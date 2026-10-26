//! TM-2b — the link TM-2's witness said it could not reach: a REAL cell door,
//! over a REAL tailnet, through the REAL sidecar's reverse-proxy hijack.
//!
//! TM-2 landed the cell routes and proved everything up to the sidecar with a
//! stand-in splice (`packages/fieldd/test/terminal-remote-door.e2e.test.ts`).
//! What a stand-in cannot rehearse is the sidecar itself: whether its
//! WebSocket hijack carries a T1 upgrade untouched to a loopback target, and
//! whether its login allow-gate actually refuses. This row answers both on a
//! live tailnet.
//!
//! WHAT IS REAL:
//!   · the floor, bootstrapped in-process, with its cells (unconditional since
//!     TM-1), a real `field-terminal-host`, a real PTY, and real T1 doors;
//!   · the grant key, read off the floor's own route row, so the grants below
//!     are MAC'd with the key the CELL will verify against;
//!   · two ephemeral truffle nodes on the real tailnet, and the vendored
//!     sidecar this workspace pins;
//!   · the proxy route, whose shape is exactly what `build_serve_config`'s
//!     `kind: "routes"` arm produces for fieldd — prefix `/cell/<boot>/`,
//!     a loopback `targetUrl`, `strip_prefix: true`, the login in `allow`;
//!   · the dial: node B reaches node A's tailnet listener with `open_tcp`, and
//!     the WebSocket rides that stream through the sidecar's hijack;
//!   · N-H1 (2026-09-14) — THE SEED. Both arms now decode a real presentation
//!     transfer (`transfer-begin` / `transfer-chunk` / `transfer-end`) off the
//!     real PTY and assert it carried bytes. Until this date neither arm drew
//!     one and the row settled for asserting that the two agreed, which held
//!     because both were `None`. The cause was this test's own
//!     `worker_capacities()` declaring a connection window below the cell's
//!     urgent reserve; see the correction at the seed assertion for the whole
//!     of it.
//!
//! WHAT IS NOT, and it is one thing, stated because it bounds the claim: the
//! serve is registered by THIS TEST against a test-minted node, not by fieldd
//! against the FLOOR's own gateway node. The floor's mesh service has no
//! auth-key path at all — it drives an interactive browser login
//! (`services/mesh.rs`), so a floor cannot join a tailnet headlessly and no
//! test can make it. fieldd's half of that seam (declaring the route through
//! `native.mesh.serve.*`) is witnessed against the mock floor in the fieldd
//! package; what is proven HERE is everything downstream of the declaration.
//!
//! The allow-gate is exercised with a BOGUS login rather than a second
//! account: one auth key yields one login, so "a different person is refused"
//! is not constructible on one key. Refusing a gate that names nobody proves
//! the gate is consulted, which is the property that matters; a genuinely
//! foreign login stays a two-account hardware run.
//!
//! See `common/mod.rs` for the gate and the tailnet courtesies (ephemeral
//! nodes, a per-run app id). Run it:
//!   cargo test -p field-native --test terminal_cell_route_probe -- --ignored --nocapture

#[path = "support/tp_mint.rs"]
mod tp_mint;

mod common;

use common::{authkey, build_node, probe_app_id, redact, rendezvous, sidecar, AUTHKEY_ENV};
use field_native::mgmt::mesh::{build_serve_config, SecretDoor, ServeConfigInput};
use field_native::registries::ports::TERMINAL_CELLS_SERVE;
use field_native::services::terminal_client::ControlClient;
use field_native::{bootstrap, config::NativeConfig, RunningDaemon};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tp_mint::{hello, TestMinter, TransportSpec};
use truffle_core::network::tailscale::TailscaleProvider;
use truffle_core::proxy::{ProxyConfig, ProxyRoute, ProxyTarget};
use truffle_core::Node;

#[cfg(unix)]
const TENANT: &str = "/bin/cat";
#[cfg(windows)]
const TENANT: &str = r"C:\Windows\System32\cmd.exe";

/// A short data root: the cell's sockets sit three levels under it and macOS
/// caps `sun_path` at ~104 bytes (the same reason `terminal_unit.rs` does it).
#[cfg(unix)]
fn short_tempdir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("vftm2b")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp")
}
#[cfg(windows)]
fn short_tempdir() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

/// Boot the floor and wait for a cell that serves doors AND mints grants —
/// both are what a route is made of, and a cell announces them together.
async fn boot(dir: &std::path::Path) -> RunningDaemon {
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.to_path_buf()))
        .await
        .expect("bootstrap");
    let mut routes = daemon.state.terminal_routes.clone();
    timeout(
        Duration::from_secs(30),
        routes.wait_for(|snapshot| {
            snapshot
                .cells
                .iter()
                .any(|c| c.doors.is_some() && c.grant_key.is_some())
        }),
    )
    .await
    .expect("a terminal cell announced its doors within the hello budget")
    .expect("the routes watch outlives boot");
    daemon
}

/// The route config for one cell, built the way `build_serve_config`'s
/// `kind: "routes"` arm builds it (mgmt/mesh.rs). Kept in this shape ON
/// PURPOSE: if that arm changes, this row should have to change with it.
///
/// T-M4 (2026-09-14) — and "should have to" is now enforced rather than
/// intended: `assert_matches_production` builds the SAME route through the
/// production function from fieldd's own params and requires the two to be
/// equal before the serve is registered.
fn cell_route_config(
    id: &str,
    cell_boot_id: &str,
    door_port: u16,
    allow: Vec<String>,
) -> ProxyConfig {
    ProxyConfig {
        id: id.into(),
        name: "terminal".into(),
        listen_port: TERMINAL_CELLS_SERVE,
        target: ProxyTarget::default(), // ignored: routes is non-empty
        announce: false,
        tls: false,
        allow_non_loopback: false,
        allow,
        routes: vec![ProxyRoute {
            // NO trailing slash: this row MEASURED the shipped sidecar refusing
            // to match one (see the module note), and the production rule in
            // `parse_cell_routes` / `remoteCellRoutePrefix` says the same.
            prefix: format!("/cell/{cell_boot_id}"),
            target_url: Some(format!("http://127.0.0.1:{door_port}")),
            dir: None,
            fallback: None,
            strip_prefix: true,
            allow: vec![],
        }],
        accept_app_capabilities: vec![],
    }
}

/// T-M4 — the SAME route, built by the PRODUCTION mapping from the params
/// fieldd actually sends (`terminalServeSpec`, terminal-serve.ts): target
/// `{kind: "routes"}`, `tls: false`, one glob in `allow`, one
/// `{prefix, targetPort}` row. This is `build_serve_config`'s own output, not a
/// transcription of it.
///
/// The literal above is kept BESIDE it rather than replaced, and the two are
/// asserted equal: the literal documents the shape a reader of this probe needs
/// to see, and the assertion is what makes it impossible for that documentation
/// to go quietly stale. Before this the probe hand-built its config with no link
/// to the arm at all, so the row could have kept passing against a shape the
/// product no longer produces.
fn production_cell_route_config(
    id: &str,
    cell_boot_id: &str,
    door_port: u16,
    allow: Vec<String>,
) -> ProxyConfig {
    let target = json!({"kind": "routes"});
    let routes = json!([{ "prefix": format!("/cell/{cell_boot_id}"), "targetPort": door_port }]);
    build_serve_config(ServeConfigInput {
        serve_id: id,
        name: "terminal",
        target: &target,
        listen_port: Some(u64::from(TERMINAL_CELLS_SERVE)),
        preview_dir: None,
        allow,
        tls: Some(false),
        path_secret: None,
        secret_door: SecretDoor::Product,
        routes: &routes,
    })
    .expect("the production routes arm accepts the shape fieldd sends")
}

/// `ProxyConfig` derives no `PartialEq` upstream, so the comparison is over the
/// serialized form — the same reason `fixture_parity` compares `Value`s.
fn assert_matches_production(hand_built: &ProxyConfig, cell_boot_id: &str, door_port: u16) {
    let production = production_cell_route_config(
        &hand_built.id,
        cell_boot_id,
        door_port,
        hand_built.allow.clone(),
    );
    assert_eq!(
        serde_json::to_value(hand_built).expect("serialize"),
        serde_json::to_value(&production).expect("serialize"),
        "this probe's route no longer matches what build_serve_config produces \
         for fieldd's own params — the row under test has drifted from the product"
    );
}

/// The loopback port behind a cell's doors — both URLs name it, and fieldd
/// refuses the row if they disagree (`cellDoorPort`, terminal-serve.ts).
fn door_port(url: &str) -> u16 {
    url.rsplit(':')
        .next()
        .and_then(|tail| tail.split('/').next())
        .and_then(|p| p.parse().ok())
        .expect("a door URL names a port")
}

type PeerWs = WebSocketStream<TcpStream>;

/// Dial one cell channel over the tailnet: node B's own userspace stack gives a
/// real `TcpStream` to A's listener, and the WebSocket rides it. The Host in
/// the request is A's MagicDNS name — the sidecar routes by PATH, and this is
/// what a phone would send.
async fn dial_channel(
    node: &Node<TailscaleProvider>,
    peer_id: &str,
    host: &str,
    cell_boot_id: &str,
    channel: &str,
) -> Result<PeerWs, String> {
    let stream = timeout(
        Duration::from_secs(30),
        node.open_tcp(peer_id, TERMINAL_CELLS_SERVE),
    )
    .await
    .map_err(|_| "open_tcp timed out".to_string())?
    .map_err(|e| format!("open_tcp failed: {e}"))?;
    let url = format!("ws://{host}:{TERMINAL_CELLS_SERVE}/cell/{cell_boot_id}/{channel}");
    let request = url.into_client_request().expect("client request");
    match timeout(
        Duration::from_secs(30),
        tokio_tungstenite::client_async(request, stream),
    )
    .await
    .map_err(|_| "the websocket upgrade timed out".to_string())?
    {
        Ok((ws, response)) => {
            eprintln!("[probe] {channel} upgrade: HTTP {}", response.status());
            for (name, value) in response.headers() {
                eprintln!("[probe]   {name}: {}", value.to_str().unwrap_or("<binary>"));
            }
            Ok(ws)
        }
        Err(e) => Err(format!("{e}")),
    }
}

/// One established leg: a sink shared with its heartbeat task, and the stream
/// half the flow reads.
///
/// THE HEARTBEAT IS THE CLIENT'S JOB (spec §5.1; `tp_door.rs`'s 4004 row): the
/// client SENDS `LegHeartbeat` and the door acks. A leg that goes quiet past
/// `heartbeatTtlMs` is closed `4004 LEG_TIMEOUT` — which is exactly what this
/// probe hit before it grew this, and it is why both legs need their own
/// ticker rather than being serviced only while the flow happens to read them.
struct Leg {
    sink: std::sync::Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<PeerWs, Message>>>,
    stream: futures_util::stream::SplitStream<PeerWs>,
    beat: tokio::task::JoinHandle<()>,
}

impl Leg {
    async fn send(&self, message: Value) {
        self.sink
            .lock()
            .await
            .send(Message::Text(message.to_string().into()))
            .await
            .expect("send on the leg");
    }

    /// The next frame this flow cares about. Heartbeat ACKS from the door are
    /// consumed here; the SENDING is the ticker's.
    async fn next_text(&mut self, what: &str) -> Value {
        loop {
            match self.next_message(what).await {
                Message::Text(t) => {
                    let frame: Value = serde_json::from_str(&t).expect("json frame");
                    if frame["type"] == "LegHeartbeatAck" {
                        continue;
                    }
                    return frame;
                }
                Message::Binary(_) => continue,
                _ => continue,
            }
        }
    }

    async fn next_message(&mut self, what: &str) -> Message {
        let message = timeout(Duration::from_secs(30), self.stream.next())
            .await
            .unwrap_or_else(|_| panic!("{what}: nothing within 30s"))
            .unwrap_or_else(|| panic!("{what}: the leg closed"))
            .unwrap_or_else(|e| panic!("{what}: {e}"));
        if let Message::Close(c) = &message {
            panic!("{what}: closed {c:?}");
        }
        message
    }

    /// Start the ticker once the door has told us the set, the generation and
    /// the deadline it will hold us to.
    fn start_heartbeat(&mut self, accepted: &Value, channel: &str) {
        let set = accepted["connectionSetId"]
            .as_str()
            .expect("the acceptance names the connection set")
            .to_string();
        let generation = accepted["legGeneration"].as_u64().unwrap_or(1);
        let ttl = accepted["heartbeatTtlMs"].as_u64().unwrap_or(10_000);
        let sink = self.sink.clone();
        let channel = channel.to_string();
        // a third of the deadline: two misses in a row are still inside it
        let every = Duration::from_millis((ttl / 3).max(250));
        self.beat = tokio::spawn(async move {
            let mut sequence = 0_u64;
            loop {
                tokio::time::sleep(every).await;
                sequence += 1;
                let beat = json!({
                    "type": "LegHeartbeat",
                    "connectionSetId": set,
                    "channel": channel,
                    "legGeneration": generation,
                    "sequence": sequence,
                });
                if sink
                    .lock()
                    .await
                    .send(Message::Text(beat.to_string().into()))
                    .await
                    .is_err()
                {
                    return;
                }
            }
        });
    }
}

impl Drop for Leg {
    fn drop(&mut self) {
        self.beat.abort();
    }
}

/// N-H1 — the seed window, with the CONTROL LEG DRAINED.
///
/// The cell does not fail silently: when a presentation cannot start it says so
/// on the control leg, as `CellActivationStatus {presentation: {state, reason}}`
/// (`tp/activation.rs`'s `presentation_stopped`). This probe used to stop
/// reading that leg the moment the attach was acknowledged, so it RECEIVED the
/// answer to its own question and discarded it — and then attributed the
/// missing seed, in a comment, to a cause the cell cannot have.
///
/// Returns the decoded SEED TRANSFER and every control frame seen in the
/// window, so a failing arm reports the cell's own account rather than a
/// silence.
///
/// THE WHOLE TRANSFER, not the first envelope: a seed is
/// `transfer-begin` → one or more `transfer-chunk` → `transfer-end`
/// (`tp/presentation.rs`), and `transfer-begin` legitimately carries a ZERO
/// byte payload — it announces the base and result stamps, the frame rides the
/// chunks. Asserting on the first envelope's length would fail against a
/// perfectly good seed, which is exactly what it did while this was being
/// written.
async fn seed_with_control(
    frames: &mut Leg,
    control: &mut Leg,
    arm: &str,
    budget: Duration,
) -> (Option<SeedTransfer>, Vec<Value>) {
    let deadline = tokio::time::Instant::now() + budget;
    let mut control_frames: Vec<Value> = Vec::new();
    let mut transfer: Option<SeedTransfer> = None;
    let mut seed: Option<()> = None;
    while seed.is_none() && tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        tokio::select! {
            got = timeout(remaining, frames.stream.next()) => match got {
                Ok(Some(Ok(Message::Binary(bytes)))) => {
                    let Some((header, payload)) =
                        field_native::tp::wire::decode_envelope(&bytes) else {
                            panic!("[{arm}] the frames leg sent bytes that are not a \
                                    presentation envelope ({} bytes)", bytes.len());
                        };
                    let kind = header["kind"].as_str().unwrap_or("?").to_string();
                    eprintln!(
                        "[probe] {arm} envelope: kind={kind} payload={} bytes",
                        payload.len()
                    );
                    let t = transfer.get_or_insert_with(|| SeedTransfer {
                        kinds: Vec::new(),
                        payload_bytes: 0,
                        begin: header.clone(),
                    });
                    t.payload_bytes += payload.len();
                    t.kinds.push(kind.clone());
                    // `transfer-end` closes a seed; a bare `trf1-frame` is a
                    // whole unit on its own and needs no closer.
                    if kind == "transfer-end" || kind == "trf1-frame" {
                        seed = Some(());
                    }
                }
                Ok(Some(Ok(Message::Text(t)))) => {
                    let v: Value = serde_json::from_str(&t).unwrap_or(Value::Null);
                    if v["type"] != "LegHeartbeatAck" {
                        eprintln!("[probe] {arm} frames leg: {v}");
                    }
                }
                Ok(Some(Ok(_))) => {}
                Ok(Some(Err(e))) => panic!("[{arm}] the frames leg failed: {e}"),
                Ok(None) => break,
                Err(_) => break,
            },
            got = timeout(remaining, control.stream.next()) => match got {
                Ok(Some(Ok(Message::Text(t)))) => {
                    let v: Value = serde_json::from_str(&t).unwrap_or(Value::Null);
                    if v["type"] == "LegHeartbeatAck" {
                        continue;
                    }
                    eprintln!("[probe] {arm} CONTROL: {v}");
                    control_frames.push(v);
                }
                Ok(Some(Ok(_))) => {}
                Ok(Some(Err(e))) => panic!("[{arm}] the control leg failed: {e}"),
                Ok(None) => break,
                Err(_) => break,
            },
        }
    }
    (transfer.filter(|_| seed.is_some()), control_frames)
}

/// One completed seed: the kinds in order, the total payload carried, and the
/// opening header (whose `resultContent` stamp names the revision seeded).
#[derive(Debug)]
struct SeedTransfer {
    kinds: Vec<String>,
    payload_bytes: usize,
    begin: Value,
}

/// The cell's own words for why a presentation is not running, if it said any —
/// what a failing arm prints instead of "we saw nothing".
fn presentation_complaint(control_frames: &[Value]) -> String {
    let stopped: Vec<String> = control_frames
        .iter()
        .filter(|f| f["type"] == "CellActivationStatus")
        .map(|f| f["presentation"].to_string())
        .collect();
    if stopped.is_empty() {
        "the cell said nothing on the control leg".to_string()
    } else {
        format!("the cell's presentation status: {}", stopped.join(", "))
    }
}

fn leg_from(ws: PeerWs) -> Leg {
    let (sink, stream) = ws.split();
    Leg {
        sink: std::sync::Arc::new(tokio::sync::Mutex::new(sink)),
        stream,
        beat: tokio::spawn(async {}),
    }
}

/// Dial, hello, and hold the leg open: the full establishment a routed client
/// performs, over the tailnet and through the sidecar's hijack.
async fn establish(
    node: &Node<TailscaleProvider>,
    peer_id: &str,
    host: &str,
    cell_boot_id: &str,
    channel: &str,
    grant: &Value,
    capacities: Option<Value>,
) -> Leg {
    let ws = dial_channel(node, peer_id, host, cell_boot_id, channel)
        .await
        .unwrap_or_else(|e| panic!("the {channel} leg must upgrade through the sidecar: {e}"));
    let (sink, stream) = ws.split();
    let mut leg = Leg {
        sink: std::sync::Arc::new(tokio::sync::Mutex::new(sink)),
        stream,
        beat: tokio::spawn(async {}),
    };
    leg.sink
        .lock()
        .await
        .send(Message::Text(hello(channel, grant, capacities).into()))
        .await
        .expect("send the hello");
    let accepted = leg
        .next_text(&format!("the {channel} leg's first reply"))
        .await;
    assert_eq!(
        accepted["type"], "ConnectionAccepted",
        "the {channel} leg was not accepted: {accepted}"
    );
    leg.start_heartbeat(&accepted, channel);
    leg
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY; run with --ignored"]
async fn a_peer_reaches_a_real_cell_door_through_the_sidecars_cell_route() {
    let Some(key) = authkey() else {
        eprintln!("[skip] terminal_cell_route_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar) = sidecar() else {
        eprintln!("[skip] terminal_cell_route_probe: no truffle sidecar found");
        return;
    };
    let app_id = probe_app_id();
    eprintln!(
        "[probe] app_id={app_id} sidecar={} authkey={}",
        sidecar.display(),
        redact(&key)
    );

    // ---- the floor, its cell, and a real PTY behind it ----
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let (
        cell_boot_id,
        control_socket,
        auth_token,
        grant_key,
        key_generation,
        control_port,
        frames_port,
    ) = {
        let snapshot = daemon.state.terminal_routes.borrow();
        let cell = snapshot
            .cells
            .iter()
            .find(|c| c.doors.is_some() && c.grant_key.is_some())
            .expect("a cell with doors and a grant key");
        let doors = cell.doors.as_ref().expect("doors");
        (
            cell.cell_boot_id.clone(),
            cell.endpoints.control_socket.clone(),
            cell.endpoints.auth_token.clone(),
            cell.grant_key.clone().expect("grant key"),
            cell.grant_key_generation.unwrap_or(1) as u64,
            door_port(&doors.control_url),
            door_port(&doors.frames_url),
        )
    };
    assert_eq!(
        control_port, frames_port,
        "one cell serves both paths on one listener; a route carries one target"
    );
    let (control_client, _events) = ControlClient::connect(&control_socket, &auth_token)
        .await
        .expect("dial the cell's control socket");
    let session = control_client
        .create_session(json!({
            "executable": TENANT,
            "args": [],
            "cols": 80,
            "rows": 24,
            "persistence": "keep-until-exit",
            "environment": {"mode": "clean", "variables": {}},
        }))
        .await
        .expect("create a session on the real cell");
    eprintln!(
        "[probe] floor up: cell={cell_boot_id} door=127.0.0.1:{control_port} session={}",
        session.id
    );

    // The grants the cell will verify: MAC'd with ITS key, by the procedure
    // fieldd uses (`terminal-grants.ts`; this is the test-side mirror).
    let minter = TestMinter {
        cell_boot_id: cell_boot_id.clone(),
        key_generation,
        key: hex::decode(&grant_key).expect("the grant key is hex"),
    };

    // ---- two nodes on the real tailnet ----
    let state_a = tempfile::tempdir().expect("state a");
    let state_b = tempfile::tempdir().expect("state b");
    let (node_a, node_b) = tokio::join!(
        build_node(&app_id, "tm2bhost", state_a.path(), &key, &sidecar),
        build_node(&app_id, "tm2bpeer", state_b.path(), &key, &sidecar),
    );
    let host_a = node_a.local_info().tailscale_hostname;
    let dns_a = node_a
        .local_info()
        .dns_name
        .unwrap_or_else(|| host_a.clone());
    let peer_a = rendezvous(&node_b, &host_a).await;
    eprintln!("[probe] nodes up: A={host_a} (dns {dns_a}) B sees it as {peer_a}");

    // B's own login, so the allow-list can name the caller truthfully.
    let ip_b = timeout(Duration::from_secs(90), async {
        loop {
            if let Some(ip) = node_b.local_info().ip {
                return ip;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .expect("node B never learned its own tailnet ip");
    let login_b = timeout(Duration::from_secs(60), async {
        loop {
            if let Ok(Some(identity)) = node_b.whois(&ip_b.to_string()).await {
                if let Some(login) = identity.login_name {
                    return login;
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .expect("node B never learned its own login");

    // ---- THE CONTROL ARM: the SAME client, the SAME cell, NO tailnet ----
    let loopback_seed: Option<usize>;
    // Without this the probe could not tell "the tailnet path dropped the
    // frames" from "this client never asked for them correctly". It dials the
    // cell's loopback door directly and runs the identical ladder.
    {
        let loopback = timeout(
            Duration::from_secs(10),
            tokio::net::TcpStream::connect(("127.0.0.1", control_port)),
        )
        .await
        .expect("loopback connect timed out")
        .expect("connect the cell's loopback door");
        let request = format!("ws://127.0.0.1:{control_port}/control")
            .into_client_request()
            .expect("client request");
        let (ws, _) = timeout(
            Duration::from_secs(10),
            tokio_tungstenite::client_async(request, loopback),
        )
        .await
        .expect("loopback upgrade timed out")
        .expect("the loopback door upgrades");
        let mut ctl = leg_from(ws);
        let grant = minter.transport(TransportSpec::basic("cs-local", 1, "nonce-local-1"));
        ctl.sink
            .lock()
            .await
            .send(Message::Text(hello("control", &grant, None).into()))
            .await
            .expect("hello");
        let accepted = ctl.next_text("the loopback control reply").await;
        assert_eq!(accepted["type"], "ConnectionAccepted", "{accepted}");
        ctl.start_heartbeat(&accepted, "control");

        let loopback_f = tokio::net::TcpStream::connect(("127.0.0.1", frames_port))
            .await
            .expect("connect the cell's frames door");
        let request = format!("ws://127.0.0.1:{frames_port}/frames")
            .into_client_request()
            .expect("client request");
        let (ws, _) = tokio_tungstenite::client_async(request, loopback_f)
            .await
            .expect("the loopback frames door upgrades");
        let mut frm = leg_from(ws);
        frm.sink
            .lock()
            .await
            .send(Message::Text(
                hello("frames", &grant, Some(tp_mint::worker_capacities())).into(),
            ))
            .await
            .expect("hello");
        let accepted_f = frm.next_text("the loopback frames reply").await;
        assert_eq!(accepted_f["type"], "ConnectionAccepted", "{accepted_f}");
        frm.start_heartbeat(&accepted_f, "frames");

        let attach = minter.attach(&session.id, 1, &["geometry", "input", "read"]);
        ctl.send(json!({
            "type": "AttachControlLeg",
            "activationId": "act-local",
            "attachGrant": attach,
            "initialDemand": {"mode": "live"},
        }))
        .await;
        let a = ctl.next_text("the loopback control attach").await;
        assert_eq!(a["type"], "ControlLegAttached", "{a}");
        frm.send(json!({
            "type": "AttachFramesLeg",
            "activationId": "act-local",
            "attachGrant": attach,
        }))
        .await;
        let fa = frm.next_text("the loopback frames attach").await;
        assert_eq!(fa["type"], "FramesLegAttached", "{fa}");

        let (seed, control_frames) =
            seed_with_control(&mut frm, &mut ctl, "loopback", Duration::from_secs(20)).await;
        let seed = seed.unwrap_or_else(|| {
            panic!(
                "the loopback arm drew NO seed from a real cell over a plain socket — \
                 no sidecar and no tailnet in the path, so this is the client flow or \
                 the cell, never the route. {}",
                presentation_complaint(&control_frames)
            )
        });
        assert!(
            seed.payload_bytes > 0,
            "a transfer that carried no bytes is not a seed: {seed:?}"
        );
        eprintln!(
            "[probe] LOOPBACK CONTROL ARM: {} envelopes {:?}, {} payload bytes, begin={}",
            seed.kinds.len(),
            seed.kinds,
            seed.payload_bytes,
            seed.begin
        );
        loopback_seed = Some(seed.payload_bytes);
    }

    // ---- WHAT THE SIDECAR DOES TO THE UPGRADE, measured rather than assumed ----
    // A loopback backend that answers nothing and reports the exact bytes it
    // was handed. This is the only way to see the request LINE (did the prefix
    // come off?) and the headers (was the upgrade rewritten? was the identity
    // injected?) instead of inferring them from a status code — and it is the
    // row that found the trailing-slash rule this slice corrects.
    let echo = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind the echo backend");
    let echo_port = echo.local_addr().expect("echo addr").port();
    let echoed = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let sink = echoed.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = echo.accept().await else {
                return;
            };
            let sink = sink.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut buf = vec![0_u8; 4096];
                if let Ok(n) = socket.read(&mut buf).await {
                    sink.lock()
                        .await
                        .push(String::from_utf8_lossy(&buf[..n]).to_string());
                }
                // answers nothing on purpose: the request is the artifact
            });
        }
    });
    let mut echo_cfg = cell_route_config(
        "terminal-echo",
        &cell_boot_id,
        control_port,
        vec![login_b.clone()],
    );
    echo_cfg.routes = vec![
        ProxyRoute {
            prefix: "/echo".into(),
            target_url: Some(format!("http://127.0.0.1:{echo_port}")),
            dir: None,
            fallback: None,
            strip_prefix: true,
            allow: vec![],
        },
        ProxyRoute {
            // the same target with a TRAILING SLASH: the shape that does not
            // match, kept as the control for the rule above
            prefix: "/slashed/".into(),
            target_url: Some(format!("http://127.0.0.1:{echo_port}")),
            dir: None,
            fallback: None,
            strip_prefix: true,
            allow: vec![],
        },
    ];
    node_a
        .proxy()
        .add(echo_cfg)
        .await
        .expect("the echo serve registers");
    let mut slashed_matched = false;
    for (path, expect_forwarded) in [("/echo/control", true), ("/slashed/control", false)] {
        let before = echoed.lock().await.len();
        if let Ok(Ok(stream)) = timeout(
            Duration::from_secs(20),
            node_b.open_tcp(&peer_a, TERMINAL_CELLS_SERVE),
        )
        .await
        {
            let url = format!("ws://{dns_a}:{TERMINAL_CELLS_SERVE}{path}");
            let request = url.into_client_request().expect("client request");
            let _ = timeout(
                Duration::from_secs(6),
                tokio_tungstenite::client_async(request, stream),
            )
            .await;
        }
        let forwarded = echoed.lock().await.len() > before;
        eprintln!("[probe] dial {path} -> forwarded to the backend: {forwarded}");
        if path == "/slashed/control" {
            slashed_matched = forwarded;
        } else {
            assert!(
                forwarded == expect_forwarded,
                "a slashless prefix must reach its backend"
            );
        }
    }
    assert!(
        !slashed_matched,
        "a TRAILING-SLASH prefix matched after all — the rule this slice encodes is wrong"
    );
    let captured = echoed.lock().await.first().cloned().unwrap_or_default();
    eprintln!(
        "[probe] SIDECAR FORWARDED: {}",
        captured.replace("\r\n", " | ").replace('\n', " | ")
    );
    let head = captured.to_ascii_lowercase();
    // the prefix came OFF: the cell's door matches `/control` exactly
    assert!(
        captured.starts_with("GET /control "),
        "the sidecar did not strip the route prefix: {captured}"
    );
    // the upgrade rode through untouched…
    assert!(head.contains("upgrade: websocket"), "{captured}");
    assert!(head.contains("connection: upgrade"), "{captured}");
    assert!(head.contains("sec-websocket-key:"), "{captured}");
    // …with NO compression negotiation added, which is the risk the design
    // named (the cell door refuses permessage-deflate and reads the hello first)
    assert!(
        !head.contains("sec-websocket-extensions"),
        "the sidecar negotiated an extension the cell door refuses: {captured}"
    );
    // and the identity is INJECTED by the sidecar, not smuggled by the caller
    assert!(
        head.contains(&format!(
            "tailscale-user-login: {}",
            login_b.to_ascii_lowercase()
        )),
        "{captured}"
    );
    node_a.proxy().remove("terminal-echo").await.ok();

    // ---- THE GATE: a route whose allow-list names nobody refuses at the sidecar ----
    node_a
        .proxy()
        .add(cell_route_config(
            "terminal-closed",
            &cell_boot_id,
            control_port,
            vec!["nobody@example.invalid".to_string()],
        ))
        .await
        .expect("the closed serve registers");
    let refusal = match dial_channel(&node_b, &peer_a, &dns_a, &cell_boot_id, "control").await {
        Ok(_) => panic!("a gate that names nobody must refuse, but the dial landed"),
        Err(e) => e,
    };
    eprintln!("[probe] closed-gate dial refused: {refusal}");
    // The REFUSAL is the assertion; its STATUS is recorded, not demanded. The
    // design (and truffle's RFC 023 §9.7) says a non-matching login gets "a
    // bare 403, on the proxy and WebSocket-hijack paths alike". What the
    // sidecar at 0.7.12 actually answers on the hijack path is measured here
    // and printed, because the same dial at the same path SUCCEEDS once the
    // allow-list names the caller — that contrast, not the number, is what
    // proves the gate was consulted rather than the route being absent.
    assert!(
        !refusal.is_empty(),
        "a refusal must carry a reason: {refusal}"
    );
    node_a
        .proxy()
        .remove("terminal-closed")
        .await
        .expect("the closed serve removes");

    // ---- the open route: remove-then-add, the shape truffle's API forces ----
    //
    // T-M4 — and the row this test dials is checked against the PRODUCTION
    // mapping before it is registered, so the literal above cannot drift away
    // from what `build_serve_config` produces for fieldd's own params.
    let open_route = cell_route_config(
        "terminal",
        &cell_boot_id,
        control_port,
        vec![login_b.clone()],
    );
    assert_matches_production(&open_route, &cell_boot_id, control_port);
    node_a
        .proxy()
        .add(open_route)
        .await
        .expect("the terminal serve registers");
    eprintln!("[probe] open gate: allow=[{login_b}] — the same dial must now land");

    // ---- the control leg, over the tailnet, through the hijack ----
    let transport = minter.transport(TransportSpec::basic("cs-tm2b", 1, "nonce-tm2b-1"));
    let mut control = establish(
        &node_b,
        &peer_a,
        &dns_a,
        &cell_boot_id,
        "control",
        &transport,
        None,
    )
    .await;
    let mut frames = establish(
        &node_b,
        &peer_a,
        &dns_a,
        &cell_boot_id,
        "frames",
        &transport,
        Some(tp_mint::worker_capacities()),
    )
    .await;

    // ---- the attach, where the ATTACH grant is verified, then the seed ----
    let attach = minter.attach(&session.id, 1, &["geometry", "input", "read"]);
    let activation = "act-tm2b-1";
    control
        .send(json!({
            "type": "AttachControlLeg",
            "activationId": activation,
            "attachGrant": attach,
            "initialDemand": {"mode": "live"},
        }))
        .await;
    let control_attached = control.next_text("the control attach").await;
    assert_eq!(
        control_attached["type"], "ControlLegAttached",
        "the control attach was refused: {control_attached}"
    );

    frames
        .send(json!({
            "type": "AttachFramesLeg",
            "activationId": activation,
            "attachGrant": attach,
        }))
        .await;
    let frames_attached = frames.next_text("the frames attach").await;
    assert_eq!(
        frames_attached["type"], "FramesLegAttached",
        "the frames attach was refused: {frames_attached}"
    );

    // Demand, declared explicitly on the control leg. `initialDemand` rode the
    // attach, and a real client re-states it per activation (spec §7); saying
    // it twice is idempotent by `demandSequence` and costs nothing.
    control
        .send(json!({
            "type": "DeclareDemand",
            "sessionId": session.id,
            "activationId": activation,
            "leaseEpoch": 0,
            "demandSequence": 1,
            "demand": {"mode": "live"},
        }))
        .await;
    eprintln!("[probe] framesAttached={frames_attached}");
    eprintln!("[probe] controlAttached={control_attached}");

    // ---- THE SEED, on BOTH arms, decoded ----
    //
    // CORRECTED 2026-09-14 (N-H1). What stood here until this date said the
    // probe "does not draw a seed out of a REAL cell", named
    // `TestMinter::attach`'s hardcoded `routeRevision: 1` and its window
    // `clientId` as the likeliest cause, and settled for asserting that the two
    // arms AGREED. Every part of that was wrong:
    //
    //   · `AttachClaims.route_revision` is read by NOTHING outside cfg(test)
    //     fixtures — the cell never compares it, so it cannot refuse over it;
    //   · the `clientId` cross-check (`activation.rs`, `claims.client_id !=
    //     set.client_id`) demonstrably PASSED — both attaches were accepted,
    //     which is the only way `ControlLegAttached` / `FramesLegAttached`
    //     arrive at all;
    //   · and the equality assertion was VACUOUS: it compared two `Option`s
    //     that were both `None`, so it held for the one reason it should have
    //     failed.
    //
    // THE REAL CAUSE, found by draining the control leg the probe was already
    // being sent: `CellActivationStatus {presentation: {state: "stopped",
    // reason: "overload"}}`, at 3004 ms — `MAX_ACTIVATION_CATCHUP_MS`, so
    // `wait_for_credit`, not the 2 s seed wait. `tp_mint::worker_capacities()`
    // declared `connectionCreditBytes: 1 MiB`, an eighth of what a real client
    // declares, and BELOW the cell's 2 MiB `URGENT_RESERVE_BYTES`; bulk
    // admission may draw the window only down to that reserve, so bulk headroom
    // was exactly zero and the seed was never admissible. The floor was
    // blameless and so was the tailnet. Both halves are fixed — the helper now
    // reads the product's own `DEFAULT_CELL_RECEIVER_CAPS`, and the cell's
    // reserve clamp no longer collapses a small window to zero bulk
    // (`CreditLedger::new`, N-H1).
    //
    // So the assertion is no longer a comparison of two absences. Each arm must
    // decode a REAL presentation envelope off a REAL PTY, and the control arm
    // is what keeps the tailnet arm honest: a failure on the loopback arm is
    // this client or this cell, and only a failure on the tailnet arm alone is
    // the sidecar's.
    let (tailnet_seed, tailnet_control) = seed_with_control(
        &mut frames,
        &mut control,
        "tailnet",
        Duration::from_secs(20),
    )
    .await;
    let tailnet = tailnet_seed.unwrap_or_else(|| {
        panic!(
            "the loopback arm seeded ({loopback_seed:?} payload bytes) and the tailnet arm \
             did not — the sidecar's hijack is the ONLY difference between them. {}",
            presentation_complaint(&tailnet_control)
        )
    });
    assert!(
        tailnet.payload_bytes > 0,
        "a transfer that carried no bytes is not a seed: {tailnet:?}"
    );
    assert!(
        loopback_seed.is_some(),
        "the control arm must have seeded, or this row proves nothing about the route"
    );
    let tailnet_bytes = tailnet.payload_bytes;
    eprintln!(
        "[probe] TAILNET ARM: {} envelopes {:?}, {tailnet_bytes} payload bytes, begin={}",
        tailnet.kinds.len(),
        tailnet.kinds,
        tailnet.begin
    );
    eprintln!(
        "[probe] TM2B_WITNESS cell={cell_boot_id} session={} host={dns_a} \
gate403=yes upgrade=101 both-legs-accepted=yes attached=yes \
seed-loopback={loopback_seed:?} seed-tailnet={tailnet_bytes}",
        session.id
    );

    node_a.proxy().remove("terminal").await.ok();
    // Best-effort: the daemon's own shutdown reaps the cell and its PTY, and a
    // control connection that has already gone quiet is a teardown detail, not
    // a claim this row makes.
    let _ = control_client.terminate(&session.id, "probe").await;
    daemon.shutdown().await;
}
