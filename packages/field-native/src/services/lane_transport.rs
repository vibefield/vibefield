//! The remote leg of a MeshData lane (C6-3): truffle QUIC behind the
//! `LaneTransport` seam. This is the only file in the daemon that names a QUIC
//! type — `mesh_bridge.rs` stays dumb because it structurally cannot reach one.
//!
//! ONE QUIC STREAM PER LANE. Reliable lanes carry their one-way DATA records on
//! it; lossy lanes use it bidirectionally only for OPEN/READY and terminal
//! replay while their steady-state records ride UDP. QUIC already gives
//! independent, ordered streams with no head-of-line blocking between them, so
//! a reliable lane IS a stream rather than another multiplexing layer inside
//! one. Product direction remains one-way: two-way doc sync/presence is a PAIR
//! of lanes, one opened by each side.
//!
//! THE OPENER MUST WRITE. truffle documents it and the C6-3c probe measured it:
//! `accept_stream()` does not fire until the opening side sends bytes. So the
//! LANE_OPEN header is not merely how the peer learns what the lane is — it is
//! what makes the lane exist at all from the peer's side. A lane opened and
//! left silent would be invisible.
//!
//! IDENTITY COMES FROM THE ADDRESS, NEVER THE HEADER (EL7). The header says
//! what the lane carries; who opened it is resolved from the connection's
//! remote address, which the tailnet authenticated with WireGuard. A peer can
//! write anything into a header, so nothing authorization-shaped is read from
//! one. ALPN scoping (`truffle-raw.{app_id}`) means a different app cannot even
//! complete the handshake.
//!
//! LOSSY LANES ARE HYBRID. Their authenticated QUIC stream installs the UDP
//! route and answers READY before `open()` returns; steady state uses bounded,
//! versioned UDP fragments; graceful close reliably replays the retained latest
//! snapshot on that same stream. A crash gets no replay and falls back to ICE's
//! peer TTL, which is the honest distinction between graceful and unreachable.

use crate::services::lossy_lane::{decode_datagram, encode_datagrams, Reassembler};
use crate::services::mesh::{MeshHandle, MeshNode};
use crate::services::mesh_bridge::{
    encode_frame, BridgeHandle, FrameReader, Lane, LaneClass, LaneTransport,
    LOSSY_MAX_PAYLOAD_BYTES,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Mutex};
use truffle_core::transport::{
    quic::{QuicConnection, QuicStream},
    DatagramSocket,
};

/// = @vibefield/contracts registries PORTS.DOC_SYNC_QUIC. Mirrored, never
/// invented; `tests/lane_transport.rs` pins it against registries.ts.
pub const DOC_SYNC_QUIC_PORT: u16 = 9440;
/// = @vibefield/contracts registries PORTS.PRESENCE_UDP.
pub const PRESENCE_UDP_PORT: u16 = crate::registries::ports::PRESENCE_UDP;

// ---- the native↔native wire ------------------------------------------------
// Same CODEC as the local socket (one framing implementation, one set of
// hardening tests), a deliberately DISJOINT vocabulary. The local socket's
// FRAME_HELLO=1 authenticates a same-uid process with a pairing MAC; a mesh
// lane's opener says something else entirely. Numbering them apart means a
// stream fed to the wrong reader fails loudly instead of decoding as a kind it
// never was.

/// First frame on every lane stream: what this lane is. Payload is JSON.
pub const LANE_OPEN: u8 = 0x10;
/// One opaque record — a Loro update, as far as this file is concerned a bag of
/// bytes. Record boundaries are the frame's job: QUIC is a byte stream, so
/// concatenating records without framing would hand the peer an unsplittable
/// blob.
pub const LANE_DATA: u8 = 0x11;
/// Receiver → opener: the lossy UDP route is installed and may receive.
pub const LANE_READY: u8 = 0x12;
/// Opener → receiver on graceful lossy close: u32 sequence + full latest bytes.
pub const LANE_FINAL: u8 = 0x13;
/// Receiver → opener: fieldd deliberately rejected or closed the inbound
/// lane. This is distinct from EOF: the opener can retire its local lane now,
/// rather than discovering the close through a later payload write.
pub const LANE_STOP: u8 = 0x14;

/// Frames queued toward one lane's stream. Bounded ON PURPOSE: an unbounded
/// queue converts a stalled peer into unbounded memory, and this is the plane
/// whole documents cross. When it fills, `send` awaits — QUIC flow control
/// reaches back through the channel to fieldd, which is the backpressure
/// `LaneTransport::send` promises for a reliable lane.
const LANE_SEND_QUEUE: usize = 256;

/// The peer's declaration about its own lane. Descriptive only — see the module
/// note on identity. `class` is honoured because it changes how bytes are
/// carried, not who may send them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneOpenHeader {
    pub class: String,
    pub protocol: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    /// The originator's lane id. Carried for correlating the two sides' logs
    /// and NOTHING else — the receiver mints its own (see
    /// `reserve_inbound_lane`).
    pub origin_lane_id: u64,
}

pub fn encode_lane_open(lane: &Lane) -> anyhow::Result<Vec<u8>> {
    let header = LaneOpenHeader {
        class: lane.class.as_str().to_string(),
        protocol: lane.protocol.clone(),
        doc_id: lane.doc_id.clone(),
        origin_lane_id: lane.lane_id,
    };
    encode_frame(LANE_OPEN, lane.lane_id, &serde_json::to_vec(&header)?)
}

pub fn decode_lane_open(payload: &[u8]) -> anyhow::Result<LaneOpenHeader> {
    let header: LaneOpenHeader = serde_json::from_slice(payload)?;
    anyhow::ensure!(
        LaneClass::parse(&header.class).is_some(),
        "unknown lane class {:?}",
        header.class
    );
    Ok(header)
}

// ---- the transport ---------------------------------------------------------

#[derive(Clone)]
enum LaneSink {
    Reliable(ReliableSink),
    Lossy(Arc<LossySink>),
}

#[derive(Clone)]
struct ReliableSink {
    tx: mpsc::Sender<Vec<u8>>,
    identity: Arc<()>,
}

struct LossySendState {
    next_sequence: u32,
    latest: Option<(u32, Vec<u8>)>,
}

struct LossySink {
    origin_lane_id: u32,
    destination: String,
    socket: Arc<DatagramSocket>,
    control: Mutex<LossyControl>,
    state: Mutex<LossySendState>,
}

struct LossyControl {
    stream: QuicStream,
    reader: FrameReader,
}

struct LossyPeerEnd {
    reason: &'static str,
    detail: String,
}

impl LossySink {
    /// Lossy steady state normally never reads QUIC, but its receiver can
    /// deliberately reject the lane. Poll that control leg on each ICE
    /// snapshot/keepalive so STOP (or clean EOF) retires the stale lane before
    /// another useful snapshot is considered delivered.
    async fn ensure_peer_open(&self) -> Result<(), LossyPeerEnd> {
        let mut control = self.control.lock().await;
        let read =
            tokio::time::timeout(Duration::from_millis(1), control.stream.read(64 * 1024)).await;
        let chunk = match read {
            Err(_) => return Ok(()), // no control record waiting
            Ok(Ok(Some(chunk))) => chunk,
            Ok(Ok(None)) => {
                return Err(LossyPeerEnd {
                    reason: "peer-closed",
                    detail: format!("peer closed lossy lane {}", self.origin_lane_id),
                })
            }
            Ok(Err(error)) => {
                return Err(LossyPeerEnd {
                    reason: "peer-unreachable",
                    detail: format!("lossy lane {} control read: {error}", self.origin_lane_id),
                })
            }
        };
        let frames = control.reader.push(&chunk).map_err(|error| LossyPeerEnd {
            reason: "torn-frame",
            detail: error.to_string(),
        })?;
        if frames
            .iter()
            .any(|frame| frame.kind == LANE_STOP && frame.lane_id == self.origin_lane_id as u64)
        {
            return Err(LossyPeerEnd {
                reason: "peer-closed",
                detail: format!("peer stopped lossy lane {}", self.origin_lane_id),
            });
        }
        Ok(())
    }

    async fn send_datagrams(&self, payload: &[u8]) -> anyhow::Result<()> {
        let (sequence, packets) = {
            let mut state = self.state.lock().await;
            let sequence = state.next_sequence;
            let packets = encode_datagrams(self.origin_lane_id, sequence, payload)?;
            state.next_sequence = state.next_sequence.wrapping_add(1);
            state.latest = Some((sequence, payload.to_vec()));
            (sequence, packets)
        };
        for packet in packets {
            if let Err(error) = self.socket.send_to(&packet, &self.destination).await {
                // The snapshot is retained for the reliable terminal replay,
                // and the next ICE keepalive heals ordinary UDP loss. A failed
                // datagram is therefore observable loss, not lane teardown.
                tracing::info!(
                    event = "field_native.lane_transport.datagram_dropped",
                    component = "lane_transport",
                    origin_lane_id = self.origin_lane_id,
                    sequence,
                    error = %error,
                    "A lossy lane datagram could not be sent"
                );
            }
        }
        Ok(())
    }

    async fn close(&self) -> anyhow::Result<()> {
        let latest = self.state.lock().await.latest.clone();
        let mut control = self.control.lock().await;
        if let Some((sequence, payload)) = latest {
            let mut terminal = Vec::with_capacity(4 + payload.len());
            terminal.extend_from_slice(&sequence.to_be_bytes());
            terminal.extend_from_slice(&payload);
            control
                .stream
                .write(&encode_frame(
                    LANE_FINAL,
                    self.origin_lane_id as u64,
                    &terminal,
                )?)
                .await
                .map_err(|error| {
                    anyhow::anyhow!(
                        "lossy lane {} terminal replay: {error}",
                        self.origin_lane_id
                    )
                })?;
        }
        control.stream.finish();
        Ok(())
    }
}

struct InboundCloser {
    stop: oneshot::Sender<()>,
    done: oneshot::Receiver<()>,
}

type InboundClosers = Arc<Mutex<HashMap<u64, InboundCloser>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct RouteKey {
    source: IpAddr,
    origin_lane_id: u32,
}

struct InboundRoute {
    lane_id: u64,
    reassembler: Mutex<Reassembler>,
}

struct LossyHub {
    socket: Arc<DatagramSocket>,
    bridge: BridgeHandle,
    routes: Mutex<HashMap<RouteKey, Arc<InboundRoute>>>,
}

impl LossyHub {
    async fn bind(node: &Arc<MeshNode>, bridge: BridgeHandle) -> anyhow::Result<Arc<Self>> {
        let socket = node
            .bind_udp(PRESENCE_UDP_PORT)
            .await
            .map_err(|error| anyhow::anyhow!("bind UDP {PRESENCE_UDP_PORT}: {error}"))?;
        // Route authority is `(tailnet source IP, origin lane id)`. Truffle's
        // test-only direct fallback is not WireGuard-authenticated and binds
        // 0.0.0.0, so accepting it here would turn a LAN sender into a peer.
        anyhow::ensure!(
            matches!(&socket, DatagramSocket::Network { .. }),
            "presence UDP requires the authenticated network provider"
        );
        let socket = Arc::new(socket);
        let hub = Arc::new(Self {
            socket,
            bridge,
            routes: Mutex::new(HashMap::new()),
        });
        tokio::spawn(hub.clone().receive());
        Ok(hub)
    }

    async fn receive(self: Arc<Self>) {
        // One extra byte makes an oversized datagram observable instead of
        // silently accepting a truncated 1,150-byte prefix.
        let mut buffer = [0u8; LOSSY_MAX_PAYLOAD_BYTES + 1];
        loop {
            let (length, source) = match self.socket.recv_from(&mut buffer).await {
                Ok(received) => received,
                Err(error) => {
                    tracing::warn!(
                        event = "field_native.lane_transport.udp_receive_failed",
                        component = "lane_transport",
                        error = %error,
                        "The shared presence UDP receiver stopped"
                    );
                    return;
                }
            };
            if length > LOSSY_MAX_PAYLOAD_BYTES {
                continue;
            }
            let Ok(source) = source.parse::<SocketAddr>() else {
                continue;
            };
            let Ok(datagram) = decode_datagram(&buffer[..length]) else {
                continue;
            };
            let key = RouteKey {
                source: source.ip(),
                origin_lane_id: datagram.origin_lane_id,
            };
            let route = self.routes.lock().await.get(&key).cloned();
            let Some(route) = route else {
                continue;
            };
            let complete = route.reassembler.lock().await.ingest(&datagram);
            if let Some((_sequence, payload)) = complete {
                self.bridge.deliver_inbound(route.lane_id, &payload);
            }
        }
    }

    async fn install(
        &self,
        source: IpAddr,
        origin_lane_id: u32,
        lane_id: u64,
    ) -> (RouteKey, Arc<InboundRoute>, Option<u64>) {
        let key = RouteKey {
            source,
            origin_lane_id,
        };
        let route = Arc::new(InboundRoute {
            lane_id,
            reassembler: Mutex::new(Reassembler::default()),
        });
        let previous = self
            .routes
            .lock()
            .await
            .insert(key, route.clone())
            .map(|route| route.lane_id);
        (key, route, previous)
    }

    async fn remove(&self, key: RouteKey, route: &Arc<InboundRoute>) {
        let mut routes = self.routes.lock().await;
        if routes
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, route))
        {
            routes.remove(&key);
        }
    }
}

pub struct TruffleLaneTransport {
    node: Arc<MeshNode>,
    /// Held so a lane that dies OUT HERE can say so on the control plane. The
    /// transport learns of a peer going away first — it is the only thing
    /// holding the failing write — and without a way back to the bridge, a
    /// lane's death is knowable only by accident: fieldd would keep believing
    /// the lane is open, its id would stay permanently un-reopenable, and the
    /// sole signal would be an ERR on the byte plane the next time it wrote.
    /// That inverts the D5 split — control state corrected by a data-plane
    /// side effect.
    bridge: BridgeHandle,
    port: u16,
    /// One connection per peer, shared by every lane pointing at it. Streams are
    /// the cheap thing; connections are not.
    conns: Mutex<HashMap<String, Arc<QuicConnection>>>,
    /// Shared with each lane's writer task, so a task that loses its stream can
    /// evict itself rather than leaking its sink.
    lanes: Arc<Mutex<HashMap<u64, LaneSink>>>,
    /// Exact local stop handles for peer-opened streams. The bridge owns the
    /// public lane table; this private table owns the transport work that must
    /// end when fieldd closes one of those inbound ids.
    inbound_closers: InboundClosers,
    lossy: Option<Arc<LossyHub>>,
}

impl TruffleLaneTransport {
    pub async fn new(node: Arc<MeshNode>, bridge: BridgeHandle, port: u16) -> Self {
        let lossy = match LossyHub::bind(&node, bridge.clone()).await {
            Ok(hub) => {
                tracing::info!(
                    event = "field_native.lane_transport.udp_listening",
                    component = "lane_transport",
                    port = PRESENCE_UDP_PORT,
                    "The shared presence UDP socket is live"
                );
                Some(hub)
            }
            Err(error) => {
                tracing::warn!(
                    event = "field_native.lane_transport.udp_unavailable",
                    component = "lane_transport",
                    port = PRESENCE_UDP_PORT,
                    error = %error,
                    "Lossy mesh lanes are unavailable; reliable lanes remain live"
                );
                None
            }
        };
        Self {
            node,
            bridge,
            port,
            conns: Mutex::new(HashMap::new()),
            lanes: Arc::new(Mutex::new(HashMap::new())),
            inbound_closers: Arc::new(Mutex::new(HashMap::new())),
            lossy,
        }
    }

    /// A stream to a peer, over the cached connection when there is a live one.
    ///
    /// The only honest test of a connection is USING it: a peer that rebooted
    /// leaves an entry in this map that looks perfectly alive, so a failed
    /// `open_stream` is what evicts it rather than a liveness flag nobody
    /// updates.
    async fn open_stream_to(&self, peer: &str) -> anyhow::Result<QuicStream> {
        // The lock is held across the dial on purpose: two lanes opening to the
        // same peer at once must not race into two connections. A tokio Mutex,
        // so awaiting under it is sound.
        let mut conns = self.conns.lock().await;
        if let Some(conn) = conns.get(peer).cloned() {
            match conn.open_stream().await {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    tracing::info!(
                        event = "field_native.lane_transport.redialling",
                        component = "lane_transport",
                        peer,
                        error = %e,
                        "The cached lane connection was dead; redialling"
                    );
                    conns.remove(peer);
                }
            }
        }
        let conn = Arc::new(
            self.node
                .connect_quic(peer, self.port)
                .await
                .map_err(|e| anyhow::anyhow!("connect_quic {peer}: {e}"))?,
        );
        let stream = conn
            .open_stream()
            .await
            .map_err(|e| anyhow::anyhow!("open_stream to {peer}: {e}"))?;
        conns.insert(peer.to_string(), conn);
        Ok(stream)
    }
}

async fn await_lane_ready(stream: &mut QuicStream, lane_id: u64) -> anyhow::Result<()> {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut reader = FrameReader::default();
        loop {
            let chunk = stream
                .read(64 * 1024)
                .await
                .map_err(|error| anyhow::anyhow!("lane {lane_id} READY read: {error}"))?
                .ok_or_else(|| anyhow::anyhow!("lane {lane_id} closed before READY"))?;
            for frame in reader.push(&chunk)? {
                if frame.kind == LANE_READY && frame.lane_id == lane_id {
                    return Ok(());
                }
            }
        }
    })
    .await
    .map_err(|_| anyhow::anyhow!("lane {lane_id} READY timed out"))?
}

async fn remove_reliable_sink_if(
    lanes: &Mutex<HashMap<u64, LaneSink>>,
    lane_id: u64,
    identity: &Arc<()>,
) -> bool {
    let mut lanes = lanes.lock().await;
    let is_current = matches!(
        lanes.get(&lane_id),
        Some(LaneSink::Reliable(sink)) if Arc::ptr_eq(&sink.identity, identity)
    );
    if is_current {
        lanes.remove(&lane_id);
    }
    is_current
}

async fn remove_lossy_sink_if(
    lanes: &Mutex<HashMap<u64, LaneSink>>,
    lane_id: u64,
    expected: &Arc<LossySink>,
) -> bool {
    let mut lanes = lanes.lock().await;
    let is_current = matches!(
        lanes.get(&lane_id),
        Some(LaneSink::Lossy(sink)) if Arc::ptr_eq(sink, expected)
    );
    if is_current {
        lanes.remove(&lane_id);
    }
    is_current
}

async fn stop_inbound_lane(closers: &InboundClosers, lane_id: u64) {
    let closer = closers.lock().await.remove(&lane_id);
    let Some(closer) = closer else {
        return;
    };
    let _ = closer.stop.send(());
    if tokio::time::timeout(Duration::from_secs(5), closer.done)
        .await
        .is_err()
    {
        tracing::warn!(
            event = "field_native.lane_transport.inbound_stop_timed_out",
            component = "lane_transport",
            lane_id,
            "An inbound lane did not finish within its local close fence"
        );
    }
}

#[async_trait::async_trait]
impl LaneTransport for TruffleLaneTransport {
    async fn open(&self, lane: &Lane) -> anyhow::Result<()> {
        // Refuse every local precondition before the OPEN becomes observable
        // remotely. Otherwise a failed address conversion or unavailable UDP
        // socket produces a spurious peerOpened/closed pair on the receiver.
        let lossy_plan = if lane.class == LaneClass::Lossy {
            let hub = self
                .lossy
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("presence UDP socket is unavailable"))?;
            let origin_lane_id = u32::try_from(lane.lane_id)
                .map_err(|_| anyhow::anyhow!("outbound lossy lane id exceeds u32"))?;
            let peer_ip = self
                .node
                .resolve_peer_ip(&lane.peer)
                .await
                .map_err(|error| anyhow::anyhow!("resolve peer {}: {error}", lane.peer))?;
            Some((hub.socket.clone(), origin_lane_id, peer_ip))
        } else {
            None
        };
        let mut stream = self.open_stream_to(&lane.peer).await?;

        // The header goes out HERE, inside open(), and the call does not return
        // until it is written: this is what makes the peer's accept_stream fire.
        // Deferring it to the first payload would leave a lane that both sides
        // believe is open but only one can see.
        stream
            .write(&encode_lane_open(lane)?)
            .await
            .map_err(|e| anyhow::anyhow!("lane {} header: {e}", lane.lane_id))?;
        let lane_id = lane.lane_id;
        let (sink, start_writer) = match lane.class {
            LaneClass::Reliable => {
                let (tx, mut rx) = mpsc::channel::<Vec<u8>>(LANE_SEND_QUEUE);
                let identity = Arc::new(());
                let reliable = ReliableSink {
                    tx,
                    identity: identity.clone(),
                };
                // The task cannot fail and clean itself up before its sink is
                // installed. That tiny race otherwise leaves a dead sender in
                // `lanes` after `open()` reports success.
                let (start_tx, start_rx) = oneshot::channel();
                let bridge = self.bridge.clone();
                let lanes = self.lanes.clone();
                tokio::spawn(async move {
                    if start_rx.await.is_err() {
                        return;
                    }
                    // Two ways out, and they must not be confused. The channel
                    // closing is LOCAL; STOP/EOF is a deliberate peer close;
                    // an I/O error is peer-unreachable.
                    let mut reader = FrameReader::default();
                    let mut ended: Option<(&str, String)> = None;
                    'lane: loop {
                        tokio::select! {
                            next = rx.recv() => match next {
                                Some(frame) => {
                                    if let Err(error) = stream.write(&frame).await {
                                        ended = Some(("peer-unreachable", error.to_string()));
                                        break 'lane;
                                    }
                                }
                                None => break 'lane,
                            },
                            read = stream.read(64 * 1024) => match read {
                                Ok(Some(chunk)) => match reader.push(&chunk) {
                                    Ok(frames) => {
                                        if frames.iter().any(|frame| {
                                            frame.kind == LANE_STOP && frame.lane_id == lane_id
                                        }) {
                                            ended = Some((
                                                "peer-closed",
                                                "the receiver stopped the lane".into(),
                                            ));
                                            break 'lane;
                                        }
                                    }
                                    Err(error) => {
                                        ended = Some(("torn-frame", error.to_string()));
                                        break 'lane;
                                    }
                                },
                                Ok(None) => {
                                    ended = Some(("peer-closed", "clean EOF".into()));
                                    break 'lane;
                                }
                                Err(error) => {
                                    ended = Some(("peer-unreachable", error.to_string()));
                                    break 'lane;
                                }
                            },
                        }
                    }
                    stream.finish();
                    if let Some((reason, detail)) = ended {
                        tracing::warn!(
                            event = "field_native.lane_transport.outbound_lane_ended",
                            component = "lane_transport",
                            lane_id,
                            reason,
                            detail,
                            "An outbound lane ended at its peer"
                        );
                        if remove_reliable_sink_if(&lanes, lane_id, &identity).await {
                            bridge.forget_lane(lane_id, reason);
                        }
                    }
                });
                (LaneSink::Reliable(reliable), Some(start_tx))
            }
            LaneClass::Lossy => {
                let (socket, origin_lane_id, peer_ip) =
                    lossy_plan.expect("lossy preflight matches lane class");
                await_lane_ready(&mut stream, lane_id).await?;
                (
                    LaneSink::Lossy(Arc::new(LossySink {
                        origin_lane_id,
                        destination: SocketAddr::new(peer_ip, PRESENCE_UDP_PORT).to_string(),
                        socket,
                        control: Mutex::new(LossyControl {
                            stream,
                            reader: FrameReader::default(),
                        }),
                        state: Mutex::new(LossySendState {
                            next_sequence: 1,
                            latest: None,
                        }),
                    })),
                    None,
                )
            }
        };
        self.lanes.lock().await.insert(lane_id, sink);
        if let Some(start) = start_writer {
            let _ = start.send(());
        }
        Ok(())
    }

    async fn send(&self, lane: &Lane, payload: &[u8]) -> anyhow::Result<()> {
        let sink = {
            let lanes = self.lanes.lock().await;
            lanes
                .get(&lane.lane_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("lane {} has no transport", lane.lane_id))?
        };
        match sink {
            LaneSink::Reliable(sink) => {
                let frame = encode_frame(LANE_DATA, lane.lane_id, payload)?;
                // Awaits when full — that IS reliable backpressure.
                sink.tx
                    .send(frame)
                    .await
                    .map_err(|_| anyhow::anyhow!("lane {} stream is gone", lane.lane_id))
            }
            LaneSink::Lossy(sink) => {
                if let Err(ended) = sink.ensure_peer_open().await {
                    tracing::warn!(
                        event = "field_native.lane_transport.outbound_lane_ended",
                        component = "lane_transport",
                        lane_id = lane.lane_id,
                        reason = ended.reason,
                        detail = %ended.detail,
                        "An outbound lossy lane ended at its peer"
                    );
                    if remove_lossy_sink_if(&self.lanes, lane.lane_id, &sink).await {
                        self.bridge.forget_lane(lane.lane_id, ended.reason);
                    }
                    return Err(anyhow::anyhow!(ended.detail));
                }
                sink.send_datagrams(payload).await
            }
        }
    }

    async fn close(&self, lane: &Lane) -> anyhow::Result<()> {
        if lane.inbound {
            stop_inbound_lane(&self.inbound_closers, lane.lane_id).await;
            return Ok(());
        }
        let sink = self.lanes.lock().await.remove(&lane.lane_id);
        match sink {
            // Dropping the sender ends the writer task and finishes the stream.
            Some(LaneSink::Reliable(_)) | None => Ok(()),
            Some(LaneSink::Lossy(sink)) => sink.close().await,
        }
    }
}

// ---- the inbound side ------------------------------------------------------

/// Accept lane streams forever, adopting each one into the bridge.
///
/// Every level spawns rather than serialising: one wedged peer must not stop
/// the listener, and one wedged lane must not stop its connection. That is D5's
/// "a torn frame tears the LANE, never the daemon" applied to the remote leg.
pub async fn serve_inbound(transport: Arc<TruffleLaneTransport>) {
    let node = transport.node.clone();
    let bridge = transport.bridge.clone();
    let port = transport.port;
    let listener = match node.listen_quic(port).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(
                event = "field_native.lane_transport.listen_failed",
                component = "lane_transport",
                port,
                error = %e,
                "Inbound mesh lanes are unavailable: the QUIC listener did not bind"
            );
            return;
        }
    };
    tracing::info!(
        event = "field_native.lane_transport.listening",
        component = "lane_transport",
        port,
        "Inbound mesh lanes are open"
    );
    while let Some(conn) = listener.accept().await {
        let node = node.clone();
        let bridge = bridge.clone();
        let lossy = transport.lossy.clone();
        let inbound_closers = transport.inbound_closers.clone();
        tokio::spawn(
            async move { serve_connection(node, bridge, lossy, inbound_closers, conn).await },
        );
    }
}

async fn serve_connection(
    node: Arc<MeshNode>,
    bridge: BridgeHandle,
    lossy: Option<Arc<LossyHub>>,
    inbound_closers: InboundClosers,
    conn: QuicConnection,
) {
    // EL7: the peer's identity is the tailnet's answer about the address that
    // dialled us, not the stream's answer about itself. An unresolvable address
    // is reported as such — a peer field that reads "unknown" is honest, and
    // fieldd can refuse it; a fabricated one would not be.
    let addr = conn.remote_address();
    let peer = resolve_peer_by_ip(&node, addr.ip().to_string()).await;
    tracing::info!(
        event = "field_native.lane_transport.peer_connected",
        component = "lane_transport",
        peer = %peer,
        "A peer opened a mesh lane connection"
    );
    loop {
        match conn.accept_stream().await {
            Ok(Some(stream)) => {
                let bridge = bridge.clone();
                let peer = peer.clone();
                let lossy = lossy.clone();
                let inbound_closers = inbound_closers.clone();
                tokio::spawn(async move {
                    serve_lane_stream(bridge, peer, addr.ip(), lossy, inbound_closers, stream).await
                });
            }
            Ok(None) => break, // connection closed by either side
            Err(e) => {
                tracing::warn!(
                    event = "field_native.lane_transport.accept_stream_failed",
                    component = "lane_transport",
                    peer = %peer,
                    error = %e,
                    "A peer's lane connection ended"
                );
                break;
            }
        }
    }
}

struct InboundRouteBinding {
    hub: Arc<LossyHub>,
    key: RouteKey,
    route: Arc<InboundRoute>,
}

async fn finish_inbound(
    bridge: &BridgeHandle,
    inbound_closers: &InboundClosers,
    lane: Option<(u64, LaneClass, u64)>,
    route: Option<InboundRouteBinding>,
    done: &mut Option<oneshot::Sender<()>>,
    reason: &str,
) {
    if let Some(route) = route {
        route.hub.remove(route.key, &route.route).await;
    }
    if let Some((lane_id, _, _)) = lane {
        inbound_closers.lock().await.remove(&lane_id);
        bridge.forget_lane(lane_id, reason);
    }
    if let Some(done) = done.take() {
        let _ = done.send(());
    }
}

/// One inbound lane, from its header to its EOF.
async fn serve_lane_stream(
    bridge: BridgeHandle,
    peer: String,
    source_ip: IpAddr,
    lossy: Option<Arc<LossyHub>>,
    inbound_closers: InboundClosers,
    mut stream: QuicStream,
) {
    let mut reader = FrameReader::default();
    let mut lane: Option<(u64, LaneClass, u64)> = None;
    let mut route: Option<InboundRouteBinding> = None;
    let (stop_tx, mut stop_rx) = oneshot::channel();
    let mut stop_tx = Some(stop_tx);
    let (done_tx, done_rx) = oneshot::channel();
    let mut done_tx = Some(done_tx);
    let mut done_rx = Some(done_rx);

    loop {
        let read = tokio::select! {
            stop = &mut stop_rx, if lane.is_some() => {
                if stop.is_ok() {
                    if let Some((_, _, origin_lane_id)) = lane {
                        if let Ok(frame) = encode_frame(LANE_STOP, origin_lane_id, &[]) {
                            let _ = stream.write(&frame).await;
                        }
                    }
                    stream.finish();
                    finish_inbound(
                        &bridge,
                        &inbound_closers,
                        lane,
                        route,
                        &mut done_tx,
                        "local",
                    )
                    .await;
                    return;
                }
                // The sender only disappears during teardown, after which the
                // stream's own EOF/error is the authoritative outcome.
                stream.read(64 * 1024).await
            }
            read = stream.read(64 * 1024) => read,
        };
        let chunk = match read {
            Ok(Some(c)) => c,
            Ok(None) => break, // clean EOF: the peer closed the lane
            Err(e) => {
                tracing::warn!(
                    event = "field_native.lane_transport.read_failed",
                    component = "lane_transport",
                    peer = %peer,
                    error = %e,
                    "A lane stream read failed"
                );
                finish_inbound(
                    &bridge,
                    &inbound_closers,
                    lane,
                    route,
                    &mut done_tx,
                    "peer-unreachable",
                )
                .await;
                return;
            }
        };
        let frames = match reader.push(&chunk) {
            Ok(f) => f,
            Err(e) => {
                // Structural garbage on ONE lane. Its stream is unrecoverable
                // (there is no marker to resynchronise on), but the connection
                // and every sibling lane on it are untouched.
                tracing::warn!(
                    event = "field_native.lane_transport.frame_error",
                    component = "lane_transport",
                    peer = %peer,
                    error = %e,
                    "A lane's framing tore; dropping that lane only"
                );
                finish_inbound(
                    &bridge,
                    &inbound_closers,
                    lane,
                    route,
                    &mut done_tx,
                    "torn-frame",
                )
                .await;
                return;
            }
        };
        for frame in frames {
            match (frame.kind, lane) {
                (LANE_OPEN, None) => match decode_lane_open(&frame.payload) {
                    Ok(header) => {
                        let class = LaneClass::parse(&header.class).unwrap_or(LaneClass::Reliable);
                        if header.origin_lane_id != frame.lane_id {
                            tracing::warn!(
                                event = "field_native.lane_transport.inconsistent_header",
                                component = "lane_transport",
                                peer = %peer,
                                "A lane header disagreed with its frame id"
                            );
                            return;
                        }
                        let origin_lane_id = match u32::try_from(header.origin_lane_id) {
                            Ok(id) => id,
                            Err(_) if class == LaneClass::Lossy => {
                                tracing::warn!(
                                    event = "field_native.lane_transport.lossy_id_too_large",
                                    component = "lane_transport",
                                    peer = %peer,
                                    "A lossy lane id could not fit its datagram header"
                                );
                                return;
                            }
                            Err(_) => 0, // reliable streams retain their full u64 id
                        };
                        if class == LaneClass::Lossy && lossy.is_none() {
                            tracing::warn!(
                                event = "field_native.lane_transport.lossy_unavailable",
                                component = "lane_transport",
                                peer = %peer,
                                "A lossy lane was refused because UDP is unavailable"
                            );
                            return;
                        }
                        let inbound = bridge.reserve_inbound_lane(
                            class,
                            peer.clone(),
                            header.protocol.clone(),
                            header.doc_id.clone(),
                        );
                        tracing::info!(
                            event = "field_native.lane_transport.lane_adopted",
                            component = "lane_transport",
                            lane_id = inbound.lane_id,
                            origin_lane_id = header.origin_lane_id,
                            peer = %peer,
                            protocol = %header.protocol,
                            "A peer's lane was adopted"
                        );
                        lane = Some((inbound.lane_id, class, header.origin_lane_id));
                        if class == LaneClass::Lossy {
                            let hub = lossy.as_ref().expect("checked above");
                            let (key, installed, previous) = hub
                                .install(source_ip, origin_lane_id, inbound.lane_id)
                                .await;
                            route = Some(InboundRouteBinding {
                                hub: hub.clone(),
                                key,
                                route: installed,
                            });
                            if let Some(previous) = previous {
                                // The same authenticated peer reopened the same
                                // origin id. Retire the old stream as well as
                                // replacing its exact UDP route.
                                bridge.forget_lane(previous, "peer-replaced");
                                stop_inbound_lane(&inbound_closers, previous).await;
                            }
                        }
                        let closer = InboundCloser {
                            stop: stop_tx.take().expect("one OPEN per stream"),
                            done: done_rx.take().expect("one OPEN per stream"),
                        };
                        let replaced = inbound_closers.lock().await.insert(inbound.lane_id, closer);
                        debug_assert!(replaced.is_none(), "inbound ids are never reused");
                        // Announce only after local close and UDP routes exist:
                        // fieldd is now free to reject synchronously.
                        bridge.announce_inbound_lane(&inbound);
                        if class == LaneClass::Lossy {
                            // READY only after the authenticated source route is
                            // live, so the first UDP fragment cannot beat it.
                            if let Err(error) = stream
                                .write(
                                    &encode_frame(LANE_READY, header.origin_lane_id, &[])
                                        .expect("READY frame is bounded"),
                                )
                                .await
                            {
                                tracing::warn!(
                                    event = "field_native.lane_transport.ready_failed",
                                    component = "lane_transport",
                                    lane_id = inbound.lane_id,
                                    error = %error,
                                    "A lossy lane could not acknowledge its installed route"
                                );
                                finish_inbound(
                                    &bridge,
                                    &inbound_closers,
                                    lane,
                                    route,
                                    &mut done_tx,
                                    "torn-frame",
                                )
                                .await;
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            event = "field_native.lane_transport.bad_header",
                            component = "lane_transport",
                            peer = %peer,
                            error = %e,
                            "A lane's opening header was unreadable; refusing the lane"
                        );
                        return;
                    }
                },
                (LANE_DATA, Some((id, LaneClass::Reliable, _))) => {
                    bridge.deliver_inbound(id, &frame.payload)
                }
                (LANE_FINAL, Some((id, LaneClass::Lossy, _))) => {
                    if frame.payload.len() < 4 {
                        continue;
                    }
                    let sequence =
                        u32::from_be_bytes(frame.payload[0..4].try_into().unwrap_or_default());
                    let Some(binding) = route.as_ref() else {
                        continue;
                    };
                    let payload = binding
                        .route
                        .reassembler
                        .lock()
                        .await
                        .ingest_final(sequence, &frame.payload[4..]);
                    if let Some(payload) = payload {
                        bridge.deliver_inbound(id, &payload);
                    }
                }
                (LANE_DATA, None) => {
                    // Data before the header: the peer skipped the one frame
                    // that says what this lane is. There is no lane to route to
                    // and no way to invent one.
                    tracing::warn!(
                        event = "field_native.lane_transport.data_before_header",
                        component = "lane_transport",
                        peer = %peer,
                        "A lane sent data before declaring itself; refusing the lane"
                    );
                    return;
                }
                // Tolerant reader: a newer peer may frame a kind this daemon has
                // no opinion about, and that is not a reason to kill its lane.
                _ => {}
            }
        }
    }

    finish_inbound(
        &bridge,
        &inbound_closers,
        lane,
        route,
        &mut done_tx,
        "peer-closed",
    )
    .await;
}

/// Tailnet IP → peer id, using the same `PeerInfo.id` (`tailscale_id`) that
/// `native.mesh.peers.list` publishes — so the peer named in a `lane.peerOpened`
/// is the same string fieldd would pass back to `lane.open`.
///
/// T1: `whois(ip)` is asked first — the tailnet control plane's authoritative
/// answer for the WireGuard-authenticated address (its `node_id` IS the
/// tailscale stable id, one keyspace with the registry scan below), and it
/// resolves callers the app-filtered registry is blind to. A pre-v3 sidecar
/// fails the call fast, so the registry scan stays as the mixed-fleet
/// fallback; `unknown:<ip>` remains the honest miss (EL7: absent, never
/// fabricated).
async fn resolve_peer_by_ip(node: &Arc<MeshNode>, ip: String) -> String {
    if let Ok(Some(identity)) = node.whois(&ip).await {
        if let Some(node_id) = identity.node_id.filter(|n| !n.is_empty()) {
            return node_id;
        }
    }
    node.peers()
        .await
        .into_iter()
        .find(|p| p.ip.to_string() == ip)
        .map(|p| p.tailscale_id)
        .unwrap_or_else(|| format!("unknown:{ip}"))
}

// ---- installation ----------------------------------------------------------

/// Park until the mesh node exists, then put the remote leg behind the bridge's
/// seam and start accepting inbound lanes.
///
/// Spawned once at boot. With the mesh disabled — the default — it simply never
/// fires, and lanes stay local-only, which `lane.open` already reports honestly
/// as UNAVAILABLE with the mesh unit's real state.
pub fn install_when_ready(
    mesh: MeshHandle,
    bridge: BridgeHandle,
    port: u16,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let node = mesh.wait_for_node().await;
        let transport = Arc::new(TruffleLaneTransport::new(node, bridge.clone(), port).await);
        bridge.set_transport(transport.clone());
        tracing::info!(
            event = "field_native.lane_transport.installed",
            component = "lane_transport",
            port,
            "The mesh lane transport is live"
        );
        serve_inbound(transport).await;
    })
}

#[cfg(test)]
mod tests {
    //! The wire's pure half. Everything that needs two tailnet nodes lives in
    //! `tests/quic_lane_transport.rs`, gated and ignored.
    use super::*;

    fn lane() -> Lane {
        Lane {
            lane_id: 7,
            class: LaneClass::Reliable,
            peer: "ts-peer".into(),
            protocol: "doc-sync".into(),
            doc_id: Some("doc-1".into()),
            inbound: false,
        }
    }

    #[test]
    fn a_lane_open_frame_round_trips() {
        let framed = encode_lane_open(&lane()).expect("encode");
        let mut reader = FrameReader::default();
        let frames = reader.push(&framed).expect("decode");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].kind, LANE_OPEN);
        assert_eq!(frames[0].lane_id, 7);
        let header = decode_lane_open(&frames[0].payload).expect("header");
        assert_eq!(header.class, "reliable");
        assert_eq!(header.protocol, "doc-sync");
        assert_eq!(header.doc_id.as_deref(), Some("doc-1"));
        assert_eq!(header.origin_lane_id, 7);
    }

    #[test]
    fn the_mesh_leg_and_the_local_leg_do_not_share_a_vocabulary() {
        // Same codec, disjoint kinds — a stream fed to the wrong reader must
        // fail loudly rather than decode as a kind it never was.
        use crate::services::mesh_bridge::{FRAME_DATA, FRAME_ERR, FRAME_HELLO, FRAME_HELLO_OK};
        for local in [FRAME_HELLO, FRAME_HELLO_OK, FRAME_DATA, FRAME_ERR] {
            assert_ne!(local, LANE_OPEN);
            assert_ne!(local, LANE_DATA);
            assert_ne!(local, LANE_READY);
            assert_ne!(local, LANE_FINAL);
            assert_ne!(local, LANE_STOP);
        }
    }

    #[test]
    fn a_header_with_an_unknown_class_is_refused_not_defaulted() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "class": "telepathic", "protocol": "doc-sync", "origin_lane_id": 1
        }))
        .unwrap();
        let err = decode_lane_open(&payload).expect_err("unknown class must be refused");
        assert!(err.to_string().contains("telepathic"), "{err}");
    }

    #[test]
    fn a_header_missing_its_protocol_is_refused() {
        let payload =
            serde_json::to_vec(&serde_json::json!({"class": "reliable", "origin_lane_id": 1}))
                .unwrap();
        assert!(decode_lane_open(&payload).is_err());
    }

    #[test]
    fn a_doc_less_lane_omits_doc_id_rather_than_sending_null() {
        let mut l = lane();
        l.doc_id = None;
        let framed = encode_lane_open(&l).unwrap();
        let text = String::from_utf8_lossy(&framed);
        assert!(
            !text.contains("doc_id"),
            "a doc-less tolerant header must omit doc_id: {text}"
        );
        let mut reader = FrameReader::default();
        let frames = reader.push(&framed).unwrap();
        assert!(decode_lane_open(&frames[0].payload)
            .unwrap()
            .doc_id
            .is_none());
    }

    #[test]
    fn the_port_matches_the_contracts_registry() {
        let src = std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../contracts/src/registries.ts"),
        )
        .expect("read registries.ts");
        assert!(
            src.contains(&format!("DOC_SYNC_QUIC: {DOC_SYNC_QUIC_PORT},")),
            "registries.ts does not declare DOC_SYNC_QUIC: {DOC_SYNC_QUIC_PORT}"
        );
        assert!(
            src.contains(&format!("PRESENCE_UDP: {PRESENCE_UDP_PORT},")),
            "registries.ts does not declare PRESENCE_UDP: {PRESENCE_UDP_PORT}"
        );
    }
}
