import { z } from "zod";
import { TerminalCellRole, TerminalRouteCell, TerminalWorkloadClass } from "./envelope";
import { UnavailableDetails } from "./errors";
import { CELL_SUPERVISION, NATIVE_FLOOR_TICK, PORTS } from "./registries";

// Management channel (design-01 §5.2, M2 subset): native.lifecycle.* + the mesh
// facade P0 subset (peers / store / serve). Laws honored here:
// - survivor set only: desired state carries adoption + persistence policy,
//   NEVER interactive ops (design-02 §2.7);
// - facade state is rebuilt-not-persisted — fieldd replays its declarative set
//   on reconnect/rebuild ("re-serving is re-creating");
// - every inbound mesh delivery carries WhoIs identity (v0.5 requirement).

// ---- lifecycle ----

export const UnitState = z.enum(["starting", "up", "degraded", "crashed", "disabled"]);
export type UnitState = z.infer<typeof UnitState>;

export const UnitHealth = z
  .object({
    /** "mgmt" | "mesh-gateway" | "terminal" | "mesh-bridge" | "freeway" | "process" */
    unit: z.string(),
    state: UnitState,
    detail: z.string().optional(),
    /** mesh-gateway during browser auth (design-02 §2.4) */
    authUrl: z.string().optional(),
  })
  .passthrough();
export type UnitHealth = z.infer<typeof UnitHealth>;

export const NativeHealth = z
  .object({
    state: z.enum(["starting", "up", "degraded"]),
    bootId: z.string(),
    units: z.array(UnitHealth),
  })
  .passthrough();
export type NativeHealth = z.infer<typeof NativeHealth>;

export const DesiredTerminal = z
  .object({
    sessionId: z.string(),
    /** ghosttea persistence-policy name — opaque passthrough (reference-don't-remodel) */
    persistence: z.string().optional(),
  })
  .passthrough();
export type DesiredTerminal = z.infer<typeof DesiredTerminal>;

export const DesiredWorker = z
  .object({
    id: z.string(),
    kind: z.string(),
    config: z.unknown().optional(),
  })
  .passthrough();
export type DesiredWorker = z.infer<typeof DesiredWorker>;

/** Gateway knobs fieldd may declare; deliberately empty at P0 (tolerant growth). */
export const MeshConfig = z.object({}).passthrough();
export type MeshConfig = z.infer<typeof MeshConfig>;

export const DesiredState = z
  .object({
    generation: z.number().int(),
    /** THE survivor set — sessions not listed run their terminate ladder */
    terminals: z.array(DesiredTerminal),
    workers: z.array(DesiredWorker),
    meshConfig: MeshConfig.optional(),
    /** NF-D2(b) — adopt-before-authority: a set that would TERMINATE ≥1
     * running session must prove it saw THIS boot's inventory by echoing the
     * current native bootId; mismatch or absence ⇒ PRECONDITION_FAILED and
     * zero terminations. Retain-only sets may omit it (silence kills nothing —
     * NF-D2(a)). */
    observedBootId: z.string().optional(),
  })
  .passthrough();
export type DesiredState = z.infer<typeof DesiredState>;

/** TC-S3 — which cell a session lives on: the inventory's `cell` tag (§5).
 * Identity mirrors the route row (`cellBootId` is THE identity; the ordinal is
 * the socket-name suffix), so a reader can join inventory rows onto routes —
 * ticket routing, per-cell loss receipts ("blast counted"), and the observed
 * side of spawn-isolation all key on this. Deliberately WITHOUT endpoints or
 * token: the tag names placement, the route snapshot owns coordinates. */
export const ObservedTerminalCell = z
  .object({
    cellInstanceId: z.number().int(),
    cellBootId: z.string(),
    workloadClass: TerminalWorkloadClass.optional(),
    role: TerminalCellRole.optional(),
  })
  .passthrough();
export type ObservedTerminalCell = z.infer<typeof ObservedTerminalCell>;

export const ObservedTerminal = z
  .object({
    sessionId: z.string(),
    pid: z.number().int().optional(),
    /** epoch millis. LAW: wire timestamps are ALWAYS integers — bare z.number()
     * becomes f64 in generated Rust and drifts on re-serialization (caught by parity). */
    createdAt: z.number().int().optional(),
    persistence: z.string().optional(),
    title: z.string().optional(),
    cwd: z.string().optional(),
    /** Item 97 (2026-10-29) — the row's process has ended and its cell still lists the pane: a
     * `keep-until-explicit-close` husk (MF-1g keeps an agent's), from which no exit event will
     * come again. `true` only, and only once exited: ABSENT on a live row and from a floor older
     * than item 97, so absence never says the process lives. fieldd's agent backstop reads a
     * husk's `true` as an exit, after the grace that lets the floor's own `session-exited`
     * carry the outcome first (AgentRuntime.handleInventory). */
    exited: z.boolean().optional(),
    /** TC-S3 — the hosting cell. ABSENT on a pre-TC-S3 floor and in the
     * mesh-flagged in-process serve (there is no cell; tolerant readers fall
     * back to the legacy single-cell reading). */
    cell: ObservedTerminalCell.optional(),
  })
  .passthrough();
export type ObservedTerminal = z.infer<typeof ObservedTerminal>;

export const ObservedWorker = z.object({ id: z.string(), state: UnitState }).passthrough();
export type ObservedWorker = z.infer<typeof ObservedWorker>;

/** IL-D4 (`draft/thinking-inventory-latency.md` §4.1) — one cell whose inventory is older than
 * the floor's bound (`TERMINAL_INVENTORY.STALE_MS`): no reconcile that began after `since` has
 * brought it back inside the bound. The cell is named as the inventory's own tag names it
 * (`ObservedTerminalCell`; `cellBootId` is THE identity), so a reader joins the entry onto rows
 * and routes. `since` is the wall-clock twin of the floor's monotonic stamp, read beside it when
 * the cell's last applied reconcile began (its pump's spawn, for a cell whose first reconcile
 * never landed), so a reader's age is `now − since`, which counts sleep. It is fixed when the
 * cell goes stale: a reconcile that lands while the cell stays stale (one that itself began more
 * than the bound ago) leaves the entry as it was, so a reader's age may run long by that
 * reconcile, never short, and `staleCells` changes only on a transition. */
export const ObservedStaleCell = z
  .object({
    cellInstanceId: z.number().int(),
    cellBootId: z.string().min(1),
    /** unix ms */
    since: z.number().int().nonnegative(),
  })
  .passthrough();
export type ObservedStaleCell = z.infer<typeof ObservedStaleCell>;

export const ObservedState = z
  .object({
    /** last applied desired generation (0 = none since boot) */
    generation: z.number().int(),
    bootId: z.string(),
    terminals: z.array(ObservedTerminal),
    workers: z.array(ObservedWorker),
    /** IL-D4 — the floor's inventory bound in ms (`TERMINAL_INVENTORY.STALE_MS`). Its PRESENCE
     * says this floor judges its inventory's age: a floor that runs the sampler always sets it.
     * ABSENT: an older floor that cannot say. A reader then reports the age as unknown, and its
     * acting doors behave as they did before the bound. */
    inventoryBoundMs: z.number().int().nonnegative().optional(),
    /** IL-D4 — the cells whose inventory is older than `inventoryBoundMs`, present only while one
     * is. Never an always-present `[]`: the generated Rust skips an empty list, so an empty one
     * would serialize as an older floor's does. With `inventoryBoundMs` set, absence here means
     * every cell is fresh. Neither field stamps a row or a reconcile, so the stream still
     * publishes on a change (a row, or a cell going stale or fresh), never on every reconcile. */
    staleCells: z.array(ObservedStaleCell).optional(),
  })
  .passthrough();
export type ObservedState = z.infer<typeof ObservedState>;

/** E-F1 — the payload of `native.lifecycle.terminal.routes` (the subscribe
 * result's `snapshot` and every `.delta`): the route snapshot, plus the floor's
 * LIVE answer to "are these doors published on the tailnet".
 *
 * WHY THE BOOLEAN RIDES HERE AT ALL. `HelloAck.terminalMesh` is read exactly
 * once, at a moment it is predictably FALSE: the floor's mesh node is installed
 * by a spawned bring-up task that returns long before the node exists
 * (`field-native/src/services/mesh.rs`), while the mgmt listener binds
 * immediately after `start_all` and fieldd hellos as soon as the socket
 * answers. tsnet bring-up takes seconds. So a cold boot with the flag set reads
 * `terminalMesh: false` and — the ack being the only writer — keeps reading
 * false until fieldd re-pairs for some unrelated reason: no routes declared,
 * the field's `terminal` joins withheld, `terminal.openTicket` refusing
 * `doors_not_published` on a floor whose doors came up seconds after the hello.
 * This field is the floor PUSHING the correction on the stream it already owns.
 *
 * TOLERANT BY CONSTRUCTION, and the tolerance is the whole contract: ABSENT
 * means "this payload says nothing about the mesh" and a reader KEEPS the value
 * the hello gave it. That is what a floor predating E-F1 sends on every delta,
 * so absence must never be read as `false` — it is not a reading at all. A
 * present boolean is authoritative and supersedes the hello's.
 *
 * Secret-free like the hello's (EL7): a boolean, never the node's name, the
 * capability, or a port. The snapshot half is unchanged — `revision` still
 * orders, `cells` is still the full state-transfer payload (TC-D15) — so a
 * reader that knows only `TerminalRouteSnapshot` parses this shape correctly
 * and ignores the extra key. */
export const TerminalRoutesStreamPayload = z
  .object({
    revision: z.number().int(),
    /** SPELLED OUT rather than `TerminalRouteSnapshot.extend(...)`, and that is
     * a codegen constraint, not a style choice: `.extend()` hands
     * zod-to-json-schema the SAME `z.array(TerminalRouteCell)` instance the
     * snapshot already emitted, which it dedupes into
     * `#/definitions/TerminalRouteSnapshot/properties/cells` — a nested path
     * `cargo typify` cannot resolve (it panics outright). A fresh array
     * instance renders as `items: {$ref: "#/definitions/TerminalRouteCell"}`
     * in both places, which is the shape the Rust side needs. */
    cells: z.array(TerminalRouteCell),
    terminalMesh: z.boolean().optional(),
  })
  .passthrough();
export type TerminalRoutesStreamPayload = z.infer<typeof TerminalRoutesStreamPayload>;

// ---- TC-S1 supervision (specs/terminal-custody.md TC-D1/TC-D2) and the wedge ladder ----
// (WG-D0…WG-D6, `draft/thinking-floor-wedge.md` §5.3 and §11, ruled 2026-10-19)

/** fieldd's EXTERNAL judgment of the floor + its link, surfaced in fieldd's
 * health (`NativeLinkHealth`) and, while it is `unresponsive`, as UNAVAILABLE
 * {service: "native", state: "unresponsive"} (`NativeUnavailableDetails`) on
 * the doors that ride the floor's mgmt path (WG-D4).
 * *Corrected 2026-10-19 (WG-D4):* this said the doors that need the floor
 * answered UNAVAILABLE {service: "native", state}, and nothing emitted it: a
 * call to a held floor waited out its own deadline (`thinking-floor-wedge.md`
 * §2.2). WG-D4's door gate is its emitter.
 * Deliberately NOT UnitState: a wedged floor cannot self-report — the whole
 * point (TC-D2) is distinguishing "crashed" (socket gone, kernel says so) from
 * "unresponsive" (alive, not answering the control path). */
export const NativeLinkState = z.enum(["connecting", "up", "unresponsive", "respawning", "gone"]);
export type NativeLinkState = z.infer<typeof NativeLinkState>;

/** native.lifecycle.ping — the TC-D2 heartbeat probe. Rides the SAME control
 * path as every real request end-to-end (socket → framing → dispatch → reply),
 * so a wedge anywhere on that path is exactly what it measures. The ack echoes
 * the boot id so a supervisor also notices a floor that restarted underneath a
 * surviving socket. `ts` is the floor's wall clock (unix ms) as it answered: a
 * pong that comes back past its deadline is kept with it, never dropped, and
 * proves the reader and dispatch move (WG-E2). Generated into Rust (WG-D6), so
 * the floor writes the shape `ping-ack.valid.json` pins on both sides. */
export const PingAck = z.object({ bootId: z.string(), ts: z.number().int() }).passthrough();
export type PingAck = z.infer<typeof PingAck>;

/** WG-D6 — `native.lifecycle.tick`'s params (`MGMT_NOTIFICATIONS.TICK`): a
 * notification the floor pushes to its paired client every
 * `NATIVE_FLOOR_TICK.INTERVAL_MS` from a task of its own — no `id` (it answers
 * no call) and no `subId` (it belongs to no subscription). A tick proves the
 * floor's runtime and its writer alive, and it NEVER restarts fieldd's kill
 * clock: only a reply proves the reader and dispatch move (WG-E2). `ts` is the
 * floor's wall clock (unix ms), the clock of `PingAck.ts`; `seq` counts up from
 * 0 within one floor boot, so a reader can see a gap. */
export const NativeTickParams = z
  .object({
    bootId: z.string(),
    ts: z.number().int(),
    seq: z.number().int().nonnegative(),
  })
  .passthrough();
export type NativeTickParams = z.infer<typeof NativeTickParams>;

/** WP12 L2b (`build-wp12-updater.md` §9 R2/R3) — why the floor is asked to stop: `update`, an app update that touches
 * field-native, after the person's consent or at census zero (EDP-33/35); since AL-2 (2026-10-27,
 * `thinking-app-lifecycle.md`; ESR §7.3 as amended) `quit`, a person's quit after the same census gate, and `logout`,
 * the OS ending the session (no box asks, AL-D6); since AL-5 `idle`, the orphan bound: no shell and no live session
 * for its whole span, so fieldd ends the pair on its own (AL-D4). Every one is a PLANNED stop: the next boot reads
 * `lastExit: planned`. The "restart" in the name is the next launch's. */
export const NativeRestartReason = z.enum(["update", "quit", "logout", "idle"]);
export type NativeRestartReason = z.infer<typeof NativeRestartReason>;

/** `native.lifecycle.prepareRestart` — record the restart intent BEFORE the floor is stopped, so the next boot can
 * tell a planned stop from a crash (`HelloAck.lastExit`). The floor writes `<data>/native/restart-intent.json`
 * atomically; its presence is the encoding. Authorization is the single-client rule: only the current paired
 * client is served, and a superseded connection's call refuses `UNAUTHORIZED` ("this connection was superseded by
 * a newer management client") before any effect. */
export const NativePrepareRestartParams = z
  .object({
    reason: NativeRestartReason,
    /** the app version the restart installs — provenance for the logs, never parsed for behavior */
    toVersion: z.string().min(1).max(128).optional(),
  })
  .passthrough();
export type NativePrepareRestartParams = z.infer<typeof NativePrepareRestartParams>;

export const NativePrepareRestartResult = z.object({ recorded: z.boolean() }).passthrough();
export type NativePrepareRestartResult = z.infer<typeof NativePrepareRestartResult>;

/** `native.lifecycle.shutdown` — the floor stops ITSELF: it replies, then runs the same graceful drain SIGTERM runs
 * (a third arm of field-native's `shutdown_signal()`; the terminal unit's G7 drain ends the cells and their PTYs, as
 * kill-matrix row S2-B and the Rust SIGTERM sweep pin), and exits. No signal and no pid: an ADOPTED floor — the
 * update path's case by construction — has no pid fieldd could aim at, and on Windows a signal is a hard kill.
 *
 * Authorization is the single-client rule and nothing else: field-native serves only the current paired client,
 * so a superseded connection's call refuses `UNAUTHORIZED` ("this connection was superseded by a newer management
 * client") before any effect, exactly as every other mutating verb does. fieldd calls it only inside its own
 * consented stop (`system.shutdown` with `native`: the live set equals the set the person consented to end). */
export const NativeShutdownParams = z.object({ reason: NativeRestartReason }).passthrough();
export type NativeShutdownParams = z.infer<typeof NativeShutdownParams>;

export const NativeShutdownResult = z.object({ stopping: z.boolean() }).passthrough();
export type NativeShutdownResult = z.infer<typeof NativeShutdownResult>;

/** AL-8a (`thinking-app-lifecycle.md` §8.3.1; AL-D10 "A", James 2026-10-27 15:31Z) — `native.lifecycle.detach`: the
 * management client is leaving ON PURPOSE (fieldd's planned stop: a quit, an update, a signal, AL-5's `idle`), said
 * before it closes. The floor records the departure planned; a client that is simply gone — EOF without it, a crash —
 * left unplanned, and the next client's hello says so (`HelloAck.lastManager`). Authorized by the single-client rule
 * alone, like the other lifecycle verbs. */
export const NativeDetachParams = z.object({}).passthrough();
export type NativeDetachParams = z.infer<typeof NativeDetachParams>;

export const NativeDetachResult = z.object({ noted: z.boolean() }).passthrough();
export type NativeDetachResult = z.infer<typeof NativeDetachResult>;

/** TC-D1/TC-D2 supervision timings (fieldd-side), and the wedge ladder WG-D1
 * ruled (`draft/thinking-floor-wedge.md` §5.3; the WEDGE_* numbers are WG-D2's
 * first values, re-ruled on the evidence of WG-D0's episode lines with a dated
 * note here).
 *
 * DETECTION is a state, reversible: a heartbeat every HEARTBEAT_INTERVAL_MS
 * with a HEARTBEAT_DEADLINE_MS deadline; a miss fires one stage-2 probe; two
 * misses make the link `unresponsive` (≤ 250 ms). A miss counts only when
 * fieldd's own deadline timer fired on time (WG-E1). Sized against loaded-host
 * scheduling stalls (vault-free round trips p99 24–37ms at load ~40, max 69ms —
 * spike LOCK-1), which must never cost a session. Returning to `up` takes two
 * clean pongs in a row.
 *
 * THE KILL CLOCK is silence of REPLIES: the time since the last response to
 * any request, a pong or any other, a late one included. Any reply restarts it;
 * notifications (the floor's tick, the health, observed and route deltas)
 * never do, because they come from the floor's forwarder tasks, not its reader
 * (WG-E2/E3). On that one clock:
 *  - WEDGE_REDIAL_MS — once per episode, fieldd drops the mgmt link and dials
 *    again (WG-E4). It costs no session (a dead mgmt connection kills no PTY),
 *    and a fresh hello gets a fresh reader, so a per-connection reader wedge
 *    recovers outright. The clock runs on across it: an unanswered hello is
 *    more silence, never a `connecting` that lasts forever.
 *  - WEDGE_CONFIRM_MS — the bound. With the redial failed, the census decides
 *    (WG-E6): the cells' own session lists read at decision time with births
 *    closed, plus every session born and not yet seen; a cell that does not
 *    answer counts as holding sessions. Empty ⇒ the automatic restart
 *    (unplanned, so never announced). Not empty ⇒ the link stays
 *    `unresponsive` with its numbers (`NativeLinkHealth`), the census is read
 *    again every WEDGE_RECOUNT_MS, and the person's consented restart is
 *    offered (`system.native.restart {sessions}`, WG-D5).
 *  - WEDGE_HEADLESS_MS — with live sessions and nobody to ask (no window, or
 *    the phone alone), fieldd waits while the floor's tick flows: that is a
 *    reader or dispatch wedge, and the cells run on. Once replies AND the tick
 *    have both been silent this long (a floor stalled whole, which stops
 *    draining its cells' stderr), it proceeds, with loss receipts.
 * fieldd takes an irreversible step only after one `setImmediate` yield finds
 * no reply pending (WG-E1). Wedge restarts have their own intensity bound,
 * WEDGE_RESTART_MAX per WEDGE_RESTART_WINDOW_MS, past which the link is `gone`;
 * the crash path keeps RESPAWN_MAX per RESPAWN_WINDOW_MS, which a restart at
 * most once per WEDGE_CONFIRM_MS could never trip. Every deliberate stop's
 * SIGKILL rung waits KILL_DRAIN_WAIT_MS after SIGTERM, never less. */
export const NATIVE_SUPERVISION = {
  /** default deadline for ordinary mgmt requests (pre-TC-S1, rawRequest waited
   * forever). WG-D6: it rides each request as `RpcRequest.deadlineAt`, so the
   * floor answers TIMEOUT rather than run a request fieldd has given up on */
  REQUEST_DEADLINE_MS: 10_000,
  HEARTBEAT_INTERVAL_MS: 100,
  HEARTBEAT_DEADLINE_MS: 100,
  /** stage 2 — fired immediately after a first miss */
  HEARTBEAT_PROBE_DEADLINE_MS: 50,
  HEARTBEAT_MISS_THRESHOLD: 2,
  /** WG-E4 — the reversible step, once per episode: drop the mgmt link and
   * dial again. Not below REQUEST_DEADLINE_MS: by then the oldest request in
   * flight has timed out anyway, so the redial fails nothing that was alive */
  WEDGE_REDIAL_MS: 10_000,
  /** WG-D1 — the bound: past this much reply silence, with the redial failed,
   * the census decides — empty ⇒ the automatic restart; not empty ⇒ the
   * person's consented restart is offered.
   * *Corrected 2026-10-19 (WG-D1):* this was `3_000`, "unresponsive →
   * kill+respawn only after this much CONTINUED silence", and the supervisor
   * did not measure continued silence: its clock started at the double miss and
   * cleared only on two clean pongs in a row, so a lone pong left it running, a
   * reply past its deadline was dropped unseen, and a floor this fieldd had
   * spawned was killed with every session in it on the first miss 3 s after its
   * first double miss (2026-10-19 02:24:56Z, `thinking-floor-wedge.md` §1,
   * §2.2). LOCK-1's sizing covered CPU-scheduling stalls, never disk I/O. */
  WEDGE_CONFIRM_MS: 60_000,
  /** WG-D1's headless clause: with live sessions and nobody to ask, proceed
   * after this much silence of replies and of the floor's tick together. A
   * tick that stopped a moment ago is no floor stalled whole, however long the
   * replies have been silent */
  WEDGE_HEADLESS_MS: 600_000,
  /** past the bound, while the floor is held, the census is read again this
   * often (a count: it closes no births). Sessions that end on a held floor let
   * the empty-floor restart run, and the health block's count stays current.
   * Not one of WG-D2's ruled numbers: fieldd's cadence for a reading */
  WEDGE_RECOUNT_MS: 10_000,
  /** WG-D1 — wedge restarts' own intensity bound: past WEDGE_RESTART_MAX in
   * WEDGE_RESTART_WINDOW_MS the link is `gone`, with the restart affordance,
   * so a floor that wedges on every boot is never killed once a minute forever */
  WEDGE_RESTART_MAX: 3,
  WEDGE_RESTART_WINDOW_MS: 600_000,
  /** every deliberate stop's SIGKILL rung, after SIGTERM: the floor collects
   * its cells' drain reports for CELL_SUPERVISION's DRAIN_BUDGET_MS +
   * EXIT_GRACE_MS + 1 s (field-native's terminal stop path) and then exits;
   * one second more for that exit. A rung inside the drain ends sessions that
   * were draining cleanly (`thinking-floor-wedge.md` §1: a 2 s rung) */
  KILL_DRAIN_WAIT_MS: CELL_SUPERVISION.DRAIN_BUDGET_MS + CELL_SUPERVISION.EXIT_GRACE_MS + 2_000,
  /** WG-D6 — a floor tick older than this is no tick: three intervals, so one
   * late or lost tick never reads as a floor stalled whole */
  TICK_STALE_MS: 3 * NATIVE_FLOOR_TICK.INTERVAL_MS,
  /** TC-D1 — respawn only after this many failed redials AND a fresh endpoint
   * probe confirming no listener (the double-spawn probe stays in force) */
  RESPAWN_AFTER_REDIALS: 3,
  /** bounded intensity; past it: permanent honest degraded state + the restart verb */
  RESPAWN_MAX: 3,
  RESPAWN_WINDOW_MS: 60_000,
} as const;

/** WG-D4/WG-D6 — the native plane's refusal vocabulary. Generated into Rust
 * (`registries::native_refusals`), so the floor's TIMEOUT and fieldd's readers
 * spell one word. */
export const NATIVE_REFUSALS = {
  /** `details.service` on both refusals below */
  SERVICE: "native",
  /** fieldd's word for a floor it holds `unresponsive` (`NativeLinkState`) */
  STATE_UNRESPONSIVE: "unresponsive",
  /** the floor's word for a request that reached dispatch past its `deadlineAt` */
  REASON_DEADLINE_PASSED: "deadline-passed",
} as const;

/** WG-D4 — what a door that rides the floor's mgmt path (the mesh verbs, the
 * device slice's publish, the cells' serve routes) answers while fieldd holds
 * the floor `unresponsive`: UNAVAILABLE {service: "native", state:
 * "unresponsive"}, retryable, at once, never after the request's own
 * REQUEST_DEADLINE_MS. Distinct from UNAVAILABLE {service: "terminal", state:
 * "unresponsive"}, which fieldd's terminal service answers for a CELL that did
 * not answer inside its budget. fieldd writes it and a window reads it; the
 * floor never does (`error-data.native-unresponsive.json`). */
export const NativeUnavailableDetails = UnavailableDetails.extend({
  service: z.literal(NATIVE_REFUSALS.SERVICE),
  state: z.literal(NATIVE_REFUSALS.STATE_UNRESPONSIVE),
  /** when the link went `unresponsive` (unix ms) */
  since: z.number().int().nonnegative().optional(),
  /** the supervisor's own sentence for the state */
  detail: z.string().optional(),
}).passthrough();
export type NativeUnavailableDetails = z.infer<typeof NativeUnavailableDetails>;

/** WG-D6 — the floor's answer to a request that reaches dispatch after its
 * `RpcRequest.deadlineAt`: TIMEOUT, retryable, and the request is NOT run.
 * fieldd gave up on it at that instant, and a mutation run late can land behind
 * its own retry. The answer reaches fieldd as a late reply, which restarts the
 * kill clock like any reply: it proves the reader and dispatch move (WG-E2).
 * The floor writes these details as JSON; `error-data.native-deadline-passed`
 * pins them on both sides. */
export const NativeDeadlinePassedDetails = z
  .object({
    service: z.literal(NATIVE_REFUSALS.SERVICE),
    reason: z.literal(NATIVE_REFUSALS.REASON_DEADLINE_PASSED),
    /** the request's method, as fieldd's own TIMEOUT names it */
    method: z.string(),
    /** the deadline the request carried (unix ms, fieldd's clock on the same host) */
    deadlineAt: z.number().int().nonnegative(),
    /** when the floor refused it (unix ms, the floor's clock) */
    at: z.number().int(),
  })
  .passthrough();
export type NativeDeadlinePassedDetails = z.infer<typeof NativeDeadlinePassedDetails>;

/** WG-D1 (`thinking-floor-wedge.md` §7, §8.1) — the native-link block of
 * fieldd's `system.health`: the state with its numbers and its provenance
 * (DESIGN.md §9), so a window can say "the terminal floor isn't answering ·
 * 40 s — your 3 sessions still run" and, past the bound where this fieldd can
 * act, offer the person's restart. fieldd writes it, a window reads it, and
 * field-native never does, so it stays out of the Rust gen. Ages are fieldd's
 * monotonic clock when the block is written; `since` and `headlessAt` are its
 * wall clock (unix ms). */
export const NativeLinkHealth = z
  .object({
    state: NativeLinkState,
    /** the supervisor's own sentence for the state */
    detail: z.string(),
    /** the floor's pid as this fieldd knows it: the one it spawned, or the one
     * the floor stated in its hello ack (`HelloAck.pid`, WG-D6); null when it
     * knows neither */
    pid: z.number().int().min(1).nullable(),
    /** when `state` began (unix ms) */
    since: z.number().int().nonnegative(),
    /** ms since the last REPLY on the mgmt link, a late one included: the kill
     * clock (WG-E2). It runs on across a redial. null = no reply since this
     * fieldd first dialled */
    lastReplyAgeMs: z.number().int().nonnegative().nullable(),
    /** ms since the floor's last `native.lifecycle.tick`; past
     * `NATIVE_SUPERVISION.TICK_STALE_MS` the tick has stopped. null = no tick
     * seen (a floor predating WG-D6, or none yet) */
    lastTickAgeMs: z.number().int().nonnegative().nullable(),
    /** fieldd's own event-loop delay over the open wedge episode, p99 in ms
     * (WG-E1). null outside an episode or before its first sample, never 0 for
     * "no reading" */
    loopLagMs: z.number().nonnegative().nullable(),
    /** the sessions a restart of the floor would end, as fieldd last counted
     * them (WG-E6's census). null = unknown: not counted yet, or a cell did not
     * answer, which counts as holding sessions */
    sessionsAtRisk: z.number().int().nonnegative().nullable(),
    /** requests that settled TIMEOUT in the open episode, pings included; 0
     * outside one */
    requestsTimedOut: z.number().int().nonnegative(),
    /** the window may offer the person's restart (`system.native.restart`,
     * WG-D5): the link is `unresponsive` past the bound with sessions at risk,
     * or `gone`, AND this fieldd can act — on a live floor, a pid to signal (the
     * one it spawned, or the one the hello ack stated) and the authority to
     * spawn the next; on a dead one, that authority — AND a window is open to
     * offer it in. False past the bound with a window open means the words
     * "restart it outside VibeField" and no button */
    restartOffered: z.boolean(),
    /** when WG-D1's headless clause would proceed (unix ms) while it is armed:
     * sessions at risk past the bound and nobody to ask. It is
     * WEDGE_HEADLESS_MS after replies and the tick had both gone silent, so
     * while the tick flows it moves with every tick and the clause waits.
     * null = not armed */
    headlessAt: z.number().int().nonnegative().nullable(),
  })
  .passthrough();
export type NativeLinkHealth = z.infer<typeof NativeLinkHealth>;

/** `system.native.restart` (methods.ts, local only) — WG-D5: the person's
 * restart of a floor held `unresponsive` past the bound (or `gone`), in the
 * consent shape of `system.shutdown {native}` (design-00 EL1's consented
 * exception). `sessions` is the set the person consents to end: `[]` when the
 * floor holds none, as after the floor's own death on the `gone` escalation.
 * fieldd closes the terminal service to births and re-reads the census at the
 * point of effect (WG-E6); any difference from `sessions`, or a birth in
 * flight, refuses PRECONDITION_FAILED {live} and reopens births, and so does a
 * census no reading grounds (a silent cell fieldd never observed). A floor that
 * is answering, or not yet held past the bound, is refused PRECONDITION_FAILED
 * {state}. Only an exact match stops the floor, and its ladder waits out the
 * drain (`KILL_DRAIN_WAIT_MS`). TS-only: a window asks it of fieldd; the floor
 * never sees it. */
export const SystemNativeRestartParams = z
  .object({
    sessions: z.array(z.string().min(1).max(256)).max(4096),
  })
  .passthrough();
export type SystemNativeRestartParams = z.infer<typeof SystemNativeRestartParams>;

/** `system.native.restart`'s answer: the link's state after the act, in the
 * supervisor's words (`respawning` while the restart runs; `gone` when there
 * was no floor this fieldd could start again). */
export const SystemNativeRestartResult = z
  .object({
    state: NativeLinkState,
    detail: z.string(),
  })
  .passthrough();
export type SystemNativeRestartResult = z.infer<typeof SystemNativeRestartResult>;

/** TC-D6(e) — resource-pressure state spellings shared by emitters and readers
 * (UnavailableDetails.state / UnitHealth.detail). */
export const RESOURCE_PRESSURE_STATES = ["fd_pressure", "pty_exhausted"] as const;

// RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3): the
// mirror-write capability's mgmt shapes (MF-2a, GM-D5) —
// `NativeTerminalMirrorWriteCapabilityParams` and `...Result {configured,
// capability?}`, the one hop that ever carried the floor's durable write secret
// off the floor. Deleted with the verb, the mint, the key file and the env var;
// the write right is a claim in a per-client expiring attach grant now. No
// replacement shape belongs here: the grant is minted on the PRODUCT plane from
// the cell's own key, and the floor never hands a secret to fieldd for it.

// ---- mesh facade (P0 subset: peers / store / serve) ----

/** The spoof-safe Tailscale-User-* triple, injected at the sidecar bridge. */
export const WhoIsIdentity = z
  .object({
    login: z.string(),
    deviceName: z.string().optional(),
    tailscaleId: z.string().optional(),
  })
  .passthrough();
export type WhoIsIdentity = z.infer<typeof WhoIsIdentity>;

/** Truffle peer, mirrored minimally (parity fixture vs truffle-core serde lands with the embedding).
 * TWO id keyspaces ride here, and truffle's contract says they never collide:
 * `id` is the Tailscale stable node id (what `lane.open`/`resolve_peer` dial);
 * `deviceId` is the durable published ULID — the SyncedStore slice key (D30).
 * Joins must never mix them (the T1 §6 keyspace bug). `deviceId` is absent for
 * peers that never published into the mesh registry. */
export const PeerInfo = z
  .object({
    id: z.string(),
    deviceId: z.string().optional(),
    name: z.string().optional(),
    online: z.boolean(),
    addresses: z.array(z.string()).optional(),
    whois: WhoIsIdentity.optional(),
  })
  .passthrough();
export type PeerInfo = z.infer<typeof PeerInfo>;

/** UA-P-0a (D1) — the mesh POSTURE, which derives from the link and from
 * nothing else. The floor runs no tailnet node until fieldd asks for one:
 *
 *  - `capture` — the user's Link act. The interactive login runs and
 *    `native.mesh.self` starts answering once the netmap loads. NOTHING may be
 *    declared or published in this mode: the floor itself refuses `serve.add`
 *    and `store.set` (the belt), and fieldd declares no serve and publishes no
 *    slice (the suspenders). The account is not known yet, so nothing can be
 *    scoped to it.
 *  - `linked` — a login was captured and IS the account. Every surface is
 *    scoped to it; the floor carries the login so a later upstream gate
 *    (UA-P-4) has it in hand without a second round trip.
 *
 * Unlinked is the absence of both: no node, no serve, no store, no lane. */
export const MeshMode = z.enum(["capture", "linked"]);
export type MeshMode = z.infer<typeof MeshMode>;

/** UA-3 — `native.mesh.self`: the node's OWN identity, including the S1
 * self-whois login (best-effort — absent means the sidecar could not answer
 * for self, or a tagged node has no user; never synthesized, EL7). This is
 * the left-hand side of UA-4's self/guest comparison, captured once at link
 * time into link.json, never looked up per request.
 *
 * UA-P-4 (RFC 025 §3.6) — `loginAllow` is the node's own GATE: the login globs
 * the installed node was BUILT with, which truffle fixes for its lifetime
 * (§3.1). `[]` is truffle's "no gate" and is the honest answer for capture mode
 * and for the `FIELD_NATIVE_MESH` development override; the product's linked
 * node carries exactly one entry, its account's login.
 *
 * REQUIRED, and deliberately not optional. The question it answers — "is this
 * node admitting only my account?" — has no third state: a floor either knows
 * what it built its node with or has no node to describe. An optional field
 * would let an absent value read as "ungated" at exactly the reader that most
 * needs to fail closed, which is the shape of every fail-open bug UA-P-0 spent
 * itself closing. It is NOT derived from the posture: between
 * `native.mesh.start {mode:"linked"}` and the rebuild that gate change forces,
 * the posture already says linked while the live node is still ungated, and
 * this field tracks the node. */
export const MeshSelfIdentity = z
  .object({
    deviceId: z.string(),
    deviceName: z.string().optional(),
    dnsName: z.string().optional(),
    tailscaleId: z.string().optional(),
    ip: z.string().optional(),
    login: z.string().optional(),
    loginAllow: z.array(z.string()),
    /** TS-1 (track TS) — the posture the floor holds this node in. Optional
     * for a floor that predates it. */
    mode: MeshMode.optional(),
    /** TS-1 — the name Tailscale shows for this node, on its "connect the
     * device …?" page and in the admin console (`truffle-vibefield-<host>`
     * until TF-a; Tailscale may add `-1`). */
    machineName: z.string().optional(),
    /** TS-1 — when this node's sign-in lapses, ms since the epoch; absent
     * when expiry is disabled for it (`keyExpiryDisabled`) or not known (a
     * sidecar before protocol 10). Display and warning only, never a trust
     * input. Two fields rather than a nullable one, because the floor's
     * typed writer cannot tell `null` from absent. */
    keyExpiresAt: z.number().int().optional(),
    /** TS-1 — expiry is disabled for this node (an admin turned it off). */
    keyExpiryDisabled: z.boolean().optional(),
    /** TS-1 — the admin console's Machines page; absent for a custom control
     * server (Headscale has no console). */
    adminUrl: z.string().optional(),
    /** TS-1 — the node was running and is signed out of the tailnet: its key
     * expired, or it was removed in the console. Nothing reaches it until a
     * new sign-in (`native.mesh.start` with `renew`). */
    needsLogin: z.boolean().optional(),
    /** T11 (track TS) — the Tailscale client the node's sidecar embeds, the
     * release a person compares with the admin console (`1.104.1`). */
    tailscaleVersion: z.string().optional(),
    /** T11 — Tailnet Lock holds this node: it runs, but reaches no peer and no
     * peer reaches it until a signing device signs it ("connected, not yet
     * trusted"). */
    needsSignature: z.boolean().optional(),
    /** TS-D15/D16 — the node sends Tailscale its client logs: what the RUNNING
     * node was built with (`MeshStartParams.clientLogUpload`). */
    clientLogUpload: z.boolean().optional(),
  })
  .passthrough();
export type MeshSelfIdentity = z.infer<typeof MeshSelfIdentity>;

/** UA-P-0a — `native.mesh.start`: bring the node up in one posture, or move a
 * running node to another (capture → linked is the ordinary promotion at the
 * moment the login lands). `login` is REQUIRED in `linked` mode and refused in
 * `capture` mode — a captured login is the only thing that may name an
 * account, and pre-capture there is nothing to name. */
export const MeshStartParams = z
  .object({
    mode: MeshMode,
    login: z.string().min(1).optional(),
    /** TS-1 (track TS, P7) — `capture` only: sign the node in with this
     * Tailscale auth key and no browser (a headless mini, a managed machine).
     * Never stored and never logged on either side of the channel; the floor
     * holds it for the one bring-up it signs in. Refused in `linked` mode: a
     * linked node keeps the key it signed in with. */
    authKey: z.string().min(1).optional(),
    /** TS-1 — `linked` only: the node was signed out (its key expired, or it
     * was removed), so rebuild an INSTALLED node on its own state even though
     * its gate has not moved: only a new bring-up hands out a new sign-in
     * address. A bring-up still waiting for its sign-in is left alone, since
     * its address is the live one. Refused in `capture` mode. */
    renew: z.boolean().optional(),
    /** TS-D15/D16 — send Tailscale the node's client logs. Absent or false is
     * VibeField's default, none (D15); true only for a link, or a capture, the
     * person opted in on a network that requires logs (D16, "Send logs on this
     * network"). truffle fixes it for a node's lifetime, so a change rebuilds a
     * running node. Either mode. */
    clientLogUpload: z.boolean().optional(),
  })
  .passthrough();
export type MeshStartParams = z.infer<typeof MeshStartParams>;

/** TS-1 (track TS) — why the floor's last bring-up ended without a node: no
 * sidecar to start (reinstalling is the way forward), a build that failed, or
 * the sidecar of a node that was up exiting on its own. One word the person's
 * sentence is chosen by; the unit's `detail` keeps the floor's own words.
 *
 * TS-D16 adds `logging_required`: the tailnet requires client logs (its
 * network flow logs are on) and this node sends none, so Tailscale keeps it
 * down, at its start or, for a running node, when an admin turns flow logs
 * on. It stays down until it is built again with uploads allowed, or until the
 * tailnet's flow logs are off. */
export const MeshFailure = z.enum([
  "sidecar_missing",
  "bring_up_failed",
  "sidecar_exited",
  "logging_required",
]);
export type MeshFailure = z.infer<typeof MeshFailure>;

/** TS-1 (track TS) — the details of `native.mesh.self`'s UNAVAILABLE answer,
 * "mesh node not up": the C1 shape (the unit's own state, and its sign-in
 * address while a browser login runs) plus the facts a person acts on while
 * there is no node yet — the approval it waits on and the console that grants
 * it, the name it will carry, and why a bring-up ended. The tolerant reader
 * holds: a floor before TS-1 sends `service`, `state` and `authUrl` alone.
 *
 * It restates `UnavailableDetails`' two fields rather than `.extend()`ing it:
 * zod-to-json-schema writes an extension as `$ref`s into the parent's
 * properties, which typify cannot follow. */
export const MeshNotUpDetails = z
  .object({
    /** always "mesh-gateway" */
    service: z.string(),
    /** the mesh unit's state (`UnitState`), or "unknown" */
    state: z.string(),
    /** the mesh unit's sign-in address while a browser login runs */
    authUrl: z.string().optional(),
    /** the posture the floor holds; absent when it holds none */
    mode: MeshMode.optional(),
    /** the tailnet's device approval holds this node (Tailscale's NeedsMachineAuth) */
    needsApproval: z.boolean().optional(),
    /** the admin console's Machines page; absent for a custom control server */
    adminUrl: z.string().optional(),
    /** the name the node will carry in Tailscale (composed before it is up) */
    machineName: z.string().optional(),
    /** ms since the epoch; absent = expiry disabled or not known */
    keyExpiresAt: z.number().int().optional(),
    /** expiry is disabled for this node */
    keyExpiryDisabled: z.boolean().optional(),
    failure: MeshFailure.optional(),
  })
  .passthrough();
export type MeshNotUpDetails = z.infer<typeof MeshNotUpDetails>;

/** `started: false` = the node was already up in this exact posture — an
 * idempotent re-ask, not a failure. A posture CHANGE always reports true. */
export const MeshStartResult = z
  .object({
    mode: MeshMode,
    started: z.boolean(),
  })
  .passthrough();
export type MeshStartResult = z.infer<typeof MeshStartResult>;

/** UA-P-0a — `native.mesh.stop`: drop the node without touching the identity
 * on disk. This is NOT unlink (`native.mesh.retire` archives the state dir and
 * mints a fresh identity on relink); it is the posture going offline — a
 * capture that could not learn a login, or a login another local user already
 * holds. `stopped: false` = there was no node — an honest no-op. */
export const MeshStopResult = z
  .object({
    stopped: z.boolean(),
  })
  .passthrough();
export type MeshStopResult = z.infer<typeof MeshStopResult>;

/** UA-3 — `native.mesh.retire`: unlink's native half. Stops the node (the
 * sidecar dies with it), archives the state dir to `mesh.retired-<ts>`
 * beside itself, and reports where. `retired: false` = nothing to retire
 * (no state on disk) — an honest no-op, not an error. Answered BEFORE the
 * node gate: retiring a half-authed or disabled mesh must still work.
 *
 * TS-D14 — the node is signed out of its tailnet first (truffle's
 * `Node::logout`, bounded at 12 s), so the admin console stops counting it as
 * signed in. `signedOut: false` = the logout did not reach Tailscale (the
 * device was offline, or there was no node up to sign out), and the console
 * keeps listing it until someone removes it there. Absent from a floor before
 * TS-D14. The caller's deadline must outlast the logout's bound. */
export const MeshRetireResult = z
  .object({
    retired: z.boolean(),
    archivedTo: z.string().nullable(),
    signedOut: z.boolean().optional(),
  })
  .passthrough();
export type MeshRetireResult = z.infer<typeof MeshRetireResult>;

/** SyncedStore view: device-owned slices, merged at the reader. `store.set` writes OWN slice only. */
export const StoreSnapshot = z
  .object({
    storeId: z.string(),
    slices: z.record(z.unknown()),
  })
  .passthrough();
export type StoreSnapshot = z.infer<typeof StoreSnapshot>;

/** TM-2 (TM-D2) — a route prefix as the floor's `parse_cell_routes` admits it
 * (`field-native/src/mgmt/mesh.rs`): ABSOLUTE, and with NO trailing slash
 * unless the prefix is the root itself.
 *
 * The trailing-slash rule is a measurement, not a preference (TM-2b,
 * 2026-09-14, sidecar-slim at the pinned truffle 0.7.12): `/cell/<boot>/` never
 * matched `/cell/<boot>/control` at all, while `/cell/<boot>` matched it and
 * handed the backend `/control`, which is the exact path a cell door requires.
 * The law and its evidence live on `remoteCellRoutePrefix`; this is the same
 * rule stated where the WIRE is described, so a spec that would be refused by
 * the floor is refused before it is sent. */
export const SERVE_ROUTE_PREFIX_PATTERN = "^\\/(?:[\\s\\S]*[^\\/])?$";

/** TM-2 (TM-D2) — one declared route on a `routes` serve: a path prefix onto
 * ONE loopback port, and DELIBERATELY nothing else.
 *
 * The narrowness is the EL7 argument, and it is the floor's: `parse_cell_routes`
 * admits a prefix and a port and refuses everything a truffle `ProxyRoute` can
 * otherwise carry — a static dir, a non-loopback target, a fallback, or a
 * per-route allow-list that would override the serve's login gate. `stripPrefix`
 * is not a field either: the floor sets it TRUE for every one of these, because
 * a cell's door matches `/control` and `/frames` exactly and answers anything
 * else with `HelloMalformed`. So the worst a compromised fieldd can publish
 * through this door is another loopback port on a machine it already owns. */
export const ServeRoute = z
  .object({
    prefix: z.string().regex(new RegExp(SERVE_ROUTE_PREFIX_PATTERN)),
    /** the cell's loopback T1 door; the floor composes `http://127.0.0.1:<port>` */
    targetPort: z.number().int().min(1).max(65535),
  })
  .passthrough();
export type ServeRoute = z.infer<typeof ServeRoute>;

export const ServeTarget = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("port"),
      port: z.number().int().min(1).max(65535),
      scheme: z.enum(["http", "https"]).optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("dir"),
      path: z.string(),
      fallback: z.literal("/index.html").optional(),
    })
    .passthrough(),
  /** TM-2 (TM-D2) — a serve whose ENTIRE surface is `ServeConfig.routes`, with
   * no implicit root route: the terminal-cell listener. The `port` arm mounts a
   * catch-all `/` at its target whenever a listener port is named, and a
   * catch-all on THIS listener would publish whatever single port the shape
   * happened to carry — fieldd's own control port, in the natural spelling — so
   * an unmatched path here reaches no backend at all.
   *
   * ADDED 2026-09-14 (F-H3): fieldd has been sending this kind and the floor has
   * been implementing it since TM-2, while the contract described two arms. The
   * typify'd Rust twin therefore could not deserialize the spec the daemon
   * really sends, and `serve-config.valid.json` pinned a shape nothing on this
   * seam uses — an EL9 golden blind to the live wire. */
  z
    .object({
      kind: z.literal("routes"),
    })
    .passthrough(),
]);
export type ServeTarget = z.infer<typeof ServeTarget>;

export const ServeConfig = z
  .object({
    /** Stable engine identity. Omitted by v1 callers, where it defaults to name. */
    serveId: z.string().min(1).optional(),
    name: z.string(),
    /** Tailnet listener, independent of a port target. Omitted preserves v1 behavior. */
    listenPort: z.number().int().min(1).max(65535).optional(),
    target: ServeTarget,
    /** per-route allow-globs (WhoIs-gated at the proxy, pre-injection, fails
     * closed on empty caller login — tagged nodes never reach the backend) */
    allow: z.array(z.string()).optional(),
    /** false = plain HTTP inside WireGuard (no MagicDNS-cert dependency —
     * the product-API serve's choice). Default true upstream. v2-sidecar. */
    tls: z.boolean().optional(),
    /** TM-2 — the declared path routes. ONLY meaningful for `target.kind:
     * "routes"`, where they are the serve's whole surface; every other kind
     * ignores them. The floor REFUSES an empty list on a routes serve, because
     * truffle reads `routes.is_empty()` as "use the single-target shape" and
     * would silently fall back to a default target — a caller with nothing to
     * publish removes the serve instead, which is what fieldd's driver does. */
    routes: z.array(ServeRoute).optional(),
    /** Optional app-owned static preview root mounted ahead of the source route. */
    previewDir: z.string().min(1).optional(),
    /** C3 provenance proof: when set, the serve is ONE route — the bare root `/` → the target with
     * `/<door>/<pathSecret>` as the TARGET's path, strip_prefix OFF — so the sidecar adds the secret
     * on forward, the caller dials the root knowing nothing, and the backend sees the secret on every
     * proxied request. Only the sidecar's route config and the declaring daemon hold it — a same-uid
     * local caller (EL7's adversary) cannot mint tailnet identity without it. *Corrected 2026-10-17
     * at source:* this said the route was the PUBLIC `/t/<pathSecret>`, which UA-P-0d (D7,
     * 2026-09-15) moved onto the target; the floor's `build_serve_config` and its erratum are the
     * authority. */
    pathSecret: z.string().optional(),
    /** F1 — which door `pathSecret` proves to: fieldd's product door (`/t/`, the default) or the
     * freeway host's (`/f/`). Only with `pathSecret`. */
    secretDoor: z.enum(["product", "freeway"]).optional(),
  })
  .passthrough();
export type ServeConfig = z.infer<typeof ServeConfig>;

/** ProxyStatus/ProxyEvent mirror — the serve's live runtime state. */
export const ServeStatus = z.enum(["starting", "running", "stopped", "error"]);
export type ServeStatus = z.infer<typeof ServeStatus>;

export const ServeEntry = z
  .object({
    serveId: z.string().min(1),
    name: z.string(),
    listenPort: z.number().int().min(1).max(65535),
    target: ServeTarget,
    url: z.string(),
    allow: z.array(z.string()).optional(),
    /** Benign declared listener policy, rehydrated from field-native's private config cache. */
    tls: z.boolean().optional(),
    status: ServeStatus.optional(),
    /** ProxyEvent::Error passthrough (SERVE_ERROR / CONNECTION_REFUSED / …) */
    error: z.string().optional(),
  })
  .passthrough();
export type ServeEntry = z.infer<typeof ServeEntry>;

// ---- MeshData lanes (C6 / D5) ----
//
// CONTROL ONLY. Lane bytes ride native/run/meshdata.sock (see meshdata.ts);
// nothing below ever carries a payload. That split is EL2 made structural: a
// lane is negotiated on a contract surface and then gets out of the way, so
// doc bytes never touch JSON-RPC and control never queues behind a snapshot.

/** Delivery class, mapped 1:1 from strata's DeliveryClass by fieldd's Channel
 * impl. `reliable` = one QUIC stream per lane (per-lane FIFO, flow control
 * propagates); `lossy` = bounded logical snapshots fragmented into datagrams,
 * latest-first healing, with reliable terminal replay on graceful close. */
export const MeshLaneClass = z.enum(["reliable", "lossy"]);
export type MeshLaneClass = z.infer<typeof MeshLaneClass>;

/** What the lane carries. The BRIDGE does not interpret this — it is dumb by
 * design (D5) — but fieldd routes inbound lanes by it, and it is what makes a
 * `lane.peerOpened` actionable without decoding a byte. */
export const MeshLaneProtocol = z.enum(["doc-sync", "presence"]);
export type MeshLaneProtocol = z.infer<typeof MeshLaneProtocol>;

/** native.mesh.lane.open — fieldd asks the bridge for a lane to a peer.
 * The caller mints laneId: it owns the numbering for lanes it opens, which
 * removes a round-trip and lets it send DATA as soon as the call returns. */
export const MeshLaneOpenRequest = z
  .object({
    laneId: z.number().int().nonnegative(),
    class: MeshLaneClass,
    /** truffle peer id, as carried by PeerInfo.id */
    peer: z.string(),
    protocol: MeshLaneProtocol,
    /** Document room this lane is for (`doc-sync` and `presence`). A snapshot
     * takes its own short-lived lane, so this is not unique per document. */
    docId: z.string().optional(),
  })
  .passthrough();
export type MeshLaneOpenRequest = z.infer<typeof MeshLaneOpenRequest>;

export const MeshLaneCloseRequest = z
  .object({
    laneId: z.number().int().nonnegative(),
    reason: z.string().optional(),
  })
  .passthrough();
export type MeshLaneCloseRequest = z.infer<typeof MeshLaneCloseRequest>;

/** Notification: a PEER opened a lane to us. Lane ids from the two directions
 * share no space, so the `inbound` flag is what keeps them apart rather than a
 * numbering convention nobody can enforce across a network. */
export const MeshLanePeerOpened = z
  .object({
    laneId: z.number().int().nonnegative(),
    inbound: z.literal(true),
    class: MeshLaneClass,
    peer: z.string(),
    protocol: MeshLaneProtocol,
    docId: z.string().optional(),
    /** WhoIs-verified identity of the opening peer — every inbound delivery
     * carries it (the v0.5 requirement), so authorization never rests on a
     * self-declared id. */
    whois: WhoIsIdentity.optional(),
  })
  .passthrough();
export type MeshLanePeerOpened = z.infer<typeof MeshLanePeerOpened>;

/** Notification: a lane ended, from either side. Lanes are cheap and mortal —
 * D5's law is that a torn frame tears the LANE, never the daemon — so this is
 * an ordinary event, not an error path. */
export const MeshLaneClosed = z
  .object({
    laneId: z.number().int().nonnegative(),
    inbound: z.boolean().optional(),
    /** "peer-closed" | "peer-unreachable" | "torn-frame" | "local" | … —
     * open vocabulary, logged verbatim (tolerant reader). */
    reason: z.string(),
  })
  .passthrough();
export type MeshLaneClosed = z.infer<typeof MeshLaneClosed>;

// ---- egress (DS-1 · design-02 §2.4's egress bullet · design-06 §3 · petition T7 = truffle RFC 026) ----
//
// The mirror image of `serve`. Serving publishes a loopback port ONTO the
// tailnet; egress lets a process on THIS desktop reach a peer THROUGH its own
// node, so no desktop-to-desktop path depends on the operating system's
// Tailscale app (DS-L5). Three rungs, all in the sidecar, so bytes cross a
// process boundary once per side as they do inbound:
//
//   E1 `proxy`      the node's own authenticated SOCKS5 (tsnet `Loopback()`);
//                   fieldd's PeerLink dials a peer's door through it.
//   E2 `route.*`    a loopback listener with a FIXED tailnet target, one per
//                   peer door; a renderer dials a remote cell as it dials a
//                   local one.
//   E3 `httpProxy`  an authenticated HTTP CONNECT proxy for the artifact and
//                   browser partition (Chromium cannot authenticate to SOCKS5).
//
// CONTROL ONLY: an address, a credential, a route row. Nothing that rides an
// egress path ever crosses this channel (EL2).
//
// The floor answers these verbs from its node: truffle-core 0.7.19 and its
// protocol-8 sidecar carry egress (RFC 026 needs protocol 7), and
// field-native's default build is the truffle arm. Before a node is up, the
// acts that need one (`proxy`, `httpProxy`, `route.add`) answer `mesh-down`,
// the table reads answer an empty table, and `route.remove` finds nothing
// (`NOT_FOUND`). A build without the `truffle-egress` feature, or a node whose
// sidecar predates protocol 7, answers every verb
// `UNAVAILABLE {service: "mesh", state: "egress-unsupported"}`. That is a
// capability fact, not a transient: fieldd keeps dialling over the OS network
// and says so once per link (`mesh.egress.fallback_os_network`).
// Corrected 2026-10-01 (DS-1b, review D4 + D5): fieldd asks once per FLOOR
// BOOT and says it once per boot (`FloorEgress` in fieldd's egress.ts), and
// `egress-unsupported` is the ONLY answer that takes the OS network:
// `mesh-down`, a timeout or a mgmt link mid-reconnect fail the dial closed
// (DS-L5).

/** The egress registry. Generated into Rust (`registries::mesh_egress`) so the
 * floor's belt and fieldd's suspenders read ONE list, never two copies. */
export const MESH_EGRESS = {
  /** `UnavailableDetails.service` on every egress refusal. */
  SERVICE: "mesh",
  /** The sidecar predates RFC 026. A CAPABILITY fact that holds for the
   * floor's whole life, so a reader falls back instead of retrying. */
  STATE_UNSUPPORTED: "egress-unsupported",
  /** Egress exists, but no node is installed right now (the posture is
   * offline, or the node is starting or rebuilding). */
  STATE_MESH_DOWN: "mesh-down",
  /** DS-L6 — the ONLY tailnet ports an unauthenticated loopback route may
   * target: doors that demand their own grant. A terminal cell verifies a MAC
   * on its first frame; the product door trusts the node's login and is
   * reached only through the authenticated proxy (E1), never through a route.
   * A new row here is a claim about a door's authentication, made in review.
   * (SP-3, 2026-10-01: `PORTS.INDEX_SERVE` is deliberately absent — the pinned
   * rosettad verifies no credential; it is the claim DS-7's pin move makes,
   * when rosettad starts with RO-1's bearer and RO-10's grant key.) */
  ROUTABLE_PORTS: [PORTS.TERMINAL_CELLS_SERVE],
} as const;

/** 1–65535 with no leading zero, as a PATTERN rather than a refinement so the
 * generated Rust twin checks the same rule (typify carries `pattern`; a zod
 * refinement never reaches it). */
const EGRESS_PORT =
  "(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])";

/** A listener the floor bound for this desktop: a LITERAL loopback address and
 * a port. Never a name: a name is resolved, a resolver can be pointed
 * elsewhere, and whoever answered would be handed the credential. */
export const MESH_EGRESS_LOOPBACK_PATTERN = `^(?:127\\.0\\.0\\.1|\\[::1\\]):${EGRESS_PORT}$`;
export const MeshEgressLoopbackAddress = z
  .string()
  .regex(new RegExp(MESH_EGRESS_LOOPBACK_PATTERN), "a literal loopback host:port");
export type MeshEgressLoopbackAddress = z.infer<typeof MeshEgressLoopbackAddress>;

/** A route's FIXED tailnet target, `<peer-fqdn-or-ip>:<port>`: a DNS name
 * (MagicDNS), a dotted IPv4, or a bracketed IPv6. Syntax only. Whether the
 * target is a peer the node's login gate admits is the sidecar's refusal to
 * make (RFC 026 E2); which PORTS may be routed at all is DS-L6's
 * (`MESH_EGRESS.ROUTABLE_PORTS`), enforced by the floor. */
export const MESH_EGRESS_TARGET_PATTERN = `^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\\[[0-9A-Fa-f:.]{2,45}\\]):${EGRESS_PORT}$`;
export const MeshEgressTarget = z
  .string()
  .max(259)
  .regex(new RegExp(MESH_EGRESS_TARGET_PATTERN), "<peer-fqdn-or-ip>:<port>");
export type MeshEgressTarget = z.infer<typeof MeshEgressTarget>;

/** A route's name. The CALLER mints it (fieldd keys one per `{peer, port}`),
 * so an add replayed after a reconnect names the same route instead of
 * binding a second listener. A conservative charset, because the sidecar
 * carries it as its own key. */
export const MESH_EGRESS_ROUTE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
export const MeshEgressRouteId = z.string().regex(new RegExp(MESH_EGRESS_ROUTE_ID_PATTERN));
export type MeshEgressRouteId = z.infer<typeof MeshEgressRouteId>;

/** `native.mesh.egress.proxy {}` (E1, SOCKS5) and `native.mesh.egress.httpProxy {}`
 * (E3, HTTP CONNECT): one answer shape for both, where the proxy listens and
 * the username and credential it demands (RFC 1929 for the SOCKS5, Basic for
 * the HTTP proxy). The username is the substrate's constant — tsnet's
 * loopback proxy fixes it (`LOOPBACK_SOCKS5_USERNAME = "tsnet"` in truffle-core
 * as built for RFC 026) — and rides the answer so no reader hardcodes it. The
 * credential is the only secret on this seam: it rides the paired channel
 * once per ask and lives in fieldd's memory, never a log, a file or an
 * environment (EL7). */
export const MeshEgressProxy = z
  .object({
    address: MeshEgressLoopbackAddress,
    username: z.string().min(1).max(255),
    credential: z.string().min(1).max(1024),
  })
  .passthrough();
export type MeshEgressProxy = z.infer<typeof MeshEgressProxy>;

/** `native.mesh.egress.route.add`: bind a loopback listener whose every
 * connection is dialled, through the node, to `target`. Idempotent per id:
 * the same id with the same target answers the route already bound, and the
 * same id with ANOTHER target is a CONFLICT, because a route never silently
 * re-aims. `login` is an optional allow-glob the sidecar checks against the
 * target's WhoIs at bind (RFC 026 E2's option). */
export const MeshEgressRouteAddParams = z
  .object({
    id: MeshEgressRouteId,
    target: MeshEgressTarget,
    login: z.string().min(1).max(256).optional(),
  })
  .passthrough();
export type MeshEgressRouteAddParams = z.infer<typeof MeshEgressRouteAddParams>;

/** The table's REVISION: the facade's change counter, bumped by every add,
 * remove and reset (TC-D15's discipline for route snapshots, reused). It
 * orders an answer against the stream: the table stream's forwarder runs
 * beside the handler, so a snapshot read just before an add can reach the
 * reader AFTER that add's answer, and without an order it would read as
 * "the route is gone". A snapshot whose revision is below the one a route was
 * bound at says nothing about that route.
 *
 * A revision orders only within ONE floor boot: a respawned floor counts from
 * zero again, so both shapes carry the floor's `bootId` beside it, and a table
 * from another boot is authoritative for every route — the routes of the boot
 * that bound them died with it. */
export const MeshEgressRevision = z.number().int().nonnegative();

/** `route.add`'s answer: the loopback address a local process dials, and the
 * table revision this binding is part of. */
export const MeshEgressRouteBound = z
  .object({
    id: MeshEgressRouteId,
    listen: MeshEgressLoopbackAddress,
    revision: MeshEgressRevision,
    /** the floor boot that bound it (`NativeHealth.bootId`) */
    bootId: z.string().min(1),
  })
  .passthrough();
export type MeshEgressRouteBound = z.infer<typeof MeshEgressRouteBound>;

/** `route.remove`'s params AND its answer: a route is named by its id alone.
 * An unknown id is NOT_FOUND, exactly as `serve.remove` answers, so a caller
 * releasing a route that a node rebuild already dropped reads it as done. */
export const MeshEgressRouteRef = z
  .object({
    id: MeshEgressRouteId,
  })
  .passthrough();
export type MeshEgressRouteRef = z.infer<typeof MeshEgressRouteRef>;

/** One row of the route table. */
export const MeshEgressRoute = z
  .object({
    id: MeshEgressRouteId,
    target: MeshEgressTarget,
    listen: MeshEgressLoopbackAddress,
  })
  .passthrough();
export type MeshEgressRoute = z.infer<typeof MeshEgressRoute>;

/** `route.list`'s answer, and the snapshot of `route.subscribe`. The table is
 * REBUILT-NOT-PERSISTED like every facade table (design-02 §2.4): a node
 * teardown or rebuild empties it, and the subscription says so with a fresh
 * snapshot. That snapshot is the facade's `reset` in the P5 idiom, and it is
 * how fieldd learns that every listen address it handed out is dead. */
export const MeshEgressRouteTable = z
  .object({
    routes: z.array(MeshEgressRoute),
    /** the facade's revision this table was read at or after (never before) */
    revision: MeshEgressRevision,
    /** the floor boot whose table this is (`NativeHealth.bootId`) */
    bootId: z.string().min(1),
  })
  .passthrough();
export type MeshEgressRouteTable = z.infer<typeof MeshEgressRouteTable>;

/** The facade's two degraded answers, as `UNAVAILABLE` details
 * (`MESH_EGRESS.STATE_*` says what each means). `gatewayState` rides beside
 * `mesh-down` with the mesh unit's own word, so a reader can say WHY without
 * asking twice. TS-side only: the floor writes these details as JSON, and the
 * `error-data.egress-*` goldens pin what it writes on both sides. */
export const MeshEgressUnavailableState = z.enum([
  MESH_EGRESS.STATE_UNSUPPORTED,
  MESH_EGRESS.STATE_MESH_DOWN,
]);
export type MeshEgressUnavailableState = z.infer<typeof MeshEgressUnavailableState>;
export const MeshEgressUnavailableDetails = UnavailableDetails.extend({
  service: z.literal(MESH_EGRESS.SERVICE),
  state: MeshEgressUnavailableState,
  gatewayState: UnitState.optional(),
}).passthrough();
export type MeshEgressUnavailableDetails = z.infer<typeof MeshEgressUnavailableDetails>;
