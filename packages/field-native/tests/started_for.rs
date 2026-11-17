//! OB custody (rule 6) — WHAT EACH TERMINAL WAS STARTED FOR: on the management channel, on the table itself and
//! at the door's walk (contracts custody.ts `TerminalStartedFor*`,
//! mgmt.ts `NativeTerminalStartedForSet*`, envelope.ts `HelloAck.startedFor`, and registries.ts's
//! `CUSTODY.STARTED_FOR_MAX`).
//!
//! An agent fieldd launched outlives it. The fieldd that pairs next has to say whose run that agent is, and a record
//! on disk cannot tell it: the agent can rewrite its own. So fieldd tells the floor what it started in each terminal
//! (`native.terminal.startedFor.set`), the floor keeps it IN MEMORY, and its hello ack hands it to the next fieldd.
//! Only a floor that was handed its pairing secret keeps the table. Where the secret is a file a pane can read,
//! anyone can pair and say an entry.
//!
//! An entry stands on a process, not on a number. At the set the floor reads the pane root's start from the kernel
//! itself; the ack hands an entry on only while that pid still has that start; and the door's walk knows a pane with
//! an entry by that exact start, never by the minute a pane without one is allowed.
//!
//! WHAT IS INJECTED, AND WHICH ROW PROVES THE REAL THING:
//! - Most rows plant the inventory themselves (`observed_tx`, as `tests/door.rs` does), so a pane's root is a process
//!   of this test's own. Everything else is the floor's own: its boot, its management channel, the kernel it reads.
//!   `on_a_real_terminal_the_entry_stands_on_the_ptys_own_root_and_ends_with_it` plants nothing: the inventory is the
//!   one the floor's own pump lists off a real cell.
//! - The rows that need a pid to change hands run on the table and on the walk under a fixed process table (`Tree`).
//!   They show the rule GIVEN a table. That the floor binds the real kernel is proved by every row on a booted floor,
//!   and for the walk by `the_doors_walk_knows_a_pane_with_an_entry_by_the_start_read_at_the_set`.
//!
//! The log's row is `tests/started_for_canary.rs`.
#![cfg(unix)]

use field_native::contracts::{ObservedState, ObservedTerminal, TerminalStartedFor};
use field_native::local_ipc;
use field_native::registries::custody;
use field_native::services::door::peer::{process_facts, ProcessFacts, ProcessTable};
use field_native::services::door::walk::{walk, with_root_starts, Found, PaneRoot, Reached};
use field_native::services::terminal_client::ControlClient;
use field_native::started_for::{Refused, StartedFor};
use field_native::{bootstrap, bootstrap_handed, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::{timeout, timeout_at, Instant};

const VERB: &str = "native.terminal.startedFor.set";
/// The secret a sealed floor of these rows is handed: one byte repeated, nobody's.
const HANDED: [u8; 32] = [0x5a; 32];
/// Far outside the minute a pane's root may be born off its row.
const HOUR_MS: u64 = 3_600_000;
/// A whole second, so a start a few hundred milliseconds on is the same start at the kernel's resolution.
const BIRTH: u64 = 1_792_431_660_000;

/// The contracts goldens of a set: a plain run's, a spark's (with its helper root), and a typed run's.
const PLAIN: &str = "native-terminal-started-for-set-params.valid.json";
const SPARK: &str = "native-terminal-started-for-set-params.spark.json";
const TYPED: &str = "native-terminal-started-for-set-params.typed.json";

/// A floor that was handed its pairing secret, the only kind that keeps the table. Every row that boots a floor ends
/// with `daemon.shutdown().await` (item 196).
async fn sealed() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
    let daemon = bootstrap_handed(config, HANDED).await.expect("bootstrap");
    (dir, daemon)
}

/// A floor that made its own pairing file: today's kind, which keeps no table.
async fn from_the_file() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    (dir, daemon)
}

/// The secret this floor pairs under: its file's where it made one, else the one it was handed.
fn secret(daemon: &RunningDaemon) -> Vec<u8> {
    match std::fs::read_to_string(&daemon.pairing_file) {
        Ok(raw) => hex::decode(raw.trim()).expect("hex"),
        Err(_) => HANDED.to_vec(),
    }
}

/// A contracts golden, read as `tests/fixture_parity.rs`'s `load` reads one.
fn load(name: &str) -> Value {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts/fixtures")
        .join(name);
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("json {}: {e}", p.display()))
}

/// What a golden set says was started: its `startedFor`.
fn said_in(name: &str) -> Value {
    load(name)["startedFor"].clone()
}

/// The same, as the table takes it.
fn started(name: &str) -> TerminalStartedFor {
    serde_json::from_value(said_in(name)).expect("a golden's entry")
}

/// A process of this test's own standing in for a pane's root: a `sleep`, ended and reaped with the row.
struct Root(Child);

impl Root {
    fn start() -> Self {
        let sleep = Command::new("sleep")
            .arg("300")
            .stdin(Stdio::null())
            .spawn()
            .expect("spawn sleep");
        Self(sleep)
    }

    /// Its pid and the start the kernel has for it: what a row lists as a pane's root and its birth.
    fn born(&self) -> (u32, u64) {
        let pid = self.0.id();
        let facts = process_facts(pid).expect("a live child has facts");
        (pid, facts.started_at_ms)
    }

    /// End it and reap it, and wait until the kernel knows no such process.
    fn end(&mut self) {
        let pid = self.0.id();
        let _ = self.0.kill();
        let _ = self.0.wait();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while process_facts(pid).is_some() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Root {
    fn drop(&mut self) {
        self.end();
    }
}

/// One row of an inventory: a session, and the root and birth it lists.
fn pane(session: &str, (pid, created_at): (u32, u64)) -> Value {
    json!({"sessionId": session, "pid": pid, "createdAt": created_at})
}

/// The same row once its root has ended and its cell still lists it.
fn exited(mut row: Value) -> Value {
    row["exited"] = json!(true);
    row
}

/// The floor's inventory becomes exactly these rows.
fn plant(daemon: &RunningDaemon, rows: &[Value]) {
    let rows: Vec<ObservedTerminal> = rows
        .iter()
        .map(|row| serde_json::from_value(row.clone()).expect("an observed row"))
        .collect();
    daemon
        .state
        .observed_tx
        .send_modify(|observed| observed.terminals = rows);
}

/// An inventory of these rows, for the table's own rows.
fn inventory(rows: &[Value]) -> ObservedState {
    let state = json!({"generation": 1, "bootId": "b", "terminals": rows, "workers": []});
    serde_json::from_value(state).expect("an observed state")
}

/// How many entries the floor holds. A floor with no table holds none.
fn held(daemon: &RunningDaemon) -> usize {
    match daemon.state.started_for() {
        Some(table) => table.count(),
        None => 0,
    }
}

fn door_endpoint(daemon: &RunningDaemon) -> String {
    daemon
        .state
        .door
        .info()
        .expect("the door is open")
        .endpoint
        .to_string()
}

/// The session an entry of the ack is for.
fn session_of(entry: &Value) -> &str {
    entry["sessionId"].as_str().expect("an entry's session")
}

/// What was started, as the ack says it for `session`.
fn entry_for(session: &str, started_for: &Value) -> Value {
    let mut entry = started_for.clone();
    entry["sessionId"] = json!(session);
    entry
}

/// The ack's table, in one order: the floor says it in its own.
fn by_session(table: &Value) -> Vec<Value> {
    let mut entries = table.as_array().cloned().unwrap_or_default();
    entries.sort_by_key(|entry| entry["sessionId"].as_str().map(str::to_owned));
    entries
}

/// The refusal an answer carries: its kind and, where it names one, its `details.reason`. A floor that has no such
/// verb answers `NOT_FOUND` too, under the method's own code, and that is not the refusal any row here means.
fn refusal(answer: &Value) -> (&str, Option<&str>) {
    let error = &answer["error"];
    if error["code"] == json!(-32601) {
        return ("no such verb", None);
    }
    let data = &error["data"];
    let kind = data["kind"].as_str().unwrap_or("no refusal");
    (kind, data["details"]["reason"].as_str())
}

/// Polls `check` until it holds or five seconds pass.
async fn settles(check: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !check() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    check()
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

/// fieldd's management connection: a call is answered by its id, the floor's ticks and streams aside.
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

    /// A paired connection, and the ack its hello was answered. A hello supersedes whoever held the slot.
    async fn paired(daemon: &RunningDaemon) -> (Self, Value) {
        let mut mgmt = Self::connect(daemon).await;
        let answer = mgmt.hello(daemon).await;
        assert!(answer.get("result").is_some(), "{answer}");
        (mgmt, answer["result"].clone())
    }

    async fn hello(&mut self, daemon: &RunningDaemon) -> Value {
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-started-for-test";
        let mac = pairing::compute_mac(&secret(daemon), boot, ts);
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

    /// The floor's next line before `deadline`.
    async fn next_by(&mut self, deadline: Instant) -> Value {
        let line = timeout_at(deadline, self.reader.next_line())
            .await
            .expect("recv timeout")
            .expect("read error")
            .expect("connection closed");
        serde_json::from_str(&line).expect("json line")
    }

    /// One request, and the line that answers it.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.tell(method, params).await;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let said = self.next_by(deadline).await;
            if said["id"] == json!(id) {
                return said;
            }
        }
    }

    /// The verb, and the floor's whole answer: with `started_for` a set, with none a clear.
    async fn set(&mut self, session: &str, started_for: Option<&Value>) -> Value {
        let mut params = json!({ "sessionId": session });
        if let Some(started_for) = started_for {
            params["startedFor"] = started_for.clone();
        }
        self.call(VERB, params).await
    }

    /// The next line of the door stream.
    async fn door_note(&mut self) -> Value {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let said = self.next_by(deadline).await;
            if said["method"]
                .as_str()
                .is_some_and(|m| m.starts_with("native.door."))
            {
                return said;
            }
        }
    }
}

#[tokio::test]
async fn the_verb_is_refused_before_a_hello() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    plant(&daemon, &[pane("pane-a", root.born())]);
    let mut stranger = Mgmt::connect(&daemon).await;
    let refused = stranger.set("pane-a", Some(&said_in(PLAIN))).await;
    assert_eq!(refusal(&refused), ("UNAUTHORIZED", None), "{refused}");
    assert_eq!(held(&daemon), 0, "an unpaired caller's entry was kept");
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_superseded_connection_sets_nothing() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    plant(&daemon, &[pane("pane-a", root.born())]);
    let (mut stale, _) = Mgmt::paired(&daemon).await;
    let (mut current, _) = Mgmt::paired(&daemon).await;

    // The floor closes a superseded connection, and until its reader has stopped a request on it still meets the
    // per-request single-client rule, the verb's only authorization. Either way it has no effect, and its answer may
    // never come: the row reads the floor.
    let mut params = json!({ "sessionId": "pane-a" });
    params["startedFor"] = said_in(PLAIN);
    stale.tell(VERB, params).await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(held(&daemon), 0, "a stale client's entry was kept");

    // the current client is untouched, and its set is kept
    let answer = current.set("pane-a", Some(&said_in(PLAIN))).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    assert_eq!(held(&daemon), 1);
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_floor_booted_from_the_file_answers_not_sealed_and_its_ack_names_no_table() {
    let (_dir, daemon) = from_the_file().await;
    let root = Root::start();
    plant(&daemon, &[pane("pane-a", root.born())]);
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    assert!(ack.get("startedFor").is_none(), "no table, no key: {ack}");

    // a set and a clear alike, of a pane that is listed and running: this floor's secret is a file a pane can read
    let not_sealed = ("PRECONDITION_FAILED", Some("not-sealed"));
    let answer = fieldd.set("pane-a", Some(&said_in(PLAIN))).await;
    assert_eq!(refusal(&answer), not_sealed, "{answer}");
    let answer = fieldd.set("pane-a", None).await;
    assert_eq!(refusal(&answer), not_sealed, "{answer}");
    // and before it reads a word of the params
    let answer = fieldd.call(VERB, json!({"sessionId": 7})).await;
    assert_eq!(refusal(&answer), not_sealed, "{answer}");

    assert!(daemon.state.started_for().is_none(), "there is no table");
    let (_next, ack) = Mgmt::paired(&daemon).await;
    assert!(ack.get("startedFor").is_none(), "{ack}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_sealed_floor_that_holds_nothing_says_no_key_and_still_keeps_the_table() {
    let (_dir, daemon) = sealed().await;
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    // absent and empty are one thing to a reader, so a floor with nothing to hand says no key, as with `marks`
    assert!(ack.get("startedFor").is_none(), "{ack}");
    // it is the verb that tells this floor from one booted from the file: it answers about the session it is asked
    assert!(daemon.state.started_for().is_some(), "a sealed floor's table");
    let answer = fieldd.set("nobody", None).await;
    assert_eq!(refusal(&answer), ("NOT_FOUND", None), "{answer}");
    daemon.shutdown().await;
}

/// The contract holds a typed run's pid to 2 or more, and the generated type on this side carries no such bound. So
/// the floor holds it by hand: nothing out of bound is kept, and none is handed back.
#[tokio::test]
async fn a_typed_runs_pid_below_two_is_refused_by_hand_and_two_is_taken() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    plant(&daemon, &[pane("pane-a", root.born())]);
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let typed = |pid: i64| {
        let mut started_for = said_in(TYPED);
        started_for["process"]["pid"] = json!(pid);
        started_for
    };
    let plain = said_in(PLAIN);
    let answer = fieldd.set("pane-a", Some(&plain)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");

    // refused as params the contract does not allow, and what was kept is untouched
    let bad_params = ("PRECONDITION_FAILED", None);
    for pid in [-1, 0, 1] {
        let answer = fieldd.set("pane-a", Some(&typed(pid))).await;
        assert_eq!(refusal(&answer), bad_params, "pid {pid}: {answer}");
    }
    assert_eq!(held(&daemon), 1);
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], json!([entry_for("pane-a", &plain)]));

    // 2 is a pid: taken, and handed on as it was said
    let two = typed(2);
    let answer = fieldd.set("pane-a", Some(&two)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    let (_next, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], json!([entry_for("pane-a", &two)]));
    daemon.shutdown().await;
}

#[tokio::test]
async fn an_unknown_session_and_an_exited_one_are_not_found() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    plant(&daemon, &[exited(pane("a-husk", root.born()))]);
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let plain = said_in(PLAIN);
    for session in ["nobody", "a-husk"] {
        let answer = fieldd.set(session, Some(&plain)).await;
        assert_eq!(refusal(&answer), ("NOT_FOUND", None), "{answer}");
        let answer = fieldd.set(session, None).await;
        assert_eq!(refusal(&answer), ("NOT_FOUND", None), "{answer}");
    }
    assert_eq!(held(&daemon), 0);
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_set_needs_a_root_the_floor_reads_itself_born_with_its_row() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    let mut gone = Root::start();
    let (pid, born) = root.born();
    let was = gone.born();
    gone.end();
    plant(
        &daemon,
        &[
            json!({"sessionId": "no-pid", "createdAt": born}),
            json!({"sessionId": "no-birth", "pid": pid}),
            pane("root-gone", was),
            pane("born-an-hour-off", (pid, born + HOUR_MS)),
            pane("pane-a", (pid, born)),
        ],
    );
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let plain = said_in(PLAIN);
    let not_found = ("NOT_FOUND", None);
    // listed and running, and no process the floor can read as the root: nothing is kept for any
    for session in ["no-pid", "no-birth", "root-gone", "born-an-hour-off"] {
        let answer = fieldd.set(session, Some(&plain)).await;
        assert_eq!(refusal(&answer), not_found, "{session}: {answer}");
    }
    assert_eq!(held(&daemon), 0);
    // a clear needs none: the session is listed and running, and clearing nothing is an answer
    let answer = fieldd.set("no-pid", None).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    // and the pane whose root lives, born with its row, is kept
    let answer = fieldd.set("pane-a", Some(&plain)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    assert_eq!(held(&daemon), 1);
    daemon.shutdown().await;
}

#[tokio::test]
async fn set_set_again_and_clear() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    plant(&daemon, &[pane("pane-a", root.born())]);
    let (plain, spark) = (said_in(PLAIN), said_in(SPARK));

    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let answer = fieldd.set("pane-a", Some(&plain)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], json!([entry_for("pane-a", &plain)]));

    // said again, the entry is what was said last: a resume puts another run in the same pane
    let answer = fieldd.set("pane-a", Some(&spark)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    assert_eq!(held(&daemon), 1);
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], json!([entry_for("pane-a", &spark)]));

    // cleared, it is gone: by a null here, which this side reads as an absent `startedFor`
    let null = json!({"sessionId": "pane-a", "startedFor": null});
    let answer = fieldd.call(VERB, null).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    assert_eq!(held(&daemon), 0);
    // and clearing nothing is the same answer
    let answer = fieldd.set("pane-a", None).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    let (_fieldd, ack) = Mgmt::paired(&daemon).await;
    assert!(ack.get("startedFor").is_none(), "{ack}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_ack_hands_the_table_in_the_contracts_shape() {
    let golden = load("hello-ack.started-for.json");
    let golden = by_session(&golden["startedFor"]);
    assert_eq!(golden.len(), 2, "the golden's two entries");
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    let rows: Vec<Value> = golden
        .iter()
        .map(|entry| pane(session_of(entry), root.born()))
        .collect();
    plant(&daemon, &rows);

    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    for entry in &golden {
        let mut started_for = entry.clone();
        let said = started_for.as_object_mut().expect("an entry");
        said.remove("sessionId");
        let answer = fieldd.set(session_of(entry), Some(&started_for)).await;
        assert_eq!(answer["result"], json!({}), "{answer}");
    }
    // what the next fieldd is handed is the golden's table, to the field
    let (_next, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(by_session(&ack["startedFor"]), golden);
    daemon.shutdown().await;
}

#[tokio::test]
async fn an_exited_sessions_entry_and_a_dead_roots_are_not_handed_and_are_dropped() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    let mut dying = Root::start();
    let (born, was) = (root.born(), dying.born());
    let rows = [
        pane("stays", born),
        pane("exits", born),
        pane("root-dies", was),
    ];
    plant(&daemon, &rows);
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let typed = said_in(TYPED);
    for session in ["stays", "exits", "root-dies"] {
        let answer = fieldd.set(session, Some(&typed)).await;
        assert_eq!(answer["result"], json!({}), "{session}: {answer}");
    }
    assert_eq!(held(&daemon), 3);

    // one pane's process ends and its cell still lists it; another's root dies before the floor has heard
    dying.end();
    let rows = [
        pane("stays", born),
        exited(pane("exits", born)),
        pane("root-dies", was),
    ];
    plant(&daemon, &rows);
    let (_next, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], json!([entry_for("stays", &typed)]));
    // and they are dropped there, not kept for a pane that might be listed again
    assert_eq!(held(&daemon), 1);
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_later_fieldds_hello_is_handed_the_table_again() {
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    plant(&daemon, &[pane("pane-a", root.born())]);
    let spark = said_in(SPARK);
    let table = json!([entry_for("pane-a", &spark)]);

    let (mut first, _) = Mgmt::paired(&daemon).await;
    let answer = first.set("pane-a", Some(&spark)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    // fieldd is gone, and the floor and the agent's terminal are not
    drop(first);
    until_vacant(&daemon).await;
    assert_eq!(held(&daemon), 1, "the table is the floor's");

    // the fieldd that pairs next is handed it, and so is one after that
    let (_second, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], table, "{ack}");
    let (_third, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], table, "{ack}");
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_bound_drops_what_fell_before_it_refuses_and_a_full_table_says_so() {
    let bound = custody::STARTED_FOR_MAX as usize;
    let (_dir, daemon) = sealed().await;
    let root = Root::start();
    let born = root.born();
    let session = |n: usize| format!("pane-{n:04}");
    // one session more than the table keeps, every one rooted at a process that lives; `fallen` has exited
    let listed = |fallen: Option<usize>| -> Vec<Value> {
        (0..=bound)
            .map(|n| match fallen {
                Some(fell) if fell == n => exited(pane(&session(n), born)),
                _ => pane(&session(n), born),
            })
            .collect()
    };
    plant(&daemon, &listed(None));
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    let plain = said_in(PLAIN);
    for n in 0..bound {
        let answer = fieldd.set(&session(n), Some(&plain)).await;
        assert_eq!(answer["result"], json!({}), "entry {n}: {answer}");
    }
    assert_eq!(held(&daemon), bound);

    // one session more, and nothing in the table has fallen: refused by name, and nothing changes
    let full = ("PRECONDITION_FAILED", Some("started-for-full"));
    let answer = fieldd.set(&session(bound), Some(&plain)).await;
    assert_eq!(refusal(&answer), full, "{answer}");
    assert_eq!(held(&daemon), bound);
    // an entry already held is replaced at the bound, never refused
    let answer = fieldd.set(&session(0), Some(&said_in(SPARK))).await;
    assert_eq!(answer["result"], json!({}), "{answer}");

    // a session of the table ends: the new one's set drops it first, and is kept
    plant(&daemon, &listed(Some(1)));
    let answer = fieldd.set(&session(bound), Some(&plain)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    assert_eq!(held(&daemon), bound);
    let (_next, ack) = Mgmt::paired(&daemon).await;
    let handed = by_session(&ack["startedFor"]);
    assert_eq!(handed.len(), bound, "what the next fieldd is handed");
    let fell = session(1);
    assert!(handed.iter().all(|entry| session_of(entry) != fell));
    daemon.shutdown().await;
}

/// NOTHING PLANTED. A sealed floor with its real cell; a real PTY made on the cell's control socket, as fieldd makes
/// one; the row the floor's own pump lists it with; the kernel's word on its root. It proves what the planted rows
/// take as given: that the birth ghosttea stamps on a session and the start the kernel has for its root are the same
/// birth, so a set of a real pane is kept, and that a real exit is what ends the entry.
#[tokio::test]
async fn on_a_real_terminal_the_entry_stands_on_the_ptys_own_root_and_ends_with_it() {
    // macOS caps a socket path near 104 bytes and a cell's sockets sit three levels under the data dir, so the data
    // dir is rooted at /tmp (`tests/terminal_unit.rs`, `short_tempdir`)
    let dir = tempfile::Builder::new()
        .prefix("vfsf")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp");
    let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
    let daemon = bootstrap_handed(config, HANDED).await.expect("bootstrap");
    let mut routes = daemon.state.terminal_routes.clone();
    timeout(
        Duration::from_secs(20),
        routes.wait_for(|snapshot| !snapshot.cells.is_empty()),
    )
    .await
    .expect("the terminal cell announced within its hello budget")
    .expect("the routes watch outlives boot");

    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    let terminal = &ack["terminal"];
    let socket = terminal["controlSocket"].as_str().expect("controlSocket");
    let token = terminal["authToken"].as_str().expect("authToken");
    let (cell, _events) = ControlClient::connect(socket, token)
        .await
        .expect("dial the cell's control socket");
    // an agent's pane: the program is the pane's root, and the pane is kept after it ends
    let options = json!({
        "executable": "/bin/cat",
        "args": [],
        "cols": 80,
        "rows": 24,
        "persistence": "keep-until-explicit-close",
        "environment": {"mode": "clean", "variables": {}},
    });
    let session = cell.create_session(options).await.expect("create session");
    let pid = session.pid.expect("the PTY leader has a pid");
    let listed = |as_exited: bool| {
        let observed = daemon.state.observed_tx.borrow();
        let mut rows = observed.terminals.iter();
        rows.any(|row| row.session_id == session.id && (row.exited == Some(true)) == as_exited)
    };
    assert!(settles(|| listed(false)).await, "the floor lists the pane");

    // the set: the floor reads the PTY root itself, and the root was born with the row ghosttea stamped
    let spark = said_in(SPARK);
    let answer = fieldd.set(&session.id, Some(&spark)).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    let table = daemon.state.started_for().expect("a sealed floor's table");
    let facts = process_facts(pid).expect("the PTY leader has facts");
    let read = table.root_starts().get(&session.id).copied();
    assert_eq!(read, Some((pid, facts.started_at_ms)));
    let handed = json!([entry_for(&session.id, &spark)]);
    let (_next, ack) = Mgmt::paired(&daemon).await;
    assert_eq!(ack["startedFor"], handed, "{ack}");

    // the agent's process ends, and its cell keeps listing the pane: the entry ends with the process
    // SAFETY: `pid` is the PTY leader this row created a moment ago, and it is still this row's to end.
    unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
    assert!(settles(|| listed(true)).await, "the floor lists the husk");
    let (mut fieldd, ack) = Mgmt::paired(&daemon).await;
    assert!(ack.get("startedFor").is_none(), "{ack}");
    assert_eq!(held(&daemon), 0);
    // and nothing can be said of a husk
    let answer = fieldd.set(&session.id, Some(&spark)).await;
    assert_eq!(refusal(&answer), ("NOT_FOUND", None), "{answer}");
    daemon.shutdown().await;
}

/// A fixed process table: pid → (parent, start). INJECTED: the rows below hand the table and the walk this in place
/// of the kernel, to show their rule given a table (the header says which rows prove the real binding).
struct Tree(HashMap<u32, ProcessFacts>);

impl Tree {
    fn new(rows: &[(u32, u32, u64)]) -> Self {
        let facts = |&(pid, parent, started_at_ms): &(u32, u32, u64)| {
            let facts = ProcessFacts {
                parent,
                started_at_ms,
            };
            (pid, facts)
        };
        Self(rows.iter().map(facts).collect())
    }
}

impl ProcessTable for Tree {
    fn process(&self, pid: u32) -> Option<ProcessFacts> {
        self.0.get(&pid).copied()
    }
}

/// The PM's row: an entry is a process's, and a pid alone hands nothing on.
#[test]
fn a_root_pid_alive_under_another_start_is_not_handed() {
    let table = StartedFor::default();
    let listed = inventory(&[pane("pane-a", (500, BIRTH))]);
    let at_the_set = Tree::new(&[(500, 400, BIRTH + 100)]);
    let set = table.set(&at_the_set, &listed, "pane-a", Some(started(PLAIN)));
    assert_eq!(set, Ok(()));
    // the same process read again inside the same second, the kernel's resolution: handed
    let read_again = Tree::new(&[(500, 400, BIRTH + 900)]);
    assert_eq!(table.handed(&read_again, &listed).len(), 1);

    // the pid lives, and the process holding it started five seconds on: it is not the root the entry was said of
    let another = Tree::new(&[(500, 1, BIRTH + 5_000)]);
    assert!(table.handed(&another, &listed).is_empty());
    // and the entry is dropped there: the first process, could it come back, is handed nothing
    assert_eq!(table.count(), 0);
    assert!(table.handed(&at_the_set, &listed).is_empty());
}

#[test]
fn the_table_reads_the_root_itself_and_refuses_what_it_cannot_read() {
    let table = StartedFor::default();
    let listed = inventory(&[
        pane("pane-a", (500, BIRTH)),
        exited(pane("a-husk", (600, BIRTH))),
    ]);
    let desk = Tree::new(&[(500, 400, BIRTH + 100), (600, 400, BIRTH)]);
    let nobody = Tree::new(&[]);
    let reused = Tree::new(&[(500, 1, BIRTH + HOUR_MS)]);
    let asks = [
        // no such session, and a session whose process has ended
        (&desk, "nobody"),
        (&desk, "a-husk"),
        // a running pane whose root the kernel no longer knows, and one whose pid went to a later process
        (&nobody, "pane-a"),
        (&reused, "pane-a"),
    ];
    for (processes, session) in asks {
        let set = table.set(processes, &listed, session, Some(started(PLAIN)));
        assert_eq!(set, Err(Refused::NotFound), "{session}");
    }
    assert_eq!(table.count(), 0);

    // kept, the entry is said with its session and the root is the one the table read: pid and start
    let set = table.set(&desk, &listed, "pane-a", Some(started(SPARK)));
    assert_eq!(set, Ok(()));
    let handed = table.handed(&desk, &listed);
    assert_eq!(handed, vec![entry_for("pane-a", &said_in(SPARK))]);
    let roots = table.root_starts();
    assert_eq!(roots.get("pane-a"), Some(&(500, BIRTH + 100)));
    assert_eq!(roots.len(), 1);

    // a set the floor cannot read a root for takes the old entry with it: its root is the one that is gone
    let set = table.set(&nobody, &listed, "pane-a", Some(started(PLAIN)));
    assert_eq!(set, Err(Refused::NotFound));
    assert_eq!(table.count(), 0);
}

fn pane_root(id: &str, pid: u32, created_at_ms: u64, read: Option<u64>) -> PaneRoot {
    PaneRoot {
        terminal_session_id: id.into(),
        pid,
        created_at_ms,
        root_started_at_ms: read,
    }
}

/// The pane a walk from `caller` reaches, with no helper root on the table.
fn placed(table: &Tree, caller: u32, panes: &[PaneRoot]) -> Option<Found> {
    match walk(table, caller, panes, &[]) {
        Some(Reached::Pane(found)) => Some(found),
        _ => None,
    }
}

/// §8.1.12 — the minute a pane's root may be born off its row is long enough for a dead root's pid to come round.
#[test]
fn a_process_with_a_pane_roots_pid_and_another_start_is_not_placed_on_a_pane_that_has_an_entry() {
    // the pane was born at BIRTH. Its root died inside its first minute, and the pid went to a process started
    // twenty seconds on, which has a child of its own
    let taken = Tree::new(&[
        (1, 0, 0),
        (500, 1, BIRTH + 20_000),
        (510, 500, BIRTH + 21_000),
    ]);
    // with no entry the minute takes the newcomer for the root, and its child for the pane's
    let unsaid = [pane_root("pane-a", 500, BIRTH, None)];
    assert_eq!(placed(&taken, 510, &unsaid).map(|f| f.depth), Some(1));
    // with an entry the root is the process that had the start the floor read at the set, and no other
    let said = [pane_root("pane-a", 500, BIRTH, Some(BIRTH + 100))];
    assert_eq!(placed(&taken, 510, &said), None);
    assert_eq!(placed(&taken, 500, &said), None);

    // the root itself and what it started are placed as ever, its row's birth whatever it says
    let alive = Tree::new(&[(500, 1, BIRTH + 100), (510, 500, BIRTH + 21_000)]);
    assert_eq!(placed(&alive, 510, &said).map(|f| f.depth), Some(1));
    let birth_off = BIRTH + HOUR_MS;
    let off = [pane_root("pane-a", 500, birth_off, Some(BIRTH + 100))];
    assert_eq!(placed(&alive, 500, &off).map(|f| f.depth), Some(0));
}

#[test]
fn a_pane_with_no_entry_is_placed_as_before() {
    // a root the kernel started inside the minute of its row's birth, either side, is the pane's
    let desk = Tree::new(&[
        (1, 0, 0),
        (500, 1, BIRTH - 59_000),
        (510, 500, BIRTH),
        (600, 1, BIRTH + 59_000),
        (700, 1, BIRTH + 61_000),
    ]);
    let panes = [
        pane_root("early", 500, BIRTH, None),
        pane_root("late", 600, BIRTH, None),
        pane_root("too-late", 700, BIRTH, None),
    ];
    let reached = |caller: u32| {
        let found = placed(&desk, caller, &panes)?;
        Some(found.terminal_session_id)
    };
    assert_eq!(reached(510).as_deref(), Some("early"));
    assert_eq!(reached(600).as_deref(), Some("late"));
    assert_eq!(reached(700), None);
}

#[test]
fn the_tables_roots_name_only_the_pane_they_were_read_of() {
    let panes = vec![
        pane_root("pane-a", 500, BIRTH, None),
        pane_root("another-pid", 600, BIRTH, None),
        pane_root("no-entry", 700, BIRTH, None),
    ];
    let starts = HashMap::from([
        ("pane-a".to_owned(), (500, BIRTH + 100)),
        ("another-pid".to_owned(), (601, BIRTH + 100)),
        ("not-listed".to_owned(), (800, BIRTH + 100)),
    ]);
    let read: Vec<Option<u64>> = with_root_starts(panes, &starts)
        .iter()
        .map(|pane| pane.root_started_at_ms)
        .collect();
    // an entry said of another pid is not about this row's root, which keeps the rule of a pane with none
    assert_eq!(read, [Some(BIRTH + 100), None, None]);
}

/// The walk's exact start, through the floor's own wiring: boot hands the door the table, and a caller dialing
/// `door.sock` is placed by it. The caller is this test process, and the pane's root is this process itself.
#[tokio::test]
async fn the_doors_walk_knows_a_pane_with_an_entry_by_the_start_read_at_the_set() {
    let (_dir, daemon) = sealed().await;
    let own = std::process::id();
    let facts = process_facts(own).expect("this process has facts");
    let born = facts.started_at_ms;
    let door = door_endpoint(&daemon);
    let (mut fieldd, _) = Mgmt::paired(&daemon).await;
    fieldd.call("native.door.subscribe", json!({})).await;

    // a row born an hour off this process's start, and no entry: the minute's rule places nobody
    let an_hour_off = [pane("pane-a", (own, born + HOUR_MS))];
    plant(&daemon, &an_hour_off);
    let _outside = UnixStream::connect(&door).await.unwrap();
    let open = fieldd.door_note().await;
    assert!(open["params"]["payload"].get("pane").is_none(), "{open}");

    // the entry is said while the row's birth is the root's own, and the floor reads the start itself
    plant(&daemon, &[pane("pane-a", (own, born))]);
    let answer = fieldd.set("pane-a", Some(&said_in(PLAIN))).await;
    assert_eq!(answer["result"], json!({}), "{answer}");
    // now only that start can place the caller: the row's birth is an hour off again
    plant(&daemon, &an_hour_off);
    let _inside = UnixStream::connect(&door).await.unwrap();
    let open = fieldd.door_note().await;
    let the_pane = json!({"terminalSessionId": "pane-a", "depth": 0});
    assert_eq!(open["params"]["payload"]["pane"], the_pane, "{open}");
    daemon.shutdown().await;
}
