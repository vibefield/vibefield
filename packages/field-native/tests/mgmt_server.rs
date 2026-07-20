//! Kill-matrix seeds for the mgmt channel (design-02 §7): pairing, hello gate,
//! single-client SUPERSEDED takeover, generation guard, subscriptions, honest stubs.
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::timeout;

struct TestClient {
    reader: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    writer: tokio::net::unix::OwnedWriteHalf,
}

impl TestClient {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = UnixStream::connect(&daemon.mgmt_socket).await.expect("connect mgmt");
        let (r, w) = stream.into_split();
        Self { reader: BufReader::new(r).lines(), writer: w }
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
        self.send(json!({"jsonrpc":"2.0","id":id,"method":"native.lifecycle.hello","params":{
            "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"field-native",
            "credential":{"bootId":boot,"ts":ts,"mac":mac}
        }}))
        .await;
        self.recv().await
    }
}

fn read_secret(daemon: &RunningDaemon) -> Vec<u8> {
    // tests derive macs the way fieldd will: from the shared 0600 pairing file
    let path = daemon.mgmt_socket.parent().unwrap().parent().unwrap().join("pairing");
    hex::decode(std::fs::read_to_string(path).unwrap().trim()).unwrap()
}

async fn boot() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig { data_dir: dir.path().to_path_buf() })
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
    let mac = pairing::compute_mac(&secret, v["bootId"].as_str().unwrap(), v["ts"].as_i64().unwrap());
    assert_eq!(mac, v["mac"].as_str().unwrap(), "D8 MAC recipe drifted from the TS side");
}

#[tokio::test]
async fn hello_pairs_and_acks() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    let resp = c.hello(&daemon, 1).await;
    assert_eq!(resp["result"]["serverKind"], "field-native");
    assert_eq!(resp["result"]["contractsVersion"], "0.1.0");
}

#[tokio::test]
async fn bad_mac_and_stale_ts_rejected() {
    let (_dir, daemon) = boot().await;

    let mut c = TestClient::connect(&daemon).await;
    c.send(json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.hello","params":{
        "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"field-native",
        "credential":{"bootId":"x","ts": pairing::now_epoch_secs(),"mac":"deadbeef"}
    }})).await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAUTHORIZED");

    let mut c2 = TestClient::connect(&daemon).await;
    let secret = read_secret(&daemon);
    let stale = pairing::now_epoch_secs() - 3600;
    let mac = pairing::compute_mac(&secret, "x", stale);
    c2.send(json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.hello","params":{
        "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"field-native",
        "credential":{"bootId":"x","ts": stale,"mac": mac}
    }})).await;
    let resp = c2.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAUTHORIZED", "outside ±300s window");
}

#[tokio::test]
async fn hello_required_before_anything() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.send(json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.health.subscribe","params":{}})).await;
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
    assert!(c1.recv_eof().await, "old connection must be closed after SUPERSEDED");

    // the new client is fully functional
    c2.send(json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.health.subscribe","params":{}})).await;
    let resp = c2.recv().await;
    assert!(resp["result"]["snapshot"]["units"].is_array());
}

#[tokio::test]
async fn health_snapshot_reports_stub_units() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;
    c.send(json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.health.subscribe","params":{}})).await;
    let resp = c.recv().await;
    let units = resp["result"]["snapshot"]["units"].as_array().unwrap();
    let names: Vec<&str> = units.iter().map(|u| u["unit"].as_str().unwrap()).collect();
    assert!(names.contains(&"mgmt") && names.contains(&"terminal") && names.contains(&"mesh-gateway"));
    assert_eq!(resp["result"]["snapshot"]["state"], "up");
}

#[tokio::test]
async fn desired_generation_guard_and_observed_delta() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;

    c.send(json!({"jsonrpc":"2.0","id":2,"method":"native.lifecycle.observed.subscribe","params":{}})).await;
    let sub = c.recv().await;
    assert_eq!(sub["result"]["snapshot"]["generation"], 0);

    c.send(json!({"jsonrpc":"2.0","id":3,"method":"native.lifecycle.desired.set","params":{
        "generation":5,"terminals":[{"sessionId":"a"}],"workers":[]
    }})).await;
    // arrival order of ack vs delta is not guaranteed — collect both
    let (a, b) = (c.recv().await, c.recv().await);
    let (ack, delta) = if a.get("id").is_some_and(|i| i == 3) { (a, b) } else { (b, a) };
    assert_eq!(ack["result"]["applied"], 5);
    assert_eq!(delta["method"], "native.lifecycle.observed.delta");
    assert_eq!(delta["params"]["payload"]["generation"], 5);

    c.send(json!({"jsonrpc":"2.0","id":4,"method":"native.lifecycle.desired.set","params":{
        "generation":4,"terminals":[],"workers":[]
    }})).await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "PRECONDITION_FAILED");
}

#[tokio::test]
async fn mesh_stub_answers_honest_unavailable() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    c.hello(&daemon, 1).await;
    c.send(json!({"jsonrpc":"2.0","id":2,"method":"native.mesh.peers.list","params":{}})).await;
    let resp = c.recv().await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAVAILABLE");
    assert_eq!(resp["error"]["data"]["details"]["service"], "mesh-gateway");
    assert_eq!(resp["error"]["data"]["retryable"], true);
}

#[tokio::test]
async fn tolerant_reader_on_hello() {
    let (_dir, daemon) = boot().await;
    let mut c = TestClient::connect(&daemon).await;
    let secret = read_secret(&daemon);
    let ts = pairing::now_epoch_secs();
    let mac = pairing::compute_mac(&secret, "b", ts);
    c.send(json!({"jsonrpc":"2.0","id":1,"method":"native.lifecycle.hello","params":{
        "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"field-native",
        "credential":{"bootId":"b","ts":ts,"mac":mac},
        "futureField":{"carried":true}
    }})).await;
    let resp = c.recv().await;
    assert!(resp["result"].is_object(), "unknown fields must not break hello (P3)");
}
