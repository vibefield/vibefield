//! TerminalUnit (NF-2) — ghosttea's `TerminalService` embedded as this device's
//! single PTY authority (native-floor spec §4; NF-L1: every PTY the product
//! creates lives here). The unit owns the run directory's endpoints, the
//! per-boot bearer token, the inventory it publishes to fieldd, and — since
//! NF-7 — the G7 drain handle: shutdown is upstream's `ServiceHandle::shutdown`
//! (admission stop + full-ladder drain + honest `DrainReport`), not a
//! self-client sweep.
//!
//! Health honesty, in the M2 shape:
//!   starting  — endpoints bound, service under construction (font discovery)
//!   up        — serving control + frame traffic; detail names the text engine
//!   crashed   — the serve task ended on its own; global health goes degraded
//!               with this unit named. NO in-process restart (manager law:
//!               fieldd decides whether to surface or bounce the pair).
//!   degraded  — the unit could not even be configured (see `endpoints`)
//!
//! **No `with_terminal_mesh` here.** The floor has no mesh coupling: the
//! `ghosttea` crate carries no truffle dependency, remote ops `bail!` honestly
//! without an adapter, and TSP1 mirroring is NF-remote (spec §7). That is also
//! why the unit declares no dependency on `mesh-gateway` — it is registered
//! after it only to keep design-02's start order, not because it needs it.
//!
//! ## The NF-2 upstream absences, retired at NF-7 (ghosttea 0.6.0 → 0.7.0)
//!
//! Three verified absences shaped this unit's first cut; the G7/G8/G9 petition
//! landings closed all three, and the posture flipped with them:
//!
//! 1. **`session-created` exists** (gated at control minor ≥ 1.9 — the client
//!    announces 1.9 for exactly this). Creation is now a pushed hint like every
//!    other registry change; the `list-sessions` backstop below survives only
//!    as slow belt-and-braces reconciliation, no longer the creation-latency
//!    bound.
//! 2. **`SessionSummary.persistence` is reported** (`Some` for locally governed
//!    sessions, absent for remote replicas) — `ObservedTerminal.persistence` is
//!    filled as opaque passthrough, and mgmt re-policy is real (`set-persistence`).
//! 3. **The graceful drain is upstream** (spec §2.2/NF-D10 held: mechanism
//!    moved, policy stayed). `serve_managed` hands this unit a `ServiceHandle`;
//!    stop calls `shutdown(SWEEP_BUDGET)` and logs the `DrainReport` honestly.

use crate::config::NativeConfig;
use crate::contracts::{ObservedTerminal, TerminalEndpoints, UnitHealth, UnitState};
use crate::manager::NativeService;
use crate::registries;
use crate::services::terminal_client::{ControlClient, SessionSummary};
use crate::state::DaemonState;
use ghosttea::{
    ipc, ServiceHandle, TerminalService, TerminalServiceConfig, TerminalServiceListeners,
    TextEngine,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::UnixListener;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;

pub const UNIT_ID: &str = "terminal";

/// The whole drain, not one session's ladder — spec §4.4's "~6s". Upstream's
/// ladder is interrupt → 2s → SIGTERM(pgrp) → 2s → SIGKILL(pgrp) → 1s, runs on
/// its own thread per session, and G7's drain compresses it against this budget
/// when it must — so this is one full ladder plus slack, not a per-session
/// cost, and a sub-ladder budget degrades to earlier SIGKILLs rather than a
/// false `unresponsive`.
///
/// The ceiling is not academic. A supervisor that SIGTERMs this daemon and then
/// SIGKILLs it has its own patience (tests/native_logging.rs allows 5s for a
/// session-less shutdown), and anything we spend past it is time the ladder does
/// not get. Bounded is the law; small is the courtesy.
const SWEEP_BUDGET: Duration = Duration::from_secs(6);

/// Inventory publish floor — the `native.diagnostics` precedent (≤10Hz). Bursts
/// of session events coalesce into at most one `list-sessions` per tick.
const RECONCILE_FLOOR: Duration = Duration::from_millis(100);

/// How long inventory may go unasked-for. Since NF-7 creation is a pushed
/// `session-created` hint (the client announces minor 1.9), so this no longer
/// bounds creation latency — events do, inside the kill-matrix's "< 2s" row
/// (spec §10.1). The backstop survives as belt-and-braces reconciliation for
/// whatever an event stream can silently lose, at a pace that stays honest
/// without being a poll.
///
/// Measured against a timestamp and NOT by counting ticks: with
/// `MissedTickBehavior::Skip`, a reconcile slower than the floor eats ticks, so
/// several of them could stretch well past the interval and the bound would
/// quietly stop being one.
const BACKSTOP_INTERVAL: Duration = Duration::from_secs(5);

/// A torn control connection is reconciled by reconnecting, never by guessing
/// (spec §10.5: `list-sessions` is truth).
const RECONNECT_DELAY: Duration = Duration::from_millis(500);

/// Socket paths and the per-boot token: everything a client needs, and the
/// exact shape the NF-D8 hello carries.
#[derive(Clone)]
struct Endpoints {
    control: String,
    frame: String,
    /// 32 random bytes, hex, minted per field-native boot. Memory-only: never
    /// logged, never written to disk, never placed in any environment (NF-D8,
    /// EL7). Rotating it means restarting the pair.
    token: String,
}

impl Endpoints {
    fn contract(&self) -> TerminalEndpoints {
        TerminalEndpoints {
            control_socket: self.control.clone(),
            frame_socket: self.frame.clone(),
            auth_token: self.token.clone(),
        }
    }
}

struct Shared {
    health: Mutex<UnitHealth>,
    /// pokes the daemon's health-refresh task (lib.rs) after every transition
    ping: UnboundedSender<()>,
    /// `None` only when the run directory cannot be expressed as the UTF-8
    /// string the contract (and ghosttea's config) require — the one path on
    /// which `HelloAck.terminal` is honestly absent.
    endpoints: Option<Endpoints>,
    /// A watch and not a flag: the inventory pump cannot start before the
    /// service accepts connections, so it is woken rather than left to poll.
    serving: watch::Sender<bool>,
    /// G7's drain handle, deposited by the serve task once `serve_managed`
    /// constructs the service. `stop` TAKES it — a taken handle is also how the
    /// serve task's end path tells a requested shutdown from a crash.
    drain: Mutex<Option<ServiceHandle>>,
}

impl Shared {
    fn set(&self, state: UnitState, detail: Option<String>) {
        *self.health.lock().unwrap() = UnitHealth {
            unit: UNIT_ID.to_string(),
            state,
            detail,
            auth_url: None,
        };
        let _ = self.ping.send(());
    }
}

/// Aborts its task when dropped, so a unit that goes away never leaves a serve
/// loop or an inventory pump behind (upstream uses the same guard shape).
struct TaskGuard(tokio::task::JoinHandle<()>);

impl Drop for TaskGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Cloneable door to the terminal unit: the boot sequence reads the endpoints
/// from it for the hello ack, and the inventory pump waits on it for readiness.
#[derive(Clone)]
pub struct TerminalHandle {
    shared: Arc<Shared>,
}

impl TerminalHandle {
    /// The NF-D8 endpoints, or `None` if the unit could not be configured.
    /// Minted before any fallible step, so a registered unit answers this even
    /// while it is still starting — readers learn whether the plane WORKS from
    /// health, never from a missing field.
    pub fn endpoints(&self) -> Option<TerminalEndpoints> {
        self.shared.endpoints.as_ref().map(Endpoints::contract)
    }

    /// Park until the service is serving. Never resolves if it never serves,
    /// which is the honest answer rather than a hang papering over one: there
    /// is no inventory to pump, and the caller is aborted at shutdown (the
    /// `MeshHandle::wait_for_node` precedent).
    async fn wait_until_serving(&self) {
        let mut rx = self.shared.serving.subscribe();
        loop {
            let serving = *rx.borrow_and_update();
            if serving {
                return;
            }
            if rx.changed().await.is_err() {
                std::future::pending::<()>().await;
            }
        }
    }
}

pub struct TerminalUnit {
    shared: Arc<Shared>,
    tasks: Mutex<Vec<TaskGuard>>,
}

impl TerminalUnit {
    pub fn new(config: &NativeConfig, ping: UnboundedSender<()>) -> Self {
        let run_dir = config.run_dir();
        let endpoints = endpoint_paths(&run_dir).map(|(control, frame)| Endpoints {
            control,
            frame,
            token: mint_token(),
        });
        let detail = endpoints.is_none().then(|| {
            format!(
                "run directory is not valid UTF-8, which the endpoint contract requires: {}",
                run_dir.display()
            )
        });
        Self {
            shared: Arc::new(Shared {
                health: Mutex::new(UnitHealth {
                    unit: UNIT_ID.to_string(),
                    state: if endpoints.is_some() {
                        UnitState::Starting
                    } else {
                        UnitState::Degraded
                    },
                    detail,
                    auth_url: None,
                }),
                ping,
                endpoints,
                serving: watch::channel(false).0,
                drain: Mutex::new(None),
            }),
            tasks: Mutex::new(Vec::new()),
        }
    }

    pub fn handle(&self) -> TerminalHandle {
        TerminalHandle {
            shared: self.shared.clone(),
        }
    }
}

#[async_trait::async_trait]
impl NativeService for TerminalUnit {
    fn id(&self) -> &'static str {
        UNIT_ID
    }

    /// Assembly per spec §4.1. The 0700 run directory is already created by
    /// `bootstrap` before any unit starts, so this only owns the endpoints
    /// inside it.
    async fn start(&self) -> anyhow::Result<()> {
        let Some(endpoints) = self.shared.endpoints.clone() else {
            return Ok(()); // already degraded with the reason; nothing to bind
        };

        // A Unix socket outlives the process that bound it, so a host that
        // restarts replaces its own endpoints (ghosttea README, "Embedded
        // service mode"). Binding is deliberately OURS, not `run()`'s: this
        // daemon owns the directory, the permissions, and the start order.
        ipc::remove_stale_endpoint(&endpoints.control)?;
        ipc::remove_stale_endpoint(&endpoints.frame)?;
        let control = UnixListener::bind(&endpoints.control)?;
        let frames = UnixListener::bind(&endpoints.frame)?;
        set_private_socket_permissions(&endpoints.control)?;
        set_private_socket_permissions(&endpoints.frame)?;

        self.shared
            .set(UnitState::Starting, Some("binding terminal service".into()));

        let shared = self.shared.clone();
        let task = tokio::spawn(serve(shared, endpoints, control, frames));
        self.tasks.lock().unwrap().push(TaskGuard(task));
        Ok(())
    }

    fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    /// Stop = G7's drain, then teardown. No PTY survives field-native — the
    /// honest ceiling the product promises and nothing more. Taking the handle
    /// (not borrowing it) is deliberate: the serve task's end path reads
    /// `drain.is_none()` as "this ending was requested".
    async fn stop(&self) -> anyhow::Result<()> {
        let handle = self.shared.drain.lock().unwrap().take();
        if let Some(handle) = handle {
            match handle.shutdown(SWEEP_BUDGET).await {
                Ok(report) => {
                    // The report is the record: every bucket named, nothing
                    // inferred. `unresponsive`/`pending_creates` are the two
                    // shapes of "a process may outlive this boot" — warn-level,
                    // because the OS re-parents them and the observed tier
                    // inherits the problem (spec §4.4).
                    if report.unresponsive.is_empty() && report.pending_creates == 0 {
                        tracing::info!(
                            event = "field_native.terminal.drain_complete",
                            component = "terminal",
                            drained = report.drained,
                            killed = report.killed,
                            announced_shutdown = report.announced_shutdown,
                            elapsed_ms = report.spent.as_millis() as u64,
                            "Every terminal session concluded under the shutdown drain"
                        );
                    } else {
                        tracing::warn!(
                            event = "field_native.terminal.drain_incomplete",
                            component = "terminal",
                            drained = report.drained,
                            killed = report.killed,
                            unresponsive = %report.unresponsive.join(","),
                            pending_creates = report.pending_creates,
                            announced_shutdown = report.announced_shutdown,
                            elapsed_ms = report.spent.as_millis() as u64,
                            "The shutdown drain spent its budget with sessions unaccounted for"
                        );
                    }
                }
                Err(error) => tracing::warn!(
                    event = "field_native.terminal.drain_failed",
                    component = "terminal",
                    error = %error,
                    "The shutdown drain did not run; sessions may outlive this boot"
                ),
            }
        }
        self.tasks.lock().unwrap().clear(); // TaskGuard aborts the serve loop
        self.shared.serving.send_replace(false);
        Ok(())
    }
}

/// Build and serve. Construction happens here rather than in `start` so a slow
/// font database never blocks the boot sequence — the unit reports `starting`
/// meanwhile, which is true.
async fn serve(
    shared: Arc<Shared>,
    endpoints: Endpoints,
    control: UnixListener,
    frames: UnixListener,
) {
    // field-native bundles no fonts, so the text engine comes from system
    // discovery (ghosttead's `GHOSTTEA_FONT_DIR` path is a packaging concern —
    // P2 may bundle a family and this becomes `TextEngine::from_fonts`). It is
    // not optional: `serve()` would call `discover()` itself and fail the whole
    // future, and every session needs the engine to build its model. Doing it
    // here instead turns that into an honest unit state. `spawn_blocking`
    // because loading the system font database is blocking, CPU-bound work.
    let engine = match tokio::task::spawn_blocking(TextEngine::discover).await {
        Ok(Ok(engine)) => engine,
        Ok(Err(error)) => {
            shared.set(
                UnitState::Degraded,
                Some(format!("no usable monospace font: {error}")),
            );
            return;
        }
        Err(error) => {
            shared.set(
                UnitState::Degraded,
                Some(format!("font discovery task failed: {error}")),
            );
            return;
        }
    };
    let family = engine.primary_family().to_owned();

    let service = match TerminalService::new(TerminalServiceConfig {
        control_socket: endpoints.control.clone(),
        frame_socket: endpoints.frame.clone(),
        auth_token: endpoints.token.clone(),
    })
    // EL7/NF-D6: FIELD_/FIELDD_ join ghosttea's own GHOSTTEA_*/TERMINALD_*
    // strip list at the service, so even an inherit-mode PTY cannot carry a
    // daemon secret. Prefixes come from the generated registries, never a
    // literal (NF-D9).
    .with_private_env_prefixes(registries::ENV_PREFIXES.iter().copied())
    {
        Ok(service) => service.with_text_engine(engine),
        Err(error) => {
            shared.set(
                UnitState::Degraded,
                Some(format!("private env prefixes rejected: {error}")),
            );
            return;
        }
    };

    shared.set(
        UnitState::Up,
        Some(format!("serving; text engine {family}")),
    );
    shared.serving.send_replace(true);
    tracing::info!(
        event = "field_native.terminal.serving",
        component = "terminal",
        control_socket = %endpoints.control,
        frame_socket = %endpoints.frame,
        text_engine = %family,
        "The terminal service is serving"
    );

    // G7 (NF-7): `serve_managed` runs until a listener fails OR a completed
    // `shutdown` — the first non-failure way serving ends. The handle is
    // deposited BEFORE the await so `stop` can always reach a serving plane.
    let (handle, serving_future) =
        service.serve_managed(TerminalServiceListeners::new(control.into(), frames.into()));
    *shared.drain.lock().unwrap() = Some(handle);
    let outcome = serving_future.await;
    shared.serving.send_replace(false);
    // `stop` TAKES the handle before draining, so a missing handle plus a clean
    // exit is a requested shutdown — the one ending that is not a crash.
    let requested = shared.drain.lock().unwrap().is_none();
    if requested && outcome.is_ok() {
        tracing::info!(
            event = "field_native.terminal.serve_ended",
            component = "terminal",
            "The terminal service drained and stopped as requested"
        );
        return;
    }
    shared.drain.lock().unwrap().take(); // a dead plane's handle answers nothing
    let detail = match outcome {
        Ok(()) => "the terminal service stopped serving".to_string(),
        Err(error) => format!("the terminal service failed: {error}"),
    };
    tracing::error!(
        event = "field_native.terminal.serve_ended",
        component = "terminal",
        detail = %detail,
        "The terminal service ended; sessions are no longer reachable"
    );
    // Manager law: no in-process restart. Global health goes degraded with this
    // unit named and fieldd decides what to do about it.
    shared.set(UnitState::Crashed, Some(detail));
}

/// Wire the unit's inventory to the mgmt watch channel (NF-D7/§4.3). Called
/// from `bootstrap`, not from the unit, for the reason the lane transport is:
/// joining a unit to the mgmt plane is WIRING — the unit never learns what a
/// subscription is, and the mgmt facade never learns the control protocol.
pub fn install_inventory(
    handle: TerminalHandle,
    state: Arc<DaemonState>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let Some(endpoints) = handle.shared.endpoints.clone() else {
            std::future::pending::<()>().await;
            return;
        };
        // Consecutive failed attempts, and whether this streak's recovery is
        // still owed a line. A dead plane is dialed twice a second forever, so
        // warning on every attempt is ~172k lines a day against the LOG soak
        // gate: the FIRST failure of a streak is the news, the rest are debug,
        // and the recovery is news again exactly once.
        let mut failures = 0_u32;
        let mut recovery_owed = false;
        loop {
            // Inside the loop, not before it: a torn connection reconnects at
            // once while the service is still up, and a service that DIED parks
            // here forever instead of dialing a dead socket twice a second. The
            // unit's health already says the plane is gone; a retry storm would
            // only add noise to a fact fieldd has.
            handle.wait_until_serving().await;
            // Dialing here rather than inside the pump is what lets a failed
            // DIAL be told apart from a pump that ran and then broke.
            match ControlClient::connect(Path::new(&endpoints.control), &endpoints.token).await {
                Ok((client, events)) => {
                    if recovery_owed {
                        recovery_owed = false;
                        tracing::info!(
                            event = "field_native.terminal.inventory_reconnected",
                            component = "terminal",
                            after_failed_attempts = failures,
                            "The terminal inventory connection was re-established"
                        );
                    }
                    match pump_inventory(&client, events, &state).await {
                        Ok(()) => {
                            failures = 0;
                            tracing::info!(
                                event = "field_native.terminal.inventory_disconnected",
                                component = "terminal",
                                "The terminal inventory connection closed; reconnecting"
                            );
                        }
                        Err(error) => {
                            failures += 1;
                            log_inventory_failure(failures, &mut recovery_owed, &error);
                        }
                    }
                }
                Err(error) => {
                    failures += 1;
                    log_inventory_failure(failures, &mut recovery_owed, &error);
                }
            }
            // The last published inventory deliberately STAYS. A dead control
            // connection does not kill PTYs, so clearing the rows would claim
            // sessions ended when we simply cannot see them; unit health is
            // what carries "this plane is degraded" (honest states, not blanks).
            tokio::time::sleep(RECONNECT_DELAY).await;
        }
    })
}

/// One failed inventory attempt, logged at a level that survives a soak: the
/// first of a streak at warn, the rest at debug carrying the attempt count so
/// the streak's length is still recoverable from the log.
fn log_inventory_failure(failures: u32, recovery_owed: &mut bool, error: &anyhow::Error) {
    if failures == 1 {
        *recovery_owed = true;
        tracing::warn!(
            event = "field_native.terminal.inventory_failed",
            component = "terminal",
            error = %error,
            "The terminal inventory pump failed; reconnecting"
        );
    } else {
        tracing::debug!(
            event = "field_native.terminal.inventory_failed",
            component = "terminal",
            attempts = failures,
            error = %error,
            "The terminal inventory pump is still failing; reconnecting"
        );
    }
}

/// One connection's worth of inventory maintenance: reconcile on connect, then
/// on events and on the backstop.
async fn pump_inventory(
    client: &ControlClient,
    mut events: tokio::sync::mpsc::UnboundedReceiver<Value>,
    state: &Arc<DaemonState>,
) -> anyhow::Result<()> {
    // Seeded from what the channel already holds so an unchanged inventory
    // wakes no subscriber.
    let mut published = inventory_value(&state.observed_tx.borrow().terminals);
    let mut last_reconcile = Instant::now();
    published = reconcile(client, state, published).await?;

    let mut ticker = tokio::time::interval(RECONCILE_FLOOR);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut dirty = false;
    loop {
        tokio::select! {
            event = events.recv() => match event {
                // Every pushed event is a hint that the registry may have
                // moved; the tick below is what bounds how often we ask.
                Some(_) => dirty = true,
                None => return Ok(()),
            },
            _ = ticker.tick() => {
                // An event-driven reconcile resets the backstop clock too: it
                // asked `list-sessions` the same question the backstop would
                // have, so counting from it kills a redundant second call.
                if dirty || last_reconcile.elapsed() >= BACKSTOP_INTERVAL {
                    dirty = false;
                    // Stamped from BEFORE the call, so a slow reconcile cannot
                    // stretch the interval the kill matrix bounds.
                    let started = Instant::now();
                    published = reconcile(client, state, published).await?;
                    last_reconcile = started;
                }
            },
        }
    }
}

/// `list-sessions` is truth (spec §10.5). Publishes only on a real change.
async fn reconcile(
    client: &ControlClient,
    state: &Arc<DaemonState>,
    published: Value,
) -> anyhow::Result<Value> {
    let mut sessions = client.list_sessions().await?;
    // The service answers from a HashMap, so its order is arbitrary between
    // calls. Without this sort every backstop tick would look like a change and
    // wake every subscriber.
    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    let terminals: Vec<ObservedTerminal> = sessions.iter().map(observed_row).collect();
    let snapshot = inventory_value(&terminals);
    if snapshot == published {
        return Ok(published);
    }
    let count = terminals.len();
    state
        .observed_tx
        .send_modify(|observed| observed.terminals = terminals);
    tracing::debug!(
        event = "field_native.terminal.inventory_published",
        component = "terminal",
        terminals = count,
        "The terminal inventory changed"
    );
    Ok(snapshot)
}

/// Map ghosttea's summary onto the contract row. What the protocol does not
/// provide stays absent — `persistence` has no upstream source at all
/// (absence 2 in the module note), and the session id IS the floor's identity:
/// binding it to a chopsticks agent session is a fieldd concern above the mgmt
/// seam (NF-L2), never invented here.
fn observed_row(session: &SessionSummary) -> ObservedTerminal {
    ObservedTerminal {
        session_id: session.id.clone(),
        pid: session.pid.map(i64::from),
        created_at: session.created_at_ms.and_then(|ms| i64::try_from(ms).ok()),
        persistence: session.persistence.clone(),
        title: session.title.clone(),
        cwd: session.cwd.clone(),
    }
}

/// `ObservedTerminal` is generated and carries no `PartialEq`, so equality
/// rides serde rather than a hand-written comparison that would drift when the
/// contract grows a field.
fn inventory_value(terminals: &[ObservedTerminal]) -> Value {
    serde_json::to_value(terminals).unwrap_or(Value::Null)
}

/// Socket names come from the generated registries (NF-D9); paths are stable
/// across restarts, which is what lets ghosttea clients read endpoints once
/// (external-mode law).
fn endpoint_paths(run_dir: &Path) -> Option<(String, String)> {
    let control = run_dir.join(registries::sockets::TERMINAL_CONTROL);
    let frame = run_dir.join(registries::sockets::TERMINAL_FRAME);
    Some((path_string(&control)?, path_string(&frame)?))
}

fn path_string(path: &Path) -> Option<String> {
    path.to_str().map(str::to_owned)
}

fn mint_token() -> String {
    hex::encode(rand::random::<[u8; 32]>())
}

/// The 0700 run directory is the real boundary, but a socket the owning user
/// alone may open costs one syscall and does not rely on the directory staying
/// that way.
fn set_private_socket_permissions(path: &str) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(PathBuf::from(path), std::fs::Permissions::from_mode(0o600))
}
