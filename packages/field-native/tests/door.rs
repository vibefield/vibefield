//! CP-1a — the floor's door, end to end on a real floor: a bound `door.sock`, the kernel naming the caller, a door
//! lane carrying bytes both ways through the MeshData bridge, the hold while fieldd is away, and the door stream on
//! the management channel. The callers here are this test process itself; the bridge command's own rows dial it as
//! a child (`door_bridge.rs`).
#![cfg(unix)]

use field_native::local_ipc;
use field_native::services::door::peer::process_facts;
use field_native::services::mesh_bridge::{
    encode_frame, Frame, FrameReader, FRAME_DATA, FRAME_HELLO,
};
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::{timeout, timeout_at, Instant};

const TICK: &str = "native.lifecycle.tick";

async fn boot() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    (dir, daemon)
}

fn secret(daemon: &RunningDaemon) -> Vec<u8> {
    hex::decode(
        std::fs::read_to_string(&daemon.pairing_file)
            .unwrap()
            .trim(),
    )
    .unwrap()
}

fn credential(daemon: &RunningDaemon) -> Value {
    let ts = pairing::now_epoch_secs();
    let boot = "fieldd-boot-test";
    json!({"bootId": boot, "ts": ts, "mac": pairing::compute_mac(&secret(daemon), boot, ts)})
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

/// Polls `check` until it holds or two seconds pass.
async fn settles(check: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !check() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    check()
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

    /// The next line that is not a tick.
    async fn recv(&mut self) -> Value {
        let deadline = Instant::now() + Duration::from_secs(5);
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

    /// The next door stream line.
    async fn door_note(&mut self) -> Value {
        loop {
            let note = self.recv().await;
            if note["method"]
                .as_str()
                .is_some_and(|m| m.starts_with("native.door."))
            {
                return note;
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
        let ack = bytes.next().await.expect("HELLO_OK");
        assert_eq!(
            ack.kind,
            field_native::services::mesh_bridge::FRAME_HELLO_OK
        );
        bytes
    }

    async fn next(&mut self) -> Option<Frame> {
        let deadline = Instant::now() + Duration::from_secs(5);
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

    /// Every DATA byte on `lane_id` until `want` bytes have come.
    async fn read_lane(&mut self, lane_id: u64, want: usize) -> Vec<u8> {
        let mut got = Vec::new();
        while got.len() < want {
            let frame = self.next().await.expect("a DATA frame");
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

async fn read_exactly(door: &mut UnixStream, want: usize) -> Vec<u8> {
    let mut got = vec![0u8; want];
    timeout(Duration::from_secs(5), door.read_exact(&mut got))
        .await
        .expect("read timeout")
        .expect("read");
    got
}

/// The caller sees the floor hang up.
async fn hung_up(door: &mut UnixStream) -> bool {
    let mut buf = [0u8; 16];
    matches!(
        timeout(Duration::from_secs(5), door.read(&mut buf)).await,
        Ok(Ok(0)) | Ok(Err(_))
    )
}

#[tokio::test]
async fn the_door_binds_beside_mgmt_for_its_owner_alone_and_says_how_to_reach_it() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, daemon) = boot().await;
    let path = dir.path().join("native").join("run").join("door.sock");
    let mode = std::fs::metadata(&path)
        .expect("door.sock")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let info = daemon.state.door.info().expect("info");
    assert_eq!(info.endpoint.as_str(), path.to_str().unwrap());
    assert_eq!(
        info.args,
        vec!["door", "--endpoint", path.to_str().unwrap()]
    );
    assert!(std::path::Path::new(info.command.as_str()).is_absolute());
    let mut mgmt = Mgmt::paired(&daemon).await;
    let answer = mgmt.call("native.door.info", json!({})).await;
    assert_eq!(answer["result"]["endpoint"], json!(path.to_str().unwrap()));
    let health = mgmt
        .call("native.lifecycle.health.subscribe", json!({}))
        .await;
    let units = health["result"]["snapshot"]["units"].as_array().unwrap();
    assert!(
        units
            .iter()
            .any(|u| u["unit"] == "door" && u["state"] == "up"),
        "{units:?}"
    );
}

#[tokio::test]
async fn a_door_names_its_caller_and_carries_bytes_both_ways_on_a_lane_the_mesh_stream_never_lists()
{
    let (_dir, daemon) = boot().await;
    let mut mgmt = Mgmt::paired(&daemon).await;
    let subscribed = mgmt.call("native.door.subscribe", json!({})).await;
    assert_eq!(subscribed["result"]["snapshot"], json!({"doors": []}));
    let mut bytes = Bytes::paired(&daemon).await;

    let mut door = UnixStream::connect(door_endpoint(&daemon)).await.unwrap();
    let open = mgmt.door_note().await;
    assert_eq!(open["method"], "native.door.delta");
    let open = &open["params"]["payload"];
    assert_eq!(open["state"], "open");
    let own = process_facts(std::process::id()).unwrap();
    assert_eq!(
        open["caller"],
        json!({"pid": std::process::id(), "startedAtMs": own.started_at_ms})
    );
    // this process runs in no pane the floor lists: `pane` is absent, never empty
    assert!(open.get("pane").is_none(), "{open}");
    let lane_id = open["laneId"].as_u64().unwrap();
    assert!(lane_id >= 1 << 32);

    let request: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n";
    door.write_all(request).await.unwrap();
    assert_eq!(bytes.read_lane(lane_id, request.len()).await, request);
    let answer: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n";
    bytes.send(lane_id, answer).await;
    assert_eq!(read_exactly(&mut door, answer.len()).await, answer);

    let lanes = mgmt.call("native.mesh.lane.subscribe", json!({})).await;
    assert_eq!(
        lanes["result"]["snapshot"]["lanes"],
        json!([]),
        "a door's lane is never on the mesh stream"
    );
    let close = mgmt
        .call("native.mesh.lane.close", json!({"laneId": lane_id}))
        .await;
    assert!(
        close.get("error").is_some(),
        "a door's lane closes through its door: {close}"
    );
    assert_eq!(daemon.state.door.open_count(), 1);
}

#[tokio::test]
async fn a_door_outlives_fieldd_and_what_it_held_follows_the_next_subscription_in_order() {
    let (_dir, daemon) = boot().await;
    // no fieldd at all: the door opens, and its caller's bytes are held
    let mut door = UnixStream::connect(door_endpoint(&daemon)).await.unwrap();
    assert!(settles(|| daemon.state.door.open_count() == 1).await);
    door.write_all(b"first\n").await.unwrap();
    assert!(settles(|| daemon.state.door.held_bytes() == 6).await);

    // a byte-plane client alone does not take them: fieldd has not been told of the door
    let mut bytes = Bytes::paired(&daemon).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(daemon.state.door.held_bytes(), 6);
    let mut mgmt = Mgmt::paired(&daemon).await;
    let subscribed = mgmt.call("native.door.subscribe", json!({})).await;
    let doors = subscribed["result"]["snapshot"]["doors"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(doors.len(), 1);
    let (conn_id, lane_id) = (
        doors[0]["connId"].clone(),
        doors[0]["laneId"].as_u64().unwrap(),
    );
    assert_eq!(bytes.read_lane(lane_id, 6).await, b"first\n");
    assert_eq!(daemon.state.door.held_bytes(), 0);

    // fieldd goes (both of its connections), the door stays, and holds again
    drop(mgmt);
    drop(bytes);
    assert!(settles(|| !daemon.state.door.takes_bytes()).await);
    door.write_all(b"while-away\n").await.unwrap();
    assert!(settles(|| daemon.state.door.held_bytes() == 11).await);
    assert_eq!(daemon.state.door.open_count(), 1);

    // the next fieldd subscribes first this time, and the bytes follow the byte plane's hello
    let mut mgmt = Mgmt::paired(&daemon).await;
    let subscribed = mgmt.call("native.door.subscribe", json!({})).await;
    assert_eq!(
        subscribed["result"]["snapshot"]["doors"][0]["connId"],
        conn_id
    );
    let mut bytes = Bytes::paired(&daemon).await;
    assert_eq!(bytes.read_lane(lane_id, 11).await, b"while-away\n");
    // and the live door goes on in order
    door.write_all(b"after\n").await.unwrap();
    assert_eq!(bytes.read_lane(lane_id, 6).await, b"after\n");
}

#[tokio::test]
async fn a_door_past_its_hold_is_closed_and_its_bytes_released() {
    let (_dir, daemon) = boot().await;
    let mut door = UnixStream::connect(door_endpoint(&daemon)).await.unwrap();
    assert!(settles(|| daemon.state.door.open_count() == 1).await);
    let past = field_native::registries::native_door::HELD_BYTES_PER_DOOR as usize + 1;
    // the write may fail part way: the floor hangs up as soon as the hold is past its bound
    let _ = door.write_all(&vec![b'x'; past]).await;
    assert!(hung_up(&mut door).await);
    assert!(settles(|| daemon.state.door.open_count() == 0).await);
    assert_eq!(daemon.state.door.held_bytes(), 0);
}

#[tokio::test]
async fn fieldd_closes_a_door_once_and_its_caller_is_hung_up_on() {
    let (_dir, daemon) = boot().await;
    let mut mgmt = Mgmt::paired(&daemon).await;
    mgmt.call("native.door.subscribe", json!({})).await;
    let mut door = UnixStream::connect(door_endpoint(&daemon)).await.unwrap();
    let open = mgmt.door_note().await;
    let conn_id = open["params"]["payload"]["connId"].clone();
    let closed = mgmt
        .call("native.door.close", json!({"connId": conn_id}))
        .await;
    assert_eq!(closed["result"], json!({"closed": true}));
    let note = mgmt.door_note().await;
    assert_eq!(
        note["params"]["payload"],
        json!({"connId": conn_id, "state": "closed", "reason": "closed-by-fieldd"})
    );
    assert!(hung_up(&mut door).await);
    let again = mgmt
        .call("native.door.close", json!({"connId": conn_id}))
        .await;
    assert_eq!(again["result"], json!({"closed": false}));
}

#[tokio::test]
async fn the_door_past_the_limit_is_refused_opens_no_lane_and_is_never_announced() {
    let (_dir, daemon) = boot().await;
    let limit = field_native::registries::native_door::MAX_OPEN as usize;
    let endpoint = door_endpoint(&daemon);
    let mut open = Vec::new();
    for _ in 0..limit {
        open.push(UnixStream::connect(&endpoint).await.unwrap());
    }
    assert!(settles(|| daemon.state.door.open_count() == limit).await);
    let mut mgmt = Mgmt::paired(&daemon).await;
    mgmt.call("native.door.subscribe", json!({})).await;
    let mut refused = UnixStream::connect(&endpoint).await.unwrap();
    assert!(hung_up(&mut refused).await);
    assert_eq!(daemon.state.door.open_count(), limit);
    // no line about it: the next door line is the close of one of the open ones
    drop(open.pop());
    let note = mgmt.door_note().await;
    assert_eq!(note["params"]["payload"]["state"], "closed", "{note}");
    assert_eq!(note["params"]["payload"]["reason"], "eof");
}

/// EL7, the CO lead's ruling: a caller churning doors faster than fieldd reads must never close the management
/// channel. The stream drops what the outbox has no headroom for and then owes one snapshot.
#[tokio::test]
async fn a_burst_of_doors_coalesces_into_a_snapshot_and_never_closes_the_management_channel() {
    let (_dir, daemon) = boot().await;
    let mut mgmt = Mgmt::paired(&daemon).await;
    mgmt.call("native.door.subscribe", json!({})).await;
    let endpoint = door_endpoint(&daemon);
    // fieldd reads nothing while 420 doors open and close: 840 events, far past the outbox's 64 lines and what the
    // two socket buffers hold. Each batch stays open until the floor has opened it, so every door is announced.
    for _ in 0..7 {
        let mut batch = Vec::new();
        for _ in 0..60 {
            batch.push(UnixStream::connect(&endpoint).await.unwrap());
        }
        assert!(settles(|| daemon.state.door.open_count() == 60).await);
        drop(batch);
        assert!(settles(|| daemon.state.door.open_count() == 0).await);
    }
    let kept = UnixStream::connect(&endpoint).await.unwrap();
    assert!(settles(|| daemon.state.door.open_count() == 1).await);

    // reading now, the stream converges on the one open door, and it took a snapshot to get there
    let mut doors: std::collections::BTreeMap<String, Value> = Default::default();
    let mut snapshots = 0;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let note = match timeout(Duration::from_millis(500), mgmt.door_note()).await {
            Ok(note) => note,
            Err(_) if doors.len() == 1 => break,
            Err(_) => continue,
        };
        let payload = &note["params"]["payload"];
        if note["method"] == "native.door.snapshot" {
            snapshots += 1;
            doors = (payload["doors"].as_array().unwrap().iter())
                .map(|d| (d["connId"].as_str().unwrap().to_owned(), d.clone()))
                .collect();
        } else if payload["state"] == "open" {
            doors.insert(
                payload["connId"].as_str().unwrap().to_owned(),
                payload.clone(),
            );
        } else {
            doors.remove(payload["connId"].as_str().unwrap());
        }
    }
    assert!(snapshots >= 1, "the burst was coalesced");
    assert_eq!(doors.len(), 1, "{doors:?}");
    // and the channel is the same live connection
    let ping = mgmt.call("native.lifecycle.ping", json!({})).await;
    assert!(ping.get("result").is_some(), "{ping}");
    drop(kept);
}

/// THE FLOOR WALKS, on the real kernel: this test process's parent stands in for a pane root the floor lists, so the
/// door from this process resolves to that pane one step up. A row whose root started at another time is not the
/// pane (the 60 s birth rule), and the door outside it names none.
#[tokio::test]
async fn a_door_from_inside_a_listed_pane_names_the_pane_and_how_far_up_its_root_stood() {
    let (_dir, daemon) = boot().await;
    let own = process_facts(std::process::id()).unwrap();
    let parent = process_facts(own.parent).expect("this process's parent has facts");
    let row = |session: &str, created_at: u64| -> field_native::contracts::ObservedTerminal {
        serde_json::from_value(
            json!({"sessionId": session, "pid": own.parent, "createdAt": created_at}),
        )
        .unwrap()
    };
    daemon.state.observed_tx.send_modify(|observed| {
        observed.terminals = vec![row("pane-born-with-it", parent.started_at_ms)];
    });
    let mut mgmt = Mgmt::paired(&daemon).await;
    mgmt.call("native.door.subscribe", json!({})).await;
    let _door = UnixStream::connect(door_endpoint(&daemon)).await.unwrap();
    let open = mgmt.door_note().await;
    assert_eq!(
        open["params"]["payload"]["pane"],
        json!({"terminalSessionId": "pane-born-with-it", "depth": 1})
    );

    // the same pid listed as the root of a pane born an hour off its start is a husk's row, not this pane
    daemon.state.observed_tx.send_modify(|observed| {
        observed.terminals = vec![row("a-husk", parent.started_at_ms + 3_600_000)];
    });
    let _outside = UnixStream::connect(door_endpoint(&daemon)).await.unwrap();
    let open = mgmt.door_note().await;
    assert!(open["params"]["payload"].get("pane").is_none(), "{open}");
}
