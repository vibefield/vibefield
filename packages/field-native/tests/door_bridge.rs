//! CP-1a — the bridge command, `field-native door --endpoint <path>`, against a real floor. Its child is the caller
//! the door names: the binary itself, spawned as a spark's agent spawns it. The rows for a spent budget and a line past
//! the cap run the same `bridge` in process with a short budget, where the binary's would take a minute.
#![cfg(unix)]

use field_native::door_bridge::{
    bridge, Backoff, EXIT_LINE_TOO_LONG, EXIT_OK, EXIT_UNREACHABLE, EXIT_USAGE, LINE_MAX,
};
use field_native::local_ipc;
use field_native::services::door::peer::process_facts;
use field_native::services::mesh_bridge::{
    encode_frame, Frame, FrameReader, FRAME_DATA, FRAME_HELLO,
};
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::{timeout, timeout_at, Instant};

const TICK: &str = "native.lifecycle.tick";

async fn boot_at(dir: &Path) -> RunningDaemon {
    bootstrap(NativeConfig::for_data_dir(dir.to_path_buf()))
        .await
        .expect("bootstrap")
}

fn credential(daemon: &RunningDaemon) -> Value {
    let secret = hex::decode(
        std::fs::read_to_string(&daemon.pairing_file)
            .unwrap()
            .trim(),
    )
    .unwrap();
    let ts = pairing::now_epoch_secs();
    let boot = "fieldd-boot-test";
    json!({"bootId": boot, "ts": ts, "mac": pairing::compute_mac(&secret, boot, ts)})
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

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

async fn settles(check: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !check() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    check()
}

/// Every file under `root`.
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

/// fieldd's management connection, as far as the door needs one.
struct Mgmt {
    reader: tokio::io::Lines<BufReader<tokio::io::ReadHalf<local_ipc::ClientStream>>>,
    writer: tokio::io::WriteHalf<local_ipc::ClientStream>,
    next_id: u64,
}

impl Mgmt {
    async fn paired(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .expect("connect mgmt");
        let (r, w) = tokio::io::split(stream);
        let mut mgmt = Self {
            reader: BufReader::new(r).lines(),
            writer: w,
            next_id: 1,
        };
        let hello = mgmt
            .call(
                "native.lifecycle.hello",
                json!({"contractsVersion": "0.1.0", "minCompatible": "0.1.0", "clientKind": "fieldd",
                       "credential": credential(daemon)}),
            )
            .await;
        assert!(hello.get("result").is_some(), "{hello}");
        mgmt
    }

    /// Subscribes to the door stream; the doors open at the time.
    async fn subscribe(&mut self) -> Vec<Value> {
        let answer = self.call("native.door.subscribe", json!({})).await;
        answer["result"]["snapshot"]["doors"]
            .as_array()
            .expect("a snapshot")
            .clone()
    }

    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let mut line =
            json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).await.expect("write");
        loop {
            let note = self.recv().await;
            if note["id"] == json!(id) {
                return note;
            }
        }
    }

    async fn recv(&mut self) -> Value {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let line = timeout_at(deadline, self.reader.next_line())
                .await
                .expect("recv timeout")
                .expect("read error")
                .expect("connection closed");
            let value: Value = serde_json::from_str(&line).expect("json line");
            if value["method"] != TICK {
                return value;
            }
        }
    }

    /// The next door stream payload.
    async fn door(&mut self) -> Value {
        loop {
            let note = self.recv().await;
            if note["method"]
                .as_str()
                .is_some_and(|m| m.starts_with("native.door."))
            {
                return note["params"]["payload"].clone();
            }
        }
    }
}

/// fieldd's byte-plane connection.
struct Bytes {
    stream: local_ipc::ClientStream,
    reader: FrameReader,
    pending: std::collections::VecDeque<Frame>,
}

impl Bytes {
    async fn paired(daemon: &RunningDaemon) -> Self {
        let mut stream = local_ipc::connect(&daemon.meshdata_endpoint)
            .await
            .expect("connect meshdata");
        let hello =
            encode_frame(FRAME_HELLO, 0, credential(daemon).to_string().as_bytes()).unwrap();
        stream.write_all(&hello).await.unwrap();
        let mut bytes = Self {
            stream,
            reader: FrameReader::default(),
            pending: Default::default(),
        };
        bytes.next(Duration::from_secs(5)).await.expect("HELLO_OK");
        bytes
    }

    async fn next(&mut self, budget: Duration) -> Option<Frame> {
        let deadline = Instant::now() + budget;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            if let Some(frame) = self.pending.pop_front() {
                return Some(frame);
            }
            let n = match timeout_at(deadline, self.stream.read(&mut buf)).await {
                Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return None,
                Ok(Ok(n)) => n,
            };
            self.pending
                .extend(self.reader.push(&buf[..n]).expect("decode"));
        }
    }

    async fn read_lane(&mut self, lane_id: u64, want: usize) -> Vec<u8> {
        let mut got = Vec::new();
        while got.len() < want {
            let frame = self
                .next(Duration::from_secs(10))
                .await
                .expect("a DATA frame");
            assert_eq!((frame.kind, frame.lane_id), (FRAME_DATA, lane_id));
            got.extend(frame.payload);
        }
        got
    }

    async fn send(&mut self, lane_id: u64, payload: &[u8]) {
        let frame = encode_frame(FRAME_DATA, lane_id, payload).unwrap();
        self.stream.write_all(&frame).await.unwrap();
    }
}

/// The binary's door arm, as a spark's agent runs it.
fn spawn_bridge(args: &[&str]) -> Child {
    Command::new(env!("CARGO_BIN_EXE_field-native"))
        .arg("door")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn the bridge")
}

async fn exit_code(child: &mut Child) -> Option<i32> {
    timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("the bridge exits")
        .expect("wait")
        .code()
}

#[tokio::test]
async fn the_bridge_is_a_child_the_door_names_by_its_pid_and_start_and_carries_whole_lines() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_at(dir.path()).await;
    let mut mgmt = Mgmt::paired(&daemon).await;
    mgmt.subscribe().await;
    let mut bytes = Bytes::paired(&daemon).await;
    let before = now_ms();
    let mut child = spawn_bridge(&["--endpoint", &door_endpoint(&daemon)]);
    let pid = child.id().unwrap();
    let after = now_ms();
    let open = mgmt.door().await;
    assert_eq!(open["state"], "open");
    assert_eq!(open["caller"]["pid"], json!(pid));
    let started = open["caller"]["startedAtMs"].as_u64().unwrap();
    assert!(
        started + 1_000 >= before && started <= after + 1_000,
        "{started} is not within a second of {before}..{after}"
    );
    assert_eq!(Some(started), process_facts(pid).map(|f| f.started_at_ms));
    let lane_id = open["laneId"].as_u64().unwrap();

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let request: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}\n";
    stdin.write_all(request).await.unwrap();
    assert_eq!(bytes.read_lane(lane_id, request.len()).await, request);

    // toward the agent, a line reaches stdout whole, however the floor's frames cut it
    bytes.send(lane_id, b"{\"jsonrpc\":\"2.0\",").await;
    bytes.send(lane_id, b"\"id\":1,\"result\":{}}\n").await;
    let mut line = String::new();
    timeout(Duration::from_secs(5), stdout.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(line, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n");

    // and from it: a part line waits for its newline, so a connection never carries half a message
    stdin.write_all(b"{\"id\":").await.unwrap();
    assert!(bytes.next(Duration::from_millis(300)).await.is_none());
    stdin.write_all(b"2}\n").await.unwrap();
    assert_eq!(bytes.read_lane(lane_id, 9).await, b"{\"id\":2}\n");

    // stdin's end is the bridge's: exit 0, and the floor sees its door end
    drop(stdin);
    assert_eq!(exit_code(&mut child).await, Some(EXIT_OK));
    let closed = mgmt.door().await;
    assert_eq!(
        (closed["state"].as_str(), closed["reason"].as_str()),
        (Some("closed"), Some("eof"))
    );
}

/// THE FLOOR WALKS through the real binary: this test's parent stands in for a pane root the floor lists, so the
/// bridge, its grandchild, resolves to that pane two steps up.
#[tokio::test]
async fn the_bridge_run_inside_a_listed_pane_names_the_pane_two_steps_above_it() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_at(dir.path()).await;
    let own = process_facts(std::process::id()).unwrap();
    let root = process_facts(own.parent).expect("this process's parent has facts");
    let row: field_native::contracts::ObservedTerminal = serde_json::from_value(
        json!({"sessionId": "the-spark-pane", "pid": own.parent, "createdAt": root.started_at_ms}),
    )
    .unwrap();
    daemon
        .state
        .observed_tx
        .send_modify(|observed| observed.terminals = vec![row]);
    let mut mgmt = Mgmt::paired(&daemon).await;
    mgmt.subscribe().await;
    let mut child = spawn_bridge(&["--endpoint", &door_endpoint(&daemon)]);
    let open = mgmt.door().await;
    assert_eq!(open["caller"]["pid"], json!(child.id().unwrap()));
    assert_eq!(
        open["pane"],
        json!({"terminalSessionId": "the-spark-pane", "depth": 2})
    );
    drop(child.stdin.take());
    assert_eq!(exit_code(&mut child).await, Some(EXIT_OK));
}

#[tokio::test]
async fn the_bridge_dials_again_after_its_door_closes_and_a_line_written_meanwhile_goes_on_the_new_door(
) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_at(dir.path()).await;
    let mut mgmt = Mgmt::paired(&daemon).await;
    mgmt.subscribe().await;
    let mut bytes = Bytes::paired(&daemon).await;
    let mut child = spawn_bridge(&["--endpoint", &door_endpoint(&daemon)]);
    let pid = child.id().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let first = mgmt.door().await;
    // half a line toward the agent, then the door goes: the half goes with it, never onto the next door's line
    bytes
        .send(first["laneId"].as_u64().unwrap(), b"{\"torn\":")
        .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let closed = mgmt
        .call("native.door.close", json!({"connId": first["connId"]}))
        .await;
    assert_eq!(closed["result"]["closed"], true);
    assert_eq!(mgmt.door().await["state"], "closed");
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"{\"id\":3}\n").await.unwrap();
    let again = mgmt.door().await;
    assert_eq!(again["state"], "open");
    assert_eq!(
        again["caller"]["pid"],
        json!(pid),
        "the same caller, named again"
    );
    assert_ne!(again["connId"], first["connId"]);
    let lane_id = again["laneId"].as_u64().unwrap();
    assert_eq!(bytes.read_lane(lane_id, 9).await, b"{\"id\":3}\n");
    bytes.send(lane_id, b"{\"id\":3,\"result\":{}}\n").await;
    let mut line = String::new();
    timeout(Duration::from_secs(5), stdout.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(line, "{\"id\":3,\"result\":{}}\n");
    drop(stdin);
    assert_eq!(exit_code(&mut child).await, Some(EXIT_OK));
}

#[tokio::test]
async fn the_bridge_outlives_a_floor_restart_and_dials_the_next_floor() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_at(dir.path()).await;
    let endpoint = door_endpoint(&daemon);
    let mut child = spawn_bridge(&["--endpoint", &endpoint]);
    let pid = child.id().unwrap();
    assert!(settles(|| daemon.state.door.open_count() == 1).await);
    daemon.shutdown().await;
    // the floor is gone, and the bridge waits to dial
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        child.try_wait().unwrap().is_none(),
        "the bridge outlived its floor"
    );

    let daemon = boot_at(dir.path()).await;
    assert_eq!(door_endpoint(&daemon), endpoint);
    let mut mgmt = Mgmt::paired(&daemon).await;
    let open = match mgmt.subscribe().await.first() {
        Some(door) => door.clone(),
        None => mgmt.door().await,
    };
    assert_eq!(open["caller"]["pid"], json!(pid));
    let lane_id = open["laneId"].as_u64().unwrap();
    let mut bytes = Bytes::paired(&daemon).await;
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"{\"id\":4}\n").await.unwrap();
    assert_eq!(bytes.read_lane(lane_id, 9).await, b"{\"id\":4}\n");
    drop(stdin);
    assert_eq!(exit_code(&mut child).await, Some(EXIT_OK));
}

/// No daemon and no config: a bridge refused its arguments, or with no door to dial, exits at once and writes nothing
/// under its HOME, whatever its environment.
#[tokio::test]
async fn the_bridge_without_its_endpoint_or_its_door_exits_touching_nothing() {
    let home = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_field-native"))
            .arg("door")
            .args(args)
            .env_clear()
            .env("HOME", home.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn the bridge")
    };
    for refused in [&[][..], &["--endpoint"], &["--endpoint", "/a", "--b"]] {
        let output = timeout(Duration::from_secs(10), run(refused).wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(output.status.code(), Some(EXIT_USAGE), "{refused:?}");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("usage: field-native door --endpoint <path>"),
            "{stderr}"
        );
        assert!(output.stdout.is_empty());
    }
    let missing = home.path().join("no-floor").join("door.sock");
    let output = timeout(
        Duration::from_secs(10),
        run(&["--endpoint", missing.to_str().unwrap()]).wait_with_output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(output.status.code(), Some(EXIT_UNREACHABLE));
    assert_eq!(written_under(home.path()), Vec::<PathBuf>::new());
}

#[tokio::test]
async fn a_spent_budget_ends_the_bridge_with_3() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_at(dir.path()).await;
    let endpoint = door_endpoint(&daemon);
    // the agent's ends stay held, so stdin never ends
    let (_agent_in, bridge_in) = tokio::io::duplex(1024);
    let (bridge_out, _agent_out) = tokio::io::duplex(1024);
    let backoff = Backoff {
        first: Duration::from_millis(20),
        budget: Duration::from_millis(300),
    };
    let run = tokio::spawn(async move { bridge(&endpoint, bridge_in, bridge_out, backoff).await });
    assert!(settles(|| daemon.state.door.open_count() == 1).await);
    let began = Instant::now();
    daemon.shutdown().await;
    let code = timeout(Duration::from_secs(10), run)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(code, EXIT_UNREACHABLE);
    assert!(
        began.elapsed() >= Duration::from_millis(300),
        "it spent its budget first"
    );
}

#[tokio::test]
async fn a_line_past_the_cap_ends_the_bridge_with_4() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_at(dir.path()).await;
    let endpoint = door_endpoint(&daemon);
    let (mut agent_in, bridge_in) = tokio::io::duplex(64 * 1024);
    let (bridge_out, _agent_out) = tokio::io::duplex(1024);
    let run =
        tokio::spawn(
            async move { bridge(&endpoint, bridge_in, bridge_out, Backoff::STANDARD).await },
        );
    let writer = tokio::spawn(async move {
        let _ = agent_in.write_all(&vec![b'x'; LINE_MAX + 1]).await;
        agent_in
    });
    let code = timeout(Duration::from_secs(30), run)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(code, EXIT_LINE_TOO_LONG);
    writer.abort();
}

/// The bridge, in process, on a short budget, closing every door it opens through the floor's own handle the moment
/// it opens, for `rounds` doors or until the bridge ends. Each door is held open `lifetime` first. Returns the doors
/// opened and the bridge's exit code, if it ended.
async fn close_every_door(
    backoff: Backoff,
    lifetime: Duration,
    rounds: usize,
) -> (usize, Option<i32>) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = boot_at(dir.path()).await;
    let endpoint = door_endpoint(&daemon);
    let mut events = daemon.state.door.subscribe_events();
    let (_agent_in, bridge_in) = tokio::io::duplex(1024);
    let (bridge_out, _agent_out) = tokio::io::duplex(1024);
    let mut run =
        tokio::spawn(async move { bridge(&endpoint, bridge_in, bridge_out, backoff).await });
    let mut opened = 0;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        tokio::select! {
            code = &mut run => return (opened, Some(code.unwrap())),
            event = events.recv() => {
                if let Ok(field_native::services::door::DoorEvent::Opened(open)) = event {
                    opened += 1;
                    if opened > rounds {
                        run.abort();
                        return (opened, None);
                    }
                    tokio::time::sleep(lifetime).await;
                    assert!(daemon.state.door.close(open.conn_id.as_str(), "closed-by-fieldd"));
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                run.abort();
                return (opened, None);
            }
        }
    }
}

/// The CO lead's ruling (2026-10-29): a door fieldd keeps closing comes back for at most one budget of delays, and
/// then the bridge exits 3.
#[tokio::test]
async fn a_door_fieldd_keeps_closing_comes_back_for_one_budget_and_then_the_bridge_exits_3() {
    let backoff = Backoff {
        first: Duration::from_millis(20),
        budget: Duration::from_millis(300),
    };
    // 20 + 40 + 80 + 160 ms: four doors after the first, then nothing left to wait
    let (opened, code) = close_every_door(backoff, Duration::ZERO, 50).await;
    assert_eq!(code, Some(EXIT_UNREACHABLE));
    assert_eq!(opened, 1 + backoff.delays().len());
}

/// ...and a connection that lived a whole budget restores it: a door closed only after a budget's life is dialed again
/// every time.
#[tokio::test]
async fn a_door_that_lived_a_whole_budget_restores_the_budget() {
    let backoff = Backoff {
        first: Duration::from_millis(100),
        budget: Duration::from_millis(300),
    };
    // 100 + 200 ms: without the restore the third close would leave nothing to wait
    let (opened, code) = close_every_door(backoff, Duration::from_millis(350), 4).await;
    assert_eq!(code, None, "the bridge was still dialing");
    assert_eq!(opened, 5);
}
