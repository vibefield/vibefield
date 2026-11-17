//! OB custody (C3) — the floor is handed its pairing secret (contracts mgmt.ts
//! `NativeBootstrap`, registries.ts `CUSTODY`). Under `FIELD_NATIVE_CUSTODY=stdin` the floor reads ONE line from its
//! stdin and holds the secret in memory: it never makes, reads or removes `native/pairing`, and a line that is absent,
//! late, too long or not a bootstrap it reads is a refusal to boot that names no secret, never a fall back to the
//! file. With the flag unset it is today's file, untouched.
//!
//! Three kinds of row. The REAL binary with a piped stdin: the claim as fieldd meets it (the env flag, the pipe, the
//! exit code, the log). The reader alone, over text and pipes this file holds: the bounds to the byte, without the
//! registry's wait. And the in-process seam (`bootstrap_handed`), which other files' rows can boot a sealed floor
//! through, as `RunningDaemon.pairing_file` is the seam of a `files` one.
//!
//! Last, the binary's OTHER roles. Only the bare invocation, the daemon's, reads the flag and so a bootstrap line.
//! `field-native door` is run by any agent in a pane, with the stdin and the environment of its choosing: what it reads
//! there is the door's ordinary bytes, never a secret, with the flag set or not.
//!
//! Every secret here is a repeated byte: nothing in this file is a secret anyone holds.
#![cfg(unix)]

use field_native::custody::{read_bootstrap, stdin_requested, Refused};
use field_native::door_bridge::{EXIT_OK, EXIT_UNREACHABLE, EXIT_USAGE};
use field_native::registries::custody as registry;
use field_native::services::mesh_bridge::{encode_frame, FrameReader, FRAME_HELLO, FRAME_HELLO_OK};
use field_native::{bootstrap_handed, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::{timeout_at, Instant};

// Item 345: a floor this file spawns as a daemon takes the run's own socket alias parent, `RunAliasParent`, from the
// shared support, as native_logging.rs's does.
#[path = "support/native_child.rs"]
mod native_child;
use field_native::registries::SOCKET_ALIAS_PARENT_ENV;
use native_child::RunAliasParent;

/// The boot id this file's fieldd says its hellos under, and the challenge it offers (WIN-10).
const BOOT: &str = "fieldd-custody-test";
const NONCE: &str = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";

/// The fixture's secret (`native-bootstrap.valid.json`): the one a floor here is handed.
fn handed_hex() -> String {
    "b4".repeat(32)
}

/// A secret no floor here is ever handed.
fn other_hex() -> String {
    "c5".repeat(32)
}

fn secret_bytes(hex_secret: &str) -> [u8; 32] {
    let bytes = hex::decode(hex_secret).expect("hex");
    bytes.try_into().expect("32 bytes")
}

/// fieldd's bootstrap line, without its newline.
fn bootstrap_line(v: u64, pairing: &str) -> String {
    json!({"v": v, "pairing": pairing}).to_string()
}

/// The D8 credential under `secret`, with a challenge for the ack to answer.
fn credential(secret: &[u8]) -> Value {
    let ts = pairing::now_epoch_secs();
    let mac = pairing::compute_mac(secret, BOOT, ts);
    json!({"bootId": BOOT, "ts": ts, "mac": mac, "nonce": NONCE})
}

/// A data root and a log root of one row's own.
fn roots() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let fixture = tempfile::tempdir().expect("tempdir");
    let data_dir = fixture.path().join("data");
    let log_root = fixture.path().join("logs");
    (fixture, data_dir, log_root)
}

/// fieldd's management connection, as far as a pairing needs one.
struct Mgmt {
    reader: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    writer: tokio::net::unix::OwnedWriteHalf,
}

impl Mgmt {
    async fn connect(socket: &Path) -> Self {
        let stream = UnixStream::connect(socket).await.expect("connect mgmt");
        let (read, write) = stream.into_split();
        Self {
            reader: BufReader::new(read).lines(),
            writer: write,
        }
    }

    /// One request, and the line that answers it (the floor's ticks aside).
    async fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        let request = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        self.writer
            .write_all(format!("{request}\n").as_bytes())
            .await
            .expect("write mgmt");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let line = timeout_at(deadline, self.reader.next_line())
                .await
                .expect("mgmt response timeout")
                .expect("mgmt response read")
                .expect("mgmt connection closed");
            let value: Value = serde_json::from_str(&line).expect("mgmt response json");
            if value["id"] == json!(id) {
                return value;
            }
        }
    }

    /// One hello under `secret`, and the floor's answer to it.
    async fn hello(&mut self, secret: &[u8]) -> Value {
        let params = json!({
            "contractsVersion": "0.1.0", "minCompatible": "0.1.0", "clientKind": "fieldd",
            "credential": credential(secret),
        });
        self.call(1, "native.lifecycle.hello", params).await
    }

    /// The paired client's planned stop (`native.lifecycle.shutdown`): the floor answers, then runs the drain SIGTERM
    /// runs and exits 0. The verb and not the signal, because the floor keeps the request until main waits for it:
    /// a SIGTERM sent in the instant between the listener's bind and main's handler would end the floor undrained.
    async fn stop(&mut self) {
        let params = json!({"reason": "quit"});
        let answer = self.call(2, "native.lifecycle.shutdown", params).await;
        assert_eq!(answer["result"]["stopping"], true, "{answer}");
    }
}

/// The byte plane's hello under `secret` (`meshdata.sock`, the D8 handshake unchanged): did the floor answer HELLO_OK?
async fn byte_plane_pairs(daemon: &RunningDaemon, secret: &[u8]) -> bool {
    let mut stream = UnixStream::connect(&daemon.meshdata_endpoint)
        .await
        .expect("connect meshdata");
    let payload = credential(secret).to_string();
    let hello = encode_frame(FRAME_HELLO, 0, payload.as_bytes()).expect("a hello frame");
    stream.write_all(&hello).await.expect("write meshdata");
    let mut frames = FrameReader::default();
    let mut buf = vec![0u8; 4096];
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let n = match timeout_at(deadline, stream.read(&mut buf)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return false,
            Ok(Ok(n)) => n,
        };
        let decoded = frames.push(&buf[..n]).expect("decode");
        if let Some(frame) = decoded.first() {
            return frame.kind == FRAME_HELLO_OK;
        }
    }
}

/// The REAL field-native binary, its stdin a pipe this file holds: what fieldd's spawn is to the floor.
struct Floor {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    /// The daemon's socket alias parent, dropped after `Drop::drop` has stopped the child; a role's is none.
    _alias_parent: Option<RunAliasParent>,
}

impl Floor {
    /// `flag` is `FIELD_NATIVE_CUSTODY`'s value, or `None` for a floor never told of custody.
    fn spawn(data_dir: &Path, log_root: &Path, flag: Option<&str>) -> Self {
        let alias_parent = RunAliasParent::make();
        let mut command = Command::new(env!("CARGO_BIN_EXE_field-native"));
        command
            .env("FIELD_NATIVE_DATA_DIR", data_dir)
            .env(SOCKET_ALIAS_PARENT_ENV, alias_parent.path())
            .env("FIELD_LOG_DIR", log_root)
            .env("FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE", "1")
            .env_remove("FIELD_NATIVE_ALLOW_LOG_FILTER")
            .env_remove("FIELD_NATIVE_LOG_FILTER")
            .env_remove("FIELD_NATIVE_MESH")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        match flag {
            Some(value) => command.env(registry::NATIVE_ENV, value),
            None => command.env_remove(registry::NATIVE_ENV),
        };
        let mut child = command.spawn().expect("spawn field-native");
        let stdin = child.stdin.take();
        Self {
            child: Some(child),
            stdin,
            _alias_parent: Some(alias_parent),
        }
    }

    /// The same binary in another role (`door …`, `--version`): nothing of a daemon's environment, an empty HOME where
    /// a boot would write its roots, and the custody flag set all the same.
    fn spawn_role(args: &[&str], home: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_field-native"))
            .args(args)
            .env_clear()
            .env("HOME", home)
            .env(registry::NATIVE_ENV, registry::STDIN)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn field-native");
        let stdin = child.stdin.take();
        Self {
            child: Some(child),
            stdin,
            _alias_parent: None,
        }
    }

    /// fieldd's whole hand-off: `line`, a newline, and stdin's end. Written from a thread of its own, so a floor that
    /// never reads cannot hold the row; a floor that already refused has closed its end, and the row reads its exit.
    fn hand(&mut self, line: String) {
        let mut stdin = self.stdin.take().expect("stdin is still this file's");
        std::thread::spawn(move || {
            let _ = stdin.write_all(format!("{line}\n").as_bytes());
        });
    }

    fn is_running(&mut self) -> bool {
        self.child
            .as_mut()
            .expect("child available")
            .try_wait()
            .expect("query child")
            .is_none()
    }

    /// What an exited floor wrote.
    fn output(&mut self) -> Output {
        self.child
            .take()
            .expect("child available")
            .wait_with_output()
            .expect("collect field-native output")
    }

    /// Ready is the management socket answering: a sealed floor makes no pairing file to wait for.
    async fn ready(&mut self, data_dir: &Path) -> PathBuf {
        let socket = data_dir.join("native/run/mgmt.sock");
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if !self.is_running() {
                let output = self.output();
                panic!(
                    "field-native exited before readiness: status={}; stderr={}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            if socket.exists() && UnixStream::connect(&socket).await.is_ok() {
                return socket;
            }
            assert!(Instant::now() < deadline, "field-native did not bind mgmt");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// The floor's exit within `budget`, and what it wrote.
    async fn exits_within(&mut self, budget: Duration) -> Output {
        let deadline = Instant::now() + budget;
        while self.is_running() {
            assert!(Instant::now() < deadline, "field-native is still running");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.output()
    }
}

impl Drop for Floor {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// The floor's own log, whole, and its records.
fn log(log_root: &Path) -> (String, Vec<Value>) {
    let active = log_root.join("system/field-native.ndjson");
    let raw = std::fs::read_to_string(active).expect("the floor's log");
    let records = raw
        .lines()
        .map(|line| serde_json::from_str(line).expect("a log record"))
        .collect();
    (raw, records)
}

/// What a floor that refused its boot said of it: main's `bootstrap_failed` line, and only one.
fn refusal(records: &[Value]) -> String {
    let said: Vec<&Value> = records
        .iter()
        .filter(|record| record["event"] == "field_native.lifecycle.bootstrap_failed")
        .collect();
    assert_eq!(said.len(), 1, "one line says why: {records:?}");
    said[0]["err"]["message"]
        .as_str()
        .expect("the refusal's words")
        .to_owned()
}

/// Nothing the floor wrote names `hex_secret`, whole or by its first sixteen characters: the logger masks a whole
/// 64-character run by itself, and that mask must not be what stands between a secret and the log.
fn names_no_secret(what: &str, hex_secret: &str, output: &Output, raw_log: &str) {
    let needle = &hex_secret[..16];
    let places = [
        (
            "stdout",
            String::from_utf8_lossy(&output.stdout).into_owned(),
        ),
        (
            "stderr",
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ),
        ("log", raw_log.to_owned()),
    ];
    for (place, text) in places {
        assert!(
            !text.contains(needle),
            "{what}: its {place} names the secret"
        );
    }
}

/// A floor that refused its boot: a non-zero exit, one line that says `reason` and holds nothing the logger had to
/// mask, the handed secret named nowhere, no pairing file and no listener.
fn refused_its_boot(what: &str, data_dir: &Path, log_root: &Path, output: &Output, reason: &str) {
    assert!(
        !output.status.success(),
        "{what}: it exited {:?}",
        output.status
    );
    let (raw, records) = log(log_root);
    let said = refusal(&records);
    assert!(
        said.contains(reason),
        "{what}: it said {said:?}, not {reason}"
    );
    let masked = said.contains("<redacted>");
    assert!(!masked, "{what}: the logger had to mask {said:?}");
    names_no_secret(what, &handed_hex(), output, &raw);
    let pairing_file = data_dir.join("native/pairing");
    assert!(!pairing_file.exists(), "{what}: it made a pairing file");
    let listener = data_dir.join("native/run/mgmt.sock");
    assert!(!listener.exists(), "{what}: it bound its listener");
}

// ---- the real binary, as fieldd spawns it --------------------------------------------------------------------------

#[tokio::test]
async fn handed_its_pairing_on_stdin_the_floor_writes_no_pairing_file() {
    let (_fixture, data_dir, log_root) = roots();
    let mut floor = Floor::spawn(&data_dir, &log_root, Some(registry::STDIN));
    floor.hand(bootstrap_line(1, &handed_hex()));
    let socket = floor.ready(&data_dir).await;
    let pairing_file = data_dir.join("native/pairing");
    assert!(!pairing_file.exists(), "a sealed floor made its file");

    // its fieldd pairs and stops it, as a planned stop does
    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&secret_bytes(&handed_hex())).await;
    assert!(ack["result"].is_object(), "{ack}");
    fieldd.stop().await;
    let output = floor.exits_within(Duration::from_secs(15)).await;
    assert!(output.status.success(), "{:?}", output.status);
    assert!(!pairing_file.exists(), "and none by the time it stopped");
    let (raw, records) = log(&log_root);
    let sealed = "field_native.lifecycle.custody_sealed";
    assert!(
        records.iter().any(|record| record["event"] == sealed),
        "a sealed floor says so at its boot: {raw}"
    );
    names_no_secret("a sealed boot", &handed_hex(), &output, &raw);
}

#[tokio::test]
async fn it_pairs_a_hello_under_that_secret_and_refuses_one_under_any_other() {
    let (_fixture, data_dir, log_root) = roots();
    let mut floor = Floor::spawn(&data_dir, &log_root, Some(registry::STDIN));
    floor.hand(bootstrap_line(1, &handed_hex()));
    let socket = floor.ready(&data_dir).await;
    let handed = secret_bytes(&handed_hex());

    let mut stranger = Mgmt::connect(&socket).await;
    let refused = stranger.hello(&secret_bytes(&other_hex())).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "UNAUTHORIZED",
        "a hello under another secret: {refused}"
    );

    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&handed).await;
    assert_eq!(ack["result"]["serverKind"], "field-native", "{ack}");
    // WIN-10: the ack proves the floor holds the secret it was handed
    let proof = pairing::compute_ack_mac(&handed, NONCE, BOOT);
    assert_eq!(ack["result"]["serverMac"], json!(proof), "{ack}");

    drop(stranger);
    fieldd.stop().await;
    let output = floor.exits_within(Duration::from_secs(15)).await;
    assert!(output.status.success(), "{:?}", output.status);
}

#[tokio::test]
async fn the_flag_set_and_no_line_it_exits_non_zero_and_says_why_without_the_secret() {
    // stdin ended with nothing on it
    let (_fixture, data_dir, log_root) = roots();
    let mut floor = Floor::spawn(&data_dir, &log_root, Some(registry::STDIN));
    drop(floor.stdin.take());
    let output = floor.exits_within(Duration::from_secs(15)).await;
    let reason = "bootstrap-absent";
    refused_its_boot("an ended stdin", &data_dir, &log_root, &output, reason);

    // stdin ended part way through a line: no line came, and what did come is named nowhere
    let (_fixture, data_dir, log_root) = roots();
    let mut floor = Floor::spawn(&data_dir, &log_root, Some(registry::STDIN));
    let mut stdin = floor.stdin.take().expect("stdin");
    let half = bootstrap_line(1, &handed_hex());
    stdin.write_all(half.as_bytes()).expect("write");
    drop(stdin);
    let output = floor.exits_within(Duration::from_secs(15)).await;
    refused_its_boot("half a line", &data_dir, &log_root, &output, reason);

    // stdin held open and silent: the floor gives up at the registry's wait, never sooner
    let (_fixture, data_dir, log_root) = roots();
    let wait = Duration::from_millis(registry::HANDOFF_WAIT_MS);
    let started = Instant::now();
    let mut floor = Floor::spawn(&data_dir, &log_root, Some(registry::STDIN));
    let output = floor.exits_within(wait + Duration::from_secs(15)).await;
    assert!(started.elapsed() >= wait, "it gave up before its wait");
    let reason = "bootstrap-late";
    refused_its_boot("a silent stdin", &data_dir, &log_root, &output, reason);
}

#[tokio::test]
async fn a_line_longer_than_the_bound_or_of_another_version_is_refused() {
    let max = registry::HANDOFF_MAX_BYTES as usize;
    let valid = bootstrap_line(1, &handed_hex());
    // a bootstrap this floor would read, padded until its newline is one byte past the bound
    let too_long = format!("{valid}{}", " ".repeat(max - valid.len()));
    let another_version = bootstrap_line(2, &handed_hex());
    for (what, line, reason) in [
        ("a line past the bound", too_long, "bootstrap-too-long"),
        ("another version", another_version, "bootstrap-version"),
    ] {
        let (_fixture, data_dir, log_root) = roots();
        let mut floor = Floor::spawn(&data_dir, &log_root, Some(registry::STDIN));
        floor.hand(line);
        let output = floor.exits_within(Duration::from_secs(15)).await;
        refused_its_boot(what, &data_dir, &log_root, &output, reason);
    }
}

#[tokio::test]
async fn with_no_flag_it_makes_and_reads_the_file_as_before() {
    use std::os::unix::fs::PermissionsExt;
    let (_fixture, data_dir, log_root) = roots();
    let pairing_file = data_dir.join("native/pairing");

    let mut floor = Floor::spawn(&data_dir, &log_root, None);
    // a line nobody told this floor to expect: it is never read, and it pairs nothing
    floor.hand(bootstrap_line(1, &handed_hex()));
    let socket = floor.ready(&data_dir).await;
    let made = std::fs::read_to_string(&pairing_file).expect("the pairing file");
    assert_eq!(made.len(), 64, "32 bytes, in hex");
    let mode = std::fs::metadata(&pairing_file)
        .expect("stat")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let own = secret_bytes(&made);
    let mut stranger = Mgmt::connect(&socket).await;
    let refused = stranger.hello(&secret_bytes(&handed_hex())).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "UNAUTHORIZED",
        "a line that was never read pairs nothing: {refused}"
    );
    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&own).await;
    assert!(ack["result"].is_object(), "{ack}");
    drop(stranger);
    fieldd.stop().await;
    let output = floor.exits_within(Duration::from_secs(15)).await;
    assert!(output.status.success(), "{:?}", output.status);

    // the next boot reads the file it finds, and pairs under it
    let mut next = Floor::spawn(&data_dir, &log_root, None);
    let socket = next.ready(&data_dir).await;
    let kept = std::fs::read_to_string(&pairing_file).expect("the pairing file");
    assert_eq!(kept, made, "a second boot made another secret");
    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&own).await;
    assert!(ack["result"].is_object(), "{ack}");
    fieldd.stop().await;
    let output = next.exits_within(Duration::from_secs(15)).await;
    assert!(output.status.success(), "{:?}", output.status);
}

/// §8.1 — the table of what each terminal was started for is a sealed floor's alone, and the boot that read the
/// bootstrap line is the one that gives a floor it. Through the real binary and its own `main`, nothing handed in
/// process: this is the row that proves the binding which the in-process rows of `tests/started_for.rs` take as given
/// (`bootstrap_handed`).
#[tokio::test]
async fn the_floor_sealed_on_stdin_keeps_the_table_and_a_floor_from_the_file_keeps_none() {
    let verb = "native.terminal.startedFor.set";
    let ask = json!({"sessionId": "nobody"});

    // handed its secret on stdin: the verb answers about the session it was asked. (Its ack says no table while it
    // holds none: absent and empty are one thing to a reader.)
    let (_fixture, data_dir, log_root) = roots();
    let mut floor = Floor::spawn(&data_dir, &log_root, Some(registry::STDIN));
    floor.hand(bootstrap_line(1, &handed_hex()));
    let socket = floor.ready(&data_dir).await;
    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&secret_bytes(&handed_hex())).await;
    assert!(ack["result"].is_object(), "{ack}");
    let answer = fieldd.call(3, verb, ask.clone()).await;
    // the code is an entity's, not a method's: the verb is there, and the session is not
    assert_eq!(answer["error"]["code"], -32003, "{answer}");
    assert_eq!(answer["error"]["data"]["kind"], "NOT_FOUND", "{answer}");
    fieldd.stop().await;
    let output = floor.exits_within(Duration::from_secs(15)).await;
    assert!(output.status.success(), "{:?}", output.status);

    // booted from its file: no key in the ack, and the verb is refused by name
    let (_fixture, data_dir, log_root) = roots();
    let mut floor = Floor::spawn(&data_dir, &log_root, None);
    let socket = floor.ready(&data_dir).await;
    let made = std::fs::read_to_string(data_dir.join("native/pairing")).expect("the pairing file");
    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&secret_bytes(&made)).await;
    assert!(ack["result"].is_object(), "{ack}");
    assert!(ack["result"].get("startedFor").is_none(), "{ack}");
    let answer = fieldd.call(3, verb, ask).await;
    let details = &answer["error"]["data"]["details"];
    assert_eq!(details["reason"], "not-sealed", "{answer}");
    fieldd.stop().await;
    let output = floor.exits_within(Duration::from_secs(15)).await;
    assert!(output.status.success(), "{:?}", output.status);
}

// ---- the reader alone ----------------------------------------------------------------------------------------------

/// The reader over text this file holds, with a wait no row here reaches.
async fn read(text: String, max_bytes: usize) -> Result<[u8; 32], Refused> {
    let open = move || std::io::Cursor::new(text.into_bytes());
    read_bootstrap(open, max_bytes, Duration::from_secs(5)).await
}

#[tokio::test]
async fn the_reader_holds_a_line_to_its_bound_to_the_byte() {
    // a bound of this row's own: the reader takes its bound as it is given it
    let max = 256;
    let valid = bootstrap_line(1, &handed_hex());
    let handed = secret_bytes(&handed_hex());

    // exactly the bound, its newline included, is a line
    let exactly = format!("{valid}{}\n", " ".repeat(max - valid.len() - 1));
    assert_eq!(exactly.len(), max);
    assert_eq!(read(exactly, max).await, Ok(handed));
    // one byte more is not
    let one_more = format!("{valid}{}\n", " ".repeat(max - valid.len()));
    assert_eq!(read(one_more, max).await, Err(Refused::TooLong));
    // and a line with no end is refused at the bound, never read to its end
    let endless = "x".repeat(max * 64);
    assert_eq!(read(endless, max).await, Err(Refused::TooLong));

    // the registry's bound holds the contract's own fixture, written as fieldd writes it
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts/fixtures/native-bootstrap.valid.json");
    let raw = std::fs::read_to_string(fixture).expect("the fixture");
    let golden: Value = serde_json::from_str(&raw).expect("fixture json");
    let line = format!("{golden}\n");
    let registry_max = registry::HANDOFF_MAX_BYTES as usize;
    assert_eq!(read(line, registry_max).await, Ok(handed));
}

#[tokio::test]
async fn the_reader_refuses_what_is_not_a_bootstrap_it_reads_and_keeps_none_of_its_words() {
    let hex = handed_hex();
    let max = 256;
    // a version this floor does not read
    let other_version = format!("{}\n", bootstrap_line(2, &hex));
    assert_eq!(read(other_version, max).await, Err(Refused::Version));
    // a whole bootstrap with no newline after it, and nothing at all: no line came
    let unended = bootstrap_line(1, &hex);
    assert_eq!(read(unended, max).await, Err(Refused::Absent));
    assert_eq!(read(String::new(), max).await, Err(Refused::Absent));

    // not a bootstrap: its class is kept, never its words (serde quotes the value it could not read)
    let not_bootstraps = [
        "not json".to_owned(),
        json!({"v": 1}).to_string(),
        json!({"v": 0, "pairing": hex}).to_string(),
        json!({"v": hex, "pairing": hex}).to_string(),
        json!({"v": 1, "pairing": hex.to_uppercase()}).to_string(),
        json!({"v": 1, "pairing": &hex[..62]}).to_string(),
        json!({"v": 1, "pairing": [hex]}).to_string(),
    ];
    for line in not_bootstraps {
        let refused = read(format!("{line}\n"), max).await.expect_err("refused");
        assert!(
            matches!(refused, Refused::Unparsed(_)),
            "{line}: {refused:?}"
        );
        let said = refused.to_string();
        assert!(!said.contains(&hex[..16]), "{said}");
    }
}

#[tokio::test]
async fn the_reader_gives_up_at_its_wait_and_reads_a_line_that_comes_inside_it() {
    use std::os::unix::net::UnixStream as Pipe;
    // a writer that never writes: late, at the wait
    let (silent, reader) = Pipe::pair().expect("a socket pair");
    let wait = Duration::from_millis(200);
    let started = Instant::now();
    let open = move || std::io::BufReader::new(reader);
    assert_eq!(read_bootstrap(open, 256, wait).await, Err(Refused::Late));
    assert!(started.elapsed() >= wait, "it gave up before its wait");
    drop(silent);

    // a writer that takes its time and never closes: the line is read when it comes
    let (mut slow, reader) = Pipe::pair().expect("a socket pair");
    let line = format!("{}\n", bootstrap_line(1, &handed_hex()));
    let writer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        slow.write_all(line.as_bytes()).expect("write the line");
        slow
    });
    let open = move || std::io::BufReader::new(reader);
    let got = read_bootstrap(open, 256, Duration::from_secs(5)).await;
    assert_eq!(got, Ok(secret_bytes(&handed_hex())));
    drop(writer.join());
}

#[test]
fn the_flag_is_its_one_value_and_sits_under_the_prefixes_a_pane_never_sees() {
    assert!(stdin_requested(Some(registry::STDIN)));
    let reads_as_unset = [
        None,
        Some(""),
        Some("1"),
        Some("true"),
        Some("STDIN"),
        Some(" stdin"),
        Some("files"),
    ];
    for value in reads_as_unset {
        assert!(!stdin_requested(value), "{value:?} asks for stdin");
    }
    // EL7: both planes strip these prefixes from an agent's PTY, so the flag never reaches one
    let under_a_prefix = field_native::registries::ENV_PREFIXES
        .iter()
        .any(|prefix| registry::NATIVE_ENV.starts_with(*prefix));
    assert!(under_a_prefix, "the flag would reach an agent's PTY");
}

// ---- the in-process seam -------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_floor_handed_its_pairing_in_process_makes_no_pairing_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
    let handed = secret_bytes(&handed_hex());
    let daemon = bootstrap_handed(config, handed).await.expect("bootstrap");
    let pairing_file = daemon.pairing_file.clone();
    assert!(!pairing_file.exists(), "a sealed floor made its file");
    assert_eq!(daemon.state.secret, handed, "it holds what it was handed");
    assert!(byte_plane_pairs(&daemon, &handed).await);
    daemon.shutdown().await;
    assert!(!pairing_file.exists(), "and none by the time it stopped");
}

#[tokio::test]
async fn a_floor_handed_its_pairing_neither_reads_nor_removes_a_pairing_file_it_finds() {
    let dir = tempfile::tempdir().expect("tempdir");
    let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
    // an earlier `files` boot left its secret here
    let pairing_file = config.pairing_file();
    std::fs::create_dir_all(pairing_file.parent().expect("native/")).expect("mkdir");
    std::fs::write(&pairing_file, other_hex()).expect("seed the file");

    let handed = secret_bytes(&handed_hex());
    let on_file = secret_bytes(&other_hex());
    let daemon = bootstrap_handed(config, handed).await.expect("bootstrap");
    assert_eq!(daemon.pairing_file, pairing_file);
    let left = std::fs::read_to_string(&pairing_file).expect("still there");
    assert_eq!(left, other_hex(), "the file is as the floor found it");

    let socket = PathBuf::from(&daemon.mgmt_endpoint);
    let mut stale = Mgmt::connect(&socket).await;
    let refused = stale.hello(&on_file).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "UNAUTHORIZED",
        "the file's secret pairs nothing: {refused}"
    );
    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&handed).await;
    assert!(ack["result"].is_object(), "{ack}");
    // the byte plane is paired by the same secret, and by no other
    assert!(byte_plane_pairs(&daemon, &handed).await);
    assert!(!byte_plane_pairs(&daemon, &on_file).await);

    drop(fieldd);
    drop(stale);
    daemon.shutdown().await;
    let left = std::fs::read_to_string(&pairing_file).expect("still there");
    assert_eq!(left, other_hex(), "and as it was when the floor stopped");
}

// ---- the binary's other roles: the read is the daemon's alone ------------------------------------------------------

/// Every path under `root` (`tests/door_bridge.rs`'s reading: a boot writes its data and log roots under its HOME).
fn written_under(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut dirs = vec![root.to_path_buf()];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path.clone());
            }
            found.push(path);
        }
    }
    found
}

/// The agent's own play: the bridge every pane may run, with the daemon's flag in its environment and a bootstrap line
/// on its stdin. It is still only the bridge. The line is carried to the door as any caller's bytes, nothing of it is
/// held or written, the bridge ends at stdin's end as it always did, and the floor pairs under the secret it had.
#[tokio::test]
async fn the_door_bridge_carries_a_bootstrap_line_as_its_ordinary_input_and_holds_no_secret() {
    // a floor that was handed one secret, and an agent that tries the bridge with another
    let dir = tempfile::tempdir().expect("tempdir");
    let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
    let floors = secret_bytes(&other_hex());
    let daemon = bootstrap_handed(config, floors).await.expect("bootstrap");
    let door = daemon.state.door.clone();
    let endpoint = door.info().expect("the door").endpoint.to_string();

    let home = tempfile::tempdir().expect("a temp home");
    let mut bridge = Floor::spawn_role(&["door", "--endpoint", &endpoint], home.path());
    let pid = bridge.child.as_ref().expect("child available").id();
    let line = format!("{}\n", bootstrap_line(1, &handed_hex()));
    let mut stdin = bridge.stdin.take().expect("stdin");
    stdin.write_all(line.as_bytes()).expect("write");

    // It is the bridge: the floor's door names it, and holds its line as any caller's bytes (no fieldd is attached).
    let deadline = Instant::now() + Duration::from_secs(5);
    while door.held_bytes() != line.len() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(door.held_bytes(), line.len(), "the door holds the line");
    let doors = json!(door.snapshot());
    assert_eq!(doors["doors"][0]["caller"]["pid"], json!(pid), "{doors}");

    // stdin's end is the bridge's own, as ever: exit 0, nothing said back, nothing written
    drop(stdin);
    let output = bridge.exits_within(Duration::from_secs(10)).await;
    assert_eq!(output.status.code(), Some(EXIT_OK), "{:?}", output.status);
    assert!(output.stdout.is_empty(), "the bridge said something back");
    names_no_secret("the bridge", &handed_hex(), &output, "");
    let wrote = written_under(home.path());
    assert!(wrote.is_empty(), "the bridge wrote {wrote:?}");

    // and the floor is as it was: no file, and it pairs under its own secret, never the line's
    let pairing_file = daemon.pairing_file.clone();
    assert!(!pairing_file.exists(), "a pairing file was made");
    let socket = PathBuf::from(&daemon.mgmt_endpoint);
    let mut agent = Mgmt::connect(&socket).await;
    let refused = agent.hello(&secret_bytes(&handed_hex())).await;
    assert_eq!(
        refused["error"]["data"]["kind"], "UNAUTHORIZED",
        "the line's secret pairs nothing: {refused}"
    );
    let mut fieldd = Mgmt::connect(&socket).await;
    let ack = fieldd.hello(&floors).await;
    assert!(ack["result"].is_object(), "{ack}");
    drop(fieldd);
    drop(agent);
    daemon.shutdown().await;
}

/// One run of the binary in another role, the flag set and a bootstrap line on its stdin: nothing it wrote names the
/// line's secret, nothing is written under its HOME (so it is no daemon), and its exit code is the answer.
async fn role_exits(args: &[&str], line: &str) -> Option<i32> {
    let home = tempfile::tempdir().expect("a temp home");
    let mut role = Floor::spawn_role(args, home.path());
    role.hand(line.to_owned());
    // launch_check's bound for a slow exit under load
    let output = role.exits_within(Duration::from_secs(60)).await;
    names_no_secret(&args.join(" "), &handed_hex(), &output, "");
    let wrote = written_under(home.path());
    assert!(wrote.is_empty(), "{args:?} wrote {wrote:?}");
    output.status.code()
}

#[tokio::test]
async fn no_other_role_reads_the_flag_or_a_bootstrap_line() {
    let line = bootstrap_line(1, &handed_hex());
    // each exits as it does with no flag and no line: `--version` and `--help` 0, an unknown argument 2
    assert_eq!(role_exits(&["--version"], &line).await, Some(0));
    assert_eq!(role_exits(&["--help"], &line).await, Some(0));
    assert_eq!(role_exits(&["--no-such-flag"], &line).await, Some(2));
    // the bridge refused its arguments, and the bridge with no door to dial
    assert_eq!(role_exits(&["door"], &line).await, Some(EXIT_USAGE));
    let nowhere = ["door", "--endpoint", "/nonexistent/vf-custody/door.sock"];
    assert_eq!(role_exits(&nowhere, &line).await, Some(EXIT_UNREACHABLE));
}
