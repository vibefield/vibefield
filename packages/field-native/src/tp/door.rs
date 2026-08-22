//! The cell's two T1 doors (terminal-pipeline-v3 §8 "door hygiene", §5.1 the
//! handshake, the contracts' CONNECTION_LEG machine): one ephemeral loopback
//! TCP port, two WebSocket paths — `/control` and `/frames` — accepted,
//! authenticated and kept alive here. TP-S3a scope: connection layer ONLY.
//!
//! Per socket, in order: the Origin allow-list at the HTTP upgrade → the
//! pre-auth caps (a hello deadline, a byte cap, a connection cap) → the FIRST
//! frame must be a tagged `ConnectionHello` whose channel matches the path →
//! the transport grant verifies (the silent class closes `1008` with NO body;
//! the reason is the audit line) → the ledger admits it (the structured class
//! answers `ConnectionRefused` and closes) → `ConnectionAccepted` (frames: a
//! credit epoch + the MIN of advertised and cell windows) → the leg lives while
//! `LegHeartbeat`s arrive within `heartbeatTtlMs`, and dies `4004` otherwise.
//! A higher-generation (or newer equal-generation) grant supersedes the
//! channel's live leg, which closes `4002`. Shutdown closes every leg `1001`.
//!
//! Not here yet (S3b+): session attaches, activations, frames, credits — any
//! such message on an accepted leg is an honest `4003 PROTOCOL` close naming
//! `unsupported-at-s3a:<type>`. `STALE_ROUTE`/`FENCED` closes exist as signals
//! the cell will raise when custody tells it so (TC-S6).
//!
//! Concurrency: one tokio task per socket; one registry behind a std Mutex with
//! short, await-free critical sections; superseding or shutting a leg down is a
//! message to its task, never a cross-task socket write.

use super::grant::{Channel, GrantVerifier, PreAuthFailure, PreAuthFailureCode};
use super::ledger::{CurrentLeg, TransportLedger, TransportRefusal};
use super::unix_ms;
use super::wire::{
    capability_intersection, inbound_tags, select_version, tagged, ConnectionAccepted,
    ConnectionHello, ConnectionRefused, LegHeartbeat, LegHeartbeatAck, ProtocolLimits,
    ReceiverCapacities, Tagged,
};
use crate::registries::terminal_pipeline as tp;
use crate::registries::terminal_pipeline_close_codes as close;
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

/// Everything the door needs, with the registries' numbers as defaults.
#[derive(Debug, Clone)]
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
        }
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
}

struct DoorState {
    config: DoorConfig,
    registry: Mutex<Registry>,
}

/// A read-only view for tests and diagnostics — ids, generations, counts;
/// never a grant, a key or a nonce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoorSnapshot {
    pub sets: Vec<SetSnapshot>,
    pub pre_auth_connections: usize,
    /// (transport high-waters, attach high-waters, nonces)
    pub ledger_sizes: (usize, usize, usize),
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
}

impl Door {
    /// Bind `127.0.0.1:0` and start accepting. The URLs are the cell's
    /// `CellEndpointSet` for the route row.
    pub async fn serve(config: DoorConfig) -> Result<Door> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .context("bind the T1 door on loopback")?;
        let port = listener.local_addr().context("door local address")?.port();
        let state = Arc::new(DoorState {
            config,
            registry: Mutex::new(Registry {
                ledger: TransportLedger::default(),
                sets: HashMap::new(),
                pre_auth_connections: 0,
                next_connection_id: 1,
                closed: false,
            }),
        });
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
    }
}

type Ws = WebSocketStream<TcpStream>;

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
    // Count this socket as pre-auth from the first byte; the guard releases it
    // unless acceptance disarms the guard first.
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

    let initial_windows = (channel == Channel::Frames).then(|| {
        hello
            .receiver_capacities
            .map(|advertised| advertised.min_with(state.config.cell_caps))
            .unwrap_or(state.config.cell_caps)
    });
    let accepted = ConnectionAccepted {
        selected_protocol_version: version,
        connection_set_id: claims.connection_set_id.clone(),
        channel,
        leg_generation,
        heartbeat_ttl_ms: state.config.heartbeat_ttl.as_millis() as u64,
        // §8 law (4): the credit epoch IS the frames-leg generation.
        credit_epoch: (channel == Channel::Frames).then_some(leg_generation),
        initial_windows,
        protocol_limits: state.config.protocol_limits,
        capabilities: capability_intersection(&hello.capabilities),
    };
    if ws
        .send(Message::Text(
            tagged("ConnectionAccepted", &accepted).into(),
        ))
        .await
        .is_err()
    {
        deregister(&state, &claims.connection_set_id, channel, connection_id);
        return;
    }
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

    // The accepted leg: heartbeats in, acks out, a receipt deadline, closes by signal.
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
            incoming = ws.next() => {
                match incoming {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break (0, String::new()),
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                    Some(Ok(Message::Binary(_))) => break (close::PROTOCOL, "PROTOCOL:binary-inbound".to_string()),
                    Some(Ok(Message::Text(text))) => {
                        match handle_text(text.as_str(), channel, &claims.connection_set_id, leg_generation) {
                            Ok(Some(ack)) => {
                                if ws.send(Message::Text(ack.into())).await.is_err() {
                                    break (0, String::new());
                                }
                                deadline.as_mut().reset(tokio::time::Instant::now() + ttl);
                            }
                            Ok(None) => {}
                            Err(reason) => break (close::PROTOCOL, format!("PROTOCOL:{reason}")),
                        }
                    }
                }
            }
        }
    };
    deregister(&state, &claims.connection_set_id, channel, connection_id);
    if outcome.0 != 0 {
        let _ = close_with(&mut ws, outcome.0, &outcome.1).await;
    }
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

/// One inbound text frame on an ACCEPTED leg. `Ok(Some(reply))` sends a reply
/// and re-arms the deadline; `Ok(None)` is silence; `Err(reason)` is a PROTOCOL
/// close naming the reason.
fn handle_text(
    text: &str,
    channel: Channel,
    connection_set_id: &str,
    leg_generation: u64,
) -> Result<Option<String>, String> {
    let tag: Tagged = serde_json::from_str(text).map_err(|_| "untagged".to_string())?;
    match tag.message_type.as_str() {
        "LegHeartbeat" => {
            let hb: LegHeartbeat =
                serde_json::from_str(text).map_err(|e| format!("heartbeat:{e}"))?;
            if hb.connection_set_id != connection_set_id
                || hb.channel != channel
                || hb.leg_generation != leg_generation
            {
                return Err("heartbeat-identity".to_string());
            }
            Ok(Some(tagged(
                "LegHeartbeatAck",
                &LegHeartbeatAck {
                    sequence: hb.sequence,
                },
            )))
        }
        "ConnectionHello" => Err("hello-after-accept".to_string()),
        other if inbound_tags(channel).contains(&other) => {
            // Honest about the slice: the message is known, the door is S3a.
            Err(format!("unsupported-at-s3a:{other}"))
        }
        other => Err(format!("unknown-type:{other}")),
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
