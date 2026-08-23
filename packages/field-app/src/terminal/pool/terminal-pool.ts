import type { CreateSessionOptions, SessionSummary } from "@vibecook/ghosttea-protocol";
import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";
import {
  type ProductSessionRosterItem,
  type TerminalCreateParams,
  type TerminalOpenTicket,
  TerminalRosterResult,
  type WindowTerminalBootstrap,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { getHost } from "../../host";
import { getRendererLogger } from "../../logging";
import { registerTerminalPerfSource } from "../../perf/terminal-perf-source";
import { createRoutedTerminalHost, type RoutedTerminalHostBinding } from "../routed/host";
import {
  type CellBootId,
  type CellTransport,
  CellTransportTable,
  resolveCellForSession,
  type TerminalShellPolicy,
  UNNAMED_CELL,
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
import { type ReadTicket, readCreateTicket, readOpenTicket } from "./open-ticket";
import { createTerminalRuntime } from "./runtime-factory";
import {
  type SessionAvailability,
  type SessionGrants,
  SessionPlacementLedger,
} from "./session-grants";

// THE WINDOW'S TERMINAL SESSION POOL (TP-S0b; opened BY SESSION at TP-S1).
//
// A module singleton, deliberately — the same reason the frame-stats overlay is
// a module and not a component (`mount.tsx`): it must outlive every remount the
// React tree does. It owns five things:
//
//   1. THE RUNTIME. One per window (TP-D5, §9.1).
//   2. THE TRANSPORT TABLE (TP-L-C). `cellBootId -> CellTransport`.
//   3. THE PLACEMENT LEDGER. Per session: its route, and its two grants.
//   4. THE DEMAND LEDGER (TP-L-E'). Views declare `none | live` per session and
//      release ATOMICALLY on unmount.
//   5. THE RECOVERY LADDER, behind one bridge subscription and one guard.
//
// TP-S1 — TWO LIFETIMES, NOT ONE. The runtime and the transport used to be
// acquired together, because the door was `terminal.connectTicket`: a mint with
// no session, answering "the interactive cell by definition"
// (`fieldd/src/terminal-service.ts:321-324`). That door is RETIRED (TP-D3). A
// transport is now opened FOR A SESSION — `terminal.openTicket(sessionId)` to
// rejoin one, `terminal.create(class)` to make one — and every ticket answers a
// `RouteBinding` whose `cellBootId` is the transport table's real key.
//
// The consequence is a split the routed model wanted anyway: the RUNTIME (with
// its worker and GPU device) warms at idle and belongs to the window; a
// TRANSPORT belongs to a cell and cannot exist before a session does. So the
// prewarm now stops at the device, and a window with nothing to show holds no
// connection at all — the `dormant` phase below, which is a resting state and
// not a failure.
//
// WHO MAY SPAWN A SHELL is unchanged, and it is NOT the pool (GT-D14's line
// between dead weight and meaning). `createTerminalSession` exists because a
// consumer asked for a session, and the consumer that asks is the one holding
// the consent gate.

/** Which plane refused, and therefore what is actually true about the shells.
 *
 * `transport` is the path to the floor: no bridge on this host, a connect main
 * could not make, a bridge that died. `fieldd` is the CONTROL plane alone — the
 * mint. field-native holds the PTYs and outlives fieldd by design, so a fieldd
 * that will not answer says NOTHING about the shells: they are running, and this
 * window is merely not allowed through the door yet (GT-5c). */
export type TerminalFaultPlane = "transport" | "fieldd";

export interface TerminalFault {
  readonly plane: TerminalFaultPlane;
  /** The failing plane's own words, carried whole. */
  readonly message: string;
}

/**
 * Where the pool is. Two axes, deliberately not collapsed into one word: this is
 * the TRANSPORT's phase, and `claimed` is OWNERSHIP.
 */
export type TerminalPoolPhase =
  /** Nothing has been asked for. No runtime, no worker, no socket. */
  | "cold"
  /** The runtime is being built and its render backend forced (the prewarm). */
  | "warming"
  /** A runtime exists, unclaimed. NO transport — there is no session yet. */
  | "warm"
  /** The prewarm failed or its bridge died before use. One re-warm. */
  | "spent"
  /** Claimed, and a transport is being opened for a session. */
  | "opening"
  /** Claimed, runtime ready, and NO transport because nothing has asked for
   * one. A resting state: a window with nothing to show holds no connection. */
  | "dormant"
  /** Claimed, and a transport is live. */
  | "open"
  /** Claimed, and something refused. `fault` names the plane. */
  | "failed";

/** What the roster read knows. `unobserved` is fieldd's own honest refusal
 * before its first observation of the floor; `unavailable` is this window not
 * being able to ask at all. Neither is an empty floor, and an empty list is only
 * trustworthy under `observed`. */
export type TerminalRosterState = "unread" | "observed" | "unobserved" | "unavailable";

export interface TerminalPoolSnapshot {
  readonly phase: TerminalPoolPhase;
  /** A consumer has taken the pool; nothing may prewarm behind it. */
  readonly claimed: boolean;
  /** The window's ONE runtime once it exists, else null. */
  readonly runtime: GhostteaTerminalRuntime | null;
  /** Main's answer to the connect (GT-D10). Null until a transport is open. */
  readonly shell: TerminalShellPolicy | null;
  readonly fault: TerminalFault | null;
  /** Bumped whenever the RUNTIME is replaced. A consumer that reads its runtime
   * once at mount — the ghosttea workspace does — keys its subtree on this. */
  readonly generation: number;
  /** The runtime was inherited from a prewarm rather than built on demand. */
  readonly warm: boolean;
  /** Why the prewarm is spent, when it is. */
  readonly spentReason: string | null;
  /** Whether the floor minted the v2 half of a ticket. False is a keyless floor
   * answering the legacy trio — a supported answer, honestly recorded, never a
   * fabricated route (`open-ticket.ts`). */
  readonly grantsLanded: boolean;
  /** The UI's roster projection (TP-D4): ids, class, health, provenance and NO
   * placement — the contract refuses a placement key at parse. */
  readonly roster: readonly ProductSessionRosterItem[];
  readonly rosterState: TerminalRosterState;
}

/** The stations the pool can stamp on a cold-open trace. Structural on purpose:
 * `ColdOpenTrace` satisfies it, and the pool does not import Godview.
 *
 * TP-S1m added the SEND edges (`claim`, `rosterAsk`, `mintAsk`). Without them a
 * station only says when an answer arrived, and an answer's arrival cannot tell
 * a slow daemon from a request that was sent late — which is exactly the
 * mistake the ticket's "57% of the cold open" was. */
export interface TransportTrace {
  mark(
    phase: "claim" | "rosterAsk" | "roster" | "mintAsk" | "ticket" | "connected" | "device",
  ): void;
}

/** One view's binding to one session (TP-L-C: by id, never by placement). */
export interface TerminalSessionView {
  readonly sessionId: string;
  /** Re-declare this view's demand. Idempotent. */
  declare(demand: SourceDemand): void;
  /** Release atomically. Safe to call twice — React cleanups can run late. */
  release(): void;
}

/** What `createTerminalSession` answers: the session fieldd made, and whether
 * this window can actually show it. */
export interface CreatedTerminalSession {
  readonly sessionId: string;
  readonly availability: SessionAvailability;
}

// ── the singleton's state ───────────────────────────────────────────────────

const placements = new SessionPlacementLedger();
const demand = new SessionDemandLedger();
const listeners = new Set<() => void>();
const projected = new Map<string, ProjectedSessionDemand>();

let phase: TerminalPoolPhase = "cold";
let claimed = false;
let fault: TerminalFault | null = null;
let spentReason: string | null = null;
let inheritedWarm = false;
let runtimeGeneration = 0;
let transportGeneration = 0;
let grantsLanded = false;
let roster: readonly ProductSessionRosterItem[] = [];
let rosterState: TerminalRosterState = "unread";
/** Main's one-per-renderer-generation shell policy (the transport selector
 * collapsed to the routed literal at TP-S3e). Browser harnesses omit it and
 * simply have no shell policy — and no fieldd either. */
let terminalBootstrap: WindowTerminalBootstrap | null = null;
/** THE window's runtime. Held apart from any transport since TP-S1: a runtime
 * outlives every transport under it, and a bridge rebuild replaces both only
 * because the runtime's ports wait is one-shot. */
let runtime: GhostteaTerminalRuntime | null = null;
/** Exists iff `runtime` is G23-routed; owns the input ledger and lifecycle
 * listener and is disposed with that exact runtime. */
let routedHost: RoutedTerminalHostBinding | null = null;
/** Cells for which G23 has actually minted a ticket in this runtime. */
const routedCells = new Set<CellBootId>();
/** Birth summaries outrun observed inventory by design; retain each exact
 * service answer for the session's product lifetime. Termination/disposal are
 * the inverses, so repeat readers never fall back to an observation race. */
const createdSummaries = new Map<string, SessionSummary>();
/** The client the pool mints with, remembered from the first ask so the ladder
 * and the retry do not need one handed to them at the moment of a bridge event
 * — which is not a moment any React tree is guaranteed to exist. */
let client: FielddClient | null = null;
/** A prewarm in flight, so a claim joins it rather than arming a second ports
 * wait. THE one-runtime law's first half. */
let pending: Promise<void> | null = null;
/** Bumped by anything that INVALIDATES work in flight. A late answer to a
 * question nobody is asking any more is dropped, not applied. */
let acquisitionEpoch = 0;
/** The ids a consumer last asked the pool to open on. Remembered because a
 * legacy floor mints no grants and a pool with no bound views has no demand, so
 * without it a bridge rebuild on such a floor would have nothing to rejoin and
 * would rest dormant while the deck sat there holding panes. */
let rejoinHint: readonly string[] = [];
/** The cold-open trace belongs to the claim, while the routed workspace may
 * not ask for its first birth until a later initialization turn. */
let workspaceBirthTrace: TransportTrace | undefined;

let snapshot: TerminalPoolSnapshot = buildSnapshot();

function buildSnapshot(): TerminalPoolSnapshot {
  const routedShell =
    (phase === "dormant" || phase === "open") && terminalBootstrap !== null
      ? { defaultShell: terminalBootstrap.defaultShell, home: terminalBootstrap.home }
      : null;
  return {
    phase,
    claimed,
    runtime,
    shell: routedShell,
    fault,
    generation: runtimeGeneration,
    warm: inheritedWarm,
    spentReason,
    grantsLanded,
    roster,
    rosterState,
  };
}

/** Install main's bootstrap decision before any workspace can prewarm/claim.
 * The selector cannot move under a live runtime: doing so would reinterpret one
 * worker as owning a different transport. */
/** Whether main handed this window a terminal bootstrap — the post-S3e
 * "does this host offer terminals" signal (a browser harness never does). */
export function terminalPoolConfigured(): boolean {
  return terminalBootstrap !== null;
}

export function configureTerminalPool(bootstrap: WindowTerminalBootstrap | undefined): void {
  terminalBootstrap = bootstrap ?? null;
  publish();
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
 * does anything that must reach the floor's control connection outside React. A
 * GETTER, not a field: a caller that cached one across a recovery would be
 * holding a disposed runtime.
 */
export function terminalPoolRuntime(): GhostteaTerminalRuntime | null {
  return runtime;
}

/** How many cells this window holds a transport to. */
export function terminalPoolCellCount(): number {
  return routedCells.size;
}

/**
 * Can this window show that session, and if not, what does it say?
 *
 * The ONLY placement-derived answer that crosses the pool's door, and it
 * deliberately carries no cell: a consumer learns "not from here, and here is
 * why", never "it is in cell 7" (TP-L-C).
 */
export function terminalSessionAvailability(sessionId: string): SessionAvailability {
  // G23 is multi-cell: no first-ticket pin exists (the bridge's single-cell
  // rule retired with it at TP-S3e). Per-activation availability is reported
  // by the runtime's routed state.
  void sessionId;
  return { ready: true };
}

/** The grants a session's ticket left behind, if any. In routed mode G23 uses
 * them for the live legs; in bridge mode they remain forward-compatible state. */
export function terminalSessionGrants(sessionId: string): SessionGrants | undefined {
  return placements.get(sessionId)?.grants;
}

/** Sessions whose grants the pool is holding — the "held, never faked" read. */
export function terminalPoolGrantedSessions(): string[] {
  return placements.withGrants();
}

// ── demand (TP-L-E') ────────────────────────────────────────────────────────

/**
 * Bind a view to a session and declare its demand.
 *
 * The returned handle is the ONLY way to release it, and releasing is atomic.
 * Nothing about placement crosses this door — a caller names a session id, and
 * which cell answers for it is the pool's business (TP-L-C).
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

/** Every session with a bound view, folded. */
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
 * TP-L-C is a property of this type, not a comment above it. */
export interface ProjectedSessionDemand {
  readonly sessionId: string;
  readonly mode: SourceDemandMode;
  /** Which transport incarnation it was declared to — a local transport fact. */
  readonly transportGeneration: number;
}

/**
 * What a demand transition does TODAY, stated exactly.
 *
 * It RESOLVES the session to a cell and records the declaration against that
 * cell's transport — the final path's two steps, with the third (writing
 * `DeclareDemand` on the control leg) landing at TP-S3b. Demand declared while
 * no transport exists is HELD, not lost, and re-declared when one opens, because
 * a new activation declares demand afresh (§5.4).
 *
 * What it deliberately does NOT do is take a retain of its own. The only
 * source-silencing this renderer can perform today is upstream's: the runtime
 * refcounts ONE frame subscription per session across its mounted surfaces and,
 * a grace after the last surface unmounts, drops it and posts `drop-session` to
 * the render worker (`runtime.js:526, 570-596`). The pool owns that grace
 * (`runtime-factory.ts`) and holds no pin — a pool that pinned would keep a
 * subscription open past its last view and defeat TP-R1 from inside the module
 * meant to prove it.
 */
function projectDemand(change: SessionDemandChange | null): void {
  if (change === null) return;
  if (runtime === null || change.mode === "none") {
    projected.delete(change.sessionId);
    return;
  }
  // G23 performs the real DeclareDemand fold from its mounted/visible views.
  // This ledger remains the product pool's observation of consumer demand;
  // its generation names the routed runtime that owns that declaration.
  projected.set(change.sessionId, {
    sessionId: change.sessionId,
    mode: change.mode,
    transportGeneration: runtimeGeneration,
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

// ── the runtime's own lifetime ──────────────────────────────────────────────

/**
 * Force the render backend into existence without a surface or a session.
 *
 * 0.10.1 exposes no `prepare()`, but it exposes a door that reaches the same
 * work: `performance-start` makes the worker run `ensureRenderer()` — the WebGPU
 * adapter, the device and all six pipelines — before it begins recording, with
 * no surface mounted. The measurement is finished immediately: the point is the
 * device it forced, not the numbers, and a measurement left open would
 * accumulate sample arrays for a deck that has not opened yet.
 */
export const TERMINAL_PREWARM_TIMEOUT_MS = 5_000;

async function warmRenderBackend(target: GhostteaTerminalRuntime): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await target.startPerformanceMeasurement();
        const measured = await target.finishPerformanceMeasurement({
          quietMs: 0,
          timeoutMs: 2_000,
        });
        return measured.backend;
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("the terminal render-worker prewarm timed out")),
          TERMINAL_PREWARM_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Undo for the perf registration below, held so a replaced runtime unpublishes
 * itself rather than leaving a disposed one for the sampler to measure. */
let unregisterPerfSource: (() => void) | null = null;

/** Build the window's runtime if it has none. Never two: the ports arrive once
 * per attach, and two waiters would both resolve with the same pair.
 *
 * TP-S0a's perf source is published HERE rather than from the deck, which is
 * where S0a landed it and where its own module note said it should not stay
 * ("the owner publishes... when TP-S0b moves runtime ownership to a
 * window-level pool this registration moves with the OWNER"). It matters more
 * than tidiness: the deck unmounts while the runtime lives — that is the whole
 * point of the promotion — so a registration owned by the deck would unpublish
 * a perfectly live runtime the moment the overlay's gate flipped, and a sampler
 * running at that instant would lose its source for reasons that have nothing
 * to do with the terminal. Registering where the runtime is CREATED and undoing
 * where it is DISPOSED makes the registration's lifetime the runtime's. */
function ensureRuntime(): GhostteaTerminalRuntime {
  if (runtime !== null) return runtime;
  const fieldd = client;
  if (fieldd === null) throw new Error("the routed terminal runtime has no fieldd client");
  routedHost = createRoutedTerminalHost({
    fieldd,
    createSession: createRoutedWorkspaceSession,
    onTicket: recordRoutedTicket,
    onTerminated: forgetRoutedSession,
  });
  runtime = createTerminalRuntime({ transport: "routed", host: routedHost.host });
  routedHost.bind(runtime);
  runtimeGeneration += 1;
  unregisterPerfSource = registerTerminalPerfSource(runtime);
  return runtime;
}

/** Ghosttea owns the empty-workspace birth decision. Route that optional G23
 * host verb through the same audited product create seam as splits and
 * rehydration. In particular, do not pre-create and then depend on
 * `terminal.sessions`: fieldd intentionally filters that read through the
 * asynchronously observed inventory, while `terminal.create` already returns
 * the authoritative summary for the session it just made. */
async function createRoutedWorkspaceSession(
  options: CreateSessionOptions,
): Promise<SessionSummary> {
  const created = await createTerminalSession(
    {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      workloadClass: "interactive",
    },
    workspaceBirthTrace,
  );
  const summary = await terminalSessionSummary(created.sessionId, 1);
  if (summary === null) throw new Error("the floor did not report the session it just created");
  workspaceBirthTrace = undefined;
  return summary;
}

/** Dispose the window's runtime, if any. Each owns a render worker and the
 * ports, and a leaked one is a leaked thread. */
function disposeRuntime(): void {
  unregisterPerfSource?.();
  unregisterPerfSource = null;
  routedHost?.dispose();
  routedHost = null;
  runtime?.dispose();
  runtime = null;
  routedCells.clear();
}

/** G23's ticket callback: retain only transport-private route/grant state. */
function recordRoutedTicket(sessionId: string, ticket: TerminalOpenTicket): void {
  placements.record({
    sessionId,
    route: ticket.route,
    cellBootId: ticket.route.cellBootId as CellBootId,
    grants: {
      transportGrant: ticket.transportGrant,
      attachGrant: ticket.attachGrant,
      attachExpiresAt: ticket.attachGrant.claims.expiresAt,
      grantGeneration: ticket.attachGrant.claims.grantGeneration,
    },
    resolvedAt: Date.now(),
  });
  routedCells.add(ticket.route.cellBootId as CellBootId);
  grantsLanded = true;
  publish();
}

/** Exact inverse of the routed session-private records after a confirmed kill. */
function forgetRoutedSession(sessionId: string): void {
  createdSummaries.delete(sessionId);
  const cell = placements.cellFor(sessionId);
  placements.forgetSession(sessionId);
  if (
    cell !== undefined &&
    !placements.sessionIds().some((candidate) => placements.cellFor(candidate) === cell)
  ) {
    routedCells.delete(cell);
  }
  publish();
}

// ── the routed transport ────────────────────────────────────────────────────

/**
 * A failure of the TRANSPORT plane rather than of one session.
 *
 * The distinction is load-bearing in `adopt`: a mint refused for one session is
 * the common, expected case (a saved pane the floor no longer has — `openTicket`
 * gates on the observed inventory by design), and the answer is to try the next
 * candidate. A bridge that will not connect is not about any session, and
 * trying the next candidate would just fail the same way N times while hiding
 * the real reason behind the last one.
 */
class TransportPlaneError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "TransportPlaneError";
  }
}

function transportFault(plane: TerminalFaultPlane, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  phase = "failed";
  fault = { plane, message };
  logger().error(
    "renderer.terminal.unavailable",
    plane === "fieldd"
      ? "The terminal pool could not mint its ticket; the floor's sessions are unaffected"
      : "The terminal pool could not reach a shell",
    cause,
    { plane },
  );
  publish();
}

// (landTransport + openTransportForSession retired at TP-S3e with the bridge
// and its single-cell pin: G23 mints per session and dials per cell.)

// ── acquisition ─────────────────────────────────────────────────────────────

/**
 * Warm the RUNTIME at idle. Idempotent, at most once per app life plus one
 * recovery.
 *
 * GT-D14's line, sharpened by TP-S1: DEAD WEIGHT warms — a render worker, a GPU
 * device and its pipelines, none of which runs anyone's code — and MEANINGFUL
 * does not. A TRANSPORT is no longer on the dead-weight side of that line: it is
 * opened FOR a session, and at idle there is no session. (A transport-only
 * prewarm against a session that already exists is §17's mark 16 — default OFF,
 * and not implemented here.) So this builds a runtime, forces a device, and
 * stops: no ticket, no bridge, no socket, no shell, no PTY.
 */
export function prewarmTerminalPool(fieldd: FielddClient, trace?: TransportTrace): void {
  if (phase !== "cold" || claimed) return;
  client = fieldd;
  phase = "warming";
  const mine: Promise<void> = Promise.resolve()
    .then(async () => {
      const epoch = acquisitionEpoch;
      try {
        const backend = await warmRenderBackend(ensureRuntime());
        trace?.mark("device");
        if (epoch !== acquisitionEpoch) return;
        phase = "warm";
        logger().info("renderer.terminal.prewarmed", "The terminal runtime is warm", { backend });
        publish();
      } catch (cause) {
        if (epoch !== acquisitionEpoch) return;
        disposeRuntime();
        phase = "spent";
        spentReason = cause instanceof Error ? cause.message : String(cause);
        // Info, not error: nothing is broken for the user — the next open takes
        // the cold path it would have taken anyway.
        logger().info(
          "renderer.terminal.prewarm_failed",
          "The terminal runtime could not be warmed; the first open will be cold",
          { reason: spentReason },
        );
        publish();
      }
    })
    // The body publishes every outcome and is not supposed to reject — but a
    // consumer JOINS this promise, and a join that inherited a rejection would
    // leave that consumer waiting on a `.then` that never runs. Settled, always.
    .catch(() => undefined)
    .finally(() => {
      // Only if this warm still OWNS the slot. A bridge that flaps discards a
      // warm mid-flight and the one re-warm starts another immediately, so a
      // blind `pending = null` here would clear the NEW warm's slot when the OLD
      // one finally landed — and a claim arriving after that would see nothing
      // in flight and arm a second ports wait against the live one.
      if (pending === mine) pending = null;
    });
  pending = mine;
  publish();
}

/**
 * A consumer needs the pool. Claims it, and opens a transport if it can.
 *
 * THE ONE-RUNTIME LAW, both halves, structural rather than agreed: a prewarm IN
 * FLIGHT holds the only armed ports wait so this JOINS it, and a prewarm merely
 * SCHEDULED is invisible to any check so the claim is SYNCHRONOUS — from here on
 * `prewarmTerminalPool` is a no-op and a late idle callback cannot wake up behind
 * a live consumer.
 *
 * `sessionIds` are the sessions this consumer would like to rejoin, best first
 * (the deck's saved panes). The pool opens on the FIRST that answers a ticket; a
 * session the floor no longer has simply fails its mint and the next is tried.
 * None of them answering is not a fault — it is `dormant`, and the consumer's
 * next move is `createTerminalSession`.
 */
export function openTerminalPool(
  fieldd: FielddClient,
  options: { sessionIds?: readonly string[]; trace?: TransportTrace } = {},
): void {
  client = fieldd;
  options.trace?.mark("claim");
  if (options.trace !== undefined) workspaceBirthTrace = options.trace;
  if (options.sessionIds !== undefined && options.sessionIds.length > 0) {
    rejoinHint = options.sessionIds;
  }
  if (claimed) return;
  claimed = true;
  const inFlight = pending;
  if (inFlight !== null) {
    phase = "opening";
    publish();
    void inFlight.then(() => adopt(options));
    return;
  }
  void adopt(options);
}

/** Take the warm runtime if there is one, then open a transport for a session. */
async function adopt(options: {
  sessionIds?: readonly string[];
  trace?: TransportTrace;
}): Promise<void> {
  if (!claimed) return; // a reset happened while the warm was landing
  inheritedWarm = runtime !== null;
  fault = null;
  phase = "opening";
  publish();
  const epoch = acquisitionEpoch;
  try {
    ensureRuntime();
    if (epoch !== acquisitionEpoch) return;
    // Views can declare demand BEFORE a runtime exists (§5.4 — a new
    // activation declares afresh); the fresh runtime is what those
    // declarations are projected against. The bridge path did this inside
    // landTransport; the routed runtime does it at birth.
    reprojectDemand();
    // A routed runtime has no sessionless connection to open. Existing pane
    // ids make the workspace mountable; each mounted activation mints and
    // dials its own cell through G23. With no ids, rest dormant until roster
    // or an explicit birth gives the workspace something meaningful to show.
    phase = (options.sessionIds?.length ?? 0) > 0 ? "open" : "dormant";
    fault = null;
    spentReason = null;
    publish();
  } catch (cause) {
    if (epoch !== acquisitionEpoch) return;
    transportFault("transport", cause instanceof TransportPlaneError ? cause.cause : cause);
  }
}

/**
 * Make a session through fieldd, and open this window's transport on it if it
 * has none.
 *
 * `terminal.create(class)` is the product-plane birth (spec §5.1): audited,
 * class-placed and capped by the floor. Its answer carries the session AND its
 * ticket, which is why a create can open a transport with no second round trip —
 * `openTicket` gates on the observed inventory and create does not have that
 * problem, having just made the session (`contracts/src/terminal.ts:135-142`).
 *
 * The pool does not decide to spawn a shell. A consumer asks; the consumer that
 * asks is the one holding the consent gate.
 */
export async function createTerminalSession(
  params: TerminalCreateParams = {},
  trace?: TransportTrace,
): Promise<CreatedTerminalSession> {
  const fieldd = client;
  if (fieldd === null) throw new Error("the terminal pool has no fieldd client");
  let raw: unknown;
  try {
    // TP-S1m: the create path is a MINT too (GT-1 — create answers with a
    // ticket), and it was the one the trace could not see. A first run has
    // nothing to rejoin, so it reached the floor through here and published a
    // cold open with no `ticket` station at all.
    trace?.mark("mintAsk");
    raw = await fieldd.request("terminal.create", params);
  } catch (cause) {
    // The CONTROL plane refused. field-native holds the PTYs and outlives
    // fieldd, so this says nothing about the shells that are already running —
    // which is exactly what the face's second line has to get right (GT-5c).
    transportFault("fieldd", cause);
    throw cause;
  }
  const read = readCreateTicket(raw, Date.now());
  trace?.mark("ticket");
  placements.record(read.placement);
  grantsLanded = true;
  rejoinHint = [...new Set([...rejoinHint, read.sessionId])];
  const target = ensureRuntime();
  routedHost?.primeTicket(read.sessionId, read.routedTicket);
  createdSummaries.set(read.sessionId, read.session);
  target.registerSession(read.session);
  phase = "open";
  fault = null;
  spentReason = null;
  publish();
  return { sessionId: read.sessionId, availability: { ready: true } };
}

/**
 * Open a DORMANT pool's transport on one of these sessions.
 *
 * The lighter half of `retryTerminalPool`: a dormant pool has no transport to
 * replace and a perfectly good runtime, so re-learning about sessions must not
 * cost a worker and a GPU device. A no-op in every other phase — an open pool is
 * already pinned, and a failed one wants the human's retry.
 */
export async function openDormantTransport(
  sessionIds: readonly string[],
  trace?: TransportTrace,
): Promise<boolean> {
  if (!claimed || phase !== "dormant") return false;
  if (sessionIds.length > 0) rejoinHint = [...new Set([...rejoinHint, ...sessionIds])];
  phase = "opening";
  publish();
  if (sessionIds.length === 0) {
    phase = "dormant";
    publish();
    return false;
  }
  // G23 opens per activation at mount; this transition only releases the
  // workspace gate. It mints no throw-away grant and dials no idle socket.
  phase = "open";
  fault = null;
  publish();
  return true;
}

/**
 * Resolve a session id to the ghosttea summary a PANE is mounted from.
 *
 * The join between the two halves of a birth: fieldd makes the session (audited,
 * class-placed, capped) and answers an id, and the workspace mounts a
 * `SessionSummary`. The floor is the one authority both read, so this asks the
 * runtime's own `listSessions` rather than fabricating a summary — a fabricated
 * one would carry this renderer's guesses about executable, cwd and geometry
 * into a pane and into the persisted layout.
 *
 * Retried a few times because the two answers race: `terminal.create` returns
 * when the FLOOR has the session, and the runtime's control connection learns of
 * it independently. This is the same "observed inventory lags the spawn" gap
 * that made `create` mint its own ticket (`contracts/src/terminal.ts:135-142`),
 * seen from the renderer's side.
 */
export async function terminalSessionSummary(
  sessionId: string,
  attempts = 5,
): Promise<SessionSummary | null> {
  const target = runtime;
  if (target === null) return null;
  const born = createdSummaries.get(sessionId);
  if (born !== undefined) return born;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let known: SessionSummary[];
    try {
      known = await target.listSessions();
    } catch (cause) {
      if (attempt + 1 >= attempts) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 20));
      continue;
    }
    const found = known.find((session) => session.id === sessionId);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

/**
 * fieldd's honest "I have not looked at the floor yet" (`UNAVAILABLE
 * {service:"terminal", state:"unobserved"}`), recognised STRUCTURALLY.
 *
 * An unarmed inventory is not an empty one, and matching on message text is how
 * that distinction gets lost the first time someone rewords a string — the
 * refusal exists precisely because answering `[]` once made a restore offer to
 * forget a layout whose sessions were alive. `terminal.roster` refuses through
 * the same `requireObserved()` as `terminal.list`, so this is the same test the
 * rest of the tree already applies to that answer.
 */
function unobservedRefusal(cause: unknown): boolean {
  if (!(cause instanceof Error) || !("kind" in cause) || cause.kind !== "UNAVAILABLE") return false;
  const details = (cause as { details?: unknown }).details;
  return (
    details !== null &&
    typeof details === "object" &&
    "state" in details &&
    (details as { state: unknown }).state === "unobserved"
  );
}

/**
 * Read the UI's roster projection (spec §5.3, TP-D4).
 *
 * `terminal.roster` answers `ProductSessionRosterItem`s — ids, class, health,
 * provenance and NO placement, refused at PARSE by the contract. The renderer
 * never folds this itself: the fold is fieldd's (EL5, one fold), and a renderer
 * that projected `terminal.list` down to this shape would be handling the
 * placement it is not allowed to see — the law this slice exists to establish,
 * and TP-L-F's "no interim roster" in as many words.
 *
 * Refusals are STATES, not exceptions: fieldd's own `UNAVAILABLE
 * {state:"unobserved"}` before its first observation is `unobserved`, and a
 * window that cannot ask at all is `unavailable`. An empty list is only
 * trustworthy under `observed`.
 */
export async function refreshTerminalRoster(
  trace?: TransportTrace,
): Promise<readonly ProductSessionRosterItem[]> {
  const fieldd = client;
  if (fieldd === null) {
    roster = [];
    rosterState = "unavailable";
    publish();
    return roster;
  }
  try {
    // TP-S1m's null arm: the same client and the same socket, one call before
    // the mint, answering from memory with no audit append and no HMAC. What
    // the two intervals differ by is the mint's own cost.
    trace?.mark("rosterAsk");
    roster = TerminalRosterResult.parse(await fieldd.request("terminal.roster", {})).items;
    trace?.mark("roster");
    rosterState = "observed";
  } catch (cause) {
    roster = [];
    rosterState = unobservedRefusal(cause) ? "unobserved" : "unavailable";
    logger().info("renderer.terminal.roster_unavailable", "The session roster could not be read", {
      reason: cause instanceof Error ? cause.message : String(cause),
      state: rosterState,
    });
  }
  publish();
  return roster;
}

/**
 * Replace the transport AND the runtime.
 *
 * A rebuilt bridge posts its ports once and a runtime holds its ports for life,
 * so recovery means a new runtime — which is what the snapshot's `generation` is
 * for. The old one is disposed HERE, while nothing is rendering it.
 *
 * Demand SURVIVES, deliberately: demand is declared against a SESSION, and
 * sessions outlive this window's transport by design — the floor holds the PTYs
 * and outlives fieldd. Clearing the ledger here would say the views went away,
 * which is the one thing that did not happen. PLACEMENT does NOT survive: the
 * next ticket re-resolves it (§5.2 — re-resolve on connection death), and a
 * cached route across a cell restart is exactly the stale binding the route
 * layer exists to correct.
 */
function replaceTransport(sessionIds: readonly string[]): void {
  acquisitionEpoch += 1;
  placements.clear();
  routedCells.clear();
  projected.clear();
  disposeRuntime();
  phase = "opening";
  fault = null;
  spentReason = null;
  inheritedWarm = false;
  publish();
  void adopt({ sessionIds });
}

// (discardWarm retired at TP-S3e: its only trigger was the bridge-status
// subscription. A routed warm is a runtime + device with no external transport
// that can die under it; a FAILED warm still spends the attempt below.)

// ── the door ────────────────────────────────────────────────────────────────

/**
 * The human's way back from a fault (GT-2b), and the way to re-open a dormant
 * pool onto sessions it has since learned about.
 */
export function retryTerminalPool(sessionIds: readonly string[] = []): void {
  if (!claimed) return;
  replaceTransport(sessionIds.length > 0 ? sessionIds : rejoinCandidates());
}

// (the bridge-status recovery ladder retired at TP-S3e: G23's routed runtime
// owns per-activation recovery, and there is no main-side transport to die.)

/**
 * The sessions a replacement should try to rejoin, best first.
 *
 * What this window is actually SHOWING comes first (the demand ledger), then
 * every session it has resolved a route for, then the ids the consumer opened
 * with. Three sources because each covers a hole the others leave: a legacy
 * floor mints no grants, a pool that never bound a view has no demand, and a
 * window whose sessions all died still knows what it was asked to open on.
 *
 * All of it beats the deck's saved layout, which is a disk record of a previous
 * run rather than a statement about this window — and all of it is available at
 * the moment of a bridge event, when no React tree is guaranteed to exist.
 */
function rejoinCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (sessionId: string): void => {
    if (seen.has(sessionId)) return;
    seen.add(sessionId);
    candidates.push(sessionId);
  };
  for (const session of demand.sessions()) add(session.sessionId);
  for (const sessionId of placements.sessionIds()) add(sessionId);
  for (const sessionId of rejoinHint) add(sessionId);
  return candidates;
}

/**
 * Tear the pool down.
 *
 * Honest about its callers: TODAY this is the test seam and nothing else. The
 * pool is per-window, and a window going away takes its renderer — worker,
 * device and all — with it, so there is no production teardown to hang this on,
 * and wiring one into the close handshake would add a failure mode to a path
 * that currently has none. It exists because a module singleton is otherwise
 * untestable: this is the only honest way to get a second pool in one process.
 */
export function disposeTerminalPool(): void {
  acquisitionEpoch += 1;
  disposeRuntime();
  placements.clear();
  routedCells.clear();
  createdSummaries.clear();
  demand.clear();
  projected.clear();
  pending = null;
  client = null;
  rejoinHint = [];
  workspaceBirthTrace = undefined;
  phase = "cold";
  claimed = false;
  fault = null;
  spentReason = null;
  inheritedWarm = false;
  grantsLanded = false;
  roster = [];
  rosterState = "unread";
  runtimeGeneration = 0;
  transportGeneration = 0;
  terminalBootstrap = null;
  publish();
}
