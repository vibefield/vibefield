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
//! WHAT IS NOT HERE YET (C6-2's honest boundary): the remote leg. `LaneTransport`
//! is the seam a truffle QUIC stream lands on in C6-3, where two real nodes can
//! exercise it. Everything local — socket, auth, framing, lane table, routing,
//! teardown — is real and tested now, because it can be. A loopback transport
//! ships alongside so the local half is provable without a tailnet.

use crate::config::NativeConfig;
use crate::contracts::{UnitHealth, UnitState};
use crate::manager::NativeService;
use crate::pairing;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
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

struct Shared {
    health: Mutex<UnitHealth>,
    lanes: Mutex<HashMap<u64, Lane>>,
    /// Frames bound for the connected fieldd client. None until HELLO succeeds;
    /// dropping it is how a superseded connection dies.
    out: Mutex<Option<UnboundedSender<Vec<u8>>>>,
    ping: UnboundedSender<()>,
    transport: Mutex<Option<Arc<dyn LaneTransport>>>,
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
        if let Some(tx) = self.out.lock().unwrap().as_ref() {
            let _ = tx.send(frame);
        }
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
        {
            let lanes = self.shared.lanes.lock().unwrap();
            anyhow::ensure!(
                !lanes.contains_key(&lane.lane_id),
                "lane {} already open",
                lane.lane_id
            );
        }
        if let Some(t) = transport.as_ref() {
            t.open(&lane).await?;
        }
        self.shared.lanes.lock().unwrap().insert(lane.lane_id, lane);
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
        if let (Some(lane), Some(t)) = (lane, transport) {
            t.close(&lane).await?;
        }
        Ok(())
    }

    pub fn lane(&self, lane_id: u64) -> Option<Lane> {
        self.shared.lanes.lock().unwrap().get(&lane_id).cloned()
    }

    pub fn open_lane_count(&self) -> usize {
        self.shared.lanes.lock().unwrap().len()
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
                ping,
                transport: Mutex::new(None),
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

    loop {
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
                *shared.out.lock().unwrap() = Some(tx.clone());
                let _ = tx.send(encode_frame(FRAME_HELLO_OK, 0, b"{}").unwrap_or_default());
                tracing::info!(
                    event = "field_native.mesh_bridge.client_authenticated",
                    component = "mesh_bridge",
                    "A MeshData client authenticated"
                );
                continue;
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
                if let Some(t) = transport {
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
            }
            // Unknown kinds are ignored on purpose (tolerant reader): a newer
            // fieldd may frame something this daemon has no opinion about.
        }
        if !authed {
            break;
        }
    }

    // DRAIN, don't abort. The refusal frame is queued on `tx`, and aborting the
    // writer here would drop it on the floor — the client would see a bare
    // disconnect and have to guess why. Dropping every sender ends the writer's
    // loop naturally, after it has written what is already queued; the timeout
    // is only there so a wedged peer socket cannot hold the task forever.
    *shared.out.lock().unwrap() = None;
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
