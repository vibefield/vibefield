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
    // what moves the revision off its initial.
    let mut routes = daemon.state.terminal_routes.clone();
    timeout(
        Duration::from_secs(20),
        routes.wait_for(|snapshot| !snapshot.cells.is_empty()),
    )
    .await
    .expect("the terminal cell announced within its hello budget")
    .expect("the routes watch outlives boot");

    let mut c = TestClient::connect(&daemon).await;
    let ack = c.hello(&daemon, 1).await;
    let acked = ack["result"]["terminalRoutes"].clone();
    assert!(
        acked["revision"].as_i64().is_some_and(|r| r > 0),
        "a cell floor's ack carries its revised snapshot: {acked}"
    );

    let subscribed = routes_subscribe(&mut c, 2).await;
    let snapshot = subscribed["result"]["snapshot"].clone();
    assert_eq!(
        snapshot, acked,
        "one floor, one reading: the subscription's snapshot is the ack's"
    );
    assert!(
        !snapshot["cells"].as_array().expect("cells").is_empty(),
        "the cell that armed this test owes a row: {snapshot}"
    );

    daemon.shutdown().await;
}

// ---- MF-2a — the mirror-write capability's one hop (GM-D5, §10.2) ----

/// Boot a floor with a config of the caller's making (the `boot()` helper's
/// default is the view-only floor; these rows need the other two shapes).
async fn boot_with(config: NativeConfig) -> (tempfile::TempDir, RunningDaemon, NativeConfig) {
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        data_dir: dir.path().to_path_buf(),
        ..config
    };
    let daemon = bootstrap(config.clone()).await.expect("bootstrap");
    (dir, daemon, config)
}

async fn mirror_write_capability(daemon: &RunningDaemon, client: &mut TestClient) -> Value {
    client
        .send(json!({"jsonrpc":"2.0","id":7,"method":"native.terminal.mirrorWriteCapability","params":{}}))
        .await;
    let _ = daemon;
    client.recv().await
}

/// The default floor holds nothing, and says so: `configured: false` with no
/// `capability` key at all. This is what fieldd turns into UNAVAILABLE
/// {service: "terminal", state: "no-mirror-write"}.
#[tokio::test]
async fn the_view_only_floor_answers_that_nothing_is_configured() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;

    // EL7 first: the capability is behind the SAME pairing gate as every other
    // mutating surface — an unpaired local process cannot ask for it.
    let unauthed = mirror_write_capability(&daemon, &mut c).await;
    assert_eq!(unauthed["error"]["data"]["kind"], "UNAUTHORIZED");

    c.hello(&daemon, 1).await;
    let resp = mirror_write_capability(&daemon, &mut c).await;
    assert_eq!(resp["result"]["configured"], false);
    assert!(
        resp["result"].get("capability").is_none(),
        "a view-only floor must not carry a capability key at all: {resp}"
    );

    daemon.shutdown().await;
}

/// The exported capability reaches the paired client verbatim — this is the
/// hop that replaces the string a human types into the phone.
#[tokio::test]
async fn the_exported_capability_reaches_the_paired_client_verbatim() {
    const CAPABILITY: &str = "vf-mf2a-exported-canary";
    let (_dir, daemon, config) = boot_with(NativeConfig {
        terminal_mesh_enabled: true,
        terminal_mirror_write: Some(CAPABILITY.into()),
        ..NativeConfig::for_data_dir(std::path::PathBuf::from("/unset"))
    })
    .await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;

    let resp = mirror_write_capability(&daemon, &mut c).await;
    assert_eq!(resp["result"]["configured"], true);
    assert_eq!(resp["result"]["capability"], CAPABILITY);

    // The env's value is the env's to rotate: an exported capability leaves no
    // file behind (config.rs's law, asserted here through a REAL boot).
    assert!(!config.terminal_mirror_write_file().exists());
    // And the boot published no trace of it.
    let health = serde_json::to_value(&*daemon.state.health_tx.borrow()).expect("health json");
    assert!(
        !health.to_string().contains(CAPABILITY),
        "the capability must never reach a health snapshot: {health}"
    );

    daemon.shutdown().await;
}

/// The MF-2a claim end to end: terminal mesh on, nothing exported, and the
/// floor still has a capability to grant — minted at boot, 0600 on disk, the
/// same string the paired client is answered with.
#[tokio::test]
async fn a_serving_floor_mints_a_capability_the_paired_client_can_be_granted() {
    let (_dir, daemon, config) = boot_with(NativeConfig {
        terminal_mesh_enabled: true,
        ..NativeConfig::for_data_dir(std::path::PathBuf::from("/unset"))
    })
    .await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;

    let resp = mirror_write_capability(&daemon, &mut c).await;
    assert_eq!(resp["result"]["configured"], true);
    let capability = resp["result"]["capability"]
        .as_str()
        .unwrap_or_else(|| panic!("a serving floor owes a capability: {resp}"))
        .to_owned();
    assert_eq!(capability.len(), 64, "32 random bytes as hex: {capability}");

    let file = config.terminal_mirror_write_file();
    assert_eq!(
        std::fs::read_to_string(&file)
            .expect("the minted key file")
            .trim(),
        capability,
        "the answer must be the persisted capability, not a per-call string"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&file).expect("stat").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "the capability is a secret on disk");
    }

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
