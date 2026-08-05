//! NF-2/NF-5 gate: the terminal floor with a REAL PTY under it, and the survivor
//! authority that decides which of those PTYs keeps running.
//!
//! These are deliberately NOT `#[ignore]`d. The only ignored tests in this crate
//! are the ones that join a live tailnet; a local PTY needs no network, and the
//! whole point of the floor is that its custody claims are checked on every
//! `pnpm verify` rather than asserted in a doc.
//!
//! Every test drives the same seams fieldd will: the mgmt channel for endpoints
//! and inventory, and ghosttea's own control socket (through field-native's
//! self-client) for session lifecycle.

use field_native::services::terminal_client::ControlClient;
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::timeout;

/// A quiet, portable PTY tenant: it holds the terminal open reading stdin and
/// dies on the first rung of the ladder (^C → SIGINT), so a sweep that works
/// finishes in milliseconds and a sweep that does not is unmistakable.
const TENANT: &str = "/bin/cat";

/// macOS caps a Unix socket path at ~104 bytes (`sun_path`), and these sockets
/// sit three levels under the data dir. The platform temp dir
/// (`/var/folders/<32 chars>/…`) leaves almost no room, so tests root their data
/// dir at `/tmp` and check the budget instead of discovering it as ENAMETOOLONG.
fn short_tempdir() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("vfnf")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp");
    let probe = dir.path().join("native/run/termctl.sock");
    assert!(
        probe.as_os_str().len() < 100,
        "socket path would risk sun_path truncation: {}",
        probe.display()
    );
    dir
}

async fn boot(dir: &Path) -> RunningDaemon {
    bootstrap(NativeConfig::for_data_dir(dir.to_path_buf()))
        .await
        .expect("bootstrap")
}

/// What one read off the mgmt socket found. Timeout and end-of-stream are kept
/// apart on purpose: "nothing was said" and "the connection is gone" are
/// different facts, and the supersession test asserts the second one.
enum Incoming {
    Message(Value),
    Closed,
    Quiet,
}

/// The mgmt client, in the idiom of tests/mgmt_server.rs: newline JSON-RPC over
/// the paired UDS.
struct MgmtClient {
    reader: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    writer: tokio::net::unix::OwnedWriteHalf,
    /// Notifications that overtook a response. Acks and deltas share one socket
    /// and their order is not guaranteed, so a caller correlating an ack must
    /// hand back the deltas it read on the way — otherwise it consumes the very
    /// delta the next assertion is waiting for and the test hangs on a
    /// convergence that already happened.
    buffered: std::collections::VecDeque<Value>,
    /// Request ids are minted here and never passed in: two requests sharing an
    /// id make `request`'s correlator ambiguous, and a repeated
    /// `observed.subscribe` id used to leak a second forwarder onto one socket.
    last_id: u64,
}

impl MgmtClient {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = UnixStream::connect(&daemon.mgmt_socket)
            .await
            .expect("connect mgmt");
        let (r, w) = stream.into_split();
        Self {
            reader: BufReader::new(r).lines(),
            writer: w,
            buffered: std::collections::VecDeque::new(),
            last_id: 0,
        }
    }

    fn next_id(&mut self) -> u64 {
        self.last_id += 1;
        self.last_id
    }

    async fn send(&mut self, v: Value) {
        let mut line = v.to_string();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).await.expect("write");
    }

    async fn recv(&mut self) -> Value {
        self.recv_within(Duration::from_secs(5)).await
    }

    async fn recv_within(&mut self, budget: Duration) -> Value {
        match self.poll_within(budget).await {
            Incoming::Message(message) => message,
            Incoming::Closed => panic!("the mgmt connection closed"),
            Incoming::Quiet => panic!("nothing arrived on the mgmt connection in {budget:?}"),
        }
    }

    async fn poll_within(&mut self, budget: Duration) -> Incoming {
        if let Some(message) = self.buffered.pop_front() {
            return Incoming::Message(message);
        }
        match timeout(budget, self.reader.next_line()).await {
            Err(_) => Incoming::Quiet,
            Ok(Err(_)) | Ok(Ok(None)) => Incoming::Closed,
            Ok(Ok(Some(line))) => {
                Incoming::Message(serde_json::from_str(&line).expect("json line"))
            }
        }
    }

    /// Answers with the ack itself (the JSON-RPC `result`), which is the
    /// `HelloAck` shape the contract pins.
    async fn hello(&mut self, daemon: &RunningDaemon) -> Value {
        let secret = read_secret(daemon);
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-boot-terminal-test";
        let mac = pairing::compute_mac(&secret, boot, ts);
        let id = self.next_id();
        self.send(
            json!({"jsonrpc":"2.0","id":id,"method":"native.lifecycle.hello","params":{
                "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
                "credential":{"bootId":boot,"ts":ts,"mac":mac}
            }}),
        )
        .await;
        let response = self.recv().await;
        assert_eq!(
            response["result"]["serverKind"], "field-native",
            "hello was refused: {response}"
        );
        response["result"].clone()
    }

    /// Subscribe and answer with the inventory snapshot. Once per connection:
    /// every call spawns another forwarder onto the same socket.
    async fn subscribe_observed(&mut self) -> Value {
        let response = self
            .request("native.lifecycle.observed.subscribe", json!({}))
            .await;
        response["result"]["snapshot"].clone()
    }

    /// One request, correlated by id and never by arrival order: a delta can
    /// always overtake the response it was caused by. Notifications read while
    /// waiting are handed back for the delta assertions to consume.
    async fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id();
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
            .await;
        let mut deferred = Vec::new();
        let response = loop {
            let message = self.recv().await;
            if message.get("id").is_some_and(|got| got == id) {
                break message;
            }
            deferred.push(message);
        };
        self.buffered.extend(deferred);
        response
    }

    /// Read observed deltas until one satisfies `wanted`, or give up. Deltas are
    /// the seam fieldd actually watches, so the assertions ride them rather than
    /// peeking at daemon state.
    async fn await_observed(&mut self, budget: Duration, wanted: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + budget;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(
                !remaining.is_zero(),
                "no matching observed delta in {budget:?}"
            );
            let message = self.recv_within(remaining).await;
            if message["method"] == "native.lifecycle.observed.delta" {
                let payload = message["params"]["payload"].clone();
                if wanted(&payload) {
                    return payload;
                }
            }
        }
    }

    /// Every observed payload a quiet window produced — possibly none. A window
    /// with nothing in it is evidence too: it is how a test proves a refusal
    /// published NOTHING, without opening a second subscription on the one
    /// socket to go looking for a snapshot.
    async fn observed_within(&mut self, budget: Duration) -> Vec<Value> {
        let deadline = Instant::now() + budget;
        let mut payloads = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return payloads;
            }
            match self.poll_within(remaining).await {
                Incoming::Message(message)
                    if message["method"] == "native.lifecycle.observed.delta" =>
                {
                    payloads.push(message["params"]["payload"].clone());
                }
                Incoming::Message(_) => {}
                Incoming::Closed | Incoming::Quiet => return payloads,
            }
        }
    }

    /// Read until this connection ends, asserting that nothing answers `id` on
    /// the way.
    async fn await_close_without_answering(&mut self, id: u64, budget: Duration) {
        let deadline = Instant::now() + budget;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.poll_within(remaining).await {
                Incoming::Closed => return,
                Incoming::Quiet => {
                    panic!("the connection was still open, and still unanswered, after {budget:?}")
                }
                Incoming::Message(message) => assert!(
                    message.get("id").is_none_or(|got| got != id),
                    "this connection was not supposed to be served: {message}"
                ),
            }
        }
    }

    /// Read until a notification with this method arrives. Deltas share the
    /// socket, so an assertion about a notification cannot assume it is next.
    async fn await_notification(&mut self, method: &str, budget: Duration) -> Value {
        let deadline = Instant::now() + budget;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(
                !remaining.is_zero(),
                "no {method} notification in {budget:?}"
            );
            let message = self.recv_within(remaining).await;
            if message["method"] == method {
                return message;
            }
        }
    }

    /// `desired.set` in fieldd's shape, answering with the whole JSON-RPC
    /// envelope so a test can assert on either a result or a refusal.
    async fn desired_set(&mut self, params: Value) -> Value {
        self.request("native.lifecycle.desired.set", params).await
    }
}

fn read_secret(daemon: &RunningDaemon) -> Vec<u8> {
    let path = daemon
        .mgmt_socket
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("pairing");
    hex::decode(std::fs::read_to_string(path).unwrap().trim()).unwrap()
}

fn terminals(payload: &Value) -> &Vec<Value> {
    payload["terminals"].as_array().expect("terminals array")
}

fn has_session(payload: &Value, session_id: &str) -> bool {
    terminals(payload)
        .iter()
        .any(|t| t["sessionId"] == session_id)
}

/// Spawn options in the NF-D3/NF-D6 posture: daemon-lifetime persistence, and a
/// clean environment so the test cannot pass by inheriting something.
fn tenant_options() -> Value {
    json!({
        "executable": TENANT,
        "args": [],
        "cols": 80,
        "rows": 24,
        "persistence": "keep-until-exit",
        "environment": {"mode": "clean", "variables": {}},
    })
}

/// Is this pid still around? The PTY leader is a child of THIS process in tests
/// (field-native is embedded), so a reaped child answers ESRCH.
fn alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

async fn wait_until_gone(pid: u32, budget: Duration) -> bool {
    let deadline = Instant::now() + budget;
    while Instant::now() < deadline {
        if !alive(pid) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    !alive(pid)
}

/// Dial the control socket the way any ticket holder will, using the endpoints
/// the hello handed over.
async fn control(ack: &Value) -> (ControlClient, tokio::sync::mpsc::UnboundedReceiver<Value>) {
    let socket = ack["terminal"]["controlSocket"]
        .as_str()
        .expect("controlSocket");
    let token = ack["terminal"]["authToken"].as_str().expect("authToken");
    ControlClient::connect(Path::new(socket), token)
        .await
        .expect("dial terminal control socket")
}

/// NF-D8: endpoints ride the pairing hello, under this daemon's own run dir,
/// with a per-boot token — and the sockets are private to the owning user (EL7).
#[tokio::test]
async fn hello_carries_private_terminal_endpoints() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let terminal = &ack["terminal"];

    let run_dir = dir.path().join("native/run");
    assert_eq!(
        terminal["controlSocket"].as_str().unwrap(),
        run_dir.join("termctl.sock").to_str().unwrap(),
        "control socket must be the registries path under this daemon's run dir"
    );
    assert_eq!(
        terminal["frameSocket"].as_str().unwrap(),
        run_dir.join("termframe.sock").to_str().unwrap()
    );
    let token = terminal["authToken"].as_str().expect("authToken");
    assert_eq!(token.len(), 64, "32 random bytes, hex");
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));

    for name in ["termctl.sock", "termframe.sock"] {
        let path = run_dir.join(name);
        let mode = std::fs::metadata(&path)
            .unwrap_or_else(|e| panic!("stat {}: {e}", path.display()))
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "{name} must be private to the owning user");
    }

    daemon.shutdown().await;
}

/// The slice's headline: a live PTY created over the control socket shows up in
/// the mgmt inventory with a pid, and leaves it when terminated.
#[tokio::test]
async fn live_pty_enters_and_leaves_the_observed_inventory() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let snapshot = mgmt.subscribe_observed().await;
    assert!(
        terminals(&snapshot).is_empty(),
        "a fresh boot owns no terminals: {snapshot}"
    );
    assert_eq!(snapshot["bootId"], daemon.boot_id);

    let (client, _events) = control(&ack).await;
    let session = client
        .create_session(tenant_options())
        .await
        .expect("create session");
    let pid = session.pid.expect("the PTY leader has a pid");
    assert!(alive(pid), "the tenant process must be running");

    // NF-7: creation is a pushed `session-created` hint (the self-client
    // announces control minor 1.9), so this delta arrives event-driven — the
    // kill matrix's < 2s row now rides the event, not the backstop.
    let payload = mgmt
        .await_observed(Duration::from_secs(5), |p| has_session(p, &session.id))
        .await;
    let row = terminals(&payload)
        .iter()
        .find(|t| t["sessionId"] == session.id)
        .expect("the session's row");
    assert_eq!(row["pid"].as_u64(), Some(u64::from(pid)));
    assert!(
        row["createdAt"].as_i64().is_some_and(|ms| ms > 0),
        "createdAt is epoch millis straight from the summary: {row}"
    );
    // G9 (0.7.0): the summary reports persistence and the row passes it
    // through — the create default, not an invention.
    assert_eq!(
        row["persistence"], "keep-until-exit",
        "persistence rides the summary into the observed row: {row}"
    );

    client
        .terminate(&session.id, "user")
        .await
        .expect("terminate");
    let payload = mgmt
        .await_observed(Duration::from_secs(5), |p| !has_session(p, &session.id))
        .await;
    assert!(
        terminals(&payload).is_empty(),
        "the terminated session must leave inventory: {payload}"
    );
    assert!(
        wait_until_gone(pid, Duration::from_secs(5)).await,
        "the tenant process must be gone after terminate"
    );

    daemon.shutdown().await;
}

/// The persistence of one session, as the observed inventory reports it.
fn persistence_of<'a>(payload: &'a Value, session_id: &str) -> Option<&'a str> {
    terminals(payload)
        .iter()
        .find(|t| t["sessionId"] == session_id)
        .and_then(|t| t["persistence"].as_str())
}

/// What a `GhostteaWorkspace` door asks for: an interactive shell, no owner
/// named, and the app-lifetime default it hardcodes (Workspace.tsx:199-207).
/// Written out rather than derived so this test still means what it says if the
/// deck's own props change.
fn workspace_door_options() -> Value {
    json!({
        "executable": TENANT,
        "args": [],
        "cols": 100,
        "rows": 30,
        "persistence": "terminate-with-app",
        "programKind": "interactive-shell",
        "environment": {"mode": "clean", "variables": {}},
    })
}

/// GT-D11: the floor keeps what the UI creates.
///
/// The workspace is the one authority over pane births (GT-D10) and its doors
/// hardcode `terminate-with-app`; this plane re-governs those births to the
/// daemon-lifetime the product promises. The whole chain is real here — a birth
/// on the actual floor, the actual `session-created` event, the actual
/// `set-persistence` — and the assertion reads the mgmt seam fieldd reads, so a
/// flip that never reached an observer would still fail.
#[tokio::test]
async fn an_ownerless_app_lifetime_birth_is_re_governed_to_the_floors_lifetime() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    mgmt.subscribe_observed().await;
    let (client, _events) = control(&ack).await;

    let ownerless = client
        .create_session(workspace_door_options())
        .await
        .expect("create an ownerless session");
    assert_eq!(
        ownerless.persistence.as_deref(),
        Some("terminate-with-app"),
        "the floor must have honoured the door's own ask before anything re-governs it"
    );

    let payload = mgmt
        .await_observed(Duration::from_secs(10), |p| {
            persistence_of(p, &ownerless.id) == Some("keep-until-exit")
        })
        .await;
    assert_eq!(
        persistence_of(&payload, &ownerless.id),
        Some("keep-until-exit"),
        "an ownerless app-lifetime birth must reach the observed inventory re-governed: {payload}"
    );

    // The other half of the law, and the one that would be invisible if broken:
    // an OWNED birth carries its author's explicit intent, and explicit intent
    // is never overridden. Read from the floor's own `list-sessions` — the
    // authority on retention — after a window several times longer than the
    // flip takes for the ownerless case above.
    let mut owned_options = workspace_door_options();
    owned_options["ownerId"] = json!("vibefield.fieldd");
    let owned = client
        .create_session(owned_options)
        .await
        .expect("create an owned session");
    assert_eq!(owned.owner_id.as_deref(), Some("vibefield.fieldd"));
    tokio::time::sleep(Duration::from_secs(2)).await;
    let sessions = client.list_sessions().await.expect("list sessions");
    let owned_now = sessions
        .iter()
        .find(|s| s.id == owned.id)
        .expect("the owned session is still on the floor");
    assert_eq!(
        owned_now.persistence.as_deref(),
        Some("terminate-with-app"),
        "an owned birth states its own persistence and must be left alone"
    );

    daemon.shutdown().await;
}

/// NF-D3: stop is a sweep. No PTY survives field-native — the honest ceiling —
/// it happens inside a bounded budget, and the exits are CLASSIFIED as the
/// service's doing.
///
/// The classification is the load-bearing assertion, not the dead pid: dropping
/// a session closes the PTY master, which SIGHUPs the foreground group all by
/// itself, so "the process is gone" alone would pass even with no sweep at all.
/// `service-terminated` can only come from a terminate this unit issued with
/// `source: "service-shutdown"`.
#[tokio::test]
async fn shutdown_sweeps_every_session_within_budget() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;

    // A passive witness: it issues nothing during shutdown, it only receives the
    // exit events the service broadcasts to every control client.
    let (client, mut events) = control(&ack).await;
    let mut expected = Vec::new();
    for _ in 0..3 {
        let session = client
            .create_session(tenant_options())
            .await
            .expect("create session");
        expected.push((session.id.clone(), session.pid.expect("pid")));
    }
    assert!(
        expected.iter().all(|(_, pid)| alive(*pid)),
        "tenants must be running"
    );

    let started = Instant::now();
    daemon.shutdown().await;
    let elapsed = started.elapsed();
    assert!(
        elapsed < Duration::from_secs(6),
        "shutdown overran the sweep budget: {elapsed:?}"
    );

    let mut outcomes = std::collections::HashMap::new();
    while outcomes.len() < expected.len() {
        let event = timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap_or_else(|_| panic!("only {} exit events arrived", outcomes.len()))
            .expect("the witness connection closed before the exits arrived");
        if event["type"] == "session-exited" {
            let id = event["sessionId"].as_str().expect("sessionId").to_owned();
            outcomes.insert(id, event.clone());
        }
    }
    for (id, pid) in expected {
        let event = outcomes
            .get(&id)
            .unwrap_or_else(|| panic!("no exit for {id}"));
        assert_eq!(
            event["requestedTermination"], "service-shutdown",
            "the sweep must stamp the true source: {event}"
        );
        assert_eq!(
            event["exitOutcome"], "service-terminated",
            "the exit must be classified as the service's, not an application's: {event}"
        );
        assert!(
            wait_until_gone(pid, Duration::from_secs(2)).await,
            "pid {pid} outlived the daemon; the sweep did not run its ladder"
        );
    }
}

/// EL7: the token is the boundary. A wrong one is refused, and the refusal is
/// not the service being dead — the right token still works right after.
#[tokio::test]
async fn wrong_token_is_refused_on_the_control_socket() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let socket = ack["terminal"]["controlSocket"]
        .as_str()
        .unwrap()
        .to_owned();

    // Wait for the service to be serving: an unaccepted connection would queue
    // in the kernel and read as a hang rather than a refusal.
    let (probe, _events) = control(&ack).await;
    probe.list_sessions().await.expect("service is serving");
    drop(probe);

    let mut stream = UnixStream::connect(&socket).await.expect("dial control");
    let wrong = b"0000000000000000000000000000000000000000000000000000000000000000";
    stream
        .write_u32_le(wrong.len() as u32)
        .await
        .expect("write length");
    stream.write_all(wrong).await.expect("write token");
    stream.flush().await.expect("flush");
    let refused = timeout(Duration::from_secs(5), stream.read_u32_le()).await;
    assert!(
        matches!(refused, Ok(Err(_))),
        "a wrong token must get no ack and a closed socket, got {refused:?}"
    );

    let (client, _events) = control(&ack).await;
    assert!(
        client.list_sessions().await.expect("list").is_empty(),
        "the right token still authenticates after a refusal"
    );

    daemon.shutdown().await;
}

// ---------------------------------------------------------------------------
// GT-3 — the app-owned config overlay (`config.ghostty`)
// ---------------------------------------------------------------------------

/// One framed control request on a raw socket, answered by type.
///
/// Written here rather than added to `ControlClient` on purpose: the config
/// document has no field-native caller, and a `pub` method with no production
/// user is a surface this crate would then owe forever (declared == shipped).
/// The framing is the same LE-u32 the wrong-token test already writes by hand.
async fn control_request(socket: &str, token: &str, request: Value, want: &str) -> Value {
    let mut stream = UnixStream::connect(socket).await.expect("dial control");
    write_frame(&mut stream, token.as_bytes()).await;
    let ack = read_frame(&mut stream).await;
    assert_eq!(ack, b"ok", "control authentication was refused");
    let hello = serde_json::to_vec(&json!({
        "requestId": 1,
        "type": "hello",
        "protocolMajor": 1,
        "protocolMinor": 9,
        "clientBuild": "field-native-test",
    }))
    .unwrap();
    write_frame(&mut stream, &hello).await;
    let _hello = read_frame(&mut stream).await;
    let mut body = request;
    body["requestId"] = json!(2);
    write_frame(&mut stream, &serde_json::to_vec(&body).unwrap()).await;
    // Looped, not read once: this connection is a client like any other and the
    // service may push it an unsolicited event before the answer.
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let frame = read_frame(&mut stream).await;
        let value: Value = serde_json::from_slice(&frame).expect("a JSON response");
        if value["type"] == want {
            return value;
        }
        assert_ne!(
            value["type"], "error",
            "the service refused the request: {value}"
        );
    }
    panic!("no {want} response within the budget");
}

async fn write_frame(stream: &mut UnixStream, bytes: &[u8]) {
    stream
        .write_u32_le(bytes.len() as u32)
        .await
        .expect("write length");
    stream.write_all(bytes).await.expect("write body");
    stream.flush().await.expect("flush");
}

async fn read_frame(stream: &mut UnixStream) -> Vec<u8> {
    let len = timeout(Duration::from_secs(10), stream.read_u32_le())
        .await
        .expect("a frame within the budget")
        .expect("read frame length") as usize;
    let mut body = vec![0_u8; len];
    stream.read_exact(&mut body).await.expect("read frame body");
    body
}

/// GT-3: the embedded service is pointed at OUR config file, and the file is
/// the registries name under this daemon's own native dir.
///
/// The path is read back from the SERVICE, not recomputed here — that is the
/// whole claim. `with_config_path` is the only thing that makes a document
/// editable at all (without it the service answers "unavailable without an
/// explicit overlay"), so a wiring that silently went missing fails this test
/// rather than surfacing later as a settings panel that cannot save.
#[tokio::test]
async fn the_config_overlay_is_this_daemons_own_file() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let socket = ack["terminal"]["controlSocket"]
        .as_str()
        .unwrap()
        .to_owned();
    let token = ack["terminal"]["authToken"].as_str().unwrap().to_owned();

    // Serving, not merely bound — an unaccepted connection queues in the kernel.
    let (probe, _events) = control(&ack).await;
    probe.list_sessions().await.expect("service is serving");
    drop(probe);

    let expected = dir.path().join("native/config.ghostty");
    assert!(
        !expected.exists(),
        "a fresh boot must not write a config file nobody asked for"
    );

    let response = control_request(
        &socket,
        &token,
        json!({"type": "get-config-document"}),
        "config-document",
    )
    .await;
    let document = &response["document"];
    assert_eq!(
        document["path"].as_str().unwrap(),
        expected.to_str().unwrap(),
        "the overlay must be the registries name under this daemon's native dir"
    );
    // A not-yet-created overlay is a valid empty config upstream, which is why
    // nothing has to be written before a user can be shown the file — and the
    // service answering at all, on a floor that just listed sessions, is the
    // answer to "does a missing config degrade the unit": it does not.
    assert_eq!(document["exists"], json!(false));
    assert_eq!(document["contents"].as_str().unwrap(), "");

    // The write half, on the same seam fieldd drives: an optimistic replace
    // against the revision just read. The file appears here and not before.
    let updated = control_request(
        &socket,
        &token,
        json!({
            "type": "replace-config-document",
            "expectedRevision": document["revision"].as_str().unwrap(),
            "contents": "# vibefield\nfont-size = 13\n",
        }),
        "config-document-updated",
    )
    .await;
    assert_eq!(updated["document"]["exists"], json!(true));
    assert_eq!(
        std::fs::read_to_string(&expected).expect("the overlay is on disk now"),
        "# vibefield\nfont-size = 13\n",
        "the service writes the bytes it was given, verbatim"
    );
    // The reload is part of the same operation, so the EFFECTIVE config has
    // already moved by the time the write is answered.
    assert_eq!(
        updated["config"]["renderer"]["fontSize"],
        json!(13.0),
        "the replace reloaded the config it just wrote: {}",
        updated["config"]["diagnostics"]
    );

    // A stale revision is refused rather than clobbering the newer file.
    let conflicted = control_request(
        &socket,
        &token,
        json!({
            "type": "replace-config-document",
            "expectedRevision": document["revision"].as_str().unwrap(),
            "contents": "font-size = 99\n",
        }),
        "config-document-conflict",
    )
    .await;
    assert_eq!(
        conflicted["document"]["contents"],
        updated["document"]["contents"]
    );

    daemon.shutdown().await;
}

// ---------------------------------------------------------------------------
// NF-5 — survivor authority (spec §5, NF-D2; kill-matrix row 4)
// ---------------------------------------------------------------------------

/// One session's exit event, from a witness connection that issues nothing of
/// its own. The classification is the only evidence of WHICH authority killed a
/// session — a dead pid proves a ladder ran, never who asked for it.
async fn await_exit(
    events: &mut tokio::sync::mpsc::UnboundedReceiver<Value>,
    session_id: &str,
    budget: Duration,
) -> Value {
    let deadline = Instant::now() + budget;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = timeout(remaining, events.recv())
            .await
            .unwrap_or_else(|_| panic!("no exit event for {session_id} in {budget:?}"))
            .expect("the witness connection closed before the exit arrived");
        if event["type"] == "session-exited" && event["sessionId"] == session_id {
            return event;
        }
    }
}

/// The exits for a whole SET, gathered together. Sequential `await_exit` calls
/// cannot do this job: each one discards the events it was not asked for, and a
/// prune's ladders run in parallel in whatever order the floor's inventory sorted
/// them into — so waiting for one session can consume another's only proof.
async fn await_exits(
    events: &mut tokio::sync::mpsc::UnboundedReceiver<Value>,
    session_ids: &[String],
    budget: Duration,
) -> std::collections::HashMap<String, Value> {
    let deadline = Instant::now() + budget;
    let mut exits = std::collections::HashMap::new();
    while exits.len() < session_ids.len() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = timeout(remaining, events.recv())
            .await
            .unwrap_or_else(|_| {
                panic!(
                    "only {} of {} exit events arrived in {budget:?}",
                    exits.len(),
                    session_ids.len()
                )
            })
            .expect("the witness connection closed before the exits arrived");
        if event["type"] == "session-exited" {
            let id = event["sessionId"].as_str().expect("sessionId").to_owned();
            if session_ids.contains(&id) {
                exits.insert(id, event);
            }
        }
    }
    exits
}

/// Two tenants and the bootId fieldd would prove with: the daemon, its mgmt
/// client subscribed to observed, a control client, and both sessions already
/// visible in the inventory (which is what makes a proof possible at all).
struct Pair {
    survivor: field_native::services::terminal_client::SessionSummary,
    doomed: field_native::services::terminal_client::SessionSummary,
    survivor_pid: u32,
    doomed_pid: u32,
    boot_id: String,
}

async fn two_tenants(
    mgmt: &mut MgmtClient,
    client: &ControlClient,
    daemon: &RunningDaemon,
) -> Pair {
    let snapshot = mgmt.subscribe_observed().await;
    // fieldd learns the bootId the way the contract intends — from the
    // inventory it pulled, not from anywhere else.
    let boot_id = snapshot["bootId"].as_str().expect("bootId").to_owned();
    assert_eq!(boot_id, daemon.boot_id);

    let survivor = client
        .create_session(tenant_options())
        .await
        .expect("create the survivor");
    let doomed = client
        .create_session(tenant_options())
        .await
        .expect("create the session to be withdrawn");
    let survivor_pid = survivor.pid.expect("pid");
    let doomed_pid = doomed.pid.expect("pid");

    // The floor must SEE both before a set can prove it saw them.
    mgmt.await_observed(Duration::from_secs(5), |payload| {
        has_session(payload, &survivor.id) && has_session(payload, &doomed.id)
    })
    .await;

    Pair {
        survivor,
        doomed,
        survivor_pid,
        doomed_pid,
        boot_id,
    }
}

/// The slice's headline: a proven set IS authority. The session fieldd still
/// lists is untouched; the one it withdrew runs its ladder, leaves the inventory,
/// and its exit is stamped `application` — a reconcile is the product plane's
/// decision, neither a human's kill nor this daemon going down.
#[tokio::test]
async fn proven_desired_set_prunes_only_the_unlisted_session() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let (client, mut events) = control(&ack).await;
    let pair = two_tenants(&mut mgmt, &client, &daemon).await;

    let response = mgmt
        .desired_set(json!({
            "generation": 1,
            "terminals": [{"sessionId": pair.survivor.id}],
            "workers": [],
            "observedBootId": pair.boot_id,
        }))
        .await;
    assert_eq!(
        response["result"]["applied"], 1,
        "a proven set must apply: {response}"
    );

    let exit = await_exit(&mut events, &pair.doomed.id, Duration::from_secs(5)).await;
    assert_eq!(
        exit["requestedTermination"], "application",
        "a prune is the application withdrawing a session: {exit}"
    );
    assert_eq!(
        exit["exitOutcome"], "application-terminated",
        "the classification every observer reads must name the product plane: {exit}"
    );

    let payload = mgmt
        .await_observed(Duration::from_secs(5), |payload| {
            !has_session(payload, &pair.doomed.id)
        })
        .await;
    assert!(
        has_session(&payload, &pair.survivor.id),
        "the listed session must survive the prune: {payload}"
    );
    assert_eq!(
        payload["generation"], 1,
        "the applied generation is observed"
    );
    assert!(
        wait_until_gone(pair.doomed_pid, Duration::from_secs(5)).await,
        "the withdrawn session's ladder must have run"
    );
    assert!(
        alive(pair.survivor_pid),
        "the survivor's PTY must be untouched by someone else's prune"
    );

    daemon.shutdown().await;
}

/// NF-D2(a) and (b): silence kills nothing, and a set that WOULD prune without
/// proof of this boot's inventory is refused whole. The last step is the
/// sensitivity proof — the identical set applies the moment it carries the
/// proof, so these refusals are about the missing proof and not about the set.
#[tokio::test]
async fn unproven_desired_set_prunes_nothing() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let (client, _events) = control(&ack).await;
    let pair = two_tenants(&mut mgmt, &client, &daemon).await;

    // (a) No set has been sent since boot, and both tenants are running. The
    // inventory on its own is never authority to kill anything.
    assert!(
        alive(pair.survivor_pid) && alive(pair.doomed_pid),
        "silence must kill nothing"
    );

    let survivors = json!([{"sessionId": pair.survivor.id}]);
    for proof in [None, Some("native-boot-from-another-life".to_owned())] {
        let mut params = json!({
            "generation": 1,
            "terminals": survivors,
            "workers": [],
        });
        if let Some(proof) = proof {
            params["observedBootId"] = json!(proof);
        }
        let refusal = mgmt.desired_set(params).await;
        assert_eq!(
            refusal["error"]["data"]["kind"], "PRECONDITION_FAILED",
            "an unproven prune must be refused: {refusal}"
        );
        let details = &refusal["error"]["data"]["details"];
        assert_eq!(
            details["wouldPrune"], 1,
            "the refusal must name what it declined to kill: {refusal}"
        );
        assert_eq!(
            details["current"], pair.boot_id,
            "the refusal must hand back the bootId that WOULD satisfy it: {refusal}"
        );
    }

    // A ladder is fast — /bin/cat dies on the first rung — so a wrongly fired
    // one would already be visible here. The quiet window doubles as the
    // generation proof: banking a refused set would publish an observed delta,
    // and this reads every delta the window produced (which is how the claim is
    // made on the ONE subscription this connection has, rather than by opening a
    // second one to peek at a snapshot).
    for payload in mgmt.observed_within(Duration::from_millis(500)).await {
        assert_eq!(
            payload["generation"], 0,
            "a refused set must not bank its generation: {payload}"
        );
    }
    assert!(
        alive(pair.survivor_pid) && alive(pair.doomed_pid),
        "an unproven set must terminate NOTHING"
    );
    assert_eq!(
        client.list_sessions().await.expect("list").len(),
        2,
        "list-sessions is truth, and it must still hold both"
    );

    let response = mgmt
        .desired_set(json!({
            "generation": 1,
            "terminals": survivors,
            "workers": [],
            "observedBootId": pair.boot_id,
        }))
        .await;
    assert_eq!(
        response["result"]["applied"], 1,
        "the same set, proven, must apply — otherwise the refusals above prove nothing: {response}"
    );
    assert!(
        wait_until_gone(pair.doomed_pid, Duration::from_secs(5)).await,
        "the proven set must prune what the unproven ones could not"
    );
    assert!(alive(pair.survivor_pid), "the survivor still survives");

    daemon.shutdown().await;
}

/// NF-D2: a retain-only set may omit the proof. The guard exists to protect
/// running sessions, not to make bookkeeping ceremonial — a set that kills
/// nothing has nothing to prove.
#[tokio::test]
async fn retain_only_desired_set_needs_no_proof() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let (client, _events) = control(&ack).await;
    let pair = two_tenants(&mut mgmt, &client, &daemon).await;

    // Every running session is listed, so the prune set is empty.
    let response = mgmt
        .desired_set(json!({
            "generation": 3,
            "terminals": [
                {"sessionId": pair.survivor.id},
                {"sessionId": pair.doomed.id, "persistence": "keep-until-explicit-close"},
            ],
            "workers": [],
        }))
        .await;
    assert_eq!(
        response["result"]["applied"], 3,
        "a retain-only set must apply without a proof: {response}"
    );

    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        alive(pair.survivor_pid) && alive(pair.doomed_pid),
        "a retain-only set must terminate nothing"
    );
    // NF-7: the carried persistence is now APPLIED (G9's `set-persistence`,
    // spec §5's re-policy step) — the promoted session's observed row must
    // come to say so. No event announces a policy change, so the row refreshes
    // on the backstop; the wait spans it with room.
    let payload = mgmt
        .await_observed(Duration::from_secs(12), |payload| {
            terminals(payload).iter().any(|row| {
                row["sessionId"] == pair.doomed.id
                    && row["persistence"] == "keep-until-explicit-close"
            })
        })
        .await;
    let untouched = terminals(&payload)
        .iter()
        .find(|row| row["sessionId"] == pair.survivor.id)
        .map(|row| row["persistence"].clone())
        .expect("the survivor's row");
    assert_eq!(
        untouched, "keep-until-exit",
        "a set that says nothing about a session's persistence changes nothing: {payload}"
    );

    daemon.shutdown().await;
}

/// NF-D2(c) before (b)'s effect: a stale generation is refused BEFORE any ladder
/// fires, even when the set is otherwise perfectly proven. Kill-matrix row 4's
/// "stale ⇒ zero terminations".
#[tokio::test]
async fn stale_generation_is_refused_before_any_prune() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let (client, _events) = control(&ack).await;
    let pair = two_tenants(&mut mgmt, &client, &daemon).await;

    let response = mgmt
        .desired_set(json!({
            "generation": 5,
            "terminals": [{"sessionId": pair.survivor.id}, {"sessionId": pair.doomed.id}],
            "workers": [],
        }))
        .await;
    assert_eq!(response["result"]["applied"], 5);

    // Proven, and it would prune both — but it arrives behind the generation
    // that is already applied, so it is refused before anything is issued.
    let refusal = mgmt
        .desired_set(json!({
            "generation": 4,
            "terminals": [],
            "workers": [],
            "observedBootId": pair.boot_id,
        }))
        .await;
    assert_eq!(refusal["error"]["data"]["kind"], "PRECONDITION_FAILED");
    assert_eq!(
        refusal["error"]["message"], "stale generation",
        "the generation guard must answer first, before the proof is ever weighed: {refusal}"
    );

    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        alive(pair.survivor_pid) && alive(pair.doomed_pid),
        "a stale set must terminate nothing, however well proven"
    );
    assert_eq!(client.list_sessions().await.expect("list").len(), 2);

    daemon.shutdown().await;
}

/// The single-client rule is a KILL-authority boundary and not bookkeeping.
/// Superseding a connection closes its write half, but its reader loop stays
/// alive and authenticated — and `desired.set` is the one surface where that
/// matters, because a prune kills PTYs the SUCCESSOR is responsible for. The
/// generation guard cannot stand in for this check: the stale set below carries a
/// generation higher than anything applied, so every other guard would admit it.
#[tokio::test]
async fn a_superseded_client_may_not_prune_the_successors_sessions() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut stale = MgmtClient::connect(&daemon).await;
    let ack = stale.hello(&daemon).await;
    let (client, mut events) = control(&ack).await;
    let pair = two_tenants(&mut stale, &client, &daemon).await;

    // A newer fieldd pairs; the old connection is told why its plane ended.
    let mut current = MgmtClient::connect(&daemon).await;
    current.hello(&daemon).await;
    let notice = stale
        .await_notification("native.lifecycle.superseded", Duration::from_secs(5))
        .await;
    assert_eq!(
        notice["params"]["reason"], "new hello",
        "the superseded client must learn why: {notice}"
    );

    // Proven against this boot, ahead of every applied generation, and it would
    // prune BOTH sessions: everything the other guards weigh, from a connection
    // that is no longer the product plane. Sent raw because the id has to be
    // known to the assertion below.
    let stale_id = 90;
    stale
        .send(
            json!({"jsonrpc":"2.0","id":stale_id,"method":"native.lifecycle.desired.set","params":{
                "generation": 7,
                "terminals": [],
                "workers": [],
                "observedBootId": pair.boot_id,
            }}),
        )
        .await;
    // The refusal is generated, but supersession already shut this connection's
    // write half down, so it cannot reach the wire: the honest observables are a
    // closed socket and two PTYs that are still running.
    stale
        .await_close_without_answering(stale_id, Duration::from_secs(5))
        .await;
    // EOF says nothing about timing — it was already inevitable when the write
    // half closed — so the liveness claim needs the window a ladder would need.
    // /bin/cat dies on the first rung, and the wrongly-pruned pids below stay
    // alive well past this only if nothing was ever issued for them.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        alive(pair.survivor_pid) && alive(pair.doomed_pid),
        "a superseded client must terminate NOTHING"
    );
    assert_eq!(
        client.list_sessions().await.expect("list").len(),
        2,
        "list-sessions is truth, and it must still hold both"
    );

    // Sensitivity: the identical set from the CURRENT client applies. So the
    // refusal was about who asked, never about the set.
    let snapshot = current.subscribe_observed().await;
    assert_eq!(
        snapshot["generation"], 0,
        "the stale set must not have banked its generation: {snapshot}"
    );
    let response = current
        .desired_set(json!({
            "generation": 7,
            "terminals": [],
            "workers": [],
            "observedBootId": pair.boot_id,
        }))
        .await;
    assert_eq!(
        response["result"]["applied"], 7,
        "the current client's identical set must apply: {response}"
    );
    let both = [pair.survivor.id.clone(), pair.doomed.id.clone()];
    let exits = await_exits(&mut events, &both, Duration::from_secs(10)).await;
    for (session_id, pid) in [
        (&pair.survivor.id, pair.survivor_pid),
        (&pair.doomed.id, pair.doomed_pid),
    ] {
        assert_eq!(
            exits[session_id]["requestedTermination"], "application",
            "{:?}",
            exits[session_id]
        );
        assert!(
            wait_until_gone(pid, Duration::from_secs(5)).await,
            "pid {pid} outlived the current client's prune"
        );
    }

    daemon.shutdown().await;
}

/// The hazard behind the reconcile prune, at the seam where it is deterministic.
/// Every control connection receives every broadcast event (service.rs:470/624),
/// and a client that only wants request/response — which is exactly what the
/// prune is — has no receiver to hand them to. Discarding those events must cost
/// nothing: a client that ended its demultiplexer instead would leave every
/// later request on that connection unanswered until the 10s request budget
/// expired, with the reconcile lock held the whole time.
#[tokio::test]
async fn a_dropped_events_receiver_does_not_wedge_the_control_client() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;

    // A witness that keeps its receiver, so the test knows WHEN the broadcast
    // reached the connections rather than guessing.
    let (witness, mut events) = control(&ack).await;
    // The client under test, in the prune's shape: the event stream it never
    // asked for is dropped straight away.
    let (client, unwanted) = control(&ack).await;
    drop(unwanted);

    let session = witness
        .create_session(tenant_options())
        .await
        .expect("create session");
    let pid = session.pid.expect("pid");
    // Terminated THROUGH the client under test, so the event it is about to be
    // handed is one its own request caused — the prune's situation exactly.
    client
        .terminate(&session.id, "application")
        .await
        .expect("terminate");
    await_exit(&mut events, &session.id, Duration::from_secs(5)).await;
    assert!(wait_until_gone(pid, Duration::from_secs(5)).await);
    // The witness proves the broadcast happened; this gives the other
    // connection's reader time to have taken its copy off the socket.
    tokio::time::sleep(Duration::from_millis(200)).await;

    let started = Instant::now();
    let sessions = timeout(Duration::from_secs(3), client.list_sessions())
        .await
        .expect("the control client stopped answering after an undeliverable event")
        .expect("list-sessions");
    assert!(
        sessions.is_empty(),
        "the terminated session must be gone: {sessions:?}"
    );
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "a request after an undeliverable event took {:?}",
        started.elapsed()
    );

    daemon.shutdown().await;
}

/// A prune that withdraws MORE than one session, which no case covered before:
/// every ladder runs, every exit is classified, and the response comes back at
/// socket speed rather than waiting on anything.
#[tokio::test]
async fn a_multi_session_prune_answers_without_burning_request_timeouts() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let snapshot = mgmt.subscribe_observed().await;
    let boot_id = snapshot["bootId"].as_str().expect("bootId").to_owned();
    let (client, mut events) = control(&ack).await;

    let mut doomed = Vec::new();
    for _ in 0..3 {
        let session = client
            .create_session(tenant_options())
            .await
            .expect("create session");
        doomed.push((session.id.clone(), session.pid.expect("pid")));
    }
    // Proof first: the floor must SEE all three before a set may prune them.
    mgmt.await_observed(Duration::from_secs(5), |payload| {
        doomed
            .iter()
            .all(|(session_id, _)| has_session(payload, session_id))
    })
    .await;

    let started = Instant::now();
    let response = mgmt
        .desired_set(json!({
            "generation": 1,
            "terminals": [],
            "workers": [],
            "observedBootId": boot_id,
        }))
        .await;
    let elapsed = started.elapsed();
    assert_eq!(
        response["result"]["applied"], 1,
        "a proven set must apply: {response}"
    );
    // Three terminates are three Unix-socket round trips into this process:
    // milliseconds. The bound is loose enough not to flake on a loaded machine
    // and far tighter than the two burned 10s budgets the bug cost.
    assert!(
        elapsed < Duration::from_secs(3),
        "the prune answered in {elapsed:?}; a multi-session prune must not wait on request timeouts"
    );

    let ids: Vec<String> = doomed.iter().map(|(id, _)| id.clone()).collect();
    let exits = await_exits(&mut events, &ids, Duration::from_secs(10)).await;
    for (session_id, pid) in &doomed {
        assert_eq!(
            exits[session_id]["requestedTermination"], "application",
            "every prune in the set is the application's: {:?}",
            exits[session_id]
        );
        assert!(
            wait_until_gone(*pid, Duration::from_secs(5)).await,
            "pid {pid} outlived the prune"
        );
    }

    daemon.shutdown().await;
}

/// The NF-D3 sweep's already-exited filter, proven. Only a
/// `keep-until-explicit-close` session survives its own process in the registry
/// (service.rs:709 removes every other class on exit), and upstream will never
/// emit a second `session-exited` for it — so a sweep that awaited one would
/// spend its entire 6s budget on a session that is already dead.
#[tokio::test]
async fn the_sweep_never_waits_on_an_already_exited_session() {
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&daemon).await;
    let ack = mgmt.hello(&daemon).await;
    let (client, _events) = control(&ack).await;

    // `/bin/echo` exits on its own the moment it is spawned; the persistence is
    // what makes the registry keep the row afterwards.
    let mut options = tenant_options();
    options["executable"] = json!("/bin/echo");
    options["persistence"] = json!("keep-until-explicit-close");
    let session = client
        .create_session(options)
        .await
        .expect("create the short-lived session");

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(
            Instant::now() < deadline,
            "the session never reported itself exited"
        );
        let sessions = client.list_sessions().await.expect("list");
        let row = sessions
            .iter()
            .find(|listed| listed.id == session.id)
            .unwrap_or_else(|| {
                panic!(
                    "a keep-until-explicit-close session must be RETAINED after its process exits"
                )
            });
        if row.exited {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let started = Instant::now();
    daemon.shutdown().await;
    let elapsed = started.elapsed();
    // The sweep still ISSUES the terminate — the registry row is its to clear —
    // it just must not wait for an exit that already happened.
    assert!(
        elapsed < Duration::from_secs(2),
        "the sweep spent {elapsed:?} waiting on a session that had already exited"
    );
}

/// A Unix socket outlives the process that bound it, so the second boot has to
/// replace its own endpoints. The token is minted per boot, and the inventory
/// starts empty — no phantom sessions from a previous life (spec §10.3).
#[tokio::test]
async fn stale_endpoints_are_rebound_on_the_next_boot() {
    let dir = short_tempdir();

    let first = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&first).await;
    let first_ack = mgmt.hello(&first).await;
    let (client, _events) = control(&first_ack).await;
    let session = client
        .create_session(tenant_options())
        .await
        .expect("create");
    let pid = session.pid.expect("pid");
    let first_token = first_ack["terminal"]["authToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let first_boot_id = first.boot_id.clone();
    drop(client);
    first.shutdown().await;
    assert!(
        wait_until_gone(pid, Duration::from_secs(5)).await,
        "the first boot's session must not survive its daemon"
    );
    let socket_path = dir.path().join("native/run/termctl.sock");
    assert!(
        socket_path.exists(),
        "the socket file is expected to be left behind — that is what makes this a rebind"
    );

    let second = boot(dir.path()).await;
    let mut mgmt = MgmtClient::connect(&second).await;
    let second_ack = mgmt.hello(&second).await;
    let second_token = second_ack["terminal"]["authToken"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(
        first_token, second_token,
        "the bearer token dies with its boot (NF-D8)"
    );
    assert_ne!(first_boot_id, second.boot_id);

    let (client, _events) = control(&second_ack).await;
    assert!(
        client.list_sessions().await.expect("list").is_empty(),
        "a fresh boot must show no phantom sessions"
    );
    let session = client
        .create_session(tenant_options())
        .await
        .expect("create on the rebound socket");
    let pid = session.pid.expect("pid");
    drop(client);
    second.shutdown().await;
    assert!(wait_until_gone(pid, Duration::from_secs(5)).await);
}
