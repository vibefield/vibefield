import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";

// THE ROUTED DATA MODEL (TP-L-C), one cell populated.
//
// "The session id is the only address. Placement {cell instance, cell boot,
// lease epoch, route revision} is a fact about a session, resolved by the route
// layer... product consumers address sessions ONLY; the routed transport may
// CACHE resolved placement (connections keyed by `cellBootId`), but placement
// never escapes the transport abstraction."
//
// This module IS that abstraction's private half. Nothing it exports is allowed
// to leave the pool: the deck asks for sessions, never for cells, and the day
// there are two cells nothing above this file learns about it. fieldd already
// runs the same shape from the other side — one control connection per cell
// keyed by `cellBootId`, blast counted per cell — so this is the client half of
// a design that exists, not a new one (`fieldd/src/terminal-service.ts:106-133`).
//
// TP-S1 — THE KEY IS REAL NOW. It was a named stand-in
// (`cell:interactive/unrouted`) for exactly one slice, because
// `terminal.connectTicket` is sessionless and answers no cell at all
// (`fieldd/src/terminal-service.ts:321-324`; `TerminalTicket` is
// `{controlSocket, frameSocket, token}`, `contracts/src/terminal.ts:67-74`).
// The session-addressed mints answer a `RouteBinding` — `{cellBootId,
// routeRevision, leaseEpoch?}` — and THAT `cellBootId` is this table's key. The
// table, the lookup and every consumer are unchanged by the swap, which is what
// the stand-in was for.

/** Placement's key. Opaque by law — it never crosses the pool's door. */
export type CellBootId = string & { readonly __cellBootId: unique symbol };

/**
 * A cell a keyless floor did not name.
 *
 * A floor that predates the grant key answers the bare legacy ticket with no
 * route at all (`open-ticket.ts`). The transport is still real and the bridge
 * still dials it, so the table still needs a key — but the key must not be a
 * plausible-looking cell id, because nothing observed one. This is that key,
 * spelled so a reader who greps for it lands on this sentence. A floor that
 * mints routes never produces it.
 */
export const UNNAMED_CELL = "cell:unnamed/keyless-floor" as CellBootId;

/** Main's answer to the connect (GT-D10): the shell every pane is born with. */
export interface TerminalShellPolicy {
  readonly defaultShell: string;
  readonly home: string;
}

/** One cell's transport: the connection, and what rode its answer back. */
export interface CellTransport {
  readonly cellBootId: CellBootId;
  /** The ONE ghosttea runtime per window (TP-D5, §9.1). Today every cell would
   * share it — one runtime, N cell connections is the end state, and the
   * runtime takes exactly one port pair for its life (`runtime.d.ts`), which is
   * why the pool replaces the runtime whenever this transport is replaced. */
  readonly runtime: GhostteaTerminalRuntime;
  readonly shell: TerminalShellPolicy;
  /** Bumped per acquisition of this cell's transport. A local transport fact
   * (§5.4's `TransportGeneration`), never placement. */
  readonly transportGeneration: number;
  /** When the transport became usable, so a claim can say how stale it is. */
  readonly openedAt: number;
}

/**
 * The transport table: `cellBootId → CellTransport`, one entry today.
 *
 * A Map rather than a field because the entry count is the whole point of the
 * slice. The pool never iterates it to answer a product question — it resolves a
 * session to a cell and looks the cell up, which is the operation that keeps
 * working when there are K of them.
 */
export class CellTransportTable {
  readonly #byCell = new Map<CellBootId, CellTransport>();

  get(cellBootId: CellBootId): CellTransport | undefined {
    return this.#byCell.get(cellBootId);
  }

  set(transport: CellTransport): void {
    this.#byCell.set(transport.cellBootId, transport);
  }

  delete(cellBootId: CellBootId): CellTransport | undefined {
    const transport = this.#byCell.get(cellBootId);
    this.#byCell.delete(cellBootId);
    return transport;
  }

  get size(): number {
    return this.#byCell.size;
  }

  /** Every transport, for teardown. Not a product read. */
  all(): CellTransport[] {
    return [...this.#byCell.values()];
  }

  clear(): CellTransport[] {
    const transports = this.all();
    this.#byCell.clear();
    return transports;
  }
}

/**
 * Resolve a session to the cell that holds it.
 *
 * The answer comes from the ticket that session was last minted — the route
 * layer's own word, cached per session in the placement ledger — and the lookup
 * is a function so that TP-S3c's re-resolution (a `STALE_ROUTE` at a cell's
 * door, the inventory's cell tag moving) lands inside it rather than at its call
 * sites. `undefined` means "never ticketed", which is a different fact from
 * "ticketed onto a cell we cannot reach" and must not be collapsed into it.
 */
export function resolveCellForSession(
  sessionId: string,
  placements: { cellFor(sessionId: string): CellBootId | undefined },
): CellBootId | undefined {
  return placements.cellFor(sessionId);
}
