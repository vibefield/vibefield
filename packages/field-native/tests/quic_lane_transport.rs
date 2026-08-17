//! C6-3 end to end: a lane opened on one device's mgmt plane, carried over a
//! real tailnet by QUIC, and delivered out of ANOTHER device's byte socket.
//!
//! This is the test the whole C6 track was building toward, and it is the only
//! one that can answer the question the loopback transport cannot: do two
//! field-native daemons actually move a document's bytes between two machines?
//! Everything it exercises is production code — two real `bootstrap()`ed
//! daemons, the real `MeshBridge`, the real `TruffleLaneTransport`, the real
//! `serve_inbound` accept loop. Only the tailnet nodes are built by hand, so
//! the test can pick its own throwaway namespace instead of joining as the
//! product (see `common/mod.rs`).
//!
//! Gated and `#[ignore]`d for the reasons in `common/mod.rs`:
//!     cargo test -p field-native --test quic_lane_transport -- --ignored --nocapture

mod common;

use common::{authkey, build_node, probe_app_id, redact, rendezvous, sidecar, AUTHKEY_ENV};
use field_native::config::NativeConfig;
use field_native::local_ipc;
use field_native::services::lane_transport::{TruffleLaneTransport, DOC_SYNC_QUIC_PORT};
use field_native::services::mesh_bridge::{
    encode_frame, Frame, FrameReader, Lane, LaneClass, LaneEvent, INBOUND_LANE_ID_BASE,
};
use field_native::{bootstrap, pairing, RunningDaemon};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;

/// fieldd's end of one daemon's byte plane. Deliberately NOT shared with
/// `mesh_bridge.rs`'s client: that one exists to probe refusals and needs to
/// send a bad MAC, this one only ever behaves. Two small honest clients beat
/// one with a `valid: bool` knob whose false branch is dead here.
struct DataClient {
    stream: local_ipc::ClientStream,
    reader: FrameReader,
    /// One socket read can carry SEVERAL frames — two lane records written back
    /// to back routinely arrive together. Holding the surplus is the difference
    /// between "the second record was dropped" and "the second record is next".
    pending: std::collections::VecDeque<Frame>,
}

impl DataClient {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.meshdata_endpoint)
            .await
            .expect("connect meshdata");
        let mut client = Self {
            stream,
            reader: FrameReader::default(),
            pending: std::collections::VecDeque::new(),
        };
        // WIN-D1: the pairing file the daemon loaded, not walked up from the
        // endpoint (a pipe name has no parent on disk).
        let secret = hex::decode(
            std::fs::read_to_string(&daemon.pairing_file)
                .unwrap()
                .trim(),
        )
        .unwrap();
        let ts = pairing::now_epoch_secs();
        let boot = "fieldd-lane-e2e";
        let hello =
            json!({"bootId": boot, "ts": ts, "mac": pairing::compute_mac(&secret, boot, ts)})
                .to_string();
        client
            .write(
                &encode_frame(
                    field_native::services::mesh_bridge::FRAME_HELLO,
                    0,
                    hello.as_bytes(),
                )
                .unwrap(),
            )
            .await;
        let ok = client.next().await.expect("hello answered");
        assert_eq!(ok.kind, field_native::services::mesh_bridge::FRAME_HELLO_OK);
        client
    }

    async fn write(&mut self, bytes: &[u8]) {
        self.stream.write_all(bytes).await.expect("write");
    }

    async fn send_lane(&mut self, lane_id: u64, payload: &[u8]) {
        let frame = encode_frame(
            field_native::services::mesh_bridge::FRAME_DATA,
            lane_id,
            payload,
        )
        .unwrap();
        self.write(&frame).await;
    }

    async fn next(&mut self) -> Option<Frame> {
        if let Some(f) = self.pending.pop_front() {
            return Some(f);
        }
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = match self.stream.read(&mut buf).await {
                Ok(0) | Err(_) => return None,
                Ok(n) => n,
            };
            self.pending
                .extend(self.reader.push(&buf[..n]).expect("decode"));
            if let Some(f) = self.pending.pop_front() {
                return Some(f);
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY; run with --ignored"]
async fn a_lane_carries_document_bytes_between_two_daemons_over_the_mesh() {
    let Some(key) = authkey() else {
        eprintln!("[skip] quic_lane_transport: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar_path) = sidecar() else {
        eprintln!("[skip] quic_lane_transport: no truffle sidecar found");
        return;
    };

    // Opt-in daemon tracing — `RUST_LOG=1 cargo test … -- --ignored --nocapture`
    // prints both daemons' events interleaved with the tailnet's, which is how
    // a failure here gets diagnosed. Off by default: at DEBUG the QUIC layer
    // alone buries the assertions.
    if std::env::var_os("RUST_LOG").is_some() {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_test_writer()
            .try_init();
    }
    let app_id = probe_app_id();
    eprintln!(
        "[e2e] app_id={app_id} sidecar={} authkey={}",
        sidecar_path.display(),
        redact(&key)
    );

    let alpha_state = tempfile::TempDir::with_prefix("vf-e2e-alpha-net-").unwrap();
    let beta_state = tempfile::TempDir::with_prefix("vf-e2e-beta-net-").unwrap();
    let (alpha, beta) = tokio::join!(
        build_node(&app_id, "alpha", alpha_state.path(), &key, &sidecar_path),
        build_node(&app_id, "beta", beta_state.path(), &key, &sidecar_path),
    );
    let (alpha, beta) = (Arc::new(alpha), Arc::new(beta));
    let alpha_host = alpha.local_info().tailscale_hostname.clone();
    let beta_host = beta.local_info().tailscale_hostname.clone();
    eprintln!("[e2e] nodes up: alpha={alpha_host} beta={beta_host}");

    // Both directions: alpha needs beta's id to dial it, and beta needs to see
    // alpha to name it in the announcement. That second one is the EL7 property
    // under test — the announced peer is resolved from the authenticated
    // address, not read out of the stream's own header.
    let (beta_id, alpha_id) = tokio::join!(
        rendezvous(&alpha, &beta_host),
        rendezvous(&beta, &alpha_host)
    );
    eprintln!("[e2e] rendezvous: alpha↔beta as {alpha_id} ↔ {beta_id}");

    // Two REAL daemons. Their own mesh units stay disabled (the test owns the
    // nodes), but everything downstream of the transport seam is production.
    let dir_a = tempfile::TempDir::with_prefix("vf-e2e-a-").unwrap();
    let dir_b = tempfile::TempDir::with_prefix("vf-e2e-b-").unwrap();
    let daemon_a = bootstrap(NativeConfig::for_data_dir(dir_a.path().to_path_buf()))
        .await
        .expect("daemon A");
    let daemon_b = bootstrap(NativeConfig::for_data_dir(dir_b.path().to_path_buf()))
        .await
        .expect("daemon B");

    let mut fieldd_a = DataClient::connect(&daemon_a).await;
    let mut fieldd_b = DataClient::connect(&daemon_b).await;
    let mut lanes_b = daemon_b.bridge.subscribe_events();

    // B accepts inbound lanes; A dials out. Each production transport also
    // binds the shared presence UDP socket even though this witness uses the
    // reliable class.
    let transport_b = Arc::new(
        TruffleLaneTransport::new(beta.clone(), daemon_b.bridge.clone(), DOC_SYNC_QUIC_PORT).await,
    );
    daemon_b.bridge.set_transport(transport_b.clone());
    let inbound = tokio::spawn(field_native::services::lane_transport::serve_inbound(
        transport_b,
    ));
    let transport_a = Arc::new(
        TruffleLaneTransport::new(alpha.clone(), daemon_a.bridge.clone(), DOC_SYNC_QUIC_PORT).await,
    );
    daemon_a.bridge.set_transport(transport_a);

    // The listener binds asynchronously, so the first dial can legitimately
    // lose the race. Retrying is honest; a bare sleep would only hide it.
    let lane = Lane {
        lane_id: 7,
        class: LaneClass::Reliable,
        peer: beta_id.clone(),
        protocol: "doc-sync".into(),
        doc_id: Some("doc-1".into()),
        inbound: false,
    };
    let mut opened = Err(anyhow::anyhow!("not attempted"));
    for attempt in 0..10 {
        opened = daemon_a.bridge.open_lane(lane.clone()).await;
        if opened.is_ok() {
            eprintln!("[e2e] lane open on attempt {}", attempt + 1);
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    opened.expect("lane never opened toward beta");

    // 1. B learns of the lane on its CONTROL plane …
    let adopted = match timeout(Duration::from_secs(30), lanes_b.recv())
        .await
        .expect("no lane event within 30s")
        .expect("lane event stream closed")
    {
        LaneEvent::PeerOpened(l) => l,
        other => panic!("expected a peerOpened, got {other:?}"),
    };
    assert!(adopted.inbound);
    assert_eq!(adopted.protocol, "doc-sync");
    assert_eq!(adopted.doc_id.as_deref(), Some("doc-1"));
    assert!(
        adopted.lane_id >= INBOUND_LANE_ID_BASE,
        "an adopted lane is renumbered into the inbound space, not given the \
         originator's id: {}",
        adopted.lane_id
    );
    assert_eq!(
        adopted.peer, alpha_id,
        "the announced peer must be the tailnet's answer about the address that \
         dialled, not the stream's claim about itself (EL7)"
    );
    eprintln!(
        "[e2e] beta adopted lane {} from {}",
        adopted.lane_id, adopted.peer
    );

    // 2. … and the bytes arrive on its DATA plane. Binary with NULs, because a
    //    Loro update record is not text and a string-shaped path corrupts it.
    let first: Vec<u8> = vec![0, 1, 2, 0, 255, 128, 0, 42];
    let second: Vec<u8> = vec![7, 0, 0, 9];
    fieldd_a.send_lane(7, &first).await;
    fieldd_a.send_lane(7, &second).await;

    let got_one = timeout(Duration::from_secs(30), fieldd_b.next())
        .await
        .expect("timed out")
        .expect("no frame");
    assert_eq!(
        got_one.kind,
        field_native::services::mesh_bridge::FRAME_DATA
    );
    assert_eq!(got_one.lane_id, adopted.lane_id, "delivered on B's own id");
    assert_eq!(got_one.payload, first, "bytes must cross unchanged");

    // The record boundary is the point: QUIC is a byte STREAM, so two sends
    // arriving as one 12-byte blob would hand fieldd an unsplittable payload
    // and corrupt every document update after the first.
    let got_two = timeout(Duration::from_secs(30), fieldd_b.next())
        .await
        .expect("timed out")
        .expect("no second frame");
    assert_eq!(
        got_two.payload, second,
        "each send is its own record — two writes must not coalesce into one"
    );
    eprintln!("[e2e] two records crossed the mesh with their boundaries intact");

    // 3. A hangs up; B hears it as a lane ending, not as a daemon problem.
    daemon_a.bridge.close_lane(7).await.expect("close");
    let closed = timeout(Duration::from_secs(30), lanes_b.recv())
        .await
        .expect("no close event within 30s")
        .expect("lane event stream closed");
    match closed {
        LaneEvent::Closed {
            lane_id, reason, ..
        } => {
            assert_eq!(lane_id, adopted.lane_id);
            assert_eq!(reason, "peer-closed");
        }
        other => panic!("expected a Closed, got {other:?}"),
    }
    assert_eq!(daemon_b.bridge.open_lane_count(), 0);
    eprintln!("[e2e] lane closed cleanly from the far end");

    // 4. The released presence shape: a fragmentable logical snapshot crosses
    //    the shared UDP socket only after READY installed its authenticated
    //    route. Graceful close replays it on QUIC, and the receiver deduplicates
    //    that replay rather than delivering the snapshot twice.
    let lossy = Lane {
        lane_id: 9,
        class: LaneClass::Lossy,
        peer: beta_id.clone(),
        protocol: "presence".into(),
        doc_id: Some("doc-presence".into()),
        inbound: false,
    };
    daemon_a
        .bridge
        .open_lane(lossy)
        .await
        .expect("lossy presence lane opened toward beta");
    let adopted_lossy = match timeout(Duration::from_secs(30), lanes_b.recv())
        .await
        .expect("no lossy lane event within 30s")
        .expect("lane event stream closed")
    {
        LaneEvent::PeerOpened(lane) => lane,
        other => panic!("expected lossy peerOpened, got {other:?}"),
    };
    assert_eq!(adopted_lossy.class, LaneClass::Lossy);
    assert_eq!(adopted_lossy.protocol, "presence");
    assert_eq!(adopted_lossy.doc_id.as_deref(), Some("doc-presence"));
    let presence = vec![0x5a; 4_242];
    fieldd_a.send_lane(9, &presence).await;
    let got_presence = timeout(Duration::from_secs(30), fieldd_b.next())
        .await
        .expect("presence datagrams timed out")
        .expect("no reassembled presence frame");
    assert_eq!(got_presence.lane_id, adopted_lossy.lane_id);
    assert_eq!(got_presence.payload, presence);
    daemon_a.bridge.close_lane(9).await.expect("lossy close");
    let lossy_closed = timeout(Duration::from_secs(30), lanes_b.recv())
        .await
        .expect("no lossy close event within 30s")
        .expect("lane event stream closed");
    assert!(matches!(
        lossy_closed,
        LaneEvent::Closed { lane_id, .. } if lane_id == adopted_lossy.lane_id
    ));
    assert!(
        timeout(Duration::from_millis(500), fieldd_b.next())
            .await
            .is_err(),
        "the reliable terminal replay must deduplicate a completed UDP sequence"
    );
    eprintln!("[e2e] fragmentable presence crossed UDP and terminal replay deduplicated");

    // 5. Receiver-side refusal is not EOF-shaped bookkeeping. B deliberately
    //    closes a peer-opened lane; A observes STOP on the authenticated QUIC
    //    control leg, retires its outbound id, and can reopen that SAME id.
    //    This is the document-room race: a peer without the document closes
    //    presence now, then becomes eligible after opening it later.
    let mut rejection_events = daemon_a.bridge.subscribe_events();
    let rejected_lane = Lane {
        lane_id: 10,
        class: LaneClass::Lossy,
        peer: beta_id.clone(),
        protocol: "presence".into(),
        doc_id: Some("doc-reopen".into()),
        inbound: false,
    };
    daemon_a
        .bridge
        .open_lane(rejected_lane.clone())
        .await
        .expect("receiver-refusal witness opened");
    let rejected_inbound = match timeout(Duration::from_secs(30), lanes_b.recv())
        .await
        .expect("no rejected lane event")
        .expect("lane event stream closed")
    {
        LaneEvent::PeerOpened(lane) => lane,
        other => panic!("expected peerOpened before refusal, got {other:?}"),
    };
    daemon_b
        .bridge
        .close_lane(rejected_inbound.lane_id)
        .await
        .expect("B refused its inbound lane");
    assert!(matches!(
        timeout(Duration::from_secs(30), lanes_b.recv())
            .await
            .expect("B did not announce its local refusal")
            .expect("lane event stream closed"),
        LaneEvent::Closed { lane_id, reason, .. }
            if lane_id == rejected_inbound.lane_id && reason == "local"
    ));

    // Drive the same path as ICE's next keepalive snapshot. STOP was written
    // before B's close returned; this send polls it and corrects A's control
    // table even though UDP itself has no acknowledgement.
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    let stopped = loop {
        fieldd_a
            .send_lane(rejected_lane.lane_id, b"keepalive-after-stop")
            .await;
        if let Ok(event) = timeout(Duration::from_millis(200), rejection_events.recv()).await {
            break event.expect("lane event stream closed");
        }
        assert!(
            std::time::Instant::now() < deadline,
            "A did not observe receiver STOP"
        );
    };
    assert!(matches!(
        stopped,
        LaneEvent::Closed { lane_id, reason, .. }
            if lane_id == rejected_lane.lane_id && reason == "peer-closed"
    ));

    daemon_a
        .bridge
        .open_lane(rejected_lane.clone())
        .await
        .expect("the stopped outbound id can reopen");
    let reopened = match timeout(Duration::from_secs(30), lanes_b.recv())
        .await
        .expect("no reopened lane event")
        .expect("lane event stream closed")
    {
        LaneEvent::PeerOpened(lane) => lane,
        other => panic!("expected reopened peerOpened, got {other:?}"),
    };
    assert_ne!(reopened.lane_id, rejected_inbound.lane_id);
    let after_reopen = vec![0xa5; 2_000];
    fieldd_a
        .send_lane(rejected_lane.lane_id, &after_reopen)
        .await;
    let reopened_payload = timeout(Duration::from_secs(30), fieldd_b.next())
        .await
        .expect("reopened presence timed out")
        .expect("no reopened presence frame");
    assert_eq!(reopened_payload.lane_id, reopened.lane_id);
    assert_eq!(reopened_payload.payload, after_reopen);
    daemon_a
        .bridge
        .close_lane(rejected_lane.lane_id)
        .await
        .expect("close reopened lane");
    assert!(matches!(
        timeout(Duration::from_secs(30), lanes_b.recv())
            .await
            .expect("reopened lane did not close")
            .expect("lane event stream closed"),
        LaneEvent::Closed { lane_id, .. } if lane_id == reopened.lane_id
    ));
    eprintln!("[e2e] receiver STOP retired and reopened a lossy lane cleanly");

    // 6. The OTHER direction, and the one a clean close cannot prove: the peer
    //    vanishes without hanging up. F-C6-6 was that a dead outbound stream
    //    told nobody — the writer task logged and exited, so fieldd kept a lane
    //    it believed was open forever and only learned otherwise by writing to
    //    it and collecting an ERR on the byte plane. Control state repaired by a
    //    data-plane accident is precisely the inversion D5 exists to prevent, so
    //    this asserts the lane.closed that must arrive on A's OWN control plane.
    let mut lanes_a = daemon_a.bridge.subscribe_events();
    let lane_8 = Lane {
        lane_id: 8,
        class: LaneClass::Reliable,
        peer: beta_id.clone(),
        protocol: "doc-sync".into(),
        doc_id: Some("doc-2".into()),
        inbound: false,
    };
    daemon_a
        .bridge
        .open_lane(lane_8)
        .await
        .expect("second lane opened toward beta");
    eprintln!("[e2e] lane 8 open; taking beta off the tailnet");

    // Beta leaves the network entirely — no FIN, no close frame, the way a
    // rebooted laptop leaves.
    beta.stop().await;

    // QUIC does not fail a write the instant a peer disappears: bytes go into a
    // send buffer and the connection dies on its own timers. So DRIVE it — keep
    // writing until either the event lands or the budget is spent. A single
    // write here would be a coin flip dressed up as a test.
    //
    // THE BUDGET IS MEASURED, NOT GUESSED, and it is much larger than it looks
    // like it should be. Detection took 78s in one run and over 90s in another,
    // against truffle's 5s keep-alive — so the honest number is minutes, not
    // seconds, and a tight budget makes this test a coin flip instead of a
    // proof. Recorded because the LATENCY is itself a product fact: a peer that
    // vanishes stays "open" in fieldd's lane table for over a minute, which is
    // what C6-4's peer-offline UX has to tell the truth about.
    let deadline = std::time::Instant::now() + Duration::from_secs(240);
    let mut announced = None;
    while std::time::Instant::now() < deadline && announced.is_none() {
        fieldd_a.send_lane(8, b"into-the-void").await;
        if let Ok(Ok(LaneEvent::Closed {
            lane_id, reason, ..
        })) = timeout(Duration::from_millis(500), lanes_a.recv()).await
        {
            announced = Some((lane_id, reason));
        }
    }
    let (lane_id, reason) = announced.expect(
        "a lane whose peer vanished must be announced as closed on the control plane, \
         not left open until someone writes to it",
    );
    assert_eq!(lane_id, 8, "the announcement names the lane that died");
    assert_eq!(
        reason, "peer-unreachable",
        "the reason distinguishes a vanished peer from a clean hang-up"
    );
    assert_eq!(
        daemon_a.bridge.open_lane_count(),
        0,
        "the dead lane leaves the table with its announcement"
    );
    eprintln!("[e2e] a vanished peer was announced as {reason}, not left dangling");

    inbound.abort();
    daemon_a.shutdown().await;
    daemon_b.shutdown().await;
    alpha.stop().await;
}
