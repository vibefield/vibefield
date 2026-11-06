//! DR-3a (W3, VF-FLOOR stack B) — the named-root file transfer arm over the
//! REAL management socket: pairing, the mesh worker, the facade's refusal order
//! (contracts mgmt.ts, the file transfer's header), the held roots, the
//! folders, the pulls and their stream.
//!
//! What these rows witness, stated plainly because it bounds them: no node can
//! be built headlessly (`MeshHandle::force_node_presence_for_tests`), and the
//! named-root arm is unreachable in production until EL8-TRUFFLE. So each row
//! installs the arm through its test seam, and each node's substrate is a
//! `ScriptedPulls` handed over by the one install hook
//! (`MeshHandle::attach_file_transfer_for_tests` → `on_node_installed`), with
//! REAL files under a temp root. truffle's own named pull is EL8-TRUFFLE's
//! `drive_pull_probe.rs`.
//!
//! Every answer, delta and snapshot a row reads is parsed through the generated
//! `NativeFileTransfer*` or `ErrorData` type, its kind asserted (the
//! `tests/mesh_egress.rs` precedent). Every row boots its own floor on its own
//! temp root, awaits the floor's shutdown, and drops the root (item 196). Each
//! row's note names the mutation that turns it red ("Probe").
use field_native::contracts::{
    ErrorData, ErrorKind, FileTransferRootName, MeshMode, MeshNotUpDetails,
    NativeFileTransferDelta, NativeFileTransferPullResult, NativeFileTransferRootsResult,
    NativeFileTransferSnapshot,
};
use field_native::local_ipc;
use field_native::registries::{drive_limits, file_transfer_roots, layout, mesh_file_transfer};
use field_native::services::file_transfer::{
    NamedRootsFileTransfer, PullFailure, Scripted, ScriptedPulls,
};
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout, timeout_at, Instant};

const LOGIN: &str = "me@example.com";
const OTHER_LOGIN: &str = "someone@example.org";
const PEER: &str = "n4Kd8xQ2pLmR";
/// A SHA-256 the substrate answers: the floor passes the substrate's word on.
const SHA256: &str = "075eeb056ba8f587858fe88dd968e5d29207d6537944d88d8826a56cb8e89a42";
const DRIVE_OBJECTS: &str = file_transfer_roots::DRIVE_OBJECTS;
const ROOTS: &str = "native.mesh.fileTransfer.roots";
const PULL: &str = "native.mesh.fileTransfer.pull";
const SUBSCRIBE: &str = "native.mesh.fileTransfer.subscribe";
const DELTA: &str = "native.mesh.fileTransfer.delta";
const SNAPSHOT: &str = "native.mesh.fileTransfer.snapshot";
/// One wait's budget: a reply, a note, a pull's end or a teardown that has not
/// come by then reds its row rather than hanging it. The floor ticks every
/// second, so a deadline per line would restart for ever: the budget is the
/// whole wait's (`tests/mgmt_server.rs`'s `recv`).
const BUDGET: Duration = Duration::from_secs(10);

struct Mgmt {
    reader: tokio::io::Lines<BufReader<tokio::io::ReadHalf<local_ipc::ClientStream>>>,
    writer: tokio::io::WriteHalf<local_ipc::ClientStream>,
    next_id: u64,
    /// notifications read while waiting for something else, in arrival order
    notes: VecDeque<Value>,
}

impl Mgmt {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .expect("connect mgmt");
        let (r, w) = tokio::io::split(stream);
        let mut me = Self {
            reader: BufReader::new(r).lines(),
            writer: w,
            next_id: 1,
            notes: VecDeque::new(),
        };
        let secret = hex::decode(
            std::fs::read_to_string(&daemon.pairing_file)
                .unwrap()
                .trim(),
        )
        .unwrap();
        let ts = pairing::now_epoch_secs();
        let boot = "dr3a-file-transfer-test";
        let mac = pairing::compute_mac(&secret, boot, ts);
        let ack = me
            .call(
                "native.lifecycle.hello",
                json!({
                    "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
                    "credential":{"bootId":boot,"ts":ts,"mac":mac}
                }),
            )
            .await;
        assert!(ack.get("result").is_some(), "hello refused: {ack}");
        me
    }

    /// The next line by `deadline` that is not the floor's liveness tick; a
    /// wait for `what` past it panics.
    async fn next_line(&mut self, deadline: Instant, what: &str) -> Value {
        loop {
            let line = timeout_at(deadline, self.reader.next_line())
                .await
                .unwrap_or_else(|_| panic!("no {what} within {BUDGET:?}"))
                .expect("mgmt read error")
                .expect("mgmt connection closed");
            let msg: Value = serde_json::from_str(&line).expect("json line");
            if msg["method"] != "native.lifecycle.tick" {
                return msg;
            }
        }
    }

    /// Send a request and return ITS response within the budget;
    /// notifications that arrive first are kept.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let line = format!(
            "{}\n",
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
        );
        self.writer.write_all(line.as_bytes()).await.unwrap();
        let deadline = Instant::now() + BUDGET;
        loop {
            let msg = self.next_line(deadline, method).await;
            if msg.get("id") == Some(&json!(id)) {
                return msg;
            }
            self.notes.push_back(msg);
        }
    }

    /// The next notification `wanted` accepts, by `deadline`; the others are
    /// kept, in order.
    async fn note_where(
        &mut self,
        deadline: Instant,
        what: &str,
        wanted: impl Fn(&Value) -> bool,
    ) -> Value {
        if let Some(i) = self.notes.iter().position(&wanted) {
            return self.notes.remove(i).unwrap();
        }
        loop {
            let msg = self.next_line(deadline, what).await;
            if wanted(&msg) {
                return msg;
            }
            self.notes.push_back(msg);
        }
    }

    /// The next notification named `method`, within the budget.
    async fn note(&mut self, method: &str) -> Value {
        self.note_where(Instant::now() + BUDGET, method, |n| n["method"] == method)
            .await
    }

    /// The END of the pull `transfer_id` within ONE budget, its progress
    /// aside: its first delta that is not a progress, the note it rode with it.
    async fn end_of(&mut self, transfer_id: &str) -> (Value, NativeFileTransferDelta) {
        let deadline = Instant::now() + BUDGET;
        let what = format!("end of {transfer_id}");
        loop {
            let note = self
                .note_where(deadline, &what, |n| {
                    n["method"] == DELTA && n["params"]["payload"]["transferId"] == transfer_id
                })
                .await;
            let delta = delta(&note);
            if kind_of(&delta) != "progress" {
                return (note, delta);
            }
        }
    }
}

/// A floor on its own temp root. No sidecar can be found: a `start` a row makes
/// to rebuild a posture tears the node down and degrades, and never builds one.
async fn boot() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some("/nonexistent/sidecar-slim".into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.expect("bootstrap");
    (dir, daemon)
}

/// Install the named-root arm for the floor's user root, shaped by `shape`.
fn install(
    dir: &Path,
    daemon: &RunningDaemon,
    shape: impl FnOnce(NamedRootsFileTransfer) -> NamedRootsFileTransfer,
) {
    let arm = shape(NamedRootsFileTransfer::new(&NativeConfig::for_data_dir(
        dir.to_path_buf(),
    )));
    daemon
        .state
        .mesh
        .install_file_transfer_for_tests(Arc::new(arm));
}

/// A node arrives: its substrate goes through the one install hook.
async fn attach(daemon: &RunningDaemon) -> Arc<ScriptedPulls> {
    let pulls = Arc::new(ScriptedPulls::new());
    daemon
        .state
        .mesh
        .attach_file_transfer_for_tests(pulls.clone())
        .await;
    pulls
}

/// A floor with the named-root arm shaped by `shape`, a node present, built
/// gated for LOGIN, and its substrate attached.
async fn gated_floor_with(
    shape: impl FnOnce(NamedRootsFileTransfer) -> NamedRootsFileTransfer,
) -> (tempfile::TempDir, RunningDaemon, Arc<ScriptedPulls>) {
    let (dir, daemon) = boot().await;
    install(dir.path(), &daemon, shape);
    daemon.state.mesh.record_gate_for_tests(LOGIN, true);
    daemon.state.mesh.force_node_presence_for_tests(true);
    let pulls = attach(&daemon).await;
    (dir, daemon, pulls)
}

async fn gated_floor() -> (tempfile::TempDir, RunningDaemon, Arc<ScriptedPulls>) {
    gated_floor_with(|arm| arm).await
}

/// A rebuild under `login`: `start` tears the node down (`gate_changed`, never
/// `stopped`), and with no sidecar records the gate `[login]` with no node.
async fn rebuild(daemon: &RunningDaemon, login: &str) {
    daemon
        .state
        .mesh
        .start(MeshMode::Linked, Some(login.to_owned()))
        .await
        .expect("start");
}

fn join(dir: &Path, segments: &[&str]) -> PathBuf {
    segments
        .iter()
        .fold(dir.to_path_buf(), |path, segment| path.join(segment))
}

/// The drive root's `serves` folder, from the generated registry rows.
fn serves(dir: &Path) -> PathBuf {
    join(dir, file_transfer_roots::DRIVE_OBJECTS_SERVES)
}

/// The drive root's `lands` folder, from the generated registry rows.
fn lands(dir: &Path) -> PathBuf {
    join(dir, file_transfer_roots::DRIVE_OBJECTS_LANDS)
}

fn served_objects(dir: &Path) -> BTreeMap<String, PathBuf> {
    BTreeMap::from([(DRIVE_OBJECTS.to_owned(), serves(dir))])
}

fn digest(n: u64) -> String {
    format!("{n:02x}").repeat(32)
}

fn transfer_id(n: u64) -> String {
    format!("01JC8ZK4W2MX7N3Q5R9T6V0B{n:02}")
}

/// The drive's path for an object: its shard, then its digest.
fn path_of(digest: &str) -> String {
    format!("{}/{digest}", &digest[..2])
}

fn landed(n: u64) -> String {
    format!("{}.{}", digest(n), transfer_id(n))
}

fn pull_params(n: u64) -> Value {
    json!({
        "transferId": transfer_id(n),
        "peer": PEER,
        "root": DRIVE_OBJECTS,
        "path": path_of(&digest(n)),
        "digest": digest(n),
    })
}

/// The `*.truffle-tmp` names in `lands`, sorted.
fn temps(lands: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(lands) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name.ends_with(".truffle-tmp"))
        .collect();
    names.sort();
    names
}

async fn wait_until(what: &str, ready: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn golden(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts/fixtures")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn parse<T: DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("{e}: {value}"))
}

fn error_data(reply: &Value) -> ErrorData {
    parse(&reply["error"]["data"])
}

/// A `.delta` note's payload through the generated type. typify makes it an
/// untagged enum whose `kind` is a free string, so the shape that parsed and
/// the word it carries are asserted to agree.
fn delta(note: &Value) -> NativeFileTransferDelta {
    let delta: NativeFileTransferDelta = parse(&note["params"]["payload"]);
    let shape = match &delta {
        NativeFileTransferDelta::Variant0 { .. } => "progress",
        NativeFileTransferDelta::Variant1 { .. } => "completed",
        NativeFileTransferDelta::Variant2 { .. } => "failed",
    };
    assert_eq!(
        kind_of(&delta),
        shape,
        "a delta's kind is its shape's: {note}"
    );
    delta
}

fn kind_of(delta: &NativeFileTransferDelta) -> &str {
    match delta {
        NativeFileTransferDelta::Variant0 { kind, .. }
        | NativeFileTransferDelta::Variant1 { kind, .. }
        | NativeFileTransferDelta::Variant2 { kind, .. } => kind,
    }
}

/// The failed delta's word, or a panic naming what came instead.
fn failed_reason(delta: NativeFileTransferDelta) -> String {
    match delta {
        NativeFileTransferDelta::Variant2 {
            reason, message, ..
        } => {
            assert!(!message.is_empty(), "the floor says what happened");
            reason
        }
        other => panic!("expected failed: {other:?}"),
    }
}

#[cfg(unix)]
fn mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

/// Row 1 — rider A, steps 2 and 3: with no node, `roots` and `pull` answer the
/// node gate's UNAVAILABLE (`MeshNotUpDetails`, retryable: a state, never a
/// capability), even for params the floor cannot read (step 3 before step 5),
/// and `subscribe` is answered all the same, with an empty snapshot, because
/// its stream outlives nodes (rider B).
/// Probe: gate `subscribe` on the node in `mgmt/file_transfer.rs` → the
/// subscribe asserts red; read the params before the facade's node gate → the
/// unreadable `{}` answers PRECONDITION_FAILED -32005, not the gate's -32006.
#[tokio::test]
async fn with_no_node_roots_and_pull_answer_the_node_gate_and_subscribe_answers() {
    let (dir, daemon) = boot().await;
    install(dir.path(), &daemon, |arm| arm);
    assert_eq!(daemon.state.mesh.file_transfer().arm(), "named-roots");
    assert!(
        !daemon.state.mesh.node_present(),
        "the default posture has no node"
    );
    let mut mgmt = Mgmt::connect(&daemon).await;
    for (method, params) in [
        (ROOTS, json!({"roots": [DRIVE_OBJECTS]})),
        (PULL, pull_params(1)),
        (ROOTS, json!({})),
        (PULL, json!({})),
    ] {
        let reply = mgmt.call(method, params).await;
        assert_eq!(reply["error"]["code"], -32006, "{method}: {reply}");
        let data = error_data(&reply);
        assert_eq!(data.kind, ErrorKind::Unavailable, "{method}");
        assert!(data.retryable, "{method}: the node gate is a state");
        let details: MeshNotUpDetails = parse(data.details.as_ref().expect("the gate's details"));
        assert_eq!(details.service, "mesh-gateway", "{method}");
    }
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    assert!(sub["result"]["subId"].is_string(), "{sub}");
    let snapshot: NativeFileTransferSnapshot = parse(&sub["result"]["snapshot"]);
    assert!(snapshot.transfers.is_empty());
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 2 — rider A, step 4: while the login is captured, `roots` and `pull`
/// are refused MESH_CAPTURING, as `serve.add` is, even for params the floor
/// cannot read (step 4 before step 5), and with no node they answer the node
/// gate first (step 3 before step 4); `subscribe` passes.
/// Probe: drop the capture check in `mgmt/file_transfer.rs` → `roots` answers
/// a result; read the params before it → the unreadable pull's -32005 carries
/// no MESH_CAPTURING; check the capture before the node gate → the no-node
/// `roots` answers -32005.
#[tokio::test]
async fn in_capture_mode_roots_and_pull_are_refused_and_subscribe_passes() {
    let (dir, daemon) = boot().await;
    install(dir.path(), &daemon, |arm| arm);
    daemon
        .state
        .mesh
        .start(MeshMode::Capture, None)
        .await
        .expect("start");
    let mut mgmt = Mgmt::connect(&daemon).await;
    let gate = mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await;
    assert_eq!(gate["error"]["code"], -32006, "no node, captured: {gate}");
    let data = error_data(&gate);
    assert_eq!(data.kind, ErrorKind::Unavailable);
    let _: MeshNotUpDetails = parse(data.details.as_ref().expect("the gate's details"));

    daemon.state.mesh.force_node_presence_for_tests(true);
    let pulls = attach(&daemon).await;
    let mut unreadable = pull_params(1);
    unreadable["path"] = json!("/Users/james/vf/users/1/drive/objects/01");
    for (method, params) in [
        (ROOTS, json!({"roots": [DRIVE_OBJECTS]})),
        (PULL, pull_params(1)),
        (PULL, unreadable),
    ] {
        let reply = mgmt.call(method, params).await;
        assert_eq!(reply["error"]["code"], -32005, "{method}: {reply}");
        let data = error_data(&reply);
        assert_eq!(data.kind, ErrorKind::PreconditionFailed, "{method}");
        assert_eq!(
            data.details.as_ref().map(|d| d["code"].clone()),
            Some(json!("MESH_CAPTURING")),
            "{method}: {reply}"
        );
    }
    assert!(
        pulls.calls().is_empty(),
        "nothing is pulled while capturing"
    );
    assert!(
        pulls.served().is_empty(),
        "nothing is served while capturing"
    );
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    let snapshot: NativeFileTransferSnapshot = parse(&sub["result"]["snapshot"]);
    assert!(snapshot.transfers.is_empty());
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 3 — rider A, step 5: params the floor cannot read are PRECONDITION_FAILED,
/// read through the generated types: an absolute path, a `..` segment, a root
/// that is not a named root, a lower-case id. None reaches the substrate.
/// Probe: read the params with `Value::get` instead of the generated types →
/// the absolute path is pulled.
#[tokio::test]
async fn a_request_the_floor_cannot_read_is_a_precondition_failure() {
    let (_dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    for params in [
        json!({"roots": ["drive-incoming"]}),
        json!({"roots": DRIVE_OBJECTS}),
        json!({}),
    ] {
        let reply = mgmt.call(ROOTS, params.clone()).await;
        assert_eq!(reply["error"]["code"], -32005, "{params}: {reply}");
        assert_eq!(
            error_data(&reply).kind,
            ErrorKind::PreconditionFailed,
            "{params}"
        );
    }
    for (field, value) in [
        ("path", "/Users/james/vf/users/1/drive/objects/01"),
        ("path", "01/../../keys"),
        ("root", "drive-incoming"),
        ("transferId", "01jc8zk4w2mx7n3q5r9t6v0b01"),
    ] {
        let mut params = pull_params(1);
        params[field] = json!(value);
        let reply = mgmt.call(PULL, params).await;
        assert_eq!(reply["error"]["code"], -32005, "{field}={value}: {reply}");
        assert_eq!(
            error_data(&reply).kind,
            ErrorKind::PreconditionFailed,
            "{field}={value}"
        );
    }
    assert!(
        pulls.calls().is_empty(),
        "no unreadable pull reached the node"
    );
    assert!(pulls.served().is_empty(), "no unreadable set was served");
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 4 — rider A, step 6, on a node built UNGATED: each root answers
/// `registered: false` with ROOT_UNGATED (the golden), no folder is made, and
/// the set is HELD: the next node built gated for the same login serves it with
/// no declaration (nit 8, as the critic's finding 0 rewrote it).
/// Probe: clear the held set on a `gate_changed` detach → the second node
/// serves nothing; make the folders before the gate → `drive/` exists.
#[tokio::test]
async fn an_ungated_node_holds_the_roots_and_serves_them_from_the_next_gated_node_of_the_login() {
    let (dir, daemon) = boot().await;
    install(dir.path(), &daemon, |arm| arm);
    daemon.state.mesh.record_gate_for_tests(LOGIN, false);
    daemon.state.mesh.force_node_presence_for_tests(true);
    let first = attach(&daemon).await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let reply = mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await;
    let answered: NativeFileTransferRootsResult = parse(&reply["result"]);
    assert_eq!(answered.roots.len(), 1);
    assert_eq!(answered.roots[0].name, FileTransferRootName::DriveObjects);
    assert!(!answered.roots[0].registered);
    assert_eq!(
        answered.roots[0].reason.as_deref(),
        Some(mesh_file_transfer::ROOT_UNGATED)
    );
    assert_eq!(
        reply["result"],
        golden("native-file-transfer-roots-result.ungated.json")
    );
    assert!(first.served().is_empty(), "an ungated node serves nothing");
    assert!(
        !join(dir.path(), layout::DRIVE_DIR).exists(),
        "no folder is made for a root an ungated node cannot serve"
    );

    rebuild(&daemon, LOGIN).await;
    let second = attach(&daemon).await;
    assert_eq!(
        second.served(),
        served_objects(dir.path()),
        "the held set is served from the next node built gated for its login"
    );
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 5 — a node built GATED: the root registers (the golden), both folders exist
/// at 0700, the `serves` folder is served under the name and the `lands` one
/// never; the node is capped at OBJECT_MAX_BYTES and refuses pushes once; a
/// repeat serves nothing again; `[]` unserves.
/// Probe: serve `lands` → the served map reds; drop the already-serving check
/// → `serve_calls` is 2; skip `set_cap` → `cap()` is None.
#[tokio::test]
async fn a_gated_node_serves_objects_never_what_lands_and_a_repeat_is_a_no_op() {
    let (dir, daemon, pulls) = gated_floor().await;
    assert_eq!(pulls.cap(), Some(drive_limits::OBJECT_MAX_BYTES));
    assert_eq!(pulls.pushes_refused(), 1);
    let mut mgmt = Mgmt::connect(&daemon).await;
    let reply = mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await;
    let answered: NativeFileTransferRootsResult = parse(&reply["result"]);
    assert!(answered.roots[0].registered, "{reply}");
    assert!(answered.roots[0].reason.is_none());
    assert_eq!(
        reply["result"],
        golden("native-file-transfer-roots-result.valid.json")
    );
    let (serves, lands) = (serves(dir.path()), lands(dir.path()));
    assert!(serves.is_dir() && lands.is_dir());
    #[cfg(unix)]
    {
        assert_eq!(mode(&serves), 0o700);
        assert_eq!(mode(&lands), 0o700);
    }
    assert_eq!(pulls.served(), served_objects(dir.path()));
    assert!(
        pulls.served().values().all(|folder| folder != &lands),
        "what lands is never served"
    );
    assert_eq!(pulls.serve_calls(), 1);

    let again = mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await;
    let again: NativeFileTransferRootsResult = parse(&again["result"]);
    assert!(again.roots[0].registered);
    assert_eq!(pulls.serve_calls(), 1, "a repeat is a no-op");
    assert_eq!(pulls.served(), served_objects(dir.path()));

    let none = mgmt.call(ROOTS, json!({"roots": []})).await;
    let none: NativeFileTransferRootsResult = parse(&none["result"]);
    assert!(none.roots.is_empty());
    assert!(pulls.served().is_empty(), "an empty set serves none");
    assert_eq!(pulls.pushes_refused(), 1, "once per node");
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 6 — the critic's finding 11: a `drive/` the floor makes is 0700, a
/// leaf that exists wider is set to 0700, and a `drive/` the floor did not
/// make (mille's root) is left as it is: never `harden_state_dir`'s recursion.
/// EL7: a link where a leaf belongs (a same-uid agent's, to a folder it chose)
/// is refused FAILED_IO, and the folder it names is neither narrowed nor
/// served.
/// Probe: set the mode only on a folder the floor creates → the 0755 leaf
/// stays 0755; set it on every ancestor → mille's `drive/` reads 0700; accept
/// an entry that exists without reading what it is → the link registers and
/// `elsewhere` reads 0700.
#[cfg(unix)]
#[tokio::test]
async fn the_leaves_are_0700_always_and_a_drive_folder_the_floor_makes_is_0700() {
    let (dir, daemon, pulls) = gated_floor().await;
    let drive = join(dir.path(), layout::DRIVE_DIR);
    let (serves, lands) = (serves(dir.path()), lands(dir.path()));
    assert!(!drive.exists());
    let mut mgmt = Mgmt::connect(&daemon).await;
    let first: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(first.roots[0].registered);
    assert_eq!(mode(&drive), 0o700, "a drive/ the floor makes is 0700");

    // mille's own drive/, made before the floor's declaration, with a leaf
    let none: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": []})).await["result"]);
    assert!(none.roots.is_empty());
    std::fs::remove_dir_all(&drive).unwrap();
    std::fs::create_dir(&drive).unwrap();
    set_mode(&drive, 0o755);
    std::fs::create_dir(&serves).unwrap();
    set_mode(&serves, 0o755);
    let second: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(second.roots[0].registered);
    assert_eq!(mode(&serves), 0o700, "a leaf that exists is set to 0700");
    assert_eq!(mode(&lands), 0o700, "a leaf the floor makes is 0700");
    assert_eq!(
        mode(&drive),
        0o755,
        "a drive/ the floor did not make is not the floor's to narrow"
    );

    // a link where the `serves` leaf belongs, to a folder elsewhere
    let none: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": []})).await["result"]);
    assert!(none.roots.is_empty());
    let elsewhere = dir.path().join("elsewhere");
    std::fs::create_dir(&elsewhere).unwrap();
    set_mode(&elsewhere, 0o755);
    std::fs::remove_dir(&serves).unwrap();
    std::os::unix::fs::symlink(&elsewhere, &serves).unwrap();
    let linked: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(!linked.roots[0].registered);
    assert_eq!(
        linked.roots[0].reason.as_deref(),
        Some(mesh_file_transfer::FAILED_IO)
    );
    assert_eq!(mode(&elsewhere), 0o755, "what a link names is not narrowed");
    assert!(
        pulls.served().is_empty(),
        "nor served: {:?}",
        pulls.served()
    );
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 7 — registering a root sweeps every `*.truffle-tmp` in its `lands` folder
/// that no running pull owns, keeps a running pull's, and never touches a
/// landed name (fieldd's to adopt or sweep).
/// Probe: sweep every temporary → the running pull's is gone; skip the sweep
/// on a repeat → the orphan stays.
#[tokio::test]
async fn registering_sweeps_orphan_temporaries_and_keeps_a_running_pulls() {
    let (dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let first: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(first.roots[0].registered);
    let lands = lands(dir.path());
    let orphan = lands.join(format!("{}.t9.truffle-tmp", landed(9)));
    std::fs::write(&orphan, b"a pull an earlier floor ran").unwrap();
    let unverified = lands.join(landed(8));
    std::fs::write(&unverified, b"landed, unverified").unwrap();
    pulls.script(&path_of(&digest(1)), Scripted::Hold);
    let reply = mgmt.call(PULL, pull_params(1)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    let running = format!("{}.", landed(1));
    wait_until("the running pull's temporary", || {
        temps(&lands).iter().any(|name| name.starts_with(&running))
    })
    .await;

    let again: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(again.roots[0].registered);
    assert!(
        !orphan.exists(),
        "a temporary no running pull owns is swept"
    );
    let left = temps(&lands);
    assert_eq!(left.len(), 1, "{left:?}");
    assert!(
        left[0].starts_with(&running),
        "a running pull keeps its temporary: {left:?}"
    );
    assert!(
        unverified.exists(),
        "a landed name is fieldd's to adopt or sweep"
    );
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 8 — a pull is answered `{transferId}` at once and runs on its own: the
/// serial mesh worker answers `serve.list` and `roots` while it is held open,
/// and the stream's snapshot lists it. The floor names its own landing path
/// to the substrate, `<lands>/<digest>.<transferId>`, never the holder's.
/// `serve.list` answers the mesh facade's node gate: the forced presence is
/// no node (`MeshHandle::node` is `None`), so -32006 is its answer.
/// Probe: await the pull in the handler → the pull's call reds at BUDGET.
#[tokio::test]
async fn a_pull_is_answered_at_once_and_the_worker_answers_while_it_runs() {
    let (dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    pulls.script(&path_of(&digest(1)), Scripted::Hold);
    let reply = mgmt.call(PULL, pull_params(1)).await;
    let answered: NativeFileTransferPullResult = parse(&reply["result"]);
    assert_eq!(answered.transfer_id.as_str(), transfer_id(1));

    let listed = mgmt.call("native.mesh.serve.list", json!({})).await;
    assert_eq!(listed["error"]["code"], -32006, "{listed}");
    let data = error_data(&listed);
    assert_eq!(data.kind, ErrorKind::Unavailable);
    let _: MeshNotUpDetails = parse(data.details.as_ref().expect("the gate's details"));
    let roots: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(roots.roots[0].registered);

    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    let snapshot: NativeFileTransferSnapshot = parse(&sub["result"]["snapshot"]);
    assert_eq!(snapshot.transfers.len(), 1, "{sub}");
    let row = &snapshot.transfers[0];
    assert_eq!(row.transfer_id.as_str(), transfer_id(1));
    assert_eq!(row.peer, PEER);
    assert_eq!(row.root, FileTransferRootName::DriveObjects);
    assert_eq!(row.digest.as_str(), digest(1));
    assert_eq!(row.bytes, 0);

    wait_until("the pull reached the substrate", || {
        !pulls.calls().is_empty()
    })
    .await;
    let call = pulls.calls()[0].clone();
    assert_eq!(call.peer, PEER);
    assert_eq!(call.root, FileTransferRootName::DriveObjects);
    assert_eq!(call.path, path_of(&digest(1)));
    assert_eq!(call.into, lands(dir.path()).join(landed(1)));
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 9 — nit 9: a second pull under a live transferId, or of a digest a running
/// pull holds under any transferId, is refused CONFLICT -32004, retryable
/// false, the golden key for key; neither reaches the substrate, and a pull
/// fresh in both still runs.
/// Probe: drop the by-digest index → the running digest is accepted.
#[tokio::test]
async fn a_live_transfer_id_or_a_running_digest_is_a_conflict() {
    let (_dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    pulls.script(&path_of(&digest(1)), Scripted::Hold);
    let first = mgmt.call(PULL, pull_params(1)).await;
    let _: NativeFileTransferPullResult = parse(&first["result"]);
    let conflict = golden("error-data.file-transfer-conflict.json");
    let mut same_id = pull_params(2);
    same_id["transferId"] = json!(transfer_id(1));
    let mut same_digest = pull_params(1);
    same_digest["transferId"] = json!(transfer_id(2));
    for (what, params) in [
        ("a live transferId", same_id),
        ("a running digest", same_digest),
    ] {
        let reply = mgmt.call(PULL, params).await;
        assert_eq!(reply["error"]["code"], -32004, "{what}: {reply}");
        let data = error_data(&reply);
        assert_eq!(data.kind, ErrorKind::Conflict, "{what}");
        assert!(!data.retryable, "{what}");
        assert_eq!(reply["error"]["data"], conflict, "{what}: the golden");
    }
    pulls.script(&path_of(&digest(3)), Scripted::Hold);
    let third = mgmt.call(PULL, pull_params(3)).await;
    let _: NativeFileTransferPullResult = parse(&third["result"]);
    wait_until("two pulls reached the substrate", || {
        pulls.calls().len() == 2
    })
    .await;
    assert!(pulls
        .calls()
        .iter()
        .all(|call| call.path != path_of(&digest(2))));
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 10 — past DRIVE_LIMITS.PULLS_IN_FLIGHT the next pull is
/// RESOURCE_EXHAUSTED -32010, retryable (a slot frees when a pull ends), with
/// no details, since C1 names none; and CONFLICT comes first (the header's
/// step 6).
/// Probe: check the bound before CONFLICT → the live id answers -32010; answer
/// it retryable false, or with details → the shape asserts red.
#[tokio::test]
async fn a_pull_past_the_bound_is_resource_exhausted() {
    let (_dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let bound = drive_limits::PULLS_IN_FLIGHT;
    for n in 1..=bound {
        pulls.script(&path_of(&digest(n)), Scripted::Hold);
        let reply = mgmt.call(PULL, pull_params(n)).await;
        let _: NativeFileTransferPullResult = parse(&reply["result"]);
    }
    let past = mgmt.call(PULL, pull_params(bound + 1)).await;
    assert_eq!(past["error"]["code"], -32010, "{past}");
    let data = error_data(&past);
    assert_eq!(data.kind, ErrorKind::ResourceExhausted);
    assert!(data.retryable, "{past}");
    assert!(data.details.is_none(), "{past}");
    let mut live = pull_params(bound + 2);
    live["transferId"] = json!(transfer_id(1));
    let reply = mgmt.call(PULL, live).await;
    assert_eq!(error_data(&reply).kind, ErrorKind::Conflict, "{reply}");
    wait_until("the bound's pulls reached the substrate", || {
        pulls.calls().len() as u64 == bound
    })
    .await;
    assert!(pulls
        .calls()
        .iter()
        .all(|call| call.path != path_of(&digest(bound + 1))));
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 11 — progress reaches the stream at most once per
/// PROGRESS_MIN_INTERVAL_MS a pull; `completed` carries the transferId, the
/// digest, the landed name, the bytes and the substrate's SHA-256, and the file
/// is in place when it is read. A completed pull leaves the snapshot.
/// Probe: send every progress → the count passes the bound; send `completed`
/// before the file is placed → the read reds.
#[tokio::test]
async fn progress_is_throttled_and_completed_comes_with_its_file_in_place() {
    let (dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    let sub_id = sub["result"]["subId"].clone();
    let body = vec![7u8; 48_213];
    pulls.script(
        &path_of(&digest(1)),
        Scripted::Land {
            body: body.clone(),
            sha256: SHA256.into(),
            progress: (1..=30).map(|i| i * 1_600).collect(),
            every: Duration::from_millis(20),
        },
    );
    let started = Instant::now();
    let reply = mgmt.call(PULL, pull_params(1)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    let mut reported: u128 = 0;
    let end = loop {
        let note = mgmt.note(DELTA).await;
        assert_eq!(note["params"]["subId"], sub_id);
        match delta(&note) {
            NativeFileTransferDelta::Variant0 {
                transfer_id: id,
                bytes,
                total,
                ..
            } => {
                assert_eq!(id.as_str(), transfer_id(1));
                assert_eq!(total, body.len() as u64);
                assert!(bytes <= total);
                reported += 1;
            }
            other => break other,
        }
    };
    let elapsed = started.elapsed().as_millis();
    let interval = u128::from(mesh_file_transfer::PROGRESS_MIN_INTERVAL_MS);
    assert!(reported >= 1, "a pull's first progress is sent");
    assert!(
        reported <= 1 + elapsed / interval,
        "at most one progress per {interval} ms: {reported} in {elapsed} ms"
    );
    let (id, object, incoming, bytes, sha256) = match end {
        NativeFileTransferDelta::Variant1 {
            transfer_id,
            digest,
            incoming,
            bytes,
            sha256,
            ..
        } => (transfer_id, digest, incoming, bytes, sha256),
        other => panic!("expected completed: {other:?}"),
    };
    assert_eq!(id.as_str(), transfer_id(1));
    assert_eq!(object.as_str(), digest(1));
    assert_eq!(incoming.as_str(), landed(1));
    assert_eq!(bytes, body.len() as u64);
    assert_eq!(sha256.as_str(), SHA256);
    let lands = lands(dir.path());
    assert_eq!(
        std::fs::read(lands.join(incoming.as_str())).unwrap(),
        body,
        "the file is in place when `completed` is read"
    );
    assert!(temps(&lands).is_empty());
    let after = mgmt.call(SUBSCRIBE, json!({})).await;
    let snapshot: NativeFileTransferSnapshot = parse(&after["result"]["snapshot"]);
    assert!(snapshot.transfers.is_empty(), "a pull that ended is gone");
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 12 — `failed` says its MESH_FILE_TRANSFER word, and nothing of its pull
/// is left when it is read: not the landed file (placed, then the pull
/// failed), not the pull's temporaries. NO_SPACE for a disk that refused, IO
/// for a read that broke (its temporary left behind), REJECTED for a file the
/// holder does not serve. That the send comes after the removal is held by
/// `finish`'s structure (one synchronous fn, files first), which no reader on
/// this runtime can see between.
/// Probe: skip `remove_landed` on an Err in `finish` → the exists assert reds;
/// skip `remove_temps` → the temporaries assert reds; map NoSpace to `io` →
/// the word reds.
#[tokio::test]
async fn failed_says_its_word_after_the_landed_file_and_temporaries_are_gone() {
    let (dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    let sub_id = sub["result"]["subId"].clone();
    let lands = lands(dir.path());
    pulls.script(
        &path_of(&digest(1)),
        Scripted::PlaceThenFail(PullFailure::NoSpace("no space left on device".into())),
    );
    pulls.script(
        &path_of(&digest(2)),
        Scripted::FailLeavingTemp(PullFailure::Io("connection reset by peer".into())),
    );
    // pull 3's path is scripted for nothing: the holder's one word
    for (n, word) in [
        (1, mesh_file_transfer::FAILED_NO_SPACE),
        (2, mesh_file_transfer::FAILED_IO),
        (3, mesh_file_transfer::FAILED_REJECTED),
    ] {
        let reply = mgmt.call(PULL, pull_params(n)).await;
        let _: NativeFileTransferPullResult = parse(&reply["result"]);
        let (note, end) = mgmt.end_of(&transfer_id(n)).await;
        assert_eq!(note["params"]["subId"], sub_id);
        assert_eq!(failed_reason(end), word, "pull {n}");
        assert!(
            !lands.join(landed(n)).exists(),
            "pull {n}: nothing is left landed when `failed` is read"
        );
        let own = format!("{}.", landed(n));
        assert!(
            temps(&lands).iter().all(|name| !name.starts_with(&own)),
            "pull {n}: its temporaries are gone first"
        );
    }
    let after = mgmt.call(SUBSCRIBE, json!({})).await;
    let snapshot: NativeFileTransferSnapshot = parse(&after["result"]["snapshot"]);
    assert!(snapshot.transfers.is_empty());
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 13 — W3-4: a pull no byte reaches within the floor's idle bound fails
/// TIMEOUT, its temporary gone; a pull that keeps reporting outlives the
/// bound, because progress resets it. The bound is 2 s and the reporting pull
/// runs 4 s, 40 reports 100 ms apart, so only a stall of 1.9 s between two
/// reports on a loaded host could end it early.
/// Probe: never fire the idle bound → `end_of` reds at BUDGET; skip the reset
/// on progress → pull 2 fails `timeout`.
#[tokio::test]
async fn a_stalled_pull_fails_timeout_at_the_idle_bound_and_progress_resets_it() {
    let (dir, daemon, pulls) =
        gated_floor_with(|arm| arm.with_idle_bound(Duration::from_secs(2))).await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    assert!(sub["result"]["subId"].is_string(), "{sub}");
    let _: NativeFileTransferSnapshot = parse(&sub["result"]["snapshot"]);
    let lands = lands(dir.path());
    pulls.script(&path_of(&digest(1)), Scripted::Stall);
    let reply = mgmt.call(PULL, pull_params(1)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    let (_, end) = mgmt.end_of(&transfer_id(1)).await;
    assert_eq!(failed_reason(end), mesh_file_transfer::FAILED_TIMEOUT);
    assert!(temps(&lands).is_empty(), "{:?}", temps(&lands));
    assert_eq!(pulls.in_flight(), 0, "the stalled pull was dropped");

    pulls.script(
        &path_of(&digest(2)),
        Scripted::Land {
            body: vec![1u8; 1_000],
            sha256: SHA256.into(),
            progress: (1..=40).map(|i| i * 25).collect(),
            every: Duration::from_millis(100),
        },
    );
    let reply = mgmt.call(PULL, pull_params(2)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    let (_, end) = mgmt.end_of(&transfer_id(2)).await;
    assert!(
        matches!(end, NativeFileTransferDelta::Variant1 { .. }),
        "a pull that reports outlives the bound: {end:?}"
    );
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 14 — rider B and the critic's finding 1: a teardown mid-pull sends
/// `failed` NODE_DOWN on the SAME subscription, its files gone; the held roots
/// return at the next node built gated for the same login, through the one
/// install hook, with no declaration; and the stream carries the next node's
/// pulls. That a teardown's pull leaves the table only after its files is
/// services/file_transfer.rs's in-crate teardown row, on a multi-thread
/// runtime: this one runs `detach` whole inside `rebuild`, so no reader here
/// can see between its steps.
/// Probe: clear the held set on every detach → the second node serves
/// nothing; gate the stream on the node → the second end reds at BUDGET; skip
/// `detach`'s cleanup → the temporaries assert reds.
#[tokio::test]
async fn a_teardown_fails_a_running_pull_node_down_on_the_same_stream_and_the_roots_return() {
    let (dir, daemon, first) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let declared: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(declared.roots[0].registered);
    assert_eq!(first.served(), served_objects(dir.path()));
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    let sub_id = sub["result"]["subId"].clone();
    let lands = lands(dir.path());
    first.script(&path_of(&digest(1)), Scripted::Hold);
    let reply = mgmt.call(PULL, pull_params(1)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    let own = format!("{}.", landed(1));
    wait_until("the pull's temporary", || {
        temps(&lands).iter().any(|name| name.starts_with(&own))
    })
    .await;

    rebuild(&daemon, LOGIN).await;
    let (note, end) = mgmt.end_of(&transfer_id(1)).await;
    assert_eq!(note["params"]["subId"], sub_id, "the SAME subscription");
    assert_eq!(failed_reason(end), mesh_file_transfer::FAILED_NODE_DOWN);
    assert!(temps(&lands).is_empty(), "{:?}", temps(&lands));
    assert!(!lands.join(landed(1)).exists());
    assert_eq!(first.in_flight(), 0, "the teardown ended the pull");

    let second = attach(&daemon).await;
    assert_eq!(
        second.served(),
        served_objects(dir.path()),
        "the held roots return with the next gated node of the login"
    );
    assert_eq!(second.cap(), Some(drive_limits::OBJECT_MAX_BYTES));
    assert_eq!(second.pushes_refused(), 1);
    second.script(
        &path_of(&digest(2)),
        Scripted::land(b"after the rebuild", SHA256),
    );
    let reply = mgmt.call(PULL, pull_params(2)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    let (note, end) = mgmt.end_of(&transfer_id(2)).await;
    assert_eq!(note["params"]["subId"], sub_id);
    assert!(
        matches!(end, NativeFileTransferDelta::Variant1 { .. }),
        "{end:?}"
    );
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 15 — the critic's finding 0: a retire (an unlink) drops the held set, and so
/// does a stop; the next node, gated for the same login, serves nothing until
/// fieldd declares.
/// Probe: keep the held set across a `retired` detach → the second node
/// serves the old set.
#[tokio::test]
async fn a_retire_or_a_stop_drops_the_held_roots() {
    let (dir, daemon, first) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let declared: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(declared.roots[0].registered);
    assert_eq!(first.served(), served_objects(dir.path()));

    daemon.state.mesh.retire().await;
    daemon.state.mesh.record_gate_for_tests(LOGIN, true);
    let second = attach(&daemon).await;
    assert!(
        second.served().is_empty(),
        "an unlink drops the held roots: {:?}",
        second.served()
    );
    let declared: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(declared.roots[0].registered);
    assert_eq!(second.served(), served_objects(dir.path()));

    daemon.state.mesh.stop().await;
    daemon.state.mesh.record_gate_for_tests(LOGIN, true);
    let third = attach(&daemon).await;
    assert!(
        third.served().is_empty(),
        "a stop drops them too: {:?}",
        third.served()
    );
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 16 — the critic's finding 0: a node gated for ANOTHER login serves nothing
/// from the held set until fieldd declares; the declaration binds the set to
/// that login, whose next node serves it.
/// Probe: serve the held set on any gated attach, whatever its login → the
/// second node serves the first login's set.
#[tokio::test]
async fn a_node_gated_for_another_login_serves_nothing_until_fieldd_declares() {
    let (dir, daemon, first) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let declared: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(declared.roots[0].registered);
    assert_eq!(first.served(), served_objects(dir.path()));

    rebuild(&daemon, OTHER_LOGIN).await;
    let second = attach(&daemon).await;
    assert!(
        second.served().is_empty(),
        "another login's node serves nothing it did not declare: {:?}",
        second.served()
    );
    assert_eq!(second.cap(), Some(drive_limits::OBJECT_MAX_BYTES));
    assert_eq!(second.pushes_refused(), 1);
    let declared: NativeFileTransferRootsResult =
        parse(&mgmt.call(ROOTS, json!({"roots": [DRIVE_OBJECTS]})).await["result"]);
    assert!(declared.roots[0].registered);
    assert_eq!(second.served(), served_objects(dir.path()));

    rebuild(&daemon, OTHER_LOGIN).await;
    let third = attach(&daemon).await;
    assert_eq!(
        third.served(),
        served_objects(dir.path()),
        "the set is now the other login's"
    );
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 17 — a reader that lags the stream is sent a `.snapshot`, never a gap:
/// the pulls running when it was sent, so a pull it does not list ended, and
/// its landed file says completed (the contract's resync rule).
/// It relies on `#[tokio::test]`'s current-thread runtime and its FIFO run
/// queue: the three released pulls each end in one poll, before the forwarder
/// their first end wakes, so the one-event stream lags, and the snapshot lists
/// pull 4 alone. A multi-thread flavor could forward between the ends.
/// Probe: forward past a Lagged as if nothing were lost → no snapshot comes
/// and `note` reds at BUDGET.
#[tokio::test]
async fn a_lagging_reader_is_sent_a_snapshot() {
    let (dir, daemon, pulls) = gated_floor_with(|arm| arm.with_stream_capacity(1)).await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    let sub_id = sub["result"]["subId"].clone();
    let lands = lands(dir.path());
    for n in 1..=4 {
        pulls.script(&path_of(&digest(n)), Scripted::Hold);
        let reply = mgmt.call(PULL, pull_params(n)).await;
        let _: NativeFileTransferPullResult = parse(&reply["result"]);
    }
    wait_until("four pulls hold their temporaries", || {
        temps(&lands).len() == 4
    })
    .await;
    for n in 1..=3 {
        assert!(pulls.release(&path_of(&digest(n)), Scripted::land(b"released", SHA256)));
    }
    let note = mgmt.note(SNAPSHOT).await;
    assert_eq!(note["params"]["subId"], sub_id);
    let snapshot: NativeFileTransferSnapshot = parse(&note["params"]["payload"]);
    let listed: Vec<String> = snapshot
        .transfers
        .iter()
        .map(|row| row.transfer_id.as_str().to_owned())
        .collect();
    assert_eq!(
        listed,
        vec![transfer_id(4)],
        "only the pull still running is listed"
    );
    for n in 1..=3 {
        assert!(
            lands.join(landed(n)).exists(),
            "pull {n} is not listed, so it ended, and its landed file says completed"
        );
    }
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 18 — the critic's finding 3: a teardown with a stalled pull returns
/// within a bound (the tasks are taken and the lock dropped, the tasks
/// aborted, then joined), and the pull ends `failed` NODE_DOWN with its
/// temporary gone.
/// Probe: join the stalled task before aborting it → the BUDGET deadline reds.
#[tokio::test]
async fn a_teardown_with_a_stalled_pull_returns_within_its_bound() {
    let (dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let sub = mgmt.call(SUBSCRIBE, json!({})).await;
    assert!(sub["result"]["subId"].is_string(), "{sub}");
    let _: NativeFileTransferSnapshot = parse(&sub["result"]["snapshot"]);
    let lands = lands(dir.path());
    pulls.script(&path_of(&digest(1)), Scripted::Stall);
    let reply = mgmt.call(PULL, pull_params(1)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    wait_until("the stalled pull's temporary", || temps(&lands).len() == 1).await;

    let torn = timeout(BUDGET, rebuild(&daemon, LOGIN)).await;
    assert!(torn.is_ok(), "a teardown never waits on a stalled pull");
    let (_, end) = mgmt.end_of(&transfer_id(1)).await;
    assert_eq!(failed_reason(end), mesh_file_transfer::FAILED_NODE_DOWN);
    assert_eq!(pulls.in_flight(), 0);
    assert!(temps(&lands).is_empty(), "{:?}", temps(&lands));
    drop(mgmt);
    daemon.shutdown().await;
}

/// Row 19 — item 196: the floor's shutdown with a pull running ends the pull's task
/// and leaves no temporary and no landed file behind.
/// Probe: drop the detach from `teardown_node` → the pull stays in flight and
/// its temporary stays.
#[tokio::test]
async fn shutdown_ends_a_running_pull_and_leaves_no_temporaries() {
    let (dir, daemon, pulls) = gated_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let lands = lands(dir.path());
    pulls.script(&path_of(&digest(1)), Scripted::Hold);
    let reply = mgmt.call(PULL, pull_params(1)).await;
    let _: NativeFileTransferPullResult = parse(&reply["result"]);
    wait_until("the pull's temporary", || temps(&lands).len() == 1).await;
    drop(mgmt);
    timeout(Duration::from_secs(30), daemon.shutdown())
        .await
        .expect("a floor with a pull running shuts down");
    assert_eq!(pulls.in_flight(), 0, "the pull's task ended with the floor");
    assert!(temps(&lands).is_empty(), "{:?}", temps(&lands));
    assert!(!lands.join(landed(1)).exists());
}
