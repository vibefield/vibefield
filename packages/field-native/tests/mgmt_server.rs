//! Kill-matrix seeds for the mgmt channel (design-02 §7): pairing, hello gate,
//! single-client SUPERSEDED takeover, generation guard, subscriptions, honest stubs.
use field_native::local_ipc;
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::timeout;

// WIN-D1: the client dials through local_ipc (socket path or pipe name — the
// endpoint string decides) and splits generically, because a named pipe has no
// owned split. This is the same shape production dialers took.
struct TestClient {
    reader: tokio::io::Lines<BufReader<tokio::io::ReadHalf<local_ipc::ClientStream>>>,
    writer: tokio::io::WriteHalf<local_ipc::ClientStream>,
}

impl TestClient {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .expect("connect mgmt");
        let (r, w) = tokio::io::split(stream);
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
    async fn recv_eof(&mut self) -> bool {
        matches!(
            timeout(Duration::from_secs(5), self.reader.next_line()).await,
            Ok(Ok(None)) | Ok(Err(_))
        )
    }
    async fn hello(&mut self, daemon: &RunningDaemon, id: u64) -> Value {
        let secret = read_secret(daemon);
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-boot-test";
        let mac = pairing::compute_mac(&secret, boot, ts);
        self.send(
            json!({"jsonrpc":"2.0","id":id,"method":"native.lifecycle.hello","params":{
                "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
                "credential":{"bootId":boot,"ts":ts,"mac":mac}
            }}),
        )
        .await;
        self.recv().await
    }
}

fn read_secret(daemon: &RunningDaemon) -> Vec<u8> {
    // tests derive macs the way fieldd will: from the shared 0600 pairing file.
    // WIN-D1: from the path the daemon exposes, not walked up from the endpoint
    // — on win32 the endpoint is a pipe name with no parent on disk.
    hex::decode(
        std::fs::read_to_string(&daemon.pairing_file)
            .unwrap()
            .trim(),
    )
    .unwrap()
}

async fn boot() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    (dir, daemon)
}

#[tokio::test]
async fn pairing_vector_matches_cross_language_fixture() {
    let raw = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/pairing.vector.json"),
    )
    .unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();
    let secret = hex::decode(v["secretHex"].as_str().unwrap()).unwrap();
    let mac = pairing::compute_mac(
        &secret,
        v["bootId"].as_str().unwrap(),
        v["ts"].as_i64().unwrap(),
    );
    assert_eq!(
        mac,
        v["mac"].as_str().unwrap(),
        "D8 MAC recipe drifted from the TS side"
    );
}

/// WIN-10 — the SERVER's half of the handshake is pinned by the same vector.
/// The client refuses an ack whose proof does not verify, so a drift here is a
/// pair that cannot pair at all rather than a silent weakening.
#[tokio::test]
async fn ack_mac_vector_matches_cross_language_fixture() {
    let raw = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/pairing.vector.json"),
    )
    .unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();
    let secret = hex::decode(v["secretHex"].as_str().unwrap()).unwrap();
    let ack = pairing::compute_ack_mac(
        &secret,
        v["nonce"].as_str().unwrap(),
        v["bootId"].as_str().unwrap(),
    );
    assert_eq!(
        ack,
        v["ackMac"].as_str().unwrap(),
        "WIN-10 ack MAC recipe drifted from the TS side"
    );
    // The two directions must never produce the same bytes for the same inputs:
    // distinct context strings are what stop one transcript replaying as the other.
    assert_ne!(
        ack,
        pairing::compute_mac(
            &secret,
            v["bootId"].as_str().unwrap(),
            v["ts"].as_i64().unwrap()
        ),
        "the ack and client MACs share a derivation"
    );
}

#[tokio::test]
async fn hello_pairs_and_acks() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    let resp = c.hello(&daemon, 1).await;
    assert_eq!(resp["result"]["serverKind"], "field-native");
    assert_eq!(resp["result"]["contractsVersion"], "0.1.0");
    // GT-2d: the ack names the build that answered. This plane is adopted, so
    // the pairing alone never says how old the floor on the other end is.
    let build = resp["result"]["nativeBuild"]
        .as_str()
        .expect("the hello ack carries a build label");
    assert!(
        build.starts_with(concat!("field-native/", env!("CARGO_PKG_VERSION"))),
        "build label lost its crate version: {build}"
    );
}

#[tokio::test]
async fn bad_mac_and_stale_ts_rejected() {
    let (_dir, daemon) = boot().await;

    let mut c = TestClient::connect(&daemon).await;
    c.send(
        json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.hello","params":{
            "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
            "credential":{"bootId":"x","ts": pairing::now_epoch_secs(),"mac":"deadbeef"}
        }}),
    )
    .await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAUTHORIZED");

    let mut c2 = TestClient::connect(&daemon).await;
    let secret = read_secret(&daemon);
    let stale = pairing::now_epoch_secs() - 3600;
    let mac = pairing::compute_mac(&secret, "x", stale);
    c2.send(
        json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.hello","params":{
            "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
            "credential":{"bootId":"x","ts": stale,"mac": mac}
        }}),
    )
    .await;
    let resp = c2.recv().await;
    assert_eq!(
        resp["error"]["data"]["kind"], "UNAUTHORIZED",
        "outside ±300s window"
    );
}

#[tokio::test]
async fn hello_required_before_anything() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.send(
        json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.health.subscribe","params":{}}),
    )
    .await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAUTHORIZED");
}

#[tokio::test]
async fn new_hello_supersedes_old_client() {
    let (_dir, daemon) = boot().await;
    let mut c1 = TestClient::connect(&daemon).await;
    assert!(c1.hello(&daemon, 1).await["result"].is_object());

    let mut c2 = TestClient::connect(&daemon).await;
    assert!(c2.hello(&daemon, 1).await["result"].is_object());

    let note = c1.recv().await;
    assert_eq!(note["method"], "native.lifecycle.superseded");
    assert!(
        c1.recv_eof().await,
        "old connection must be closed after SUPERSEDED"
    );

    // the new client is fully functional
    c2.send(
        json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.health.subscribe","params":{}}),
    )
    .await;
    let resp = c2.recv().await;
    assert!(resp["result"]["snapshot"]["units"].is_array());
}

#[tokio::test]
async fn health_snapshot_reports_every_unit() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;
    c.send(
        json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.health.subscribe","params":{}}),
    )
    .await;
    let resp = c.recv().await;
    let units = resp["result"]["snapshot"]["units"].as_array().unwrap();
    let names: Vec<&str> = units.iter().map(|u| u["unit"].as_str().unwrap()).collect();
    assert!(
        names.contains(&"mgmt") && names.contains(&"terminal") && names.contains(&"mesh-gateway")
    );
    // The snapshot can honestly read "starting": since NF-2 the terminal unit
    // builds its text engine off the boot path, and the deltas carry the settle.
    // What matters is where it LANDS — mesh disabled is not degradation.
    let mut state = resp["result"]["snapshot"]["state"].clone();
    while state == "starting" {
        let delta = c.recv().await;
        assert_eq!(delta["method"], "native.lifecycle.health.delta");
        state = delta["params"]["payload"]["state"].clone();
    }
    assert_eq!(state, "up");
}

#[tokio::test]
async fn desired_generation_guard_and_observed_delta() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;

    c.send(
        json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.observed.subscribe","params":{}}),
    )
    .await;
    let sub = c.recv().await;
    assert_eq!(sub["result"]["snapshot"]["generation"], 0);

    c.send(
        json!({"jsonrpc":"2.0","id":3,"method":"native.lifecycle.desired.set","params":{
            "generation":5,"terminals":[{"sessionId":"a"}],"workers":[]
        }}),
    )
    .await;
    // arrival order of ack vs delta is not guaranteed — collect both
    let (a, b) = (c.recv().await, c.recv().await);
    let (ack, delta) = if a.get("id").is_some_and(|i| i == 3) {
        (a, b)
    } else {
        (b, a)
    };
    assert_eq!(ack["result"]["applied"], 5);
    assert_eq!(delta["method"], "native.lifecycle.observed.delta");
    assert_eq!(delta["params"]["payload"]["generation"], 5);

    c.send(
        json!({"jsonrpc":"2.0","id":4,"method":"native.lifecycle.desired.set","params":{
            "generation":4,"terminals":[],"workers":[]
        }}),
    )
    .await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "PRECONDITION_FAILED");
}

#[tokio::test]
async fn mesh_answers_honest_unavailable_with_real_unit_state() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;
    c.send(json!({"jsonrpc":"2.0","id":2,"method":"native.mesh.peers.list","params":{}}))
        .await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAVAILABLE");
    assert_eq!(resp["error"]["data"]["details"]["service"], "mesh-gateway");
    // C1: the details carry the unit's REAL state, not a hardcoded "stub"
    assert_eq!(resp["error"]["data"]["details"]["state"], "disabled");
    assert_eq!(resp["error"]["data"]["retryable"], true);
}

/// UA-P-0a (D1) — the posture verbs answer BEFORE the node gate, which is the
/// whole point: `start` is how a node comes to exist, so gating it on a node
/// would make an unlinked desktop permanently unlinkable. There is no sidecar
/// here, so the bring-up degrades — and that is the honest answer too: the verb
/// SUCCEEDED (the posture is recorded), the unit reports why there is no node.
#[tokio::test]
async fn the_posture_verbs_answer_without_a_node() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;

    // peers.list, one line up from here, is refused UNAVAILABLE with no node.
    // start is not: it is the verb that asks for one.
    c.send(
        json!({"jsonrpc":"2.0","id":2,"method":"native.mesh.start","params":{"mode":"capture"}}),
    )
    .await;
    let resp = c.recv().await;
    assert_eq!(resp["result"]["mode"], "capture", "{resp}");
    assert_eq!(resp["result"]["started"], true, "{resp}");

    // the promotion the capture ends in
    c.send(
        json!({"jsonrpc":"2.0","id":3,"method":"native.mesh.start","params":{
            "mode":"linked","login":"james@github"
        }}),
    )
    .await;
    let resp = c.recv().await;
    assert_eq!(resp["result"]["mode"], "linked", "{resp}");

    // stop reports honestly that there was no node to drop (no sidecar here)
    c.send(json!({"jsonrpc":"2.0","id":4,"method":"native.mesh.stop","params":{}}))
        .await;
    let resp = c.recv().await;
    assert_eq!(resp["result"]["stopped"], false, "{resp}");

    daemon.shutdown().await;
}

/// UA-P-0a — the two modes are validated AGAINST EACH OTHER. `linked` with no
/// login is a node claiming an account it cannot name; `capture` with one is a
/// caller asserting an identity the tailnet has not answered for (EL7 —
/// identity comes from the control plane, never from a claim).
#[tokio::test]
async fn a_posture_that_contradicts_its_login_is_refused() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;

    c.send(json!({"jsonrpc":"2.0","id":2,"method":"native.mesh.start","params":{"mode":"linked"}}))
        .await;
    let resp = c.recv().await;
    assert_eq!(
        resp["error"]["data"]["kind"], "PRECONDITION_FAILED",
        "{resp}"
    );

    c.send(
        json!({"jsonrpc":"2.0","id":3,"method":"native.mesh.start","params":{
            "mode":"capture","login":"james@github"
        }}),
    )
    .await;
    let resp = c.recv().await;
    assert_eq!(
        resp["error"]["data"]["kind"], "PRECONDITION_FAILED",
        "{resp}"
    );

    // and an unknown mode is a refusal, not a tolerated shape: the posture is a
    // closed enum because each arm means a different thing about the account
    c.send(
        json!({"jsonrpc":"2.0","id":4,"method":"native.mesh.start","params":{"mode":"whatever"}}),
    )
    .await;
    let resp = c.recv().await;
    assert_eq!(
        resp["error"]["data"]["kind"], "PRECONDITION_FAILED",
        "{resp}"
    );

    // nothing was recorded by any of the three
    assert!(daemon.state.mesh.mode().is_none());
    daemon.shutdown().await;
}

#[tokio::test]
async fn serve_subscribe_refused_honestly_when_mesh_down() {
    // No tailnet in CI: the node is absent, so serve.subscribe must be refused with
    // the unit's REAL state (mirror of the peers.list unavailable path) — never a
    // half-open subscription. (C3: serve.subscribe forwarder.)
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;
    c.send(json!({"jsonrpc":"2.0","id":2,"method":"native.mesh.serve.subscribe","params":{}}))
        .await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAVAILABLE");
    assert_eq!(resp["error"]["data"]["details"]["service"], "mesh-gateway");
    assert_eq!(resp["error"]["data"]["details"]["state"], "disabled");
    assert_eq!(resp["error"]["data"]["retryable"], true);
}

#[tokio::test]
async fn tolerant_reader_on_hello() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    let secret = read_secret(&daemon);
    let ts = pairing::now_epoch_secs();
    let mac = pairing::compute_mac(&secret, "b", ts);
    c.send(
        json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.hello","params":{
            "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
            "credential":{"bootId":"b","ts":ts,"mac":mac},
            "futureField":{"carried":true}
        }}),
    )
    .await;
    let resp = c.recv().await;
    assert!(
        resp["result"].is_object(),
        "unknown fields must not break hello (P3)"
    );
}

// ---- MF-2i — the route-snapshot disclosure rule, on the WIRE (QA 2026-09-13
// finding 2: the hello applied it and the subscription did not) ----

/// macOS caps a Unix socket path at ~104 bytes (`sun_path`) and the terminal
/// sockets sit three levels under the data dir, so a floor that must actually
/// SERVE roots its data dir at `/tmp` — the law tests/terminal_unit.rs states.
/// The rows above never start a terminal, which is why `boot()` can use the
/// platform temp dir; these two do.
#[cfg(unix)]
fn serving_tempdir() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("vfmf2i")
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

/// WIN-D1: named pipes carry no `sun_path` budget, so the platform temp dir is
/// the right root there.
#[cfg(windows)]
fn serving_tempdir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("vfmf2i")
        .tempdir()
        .expect("tempdir")
}

async fn routes_subscribe(client: &mut TestClient, id: u64) -> Value {
    client
        .send(json!({"jsonrpc":"2.0","id":id,
            "method":"native.lifecycle.terminal.routes.subscribe","params":{}}))
        .await;
    client.recv().await
}

// RETIRED 2026-09-14 (TM-1). This was THE regression fence for QA finding 2:
// with `FIELD_NATIVE_TERMINAL_MESH` the floor kept the pre-cell in-process
// serve, its route snapshot never left `{revision: 0, cells: []}`, and the
// hello's LEGACY `terminal` mirror was its only real reading — so when the
// routes subscription answered that unrevised snapshot unconditionally, fieldd
// resolved the empty cell list to "no endpoints" and threw the mirror away one
// message after the ack vouched for it.
//
// The FLOOR it fenced is gone (TM-D7), and with it the only shape that could
// serve at revision 0: `supervise_cells` announces the routes capability at
// revision 1 before the first cell exists, so a floor with a terminal unit is
// never unrevised for longer than a task spawn. The RULE is unchanged and
// still witnessed — `disclosed_routes`'s own rows in `mgmt/mod.rs` prove the
// withholding for both surfaces from one function, and the row below proves
// the ack and the subscription agree on a real floor, which is the
// contradiction finding 2 was actually about.
//
// The MF-1l rows that replaced it are further down: the hello now says whether
// the terminal doors are on the tailnet, which is the fact a reader wanted
// when it was reduced to inferring one from an empty cell list.

/// The other half of the same rule, so a regression cannot pass by muting the
/// surface: a floor with a REAL revision discloses it, on the subscription and
/// in the ack alike, and the two agree.
#[tokio::test]
async fn the_routes_subscription_serves_a_revised_snapshot() {
    let dir = serving_tempdir();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    // The DEFAULT floor is cell mode: wait for the first cell's hello, which is
    // what moves the revision off its initial — and then for the snapshot to
    // SETTLE. TM-1 made the class cells unconditional, so a second cell's hello
    // can land between the ack below and the subscribe after it; the row asserts
    // "one floor, one reading" about a floor that has stopped moving, not about
    // a floor mid-boot (found by the landing gate at `64c26a75` under load).
    let mut routes = daemon.state.terminal_routes.clone();
    timeout(
        Duration::from_secs(20),
        routes.wait_for(|snapshot| !snapshot.cells.is_empty()),
    )
    .await
    .expect("the terminal cell announced within its hello budget")
    .expect("the routes watch outlives boot");
    let settled = timeout(Duration::from_secs(20), async {
        loop {
            match timeout(Duration::from_millis(750), routes.changed()).await {
                Ok(Ok(())) => continue,
                Ok(Err(_)) => panic!("the routes watch outlives boot"),
                Err(_) => break,
            }
        }
    })
    .await;
    settled.expect("the route snapshot settled within its budget");

    let mut c = TestClient::connect(&daemon).await;
    let ack = c.hello(&daemon, 1).await;
    let acked = ack["result"]["terminalRoutes"].clone();
    assert!(
        acked["revision"].as_i64().is_some_and(|r| r > 0),
        "a cell floor's ack carries its revised snapshot: {acked}"
    );

    let subscribed = routes_subscribe(&mut c, 2).await;
    let mut snapshot = subscribed["result"]["snapshot"].clone();
    // E-F1 — the stream payload is the snapshot plus the floor's live
    // `terminalMesh`, so the two surfaces are compared on the ROUTE reading
    // they share and on the mesh reading separately. Both must agree: the
    // whole point of MF-2i is that the subscription cannot contradict the ack
    // one message later, and E-F1 adds a second fact under the same rule.
    assert_eq!(
        snapshot["terminalMesh"], ack["result"]["terminalMesh"],
        "the stream's mesh reading must not contradict the ack's: {subscribed}"
    );
    snapshot
        .as_object_mut()
        .expect("the snapshot is an object")
        .remove("terminalMesh");
    assert_eq!(
        snapshot, acked,
        "one floor, one reading: the subscription's route snapshot is the ack's"
    );
    assert!(
        !snapshot["cells"].as_array().expect("cells").is_empty(),
        "the cell that armed this test owes a row: {snapshot}"
    );

    daemon.shutdown().await;
}

// ---- TM-1 (MF-1l) — the hello says whether the terminal doors are on the
// tailnet, and the answer is never inferred from an empty cell list ----

/// The default floor: no flag, no gateway, doors loopback-only. The field is
/// PRESENT and false — absence means "a floor that predates the field", and a
/// floor that can answer must not be mistaken for one that cannot.
#[tokio::test]
async fn the_hello_says_the_terminal_doors_are_not_published() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    let ack = c.hello(&daemon, 1).await;

    assert_eq!(
        ack["result"]["terminalMesh"], false,
        "a floor with the flag unset publishes nothing, and says so: {ack}"
    );
    assert!(
        ack["result"].get("terminalMesh").is_some(),
        "the field must be PRESENT — absence is reserved for a floor predating it: {ack}"
    );

    daemon.shutdown().await;
}

/// The FALSE-POSITIVE direction, which is the whole reason the field exists:
/// the flag is a request, and a request over a gateway that never came up
/// publishes nothing. A publisher gating on the flag alone would announce this
/// floor's sessions as reachable when no tailnet node exists to reach them.
///
/// The floor is a floor throughout — the flag costs it nothing (TM-D7), which
/// the serving row in `terminal_unit.rs` proves against real cells.
#[tokio::test]
async fn a_flagged_floor_without_a_gateway_says_the_doors_are_not_published() {
    let dir = serving_tempdir();
    let config = NativeConfig {
        terminal_mesh_enabled: true,
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    assert!(!config.mesh_enabled, "the gateway is off in this scenario");
    let daemon = bootstrap(config).await.expect("bootstrap");

    let mut c = TestClient::connect(&daemon).await;
    let ack = c.hello(&daemon, 1).await;
    assert_eq!(
        ack["result"]["terminalMesh"], false,
        "asked is not achieved: with no node there is nothing on the tailnet: {ack}"
    );

    daemon.shutdown().await;
}

/// E-F1 — and the reading the two rows above pin is taken at a moment it is
/// predictably wrong, which is what this row is about.
///
/// `HelloAck.terminalMesh` is written ONCE per pairing. The mesh node is
/// installed by a spawned bring-up task that RETURNS BEFORE THE NODE EXISTS
/// (`services/mesh.rs` — `send_replace(Some(node))` happens inside the task),
/// while the mgmt listener binds immediately after `start_all` and fieldd
/// hellos the instant the socket answers. tsnet bring-up takes seconds. So on
/// a cold boot with both flags set the ack says FALSE, correctly, and then
/// nothing ever corrects it: the ack is the only writer and nothing re-hellos.
/// fieldd declares no route, the field's `terminal` joins are withheld, and
/// `terminal.openTicket` refuses `doors_not_published` on a floor whose doors
/// came up two seconds after the pairing.
///
/// So the floor PUSHES the correction on the stream fieldd already reads. What
/// this row proves end to end: the hello's false, a subscribe that agrees with
/// it, then a node arriving, and a routes DELTA carrying `terminalMesh: true`
/// at the SAME revision — with no second hello anywhere in the transcript.
///
/// WHAT IT DOES NOT PROVE, stated because it bounds the claim: that tsnet
/// bring-up itself flips the watch. A tailnet node cannot be built headlessly
/// (`MeshUnit::start` drives an interactive browser login), so the node half is
/// moved through `force_node_presence_for_tests` — the seam's own doc says the
/// same. Everything downstream of the watch is real: the composition, the
/// forwarder's wake, the dedupe, the wire bytes. The live witness for a real
/// node moving it is a hardware run.
#[tokio::test]
async fn a_node_arriving_after_the_hello_is_pushed_on_the_routes_stream() {
    let dir = serving_tempdir();
    let config = NativeConfig {
        terminal_mesh_enabled: true,
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.expect("bootstrap");
    // A revision must exist before the stream can say anything at all: an
    // unrevised snapshot is withheld on BOTH surfaces (`disclosed_routes`), and
    // a payload that is never sent carries no boolean either.
    let mut routes = daemon.state.terminal_routes.clone();
    timeout(
        Duration::from_secs(20),
        routes.wait_for(|snapshot| snapshot.revision > 0),
    )
    .await
    .expect("the floor announced its routes capability within its budget")
    .expect("the routes watch outlives boot");

    let mut c = TestClient::connect(&daemon).await;
    let ack = c.hello(&daemon, 1).await;
    assert_eq!(
        ack["result"]["terminalMesh"], false,
        "the hello is answered before any node exists, and says so: {ack}"
    );

    let subscribed = routes_subscribe(&mut c, 2).await;
    let snapshot = subscribed["result"]["snapshot"].clone();
    assert_eq!(
        snapshot["terminalMesh"], false,
        "the subscribe result must not contradict the ack that preceded it: {subscribed}"
    );
    let revision_at_subscribe = snapshot["revision"]
        .as_i64()
        .expect("a disclosed snapshot has a revision");

    // THE NODE ARRIVES — seconds after the hello, exactly as a real bring-up does.
    daemon.state.mesh.force_node_presence_for_tests(true);

    // The push, on the stream this client already holds. Route deltas may also
    // be in flight (a second class cell announcing), so read until one carries
    // the flip rather than demanding it be the very next line — every line is
    // still checked for a second hello.
    let delta = timeout(Duration::from_secs(20), async {
        loop {
            let note = c.recv().await;
            assert_ne!(
                note["method"], "native.lifecycle.hello",
                "the correction must ride the stream, never a re-pair: {note}"
            );
            if note["method"] == "native.lifecycle.terminal.routes.delta"
                && note["params"]["payload"]["terminalMesh"] == true
            {
                return note;
            }
        }
    })
    .await
    .expect("the node flip reached the routes stream");

    let payload = &delta["params"]["payload"];
    assert_eq!(
        payload["terminalMesh"], true,
        "the floor's doors are published now, and the stream says so: {delta}"
    );
    assert_eq!(
        payload["revision"].as_i64(),
        Some(revision_at_subscribe),
        "a node flip changes no ROUTE state — the revision orders routes, and \
         moving it to announce a different fact would make it mean two things: {delta}"
    );
    assert!(
        payload["cells"].is_array(),
        "the push carries the unchanged snapshot, not a bare boolean: {delta}"
    );

    daemon.shutdown().await;
}

/// E-F1's other half: a node flip that does NOT move the reading sends nothing.
///
/// The flag is the reason — `MeshPlan::publishes` is an AND, so on a floor that
/// was never asked to publish, a node coming up is still "not published". A
/// forwarder that woke on the watch and emitted regardless would send a delta
/// that says nothing changed, which is how a stream teaches its reader to
/// ignore it.
///
/// ASSERTED AGAINST THE REVISION, not against silence. A real floor's cells
/// announce on their own schedule (TM-1 made both class cells unconditional),
/// so genuine route deltas can land at any moment in this window and a
/// "nothing arrives" row would be a lottery ticket — it failed exactly that way
/// while being written. A node-driven emission is identifiable instead: it
/// repeats the revision, because a node flip changes no route state. So every
/// delta in the window must carry a MOVED revision (route-driven) and
/// `terminalMesh: false` (the AND holding).
#[tokio::test]
async fn a_node_on_an_unflagged_floor_pushes_nothing() {
    let dir = serving_tempdir();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    let mut routes = daemon.state.terminal_routes.clone();
    timeout(
        Duration::from_secs(20),
        routes.wait_for(|snapshot| snapshot.revision > 0),
    )
    .await
    .expect("the floor announced its routes capability within its budget")
    .expect("the routes watch outlives boot");

    let mut c = TestClient::connect(&daemon).await;
    let ack = c.hello(&daemon, 1).await;
    assert_eq!(ack["result"]["terminalMesh"], false, "{ack}");
    let subscribed = routes_subscribe(&mut c, 2).await;
    assert_eq!(subscribed["result"]["snapshot"]["terminalMesh"], false);
    let revision_at_subscribe = subscribed["result"]["snapshot"]["revision"]
        .as_i64()
        .expect("a disclosed snapshot has a revision");

    daemon.state.mesh.force_node_presence_for_tests(true);

    // PIN THE PRECONDITION the other way round: the watch really did move, so a
    // stream that stays quiet here is the dedupe working and not a seam that
    // does nothing.
    assert!(
        daemon.state.mesh.node_present(),
        "the seam must actually move the fact, or this row proves nothing"
    );
    assert!(
        !daemon.state.terminal_mesh_published(),
        "a node without the flag is still not published — that is the AND"
    );

    let mut highest = revision_at_subscribe;
    loop {
        let Ok(note) = timeout(Duration::from_secs(2), c.recv()).await else {
            break; // the window closed with nothing further — the ordinary case
        };
        assert_eq!(
            note["method"], "native.lifecycle.terminal.routes.delta",
            "nothing but routes rides this subscription: {note}"
        );
        let payload = &note["params"]["payload"];
        assert_eq!(
            payload["terminalMesh"], false,
            "the flag was never set, so no reading can say published: {note}"
        );
        let revision = payload["revision"]
            .as_i64()
            .expect("a delta has a revision");
        assert!(
            revision > highest,
            "a delta that repeats the revision is a NODE-driven emission, and a \
             node flip that moves no reading must send nothing (was {highest}): {note}"
        );
        highest = revision;
    }

    daemon.shutdown().await;
}

// ---- WP12 L2b (build-wp12-updater.md §9 R2/R3): the restart intent and the floor's self-stop ----------------------

async fn boot_in(dir: &tempfile::TempDir) -> RunningDaemon {
    bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap")
}

fn intent_file(dir: &tempfile::TempDir) -> std::path::PathBuf {
    NativeConfig::for_data_dir(dir.path().to_path_buf()).restart_intent_file()
}

#[tokio::test]
async fn a_planned_stop_is_recorded_and_the_next_boot_says_so_once() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_in(&dir).await;
    let mut c = TestClient::connect(&daemon).await;
    let ack = c.hello(&daemon, 1).await;
    assert_eq!(
        ack["result"]["lastExit"], "unplanned",
        "a first boot recorded no intent: {ack}"
    );

    c.send(
        json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.prepareRestart",
        "params":{"reason":"update","toVersion":"0.9.0+2490459"}}),
    )
    .await;
    let prepared = c.recv().await;
    assert_eq!(prepared["result"]["recorded"], true, "{prepared}");
    assert!(
        intent_file(&dir).exists(),
        "the intent is on disk before the stop"
    );

    c.send(
        json!({"jsonrpc":"2.0","id":3,"method":"native.lifecycle.shutdown",
        "params":{"reason":"update"}}),
    )
    .await;
    let stopping = c.recv().await;
    assert_eq!(stopping["result"]["stopping"], true, "{stopping}");
    // main's third arm: the request reaches the ONE drain
    timeout(
        Duration::from_secs(2),
        daemon.state.restart.shutdown_requested(),
    )
    .await
    .expect("the paired client's shutdown wakes main's third arm");
    daemon.shutdown().await;

    let next = boot_in(&dir).await;
    let mut c = TestClient::connect(&next).await;
    assert_eq!(c.hello(&next, 1).await["result"]["lastExit"], "planned");
    assert!(!intent_file(&dir).exists(), "the boot TOOK the intent");
    next.shutdown().await;

    let after = boot_in(&dir).await;
    let mut c = TestClient::connect(&after).await;
    assert_eq!(
        c.hello(&after, 1).await["result"]["lastExit"],
        "unplanned",
        "an intent describes ONE stop"
    );
    after.shutdown().await;
}

#[tokio::test]
async fn a_superseded_client_can_neither_record_an_intent_nor_stop_the_floor() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_in(&dir).await;
    let mut stale = TestClient::connect(&daemon).await;
    assert!(stale.hello(&daemon, 1).await["result"].is_object());
    let mut current = TestClient::connect(&daemon).await;
    assert!(current.hello(&daemon, 1).await["result"].is_object());
    assert_eq!(stale.recv().await["method"], "native.lifecycle.superseded");

    // The stale connection's reader loop still runs (its write half is what closed), so its requests reach the
    // per-request single-client guard — the verbs' ONLY authorization — and are refused before any effect.
    for (id, method, params) in [
        (
            2,
            "native.lifecycle.prepareRestart",
            json!({"reason":"update"}),
        ),
        (3, "native.lifecycle.shutdown", json!({"reason":"update"})),
    ] {
        let mut line = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string();
        line.push('\n');
        let _ = stale.writer.write_all(line.as_bytes()).await;
    }
    assert!(
        timeout(
            Duration::from_millis(400),
            daemon.state.restart.shutdown_requested()
        )
        .await
        .is_err(),
        "a superseded client stopped the floor"
    );
    assert!(
        !intent_file(&dir).exists(),
        "a superseded client recorded an intent"
    );

    // the current client is untouched by any of it
    current
        .send(json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.ping","params":{}}))
        .await;
    assert!(current.recv().await["result"]["bootId"].is_string());
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_malformed_restart_request_is_refused_and_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_in(&dir).await;
    let mut c = TestClient::connect(&daemon).await;
    assert!(c.hello(&daemon, 1).await["result"].is_object());
    for (id, method) in [
        (2, "native.lifecycle.prepareRestart"),
        (3, "native.lifecycle.shutdown"),
    ] {
        c.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":{"reason":"whim"}}))
            .await;
        let refused = c.recv().await;
        assert_eq!(
            refused["error"]["data"]["kind"], "PRECONDITION_FAILED",
            "{method}: {refused}"
        );
    }
    assert!(!intent_file(&dir).exists());
    assert!(timeout(
        Duration::from_millis(300),
        daemon.state.restart.shutdown_requested()
    )
    .await
    .is_err());
    daemon.shutdown().await;
}

/// The reply to request `id`, and the notifications that came before it.
async fn reply(c: &mut TestClient, id: u64) -> (Value, Vec<Value>) {
    let mut notes = Vec::new();
    loop {
        let line = c.recv().await;
        if line["id"] == json!(id) {
            return (line, notes);
        }
        notes.push(line);
    }
}

/// F1 — the four `native.freeway.*` arms answer on the paired channel. A declaration the contract
/// refuses is PRECONDITION_FAILED, never quoting its text (its doors carry secrets); a valid one is
/// `{}`, and the state subscription's deltas show the host come up on it; a revoke with no phone
/// link answers `{closed: 0}`; the joins subscription answers its first frame.
#[tokio::test]
async fn the_freeway_arms_answer_on_the_paired_channel() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;
    let subscribe =
        json!({"jsonrpc":"2.0","id":2,"method":"native.freeway.state.subscribe","params":{}});
    c.send(subscribe).await;
    let (subscribed, _) = reply(&mut c, 2).await;
    assert_eq!(
        subscribed["result"]["snapshot"]["up"],
        json!(false),
        "{subscribed}"
    );

    let doors = json!({ "product": "ws://127.0.0.1:1/fw/a-secret-never-said" });
    let exposure = json!({ "terminals": true });
    let window = json!([{ "deviceId": "dev-b", "role": "window" }]);
    let refused =
        json!({ "deviceId": "dev-a", "admit": window, "doors": doors, "exposure": exposure });
    c.send(json!({"jsonrpc":"2.0","id":3,"method":"native.freeway.declare","params": refused}))
        .await;
    let (refused, _) = reply(&mut c, 3).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "PRECONDITION_FAILED",
        "{refused}"
    );
    assert!(
        !refused.to_string().contains("a-secret-never-said"),
        "{refused}"
    );

    let admitted = json!([{ "deviceId": "dev-b", "role": "phone" }]);
    let declared =
        json!({ "deviceId": "dev-a", "admit": admitted, "doors": doors, "exposure": exposure });
    c.send(json!({"jsonrpc":"2.0","id":4,"method":"native.freeway.declare","params": declared}))
        .await;
    let (accepted, mut notes) = reply(&mut c, 4).await;
    assert_eq!(accepted["result"], json!({}), "{accepted}");
    while !notes
        .iter()
        .any(|note| note["params"]["payload"]["up"] == json!(true))
    {
        let note = c.recv().await;
        assert_eq!(note["method"], "native.freeway.state.delta", "{note}");
        notes.push(note);
    }

    let revoke = json!({"jsonrpc":"2.0","id":5,"method":"native.freeway.revoke","params":{}});
    c.send(revoke).await;
    let (revoked, _) = reply(&mut c, 5).await;
    assert_eq!(revoked["result"], json!({ "closed": 0 }), "{revoked}");

    let joins =
        json!({"jsonrpc":"2.0","id":6,"method":"native.freeway.joins.subscribe","params":{}});
    c.send(joins).await;
    let (joins, _) = reply(&mut c, 6).await;
    assert_eq!(
        joins["result"]["snapshot"],
        json!({ "floorBootId": daemon.boot_id, "rows": [], "dropped": 0 }),
        "{joins}"
    );

    // fieldd's acknowledgment of what it audited; a malformed one names its class alone
    let ack =
        json!({"jsonrpc":"2.0","id":7,"method":"native.freeway.joins.ack","params":{"through":3}});
    c.send(ack).await;
    let (acked, _) = reply(&mut c, 7).await;
    assert_eq!(acked["result"], json!({}), "{acked}");
    let bad = json!({"jsonrpc":"2.0","id":8,"method":"native.freeway.joins.ack","params":{"through":"x"}});
    c.send(bad).await;
    let (refused, _) = reply(&mut c, 8).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "PRECONDITION_FAILED",
        "{refused}"
    );
    daemon.shutdown().await;
}
