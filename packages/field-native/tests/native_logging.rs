//! LOG-L2 production-path proof: the real field-native binary owns its stream,
//! serves its bounded ring over authenticated mgmt, survives fieldd-link death,
//! accepts a replacement fieldd, and drains on SIGTERM.

#![cfg(unix)]

use field_native::contracts::{DiagnosticLogDeltaV1, DiagnosticLogSnapshotV1};
use field_native::pairing;
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::timeout;

struct NativeProcess {
    child: Option<Child>,
}

impl NativeProcess {
    fn spawn(data_dir: &Path, log_root: &Path, sidecar: &Path) -> Self {
        let child = Command::new(env!("CARGO_BIN_EXE_field-native"))
            .env("FIELD_NATIVE_DATA_DIR", data_dir)
            .env("FIELD_LOG_DIR", log_root)
            .env("FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE", "1")
            .env_remove("FIELD_NATIVE_ALLOW_LOG_FILTER")
            .env_remove("FIELD_NATIVE_LOG_FILTER")
            .env("FIELD_NATIVE_MESH", "1")
            .env("FIELD_NATIVE_SIDECAR_PATH", sidecar)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn field-native");
        Self { child: Some(child) }
    }

    fn id(&self) -> u32 {
        self.child.as_ref().expect("child available").id()
    }

    fn is_running(&mut self) -> bool {
        self.child
            .as_mut()
            .expect("child available")
            .try_wait()
            .expect("query child")
            .is_none()
    }

    async fn terminate(mut self) -> Output {
        // SIGTERM exercises the production shutdown handler and bounded writer
        // guard rather than Child::kill's abrupt SIGKILL.
        // SAFETY: this PID belongs to the child retained by this fixture.
        assert_eq!(
            unsafe { libc::kill(self.id() as libc::pid_t, libc::SIGTERM) },
            0
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.is_running() {
            assert!(Instant::now() < deadline, "field-native ignored SIGTERM");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.child
            .take()
            .expect("child available")
            .wait_with_output()
            .expect("collect field-native output")
    }
}

impl Drop for NativeProcess {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

struct TestClient {
    reader: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    writer: tokio::net::unix::OwnedWriteHalf,
}

impl TestClient {
    async fn connect(path: &Path) -> Self {
        let stream = UnixStream::connect(path).await.expect("connect mgmt");
        let (read, write) = stream.into_split();
        Self {
            reader: BufReader::new(read).lines(),
            writer: write,
        }
    }

    async fn send(&mut self, value: Value) {
        self.writer
            .write_all(format!("{value}\n").as_bytes())
            .await
            .expect("write mgmt");
    }

    async fn receive(&mut self) -> Value {
        let line = timeout(Duration::from_secs(5), self.reader.next_line())
            .await
            .expect("mgmt response timeout")
            .expect("mgmt response read")
            .expect("mgmt connection closed");
        serde_json::from_str(&line).expect("mgmt response json")
    }

    async fn hello(&mut self, data_dir: &Path, id: u64) {
        let secret_hex = fs::read_to_string(data_dir.join("native/pairing")).unwrap();
        let secret = hex::decode(secret_hex.trim()).unwrap();
        let boot_id = format!("fieldd-client-{id}");
        let timestamp = pairing::now_epoch_secs();
        let mac = pairing::compute_mac(&secret, &boot_id, timestamp);
        self.send(json!({
            "jsonrpc":"2.0",
            "id":id,
            "method":"native.lifecycle.hello",
            "params":{
                "contractsVersion":"0.1.0",
                "minCompatible":"0.1.0",
                "clientKind":"fieldd",
                "credential":{"bootId":boot_id,"ts":timestamp,"mac":mac}
            }
        }))
        .await;
        assert!(self.receive().await["result"].is_object());
    }
}

async fn wait_for_native(data_dir: &Path, process: &mut NativeProcess) -> PathBuf {
    let socket = data_dir.join("native/run/mgmt.sock");
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(process.is_running(), "field-native exited before readiness");
        if socket.exists()
            && data_dir.join("native/pairing").exists()
            && UnixStream::connect(&socket).await.is_ok()
        {
            return socket;
        }
        assert!(Instant::now() < deadline, "field-native did not bind mgmt");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn diagnostic_query() -> Value {
    json!({
        "sources":["system/field-native"],
        "minLevel":"info",
        "limit":1000
    })
}

async fn wait_for_diagnostic_event(client: &mut TestClient, request_id: u64, event: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        client
            .send(json!({
                "jsonrpc":"2.0",
                "id":request_id,
                "method":"native.diagnostics.query",
                "params":diagnostic_query()
            }))
            .await;
        let response = client.receive().await;
        if response["result"]["records"]
            .as_array()
            .is_some_and(|records| records.iter().any(|record| record["event"] == event))
        {
            return response;
        }
        assert!(
            Instant::now() < deadline,
            "diagnostic event {event} did not arrive: {response}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn fieldd_link_death_does_not_stop_native_evidence_or_diagnostics() {
    let fixture = tempfile::tempdir().unwrap();
    let data_dir = fixture.path().join("data");
    let log_root = fixture.path().join("logs");
    let sidecar = fixture.path().join("sidecar-slim");
    let sidecar_secret = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456";
    fs::write(
        &sidecar,
        format!("#!/bin/sh\nprintf '%s\\n' 'probe Bearer {sidecar_secret}' >&2\nexit 1\n"),
    )
    .unwrap();
    fs::set_permissions(&sidecar, fs::Permissions::from_mode(0o700)).unwrap();
    let mut process = NativeProcess::spawn(&data_dir, &log_root, &sidecar);
    let socket = wait_for_native(&data_dir, &mut process).await;

    let mut first = TestClient::connect(&socket).await;
    first.hello(&data_dir, 1).await;
    let query_response =
        wait_for_diagnostic_event(&mut first, 2, "field_native.sidecar.stderr").await;
    let snapshot: DiagnosticLogSnapshotV1 =
        serde_json::from_value(query_response["result"].clone()).unwrap();
    assert!(!snapshot.records.is_empty());
    assert_eq!(
        query_response["result"]["producers"][0]["health"]["writerState"],
        "healthy"
    );
    assert!(query_response["result"]["records"]
        .as_array()
        .unwrap()
        .iter()
        .any(|record| record["event"] == "field_native.lifecycle.boot_started"));

    first
        .send(json!({
            "jsonrpc":"2.0",
            "id":3,
            "method":"native.diagnostics.subscribe",
            "params":diagnostic_query()
        }))
        .await;
    let subscription = first.receive().await;
    assert!(subscription["result"]["snapshot"].is_object());

    first
        .send(json!({
            "jsonrpc":"2.0",
            "id":4,
            "method":"native.lifecycle.desired.set",
            "params":{"generation":7,"terminals":[],"workers":[]}
        }))
        .await;
    assert_eq!(first.receive().await["result"]["applied"], 7);
    let delta_note = first.receive().await;
    assert_eq!(delta_note["method"], "native.diagnostics.delta");
    let delta: DiagnosticLogDeltaV1 =
        serde_json::from_value(delta_note["params"]["payload"].clone()).unwrap();
    assert!(delta_note["params"]["payload"]["records"]
        .as_array()
        .unwrap()
        .iter()
        .any(|record| record["event"] == "field_native.lifecycle.desired_applied"));
    assert!(!delta.records.is_empty());

    // This socket is the fieldd lifetime boundary. Its death must not own or
    // close the native writer.
    drop(first);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(process.is_running());

    let mut replacement = TestClient::connect(&socket).await;
    replacement.hello(&data_dir, 10).await;
    replacement
        .send(json!({
            "jsonrpc":"2.0",
            "id":11,
            "method":"native.diagnostics.query",
            "params":diagnostic_query()
        }))
        .await;
    let after_death = replacement.receive().await;
    let authenticated = after_death["result"]["records"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|record| record["event"] == "field_native.mgmt.client_authenticated")
        .count();
    assert!(
        authenticated >= 2,
        "the replacement fieldd event must land after the first link dies"
    );
    drop(replacement);

    let output = process.terminate().await;
    assert!(output.status.success());
    assert!(
        output.stdout.is_empty(),
        "field-native has no stdout logging protocol"
    );
    assert!(
        output.stderr.is_empty(),
        "healthy production logging keeps the emergency path quiet: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let active = log_root.join("system/field-native.ndjson");
    let raw = fs::read_to_string(&active).unwrap();
    let records: Vec<Value> = raw
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(records
        .iter()
        .any(|record| record["event"] == "field_native.lifecycle.stopped"));
    let sidecar_record = records
        .iter()
        .find(|record| record["event"] == "field_native.sidecar.stderr")
        .unwrap_or_else(|| {
            panic!("sidecar stderr must enter field-native's owned structured stream: {raw}")
        });
    assert_eq!(sidecar_record["attrs"]["raw"], true);
    assert_eq!(
        sidecar_record["attrs"]["raw_line"],
        "probe Bearer <redacted>"
    );
    assert!(!raw.contains(sidecar_secret));
    let pairing_secret = fs::read_to_string(data_dir.join("native/pairing")).unwrap();
    assert!(!raw.contains(pairing_secret.trim()));
    assert_eq!(
        fs::metadata(&log_root).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(active).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
