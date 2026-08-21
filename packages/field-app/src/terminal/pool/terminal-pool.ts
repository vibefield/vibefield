import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";
import { TerminalConnectTicketResult } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { getHost } from "../../host";
import { getRendererLogger } from "../../logging";
import {
  type CellTransport,
  CellTransportTable,
  resolveCellForSession,
  type TerminalShellPolicy,
  UNROUTED_INTERACTIVE_CELL,
} from "./cell-transport";
import {
  NO_SOURCE_DEMAND,
  type SessionDemand,
  type SessionDemandChange,
  SessionDemandLedger,
  type SourceDemand,
  type SourceDemandMode,
  type ViewDemandKey,
} from "./demand";
import { createTerminalRuntime } from "./runtime-factory";

// THE WINDOW'S TERMINAL SESSION POOL (TP-S0b; design-03·A's D13 session pool,
// promoted to the runtime's owner).
//
// A module singleton, deliberately — the same reason the frame-stats overlay is
// a module and not a component (`mount.tsx`): it must outlive every remount the
// React tree does. The canvas stack remounts on doc generation; the Godview
// monitor unmounts on close; the deck itself is mounted and unmounted by the
// overlay's `everOpened` gate and by whether the host offers a terminal at all.
// A runtime that dies with any of those is a bridge re-forked, a socket
// re-dialled, a render worker re-created and a GPU device re-requested for
// reasons that have nothing to do with terminals.
//
// It owns four things, and they were in three different places before:
//
//   1. THE RUNTIME. One per window (TP-D5, §9.1). It was minted in
//      `GodviewDeck` (React state, one per deck generation) and again in
//      `warm-transport` (a second module singleton), which is why the
//      one-runtime law had to be enforced by two modules agreeing at a
//      distance. Here there is one owner and the law is structural.
//   2. THE TRANSPORT TABLE (TP-L-C). `cellBootId → CellTransport`, one entry
//      today. Placement never escapes this module: consumers ask for sessions.
//   3. THE DEMAND LEDGER (TP-L-E′). Views declare `none | live` per session and
//      release ATOMICALLY on unmount.
//   4. THE RECOVERY LADDER. Bridge death, bridge rebuild, ticket expiry, the
//      prewarm's custody clause and the human retry — one transition guard, one
//      place that decides to replace a runtime, instead of the deck and the
//      overlay each holding half of it.
//
// What is NOT here: sessions, panes, layout, faces, the workspace. The pool
// opens the door and holds the ledger; what appears in a pane is still the
// workspace's decision through its own doors (GT-D10), and the deck is the first
// consumer of the pool rather than the owner of the runtime.

/** Which plane refused, and therefore what is actually true about the shells.
 *
 * `transport` is the path to the floor: no bridge on this host, a connect main
 * could not make, a bridge that died. `fieldd` is the CONTROL plane alone — the
 * ticket mint. field-native holds the PTYs and outlives fieldd by design, so a
 * fieldd that will not answer says NOTHING about the shells: they are running,
 * and this window is merely not allowed through the door yet. Reporting that as
 * a dead shell told a user the exact opposite of the property this product
 * sells (GT-5c). */
export type TerminalFaultPlane = "transport" | "fieldd";

export interface TerminalFault {
  readonly plane: TerminalFaultPlane;
  /** The failing plane's own words, carried whole. */
  readonly message: string;
}

/**
 * Where the transport is. Two axes, deliberately not collapsed into one word:
 * this is the TRANSPORT's phase, and `claimed` is OWNERSHIP. A warm transport
 * nobody has asked for and an open one a deck is holding are the same plumbing
 * in different custody, and every rule about re-warming is about the second axis.
 */
export type TerminalPoolPhase =
  /** Nothing has been asked for. No bridge, no socket, no worker. */
  | "cold"
  /** A prewarm is in flight and holds the only ports wait. */
  | "warming"
  /** A prewarm finished; the transport is live and unclaimed. */
  | "warm"
  /** The prewarm failed or its bridge died before anyone used it. One re-warm. */
  | "spent"
  /** A consumer claimed the pool and the transport is being acquired. */
  | "opening"
  /** A consumer claimed the pool and the transport is live. */
  | "open"
  /** A consumer claimed the pool and something refused. `fault` says which. */
  | "failed";

export interface TerminalPoolSnapshot {
  readonly phase: TerminalPoolPhase;
  /** A consumer has taken the pool; nothing may prewarm behind it. */
  readonly claimed: boolean;
  /** The window's ONE runtime while a transport exists, else null. */
  readonly runtime: GhostteaTerminalRuntime | null;
  /** Main's answer to the connect (GT-D10). */
  readonly shell: TerminalShellPolicy | null;
  readonly fault: TerminalFault | null;
  /** Bumped whenever the runtime is REPLACED. A consumer that reads its runtime
   * once at mount — the ghosttea workspace does — keys its subtree on this. */
  readonly generation: number;
  /** The open INHERITED a prewarmed transport rather than acquiring one. */
  readonly warm: boolean;
  /** Why the prewarm is spent, when it is. */
  readonly spentReason: string | null;
}

/** The stations the pool can stamp on a cold-open trace. Structural on purpose:
 * `ColdOpenTrace` satisfies it, and the pool does not import Godview. */
export interface TransportTrace {
  mark(phase: "ticket" | "connected" | "device"): void;
}

/** One view's binding to one session (TP-L-C: by id, never by placement). */
export interface TerminalSessionView {
  readonly sessionId: string;
  /** Re-declare this view's demand. Idempotent. */
  declare(demand: SourceDemand): void;
  /** Release atomically. Safe to call twice — React cleanups can run late. */
  release(): void;
}

// ── the singleton's state ───────────────────────────────────────────────────

const transports = new CellTransportTable();
const demand = new SessionDemandLedger();
const listeners = new Set<() => void>();

let phase: TerminalPoolPhase = "cold";
let claimed = false;
let fault: TerminalFault | null = null;
let spentReason: string | null = null;
let inheritedWarm = false;
let transportGeneration = 0;
/** The client the pool mints tickets with, remembered from the first ask so the
 * ladder and the retry do not need one handed to them at the moment of a
 * bridge event — which is not a moment any React tree is guaranteed to exist. */
let client: FielddClient | null = null;
/** A prewarm in flight, so a claim joins it rather than arming a second ports
 * wait. THE one-runtime law's first half. */
let pending: Promise<void> | null = null;
/** Bumped by anything that INVALIDATES an acquisition in flight. A late answer
 * to a question nobody is asking any more is dropped, not applied. */
let acquisitionEpoch = 0;
/** GT-D14: exactly one re-warm from `spent`, enforced by state rather than by a
 * counter someone must trust. */
let rewarmed = false;
/** GT-2c: main republishes unchanged bridge states by contract, so only a
 * TRANSITION may act. Module-scoped now, which is stricter than the deck's
 * per-mount ref was: a remounted deck no longer re-acts to a state it already
 * saw. */
let lastBridgeState: string | null = null;
let unsubscribeBridge: (() => void) | null = null;

let snapshot: TerminalPoolSnapshot = buildSnapshot();

function buildSnapshot(): TerminalPoolSnapshot {
  const transport = transports.get(UNROUTED_INTERACTIVE_CELL);
  return {
    phase,
    claimed,
    runtime: transport?.runtime ?? null,
    shell: transport?.shell ?? null,
    fault,
    generation: transportGeneration,
    warm: inheritedWarm,
    spentReason,
  };
}

function publish(): void {
  snapshot = buildSnapshot();
  for (const listener of [...listeners]) listener();
}

function logger() {
  return getRendererLogger().child({ component: "terminal-pool" });
}

// ── reads ───────────────────────────────────────────────────────────────────

/** The current snapshot. Referentially stable until something moves, so it is
 * safe as a `useSyncExternalStore` getter. */
export function terminalPoolSnapshot(): TerminalPoolSnapshot {
  return snapshot;
}

export function subscribeTerminalPool(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The window's runtime, reachable without a render.
 *
 * The perf lanes need it (its `TerminalRenderPerformanceSnapshot` door) and so
 * does anything that must reach the floor's control connection outside React —
 * the Godview's remote-session door is built on exactly that. It is a GETTER,
 * not a field: a caller that cached one across a recovery would be holding a
 * disposed runtime.
 */
export function terminalPoolRuntime(): GhostteaTerminalRuntime | null {
  return snapshot.runtime;
}

/** How many cells this window holds a transport to. One, today, and the number
 * that makes the routed shape checkable rather than merely described. */
export function terminalPoolCellCount(): number {
  return transports.size;
}

// ── demand (TP-L-E′) ────────────────────────────────────────────────────────

/**
 * Bind a view to a session and declare its demand.
 *
 * The returned handle is the ONLY way to release it, and releasing is atomic:
 * the view leaves the fold in one step (`SessionDemandLedger.release`). Nothing
 * about placement crosses this door — a caller names a session id, and which
 * cell answers for it is the pool's business (TP-L-C).
 */
export function bindTerminalSessionView(
  sessionId: string,
  initial: SourceDemand = NO_SOURCE_DEMAND,
): TerminalSessionView {
  const { key, change } = demand.bind(sessionId, initial);
  projectDemand(change);
  let held: ViewDemandKey | null = key;
  return {
    sessionId,
    declare: (next) => {
      if (held === null) return;
      projectDemand(demand.declare(held, next));
    },
    release: () => {
      if (held === null) return;
      const released = held;
      // Cleared BEFORE the ledger call so a re-entrant release (a cleanup that
      // runs twice, a listener that releases from inside a projection) cannot
      // reach the ledger a second time with a key it already dropped.
      held = null;
      projectDemand(demand.release(released));
    },
  };
}

/** The folded demand for one session. */
export function terminalSessionDemand(sessionId: string): SourceDemandMode {
  return demand.modeFor(sessionId);
}

/** Every session with a bound view, folded. The shape TP-S3b's `DeclareDemand`
 * is computed from; today it is read by tests and by nothing on the wire. */
export function terminalPoolDemand(): SessionDemand[] {
  return demand.sessions();
}

/** The sessions a source must actually be advancing right now (TP-R1's subject). */
export function terminalPoolLiveSessions(): string[] {
  return demand.liveSessionIds();
}

/** How many views are bound at any mode. Zero after every consumer unmounts is
 * the leak check the module singleton makes necessary. */
export function terminalPoolViewCount(): number {
  return demand.viewCount();
}

/** One session's demand as it was actually DECLARED to a transport. No cell:
 * TP-L-C's "placement never escapes the transport abstraction" is a property of
 * this type, not a comment above it. */
export interface ProjectedSessionDemand {
  readonly sessionId: string;
  readonly mode: SourceDemandMode;
  /** Which transport incarnation it was declared to — a local transport fact. */
  readonly transportGeneration: number;
}

/** What the pool has declared, per session. Never `none`: a fold that reaches
 * `none` is a declaration WITHDRAWN, which is an absence, not an entry. */
const projected = new Map<string, ProjectedSessionDemand>();

/**
 * What a demand transition does TODAY, stated exactly.
 *
 * It RESOLVES the session to a cell and records the declaration against that
 * cell's transport — the final path's two steps, with the third (writing
 * `DeclareDemand {sessionId, activationId, leaseEpoch, demandSequence, …}` on
 * the control leg) landing at TP-S3b. Demand declared while no transport exists
 * is HELD, not lost, and re-declared when one opens (`reprojectDemand`), because
 * a new activation declares demand afresh (§5.4).
 *
 * What it deliberately does NOT do is take a retain of its own. The only
 * source-silencing this renderer can perform today is the one upstream already
 * performs: the runtime refcounts ONE frame subscription per session across its
 * mounted surfaces and, a grace after the last surface unmounts, drops the
 * subscription and posts `drop-session` to the render worker (`runtime.js:526,
 * 570-596`). The pool owns that grace (`runtime-factory.ts`) and holds no pin —
 * a pool that pinned a session would keep its subscription open past its last
 * view and defeat TP-R1 from inside the module meant to prove it.
 */
function projectDemand(change: SessionDemandChange | null): void {
  if (change === null) return;
  const transport = transports.get(resolveCellForSession(change.sessionId));
  if (transport === undefined || change.mode === "none") {
    projected.delete(change.sessionId);
    return;
  }
  projected.set(change.sessionId, {
    sessionId: change.sessionId,
    mode: change.mode,
    transportGeneration: transport.transportGeneration,
  });
}

/** Re-declare every session's fold against a freshly opened transport. */
function reprojectDemand(): void {
  projected.clear();
  for (const session of demand.sessions()) {
    projectDemand({ sessionId: session.sessionId, mode: session.mode, previous: "none" });
  }
}

/** What the pool has actually declared to a transport, sorted by session id. */
export function terminalPoolProjectedDemand(): ProjectedSessionDemand[] {
  return [...projected.values()].sort((left, right) => (left.sessionId < right.sessionId ? -1 : 1));
}

// ── acquisition ─────────────────────────────────────────────────────────────

/**
 * Force the render backend into existence without a surface or a session.
 *
 * 0.10.1 still exposes no `prepare()`, but it exposes a door that reaches the
 * same work: `performance-start` makes the worker run `ensureRenderer()` — the
 * WebGPU adapter, the device and all six pipelines — before it begins recording,
 * with no surface mounted. The measurement is finished immediately: the point is
 * the device it forced, not the numbers, and a measurement left open would
 * accumulate sample arrays for a deck that has not opened yet.
 */
async function warmRenderBackend(runtime: GhostteaTerminalRuntime): Promise<string> {
  await runtime.startPerformanceMeasurement();
  const measured = await runtime.finishPerformanceMeasurement({ quietMs: 0, timeoutMs: 2_000 });
  return measured.backend;
}

/**
 * Acquire this window's transport: a runtime, a ticket, a bridge, a shell.
 *
 * Never throws — every exit is a published state. `warmRenderer` is the ONE
 * difference between the prewarm and a cold open, and it is the prewarm's whole
 * reason for existing: the device and its pipelines are the longest pole in the
 * first open and cost nothing to have early (GT-D14's "dead weight" clause).
 */
async function acquire(options: {
  warmRenderer: boolean;
  trace?: TransportTrace | undefined;
}): Promise<void> {
  const epoch = acquisitionEpoch;
  const current = (): boolean => epoch === acquisitionEpoch;
  const fieldd = client;
  // Which plane the next await is asking, so the catch reports the one that
  // actually refused. Only the mint speaks to fieldd (GT-5c).
  let plane: TerminalFaultPlane = "transport";
  let runtime: GhostteaTerminalRuntime | null = null;
  try {
    const terminal = getHost().terminal;
    if (terminal === undefined) throw new Error("this host has no terminal bridge");
    if (fieldd === null) throw new Error("the terminal pool has no fieldd client");
    // Built BEFORE the connect that causes the port transfer: the ports wait is
    // one-shot and must be armed first.
    runtime = createTerminalRuntime();
    plane = "fieldd";
    // Parsed, not cast: a mint without a ticket must fail loudly.
    const minted = TerminalConnectTicketResult.parse(
      await fieldd.request("terminal.connectTicket", {}),
    );
    options.trace?.mark("ticket");
    plane = "transport";
    // Main answers the connect with the shell identity it alone can read.
    const attached = await terminal.connect(minted.ticket);
    options.trace?.mark("connected");
    if (options.warmRenderer) {
      // `connect()` memoizes its own promise (`#ready ??=`), so the workspace's
      // later connect joins this one instead of racing it.
      await runtime.connect();
      const backend = await warmRenderBackend(runtime);
      options.trace?.mark("device");
      logger().info("renderer.terminal.prewarmed", "The terminal transport is warm", { backend });
    }
    if (!current()) {
      // Superseded while in flight — a bridge died, a consumer replaced the
      // transport, a test reset the pool. Disposed rather than published:
      // publishing would hand a consumer a runtime whose bridge is already gone.
      runtime.dispose();
      return;
    }
    transportGeneration += 1;
    const transport: CellTransport = {
      cellBootId: UNROUTED_INTERACTIVE_CELL,
      runtime,
      shell: { defaultShell: attached.defaultShell, home: attached.home },
      transportGeneration,
      openedAt: performance.now(),
    };
    transports.set(transport);
    reprojectDemand();
    phase = claimed ? "open" : "warm";
    fault = null;
    spentReason = null;
    publish();
  } catch (cause) {
    if (!current()) {
      runtime?.dispose();
      return;
    }
    // The failed runtime's one-shot ports wait is SPENT and its worker is dead
    // weight, so it is disposed here rather than left for a retry to find. (The
    // pre-pool prewarm leaked exactly this runtime on every failed mint.)
    runtime?.dispose();
    const message = cause instanceof Error ? cause.message : String(cause);
    if (claimed) {
      phase = "failed";
      fault = { plane, message };
      logger().error(
        "renderer.terminal.unavailable",
        plane === "fieldd"
          ? "The terminal pool could not mint its connect ticket; the floor's sessions are unaffected"
          : "The terminal pool could not reach a shell",
        cause,
        { plane },
      );
    } else {
      phase = "spent";
      spentReason = message;
      // Info, not error: nothing is broken for the user — the next open takes
      // the cold path it would have taken anyway.
      logger().info(
        "renderer.terminal.prewarm_failed",
        "The terminal transport could not be warmed; the first open will be cold",
        { reason: message },
      );
    }
    publish();
  }
}

/** Replace the transport: retire the runtime, and acquire another.
 *
 * A runtime holds its ports for life, so a rebuilt bridge needs a NEW one — and
 * the workspace reads its runtime from context at mount, which is what the
 * generation in the snapshot is for. The old runtime is disposed HERE, while
 * nothing is rendering it: consumers see `runtime: null` for the round trip, and
 * the deck draws nothing rather than drawing a corpse.
 *
 * Demand SURVIVES a replacement, deliberately. Demand is declared against a
 * SESSION, and sessions outlive this window's transport by design — the floor
 * holds the PTYs and outlives fieldd. Clearing the ledger here would say the
 * views went away, which is the one thing that did not happen. */
function replaceTransport(): void {
  acquisitionEpoch += 1;
  transports.delete(UNROUTED_INTERACTIVE_CELL)?.runtime.dispose();
  // The declarations went with the transport; the DEMAND did not.
  projected.clear();
  phase = "opening";
  fault = null;
  spentReason = null;
  inheritedWarm = false;
  publish();
  void acquire({ warmRenderer: false });
}

/** The prewarm's custody clause (GT-D14): a warm transport whose bridge died
 * before anyone used it is dead weight holding a disposed worker. Exactly one
 * re-warm may follow. A CLAIMED transport is untouched — it belongs to a
 * consumer, whose ladder is `replaceTransport` above. */
function discardWarm(reason: string): void {
  if (claimed) return;
  if (phase !== "warm" && phase !== "warming") return;
  acquisitionEpoch += 1;
  transports.delete(UNROUTED_INTERACTIVE_CELL)?.runtime.dispose();
  projected.clear();
  pending = null;
  phase = "spent";
  spentReason = reason;
  publish();
}

// ── the door ────────────────────────────────────────────────────────────────

/**
 * Warm the transport at idle. Idempotent, at most once per app life plus one
 * recovery.
 *
 * GT-D14's line, unchanged by the promotion: DEAD WEIGHT warms (a forked bridge,
 * a dialled socket, a render worker, a GPU device and its pipelines — none of it
 * runs anyone's code); MEANINGFUL does not (a PTY, a login shell, a session is
 * still born on ⌘G and never before). This creates a runtime and a connection
 * and stops.
 */
export function prewarmTerminalPool(fieldd: FielddClient, trace?: TransportTrace): void {
  if (phase !== "cold" || claimed) return;
  client = fieldd;
  ensureBridgeSubscription();
  phase = "warming";
  // Deferred to a microtask so the `warming` phase above is what an early exit
  // inside `acquire` overwrites, rather than the other way round: an async
  // function body runs synchronously up to its first await, and the early exits
  // there have none.
  const mine: Promise<void> = Promise.resolve()
    .then(() => acquire({ warmRenderer: true, trace }))
    // `acquire` publishes every outcome and is not supposed to reject — but a
    // consumer JOINS this promise, and a join that inherits a rejection would
    // leave that consumer waiting on a `.then` that never runs. Settled, always.
    .catch(() => undefined)
    .finally(() => {
      // Only if this warm still OWNS the slot. A bridge that flaps discards a
      // warm mid-flight and the one re-warm starts another immediately, so a
      // blind `pending = null` here would clear the NEW warm's slot when the
      // OLD one finally landed — and a claim arriving after that would see
      // nothing in flight and arm a second ports wait against the live one.
      // That is the one-runtime law failing by bookkeeping rather than by
      // design, which is the kind that survives review.
      if (pending === mine) pending = null;
    });
  pending = mine;
  publish();
}

/**
 * A consumer needs the pool. Claims it, and opens if it is not already open.
 *
 * THE ONE-RUNTIME LAW, both halves, and now structural rather than agreed:
 *
 *   - a prewarm IN FLIGHT holds the only armed ports wait, so this JOINS it
 *     rather than building a second runtime. Main posts the two MessagePorts
 *     exactly once per attach and two waiters would both resolve with the same
 *     pair, leaving whichever the workspace holds permanently at "starting" — a
 *     dead deck, not a slow one;
 *   - a prewarm merely SCHEDULED is invisible to any check, so the claim below
 *     is SYNCHRONOUS: from here on `prewarmTerminalPool` is a no-op and an idle
 *     callback that fires late cannot wake up behind a live consumer.
 *
 * Idempotent by the same flag: a consumer that mounts twice, or two consumers,
 * get the one pool.
 */
export function openTerminalPool(fieldd: FielddClient, trace?: TransportTrace): void {
  client = fieldd;
  ensureBridgeSubscription();
  if (claimed) return;
  claimed = true;
  const inFlight = pending;
  if (inFlight !== null) {
    phase = "opening";
    publish();
    void inFlight.then(() => adopt(trace));
    return;
  }
  adopt(trace);
}

/**
 * Take the warm transport if there is one, else acquire one.
 *
 * The test is the TRANSPORT, not the phase: a warm that landed after the claim
 * publishes itself as `open` already (the acquisition reads `claimed` when it
 * finishes), and a claim that then looked only at `phase === "warm"` would
 * acquire a second runtime on top of a perfectly good one — the one-runtime law
 * broken by the very function that exists to keep it.
 *
 * No transport means the warm FAILED while this consumer waited for it, and the
 * answer is one automatic cold attempt: a prewarm is an optimization, and its
 * failure must not doom the open that was waiting behind it. If that attempt
 * fails too, the fault stands and the human's retry is the next move.
 */
function adopt(trace?: TransportTrace): void {
  if (!claimed) return; // a reset happened while the warm was landing
  if (transports.size > 0) {
    // Everything is already done: ticket redeemed, bridge forked, ports posted,
    // shell answered, device built.
    phase = "open";
    inheritedWarm = true;
    fault = null;
    publish();
    return;
  }
  phase = "opening";
  inheritedWarm = false;
  fault = null;
  publish();
  void acquire({ warmRenderer: false, trace });
}

/**
 * The human's way back from a fault (GT-2b).
 *
 * A failed acquisition leaves no runtime — its one-shot ports wait was spent and
 * it was disposed — so this is a fresh acquisition, which is also what a
 * `bridge-up` performs. Available when no bridge-up is coming: a bridge that
 * never built, a ladder that spent itself.
 */
export function retryTerminalPool(): void {
  if (!claimed) return;
  replaceTransport();
}

/**
 * The recovery ladder, subscribed ONCE.
 *
 * It was two halves that never met: the overlay handled the prewarm's custody
 * clause (discard on death, one lazy re-warm) and the deck handled its own
 * replacement, each with its own view of what "a transition" meant. One
 * subscription, one guard, one decision.
 */
function ensureBridgeSubscription(): void {
  if (unsubscribeBridge !== null) return;
  const terminal = getHost().terminal;
  if (terminal === undefined) return;
  unsubscribeBridge = terminal.onStatus((status) => {
    // GT-2c: main publishes on EVERY set, including unchanged — its own contract
    // test pins that — so only a TRANSITION may act. Treating a republish as
    // news built a feedback loop: each event minted a runtime and a generation,
    // each generation re-asked, and the deck remounted itself to death.
    if (status.state === lastBridgeState) return;
    lastBridgeState = status.state;
    if (status.state === "bridge-down") {
      if (!claimed) {
        discardWarm("the bridge died before first use");
        return;
      }
      // The honest moment of death. Nothing is minted here: a rebuild is coming
      // and `bridge-up` is the only event this page can act on.
      phase = "failed";
      fault = { plane: "transport", message: "the terminal bridge died — rebuilding" };
      publish();
      return;
    }
    if (status.state !== "bridge-up" && status.state !== "ticket-expired") return;
    if (!claimed) {
      rewarmOnce();
      return;
    }
    // `ticket-expired` means main's credentials rotted with a field-native
    // reboot and only a fresh redeem will do, which is what this performs.
    replaceTransport();
  });
}

/** GT-D14: re-warm lazily, never in a loop. */
function rewarmOnce(): void {
  if (phase !== "spent" || rewarmed || claimed || client === null) return;
  rewarmed = true;
  phase = "cold";
  prewarmTerminalPool(client);
}

/**
 * Tear the pool down.
 *
 * Honest about its callers: TODAY this is the test seam and nothing else. The
 * pool is per-window, and a window going away takes its renderer — worker,
 * device and all — with it, so there is no production teardown to hang this on
 * and wiring one into the close handshake would add a failure mode to a path
 * that currently has none. It exists because a module singleton is otherwise
 * untestable: this is the only honest way to get a second pool in one process.
 *
 * What it does is what a real teardown would: the runtime is disposed, the
 * ledger is cleared (its views are gone with the window), the bridge
 * subscription is dropped, and anything in flight is superseded so it disposes
 * its own runtime rather than publishing into a pool nobody holds.
 */
export function disposeTerminalPool(): void {
  acquisitionEpoch += 1;
  for (const transport of transports.clear()) transport.runtime.dispose();
  demand.clear();
  projected.clear();
  unsubscribeBridge?.();
  unsubscribeBridge = null;
  lastBridgeState = null;
  pending = null;
  client = null;
  phase = "cold";
  claimed = false;
  fault = null;
  spentReason = null;
  inheritedWarm = false;
  rewarmed = false;
  transportGeneration = 0;
  publish();
}
