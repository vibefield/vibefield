//! The MeshData bridge (design-02 §2.5, D5) — the local half, which is the half
//! that can be proven without a tailnet. Everything here is real: a bound UDS,
//! the pairing-secret handshake, the streaming codec, the lane table, and the
//! routing between them. The remote leg rides `LaneTransport`, and these tests
//! run it against the loopback implementation so the local behaviour is pinned
//! before C6-3 puts truffle QUIC behind the same seam.
use field_native::services::mesh_bridge::{
    encode_frame, FrameReader, Lane, LaneClass, LoopbackTransport, FRAME_DATA, FRAME_ERR,
    FRAME_HELLO, FRAME_HELLO_OK, HEADER_BYTES, LENGTH_PREFIX_BYTES, LOSSY_MAX_PAYLOAD_BYTES,
    MAX_FRAME_BYTES, SOCKET_NAME,
};
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::time::timeout;

async fn boot() -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    (dir, daemon)
}

fn read_secret(daemon: &RunningDaemon) -> Vec<u8> {
    let path = daemon
        .mgmt_socket
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("pairing");
    hex::decode(std::fs::read_to_string(path).unwrap().trim()).unwrap()
}

struct BridgeClient {
    stream: UnixStream,
    reader: FrameReader,
}

impl BridgeClient {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = UnixStream::connect(&daemon.meshdata_socket)
            .await
            .expect("connect meshdata");
        Self {
            stream,
            reader: FrameReader::default(),
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
        let mut buf = vec![0u8; 64 * 1024];
        for _ in 0..40 {
            let n = match timeout(Duration::from_millis(250), self.stream.read(&mut buf)).await {
                Ok(Ok(0)) | Ok(Err(_)) => return None,
                Ok(Ok(n)) => n,
                Err(_) => continue,
            };
            let frames = self.reader.push(&buf[..n]).expect("decode");
            if let Some(f) = frames.into_iter().next() {
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

#[tokio::test]
async fn the_bridge_binds_its_socket_beside_mgmt() {
    let (_dir, daemon) = boot().await;
    assert!(daemon.meshdata_socket.exists(), "meshdata socket not bound");
    assert!(daemon.meshdata_socket.ends_with(SOCKET_NAME));
    // beside mgmt.sock in the same 0700 run dir — one trust boundary, two planes
    assert_eq!(daemon.meshdata_socket.parent(), daemon.mgmt_socket.parent());
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
async fn a_lossy_lane_refuses_a_payload_that_would_fragment() {
    let (_dir, daemon) = boot().await;
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    let transport = LoopbackTransport::new(tx);
    let big = vec![0u8; LOSSY_MAX_PAYLOAD_BYTES + 1];
    use field_native::services::mesh_bridge::LaneTransport;
    assert!(
        transport
            .send(&lane(1, LaneClass::Lossy), &big)
            .await
            .is_err(),
        "a lossy lane must refuse to fragment"
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
