//! The MeshData bridge (design-02 §2.5, D5) — the local half, which is the half
//! that can be proven without a tailnet. Everything here is real: a bound UDS,
//! the pairing-secret handshake, the streaming codec, the lane table, and the
//! routing between them. The remote leg rides `LaneTransport`, and these tests
//! run it against the loopback implementation so the local behaviour is pinned
//! before C6-3 puts truffle QUIC behind the same seam.
use field_native::local_ipc;
use field_native::services::mesh_bridge::{
    encode_frame, FrameReader, Lane, LaneClass, LaneEvent, LoopbackTransport, FRAME_BARRIER,
    FRAME_BARRIER_OK, FRAME_DATA, FRAME_ERR, FRAME_HELLO, FRAME_HELLO_OK, HEADER_BYTES,
    INBOUND_LANE_ID_BASE, LENGTH_PREFIX_BYTES, LOSSY_MAX_LOGICAL_BYTES, LOSSY_MAX_PAYLOAD_BYTES,
    MAX_FRAME_BYTES,
};
// only the filesystem-shape test reads it, and that test is unix-only
#[cfg(unix)]
use field_native::services::mesh_bridge::SOCKET_NAME;
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;

async fn boot() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    (dir, daemon)
}

fn read_secret(daemon: &RunningDaemon) -> Vec<u8> {
    // WIN-D1: from the file the daemon loaded, not walked up from the endpoint
    // — a pipe name is not a path with a parent (mgmt_server.rs uses the same).
    hex::decode(
        std::fs::read_to_string(&daemon.pairing_file)
            .unwrap()
            .trim(),
    )
    .unwrap()
}

struct BridgeClient {
    stream: local_ipc::ClientStream,
    reader: FrameReader,
    /// One socket read can carry several frames. Holding the surplus is the
    /// difference between "the second one was dropped" and "it is next" — a
    /// helper that discards them turns a passing test into a coin flip the day
    /// two frames first arrive together.
    pending: std::collections::VecDeque<field_native::services::mesh_bridge::Frame>,
}

impl BridgeClient {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.meshdata_endpoint)
            .await
            .expect("connect meshdata");
        Self {
            stream,
            reader: FrameReader::default(),
            pending: std::collections::VecDeque::new(),
        }
    }

    async fn write(&mut self, bytes: &[u8]) {
        self.stream.write_all(bytes).await.expect("write");
    }

    async fn hello(&mut self, daemon: &RunningDaemon, valid: bool) {
        let secret = read_secret(daemon);
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-boot-test";
        let mac = if valid {
            pairing::compute_mac(&secret, boot, ts)
        } else {
            "00".repeat(32)
        };
        let payload = json!({"bootId": boot, "ts": ts, "mac": mac}).to_string();
        let frame = encode_frame(FRAME_HELLO, 0, payload.as_bytes()).unwrap();
        self.write(&frame).await;
    }

    /// Next frame, or None on EOF/timeout — the bridge closing the socket IS a
    /// result here, not a test failure.
    async fn next(&mut self) -> Option<field_native::services::mesh_bridge::Frame> {
        if let Some(f) = self.pending.pop_front() {
            return Some(f);
        }
        let mut buf = vec![0u8; 64 * 1024];
        for _ in 0..40 {
            let n = match timeout(Duration::from_millis(250), self.stream.read(&mut buf)).await {
                Ok(Ok(0)) | Ok(Err(_)) => return None,
                Ok(Ok(n)) => n,
                Err(_) => continue,
            };
            self.pending
                .extend(self.reader.push(&buf[..n]).expect("decode"));
            if let Some(f) = self.pending.pop_front() {
                return Some(f);
            }
        }
        None
    }
}

fn lane(id: u64, class: LaneClass) -> Lane {
    Lane {
        lane_id: id,
        class,
        peer: "peer-a".into(),
        protocol: "doc-sync".into(),
        doc_id: Some("doc-1".into()),
        inbound: false,
    }
}

// ---- the wire constants, pinned against the TypeScript source ---------------

#[test]
fn frame_constants_match_the_typescript_codec() {
    // These are constants, not generated shapes, so NOTHING regenerates them
    // into agreement — a divergence silently desynchronises two byte streams.
    // The numbers below are read from contracts/src/meshdata.ts by eye; this
    // test is what makes changing one of them a two-file change.
    let src = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/src/meshdata.ts"),
    )
    .expect("read meshdata.ts");
    for (name, value) in [
        ("HELLO", FRAME_HELLO),
        ("HELLO_OK", FRAME_HELLO_OK),
        ("DATA", FRAME_DATA),
        ("ERR", FRAME_ERR),
        ("BARRIER", FRAME_BARRIER),
        ("BARRIER_OK", FRAME_BARRIER_OK),
    ] {
        assert!(
            src.contains(&format!("{name}: {value},")),
            "meshdata.ts does not declare {name}: {value}"
        );
    }
    assert!(src.contains(&format!("MESHDATA_HEADER_BYTES = {HEADER_BYTES}")));
    assert!(src.contains(&format!(
        "MESHDATA_LENGTH_PREFIX_BYTES = {LENGTH_PREFIX_BYTES}"
    )));
    assert!(src.contains(&format!(
        "MESHDATA_LOSSY_MAX_PAYLOAD_BYTES = {LOSSY_MAX_PAYLOAD_BYTES}"
    )));
    assert!(src.contains("MESHDATA_LOSSY_MAX_LOGICAL_BYTES = 64 * 1024"));
    assert_eq!(LOSSY_MAX_LOGICAL_BYTES, 64 * 1024);
    // The two minting authorities share one number across two languages, and
    // nothing regenerates them into agreement.
    assert_eq!(INBOUND_LANE_ID_BASE, 1 << 32);
    assert!(
        src.contains("MESHDATA_INBOUND_LANE_ID_BASE = 2 ** 32"),
        "meshdata.ts does not declare MESHDATA_INBOUND_LANE_ID_BASE = 2 ** 32"
    );
}

// ---- the codec -------------------------------------------------------------

#[test]
fn codec_round_trips_and_reassembles_across_arbitrary_chunk_boundaries() {
    let whole = encode_frame(FRAME_DATA, 42, &[1, 2, 3, 4]).unwrap();
    assert_eq!(whole.len(), HEADER_BYTES + 4);

    // one byte at a time — the worst boundary a UDS can hand us
    let mut r = FrameReader::default();
    let mut out = Vec::new();
    for b in &whole {
        out.extend(r.push(&[*b]).unwrap());
    }
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].lane_id, 42);
    assert_eq!(out[0].payload, vec![1, 2, 3, 4]);
    assert_eq!(r.pending(), 0);
}

#[test]
fn codec_yields_several_frames_from_one_chunk_and_holds_the_partial() {
    let mut stream = Vec::new();
    for id in [1u64, 2, 3] {
        stream.extend(encode_frame(FRAME_DATA, id, &[id as u8]).unwrap());
    }
    let cut = stream.len() - 3;
    let mut r = FrameReader::default();
    let first = r.push(&stream[..cut]).unwrap();
    assert_eq!(
        first.iter().map(|f| f.lane_id).collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert!(r.pending() > 0);
    let rest = r.push(&stream[cut..]).unwrap();
    assert_eq!(rest.iter().map(|f| f.lane_id).collect::<Vec<_>>(), vec![3]);
}

#[test]
fn codec_refuses_an_absurd_declared_length_before_allocating() {
    // The attack: claim 4 GB so the daemon reserves 4 GB. The refusal has to
    // happen on the 4-byte prefix alone, with no payload in hand.
    let mut evil = ((MAX_FRAME_BYTES + 1) as u32).to_be_bytes().to_vec();
    evil.extend_from_slice(&[0u8; 4]);
    assert!(FrameReader::default().push(&evil).is_err());
}

#[test]
fn codec_refuses_a_length_shorter_than_its_own_header() {
    let mut evil = 3u32.to_be_bytes().to_vec();
    evil.extend_from_slice(&[0u8; 4]);
    assert!(FrameReader::default().push(&evil).is_err());
}

// ---- the socket ------------------------------------------------------------

// unix-only by content: it asserts filesystem SHAPE (a node on disk, a shared
// parent dir, a .sock suffix). On win32 the endpoints are pipe names with none
// of those properties, and every other test in this file proves the portable
// claim — the endpoint answers a dial.
#[cfg(unix)]
#[tokio::test]
async fn the_bridge_binds_its_socket_beside_mgmt() {
    let (_dir, daemon) = boot().await;
    assert!(
        std::path::Path::new(&daemon.meshdata_endpoint).exists(),
        "meshdata socket not bound"
    );
    assert!(daemon.meshdata_endpoint.ends_with(SOCKET_NAME));
    // beside mgmt.sock in the same 0700 run dir — one trust boundary, two planes
    assert_eq!(
        std::path::Path::new(&daemon.meshdata_endpoint).parent(),
        std::path::Path::new(&daemon.mgmt_endpoint).parent()
    );
    daemon.shutdown().await;
}

#[tokio::test]
async fn an_unauthenticated_client_is_refused_and_dropped() {
    let (_dir, daemon) = boot().await;
    let mut c = BridgeClient::connect(&daemon).await;
    c.hello(&daemon, false).await;
    let frame = c.next().await.expect("expected an error frame");
    assert_eq!(frame.kind, FRAME_ERR);
    // EL7: a same-uid process without the pairing secret gets nothing
    assert!(String::from_utf8_lossy(&frame.payload).contains("unauthenticated"));
    daemon.shutdown().await;
}

#[tokio::test]
async fn data_before_hello_is_refused() {
    let (_dir, daemon) = boot().await;
    let mut c = BridgeClient::connect(&daemon).await;
    c.write(&encode_frame(FRAME_DATA, 1, b"early").unwrap())
        .await;
    let frame = c.next().await.expect("expected an error frame");
    assert_eq!(frame.kind, FRAME_ERR);
    daemon.shutdown().await;
}

#[tokio::test]
async fn an_authenticated_client_gets_hello_ok() {
    let (_dir, daemon) = boot().await;
    let mut c = BridgeClient::connect(&daemon).await;
    c.hello(&daemon, true).await;
    let frame = c.next().await.expect("expected hello-ok");
    assert_eq!(frame.kind, FRAME_HELLO_OK);
    daemon.shutdown().await;
}

// ---- lanes -----------------------------------------------------------------

#[tokio::test]
async fn an_opened_lane_carries_bytes_to_the_transport() {
    let (_dir, daemon) = boot().await;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    daemon
        .bridge
        .set_transport(Arc::new(LoopbackTransport::new(tx)));
    daemon
        .bridge
        .open_lane(lane(7, LaneClass::Reliable))
        .await
        .expect("open lane");

    let mut c = BridgeClient::connect(&daemon).await;
    c.hello(&daemon, true).await;
    assert_eq!(c.next().await.unwrap().kind, FRAME_HELLO_OK);
    c.write(&encode_frame(FRAME_DATA, 7, b"loro-update-bytes").unwrap())
        .await;

    let (lane_id, payload) = timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("transport timeout")
        .expect("transport closed");
    assert_eq!(lane_id, 7);
    // opaque: the bridge moved the bytes without looking at them
    assert_eq!(payload, b"loro-update-bytes");
    daemon.shutdown().await;
}

#[tokio::test]
async fn data_for_an_unopened_lane_errors_that_lane_and_keeps_the_socket() {
    let (_dir, daemon) = boot().await;
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    daemon
        .bridge
        .set_transport(Arc::new(LoopbackTransport::new(tx)));
    let mut c = BridgeClient::connect(&daemon).await;
    c.hello(&daemon, true).await;
    assert_eq!(c.next().await.unwrap().kind, FRAME_HELLO_OK);

    c.write(&encode_frame(FRAME_DATA, 999, b"orphan").unwrap())
        .await;
    let err = c.next().await.expect("expected an unknown-lane error");
    assert_eq!(err.kind, FRAME_ERR);
    assert_eq!(err.lane_id, 999);

    // D5: a lane's problem is a lane's problem — the socket must still work
    daemon
        .bridge
        .open_lane(lane(8, LaneClass::Reliable))
        .await
        .unwrap();
    c.write(&encode_frame(FRAME_DATA, 8, b"still-alive").unwrap())
        .await;
    assert_eq!(daemon.bridge.open_lane_count(), 1);
    daemon.shutdown().await;
}

#[tokio::test]
async fn inbound_deliveries_reach_the_client_framed() {
    let (_dir, daemon) = boot().await;
    daemon
        .bridge
        .open_lane(lane(12, LaneClass::Reliable))
        .await
        .unwrap();
    let mut c = BridgeClient::connect(&daemon).await;
    c.hello(&daemon, true).await;
    assert_eq!(c.next().await.unwrap().kind, FRAME_HELLO_OK);

    daemon.bridge.deliver_inbound(12, b"from-the-peer");
    let frame = c.next().await.expect("expected inbound data");
    assert_eq!(frame.kind, FRAME_DATA);
    assert_eq!(frame.lane_id, 12);
    assert_eq!(frame.payload, b"from-the-peer");

    daemon.bridge.forget_lane(12, "peer-closed");
    daemon.bridge.deliver_inbound(12, b"after-close");
    assert!(
        timeout(Duration::from_millis(50), c.next()).await.is_err(),
        "bytes for a retired inbound id must not leak into fieldd"
    );
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_duplicate_lane_id_is_refused_rather_than_absorbed() {
    let (_dir, daemon) = boot().await;
    daemon
        .bridge
        .open_lane(lane(3, LaneClass::Reliable))
        .await
        .unwrap();
    // laneId is caller-minted: a collision means the caller lost track, and
    // reusing the lane would cross two byte streams into one.
    assert!(daemon
        .bridge
        .open_lane(lane(3, LaneClass::Lossy))
        .await
        .is_err());
    assert_eq!(daemon.bridge.open_lane_count(), 1);
    assert_eq!(daemon.bridge.lane(3).unwrap().class, LaneClass::Reliable);
    daemon.shutdown().await;
}

/// A transport whose `open` parks. The refusal above is decided synchronously,
/// so it cannot see the window a SECOND caller lives in: one that arrives while
/// the first is still awaiting its stream.
struct SlowOpenTransport {
    opens: Arc<std::sync::atomic::AtomicUsize>,
}

#[async_trait::async_trait]
impl field_native::services::mesh_bridge::LaneTransport for SlowOpenTransport {
    async fn open(&self, _lane: &Lane) -> anyhow::Result<()> {
        self.opens.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(200)).await;
        Ok(())
    }
    async fn send(&self, _lane: &Lane, _payload: &[u8]) -> anyhow::Result<()> {
        Ok(())
    }
    async fn close(&self, _lane: &Lane) -> anyhow::Result<()> {
        Ok(())
    }
}

struct RefusingTransport;

#[async_trait::async_trait]
impl field_native::services::mesh_bridge::LaneTransport for RefusingTransport {
    async fn open(&self, _lane: &Lane) -> anyhow::Result<()> {
        anyhow::bail!("no route to peer")
    }
    async fn send(&self, _lane: &Lane, _payload: &[u8]) -> anyhow::Result<()> {
        Ok(())
    }
    async fn close(&self, _lane: &Lane) -> anyhow::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn two_opens_of_one_id_cannot_both_build_a_stream() {
    // The id is RESERVED before the transport is asked, so the loser is refused
    // on the table rather than after building a stream nothing can reach. The
    // parked `open` is what makes this deterministic against the old shape:
    // check-then-insert let both callers pass the check inside that 200ms and
    // both call the transport, leaving one stream live and unreferenced.
    let (_dir, daemon) = boot().await;
    let opens = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    daemon.bridge.set_transport(Arc::new(SlowOpenTransport {
        opens: opens.clone(),
    }));

    let (first, second) = (daemon.bridge.clone(), daemon.bridge.clone());
    let a = tokio::spawn(async move { first.open_lane(lane(9, LaneClass::Reliable)).await });
    let b = tokio::spawn(async move { second.open_lane(lane(9, LaneClass::Reliable)).await });
    let (a, b) = (a.await.unwrap(), b.await.unwrap());

    assert_eq!(
        [a.is_ok(), b.is_ok()].iter().filter(|ok| **ok).count(),
        1,
        "exactly one open may win a contested id"
    );
    assert_eq!(
        opens.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the loser must never reach the transport — a stream it built would leak"
    );
    assert_eq!(daemon.bridge.open_lane_count(), 1);
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_refused_open_releases_the_id_rather_than_burning_it() {
    // The other half of reserve-then-open: a reservation that outlived its
    // failure would cost the caller that number for the daemon's lifetime, and
    // an unreachable peer is a transient condition, not a permanent one.
    let (_dir, daemon) = boot().await;
    daemon.bridge.set_transport(Arc::new(RefusingTransport));
    assert!(daemon
        .bridge
        .open_lane(lane(11, LaneClass::Reliable))
        .await
        .is_err());
    assert_eq!(
        daemon.bridge.open_lane_count(),
        0,
        "a failed open must leave no reservation behind"
    );

    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    daemon
        .bridge
        .set_transport(Arc::new(LoopbackTransport::new(tx)));
    assert!(
        daemon
            .bridge
            .open_lane(lane(11, LaneClass::Reliable))
            .await
            .is_ok(),
        "the id must be usable again once the peer is reachable"
    );
    daemon.shutdown().await;
}

#[tokio::test]
async fn closing_a_lane_is_idempotent() {
    let (_dir, daemon) = boot().await;
    daemon
        .bridge
        .open_lane(lane(5, LaneClass::Reliable))
        .await
        .unwrap();
    daemon.bridge.close_lane(5).await.unwrap();
    // both ends hanging up at once is the normal race, not an error
    daemon.bridge.close_lane(5).await.unwrap();
    assert_eq!(daemon.bridge.open_lane_count(), 0);
    assert!(daemon.bridge.lane(5).is_none());
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_lossy_lane_accepts_fragmentable_messages_but_refuses_past_the_logical_cap() {
    let (_dir, daemon) = boot().await;
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    let transport = LoopbackTransport::new(tx);
    let fragmentable = vec![0u8; LOSSY_MAX_PAYLOAD_BYTES + 1];
    use field_native::services::mesh_bridge::LaneTransport;
    assert!(transport
        .send(&lane(1, LaneClass::Lossy), &fragmentable)
        .await
        .is_ok());
    let big = vec![0u8; LOSSY_MAX_LOGICAL_BYTES + 1];
    assert!(
        transport
            .send(&lane(1, LaneClass::Lossy), &big)
            .await
            .is_err(),
        "a lossy lane must refuse past its logical-message cap"
    );
    // the same payload on a reliable lane is fine — that is the whole difference
    assert!(transport
        .send(&lane(2, LaneClass::Reliable), &big)
        .await
        .is_ok());
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_bridge_reports_itself_in_native_health() {
    let (_dir, daemon) = boot().await;
    let health = daemon.state.health_tx.borrow().clone();
    let bridge = health
        .units
        .iter()
        .find(|u| u.unit == "mesh-bridge")
        .expect("mesh-bridge unit missing from health");
    assert!(matches!(
        bridge.state,
        field_native::contracts::UnitState::Up
    ));
    daemon.shutdown().await;
}

// ---- lane control over the mgmt channel (C6-3) -----------------------------
// The control half of D5: lanes are negotiated on the management channel and
// then get out of the way. These drive the real JSON-RPC surface, not the
// handle directly, so the contract in methods.ts is what is actually exercised.

struct MgmtClient {
    reader: tokio::io::Lines<tokio::io::BufReader<tokio::io::ReadHalf<local_ipc::ClientStream>>>,
    writer: tokio::io::WriteHalf<local_ipc::ClientStream>,
}

impl MgmtClient {
    async fn connect(daemon: &RunningDaemon) -> Self {
        use tokio::io::AsyncBufReadExt;
        let stream = local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .expect("connect mgmt");
        let (r, w) = tokio::io::split(stream);
        Self {
            reader: tokio::io::BufReader::new(r).lines(),
            writer: w,
        }
    }
    async fn call(&mut self, method: &str, params: serde_json::Value) -> serde_json::Value {
        let mut line = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).await.expect("write");
        let out = timeout(Duration::from_secs(5), self.reader.next_line())
            .await
            .expect("timeout")
            .expect("read")
            .expect("closed");
        serde_json::from_str(&out).expect("json")
    }
    async fn hello(&mut self, daemon: &RunningDaemon) {
        let secret = read_secret(daemon);
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-boot-test";
        let mac = pairing::compute_mac(&secret, boot, ts);
        self.call(
            "native.lifecycle.hello",
            json!({"contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
                   "credential":{"bootId":boot,"ts":ts,"mac":mac}}),
        )
        .await;
    }
    /// The next server-pushed notification (subscriptions are one-way after
    /// their response line).
    async fn next_note(&mut self) -> serde_json::Value {
        let out = timeout(Duration::from_secs(5), self.reader.next_line())
            .await
            .expect("timed out waiting for a notification")
            .expect("read")
            .expect("closed");
        serde_json::from_str(&out).expect("json")
    }
}

#[tokio::test]
async fn lane_open_without_a_mesh_node_is_honestly_unavailable() {
    // Mesh is disabled by default in tests. A lane needs somewhere to go, so
    // the answer names the mesh unit's REAL state rather than inventing a lane
    // that silently goes nowhere (the C1 honesty shape).
    let (_dir, daemon) = boot().await;
    let mut c = MgmtClient::connect(&daemon).await;
    c.hello(&daemon).await;
    let resp = c
        .call(
            "native.mesh.lane.open",
            json!({"laneId":1,"class":"reliable","peer":"peer-a","protocol":"doc-sync"}),
        )
        .await;
    assert_eq!(resp["error"]["data"]["kind"], "UNAVAILABLE");
    assert_eq!(resp["error"]["data"]["details"]["service"], "mesh-gateway");
    assert_eq!(daemon.bridge.open_lane_count(), 0);
    daemon.shutdown().await;
}

#[tokio::test]
async fn lane_close_works_with_the_mesh_down_because_that_is_when_it_is_needed() {
    let (_dir, daemon) = boot().await;
    // opened directly: the point is that CLOSE is not gated behind a live node
    daemon
        .bridge
        .open_lane(lane(4, LaneClass::Reliable))
        .await
        .unwrap();
    let mut c = MgmtClient::connect(&daemon).await;
    c.hello(&daemon).await;
    let resp = c.call("native.mesh.lane.close", json!({"laneId":4})).await;
    assert_eq!(resp["result"]["laneId"], 4);
    assert_eq!(daemon.bridge.open_lane_count(), 0);
    // and again — idempotent, because both ends hanging up at once is normal
    let again = c.call("native.mesh.lane.close", json!({"laneId":4})).await;
    assert_eq!(again["result"]["laneId"], 4);
    daemon.shutdown().await;
}

#[tokio::test]
async fn lane_open_refuses_a_malformed_request() {
    let (_dir, daemon) = boot().await;
    let mut c = MgmtClient::connect(&daemon).await;
    c.hello(&daemon).await;
    let resp = c
        .call(
            "native.mesh.lane.open",
            json!({"laneId":1,"class":"telepathy"}),
        )
        .await;
    assert_eq!(resp["error"]["data"]["kind"], "PRECONDITION_FAILED");
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_lane_with_no_transport_says_so_instead_of_swallowing_the_bytes() {
    // `lane.open` refuses while the mesh is down, so this needs a transport
    // that went away UNDER a live lane. Rare — and exactly the case where
    // silence would read as a peer that stopped listening.
    let (_dir, daemon) = boot().await;
    daemon
        .bridge
        .open_lane(lane(8, LaneClass::Reliable))
        .await
        .unwrap(); // no transport installed
    let mut c = BridgeClient::connect(&daemon).await;
    c.hello(&daemon, true).await;
    assert_eq!(c.next().await.map(|f| f.kind), Some(FRAME_HELLO_OK));
    c.write(&encode_frame(FRAME_DATA, 8, b"into-the-void").unwrap())
        .await;
    let err = c
        .next()
        .await
        .expect("the bridge answers rather than eating it");
    assert_eq!(err.kind, FRAME_ERR);
    assert_eq!(err.lane_id, 8);
    assert!(
        String::from_utf8_lossy(&err.payload).contains("no-transport"),
        "the reason names the cause: {:?}",
        String::from_utf8_lossy(&err.payload)
    );
    daemon.shutdown().await;
}

#[tokio::test]
async fn lane_open_refuses_an_id_from_the_inbound_half() {
    // The numbering split is a law, so the DOOR enforces it — leaving it to
    // fieldd's discipline means the separation holds only while every caller
    // remembers it exists.
    let (_dir, daemon) = boot().await;
    let mut c = MgmtClient::connect(&daemon).await;
    c.hello(&daemon).await;
    let resp = c
        .call(
            "native.mesh.lane.open",
            json!({"laneId": INBOUND_LANE_ID_BASE, "class":"reliable","peer":"p","protocol":"doc-sync"}),
        )
        .await;
    assert_eq!(resp["error"]["data"]["kind"], "PRECONDITION_FAILED");
    assert!(
        resp["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("reserved"),
        "the refusal explains itself: {}",
        resp["error"]["message"]
    );
    // …and it is refused BEFORE the mesh gate, so the reason is the id rather
    // than the honest-but-unrelated UNAVAILABLE.
    assert_eq!(daemon.bridge.open_lane_count(), 0);
    daemon.shutdown().await;
}

// ---- supersession: two overlapping fieldds ---------------------------------
// Not a corner case. field-native OUTLIVES fieldd (the two-plane law), so every
// fieldd restart puts two connections on this socket at once — the new process
// authenticates before the old task notices EOF.

#[tokio::test]
async fn a_superseded_connection_dying_does_not_silence_the_live_one() {
    // The regression: teardown used to clear the delivery slot unconditionally,
    // so the OLD connection's exit wiped the NEW one's path. Every inbound byte
    // then vanished with no error, no log and no lane.closed — and asymmetric,
    // because fieldd→peer kept working, so it read as "the peer went quiet".
    let (_dir, daemon) = boot().await;
    // The lane must EXIST: deliver_inbound gained close's receive-half fence
    // (unknown ids drop — asserted as a feature by the retired-id test above),
    // and this test's subject is supersession, not unknown-lane semantics.
    daemon
        .bridge
        .open_lane(lane(7, LaneClass::Reliable))
        .await
        .unwrap();
    let mut first = BridgeClient::connect(&daemon).await;
    first.hello(&daemon, true).await;
    assert_eq!(first.next().await.map(|f| f.kind), Some(FRAME_HELLO_OK));

    let mut second = BridgeClient::connect(&daemon).await;
    second.hello(&daemon, true).await;
    assert_eq!(second.next().await.map(|f| f.kind), Some(FRAME_HELLO_OK));

    // The superseded connection goes away, as a restarted fieldd's old socket does.
    drop(first);
    tokio::time::sleep(Duration::from_millis(200)).await;

    daemon.bridge.deliver_inbound(7, b"still-listening");
    let got = second
        .next()
        .await
        .expect("the live client must still receive");
    assert_eq!(got.kind, FRAME_DATA);
    assert_eq!(got.lane_id, 7);
    assert_eq!(got.payload, b"still-listening");
    daemon.shutdown().await;
}

#[tokio::test]
async fn a_superseded_connection_stops_being_the_product_plane() {
    // It keeps its `authed` bit, so without an explicit check a stale fieldd
    // goes on writing to lanes the new one now owns.
    let (_dir, daemon) = boot().await;
    daemon
        .bridge
        .open_lane(lane(1, LaneClass::Reliable))
        .await
        .unwrap();
    let mut first = BridgeClient::connect(&daemon).await;
    first.hello(&daemon, true).await;
    assert_eq!(first.next().await.map(|f| f.kind), Some(FRAME_HELLO_OK));

    let mut second = BridgeClient::connect(&daemon).await;
    second.hello(&daemon, true).await;
    assert_eq!(second.next().await.map(|f| f.kind), Some(FRAME_HELLO_OK));

    // The stale connection tries to use a lane it no longer owns.
    first
        .write(&encode_frame(FRAME_DATA, 1, b"from-the-past").unwrap())
        .await;
    let refusal = first.next().await.expect("the stale client is told why");
    assert_eq!(refusal.kind, FRAME_ERR);
    assert!(
        String::from_utf8_lossy(&refusal.payload).contains("superseded"),
        "the refusal names the reason: {:?}",
        String::from_utf8_lossy(&refusal.payload)
    );
    // …and the live connection is untouched by any of it.
    daemon.bridge.deliver_inbound(1, b"for-the-live-one");
    let got = second.next().await.expect("live client still receives");
    assert_eq!(got.payload, b"for-the-live-one");
    daemon.shutdown().await;
}

// ---- inbound lanes: adoption + announcement (C6-3) --------------------------
// The transport's half of the lane table, exercised WITHOUT a tailnet. What
// needs two real nodes is the QUIC carriage itself, and that lives in
// tests/quic_lane_transport.rs; the id arithmetic and the announcement do not,
// so they are proven on every commit rather than only when a key is present.

#[tokio::test]
async fn an_adopted_lane_cannot_collide_with_one_fieldd_minted() {
    // Two numbering authorities, one table. fieldd mints outbound ids from its
    // own counter starting low; the bridge mints inbound ids from a base far
    // above it. If these ever met, one lane's bytes would reach the other's
    // consumer — so this pins the separation rather than trusting it.
    let (_dir, daemon) = boot().await;
    for id in 0..64 {
        daemon
            .bridge
            .open_lane(lane(id, LaneClass::Reliable))
            .await
            .unwrap();
    }
    let adopted = daemon.bridge.adopt_inbound_lane(
        LaneClass::Reliable,
        "ts-peer".into(),
        "doc-sync".into(),
        Some("doc-9".into()),
    );
    assert!(
        adopted.lane_id >= INBOUND_LANE_ID_BASE,
        "inbound ids come from their own half of the space: {}",
        adopted.lane_id
    );
    assert!(adopted.inbound, "an adopted lane knows which way it points");
    assert_eq!(daemon.bridge.open_lane_count(), 65);
    daemon.shutdown().await;
}

#[tokio::test]
async fn an_inbound_lane_id_survives_the_trip_through_json() {
    // laneId crosses the mgmt channel as a JavaScript number. Anything past
    // 2^53 loses precision there, and a lane id that does not round-trip
    // delivers bytes to the wrong consumer — silently.
    let (_dir, daemon) = boot().await;
    let adopted =
        daemon
            .bridge
            .adopt_inbound_lane(LaneClass::Reliable, "p".into(), "doc-sync".into(), None);
    assert!(
        (adopted.lane_id as f64) as u64 == adopted.lane_id,
        "lane id {} is not exactly representable as an f64",
        adopted.lane_id
    );
    daemon.shutdown().await;
}

#[tokio::test]
async fn subscribers_hear_a_peer_open_a_lane_and_hear_it_close() {
    let (_dir, daemon) = boot().await;
    let mut c = MgmtClient::connect(&daemon).await;
    c.hello(&daemon).await;

    // The subscription is NOT gated on a live node: fieldd subscribes at boot,
    // and if it had to wait for the mesh it would miss the first inbound lane.
    let resp = c.call("native.mesh.lane.subscribe", json!({})).await;
    assert!(resp["result"]["subId"].is_string());
    assert_eq!(
        resp["result"]["snapshot"]["lanes"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    let adopted = daemon.bridge.adopt_inbound_lane(
        LaneClass::Reliable,
        "ts-abc".into(),
        "doc-sync".into(),
        Some("doc-1".into()),
    );
    let opened = c.next_note().await;
    assert_eq!(opened["method"], "native.mesh.lane.delta");
    assert_eq!(opened["params"]["payload"]["kind"], "peerOpened");
    let payload = &opened["params"]["payload"];
    assert_eq!(payload["laneId"], adopted.lane_id);
    assert_eq!(payload["inbound"], true);
    assert_eq!(payload["peer"], "ts-abc");
    assert_eq!(payload["protocol"], "doc-sync");
    assert_eq!(payload["docId"], "doc-1");
    // EL7: absent, not empty — truffle's Peer carries no tailnet login, and a
    // synthesized one would be fabricated identity.
    assert!(payload.get("whois").is_none());

    // The peer hangs up at the transport.
    daemon.bridge.forget_lane(adopted.lane_id, "peer-closed");
    let closed = c.next_note().await;
    assert_eq!(closed["method"], "native.mesh.lane.delta");
    assert_eq!(closed["params"]["payload"]["kind"], "closed");
    assert_eq!(closed["params"]["payload"]["laneId"], adopted.lane_id);
    assert_eq!(closed["params"]["payload"]["reason"], "peer-closed");
    assert_eq!(closed["params"]["payload"]["inbound"], true);
    assert_eq!(daemon.bridge.open_lane_count(), 0);
    daemon.shutdown().await;
}

#[tokio::test]
async fn an_inbound_lane_is_not_announced_until_its_transport_routes_exist() {
    let (_dir, daemon) = boot().await;
    let mut events = daemon.bridge.subscribe_events();
    let reserved = daemon.bridge.reserve_inbound_lane(
        LaneClass::Lossy,
        "ts-abc".into(),
        "presence".into(),
        Some("doc-1".into()),
    );
    assert!(matches!(
        events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
    let stored = daemon.bridge.lane(reserved.lane_id).expect("reserved lane");
    assert_eq!(stored.lane_id, reserved.lane_id);
    assert_eq!(stored.class, LaneClass::Lossy);
    assert_eq!(stored.doc_id.as_deref(), Some("doc-1"));

    daemon.bridge.announce_inbound_lane(&reserved);
    match events.recv().await.unwrap() {
        LaneEvent::PeerOpened(opened) => assert_eq!(opened.lane_id, reserved.lane_id),
        other => panic!("expected peerOpened, got {other:?}"),
    }
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_lane_snapshot_carries_lanes_already_open() {
    // A fieldd that reconnects mid-session must learn the lanes it missed from
    // the snapshot; the event stream alone would leave it blind to them.
    let (_dir, daemon) = boot().await;
    daemon
        .bridge
        .open_lane(lane(3, LaneClass::Reliable))
        .await
        .unwrap();
    let inbound = daemon.bridge.adopt_inbound_lane(
        LaneClass::Lossy,
        "ts-xyz".into(),
        "presence".into(),
        Some("doc-presence".into()),
    );

    let mut c = MgmtClient::connect(&daemon).await;
    c.hello(&daemon).await;
    let resp = c.call("native.mesh.lane.subscribe", json!({})).await;
    let lanes = resp["result"]["snapshot"]["lanes"].as_array().unwrap();
    assert_eq!(lanes.len(), 2);
    // id-ordered, so the outbound one (a small caller-minted id) comes first
    assert_eq!(lanes[0]["laneId"], 3);
    assert_eq!(lanes[0]["class"], "reliable");
    assert!(lanes[0].get("inbound").is_none(), "outbound is the default");
    assert_eq!(lanes[0]["docId"], "doc-1");
    assert_eq!(lanes[1]["laneId"], inbound.lane_id);
    assert_eq!(lanes[1]["class"], "lossy");
    assert_eq!(lanes[1]["inbound"], true);
    assert_eq!(lanes[1]["docId"], "doc-presence");
    daemon.shutdown().await;
}

#[tokio::test]
async fn closing_a_lane_locally_is_announced_once_not_twice() {
    // lane.close is idempotent, but the EVENT must not be: a second close of a
    // dead lane telling fieldd it died again would look like a new failure.
    let (_dir, daemon) = boot().await;
    let mut c = MgmtClient::connect(&daemon).await;
    c.hello(&daemon).await;
    c.call("native.mesh.lane.subscribe", json!({})).await;

    daemon
        .bridge
        .open_lane(lane(5, LaneClass::Reliable))
        .await
        .unwrap();
    c.call("native.mesh.lane.close", json!({"laneId":5})).await;
    let closed = c.next_note().await;
    assert_eq!(closed["params"]["payload"]["kind"], "closed");
    assert_eq!(closed["params"]["payload"]["reason"], "local");

    c.call("native.mesh.lane.close", json!({"laneId":5})).await;
    daemon
        .bridge
        .open_lane(lane(6, LaneClass::Reliable))
        .await
        .unwrap();
    daemon.bridge.forget_lane(6, "peer-closed");
    // If the second close had announced itself, this would be lane 5 again.
    let next = c.next_note().await;
    assert_eq!(next["params"]["payload"]["laneId"], 6);
    daemon.shutdown().await;
}
