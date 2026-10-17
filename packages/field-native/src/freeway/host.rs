//! FW (v0.3 §3, §5.2) — the freeway host: the floor's supervised child for the link plane. The
//! binary (`field-freeway-host`) hands this the floor-held listener; everything else is here,
//! testable in-process, on the cells' pipe pattern (`cell.rs`):
//!
//! - stdin line 1 is `HostBootstrap`: the floor boot, the path secret and the freeway key
//!   (memory-only and never logged, EL7: a line that does not parse is reported by its position
//!   alone), fieldd's last declaration if it has made one, and the floor's peers, cells and
//!   sessions. The rest of line 1 is FD1's (the `/l/` secret, the E3 egress) and is not read
//!   here. Each later line is a `HostUpdate`: a part replaced whole, or an order, a `revoke` or a
//!   `restart`. EOF is the leash: every link closes 1001, the host waits for them (the floor's
//!   drain budget bounds the wait) and returns.
//! - stdout line 1 is `HostHello {hostBootId, pid}`; each later line is a `HostReport`: a link up
//!   or down, a join or a leave, a revoke's `revokeClient` for the floor to hand every cell.
//! - One link per node (§5.1): a newer link from a node supersedes its older one (4409). A node
//!   the declaration no longer admits as the device and role it linked as loses its link (4410).
//!   A revoke closes the matching phone links (4401) and names each keyring's `beforeGeneration`,
//!   and those keyrings mint nothing until a new link reopens them.

use super::approval::ApprovalKey;
use super::door::{accept, DoorConfig};
use super::hello::{decide, Admit, Host, Identity, PeerRole};
use super::keyring::{CellRoute, Placement, SessionRoute};
use super::link::{self, FloorState, LinkCommand, Shared};
use crate::contracts::{FreewayAdmitRowRole, FreewayDeclareParams};
use crate::registries::freeway_codes as codes;
use crate::tp::grant::{AttachRight, GrantKey};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

/// After an accept that failed (EMFILE and friends): the cell door's own breath (`tp/door.rs`).
const ACCEPT_BREATH: Duration = Duration::from_millis(50);

/// stdin line 1 (§5.2). Not `Debug`: it carries the path secret and the freeway key.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostBootstrap {
    pub floor_boot_id: String,
    /// The serve's one route ends at `/f/<pathSecret>`.
    pub path_secret: String,
    /// The floor's freeway key, hex: fieldd MACs a phone's approval with it.
    pub freeway_key_hex: String,
    pub freeway_key_generation: u64,
    /// fieldd's last declaration; none until fieldd has made one, and until then no one links.
    #[serde(default)]
    pub declaration: Option<FreewayDeclareParams>,
    #[serde(default)]
    pub peers: Vec<PeerRow>,
    #[serde(default)]
    pub cells: Vec<CellRow>,
    #[serde(default)]
    pub sessions: HashMap<String, SessionRow>,
}

/// A floor peer row: the tailnet node a roster device is.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerRow {
    pub device_id: String,
    pub node_id: String,
}

/// A cell, as the floor's route rows name it. Not `Debug`: it carries the cell's grant key.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellRow {
    pub cell_boot_id: String,
    pub key_hex: String,
    pub key_generation: u64,
    pub control_url: String,
    pub frames_url: String,
    pub route_revision: u64,
}

/// A session's placement: its cell, and custody's lease epoch once it is exposed. fieldd's
/// tickets carry the epoch then, so the host's do too.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub cell_boot_id: String,
    #[serde(default)]
    pub lease_epoch: Option<u64>,
}

/// A later stdin line: each part present replaces the host's whole; an order is carried out.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdate {
    #[serde(default)]
    pub declaration: Option<FreewayDeclareParams>,
    #[serde(default)]
    pub peers: Option<Vec<PeerRow>>,
    #[serde(default)]
    pub cells: Option<Vec<CellRow>>,
    #[serde(default)]
    pub sessions: Option<HashMap<String, SessionRow>>,
    #[serde(default)]
    pub revoke: Option<RevokeOrder>,
    #[serde(default)]
    pub restart: Option<RestartOrder>,
}

/// `native.freeway.revoke`, relayed: one client, or every phone's without one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeOrder {
    #[serde(default)]
    pub client_id: Option<String>,
}

/// A planned restart: `RestartScheduled`'s reason and planes, passed through as the floor gave
/// them, and how long the peers wait before they redial.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartOrder {
    pub reason: Value,
    pub planes: Value,
    pub ttl_ms: u64,
}

/// stdout line 1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostHello {
    pub host_boot_id: String,
    pub pid: u32,
}

/// Each later stdout line.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HostReport {
    /// For the floor's state stream (`FreewayLinkRow`; the floor adds the path).
    Link(LinkRow),
    /// The audit (FW-L3), for `native.freeway.joins.subscribe`.
    Joined(JoinRow),
    Left(JoinRow),
    /// For every cell's stdin, as the floor fans it out.
    RevokeClient(RevokeClient),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkRow {
    pub device_id: String,
    pub state: LinkState,
}

/// What the host can say of a link it accepted (`FreewayLinkState`'s other two are a dialer's).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinkState {
    Up,
    Down,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JoinRow {
    pub client_id: String,
    pub session_id: String,
    pub rights: Vec<AttachRight>,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevokeClient {
    pub client_id: String,
    pub before_generation: u64,
}

struct Core {
    host_boot_id: String,
    door: DoorConfig,
    shared: Arc<Mutex<Shared>>,
    /// What the floor said that no link reads: the admit table is built from it.
    said: Mutex<Said>,
    links: Mutex<Links>,
    out: mpsc::UnboundedSender<Value>,
    now: fn() -> u64,
}

struct Said {
    declaration: Option<FreewayDeclareParams>,
    peers: Vec<PeerRow>,
}

#[derive(Default)]
struct Links {
    by_node: HashMap<String, Entry>,
    /// The leash is pulled: a link admitted now closes at once.
    draining: bool,
    /// A restart is ordered: a link admitted now is told so at once.
    restarting: Option<Value>,
}

struct Entry {
    seq: u64,
    device_id: String,
    role: PeerRole,
    client: Option<String>,
    commands: mpsc::UnboundedSender<LinkCommand>,
}

/// Run the host until the leash: stdin line 1 first, then the listener and the update lines.
pub async fn run<R, W>(listener: TcpListener, stdin: R, stdout: W, now: fn() -> u64) -> Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let mut lines = stdin.lines();
    let first = (lines.next_line().await)
        .context("read the bootstrap line")?
        .context("stdin closed before the bootstrap line")?;
    let bootstrap: HostBootstrap = serde_json::from_str(&first).map_err(|error| {
        let (class, column) = (error.classify(), error.column());
        anyhow!("the bootstrap line did not parse ({class:?} at column {column})")
    })?;
    let (out, queued) = mpsc::unbounded_channel();
    let writer = tokio::spawn(write_lines(stdout, queued));
    let core = Arc::new(Core::new(bootstrap, out, now)?);
    let hello = HostHello {
        host_boot_id: core.host_boot_id.clone(),
        pid: std::process::id(),
    };
    core.line(&hello);
    let mut tasks = JoinSet::new();
    let mut seq = 0;
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    seq += 1;
                    tasks.spawn(serve(core.clone(), stream, seq));
                }
                Err(error) => {
                    tracing::warn!(
                        event = "field_native.freeway.accept_error",
                        component = "freeway",
                        error = %error,
                        "freeway accept failed"
                    );
                    tokio::time::sleep(ACCEPT_BREATH).await;
                }
            },
            line = lines.next_line() => match line {
                Ok(Some(line)) => core.apply(&line),
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(
                        event = "field_native.freeway.stdin_error",
                        component = "freeway",
                        error = %error,
                        "freeway stdin failed; draining"
                    );
                    break;
                }
            },
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
        }
    }
    core.drain();
    while tasks.join_next().await.is_some() {}
    // The last sender goes with the core: the writer flushes what is queued, then ends.
    drop(core);
    let _ = writer.await;
    Ok(())
}

/// One accepted connection: the door, then (admitted) the link, registered as its node's.
async fn serve(core: Arc<Core>, stream: TcpStream, seq: u64) {
    let link_id = format!("lk-{seq}");
    let now = core.now;
    let decided = |payload: &[u8], identity: &Identity| {
        let shared = core.shared.lock().unwrap();
        let floor = &shared.floor;
        // Until fieldd declares no node is admitted, so no welcome ever names an empty desktop.
        let host = Host {
            link_id: &link_id,
            host_boot_id: &core.host_boot_id,
            floor_boot_id: &floor.approval_key.floor_boot_id,
            device_id: floor.device_id.as_deref().unwrap_or_default(),
        };
        decide(
            payload,
            identity,
            &floor.admit,
            &floor.approval_key,
            &host,
            now(),
        )
    };
    let Some((ws, admitted)) = accept(stream, &core.door, decided).await else {
        return;
    };
    let node = admitted.identity.node_id.clone();
    let device_id = admitted.device_id.clone();
    let (commands_out, commands) = mpsc::unbounded_channel();
    {
        let mut links = core.links.lock().unwrap();
        if links.draining {
            let _ = commands_out.send(LinkCommand::Close(1001));
        } else if let Some(restarting) = &links.restarting {
            let _ = commands_out.send(LinkCommand::Restart(restarting.clone()));
        }
        let entry = Entry {
            seq,
            device_id: device_id.clone(),
            role: admitted.role,
            client: admitted.client_id.clone(),
            commands: commands_out,
        };
        if let Some(older) = links.by_node.insert(node.clone(), entry) {
            let _ = older.commands.send(LinkCommand::Close(codes::SUPERSEDED));
        }
    }
    let up = LinkRow {
        device_id: device_id.clone(),
        state: LinkState::Up,
    };
    core.line(&HostReport::Link(up));
    let shared = core.shared.clone();
    let end = link::run(ws, admitted, shared, commands, core.out.clone(), now).await;
    tracing::info!(
        event = "field_native.freeway.link_ended",
        component = "freeway",
        link = %link_id,
        end = ?end,
        "freeway link ended"
    );
    let ours = {
        let mut links = core.links.lock().unwrap();
        let ours = (links.by_node.get(&node)).is_some_and(|entry| entry.seq == seq);
        if ours {
            links.by_node.remove(&node);
        }
        ours
    };
    // A newer link from the node took this one's place: the device is still up on that one.
    if ours {
        let down = LinkRow {
            device_id,
            state: LinkState::Down,
        };
        core.line(&HostReport::Link(down));
    }
}

impl Core {
    fn new(
        bootstrap: HostBootstrap,
        out: mpsc::UnboundedSender<Value>,
        now: fn() -> u64,
    ) -> Result<Self> {
        // Never the key in an error: the decoder's own would quote a character of it.
        let key = hex::decode(&bootstrap.freeway_key_hex)
            .map_err(|_| anyhow!("the bootstrap's freeway key is not hex"))?;
        let said = Said {
            declaration: bootstrap.declaration,
            peers: bootstrap.peers,
        };
        let (admit, device_id, terminals) = admission(&said);
        let floor = FloorState {
            placement: Placement {
                cells: cell_routes(bootstrap.cells),
                sessions: session_routes(bootstrap.sessions),
            },
            terminals,
            approval_key: ApprovalKey {
                floor_boot_id: bootstrap.floor_boot_id,
                key_generation: bootstrap.freeway_key_generation,
                key,
            },
            admit,
            device_id,
        };
        let keyrings = HashMap::new();
        Ok(Self {
            host_boot_id: format!("hb-{}", hex::encode(rand::random::<[u8; 8]>())),
            door: DoorConfig::new(bootstrap.path_secret),
            shared: Arc::new(Mutex::new(Shared { floor, keyrings })),
            said: Mutex::new(said),
            links: Mutex::new(Links::default()),
            out,
            now,
        })
    }

    fn line(&self, line: &impl Serialize) {
        if let Ok(value) = serde_json::to_value(line) {
            let _ = self.out.send(value);
        }
    }

    fn apply(&self, line: &str) {
        let update: HostUpdate = match serde_json::from_str(line) {
            Ok(update) => update,
            // Its position alone: the line may carry keys.
            Err(error) => {
                return tracing::warn!(
                    event = "field_native.freeway.update_unparsed",
                    component = "freeway",
                    class = ?error.classify(),
                    column = error.column(),
                    "a freeway update line did not parse; ignored"
                );
            }
        };
        if let Some(cells) = update.cells {
            self.shared.lock().unwrap().floor.placement.cells = cell_routes(cells);
        }
        if let Some(sessions) = update.sessions {
            self.shared.lock().unwrap().floor.placement.sessions = session_routes(sessions);
        }
        if update.declaration.is_some() || update.peers.is_some() {
            let (admit, device_id, terminals) = {
                let mut said = self.said.lock().unwrap();
                if let Some(declaration) = update.declaration {
                    said.declaration = Some(declaration);
                }
                if let Some(peers) = update.peers {
                    said.peers = peers;
                }
                admission(&said)
            };
            let mut shared = self.shared.lock().unwrap();
            shared.floor.admit = admit;
            shared.floor.device_id = device_id;
            shared.floor.terminals = terminals;
            // A node the declaration no longer admits, as the device and role it linked as,
            // loses its link.
            let links = self.links.lock().unwrap();
            for (node, entry) in &links.by_node {
                let kept = (shared.floor.admit.get(node))
                    .is_some_and(|(device, role)| device == entry.device_id && role == entry.role);
                if !kept {
                    let _ = entry.commands.send(LinkCommand::Close(codes::PEER_GONE));
                }
            }
        }
        if let Some(order) = update.revoke {
            self.revoke(order.client_id.as_deref());
        }
        if let Some(order) = update.restart {
            self.restart(order);
        }
    }

    /// Each matching keyring names its `beforeGeneration` (the floor gives the line to every
    /// cell) and mints nothing more; then the matching phone links close (4401).
    fn revoke(&self, client: Option<&str>) {
        let matches = |id: &str| client.is_none_or(|wanted| wanted == id);
        let walls: Vec<RevokeClient> = {
            let mut shared = self.shared.lock().unwrap();
            (shared.keyrings.iter_mut())
                .filter(|(id, _)| matches(id))
                .map(|(id, keyring)| RevokeClient {
                    client_id: id.clone(),
                    before_generation: keyring.revoke(),
                })
                .collect()
        };
        for wall in walls {
            self.line(&HostReport::RevokeClient(wall));
        }
        let links = self.links.lock().unwrap();
        for entry in links.by_node.values() {
            if entry.client.as_deref().is_some_and(matches) {
                let _ = entry.commands.send(LinkCommand::Close(codes::APPROVAL));
            }
        }
    }

    fn restart(&self, order: RestartOrder) {
        let restarting = json!({
            "type": "Restarting",
            "reason": order.reason,
            "planes": order.planes,
            "at": (self.now)(),
            "ttlMs": order.ttl_ms,
        });
        let mut links = self.links.lock().unwrap();
        for entry in links.by_node.values() {
            let _ = entry
                .commands
                .send(LinkCommand::Restart(restarting.clone()));
        }
        links.restarting = Some(restarting);
    }

    fn drain(&self) {
        let mut links = self.links.lock().unwrap();
        links.draining = true;
        for entry in links.by_node.values() {
            let _ = entry.commands.send(LinkCommand::Close(1001));
        }
    }
}

/// fieldd's admit rows (by device) joined with the floor's peer rows (device → node): a device the
/// floor knows no node for cannot link yet. No declaration: no one, and no terminals.
fn admission(said: &Said) -> (Admit, Option<String>, bool) {
    let mut admit = Admit::default();
    let Some(declaration) = &said.declaration else {
        return (admit, None, false);
    };
    for row in &declaration.admit {
        let role = match row.role {
            FreewayAdmitRowRole::Desktop => PeerRole::Desktop,
            FreewayAdmitRowRole::Phone => PeerRole::Phone,
        };
        for peer in said
            .peers
            .iter()
            .filter(|peer| peer.device_id == *row.device_id)
        {
            admit.insert(&peer.node_id, &peer.device_id, role);
        }
    }
    let device_id = declaration.device_id.to_string();
    (admit, Some(device_id), declaration.exposure.terminals)
}

fn cell_routes(rows: Vec<CellRow>) -> HashMap<String, CellRoute> {
    let routes = rows.into_iter().filter_map(|row| {
        let Ok(key) = hex::decode(&row.key_hex) else {
            tracing::warn!(
                event = "field_native.freeway.cell_key_unparsed",
                component = "freeway",
                cell = %row.cell_boot_id,
                "a cell's key is not hex; that cell is not served"
            );
            return None;
        };
        let key = GrantKey {
            cell_boot_id: row.cell_boot_id.clone(),
            key_generation: row.key_generation,
            key,
        };
        let route = CellRoute {
            key,
            route_revision: row.route_revision,
            control_url: row.control_url,
            frames_url: row.frames_url,
        };
        Some((row.cell_boot_id, route))
    });
    routes.collect()
}

fn session_routes(rows: HashMap<String, SessionRow>) -> HashMap<String, SessionRoute> {
    let routes = rows.into_iter().map(|(session, row)| {
        let route = SessionRoute {
            cell_boot_id: row.cell_boot_id,
            lease_epoch: row.lease_epoch,
        };
        (session, route)
    });
    routes.collect()
}

async fn write_lines<W: AsyncWrite + Unpin>(
    mut stdout: W,
    mut lines: mpsc::UnboundedReceiver<Value>,
) {
    while let Some(line) = lines.recv().await {
        let Ok(mut bytes) = serde_json::to_vec(&line) else {
            continue;
        };
        bytes.push(b'\n');
        if stdout.write_all(&bytes).await.is_err() || stdout.flush().await.is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::frame::FrameType;
    use super::super::testing::*;
    use super::*;
    use tokio::io::{BufReader, DuplexStream, Lines};
    use tokio::task::JoinHandle;

    const TICKETS: &[u8] = br#"{"kind":"terminal-tickets","sessionIds":["sess-a"]}"#;

    /// A host on a loopback listener, its stdin and stdout pipes in the test's hands.
    struct Rig {
        port: u16,
        hello: HostHello,
        stdin: DuplexStream,
        stdout: Lines<BufReader<DuplexStream>>,
        host: JoinHandle<Result<()>>,
    }

    async fn rig(bootstrap: Value) -> Rig {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (mut stdin, host_stdin) = tokio::io::duplex(1 << 16);
        let (host_stdout, stdout) = tokio::io::duplex(1 << 16);
        let host = tokio::spawn(run(
            listener,
            BufReader::new(host_stdin),
            host_stdout,
            fixed,
        ));
        stdin
            .write_all(format!("{bootstrap}\n").as_bytes())
            .await
            .unwrap();
        let mut stdout = BufReader::new(stdout).lines();
        let first = stdout.next_line().await.unwrap().expect("the hello");
        let hello = serde_json::from_str(&first).expect("line 1 is the hello");
        Rig {
            port,
            hello,
            stdin,
            stdout,
            host,
        }
    }

    impl Rig {
        async fn say(&mut self, line: Value) {
            self.stdin
                .write_all(format!("{line}\n").as_bytes())
                .await
                .unwrap();
        }

        /// Pull the leash, and read every report until the host has left; it returns `Ok`.
        async fn leash(self) -> Vec<HostReport> {
            let Rig {
                stdin,
                mut stdout,
                host,
                ..
            } = self;
            drop(stdin);
            let mut reports = Vec::new();
            loop {
                let line = tokio::time::timeout(Duration::from_secs(5), stdout.next_line());
                let Some(line) = line.await.expect("the host leaves").unwrap() else {
                    break;
                };
                reports.push(serde_json::from_str(&line).expect("a HostReport"));
            }
            assert!(host.await.unwrap().is_ok());
            reports
        }

        async fn report(&mut self) -> HostReport {
            let line = tokio::time::timeout(Duration::from_secs(5), self.stdout.next_line());
            let line = line.await.expect("a report").unwrap().expect("a line");
            serde_json::from_str(&line).expect("every later line is a HostReport")
        }
    }

    fn declaration(role: &str, terminals: bool) -> Value {
        let admit = json!([{ "deviceId": "dev-b", "role": role }]);
        let exposure = json!({ "terminals": terminals });
        json!({ "deviceId": "dev-a", "admit": admit, "doors": {}, "exposure": exposure })
    }

    fn bootstrap(declared: Option<Value>) -> Value {
        let cell = json!({
            "cellBootId": "cb-1", "keyHex": hex::encode([7; 32]), "keyGeneration": 1,
            "controlUrl": "ws://127.0.0.1:1/control", "framesUrl": "ws://127.0.0.1:1/frames",
            "routeRevision": 1,
        });
        let mut line = json!({
            "floorBootId": FLOOR_BOOT,
            "hostGeneration": 1,
            "pathSecret": "s3cret",
            "localSecret": "not-read-in-f1",
            "freewayKeyHex": hex::encode([0xa5; 32]),
            "freewayKeyGeneration": 1,
            "peers": [{ "deviceId": "dev-b", "nodeId": NODE, "address": "100.64.0.2", "login": LOGIN }],
            "cells": [cell],
            "sessions": { "sess-a": { "cellBootId": "cb-1" } },
        });
        if let Some(declared) = declared {
            line["declaration"] = declared;
        }
        line
    }

    fn row(state: LinkState) -> HostReport {
        let device_id = "dev-b".to_owned();
        HostReport::Link(LinkRow { device_id, state })
    }

    /// A tickets open, answered: (transport generation, attach generation), its CLOSE read.
    async fn ticket(ws: &mut Client, stream: u64) -> (u64, u64) {
        send(ws, FrameType::Open, stream, TICKETS).await;
        let (kind, _, opened) = next(ws).await;
        assert_eq!(kind, FrameType::Opened);
        let ticket = &json_of(&opened)["tickets"][0]["ticket"];
        let generation =
            |grant: &str, field: &str| ticket[grant]["claims"][field].as_u64().unwrap();
        let minted = (
            generation("transportGrant", "transportGrantGeneration"),
            generation("attachGrant", "grantGeneration"),
        );
        assert_eq!(next(ws).await.0, FrameType::Close);
        minted
    }

    #[tokio::test]
    async fn the_hello_is_line_one_the_welcome_names_this_desktop_and_each_link_is_reported() {
        let mut rig = rig(bootstrap(Some(declaration("phone", true)))).await;
        assert!(rig.hello.host_boot_id.starts_with("hb-"));
        assert_eq!(rig.hello.pid, std::process::id());
        let (ws, welcome) = open(rig.port, phone_hello()).await;
        assert_eq!(
            (&welcome["type"], &welcome["deviceId"]),
            (&json!("FreewayWelcome"), &json!("dev-a"))
        );
        assert_eq!(welcome["hostBootId"], json!(rig.hello.host_boot_id));
        let client = format!("freeway:{LOGIN}#{NODE}~{}", rig.hello.host_boot_id);
        assert_eq!(welcome["clientId"], json!(client));
        assert_eq!(rig.report().await, row(LinkState::Up));
        drop(ws);
        assert_eq!(rig.report().await, row(LinkState::Down));
    }

    #[tokio::test]
    async fn no_declaration_admits_no_one() {
        let rig = rig(bootstrap(None)).await;
        let (_ws, refused) = open(rig.port, phone_hello()).await;
        assert_eq!(
            (&refused["type"], &refused["code"]),
            (&json!("FreewayRefused"), &json!("NOT_ADMITTED"))
        );
    }

    #[tokio::test]
    async fn a_newer_link_from_the_node_supersedes_the_older_and_the_device_stays_up() {
        let mut rig = rig(bootstrap(Some(declaration("desktop", true)))).await;
        let mut first = dial(rig.port, desktop_hello()).await;
        assert_eq!(rig.report().await, row(LinkState::Up));
        let second = dial(rig.port, desktop_hello()).await;
        assert_eq!(rig.report().await, row(LinkState::Up));
        assert_eq!(
            close_of(&mut first).await,
            (codes::SUPERSEDED, "SUPERSEDED".to_owned())
        );
        // The older one's end says nothing: every report left is the newer one's own end.
        drop(second);
        assert_eq!(rig.leash().await, vec![row(LinkState::Down)]);
    }

    #[tokio::test]
    async fn a_revoke_names_the_wall_closes_the_phone_4401_and_its_next_link_mints_at_the_wall() {
        let mut rig = rig(bootstrap(Some(declaration("phone", true)))).await;
        let client = format!("freeway:{LOGIN}#{NODE}~{}", rig.hello.host_boot_id);
        let mut ws = dial(rig.port, phone_hello()).await;
        assert_eq!(rig.report().await, row(LinkState::Up));
        assert_eq!(ticket(&mut ws, 1).await, (1, 1));
        assert!(
            matches!(rig.report().await, HostReport::Joined(join) if join.session_id == "sess-a")
        );
        rig.say(json!({ "revoke": {} })).await;
        let wall = RevokeClient {
            client_id: client.clone(),
            before_generation: 2,
        };
        assert_eq!(rig.report().await, HostReport::RevokeClient(wall));
        assert_eq!(
            close_of(&mut ws).await,
            (codes::APPROVAL, "APPROVAL".to_owned())
        );
        assert!(matches!(rig.report().await, HostReport::Left(join) if join.client_id == client));
        assert_eq!(rig.report().await, row(LinkState::Down));
        // Approved again, the phone's next link mints at the wall.
        let mut ws = dial(rig.port, phone_hello()).await;
        assert_eq!(rig.report().await, row(LinkState::Up));
        assert_eq!(ticket(&mut ws, 1).await, (2, 2));
    }

    #[tokio::test]
    async fn a_node_the_declaration_drops_loses_its_link_4410_and_cannot_come_back() {
        let mut rig = rig(bootstrap(Some(declaration("desktop", true)))).await;
        let mut ws = dial(rig.port, desktop_hello()).await;
        assert_eq!(rig.report().await, row(LinkState::Up));
        // A line that does not parse is ignored: the host reads on, and the next one bites.
        rig.say(json!("not an update")).await;
        let mut dropped = declaration("desktop", true);
        dropped["admit"] = json!([]);
        rig.say(json!({ "declaration": dropped })).await;
        assert_eq!(
            close_of(&mut ws).await,
            (codes::PEER_GONE, "PEER_GONE".to_owned())
        );
        let (_ws, refused) = open(rig.port, desktop_hello()).await;
        assert_eq!(refused["code"], "NOT_ADMITTED");
    }

    #[tokio::test]
    async fn a_restart_says_restarting_on_every_link_and_to_a_link_that_comes_after() {
        let mut rig = rig(bootstrap(Some(declaration("desktop", true)))).await;
        let mut ws = dial(rig.port, desktop_hello()).await;
        assert_eq!(rig.report().await, row(LinkState::Up));
        let order = json!({ "reason": "update", "planes": ["field-native"], "ttlMs": 8_000 });
        rig.say(json!({ "restart": order })).await;
        let restarting = json!({
            "type": "Restarting", "reason": "update", "planes": ["field-native"],
            "at": fixed(), "ttlMs": 8_000,
        });
        let (kind, _, said) = next(&mut ws).await;
        assert_eq!(
            (kind, json_of(&said)),
            (FrameType::Link, restarting.clone())
        );
        assert_eq!(
            close_of(&mut ws).await,
            (codes::RESTARTING, "RESTARTING".to_owned())
        );
        let mut late = dial(rig.port, desktop_hello()).await;
        let (_, _, said) = next(&mut late).await;
        assert_eq!(json_of(&said), restarting);
        assert_eq!(close_of(&mut late).await.0, codes::RESTARTING);
    }

    #[test]
    fn an_update_replaces_its_part_whole_and_one_that_does_not_parse_changes_nothing() {
        let (out, _lines) = mpsc::unbounded_channel();
        let line = bootstrap(Some(declaration("phone", true))).to_string();
        let core = Core::new(serde_json::from_str(&line).unwrap(), out, fixed).unwrap();
        let sizes = |core: &Core| {
            let placement = &core.shared.lock().unwrap().floor.placement;
            (placement.cells.len(), placement.sessions.len())
        };
        assert_eq!(sizes(&core), (1, 1));
        core.apply("not an update");
        assert_eq!(sizes(&core), (1, 1));
        core.apply(&json!({ "sessions": {} }).to_string());
        assert_eq!(sizes(&core), (1, 0));
        core.apply(&json!({ "cells": [] }).to_string());
        assert_eq!(sizes(&core), (0, 0));
    }

    #[tokio::test]
    async fn the_leash_closes_every_link_1001_and_the_host_returns() {
        let mut rig = rig(bootstrap(Some(declaration("desktop", true)))).await;
        let mut ws = dial(rig.port, desktop_hello()).await;
        assert_eq!(rig.report().await, row(LinkState::Up));
        // The host leaves only once its links have: the link's end is reported first.
        assert_eq!(rig.leash().await, vec![row(LinkState::Down)]);
        assert_eq!(close_of(&mut ws).await.0, 1001);
    }
}
