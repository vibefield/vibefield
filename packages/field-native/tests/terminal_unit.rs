//! NF-2 gate: the terminal floor with a REAL PTY under it.
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
    let probe = dir.path().join("native/run/terminal-control.sock");
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

/// The mgmt client, in the idiom of tests/mgmt_server.rs: newline JSON-RPC over
/// the paired UDS.
struct MgmtClient {
    reader: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    writer: tokio::net::unix::OwnedWriteHalf,
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
        }
    }

    async fn send(&mut self, v: Value) {
        let mut line = v.to_string();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).await.expect("write");
    }

    async fn recv(&mut self) -> Value {
        let line = timeout(Duration::from_secs(5), self.reader.next_line())
            .await
            .expect("recv timeout")
            .expect("read error")
            .expect("connection closed");
        serde_json::from_str(&line).expect("json line")
    }

    /// Answers with the ack itself (the JSON-RPC `result`), which is the
    /// `HelloAck` shape the contract pins.
    async fn hello(&mut self, daemon: &RunningDaemon) -> Value {
        let secret = read_secret(daemon);
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-boot-terminal-test";
        let mac = pairing::compute_mac(&secret, boot, ts);
        self.send(
            json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.hello","params":{
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

    /// Subscribe and answer with the inventory snapshot.
    async fn subscribe_observed(&mut self) -> Value {
        self.send(json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.observed.subscribe"}))
            .await;
        let response = self.recv().await;
        response["result"]["snapshot"].clone()
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
            let line = timeout(remaining, self.reader.next_line())
                .await
                .expect("observed delta timed out")
                .expect("read error")
                .expect("connection closed");
            let message: Value = serde_json::from_str(&line).expect("json line");
            if message["method"] == "native.lifecycle.observed.delta" {
                let payload = message["params"]["payload"].clone();
                if wanted(&payload) {
                    return payload;
                }
            }
        }
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
        run_dir.join("terminal-control.sock").to_str().unwrap(),
        "control socket must be the registries path under this daemon's run dir"
    );
    assert_eq!(
        terminal["frameSocket"].as_str().unwrap(),
        run_dir.join("terminal-frame.sock").to_str().unwrap()
    );
    let token = terminal["authToken"].as_str().expect("authToken");
    assert_eq!(token.len(), 64, "32 random bytes, hex");
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));

    for name in ["terminal-control.sock", "terminal-frame.sock"] {
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

    // Creation pushes no upstream event (SessionSummary has no create
    // notification), so this delta arrives on the inventory backstop — the row
    // the kill matrix bounds at < 2s.
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
    assert!(
        row.get("persistence").is_none(),
        "persistence has no upstream source and must stay ABSENT, not invented: {row}"
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
    let socket_path = dir.path().join("native/run/terminal-control.sock");
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
