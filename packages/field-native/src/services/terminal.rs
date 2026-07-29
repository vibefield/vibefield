//! TerminalUnit (NF-2) — ghosttea's `TerminalService` embedded as this device's
//! single PTY authority (native-floor spec §4; NF-L1: every PTY the product
//! creates lives here). The unit owns the run directory's endpoints, the
//! per-boot bearer token, the inventory it publishes to fieldd, and the
//! shutdown sweep ghosttea deliberately does not provide (§2.2).
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
//! ## Verified upstream absences the floor must not paper over
//!
//! Read from the pinned crate (`ghosttea-0.6.0`), all three confirmed against
//! `@vibecook/ghosttea-protocol`'s `SessionSummary` as well:
//!
//! 1. **No session-created event.** The control channel pushes exactly
//!    `control-changed`, `session-activity-changed`, and `session-exited`
//!    (service.rs:503/524/714/749/786). A session fieldd creates is therefore
//!    invisible to this unit until it either changes activity or exits — so
//!    inventory needs the periodic `list-sessions` backstop below, not just
//!    events.
//! 2. **No persistence in `SessionSummary`** (session.rs:284-304). It is the
//!    spawn-time input only. `ObservedTerminal.persistence` therefore stays
//!    ABSENT rather than invented (tolerant-reader law), and the NF-D3 sweep
//!    cannot order non-persistent sessions first — see `sweep`.
//! 3. **No graceful drain** (spec §2.2/NF-D10). The sweep below is the interim;
//!    it swaps for upstream `shutdown(budget)` when G7 lands, invisibly to
//!    everything above the mgmt seam.

use crate::config::NativeConfig;
use crate::contracts::{ObservedTerminal, TerminalEndpoints, UnitHealth, UnitState};
use crate::manager::NativeService;
use crate::registries;
use crate::services::terminal_client::{ControlClient, SessionSummary};
use crate::state::DaemonState;
use ghosttea::{ipc, TerminalService, TerminalServiceConfig, TerminalServiceListeners, TextEngine};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::UnixListener;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;

pub const UNIT_ID: &str = "terminal";

/// The whole sweep, not one session's ladder — spec §4.4's "~6s". Upstream's
/// ladder is interrupt → 2s → SIGTERM(pgrp) → 2s → SIGKILL(pgrp)
/// (`INTERRUPT_GRACE`/`TERMINATE_GRACE`, session.rs:362/375/1540-1584) and it
/// runs on its own thread per session, so every ladder overlaps: this is one
/// full ladder plus slack, not a per-session cost.
///
/// The ceiling is not academic. A supervisor that SIGTERMs this daemon and then
/// SIGKILLs it has its own patience (tests/native_logging.rs allows 5s for a
/// session-less shutdown), and anything we spend past it is time the ladder does
/// not get. Bounded is the law; small is the courtesy.
const SWEEP_BUDGET: Duration = Duration::from_secs(6);

/// Inventory publish floor — the `native.diagnostics` precedent (≤10Hz). Bursts
/// of session events coalesce into at most one `list-sessions` per tick.
const RECONCILE_FLOOR: Duration = Duration::from_millis(100);

/// Ticks between unconditional reconciles. Creation pushes no event (absence 1
/// above), so this is what bounds inventory latency for a session fieldd
/// created — ten ticks ≈ 1s, inside the kill-matrix's "< 2s" row (spec §10.1).
const BACKSTOP_TICKS: u32 = 10;

/// A torn control connection is reconciled by reconnecting, never by guessing
/// (spec §10.5: `list-sessions` is truth).
const RECONNECT_DELAY: Duration = Duration::from_millis(500);

/// The sweep's honest classification. `TerminationSource` is a kebab-case wire
/// enum (session.rs:39-46) and `classify_exit` maps this variant to
/// `ExitOutcome::ServiceTerminated` (session.rs:69-83), so a self-client sweep
/// CAN stamp the true source. Recorded as a divergence: spec §2.2/NF-D10 says
/// "through the control socket we can only say `source:"application"`, which
/// lies to every observer" — that half of the G7 argument does not hold for
/// 0.6.0. The admission race (a same-uid token holder creating a session
/// mid-sweep) is real and remains G7's justification.
const SWEEP_SOURCE: &str = "service-shutdown";

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

    /// Stop = the NF-D3 sweep, then teardown. No PTY survives field-native —
    /// the honest ceiling the product promises and nothing more.
    async fn stop(&self) -> anyhow::Result<()> {
        if let Some(endpoints) = self.shared.endpoints.clone() {
            if *self.shared.serving.borrow() {
                if let Err(error) = sweep(&endpoints, SWEEP_BUDGET).await {
                    tracing::warn!(
                        event = "field_native.terminal.sweep_failed",
                        component = "terminal",
                        error = %error,
                        "The terminal shutdown sweep did not complete; sessions may outlive this boot"
                    );
                }
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

    // Runs until a listener fails; a normal shutdown ABORTS this task instead,
    // so reaching either arm means the plane died on its own.
    let outcome = service
        .serve(TerminalServiceListeners::new(control.into(), frames.into()))
        .await;
    shared.serving.send_replace(false);
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
        loop {
            // Inside the loop, not before it: a torn connection reconnects at
            // once while the service is still up, and a service that DIED parks
            // here forever instead of dialing a dead socket twice a second. The
            // unit's health already says the plane is gone; a retry storm would
            // only add noise to a fact fieldd has.
            handle.wait_until_serving().await;
            match pump_inventory(&endpoints, &state).await {
                Ok(()) => tracing::info!(
                    event = "field_native.terminal.inventory_disconnected",
                    component = "terminal",
                    "The terminal inventory connection closed; reconnecting"
                ),
                Err(error) => tracing::warn!(
                    event = "field_native.terminal.inventory_failed",
                    component = "terminal",
                    error = %error,
                    "The terminal inventory pump failed; reconnecting"
                ),
            }
            // The last published inventory deliberately STAYS. A dead control
            // connection does not kill PTYs, so clearing the rows would claim
            // sessions ended when we simply cannot see them; unit health is
            // what carries "this plane is degraded" (honest states, not blanks).
            tokio::time::sleep(RECONNECT_DELAY).await;
        }
    })
}

/// One connection's worth of inventory maintenance: reconcile on connect, then
/// on events and on the backstop tick.
async fn pump_inventory(endpoints: &Endpoints, state: &Arc<DaemonState>) -> anyhow::Result<()> {
    let (client, mut events) =
        ControlClient::connect(Path::new(&endpoints.control), &endpoints.token).await?;

    // Seeded from what the channel already holds so an unchanged inventory
    // wakes no subscriber.
    let mut published = inventory_value(&state.observed_tx.borrow().terminals);
    published = reconcile(&client, state, published).await?;

    let mut ticker = tokio::time::interval(RECONCILE_FLOOR);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut dirty = false;
    let mut ticks_since_backstop = 0_u32;
    loop {
        tokio::select! {
            event = events.recv() => match event {
                // Every pushed event is a hint that the registry may have
                // moved; the tick below is what bounds how often we ask.
                Some(_) => dirty = true,
                None => return Ok(()),
            },
            _ = ticker.tick() => {
                ticks_since_backstop += 1;
                let backstop_due = ticks_since_backstop >= BACKSTOP_TICKS;
                if dirty || backstop_due {
                    dirty = false;
                    if backstop_due {
                        ticks_since_backstop = 0;
                    }
                    published = reconcile(&client, state, published).await?;
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
        persistence: None,
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

/// The NF-D3 sweep: every session gets upstream's full ladder, then the daemon
/// waits — bounded — for the exits it asked for.
///
/// Two properties of the protocol shape this:
/// * `terminate` starts the ladder on its own thread and returns immediately
///   (session.rs:1558-1584), so issuing the requests in sequence still runs
///   every ladder in parallel. Sequence also gives the sweep a deterministic
///   order, which a `spawn`-per-session fan-out would not.
/// * NF-D3's "non-persistent first" ordering is NOT implementable here:
///   `SessionSummary` does not carry persistence (absence 2). Recorded rather
///   than faked — the natural upstream ask is to expose it, which would also
///   fill `ObservedTerminal.persistence` and unblock NF-5's re-policy.
///
/// The admission race stands as spec §2.2 records it: a same-uid holder of the
/// token can create a session after `list-sessions` and it will not be swept.
/// Only upstream can close that (G7's atomic admission stop).
async fn sweep(endpoints: &Endpoints, budget: Duration) -> anyhow::Result<()> {
    let started = Instant::now();
    let deadline = started + budget;
    // A fresh connection on purpose: the sweep must not depend on the
    // inventory pump's socket still being healthy. Connecting BEFORE listing
    // means an exit that happens mid-sweep is buffered, not missed.
    let (client, mut events) =
        ControlClient::connect(Path::new(&endpoints.control), &endpoints.token).await?;
    let sessions = client.list_sessions().await?;
    if sessions.is_empty() {
        return Ok(());
    }

    // An already-exited session (only `keep-until-explicit-close` can be one)
    // will emit no further exit event, so it is terminated but never awaited.
    let mut awaiting: HashSet<String> = sessions
        .iter()
        .filter(|session| !session.exited)
        .map(|session| session.id.clone())
        .collect();
    let requested = sessions.len();
    for session in &sessions {
        if let Err(error) = client.terminate(&session.id, SWEEP_SOURCE).await {
            tracing::warn!(
                event = "field_native.terminal.sweep_terminate_failed",
                component = "terminal",
                session_id = %session.id,
                error = %error,
                "A session refused termination during the shutdown sweep"
            );
            awaiting.remove(&session.id); // no ladder started; nothing to await
        }
    }

    while !awaiting.is_empty() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, events.recv()).await {
            Ok(Some(event)) => {
                if event.get("type").and_then(Value::as_str) == Some("session-exited") {
                    if let Some(id) = event.get("sessionId").and_then(Value::as_str) {
                        awaiting.remove(id);
                    }
                }
            }
            Ok(None) => break, // the service went away mid-sweep
            Err(_) => break,   // budget spent
        }
    }

    let unconfirmed = awaiting.len();
    if unconfirmed == 0 {
        tracing::info!(
            event = "field_native.terminal.sweep_complete",
            component = "terminal",
            sessions = requested,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "Every terminal session exited under the shutdown sweep"
        );
    } else {
        // Honest, not silent: these processes are being re-parented by the OS
        // and become the observed tier's problem (spec §4.4).
        tracing::warn!(
            event = "field_native.terminal.sweep_incomplete",
            component = "terminal",
            sessions = requested,
            unconfirmed,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "The shutdown sweep spent its budget with sessions unconfirmed"
        );
    }
    Ok(())
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
