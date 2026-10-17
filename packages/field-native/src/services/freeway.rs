//! FW (v0.3 §3, §4.3, §5.2) — the floor's freeway unit: it holds the link plane's listener and
//! secrets for the floor's boot, supervises the freeway host on them (the cells' `SupervisedChild`
//! shape, the listener inherited at 3), feeds the host the floor's word, and carries the host's
//! reports to fieldd and to the cells.
//!
//! - Per FLOOR boot: the loopback listener (its port is the serve's static route target), the path
//!   secret, the `/l/` secret and the freeway key. A host restart moves only `up` and `hostBootId`
//!   (contracts `FreewayState`), and a dialer's re-dial waits in the listener's backlog.
//! - The host starts on fieldd's first `declare`: before it, a host would admit no one. The floor
//!   keeps the last declaration (replace-whole, idempotent) and replays it to every host
//!   generation, so revocation is state and a host restart while fieldd is down forgets nothing.
//! - The host's line 1 is the floor's word as it stands — the declaration, the peers, the cells, the
//!   sessions — and each later change is a line that replaces its part whole. The update sender is
//!   registered BEFORE line 1 is read, so a change between the two is a later line, never lost.
//! - The host's reports: its link rows become the state's `links`; its joins go to fieldd's audit
//!   on `joins.subscribe` (up to `FREEWAY.JOIN_BACKLOG_ROWS` held while no one listens, the rest
//!   counted as `dropped`); its `revokeClient` goes to every running cell; its `revoked` answers
//!   the oldest revoke waiting.
//! - Restart intensity is the cells': at most `RESPAWN_MAX` starts in `RESPAWN_WINDOW_MS`, then the
//!   unit parks crashed (fieldd decides; the floor never restarts itself). A floor without the
//!   host installed is `disabled`, saying so, and never degrades the floor.

use crate::config::NativeConfig;
use crate::contracts::{UnitHealth, UnitState};
use crate::freeway::host::{HostHello, HostReport, JoinRow, LinkState};
use crate::manager::NativeService;
use crate::registries::{cell_supervision as supervision, freeway as limits};
use crate::services::terminal::TerminalHandle;
use crate::supervised_child::{ChildSpec, Inherited, StartFailure, StderrLabel, SupervisedChild};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::{oneshot, watch};

/// The floor boot's own: the listener and the secrets every host generation inherits. Not
/// `Debug`: it holds the secrets.
struct FloorBoot {
    floor_boot_id: String,
    listener: Option<std::net::TcpListener>,
    /// Why there is no listener, when there is none.
    unbound: Option<String>,
    port: u16,
    path_secret: String,
    local_secret: String,
    key_hex: String,
    key_generation: u64,
}

/// The floor's word, as the host's line 1 and later lines carry it.
#[derive(Default)]
struct Word {
    declaration: Option<Value>,
    peers: Vec<Value>,
    cells: Vec<Value>,
    sessions: Map<String, Value>,
}

/// What the state stream says beside the floor boot's own.
#[derive(Default)]
struct View {
    revision: u64,
    host_boot_id: Option<String>,
    links: BTreeMap<String, &'static str>,
}

#[derive(Default)]
struct Joins {
    backlog: VecDeque<Value>,
    dropped: u64,
    live: Option<UnboundedSender<Value>>,
}

impl Joins {
    /// A row, to the subscriber if one listens, else held (up to the backlog's bound) or counted.
    fn push(&mut self, row: Value) {
        if let Some(live) = &self.live {
            let frame = json!({ "rows": [row.clone()], "dropped": 0 });
            if live.send(frame).is_ok() {
                return;
            }
            self.live = None;
        }
        if self.backlog.len() < limits::JOIN_BACKLOG_ROWS as usize {
            self.backlog.push_back(row);
        } else {
            self.dropped += 1;
        }
    }

    /// A subscriber: what was held, and how much was not, as its first frame; every row after.
    fn subscribe(&mut self) -> (Value, mpsc::UnboundedReceiver<Value>) {
        let (out, frames) = mpsc::unbounded_channel();
        let rows: Vec<Value> = self.backlog.drain(..).collect();
        let first = json!({ "rows": rows, "dropped": std::mem::take(&mut self.dropped) });
        self.live = Some(out);
        (first, frames)
    }
}

struct Shared {
    boot: FloorBoot,
    word: Mutex<Word>,
    /// The running host's stdin.
    host: Mutex<Option<UnboundedSender<Value>>>,
    declared: watch::Sender<bool>,
    view: Mutex<View>,
    state: watch::Sender<Value>,
    joins: Mutex<Joins>,
    revokes: Mutex<VecDeque<oneshot::Sender<u64>>>,
    stopping: watch::Sender<bool>,
    health: Mutex<UnitHealth>,
    ping: UnboundedSender<()>,
    terminal: TerminalHandle,
}

/// Why a revoke has no answer: the host ended before it gave one, or never answered in time.
#[derive(Debug, PartialEq, Eq)]
pub struct Unanswered;

/// The unit's door, for mgmt and for the wiring that feeds it the floor's word.
#[derive(Clone)]
pub struct FreewayHandle {
    shared: Arc<Shared>,
}

impl FreewayHandle {
    /// `native.freeway.declare` (validated by the caller): replace-whole and idempotent; the
    /// first starts the host.
    pub fn declare(&self, declaration: Value) {
        let mut word = self.shared.word.lock().unwrap();
        self.shared.tell(&json!({ "declaration": &declaration }));
        word.declaration = Some(declaration);
        drop(word);
        self.shared.declared.send_replace(true);
    }

    /// The floor's cells: `{cellBootId, keyHex, keyGeneration, controlUrl, framesUrl,
    /// routeRevision}` each.
    pub fn set_cells(&self, cells: Vec<Value>) {
        let mut word = self.shared.word.lock().unwrap();
        self.shared.tell(&json!({ "cells": &cells }));
        word.cells = cells;
    }

    /// The floor's sessions: `{sessionId: {cellBootId, leaseEpoch?}}`.
    pub fn set_sessions(&self, sessions: Map<String, Value>) {
        let mut word = self.shared.word.lock().unwrap();
        self.shared.tell(&json!({ "sessions": &sessions }));
        word.sessions = sessions;
    }

    /// The floor's peers: `{deviceId, nodeId}` each.
    pub fn set_peers(&self, peers: Vec<Value>) {
        let mut word = self.shared.word.lock().unwrap();
        self.shared.tell(&json!({ "peers": &peers }));
        word.peers = peers;
    }

    /// `native.freeway.revoke {clientId?}`: how many phone links the host closed. No host: no
    /// keyring exists to wall, and no link to close.
    pub async fn revoke(&self, client_id: Option<String>) -> Result<u64, Unanswered> {
        let (answer, answered) = oneshot::channel();
        {
            let host = self.shared.host.lock().unwrap();
            let Some(host) = host.as_ref() else {
                return Ok(0);
            };
            self.shared.revokes.lock().unwrap().push_back(answer);
            let order = json!({ "revoke": { "clientId": client_id } });
            if host.send(order).is_err() {
                return Err(Unanswered);
            }
        }
        let deadline = Duration::from_millis(supervision::HELLO_DEADLINE_MS);
        match tokio::time::timeout(deadline, answered).await {
            Ok(Ok(closed)) => Ok(closed),
            _ => Err(Unanswered),
        }
    }

    /// The revisioned state (contracts `FreewayState`), the full value at every change.
    pub fn state_rx(&self) -> watch::Receiver<Value> {
        self.shared.state.subscribe()
    }

    /// `native.freeway.joins.subscribe`: the first frame, and every one after.
    pub fn subscribe_joins(&self) -> (Value, mpsc::UnboundedReceiver<Value>) {
        self.shared.joins.lock().unwrap().subscribe()
    }
}

impl Shared {
    /// A line for the running host, if one runs. Called under the word's lock, so a generation
    /// reading its line 1 sees the change or gets the line.
    fn tell(&self, line: &Value) {
        if let Some(host) = self.host.lock().unwrap().as_ref() {
            let _ = host.send(line.clone());
        }
    }

    fn line_one(&self) -> Value {
        let word = self.word.lock().unwrap();
        let mut line = json!({
            "floorBootId": self.boot.floor_boot_id,
            "pathSecret": self.boot.path_secret,
            "localSecret": self.boot.local_secret,
            "freewayKeyHex": self.boot.key_hex,
            "freewayKeyGeneration": self.boot.key_generation,
            "peers": word.peers,
            "cells": word.cells,
            "sessions": word.sessions,
        });
        if let Some(declaration) = &word.declaration {
            line["declaration"] = declaration.clone();
        }
        line
    }

    fn set_health(&self, state: UnitState, detail: String) {
        *self.health.lock().unwrap() = UnitHealth {
            unit: "freeway".into(),
            state,
            detail: Some(detail),
            auth_url: None,
        };
        let _ = self.ping.send(());
    }

    /// The state stream's value, re-rendered at every change, at a higher revision.
    fn publish(&self, view: &mut View) {
        view.revision += 1;
        let links: Vec<Value> = (view.links.iter())
            .map(|(device, state)| json!({ "deviceId": device, "state": state }))
            .collect();
        let mut state = json!({
            "revision": view.revision,
            "up": view.host_boot_id.is_some(),
            "floorBootId": self.boot.floor_boot_id,
            "links": links,
        });
        // The host gone: no port, no secrets — fieldd declares no serve on a floor that serves
        // no one.
        if let Some(host_boot_id) = &view.host_boot_id {
            state["hostBootId"] = json!(host_boot_id);
            state["port"] = json!(self.boot.port);
            state["pathSecret"] = json!(self.boot.path_secret);
            state["localSecret"] = json!(self.boot.local_secret);
            state["freewayKeyHex"] = json!(self.boot.key_hex);
            state["keyGeneration"] = json!(self.boot.key_generation);
        }
        self.state.send_replace(state);
    }

    fn host_up(&self, hello: &HostHello) {
        let mut view = self.view.lock().unwrap();
        view.host_boot_id = Some(hello.host_boot_id.clone());
        view.links.clear();
        self.publish(&mut view);
        let detail = format!(
            "host {} serving on 127.0.0.1:{}",
            hello.host_boot_id, self.boot.port
        );
        self.set_health(UnitState::Up, detail);
    }

    /// A generation ended (or never started): its stdin, its links and its unanswered revokes
    /// go with it.
    fn host_gone(&self) {
        self.host.lock().unwrap().take();
        self.revokes.lock().unwrap().clear();
        let mut view = self.view.lock().unwrap();
        if view.host_boot_id.take().is_some() || !view.links.is_empty() {
            view.links.clear();
            self.publish(&mut view);
        }
    }

    fn on_report(&self, line: &str) {
        let report: HostReport = match serde_json::from_str(line) {
            Ok(report) => report,
            Err(error) => {
                return tracing::warn!(
                    event = "field_native.freeway.report_unparsed",
                    component = "freeway",
                    class = ?error.classify(),
                    column = error.column(),
                    "a freeway host line did not parse; ignored"
                );
            }
        };
        match report {
            HostReport::Link(row) => {
                let mut view = self.view.lock().unwrap();
                match row.state {
                    LinkState::Up => view.links.insert(row.device_id, "up"),
                    LinkState::Down => view.links.remove(&row.device_id),
                };
                self.publish(&mut view);
            }
            HostReport::Joined(row) => self.join("joined", row),
            HostReport::Left(row) => self.join("left", row),
            HostReport::RevokeClient(wall) => {
                let line = json!({ "revokeClient": wall });
                let told = self.terminal.tell_cells(&line);
                tracing::info!(
                    event = "field_native.freeway.revoke_client",
                    component = "freeway",
                    client = %wall.client_id,
                    before = wall.before_generation,
                    cells = told,
                    "A client's wall was handed to every running cell"
                );
            }
            HostReport::Revoked(answer) => {
                if let Some(waiting) = self.revokes.lock().unwrap().pop_front() {
                    let _ = waiting.send(answer.closed);
                }
            }
        }
    }

    fn join(&self, kind: &str, row: JoinRow) {
        let row = json!({
            "kind": kind,
            "clientId": row.client_id,
            "sessionId": row.session_id,
            "rights": row.rights,
            "at": row.at,
        });
        self.joins.lock().unwrap().push(row);
    }
}

#[cfg(unix)]
fn descriptor(listener: &std::net::TcpListener) -> Inherited {
    std::os::fd::AsRawFd::as_raw_fd(listener)
}

#[cfg(windows)]
fn descriptor(listener: &std::net::TcpListener) -> Inherited {
    std::os::windows::io::AsRawSocket::as_raw_socket(listener)
}

fn secret() -> String {
    hex::encode(rand::random::<[u8; 32]>())
}

pub struct FreewayUnit {
    shared: Arc<Shared>,
    bin: Option<PathBuf>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl FreewayUnit {
    pub fn new(
        config: &NativeConfig,
        floor_boot_id: &str,
        ping: UnboundedSender<()>,
        terminal: TerminalHandle,
    ) -> Self {
        let bound = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0));
        let (listener, unbound) = match bound {
            Ok(listener) => (Some(listener), None),
            Err(error) => (
                None,
                Some(format!("the freeway listener did not bind: {error}")),
            ),
        };
        let port = (listener.as_ref())
            .and_then(|listener| listener.local_addr().ok())
            .map_or(0, |address| address.port());
        let boot = FloorBoot {
            floor_boot_id: floor_boot_id.to_owned(),
            listener,
            unbound,
            port,
            path_secret: secret(),
            local_secret: secret(),
            key_hex: secret(),
            key_generation: 1,
        };
        let (state, _) = watch::channel(Value::Null);
        let shared = Arc::new(Shared {
            boot,
            word: Mutex::new(Word::default()),
            host: Mutex::new(None),
            declared: watch::channel(false).0,
            view: Mutex::new(View::default()),
            state,
            joins: Mutex::new(Joins::default()),
            revokes: Mutex::new(VecDeque::new()),
            stopping: watch::channel(false).0,
            health: Mutex::new(UnitHealth {
                unit: "freeway".into(),
                state: UnitState::Up,
                detail: Some("no declaration yet: no host runs, and no one links".into()),
                auth_url: None,
            }),
            ping,
            terminal,
        });
        shared.publish(&mut shared.view.lock().unwrap());
        Self {
            shared,
            bin: config.freeway_binary(),
            task: Mutex::new(None),
        }
    }

    pub fn handle(&self) -> FreewayHandle {
        FreewayHandle {
            shared: self.shared.clone(),
        }
    }
}

#[async_trait::async_trait]
impl NativeService for FreewayUnit {
    fn id(&self) -> &'static str {
        "freeway"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        // The host's walls reach the cells through the terminal unit.
        &["terminal"]
    }

    async fn start(&self) -> anyhow::Result<()> {
        if let Some(unbound) = &self.shared.boot.unbound {
            anyhow::bail!("{unbound}");
        }
        let task = tokio::spawn(supervise(self.shared.clone(), self.bin.clone()));
        *self.task.lock().unwrap() = Some(task);
        Ok(())
    }

    fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    async fn stop(&self) -> anyhow::Result<()> {
        self.shared.stopping.send_replace(true);
        let task = self.task.lock().unwrap().take();
        if let Some(mut task) = task {
            let budget = supervision::DRAIN_BUDGET_MS + supervision::EXIT_GRACE_MS + 1_000;
            let ended = tokio::time::timeout(Duration::from_millis(budget), &mut task).await;
            if ended.is_err() {
                task.abort();
            }
        }
        Ok(())
    }
}

enum End {
    Stopped,
    Crashed(String),
}

async fn supervise(shared: Arc<Shared>, bin: Option<PathBuf>) {
    let mut declared = shared.declared.subscribe();
    let mut stopping = shared.stopping.subscribe();
    // The host starts on fieldd's first declaration: before it, it would admit no one.
    tokio::select! {
        _ = async { let _ = declared.wait_for(|declared| *declared).await; } => {}
        _ = async { let _ = stopping.wait_for(|stop| *stop).await; } => return,
    }
    let Some(bin) = bin else {
        let detail = "the freeway host is not installed beside this floor".to_owned();
        shared.set_health(UnitState::Disabled, detail);
        return;
    };
    let window = Duration::from_millis(supervision::RESPAWN_WINDOW_MS);
    let mut starts: Vec<Instant> = Vec::new();
    loop {
        if *stopping.borrow() {
            return;
        }
        let now = Instant::now();
        starts.retain(|started| now.duration_since(*started) < window);
        if starts.len() >= supervision::RESPAWN_MAX as usize {
            let detail = format!(
                "the freeway host started {} times in {} s and did not stay; parked",
                starts.len(),
                window.as_secs()
            );
            shared.set_health(UnitState::Crashed, detail);
            return;
        }
        starts.push(now);
        shared.set_health(UnitState::Starting, "the freeway host is starting".into());
        match run_generation(&shared, &bin, &mut stopping).await {
            End::Stopped => return,
            End::Crashed(detail) => tracing::warn!(
                event = "field_native.freeway.host_crashed",
                component = "freeway",
                detail = %detail,
                "The freeway host ended on its own"
            ),
        }
    }
}

fn failure_words(failure: &StartFailure) -> String {
    match failure {
        StartFailure::Spawn(error) => format!("spawn failed: {error}"),
        StartFailure::Bootstrap(error) => format!("bootstrap write failed: {error}"),
        StartFailure::HelloUnparsed(error) => format!("hello did not parse: {error}"),
        StartFailure::ExitedBeforeHello => "the host exited before its hello".into(),
        StartFailure::NoHello(deadline) => format!("no hello within {deadline:?} — killed"),
    }
}

async fn run_generation(
    shared: &Arc<Shared>,
    bin: &Path,
    stopping: &mut watch::Receiver<bool>,
) -> End {
    let Some(listener) = shared.boot.listener.as_ref() else {
        return End::Crashed("no listener to hand over".into());
    };
    // The sender before line 1: a word that changes between them is a later line, never lost.
    let (updates_out, mut updates) = mpsc::unbounded_channel();
    *shared.host.lock().unwrap() = Some(updates_out);
    let spec = ChildSpec {
        bin,
        args: vec!["--listener-fd".into(), "3".into()],
        bootstrap: shared.line_one(),
        hello_deadline: Duration::from_millis(supervision::HELLO_DEADLINE_MS),
        stderr: StderrLabel {
            event: "field_native.freeway.host_stderr",
            component: "freeway",
            what: "freeway host",
            instance: 0,
        },
        inherit: Some(descriptor(listener)),
    };
    let (mut host, hello) = match SupervisedChild::start::<HostHello>(spec).await {
        Ok(started) => started,
        Err(failure) => {
            shared.host_gone();
            return End::Crashed(failure_words(&failure));
        }
    };
    shared.host_up(&hello);
    let mut lines = host
        .take_lines()
        .expect("the host's stdout is its own until taken");
    let mut reading = true;
    let drain_budget =
        Duration::from_millis(supervision::DRAIN_BUDGET_MS + supervision::EXIT_GRACE_MS);
    let requested = async {
        let _ = stopping.wait_for(|stop| *stop).await;
    };
    tokio::pin!(requested);
    let end = loop {
        tokio::select! {
            _ = &mut requested => {
                host.drain(drain_budget).await;
                break End::Stopped;
            }
            status = host.wait() => break End::Crashed(format!("{status:?}")),
            Some(update) = updates.recv() => {
                // A host whose stdin is gone is dying; its wait says why.
                if let Err(error) = host.update(&update).await {
                    tracing::warn!(
                        event = "field_native.freeway.host_update_failed",
                        component = "freeway",
                        error = %error,
                        "A stdin update did not reach the freeway host"
                    );
                }
            }
            line = lines.next_line(), if reading => match line {
                Ok(Some(line)) => shared.on_report(&line),
                Ok(None) | Err(_) => reading = false,
            },
        }
    };
    shared.host_gone();
    end
}

/// The wiring's feeds (`lib.rs`): the floor's cells, from the terminal unit's route snapshot —
/// a cell serving its doors, with its grant key, at the snapshot's revision.
pub fn feed_cells(
    handle: FreewayHandle,
    mut routes: watch::Receiver<crate::contracts::TerminalRouteSnapshot>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let cells: Vec<Value> = {
                let snapshot = routes.borrow_and_update();
                let revision = snapshot.revision;
                (snapshot.cells.iter())
                    .filter_map(|cell| {
                        let doors = cell.doors.as_ref()?;
                        let key = cell.grant_key.as_ref()?;
                        Some(json!({
                            "cellBootId": cell.cell_boot_id,
                            "keyHex": key,
                            "keyGeneration": cell.grant_key_generation.unwrap_or(1),
                            "controlUrl": doors.control_url.to_string(),
                            "framesUrl": doors.frames_url.to_string(),
                            "routeRevision": revision,
                        }))
                    })
                    .collect()
            };
            handle.set_cells(cells);
            if routes.changed().await.is_err() {
                return;
            }
        }
    })
}

/// The floor's sessions, from the observed inventory: each session's cell.
pub fn feed_sessions(
    handle: FreewayHandle,
    mut observed: watch::Receiver<crate::contracts::ObservedState>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let sessions: Map<String, Value> = (observed.borrow_and_update().terminals.iter())
                .filter_map(|terminal| {
                    let cell = terminal.cell.as_ref()?;
                    let row = json!({ "cellBootId": cell.cell_boot_id });
                    Some((terminal.session_id.clone(), row))
                })
                .collect();
            handle.set_sessions(sessions);
            if observed.changed().await.is_err() {
                return;
            }
        }
    })
}

/// The floor's peers, from the mesh node: each peer that names its device, with its node id. A
/// peer change re-reads the list (subscribed BEFORE the read, so none slips between them); the
/// node coming or going starts over. No node is no peers: said only to withdraw peers this feed
/// gave, since the word starts with none.
pub fn feed_peers(
    handle: FreewayHandle,
    mesh: crate::services::mesh::MeshHandle,
) -> tokio::task::JoinHandle<()> {
    use tokio::sync::broadcast::error::RecvError;
    tokio::spawn(async move {
        let mut presence = mesh.node_presence();
        let mut gave = false;
        loop {
            let Some(node) = mesh.node() else {
                if std::mem::take(&mut gave) {
                    handle.set_peers(Vec::new());
                }
                if presence.changed().await.is_err() {
                    return;
                }
                continue;
            };
            let mut changes = node.on_peer_change();
            loop {
                let peers: Vec<Value> = (node.peers().await.into_iter())
                    .filter_map(|peer| {
                        let device = peer.device_id?;
                        Some(json!({ "deviceId": device, "nodeId": peer.tailscale_id }))
                    })
                    .collect();
                handle.set_peers(peers);
                gave = true;
                tokio::select! {
                    change = changes.recv() => match change {
                        Ok(_) | Err(RecvError::Lagged(_)) => {}
                        // The node's session ended: wait for the node to come or go before
                        // reading it again, never a loop on a dead channel.
                        Err(RecvError::Closed) => {
                            if presence.changed().await.is_err() {
                                return;
                            }
                            break;
                        }
                    },
                    moved = presence.changed() => {
                        if moved.is_err() {
                            return;
                        }
                        break;
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit() -> (FreewayUnit, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
        let (ping, _) = mpsc::unbounded_channel();
        let terminal = crate::services::terminal::TerminalUnit::new(&config, ping.clone());
        let unit = FreewayUnit::new(&config, "fb-test", ping, terminal.handle());
        (unit, dir)
    }

    #[tokio::test]
    async fn the_hosts_reports_become_the_state_the_joins_and_the_revoke_answers() {
        let (unit, _dir) = unit();
        let handle = unit.handle();
        let shared = &unit.shared;
        // Before a host: down, the floor boot named, no port and no secret said.
        let state = handle.state_rx().borrow().clone();
        assert_eq!(
            (&state["up"], &state["floorBootId"]),
            (&json!(false), &json!("fb-test"))
        );
        assert!(state.get("port").is_none() && state.get("pathSecret").is_none());

        let hello = HostHello {
            host_boot_id: "hb-1".into(),
            pid: 7,
        };
        shared.host_up(&hello);
        shared.on_report(r#"{"link":{"deviceId":"dev-b","state":"up"}}"#);
        let state = handle.state_rx().borrow().clone();
        assert_eq!(
            (&state["up"], &state["hostBootId"]),
            (&json!(true), &json!("hb-1"))
        );
        assert_eq!(state["port"], json!(shared.boot.port));
        assert_eq!(
            state["links"],
            json!([{ "deviceId": "dev-b", "state": "up" }])
        );
        shared.on_report(r#"{"link":{"deviceId":"dev-b","state":"down"}}"#);
        assert_eq!(
            handle.state_rx().borrow()["links"],
            json!([]),
            "a link's down is its end"
        );

        let joined = r#"{"joined":{"clientId":"freeway:p#n~hb-1","sessionId":"s-1","rights":["read"],"at":5}}"#;
        shared.on_report(joined);
        shared.on_report("not a report");
        let (first, _) = handle.subscribe_joins();
        let row = json!({ "kind": "joined", "clientId": "freeway:p#n~hb-1", "sessionId": "s-1", "rights": ["read"], "at": 5 });
        assert_eq!(first, json!({ "rows": [row], "dropped": 0 }));

        // A revoke waits for the host's answer; a wall reaches every running cell (none here).
        let (sent, mut said) = mpsc::unbounded_channel();
        *shared.host.lock().unwrap() = Some(sent);
        let revoking = tokio::spawn({
            let handle = handle.clone();
            async move { handle.revoke(None).await }
        });
        let order = said.recv().await.unwrap();
        assert_eq!(order, json!({ "revoke": { "clientId": null } }));
        shared
            .on_report(r#"{"revokeClient":{"clientId":"freeway:p#n~hb-1","beforeGeneration":3}}"#);
        shared.on_report(r#"{"revoked":{"closed":1}}"#);
        assert_eq!(revoking.await.unwrap(), Ok(1));

        // The host gone: down again, its links with it, and a revoke without a host is 0.
        shared.host_gone();
        let state = handle.state_rx().borrow().clone();
        assert_eq!((&state["up"], &state["links"]), (&json!(false), &json!([])));
        assert!(state.get("pathSecret").is_none());
        assert_eq!(handle.revoke(Some("anyone".into())).await, Ok(0));
    }

    fn declaration() -> Value {
        json!({ "deviceId": "dev-a", "admit": [], "doors": {}, "exposure": { "terminals": true } })
    }

    #[tokio::test]
    async fn no_host_starts_before_fieldd_declares() {
        let (unit, _dir) = unit();
        let bin = Some(PathBuf::from("/usr/bin/false"));
        let supervisor = tokio::spawn(supervise(unit.shared.clone(), bin));
        // One yield runs the supervisor to its first wait: a generation would have registered its
        // stdin before any await.
        tokio::task::yield_now().await;
        assert!(
            unit.shared.host.lock().unwrap().is_none(),
            "no host before the declaration"
        );
        unit.shared.stopping.send_replace(true);
        supervisor.await.unwrap();
    }

    #[tokio::test]
    async fn a_floor_without_the_host_installed_says_so_disabled_and_never_degrades() {
        let (unit, _dir) = unit();
        unit.handle().declare(declaration());
        supervise(unit.shared.clone(), None).await;
        let health = unit.health();
        assert_eq!(health.state, UnitState::Disabled, "{:?}", health.detail);
        assert!(health.detail.unwrap().contains("not installed"));
    }

    #[tokio::test]
    async fn a_host_that_will_not_stay_is_parked_crashed_at_the_cells_intensity() {
        let (unit, _dir) = unit();
        unit.handle().declare(declaration());
        supervise(unit.shared.clone(), Some(PathBuf::from("/usr/bin/false"))).await;
        let health = unit.health();
        assert_eq!(health.state, UnitState::Crashed, "{:?}", health.detail);
        let starts = format!("started {} times", supervision::RESPAWN_MAX);
        assert!(health.detail.unwrap().contains(&starts));
        assert_eq!(unit.handle().state_rx().borrow()["up"], json!(false));
    }

    #[tokio::test]
    async fn the_word_is_line_one_and_every_change_after_is_a_line() {
        let (unit, _dir) = unit();
        let handle = unit.handle();
        handle.set_peers(vec![json!({ "deviceId": "dev-b", "nodeId": "n-1" })]);
        let (sent, mut said) = mpsc::unbounded_channel();
        *unit.shared.host.lock().unwrap() = Some(sent);
        let line = unit.shared.line_one();
        assert_eq!(
            line["peers"],
            json!([{ "deviceId": "dev-b", "nodeId": "n-1" }])
        );
        assert!(line.get("declaration").is_none(), "no declaration yet");
        assert_eq!(line["floorBootId"], "fb-test");
        let declaration = json!({ "deviceId": "dev-a", "admit": [], "doors": {}, "exposure": { "terminals": true } });
        handle.declare(declaration.clone());
        assert_eq!(
            said.recv().await.unwrap(),
            json!({ "declaration": declaration })
        );
        assert_eq!(unit.shared.line_one()["declaration"], declaration);
        assert!(
            *unit.shared.declared.borrow(),
            "the first declaration starts the host"
        );
    }

    #[test]
    fn the_joins_are_held_while_no_one_listens_counted_past_the_bound_and_streamed_after() {
        let mut joins = Joins::default();
        let bound = limits::JOIN_BACKLOG_ROWS as usize;
        for at in 0..bound + 3 {
            joins.push(json!({ "at": at }));
        }
        let (first, mut frames) = joins.subscribe();
        assert_eq!(first["rows"].as_array().unwrap().len(), bound);
        assert_eq!(
            (&first["rows"][0]["at"], &first["dropped"]),
            (&json!(0), &json!(3))
        );
        joins.push(json!({ "at": "live" }));
        let frame = frames.try_recv().unwrap();
        assert_eq!(frame, json!({ "rows": [{ "at": "live" }], "dropped": 0 }));
        // The subscriber gone, rows are held again, and a later one gets them.
        drop(frames);
        joins.push(json!({ "at": "held" }));
        let (first, _frames) = joins.subscribe();
        assert_eq!(first, json!({ "rows": [{ "at": "held" }], "dropped": 0 }));
    }
}
