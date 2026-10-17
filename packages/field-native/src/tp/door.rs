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
//! the cell owns the seat, ghosttea commits the resize; see `handle_geometry`;
//! a `TransferGeometry` to the caller itself is DS-4's TAKE, authorized in
//! `ActivationTable::transfer_geometry` and carried here unchanged; since item
//! 42, every change of a seat — and an attach onto a `geometry-events` leg —
//! sends `GeometryState`, which the table returns as ordinary effects);
//! frames — `AttachFramesLeg`, `TransportCredit`, `SceneApplied`,
//! `CalibrationPing` (echoed as a `calibration` unit; doubles as the frames
//! heartbeat). Where the sessions come from is the `SessionSource` (source.rs):
//! production installs G22's shared `ServiceSessions`; focused harnesses may
//! install `DirectSessions` or the empty connection-only source.
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
//! leg down is a message to its read task. A geometry verb also holds its
//! SESSION's gate across its precheck, engine op and finalize (DS-4d,
//! `GeometryGates`), so verbs of one session never interleave; the engine op
//! itself stays outside the registry lock.

use super::activation::{
    ActivationTable, AttachControlInput, AttachFramesInput, Effect, GeometryDecision, GeometryOp,
    GeometryOutcome, GeometryProceed, InputDecision, InputProceed, LegRef, Outbound, SetIdentity,
    UnitClass,
};
use super::grant::{Channel, GrantVerifier, PreAuthFailure, PreAuthFailureCode};
use super::ledger::{CurrentLeg, TransportLedger, TransportRefusal};
use super::presentation::{spawn_pump, Admission, PumpHandle, PumpHost, PumpStart};
use super::source::{NoSessions, SessionSource};
use super::unix_ms;
use super::wire::{
    capability_intersection, encode_envelope, inbound_tags, select_version, tagged,
    AttachControlLeg, AttachFramesLeg, AttachRefused, CalibrationPing, ClaimGeometry,
    ConnectionAccepted, ConnectionHello, ConnectionRefused, DeclareDemand, InputOp, LegHeartbeat,
    LegHeartbeatAck, ProtocolLimits, ReceiverCapacities, ReleaseGeometry, SceneApplied, SendInput,
    SessionEvent, SessionEventKind, Tagged, TransferGeometry, TransportCredit, TrfIdentity,
    GEOMETRY_EVENTS_CAPABILITY, SESSION_EVENTS_CAPABILITY,
};
use crate::registries::terminal_pipeline as tp;
use crate::registries::terminal_pipeline_close_codes as close;
use anyhow::{Context, Result};
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use ghosttea::{ControlClaim, Session, SessionLifecycleEvent, ViewAccess};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError, Weak};
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
    /// TP-S3b/G22 — where sessions come from (`ServiceSessions` in production,
    /// `DirectSessions` in activation harnesses, `NoSessions` by default for
    /// connection-only tests).
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
    /// TP-S3f/G24: the hello negotiated `session-events` (control legs only —
    /// the lifecycle fan-out addresses entries through the registry).
    session_events: bool,
    /// The leg's writer channel — the same one its writer task drains.
    out: mpsc::UnboundedSender<Outbound>,
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

/// DS-4d — one geometry verb per session at a time. A verb's three steps — the
/// table's precheck (under the registry lock), the engine op (outside it: a PTY
/// resize must never hold every session's registry) and `geometry_finalize`
/// (under it again) — run inside the session's gate, so two verbs of one
/// session never interleave in the cell. Before it, the engine op of one verb
/// could land between another verb's precheck and its finalize: two takes at
/// once committed one holder in the lease and left the ENGINE's controller with
/// the other (last writer wins), and the holder's every resize then read
/// `VIEW_SUPERSEDED`. Now the second verb prechecks against the first's commit
/// and is refused with the seat as it is — the holder and revision its runtime
/// retries on. Only the table's own auto-releases (detach, leg loss, grant
/// expiry, a renewal dropping `geometry`) still move a seat under a verb, and
/// they only ever EMPTY it (finalize's revision CAS). Lock order: gate →
/// registry → ghosttea authority; nothing that holds the registry takes a gate.
/// A gate lives only while a verb holds or awaits it.
#[derive(Default)]
struct GeometryGates {
    gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl GeometryGates {
    fn run<R>(&self, session_id: &str, verb: impl FnOnce() -> R) -> R {
        let gate = self
            .gates
            .lock()
            .unwrap()
            .entry(session_id.to_string())
            .or_default()
            .clone();
        let result = {
            // the gate guards no data: a verb that panicked leaves nothing torn
            let _held = gate.lock().unwrap_or_else(PoisonError::into_inner);
            verb()
        };
        let mut gates = self.gates.lock().unwrap();
        // every clone is taken under the map lock, so the map's and ours alone
        // means no other verb holds or awaits this gate
        if Arc::strong_count(&gate) == 2 {
            gates.remove(session_id);
        }
        result
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.gates.lock().unwrap().len()
    }
}

struct DoorState {
    config: DoorConfig,
    registry: Mutex<Registry>,
    /// DS-4d — the per-session gate every geometry verb runs inside
    geometry_gates: GeometryGates,
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
    /// TP-S3f/G24: the lifecycle fan-out — present only when the source has a
    /// bus (`NoSessions` has none, and then the cell never emits the verb).
    lifecycle_task: Option<tokio::task::JoinHandle<()>>,
}

/// TP-S3f/G24 — project one engine lifecycle fact onto the wire verb, or None.
/// `Created` is deliberately None: births reach a client through the roster
/// read it already performs, and an `updated` for a session no client knows
/// would be noise the renderer ignores anyway.
fn session_event_of(event: &SessionLifecycleEvent) -> Option<SessionEventKind> {
    match event {
        SessionLifecycleEvent::Created { .. } => None,
        SessionLifecycleEvent::Exited { session_id, exit } => Some(SessionEventKind::Exited {
            session_id: session_id.clone(),
            exit_code: exit.exit_code,
            exit_signal: exit.exit_signal.clone(),
            requested_termination: exit.requested_termination,
            exit_outcome: exit.exit_outcome,
        }),
        SessionLifecycleEvent::Removed { session_id } => Some(SessionEventKind::Removed {
            session_id: session_id.clone(),
        }),
    }
}

/// Send one `SessionEvent` to every accepted control leg that negotiated the
/// `session-events` capability. Connection-scoped by design (spec §5.4): a
/// client tracks sessions it never attached (the deck roster, dormant panes),
/// so the death of ANY session is every negotiated client's business. A
/// closed leg's send fails silently — its entry leaves the registry with it.
fn fan_out_session_event(state: &DoorState, event: SessionEventKind) {
    let text = tagged("SessionEvent", &SessionEvent { event });
    let reg = state.registry.lock().unwrap();
    for set in reg.sets.values() {
        if let Some(entry) = set.legs.get(&Channel::Control) {
            if entry.session_events {
                let _ = entry.out.send(Outbound::Text(text.clone()));
            }
        }
    }
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
            geometry_gates: GeometryGates::default(),
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
                    reg.activations.prune_model_generations(|session_id| {
                        tick_state.config.source.session(session_id).is_some()
                    });
                    reg.activations.tick(unix_ms())
                };
                perform(&tick_state, effects);
            }
        });
        // TP-S3f/G24: subscribe BEFORE serving so no death between bind and
        // the first accept can slip past the bus un-witnessed. A `Lagged`
        // receiver answers with the honest `resync` notice, never a guess.
        let lifecycle_task = state.config.source.subscribe_lifecycle().map(|mut rx| {
            let lifecycle_state = state.clone();
            tokio::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(event) => {
                            if let Some(wire) = session_event_of(&event) {
                                fan_out_session_event(&lifecycle_state, wire);
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(dropped)) => {
                            tracing::warn!(
                                event = "field_native.tp.door.session_events_lagged",
                                component = "terminal",
                                dropped,
                                "the lifecycle receiver lagged; clients told to resync"
                            );
                            fan_out_session_event(&lifecycle_state, SessionEventKind::Resync);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            })
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
            lifecycle_task,
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
    ///
    /// **UNBUILT as of 2026-09-14 (N-M3): `LegClose::StaleRoute` (4000) has NO
    /// PRODUCTION CALLER.** This method is the only place that raises it and its
    /// only callers are in `tests/tp_door.rs`. The kit implements the recovery
    /// (4000 -> re-ticket) and `contracts/registries.ts` cites it under
    /// `TERMINAL_CELLS_SERVE` as the reason cell-route churn is survivable, so
    /// the claim reads as built from both ends. It is not.
    ///
    /// AND IT CANNOT BE WIRED HERE WITHOUT A NEW SEAM, which is why this is a
    /// note rather than a fix:
    ///   1. a cell has no inbound route channel at all. Its stdin carries one
    ///      bootstrap line and is then a LEASH whose reader discards every byte
    ///      until EOF (`cell.rs`), and the floor's route snapshot is the FLOOR's
    ///      view of its cells — nothing carries it the other way;
    ///   2. the event that actually invalidates a route is fieldd's
    ///      remove-then-add of the serve, forced by truffle offering no proxy
    ///      update (the same `registries.ts` comment says so). That happens in
    ///      the SIDECAR and tears the TCP connections down itself;
    ///   3. so by the time a cell could know, the socket a 4000 close frame
    ///      would ride is already gone. What a routed client really observes on
    ///      route churn is a plain transport death, not a named close.
    ///
    /// Wiring it therefore means a floor -> cell route channel and a decision
    /// about which snapshot change invalidates which set — a design question,
    /// not a missing call. Until then the recovery path is exercised only by
    /// the transport-death route, and the kit's 4000 arm is dead code on this
    /// product's paths.
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

    /// `RevokeClient {clientId, beforeGeneration}` (F1, the floor relaying the freeway host's
    /// revoke): the ledger refuses the client's grants below `before_generation` on every set and
    /// session, and its activations end `right-revoked`. Its legs stay; nothing they carry can
    /// attach again.
    pub fn revoke_client(&self, client_id: &str, before_generation: u64) {
        let effects = {
            let mut reg = self.state.registry.lock().unwrap();
            reg.ledger
                .revoke_client(client_id, before_generation, unix_ms());
            reg.activations.revoke_client(client_id)
        };
        perform(&self.state, effects);
    }

    /// Stop accepting, close every leg `1001`, and give the close frames a
    /// bounded moment to leave. Idempotent.
    pub async fn shutdown(&self) {
        self.accept_task.abort();
        self.tick_task.abort();
        if let Some(task) = &self.lifecycle_task {
            task.abort();
        }
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
        if let Some(task) = &self.lifecycle_task {
            task.abort();
        }
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
                    // item 42 — a detached view that held the geometry seat
                    // released it; the empty seat's announcement rides the
                    // next batch, like the view attach's own follow-ups
                    let released = state
                        .registry
                        .lock()
                        .unwrap()
                        .activations
                        .view_detached(&activation_id);
                    effects.extend(released);
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
        let Some(scene_epoch) = a.scene_epoch.clone() else {
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
            scene_epoch,
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
    // The leg's writer channel exists BEFORE admission so the registry entry
    // can carry a sender: TP-S3f's lifecycle fan-out addresses accepted
    // control legs through the registry, never through the leg task. Enqueues
    // buffer until the writer task below starts draining the same channel.
    let (out_tx, out_rx) = mpsc::unbounded_channel::<Outbound>();
    let negotiated_capabilities = capability_intersection(&hello.capabilities);
    let session_events = channel == Channel::Control
        && negotiated_capabilities
            .iter()
            .any(|c| c == SESSION_EVENTS_CAPABILITY);
    // item 42 — the same negotiation for the seat's announcement. It rides the
    // leg's `LegRef` rather than this registry entry: `GeometryState` is
    // activation-scoped, addressed through the table's `Activation::control`,
    // where `SessionEvent`'s connection-scoped fan-out walks the registry.
    let geometry_events = channel == Channel::Control
        && negotiated_capabilities
            .iter()
            .any(|c| c == GEOMETRY_EVENTS_CAPABILITY);
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
                            session_events,
                            out: out_tx.clone(),
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
        geometry_events,
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
        capabilities: negotiated_capabilities,
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
    let mut lanes = Lanes::default();
    let mut disconnected = false;
    loop {
        // Pull everything currently queued into the priority lanes (non-blocking),
        // so an urgent unit that arrived during the last write jumps ahead now.
        loop {
            match rx.try_recv() {
                Ok(item) => lanes.enqueue(item),
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }
        match lanes.pick() {
            Pick::Urgent(Outbound::Text(t)) => {
                if sink.send(Message::Text(t.into())).await.is_err() {
                    break;
                }
            }
            Pick::Urgent(Outbound::Binary(b, _)) => {
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
            Pick::Urgent(bulk @ Outbound::Bulk(..)) => lanes.enqueue(bulk), // unreachable; keep total
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
                    Some(item) => lanes.enqueue(item),
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

/// The writer's priority pick: the URGENT lane drains before any bulk, and each
/// lane is FIFO. Pulled out of the writer loop so the invariant is unit-testable
/// without a socket (§8, TP-S3d — the bulk-induced-HOL floor).
enum Pick {
    Urgent(Outbound),
    Bulk(Vec<u8>),
    Idle,
}

/// A queued unit and the order it ARRIVED in — the one order both lanes share.
struct Queued<T> {
    arrival: u64,
    unit: T,
}

/// A bulk unit and the activation whose transfer it belongs to.
struct BulkUnit {
    bytes: Vec<u8>,
    activation: Arc<str>,
}

/// The writer's two lanes. Urgent passes bulk ACROSS activations only
/// (2026-10-17): an urgent unit waits while a bulk unit of its OWN activation
/// that arrived before it is still queued, and that bulk unit goes first. A
/// delta is built on the transfer ahead of it, and the worker drops a unit that
/// arrives behind a later one of its activation; the delta that overtook its
/// own catch-up froze the phone's scene for good. Other activations' urgent
/// units still pass every bulk unit, so the HOL floor holds for them.
#[derive(Default)]
struct Lanes {
    urgent: VecDeque<Queued<Outbound>>,
    bulk: VecDeque<Queued<BulkUnit>>,
    arrivals: u64,
}

impl Lanes {
    fn enqueue(&mut self, item: Outbound) {
        self.arrivals += 1;
        let arrival = self.arrivals;
        match item {
            Outbound::Bulk(bytes, activation) => self.bulk.push_back(Queued {
                arrival,
                unit: BulkUnit { bytes, activation },
            }),
            unit => self.urgent.push_back(Queued { arrival, unit }),
        }
    }

    fn pick(&mut self) -> Pick {
        // The first urgent unit no earlier bulk unit of its activation holds
        // back goes; failing that, the bulk unit the first held one waits on.
        let mut waits_on = None;
        let mut free = None;
        for (at, queued) in self.urgent.iter().enumerate() {
            match self.holding(queued) {
                None => {
                    free = Some(at);
                    break;
                }
                Some(bulk_at) => {
                    waits_on.get_or_insert(bulk_at);
                }
            }
        }
        if let Some(at) = free {
            let queued = self.urgent.remove(at).expect("an index the scan found");
            return Pick::Urgent(queued.unit);
        }
        match self.bulk.remove(waits_on.unwrap_or(0)) {
            Some(queued) => Pick::Bulk(queued.unit.bytes),
            None => Pick::Idle,
        }
    }

    /// The earliest bulk unit of `queued`'s own activation that arrived before
    /// it, if one is still queued. A unit of no activation is never held.
    fn holding(&self, queued: &Queued<Outbound>) -> Option<usize> {
        let Outbound::Binary(_, Some(activation)) = &queued.unit else {
            return None;
        };
        self.bulk
            .iter()
            .position(|b| b.arrival < queued.arrival && b.unit.activation == *activation)
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
            let session_id = msg.session_id.clone();
            handle_geometry(state, leg, &session_id, |table, now| {
                table.claim_geometry(leg, msg, now)
            });
            Ok(false)
        }
        (Channel::Control, "TransferGeometry") => {
            let msg: TransferGeometry =
                serde_json::from_str(text).map_err(|e| format!("transfer-geometry:{e}"))?;
            let session_id = msg.session_id.clone();
            handle_geometry(state, leg, &session_id, |table, now| {
                table.transfer_geometry(leg, msg, now)
            });
            Ok(false)
        }
        (Channel::Control, "ReleaseGeometry") => {
            let msg: ReleaseGeometry =
                serde_json::from_str(text).map_err(|e| format!("release-geometry:{e}"))?;
            // No engine round-trip: the holder yields the seat cell-side — still
            // inside the session's gate, so it lands before or after a verb in
            // flight, never between its precheck and its finalize (DS-4d).
            let session_id = msg.session_id.clone();
            let effects = state.geometry_gates.run(&session_id, || {
                let mut reg = state.registry.lock().unwrap();
                reg.activations.release_geometry(leg, msg)
            });
            perform(state, effects);
            Ok(false)
        }
        (Channel::Control, "SendInput") => {
            let msg: SendInput =
                serde_json::from_str(text).map_err(|e| format!("send-input:{e}"))?;
            let now = unix_ms();
            let decision = {
                let reg = state.registry.lock().unwrap();
                reg.activations.send_input(leg, &msg, now)
            };
            handle_input(state, &msg, decision);
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
                .send(Outbound::Binary(encode_envelope(&header, &[]), None));
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

/// One geometry verb, start to finish, inside its session's gate (DS-4d):
/// `decide` is the table's precheck, run under the registry lock — and, when it
/// authorizes a CLAIM, the engine's control revision is read under that same
/// lock, beside the lease state the precheck judged; the engine op runs OUTSIDE
/// the registry lock (the table is pure — it never touches the session) as a
/// compare-and-set on that revision; `geometry_finalize` commits or refuses.
/// A refuse decision needs no engine call. Lock order: gate → registry →
/// ghosttea authority; ghosttea is a leaf and never re-enters this code.
fn handle_geometry(
    state: &Arc<DoorState>,
    leg: &LegRef,
    session_id: &str,
    decide: impl FnOnce(&mut ActivationTable, u64) -> GeometryDecision,
) {
    let effects = state.geometry_gates.run(session_id, || {
        let session = state.config.source.session(session_id);
        let (decision, expected_control_revision) = {
            let mut reg = state.registry.lock().unwrap();
            let decision = decide(&mut reg.activations, unix_ms());
            let expected = match (&decision, &session) {
                (GeometryDecision::Proceed(proceed), Some(session))
                    if matches!(proceed.op, GeometryOp::Claim { .. }) =>
                {
                    Some(session.control_snapshot().control_revision)
                }
                _ => None,
            };
            (decision, expected)
        };
        let proceed = match decision {
            GeometryDecision::Refuse(effects) => return effects,
            GeometryDecision::Proceed(proceed) => proceed,
        };
        let outcome = match &session {
            Some(session) => perform_geometry_op(session, &proceed, expected_control_revision),
            None => GeometryOutcome::EngineRefused,
        };
        // the clock read AFTER the engine op: a grant that lapsed meanwhile is
        // what the finalize's destination re-check is for
        let now = unix_ms();
        let mut reg = state.registry.lock().unwrap();
        reg.activations
            .geometry_finalize(leg, proceed, outcome, now)
    });
    perform(state, effects);
}

/// Commit the resize on the engine. A `Claim` establishes (or, for a transfer,
/// re-establishes) the controller and returns ghosttea's freshly minted control
/// epoch; a `Resize` reuses the held epoch. Both are fenced by the claimant
/// view's attachment epoch — a superseded incarnation cannot resize.
///
/// DS-4d — a `Claim` is a compare-and-set on `expected_control_revision`, the
/// engine's control revision as the door read it beside the precheck (always
/// `Some` for a claim). The gate keeps every other verb of this cell out of
/// the window, so a miss means the engine moved for a reason the lease did not
/// see — a view detached under the seat, or a claim on ghosttea's own client
/// plane (`ServiceSessions` is shared) — and the claim is refused rather than
/// overwriting a controller the lease never read (before DS-4d it was `None`,
/// last writer wins). A `Resize` needs no revision: ghosttea fences it on the
/// holder's own control epoch.
fn perform_geometry_op(
    session: &Session,
    proceed: &GeometryProceed,
    expected_control_revision: Option<u64>,
) -> GeometryOutcome {
    match &proceed.op {
        GeometryOp::Claim { cols, rows } => match session.claim_control_checked(
            &proceed.ghosttea_view_id,
            &proceed.client_id,
            proceed.attachment_epoch,
            *cols,
            *rows,
            expected_control_revision,
        ) {
            Ok(ControlClaim::Granted(changed)) => GeometryOutcome::Claimed {
                control_epoch: changed.controller.control_epoch,
                cols: changed.cols,
                rows: changed.rows,
            },
            Ok(ControlClaim::Rejected(snapshot)) => {
                tracing::info!(
                    event = "field_native.tp.geometry.engine_moved",
                    component = "terminal",
                    session_id = %proceed.session_id,
                    activation_id = %proceed.caller_activation_id,
                    expected_control_revision,
                    control_revision = snapshot.control_revision,
                    "the engine's controller moved between the precheck and the claim; refused"
                );
                GeometryOutcome::EngineRefused
            }
            Err(_) => GeometryOutcome::EngineRefused,
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

/// A `SendInput` the table ruled on. On `Proceed` the door runs the engine input
/// op OUTSIDE the registry lock — the geometry lock order (registry → ghosttea
/// authority; ghosttea is a leaf and never re-enters). A `Drop` is silent and
/// audited: §5.4 rejects disallowed input with NO wire reply, and accepted
/// input's only answer is the echo frame the pump carries. ghosttea's
/// `authorize_input` is the engine backstop — a read-only or superseded view
/// refuses there too.
fn handle_input(state: &Arc<DoorState>, msg: &SendInput, decision: InputDecision) {
    let proceed = match decision {
        InputDecision::Drop(reason) => {
            // §5.4's drop-and-AUDIT: the structural refusals are rare and must
            // be visible at the default (INFO) filter. `input-not-allowed`
            // alone stays at debug — it repeats per keystroke while a viewer
            // types into a suspended lease, and the CellActivationStatus line
            // already audits that transition once.
            if reason == "input-not-allowed" {
                tracing::debug!(
                    event = "field_native.tp.input.dropped",
                    component = "terminal",
                    reason,
                    activation_id = %msg.activation_id,
                    "a SendInput was refused cell-side"
                );
            } else {
                tracing::info!(
                    event = "field_native.tp.input.dropped",
                    component = "terminal",
                    reason,
                    activation_id = %msg.activation_id,
                    "a SendInput was refused cell-side"
                );
            }
            return;
        }
        InputDecision::Proceed(proceed) => proceed,
    };
    let Some(session) = state.config.source.session(&proceed.session_id) else {
        // the session vanished between the table read and the engine call — a
        // benign teardown race, but still a dropped input, so it audits too
        tracing::debug!(
            event = "field_native.tp.input.dropped",
            component = "terminal",
            reason = "session-vanished",
            activation_id = %msg.activation_id,
            "a SendInput was refused cell-side"
        );
        return;
    };
    if let Err(error) = perform_input_op(&session, &proceed, &msg.op) {
        tracing::info!(
            event = "field_native.tp.input.engine_refused",
            component = "terminal",
            detail = %error,
            activation_id = %msg.activation_id,
            "ghosttea refused a SendInput"
        );
    }
}

/// Map the authorized op to ghosttea's view-input family. Every method fences on
/// `authorize_input(view, client, attachment_epoch, input_sequence)`: read-only
/// refusal, stale-attachment-epoch refusal, and monotonic-sequence dedup are the
/// ENGINE's — a replayed or superseded input is a silent no-op even past the cell
/// gate. Scroll rows are signed (negative scrolls up); scroll-to is an index.
fn perform_input_op(session: &Session, proceed: &InputProceed, op: &InputOp) -> Result<()> {
    let view = &proceed.ghosttea_view_id;
    let client = &proceed.client_id;
    let epoch = proceed.attachment_epoch;
    let seq = proceed.input_sequence;
    match op {
        InputOp::Text { text } => session.send_text(view, client, epoch, seq, text.clone()),
        InputOp::Paste { text } => session.paste(view, client, epoch, seq, text.clone()),
        InputOp::Key { key } => session.key(view, client, epoch, seq, key.clone()),
        InputOp::Mouse { mouse } => session.mouse(view, client, epoch, seq, mouse.clone()),
        InputOp::Scroll { rows } => session.scroll(view, client, epoch, seq, *rows as isize),
        InputOp::ScrollTo { row } => session.scroll_to(view, client, epoch, seq, *row as usize),
        InputOp::Interrupt => session.interrupt(view, client, epoch, seq),
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

    /// DS-4d — the per-session geometry gate: a second verb of one session waits
    /// for the first; another session's verb never waits on it; a gate nobody
    /// holds or awaits is forgotten (the map does not grow with session ids).
    #[test]
    fn a_session_geometry_gate_admits_one_verb_at_a_time_and_is_forgotten_after() {
        let gates = Arc::new(GeometryGates::default());
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let first = {
            let gates = gates.clone();
            std::thread::spawn(move || {
                gates.run("s1", || {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                })
            })
        };
        entered_rx.recv().unwrap();

        // another session's verb never waits on s1's
        let mut ran = false;
        gates.run("s2", || ran = true);
        assert!(ran);

        // s1's second verb waits for its first
        let (second_tx, second_rx) = std::sync::mpsc::channel();
        let second = {
            let gates = gates.clone();
            std::thread::spawn(move || gates.run("s1", || second_tx.send(()).unwrap()))
        };
        assert!(
            second_rx.recv_timeout(Duration::from_millis(250)).is_err(),
            "s1's second verb ran inside its first"
        );
        release_tx.send(()).unwrap();
        second_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("s1's second verb runs once the first is done");
        first.join().unwrap();
        second.join().unwrap();
        assert_eq!(gates.len(), 0, "a gate nobody holds or awaits is forgotten");
    }

    /// A real session (`/bin/sh` on a PTY) for the engine-half rows below.
    #[cfg(unix)]
    fn real_session() -> Arc<Session> {
        use ghosttea::session::{Persistence, SpawnOptions};
        use ghosttea::{FrameHub, SessionEnvironment, SessionProgramKind, TextEngine};
        Session::spawn(
            SpawnOptions {
                executable: "/bin/sh".into(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                environment: Some(SessionEnvironment::Clean {
                    variables: HashMap::from([
                        ("PATH".into(), "/usr/bin:/bin".into()),
                        ("TERM".into(), "xterm".into()),
                    ]),
                }),
                cols: 80,
                rows: 24,
                persistence: Persistence::KeepUntilExit,
                program_kind: SessionProgramKind::Application,
                owner_id: None,
                scrollback_bytes: None,
            },
            FrameHub::new(8),
            Arc::new(std::sync::Mutex::new(
                TextEngine::discover().expect("a monospace font"),
            )),
            Arc::new(|_, _| {}),
        )
        .expect("spawn the session")
    }

    /// DS-4d — the ENGINE half of the take's CAS: a claim is a compare-and-set
    /// on the control revision the door read beside the precheck. When the
    /// engine's controller moved after that read — a claim on ghosttea's own
    /// client plane, a view detached under the seat — the claim is refused and
    /// the controller and the size stay as they are; at the revision as it now
    /// is, the same claim commits. (Under the old `None` the stale claim simply
    /// overwrote whatever the engine held.)
    #[cfg(unix)]
    #[tokio::test]
    async fn an_engine_claim_is_a_compare_and_set_on_the_revision_read_with_the_precheck() {
        let session = real_session();
        let epoch_a = session
            .attach_view_with_access("act-a", "win:a", ViewAccess::ReadWrite)
            .expect("view a");
        let epoch_b = session
            .attach_view_with_access("act-b", "win:b", ViewAccess::ReadWrite)
            .expect("view b");
        // what the door read beside B's precheck…
        let read = session.control_snapshot().control_revision;
        // …and then the engine moves, outside anything the lease saw
        session
            .claim_control_checked("act-a", "win:a", epoch_a, 100, 40, None)
            .expect("A's claim on the engine's own plane");
        let take = GeometryProceed {
            caller_activation_id: "act-b".into(),
            session_id: session.id(),
            client_id: "win:b".into(),
            ghosttea_view_id: "act-b".into(),
            attachment_epoch: epoch_b,
            base_revision: 0,
            claimant_view_id: "mount-b".into(),
            op: GeometryOp::Claim { cols: 90, rows: 30 },
        };
        assert!(
            matches!(
                perform_geometry_op(&session, &take, Some(read)),
                GeometryOutcome::EngineRefused
            ),
            "a claim at a stale control revision overwrote the engine's controller"
        );
        let (controller, cols, rows, _layout) = session.control_state();
        assert_eq!(controller.expect("A still seated").client_id, "win:a");
        assert_eq!((cols, rows), (100, 40), "a refused claim never resizes");

        // at the revision as it now is, the same claim commits
        let now = session.control_snapshot().control_revision;
        assert!(matches!(
            perform_geometry_op(&session, &take, Some(now)),
            GeometryOutcome::Claimed {
                cols: 90,
                rows: 30,
                ..
            }
        ));
        let (controller, cols, rows, _layout) = session.control_state();
        assert_eq!(controller.expect("B seated").client_id, "win:b");
        assert_eq!((cols, rows), (90, 30));
    }

    /// The bytes each pick would write, in the writer's order.
    fn drained(lanes: &mut Lanes) -> Vec<Vec<u8>> {
        let mut order: Vec<Vec<u8>> = Vec::new();
        loop {
            match lanes.pick() {
                Pick::Urgent(Outbound::Binary(b, _)) => order.push(b),
                Pick::Urgent(Outbound::Text(t)) => order.push(t.into_bytes()),
                Pick::Urgent(other) => panic!("unexpected urgent {other:?}"),
                Pick::Bulk(b) => order.push(b),
                Pick::Idle => return order,
            }
        }
    }

    fn bulk(bytes: &[u8], activation: &str) -> Outbound {
        Outbound::Bulk(bytes.to_vec(), Arc::from(activation))
    }

    fn urgent(bytes: &[u8], activation: &str) -> Outbound {
        Outbound::Binary(bytes.to_vec(), Some(Arc::from(activation)))
    }

    fn written(units: &[&[u8]]) -> Vec<Vec<u8>> {
        units.iter().map(|u| u.to_vec()).collect()
    }

    /// §8, TP-S3d — the writer's priority invariant: an urgent unit jumps EVERY
    /// queued bulk chunk of another activation, and each lane stays FIFO. This
    /// is the bulk-induced-HOL floor at the scheduler: a background transfer
    /// never delays an urgent incremental that is already queued.
    #[test]
    fn the_writer_drains_urgent_before_any_bulk_and_fifo_within_each_lane() {
        let mut lanes = Lanes::default();

        // A transfer's chunks are queued (bulk) with an urgent incremental in the
        // MIDDLE — exactly the head-of-line case.
        lanes.enqueue(bulk(b"a-begin", "a"));
        lanes.enqueue(bulk(b"a-chunk1", "a"));
        lanes.enqueue(urgent(b"b-urgent", "b"));
        lanes.enqueue(bulk(b"a-chunk2", "a"));
        lanes.enqueue(Outbound::Text("ctrl".into()));

        // urgent lane first (FIFO: the binary, then the control text), THEN the
        // bulk lane in FIFO order.
        assert_eq!(
            drained(&mut lanes),
            written(&[b"b-urgent", b"ctrl", b"a-begin", b"a-chunk1", b"a-chunk2"]),
        );
    }

    /// 2026-10-17 — an activation's own catch-up is not background to its own
    /// deltas. The delta queued after its activation's transfer waits for every
    /// unit of it, and that transfer goes ahead of another activation's bulk;
    /// another activation's urgent unit, and a unit of none, still pass both.
    /// James's phone: the reopen's catch-up (r3797 → r3798) was overtaken by
    /// codex's next delta, the worker dropped the catch-up's units as behind
    /// that delta in the activation's sequence, and the scene froze for good.
    #[test]
    fn an_activations_delta_never_overtakes_its_own_queued_transfer() {
        let mut lanes = Lanes::default();
        lanes.enqueue(bulk(b"c-begin", "c"));
        lanes.enqueue(bulk(b"a-begin", "a"));
        lanes.enqueue(bulk(b"a-chunk", "a"));
        lanes.enqueue(bulk(b"a-end", "a"));
        lanes.enqueue(urgent(b"a-delta", "a"));
        lanes.enqueue(urgent(b"b-urgent", "b"));
        lanes.enqueue(Outbound::Binary(b"calibration".to_vec(), None));
        assert_eq!(
            drained(&mut lanes),
            written(&[
                b"b-urgent",
                b"calibration",
                b"a-begin",
                b"a-chunk",
                b"a-end",
                b"a-delta",
                b"c-begin",
            ]),
        );

        // Only a transfer queued BEFORE a delta holds it: the delta that came
        // first still goes first, and the one after the catch-up waits for it.
        lanes.enqueue(urgent(b"a-delta-1", "a"));
        lanes.enqueue(bulk(b"a-catchup", "a"));
        lanes.enqueue(urgent(b"a-delta-2", "a"));
        assert_eq!(
            drained(&mut lanes),
            written(&[b"a-delta-1", b"a-catchup", b"a-delta-2"]),
        );
    }
}
