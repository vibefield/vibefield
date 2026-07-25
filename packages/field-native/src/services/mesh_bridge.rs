//! The MeshData bridge (design-02 §2.5, D5) — the byte plane fieldd's documents
//! cross the mesh on, and the one place in this daemon that moves product bytes.
//!
//! Shape, unchanged from D5: ONE local byte socket (`native/run/meshdata.sock`,
//! token-authed like the mgmt channel) carrying multiplexed lanes, with lane
//! LIFECYCLE on the management channel instead of in-band. That split is EL2
//! made structural — control rides a contract surface, bytes ride their own
//! plane, and neither can queue behind the other.
//!
//! THE BRIDGE IS DUMB, and that is a design property rather than an unfinished
//! state: no protocol knowledge, no persistence, no interpretation of a single
//! payload byte. It knows a lane's id, its class, and which peer it points at.
//! Doc-sync lanes carry Loro update records that fieldd itself never decodes
//! (the B3 custody shape), so a document format change cannot reach this file.
//!
//! THE REMOTE LEG IS A SIBLING, not a section of this file: `LaneTransport` is
//! the seam, and `lane_transport.rs` puts truffle QUIC behind it (C6-3). This
//! file cannot name a QUIC type, which is what keeps "the bridge is dumb" a
//! property of the code rather than a promise in a comment. A loopback
//! transport ships alongside so the local half stays provable without a tailnet.

use crate::config::NativeConfig;
use crate::contracts::{UnitHealth, UnitState};
use crate::manager::NativeService;
use crate::pairing;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::broadcast;
use tokio::sync::mpsc::{self, UnboundedSender};

// ---- the wire, mirrored from @vibefield/contracts src/meshdata.ts ----------
// These are CONSTANTS, not generated shapes, so nothing regenerates them into
// agreement. tests/mesh_bridge.rs pins every one against the TS source's
// numbers; a divergence is a silent desync of two byte streams, which is the
// worst failure this file can have.

/// = @vibefield/contracts registries SOCKETS.MESHDATA. One name, two languages;
/// the registry is the source and this mirrors it (never hardcode — repo law).
pub const SOCKET_NAME: &str = "meshdata.sock";

pub const FRAME_HELLO: u8 = 1;
pub const FRAME_HELLO_OK: u8 = 2;
pub const FRAME_DATA: u8 = 3;
pub const FRAME_ERR: u8 = 4;

/// u32 len + u8 kind + u64 laneId.
pub const HEADER_BYTES: usize = 13;
pub const LENGTH_PREFIX_BYTES: usize = 4;
/// The smallest legal `len`: the kind byte plus the lane id. A frame claiming
/// less than this is malformed by construction, not merely empty.
const MIN_BODY_BYTES: usize = 1 + 8;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub const LOSSY_MAX_PAYLOAD_BYTES: usize = 1150;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub kind: u8,
    pub lane_id: u64,
    pub payload: Vec<u8>,
}

pub fn encode_frame(kind: u8, lane_id: u64, payload: &[u8]) -> anyhow::Result<Vec<u8>> {
    let body = 1 + 8 + payload.len();
    anyhow::ensure!(
        body + LENGTH_PREFIX_BYTES <= MAX_FRAME_BYTES,
        "meshdata frame exceeds {MAX_FRAME_BYTES} bytes: {body}"
    );
    let mut out = Vec::with_capacity(HEADER_BYTES + payload.len());
    out.extend_from_slice(&(body as u32).to_be_bytes());
    out.push(kind);
    out.extend_from_slice(&lane_id.to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

/// Streaming reader — a UDS read returns whatever the kernel had, so frame
/// boundaries are the caller's problem and this is where it is solved. Mirrors
/// MeshDataFrameReader in meshdata.ts, including the rule that matters: an
/// absurd declared length is refused on the 4-byte prefix ALONE, before any
/// allocation, so a peer cannot make us reserve memory on its say-so.
#[derive(Default)]
pub struct FrameReader {
    buffer: Vec<u8>,
}

impl FrameReader {
    pub fn push(&mut self, chunk: &[u8]) -> anyhow::Result<Vec<Frame>> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();
        let mut at = 0usize;
        loop {
            if self.buffer.len() - at < LENGTH_PREFIX_BYTES {
                break;
            }
            let body = u32::from_be_bytes([
                self.buffer[at],
                self.buffer[at + 1],
                self.buffer[at + 2],
                self.buffer[at + 3],
            ]) as usize;
            anyhow::ensure!(
                body + LENGTH_PREFIX_BYTES <= MAX_FRAME_BYTES,
                "meshdata frame declares {body} bytes, past the ceiling"
            );
            anyhow::ensure!(
                body >= MIN_BODY_BYTES,
                "meshdata frame declares {body} bytes, shorter than its own header"
            );
            let total = LENGTH_PREFIX_BYTES + body;
            if self.buffer.len() - at < total {
                break;
            }
            let kind = self.buffer[at + 4];
            let mut lane = [0u8; 8];
            lane.copy_from_slice(&self.buffer[at + 5..at + 13]);
            frames.push(Frame {
                kind,
                lane_id: u64::from_be_bytes(lane),
                payload: self.buffer[at + HEADER_BYTES..at + total].to_vec(),
            });
            at += total;
        }
        if at > 0 {
            self.buffer.drain(..at);
        }
        Ok(frames)
    }

    pub fn pending(&self) -> usize {
        self.buffer.len()
    }

    /// A torn frame tears the LANE, never the daemon (D5).
    pub fn reset(&mut self) {
        self.buffer.clear();
    }
}

// ---- lanes ----------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneClass {
    Reliable,
    Lossy,
}

impl LaneClass {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "reliable" => Some(Self::Reliable),
            "lossy" => Some(Self::Lossy),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reliable => "reliable",
            Self::Lossy => "lossy",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Lane {
    pub lane_id: u64,
    pub class: LaneClass,
    pub peer: String,
    pub protocol: String,
    pub doc_id: Option<String>,
    pub inbound: bool,
}

/// Inbound lane ids are minted HERE; outbound ids are minted by fieldd. Both
/// live in one table, and this base is what keeps two numbering authorities
/// from colliding without either having to know about the other.
///
/// 2^32 and deliberately NOT the high bit: a laneId crosses JSON-RPC as a
/// JavaScript number, so anything past 2^53 would silently lose precision on
/// the way to fieldd — a lane id that does not round-trip is a lane whose bytes
/// go to the wrong consumer.
pub const INBOUND_LANE_ID_BASE: u64 = 1 << 32;

/// Lane LIFECYCLE, which is control and therefore rides the control plane
/// (`native.mesh.lane.subscribe`). The bytes those lanes carry never appear
/// here — that is the whole D5 split, expressed in a type.
#[derive(Debug, Clone)]
pub enum LaneEvent {
    /// A peer opened a lane toward us; fieldd has not claimed it yet.
    PeerOpened(Lane),
    Closed {
        lane_id: u64,
        inbound: bool,
        /// Open vocabulary, logged and forwarded verbatim (tolerant reader):
        /// "local" | "peer-closed" | "torn-frame" | …
        reason: String,
    },
}

/// Matches truffle's own subscribe capacity. A slow consumer LAGS rather than
/// blocking the transport; the mgmt forwarder answers a lag with a fresh
/// snapshot (P5), which is self-healing in a way a bigger buffer is not.
const LANE_EVENT_CAPACITY: usize = 64;

/// The remote leg. C6-3 lands the truffle QUIC/datagram implementation here;
/// the bridge itself never learns which one it has, which is what keeps "the
/// bridge is dumb" true rather than aspirational.
#[async_trait::async_trait]
pub trait LaneTransport: Send + Sync {
    /// Open toward a peer. Errors are lane-fatal, never daemon-fatal.
    async fn open(&self, lane: &Lane) -> anyhow::Result<()>;
    /// Deliver bytes on an open lane. A lossy lane may drop; a reliable one
    /// propagates backpressure by awaiting.
    async fn send(&self, lane: &Lane, payload: &[u8]) -> anyhow::Result<()>;
    async fn close(&self, lane: &Lane) -> anyhow::Result<()>;
}

/// A transport that loops every write straight back as an inbound delivery.
/// Not a mock in the pejorative sense — it is how the LOCAL half is proven
/// without a tailnet, and it is what the socket/lane/routing tests run against.
pub struct LoopbackTransport {
    inbound: UnboundedSender<(u64, Vec<u8>)>,
}

impl LoopbackTransport {
    pub fn new(inbound: UnboundedSender<(u64, Vec<u8>)>) -> Self {
        Self { inbound }
    }
}

#[async_trait::async_trait]
impl LaneTransport for LoopbackTransport {
    async fn open(&self, _lane: &Lane) -> anyhow::Result<()> {
        Ok(())
    }
    async fn send(&self, lane: &Lane, payload: &[u8]) -> anyhow::Result<()> {
        if lane.class == LaneClass::Lossy && payload.len() > LOSSY_MAX_PAYLOAD_BYTES {
            anyhow::bail!(
                "lossy payload {} exceeds {LOSSY_MAX_PAYLOAD_BYTES}",
                payload.len()
            );
        }
        let _ = self.inbound.send((lane.lane_id, payload.to_vec()));
        Ok(())
    }
    async fn close(&self, _lane: &Lane) -> anyhow::Result<()> {
        Ok(())
    }
}

// ---- the service ----------------------------------------------------------

/// The connected fieldd client, and WHICH one it is.
///
/// The identity is load-bearing, not bookkeeping. Two connections overlap
/// whenever fieldd restarts — the new process authenticates before the old
/// task notices EOF — and field-native outliving fieldd is the two-plane law,
/// so that is a first-class scenario rather than an edge case. Without the id,
/// the OLD connection's teardown clears the NEW connection's delivery path and
/// every inbound byte vanishes: no error, no log, no `lane.closed`. It is also
/// asymmetric — fieldd→peer keeps working off the per-connection sender — so it
/// presents as "the peer went quiet" rather than "our socket went deaf".
struct ClientSlot {
    conn_id: u64,
    tx: UnboundedSender<Vec<u8>>,
}

struct Shared {
    health: Mutex<UnitHealth>,
    lanes: Mutex<HashMap<u64, Lane>>,
    /// Frames bound for the connected fieldd client. None until HELLO succeeds.
    out: Mutex<Option<ClientSlot>>,
    next_conn_id: AtomicU64,
    ping: UnboundedSender<()>,
    transport: Mutex<Option<Arc<dyn LaneTransport>>>,
    events: broadcast::Sender<LaneEvent>,
    next_inbound: AtomicU64,
}

impl Shared {
    fn set(&self, state: UnitState, detail: Option<String>) {
        *self.health.lock().unwrap() = UnitHealth {
            unit: "mesh-bridge".into(),
            state,
            detail,
            auth_url: None,
        };
        let _ = self.ping.send(());
    }

    fn send_to_client(&self, frame: Vec<u8>) {
        if let Some(slot) = self.out.lock().unwrap().as_ref() {
            let _ = slot.tx.send(frame);
        }
    }

    /// Is this connection still the live one? A superseded connection must stop
    /// acting like the product plane — otherwise a stale fieldd keeps pushing
    /// DATA onto lanes the new one now owns.
    fn is_current(&self, conn_id: u64) -> bool {
        self.out
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|slot| slot.conn_id == conn_id)
    }
}

/// The mgmt server's door to the bridge — lane lifecycle arrives here, never
/// over the data socket (D5).
#[derive(Clone)]
pub struct BridgeHandle {
    shared: Arc<Shared>,
}

impl BridgeHandle {
    /// native.mesh.lane.open. Refuses a duplicate id rather than absorbing it:
    /// laneId is caller-minted, so a collision means the caller lost track, and
    /// silently reusing the lane would cross two byte streams.
    pub async fn open_lane(&self, lane: Lane) -> anyhow::Result<()> {
        let transport = self.shared.transport.lock().unwrap().clone();
        // RESERVE, then open. Checking under the lock and inserting after the
        // await leaves a window where two opens of one id both pass the check
        // and both build a stream — one of which then leaks, unreachable. The
        // window is narrow today (mgmt dispatch is serial per connection) and
        // costs one line to close, which is the wrong trade to defer.
        let lane_id = lane.lane_id;
        {
            let mut lanes = self.shared.lanes.lock().unwrap();
            anyhow::ensure!(!lanes.contains_key(&lane_id), "lane {lane_id} already open");
            lanes.insert(lane_id, lane.clone());
        }
        if let Some(t) = transport.as_ref() {
            if let Err(e) = t.open(&lane).await {
                // The reservation must not outlive the failure, or the id is
                // burned for the lifetime of the daemon.
                self.shared.lanes.lock().unwrap().remove(&lane_id);
                return Err(e);
            }
        }
        Ok(())
    }

    /// native.mesh.lane.close — idempotent by intent: both ends hanging up at
    /// once is the normal race, not an error to report.
    pub async fn close_lane(&self, lane_id: u64) -> anyhow::Result<()> {
        // Both guards are taken and RELEASED before the await. A MutexGuard held
        // across an await point can deadlock the runtime — and in a tuple
        // scrutinee the temporary lives to the end of the block, which is how
        // this read as correct while being wrong.
        let lane = self.shared.lanes.lock().unwrap().remove(&lane_id);
        let transport = self.shared.transport.lock().unwrap().clone();
        let Some(lane) = lane else {
            return Ok(()); // already gone — the normal both-ends-at-once race
        };
        let inbound = lane.inbound;
        if let Some(t) = transport {
            t.close(&lane).await?;
        }
        let _ = self.shared.events.send(LaneEvent::Closed {
            lane_id,
            inbound,
            reason: "local".into(),
        });
        Ok(())
    }

    pub fn lane(&self, lane_id: u64) -> Option<Lane> {
        self.shared.lanes.lock().unwrap().get(&lane_id).cloned()
    }

    pub fn open_lane_count(&self) -> usize {
        self.shared.lanes.lock().unwrap().len()
    }

    /// Every live lane, id-ordered — the snapshot half of `lane.subscribe`.
    pub fn lanes(&self) -> Vec<Lane> {
        let mut lanes: Vec<Lane> = self
            .shared
            .lanes
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        lanes.sort_by_key(|l| l.lane_id);
        lanes
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<LaneEvent> {
        self.shared.events.subscribe()
    }

    /// Adopt a lane a PEER opened (C6-3, transport-side). The id is minted here
    /// and the originator's is discarded: the two directions share no id space,
    /// and honouring a remote id would let a peer choose keys in our table —
    /// EL7 arithmetic, not politeness. `peer` likewise comes from the
    /// WireGuard-authenticated remote address, never from the stream's own
    /// claim about itself.
    pub fn adopt_inbound_lane(
        &self,
        class: LaneClass,
        peer: String,
        protocol: String,
        doc_id: Option<String>,
    ) -> Lane {
        let lane = {
            let mut lanes = self.shared.lanes.lock().unwrap();
            // The base makes a collision impossible in practice; the skip makes
            // it impossible in fact, whatever fieldd decides to mint.
            let lane_id = loop {
                let id =
                    INBOUND_LANE_ID_BASE + self.shared.next_inbound.fetch_add(1, Ordering::Relaxed);
                if !lanes.contains_key(&id) {
                    break id;
                }
            };
            let lane = Lane {
                lane_id,
                class,
                peer,
                protocol,
                doc_id,
                inbound: true,
            };
            lanes.insert(lane_id, lane.clone());
            lane
        };
        let _ = self.shared.events.send(LaneEvent::PeerOpened(lane.clone()));
        lane
    }

    /// A lane that ended AT THE TRANSPORT — the peer hung up, or its stream
    /// tore. No transport call back out: the thing that would be closed is the
    /// thing that just died. Silent for an unknown id, because both ends
    /// hanging up at once is the ordinary case.
    pub fn forget_lane(&self, lane_id: u64, reason: &str) {
        let Some(lane) = self.shared.lanes.lock().unwrap().remove(&lane_id) else {
            return;
        };
        let _ = self.shared.events.send(LaneEvent::Closed {
            lane_id,
            inbound: lane.inbound,
            reason: reason.to_string(),
        });
    }

    /// Install the remote leg. C6-3 hands the truffle-backed transport in once
    /// the node is up; until then lanes are local-only and say so.
    pub fn set_transport(&self, transport: Arc<dyn LaneTransport>) {
        *self.shared.transport.lock().unwrap() = Some(transport);
    }

    /// An inbound delivery from a peer: framed to the connected fieldd client.
    /// Unknown lane ids are DROPPED, not errors — the mgmt announcement and the
    /// data socket are different transports, so bytes can legitimately arrive
    /// for a lane fieldd has not been told about yet.
    pub fn deliver_inbound(&self, lane_id: u64, payload: &[u8]) {
        match encode_frame(FRAME_DATA, lane_id, payload) {
            Ok(frame) => self.shared.send_to_client(frame),
            Err(e) => tracing::warn!(
                event = "field_native.mesh_bridge.inbound_unframable",
                component = "mesh_bridge",
                lane_id,
                error = %e,
                "An inbound lane delivery could not be framed"
            ),
        }
    }
}

pub struct MeshBridge {
    socket_path: PathBuf,
    secret: [u8; 32],
    shared: Arc<Shared>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl MeshBridge {
    pub fn new(config: &NativeConfig, secret: [u8; 32], ping: UnboundedSender<()>) -> Self {
        Self {
            socket_path: config.meshdata_socket(),
            secret,
            shared: Arc::new(Shared {
                health: Mutex::new(UnitHealth {
                    unit: "mesh-bridge".into(),
                    state: UnitState::Starting,
                    detail: None,
                    auth_url: None,
                }),
                lanes: Mutex::new(HashMap::new()),
                out: Mutex::new(None),
                next_conn_id: AtomicU64::new(1),
                ping,
                transport: Mutex::new(None),
                events: broadcast::channel(LANE_EVENT_CAPACITY).0,
                next_inbound: AtomicU64::new(0),
            }),
            task: Mutex::new(None),
        }
    }

    pub fn handle(&self) -> BridgeHandle {
        BridgeHandle {
            shared: self.shared.clone(),
        }
    }
}

#[async_trait::async_trait]
impl NativeService for MeshBridge {
    fn id(&self) -> &'static str {
        "mesh-bridge"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        &["mesh-gateway"]
    }

    async fn start(&self) -> anyhow::Result<()> {
        // unlink-stale-then-bind: the path is stable across fieldd restarts
        // (external-mode law), so a leftover node from a killed daemon must not
        // make a fresh one unbindable.
        if self.socket_path.exists() {
            std::fs::remove_file(&self.socket_path)?;
        }
        let listener = UnixListener::bind(&self.socket_path)?;
        let shared = self.shared.clone();
        let secret = self.secret;
        let handle = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let shared = shared.clone();
                        tokio::spawn(async move { serve_client(stream, shared, secret).await });
                    }
                    Err(e) => {
                        tracing::error!(
                            event = "field_native.mesh_bridge.accept_failed",
                            component = "mesh_bridge",
                            error = %e,
                            "The MeshData bridge stopped accepting connections"
                        );
                        break;
                    }
                }
            }
        });
        *self.task.lock().unwrap() = Some(handle);
        self.shared
            .set(UnitState::Up, Some("meshdata socket bound".into()));
        Ok(())
    }

    fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    async fn stop(&self) -> anyhow::Result<()> {
        if let Some(t) = self.task.lock().unwrap().take() {
            t.abort();
        }
        *self.shared.out.lock().unwrap() = None;
        self.shared.lanes.lock().unwrap().clear();
        let _ = std::fs::remove_file(&self.socket_path);
        Ok(())
    }
}

/// One fieldd connection. Single client at a time by design (one product plane
/// per device); a new authenticated hello supersedes the old connection the way
/// the mgmt channel does.
async fn serve_client(stream: UnixStream, shared: Arc<Shared>, secret: [u8; 32]) {
    let conn_id = shared.next_conn_id.fetch_add(1, Ordering::Relaxed);
    let (mut rd, mut wr) = stream.into_split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let writer = tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            if wr.write_all(&frame).await.is_err() {
                break;
            }
        }
    });

    let mut reader = FrameReader::default();
    let mut authed = false;
    let mut buf = vec![0u8; 64 * 1024];

    'conn: loop {
        let n = match rd.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let frames = match reader.push(&buf[..n]) {
            Ok(f) => f,
            Err(e) => {
                // Structural garbage: the SOCKET is unusable, so end it. The
                // lane-scoped version of this rule lives at the transport.
                tracing::warn!(
                    event = "field_native.mesh_bridge.frame_error",
                    component = "mesh_bridge",
                    error = %e,
                    "A MeshData frame could not be decoded; dropping the connection"
                );
                break;
            }
        };
        for frame in frames {
            if !authed {
                if frame.kind != FRAME_HELLO || !hello_ok(&frame.payload, &secret) {
                    let _ = tx.send(
                        encode_frame(FRAME_ERR, 0, b"{\"reason\":\"unauthenticated\"}")
                            .unwrap_or_default(),
                    );
                    break;
                }
                authed = true;
                // REPLACE and drop, rather than overwrite: dropping the previous
                // sender closes the old writer's channel, which ends its task and
                // its write half. That is what makes "supersedes" true rather
                // than merely stated.
                let previous = shared.out.lock().unwrap().replace(ClientSlot {
                    conn_id,
                    tx: tx.clone(),
                });
                if previous.is_some() {
                    tracing::info!(
                        event = "field_native.mesh_bridge.client_superseded",
                        component = "mesh_bridge",
                        conn_id,
                        "A new MeshData client superseded the previous one"
                    );
                }
                drop(previous);
                let _ = tx.send(encode_frame(FRAME_HELLO_OK, 0, b"{}").unwrap_or_default());
                tracing::info!(
                    event = "field_native.mesh_bridge.client_authenticated",
                    component = "mesh_bridge",
                    conn_id,
                    "A MeshData client authenticated"
                );
                continue;
            }
            // A superseded connection is no longer the product plane. It kept
            // its `authed` bit, so without this a stale fieldd goes on writing
            // to lanes the new one now owns.
            if !shared.is_current(conn_id) {
                let _ = tx.send(
                    encode_frame(FRAME_ERR, frame.lane_id, b"{\"reason\":\"superseded\"}")
                        .unwrap_or_default(),
                );
                break 'conn;
            }
            if frame.kind == FRAME_DATA {
                let lane = shared.lanes.lock().unwrap().get(&frame.lane_id).cloned();
                let Some(lane) = lane else {
                    // Writing to a lane that was never opened is a caller bug,
                    // but it is one lane's bug: report and keep the socket.
                    let _ = tx.send(
                        encode_frame(FRAME_ERR, frame.lane_id, b"{\"reason\":\"unknown-lane\"}")
                            .unwrap_or_default(),
                    );
                    continue;
                };
                let transport = shared.transport.lock().unwrap().clone();
                let Some(t) = transport else {
                    // A lane with nowhere to go. `lane.open` refuses when the
                    // mesh is down, so reaching here means the transport went
                    // away UNDER a live lane — rare, and no reason to swallow
                    // the bytes. Saying so is the whole point of this plane.
                    let _ = tx.send(
                        encode_frame(FRAME_ERR, frame.lane_id, b"{\"reason\":\"no-transport\"}")
                            .unwrap_or_default(),
                    );
                    continue;
                };
                if let Err(e) = t.send(&lane, &frame.payload).await {
                    let _ = tx.send(
                        encode_frame(FRAME_ERR, frame.lane_id, b"{\"reason\":\"send-failed\"}")
                            .unwrap_or_default(),
                    );
                    tracing::warn!(
                        event = "field_native.mesh_bridge.lane_send_failed",
                        component = "mesh_bridge",
                        lane_id = frame.lane_id,
                        error = %e,
                        "A lane send failed"
                    );
                }
            }
            // Unknown kinds are ignored on purpose (tolerant reader): a newer
            // fieldd may frame something this daemon has no opinion about.
        }
        if !authed {
            break;
        }
    }

    // Clear the slot ONLY if it is still ours. A superseded connection tearing
    // down must not take its successor's delivery path with it — that is silent
    // byte loss on the plane whose whole purpose is preventing exactly that.
    {
        let mut out = shared.out.lock().unwrap();
        if out.as_ref().is_some_and(|slot| slot.conn_id == conn_id) {
            *out = None;
        }
    }

    // DRAIN, don't abort. The refusal frame is queued on `tx`, and aborting the
    // writer here would drop it on the floor — the client would see a bare
    // disconnect and have to guess why. Dropping every sender ends the writer's
    // loop naturally, after it has written what is already queued; the timeout
    // is only there so a wedged peer socket cannot hold the task forever.
    drop(tx);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), writer).await;
}

/// The mgmt channel's own scheme (§4.1): `{bootId, ts, mac}`, HMAC over the
/// pairing secret, ±5min window. Same secret, same shape — a second auth design
/// for the second socket would be a second thing to get wrong.
fn hello_ok(payload: &[u8], secret: &[u8; 32]) -> bool {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(payload) else {
        return false;
    };
    let (Some(boot_id), Some(ts), Some(mac)) = (
        v.get("bootId").and_then(|x| x.as_str()),
        v.get("ts").and_then(|x| x.as_i64()),
        v.get("mac").and_then(|x| x.as_str()),
    ) else {
        return false;
    };
    pairing::verify(secret, boot_id, ts, mac, pairing::now_epoch_secs())
}
