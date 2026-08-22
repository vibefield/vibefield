// THE COLD-OPEN TRACE (GT-3p, GT-D15.4) — what ⌘G actually costs, phase by phase.
//
// GT-D15.4 makes measurement the gate: a perf change qualifies by numbers or not
// at all, and "reject changes that merely move cost" needs a breakdown rather
// than a total, because moving 300ms from the fork to the device request looks
// like progress in a single number and is not.
//
// The trace is a RECORDER, not a timer: every phase is stamped when the thing
// actually happened, and the breakdown is derived at the end. That ordering is
// what lets prewarm be measured honestly — a phase completed BEFORE the overlay
// opened is not a phase the user waited through, and reporting it as elapsed
// time would credit the open with work it never did. Those phases report zero
// and the `warm` set says which they were, so a reader can see the difference
// between "fast" and "already done".
//
// Clock-injected, so the derivation is testable without a renderer.

/** The cold path's stations, in the order a cold open passes them.
 *
 * TP-S1m SPLIT THE FIRST INTERVAL, and the split is the slice's finding. Until
 * now the first station after `open` was `ticket`, so everything between the two
 * — React's commit, the pool's claim, whatever that claim WAITED on, the roster
 * read, and the mint's own round trip — arrived as one number. TP-S0c read that
 * number as "~57% of a cold open is minting the ticket". It is not: the mint is
 * the last and by far the smallest part of the interval. A breakdown that cannot
 * separate a wait from the work it waits for will always blame the work. */
export const COLD_OPEN_PHASES = [
  /** The renderer learned the overlay is open. Time zero for everything below. */
  "open",
  /** The deck claimed the pool. React's commit is behind this stamp. */
  "claim",
  /** `terminal.roster` LEFT the renderer — the control arm's send edge. */
  "rosterAsk",
  /** fieldd answered `terminal.roster`: a read of the observed inventory, with
   * no audit append and no mint. It is the NULL ARM for the mint below it —
   * same socket, same client, adjacent in time, differing only in what the
   * handler does (§19's interleaved control, taken on the path itself). */
  "roster",
  /** The mint (`terminal.openTicket` or `terminal.create`) LEFT the renderer. */
  "mintAsk",
  /** fieldd answered the mint: a ticket, and on a TP floor a route and grants. */
  "ticket",
  /** Main answered the connect: bridge forked, sockets dialled, ports posted. */
  "connected",
  /** The render worker reported a backend — adapter, device, pipelines. */
  "device",
  /** The restore gate resolved (silently, or by the user's answer). */
  "consent",
  /** The workspace committed: a pane exists in the deck's own report. */
  "mounted",
  /** A frame carrying that pane was presented (double-rAF; see `frame`). */
  "frame",
] as const;

export type ColdOpenPhase = (typeof COLD_OPEN_PHASES)[number];

export interface ColdOpenReport {
  /** Milliseconds from `open` to `frame`, the number a user would recognize. */
  totalMs: number;
  /** Per-phase milliseconds from `open`. A phase stamped before the open is 0. */
  phases: Partial<Record<ColdOpenPhase, number>>;
  /** Phases that were already done when the overlay opened — the prewarm's
   * whole claim, stated as the list of waits that did not happen. */
  warm: ColdOpenPhase[];
  /** False when a phase never arrived; `phases` then says how far it got. */
  complete: boolean;
}

/**
 * Records phase timestamps and derives the breakdown.
 *
 * Stamps are idempotent per phase: the FIRST time a station is reached is the
 * fact, and a recovery that re-runs the connect must not overwrite the number
 * the user actually waited through.
 */
export class ColdOpenTrace {
  private readonly stamps = new Map<ColdOpenPhase, number>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /** Stamp a phase, unless it already carries one. */
  mark(phase: ColdOpenPhase, at: number = this.now()): void {
    if (this.stamps.has(phase)) return;
    this.stamps.set(phase, at);
  }

  has(phase: ColdOpenPhase): boolean {
    return this.stamps.has(phase);
  }

  report(): ColdOpenReport {
    const open = this.stamps.get("open");
    if (open === undefined) {
      return { totalMs: 0, phases: {}, warm: [], complete: false };
    }
    const phases: Partial<Record<ColdOpenPhase, number>> = {};
    const warm: ColdOpenPhase[] = [];
    for (const phase of COLD_OPEN_PHASES) {
      const at = this.stamps.get(phase);
      if (at === undefined) continue;
      const elapsed = at - open;
      // A station reached before the open is warm: the clock is not run
      // backwards for it, it is reported as the zero wait that it was.
      if (elapsed < 0) {
        if (phase !== "open") warm.push(phase);
        phases[phase] = 0;
        continue;
      }
      phases[phase] = Math.round(elapsed * 10) / 10;
    }
    const frame = phases.frame;
    return {
      totalMs: frame ?? 0,
      phases,
      warm,
      complete: frame !== undefined,
    };
  }
}

/**
 * THE trace for this app's first open.
 *
 * A module singleton because the measurement spans two owners that never share a
 * React tree: the prewarm stamps `ticket`/`connected`/`device` at app idle, and
 * the deck — which does not exist yet at that moment — stamps the rest. Passing
 * a trace between them would mean the deck owned an object created for work it
 * did not do.
 *
 * One open is measured, deliberately. The FIRST is the cold one; every reopen
 * after it finds a mounted deck and a live session, and folding those into the
 * same recorder would make the number that matters unreadable.
 */
export const godviewColdOpen = new ColdOpenTrace(() => performance.now());

/** Whether the trace has everything it needs to be worth publishing. */
export function traceIsComplete(trace: ColdOpenTrace): boolean {
  return trace.has("open") && trace.has("frame");
}

/**
 * Resolve once a frame carrying the just-mounted content has been presented.
 *
 * Double-rAF and NAMED as the proxy it is: 0.9.1 gives a host no first-frame
 * signal from the render worker (`renderer-status` reports the backend, not a
 * presented frame), so what this measures is "the compositor produced a frame
 * after the pane entered the tree". It is the honest ceiling of what this page
 * can observe, and the residual is written down rather than dressed up.
 */
export function afterNextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
