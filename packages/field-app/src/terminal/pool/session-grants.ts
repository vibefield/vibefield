import type { CellTransportGrant, RouteBinding, SessionAttachGrant } from "@vibefield/contracts";
import type { CellBootId } from "./cell-transport";

// WHAT A TICKET LEAVES BEHIND (TP-S1) — the per-session half of the routed
// client: placement, and the two authorities the S3 legs will dial with.
//
// The pool keeps this; nothing above the pool can read it. That is TP-L-C in
// the type system rather than in a comment: `SessionPlacement` names a cell, so
// it never leaves this module's neighbours, and what consumers get instead is
// `SessionAvailability` — a face, not a location.
//
// NOTHING HERE IS VERIFIED OR USED ON A WIRE YET, and that is deliberate. The
// cell cannot verify a grant until TP-S3a; the legs that carry one do not exist
// until TP-S3a either. Holding them now is what makes S3 a wiring change rather
// than a re-mint: the pool already has the authority in hand, stamped with the
// route it was minted against.

/** One session's placement and authorities, as one ticket answered them. */
export interface SessionPlacement {
  readonly sessionId: string;
  /** Authoritative placement (spec §5.4's `RouteBinding`). */
  readonly route: RouteBinding;
  /** The cell this session's transport belongs to — `route.cellBootId`, named
   * separately because it is the transport table's key. */
  readonly cellBootId: CellBootId;
  /** Present only when the floor minted grants (a keyless floor mints none). */
  readonly grants: SessionGrants | undefined;
  /** When this placement was learned, for staleness reporting. */
  readonly resolvedAt: number;
}

/** The two authorities a ticket carries (spec §5.1). */
export interface SessionGrants {
  readonly transportGrant: CellTransportGrant;
  readonly attachGrant: SessionAttachGrant;
  /** Wall-clock ms the ATTACH grant expires at — recorded so TP-S3 can schedule
   * `renewAttach` against it. Nothing schedules anything today. */
  readonly attachExpiresAt: number;
  /** The generation `renewAttach(sessionId, expectGeneration, requestId)` will
   * CAS against. Held, never incremented here. */
  readonly grantGeneration: number;
}

/**
 * Why a session cannot be shown, in the shape design-01's taxonomy uses.
 *
 * `UNAVAILABLE {service, state, progress?}` is the contract's degraded-state
 * shape and `transport-not-landed` is the spec's own word for this one (§15's
 * S1 row). `reason` is the second line — what a person needs in order to know
 * this is not their fault and not a broken session:
 *
 *   `other-cell` — the session lives in a cell this window's bridge does not
 *   serve. Main's `TerminalBackendHost` holds ONE connection per window and a
 *   ticket naming different sockets tears it down and rebuilds it
 *   (`electron-shell/src/main/terminal-backend.ts:117-122`), so handing it a
 *   second cell's ticket would kill the panes that are working. TP-S3a's direct
 *   connections are what remove this; until then the honest answer is a face.
 *
 *   `endpoints-not-served` — the ticket carries route and grants but no
 *   `endpoints` (a keyed cell that serves no T1 doors — since TP-S3a a cell
 *   born with its grant key serves them and fieldd copies them onto the
 *   ticket), so the v2 path has nothing to dial and the v1 bridge is already
 *   committed elsewhere.
 */
export interface SessionUnavailable {
  readonly service: "terminal";
  readonly state: "transport-not-landed";
  readonly reason: "other-cell" | "endpoints-not-served";
}

export type SessionAvailability = { readonly ready: true } | SessionUnavailable;

/** Whether an availability is the honest refusal rather than a ready session. */
export function isSessionUnavailable(
  availability: SessionAvailability,
): availability is SessionUnavailable {
  return "state" in availability;
}

/**
 * The per-session placement ledger.
 *
 * Keyed by session id because that is the only address a consumer has (TP-L-C);
 * the cell it stores is the ANSWER to a lookup, never a key a caller supplies.
 */
export class SessionPlacementLedger {
  readonly #bySession = new Map<string, SessionPlacement>();

  record(placement: SessionPlacement): void {
    this.#bySession.set(placement.sessionId, placement);
  }

  get(sessionId: string): SessionPlacement | undefined {
    return this.#bySession.get(sessionId);
  }

  /** The cell a session was last resolved to, or undefined if never ticketed. */
  cellFor(sessionId: string): CellBootId | undefined {
    return this.#bySession.get(sessionId)?.cellBootId;
  }

  /** Drop one session after the product authority confirms termination. */
  forgetSession(sessionId: string): boolean {
    return this.#bySession.delete(sessionId);
  }

  /** Every session known to sit on one cell. Used when a transport dies: its
   * sessions lose their placement, because the next ticket re-resolves them
   * (§5.2 — re-resolve on connection death). */
  forget(cellBootId: CellBootId): string[] {
    const dropped: string[] = [];
    for (const [sessionId, placement] of this.#bySession) {
      if (placement.cellBootId === cellBootId) {
        this.#bySession.delete(sessionId);
        dropped.push(sessionId);
      }
    }
    return dropped;
  }

  /** Every session this ledger has ever resolved, in insertion order. */
  sessionIds(): string[] {
    return [...this.#bySession.keys()];
  }

  /** Sessions holding grants, for the "grants are held, nothing is faked" read. */
  withGrants(): string[] {
    return [...this.#bySession.entries()]
      .filter(([, placement]) => placement.grants !== undefined)
      .map(([sessionId]) => sessionId)
      .sort();
  }

  clear(): void {
    this.#bySession.clear();
  }

  get size(): number {
    return this.#bySession.size;
  }
}
