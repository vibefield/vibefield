//! The cell's two T1 doors (terminal-pipeline-v3 §8 "door hygiene", §5.1 the
//! handshake, §5.4 activation, §7 demand, §8 credits/transfers; the contracts'
//! CONNECTION_LEG / ACTIVATION / CREDIT_ACCOUNT machines as the cell sees
//! them): one ephemeral loopback TCP port, two WebSocket paths — `/control`
//! and `/frames` — accepted, authenticated, kept alive, and (TP-S3b) carrying
//! session activations.
//!
//! Per socket, in order: the Origin allow-list at the HTTP upgrade → the
//! pre-auth caps (a hello deadline, a byte cap, a connection cap) → the FIRST
//! frame must be a tagged `ConnectionHello` whose channel matches the path →
//! the transport grant verifies (the silent class closes `1008` with NO body;
//! the reason is the audit line) → the ledger admits it (the structured class
//! answers `ConnectionRefused` and closes) → `ConnectionAccepted` (frames: a
//! credit epoch + the MIN of advertised and cell windows) → the leg lives while
//! `LegHeartbeat`s (or, on frames, `CalibrationPing`s) arrive within
//! `heartbeatTtlMs`, and dies `4004` otherwise. A higher-generation (or newer
//! equal-generation) grant supersedes the channel's live leg, which closes
//! `4002`. Shutdown closes every leg `1001`.
//!
//! On an ACCEPTED leg: control — `AttachControlLeg` (the attach grant verified,
//! the attach high-water admitted, the table decides), `DeclareDemand`, and the
//! geometry verbs `ClaimGeometry`/`ReleaseGeometry`/`TransferGeometry` (S3c —
//! the cell owns the seat, ghosttea commits the resize; see `handle_geometry`);
//! frames — `AttachFramesLeg`, `TransportCredit`, `SceneApplied`,
//! `CalibrationPing` (echoed as a `calibration` unit; doubles as the frames
//! heartbeat). Where the sessions come from is the `SessionSource` (source.rs):
//! this harness's own until petition G22 lands.
//!
//! Concurrency: one read task per socket plus one WRITER task owning its sink
//! (every message to a leg — replies, the lease, presentation units — rides an
//! unbounded channel to that writer, so a pump and a reply never race on one
//! socket). The frames writer is a TWO-LANE PRIORITY scheduler (§8, TP-S3d):
//! urgent units (control replies, urgent incrementals) drain before any bulk
//! (transfer chunks), which it re-inspects after every chunk — a background
//! transfer yields to an urgent incremental at chunk boundaries, and a bulk
//! byte-semaphore bounds how far bulk runs ahead. One registry behind a std
//! Mutex with short, await-free critical sections; superseding or shutting a
//! leg down is a message to its read task.

use super::activation::{
    ActivationTable, AttachControlInput, AttachFramesInput, Effect, GeometryDecision, GeometryOp,
    GeometryOutcome, GeometryProceed, LegRef, Outbound, SetIdentity, UnitClass,
};
use super::grant::{Channel, GrantVerifier, PreAuthFailure, PreAuthFailureCode};
use super::ledger::{CurrentLeg, TransportLedger, TransportRefusal};
use super::presentation::{spawn_pump, Admission, PumpHandle, PumpHost, PumpStart};
use super::source::{NoSessions, SessionSource};
use super::unix_ms;
use super::wire::{
    capability_intersection, encode_envelope, inbound_tags, select_version, tagged,
    AttachControlLeg, AttachFramesLeg, AttachRefused, CalibrationPing, ClaimGeometry,
    ConnectionAccepted, ConnectionHello, ConnectionRefused, DeclareDemand, LegHeartbeat,
    LegHeartbeatAck, ProtocolLimits, ReceiverCapacities, ReleaseGeometry, SceneApplied, Tagged,
    TransferGeometry, TransportCredit, TrfIdentity,
};
use crate::registries::terminal_pipeline as tp;
use crate::registries::terminal_pipeline_close_codes as close;
use anyhow::{Context, Result};
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use ghosttea::{ControlClaim, Session, ViewAccess};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Semaphore};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

/// Everything the door needs, with the registries' numbers as defaults.
#[derive(Clone)]
pub struct DoorConfig {
    pub verifier: GrantVerifier,
    /// `Origin` values admitted at the upgrade. A socket WITHOUT an Origin
    /// header (a non-browser client) is admitted — the grant is the authority,
    /// the allow-list is hygiene (mirrors fieldd's ProductAPI door).
    pub allowed_origins: Vec<String>,
    pub hello_deadline: Duration,
    pub pre_auth_max_bytes: usize,
    pub pre_auth_connection_cap: usize,
    pub max_connection_sets: usize,
    pub heartbeat_ttl: Duration,
    pub protocol_limits: ProtocolLimits,
    pub cell_caps: ReceiverCapacities,
    /// TP-S3b — where sessions come from (`NoSessions` until G22 in production;
    /// `DirectSessions` in the harness/test binary).
    pub source: Arc<dyn SessionSource>,
    /// the cadence of the activation tick (deadlines, expiry, lag by time)
    pub tick: Duration,
    /// how long the pump waits for the engine's forced full frame (seed/catch-up)
    pub seed_wait: Duration,
    /// the activation-time convergence bound: a seed+catch-up that cannot be
    /// admitted within it stops the activation `{overload}` (§8, `maxActivationCatchupMs`)
    pub catchup_bound: Duration,
}

impl std::fmt::Debug for DoorConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DoorConfig")
            .field("verifier", &self.verifier)
            .field("allowed_origins", &self.allowed_origins)
            .field("hello_deadline", &self.hello_deadline)
            .field("heartbeat_ttl", &self.heartbeat_ttl)
            .finish_non_exhaustive()
    }
}

impl DoorConfig {
    pub fn new(verifier: GrantVerifier, allowed_origins: Vec<String>) -> Self {
        Self {
            verifier,
            allowed_origins,
            hello_deadline: Duration::from_millis(tp::HELLO_DEADLINE_MS),
            pre_auth_max_bytes: tp::PRE_AUTH_MAX_BYTES as usize,
            pre_auth_connection_cap: tp::PRE_AUTH_CONNECTION_CAP as usize,
            max_connection_sets: tp::MAX_CONNECTION_SETS as usize,
            heartbeat_ttl: Duration::from_millis(tp::HEARTBEAT_TTL_MS),
            protocol_limits: ProtocolLimits::DEFAULTS,
            cell_caps: ReceiverCapacities::CELL_CAPS,
            source: Arc::new(NoSessions),
            tick: Duration::from_millis(500),
            seed_wait: Duration::from_millis(tp::SEED_FRAME_WAIT_MS),
            catchup_bound: Duration::from_millis(tp::MAX_ACTIVATION_CATCHUP_MS),
        }
    }

    pub fn with_source(mut self, source: Arc<dyn SessionSource>) -> Self {
        self.source = source;
        self
    }
}

/// Why a leg's task is told to close by someone other than its peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegClose {
    /// A higher-generation (or newer) grant took this channel — `4002`.
    Superseded,
    /// The cell is going away — `1001`.
    Shutdown,
    /// The cell is no longer this route (TC-D15) — `4000`.
    StaleRoute,
    /// The lease fence failed — `4001`.
    Fenced,
}

impl LegClose {
    fn code_and_reason(self) -> (u16, &'static str) {
        match self {
            Self::Superseded => (close::SUPERSEDED, "SUPERSEDED"),
            Self::Shutdown => (close::GOING_AWAY, "GOING_AWAY"),
            Self::StaleRoute => (close::STALE_ROUTE, "STALE_ROUTE"),
            Self::Fenced => (close::FENCED, "FENCED"),
        }
    }
}

struct LegEntry {
    connection_id: u64,
    leg_generation: u64,
    transport_grant_generation: u64,
    grant_issued_at: u64,
    close_tx: mpsc::UnboundedSender<LegClose>,
}

struct ConnectionSet {
    client_id: String,
    legs: HashMap<Channel, LegEntry>,
    next_leg_generation: HashMap<Channel, u64>,
}

struct Registry {
    ledger: TransportLedger,
    sets: HashMap<String, ConnectionSet>,
    pre_auth_connections: usize,
    next_connection_id: u64,
    closed: bool,
    activations: ActivationTable,
}

struct DoorState {
    config: DoorConfig,
    registry: Mutex<Registry>,
    pumps: Mutex<HashMap<String, PumpHandle>>,
    /// the Arc of this very state — the pump host trait takes `&self` but a
    /// pump task needs an owned handle; set once by `Door::serve`
    me: Mutex<Weak<DoorState>>,
}

impl DoorState {
    fn arc(&self) -> Option<Arc<DoorState>> {
        self.me.lock().unwrap().upgrade()
    }
}

/// A read-only view for tests and diagnostics — ids, generations, counts;
/// never a grant, a key or a nonce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoorSnapshot {
    pub sets: Vec<SetSnapshot>,
    pub pre_auth_connections: usize,
    /// (transport high-waters, attach high-waters, nonces)
    pub ledger_sizes: (usize, usize, usize),
    /// (activationId, clientId, sessionId, presentation, input) as strings
    pub activations: Vec<(String, String, String, String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetSnapshot {
    pub connection_set_id: String,
    pub client_id: String,
    /// (channel, legGeneration, transportGrantGeneration), control before frames
    pub legs: Vec<(Channel, u64, u64)>,
    pub high_water: Option<u64>,
}

/// A serving door: its port, its registry, and the accept loop.
pub struct Door {
    port: u16,
    state: Arc<DoorState>,
    accept_task: tokio::task::JoinHandle<()>,
    tick_task: tokio::task::JoinHandle<()>,
}

impl Door {
    /// Bind `127.0.0.1:0` and start accepting. The URLs are the cell's
    /// `CellEndpointSet` for the route row.
    pub async fn serve(config: DoorConfig) -> Result<Door> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .context("bind the T1 door on loopback")?;
        let port = listener.local_addr().context("door local address")?.port();
        let cell_boot_id = config.verifier.cell_boot_id().to_string();
        let tick = config.tick;
        let state = Arc::new(DoorState {
            config,
            registry: Mutex::new(Registry {
                ledger: TransportLedger::default(),
                sets: HashMap::new(),
                pre_auth_connections: 0,
                next_connection_id: 1,
                closed: false,
                activations: ActivationTable::new(&cell_boot_id),
            }),
            pumps: Mutex::new(HashMap::new()),
            me: Mutex::new(Weak::new()),
        });
        *state.me.lock().unwrap() = Arc::downgrade(&state);
        let accept_state = state.clone();
        let accept_task = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, peer)) => {
                        let _ = stream.set_nodelay(true);
                        let st = accept_state.clone();
                        tokio::spawn(async move {
                            serve_connection(st, stream, peer).await;
                        });
                    }
                    Err(error) => {
                        // EMFILE and friends: log, breathe, keep serving.
                        tracing::warn!(
                            event = "field_native.tp.door.accept_error",
                            component = "terminal",
                            error = %error,
                            "door accept failed"
                        );
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                }
            }
        });
        let tick_state = state.clone();
        let tick_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tick);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                let effects = {
                    let mut reg = tick_state.registry.lock().unwrap();
                    if reg.closed {
                        break;
                    }
                    reg.activations.tick(unix_ms())
                };
                perform(&tick_state, effects);
            }
        });
        tracing::info!(
            event = "field_native.tp.door.serving",
            component = "terminal",
            port,
            "the cell's T1 doors are serving"
        );
        Ok(Door {
            port,
            state,
            accept_task,
            tick_task,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn control_url(&self) -> String {
        format!("ws://127.0.0.1:{}/control", self.port)
    }

    pub fn frames_url(&self) -> String {
        format!("ws://127.0.0.1:{}/frames", self.port)
    }

    pub fn snapshot(&self) -> DoorSnapshot {
        let reg = self.state.registry.lock().unwrap();
        let mut sets: Vec<SetSnapshot> = reg
            .sets
            .iter()
            .map(|(id, set)| {
                let mut legs: Vec<(Channel, u64, u64)> = set
                    .legs
                    .iter()
                    .map(|(c, l)| (*c, l.leg_generation, l.transport_grant_generation))
                    .collect();
                legs.sort();
                SetSnapshot {
                    connection_set_id: id.clone(),
                    client_id: set.client_id.clone(),
                    legs,
                    high_water: reg.ledger.transport_high_water(id),
                }
            })
            .collect();
        sets.sort_by(|a, b| a.connection_set_id.cmp(&b.connection_set_id));
        DoorSnapshot {
            sets,
            pre_auth_connections: reg.pre_auth_connections,
            ledger_sizes: reg.ledger.sizes(),
            activations: reg
                .activations
                .summary()
                .into_iter()
                .map(|(a, c, s, p, i)| (a, c, s, format!("{p:?}"), format!("{i:?}")))
                .collect(),
        }
    }

    /// Tell every leg of a set to close with `reason` (TC-S6's STALE_ROUTE /
    /// FENCED path; tests). Returns how many legs were signalled.
    pub fn close_set(&self, connection_set_id: &str, reason: LegClose) -> usize {
        let reg = self.state.registry.lock().unwrap();
        reg.sets
            .get(connection_set_id)
            .map(|set| {
                set.legs
                    .values()
                    .filter(|l| l.close_tx.send(reason).is_ok())
                    .count()
            })
            .unwrap_or(0)
    }

    /// Stop accepting, close every leg `1001`, and give the close frames a
    /// bounded moment to leave. Idempotent.
    pub async fn shutdown(&self) {
        self.accept_task.abort();
        self.tick_task.abort();
        let signalled = {
            let mut reg = self.state.registry.lock().unwrap();
            reg.closed = true;
            reg.sets
                .values()
                .flat_map(|s| s.legs.values())
                .filter(|l| l.close_tx.send(LegClose::Shutdown).is_ok())
                .count()
        };
        if signalled > 0 {
            // The tasks own the sockets; a short grace lets the 1001s flush.
            let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
            loop {
                let live = {
                    let reg = self.state.registry.lock().unwrap();
                    reg.sets.values().map(|s| s.legs.len()).sum::<usize>()
                };
                if live == 0 || tokio::time::Instant::now() >= deadline {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
        // every pump goes with its leg; stop any straggler
        let pumps: Vec<PumpHandle> = self
            .state
            .pumps
            .lock()
            .unwrap()
            .drain()
            .map(|(_, p)| p)
            .collect();
        for pump in pumps {
            pump.stop();
            pump.task.abort();
        }
        tracing::info!(
            event = "field_native.tp.door.stopped",
            component = "terminal",
            port = self.port,
            legs_signalled = signalled,
            "the cell's T1 doors stopped"
        );
    }
}

impl Drop for Door {
    fn drop(&mut self) {
        self.accept_task.abort();
        self.tick_task.abort();
    }
}

// ---- the pump's view of the door --------------------------------------------

impl PumpHost for DoorState {
    fn try_admit(
        &self,
        connection_id: u64,
        activation_id: &str,
        bytes: u64,
        class: UnitClass,
    ) -> Admission {
        let mut reg = self.registry.lock().unwrap();
        match reg
            .activations
            .can_admit(connection_id, activation_id, bytes, class)
        {
            None => Admission::Gone,
            Some(false) => Admission::Starved,
            Some(true) => {
                reg.activations
                    .try_admit(connection_id, activation_id, bytes, class);
                Admission::Admitted
            }
        }
    }

    fn can_admit(
        &self,
        connection_id: u64,
        activation_id: &str,
        bytes: u64,
        class: UnitClass,
    ) -> Admission {
        let reg = self.registry.lock().unwrap();
        match reg
            .activations
            .can_admit(connection_id, activation_id, bytes, class)
        {
            None => Admission::Gone,
            Some(false) => Admission::Starved,
            Some(true) => Admission::Admitted,
        }
    }

    fn unit_sent(&self, activation_id: &str, revision: u64, seed: bool) {
        let effects = {
            let mut reg = self.registry.lock().unwrap();
            reg.activations.unit_sent(activation_id, revision, seed)
        };
        perform_on(self, effects);
    }

    fn presentation_stopped(&self, activation_id: &str, reason: &'static str) {
        let effects = {
            let mut reg = self.registry.lock().unwrap();
            reg.activations
                .presentation_stopped(activation_id, reason, unix_ms())
        };
        perform_on(self, effects);
    }

    fn wants_frames(&self, activation_id: &str) -> bool {
        self.registry
            .lock()
            .unwrap()
            .activations
            .wants_frames(activation_id)
    }
}

/// Perform the table's effects OUTSIDE its lock (sends, view attach/detach,
/// pump start/stop/wake). Re-entrant: an attach yields `view_attached`, which
/// may yield a `StartPump`.
fn perform(state: &Arc<DoorState>, effects: Vec<Effect>) {
    perform_on(state, effects);
}

fn perform_on(state: &DoorState, mut effects: Vec<Effect>) {
    while !effects.is_empty() {
        let batch = std::mem::take(&mut effects);
        for effect in batch {
            match effect {
                Effect::Send(leg, text) => leg.send_text(text),
                Effect::AttachView {
                    activation_id,
                    session_id,
                    client_id,
                    view_id,
                    read_write,
                } => {
                    let Some(session) = state.config.source.session(&session_id) else {
                        continue;
                    };
                    let access = if read_write {
                        ViewAccess::ReadWrite
                    } else {
                        ViewAccess::ReadOnly
                    };
                    match session.attach_view_with_access(&view_id, &client_id, access) {
                        Ok(epoch) => {
                            let mut reg = state.registry.lock().unwrap();
                            effects.extend(reg.activations.view_attached(
                                &activation_id,
                                &view_id,
                                epoch,
                            ));
                        }
                        Err(error) => {
                            tracing::warn!(
                                event = "field_native.tp.door.view_attach_failed",
                                component = "terminal",
                                activation_id = %activation_id,
                                error = %error,
                                "the engine refused the activation's view"
                            );
                        }
                    }
                }
                Effect::DetachView {
                    activation_id,
                    session_id,
                    client_id,
                    view_id,
                } => {
                    if let Some(session) = state.config.source.session(&session_id) {
                        let _ = session.detach_view(&view_id, &client_id);
                    }
                    state
                        .registry
                        .lock()
                        .unwrap()
                        .activations
                        .view_detached(&activation_id);
                }
                Effect::StartPump { activation_id } => start_pump(state, &activation_id),
                Effect::StopPump { activation_id } => {
                    if let Some(pump) = state.pumps.lock().unwrap().remove(&activation_id) {
                        pump.stop();
                    }
                }
                Effect::WakePump { activation_id } => {
                    if let Some(pump) = state.pumps.lock().unwrap().get(&activation_id) {
                        pump.notify.notify_one();
                    }
                }
            }
        }
    }
}

fn start_pump(state: &DoorState, activation_id: &str) {
    // Everything the pump needs, read under the lock; the spawn happens outside it.
    let start = {
        let reg = state.registry.lock().unwrap();
        let Some(a) = reg.activations.get(activation_id) else {
            return;
        };
        let Some(frames) = a.frames.clone() else {
            return;
        };
        let Some(session) = state.config.source.session(&a.session_id) else {
            return;
        };
        let Some(hub) = state.config.source.frames(&a.session_id) else {
            return;
        };
        let Some(ledger) = reg.activations.credit_ledger(frames.connection_id) else {
            return;
        };
        let session_handle: u64 = session.summary().handle.parse().unwrap_or(0);
        let per_activation = ledger.per_activation_limit.max(1);
        let connection = ledger.connection.limit.max(1);
        let max_chunk = (state.config.protocol_limits.max_presentation_chunk_bytes)
            .min(per_activation / 2)
            .min(connection / 2)
            .max(4096) as usize;
        PumpStart {
            activation_id: activation_id.to_string(),
            session_id: a.session_id.clone(),
            lease_epoch: a.lease_epoch,
            connection_id: frames.connection_id,
            credit_epoch: ledger.credit_epoch,
            frames,
            scene_epoch: reg.activations.scene_epoch(session.session_epoch()),
            session,
            hub,
            session_handle,
            max_chunk_bytes: max_chunk,
            max_urgent_unit_bytes: state
                .config
                .protocol_limits
                .max_urgent_presentation_unit_bytes,
            seed_wait: state.config.seed_wait,
            catchup_bound: state.config.catchup_bound,
        }
    };
    let Some(host) = state.arc() else {
        return;
    };
    let handle = spawn_pump(host, start);
    if let Some(previous) = state
        .pumps
        .lock()
        .unwrap()
        .insert(activation_id.to_string(), handle)
    {
        previous.stop();
    }
}

type Ws = WebSocketStream<TcpStream>;
type WsSink = SplitSink<Ws, Message>;

/// What the upgrade callback captured: the Origin (if any) and the path.
#[derive(Default)]
struct UpgradeFacts {
    origin: Option<String>,
    path: String,
}

fn ws_config(limits: &ProtocolLimits) -> WebSocketConfig {
    let max = limits.max_control_message_bytes as usize;
    WebSocketConfig::default()
        .max_message_size(Some(max))
        .max_frame_size(Some(max))
        .accept_unmasked_frames(false)
}

// The upgrade callback's error type is tungstenite's `ErrorResponse` (an http
// Response) — large by their definition, not ours to shrink.
#[allow(clippy::result_large_err)]
async fn serve_connection(state: Arc<DoorState>, stream: TcpStream, peer: SocketAddr) {
    // The cap is decided HERE, at arrival, so an earlier socket is never pushed
    // over it by a later one: a socket that finds the cap full is not counted
    // and is refused 1008 once its upgrade completes.
    let (connection_id, counted) = {
        let mut reg = state.registry.lock().unwrap();
        if reg.closed {
            return;
        }
        let counted = reg.pre_auth_connections < state.config.pre_auth_connection_cap;
        if counted {
            reg.pre_auth_connections += 1;
        }
        let id = reg.next_connection_id;
        reg.next_connection_id += 1;
        (id, counted)
    };
    let mut pre_auth_guard = PreAuthGuard {
        state: state.clone(),
        armed: counted,
    };

    let facts = Arc::new(Mutex::new(UpgradeFacts::default()));
    let capture = facts.clone();
    let callback = move |req: &Request, resp: Response| {
        let mut f = capture.lock().unwrap();
        f.origin = req
            .headers()
            .get("origin")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        f.path = req.uri().path().to_owned();
        // No `Sec-WebSocket-Extensions` is ever added here: compression stays
        // un-negotiated, so both ends charge the same received length (§8).
        Ok(resp)
    };
    let mut ws = match tokio_tungstenite::accept_hdr_async_with_config(
        stream,
        callback,
        Some(ws_config(&state.config.protocol_limits)),
    )
    .await
    {
        Ok(ws) => ws,
        Err(error) => {
            tracing::info!(
                event = "field_native.tp.door.upgrade_failed",
                component = "terminal",
                peer = %peer,
                error = %error,
                "a T1 door upgrade did not complete"
            );
            return;
        }
    };
    let (origin, path) = {
        let f = facts.lock().unwrap();
        (f.origin.clone(), f.path.clone())
    };

    // Pre-auth hygiene, in the order the spec states it.
    let channel = match path.as_str() {
        "/control" => Channel::Control,
        "/frames" => Channel::Frames,
        _ => {
            refuse_silently(
                &mut ws,
                &mut pre_auth_guard,
                &PreAuthFailure::new(PreAuthFailureCode::HelloMalformed, format!("path {path}")),
                &origin,
                None,
            )
            .await;
            return;
        }
    };
    if let Some(o) = origin.as_deref() {
        if !state.config.allowed_origins.iter().any(|a| a == o) {
            refuse_silently(
                &mut ws,
                &mut pre_auth_guard,
                &PreAuthFailure::new(PreAuthFailureCode::OriginRejected, "origin"),
                &origin,
                Some(channel),
            )
            .await;
            return;
        }
    }
    if !counted {
        refuse_silently(
            &mut ws,
            &mut pre_auth_guard,
            &PreAuthFailure::new(PreAuthFailureCode::PreAuthLimit, "preAuthConnectionCap"),
            &origin,
            Some(channel),
        )
        .await;
        return;
    }

    // The FIRST frame: a tagged ConnectionHello, within the deadline and the byte cap.
    let first = match tokio::time::timeout(state.config.hello_deadline, ws.next()).await {
        Err(_) => {
            refuse_silently(
                &mut ws,
                &mut pre_auth_guard,
                &PreAuthFailure::new(PreAuthFailureCode::PreAuthLimit, "helloDeadline"),
                &origin,
                Some(channel),
            )
            .await;
            return;
        }
        Ok(None) | Ok(Some(Err(_))) => return, // the peer left before saying hello
        Ok(Some(Ok(Message::Close(_)))) => return,
        Ok(Some(Ok(message))) => message,
    };
    let text = match first {
        Message::Text(t) if t.len() <= state.config.pre_auth_max_bytes => t,
        Message::Text(_) => {
            refuse_silently(
                &mut ws,
                &mut pre_auth_guard,
                &PreAuthFailure::new(PreAuthFailureCode::PreAuthLimit, "preAuthMaxBytes"),
                &origin,
                Some(channel),
            )
            .await;
            return;
        }
        _ => {
            refuse_silently(
                &mut ws,
                &mut pre_auth_guard,
                &PreAuthFailure::new(
                    PreAuthFailureCode::HelloMalformed,
                    "first frame is not text",
                ),
                &origin,
                Some(channel),
            )
            .await;
            return;
        }
    };
    let hello = match parse_hello(text.as_str(), channel) {
        Ok(h) => h,
        Err(failure) => {
            refuse_silently(
                &mut ws,
                &mut pre_auth_guard,
                &failure,
                &origin,
                Some(channel),
            )
            .await;
            return;
        }
    };

    // The grant — the silent class on any failure; nothing trusted before this.
    let now = unix_ms();
    let claims = match state
        .config
        .verifier
        .verify_transport(&hello.transport_grant, now)
    {
        Ok(c) => c,
        Err(failure) => {
            refuse_silently(
                &mut ws,
                &mut pre_auth_guard,
                &failure,
                &origin,
                Some(channel),
            )
            .await;
            return;
        }
    };

    // The structured class: verified, but can it be honoured right now?
    let Some(version) = select_version(hello.protocol_major, hello.protocol_minor) else {
        refuse_structured(
            &mut ws,
            TransportRefusal::VersionUnsupported,
            &claims.connection_set_id,
            channel,
        )
        .await;
        return;
    };
    let (close_tx, mut close_rx) = mpsc::unbounded_channel::<LegClose>();
    let initial_windows = (channel == Channel::Frames).then(|| {
        hello
            .receiver_capacities
            .map(|advertised| advertised.min_with(state.config.cell_caps))
            .unwrap_or(state.config.cell_caps)
    });
    let admitted = {
        let mut reg = state.registry.lock().unwrap();
        if reg.closed {
            None
        } else {
            let current = reg
                .sets
                .get(&claims.connection_set_id)
                .and_then(|s| s.legs.get(&channel))
                .map(|l| CurrentLeg {
                    transport_grant_generation: l.transport_grant_generation,
                    grant_issued_at: l.grant_issued_at,
                });
            let is_new_set = !reg.sets.contains_key(&claims.connection_set_id);
            let verdict = if is_new_set && reg.sets.len() >= state.config.max_connection_sets {
                Err(TransportRefusal::Capacity)
            } else {
                reg.ledger.check_transport(&claims, channel, current)
            };
            match verdict {
                Err(refusal) => Some(Err(refusal)),
                Ok(admission) => {
                    reg.ledger.commit_transport(&claims, channel, now);
                    reg.ledger.prune(now);
                    let set = reg
                        .sets
                        .entry(claims.connection_set_id.clone())
                        .or_insert_with(|| ConnectionSet {
                            client_id: claims.client_id.clone(),
                            legs: HashMap::new(),
                            next_leg_generation: HashMap::new(),
                        });
                    let gen_slot = set.next_leg_generation.entry(channel).or_insert(0);
                    *gen_slot += 1;
                    let leg_generation = *gen_slot;
                    if let Some(previous) = set.legs.insert(
                        channel,
                        LegEntry {
                            connection_id,
                            leg_generation,
                            transport_grant_generation: claims.transport_grant_generation,
                            grant_issued_at: claims.issued_at,
                            close_tx: close_tx.clone(),
                        },
                    ) {
                        debug_assert!(admission.replaces_current_leg);
                        let _ = previous.close_tx.send(LegClose::Superseded);
                    }
                    if let Some(windows) = initial_windows {
                        // §8 law (4): the credit epoch IS the frames-leg generation.
                        reg.activations.open_credit(
                            connection_id,
                            leg_generation,
                            windows,
                            state.config.protocol_limits.urgent_reserve_bytes,
                        );
                    }
                    // Accepted: no longer a pre-auth socket.
                    reg.pre_auth_connections = reg.pre_auth_connections.saturating_sub(1);
                    pre_auth_guard.armed = false;
                    Some(Ok(leg_generation))
                }
            }
        }
    };
    let leg_generation = match admitted {
        None => {
            let _ = close_with(&mut ws, close::GOING_AWAY, "GOING_AWAY").await;
            return;
        }
        Some(Err(refusal)) => {
            refuse_structured(&mut ws, refusal, &claims.connection_set_id, channel).await;
            return;
        }
        Some(Ok(g)) => g,
    };

    // From here the socket is split: a writer task owns the sink, this task reads.
    // The frames socket's writer is a two-lane PRIORITY scheduler with a bulk
    // byte-semaphore (`maxBulkBytesAdmittedAhead`); a control socket has no bulk.
    let (sink, mut stream) = ws.split();
    let (out_tx, out_rx) = mpsc::unbounded_channel::<Outbound>();
    let bulk_credit = (channel == Channel::Frames).then(|| {
        Arc::new(Semaphore::new(
            state.config.protocol_limits.max_bulk_bytes_admitted_ahead as usize,
        ))
    });
    let writer = tokio::spawn(writer_task(sink, out_rx, bulk_credit.clone()));
    let leg = LegRef {
        connection_id,
        leg_generation,
        out: out_tx.clone(),
        bulk_credit,
    };
    let set_identity = SetIdentity {
        client_id: claims.client_id.clone(),
        connection_set_id: claims.connection_set_id.clone(),
    };

    let accepted = ConnectionAccepted {
        selected_protocol_version: version,
        connection_set_id: claims.connection_set_id.clone(),
        channel,
        leg_generation,
        heartbeat_ttl_ms: state.config.heartbeat_ttl.as_millis() as u64,
        credit_epoch: (channel == Channel::Frames).then_some(leg_generation),
        initial_windows,
        protocol_limits: state.config.protocol_limits,
        capabilities: capability_intersection(&hello.capabilities),
    };
    leg.send_text(tagged("ConnectionAccepted", &accepted));
    tracing::info!(
        event = "field_native.tp.door.accepted",
        component = "terminal",
        connection_set_id = %claims.connection_set_id,
        client_id = %claims.client_id,
        channel = channel.as_str(),
        leg_generation,
        transport_grant_generation = claims.transport_grant_generation,
        origin = origin.as_deref().unwrap_or("-"),
        "a T1 leg is accepted"
    );

    // The accepted leg: messages in, replies out through the writer, a receipt
    // deadline, closes by signal.
    let ttl = state.config.heartbeat_ttl;
    let deadline = tokio::time::sleep(ttl);
    tokio::pin!(deadline);
    let outcome: (u16, String) = loop {
        tokio::select! {
            biased;
            signal = close_rx.recv() => {
                let reason = signal.unwrap_or(LegClose::Shutdown);
                let (code, text) = reason.code_and_reason();
                break (code, text.to_string());
            }
            _ = &mut deadline => {
                break (close::LEG_TIMEOUT, "LEG_TIMEOUT".to_string());
            }
            incoming = stream.next() => {
                match incoming {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break (0, String::new()),
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                    Some(Ok(Message::Binary(_))) => break (close::PROTOCOL, "PROTOCOL:binary-inbound".to_string()),
                    Some(Ok(Message::Text(text))) => {
                        match handle_text(&state, &leg, &set_identity, channel, text.as_str()) {
                            Ok(keepalive) => {
                                if keepalive {
                                    deadline.as_mut().reset(tokio::time::Instant::now() + ttl);
                                }
                            }
                            Err(reason) => break (close::PROTOCOL, format!("PROTOCOL:{reason}")),
                        }
                    }
                }
            }
        }
    };
    // Teardown: the leg leaves the set, every activation on it is invalidated
    // (the lease revoked on the other leg, views detached, pumps stopped), then
    // the close frame goes out through the writer.
    deregister(&state, &claims.connection_set_id, channel, connection_id);
    let effects = {
        let mut reg = state.registry.lock().unwrap();
        reg.activations.leg_closed(connection_id)
    };
    perform(&state, effects);
    let _ = out_tx.send(Outbound::Close(outcome.0, outcome.1.clone()));
    drop(out_tx);
    drop(leg);
    // let the writer send the close, then drain the reader so the peer's echo
    // completes the handshake
    let _ = tokio::time::timeout(Duration::from_millis(500), writer).await;
    let drain = async {
        while let Some(next) = stream.next().await {
            if next.is_err() {
                break;
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_millis(500), drain).await;
    tracing::info!(
        event = "field_native.tp.door.closed",
        component = "terminal",
        connection_set_id = %claims.connection_set_id,
        channel = channel.as_str(),
        leg_generation,
        code = outcome.0,
        reason = %outcome.1,
        "a T1 leg closed"
    );
}

/// The writer: one task per socket owns the sink. It is a TWO-LANE PRIORITY
/// scheduler (§8, TP-S3d): `Text`/`Binary`/`Close` ride the URGENT lane, `Bulk`
/// the bulk lane. Urgent drains fully; between bulk chunks the writer re-inspects
/// urgent, so a background transfer yields to an urgent incremental at chunk
/// boundaries — the bulk-induced-HOL bound. Each written bulk chunk returns its
/// bytes to `bulk_credit` (`maxBulkBytesAdmittedAhead`); on exit the semaphore is
/// CLOSED so a pump blocked acquiring permits ends. `Close(0, _)` = the peer
/// already closed (no frame to send).
async fn writer_task(
    mut sink: WsSink,
    mut rx: mpsc::UnboundedReceiver<Outbound>,
    bulk_credit: Option<Arc<Semaphore>>,
) {
    let mut urgent: VecDeque<Outbound> = VecDeque::new();
    let mut bulk: VecDeque<Vec<u8>> = VecDeque::new();
    let mut disconnected = false;
    loop {
        // Pull everything currently queued into the priority lanes (non-blocking),
        // so an urgent unit that arrived during the last write jumps ahead now.
        loop {
            match rx.try_recv() {
                Ok(item) => enqueue(item, &mut urgent, &mut bulk),
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }
        match pick_next(&mut urgent, &mut bulk) {
            Pick::Urgent(Outbound::Text(t)) => {
                if sink.send(Message::Text(t.into())).await.is_err() {
                    break;
                }
            }
            Pick::Urgent(Outbound::Binary(b)) => {
                if sink.send(Message::Binary(b.into())).await.is_err() {
                    break;
                }
            }
            Pick::Urgent(Outbound::Close(code, reason)) => {
                if code != 0 {
                    let frame = CloseFrame {
                        code: CloseCode::from(code),
                        reason: reason.into(),
                    };
                    let _ = sink.send(Message::Close(Some(frame))).await;
                }
                let _ = sink.flush().await;
                break;
            }
            Pick::Urgent(Outbound::Bulk(b)) => bulk.push_back(b), // unreachable; keep total
            Pick::Bulk(b) => {
                // ONE chunk, then loop back to re-inspect urgent; return its bytes
                // to the bulk-ahead window as the wire drains them.
                let n = b.len();
                let broke = sink.send(Message::Binary(b.into())).await.is_err();
                if let Some(sem) = &bulk_credit {
                    sem.add_permits(n);
                }
                if broke {
                    break;
                }
            }
            Pick::Idle => {
                if disconnected {
                    break;
                }
                match rx.recv().await {
                    Some(item) => enqueue(item, &mut urgent, &mut bulk),
                    None => break,
                }
            }
        }
    }
    // Unblock any pump waiting on bulk-ahead permits for this dead socket.
    if let Some(sem) = &bulk_credit {
        sem.close();
    }
}

/// The writer's priority pick: the URGENT lane drains fully before any bulk, and
/// each lane is FIFO. Pulled out of the writer loop so the invariant is unit-
/// testable without a socket (§8, TP-S3d — the bulk-induced-HOL floor).
enum Pick {
    Urgent(Outbound),
    Bulk(Vec<u8>),
    Idle,
}

fn pick_next(urgent: &mut VecDeque<Outbound>, bulk: &mut VecDeque<Vec<u8>>) -> Pick {
    if let Some(u) = urgent.pop_front() {
        Pick::Urgent(u)
    } else if let Some(b) = bulk.pop_front() {
        Pick::Bulk(b)
    } else {
        Pick::Idle
    }
}

fn enqueue(item: Outbound, urgent: &mut VecDeque<Outbound>, bulk: &mut VecDeque<Vec<u8>>) {
    match item {
        Outbound::Bulk(b) => bulk.push_back(b),
        other => urgent.push_back(other),
    }
}

/// Decrements the pre-auth count if the socket never got accepted.
struct PreAuthGuard {
    state: Arc<DoorState>,
    armed: bool,
}

impl PreAuthGuard {
    /// Give the slot back NOW — a refused socket stops being pre-auth the
    /// moment the refusal is decided, not when its close handshake drains.
    fn release(&mut self) {
        if self.armed {
            self.armed = false;
            let mut reg = self.state.registry.lock().unwrap();
            reg.pre_auth_connections = reg.pre_auth_connections.saturating_sub(1);
        }
    }
}

impl Drop for PreAuthGuard {
    fn drop(&mut self) {
        self.release();
    }
}

fn parse_hello(text: &str, channel: Channel) -> Result<ConnectionHello, PreAuthFailure> {
    let malformed = |d: String| PreAuthFailure::new(PreAuthFailureCode::HelloMalformed, d);
    let tag: Tagged = serde_json::from_str(text).map_err(|e| malformed(format!("tag: {e}")))?;
    if tag.message_type != "ConnectionHello" {
        return Err(malformed(format!("first frame is {}", tag.message_type)));
    }
    let hello: ConnectionHello =
        serde_json::from_str(text).map_err(|e| malformed(format!("hello: {e}")))?;
    if hello.channel != channel {
        return Err(malformed(
            "hello.channel does not match the path".to_string(),
        ));
    }
    Ok(hello)
}

/// One inbound text frame on an ACCEPTED leg. `Ok(true)` re-arms the receipt
/// deadline (a heartbeat or a calibration ping), `Ok(false)` does not,
/// `Err(reason)` is a PROTOCOL close naming the reason.
fn handle_text(
    state: &Arc<DoorState>,
    leg: &LegRef,
    set: &SetIdentity,
    channel: Channel,
    text: &str,
) -> Result<bool, String> {
    let tag: Tagged = serde_json::from_str(text).map_err(|_| "untagged".to_string())?;
    match (channel, tag.message_type.as_str()) {
        (_, "LegHeartbeat") => {
            let hb: LegHeartbeat =
                serde_json::from_str(text).map_err(|e| format!("heartbeat:{e}"))?;
            if hb.connection_set_id != set.connection_set_id
                || hb.channel != channel
                || hb.leg_generation != leg.leg_generation
            {
                return Err("heartbeat-identity".to_string());
            }
            leg.send_text(tagged(
                "LegHeartbeatAck",
                &LegHeartbeatAck {
                    sequence: hb.sequence,
                },
            ));
            Ok(true)
        }
        (_, "ConnectionHello") => Err("hello-after-accept".to_string()),
        (Channel::Control, "AttachControlLeg") => {
            let msg: AttachControlLeg =
                serde_json::from_str(text).map_err(|e| format!("attach-control:{e}"))?;
            attach_control(state, leg, set, msg);
            Ok(false)
        }
        (Channel::Control, "DeclareDemand") => {
            let msg: DeclareDemand =
                serde_json::from_str(text).map_err(|e| format!("declare-demand:{e}"))?;
            let effects = {
                let mut reg = state.registry.lock().unwrap();
                reg.activations.declare_demand(leg, msg)
            };
            perform(state, effects);
            Ok(false)
        }
        (Channel::Control, "ClaimGeometry") => {
            let msg: ClaimGeometry =
                serde_json::from_str(text).map_err(|e| format!("claim-geometry:{e}"))?;
            let decision = {
                let mut reg = state.registry.lock().unwrap();
                reg.activations.claim_geometry(leg, msg)
            };
            handle_geometry(state, leg, decision);
            Ok(false)
        }
        (Channel::Control, "TransferGeometry") => {
            let msg: TransferGeometry =
                serde_json::from_str(text).map_err(|e| format!("transfer-geometry:{e}"))?;
            let decision = {
                let mut reg = state.registry.lock().unwrap();
                reg.activations.transfer_geometry(leg, msg)
            };
            handle_geometry(state, leg, decision);
            Ok(false)
        }
        (Channel::Control, "ReleaseGeometry") => {
            let msg: ReleaseGeometry =
                serde_json::from_str(text).map_err(|e| format!("release-geometry:{e}"))?;
            // No engine round-trip: the holder yields the seat cell-side.
            let effects = {
                let mut reg = state.registry.lock().unwrap();
                reg.activations.release_geometry(leg, msg)
            };
            perform(state, effects);
            Ok(false)
        }
        (Channel::Frames, "AttachFramesLeg") => {
            let msg: AttachFramesLeg =
                serde_json::from_str(text).map_err(|e| format!("attach-frames:{e}"))?;
            attach_frames(state, leg, set, msg);
            Ok(false)
        }
        (Channel::Frames, "TransportCredit") => {
            let msg: TransportCredit =
                serde_json::from_str(text).map_err(|e| format!("credit:{e}"))?;
            let effects = {
                let mut reg = state.registry.lock().unwrap();
                reg.activations.credit_returned(leg.connection_id, &msg)
            };
            perform(state, effects);
            Ok(false)
        }
        (Channel::Frames, "SceneApplied") => {
            let msg: SceneApplied =
                serde_json::from_str(text).map_err(|e| format!("scene-applied:{e}"))?;
            let effects = {
                let mut reg = state.registry.lock().unwrap();
                reg.activations.scene_applied(leg, msg, unix_ms())
            };
            perform(state, effects);
            Ok(false)
        }
        (Channel::Frames, "CalibrationPing") => {
            let ping: CalibrationPing =
                serde_json::from_str(text).map_err(|e| format!("calibration:{e}"))?;
            // The echo rides the frames leg as a `calibration` unit (no
            // activation: it is the connection's clock exchange). t1 = receive,
            // t2 = send, cell clock ms (f64 for sub-ms).
            let t1 = unix_ms_f64();
            let header = json!({
                "creditEpoch": leg.leg_generation,
                "activationSequence": 0,
                "sessionId": "-",
                "activationId": "-",
                "leaseEpoch": 0,
                "kind": "calibration",
                "calibration": { "sequence": ping.sequence, "t0": ping.t0, "t1": t1, "t2": unix_ms_f64() },
            });
            let _ = leg
                .out
                .send(Outbound::Binary(encode_envelope(&header, &[])));
            Ok(true)
        }
        (_, other) if inbound_tags(channel).contains(&other) => {
            // Defensive: a tag the contract lists for this leg but no arm above
            // serves. Every current tag IS served (S3c closed the geometry verbs),
            // so this fires only if a new tag joins `inbound_tags` without a handler.
            Err(format!("unsupported:{other}"))
        }
        (_, other) => Err(format!("unknown-type:{other}")),
    }
}

fn unix_ms_f64() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn refuse_attach(leg: &LegRef, activation_id: String, code: &str, retryable: bool) {
    leg.send_text(tagged(
        "AttachRefused",
        &AttachRefused {
            activation_id: Some(activation_id),
            code: code.to_string(),
            retryable,
        },
    ));
}

/// `AttachControlLeg`: verify the attach grant (a failure is ONE structured
/// `GRANT_INVALID`, the precise code in the audit line), admit its generation
/// against the attach high-water, then let the table decide.
fn attach_control(state: &Arc<DoorState>, leg: &LegRef, set: &SetIdentity, msg: AttachControlLeg) {
    let now = unix_ms();
    let claims = match state.config.verifier.verify_attach(&msg.attach_grant, now) {
        Ok(c) => c,
        Err(failure) => {
            tracing::info!(
                event = "field_native.tp.attach.refused",
                component = "terminal",
                code = "GRANT_INVALID",
                detail = %failure,
                connection_set_id = %set.connection_set_id,
                activation_id = %msg.activation_id,
                "an attach grant did not verify"
            );
            refuse_attach(leg, msg.activation_id, "GRANT_INVALID", false);
            return;
        }
    };
    let session_known = state.config.source.session(&claims.session_id).is_some();
    let effects = {
        let mut reg = state.registry.lock().unwrap();
        if !reg.ledger.accept_attach_generation(
            &claims.client_id,
            &claims.session_id,
            claims.grant_generation,
            now,
        ) {
            vec![Effect::Send(
                leg.clone(),
                tagged(
                    "AttachRefused",
                    &AttachRefused {
                        activation_id: Some(msg.activation_id.clone()),
                        code: "GRANT_GENERATION_ROLLBACK".to_string(),
                        retryable: false,
                    },
                ),
            )]
        } else {
            reg.activations.attach_control(AttachControlInput {
                now_ms: now,
                set,
                leg,
                msg,
                claims,
                session_known,
            })
        }
    };
    perform(state, effects);
}

fn attach_frames(state: &Arc<DoorState>, leg: &LegRef, set: &SetIdentity, msg: AttachFramesLeg) {
    let now = unix_ms();
    let claims = match state.config.verifier.verify_attach(&msg.attach_grant, now) {
        Ok(c) => c,
        Err(failure) => {
            tracing::info!(
                event = "field_native.tp.attach.refused",
                component = "terminal",
                code = "GRANT_INVALID",
                detail = %failure,
                connection_set_id = %set.connection_set_id,
                activation_id = %msg.activation_id,
                "an attach grant did not verify (frames leg)"
            );
            refuse_attach(leg, msg.activation_id, "GRANT_INVALID", false);
            return;
        }
    };
    let session = state.config.source.session(&claims.session_id);
    let trf_identity = session.as_ref().map(|s| {
        let handle = s.summary().handle;
        TrfIdentity {
            session_handle: handle.clone(),
            view_handle: handle,
        }
    });
    let session_epoch = session.as_ref().map(|s| s.session_epoch()).unwrap_or(0);
    let resume_token = hex::encode(rand::random::<[u8; 16]>());
    let effects = {
        let mut reg = state.registry.lock().unwrap();
        reg.activations.attach_frames(AttachFramesInput {
            set,
            leg,
            msg,
            claims,
            trf_identity,
            resume_token,
            session_epoch,
        })
    };
    perform(state, effects);
}

/// A geometry verb the table authorized (`GeometryDecision::Proceed`): run the
/// engine op OUTSIDE the registry lock (the table is pure — it never touches the
/// session), then `geometry_finalize` commits or refuses the lease. A refuse
/// decision needs no engine call. Lock order is registry → ghosttea authority;
/// ghosttea is a leaf and never re-enters this code, so the two never deadlock.
fn handle_geometry(state: &Arc<DoorState>, leg: &LegRef, decision: GeometryDecision) {
    let proceed = match decision {
        GeometryDecision::Refuse(effects) => {
            perform(state, effects);
            return;
        }
        GeometryDecision::Proceed(proceed) => proceed,
    };
    let outcome = match state.config.source.session(&proceed.session_id) {
        Some(session) => perform_geometry_op(&session, &proceed),
        None => GeometryOutcome::EngineRefused,
    };
    let effects = {
        let mut reg = state.registry.lock().unwrap();
        reg.activations.geometry_finalize(leg, proceed, outcome)
    };
    perform(state, effects);
}

/// Commit the resize on the engine. A `Claim` establishes (or, for a transfer,
/// re-establishes) the controller and returns ghosttea's freshly minted control
/// epoch; a `Resize` reuses the held epoch. Both are fenced by the claimant
/// view's attachment epoch — a superseded incarnation cannot resize.
fn perform_geometry_op(session: &Session, proceed: &GeometryProceed) -> GeometryOutcome {
    match &proceed.op {
        GeometryOp::Claim { cols, rows } => match session.claim_control_checked(
            &proceed.ghosttea_view_id,
            &proceed.client_id,
            proceed.attachment_epoch,
            *cols,
            *rows,
            None,
        ) {
            Ok(ControlClaim::Granted(changed)) => GeometryOutcome::Claimed {
                control_epoch: changed.controller.control_epoch,
                cols: changed.cols,
                rows: changed.rows,
            },
            _ => GeometryOutcome::EngineRefused,
        },
        GeometryOp::Resize {
            control_epoch,
            resize_sequence,
            cols,
            rows,
        } => match session.resize_view_checked(
            &proceed.ghosttea_view_id,
            &proceed.client_id,
            proceed.attachment_epoch,
            *control_epoch,
            *resize_sequence,
            *cols,
            *rows,
        ) {
            Ok(_) => GeometryOutcome::Resized {
                cols: *cols,
                rows: *rows,
            },
            Err(_) => GeometryOutcome::EngineRefused,
        },
    }
}

fn deregister(state: &DoorState, connection_set_id: &str, channel: Channel, connection_id: u64) {
    let mut reg = state.registry.lock().unwrap();
    if let Some(set) = reg.sets.get_mut(connection_set_id) {
        let mine = set
            .legs
            .get(&channel)
            .is_some_and(|l| l.connection_id == connection_id);
        if mine {
            set.legs.remove(&channel);
        }
        if set.legs.is_empty() {
            // The set's leg table goes; its high-water stays in the ledger
            // (the tombstone rule), and a new leg recreates the table.
            reg.sets.remove(connection_set_id);
        }
    }
}

/// The silent class: `1008`, NO body, NO code on the wire; the code and detail
/// go to the audit line only. Never the grant, never a claim value.
async fn refuse_silently(
    ws: &mut Ws,
    guard: &mut PreAuthGuard,
    failure: &PreAuthFailure,
    origin: &Option<String>,
    channel: Option<Channel>,
) {
    guard.release();
    tracing::warn!(
        event = "field_native.tp.door.refused_pre_auth",
        component = "terminal",
        code = failure.code.as_str(),
        detail = %failure.detail,
        origin = origin.as_deref().unwrap_or("-"),
        channel = channel.map(Channel::as_str).unwrap_or("-"),
        "a T1 door refused a socket before authentication"
    );
    let _ = close_with(ws, close::POLICY_PRE_AUTH, "").await;
}

/// The structured class: the grant verified but the request cannot be
/// honoured — `ConnectionRefused {code, retryable}` then a close naming it.
async fn refuse_structured(
    ws: &mut Ws,
    refusal: TransportRefusal,
    connection_set_id: &str,
    channel: Channel,
) {
    tracing::info!(
        event = "field_native.tp.door.refused",
        component = "terminal",
        code = refusal.as_str(),
        retryable = refusal.retryable(),
        connection_set_id = %connection_set_id,
        channel = channel.as_str(),
        "a T1 door refused a verified grant"
    );
    let body = ConnectionRefused {
        code: refusal.as_str().to_string(),
        retryable: refusal.retryable(),
    };
    let _ = ws
        .send(Message::Text(tagged("ConnectionRefused", &body).into()))
        .await;
    let _ = close_with(ws, 1000, refusal.as_str()).await;
}

/// Send a close frame and let the close handshake finish (bounded), so the
/// peer reads OUR code rather than a dropped socket's 1006.
async fn close_with(ws: &mut Ws, code: u16, reason: &str) -> Result<()> {
    let frame = CloseFrame {
        code: CloseCode::from(code),
        reason: reason.to_string().into(),
    };
    let _ = ws.close(Some(frame)).await;
    let drain = async {
        while let Some(next) = ws.next().await {
            if next.is_err() {
                break;
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_millis(500), drain).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// §8, TP-S3d — the writer's priority invariant: an urgent unit jumps EVERY
    /// queued bulk chunk, and each lane stays FIFO. This is the bulk-induced-HOL
    /// floor at the scheduler: a background transfer never delays an urgent
    /// incremental that is already queued.
    #[test]
    fn the_writer_drains_urgent_before_any_bulk_and_fifo_within_each_lane() {
        let mut urgent: VecDeque<Outbound> = VecDeque::new();
        let mut bulk: VecDeque<Vec<u8>> = VecDeque::new();

        // A transfer's chunks are queued (bulk) with an urgent incremental in the
        // MIDDLE — exactly the head-of-line case.
        enqueue(Outbound::Bulk(b"a-begin".to_vec()), &mut urgent, &mut bulk);
        enqueue(Outbound::Bulk(b"a-chunk1".to_vec()), &mut urgent, &mut bulk);
        enqueue(
            Outbound::Binary(b"b-urgent".to_vec()),
            &mut urgent,
            &mut bulk,
        );
        enqueue(Outbound::Bulk(b"a-chunk2".to_vec()), &mut urgent, &mut bulk);
        enqueue(Outbound::Text("ctrl".into()), &mut urgent, &mut bulk);

        let mut order: Vec<Vec<u8>> = Vec::new();
        loop {
            match pick_next(&mut urgent, &mut bulk) {
                Pick::Urgent(Outbound::Binary(b)) => order.push(b),
                Pick::Urgent(Outbound::Text(t)) => order.push(t.into_bytes()),
                Pick::Urgent(other) => panic!("unexpected urgent {other:?}"),
                Pick::Bulk(b) => order.push(b),
                Pick::Idle => break,
            }
        }

        // urgent lane first (FIFO: the binary, then the control text), THEN the
        // bulk lane in FIFO order.
        assert_eq!(
            order,
            vec![
                b"b-urgent".to_vec(),
                b"ctrl".to_vec(),
                b"a-begin".to_vec(),
                b"a-chunk1".to_vec(),
                b"a-chunk2".to_vec(),
            ],
        );
    }
}
