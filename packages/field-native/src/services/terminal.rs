//! TerminalUnit (NF-2) — this device's single PTY authority (native-floor spec
//! §4; NF-L1: every PTY the product creates lives here). ghosttea's
//! `TerminalService` is no longer embedded HERE: since TC-S2 it runs in
//! `field-terminal-host` cells, one per workload class plus solos, and this
//! unit supervises them, mints their tokens and grant keys, publishes the
//! revisioned route snapshot, and pumps the inventory it publishes to fieldd.
//!
//! Health honesty, in the M2 shape:
//!   starting  — cells spawning
//!   up        — at least one cell serving control + frame traffic
//!   crashed   — a class plane hit the restart-intensity dead end; global
//!               health goes degraded with this unit named. NO in-process
//!               restart of the unit (manager law: fieldd decides whether to
//!               surface or bounce the pair).
//!   degraded  — a class plane reached a dead end (no cell binary, an
//!               unspellable run dir, or the restart intensity), or the
//!               inventory pump stopped being able to see, or a cell's
//!               inventory or the machine-wide ledger's answer is older
//!               than its bound (IL-D4)
//!
//! **No mesh coupling at all (TM-1, 2026-09-14).** GT-4a made this unit the
//! floor's one named mesh exception: with `FIELD_NATIVE_TERMINAL_MESH` set it
//! kept the PRE-CELL in-process serve — one embedded ghosttea service hosting
//! every class, with `ghosttea-truffle`'s TSP1 adapter attached at construction
//! and borrowing the gateway's `Arc<Node>` — because a cell cannot borrow that
//! node across a process boundary. The price was cell isolation XOR the phone,
//! and with the flag on the desktop deck could not open a pane at all: no route
//! rows, no T1 doors, no grant keys, so fieldd could mint no routed ticket. The
//! terminal-mesh design (`thinking-terminal-mesh-cells.md`, T, ruled
//! 2026-09-14) cut the seam the other way, and TM-D7 deleted that path rather
//! than fencing it: it was the pre-TP-S3e product, not the product minus
//! isolation.
//!
//! So this unit supervises cells, unconditionally, and knows nothing about a
//! tailnet. The flag survives as `config::MeshPlan`, answering only whether the
//! cells' doors are PUBLISHED off-device; the mgmt hello composes that with the
//! gateway's live node into `HelloAck.terminalMesh`, and fieldd registers the
//! per-cell serve routes that do the publishing (TM-2). The unit is still
//! registered after `mesh-gateway` to keep design-02's start order, and now
//! genuinely depends on nothing it holds.
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
//!    moved, policy stayed). `serve_managed` hands the DRAIN HANDLE to whoever
//!    calls it — which since TC-S2 is each cell, in its own process: this unit
//!    drains by dropping a cell's leash and waiting out the budget, and the
//!    cell runs upstream's ladder and reports what it drained.
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
//! ## What the inventory MEANS (GT-5d; the hazard closed at TM-1)
//!
//! Upstream's `list-sessions` answers the local registry PLUS
//! `mesh_runtime.summaries()` — the replicas a floor opened as a VIEWER of
//! another device (`Command::ListSessions`, ghosttea service.rs).
//! `ObservedTerminal` carries no device, so a replica published there would read
//! as a session on THIS machine: an agent bound to its id, a kill affordance
//! reasoning about it, or a restore gate counting it alive would each be acting
//! on the wrong device. Before GT-4 `summaries()` was always empty; GT-4's mesh
//! flag silently changed what the inventory MEANT with no contract change to
//! notice, and the filter below was the answer.
//!
//! **Since TM-1 (2026-09-14) no session this floor lists can be a replica at
//! all:** the pumps dial CELLS, and a cell has never had a mesh runtime
//! (`cell.rs`), so `summaries()` is structurally empty on every connection this
//! floor makes. The filter stays — it is the honest predicate either way, it
//! costs one `Option` read, and it is what a future remote viewer would have to
//! defeat deliberately rather than by accident.
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
//!
//! ## How old the inventory is (IL-D1, IL-D3, IL-D4)
//!
//! A failure is not the only way the published rows go old: a `list-sessions`
//! that answers slowly, or a pump held in a wait, fails nothing and publishes
//! nothing. So every cell's inventory has an age. `InventoryStamps` keeps, per
//! cell, the moment its last APPLIED reconcile began (before the writer lock,
//! so the age is conservative), seeded when the cell's pump is spawned.
//! `InventorySampler`, outside every pump, judges each stamp every
//! `TERMINAL_INVENTORY.SAMPLE_MS` against `STALE_MS`, and the ledger's own
//! `as_of` the same way, and speaks only on a transition: on the observed
//! stream (`staleCells`, beside the `inventoryBoundMs` whose presence says this
//! floor judges) and in the unit's health, which names the fixed instant rather
//! than a running age. A reconcile slower than `SLOW_RECONCILE_MS` is logged
//! once per slow episode, with the part its time went to.

use crate::admission::AdmissionLedger;
use crate::cell::{CellCrumb, CellExitReport, CellHello};
use crate::config::NativeConfig;
use crate::contracts::ObservedTerminalCell;
use crate::contracts::{
    ObservedStaleCell, ObservedTerminal, TerminalCellRole, TerminalEndpoints, TerminalRouteCell,
    TerminalRouteSnapshot, TerminalWorkloadClass, UnitHealth, UnitState,
};
use crate::manager::NativeService;
use crate::orphan::{Census, SessionCensus};
use crate::registries;
use crate::registries::terminal_inventory;
use crate::resource_pressure::{
    self, CreateRefusal, FdPressureGauge, PressureClass, HIGH_WATER_PERCENT,
};
use crate::services::terminal_client::{ControlClient, SessionSummary};
use crate::state::DaemonState;
use crate::supervised_child::{ChildSpec, StartFailure, StderrLabel, SupervisedChild};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;

pub const UNIT_ID: &str = "terminal";

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
/// Since item 52 (b) (2026-10-26) it no longer bounds a shell's cwd or title
/// either: ghosttea 0.13.4's `session-metadata-changed` (minor 1.17) marks the
/// cell dirty, and an OSC 7 reaches the inventory within one `RECONCILE_FLOOR`
/// tick (about 100 ms, `terminal_unit.rs`'s row) where it waited up to here.
///
/// Measured against a timestamp and NOT by counting ticks: with
/// `MissedTickBehavior::Skip`, a reconcile slower than the floor eats ticks, so
/// several of them could stretch well past the interval and the bound would
/// quietly stop being one.
///
/// The number is `TERMINAL_INVENTORY.BACKSTOP_MS` (IL-D1), one authority with
/// fieldd: a healthy cell's inventory peaks near it, which is what the stale
/// bound beside it is set against.
const BACKSTOP_INTERVAL: Duration = Duration::from_millis(terminal_inventory::BACKSTOP_MS);

/// IL-D1 — the numbers the inventory's age is kept by: the pumps' backstop,
/// the stale bound, the slow-reconcile line and the sampler's cadence.
/// Production's are the registry's (`InventoryBounds::REGISTRY`); a test names
/// its own, in milliseconds, as `LedgerThread::spawn_with_interval` does its
/// interval.
#[derive(Clone, Copy, Debug)]
struct InventoryBounds {
    /// A cell's pump reconciles at least this often, events or none.
    backstop: Duration,
    /// Past this age, counted from when the last applied reconcile began, a
    /// cell's inventory is stale. The ledger's answer is held to it too.
    stale: Duration,
    /// A reconcile slower than this is a slow one (IL-D3).
    slow: Duration,
    /// How often the sampler judges: the age's resolution.
    sample: Duration,
}

impl InventoryBounds {
    const REGISTRY: Self = Self {
        backstop: BACKSTOP_INTERVAL,
        stale: Duration::from_millis(terminal_inventory::STALE_MS),
        slow: Duration::from_millis(terminal_inventory::SLOW_RECONCILE_MS),
        sample: Duration::from_millis(terminal_inventory::SAMPLE_MS),
    };
}

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
///
/// *Corrected 2026-10-19 (IL-D1):* ~1.5 s only when each attempt fails at
/// once, as a refused dial does. An attempt that waits out the client's 10 s
/// `REQUEST_TIMEOUT` (a cell that accepts and never answers) takes 10.5 s with
/// its reconnect, so three take about 31 s. The inventory's age covers that
/// case first: the sampler reads the cell stale at `STALE_MS`.
const INVENTORY_FAULT_STREAK: u32 = 3;

/// What `GhostteaWorkspace` hardcodes into every one of its own create doors —
/// init, split, and new-pane alike (Workspace.tsx:206/682/716). It is the right
/// default for the app it was written for, where the shell dies with the window.
const APP_LIFETIME: &str = "terminate-with-app";

/// What this product promises instead: sessions live as long as the floor does
/// (NF-D3, the daemon-lifetime ceiling stated honestly).
const FLOOR_LIFETIME: &str = "keep-until-exit";

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
    /// The supervisor's stop signal (cell mode): `stop()` flips it, the
    /// supervisor drops the cell's leash and waits out the drain budget.
    stopping: watch::Sender<bool>,
    /// TC-D15 (TC-S2) — the revisioned route snapshot the cell supervisor
    /// publishes: one row per live cell (K=2 class hosts + solos since
    /// TC-S3), revision bumped on EVERY transition. Since TM-1 it is the
    /// floor's ONLY reading of where terminals live — the supervisor announces
    /// the capability at revision 1 before the first cell, so a floor with a
    /// terminal unit never sits at the {revision: 0, cells: []} initial.
    /// Readers: the mgmt hello and routes subscription (via DaemonState's
    /// receiver), and the inventory pump manager, which runs one pump per row.
    routes: watch::Sender<TerminalRouteSnapshot>,
    /// TC-S3 — the row registry behind `routes`: each cell task upserts its
    /// row at hello and removes it at its end; every mutation recomposes the
    /// snapshot in the deterministic order the create-target discipline
    /// assumes (interactive class, agent class, then solos by instance — so
    /// the legacy `cells[0]` mirror stays the interactive host).
    route_rows: Mutex<BTreeMap<u32, TerminalRouteCell>>,
    /// F1 — each running cell's stdin, for a line the floor relays to every cell (the freeway
    /// host's `revokeClient`). A generation registers its sender right after its hello and BEFORE
    /// its route row, so any grant a client could hold for the cell is minted after the sender is
    /// there; the sender goes with the row at the generation's end.
    cell_updates: Mutex<BTreeMap<u32, UnboundedSender<Value>>>,
    /// TC-S3 — per-class plane states, composed into the unit's health.
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
    /// What the inventory pump knows and the cell supervisors cannot see: the
    /// reason the observed inventory has stopped being maintained, or `None`
    /// while it is. A SECOND cell rather than a write into `served` on purpose
    /// — the two writers are independent, and either overwriting the other's
    /// state would lose exactly the news the reader needs.
    inventory_fault: Mutex<Option<String>>,
    /// IL-D4 — every cell whose inventory is older than its bound, instance →
    /// "no reconcile applied since …", empty while every cell is fresh. Its
    /// own slot beside `inventory_faults`, for the same reason that is a cell
    /// of its own: the fault is `InventoryWatch`'s verdict on failures, this is
    /// the sampler's on age, and a cell can be both at once. Only the sampler
    /// writes it.
    inventory_stale: Mutex<BTreeMap<u32, String>>,
    /// AL-8a — the inventory's per-cell stamps, once the inventory is installed: the census's "has this cell
    /// reconciled at all" (`InventoryStamp::applied`).
    inventory_stamps: std::sync::OnceLock<Arc<InventoryStamps>>,
    /// IL-D6 — the machine-wide ledger has not answered for longer than the
    /// bound: "the machine-wide ledger has not answered since …", or `None`.
    /// Only the sampler writes it; the ledger's thread cannot, since a thread
    /// stuck in a flock says nothing.
    ledger_late: Mutex<Option<String>>,
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

    /// IL-D4 — the sampler's verdict on every cell's age. Idempotent, as the
    /// fault cell is: the sampler writes only on a transition, and an
    /// unchanged map pings nobody.
    fn set_inventory_stale(&self, stale: BTreeMap<u32, String>) {
        let mut held = self.inventory_stale.lock().unwrap();
        if *held == stale {
            return;
        }
        *held = stale;
        drop(held);
        let _ = self.ping.send(());
    }

    /// IL-D6 — the sampler's verdict on the ledger's answer.
    fn set_ledger_late(&self, detail: Option<String>) {
        let mut held = self.ledger_late.lock().unwrap();
        if *held == detail {
            return;
        }
        *held = detail;
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

    /// A cell's ending: drop its row and recompose. A cell that never helloed
    /// published no row, so it publishes no REVISION either — a snapshot whose
    /// revision moved with nothing in it is a reader's cue to re-read, and
    /// spending one on a birth that never happened is a wake-up for nothing.
    ///
    /// It used to return whether a row went, so the caller could keep a count
    /// of serving cells in step; that count fed a watch whose only subscriber
    /// was the in-process floor's inventory pump, and TM-1 retired both.
    fn route_remove(&self, instance: u32) {
        let cells = {
            let mut rows = self.route_rows.lock().unwrap();
            if rows.remove(&instance).is_none() {
                return;
            }
            compose_route_rows(&rows)
        };
        self.routes.send_modify(|snapshot| {
            snapshot.revision += 1;
            snapshot.cells = cells;
        });
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
    /// reconcile. *Corrected 2026-10-19 (IL-D6):* the ledger's own thread
    /// asserts it, on every attempt that lands — a changed total or the
    /// `LEDGER_INTERVAL` refresh — and no pump writes it.
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
    ///
    /// The inventory's age (IL-D4) and the ledger's lateness (IL-D6) are two
    /// more such facts, composed by the same rule: the age beside the pump's
    /// fault (a cell's pump can be failing and its rows old at once), the
    /// ledger's lateness beside the budget it keeps.
    fn health(&self) -> UnitHealth {
        let base = self.served.lock().unwrap().clone();
        if base.state != UnitState::Up {
            return base;
        }
        let fault = self.inventory_fault.lock().unwrap().clone();
        let stale = self.inventory_stale.lock().unwrap().clone();
        let fd = self.fd_pressure.lock().unwrap().clone();
        let pty = self.pty_pressure.lock().unwrap().clone();
        let ledger = self.ledger_late.lock().unwrap().clone();
        if fault.is_none() && stale.is_empty() && fd.is_none() && pty.is_none() && ledger.is_none()
        {
            return base;
        }
        let mut parts: Vec<String> = base.detail.iter().cloned().collect();
        if let Some(fault) = fault {
            parts.push(format!(
                "the observed inventory is no longer current: {fault}"
            ));
        }
        if !stale.is_empty() {
            parts.push(format!(
                "the observed inventory is older than its bound: {}",
                stale
                    .iter()
                    .map(|(instance, detail)| format!("cell {instance}: {detail}"))
                    .collect::<Vec<_>>()
                    .join("; ")
            ));
        }
        parts.extend(fd);
        parts.extend(pty);
        parts.extend(ledger);
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

/// AL-8a (`thinking-app-lifecycle.md` §8.3.1) — the floor's own session count, for its orphan bound and the record of
/// how its management client left, read at the source: the sum over every live cell's applied inventory, counted only
/// from reconciles that BEGAN after `after` when one is given. `Unknown` (never idle) before the inventory is
/// installed, while any cell's inventory is stale, or while the pump is faulted; `NotYet` while a live cell has no such
/// reconcile applied (its stamp). A cell that reconciled empty publishes nothing, so its missing `occupancy` entry
/// reads 0.
///
/// *Corrected 2026-10-27 (found by the EL8's verify, AL-8a-2):* this read every cell's last applied reconcile,
/// whenever it began. A session born after it is not in `occupancy` until the next one (an event's, at the next
/// 100 ms tick, which a loaded floor stretches), so a fieldd that died inside that gap was recorded beside a session
/// as `sessions: 0`, a zero the floor never saw. A count that must hold at a moment (a departure, the bound's stop)
/// asks every pump for a reconcile and counts from those begun after it: a quiet cell would not reconcile again until
/// its backstop.
impl SessionCensus for TerminalHandle {
    fn count(&self, after: Option<Instant>) -> Census {
        let shared = &self.shared;
        if shared.inventory_fault.lock().unwrap().is_some()
            || !shared.inventory_faults.lock().unwrap().is_empty()
            || !shared.inventory_stale.lock().unwrap().is_empty()
        {
            return Census::Unknown;
        }
        let Some(stamps) = shared.inventory_stamps.get() else {
            return Census::Unknown;
        };
        let applied = stamps.applied_instances(after.map(tokio::time::Instant::from_std));
        let cells: Vec<u32> = shared.route_rows.lock().unwrap().keys().copied().collect();
        // read after the stamps: a reconcile updates `occupancy` before its stamp, so this is at least as new
        let occupancy = shared.occupancy.borrow();
        cells
            .iter()
            .try_fold(0u64, |total, cell| {
                applied
                    .contains(cell)
                    .then(|| total + u64::from(occupancy.get(cell).copied().unwrap_or(0)))
            })
            .map_or(Census::NotYet, Census::Counted)
    }

    fn ask(&self) {
        if let Some(stamps) = self.shared.inventory_stamps.get() {
            stamps.ask();
        }
    }
}

impl TerminalHandle {
    /// TC-D15 — the route snapshot watch, wired into DaemonState by bootstrap
    /// so the mgmt plane can serve hello + the routes subscription without
    /// learning how cells are supervised.
    pub fn routes_rx(&self) -> watch::Receiver<TerminalRouteSnapshot> {
        self.shared.routes.subscribe()
    }

    /// F1 — the next stdin line of every running cell (the freeway host's `revokeClient`, as
    /// the floor relays it): how many cells it was handed to. A cell that is not running holds no
    /// grant to refuse, and one born later holds none minted before.
    pub fn tell_cells(&self, line: &Value) -> usize {
        let cells = self.shared.cell_updates.lock().unwrap();
        cells
            .values()
            .filter(|cell| cell.send(line.clone()).is_ok())
            .count()
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
            // it. *Corrected 2026-10-19 (IL-D6):* it answers from its own
            // thread, on a changed total and at least every `LEDGER_INTERVAL`,
            // rather than inside each reconcile.
            PressureClass::PtyExhausted => {}
        }
    }
}

pub struct TerminalUnit {
    shared: Arc<Shared>,
    tasks: Mutex<Vec<TaskGuard>>,
    /// TC-S2 — held for the cell supervisor: per-instance endpoint resolution
    /// and the cell binary's location both come from the ONE derivation
    /// authority rather than being re-spelled here.
    config: NativeConfig,
}

impl TerminalUnit {
    /// TM-1 — no `MeshHandle` argument: the flag no longer selects a serve
    /// shape, so this unit has nothing to ask the gateway for. Cells are the
    /// only serve path (TC-D3/TC-S2's extraction, now unconditional), and a
    /// cell resolves its per-instance endpoint names at each spawn — which is
    /// why no endpoint is minted here at all.
    pub fn new(config: &NativeConfig, ping: UnboundedSender<()>) -> Self {
        Self {
            shared: Arc::new(Shared {
                served: Mutex::new(UnitHealth {
                    unit: UNIT_ID.to_string(),
                    state: UnitState::Starting,
                    detail: None,
                    auth_url: None,
                }),
                ping,
                stopping: watch::channel(false).0,
                routes: watch::channel(TerminalRouteSnapshot {
                    revision: 0,
                    cells: Vec::new(),
                })
                .0,
                route_rows: Mutex::new(BTreeMap::new()),
                cell_updates: Mutex::new(BTreeMap::new()),
                // Seeded so the composition has both classes from the first
                // health read — an absent class would compose as "all up" the
                // moment the other served.
                class_states: Mutex::new(BTreeMap::from([
                    (
                        class_label(TerminalWorkloadClass::Agent),
                        ClassPlaneState::Starting("spawning".into()),
                    ),
                    (
                        class_label(TerminalWorkloadClass::Interactive),
                        ClassPlaneState::Starting("spawning".into()),
                    ),
                ])),
                occupancy: watch::channel(BTreeMap::new()).0,
                strikes: Mutex::new(std::collections::HashMap::new()),
                next_instance: std::sync::atomic::AtomicU32::new(0),
                inventory_faults: Mutex::new(BTreeMap::new()),
                inventory_fault: Mutex::new(None),
                inventory_stale: Mutex::new(BTreeMap::new()),
                inventory_stamps: std::sync::OnceLock::new(),
                ledger_late: Mutex::new(None),
                fd_pressure: Mutex::new(None),
                pty_pressure: Mutex::new(None),
                fd_gauge: Mutex::new(FdPressureGauge::new()),
            }),
            tasks: Mutex::new(Vec::new()),
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

    /// Assembly per spec §4.1 (TC-D3/TC-S2, unconditional since TM-1). The
    /// 0700 run directory is already created by `bootstrap` before any unit
    /// starts; this unit binds nothing itself — the cell supervisor owns spawn,
    /// hello, route publication, restart intensity, and the drain-on-stop, and
    /// this unit's health cells are its reporting surface.
    async fn start(&self) -> anyhow::Result<()> {
        self.shared.set(
            UnitState::Starting,
            Some("spawning the terminal cell".into()),
        );
        let task = tokio::spawn(supervise_cells(self.shared.clone(), self.config.clone()));
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

    /// Stop = the cells' drain, then teardown. No PTY survives field-native —
    /// the honest ceiling the product promises and nothing more.
    async fn stop(&self) -> anyhow::Result<()> {
        // Ask, then wait bounded: the supervisor drops each cell's leash (stdin
        // EOF — the portable drain trigger) and publishes the empty snapshot
        // once they have exited; past DRAIN + EXIT_GRACE the supervisor kills.
        // The empty snapshot doubles as the completion signal here, and the
        // TaskGuard clear beneath reaps whatever a pathological hang leaves.
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
        Ok(())
    }
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
        config.allowed_origins.clone(),
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
    allowed_origins: Vec<String>,
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
        &allowed_origins,
        &mut reap,
    )
    .await;
    shared.cell_updates.lock().unwrap().remove(&instance);
    shared.route_remove(instance);
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
    allowed_origins: &[String],
    reap: &mut watch::Receiver<bool>,
) -> CellEnd {
    let mut stopping = shared.stopping.subscribe();
    // A stale crumb from a re-used ordinal after an unclean floor boot must
    // not color this generation (the cell also fences by boot id).
    let _ = std::fs::remove_file(crumb);
    let token = mint_token();
    // TP-S1 — the per-cell-boot GRANT KEY beside the token: the HMAC-SHA256
    // key under every TPv3 grant fieldd issues for this cell. It rides the
    // route row over the paired mgmt channel and nowhere else (EL7: never env,
    // never disk, never logs); the cell receives it at spawn from TP-S3a on.
    let grant_key = mint_grant_key();
    // The bootstrap line: the token AND the grant key ride the pipe, never argv
    // or env (EL7); the renderer Origins the doors admit ride beside them
    // (TP-S3a — a non-secret, but one seam). The child's shape — argv, the
    // bootstrap, the hello, stderr, the leash — is the floor's ONE
    // `SupervisedChild` (FW-D4), which the freeway host runs on too.
    let spec = ChildSpec {
        bin,
        args: vec![
            "--control".into(),
            control.into(),
            "--frame".into(),
            frame.into(),
            "--config".into(),
            config_file.as_os_str().to_owned(),
            "--instance".into(),
            instance.to_string().into(),
            "--crumb".into(),
            crumb.as_os_str().to_owned(),
        ],
        bootstrap: serde_json::json!({
            "token": token,
            "grantKey": grant_key,
            "grantKeyGeneration": 1,
            "allowedOrigins": allowed_origins,
        }),
        hello_deadline: Duration::from_millis(registries::cell_supervision::HELLO_DEADLINE_MS),
        stderr: StderrLabel {
            event: "field_native.terminal.cell_stderr",
            component: "terminal",
            what: "cell",
            instance,
        },
        inherit: None,
    };
    let (mut cell, hello) = match SupervisedChild::start::<CellHello>(spec).await {
        Ok(started) => started,
        Err(StartFailure::Spawn(error)) => {
            return CellEnd::Crashed {
                detail: format!("spawn failed: {error}"),
                attribution: Attribution::Unknown,
            }
        }
        Err(failure) => {
            let detail = match failure {
                StartFailure::Bootstrap(error) => format!("bootstrap write failed: {error}"),
                StartFailure::HelloUnparsed(error) => format!("hello did not parse: {error}"),
                StartFailure::ExitedBeforeHello => "the cell exited before its hello".into(),
                StartFailure::NoHello(deadline) => format!("no hello within {deadline:?} — killed"),
                StartFailure::Spawn(_) => unreachable!("answered above"),
            };
            return CellEnd::Crashed {
                detail,
                attribution: read_crumb_attribution(crumb, None),
            };
        }
    };
    let (updates_out, mut updates) = tokio::sync::mpsc::unbounded_channel();
    shared
        .cell_updates
        .lock()
        .unwrap()
        .insert(instance, updates_out);
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
            grant_key: Some(grant_key),
            grant_key_generation: Some(1),
            // TP-S3a — the cell's T1 doors, when it serves them. A URL the
            // contract's loopback pattern refuses is logged and dropped — the
            // row then honestly carries no doors rather than a dial nobody can.
            doors: hello.doors.as_ref().and_then(|doors| {
                match (doors.control_url.parse(), doors.frames_url.parse()) {
                    (Ok(control_url), Ok(frames_url)) => Some(crate::contracts::CellEndpointSet {
                        control_url,
                        frames_url,
                    }),
                    _ => {
                        tracing::warn!(
                            event = "field_native.terminal.cell_doors_rejected",
                            component = "terminal",
                            instance,
                            "the cell's door URLs failed the contract's loopback pattern"
                        );
                        None
                    }
                }
            }),
            workload_class: Some(plan.class),
            role: Some(plan.role),
        },
    );
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
    // Pinned across the loop: an update is relayed and the wait goes on. `Child::wait` is
    // cancel-safe, so each turn arms it afresh.
    tokio::pin!(requested);
    loop {
        tokio::select! {
            _ = &mut requested => {
                // The leash: EOF asks the cell to drain; past the budget, kill.
                let drained = cell.drain(drain_budget).await;
                if drained.overran {
                    tracing::warn!(
                        event = "field_native.terminal.cell_drain_overrun",
                        component = "terminal",
                        instance,
                        "The cell outlived its drain budget and was killed; drain unknown"
                    );
                } else if let Some(line) = drained.last_line {
                    log_cell_exit_report(instance, &line);
                }
                return CellEnd::Stopped;
            }
            status = cell.wait() => {
                // Crashed (a requested stop never reaches here first). The exit
                // report is best-effort — a SIGKILLed cell wrote none.
                let mut detail = format!("{status:?}");
                if let Some(line) = cell.last_line().await {
                    log_cell_exit_report(instance, &line);
                    detail = format!("{detail}; {line}");
                }
                let attribution = read_crumb_attribution(crumb, Some(&hello.cell_boot_id));
                return CellEnd::Crashed { detail, attribution };
            }
            Some(line) = updates.recv() => {
                // A cell whose stdin is gone is dying; its wait says why.
                if let Err(error) = cell.update(&line).await {
                    tracing::warn!(
                        event = "field_native.terminal.cell_update_failed",
                        component = "terminal",
                        instance,
                        error = %error,
                        "A stdin update did not reach the cell"
                    );
                }
            }
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
    let ledger = LedgerThread::spawn(ledger, handle.shared.clone());
    install_inventory_with(handle, state, ledger, InventoryBounds::REGISTRY)
}

/// `install_inventory` with its parts named: the ledger's thread and the
/// bounds. Production's are `LedgerThread::spawn` and the registry's; a test
/// names its own.
///
/// IL-D1 — the sampler is made here, beside the merged inventory, and states
/// the bound on the observed state before this returns, so no subscriber ever
/// reads this floor without it. It runs as a task the manager's task owns:
/// aborting the inventory aborts the judge with it.
fn install_inventory_with(
    handle: TerminalHandle,
    state: Arc<DaemonState>,
    ledger: LedgerThread,
    bounds: InventoryBounds,
) -> tokio::task::JoinHandle<()> {
    let stamps = Arc::new(InventoryStamps::default());
    // AL-8a — the census reads which cells have reconciled from the same stamps the judge does
    let _ = handle.shared.inventory_stamps.set(stamps.clone());
    let sampler = InventorySampler::new(
        stamps.clone(),
        state.clone(),
        handle.shared.clone(),
        ledger.slot.clone(),
        bounds,
    );
    sampler.state_the_bound();
    let merged = Arc::new(MergedInventory::new(state, handle.shared.clone(), ledger));
    tokio::spawn(async move {
        let _sampler = TaskGuard(tokio::spawn(sampler.run()));
        // TC-S3 — ONE PUMP PER ROUTE ROW: each cell's sessions are observed on
        // that cell's own control socket and merged under its `cell` tag; the
        // pump manager follows the snapshot (TC-D15's re-read law, floor-side).
        // A floor with no cell yet has an empty desired set and simply waits on
        // the watch — TM-1 removed the second shape (a fixed legacy pair dialled
        // by the in-process serve), so there is no branch left to take.
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
                let Some(PumpEntry {
                    cell_boot_id,
                    _task: task,
                }) = pumps.remove(&instance)
                else {
                    continue;
                };
                // The pump is aborted before its rows go: a pump that is not
                // mid-poll is never polled again, so it cannot put them back.
                drop(task);
                merged.remove(instance);
                // IL-D1: the cell's stamp goes in the step its rows go, and
                // only here. Never by the aborted pump's drop: that pump may
                // still be finishing a poll, and it only advances a stamp that
                // is still there.
                stamps.remove(&(instance, cell_boot_id));
            }
            for (instance, (boot, endpoints, cell)) in &desired {
                if !pumps.contains_key(instance) {
                    // IL-D1: seeded at the spawn, so a cell whose first
                    // reconcile never lands ages from here and goes stale at
                    // the same bound as one that stopped answering.
                    let key: CellKey = (*instance, boot.clone());
                    stamps.seed(&key);
                    let task = TaskGuard(tokio::spawn(pump_cell(
                        endpoints.clone(),
                        CellPump::new(
                            cell.clone(),
                            merged.clone(),
                            CellStamp {
                                stamps: stamps.clone(),
                                key,
                            },
                            bounds,
                        ),
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

/// One cell's inventory pump: dial its fixed coordinates, subscribe,
/// reconcile — the S2 loop bound to one cell, publishing under its tag. The
/// manager aborts this task when the row leaves the snapshot, so a dead
/// cell's socket is never redialed forever.
async fn pump_cell(endpoints: TerminalEndpoints, mut pump: CellPump) {
    loop {
        match ControlClient::connect(&endpoints.control_socket, &endpoints.auth_token).await {
            Ok((client, events)) => {
                pump.stamp.doing(PumpActivity::Idle);
                match pump_inventory_cell(Arc::new(client), events, &mut pump).await {
                    Ok(()) => pump.watch.disconnected(),
                    Err(error) => pump.watch.failed(&error),
                }
            }
            Err(error) => pump.watch.failed(&error),
        }
        // Waiting out the delay, then dialing again: no reconcile is in flight.
        pump.stamp.doing(PumpActivity::Dialing);
        tokio::time::sleep(RECONNECT_DELAY).await;
    }
}

/// One cell's pump, as it is carried across its connections: the cell it
/// publishes for, its stamp (IL-D1), its bounds, the fault streak and the slow
/// episode (IL-D3), and the events it owed no reconcile (item 52 (b)), all of
/// which outlive a reconnect.
struct CellPump {
    instance: u32,
    cell: ObservedTerminalCell,
    merged: Arc<MergedInventory>,
    stamp: CellStamp,
    bounds: InventoryBounds,
    watch: InventoryWatch,
    slow: SlowEpisode,
    ignored: IgnoredEvents,
}

impl CellPump {
    fn new(
        cell: ObservedTerminalCell,
        merged: Arc<MergedInventory>,
        stamp: CellStamp,
        bounds: InventoryBounds,
    ) -> Self {
        let instance = stamp.key.0;
        Self {
            instance,
            watch: InventoryWatch::for_cell(instance, merged.shared()),
            cell,
            merged,
            stamp,
            bounds,
            slow: SlowEpisode::default(),
            ignored: IgnoredEvents::default(),
        }
    }

    /// An event this pump owes no reconcile (`INVENTORY_EVENTS`): counted, the
    /// first of each kind said once, every later one at debug with the total.
    fn ignored(&mut self, event: &Value) {
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("(untyped)");
        if self.ignored.note(kind) {
            tracing::info!(
                event = "field_native.terminal.inventory_event_ignored",
                component = "terminal",
                cell = self.instance,
                cell_boot_id = %self.stamp.key.1,
                kind,
                ignored_events = self.ignored.total,
                "The terminal inventory heard an event it owes no reconcile; it is counted, and \
                 the backstop still reconciles"
            );
        } else {
            tracing::debug!(
                event = "field_native.terminal.inventory_event_ignored",
                component = "terminal",
                cell = self.instance,
                cell_boot_id = %self.stamp.key.1,
                kind,
                ignored_events = self.ignored.total,
                "The terminal inventory owes this event no reconcile either"
            );
        }
    }

    /// A `list-sessions` answered and was applied: the fault streak ends, and
    /// a slow one is said, once per episode (IL-D3 (a)).
    fn reconciled(&mut self, reconciled: &Reconciled) {
        self.watch.reconciled();
        let timing = &reconciled.timing;
        let sessions = reconciled.sessions.len();
        match self.slow.observe(timing.took, self.bounds.slow) {
            SlowStep::Fast => {}
            SlowStep::Opened => tracing::warn!(
                event = "field_native.terminal.inventory_slow",
                component = "terminal",
                episode = "opened",
                cell = self.instance,
                cell_boot_id = %self.stamp.key.1,
                ms = ms(timing.took),
                bound_ms = ms(self.bounds.slow),
                sessions,
                writer_wait_ms = ms(timing.writer_wait),
                round_trip_ms = ms(timing.round_trip),
                merged_lock_wait_ms = ms(timing.merged_lock_wait),
                publish_ms = ms(timing.publish),
                "A reconcile of the terminal inventory was slow; the parts say where its time \
                 went"
            ),
            SlowStep::Continued { count } => tracing::debug!(
                event = "field_native.terminal.inventory_slow",
                component = "terminal",
                episode = "continues",
                cell = self.instance,
                cell_boot_id = %self.stamp.key.1,
                count,
                ms = ms(timing.took),
                sessions,
                writer_wait_ms = ms(timing.writer_wait),
                round_trip_ms = ms(timing.round_trip),
                merged_lock_wait_ms = ms(timing.merged_lock_wait),
                publish_ms = ms(timing.publish),
                "The terminal inventory's reconciles are still slow"
            ),
            SlowStep::Closed { count, max, total } => tracing::info!(
                event = "field_native.terminal.inventory_slow",
                component = "terminal",
                episode = "closed",
                cell = self.instance,
                cell_boot_id = %self.stamp.key.1,
                count,
                max_ms = ms(max),
                total_ms = ms(total),
                "The terminal inventory's reconciles are prompt again"
            ),
        }
    }
}

/// IL-D3 — where one applied reconcile's time went. The four parts add up to
/// `took`, give or take the clock reads between them.
#[derive(Clone, Copy, Debug)]
struct ReconcileTiming {
    /// When the reconcile began, before the writer lock: the cell's new
    /// `as_of` once its answer is applied.
    began: tokio::time::Instant,
    /// From `began` until applied.
    took: Duration,
    /// Waiting for the connection's writer: this floor's own lock, which every
    /// request on the connection shares (the births governor's among them).
    writer_wait: Duration,
    /// The write and the cell's answer.
    round_trip: Duration,
    /// Waiting for the merged inventory's lock, which every cell's pump and the
    /// manager's `remove` share.
    merged_lock_wait: Duration,
    /// The rest after the answer: composing the rows and publishing them and
    /// the occupancy. The ledger's file work is not here: its thread does it.
    publish: Duration,
}

/// IL-D3 (a) — one line per slow EPISODE rather than one per slow reconcile. A
/// busy cell just over the bound would write a line a second, ~86 000 a day,
/// the volume `InventoryWatch` damps for failures. The first slow one is the
/// news (a warn, with its parts); later ones are debug, carrying the count;
/// the first prompt one closes the episode with one info line: its count, its
/// slowest and its total — WG-D0's one-line-per-episode shape.
#[derive(Debug, Default)]
struct SlowEpisode {
    count: u32,
    max: Duration,
    total: Duration,
}

/// What one observation asks of the log.
#[derive(Debug, PartialEq, Eq)]
enum SlowStep {
    /// Within the bound, and no episode open.
    Fast,
    /// The first slow one: said at once, with its parts.
    Opened,
    /// A later slow one of the same episode, the `count`th.
    Continued { count: u32 },
    /// The first prompt one after an episode, which closes it.
    Closed {
        count: u32,
        max: Duration,
        total: Duration,
    },
}

impl SlowEpisode {
    /// Slow is slower than `bound`; one exactly at it is not.
    fn observe(&mut self, took: Duration, bound: Duration) -> SlowStep {
        if took > bound {
            self.count += 1;
            self.max = self.max.max(took);
            self.total += took;
            if self.count == 1 {
                SlowStep::Opened
            } else {
                SlowStep::Continued { count: self.count }
            }
        } else if self.count > 0 {
            let closed = SlowStep::Closed {
                count: self.count,
                max: self.max,
                total: self.total,
            };
            *self = Self::default();
            closed
        } else {
            SlowStep::Fast
        }
    }
}

/// A cell, as the stamps key it: its instance and its boot id. A re-used
/// ordinal with a new boot id is a different cell, with an age of its own.
type CellKey = (u32, String);

/// IL-D1 — how old each cell's inventory is: per cell, the moment its last
/// applied reconcile began.
///
/// A small map of its own under its own lock, beside the merged inventory and
/// never under that inventory's lock, so the sampler that reads it can never be
/// held behind a pump, the manager or the ledger's hand-off.
///
/// The manager seeds a stamp when it spawns the cell's pump and removes it in
/// the step that removes the cell's rows. A pump only ever changes a stamp that
/// is there: a pump the manager has just aborted may still be finishing its
/// poll, and its late write must not bring a gone cell's stamp back.
#[derive(Default)]
struct InventoryStamps {
    cells: Mutex<BTreeMap<CellKey, InventoryStamp>>,
    /// Wakes the sampler when a cell is removed, so a gone cell leaves
    /// `staleCells` and the unit's health at once rather than at the next
    /// sample.
    removed: tokio::sync::Notify,
    /// AL-8a — a census that must be fresh bumps this, and every pump hears it
    /// as an event owed a reconcile: each cell reconciles at its next tick
    /// rather than at its backstop. A watch, so a pump in the middle of a
    /// reconcile still hears the bump when it next waits.
    asked: watch::Sender<u64>,
}

#[derive(Clone, Copy, Debug)]
struct InventoryStamp {
    /// When the cell's last applied reconcile began, before the writer lock;
    /// the pump's spawn until one has.
    as_of: tokio::time::Instant,
    /// `as_of`'s wall-clock twin in unix ms, read beside it: the `since` a
    /// reader is told, whose age counts a sleep the monotonic clock does not.
    since: u64,
    /// What the pump is doing now, which the stale line reports.
    activity: PumpActivity,
    /// AL-8a — a reconcile has been applied at least once, published or not (an empty cell's first reconcile equals
    /// the pump's seed and publishes nothing, so `occupancy` alone cannot say it).
    applied: bool,
}

/// What a cell's pump is doing, as the stale line says it (IL-D3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PumpActivity {
    /// Dialing the cell, or waiting out the delay before the next dial.
    Dialing,
    /// Connected, between reconciles.
    Idle,
    /// A reconcile in flight: the part it is in, and when it began.
    Reconciling {
        part: ReconcilePart,
        began: tokio::time::Instant,
    },
}

impl PumpActivity {
    fn label(self) -> &'static str {
        match self {
            PumpActivity::Dialing => "dial",
            PumpActivity::Idle => "none",
            PumpActivity::Reconciling { part, .. } => part.label(),
        }
    }
}

/// The parts of a reconcile, in order (IL-D3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReconcilePart {
    /// Waiting for the connection's writer.
    WriterWait,
    /// The request written; the cell's answer awaited.
    RoundTrip,
    /// The answer in; waiting for the merged inventory's lock, or holding it.
    MergedLock,
    /// Publishing the cell's changed rows and the occupancy.
    Publish,
}

impl ReconcilePart {
    fn label(self) -> &'static str {
        match self {
            ReconcilePart::WriterWait => "writer_wait",
            ReconcilePart::RoundTrip => "round_trip",
            ReconcilePart::MergedLock => "merged_lock",
            ReconcilePart::Publish => "publish",
        }
    }
}

impl InventoryStamps {
    /// A new cell's stamp: its age counts from now.
    fn seed(&self, key: &CellKey) {
        let stamp = InventoryStamp {
            as_of: tokio::time::Instant::now(),
            since: unix_ms_now(),
            activity: PumpActivity::Dialing,
            applied: false,
        };
        self.cells.lock().unwrap().insert(key.clone(), stamp);
    }

    fn remove(&self, key: &CellKey) {
        if self.cells.lock().unwrap().remove(key).is_some() {
            self.removed.notify_one();
        }
    }

    /// Change a stamp that is there; a key with none is a cell already gone.
    fn update(&self, key: &CellKey, change: impl FnOnce(&mut InventoryStamp)) {
        if let Some(stamp) = self.cells.lock().unwrap().get_mut(key) {
            change(stamp);
        }
    }

    fn snapshot(&self) -> BTreeMap<CellKey, InventoryStamp> {
        self.cells.lock().unwrap().clone()
    }

    /// AL-8a — every pump reconciles at its next tick.
    fn ask(&self) {
        self.asked.send_modify(|asks| *asks = asks.wrapping_add(1));
    }

    fn asked(&self) -> watch::Receiver<u64> {
        self.asked.subscribe()
    }

    /// AL-8a — the instances whose inventory has been applied, by a reconcile that began after `after` when one is
    /// given (`as_of` is when the last applied one began).
    fn applied_instances(
        &self,
        after: Option<tokio::time::Instant>,
    ) -> std::collections::BTreeSet<u32> {
        self.cells
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, stamp)| stamp.applied && after.is_none_or(|after| stamp.as_of > after))
            .map(|((instance, _), _)| *instance)
            .collect()
    }
}

/// One pump's handle on its own cell's stamp.
struct CellStamp {
    stamps: Arc<InventoryStamps>,
    key: CellKey,
}

impl CellStamp {
    fn doing(&self, activity: PumpActivity) {
        self.stamps
            .update(&self.key, |stamp| stamp.activity = activity);
    }

    /// The reconcile in flight moved on to `part`.
    fn in_part(&self, part: ReconcilePart) {
        self.stamps.update(&self.key, |stamp| {
            if let PumpActivity::Reconciling { part: current, .. } = &mut stamp.activity {
                *current = part;
            }
        });
    }

    /// A reconcile that began at `began` (wall clock `since`) was applied: the
    /// cell's inventory is as old as that moment.
    fn applied(&self, began: tokio::time::Instant, since: u64) {
        self.stamps.update(&self.key, |stamp| {
            stamp.as_of = began;
            stamp.since = since;
            stamp.activity = PumpActivity::Idle;
            stamp.applied = true;
        });
    }
}

/// IL-D1 — the judge. Every `bounds.sample` it reads every cell's stamp and
/// the ledger's `as_of`, and speaks only on a transition, so a floor that stays
/// fresh, or stays stale, publishes nothing more.
///
/// It runs outside every pump, so a pump stuck in a wait cannot stop it — as
/// long as a runtime worker is free, which is why the ledger's file work left
/// the inventory's lock first (IL-D6). A runtime stalled whole stops it too;
/// that half is fieldd's, which ages its own copy when the stream stops.
///
/// It never takes the merged inventory's lock: the stamps are its only input
/// from the pumps.
struct InventorySampler {
    stamps: Arc<InventoryStamps>,
    state: Arc<DaemonState>,
    shared: Arc<Shared>,
    /// The ledger's slot, read for its `as_of`; `None` with no ledger.
    ledger: Option<Arc<LedgerSlot>>,
    bounds: InventoryBounds,
    /// The cells judged stale at the last sample.
    stale: BTreeMap<CellKey, StaleEntry>,
    /// The ledger's `as_of` while it is judged late.
    ledger_late: Option<LedgerAsOf>,
}

/// One stale cell, as the sampler published it.
#[derive(Clone, Copy, Debug)]
struct StaleEntry {
    /// The stamp's `as_of` when the cell went stale. A reconcile that lands
    /// while the cell is still past the bound does not move it: the entry,
    /// its `since` and the unit's instant change only on a transition, so a
    /// reader's age may run long by that reconcile, never short.
    as_of: tokio::time::Instant,
    /// Its wall-clock twin: the `since` published in `staleCells`.
    since: u64,
}

impl InventorySampler {
    fn new(
        stamps: Arc<InventoryStamps>,
        state: Arc<DaemonState>,
        shared: Arc<Shared>,
        ledger: Option<Arc<LedgerSlot>>,
        bounds: InventoryBounds,
    ) -> Self {
        Self {
            stamps,
            state,
            shared,
            ledger,
            bounds,
            stale: BTreeMap::new(),
            ledger_late: None,
        }
    }

    /// IL-D4 — state the bound this floor judges by on the observed state.
    /// Its presence is how a reader knows this floor judges at all: an older
    /// floor's state has none. Called before the judge starts, so the bound is
    /// on every state this floor publishes, and every later write keeps it.
    fn state_the_bound(&self) {
        let bound = Some(ms(self.bounds.stale));
        self.state.observed_tx.send_if_modified(|observed| {
            let changed = observed.inventory_bound_ms != bound;
            observed.inventory_bound_ms = bound;
            changed
        });
    }

    async fn run(mut self) {
        let stamps = self.stamps.clone();
        let mut ticker = tokio::time::interval(self.bounds.sample);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = stamps.removed.notified() => {}
            }
            self.judge_cells(tokio::time::Instant::now());
            self.judge_ledger(std::time::Instant::now());
        }
    }

    /// Every cell's age against the bound. A cell that crossed it enters, with
    /// one warn; a cell whose age is back inside the bound, or that is gone,
    /// leaves, with one info. Only then is anything published.
    ///
    /// A reconcile that lands while its cell is still past the bound (one that
    /// itself began more than the bound ago) is no transition: the cell stays
    /// stale with the `since` and the instant it went stale with, and nothing
    /// is said or published until a reconcile that began inside the bound
    /// lands. The pump's next one is due at once, since its backstop counts
    /// from when the late one began.
    fn judge_cells(&mut self, now: tokio::time::Instant) {
        let stamps = self.stamps.snapshot();
        let bound = self.bounds.stale;
        let mut moved = false;

        let leaving: Vec<CellKey> = self
            .stale
            .keys()
            .filter(|key| match stamps.get(*key) {
                Some(stamp) => now.saturating_duration_since(stamp.as_of) < bound,
                None => true,
            })
            .cloned()
            .collect();
        for key in leaving {
            let Some(entry) = self.stale.remove(&key) else {
                continue;
            };
            moved = true;
            let lasted = ms(now.saturating_duration_since(entry.as_of + bound));
            if stamps.contains_key(&key) {
                tracing::info!(
                    event = "field_native.terminal.inventory_stale",
                    component = "terminal",
                    transition = "left",
                    cell = key.0,
                    cell_boot_id = %key.1,
                    stale_ms = lasted,
                    "A cell's terminal inventory is within its bound again"
                );
            } else {
                tracing::info!(
                    event = "field_native.terminal.inventory_stale",
                    component = "terminal",
                    transition = "removed",
                    cell = key.0,
                    cell_boot_id = %key.1,
                    stale_ms = lasted,
                    "A stale cell's inventory went with its cell"
                );
            }
        }

        for (key, stamp) in &stamps {
            if self.stale.contains_key(key) {
                continue;
            }
            let age = now.saturating_duration_since(stamp.as_of);
            if age < bound {
                continue;
            }
            moved = true;
            let in_flight_ms = match stamp.activity {
                PumpActivity::Reconciling { began, .. } => ms(now.saturating_duration_since(began)),
                PumpActivity::Dialing | PumpActivity::Idle => 0,
            };
            tracing::warn!(
                event = "field_native.terminal.inventory_stale",
                component = "terminal",
                transition = "entered",
                cell = key.0,
                cell_boot_id = %key.1,
                age_ms = ms(age),
                bound_ms = ms(bound),
                since_ms = stamp.since,
                in_flight = stamp.activity.label(),
                in_flight_ms,
                "A cell's terminal inventory is older than its bound: no reconcile has been \
                 applied since"
            );
            self.stale.insert(
                key.clone(),
                StaleEntry {
                    as_of: stamp.as_of,
                    since: stamp.since,
                },
            );
        }

        if moved {
            self.publish_cells();
        }
    }

    /// The stale set, published on its two surfaces: `staleCells` on the
    /// observed stream (and the bound beside it), and the unit's stale slot,
    /// which names the fixed instant and never a running age, so a cell that
    /// stays stale does not republish health every second.
    fn publish_cells(&self) {
        let bound = self.bounds.stale;
        // A cell whose hello carried an empty boot id cannot be named in the
        // contract; the unit's health still names it by instance.
        let cells: Vec<ObservedStaleCell> = self
            .stale
            .iter()
            .filter_map(|((instance, cell_boot_id), entry)| {
                Some(ObservedStaleCell {
                    cell_boot_id: cell_boot_id.parse().ok()?,
                    cell_instance_id: i64::from(*instance),
                    since: entry.since,
                })
            })
            .collect();
        let bound_ms = Some(ms(bound));
        self.state.observed_tx.send_modify(|observed| {
            observed.inventory_bound_ms = bound_ms;
            observed.stale_cells = cells;
        });
        self.shared.set_inventory_stale(
            self.stale
                .iter()
                .map(|((instance, _), entry)| {
                    (
                        *instance,
                        format!(
                            "no reconcile applied since {} (bound {})",
                            utc_clock(entry.since),
                            spell_bound(bound)
                        ),
                    )
                })
                .collect(),
        );
    }

    /// IL-D6 — the ledger's answer against the same bound. Its thread cannot
    /// say it is stuck, since a thread inside a flock says nothing, so the
    /// judge reads its `as_of`. On std's clock, the one the thread stamps.
    fn judge_ledger(&mut self, now: std::time::Instant) {
        let Some(slot) = &self.ledger else {
            return;
        };
        let bound = self.bounds.stale;
        let late = slot
            .as_of_stamp()
            .filter(|as_of| now.saturating_duration_since(as_of.at) >= bound);
        match (late, self.ledger_late) {
            (Some(as_of), held) if held != Some(as_of) => {
                if held.is_none() {
                    tracing::warn!(
                        event = "field_native.admission.late",
                        component = "terminal",
                        transition = "entered",
                        unanswered_ms = ms(now.saturating_duration_since(as_of.at)),
                        bound_ms = ms(bound),
                        since_ms = as_of.since,
                        "The machine-wide admission ledger has not answered within its bound; \
                         the PTY budget this floor reports may be old"
                    );
                }
                self.ledger_late = Some(as_of);
                self.shared.set_ledger_late(Some(format!(
                    "the machine-wide ledger has not answered since {} (bound {})",
                    utc_clock(as_of.since),
                    spell_bound(bound)
                )));
            }
            (None, Some(held)) => {
                tracing::info!(
                    event = "field_native.admission.late",
                    component = "terminal",
                    transition = "left",
                    late_ms = ms(now.saturating_duration_since(held.at + bound)),
                    "The machine-wide admission ledger answers within its bound again"
                );
                self.ledger_late = None;
                self.shared.set_ledger_late(None);
            }
            _ => {}
        }
    }
}

/// The floor's wall clock in unix ms: the clock of every `since`.
fn unix_ms_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(ms)
        .unwrap_or(0)
}

/// A duration in whole milliseconds, as the log lines and the contract carry it.
fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// A unix-ms instant as the unit's health names it: `HH:MM:SSZ`, UTC.
fn utc_clock(unix_ms: u64) -> String {
    let seconds = i64::try_from(unix_ms / 1_000).unwrap_or(i64::MAX);
    let at = time::OffsetDateTime::from_unix_timestamp(seconds)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!("{:02}:{:02}:{:02}Z", at.hour(), at.minute(), at.second())
}

/// A bound as the unit's health spells it: whole seconds as `10 s`, anything
/// finer in milliseconds.
fn spell_bound(bound: Duration) -> String {
    if bound.subsec_millis() == 0 {
        format!("{} s", bound.as_secs())
    } else {
        format!("{} ms", ms(bound))
    }
}

/// TC-S3 — the merged observed inventory. Every cell pump owns its rows here,
/// and every mutation republishes three composed truths at once: the observed
/// inventory (rows in instance order, each cell's rows session-sorted), the
/// per-cell occupancy watch the class supervisors rotate and reap on, and
/// this floor's TOTAL governed count into the admission ledger — one meaning
/// of "a session on this device" across all three (TC-L1f).
///
/// *Corrected 2026-10-19 (IL-D6):* the third is not written at once. The total
/// is computed under this lock and handed to the ledger's own thread
/// (`LedgerThread`), which does the file work; no file is opened and no flock
/// is taken under this lock, so a ledger another pair holds stalls no pump.
/// The hand-off happens under the lock, so the thread sees totals in the order
/// they were computed: it publishes the newest it has been handed, and never
/// an older one after a newer.
///
/// How old each cell's rows are is not kept here: `InventoryStamps` keeps it
/// beside this inventory, under a lock of its own, so the sampler that judges
/// it never waits on this one (IL-D1).
struct MergedInventory {
    state: Arc<DaemonState>,
    shared: Arc<Shared>,
    inner: Mutex<MergedInner>,
}

struct MergedInner {
    rows: BTreeMap<u32, Vec<ObservedTerminal>>,
    governed: BTreeMap<u32, u32>,
    /// Dropped with the inventory, which asks the ledger's thread to stop.
    ledger: LedgerThread,
}

impl MergedInventory {
    fn new(state: Arc<DaemonState>, shared: Arc<Shared>, ledger: LedgerThread) -> Self {
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

    /// The lock, and how long this caller waited for it: a reconcile's
    /// `merged_lock_wait` (IL-D3).
    fn lock(&self) -> (std::sync::MutexGuard<'_, MergedInner>, Duration) {
        let asked = tokio::time::Instant::now();
        let inner = self.inner.lock().unwrap();
        (inner, asked.elapsed())
    }

    /// One cell's rows, applied and published. `publishing` runs once the
    /// lock is released, before the publish: where a reconcile marks its
    /// in-flight part (IL-D3). Answers how long it waited for the lock.
    fn set_rows(
        &self,
        instance: u32,
        rows: Vec<ObservedTerminal>,
        publishing: impl FnOnce(),
    ) -> Duration {
        let (composed, occupancy, waited) = {
            let (mut inner, waited) = self.lock();
            inner.rows.insert(instance, rows);
            (
                compose_observed(&inner.rows),
                compose_occupancy(&inner.rows),
                waited,
            )
        };
        publishing();
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
        waited
    }

    fn remove(&self, instance: u32) {
        let (composed, occupancy) = {
            let mut inner = self.inner.lock().unwrap();
            inner.rows.remove(&instance);
            inner.governed.remove(&instance);
            let total: u32 = inner.governed.values().sum();
            inner.ledger.hand_off(total);
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

    /// One cell's governed count, and the total handed to the ledger's thread.
    /// Answers how long it waited for the lock.
    fn observe_governed(&self, instance: u32, governed: u32) -> Duration {
        let (mut inner, waited) = self.lock();
        inner.governed.insert(instance, governed);
        let total: u32 = inner.governed.values().sum();
        inner.ledger.hand_off(total);
        waited
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
/// far cheaper than that dishonesty. The ledger's thread keeps it on its own
/// clock, so the refresh comes due whether or not a reconcile hands it a total.
const LEDGER_INTERVAL: Duration = Duration::from_secs(5);

/// The ledger thread's name, as a sample, a crash report or a debugger shows it.
const LEDGER_THREAD_NAME: &str = "terminal-ledger";

/// TC-L1f's production seam: this floor's claim on the machine-wide budget, kept
/// current from the inventory rather than from events.
///
/// `list-sessions` is truth (spec §10.5), so the ledger is TOLD the count
/// instead of trusted to have counted every create and exit. That is what makes
/// a missed event or a torn connection unable to leak budget: the next reconcile
/// corrects the entry outright.
///
/// The file work runs on ONE thread of its own (IL-D6). A publish takes the
/// ledger's `flock` twice, with no timeout, against every VibeField pair on the
/// machine, so it runs neither on a tokio worker nor under the inventory's
/// lock: there, a pair holding that flock parked every pump that reached the
/// lock and, with enough cells, every worker the floor has. The inventory hands
/// this handle its newest total and moves on; the thread publishes it when the
/// file lets it.
///
/// A dedicated `std::thread` rather than `spawn_blocking`, because a runtime's
/// shutdown waits without bound for its blocking pool, and a flock held forever
/// would hold the floor's exit with it. Nothing joins this thread: dropping the
/// handle asks it to stop, and it stops at its next wait, or never, if its
/// flock never returns — which costs the exiting process nothing.
///
/// A ledger failure is logged once per streak and never fatal. Admission is
/// advisory (the module note on `crate::admission`), so a floor that cannot
/// reach the file keeps serving with the kernel as its only authority — which is
/// exactly the guarantee that was there before the ledger existed.
struct LedgerThread {
    /// `None` when there is no ledger to keep (win32, or a root the derivation
    /// refused) or its thread could not be started: hand-offs then go nowhere.
    slot: Option<Arc<LedgerSlot>>,
}

impl LedgerThread {
    fn spawn(ledger: Option<AdmissionLedger>, shared: Arc<Shared>) -> Self {
        Self::spawn_with_interval(ledger, shared, LEDGER_INTERVAL)
    }

    /// `spawn` with the refresh interval named. Production's is
    /// `LEDGER_INTERVAL`; a test proves the refresh law in milliseconds.
    fn spawn_with_interval(
        ledger: Option<AdmissionLedger>,
        shared: Arc<Shared>,
        interval: Duration,
    ) -> Self {
        let Some(ledger) = ledger else {
            return Self { slot: None };
        };
        let slot = Arc::new(LedgerSlot::default());
        let path = ledger.path().display().to_string();
        let pump = LedgerPump::new(ledger, shared, slot.clone(), interval);
        // The join handle is dropped on purpose: nothing joins this thread.
        match std::thread::Builder::new()
            .name(LEDGER_THREAD_NAME.into())
            .spawn(move || pump.run())
        {
            Ok(_) => Self { slot: Some(slot) },
            Err(error) => {
                tracing::warn!(
                    event = "field_native.admission.unavailable",
                    component = "terminal",
                    ledger = %path,
                    error = %error,
                    "The admission ledger's thread could not be started; the kernel remains \
                     the only admission authority"
                );
                Self { slot: None }
            }
        }
    }

    /// Hand the ledger this floor's newest total. It never waits on the file:
    /// it replaces whatever total the thread has not taken yet, so a burst
    /// coalesces to its newest, and a caller holding the inventory's lock holds
    /// it no longer than the slot's own.
    fn hand_off(&self, total: u32) {
        if let Some(slot) = &self.slot {
            slot.hand_off(total);
        }
    }
}

impl Drop for LedgerThread {
    fn drop(&mut self) {
        if let Some(slot) = &self.slot {
            slot.stop();
        }
    }
}

/// What the inventory and the ledger's thread share: a one-total mailbox, the
/// stop flag, and the ledger's `as_of`. No lock here is held across the file
/// work, so a hand-off waits for nothing but the slot itself.
#[derive(Default)]
struct LedgerSlot {
    handoff: Mutex<LedgerHandoff>,
    wake: Condvar,
    /// The moment the ledger's last returned attempt began: a publish and the
    /// machine-total read after it, whether they succeeded or failed. An error
    /// is an answer, and has its own once-per-streak line; what this measures
    /// is a stall, an attempt that has not returned. Seeded with the moment
    /// the thread took its first total, so a ledger whose first attempt never
    /// returns ages from that ask; `None` while nothing has been asked of it.
    /// On std's clock, the one the thread's waits run on, so a reader measures
    /// it against `std::time::Instant::now()`. With its wall-clock twin, which
    /// the sampler's late detail names (IL-D6).
    as_of: Mutex<Option<LedgerAsOf>>,
}

/// The ledger's `as_of`: the moment an attempt began, on std's clock, and that
/// moment's wall-clock twin in unix ms, read beside it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LedgerAsOf {
    at: std::time::Instant,
    since: u64,
}

impl LedgerAsOf {
    fn now() -> Self {
        Self {
            at: std::time::Instant::now(),
            since: unix_ms_now(),
        }
    }
}

/// A ledger attempt slower than this is a slow one, which gets its own line,
/// episode by episode (IL-D3 (a), IL-D6 (a)). The reconcile's bound: both are
/// local work that takes milliseconds when healthy.
const LEDGER_SLOW: Duration = Duration::from_millis(terminal_inventory::SLOW_RECONCILE_MS);

#[derive(Default)]
struct LedgerHandoff {
    /// The newest total handed off and not yet taken. One slot, overwritten.
    latest: Option<u32>,
    stopping: bool,
}

/// Why the ledger's thread woke.
enum LedgerWake {
    /// A total was handed off, and it is the newest.
    Total(u32),
    /// The refresh interval has passed since the last attempt.
    Due,
    /// The inventory is gone.
    Stop,
}

impl LedgerSlot {
    fn hand_off(&self, total: u32) {
        self.handoff.lock().unwrap().latest = Some(total);
        self.wake.notify_one();
    }

    fn stop(&self) {
        self.handoff.lock().unwrap().stopping = true;
        self.wake.notify_one();
    }

    /// Park until a total arrives, the deadline passes, or the inventory goes.
    /// A stop wins over a total not yet taken: a floor that is going publishes
    /// nothing more.
    fn wait(&self, deadline: Option<std::time::Instant>) -> LedgerWake {
        let mut handoff = self.handoff.lock().unwrap();
        loop {
            if handoff.stopping {
                return LedgerWake::Stop;
            }
            if let Some(total) = handoff.latest.take() {
                return LedgerWake::Total(total);
            }
            handoff = match deadline {
                None => self.wake.wait(handoff).unwrap(),
                Some(deadline) => {
                    let now = std::time::Instant::now();
                    if now >= deadline {
                        return LedgerWake::Due;
                    }
                    self.wake.wait_timeout(handoff, deadline - now).unwrap().0
                }
            };
        }
    }

    /// `as_of` on std's clock alone, as the ledger's tests read it.
    #[cfg(test)]
    fn as_of(&self) -> Option<std::time::Instant> {
        self.as_of_stamp().map(|as_of| as_of.at)
    }

    fn as_of_stamp(&self) -> Option<LedgerAsOf> {
        *self.as_of.lock().unwrap()
    }

    /// The first ask seeds `as_of`; after it, only an attempt that returned
    /// moves it.
    fn seed(&self, at: LedgerAsOf) {
        self.as_of.lock().unwrap().get_or_insert(at);
    }

    fn stamp(&self, at: LedgerAsOf) {
        *self.as_of.lock().unwrap() = Some(at);
    }
}

/// The ledger thread's own state: the file work and the bookkeeping that
/// decides when to do it. Only the thread holds it; the inventory reaches it
/// through the slot alone.
struct LedgerPump {
    ledger: AdmissionLedger,
    shared: Arc<Shared>,
    slot: Arc<LedgerSlot>,
    interval: Duration,
    published: Option<u32>,
    last: Option<std::time::Instant>,
    /// When the running streak of failed attempts began, while one runs: its
    /// first failure was said, and its end owes one line.
    failing_since: Option<std::time::Instant>,
    slow: SlowEpisode,
}

impl LedgerPump {
    fn new(
        ledger: AdmissionLedger,
        shared: Arc<Shared>,
        slot: Arc<LedgerSlot>,
        interval: Duration,
    ) -> Self {
        Self {
            ledger,
            shared,
            slot,
            interval,
            published: None,
            last: None,
            failing_since: None,
            slow: SlowEpisode::default(),
        }
    }

    /// The thread's loop: publish each newest total as it comes, and refresh
    /// the machine total on the interval while this floor's stands still.
    fn run(mut self) {
        let mut current: Option<u32> = None;
        loop {
            let deadline = current.and(self.last).map(|last| last + self.interval);
            match self.slot.wait(deadline) {
                LedgerWake::Stop => return,
                LedgerWake::Total(total) => current = Some(total),
                LedgerWake::Due => {}
            }
            if let Some(total) = current {
                self.observe(total);
            }
        }
    }

    /// Publish this floor's governed count and read back what the machine holds.
    fn observe(&mut self, governed: u32) {
        let due = self.last.is_none_or(|last| last.elapsed() >= self.interval);
        if self.published == Some(governed) && !due {
            return;
        }
        let begun = LedgerAsOf::now();
        let started = begun.at;
        self.last = Some(started);
        self.slot.seed(begun);
        let ledger = &self.ledger;
        let outcome = ledger
            .publish(governed)
            .and_then(|_| ledger.machine_total());
        // The attempt returned, an error included: the sampler's late line is
        // for a ledger that does not return, and a failure has its own.
        self.slot.stamp(begun);
        match outcome {
            Ok(machine_total) => {
                self.published = Some(governed);
                if let Some(failing_since) = self.failing_since.take() {
                    tracing::info!(
                        event = "field_native.admission.available",
                        component = "terminal",
                        ledger = %ledger.path().display(),
                        unanswered_ms = ms(started.saturating_duration_since(failing_since)),
                        "The machine-wide admission ledger answered again"
                    );
                }
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
                if self.failing_since.is_none() {
                    self.failing_since = Some(started);
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
        self.note_pace(started.elapsed());
    }

    /// The ledger's own slow line, one per slow episode (IL-D3 (a)): it left
    /// the reconcile under IL-D6 (a), so a slow flock is said here and never in
    /// a reconcile's parts. An attempt that never returns says nothing here;
    /// the sampler's late line is that case.
    fn note_pace(&mut self, took: Duration) {
        match self.slow.observe(took, LEDGER_SLOW) {
            SlowStep::Fast => {}
            SlowStep::Opened => tracing::warn!(
                event = "field_native.admission.slow",
                component = "terminal",
                episode = "opened",
                ledger = %self.ledger.path().display(),
                ms = ms(took),
                bound_ms = ms(LEDGER_SLOW),
                "The machine-wide admission ledger was slow to answer"
            ),
            SlowStep::Continued { count } => tracing::debug!(
                event = "field_native.admission.slow",
                component = "terminal",
                episode = "continues",
                ledger = %self.ledger.path().display(),
                count,
                ms = ms(took),
                "The machine-wide admission ledger is still slow to answer"
            ),
            SlowStep::Closed { count, max, total } => tracing::info!(
                event = "field_native.admission.slow",
                component = "terminal",
                episode = "closed",
                ledger = %self.ledger.path().display(),
                count,
                max_ms = ms(max),
                total_ms = ms(total),
                "The machine-wide admission ledger answers promptly again"
            ),
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
    /// TC-S3 — where this pump's fault verdict lands: the per-cell composition
    /// behind the unit's single fault cell. There used to be a second sink (the
    /// unit's cell, written directly by the in-process serve's one pump); TM-1
    /// retired that serve, so a pump is always a cell's pump and the enum that
    /// chose between them collapsed into these two fields.
    instance: u32,
    shared: Arc<Shared>,
    failures: u32,
    recovery_owed: bool,
}

impl InventoryWatch {
    fn for_cell(instance: u32, shared: Arc<Shared>) -> Self {
        Self {
            instance,
            shared,
            failures: 0,
            recovery_owed: false,
        }
    }

    fn set_fault(&self, fault: Option<String>) {
        self.shared.set_cell_inventory_fault(self.instance, fault);
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
            self.set_fault(Some(format!("{error:#}")));
        }
    }

    /// A `list-sessions` answered and its snapshot was applied: the observed
    /// rows are current again. Recovery is dated from HERE and not from the
    /// dial, because a socket that opened and then said nothing useful has
    /// recovered nothing — and the streak restarts, so a plane that reconciles
    /// once between failures has to earn its degraded state again.
    fn reconciled(&mut self) {
        self.set_fault(None);
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

/// Item 52 (b) — the events a cell's pump owes a reconcile: exactly what a 1.9
/// connection hears today, plus `session-metadata-changed`. Zero change to
/// today's triggers, one added.
///
/// The floor announces 1.17 for that one event (`terminal_client.rs`'s
/// `PROTOCOL_MINOR`), and a minor is all or nothing, so the connection also
/// hears 1.10-1.16's: `config-changed`, `remote-session-state-changed`,
/// `view-state-changed` and `control-state`. They change nothing the published
/// row carries, so they are counted (`IgnoredEvents`), never reconciled. An
/// allow-list rather than "any event" is what keeps the next minor's events off
/// the reconcile path until something here reads them.
///
/// Two facts of ghosttea 0.13.4 shape the list:
/// - **No control event says a session was removed.** `Removed` lives on the
///   in-process lifecycle channel alone, and a terminated session leaves the
///   registry with no control event at all. The removal is seen at the next
///   reconcile, whichever event or backstop causes it.
/// - **`control-changed` is a live trigger.** A local session's controller
///   change reaches every minor, and the reconcile it causes can be the one
///   that publishes a removal. fieldd's item 59 grace is measured from that
///   moment, so the trigger stays.
///
/// Every event still reaches `birth_to_govern` first; this decides only the
/// reconcile.
const INVENTORY_EVENTS: [&str; 6] = [
    "session-created",
    "session-exited",
    "session-activity-changed",
    "control-changed",
    EVENTS_LOST,
    "session-metadata-changed",
];

/// Does this pushed event owe the cell a reconcile (`INVENTORY_EVENTS`)?
fn owes_reconcile(event: &Value) -> bool {
    event
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| INVENTORY_EVENTS.contains(&kind))
}

/// Item 52 (b) — the events a cell's pump heard and owed no reconcile, counted
/// rather than dropped. The count outlives a reconnect, like the rest of the
/// pump's state; the kinds it has said are bounded, since they come off the
/// wire.
#[derive(Debug, Default)]
struct IgnoredEvents {
    total: u64,
    kinds: Vec<String>,
}

impl IgnoredEvents {
    /// Past this many kinds, a new one is counted without being named again.
    const MAX_KINDS: usize = 16;

    /// Count one, and say whether it is the first of its kind this pump heard.
    fn note(&mut self, kind: &str) -> bool {
        self.total += 1;
        if self.kinds.len() >= Self::MAX_KINDS || self.kinds.iter().any(|seen| seen == kind) {
            return false;
        }
        self.kinds.push(kind.to_owned());
        true
    }
}

/// TC-S3 — one cell's connection worth of inventory maintenance: the same
/// loop as `pump_inventory` (reconcile on connect, then on events and the
/// backstop; births re-governed per GT-D11), publishing through the merged
/// registry under this cell's tag instead of straight onto the channel.
async fn pump_inventory_cell(
    client: Arc<ControlClient>,
    mut events: tokio::sync::mpsc::UnboundedReceiver<Value>,
    pump: &mut CellPump,
) -> anyhow::Result<()> {
    let instance = pump.instance;
    let mut published = pump.merged.rows_value(instance);

    let (births_tx, births_rx) = tokio::sync::mpsc::unbounded_channel();
    let (governed_tx, mut governed_rx) = tokio::sync::mpsc::unbounded_channel();
    let _governor = TaskGuard(tokio::spawn(govern_births(
        Arc::clone(&client),
        births_rx,
        governed_tx,
    )));

    // AL-8a — subscribed before the first reconcile, which begins after any
    // ask this misses: a census asking from now on is heard.
    let mut asked = pump.stamp.stamps.asked();
    // A connection that has only just opened was not watching a moment ago, so
    // its first reconcile closes an observation gap by definition.
    let known = pump.merged.session_ids(instance);
    let reconciled = reconcile_cell(&client, pump, published).await?;
    pump.reconciled(&reconciled);
    // The backstop runs from when the last reconcile BEGAN, on tokio's clock
    // like the stamps and the sampler (IL-D1).
    let mut last_reconcile = reconciled.timing.began;
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
                    if owes_reconcile(&event) {
                        if event.get("type").and_then(Value::as_str) == Some(EVENTS_LOST) {
                            gap = true;
                        }
                        dirty = true;
                    } else {
                        pump.ignored(&event);
                    }
                }
                None => return Ok(()),
            },
            Some(()) = governed_rx.recv() => dirty = true,
            Ok(()) = asked.changed() => dirty = true,
            _ = ticker.tick() => {
                if dirty || last_reconcile.elapsed() >= pump.bounds.backstop {
                    dirty = false;
                    let known =
                        std::mem::take(&mut gap).then(|| pump.merged.session_ids(instance));
                    let reconciled = reconcile_cell(&client, pump, published).await?;
                    pump.reconciled(&reconciled);
                    last_reconcile = reconciled.timing.began;
                    published = reconciled.published;
                    if let Some(known) = known {
                        regovern_unseen(&births_tx, &known, &reconciled.sessions);
                    }
                }
            },
        }
    }
}

/// `list-sessions` is truth (spec §10.5), scoped to one cell: rows are
/// stamped with its tag, the per-cell governed count feeds the ledger total
/// on EVERY reconcile (the LEDGER_INTERVAL refresh law), and rows publish
/// only on a real change. *Corrected 2026-10-19 (IL-D6):* the count is handed
/// to the ledger's thread on every reconcile, and that thread keeps the
/// LEDGER_INTERVAL refresh on its own clock; no reconcile waits on the ledger.
///
/// IL-D1, IL-D3: the moment it began, before the writer lock, becomes the
/// cell's `as_of` once the answer is applied, never before; a reconcile that
/// fails moves nothing. On the way it marks which part it is in, which the
/// stale line reports, and it answers with where its time went.
async fn reconcile_cell(
    client: &ControlClient,
    pump: &CellPump,
    published: Value,
) -> anyhow::Result<Reconciled> {
    let stamp = &pump.stamp;
    let began = tokio::time::Instant::now();
    let since = unix_ms_now();
    stamp.doing(PumpActivity::Reconciling {
        part: ReconcilePart::WriterWait,
        began,
    });
    let (mut sessions, writer_held) = client
        .list_sessions_timed(|| stamp.in_part(ReconcilePart::RoundTrip))
        .await?;
    let answered = tokio::time::Instant::now();
    stamp.in_part(ReconcilePart::MergedLock);
    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    let terminals: Vec<ObservedTerminal> = sessions
        .iter()
        .filter(|session| is_governed_here(session))
        .map(|session| observed_row_for_cell(session, &pump.cell))
        .collect();
    let snapshot = inventory_value(&terminals);
    let mut merged_lock_wait = pump
        .merged
        .observe_governed(pump.instance, terminals.len() as u32);
    if snapshot != published {
        merged_lock_wait += pump.merged.set_rows(pump.instance, terminals, || {
            stamp.in_part(ReconcilePart::Publish)
        });
    }
    stamp.applied(began, since);
    let applied = tokio::time::Instant::now();
    Ok(Reconciled {
        published: snapshot,
        sessions,
        timing: ReconcileTiming {
            began,
            took: applied.saturating_duration_since(began),
            writer_wait: writer_held.saturating_duration_since(began),
            round_trip: answered.saturating_duration_since(writer_held),
            merged_lock_wait,
            publish: applied
                .saturating_duration_since(answered)
                .saturating_sub(merged_lock_wait),
        },
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
///
/// It used to carry the GOVERNED count too, for a caller that fed the admission
/// ledger from the return value; the per-cell reconcile publishes that straight
/// into the merged inventory instead (`observe_governed`), and TM-1 deleted the
/// caller that read it from here.
///
/// And where the reconcile's time went (IL-D3), which the slow line reads.
struct Reconciled {
    published: Value,
    sessions: Vec<SessionSummary>,
    timing: ReconcileTiming,
}

/// Is this row a session THIS device runs, or a replica of another device's?
///
/// `list-sessions` answers both (the module note has the mechanism and the
/// hazard). Upstream's own marker decides it: a replica reports no persistence
/// class because claiming one would assert a governance this host does not hold,
/// and every locally created session carries one. Reading the marker rather than
/// inventing a second one is what keeps this honest when there are no replicas
/// to exclude: the predicate is then true for every row. Since TM-1 that is
/// ALWAYS the case on this floor (the module note says why), so this is a
/// standing guard rather than a live filter.
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
        // CORRECTED 2026-09-14 (N-L7). This used to read "the legacy in-process
        // serve has no cell", which named a caller TM-1 deleted — there is no
        // cell-less shape on this floor any more. What is true is narrower and
        // local: this helper's ONLY caller is `observed_row_for_cell`, which
        // stamps the tag on the very next line. `None` is the field's default
        // in a two-step construction, not a statement about a serve.
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

/// TP-S1 — a per-cell-boot grant key: 32 random bytes, hex, distinct from the
/// cell token it travels beside (same custody, different purpose: the token
/// authenticates the legacy doors; the key signs TPv3 grants).
fn mint_grant_key() -> String {
    hex::encode(rand::random::<[u8; 32]>())
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

    /// Item 52 (b): the pump reconciles on exactly what a 1.9 connection heard,
    /// plus the metadata event 1.17 added, and on nothing else that 1.17 opted
    /// this connection in to. The shapes are ghosttea 0.13.4's (service.rs).
    #[test]
    fn the_pump_reconciles_on_the_events_it_reads_and_counts_the_rest() {
        let pushed = |kind: &str, extra: Value| {
            let mut event = json!({"requestId": 0, "type": kind});
            event
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            event
        };
        for owed in [
            pushed("session-created", json!({"session": {"id": "s1"}})),
            pushed("session-exited", json!({"sessionId": "s1", "exitCode": 0})),
            pushed(
                "session-activity-changed",
                json!({"sessionId": "s1", "active": true}),
            ),
            pushed(
                "control-changed",
                json!({"sessionId": "s1", "controllerViewId": "v1", "controlEpoch": 2}),
            ),
            pushed(EVENTS_LOST, json!({"lost": 3})),
            pushed(
                "session-metadata-changed",
                json!({"sessionId": "s1", "cwd": "file://localhost/tmp", "title": null}),
            ),
        ] {
            assert!(
                owes_reconcile(&owed),
                "a 1.9 trigger, or the cwd hint: {owed}"
            );
        }

        for ignored in [
            pushed("config-changed", json!({"config": {}})),
            pushed(
                "remote-session-state-changed",
                json!({"sessionId": "r1", "state": "live"}),
            ),
            pushed(
                "view-state-changed",
                json!({"sessionId": "r1", "viewId": "v1"}),
            ),
            pushed(
                "control-state",
                json!({"sessionId": "r1", "controller": null}),
            ),
            pushed("a-minor-nobody-has-shipped", json!({})),
            json!({"requestId": 0}),
        ] {
            assert!(
                !owes_reconcile(&ignored),
                "1.10-1.16's events, the next minor's and an untyped one owe no reconcile: \
                 {ignored}"
            );
        }
    }

    /// Item 52 (b): an ignored event is counted, never dropped silently; each
    /// kind is said once, and the kinds a pump will name are bounded because
    /// they come off the wire.
    #[test]
    fn ignored_events_are_counted_and_each_kind_is_said_once() {
        let mut ignored = IgnoredEvents::default();
        assert!(
            ignored.note("view-state-changed"),
            "the first of a kind is said"
        );
        assert!(
            !ignored.note("view-state-changed"),
            "the second is only counted"
        );
        assert!(ignored.note("control-state"), "a new kind is said too");
        assert_eq!(ignored.total, 3, "every one is counted");

        for n in 0..IgnoredEvents::MAX_KINDS {
            ignored.note(&format!("kind-{n}"));
        }
        assert_eq!(ignored.kinds.len(), IgnoredEvents::MAX_KINDS);
        assert!(
            !ignored.note("one-kind-too-many"),
            "past the bound a new kind is counted without being named"
        );
        assert_eq!(ignored.total, 3 + IgnoredEvents::MAX_KINDS as u64 + 1);
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
            stopping: watch::channel(false).0,
            routes: watch::channel(TerminalRouteSnapshot {
                revision: 0,
                cells: Vec::new(),
            })
            .0,
            route_rows: Mutex::new(BTreeMap::new()),
            cell_updates: Mutex::new(BTreeMap::new()),
            class_states: Mutex::new(BTreeMap::new()),
            occupancy: watch::channel(BTreeMap::new()).0,
            strikes: Mutex::new(std::collections::HashMap::new()),
            next_instance: std::sync::atomic::AtomicU32::new(0),
            inventory_faults: Mutex::new(BTreeMap::new()),
            inventory_fault: Mutex::new(None),
            inventory_stale: Mutex::new(BTreeMap::new()),
            inventory_stamps: std::sync::OnceLock::new(),
            ledger_late: Mutex::new(None),
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
        // TM-1: a pump is always a CELL's pump now, so the streak runs through
        // the per-cell composition — which lands on the same single fault cell
        // the unit's health reads, tagged with the instance.
        let mut watch = InventoryWatch::for_cell(1, shared.clone());

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
            shared.set_inventory_stale(BTreeMap::from([(
                1,
                "no reconcile applied since 18:04:31Z (bound 10 s)".to_string(),
            )]));
            shared.set_ledger_late(Some(
                "the machine-wide ledger has not answered since 18:04:31Z (bound 10 s)".into(),
            ));
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
    /// absence is asserted in `admission::tests`). Driven synchronously: each
    /// `observe` is the step the ledger's thread takes per wake.
    #[cfg(unix)]
    #[test]
    fn the_ledger_pump_puts_the_spent_budget_on_the_unit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let mut pump = LedgerPump::new(
            ledger_under_test(dir.path(), 2),
            shared.clone(),
            Arc::new(LedgerSlot::default()),
            LEDGER_INTERVAL,
        );

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
        let thread = LedgerThread::spawn(None, shared.clone());
        assert!(thread.slot.is_none(), "no ledger, no thread to keep one");
        thread.hand_off(4_000);
        assert_eq!(shared.health().state, UnitState::Up);
        assert_eq!(
            shared.health().detail.as_deref(),
            Some("serving; text engine Menlo"),
            "no ledger means no claim about a budget — never a made-up one"
        );
    }

    // ---- IL-D6: the ledger on a thread of its own ----

    /// How long these rows wait on real time. Generous for a loaded host: a
    /// call that blocks on a held flock never returns at all, so the bound only
    /// sets how long a red takes to say so.
    #[cfg(unix)]
    const LEDGER_TEST_BOUND: Duration = Duration::from_secs(5);

    #[cfg(unix)]
    fn ledger_under_test(dir: &std::path::Path, budget: u32) -> AdmissionLedger {
        AdmissionLedger::at(
            dir.join(registries::files::CUSTODY_ADMISSION_LEDGER),
            budget,
            "boot-under-test",
        )
    }

    /// What the file says the machine holds, read the way any pair reads it.
    #[cfg(unix)]
    fn machine_total_at(path: &std::path::Path) -> u32 {
        AdmissionLedger::at(path.to_path_buf(), u32::MAX, "an-observer")
            .machine_total()
            .expect("read the ledger")
    }

    /// Poll `done` on real time until it holds or `bound` passes.
    #[cfg(unix)]
    fn eventually(bound: Duration, mut done: impl FnMut() -> bool) -> bool {
        let deadline = std::time::Instant::now() + bound;
        loop {
            if done() {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// The ledger's flock, held from a descriptor of the test's own: the shape
    /// of another pair stalled mid-publish. A `flock` belongs to the open file,
    /// so the ledger's own `open` in this same process still has to wait.
    /// Dropping the guard closes the descriptor, which releases the lock.
    #[cfg(unix)]
    struct HeldFlock {
        _file: std::fs::File,
    }

    #[cfg(unix)]
    impl HeldFlock {
        fn take(path: &std::path::Path) -> Self {
            use std::os::unix::io::AsRawFd;
            let file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)
                .expect("open the ledger");
            // SAFETY: the fd is owned by `file`, which this guard keeps open.
            let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
            assert_eq!(
                result,
                0,
                "take the ledger's flock: {}",
                std::io::Error::last_os_error()
            );
            Self { _file: file }
        }
    }

    /// The `DaemonState` the inventory publishes through, with no unit
    /// running behind it. Its health and observed state are built from wire
    /// JSON, so an optional field the contract grows does not touch this row.
    fn test_state(dir: &std::path::Path) -> Arc<DaemonState> {
        let config = NativeConfig::for_data_dir(dir.to_path_buf());
        let (ping, _) = tokio::sync::mpsc::unbounded_channel();
        let mesh = crate::services::mesh::MeshUnit::new(&config, ping.clone()).handle();
        let bridge =
            crate::services::mesh_bridge::MeshBridge::new(&config, [0; 32], ping.clone()).handle();
        // F1's freeway seam, `DaemonState::new`'s ninth argument, built as freeway.rs's own
        // tests build it: the unit binds a loopback listener on port 0 and never declares, so
        // no host starts.
        let terminal = TerminalUnit::new(&config, ping.clone());
        // CP-1a's door seam, built the way bootstrap builds it; never started here.
        let door =
            crate::services::door::DoorUnit::new(&config, ping.clone(), bridge.clone()).handle();
        let freeway = crate::services::freeway::FreewayUnit::new(
            &config,
            "boot-under-test",
            ping,
            terminal.handle(),
        )
        .handle();
        DaemonState::new(
            "boot-under-test".into(),
            [0; 32],
            serde_json::from_value(json!({
                "bootId": "boot-under-test",
                "state": "up",
                "units": [],
            }))
            .expect("a health snapshot"),
            serde_json::from_value(json!({
                "bootId": "boot-under-test",
                "generation": 0,
                "terminals": [],
                "workers": [],
            }))
            .expect("an observed state"),
            mesh,
            bridge,
            watch::channel(TerminalRouteSnapshot {
                revision: 0,
                cells: Vec::new(),
            })
            .1,
            crate::config::MeshPlan::resolve(&config),
            freeway,
            door,
            None,
        )
    }

    #[cfg(unix)]
    fn observed(session_id: &str) -> ObservedTerminal {
        serde_json::from_value(json!({ "sessionId": session_id })).expect("an observed row")
    }

    /// Run one inventory call on a runtime worker: true when it returned
    /// inside `bound`.
    #[cfg(unix)]
    async fn returns_within(
        bound: Duration,
        merged: &Arc<MergedInventory>,
        call: fn(&MergedInventory),
    ) -> bool {
        let merged = merged.clone();
        let task = tokio::spawn(async move { call(&merged) });
        matches!(tokio::time::timeout(bound, task).await, Ok(Ok(())))
    }

    /// IL-D6 — a burst handed off while the ledger is held coalesces to its
    /// newest. The thread finishes the publish it was in, then publishes the
    /// last total it was handed: none of the totals between reach the file,
    /// and no refresh after it ever writes an older one.
    #[cfg(unix)]
    #[test]
    fn a_burst_of_totals_publishes_the_newest_and_never_an_older_one_after_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_under_test(dir.path(), 1_000);
        let path = ledger.path().to_path_buf();
        let thread = LedgerThread::spawn_with_interval(
            Some(ledger),
            test_shared(),
            Duration::from_millis(20),
        );
        let slot = thread.slot.clone().expect("a ledger has a thread");

        let held = HeldFlock::take(&path);
        thread.hand_off(1);
        assert!(
            eventually(LEDGER_TEST_BOUND, || slot.as_of().is_some()),
            "the thread took the first total, seeded its as_of and waits on the flock"
        );
        for total in 2..=50 {
            thread.hand_off(total);
        }
        drop(held);

        let mut seen = std::collections::BTreeSet::new();
        let reached = eventually(LEDGER_TEST_BOUND, || {
            let total = machine_total_at(&path);
            seen.insert(total);
            total == 50
        });
        assert!(reached, "the newest total reaches the file: saw {seen:?}");

        // Several refreshes on the short interval, each read back.
        let settle = std::time::Instant::now() + Duration::from_millis(200);
        while std::time::Instant::now() < settle {
            let total = machine_total_at(&path);
            seen.insert(total);
            assert_eq!(
                total, 50,
                "a refresh republishes the newest total, never an older one"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            seen.iter().all(|total| [0, 1, 50].contains(total)),
            "only the empty file, the publish in flight and the newest total were ever on \
             disk; the 48 between were coalesced: {seen:?}"
        );
    }

    /// The LEDGER_INTERVAL refresh law, on the thread's own clock: another
    /// pair spends the machine's budget while this floor's total stands still,
    /// and the unit says so with no hand-off at all — then says the budget is
    /// back once that pair lets go. Each refresh that lands moves `as_of`.
    #[cfg(unix)]
    #[test]
    fn the_ledger_refreshes_the_machine_total_while_this_floors_total_stands_still() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_under_test(dir.path(), 2);
        let path = ledger.path().to_path_buf();
        // Another pair: a second boot id in this same live process, so the
        // reaper keeps its entry.
        let other = AdmissionLedger::at(path.clone(), 2, "another-pair");
        let shared = test_shared();
        let thread = LedgerThread::spawn_with_interval(
            Some(ledger),
            shared.clone(),
            Duration::from_millis(20),
        );
        let slot = thread.slot.clone().expect("a ledger has a thread");

        thread.hand_off(1);
        assert!(
            eventually(LEDGER_TEST_BOUND, || machine_total_at(&path) == 1),
            "this floor's one session is published"
        );
        // The file shows the publish before its attempt returns: the read-back
        // is a second flock, and until it returns `as_of` is still the seed. A
        // reservation made in that window is answered by the publish's own
        // read-back, with no refresh at all (item 83). So `first` is an attempt
        // that returned: once `as_of` has moved past the seed, the attempt it
        // names read the machine total back before this row reserves.
        let seed = slot.as_of().expect("the first total seeded as_of");
        assert!(
            eventually(LEDGER_TEST_BOUND, || slot.as_of() > Some(seed)),
            "an attempt after the first returned"
        );
        let first = slot.as_of().expect("an attempt returned");
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "one session against a budget of two is a machine with room"
        );

        assert!(other
            .try_reserve(1)
            .expect("the other pair reserves")
            .is_admitted());
        let spent = eventually(LEDGER_TEST_BOUND, || {
            shared
                .health()
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains(PressureClass::PtyExhausted.as_str()))
        });
        assert!(
            spent,
            "a refresh read the other pair's session, with no new total from this floor"
        );
        assert!(
            slot.as_of().expect("refreshes landed") > first,
            "and every refresh that lands is an answer: as_of moved"
        );

        other.release(1).expect("the other pair lets go");
        assert!(
            eventually(LEDGER_TEST_BOUND, || shared.health().state == UnitState::Up),
            "the budget came back, and the next refresh says so"
        );
    }

    /// IL-D6 — the inventory's lock never waits on the ledger. With the
    /// ledger's flock held from another descriptor, every call a pump or the
    /// manager makes under that lock returns, on a runtime worker, while the
    /// flock is still held; the held flock stalls the ledger's thread and
    /// nothing else.
    /// Real time on a multi-thread runtime, because what is ruled out is a
    /// worker parked in a syscall.
    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_held_ledger_flock_never_blocks_the_inventory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_under_test(dir.path(), 1_000);
        let path = ledger.path().to_path_buf();
        let shared = test_shared();
        let state = test_state(dir.path());
        let merged = Arc::new(MergedInventory::new(
            state.clone(),
            shared.clone(),
            LedgerThread::spawn(Some(ledger), shared.clone()),
        ));
        let slot = merged
            .inner
            .lock()
            .unwrap()
            .ledger
            .slot
            .clone()
            .expect("a ledger has a thread");

        let held = HeldFlock::take(&path);
        assert!(
            returns_within(LEDGER_TEST_BOUND, &merged, |merged| {
                merged.observe_governed(1, 3);
            })
            .await,
            "a reconcile's count is handed off, never written under the lock"
        );
        assert!(
            eventually(LEDGER_TEST_BOUND, || slot.as_of().is_some()),
            "the ledger's thread took the total and is now waiting on the flock"
        );

        assert!(
            returns_within(LEDGER_TEST_BOUND, &merged, |merged| {
                merged.set_rows(
                    1,
                    vec![observed("s1"), observed("s2"), observed("s3")],
                    || {},
                );
            })
            .await,
            "rows publish while the ledger is held"
        );
        assert_eq!(state.observed_tx.borrow().terminals.len(), 3);
        assert_eq!(shared.occupancy.borrow().get(&1), Some(&3));
        assert!(
            returns_within(LEDGER_TEST_BOUND, &merged, |merged| {
                merged.observe_governed(2, 1);
            })
            .await,
            "a second cell's reconcile does not queue behind the first's ledger write"
        );
        assert!(
            returns_within(LEDGER_TEST_BOUND, &merged, |merged| merged.remove(1)).await,
            "and the manager's remove does not either"
        );
        assert!(state.observed_tx.borrow().terminals.is_empty());
        assert_eq!(shared.occupancy.borrow().get(&1), None);

        drop(held);
        assert!(
            eventually(LEDGER_TEST_BOUND, || machine_total_at(&path) == 1),
            "released, the ledger catches up to the newest total: cell 2's one session"
        );
    }

    /// IL-D6 — the floor's exit never waits on the ledger. Dropping the
    /// inventory while its thread is stuck in the flock returns at once, since
    /// nothing joins the thread; once the flock is released the thread finishes
    /// the publish it was in, writes nothing newer, and ends.
    #[cfg(unix)]
    #[test]
    fn dropping_the_inventory_stops_the_ledger_thread_without_joining_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_under_test(dir.path(), 1_000);
        let path = ledger.path().to_path_buf();
        let shared = test_shared();
        let merged = MergedInventory::new(
            test_state(dir.path()),
            shared.clone(),
            LedgerThread::spawn(Some(ledger), shared),
        );
        let slot = Arc::downgrade(
            merged
                .inner
                .lock()
                .unwrap()
                .ledger
                .slot
                .as_ref()
                .expect("a ledger has a thread"),
        );

        let held = HeldFlock::take(&path);
        merged.observe_governed(1, 5);
        assert!(
            eventually(LEDGER_TEST_BOUND, || slot
                .upgrade()
                .is_some_and(|slot| slot.as_of().is_some())),
            "the thread took 5 and waits on the flock"
        );
        merged.observe_governed(1, 9);

        let dropping = std::time::Instant::now();
        drop(merged);
        assert!(
            dropping.elapsed() < LEDGER_TEST_BOUND,
            "the drop asked the thread to stop and did not wait for it"
        );
        assert!(
            slot.upgrade().is_some(),
            "the thread is still inside the flock, and still alive"
        );

        drop(held);
        assert!(
            eventually(LEDGER_TEST_BOUND, || slot.upgrade().is_none()),
            "released, it finished its publish and ended"
        );
        assert_eq!(
            machine_total_at(&path),
            5,
            "it finished the publish it was in and published nothing it was handed after: \
             a floor that is going writes no newer total"
        );
    }

    // ---- IL-D1, IL-D3, IL-D4: how old the inventory is ----

    /// How long the real-time rows below wait for what they expect. Generous
    /// for a loaded host: it only sets how long a red takes to say so.
    #[cfg(unix)]
    const REAL_TIME_BOUND: Duration = Duration::from_secs(5);

    fn key(instance: u32) -> CellKey {
        (instance, format!("boot-{instance}"))
    }

    #[cfg(unix)]
    fn observed_cell(instance: u32) -> ObservedTerminalCell {
        ObservedTerminalCell {
            cell_instance_id: i64::from(instance),
            cell_boot_id: format!("boot-{instance}"),
            workload_class: Some(TerminalWorkloadClass::Interactive),
            role: Some(TerminalCellRole::Class),
        }
    }

    /// A route row for cell `instance` whose control socket is `control_socket`.
    #[cfg(unix)]
    fn fake_route(instance: u32, control_socket: &str) -> TerminalRouteCell {
        TerminalRouteCell {
            cell_boot_id: format!("boot-{instance}"),
            cell_instance_id: i64::from(instance),
            pid: 1,
            endpoints: TerminalEndpoints {
                control_socket: control_socket.to_string(),
                frame_socket: format!("{control_socket}.frames"),
                auth_token: "a-token".into(),
            },
            token_generation: i64::from(instance),
            grant_key: None,
            grant_key_generation: None,
            doors: None,
            workload_class: Some(TerminalWorkloadClass::Interactive),
            role: Some(TerminalCellRole::Class),
        }
    }

    /// Poll `done` on the runtime's clock until it holds or `bound` passes,
    /// yielding between polls: the async twin of `eventually`, for a row whose
    /// runtime must go on running the pumps it watches.
    #[cfg(unix)]
    async fn settles(bound: Duration, mut done: impl FnMut() -> bool) -> bool {
        let deadline = tokio::time::Instant::now() + bound;
        loop {
            if done() {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    /// One event as `Heard` keeps it: its level, and each field's value as its
    /// `Debug` spelling (a `&str` field's without quotes).
    #[cfg(unix)]
    type HeardEvent = (tracing::Level, BTreeMap<String, String>);

    /// A subscriber layer that keeps every event it hears, for a row that
    /// asserts on the floor's own lines.
    #[cfg(unix)]
    #[derive(Clone, Default)]
    struct Heard(Arc<Mutex<Vec<HeardEvent>>>);

    #[cfg(unix)]
    impl Heard {
        /// Run `act` on this thread with a `Heard` as its subscriber, and
        /// answer the events named `event` it heard. `act` must not leave the
        /// thread. tracing caches each callsite's interest process-wide, and
        /// another row's thread can register a callsite while this scoped
        /// subscriber is the only one alive, caching it as unwanted; so the
        /// cache is rebuilt here, on this thread under this subscriber, right
        /// before `act` runs.
        fn during(event: &str, act: impl FnOnce()) -> Vec<HeardEvent> {
            use tracing_subscriber::layer::SubscriberExt;
            let heard = Self::default();
            tracing::subscriber::with_default(
                tracing_subscriber::registry().with(heard.clone()),
                || {
                    tracing::callsite::rebuild_interest_cache();
                    act();
                },
            );
            let all = heard.0.lock().unwrap().clone();
            all.into_iter()
                .filter(|(_, fields)| fields.get("event").map(String::as_str) == Some(event))
                .collect()
        }
    }

    #[cfg(unix)]
    impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Heard {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _context: tracing_subscriber::layer::Context<'_, S>,
        ) {
            struct Fields<'a>(&'a mut BTreeMap<String, String>);
            impl tracing::field::Visit for Fields<'_> {
                fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
                    self.0.insert(field.name().to_owned(), value.to_owned());
                }
                fn record_debug(
                    &mut self,
                    field: &tracing::field::Field,
                    value: &dyn std::fmt::Debug,
                ) {
                    self.0.insert(field.name().to_owned(), format!("{value:?}"));
                }
            }
            let mut fields = BTreeMap::new();
            event.record(&mut Fields(&mut fields));
            self.0
                .lock()
                .unwrap()
                .push((*event.metadata().level(), fields));
        }
    }

    /// A cell's control service, as much of it as a pump reads: the bare token
    /// and `ok`, `hello` at the floor's protocol, and `list-sessions` answered
    /// with one governed session after a delay the test moves while the pump
    /// runs. Every connection is served, since a pump redials. A SERVICE the
    /// real client dials, over a real socket, as `terminal_client`'s own fake is.
    #[cfg(unix)]
    struct FakeCell {
        endpoint: String,
        delay_ms: Arc<std::sync::atomic::AtomicU64>,
        _accepting: TaskGuard,
        _dir: tempfile::TempDir,
    }

    #[cfg(unix)]
    impl FakeCell {
        /// Bound under /tmp: macOS caps a socket path at ~104 bytes.
        fn serve() -> Self {
            let dir = tempfile::Builder::new()
                .prefix("vfinv")
                .tempdir_in("/tmp")
                .expect("tempdir under /tmp");
            let endpoint = dir
                .path()
                .join("termctl.sock")
                .to_string_lossy()
                .into_owned();
            let mut listener = crate::local_ipc::bind(&endpoint).expect("bind the fake cell");
            let delay_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let delay = delay_ms.clone();
            let accepting = TaskGuard(tokio::spawn(async move {
                while let Ok(stream) = listener.accept().await {
                    tokio::spawn(serve_fake_cell(stream, delay.clone()));
                }
            }));
            Self {
                endpoint,
                delay_ms,
                _accepting: accepting,
                _dir: dir,
            }
        }

        /// Every `list-sessions` from now on is answered after `delay`.
        fn answer_after(&self, delay: Duration) {
            self.delay_ms
                .store(ms(delay), std::sync::atomic::Ordering::SeqCst);
        }
    }

    #[cfg(unix)]
    async fn serve_fake_cell(
        mut stream: crate::local_ipc::Stream,
        delay_ms: Arc<std::sync::atomic::AtomicU64>,
    ) {
        // The bare token, then `ok`: never inspected, this is not the
        // authentication under test.
        if fake_read(&mut stream).await.is_none() || !fake_write(&mut stream, b"ok").await {
            return;
        }
        while let Some(packet) = fake_read(&mut stream).await {
            let Ok(request) = serde_json::from_slice::<Value>(&packet) else {
                return;
            };
            let id = request["requestId"].clone();
            let response = match request["type"].as_str() {
                Some("hello") => json!({
                    "requestId": id,
                    "type": "hello",
                    "protocolMajor": crate::services::terminal_client::PROTOCOL_MAJOR,
                    "protocolMinor": crate::services::terminal_client::PROTOCOL_MINOR,
                    "serverBuild": "fake-cell",
                }),
                Some("list-sessions") => {
                    let delay = delay_ms.load(std::sync::atomic::Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    json!({
                        "requestId": id,
                        "type": "session-list",
                        "sessions": [{
                            "id": "s1",
                            "persistence": FLOOR_LIFETIME,
                            "ownerId": "vibefield.fieldd",
                        }],
                    })
                }
                _ => json!({"requestId": id, "type": "ok"}),
            };
            let bytes = serde_json::to_vec(&response).expect("a response serializes");
            if !fake_write(&mut stream, &bytes).await {
                return;
            }
        }
    }

    /// One frame of the control protocol: a little-endian u32 length, then the
    /// payload.
    #[cfg(unix)]
    async fn fake_read(stream: &mut crate::local_ipc::Stream) -> Option<Vec<u8>> {
        use tokio::io::AsyncReadExt;
        let length = stream.read_u32_le().await.ok()? as usize;
        let mut bytes = vec![0; length];
        stream.read_exact(&mut bytes).await.ok()?;
        Some(bytes)
    }

    #[cfg(unix)]
    async fn fake_write(stream: &mut crate::local_ipc::Stream, bytes: &[u8]) -> bool {
        use tokio::io::AsyncWriteExt;
        stream.write_u32_le(bytes.len() as u32).await.is_ok()
            && stream.write_all(bytes).await.is_ok()
            && stream.flush().await.is_ok()
    }

    /// IL-D3 (a) — one line per slow episode: the first slow reconcile opens
    /// it, later ones only count, and the first prompt one closes it with its
    /// count, its slowest and its total. One exactly at the bound is not slower
    /// than it.
    #[test]
    fn a_slow_episode_opens_once_counts_its_reconciles_and_closes_with_its_numbers() {
        let bound = InventoryBounds::REGISTRY.slow;
        let prompt = Duration::from_millis(5);
        let mut episode = SlowEpisode::default();

        assert_eq!(episode.observe(prompt, bound), SlowStep::Fast);
        assert_eq!(
            episode.observe(bound, bound),
            SlowStep::Fast,
            "at the bound is not slower than it"
        );
        assert_eq!(episode.observe(bound * 2, bound), SlowStep::Opened);
        assert_eq!(
            episode.observe(bound * 4, bound),
            SlowStep::Continued { count: 2 }
        );
        assert_eq!(
            episode.observe(bound * 3, bound),
            SlowStep::Continued { count: 3 }
        );
        assert_eq!(
            episode.observe(prompt, bound),
            SlowStep::Closed {
                count: 3,
                max: bound * 4,
                total: bound * 9,
            },
            "one line closes the episode, with its numbers"
        );
        assert_eq!(
            episode.observe(prompt, bound),
            SlowStep::Fast,
            "and nothing is owed after it"
        );
        assert_eq!(
            episode.observe(bound * 2, bound),
            SlowStep::Opened,
            "the next slow one opens an episode of its own"
        );
    }

    /// IL-D1 — a stamp's lifecycle. Only an existing stamp moves: the write
    /// of a pump the manager has just aborted, finishing its poll, brings no
    /// gone cell back, and never touches the new cell on a re-used ordinal. A
    /// reconcile in flight moves nothing; an applied one moves the age to the
    /// moment it began.
    #[tokio::test(start_paused = true)]
    async fn a_stamp_moves_only_while_its_cell_is_listed() {
        let stamps = Arc::new(InventoryStamps::default());
        let gone = CellStamp {
            stamps: stamps.clone(),
            key: (1, "boot-a".to_string()),
        };
        stamps.seed(&gone.key);
        stamps.remove(&gone.key);
        gone.doing(PumpActivity::Idle);
        gone.applied(tokio::time::Instant::now(), unix_ms_now());
        assert!(
            stamps.snapshot().is_empty(),
            "a removed cell leaves no stamp, and an aborted pump's late write brings none back"
        );

        let reborn: CellKey = (1, "boot-b".to_string());
        stamps.seed(&reborn);
        let seeded = stamps.snapshot()[&reborn];
        assert_eq!(
            seeded.activity,
            PumpActivity::Dialing,
            "a seeded cell's pump has yet to dial"
        );
        tokio::time::advance(Duration::from_secs(1)).await;
        gone.applied(tokio::time::Instant::now(), unix_ms_now());
        assert_eq!(
            stamps.snapshot()[&reborn].as_of,
            seeded.as_of,
            "a re-used ordinal with a new boot id is another cell, with an age of its own"
        );

        let pump = CellStamp {
            stamps: stamps.clone(),
            key: reborn.clone(),
        };
        let began = tokio::time::Instant::now();
        pump.doing(PumpActivity::Reconciling {
            part: ReconcilePart::WriterWait,
            began,
        });
        pump.in_part(ReconcilePart::RoundTrip);
        let in_flight = stamps.snapshot()[&reborn];
        assert_eq!(
            in_flight.activity,
            PumpActivity::Reconciling {
                part: ReconcilePart::RoundTrip,
                began,
            }
        );
        assert_eq!(
            in_flight.as_of, seeded.as_of,
            "a reconcile in flight moves nothing: only an applied one does"
        );

        tokio::time::advance(Duration::from_secs(1)).await;
        pump.applied(began, 1_792_433_071_000);
        let applied = stamps.snapshot()[&reborn];
        assert_eq!(
            applied.as_of, began,
            "the age counts from when the applied reconcile began, not from its answer"
        );
        assert_eq!(applied.since, 1_792_433_071_000);
        assert_eq!(applied.activity, PumpActivity::Idle);
    }

    /// IL-D1, IL-D4 — the sampler's transitions, on paused time. A cell that
    /// never answers is stale a bound after its seed; one that answered half
    /// way is stale a bound after that answer. Between transitions nothing is
    /// published, and the unit's detail names a fixed instant, so health does
    /// not move each second. A reconcile that lands still past the bound moves
    /// nothing; one that began inside it clears the cell at the next sample,
    /// and a removal wakes the sampler at once.
    #[tokio::test(start_paused = true)]
    async fn the_sampler_speaks_only_on_a_transition_and_names_a_fixed_instant() {
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let state = test_state(dir.path());
        let stamps = Arc::new(InventoryStamps::default());
        let bound = InventoryBounds::REGISTRY.stale;
        let stale_ids = |observed: &crate::contracts::ObservedState| -> Vec<i64> {
            observed
                .stale_cells
                .iter()
                .map(|cell| cell.cell_instance_id)
                .collect()
        };

        stamps.seed(&key(1));
        stamps.seed(&key(2));
        let sampler = InventorySampler::new(
            stamps.clone(),
            state.clone(),
            shared.clone(),
            None,
            InventoryBounds::REGISTRY,
        );
        sampler.state_the_bound();
        assert_eq!(
            state.observed_tx.borrow().inventory_bound_ms,
            Some(terminal_inventory::STALE_MS),
            "the bound is stated before anything is judged"
        );
        // A new receiver has seen the value it was made at: only the
        // sampler's publishes count as changes from here.
        let mut observed = state.observed_tx.subscribe();
        let _sampler = TaskGuard(tokio::spawn(sampler.run()));

        // Cell 2 answers half way through the bound; cell 1 never does.
        tokio::time::sleep(bound / 2).await;
        CellStamp {
            stamps: stamps.clone(),
            key: key(2),
        }
        .applied(tokio::time::Instant::now(), unix_ms_now());

        tokio::time::sleep(bound / 2 - Duration::from_millis(500)).await;
        assert!(
            !observed.has_changed().expect("the state lives"),
            "inside the bound, nothing is said"
        );
        assert_eq!(shared.health().state, UnitState::Up);

        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(
            observed.has_changed().expect("the state lives"),
            "past the bound, the cell that never answered is stale"
        );
        let stale = observed.borrow_and_update().stale_cells.clone();
        assert_eq!(stale.len(), 1, "{stale:?}");
        assert_eq!(stale[0].cell_instance_id, 1);
        assert_eq!(stale[0].cell_boot_id.as_str(), "boot-1");
        assert_eq!(
            stale[0].since,
            stamps.snapshot()[&key(1)].since,
            "since is the stamp's own wall-clock twin"
        );
        let first = shared.health().detail.expect("a degraded unit states why");
        assert!(
            first.contains(&format!(
                "the observed inventory is older than its bound: cell 1: no reconcile applied \
                 since {} (bound 10 s)",
                utc_clock(stale[0].since)
            )),
            "{first}"
        );
        assert!(
            !first.contains("cell 2"),
            "cell 2 answered half way through: {first}"
        );

        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(
            !observed.has_changed().expect("the state lives"),
            "a cell that stays stale publishes nothing more"
        );
        assert_eq!(
            shared.health().detail.as_deref(),
            Some(first.as_str()),
            "the detail names a fixed instant, never a running age"
        );

        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(
            stale_ids(&observed.borrow_and_update()),
            vec![1, 2],
            "cell 2 is stale a bound after its last answer"
        );

        // A reconcile that lands while cell 1 is still past the bound, one
        // that itself began long ago, is no transition: the episode, its
        // `since` and the unit's instant stay as they were.
        let both = shared.health().detail;
        let long_ago = stamps.snapshot()[&key(1)].as_of + Duration::from_secs(1);
        CellStamp {
            stamps: stamps.clone(),
            key: key(1),
        }
        .applied(long_ago, unix_ms_now());
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(
            !observed.has_changed().expect("the state lives"),
            "a reconcile that began more than the bound ago leaves the cell stale and says nothing"
        );
        assert_eq!(
            shared.health().detail,
            both,
            "the unit still names the instant the cell went stale at"
        );

        CellStamp {
            stamps: stamps.clone(),
            key: key(1),
        }
        .applied(tokio::time::Instant::now(), unix_ms_now());
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert_eq!(
            stale_ids(&observed.borrow_and_update()),
            vec![2],
            "an applied reconcile makes cell 1 fresh at the next sample"
        );

        stamps.remove(&key(2));
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(
            observed.borrow_and_update().stale_cells.is_empty(),
            "a removal wakes the sampler: the cell leaves at once, not at the next sample"
        );
        assert_eq!(shared.health().state, UnitState::Up);
        assert_eq!(
            state.observed_tx.borrow().inventory_bound_ms,
            Some(terminal_inventory::STALE_MS),
            "every write kept the bound"
        );
    }

    /// IL-D1, IL-D4 — through the real manager, on paused time: a cell whose
    /// socket is not there never lands a reconcile. Three refused dials degrade
    /// the unit with the pump's fault long before the bound; at the bound,
    /// counted from the pump's spawn, the cell is stale too, and both are
    /// reported. Its row leaving the snapshot takes its stamp, its age and its
    /// fault with it, at once.
    #[cfg(unix)]
    #[tokio::test(start_paused = true)]
    async fn a_cell_whose_first_reconcile_never_lands_is_stale_from_its_spawn_beside_its_fault() {
        let dir = tempfile::Builder::new()
            .prefix("vfinv")
            .tempdir_in("/tmp")
            .expect("tempdir under /tmp");
        let nowhere = dir
            .path()
            .join("nobody.sock")
            .to_string_lossy()
            .into_owned();
        let shared = test_shared();
        let state = test_state(dir.path());
        shared.route_upsert(1, fake_route(1, &nowhere));
        let _inventory = TaskGuard(install_inventory(
            TerminalHandle {
                shared: shared.clone(),
            },
            state.clone(),
            None,
        ));
        assert_eq!(
            state.observed_tx.borrow().inventory_bound_ms,
            Some(terminal_inventory::STALE_MS),
            "the bound is on the state before install returns"
        );

        let bound = InventoryBounds::REGISTRY.stale;
        tokio::time::sleep(bound - Duration::from_millis(500)).await;
        assert!(
            state.observed_tx.borrow().stale_cells.is_empty(),
            "inside the bound, a cell that has never answered is not yet stale"
        );
        let detail = shared.health().detail.unwrap_or_default();
        assert!(
            detail.contains("the observed inventory is no longer current: cell 1:"),
            "three refused dials degrade the unit long before the bound: {detail}"
        );

        tokio::time::sleep(Duration::from_secs(1)).await;
        let stale = state.observed_tx.borrow().stale_cells.clone();
        assert_eq!(stale.len(), 1, "stale a bound after its spawn: {stale:?}");
        assert_eq!(stale[0].cell_instance_id, 1);
        let detail = shared.health().detail.expect("a degraded unit states why");
        assert!(
            detail.contains("the observed inventory is no longer current: cell 1:")
                && detail.contains(
                    "the observed inventory is older than its bound: cell 1: no reconcile \
                     applied since"
                ),
            "the fault and the age are both reported: {detail}"
        );

        shared.route_remove(1);
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(
            state.observed_tx.borrow().stale_cells.is_empty(),
            "a removed cell leaves no stamp, so nothing is stale"
        );
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "and neither its age nor its fault stays on the unit"
        );
    }

    /// IL-D3 — a reconcile against a cell that answers slowly: half way through
    /// the answer it is in its round trip; when it lands, the time is the round
    /// trip's and no other part's; the cell's age counts from when the
    /// reconcile began, before the writer lock, not from the answer; and the
    /// pump says so once, a warn with its parts that opens the slow episode,
    /// which the next prompt reconcile closes with one info line.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_slow_answer_is_the_round_trip_and_the_age_counts_from_when_the_reconcile_began() {
        let cell = FakeCell::serve();
        let answer = Duration::from_millis(400);
        cell.answer_after(answer);
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let state = test_state(dir.path());
        let stamps = Arc::new(InventoryStamps::default());
        stamps.seed(&key(1));
        let mut pump = CellPump::new(
            observed_cell(1),
            Arc::new(MergedInventory::new(
                state.clone(),
                shared.clone(),
                LedgerThread::spawn(None, shared.clone()),
            )),
            CellStamp {
                stamps: stamps.clone(),
                key: key(1),
            },
            // Slow under the answer, with room above a prompt local hop.
            InventoryBounds {
                slow: answer * 3 / 4,
                ..InventoryBounds::REGISTRY
            },
        );
        let (client, _events) = ControlClient::connect(&cell.endpoint, "a-token")
            .await
            .expect("dial the fake cell");

        let before = tokio::time::Instant::now();
        let (reconciled, mid_flight) =
            tokio::join!(reconcile_cell(&client, &pump, Value::Null), async {
                tokio::time::sleep(answer / 2).await;
                stamps.snapshot().get(&key(1)).map(|stamp| stamp.activity)
            });
        let reconciled = reconciled.expect("the fake cell answers");
        let timing = reconciled.timing;
        assert!(
            matches!(
                mid_flight,
                Some(PumpActivity::Reconciling {
                    part: ReconcilePart::RoundTrip,
                    ..
                })
            ),
            "half way through the answer, the reconcile is in its round trip: {mid_flight:?}"
        );
        assert!(
            timing.round_trip >= answer,
            "the cell's slow answer is the round trip: {timing:?}"
        );
        for (part, took) in [
            ("writer_wait", timing.writer_wait),
            ("merged_lock_wait", timing.merged_lock_wait),
            ("publish", timing.publish),
        ] {
            assert!(
                took < answer / 2,
                "{part} took none of the cell's time: {timing:?}"
            );
        }
        assert!(timing.took >= timing.round_trip, "{timing:?}");
        assert!(timing.began >= before, "{timing:?}");

        let stamp = stamps.snapshot()[&key(1)];
        assert_eq!(
            stamp.as_of, timing.began,
            "the age counts from when the reconcile began, not from its answer"
        );
        assert_eq!(
            stamp.activity,
            PumpActivity::Idle,
            "nothing is in flight once it is applied"
        );
        assert_eq!(
            state.observed_tx.borrow().terminals.len(),
            1,
            "the answer was applied: the cell's session is published"
        );

        let opened = Heard::during("field_native.terminal.inventory_slow", || {
            pump.reconciled(&reconciled)
        });
        assert_eq!(opened.len(), 1, "one line opens the episode: {opened:#?}");
        let (level, line) = &opened[0];
        assert_eq!(*level, tracing::Level::WARN, "{opened:#?}");
        assert_eq!(line.get("episode").map(String::as_str), Some("opened"));
        let round_trip_ms: u64 = line
            .get("round_trip_ms")
            .and_then(|value| value.parse().ok())
            .expect("the round trip is one of the parts");
        assert!(round_trip_ms >= ms(answer), "{opened:#?}");
        for part in ["writer_wait_ms", "merged_lock_wait_ms", "publish_ms"] {
            assert!(line.contains_key(part), "{part} is missing: {opened:#?}");
        }

        cell.answer_after(Duration::ZERO);
        let prompt = reconcile_cell(&client, &pump, reconciled.published)
            .await
            .expect("the fake cell answers at once");
        let closed = Heard::during("field_native.terminal.inventory_slow", || {
            pump.reconciled(&prompt)
        });
        assert_eq!(closed.len(), 1, "one line closes the episode: {closed:#?}");
        let (level, line) = &closed[0];
        assert_eq!(*level, tracing::Level::INFO, "{closed:#?}");
        assert_eq!(line.get("episode").map(String::as_str), Some("closed"));
        assert_eq!(line.get("count").map(String::as_str), Some("1"));
    }

    /// IL-D1, IL-D4 — a pump and the sampler against a cell that starts to
    /// answer late, on real time with short bounds. The cell goes stale at the
    /// bound while the answer is still on its way, with its rows still listed
    /// and no fault; once answers are prompt again, the late one lands, the
    /// next reconcile applies, and the cell is fresh.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_cell_that_answers_late_goes_stale_at_the_bound_and_fresh_once_it_answers() {
        let cell = FakeCell::serve();
        let bounds = InventoryBounds {
            backstop: Duration::from_millis(100),
            stale: Duration::from_millis(800),
            slow: Duration::from_millis(200),
            sample: Duration::from_millis(20),
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let state = test_state(dir.path());
        shared.route_upsert(1, fake_route(1, &cell.endpoint));
        let _inventory = TaskGuard(install_inventory_with(
            TerminalHandle {
                shared: shared.clone(),
            },
            state.clone(),
            LedgerThread::spawn(None, shared.clone()),
            bounds,
        ));
        assert!(
            settles(REAL_TIME_BOUND, || state
                .observed_tx
                .borrow()
                .terminals
                .len()
                == 1)
            .await,
            "the pump dialed the cell and applied its answer"
        );
        assert_eq!(
            state.observed_tx.borrow().inventory_bound_ms,
            Some(800),
            "a judging floor states its bound"
        );
        assert!(state.observed_tx.borrow().stale_cells.is_empty());

        let late = Duration::from_millis(2_500);
        cell.answer_after(late);
        let slowed = tokio::time::Instant::now();
        assert!(
            settles(REAL_TIME_BOUND, || !state
                .observed_tx
                .borrow()
                .stale_cells
                .is_empty())
            .await,
            "an answer that does not come leaves the cell stale"
        );
        assert!(
            slowed.elapsed() < late,
            "stale at the bound, while the answer is on its way, not once it lands"
        );
        let stale = state.observed_tx.borrow().stale_cells.clone();
        assert_eq!(stale.len(), 1, "{stale:?}");
        assert_eq!(stale[0].cell_instance_id, 1);
        assert_eq!(stale[0].cell_boot_id.as_str(), "boot-1");
        assert!(stale[0].since <= unix_ms_now(), "{stale:?}");
        let health = shared.health();
        assert_eq!(health.state, UnitState::Degraded);
        let detail = health.detail.expect("a degraded unit states why");
        assert!(
            detail.contains(
                "the observed inventory is older than its bound: cell 1: no reconcile applied \
                 since"
            ) && detail.contains("(bound 800 ms)"),
            "{detail}"
        );
        assert!(
            !detail.contains("no longer current"),
            "a slow answer is no failure: the fault streak never ran: {detail}"
        );
        assert_eq!(
            state.observed_tx.borrow().terminals.len(),
            1,
            "a stale cell's rows stay listed: they are old, not gone"
        );

        cell.answer_after(Duration::ZERO);
        assert!(
            settles(REAL_TIME_BOUND, || state
                .observed_tx
                .borrow()
                .stale_cells
                .is_empty())
            .await,
            "the late answer lands, the next reconcile applies, and the cell is fresh"
        );
        assert_eq!(shared.health().state, UnitState::Up);
    }

    /// AL-8a — a census that must be fresh asks for it. A quiet cell, whose
    /// next reconcile is a whole backstop away, reconciles at its next tick
    /// once asked, so the count from after the ask comes at once.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_census_ask_reconciles_a_quiet_cell_at_its_next_tick() {
        let cell = FakeCell::serve();
        // a minute's backstop, and a stale bound past it, so only the ask can bring a reconcile in time
        let bounds = InventoryBounds {
            backstop: Duration::from_secs(60),
            stale: Duration::from_secs(120),
            ..InventoryBounds::REGISTRY
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let state = test_state(dir.path());
        shared.route_upsert(1, fake_route(1, &cell.endpoint));
        let handle = TerminalHandle {
            shared: shared.clone(),
        };
        let _inventory = TaskGuard(install_inventory_with(
            handle.clone(),
            state.clone(),
            LedgerThread::spawn(None, shared.clone()),
            bounds,
        ));
        assert!(
            settles(REAL_TIME_BOUND, || handle.count(None) == Census::Counted(1)).await,
            "the pump's first reconcile counts the cell's session"
        );
        let asked = Instant::now();
        assert_eq!(
            handle.count(Some(asked)),
            Census::NotYet,
            "no reconcile has begun since: a quiet cell's next is its backstop"
        );
        handle.ask();
        assert!(
            settles(REAL_TIME_BOUND, || handle.count(Some(asked))
                == Census::Counted(1))
            .await,
            "the ask is heard as an event owed a reconcile"
        );
    }

    /// IL-D6 (a), the bound's precondition, end to end: with the ledger's
    /// flock held from another descriptor, the cell's pump goes on reconciling
    /// and no cell is ever stale, while the unit says the ledger is late. Once
    /// the flock is released the ledger answers and the unit is up again. Real
    /// time on a multi-thread runtime, because what is ruled out is a worker
    /// parked in a syscall.
    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_held_ledger_leaves_every_cell_fresh_and_says_the_ledger_is_late() {
        let cell = FakeCell::serve();
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_under_test(dir.path(), 1_000);
        let path = ledger.path().to_path_buf();
        let shared = test_shared();
        let state = test_state(dir.path());
        let bounds = InventoryBounds {
            backstop: Duration::from_millis(100),
            stale: Duration::from_millis(600),
            slow: Duration::from_millis(200),
            sample: Duration::from_millis(20),
        };
        shared.route_upsert(1, fake_route(1, &cell.endpoint));
        let held = HeldFlock::take(&path);
        let _inventory = TaskGuard(install_inventory_with(
            TerminalHandle {
                shared: shared.clone(),
            },
            state.clone(),
            LedgerThread::spawn_with_interval(
                Some(ledger),
                shared.clone(),
                Duration::from_millis(50),
            ),
            bounds,
        ));

        assert!(
            settles(REAL_TIME_BOUND, || shared
                .health()
                .detail
                .as_deref()
                .is_some_and(
                    |detail| detail.contains("the machine-wide ledger has not answered since")
                ))
            .await,
            "the ledger's thread took a total and sits in the flock past the bound"
        );
        let watched = tokio::time::Instant::now();
        while watched.elapsed() < bounds.stale * 2 {
            assert!(
                state.observed_tx.borrow().stale_cells.is_empty(),
                "the held flock stalls the ledger's thread and no cell's pump"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(state.observed_tx.borrow().terminals.len(), 1);
        let detail = shared.health().detail.unwrap_or_default();
        assert!(
            !detail.contains("older than its bound"),
            "the ledger is late; the inventory is not: {detail}"
        );

        drop(held);
        assert!(
            settles(REAL_TIME_BOUND, || shared.health().state == UnitState::Up).await,
            "released, the ledger answers and the unit is up again"
        );
    }

    /// IL-D6 — the ledger's lateness, judged at chosen instants: never while
    /// nothing has been asked of it, not inside the bound, late at it with the
    /// instant it was asked, unchanged while it stays late, and on time again
    /// once an attempt returns.
    #[test]
    fn the_ledger_is_late_past_the_bound_and_on_time_once_an_attempt_lands() {
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let slot = Arc::new(LedgerSlot::default());
        let bound = InventoryBounds::REGISTRY.stale;
        let mut sampler = InventorySampler::new(
            Arc::new(InventoryStamps::default()),
            test_state(dir.path()),
            shared.clone(),
            Some(slot.clone()),
            InventoryBounds::REGISTRY,
        );
        let asked = LedgerAsOf {
            at: std::time::Instant::now(),
            since: 1_792_433_071_000,
        };

        sampler.judge_ledger(asked.at + bound * 2);
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "a ledger nothing has been asked of is never late"
        );

        slot.seed(asked);
        sampler.judge_ledger(asked.at + bound - Duration::from_millis(1));
        assert_eq!(shared.health().state, UnitState::Up, "inside the bound");

        sampler.judge_ledger(asked.at + bound);
        let detail = shared.health().detail.expect("a late ledger is stated");
        assert!(
            detail
                .contains("the machine-wide ledger has not answered since 18:04:31Z (bound 10 s)"),
            "{detail}"
        );
        sampler.judge_ledger(asked.at + bound * 3);
        assert_eq!(
            shared.health().detail.as_deref(),
            Some(detail.as_str()),
            "a ledger that stays late moves nothing: the instant is fixed"
        );

        let landed = LedgerAsOf {
            at: asked.at + bound * 3,
            since: 1_792_433_101_000,
        };
        slot.stamp(landed);
        sampler.judge_ledger(landed.at + Duration::from_millis(1));
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "an attempt that returned is an answer"
        );
    }

    /// IL-D6 — a ledger that answers every attempt with an error is failing,
    /// not late: each attempt that returns moves its `as_of`, so the sampler
    /// never says it has not answered, and the unit stays up (the failure has
    /// its own once-per-streak warn). Real attempts against a ledger whose
    /// directory does not exist; the judge at an instant a bound past the
    /// first attempt and inside the bound of the second.
    #[cfg(unix)]
    #[test]
    fn a_ledger_that_fails_at_once_is_never_late() {
        let dir = tempfile::tempdir().expect("tempdir");
        let shared = test_shared();
        let slot = Arc::new(LedgerSlot::default());
        let bound = InventoryBounds::REGISTRY.stale;
        let mut pump = LedgerPump::new(
            ledger_under_test(&dir.path().join("no-such-dir"), 2),
            shared.clone(),
            slot.clone(),
            LEDGER_INTERVAL,
        );
        let mut sampler = InventorySampler::new(
            Arc::new(InventoryStamps::default()),
            test_state(dir.path()),
            shared.clone(),
            Some(slot.clone()),
            InventoryBounds::REGISTRY,
        );

        pump.observe(1);
        let first = slot.as_of().expect("an attempt that failed returned");
        std::thread::sleep(Duration::from_millis(20));
        pump.observe(1);
        let second = slot.as_of().expect("so did the next");
        assert!(
            second >= first + Duration::from_millis(20),
            "a failed attempt moves as_of, as a published one does"
        );

        sampler.judge_ledger(first + bound + Duration::from_millis(10));
        assert_eq!(
            shared.health().state,
            UnitState::Up,
            "a ledger that answers with an error has answered: {:?}",
            shared.health().detail
        );
    }

    /// IL-D4 — the inventory's age and the ledger's lateness are facts of
    /// their own, reported beside the pump's fault and the pressure gauges and
    /// cleared by nothing but their own writer.
    #[test]
    fn an_old_inventory_and_a_late_ledger_are_reported_beside_every_other_reason() {
        let shared = test_shared();
        shared.set_inventory_fault(Some("cell 2: connection refused".into()));
        shared.set_inventory_stale(BTreeMap::from([(
            2,
            "no reconcile applied since 18:04:31Z (bound 10 s)".to_string(),
        )]));
        shared.set_ledger_late(Some(
            "the machine-wide ledger has not answered since 18:04:30Z (bound 10 s)".into(),
        ));
        shared.observe_fd_pressure(900, 1000);

        let detail = shared
            .health()
            .detail
            .expect("a degraded unit states every reason it has");
        for expected in [
            "text engine Menlo",
            "the observed inventory is no longer current: cell 2: connection refused",
            "the observed inventory is older than its bound: cell 2: no reconcile applied since \
             18:04:31Z (bound 10 s)",
            "the machine-wide ledger has not answered since 18:04:30Z (bound 10 s)",
            PressureClass::FdPressure.as_str(),
        ] {
            assert!(
                detail.contains(expected),
                "{expected} is missing from: {detail}"
            );
        }

        shared.set_inventory_fault(None);
        let detail = shared.health().detail.expect("still degraded");
        assert!(
            detail.contains("older than its bound"),
            "the age is its own fact: the fault clearing does not clear it: {detail}"
        );

        shared.set_inventory_stale(BTreeMap::new());
        shared.set_ledger_late(None);
        shared.observe_fd_pressure(10, 1000);
        assert_eq!(shared.health().state, UnitState::Up);
    }

    /// The unit's words for the instant and the bound, and the registry's
    /// numbers in the order the bound depends on: a healthy cell's backstop
    /// plus a slow reconcile still lands inside the stale bound, and the sample
    /// is finer than it.
    #[test]
    fn the_unit_names_the_instant_and_the_bound_as_a_reader_reads_them() {
        assert_eq!(utc_clock(1_792_433_071_000), "18:04:31Z");
        assert_eq!(
            utc_clock(1_792_433_071_999),
            "18:04:31Z",
            "to the second, never rounded up"
        );
        assert_eq!(spell_bound(InventoryBounds::REGISTRY.stale), "10 s");
        assert_eq!(spell_bound(Duration::from_millis(800)), "800 ms");

        let bounds = InventoryBounds::REGISTRY;
        assert!(bounds.backstop + bounds.slow < bounds.stale, "{bounds:?}");
        assert!(bounds.sample < bounds.stale, "{bounds:?}");
    }

    // ---- TC-S3: the class-cell machinery's pure halves ----

    /// The snapshot's deterministic order IS the create-target discipline's
    /// substrate: interactive class first (the legacy mirror's cell), agent
    /// class second, solos last by instance.
    /// TP-S1 — the grant key is 32 bytes of hex and fresh per mint: two cell
    /// boots never share a key (the kid is `{cellBootId, 1}`).
    #[test]
    fn grant_key_is_32_hex_bytes_and_fresh_per_mint() {
        let a = mint_grant_key();
        let b = mint_grant_key();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
        assert_ne!(a, mint_token());
    }

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
                grant_key: None,
                grant_key_generation: None,
                doors: None,
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
