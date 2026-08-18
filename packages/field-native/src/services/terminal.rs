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
//! default is re-governed to `keep-until-exit` here, on the event, by the birth
//! governor — never in fieldd, because a custody claim enforced only while
//! fieldd is alive is not a custody claim. Named residual: the flip is a
//! sub-second window in which a session really is app-lifetime, and a tiny
//! upstream `defaultPersistence` prop (the G10 candidate) is what deletes it.
//!
//! An event stream is not a guarantee, so the law does not rest on one: the
//! broadcast holds 1024 slots and answers a lagging subscriber with
//! `events-lost` rather than a replay, and a reconnect has the same hole. A
//! birth this floor never SAW would otherwise stay ungoverned forever on a
//! perfectly healthy connection. `regovern_unseen` closes exactly that — rows a
//! gap reconcile found that this floor had never published — and nothing wider,
//! for the reason written there.
//!
//! ## What the inventory MEANS (GT-5d)
//!
//! Upstream's `list-sessions` answers the local registry PLUS
//! `mesh_runtime.summaries()` — the replicas this floor opened as a VIEWER of
//! another device (`Command::ListSessions`, ghosttea 0.9.2 service.rs:2168-2178).
//! `ObservedTerminal` carries no device, so a replica published there would read
//! as a session on THIS machine: an agent bound to its id, a kill affordance
//! reasoning about it, or a restore gate counting it alive would each be acting
//! on the wrong device. Before GT-4 `summaries()` was always empty, so turning
//! the mesh flag on silently changed what the inventory MEANT, with no contract
//! change to notice.
//!
//! `reconcile` therefore publishes only what this floor GOVERNS, told apart by
//! upstream's own marker: a replica reports NO persistence class, because
//! claiming one would assert a governance this host does not hold
//! (replica.rs:57-59), while every locally created session carries `Some`
//! unconditionally (session.rs:1252). That restores the pre-GT-4 meaning without
//! touching the contract. Naming a replica honestly — a `device`/`replica` field
//! on `ObservedTerminal` — is the better long-term shape, and it is a CONTRACTS
//! change this slice deliberately does not take.
//!
//! ## The pump's own honest state (GT-5d)
//!
//! A failing control connection kills no PTY, so the last published inventory
//! deliberately STAYS — clearing it would claim sessions ended when we merely
//! cannot see them. What must not stay is the claim that the plane is fine:
//! after `INVENTORY_FAULT_STREAK` consecutive failures the unit reports
//! `degraded` carrying the pump's own error, and the next successful reconcile
//! clears it. Health is COMPOSED rather than overwritten (`Shared::health`), so
//! the serve task and the pump each state what they know and neither clobbers
//! the other's news.

use crate::admission::AdmissionLedger;
use crate::cell::{CellCrumb, CellExitReport, CellHello};
use crate::config::NativeConfig;
use crate::contracts::ObservedTerminalCell;
use crate::contracts::{
    ObservedTerminal, TerminalCellRole, TerminalEndpoints, TerminalRouteCell,
    TerminalRouteSnapshot, TerminalWorkloadClass, UnitHealth, UnitState,
};
use crate::manager::NativeService;
use crate::registries;
use crate::resource_pressure::{
    self, CreateRefusal, FdPressureGauge, PressureClass, HIGH_WATER_PERCENT,
};
use crate::services::mesh::MeshHandle;
use crate::services::terminal_client::{ControlClient, SessionSummary};
use crate::services::terminal_mesh::{self, Attachment, MeshPlan};
use crate::state::DaemonState;
use ghosttea::{
    ipc, ServiceHandle, TerminalService, TerminalServiceConfig, TerminalServiceListeners,
    TextEngine,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
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

/// How often the unit samples its own descriptor pressure (TC-D6(e)).
///
/// The sample is a directory read of `/dev/fd`, which costs one descriptor and
/// no syscall a busy daemon would notice, so the interval is set by how quickly
/// the news should travel rather than by what it costs. Two seconds is inside
/// the human timescale of the health surface that reads it and well inside the
/// kill matrix's "< 2s" inventory row, so a plane that starts refusing creates
/// does not read `up` for a noticeable moment first.
const FD_SAMPLE_INTERVAL: Duration = Duration::from_secs(2);

/// How many consecutive failed inventory attempts make the plane DEGRADED
/// rather than momentarily torn.
///
/// A restart of the service itself tears this connection once and it is back
/// within `RECONNECT_DELAY`; announcing that as a degraded unit would be noise
/// on a plane that is fine. Three failures is ~1.5s of a floor that will not
/// answer `list-sessions`, which is well past any honest hiccup and still far
/// inside the human timescale of the health surface that reads it.
const INVENTORY_FAULT_STREAK: u32 = 3;

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

/// TC-S3 — one class plane's state, as its supervisor reports it. `Failed` is
/// the config-shaped dead end (no binary, unspellable run dir); `Crashed` is
/// the intensity dead end. The unit health composes across classes in
/// `Shared::set_class_state`.
#[derive(Clone)]
enum ClassPlaneState {
    Starting(String),
    Up(String),
    Failed(String),
    Crashed(String),
}

impl ClassPlaneState {
    fn detail(&self) -> &str {
        match self {
            ClassPlaneState::Starting(detail)
            | ClassPlaneState::Up(detail)
            | ClassPlaneState::Failed(detail)
            | ClassPlaneState::Crashed(detail) => detail,
        }
    }
}

fn class_label(class: TerminalWorkloadClass) -> &'static str {
    match class {
        TerminalWorkloadClass::Agent => "agent",
        TerminalWorkloadClass::Interactive => "interactive",
    }
}

/// TC-S3 — the snapshot's deterministic row order: interactive class host,
/// agent class host, then solos by instance. `cells[0]` therefore stays the
/// interactive host whenever one serves — the legacy single-cell mirror
/// (hello `terminal`, `terminal_endpoints_now`) keeps meaning "the cell every
/// legacy create lands on".
fn compose_route_rows(rows: &BTreeMap<u32, TerminalRouteCell>) -> Vec<TerminalRouteCell> {
    let mut cells: Vec<TerminalRouteCell> = rows.values().cloned().collect();
    cells.sort_by_key(|cell| {
        let solo = cell.role == Some(TerminalCellRole::Solo);
        let agent = cell.workload_class == Some(TerminalWorkloadClass::Agent);
        (solo, agent, cell.cell_instance_id)
    });
    cells
}

struct Shared {
    /// What the SERVE task knows — half of the unit's health, not all of it.
    /// `Shared::health` is what a reader gets; nothing outside this type sees
    /// either half alone.
    served: Mutex<UnitHealth>,
    /// pokes the daemon's health-refresh task (lib.rs) after every transition
    ping: UnboundedSender<()>,
    /// `None` only when the run directory cannot be expressed as the UTF-8
    /// string the contract (and ghosttea's config) require — the one path on
    /// which `HelloAck.terminal` is honestly absent.
    endpoints: Option<Endpoints>,
    /// TC-D3/TC-S2 — which serve shape this unit runs. Cell mode is the
    /// DEFAULT (the extraction); a mesh-requested boot keeps the in-process
    /// serve, because a cell cannot borrow the floor's tailnet node across a
    /// process boundary (the flagged fallback until the G14-class seam).
    cell_mode: bool,
    /// The supervisor's stop signal (cell mode): `stop()` flips it, the
    /// supervisor drops the cell's leash and waits out the drain budget.
    stopping: watch::Sender<bool>,
    /// TC-D15 (TC-S2) — the revisioned route snapshot the cell supervisor
    /// publishes: one row per live cell (K=2 class hosts + solos since
    /// TC-S3), revision bumped on EVERY transition. The in-process
    /// (mesh-flagged) mode never publishes past the {revision: 0, cells: []}
    /// initial — its legacy OnceLock reading stays the truth there. Readers:
    /// the mgmt hello and routes subscription (via DaemonState's receiver),
    /// and the inventory pump manager, which runs one pump per row.
    routes: watch::Sender<TerminalRouteSnapshot>,
    /// TC-S3 — the row registry behind `routes`: each cell task upserts its
    /// row at hello and removes it at its end; every mutation recomposes the
    /// snapshot in the deterministic order the create-target discipline
    /// assumes (interactive class, agent class, then solos by instance — so
    /// the legacy `cells[0]` mirror stays the interactive host).
    route_rows: Mutex<BTreeMap<u32, TerminalRouteCell>>,
    /// TC-S3 — how many cells are serving right now; the count behind the
    /// `serving` watch (any cell serving = the unit accepts work).
    serving_cells: Mutex<u32>,
    /// TC-S3 — per-class plane states, composed into the unit's health. Empty
    /// in legacy mode (the serve task writes `served` directly there).
    class_states: Mutex<BTreeMap<&'static str, ClassPlaneState>>,
    /// TC-S3 — per-cell session counts, maintained by the inventory pumps.
    /// The class supervisors watch it for solo target rotation (a target that
    /// gained its session stops being the target) and solo reaping (an
    /// emptied solo has nothing left to isolate).
    occupancy: watch::Sender<BTreeMap<u32, u32>>,
    /// TC-D4 — the Exact-only strike ledger, floor-lifetime. Only a crumb
    /// that NAMES a session writes here; Infrastructure/Unknown deaths blame
    /// nobody (row 13). Read at intensity breaches; kept whole for TC-S6's
    /// bisection history.
    strikes: Mutex<std::collections::HashMap<String, u32>>,
    /// TC-S3 — the shared instance allocator: ordinals are unique across
    /// classes and solos because they are also the socket-name suffixes
    /// (restart ≠ rebind holds fleet-wide, not per class).
    next_instance: std::sync::atomic::AtomicU32,
    /// TC-S3 — per-cell inventory-pump faults, composed into the single
    /// `inventory_fault` health cell (one truth for readers, per-cell news
    /// for diagnosis).
    inventory_faults: Mutex<BTreeMap<u32, String>>,
    /// A watch and not a flag: the inventory pump cannot start before the
    /// service accepts connections, so it is woken rather than left to poll.
    serving: watch::Sender<bool>,
    /// G7's drain handle, deposited by the serve task once `serve_managed`
    /// constructs the service. `stop` TAKES it — a taken handle is also how the
    /// serve task's end path tells a requested shutdown from a crash.
    drain: Mutex<Option<ServiceHandle>>,
    /// What the inventory pump knows and the serve task cannot see: the reason
    /// the observed inventory has stopped being maintained, or `None` while it
    /// is. A SECOND cell rather than a write into `served` on purpose — the two
    /// writers are independent, and either overwriting the other's state would
    /// lose exactly the news the reader needs.
    inventory_fault: Mutex<Option<String>>,
    /// TC-D6(e) — resource pressure, ONE CELL PER CLASS, for the same reason
    /// there is a second health cell at all: these writers are independent of
    /// the serve task, of the pump, and of each other. Descriptor pressure is
    /// measured by this process about itself; the PTY budget is a fact about the
    /// whole machine that the admission ledger owns. A plane serving perfectly
    /// while the machine has nothing left to give it is exactly the honest state
    /// the health surface exists for.
    ///
    /// Each detail carries a `RESOURCE_PRESSURE_STATES` spelling verbatim —
    /// that is what a reader matches on.
    fd_pressure: Mutex<Option<String>>,
    pty_pressure: Mutex<Option<String>>,
    /// The hysteresis behind `fd_pressure`, shared by BOTH of its writers: the
    /// periodic sampler and the immediate create-refusal path. If the refusal
    /// path set the cell without moving this gauge, the sampler would see no
    /// transition to report and the unit would stay degraded forever — health
    /// that cannot recover is not health.
    fd_gauge: Mutex<FdPressureGauge>,
}

impl Shared {
    fn set(&self, state: UnitState, detail: Option<String>) {
        *self.served.lock().unwrap() = UnitHealth {
            unit: UNIT_ID.to_string(),
            state,
            detail,
            auth_url: None,
        };
        let _ = self.ping.send(());
    }

    /// The pump's verdict on itself. Idempotent: an unchanged fault pings
    /// nobody, so the reconcile tick can assert "still fine" every 100ms
    /// without waking the health-refresh task.
    fn set_inventory_fault(&self, fault: Option<String>) {
        let mut held = self.inventory_fault.lock().unwrap();
        if *held == fault {
            return;
        }
        *held = fault;
        drop(held);
        let _ = self.ping.send(());
    }

    /// TC-D15 — announce the routes CAPABILITY: an empty snapshot at revision
    /// ≥1 tells fieldd "this floor speaks routes; no cell yet" — the evidence
    /// its cell-birth wait keys on. Idempotent past the first call.
    fn publish_routes_capability(&self) {
        self.routes.send_modify(|snapshot| {
            snapshot.revision += 1;
        });
    }

    /// TC-D15/TC-S3 — one route transition: upsert this cell's row and
    /// recompose. EVERY transition publishes (state transfer is the protocol —
    /// readers repair from any snapshot).
    fn route_upsert(&self, instance: u32, row: TerminalRouteCell) {
        let cells = {
            let mut rows = self.route_rows.lock().unwrap();
            rows.insert(instance, row);
            compose_route_rows(&rows)
        };
        self.routes.send_modify(|snapshot| {
            snapshot.revision += 1;
            snapshot.cells = cells;
        });
    }

    /// Returns whether a row was actually removed — a cell that never helloed
    /// published nothing, and its ending must not decrement the serving count
    /// it never incremented.
    fn route_remove(&self, instance: u32) -> bool {
        let cells = {
            let mut rows = self.route_rows.lock().unwrap();
            if rows.remove(&instance).is_none() {
                return false;
            }
            compose_route_rows(&rows)
        };
        self.routes.send_modify(|snapshot| {
            snapshot.revision += 1;
            snapshot.cells = cells;
        });
        true
    }

    /// TC-S3 — the serving watch counts cells now: the unit accepts work while
    /// ANY cell serves (per-class refusals are fieldd's routing business).
    fn cell_serving(&self, up: bool) {
        let mut count = self.serving_cells.lock().unwrap();
        *count = if up {
            *count + 1
        } else {
            count.saturating_sub(1)
        };
        self.serving.send_replace(*count > 0);
    }

    /// TC-S3 — one class's plane state moved; recompose the unit's health.
    /// The composition law: all Up → Up · all Crashed → Crashed · any
    /// Crashed/Failed → Degraded · else Starting. `Failed` is the config-shaped
    /// dead end (missing binary, unspellable run dir) and maps to Degraded
    /// even when every class hit it — a config problem is not a crash loop.
    fn set_class_state(&self, class: TerminalWorkloadClass, next: ClassPlaneState) {
        let mut states = self.class_states.lock().unwrap();
        states.insert(class_label(class), next);
        let all_up = states.values().all(|s| matches!(s, ClassPlaneState::Up(_)));
        let all_crashed = states
            .values()
            .all(|s| matches!(s, ClassPlaneState::Crashed(_)));
        let any_dead_end = states
            .values()
            .any(|s| matches!(s, ClassPlaneState::Crashed(_) | ClassPlaneState::Failed(_)));
        let state = if all_up {
            UnitState::Up
        } else if all_crashed && !states.is_empty() {
            UnitState::Crashed
        } else if any_dead_end {
            UnitState::Degraded
        } else {
            UnitState::Starting
        };
        let detail = states
            .iter()
            .map(|(label, s)| format!("{label}: {}", s.detail()))
            .collect::<Vec<_>>()
            .join("; ");
        drop(states);
        self.set(state, Some(detail));
    }

    /// TC-D4 — record an Exact strike. Only the Exact class ever reaches here;
    /// the return is the session's running count (logged, and TC-S6's
    /// bisection input).
    fn record_strike(&self, session_id: &str) -> u32 {
        let mut strikes = self.strikes.lock().unwrap();
        let count = strikes.entry(session_id.to_string()).or_insert(0);
        *count += 1;
        *count
    }

    fn alloc_instance(&self) -> u32 {
        self.next_instance
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1
    }

    /// TC-S3 — one cell pump's fault cell moved; recompose the single
    /// inventory-fault truth the health surface reads.
    fn set_cell_inventory_fault(&self, instance: u32, fault: Option<String>) {
        let composed = {
            let mut faults = self.inventory_faults.lock().unwrap();
            match fault {
                Some(fault) => {
                    faults.insert(instance, fault);
                }
                None => {
                    faults.remove(&instance);
                }
            }
            (!faults.is_empty()).then(|| {
                faults
                    .iter()
                    .map(|(instance, fault)| format!("cell {instance}: {fault}"))
                    .collect::<Vec<_>>()
                    .join("; ")
            })
        };
        self.set_inventory_fault(composed);
    }

    /// One descriptor-pressure sample. Runs the shared gauge and publishes only
    /// on a transition, so a sampler asserting "still fine" every two seconds
    /// wakes nobody.
    fn observe_fd_pressure(&self, open: u64, limit: u64) {
        let transition = self.fd_gauge.lock().unwrap().observe(open, limit);
        match transition {
            Some(true) => self.set_fd_pressure(Some(format!(
                "{}: {open} of {limit} descriptors are in use, past the {HIGH_WATER_PERCENT}% \
                 mark at which new sessions start being refused",
                PressureClass::FdPressure.as_str()
            ))),
            Some(false) => self.set_fd_pressure(None),
            None => {}
        }
    }

    /// The immediate half: a kernel refusal moves the SAME gauge, so the next
    /// sample below the low-water mark clears it through the ordinary path.
    fn note_fd_refusal(&self) {
        if self.fd_gauge.lock().unwrap().refused().is_some() {
            self.set_fd_pressure(Some(format!(
                "{}: the terminal floor refused a create because the machine is out of \
                 descriptors",
                PressureClass::FdPressure.as_str()
            )));
        }
    }

    fn set_fd_pressure(&self, detail: Option<String>) {
        let mut held = self.fd_pressure.lock().unwrap();
        if *held == detail {
            return;
        }
        *held = detail;
        drop(held);
        let _ = self.ping.send(());
    }

    /// The admission ledger's verdict on the machine-wide PTY budget. Idempotent
    /// for the same reason the fault cell is — the pump asserts it on every
    /// reconcile.
    fn set_pty_pressure(&self, detail: Option<String>) {
        let mut held = self.pty_pressure.lock().unwrap();
        if *held == detail {
            return;
        }
        *held = detail;
        drop(held);
        let _ = self.ping.send(());
    }

    /// The unit's health as a reader sees it: the serve task's state, corrected
    /// by what the pump and the pressure gauges know.
    ///
    /// A stale inventory or a resource ceiling only DOWNGRADES a serving floor —
    /// on any other base state the serve task is already telling the worse and
    /// truer story (`starting` has no inventory to be stale, `crashed`/`degraded`
    /// name a cause the others are merely symptoms of).
    ///
    /// Both corrections are reported when both hold. They are independent facts
    /// — a floor can be out of descriptors AND unable to list its sessions — and
    /// dropping either to keep the string short would hide the one the reader
    /// needed.
    fn health(&self) -> UnitHealth {
        let base = self.served.lock().unwrap().clone();
        if base.state != UnitState::Up {
            return base;
        }
        let fault = self.inventory_fault.lock().unwrap().clone();
        let fd = self.fd_pressure.lock().unwrap().clone();
        let pty = self.pty_pressure.lock().unwrap().clone();
        if fault.is_none() && fd.is_none() && pty.is_none() {
            return base;
        }
        let mut parts: Vec<String> = base.detail.iter().cloned().collect();
        if let Some(fault) = fault {
            parts.push(format!(
                "the observed inventory is no longer current: {fault}"
            ));
        }
        parts.extend(fd);
        parts.extend(pty);
        UnitHealth {
            state: UnitState::Degraded,
            detail: Some(parts.join("; ")),
            ..base
        }
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

    /// TC-D15 — the route snapshot watch, wired into DaemonState by bootstrap
    /// so the mgmt plane can serve hello + the routes subscription without
    /// learning how cells are supervised.
    pub fn routes_rx(&self) -> watch::Receiver<TerminalRouteSnapshot> {
        self.shared.routes.subscribe()
    }

    /// TC-D6(e), the immediate half: a create the kernel refused for
    /// descriptors puts the unit in `fd_pressure` NOW rather than at the next
    /// sample. A refusal is stronger evidence than any sample — it already
    /// happened — and the two-second interval is exactly the window in which a
    /// user would otherwise read `up` on a floor that just told them no.
    ///
    /// Anything the classifier could not name leaves health alone: an
    /// unclassified refusal is not evidence of pressure, and reporting one as
    /// pressure would send a reader hunting for a leak that is not there.
    pub fn note_create_refusal(&self, refusal: &CreateRefusal) {
        let Some(class) = refusal.pressure() else {
            return;
        };
        tracing::warn!(
            event = "field_native.terminal.create_refused",
            component = "terminal",
            state = class.as_str(),
            error = refusal.message(),
            "A terminal create was refused by a resource ceiling"
        );
        match class {
            PressureClass::FdPressure => self.shared.note_fd_refusal(),
            // The ledger owns this state and answers on every reconcile, so a
            // refusal carrying it needs no separate cell write — and inventing
            // one here would let a stale refusal outlive the budget that caused
            // it.
            PressureClass::PtyExhausted => {}
        }
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
    /// TC-S2 — held for the cell supervisor: per-instance endpoint resolution
    /// and the cell binary's location both come from the ONE derivation
    /// authority rather than being re-spelled here.
    config: NativeConfig,
}

impl TerminalUnit {
    pub fn new(config: &NativeConfig, ping: UnboundedSender<()>, mesh: MeshHandle) -> Self {
        let plan = MeshPlan::resolve(config);
        let mesh = (!plan.is_off()).then_some(mesh);
        // TC-D3/TC-S2: the extraction owns the DEFAULT path; a mesh-requested
        // boot keeps the in-process serve (the flagged fallback — a cell
        // cannot borrow the floor's tailnet node across a process boundary).
        let cell_mode = plan.is_off();
        let run_dir = config.run_dir();
        let config_file = config.terminal_config_file();
        // WIN-D1: endpoints come from the one resolution law in NativeConfig —
        // socket paths under the run dir on unix, scoped pipe names on win32.
        // Minted ONLY for the in-process mode: a cell resolves per-instance
        // names at each spawn, and leaving this `None` is what keeps the
        // legacy OnceLock/hello mirror empty on the cell path.
        let endpoints = (!cell_mode)
            .then(|| {
                config
                    .terminal_control_endpoint()
                    .zip(config.terminal_frame_endpoint())
                    .map(|(control, frame)| Endpoints {
                        control,
                        frame,
                        config: config_file.clone(),
                        token: mint_token(),
                    })
            })
            .flatten();
        let detail = (!cell_mode && endpoints.is_none()).then(|| {
            format!(
                "run directory is not valid UTF-8, which the endpoint contract requires: {}",
                run_dir.display()
            )
        });
        Self {
            shared: Arc::new(Shared {
                served: Mutex::new(UnitHealth {
                    unit: UNIT_ID.to_string(),
                    state: if cell_mode || endpoints.is_some() {
                        UnitState::Starting
                    } else {
                        UnitState::Degraded
                    },
                    detail,
                    auth_url: None,
                }),
                ping,
                endpoints,
                cell_mode,
                stopping: watch::channel(false).0,
                routes: watch::channel(TerminalRouteSnapshot {
                    revision: 0,
                    cells: Vec::new(),
                })
                .0,
                route_rows: Mutex::new(BTreeMap::new()),
                serving: watch::channel(false).0,
                serving_cells: Mutex::new(0),
                // Seeded so the composition has both classes from the first
                // health read — an absent class would compose as "all up" the
                // moment the other served.
                class_states: Mutex::new(if cell_mode {
                    BTreeMap::from([
                        (
                            class_label(TerminalWorkloadClass::Agent),
                            ClassPlaneState::Starting("spawning".into()),
                        ),
                        (
                            class_label(TerminalWorkloadClass::Interactive),
                            ClassPlaneState::Starting("spawning".into()),
                        ),
                    ])
                } else {
                    BTreeMap::new()
                }),
                occupancy: watch::channel(BTreeMap::new()).0,
                strikes: Mutex::new(std::collections::HashMap::new()),
                next_instance: std::sync::atomic::AtomicU32::new(0),
                inventory_faults: Mutex::new(BTreeMap::new()),
                drain: Mutex::new(None),
                inventory_fault: Mutex::new(None),
                fd_pressure: Mutex::new(None),
                pty_pressure: Mutex::new(None),
                fd_gauge: Mutex::new(FdPressureGauge::new()),
            }),
            tasks: Mutex::new(Vec::new()),
            plan,
            mesh,
            config: config.clone(),
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
        if self.shared.cell_mode {
            // TC-D3: the extraction path. The supervisor owns spawn, hello,
            // route publication, restart intensity, and the drain-on-stop;
            // this unit's health cells are its reporting surface.
            self.shared.set(
                UnitState::Starting,
                Some("spawning the terminal cell".into()),
            );
            let task = tokio::spawn(supervise_cells(self.shared.clone(), self.config.clone()));
            self.tasks.lock().unwrap().push(TaskGuard(task));
            let sampler = tokio::spawn(sample_fd_pressure(self.shared.clone()));
            self.tasks.lock().unwrap().push(TaskGuard(sampler));
            return Ok(());
        }
        let Some(endpoints) = self.shared.endpoints.clone() else {
            return Ok(()); // already degraded with the reason; nothing to bind
        };

        // An endpoint outlives the process that bound it on unix, so a host
        // that restarts replaces its own endpoints (ghosttea README, "Embedded
        // service mode"). Binding is deliberately OURS, not `run()`'s: this
        // daemon owns the endpoints and the start order — and ghosttea's
        // ipc::Listener does the platform work either way (unix socket, or a
        // windows pipe with the squat guard + CurrentUserOnly DACL), which is
        // what lets ownership stay here without a windows fork (WIN-D3).
        ipc::remove_stale_endpoint(&endpoints.control)?;
        ipc::remove_stale_endpoint(&endpoints.frame)?;
        let control = ipc::Listener::bind(&endpoints.control)?;
        let frames = ipc::Listener::bind(&endpoints.frame)?;
        #[cfg(unix)]
        {
            set_private_socket_permissions(&endpoints.control)?;
            set_private_socket_permissions(&endpoints.frame)?;
        }

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
        // TC-D6(e): started with the unit and torn down with it. It watches this
        // PROCESS's descriptors, which is what every PTY on this floor is spent
        // from, so it is the unit's own news rather than the pump's.
        let sampler = tokio::spawn(sample_fd_pressure(self.shared.clone()));
        self.tasks.lock().unwrap().push(TaskGuard(sampler));
        Ok(())
    }

    fn health(&self) -> UnitHealth {
        self.shared.health()
    }

    /// Stop = G7's drain, then teardown. No PTY survives field-native — the
    /// honest ceiling the product promises and nothing more. Taking the handle
    /// (not borrowing it) is deliberate: the serve task's end path reads
    /// `drain.is_none()` as "this ending was requested".
    async fn stop(&self) -> anyhow::Result<()> {
        if self.shared.cell_mode {
            // Ask, then wait bounded: the supervisor drops the cell's leash
            // (stdin EOF — the portable drain trigger) and publishes the empty
            // snapshot once the cell has exited; past DRAIN + EXIT_GRACE the
            // supervisor kills. The empty snapshot doubles as the completion
            // signal here, and the TaskGuard clear beneath reaps whatever a
            // pathological hang leaves.
            let _ = self.shared.stopping.send(true);
            let budget = Duration::from_millis(
                registries::cell_supervision::DRAIN_BUDGET_MS
                    + registries::cell_supervision::EXIT_GRACE_MS
                    + 1_000,
            );
            let mut rx = self.shared.routes.subscribe();
            let _ = tokio::time::timeout(budget, async {
                while !rx.borrow().cells.is_empty() {
                    if rx.changed().await.is_err() {
                        break;
                    }
                }
            })
            .await;
            self.tasks.lock().unwrap().clear();
            return Ok(());
        }
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
    control: ipc::Listener,
    frames: ipc::Listener,
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
        service.serve_managed(TerminalServiceListeners::new(control, frames));
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

/// TC-D6(e), the periodic half: watch this process's descriptor headroom and
/// put the honest state on the unit before the kernel starts refusing.
///
/// Sampling rather than counting: the daemon's descriptors are spent by PTYs,
/// sockets, log segments and whatever ghosttea opens per session, and a counter
/// this unit maintained would be a second source of truth that could only ever
/// drift from the one the kernel keeps. `/dev/fd` IS the kernel's answer.
///
/// A platform that cannot answer (win32 — see `resource_pressure`) simply never
/// reports, which leaves the unit saying exactly what it knows.
async fn sample_fd_pressure(shared: Arc<Shared>) {
    let mut ticker = tokio::time::interval(FD_SAMPLE_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        let (Some(own), Some(limit)) = (
            resource_pressure::open_fd_count(),
            resource_pressure::soft_fd_limit(),
        ) else {
            continue;
        };
        // TC-S2/S3: the PTY descriptors live in the CELLS now, so the gauge
        // reads the planes that actually spend them — the max across the floor
        // and every live cell against the (inherited) limit. A dead or
        // unreadable pid contributes nothing; the routes watch names them.
        let cell_pids: Vec<u32> = shared
            .routes
            .borrow()
            .cells
            .iter()
            .map(|cell| cell.pid as u32)
            .collect();
        let cells = cell_pids
            .into_iter()
            .filter_map(resource_pressure::open_fd_count_for)
            .max()
            .unwrap_or(0);
        shared.observe_fd_pressure(own.max(cells), limit);
    }
}

/// TC-S3 — what a cell is FOR: its class, and whether it is the shared class
/// host or a solo isolation host. Placement metadata only — cells are
/// byte-identical processes either way (class is a hint, never a permanent
/// failure domain: TC-D4).
#[derive(Clone, Copy, PartialEq, Eq)]
struct CellPlan {
    class: TerminalWorkloadClass,
    role: TerminalCellRole,
}

/// TC-D4 — how a cell death is classified at TC-S3 fidelity. `Exact` comes
/// only from a crumb NAMING a session; a sessionless crumb (the cell's own
/// panic hook) is `Infrastructure`; no evidence at all — a SIGKILL, an OOM
/// kill, a vanished process — is `Unknown`. Only Exact earns strikes; the
/// other two blame NO session, never "last active" (closure row 13).
/// Suspected/Cohort arrive with real cohort evidence at TC-S6.
#[derive(Clone)]
enum Attribution {
    Exact {
        session_id: String,
        detail: Option<String>,
    },
    Infrastructure {
        detail: String,
    },
    Unknown,
}

/// How one cell generation ended, as its own task classifies it.
enum CellEnd {
    /// The global stop or a targeted reap asked; the drain ran (or was
    /// escalated past); do not respawn.
    Stopped,
    /// The cell died or never came up — the detail is the receipt and the
    /// attribution is TC-D4's verdict on the evidence.
    Crashed {
        detail: String,
        attribution: Attribution,
    },
}

/// One cell task's final word to its class supervisor. Exactly one per
/// generation, sent after the route row is removed.
struct CellReport {
    instance: u32,
    end: CellEnd,
}

/// A live cell, as its class supervisor tracks it.
struct LiveCell {
    role: TerminalCellRole,
    /// The targeted-reap trigger (an emptied solo has nothing left to
    /// isolate; the global stop rides a different watch).
    reap: watch::Sender<bool>,
    /// Set once the occupancy watch shows a session on it: target→occupied
    /// rotates the spawn target, occupied→empty reaps.
    was_occupied: bool,
    _task: TaskGuard,
}

/// TC-S2/S3 — the cell supervisor: K=2 class supervisors over one instance
/// allocator and one composed route snapshot. Every transition publishes
/// routes (TC-D15: state transfer, never edges), and every ending is stated
/// on the unit's health cells.
async fn supervise_cells(shared: Arc<Shared>, config: NativeConfig) {
    // Announce the ROUTES CAPABILITY before the first cell exists: an empty
    // snapshot at revision 1 tells fieldd "this floor speaks TC-D15; no cell
    // YET" — the evidence its cell-birth wait keys on. A floor with no
    // terminal at all never publishes, and stays honestly absent.
    shared.publish_routes_capability();
    let mut agent = TaskGuard(tokio::spawn(supervise_class(
        shared.clone(),
        config.clone(),
        TerminalWorkloadClass::Agent,
    )));
    let mut interactive = TaskGuard(tokio::spawn(supervise_class(
        shared.clone(),
        config,
        TerminalWorkloadClass::Interactive,
    )));
    // Join both: each returns on the global stop or its own dead end. If THIS
    // task is aborted instead (unit drop without stop), the guards abort the
    // supervisors and every cell task with them — and each dropped task drops
    // its child's stdin, which is the leash: the cells drain themselves out.
    let _ = (&mut agent.0).await;
    let _ = (&mut interactive.0).await;
}

/// One class's supervisor: keep the shared class host up under intensity
/// bounds; on a breach WITH an Exact offender, switch to spawn-isolation
/// (solo cells) for the window; on a breach without one, stop and say so —
/// no session is blamed without evidence (TC-D4, row 13). A class that
/// reached either dead end still services its lingering solos until the
/// global stop.
async fn supervise_class(shared: Arc<Shared>, config: NativeConfig, class: TerminalWorkloadClass) {
    let mut stopping = shared.stopping.subscribe();
    let mut occupancy = shared.occupancy.subscribe();
    let (report_tx, mut report_rx) = tokio::sync::mpsc::unbounded_channel::<CellReport>();
    let respawn_window = Duration::from_millis(registries::cell_supervision::RESPAWN_WINDOW_MS);
    // Intensity BEFORE each spawn (starts, not deaths — the S2 law), and the
    // window's Exact evidence beside it, freshest last.
    let mut starts: Vec<Instant> = Vec::new();
    let mut exact_in_window: Vec<(Instant, String)> = Vec::new();
    // Every live cell this class owns; the shared host is named separately.
    let mut cells: BTreeMap<u32, LiveCell> = BTreeMap::new();
    let mut shared_cell: Option<u32> = None;

    'life: loop {
        if *stopping.borrow() {
            break 'life;
        }
        // A cell that keeps dying must not consume the machine in a tight
        // loop, and the refusal names the numbers.
        let now = Instant::now();
        starts.retain(|started| now.duration_since(*started) < respawn_window);
        exact_in_window.retain(|(at, _)| now.duration_since(*at) < respawn_window);
        if starts.len() >= registries::cell_supervision::RESPAWN_MAX as usize {
            match exact_in_window.last().cloned() {
                // TC-S3 — the breach has an Exact offender: spawn-isolation
                // instead of the dead end. The class keeps serving, and the
                // recurring workload can only crash itself.
                Some((_, offender)) => {
                    let end = run_isolation(
                        &shared,
                        &config,
                        class,
                        &offender,
                        &mut cells,
                        &mut report_rx,
                        &report_tx,
                        &mut occupancy,
                        &mut stopping,
                        &mut exact_in_window,
                    )
                    .await;
                    match end {
                        IsolationEnd::StopRequested => break 'life,
                        IsolationEnd::WindowElapsed => {
                            starts.clear();
                            exact_in_window.clear();
                            shared.set_class_state(
                                class,
                                ClassPlaneState::Starting(
                                    "isolation window elapsed; restoring the shared class host"
                                        .into(),
                                ),
                            );
                            continue 'life;
                        }
                        IsolationEnd::GaveOut => {
                            park_with_solos(
                                &shared,
                                &mut cells,
                                &mut report_rx,
                                &mut occupancy,
                                &mut stopping,
                                &mut exact_in_window,
                            )
                            .await;
                            break 'life;
                        }
                    }
                }
                None => {
                    // No Exact evidence: no isolation and NO blame — the
                    // honest dead end (row 13's first half). The floor's own
                    // supervisor one level up owns the next move.
                    shared.set_class_state(
                        class,
                        ClassPlaneState::Crashed(format!(
                            "terminal cell restart intensity exceeded ({} starts in {:?}) with \
                             no attributable offender; not respawning — no session is blamed \
                             without Exact evidence (TC-D4)",
                            starts.len(),
                            respawn_window
                        )),
                    );
                    park_with_solos(
                        &shared,
                        &mut cells,
                        &mut report_rx,
                        &mut occupancy,
                        &mut stopping,
                        &mut exact_in_window,
                    )
                    .await;
                    break 'life;
                }
            }
        }
        starts.push(now);
        let instance = shared.alloc_instance();
        let (reap_tx, reap_rx) = watch::channel(false);
        let plan = CellPlan {
            class,
            role: TerminalCellRole::Class,
        };
        match spawn_cell_task(&shared, &config, plan, instance, reap_rx, report_tx.clone()) {
            Ok(task) => {
                cells.insert(
                    instance,
                    LiveCell {
                        role: TerminalCellRole::Class,
                        reap: reap_tx,
                        was_occupied: false,
                        _task: task,
                    },
                );
                shared_cell = Some(instance);
            }
            Err(state) => {
                // Config-shaped dead end (no binary, unspellable run dir):
                // surfaced, not retried — retrying cannot find a binary.
                shared.set_class_state(class, state);
                park_with_solos(
                    &shared,
                    &mut cells,
                    &mut report_rx,
                    &mut occupancy,
                    &mut stopping,
                    &mut exact_in_window,
                )
                .await;
                break 'life;
            }
        }
        // Wait for the shared host's ending while servicing solo lifecycle
        // (lingering solos from an earlier isolation live here too).
        loop {
            tokio::select! {
                report = report_rx.recv() => {
                    let Some(report) = report else { break 'life };
                    cells.remove(&report.instance);
                    if shared_cell == Some(report.instance) {
                        shared_cell = None;
                        match report.end {
                            CellEnd::Stopped => break 'life,
                            CellEnd::Crashed { detail, attribution } => {
                                note_cell_crash(
                                    &shared,
                                    class,
                                    TerminalCellRole::Class,
                                    report.instance,
                                    &detail,
                                    &attribution,
                                    &mut exact_in_window,
                                );
                                shared.set_class_state(
                                    class,
                                    ClassPlaneState::Starting(format!(
                                        "cell exited ({detail}); respawning"
                                    )),
                                );
                                continue 'life;
                            }
                        }
                    } else {
                        note_solo_end(&shared, class, report, &mut exact_in_window);
                    }
                }
                changed = occupancy.changed() => {
                    if changed.is_err() { break 'life; }
                    let occ = occupancy.borrow_and_update().clone();
                    rotate_and_reap_solos(&mut cells, &occ, None);
                }
                // Wrapped so the arm's OUTPUT is `()`: `wait_for` yields a
                // watch Ref (an RwLock read guard), and select keeps arm
                // outputs alive through the arm body.
                _ = async { let _ = stopping.wait_for(|stop| *stop).await; } => break 'life,
            }
        }
    }
    // The stop path: every cell task watches the same stopping watch and
    // drains itself; collect their endings (bounded) so each row is removed
    // by its owner — which is what stop()'s routes-empty wait observes.
    let deadline = tokio::time::Instant::now()
        + Duration::from_millis(
            registries::cell_supervision::DRAIN_BUDGET_MS
                + registries::cell_supervision::EXIT_GRACE_MS
                + 1_000,
        );
    while shared_cell.is_some() || !cells.is_empty() {
        match tokio::time::timeout_at(deadline, report_rx.recv()).await {
            Ok(Some(report)) => {
                cells.remove(&report.instance);
                if shared_cell == Some(report.instance) {
                    shared_cell = None;
                }
            }
            Ok(None) | Err(_) => break,
        }
    }
}

/// Why an isolation episode ended.
enum IsolationEnd {
    StopRequested,
    WindowElapsed,
    /// The empty target itself kept dying, or a config dead end — the class
    /// state carries the receipt.
    GaveOut,
}

/// TC-S3/TC-D4 — spawn-isolation: the class's creates land on a chain of
/// fresh single-session solo cells, so the recurring poison workload can only
/// crash itself. The chain: one EMPTY target at a time; the moment it takes a
/// session, a new empty target spawns (the create-target discipline — the
/// highest-instance solo row is always the empty one). Occupied solos serve
/// their one session until it ends, then reap. MAX_SOLO_CELLS is the
/// TC-D6(f) bound: at the cap the newest solo stays target as the honest
/// overflow, logged.
#[allow(clippy::too_many_arguments)]
async fn run_isolation(
    shared: &Arc<Shared>,
    config: &NativeConfig,
    class: TerminalWorkloadClass,
    offender: &str,
    cells: &mut BTreeMap<u32, LiveCell>,
    report_rx: &mut tokio::sync::mpsc::UnboundedReceiver<CellReport>,
    report_tx: &tokio::sync::mpsc::UnboundedSender<CellReport>,
    occupancy: &mut watch::Receiver<BTreeMap<u32, u32>>,
    stopping: &mut watch::Receiver<bool>,
    exact_in_window: &mut Vec<(Instant, String)>,
) -> IsolationEnd {
    let label = class_label(class);
    let window = config.isolation_window();
    let deadline = tokio::time::Instant::now() + window;
    tracing::warn!(
        event = "field_native.terminal.isolation_entered",
        component = "terminal",
        class = label,
        offender_session_id = %offender,
        window_ms = window.as_millis() as u64,
        max_solo_cells = registries::cell_isolation::MAX_SOLO_CELLS,
        "Restart intensity breached with an Exact offender; the class moves to solo placement \
         (TC-D4 spawn-isolation)"
    );
    let mut routes = shared.routes.subscribe();
    let mut target: Option<u32> = None;
    let mut target_starts: Vec<Instant> = Vec::new();
    let mut overflow_logged = false;
    let respawn_window = Duration::from_millis(registries::cell_supervision::RESPAWN_WINDOW_MS);
    loop {
        if *stopping.borrow() {
            return IsolationEnd::StopRequested;
        }
        // Ensure a spawn target exists, within the TC-D6(f) bound.
        if target.is_none() {
            let live_solos = cells
                .values()
                .filter(|cell| cell.role == TerminalCellRole::Solo)
                .count();
            if live_solos >= registries::cell_isolation::MAX_SOLO_CELLS as usize {
                if !overflow_logged {
                    overflow_logged = true;
                    tracing::warn!(
                        event = "field_native.terminal.isolation_overflow",
                        component = "terminal",
                        class = label,
                        cap = registries::cell_isolation::MAX_SOLO_CELLS,
                        "The solo-cell cap is reached; the newest solo is the shared overflow \
                         target until one empties"
                    );
                }
            } else {
                // An empty target that keeps dying is its own intensity case:
                // nothing is on it, so nothing is blamed — the class gives
                // out honestly.
                let now = Instant::now();
                target_starts.retain(|started| now.duration_since(*started) < respawn_window);
                if target_starts.len() >= registries::cell_supervision::RESPAWN_MAX as usize {
                    shared.set_class_state(
                        class,
                        ClassPlaneState::Crashed(format!(
                            "the isolation target cell keeps dying empty ({} starts in {:?}); \
                             not respawning",
                            target_starts.len(),
                            respawn_window
                        )),
                    );
                    return IsolationEnd::GaveOut;
                }
                target_starts.push(now);
                let instance = shared.alloc_instance();
                let (reap_tx, reap_rx) = watch::channel(false);
                let plan = CellPlan {
                    class,
                    role: TerminalCellRole::Solo,
                };
                match spawn_cell_task(shared, config, plan, instance, reap_rx, report_tx.clone()) {
                    Ok(task) => {
                        cells.insert(
                            instance,
                            LiveCell {
                                role: TerminalCellRole::Solo,
                                reap: reap_tx,
                                was_occupied: false,
                                _task: task,
                            },
                        );
                        target = Some(instance);
                    }
                    Err(state) => {
                        shared.set_class_state(class, state);
                        return IsolationEnd::GaveOut;
                    }
                }
            }
        }
        tokio::select! {
            report = report_rx.recv() => {
                let Some(report) = report else { return IsolationEnd::StopRequested };
                cells.remove(&report.instance);
                if target == Some(report.instance) {
                    target = None;
                }
                note_solo_end(shared, class, report, exact_in_window);
            }
            changed = occupancy.changed() => {
                if changed.is_err() { return IsolationEnd::StopRequested; }
                let occ = occupancy.borrow_and_update().clone();
                if let Some(current) = target {
                    if occ.get(&current).copied().unwrap_or(0) > 0 {
                        if let Some(cell) = cells.get_mut(&current) {
                            cell.was_occupied = true;
                        }
                        // Rotate: the occupied solo keeps its session; the
                        // next loop iteration spawns a fresh empty target.
                        target = None;
                    }
                }
                rotate_and_reap_solos(cells, &occ, target);
            }
            changed = routes.changed() => {
                if changed.is_err() { return IsolationEnd::StopRequested; }
                // The target's row appearing is its hello: the class is
                // serving again, in isolation posture — said so, honestly.
                if let Some(current) = target {
                    let serving = routes
                        .borrow_and_update()
                        .cells
                        .iter()
                        .any(|cell| cell.cell_instance_id == i64::from(current));
                    if serving {
                        shared.set_class_state(
                            class,
                            ClassPlaneState::Up(format!(
                                "isolating (offender {offender} contained; solo placement until \
                                 the window elapses)"
                            )),
                        );
                    }
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                // Exit: reap the empty target (nothing on it); occupied solos
                // live on until their sessions end. The shared class host
                // returns in the caller.
                if let Some(current) = target.take() {
                    if let Some(cell) = cells.get(&current) {
                        if !cell.was_occupied {
                            let _ = cell.reap.send(true);
                        }
                    }
                }
                tracing::info!(
                    event = "field_native.terminal.isolation_exited",
                    component = "terminal",
                    class = label,
                    occupied_solos = cells.values().filter(|cell| cell.was_occupied).count(),
                    "The isolation window elapsed; the shared class host returns"
                );
                return IsolationEnd::WindowElapsed;
            }
            _ = async { let _ = stopping.wait_for(|stop| *stop).await; } => {
                return IsolationEnd::StopRequested;
            }
        }
    }
}

/// A class that reached its dead end still owes its lingering solos their
/// lifecycle: their sessions keep serving, their endings are classified, and
/// they reap as they empty — until the global stop.
async fn park_with_solos(
    shared: &Arc<Shared>,
    cells: &mut BTreeMap<u32, LiveCell>,
    report_rx: &mut tokio::sync::mpsc::UnboundedReceiver<CellReport>,
    occupancy: &mut watch::Receiver<BTreeMap<u32, u32>>,
    stopping: &mut watch::Receiver<bool>,
    exact_in_window: &mut Vec<(Instant, String)>,
) {
    loop {
        if *stopping.borrow() {
            return;
        }
        tokio::select! {
            report = report_rx.recv() => {
                let Some(report) = report else { return };
                cells.remove(&report.instance);
                // The class label on the receipt is knowable from the row the
                // cell published; Unknown-class here would be over-modeling —
                // the receipt carries the instance either way.
                if let CellEnd::Crashed { detail, attribution } = report.end {
                    note_cell_crash(
                        shared,
                        TerminalWorkloadClass::Interactive,
                        TerminalCellRole::Solo,
                        report.instance,
                        &detail,
                        &attribution,
                        exact_in_window,
                    );
                }
            }
            changed = occupancy.changed() => {
                if changed.is_err() { return; }
                let occ = occupancy.borrow_and_update().clone();
                rotate_and_reap_solos(cells, &occ, None);
            }
            _ = async { let _ = stopping.wait_for(|stop| *stop).await; } => return,
        }
    }
}

/// TC-S3 — reap solos with nothing left to isolate: a solo that HAS held a
/// session and now holds none is done. The empty spawn TARGET is excluded —
/// empty is its job.
fn rotate_and_reap_solos(
    cells: &mut BTreeMap<u32, LiveCell>,
    occupancy: &BTreeMap<u32, u32>,
    target: Option<u32>,
) {
    for (instance, cell) in cells.iter_mut() {
        if cell.role != TerminalCellRole::Solo || Some(*instance) == target {
            continue;
        }
        match occupancy.get(instance).copied() {
            Some(count) if count > 0 => cell.was_occupied = true,
            Some(0) if cell.was_occupied => {
                // Idempotent: a watch resend is a no-op downstream.
                let _ = cell.reap.send(true);
            }
            _ => {}
        }
    }
}

/// One solo ending, classified and logged; a reaped (Stopped) solo is the
/// planned ending and says nothing.
fn note_solo_end(
    shared: &Arc<Shared>,
    class: TerminalWorkloadClass,
    report: CellReport,
    exact_in_window: &mut Vec<(Instant, String)>,
) {
    if let CellEnd::Crashed {
        detail,
        attribution,
    } = report.end
    {
        note_cell_crash(
            shared,
            class,
            TerminalCellRole::Solo,
            report.instance,
            &detail,
            &attribution,
            exact_in_window,
        );
    }
}

/// The crash receipt: sessions on the cell are gone (the S2/S3 honest
/// ceiling), the attribution is TC-D4's verdict, and ONLY Exact writes the
/// strike ledger.
fn note_cell_crash(
    shared: &Arc<Shared>,
    class: TerminalWorkloadClass,
    role: TerminalCellRole,
    instance: u32,
    detail: &str,
    attribution: &Attribution,
    exact_in_window: &mut Vec<(Instant, String)>,
) {
    let label = class_label(class);
    let role_label = match role {
        TerminalCellRole::Class => "class",
        TerminalCellRole::Solo => "solo",
    };
    match attribution {
        Attribution::Exact {
            session_id,
            detail: evidence,
        } => {
            let strikes = shared.record_strike(session_id);
            exact_in_window.push((Instant::now(), session_id.clone()));
            tracing::error!(
                event = "field_native.terminal.cell_ended",
                component = "terminal",
                class = label,
                role = role_label,
                instance,
                detail = %detail,
                attribution = "exact",
                session_id = %session_id,
                strikes,
                evidence = evidence.as_deref().unwrap_or(""),
                "The terminal cell ended; sessions on it are gone (the honest ceiling) — \
                 attributed Exact, one strike recorded (TC-D4)"
            );
        }
        Attribution::Infrastructure { detail: why } => tracing::error!(
            event = "field_native.terminal.cell_ended",
            component = "terminal",
            class = label,
            role = role_label,
            instance,
            detail = %detail,
            attribution = "infrastructure",
            evidence = %why,
            "The terminal cell ended; sessions on it are gone (the honest ceiling) — \
             Infrastructure blames NO session (TC-D4, row 13)"
        ),
        Attribution::Unknown => tracing::error!(
            event = "field_native.terminal.cell_ended",
            component = "terminal",
            class = label,
            role = role_label,
            instance,
            detail = %detail,
            attribution = "unknown",
            "The terminal cell ended; sessions on it are gone (the honest ceiling) — \
             no evidence, no blame (TC-D4, row 13; never last-active)"
        ),
    }
}

/// Resolve one cell's spawn inputs and start its generation task. The Err is
/// the class-plane state to surface — config-shaped dead ends, not crashes.
fn spawn_cell_task(
    shared: &Arc<Shared>,
    config: &NativeConfig,
    plan: CellPlan,
    instance: u32,
    reap: watch::Receiver<bool>,
    report: tokio::sync::mpsc::UnboundedSender<CellReport>,
) -> Result<TaskGuard, ClassPlaneState> {
    let Some(bin) = config.cell_binary() else {
        return Err(ClassPlaneState::Failed(
            "the field-terminal-host binary cannot be located beside this executable".into(),
        ));
    };
    let (Some(control), Some(frame)) = (
        config.terminal_cell_control_endpoint(instance),
        config.terminal_cell_frame_endpoint(instance),
    ) else {
        return Err(ClassPlaneState::Failed(format!(
            "run directory is not valid UTF-8, which the endpoint contract requires: {}",
            config.run_dir().display()
        )));
    };
    let crumb = config.terminal_cell_crumb_file(instance);
    let config_file = config.terminal_config_file();
    Ok(TaskGuard(tokio::spawn(run_cell_generation(
        shared.clone(),
        plan,
        instance,
        bin,
        control,
        frame,
        config_file,
        crumb,
        reap,
        report,
    ))))
}

/// One cell generation, spawn to grave, as its own task. Owns its route row
/// (upsert at hello, remove at the end) and always sends exactly one report.
#[allow(clippy::too_many_arguments)]
async fn run_cell_generation(
    shared: Arc<Shared>,
    plan: CellPlan,
    instance: u32,
    bin: PathBuf,
    control: String,
    frame: String,
    config_file: PathBuf,
    crumb: PathBuf,
    mut reap: watch::Receiver<bool>,
    report: tokio::sync::mpsc::UnboundedSender<CellReport>,
) {
    let end = run_cell_generation_inner(
        &shared,
        plan,
        instance,
        &bin,
        &control,
        &frame,
        &config_file,
        &crumb,
        &mut reap,
    )
    .await;
    if shared.route_remove(instance) {
        shared.cell_serving(false);
    }
    let _ = report.send(CellReport { instance, end });
}

#[allow(clippy::too_many_arguments)]
async fn run_cell_generation_inner(
    shared: &Arc<Shared>,
    plan: CellPlan,
    instance: u32,
    bin: &std::path::Path,
    control: &str,
    frame: &str,
    config_file: &std::path::Path,
    crumb: &std::path::Path,
    reap: &mut watch::Receiver<bool>,
) -> CellEnd {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let mut stopping = shared.stopping.subscribe();
    // A stale crumb from a re-used ordinal after an unclean floor boot must
    // not color this generation (the cell also fences by boot id).
    let _ = std::fs::remove_file(crumb);
    let token = mint_token();
    let mut child = match tokio::process::Command::new(bin)
        .arg("--control")
        .arg(control)
        .arg("--frame")
        .arg(frame)
        .arg("--config")
        .arg(config_file)
        .arg("--instance")
        .arg(instance.to_string())
        .arg("--crumb")
        .arg(crumb)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return CellEnd::Crashed {
                detail: format!("spawn failed: {error}"),
                attribution: Attribution::Unknown,
            }
        }
    };
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    // The cell's diagnostics become the floor's, labeled — the parent owns log
    // routing (the cell writes plain lines to its stderr). The guard lives to
    // the end of this generation.
    let _stderr_forward = TaskGuard(tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::info!(
                event = "field_native.terminal.cell_stderr",
                component = "terminal",
                instance,
                line = %line,
                "cell"
            );
        }
    }));
    // The bootstrap line: the token rides the pipe, never argv or env (EL7).
    let bootstrap = format!("{}\n", serde_json::json!({ "token": token }));
    if let Err(error) = stdin.write_all(bootstrap.as_bytes()).await {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return CellEnd::Crashed {
            detail: format!("bootstrap write failed: {error}"),
            attribution: read_crumb_attribution(crumb, None),
        };
    }
    let mut lines = BufReader::new(stdout).lines();
    let hello_deadline = Duration::from_millis(registries::cell_supervision::HELLO_DEADLINE_MS);
    let hello: CellHello = match tokio::time::timeout(hello_deadline, lines.next_line()).await {
        Ok(Ok(Some(line))) => match serde_json::from_str(&line) {
            Ok(hello) => hello,
            Err(error) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                return CellEnd::Crashed {
                    detail: format!("hello did not parse: {error}"),
                    attribution: read_crumb_attribution(crumb, None),
                };
            }
        },
        Ok(Ok(None)) | Ok(Err(_)) => {
            let _ = child.wait().await;
            return CellEnd::Crashed {
                detail: "the cell exited before its hello".into(),
                attribution: read_crumb_attribution(crumb, None),
            };
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return CellEnd::Crashed {
                detail: format!("no hello within {hello_deadline:?} — killed"),
                attribution: read_crumb_attribution(crumb, None),
            };
        }
    };
    shared.route_upsert(
        instance,
        TerminalRouteCell {
            cell_boot_id: hello.cell_boot_id.clone(),
            cell_instance_id: i64::from(instance),
            pid: i64::from(hello.pid),
            endpoints: TerminalEndpoints {
                control_socket: control.to_string(),
                frame_socket: frame.to_string(),
                auth_token: token.clone(),
            },
            token_generation: i64::from(instance),
            workload_class: Some(plan.class),
            role: Some(plan.role),
        },
    );
    shared.cell_serving(true);
    if plan.role == TerminalCellRole::Class {
        shared.set_class_state(
            plan.class,
            ClassPlaneState::Up(format!("cell {instance} serving; pid {}", hello.pid)),
        );
    }
    tracing::info!(
        event = "field_native.terminal.cell_serving",
        component = "terminal",
        class = class_label(plan.class),
        role = match plan.role {
            TerminalCellRole::Class => "class",
            TerminalCellRole::Solo => "solo",
        },
        instance,
        pid = hello.pid,
        cell_boot_id = %hello.cell_boot_id,
        control_socket = %control,
        frame_socket = %frame,
        "The terminal cell is serving"
    );
    let drain_budget = Duration::from_millis(
        registries::cell_supervision::DRAIN_BUDGET_MS + registries::cell_supervision::EXIT_GRACE_MS,
    );
    // The two requested endings (global stop, targeted reap) share one drain.
    // Wrapped so each arm's OUTPUT is `()` — `wait_for` yields a watch Ref
    // (an RwLock read guard), and select keeps arm outputs alive through the
    // arm body.
    let requested = async {
        tokio::select! {
            _ = async { let _ = stopping.wait_for(|stop| *stop).await; } => {}
            _ = async { let _ = reap.wait_for(|reap| *reap).await; } => {}
        }
    };
    tokio::select! {
        _ = requested => {
            // The leash: EOF asks the cell to drain; past the budget, kill.
            drop(stdin);
            let waited = tokio::time::timeout(drain_budget, child.wait()).await;
            if waited.is_err() {
                let _ = child.start_kill();
                let _ = child.wait().await;
                tracing::warn!(
                    event = "field_native.terminal.cell_drain_overrun",
                    component = "terminal",
                    instance,
                    "The cell outlived its drain budget and was killed; drain unknown"
                );
            } else if let Ok(Ok(Some(line))) =
                tokio::time::timeout(Duration::from_millis(500), lines.next_line()).await
            {
                log_cell_exit_report(instance, &line);
            }
            CellEnd::Stopped
        }
        status = child.wait() => {
            // Crashed (a requested stop never reaches here first). The exit
            // report is best-effort — a SIGKILLed cell wrote none.
            let mut detail = format!("{status:?}");
            if let Ok(Ok(Some(line))) =
                tokio::time::timeout(Duration::from_millis(500), lines.next_line()).await
            {
                log_cell_exit_report(instance, &line);
                detail = format!("{detail}; {line}");
            }
            let attribution = read_crumb_attribution(crumb, Some(&hello.cell_boot_id));
            CellEnd::Crashed { detail, attribution }
        }
    }
}

/// TC-D4 at S3 fidelity: the crumb file is the only evidence. Naming a
/// session ⇒ Exact (the seam a custody-era cell will write through); the
/// cell's own panic hook writes the sessionless Infrastructure form; nothing
/// at all ⇒ Unknown. Consumed on read (delete), and a crumb from another
/// generation — boot id mismatch — is stale evidence that classifies nothing.
fn read_crumb_attribution(crumb: &std::path::Path, cell_boot_id: Option<&str>) -> Attribution {
    let raw = match std::fs::read_to_string(crumb) {
        Ok(raw) => raw,
        Err(_) => return Attribution::Unknown,
    };
    let _ = std::fs::remove_file(crumb);
    let parsed: CellCrumb = match serde_json::from_str(raw.trim()) {
        Ok(parsed) => parsed,
        Err(error) => {
            tracing::warn!(
                event = "field_native.terminal.crumb_unreadable",
                component = "terminal",
                error = %error,
                "A crash crumb did not parse; classifying Unknown"
            );
            return Attribution::Unknown;
        }
    };
    if let Some(expected) = cell_boot_id {
        if parsed.cell_boot_id != expected {
            return Attribution::Unknown;
        }
    }
    match parsed.session_id {
        Some(session_id) => Attribution::Exact {
            session_id,
            detail: parsed.detail,
        },
        None => Attribution::Infrastructure {
            detail: parsed
                .detail
                .unwrap_or_else(|| "a sessionless crumb with no detail".into()),
        },
    }
}

/// The cell's last stdout line, logged VERBATIM either way — `drained` carries
/// upstream's own report rendering, `drainUnknown` its honest absence; a line
/// that parses as neither is still worth keeping, unparsed.
fn log_cell_exit_report(instance: u32, line: &str) {
    match serde_json::from_str::<CellExitReport>(line) {
        Ok(report) => tracing::info!(
            event = "field_native.terminal.cell_exit_report",
            component = "terminal",
            instance,
            drained = report.drained.as_deref().unwrap_or(""),
            drain_unknown = report.drain_unknown.as_deref().unwrap_or(""),
            "The cell reported its ending"
        ),
        Err(_) => tracing::info!(
            event = "field_native.terminal.cell_exit_report",
            component = "terminal",
            instance,
            line = %line,
            "The cell's last line did not parse as an exit report"
        ),
    }
}

/// Wire the unit's inventory to the mgmt watch channel (NF-D7/§4.3). Called
/// from `bootstrap`, not from the unit, for the reason the lane transport is:
/// joining a unit to the mgmt plane is WIRING — the unit never learns what a
/// subscription is, and the mgmt facade never learns the control protocol.
pub fn install_inventory(
    handle: TerminalHandle,
    state: Arc<DaemonState>,
    ledger: Option<AdmissionLedger>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        // Legacy (in-process) mode dials a FIXED pair. Cell mode (TC-S3) runs
        // ONE PUMP PER ROUTE ROW — each cell's sessions are observed on that
        // cell's own control socket and merged under its `cell` tag; the pump
        // manager follows the snapshot (TC-D15's re-read law, floor-side). A
        // unit that is neither (the non-UTF-8 degraded case) parks forever.
        let legacy = handle.shared.endpoints.clone();
        if let Some(endpoints) = legacy {
            legacy_inventory_loop(handle, state, ledger, endpoints).await;
            return;
        }
        if !handle.shared.cell_mode {
            std::future::pending::<()>().await;
            return;
        }
        let merged = Arc::new(MergedInventory::new(
            state,
            handle.shared.clone(),
            LedgerPump::new(ledger, handle.shared.clone()),
        ));
        let mut routes = handle.shared.routes.subscribe();
        let mut pumps: BTreeMap<u32, PumpEntry> = BTreeMap::new();
        loop {
            let desired: BTreeMap<u32, (String, TerminalEndpoints, ObservedTerminalCell)> = routes
                .borrow_and_update()
                .cells
                .iter()
                .map(|cell| {
                    (
                        cell.cell_instance_id as u32,
                        (
                            cell.cell_boot_id.clone(),
                            cell.endpoints.clone(),
                            ObservedTerminalCell {
                                cell_instance_id: cell.cell_instance_id,
                                cell_boot_id: cell.cell_boot_id.clone(),
                                workload_class: cell.workload_class,
                                role: cell.role,
                            },
                        ),
                    )
                })
                .collect();
            // A row that vanished took its sessions with it — cell death IS
            // session death at S3, and the snapshot is the supervisor's own
            // word — so the pump goes AND its rows go. This is deliberately
            // different from a mere connection fault (where the last inventory
            // stays): there the floor cannot see; here it knows. A row whose
            // boot id moved on a re-used ordinal is a different cell: same.
            let stale: Vec<u32> = pumps
                .iter()
                .filter(|(instance, entry)| {
                    desired
                        .get(instance)
                        .map(|(boot, _, _)| *boot != entry.cell_boot_id)
                        .unwrap_or(true)
                })
                .map(|(instance, _)| *instance)
                .collect();
            for instance in stale {
                pumps.remove(&instance);
                merged.remove(instance);
            }
            for (instance, (boot, endpoints, cell)) in &desired {
                if !pumps.contains_key(instance) {
                    let task = TaskGuard(tokio::spawn(pump_cell(
                        endpoints.clone(),
                        cell.clone(),
                        *instance,
                        merged.clone(),
                    )));
                    pumps.insert(
                        *instance,
                        PumpEntry {
                            cell_boot_id: boot.clone(),
                            _task: task,
                        },
                    );
                }
            }
            if routes.changed().await.is_err() {
                return;
            }
        }
    })
}

/// One live per-cell pump, keyed to the boot id it was spawned for.
struct PumpEntry {
    cell_boot_id: String,
    _task: TaskGuard,
}

/// The S2 single-plane loop, unchanged: wait until the in-process service
/// serves, dial the fixed pair, pump, reconnect on failure.
async fn legacy_inventory_loop(
    handle: TerminalHandle,
    state: Arc<DaemonState>,
    ledger: Option<AdmissionLedger>,
    endpoints: Endpoints,
) {
    let mut watch = InventoryWatch::new(handle.clone());
    let mut admission = LedgerPump::new(ledger, handle.shared.clone());
    loop {
        // Inside the loop, not before it: a torn connection reconnects at
        // once while the service is still up, and a service that DIED parks
        // here forever instead of dialing a dead socket twice a second. The
        // unit's health already says the plane is gone; a retry storm would
        // only add noise to a fact fieldd has.
        handle.wait_until_serving().await;
        // Dialing here rather than inside the pump is what lets a failed
        // DIAL be told apart from a pump that ran and then broke.
        match ControlClient::connect(&endpoints.control, &endpoints.token).await {
            Ok((client, events)) => {
                match pump_inventory(Arc::new(client), events, &state, &mut watch, &mut admission)
                    .await
                {
                    Ok(()) => watch.disconnected(),
                    Err(error) => watch.failed(&error),
                }
            }
            Err(error) => watch.failed(&error),
        }
        // The last published inventory deliberately STAYS. A dead control
        // connection does not kill PTYs, so clearing the rows would claim
        // sessions ended when we simply cannot see them. What does NOT stay
        // is the claim that the plane is fine: past `INVENTORY_FAULT_STREAK`
        // the watch puts the pump's own error on the unit's health, which is
        // what carries "this plane is degraded" (honest states, not blanks).
        tokio::time::sleep(RECONNECT_DELAY).await;
    }
}

/// One cell's inventory pump: dial its fixed coordinates, subscribe,
/// reconcile — the S2 loop bound to one cell, publishing under its tag. The
/// manager aborts this task when the row leaves the snapshot, so a dead
/// cell's socket is never redialed forever.
async fn pump_cell(
    endpoints: TerminalEndpoints,
    cell: ObservedTerminalCell,
    instance: u32,
    merged: Arc<MergedInventory>,
) {
    let mut watch = InventoryWatch::for_cell(instance, merged.shared());
    loop {
        match ControlClient::connect(&endpoints.control_socket, &endpoints.auth_token).await {
            Ok((client, events)) => {
                match pump_inventory_cell(
                    Arc::new(client),
                    events,
                    instance,
                    &cell,
                    &merged,
                    &mut watch,
                )
                .await
                {
                    Ok(()) => watch.disconnected(),
                    Err(error) => watch.failed(&error),
                }
            }
            Err(error) => watch.failed(&error),
        }
        tokio::time::sleep(RECONNECT_DELAY).await;
    }
}

/// TC-S3 — the merged observed inventory. Every cell pump owns its rows here,
/// and every mutation republishes three composed truths at once: the observed
/// inventory (rows in instance order, each cell's rows session-sorted), the
/// per-cell occupancy watch the class supervisors rotate and reap on, and
/// this floor's TOTAL governed count into the admission ledger — one meaning
/// of "a session on this device" across all three (TC-L1f).
struct MergedInventory {
    state: Arc<DaemonState>,
    shared: Arc<Shared>,
    inner: Mutex<MergedInner>,
}

struct MergedInner {
    rows: BTreeMap<u32, Vec<ObservedTerminal>>,
    governed: BTreeMap<u32, u32>,
    ledger: LedgerPump,
}

impl MergedInventory {
    fn new(state: Arc<DaemonState>, shared: Arc<Shared>, ledger: LedgerPump) -> Self {
        Self {
            state,
            shared,
            inner: Mutex::new(MergedInner {
                rows: BTreeMap::new(),
                governed: BTreeMap::new(),
                ledger,
            }),
        }
    }

    fn shared(&self) -> Arc<Shared> {
        self.shared.clone()
    }

    fn set_rows(&self, instance: u32, rows: Vec<ObservedTerminal>) {
        let (composed, occupancy) = {
            let mut inner = self.inner.lock().unwrap();
            inner.rows.insert(instance, rows);
            (
                compose_observed(&inner.rows),
                compose_occupancy(&inner.rows),
            )
        };
        let count = composed.len();
        self.state
            .observed_tx
            .send_modify(|observed| observed.terminals = composed);
        self.shared.occupancy.send_replace(occupancy);
        tracing::debug!(
            event = "field_native.terminal.inventory_published",
            component = "terminal",
            terminals = count,
            "The terminal inventory changed"
        );
    }

    fn remove(&self, instance: u32) {
        let (composed, occupancy) = {
            let mut inner = self.inner.lock().unwrap();
            inner.rows.remove(&instance);
            inner.governed.remove(&instance);
            let total: u32 = inner.governed.values().sum();
            inner.ledger.observe(total);
            (
                compose_observed(&inner.rows),
                compose_occupancy(&inner.rows),
            )
        };
        self.state
            .observed_tx
            .send_modify(|observed| observed.terminals = composed);
        self.shared.occupancy.send_replace(occupancy);
        self.shared.set_cell_inventory_fault(instance, None);
    }

    fn observe_governed(&self, instance: u32, governed: u32) {
        let mut inner = self.inner.lock().unwrap();
        inner.governed.insert(instance, governed);
        let total: u32 = inner.governed.values().sum();
        inner.ledger.observe(total);
    }

    /// The pump's per-cell change guard seed (what this cell last published).
    fn rows_value(&self, instance: u32) -> Value {
        let inner = self.inner.lock().unwrap();
        inventory_value(inner.rows.get(&instance).map(Vec::as_slice).unwrap_or(&[]))
    }

    /// The session ids this CELL has already published — the per-cell memory
    /// behind the gap re-govern (GT-D11), captured before a reconcile applies.
    fn session_ids(&self, instance: u32) -> std::collections::HashSet<String> {
        let inner = self.inner.lock().unwrap();
        inner
            .rows
            .get(&instance)
            .map(|rows| rows.iter().map(|row| row.session_id.clone()).collect())
            .unwrap_or_default()
    }
}

fn compose_observed(rows: &BTreeMap<u32, Vec<ObservedTerminal>>) -> Vec<ObservedTerminal> {
    rows.values().flatten().cloned().collect()
}

fn compose_occupancy(rows: &BTreeMap<u32, Vec<ObservedTerminal>>) -> BTreeMap<u32, u32> {
    rows.iter()
        .map(|(instance, rows)| (*instance, rows.len() as u32))
        .collect()
}

/// How long the ledger may go untouched while this floor's own count is
/// unchanged. Another pair's sessions move the machine total without moving
/// ours, so "publish on change" alone would let this floor report `up` while the
/// machine had nothing left; a flock and a small JSON read at this cadence is
/// far cheaper than that dishonesty.
const LEDGER_INTERVAL: Duration = Duration::from_secs(5);

/// TC-L1f's production seam: this floor's claim on the machine-wide budget, kept
/// current from the inventory rather than from events.
///
/// `list-sessions` is truth (spec §10.5), so the ledger is TOLD the count
/// instead of trusted to have counted every create and exit. That is what makes
/// a missed event or a torn connection unable to leak budget: the next reconcile
/// corrects the entry outright.
///
/// A ledger failure is logged once per streak and never fatal. Admission is
/// advisory (the module note on `crate::admission`), so a floor that cannot
/// reach the file keeps serving with the kernel as its only authority — which is
/// exactly the guarantee that was there before the ledger existed.
struct LedgerPump {
    ledger: Option<AdmissionLedger>,
    shared: Arc<Shared>,
    published: Option<u32>,
    last: Option<Instant>,
    complained: bool,
}

impl LedgerPump {
    fn new(ledger: Option<AdmissionLedger>, shared: Arc<Shared>) -> Self {
        Self {
            ledger,
            shared,
            published: None,
            last: None,
            complained: false,
        }
    }

    /// Publish this floor's governed count and read back what the machine holds.
    fn observe(&mut self, governed: u32) {
        let Some(ledger) = self.ledger.as_ref() else {
            return;
        };
        let due = self
            .last
            .is_none_or(|last| last.elapsed() >= LEDGER_INTERVAL);
        if self.published == Some(governed) && !due {
            return;
        }
        self.last = Some(Instant::now());
        let outcome = ledger
            .publish(governed)
            .and_then(|_| ledger.machine_total());
        match outcome {
            Ok(machine_total) => {
                self.published = Some(governed);
                self.complained = false;
                let budget = ledger.budget();
                self.shared
                    .set_pty_pressure((machine_total >= budget).then(|| {
                        format!(
                            "{}: the machine-wide custody budget of {budget} PTYs is spent \
                         ({machine_total} held across every VibeField pair on this machine); \
                         new sessions are refused until one ends",
                            PressureClass::PtyExhausted.as_str()
                        )
                    }));
            }
            Err(error) => {
                // The count is NOT remembered as published on a failure, so the
                // next reconcile retries rather than believing a write that did
                // not happen.
                if !std::mem::replace(&mut self.complained, true) {
                    tracing::warn!(
                        event = "field_native.admission.unavailable",
                        component = "terminal",
                        ledger = %ledger.path().display(),
                        error = %error,
                        "The machine-wide admission ledger could not be updated; the kernel \
                         remains the only admission authority"
                    );
                }
            }
        }
    }
}

/// The pump's bookkeeping across reconnects: how long it has been failing,
/// whether that streak still owes a recovery line, and — since GT-5d — the unit
/// health a permanent failure lands on.
///
/// A dead plane is dialed twice a second forever, so warning on every attempt is
/// ~172k lines a day against the LOG soak gate: the FIRST failure of a streak is
/// the news, the rest are debug carrying the attempt count so the streak's
/// length stays recoverable from the log, and the recovery is news again exactly
/// once.
struct InventoryWatch {
    sink: FaultSink,
    failures: u32,
    recovery_owed: bool,
}

/// TC-S3 — where a pump's fault verdict lands: the unit's single fault cell
/// (legacy mode) or the per-cell composition (cell mode). Same streak logic
/// either way; only the sink differs.
enum FaultSink {
    Unit(TerminalHandle),
    Cell { instance: u32, shared: Arc<Shared> },
}

impl FaultSink {
    fn set(&self, fault: Option<String>) {
        match self {
            FaultSink::Unit(handle) => handle.shared.set_inventory_fault(fault),
            FaultSink::Cell { instance, shared } => {
                shared.set_cell_inventory_fault(*instance, fault)
            }
        }
    }
}

impl InventoryWatch {
    fn new(handle: TerminalHandle) -> Self {
        Self {
            sink: FaultSink::Unit(handle),
            failures: 0,
            recovery_owed: false,
        }
    }

    fn for_cell(instance: u32, shared: Arc<Shared>) -> Self {
        Self {
            sink: FaultSink::Cell { instance, shared },
            failures: 0,
            recovery_owed: false,
        }
    }

    /// One failed attempt — a dial that never landed, or a pump that ran and
    /// then broke. Past the streak the unit says so: a frozen inventory under a
    /// unit reading `up` is exactly the dishonest state this exists to prevent.
    fn failed(&mut self, error: &anyhow::Error) {
        self.failures += 1;
        if self.failures == 1 {
            self.recovery_owed = true;
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
                attempts = self.failures,
                error = %error,
                "The terminal inventory pump is still failing; reconnecting"
            );
        }
        if self.failures >= INVENTORY_FAULT_STREAK {
            self.sink.set(Some(format!("{error:#}")));
        }
    }

    /// A `list-sessions` answered and its snapshot was applied: the observed
    /// rows are current again. Recovery is dated from HERE and not from the
    /// dial, because a socket that opened and then said nothing useful has
    /// recovered nothing — and the streak restarts, so a plane that reconciles
    /// once between failures has to earn its degraded state again.
    fn reconciled(&mut self) {
        self.sink.set(None);
        if self.recovery_owed {
            self.recovery_owed = false;
            tracing::info!(
                event = "field_native.terminal.inventory_reconnected",
                component = "terminal",
                after_failed_attempts = self.failures,
                "The terminal inventory is current again"
            );
        }
        self.failures = 0;
    }

    /// The service closed the connection on us. Not a failure: the pump only
    /// gets here having reconciled at least once, and the reconnect is one
    /// `RECONNECT_DELAY` away.
    fn disconnected(&self) {
        tracing::info!(
            event = "field_native.terminal.inventory_disconnected",
            component = "terminal",
            "The terminal inventory connection closed; reconnecting"
        );
    }
}

/// The `events-lost` notice upstream synthesises for a subscriber that fell
/// behind its 1024-slot broadcast (service.rs:1647-1660). It REPLACES the
/// missed events rather than replaying them, so it is the one event whose
/// meaning is "you did not see what happened".
const EVENTS_LOST: &str = "events-lost";

/// One connection's worth of inventory maintenance: reconcile on connect, then
/// on events and on the backstop.
///
/// The client arrives as an `Arc` because governance LEAVES this loop (see
/// `govern_births`). Awaiting the GT-D11 flip inline put a request with the full
/// 10s budget behind it in the select arm: one slow birth read no further
/// events and took no reconcile tick, so an exit could stay invisible to fieldd
/// for ten seconds on a connection that was working perfectly — against the
/// spec's "< 2s" row.
async fn pump_inventory(
    client: Arc<ControlClient>,
    mut events: tokio::sync::mpsc::UnboundedReceiver<Value>,
    state: &Arc<DaemonState>,
    watch: &mut InventoryWatch,
    admission: &mut LedgerPump,
) -> anyhow::Result<()> {
    // Seeded from what the channel already holds so an unchanged inventory
    // wakes no subscriber.
    let mut published = inventory_value(&state.observed_tx.borrow().terminals);
    let mut last_reconcile = Instant::now();

    let (births_tx, births_rx) = tokio::sync::mpsc::unbounded_channel();
    let (governed_tx, mut governed_rx) = tokio::sync::mpsc::unbounded_channel();
    // Bound to THIS connection: a flip queued against a socket that is gone has
    // nothing to say, and the reconnect's own gap reconcile re-finds the row.
    let _governor = TaskGuard(tokio::spawn(govern_births(
        Arc::clone(&client),
        births_rx,
        governed_tx,
    )));

    // A connection that has only just opened was not watching a moment ago, so
    // its first reconcile closes an observation gap by definition.
    let known = known_session_ids(state);
    let reconciled = reconcile(&client, state, published).await?;
    watch.reconciled();
    admission.observe(reconciled.governed);
    published = reconciled.published;
    regovern_unseen(&births_tx, &known, &reconciled.sessions);

    let mut ticker = tokio::time::interval(RECONCILE_FLOOR);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut dirty = false;
    let mut gap = false;
    loop {
        tokio::select! {
            event = events.recv() => match event {
                // Every pushed event is a hint that the registry may have
                // moved; the tick below is what bounds how often we ask.
                Some(event) => {
                    if let Some(birth) = birth_to_govern(&event) {
                        let _ = births_tx.send(birth);
                    }
                    if event.get("type").and_then(Value::as_str) == Some(EVENTS_LOST) {
                        gap = true;
                    }
                    dirty = true;
                }
                None => return Ok(()),
            },
            // A completed flip changed a row we publish and `set-persistence`
            // announces nothing, so asking again is the only way the observed
            // persistence stops trailing the truth by up to a backstop.
            Some(()) = governed_rx.recv() => dirty = true,
            _ = ticker.tick() => {
                // An event-driven reconcile resets the backstop clock too: it
                // asked `list-sessions` the same question the backstop would
                // have, so counting from it kills a redundant second call.
                if dirty || last_reconcile.elapsed() >= BACKSTOP_INTERVAL {
                    dirty = false;
                    // Read before the reconcile applies over it, and only when
                    // a gap is owed — this is the floor's memory of what it has
                    // already seen.
                    let known = std::mem::take(&mut gap).then(|| known_session_ids(state));
                    // Stamped from BEFORE the call, so a slow reconcile cannot
                    // stretch the interval the kill matrix bounds.
                    let started = Instant::now();
                    let reconciled = reconcile(&client, state, published).await?;
                    watch.reconciled();
                    admission.observe(reconciled.governed);
                    published = reconciled.published;
                    if let Some(known) = known {
                        regovern_unseen(&births_tx, &known, &reconciled.sessions);
                    }
                    last_reconcile = started;
                }
            },
        }
    }
}

/// TC-S3 — one cell's connection worth of inventory maintenance: the same
/// loop as `pump_inventory` (reconcile on connect, then on events and the
/// backstop; births re-governed per GT-D11), publishing through the merged
/// registry under this cell's tag instead of straight onto the channel.
async fn pump_inventory_cell(
    client: Arc<ControlClient>,
    mut events: tokio::sync::mpsc::UnboundedReceiver<Value>,
    instance: u32,
    cell: &ObservedTerminalCell,
    merged: &Arc<MergedInventory>,
    watch: &mut InventoryWatch,
) -> anyhow::Result<()> {
    let mut published = merged.rows_value(instance);
    let mut last_reconcile = Instant::now();

    let (births_tx, births_rx) = tokio::sync::mpsc::unbounded_channel();
    let (governed_tx, mut governed_rx) = tokio::sync::mpsc::unbounded_channel();
    let _governor = TaskGuard(tokio::spawn(govern_births(
        Arc::clone(&client),
        births_rx,
        governed_tx,
    )));

    // A connection that has only just opened was not watching a moment ago, so
    // its first reconcile closes an observation gap by definition.
    let known = merged.session_ids(instance);
    let reconciled = reconcile_cell(&client, instance, cell, merged, published).await?;
    watch.reconciled();
    published = reconciled.published;
    regovern_unseen(&births_tx, &known, &reconciled.sessions);

    let mut ticker = tokio::time::interval(RECONCILE_FLOOR);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut dirty = false;
    let mut gap = false;
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Some(event) => {
                    if let Some(birth) = birth_to_govern(&event) {
                        let _ = births_tx.send(birth);
                    }
                    if event.get("type").and_then(Value::as_str) == Some(EVENTS_LOST) {
                        gap = true;
                    }
                    dirty = true;
                }
                None => return Ok(()),
            },
            Some(()) = governed_rx.recv() => dirty = true,
            _ = ticker.tick() => {
                if dirty || last_reconcile.elapsed() >= BACKSTOP_INTERVAL {
                    dirty = false;
                    let known = std::mem::take(&mut gap).then(|| merged.session_ids(instance));
                    let started = Instant::now();
                    let reconciled = reconcile_cell(&client, instance, cell, merged, published).await?;
                    watch.reconciled();
                    published = reconciled.published;
                    if let Some(known) = known {
                        regovern_unseen(&births_tx, &known, &reconciled.sessions);
                    }
                    last_reconcile = started;
                }
            },
        }
    }
}

/// `list-sessions` is truth (spec §10.5), scoped to one cell: rows are
/// stamped with its tag, the per-cell governed count feeds the ledger total
/// on EVERY reconcile (the LEDGER_INTERVAL refresh law), and rows publish
/// only on a real change.
async fn reconcile_cell(
    client: &ControlClient,
    instance: u32,
    cell: &ObservedTerminalCell,
    merged: &Arc<MergedInventory>,
    published: Value,
) -> anyhow::Result<Reconciled> {
    let mut sessions = client.list_sessions().await?;
    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    let terminals: Vec<ObservedTerminal> = sessions
        .iter()
        .filter(|session| is_governed_here(session))
        .map(|session| observed_row_for_cell(session, cell))
        .collect();
    let snapshot = inventory_value(&terminals);
    let governed = terminals.len() as u32;
    merged.observe_governed(instance, governed);
    if snapshot != published {
        merged.set_rows(instance, terminals);
    }
    Ok(Reconciled {
        published: snapshot,
        sessions,
        governed,
    })
}

/// The contract row plus the hosting cell's tag (TC-S3): the join key for
/// fieldd's ticket routing and per-cell loss receipts.
fn observed_row_for_cell(
    session: &SessionSummary,
    cell: &ObservedTerminalCell,
) -> ObservedTerminal {
    let mut row = observed_row(session);
    row.cell = Some(cell.clone());
    row
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
///   governance it does not hold, and the service would refuse it anyway. The
///   same marker is what keeps a replica out of the inventory entirely
///   (`is_governed_here`).
///
/// Anything else — `keep-until-exit`, `keep-until-explicit-close`, a value a
/// later ghosttea invents — is left exactly as found. A tolerant reader does
/// not rewrite what it does not recognise.
fn is_ownerless_app_lifetime_birth(session: &SessionSummary) -> bool {
    session.owner_id.is_none() && session.persistence.as_deref() == Some(APP_LIFETIME)
}

/// Apply the law's discriminator to one pushed event: the session to re-govern,
/// or `None`.
///
/// Deliberately synchronous, and deliberately left on the pump's own loop — the
/// whole of it is a parse and two field reads, and doing it here is what makes
/// the queue downstream carry births in the order this floor observed them.
fn birth_to_govern(event: &Value) -> Option<SessionSummary> {
    if event.get("type").and_then(Value::as_str) != Some("session-created") {
        return None;
    }
    // The event carries the full summary under the same `session` key the
    // create response uses (service.rs:137-149), so no follow-up list is owed.
    let summary = event.get("session")?;
    let session: SessionSummary = match serde_json::from_value(summary.clone()) {
        Ok(session) => session,
        Err(error) => {
            tracing::warn!(
                event = "field_native.terminal.birth_unreadable",
                component = "terminal",
                error = %error,
                "A session-created event carried a summary this floor could not read"
            );
            return None;
        }
    };
    is_ownerless_app_lifetime_birth(&session).then_some(session)
}

/// The session ids the floor has already published, captured BEFORE a reconcile
/// applies over them. This is the floor's memory of what it has seen, and it
/// deliberately survives a reconnect — the published inventory is never cleared.
fn known_session_ids(state: &Arc<DaemonState>) -> std::collections::HashSet<String> {
    state
        .observed_tx
        .borrow()
        .terminals
        .iter()
        .map(|terminal| terminal.session_id.clone())
        .collect()
}

/// Apply GT-D11 to the births this floor never SAW — the rows a gap reconcile
/// found that it had never published before.
///
/// Upstream's event broadcast holds 1024 slots and synthesises `events-lost`
/// rather than replaying what a lagging subscriber missed, so a session can be
/// born on a perfectly HEALTHY connection with no event this floor ever reads;
/// a reconnect leaves the same hole. Restoring the inventory from the re-list
/// without re-applying the law leaves those sessions ungoverned forever, which
/// is a broken custody claim with nothing anywhere to say so.
///
/// The unseen test is what keeps this from becoming "infer intent from an
/// inventory row", and it is load-bearing rather than belt-and-braces. The
/// discriminator alone reads the same two fields the birth event carries, but
/// the EVENT carries a third fact a row does not: that the session is new. A row
/// cannot tell "never governed" from "deliberately set back to app lifetime" —
/// and the second is reachable, because the mgmt desired set re-policies any
/// session the floor observes (`mgmt/mod.rs`'s repolicy diff), ownerless
/// included. Re-governing on the class alone would fight that authority every
/// time a connection blinked. A session absent from the last published inventory
/// cannot be one fieldd has been re-policying, because fieldd re-policies only
/// what it was shown.
fn regovern_unseen(
    births: &UnboundedSender<SessionSummary>,
    known: &std::collections::HashSet<String>,
    sessions: &[SessionSummary],
) {
    for session in sessions
        .iter()
        .filter(|session| !known.contains(&session.id))
        .filter(|session| is_ownerless_app_lifetime_birth(session))
    {
        let _ = births.send(session.clone());
    }
}

/// The GT-D11 flip itself, off the pump's loop and in the order the births
/// reached it.
///
/// A queue rather than a spawn per birth: spawning would fan a burst out into
/// unbounded concurrent requests on one socket, in whatever order the scheduler
/// and the writer lock chose. Serial here keeps the ordering that survived from
/// the inline await — a birth's flip is issued after the flips of every birth
/// this floor saw before it — while the pump goes on reading events and taking
/// reconcile ticks.
///
/// Each completed flip pokes the pump. `set-persistence` broadcasts no event,
/// and upstream answers a connection's commands in order (only the mesh
/// commands run off its loop, service.rs:1489-1499), so the reconcile that
/// follows is guaranteed to carry the value just set — without the poke the
/// published row would state the workspace's app-lifetime default for up to a
/// backstop interval, on the one surface that says whether a session survives.
///
/// Failures are swallowed after a line: by the time the flip is issued the
/// session may have already exited (a shell that ran `exit` immediately, a pane
/// closed in the same breath it opened), and the service answers "unknown or
/// remote session" for one it no longer holds. That is a race, not a fault — the
/// desired end state, a session that does not outlive its process, holds either
/// way. A control connection that is genuinely broken is diagnosed by the very
/// next `reconcile`, which returns its error instead of hiding it.
async fn govern_births(
    client: Arc<ControlClient>,
    mut births: tokio::sync::mpsc::UnboundedReceiver<SessionSummary>,
    governed: UnboundedSender<()>,
) {
    while let Some(session) = births.recv().await {
        match client.set_persistence(&session.id, FLOOR_LIFETIME).await {
            Ok(()) => {
                tracing::info!(
                    event = "field_native.terminal.persistence_regoverned",
                    component = "terminal",
                    session_id = %session.id,
                    from = APP_LIFETIME,
                    to = FLOOR_LIFETIME,
                    "An ownerless session was re-governed to the floor's lifetime"
                );
                let _ = governed.send(());
            }
            Err(error) => tracing::warn!(
                event = "field_native.terminal.persistence_regovern_failed",
                component = "terminal",
                session_id = %session.id,
                error = %error,
                "An ownerless session could not be re-governed; it may already be gone"
            ),
        }
    }
}

/// What one `list-sessions` answered: the snapshot to remember as published, and
/// the rows behind it — which a gap reconcile needs and a steady one ignores.
struct Reconciled {
    published: Value,
    sessions: Vec<SessionSummary>,
    /// How many of those rows this floor GOVERNS — the number the admission
    /// ledger publishes as this pair's claim on the machine budget. Counted
    /// here, from the same filter the inventory uses, so the ledger and the
    /// published inventory can never mean two different things by "a session
    /// on this device".
    governed: u32,
}

/// `list-sessions` is truth (spec §10.5). Publishes only on a real change, and
/// only what this floor GOVERNS — see the module note on what the inventory
/// means.
async fn reconcile(
    client: &ControlClient,
    state: &Arc<DaemonState>,
    published: Value,
) -> anyhow::Result<Reconciled> {
    let mut sessions = client.list_sessions().await?;
    // The service answers from a HashMap, so its order is arbitrary between
    // calls. Without this sort every backstop tick would look like a change and
    // wake every subscriber.
    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    let terminals: Vec<ObservedTerminal> = sessions
        .iter()
        .filter(|session| is_governed_here(session))
        .map(observed_row)
        .collect();
    let snapshot = inventory_value(&terminals);
    let governed = terminals.len() as u32;
    if snapshot == published {
        return Ok(Reconciled {
            published,
            sessions,
            governed,
        });
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
    Ok(Reconciled {
        published: snapshot,
        sessions,
        governed,
    })
}

/// Is this row a session THIS device runs, or a replica of another device's?
///
/// `list-sessions` answers both (the module note has the mechanism and the
/// hazard). Upstream's own marker decides it: a replica reports no persistence
/// class because claiming one would assert a governance this host does not hold,
/// and every locally created session carries one. Reading the marker rather than
/// inventing a second one is also what keeps this honest if the mesh flag is
/// off — with no replicas the predicate is true for every row, exactly as it was
/// before GT-4.
fn is_governed_here(session: &SessionSummary) -> bool {
    session.persistence.is_some()
}

/// Map ghosttea's summary onto the contract row. The session id IS the floor's
/// identity: binding it to a chopsticks agent session is a fieldd concern above
/// the mgmt seam (NF-L2), never invented here. `persistence` is opaque
/// passthrough — it has an upstream source since G9 (absence 2 in the module
/// note, RETIRED), and `is_governed_here` has already established that this row
/// carries one.
fn observed_row(session: &SessionSummary) -> ObservedTerminal {
    ObservedTerminal {
        session_id: session.id.clone(),
        pid: session.pid.map(i64::from),
        created_at: session.created_at_ms.and_then(|ms| i64::try_from(ms).ok()),
        persistence: session.persistence.clone(),
        title: session.title.clone(),
        cwd: session.cwd.clone(),
        // TC-S3: the legacy in-process serve has no cell; the per-cell pump
        // stamps the tag on the rows it owns.
        cell: None,
    }
}

/// `ObservedTerminal` is generated and carries no `PartialEq`, so equality
/// rides serde rather than a hand-written comparison that would drift when the
/// contract grows a field.
fn inventory_value(terminals: &[ObservedTerminal]) -> Value {
    serde_json::to_value(terminals).unwrap_or(Value::Null)
}

fn mint_token() -> String {
    hex::encode(rand::random::<[u8; 32]>())
}

/// The 0700 run directory is the real boundary, but a socket the owning user
/// alone may open costs one syscall and does not rely on the directory staying
/// that way. Unix-only by nature: the windows pipes get their CurrentUserOnly
/// DACL at bind, inside ghosttea's listener (WIN-D4).
#[cfg(unix)]
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

    /// A replica of another device's session, in the shape upstream actually
    /// mints one (replica.rs:39-61): no persistence class, no pid, and a
    /// LOCALLY generated id that says nothing about the host.
    ///
    /// Built as wire bytes for the same reason `summary` is — this row's whole
    /// job is to be the thing `list-sessions` hands us for a peer's session.
    fn replica_summary() -> SessionSummary {
        summary(json!({
            "id": "9f1c1b6e-0000-4000-8000-000000000001",
            "executable": "remote-terminal",
            "readWrite": false,
            "title": "a peer's pane",
            "pid": null,
            "createdAtMs": 0,
            "persistence": null,
        }))
    }

    /// GT-5d: `list-sessions` is the local registry PLUS the replicas this floor
    /// opened as a viewer, and `ObservedTerminal` has no device — so a replica
    /// published there is a claim that another machine's session is running
    /// here. Upstream's own marker is what tells them apart.
    #[test]
    fn only_a_session_this_floor_governs_reaches_the_inventory() {
        assert!(
            is_governed_here(&summary(json!({"persistence": FLOOR_LIFETIME}))),
            "a session this floor governs states the class it governs it by"
        );
        assert!(
            is_governed_here(&summary(json!({"persistence": APP_LIFETIME}))),
            "which class it is does not matter — that there IS one does"
        );
        assert!(
            !is_governed_here(&replica_summary()),
            "a replica reports no class because claiming one would assert a governance \
             this host does not hold; that absence is what keeps a peer's session out of \
             an inventory with no device field to put it in"
        );
    }

    /// The birth classifier, on the wire shapes it actually meets.
    #[test]
    fn only_a_session_created_event_carrying_an_ownerless_birth_is_queued() {
        let birth =
            |session: Value| json!({"requestId": 0, "type": "session-created", "session": session});
        let ownerless = json!({
            "id": "s1", "handle": "h", "executable": "/bin/zsh", "cols": 100, "rows": 30,
            "exited": false, "readWrite": true, "bellCount": 0, "pid": 4242,
            "createdAtMs": 1, "persistence": APP_LIFETIME,
        });

        assert_eq!(
            birth_to_govern(&birth(ownerless.clone()))
                .expect("the GT-D11 case is queued")
                .id,
            "s1"
        );

        let mut owned = ownerless.clone();
        owned["ownerId"] = json!("vibefield.fieldd");
        assert!(
            birth_to_govern(&birth(owned)).is_none(),
            "an owned birth carries its author's explicit intent"
        );

        assert!(
            birth_to_govern(&json!({"requestId": 0, "type": "session-exited", "sessionId": "s1"}))
                .is_none(),
            "only a birth is a birth"
        );
        assert!(
            birth_to_govern(&birth(json!({"nothing": "useful"}))).is_none(),
            "an unreadable summary is logged and dropped, never guessed at"
        );
        assert!(
            birth_to_govern(&json!({"requestId": 0, "type": "session-created"})).is_none(),
            "a birth with no summary owes no follow-up list"
        );
    }

    /// The observation-gap recovery: exactly the births a `session-created`
    /// would have queued had this floor been watching, and nothing else.
    #[test]
    fn a_gap_reconcile_re_governs_only_the_births_it_never_saw() {
        let with_id = |id: &str, extra: Value| {
            let mut session = summary(extra);
            session.id = id.to_string();
            session
        };
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let known = ["already-published".to_string()].into_iter().collect();
        regovern_unseen(
            &tx,
            &known,
            &[
                with_id("missed", json!({"persistence": APP_LIFETIME})),
                with_id("already-published", json!({"persistence": APP_LIFETIME})),
                with_id(
                    "owned",
                    json!({"persistence": APP_LIFETIME, "ownerId": "vibefield.fieldd"}),
                ),
                with_id("governed", json!({"persistence": FLOOR_LIFETIME})),
                replica_summary(),
            ],
        );
        drop(tx);

        let queued: Vec<String> = std::iter::from_fn(|| rx.try_recv().ok())
            .map(|session| session.id)
            .collect();
        assert_eq!(
            queued,
            vec!["missed".to_string()],
            "the unseen test and the law's own discriminator, and nothing wider: an owned \
             row, an already-governed row and a replica are all left alone — and so is a row \
             this floor HAS published, because that one may be app-lifetime by a deliberate \
             mgmt re-policy rather than by never having been governed"
        );
    }

    fn test_shared() -> Arc<Shared> {
        Arc::new(Shared {
            served: Mutex::new(UnitHealth {
                unit: UNIT_ID.to_string(),
                state: UnitState::Up,
                detail: Some("serving; text engine Menlo".into()),
                auth_url: None,
            }),
            ping: tokio::sync::mpsc::unbounded_channel().0,
            endpoints: None,
            cell_mode: false,
            stopping: watch::channel(false).0,
            routes: watch::channel(TerminalRouteSnapshot {
                revision: 0,
                cells: Vec::new(),
            })
            .0,
            route_rows: Mutex::new(BTreeMap::new()),
            serving: watch::channel(false).0,
            serving_cells: Mutex::new(0),
            class_states: Mutex::new(BTreeMap::new()),
            occupancy: watch::channel(BTreeMap::new()).0,
            strikes: Mutex::new(std::collections::HashMap::new()),
            next_instance: std::sync::atomic::AtomicU32::new(0),
            inventory_faults: Mutex::new(BTreeMap::new()),
            drain: Mutex::new(None),
            inventory_fault: Mutex::new(None),
            fd_pressure: Mutex::new(None),
            pty_pressure: Mutex::new(None),
            fd_gauge: Mutex::new(FdPressureGauge::new()),
        })
    }

    /// GT-5d: a pump that will never work again must not leave the unit saying
    /// `up` over a frozen inventory — and it must not overwrite what the serve
    /// task knows either.
    #[test]
    fn a_permanently_failing_pump_degrades_the_unit_and_recovers_it() {
        let shared = test_shared();
        let mut watch = InventoryWatch::new(TerminalHandle {
            shared: shared.clone(),
        });

        for _ in 1..INVENTORY_FAULT_STREAK {
            watch.failed(&anyhow::anyhow!("connection refused"));
            assert_eq!(
                shared.health().state,
                UnitState::Up,
                "a torn connection that reconnects within the streak is not a degraded plane"
            );
        }

        watch.failed(&anyhow::anyhow!("connection refused"));
        let degraded = shared.health();
        assert_eq!(degraded.state, UnitState::Degraded);
        let detail = degraded.detail.expect("a degraded unit states why");
        assert!(
            detail.contains("connection refused"),
            "the pump's own error is the reason, not a summary of it: {detail}"
        );
        assert!(
            detail.contains("text engine Menlo"),
            "and the serve task's news survives beside it: {detail}"
        );

        watch.reconciled();
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "an inventory that is current again clears the fault"
        );
    }

    /// The composition only ever DOWNGRADES a serving floor. On any other base
    /// state the serve task is telling the worse and truer story, and a stale
    /// inventory is its symptom rather than its cause.
    #[test]
    fn a_stale_inventory_never_overwrites_a_worse_state() {
        for (state, name) in [
            (UnitState::Starting, "starting"),
            (UnitState::Crashed, "crashed"),
            (UnitState::Degraded, "degraded"),
        ] {
            let shared = test_shared();
            shared.set(state, Some("the terminal service failed: boom".into()));
            shared.set_inventory_fault(Some("connection refused".into()));
            shared.observe_fd_pressure(900, 1000);
            let health = shared.health();
            assert_eq!(health.state, state, "{name} is not a serving floor");
            assert_eq!(
                health.detail.as_deref(),
                Some("the terminal service failed: boom"),
                "{name} keeps the serve task's own account"
            );
        }
    }

    /// TC-D6(e), both directions. A floor that is out of descriptors is not a
    /// floor that is fine, and — the half that matters as much — a floor whose
    /// pressure has passed must stop saying it is.
    #[test]
    fn descriptor_pressure_degrades_the_unit_and_then_recovers_it() {
        let shared = test_shared();
        assert_eq!(shared.health().state, UnitState::Up);

        shared.observe_fd_pressure(700, 1000);
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "70% is not pressure; a unit that cried wolf here would be ignored at 90%"
        );

        shared.observe_fd_pressure(820, 1000);
        let degraded = shared.health();
        assert_eq!(degraded.state, UnitState::Degraded);
        let detail = degraded.detail.expect("a degraded unit states why");
        assert!(
            detail.contains(PressureClass::FdPressure.as_str()),
            "the contract spelling is what a reader matches on: {detail}"
        );
        assert!(
            detail.contains("820 of 1000"),
            "and the numbers are the evidence, not a mood: {detail}"
        );
        assert!(
            detail.contains("text engine Menlo"),
            "the serve task's news survives beside it: {detail}"
        );

        shared.observe_fd_pressure(650, 1000);
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "pressure that has passed must clear — health that cannot recover is not health"
        );
    }

    /// The immediate half of TC-D6(e), and the reason both writers share one
    /// gauge: a refusal degrades the unit NOW, and the ordinary sampler is still
    /// what clears it. With two gauges this recovery never arrives.
    #[test]
    fn a_refused_create_degrades_the_unit_before_the_next_sample() {
        let shared = test_shared();
        let handle = TerminalHandle {
            shared: shared.clone(),
        };

        handle.note_create_refusal(&CreateRefusal::Unclassified {
            message: "failed to spawn PTY command".into(),
        });
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "a refusal nobody could classify is not evidence of pressure"
        );

        handle.note_create_refusal(&CreateRefusal::ResourceExhausted {
            class: PressureClass::FdPressure,
            message: "failed to openpty: Os { code: 24, … }".into(),
        });
        let degraded = shared.health();
        assert_eq!(degraded.state, UnitState::Degraded);
        assert!(
            degraded
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains(PressureClass::FdPressure.as_str())),
            "the refusal puts the contract state on the unit at once"
        );

        shared.observe_fd_pressure(100, 1000);
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "and a sample under the low-water mark clears what the refusal set"
        );
    }

    /// TC-L1f's state reaches health the same way, and is INDEPENDENT of the
    /// descriptor gauge: the machine's PTY budget and this process's descriptors
    /// are different facts, and neither may clear the other's.
    #[test]
    fn the_machine_budget_and_the_descriptor_gauge_are_reported_independently() {
        let shared = test_shared();
        shared.set_pty_pressure(Some(format!(
            "{}: the machine-wide custody budget of 100 PTYs is spent",
            PressureClass::PtyExhausted.as_str()
        )));
        shared.observe_fd_pressure(900, 1000);
        shared.set_inventory_fault(Some("connection refused".into()));

        let detail = shared
            .health()
            .detail
            .expect("a degraded unit states every reason it has");
        for expected in [
            "text engine Menlo",
            "connection refused",
            PressureClass::FdPressure.as_str(),
            PressureClass::PtyExhausted.as_str(),
        ] {
            assert!(
                detail.contains(expected),
                "three independent faults, all reported — {expected} is missing from: {detail}"
            );
        }

        shared.observe_fd_pressure(10, 1000);
        let detail = shared.health().detail.expect("still degraded");
        assert!(
            !detail.contains(PressureClass::FdPressure.as_str()),
            "descriptors recovered: {detail}"
        );
        assert!(
            detail.contains(PressureClass::PtyExhausted.as_str()),
            "but the machine's budget is still spent, and clearing it would be a lie: {detail}"
        );
    }

    /// The ledger's seam onto health, driven through a real flock'd file: a
    /// floor holding the whole machine budget says `pty_exhausted`, and says
    /// nothing once the sessions end. Unix-gated with the ledger itself — on
    /// win32 `resolve` answers `None` and no pump ever holds a ledger (the
    /// absence is asserted in `admission::tests`).
    #[cfg(unix)]
    #[test]
    fn the_ledger_pump_puts_the_spent_budget_on_the_unit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let ledger = crate::admission::AdmissionLedger::at(
            dir.path().join(registries::files::CUSTODY_ADMISSION_LEDGER),
            2,
            "boot-under-test",
        );
        let mut pump = LedgerPump::new(Some(ledger), shared.clone());

        pump.observe(1);
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "one session against a budget of two is a floor with room"
        );

        pump.observe(2);
        let detail = shared.health().detail.expect("a spent budget is stated");
        assert!(
            detail.contains(PressureClass::PtyExhausted.as_str()),
            "the machine budget is spent and the unit says so: {detail}"
        );
        assert!(
            detail.contains("budget of 2 PTYs"),
            "with the number that was spent: {detail}"
        );

        pump.observe(0);
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "sessions ended, budget freed — and the ledger was told by the inventory, not by \
             an event it might have missed"
        );
    }

    /// A floor with no ledger (win32, or a root the derivation refused) must
    /// behave exactly as it did before TC-S0: serving, with the kernel as the
    /// only admission authority and no invented state on its health.
    #[test]
    fn a_floor_without_a_ledger_reports_nothing_about_a_budget_it_cannot_see() {
        let shared = test_shared();
        let mut pump = LedgerPump::new(None, shared.clone());
        pump.observe(4_000);
        assert_eq!(shared.health().state, UnitState::Up);
        assert_eq!(
            shared.health().detail.as_deref(),
            Some("serving; text engine Menlo"),
            "no ledger means no claim about a budget — never a made-up one"
        );
    }

    // ---- TC-S3: the class-cell machinery's pure halves ----

    /// The snapshot's deterministic order IS the create-target discipline's
    /// substrate: interactive class first (the legacy mirror's cell), agent
    /// class second, solos last by instance.
    #[test]
    fn route_rows_compose_interactive_first_then_agent_then_solos() {
        fn row(
            instance: u32,
            class: TerminalWorkloadClass,
            role: TerminalCellRole,
        ) -> TerminalRouteCell {
            TerminalRouteCell {
                cell_boot_id: format!("boot-{instance}"),
                cell_instance_id: i64::from(instance),
                pid: 1,
                endpoints: TerminalEndpoints {
                    control_socket: format!("c{instance}"),
                    frame_socket: format!("f{instance}"),
                    auth_token: "t".into(),
                },
                token_generation: i64::from(instance),
                workload_class: Some(class),
                role: Some(role),
            }
        }
        let mut rows = BTreeMap::new();
        rows.insert(
            5,
            row(5, TerminalWorkloadClass::Agent, TerminalCellRole::Solo),
        );
        rows.insert(
            2,
            row(2, TerminalWorkloadClass::Agent, TerminalCellRole::Class),
        );
        rows.insert(
            4,
            row(
                4,
                TerminalWorkloadClass::Interactive,
                TerminalCellRole::Class,
            ),
        );
        rows.insert(
            3,
            row(3, TerminalWorkloadClass::Agent, TerminalCellRole::Solo),
        );
        let order: Vec<i64> = compose_route_rows(&rows)
            .iter()
            .map(|cell| cell.cell_instance_id)
            .collect();
        assert_eq!(order, vec![4, 2, 3, 5]);
    }

    /// The unit-health composition across class planes: all Up → Up; one
    /// intensity dead end → Degraded; both → Crashed; a config-shaped Failed
    /// stays Degraded even alone — a missing binary is not a crash loop.
    #[test]
    fn class_states_compose_honestly() {
        let shared = test_shared();
        shared.set_class_state(
            TerminalWorkloadClass::Agent,
            ClassPlaneState::Up("cell 1 serving".into()),
        );
        shared.set_class_state(
            TerminalWorkloadClass::Interactive,
            ClassPlaneState::Up("cell 2 serving".into()),
        );
        assert_eq!(shared.health().state, UnitState::Up);
        shared.set_class_state(
            TerminalWorkloadClass::Agent,
            ClassPlaneState::Crashed("intensity exceeded".into()),
        );
        let health = shared.health();
        assert_eq!(
            health.state,
            UnitState::Degraded,
            "one dead class degrades the unit while the other serves"
        );
        let detail = health.detail.expect("a degraded unit states why");
        assert!(detail.contains("agent: intensity exceeded"), "{detail}");
        assert!(detail.contains("interactive: cell 2 serving"), "{detail}");
        shared.set_class_state(
            TerminalWorkloadClass::Interactive,
            ClassPlaneState::Crashed("intensity exceeded".into()),
        );
        assert_eq!(shared.health().state, UnitState::Crashed);
        shared.set_class_state(
            TerminalWorkloadClass::Interactive,
            ClassPlaneState::Failed("no binary".into()),
        );
        assert_eq!(
            shared.health().state,
            UnitState::Degraded,
            "a config dead end is Degraded, not a crash claim"
        );
    }

    /// TC-D4's classification at the crumb seam: a session-naming crumb is
    /// Exact; the sessionless panic-hook form is Infrastructure; nothing — a
    /// SIGKILL, an OOM kill — is Unknown; a stale generation's crumb (boot id
    /// mismatch) classifies NOTHING; and the file is consumed on read.
    #[test]
    fn crumbs_classify_exact_only_when_a_session_is_named() {
        let dir = tempfile::tempdir().expect("tempdir");
        let crumb = dir.path().join("termcell.9.crumb");

        assert!(matches!(
            read_crumb_attribution(&crumb, Some("boot-a")),
            Attribution::Unknown
        ));

        std::fs::write(
            &crumb,
            r#"{"cellBootId":"boot-a","sessionId":"sess-1","detail":"feed panic"}"#,
        )
        .unwrap();
        match read_crumb_attribution(&crumb, Some("boot-a")) {
            Attribution::Exact { session_id, .. } => assert_eq!(session_id, "sess-1"),
            _ => panic!("a session-naming crumb is Exact"),
        }
        assert!(!crumb.exists(), "the crumb is consumed on read");

        std::fs::write(
            &crumb,
            r#"{"cellBootId":"boot-a","detail":"panicked at ..."}"#,
        )
        .unwrap();
        assert!(matches!(
            read_crumb_attribution(&crumb, Some("boot-a")),
            Attribution::Infrastructure { .. }
        ));

        std::fs::write(
            &crumb,
            r#"{"cellBootId":"boot-STALE","sessionId":"sess-1"}"#,
        )
        .unwrap();
        assert!(
            matches!(
                read_crumb_attribution(&crumb, Some("boot-a")),
                Attribution::Unknown
            ),
            "another generation's crumb is stale evidence and blames nobody"
        );
    }

    /// Only Exact writes the ledger — row 13's floor-side half in one
    /// assertion pair. Strikes accumulate per session across generations.
    #[test]
    fn only_exact_attributions_strike() {
        let shared = test_shared();
        let mut window: Vec<(Instant, String)> = Vec::new();
        note_cell_crash(
            &shared,
            TerminalWorkloadClass::Agent,
            TerminalCellRole::Class,
            1,
            "signal: 9 (SIGKILL)",
            &Attribution::Unknown,
            &mut window,
        );
        note_cell_crash(
            &shared,
            TerminalWorkloadClass::Agent,
            TerminalCellRole::Class,
            2,
            "abort",
            &Attribution::Infrastructure {
                detail: "allocator death".into(),
            },
            &mut window,
        );
        assert!(
            shared.strikes.lock().unwrap().is_empty() && window.is_empty(),
            "Unknown and Infrastructure blame NO session (TC-D4, row 13)"
        );
        note_cell_crash(
            &shared,
            TerminalWorkloadClass::Agent,
            TerminalCellRole::Class,
            3,
            "exit status: 101",
            &Attribution::Exact {
                session_id: "sess-9".into(),
                detail: None,
            },
            &mut window,
        );
        assert_eq!(shared.strikes.lock().unwrap().get("sess-9"), Some(&1));
        assert_eq!(
            window.len(),
            1,
            "the window holds the offender for the breach check"
        );
    }
}
