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
// WHAT IS HONEST TODAY, exactly. `terminal.connectTicket` is sessionless and
// mints "for the interactive cell by definition"
// (`fieldd/src/terminal-service.ts:321-324`); `TerminalTicket` is
// `{controlSocket, frameSocket, token}` (`contracts/src/terminal.ts:67-74`) and
// carries NO cell identity, no route revision and no lease epoch. So the key
// below is a LOCAL STAND-IN for a fact the wire does not yet state — named as
// one, not dressed up as a route binding. TP-S1 replaces it with the real
// `RouteBinding` off `openTicket(sessionId)`, and the table, the lookup and
// every consumer stay exactly as they are.

/** Placement's key. Opaque by law — it never crosses the pool's door. */
export type CellBootId = string & { readonly __cellBootId: unique symbol };

/**
 * The one cell this window can reach today.
 *
 * Spelled as a stand-in rather than a plausible id: a reader who greps for a
 * cell boot id must land on the sentence that says the wire does not carry one
 * yet. A REPLACED cell is a new key in the final model (§5.2 — "a replaced cell
 * is a NEW key, never a reconnect"); today a rebuilt bridge cannot be told from
 * a rebooted floor through this door, so the pool replaces the ENTRY under this
 * one key and records the transport generation on it instead of inventing an
 * identity it cannot observe.
 */
export const UNROUTED_INTERACTIVE_CELL = "cell:interactive/unrouted" as CellBootId;

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
 * Today: always the one cell, because the door that mints this window's
 * connection is sessionless and answers for the interactive cell by definition.
 * The signature is the final one — a session id in, a placement key out — so
 * TP-S1's real resolution (route snapshot, `STALE_ROUTE` re-resolve) lands
 * inside this function rather than at its call sites.
 */
export function resolveCellForSession(_sessionId: string): CellBootId {
  return UNROUTED_INTERACTIVE_CELL;
}
