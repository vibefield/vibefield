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
//! **`with_terminal_mesh` — the one named exception (GT-4a).** Until GT-4 the
//! floor had no mesh coupling at all: remote ops `bail!` honestly without an
//! adapter, and TSP1 mirroring was NF-remote (spec §7). That is still what the
//! unit does by DEFAULT, and default here means absent — with
//! `FIELD_NATIVE_TERMINAL_MESH` unset, nothing from `ghosttea-truffle` is
//! constructed, no advertisement store is opened, and no listener exists. The
//! exception is exactly one call, made from `serve` and gated by
//! `terminal_mesh::MeshPlan`; the mechanism, the borrowed node, and the two
//! flags' relationship live in `terminal_mesh.rs`.
//!
//! The unit STILL declares no dependency on `mesh-gateway`. It is registered
//! after it to keep design-02's start order, and it now also borrows that
//! unit's node when the flag asks — but it cannot require it: a gateway that is
//! off or degraded costs the mesh, never the PTYs.
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
//!
//! ## The persistence law (GT-D11)
//!
//! Absence 1's `session-created` is not only a latency fix — it is the seam
//! where this plane can hold a promise the UI cannot. `GhostteaWorkspace` owns
//! pane births (GT-D10) and its own doors hardcode `terminate-with-app`; our
//! product promise is daemon-lifetime. So an OWNERLESS birth carrying that
//! default is re-governed to `keep-until-exit` here, on the event, by
//! `govern_birth` — never in fieldd, because a custody claim enforced only
//! while fieldd is alive is not a custody claim. Named residual: the flip is a
//! sub-second window in which a session really is app-lifetime, and a tiny
//! upstream `defaultPersistence` prop (the G10 candidate) is what deletes it.

use crate::config::NativeConfig;
use crate::contracts::{ObservedTerminal, TerminalEndpoints, UnitHealth, UnitState};
use crate::manager::NativeService;
use crate::registries;
use crate::services::mesh::MeshHandle;
use crate::services::terminal_client::{ControlClient, SessionSummary};
use crate::services::terminal_mesh::{self, Attachment, MeshPlan};
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

/// What `GhostteaWorkspace` hardcodes into every one of its own create doors —
/// init, split, and new-pane alike (Workspace.tsx:206/682/716). It is the right
/// default for the app it was written for, where the shell dies with the window.
const APP_LIFETIME: &str = "terminate-with-app";

/// What this product promises instead: sessions live as long as the floor does
/// (NF-D3, the daemon-lifetime ceiling stated honestly).
const FLOOR_LIFETIME: &str = "keep-until-exit";

/// Socket paths and the per-boot token: everything a client needs, and the
/// exact shape the NF-D8 hello carries.
#[derive(Clone)]
struct Endpoints {
    control: String,
    frame: String,
    /// The app-owned config overlay (GT-3). A `PathBuf`, not a `String`: only
    /// the SOCKET paths owe the contract UTF-8, and a config file on a path
    /// this daemon cannot spell as UTF-8 is still a config file the service can
    /// open — refusing the whole unit over it would be a contract requirement
    /// leaking somewhere it was never made.
    config: PathBuf,
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
    /// GT-4a's named exception, resolved once at construction.
    plan: MeshPlan,
    /// The borrowed door to the gateway's node — `None` whenever the plan is
    /// `Off`, which is the structural half of "off means absent": with the flag
    /// unset this unit does not even hold a way to reach the mesh.
    mesh: Option<MeshHandle>,
}

impl TerminalUnit {
    pub fn new(config: &NativeConfig, ping: UnboundedSender<()>, mesh: MeshHandle) -> Self {
        let plan = MeshPlan::resolve(config);
        let mesh = (!plan.is_off()).then_some(mesh);
        let run_dir = config.run_dir();
        let config_file = config.terminal_config_file();
        let endpoints = endpoint_paths(&run_dir).map(|(control, frame)| Endpoints {
            control,
            frame,
            config: config_file,
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
            plan,
            mesh,
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
        let task = tokio::spawn(serve(
            shared,
            endpoints,
            control,
            frames,
            self.plan.clone(),
            self.mesh.clone(),
        ));
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
    plan: MeshPlan,
    mesh: Option<MeshHandle>,
) {
    // GT-4a: started BEFORE font discovery so the node wait overlaps a cost the
    // boot already pays, rather than adding its budget on top. A `None` here is
    // the flag-off floor, and from this point the two paths are the same code.
    let attaching = match (&plan, mesh) {
        (MeshPlan::Requested { mirror_write }, Some(mesh)) => Some(tokio::spawn(
            terminal_mesh::attach(mirror_write.clone(), mesh, terminal_mesh::ATTACH_BUDGET),
        )),
        _ => None,
    };

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
    // GT-3: the app-owned config overlay, loaded AFTER the user's own Ghostty
    // files so their existing setup is imported and ours refines it. Pointing
    // the service here is also what makes the document editable at all —
    // without an explicit path the service answers `configuration document is
    // unavailable without an explicit overlay`, which is the honest state
    // fieldd surfaces as UNAVAILABLE.
    //
    // The file is deliberately NOT created here. A missing overlay is a valid
    // empty config upstream (the explicit path joins the loader's source list
    // marked optional, and a NotFound on an optional source is skipped, not
    // diagnosed), so touching the disk at boot would only be this daemon
    // writing a file nobody asked for. It appears the first time someone saves.
    .with_config_path(endpoints.config.clone())
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

    // The mesh joins HERE or not at all: upstream takes the adapter before the
    // service serves, so this is the last moment the floor can be handed one.
    // A unit that is still waiting is still `starting`, which is what it is.
    let (service, mesh_face) = match attaching {
        None => (service, None),
        Some(task) => {
            shared.set(
                UnitState::Starting,
                Some("waiting for the tailnet node to publish the terminal mesh".into()),
            );
            match task.await {
                Ok(Attachment::Attached(mesh)) => {
                    let face = format!(
                        "publishing {} ({})",
                        registries::stores::TERMINAL_HOSTS,
                        if plan.offers_mirror_write() {
                            "mirror-write configured"
                        } else {
                            "view-only — no mirror-write configured"
                        }
                    );
                    (service.with_terminal_mesh(*mesh), Some(face))
                }
                Ok(Attachment::Unavailable(reason)) => (service, Some(format!("off — {reason}"))),
                // An aborted or panicked attach is the floor's problem to state,
                // not to inherit: the PTYs are unaffected and say so.
                Err(error) => (
                    service,
                    Some(format!("off — the attach task failed: {error}")),
                ),
            }
        }
    };

    let detail = match &mesh_face {
        None => format!("serving; text engine {family}"),
        Some(face) => format!("serving; text engine {family}; terminal mesh {face}"),
    };
    shared.set(UnitState::Up, Some(detail));
    shared.serving.send_replace(true);
    tracing::info!(
        event = "field_native.terminal.serving",
        component = "terminal",
        control_socket = %endpoints.control,
        frame_socket = %endpoints.frame,
        config_overlay = %endpoints.config.display(),
        text_engine = %family,
        // The FACE, never the capability: whether a mirror-write string exists
        // is operational news, and its value is a secret (EL7/NF-D8).
        terminal_mesh = mesh_face.as_deref().unwrap_or("not requested"),
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
                Some(event) => {
                    govern_birth(client, &event).await;
                    dirty = true;
                }
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

/// GT-D11, the floor persistence law: re-govern an **ownerless** birth that
/// carries the workspace's app-lifetime default.
///
/// The law lives HERE, in the plane that outlives fieldd, because it is a
/// custody claim: a session promised daemon-lifetime must keep that promise
/// even if fieldd dies a second later. A fieldd-side flip would be a policy
/// that stops being enforced exactly when the product needs it most.
///
/// Only one shape is touched, and the two exclusions are the reasoning:
///
/// - **Owned** (`ownerId` present) — fieldd states persistence explicitly on
///   every session it creates, so an owned birth already carries its author's
///   intent. Overriding an explicit choice is not policy, it is a bug that
///   would be very hard to see.
/// - **`persistence: None`** — a replica of a session another host governs
///   (session.rs:314-321). Re-policying one would be this device asserting a
///   governance it does not hold, and the service would refuse it anyway.
///
/// Anything else — `keep-until-exit`, `keep-until-explicit-close`, a value a
/// later ghosttea invents — is left exactly as found. A tolerant reader does
/// not rewrite what it does not recognise.
fn is_ownerless_app_lifetime_birth(session: &SessionSummary) -> bool {
    session.owner_id.is_none() && session.persistence.as_deref() == Some(APP_LIFETIME)
}

/// Apply the law to one pushed event, if it is a birth this floor governs.
///
/// Failures are swallowed after a line: by the time the event is read the
/// session may have already exited (a shell that ran `exit` immediately, a
/// pane closed in the same breath it opened), and the service answers "unknown
/// or remote session" for one it no longer holds. That is a race, not a fault
/// — the desired end state, a session that does not outlive its process, holds
/// either way. A control connection that is genuinely broken is diagnosed by
/// the very next `reconcile`, which returns its error instead of hiding it.
async fn govern_birth(client: &ControlClient, event: &Value) {
    if event.get("type").and_then(Value::as_str) != Some("session-created") {
        return;
    }
    // The event carries the full summary under the same `session` key the
    // create response uses (service.rs:145-150), so no follow-up list is owed.
    let Some(summary) = event.get("session") else {
        return;
    };
    let session: SessionSummary = match serde_json::from_value(summary.clone()) {
        Ok(session) => session,
        Err(error) => {
            tracing::warn!(
                event = "field_native.terminal.birth_unreadable",
                component = "terminal",
                error = %error,
                "A session-created event carried a summary this floor could not read"
            );
            return;
        }
    };
    if !is_ownerless_app_lifetime_birth(&session) {
        return;
    }
    match client.set_persistence(&session.id, FLOOR_LIFETIME).await {
        Ok(()) => tracing::info!(
            event = "field_native.terminal.persistence_regoverned",
            component = "terminal",
            session_id = %session.id,
            from = APP_LIFETIME,
            to = FLOOR_LIFETIME,
            "An ownerless session was re-governed to the floor's lifetime"
        ),
        Err(error) => tracing::warn!(
            event = "field_native.terminal.persistence_regovern_failed",
            component = "terminal",
            session_id = %session.id,
            error = %error,
            "An ownerless session could not be re-governed; it may already be gone"
        ),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Built from JSON rather than a struct literal on purpose: what the law
    /// reads is a WIRE shape, and a summary assembled field-by-field in Rust
    /// would keep passing if the serde names stopped matching ghosttea's.
    fn summary(extra: Value) -> SessionSummary {
        let mut wire = json!({
            "id": "s1",
            "handle": "s1-handle",
            "executable": "/bin/zsh",
            "cols": 100,
            "rows": 30,
            "exited": false,
            "readWrite": true,
            "title": null,
            "cwd": null,
            "bellCount": 0,
            "pid": 4242,
            "createdAtMs": 1,
            "exitCode": null,
            "exitSignal": null,
            "requestedTermination": null,
            "exitOutcome": null,
        });
        for (key, value) in extra.as_object().expect("an object of overrides") {
            wire[key] = value.clone();
        }
        serde_json::from_value(wire).expect("the 0.8.0 summary shape parses")
    }

    #[test]
    fn an_ownerless_app_lifetime_birth_is_the_only_one_re_governed() {
        assert!(
            is_ownerless_app_lifetime_birth(&summary(json!({"persistence": APP_LIFETIME}))),
            "a workspace door states no owner and asks for app lifetime — the GT-D11 case"
        );
        assert!(
            !is_ownerless_app_lifetime_birth(&summary(
                json!({"persistence": APP_LIFETIME, "ownerId": "vibefield.fieldd"})
            )),
            "an owned birth carries its author's explicit intent and is never overridden"
        );
        assert!(
            !is_ownerless_app_lifetime_birth(&summary(json!({"persistence": FLOOR_LIFETIME}))),
            "a session already governed by the floor's lifetime needs nothing"
        );
        assert!(
            !is_ownerless_app_lifetime_birth(&summary(
                json!({"persistence": "keep-until-explicit-close"})
            )),
            "a stronger retention class is not ours to weaken"
        );
        assert!(
            !is_ownerless_app_lifetime_birth(&summary(json!({"persistence": null}))),
            "a replica reports no class, and re-policying one would claim a governance \
             this host does not hold"
        );
    }

    /// The wire name is the whole contract here: `ownerId` arriving as anything
    /// else would read as `None` and turn every owned birth into a flip.
    #[test]
    fn the_owner_rides_the_summary_as_owner_id() {
        assert_eq!(
            summary(json!({"ownerId": "vibefield.fieldd"}))
                .owner_id
                .as_deref(),
            Some("vibefield.fieldd")
        );
        assert!(summary(json!({})).owner_id.is_none());
    }
}
