//! OB custody (C5) — MARKS on the management channel (`CUSTODY-SPEC.md` §2.5; contracts mgmt.ts `NativeMarksSet*`,
//! envelope.ts `HelloAck.marks`, registries.ts `CUSTODY`). A mark is a named number that only rises. fieldd tells the
//! floor (`native.marks.set`); the floor keeps the highest value per name IN MEMORY and says what it holds in its hello
//! ack. So a mark outlives fieldd and dies with the floor, and a store put back as it was earlier is seen to be stale.
//! The marks are the floor's, never a connection's, and only the paired management client reaches them (EL7).
use field_native::local_ipc;
use field_native::registries::custody;
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout, timeout_at, Instant};

/// The first mark, by the registry's name: the objects store's grants generation.
const GRANTS: &str = custody::MARK_OBJECT_GRANTS;

/// Every row that boots a floor ends with `daemon.shutdown().await` (item 196: a floor still running when its
/// `TempDir` drops leaves cells binding inside the removal).
async fn boot() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    (dir, daemon)
}

/// A contracts golden, read as `tests/fixture_parity.rs`'s `load` reads one.
fn load(name: &str) -> Value {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts/fixtures")
        .join(name);
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("json {}: {e}", p.display()))
}

/// The management slot is empty: the server's cleanup runs after a close, so a row that hellos again waits for it.
async fn until_vacant(daemon: &RunningDaemon) {
    timeout(Duration::from_secs(2), async {
        while daemon.state.manager.vacant_since().is_none() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the management slot emptied after the close");
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

    /// A paired connection, and the hello ack it was answered.
    async fn paired(daemon: &RunningDaemon) -> (Self, Value) {
        let mut mgmt = Self::connect(daemon).await;
        let ack = mgmt.hello(daemon).await;
        assert!(ack.get("result").is_some(), "{ack}");
        (mgmt, ack)
    }

    /// A hello under the secret this `files` floor made, as fieldd reads it.
    async fn hello(&mut self, daemon: &RunningDaemon) -> Value {
        let raw = std::fs::read_to_string(&daemon.pairing_file).expect("the pairing file");
        let secret = hex::decode(raw.trim()).expect("hex");
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-marks-test";
        let mac = pairing::compute_mac(&secret, boot, ts);
        let params = json!({
            "contractsVersion": "0.1.0", "minCompatible": "0.1.0", "clientKind": "fieldd",
            "credential": {"bootId": boot, "ts": ts, "mac": mac},
        });
        self.call("native.lifecycle.hello", params).await
    }

    /// Write one request and wait for nothing.
    async fn tell(&mut self, method: &str, params: Value) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let line = format!("{request}\n");
        // A superseded connection may refuse the write: such a row reads the floor, never this write.
        let _ = self.writer.write_all(line.as_bytes()).await;
        id
    }

    /// One request, and the line that answers it.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.tell(method, params).await;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let line = timeout_at(deadline, self.reader.next_line())
                .await
                .expect("recv timeout")
                .expect("read error")
                .expect("connection closed");
            let value: Value = serde_json::from_str(&line).expect("json line");
            if value["id"] == json!(id) {
                return value;
            }
        }
    }

    /// `native.marks.set`, and the floor's whole answer.
    async fn set(&mut self, name: &str, value: u64) -> Value {
        let params = json!({"name": name, "value": value});
        self.call("native.marks.set", params).await
    }
}

#[tokio::test]
async fn a_mark_only_rises() {
    let (_dir, daemon) = boot().await;
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    // told a value, the floor answers what it keeps: the highest it was ever told
    for (told, keeps) in [(5, 5), (3, 5), (9, 9), (9, 9), (0, 9)] {
        let answer = fieldd.set(GRANTS, told).await;
        assert_eq!(answer["result"], json!({"value": keeps}), "told {told}");
    }
    // and the answer is the contract's shape
    let golden = load("native-marks-set-result.valid.json");
    let answer = fieldd.set("a.mark.of.eight", 8).await;
    assert_eq!(answer["result"], golden, "{answer}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn two_names_are_kept_apart() {
    let (_dir, daemon) = boot().await;
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    fieldd.set("objects.grants", 8).await;
    let other = fieldd.set("sparks:kept-1", 2).await;
    assert_eq!(other["result"], json!({"value": 2}), "its own mark");
    let first = fieldd.set("objects.grants", 1).await;
    assert_eq!(first["result"], json!({"value": 8}), "and the first's");
    let held = json!({"objects.grants": 8, "sparks:kept-1": 2});
    assert_eq!(json!(daemon.state.marks.snapshot()), held);
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_hello_ack_carries_the_marks_and_carries_none_when_none_is_held() {
    let (_dir, daemon) = boot().await;
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    let none = ack["result"].get("marks").is_none();
    assert!(none, "a floor that holds no mark says none: {ack}");

    let params = load("native-marks-set-params.valid.json");
    let answer = fieldd.call("native.marks.set", params).await;
    assert_eq!(answer["result"], json!({"value": 8}), "{answer}");
    // The next hello reads them. On a NEW connection, as every fieldd's is: a hello supersedes whoever holds the
    // slot, the connection that says it included, so a second hello on one connection closes it.
    let (_next, again) = Mgmt::paired(&daemon).await;
    let golden = load("hello-ack.marks.json");
    assert_eq!(again["result"]["marks"], golden["marks"], "{again}");
    assert_eq!(again["result"]["marks"], json!({GRANTS: 8}), "{again}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_marks_outlive_the_management_client() {
    let (_dir, daemon) = boot().await;
    let (mut first, _) = Mgmt::paired(&daemon).await;
    first.set(GRANTS, 8).await;
    // fieldd goes, and nobody holds the floor
    drop(first);
    until_vacant(&daemon).await;

    let (mut second, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(
        ack["result"]["marks"],
        json!({GRANTS: 8}),
        "the next fieldd reads what the last one wrote: {ack}"
    );
    // and the mark rises from there, never from nothing
    let answer = second.set(GRANTS, 2).await;
    assert_eq!(answer["result"], json!({"value": 8}), "{answer}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_65th_name_is_refused_marks_full_and_changes_nothing() {
    let (_dir, daemon) = boot().await;
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let max = custody::MARKS_MAX;
    for n in 0..max {
        let answer = fieldd.set(&format!("mark.{n}"), n).await;
        assert_eq!(answer["result"], json!({"value": n}), "{answer}");
    }

    let refused = fieldd.set("one.too.many", 1).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "PRECONDITION_FAILED",
        "{refused}"
    );
    assert_eq!(
        refused["error"]["data"]["details"]["reason"], "marks-full",
        "{refused}"
    );
    // a held name still rises: the bound is on the names, never on a mark
    let risen = fieldd.set("mark.0", 7).await;
    assert_eq!(risen["result"], json!({"value": 7}), "{risen}");

    // what the floor holds is the names it held, and the refused one nowhere
    let held = daemon.state.marks.snapshot();
    assert_eq!(held.len() as u64, max);
    assert!(!held.contains_key("one.too.many"), "{held:?}");
    let (_next, again) = Mgmt::paired(&daemon).await;
    let said = again["result"]["marks"].as_object().expect("marks");
    assert_eq!(said.len() as u64, max, "{again}");
    assert_eq!(said.get("mark.0"), Some(&json!(7)), "{again}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_name_off_the_pattern_is_refused() {
    let (_dir, daemon) = boot().await;
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let too_long = "a".repeat(65);
    let off_pattern = [
        "",
        "Objects.grants",
        "9lives",
        "objects grants",
        "objects/grants",
        too_long.as_str(),
    ];
    for name in off_pattern {
        let refused = fieldd.set(name, 1).await;
        assert_eq!(
            refused["error"]["data"]["kind"], "PRECONDITION_FAILED",
            "{name:?}: {refused}"
        );
        // the params' own parse failure, in the helper roots' shape: no details
        let details = refused["error"]["data"].get("details");
        assert!(details.is_none(), "{name:?}: {refused}");
    }
    // a value that is no whole number at or above zero is the same refusal
    for value in [json!(-1), json!(1.5), json!("8"), Value::Null] {
        let params = json!({"name": GRANTS, "value": value});
        let refused = fieldd.call("native.marks.set", params).await;
        assert_eq!(
            refused["error"]["data"]["kind"], "PRECONDITION_FAILED",
            "{value}: {refused}"
        );
    }
    let held = daemon.state.marks.snapshot();
    assert!(held.is_empty(), "a refused set kept a mark: {held:?}");

    // the pattern's longest name is a name
    let longest = "a".repeat(64);
    let answer = fieldd.set(&longest, 1).await;
    assert_eq!(answer["result"], json!({"value": 1}), "{answer}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_verb_is_refused_before_a_hello() {
    let (_dir, daemon) = boot().await;
    let mut stranger = Mgmt::connect(&daemon).await;
    let refused = stranger.set(GRANTS, 8).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "UNAUTHORIZED",
        "an unpaired caller: {refused}"
    );
    let held = daemon.state.marks.snapshot();
    assert!(held.is_empty(), "an unpaired caller's mark: {held:?}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_superseded_connection_raises_no_mark() {
    let (_dir, daemon) = boot().await;
    let (mut stale, _) = Mgmt::paired(&daemon).await;
    stale.set(GRANTS, 3).await;
    let (mut current, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["result"]["marks"], json!({GRANTS: 3}), "{ack}");

    // The floor closes a superseded connection, and until its reader has stopped a request on it still meets the
    // per-request single-client rule, the verb's only authorization. Either way it has no effect, and its answer may
    // never come: the row reads the floor.
    let params = json!({"name": GRANTS, "value": 99});
    stale.tell("native.marks.set", params).await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    let held = daemon.state.marks.snapshot();
    assert_eq!(held.get(GRANTS), Some(&3), "a stale client raised it");

    // the current client is untouched, and its marks rise as ever
    let answer = current.set(GRANTS, 4).await;
    assert_eq!(answer["result"], json!({"value": 4}), "{answer}");
    daemon.shutdown().await;
}
