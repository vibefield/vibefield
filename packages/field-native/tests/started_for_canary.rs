//! OB custody — NO LOG LINE OF THE FLOOR, AT ANY LEVEL, SAYS AN ENTRY'S VALUES
//! ("never logged by value: counts only, at every level").
//!
//! An entry names a run, a spark and a helper root, and the floor's log stream is passed on by fieldd's diagnostics.
//! This row plants a string in each of them and reads everything the floor's code says while the verb is refused,
//! kept, replaced, cleared and handed on in two hello acks.
//!
//! What it reads is every `tracing` event of this process at TRACE, as it is emitted: before the floor's own log
//! filter, which keeps INFO and above in production, and before the redaction its writer applies. So the row cannot
//! be made green by either. That is why it is a file of its own: the subscriber is the process's one global, set
//! before any floor boots, and no other row may share the process.
#![cfg(unix)]

use field_native::contracts::ObservedTerminal;
use field_native::local_ipc;
use field_native::services::door::peer::process_facts;
use field_native::{bootstrap, bootstrap_handed, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout_at, Instant};

const VERB: &str = "native.terminal.startedFor.set";
/// The secret the sealed floor of this row is handed: one byte repeated, nobody's.
const HANDED: [u8; 32] = [0x5a; 32];

/// The planted strings. Each is a value its field takes: a run and a root are any 1 to 128 characters, and the
/// spark's is in the shape of a spark's id.
const RUN: &str = "canary-run-9f2c41d7";
const SPARK: &str = "sp-canary9f2c41d7";
const ROOT: &str = "canary-root-9f2c41d7";
const CANARIES: [&str; 3] = [RUN, SPARK, ROOT];

/// Everything this process's code says through `tracing`, in the order it was said.
#[derive(Clone, Default)]
struct Said(Arc<Mutex<Vec<u8>>>);

impl Write for Said {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Said {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }
}

/// The secret this floor pairs under: its file's where it made one, else the one it was handed.
fn secret(daemon: &RunningDaemon) -> Vec<u8> {
    match std::fs::read_to_string(&daemon.pairing_file) {
        Ok(raw) => hex::decode(raw.trim()).expect("hex"),
        Err(_) => HANDED.to_vec(),
    }
}

/// The floor's inventory becomes two running panes, `pane-a` and `pane-b`, each rooted at this test process.
fn plant(daemon: &RunningDaemon) {
    let own = std::process::id();
    let facts = process_facts(own).expect("this process has facts");
    let row = |session: &str| -> ObservedTerminal {
        let row = json!({"sessionId": session, "pid": own, "createdAt": facts.started_at_ms});
        serde_json::from_value(row).expect("an observed row")
    };
    let rows = vec![row("pane-a"), row("pane-b")];
    daemon
        .state
        .observed_tx
        .send_modify(|observed| observed.terminals = rows);
}

/// fieldd's management connection: a call is answered by its id, the floor's ticks aside.
struct Mgmt {
    reader: tokio::io::Lines<BufReader<tokio::io::ReadHalf<local_ipc::ClientStream>>>,
    writer: tokio::io::WriteHalf<local_ipc::ClientStream>,
    next_id: u64,
}

impl Mgmt {
    /// A connection that has said no hello.
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .expect("connect mgmt");
        let (r, w) = tokio::io::split(stream);
        Self {
            reader: BufReader::new(r).lines(),
            writer: w,
            next_id: 1,
        }
    }

    /// A paired connection, and the ack its hello was answered.
    async fn paired(daemon: &RunningDaemon) -> (Self, Value) {
        let mut mgmt = Self::connect(daemon).await;
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-canary-test";
        let mac = pairing::compute_mac(&secret(daemon), boot, ts);
        let params = json!({
            "contractsVersion": "0.1.0", "minCompatible": "0.1.0", "clientKind": "fieldd",
            "credential": {"bootId": boot, "ts": ts, "mac": mac},
        });
        let answer = mgmt.call("native.lifecycle.hello", params).await;
        assert!(answer.get("result").is_some(), "the hello was refused");
        (mgmt, answer["result"].clone())
    }

    /// One request, and the line that answers it.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let line = format!("{request}\n");
        self.writer.write_all(line.as_bytes()).await.expect("write");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let line = timeout_at(deadline, self.reader.next_line())
                .await
                .expect("recv timeout")
                .expect("read error")
                .expect("connection closed");
            let said: Value = serde_json::from_str(&line).expect("json line");
            if said["id"] == json!(id) {
                return said;
            }
        }
    }
}

/// The kind an answer refuses with, or `kept` for an answer that refuses nothing. A floor that has no such verb
/// answers `NOT_FOUND` too, under the method's own code, and that is not a refusal this row means.
fn kind(answer: &Value) -> &str {
    let error = &answer["error"];
    if error["code"] == json!(-32601) {
        return "no such verb";
    }
    error["data"]["kind"].as_str().unwrap_or("kept")
}

#[tokio::test]
async fn no_log_line_at_any_level_says_an_entrys_values() {
    let said = Said::default();
    let sink = said.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(move || sink.clone())
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("this process's one subscriber");

    let entry = json!({"run": RUN, "spark": SPARK, "root": ROOT});
    let set = |session: &str| json!({"sessionId": session, "startedFor": entry});

    // a floor that keeps no table refuses the verb, the planted strings in its params
    let files_dir = tempfile::tempdir().unwrap();
    let files = bootstrap(NativeConfig::for_data_dir(files_dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    plant(&files);
    let (mut fieldd, _) = Mgmt::paired(&files).await;
    let answer = fieldd.call(VERB, set("pane-a")).await;
    assert_eq!(kind(&answer), "PRECONDITION_FAILED");
    files.shutdown().await;

    // a floor that does, through every answer the verb has
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
    let daemon = bootstrap_handed(config, HANDED).await.expect("bootstrap");
    plant(&daemon);
    // a PATH under this test's home, planted as a second pane's root: a home directory rides
    // into a support bundle with any log line that prints one
    let path = format!("{}/canary-planted-path", dir.path().display());
    assert!(path.len() <= 128, "the planted path fits an entry's field");
    let with_path = json!({"run": RUN, "root": path});
    let set_path = json!({"sessionId": "pane-b", "startedFor": with_path});
    let mut stranger = Mgmt::connect(&daemon).await;
    let answer = stranger.call(VERB, set("pane-a")).await;
    assert_eq!(kind(&answer), "UNAUTHORIZED");

    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let answer = fieldd.call(VERB, set("nobody")).await;
    assert_eq!(kind(&answer), "NOT_FOUND");
    // params the contract refuses, with a planted string where a number belongs: the refusal quotes none of it
    let mut bad = set("pane-a");
    bad["startedFor"]["process"] = json!({"pid": RUN, "startedAtMs": SPARK});
    let answer = fieldd.call(VERB, bad).await;
    assert_eq!(kind(&answer), "PRECONDITION_FAILED");
    let refusal = answer.to_string();
    for canary in CANARIES {
        assert!(!refusal.contains(canary), "the refusal quotes {canary}");
    }
    // kept, and said again; and the pane whose root is the planted path
    for _ in 0..2 {
        let answer = fieldd.call(VERB, set("pane-a")).await;
        assert_eq!(kind(&answer), "kept");
    }
    let answer = fieldd.call(VERB, set_path.clone()).await;
    assert_eq!(kind(&answer), "kept");

    // the next fieldd is handed the entries, planted strings and all: the ack is where they are said
    let mut handed = entry.clone();
    handed["sessionId"] = json!("pane-a");
    let mut handed_path = with_path.clone();
    handed_path["sessionId"] = json!("pane-b");
    let table = json!([handed, handed_path]);
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], table);
    // cleared, kept once more, and handed to a third
    let answer = fieldd.call(VERB, json!({"sessionId": "pane-a"})).await;
    assert_eq!(kind(&answer), "kept");
    let answer = fieldd.call(VERB, set("pane-a")).await;
    assert_eq!(kind(&answer), "kept");
    let (_fieldd, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], table);
    daemon.shutdown().await;

    // the capture heard the floor: its hellos are there, at their own level
    let log = said.text();
    let heard = log
        .matches("field_native.mgmt.client_authenticated")
        .count();
    assert!(heard >= 4, "the capture heard {heard} hellos");
    // and nothing the floor said holds a planted string, the path among them
    for canary in CANARIES.into_iter().chain([path.as_str()]) {
        let line = log.lines().find(|line| line.contains(canary));
        assert!(line.is_none(), "a log line says {canary}: {line:?}");
    }
}
