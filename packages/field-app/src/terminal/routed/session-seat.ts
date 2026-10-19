import type { GeometryStateHolder } from "@vibefield/contracts";

// item 42 (DESIGN.md §8 "A session another device is driving") — ONE SESSION'S
// GEOMETRY SEAT as this window knows it. The cell announces it (`GeometryState`,
// behind the negotiated `geometry-events` capability) to every leg with an
// activation of the session; the routed host (`host.ts`) reads it and adds the
// one fact only it holds — whether the holder is THIS window — and the pool
// keeps the newest per session, folded here. The words are the pane's own
// (`godview/pane-faces.ts` `describeSeat`).

/** What the routed host hands the pool for one `GeometryState`. */
export interface SessionSeatAnnouncement {
  /** the holder the cell named — its client, view and generation, and the face
   * fieldd minted into its attach grant (absent: fieldd could name no device);
   * null while the seat is empty */
  readonly holder: GeometryStateHolder | null;
  /** the holder is THIS window: its clientId is one this window's own tickets
   * for the session named */
  readonly mine: boolean;
  /** the cell's `geometryRevision` */
  readonly revision: number;
  /** the PTY's committed size — the holder's, or on an empty seat the last one
   * committed, which is the size the pane goes on drawing */
  readonly cols: number;
  readonly rows: number;
}

/** The seat as the pool holds it. */
export interface SessionSeat extends SessionSeatAnnouncement {
  /** while the seat is EMPTY, the holder that let it go when that was another
   * client (the pane names it: "James's iPhone let go"); absent otherwise */
  readonly released?: GeometryStateHolder;
}

/**
 * Fold one announcement onto the seat the pool holds (undefined: none yet).
 * The receiver's rule, as the contract states it (`GeometryState`):
 *  · a revision strictly BELOW the stored one is stale — the cell sends outside
 *    its lock, so two announcements can cross — and is ignored;
 *  · an equal or higher one REPLACES the stored seat, in arrival order: one
 *    cell path (DS-4d's `DESTINATION_INELIGIBLE` on an empty seat) resizes the
 *    PTY without moving the revision;
 *  · an identical repeat (the cell's announcement on a leg's attach, a seat
 *    this window already holds) changes nothing.
 * Either of the last two answers the STORED object itself, so a reader keyed
 * on identity sees a change exactly when there is one.
 */
export function foldSessionSeat(
  stored: SessionSeat | undefined,
  next: SessionSeatAnnouncement,
): SessionSeat {
  if (stored !== undefined && next.revision < stored.revision) return stored;
  const released = next.holder === null ? releasedBy(stored) : undefined;
  if (
    stored !== undefined &&
    sameHolder(stored.holder, next.holder) &&
    stored.mine === next.mine &&
    stored.revision === next.revision &&
    stored.cols === next.cols &&
    stored.rows === next.rows &&
    sameHolder(stored.released ?? null, released ?? null)
  ) {
    return stored;
  }
  return {
    holder: next.holder,
    mine: next.mine,
    revision: next.revision,
    cols: next.cols,
    rows: next.rows,
    ...(released === undefined ? {} : { released }),
  };
}

/** Who let the seat go, as an empty seat remembers it: the holder before it,
 * when that was another client's; whoever an already-empty seat remembered;
 * nobody when this window let go, or when this window never saw it held. */
function releasedBy(stored: SessionSeat | undefined): GeometryStateHolder | undefined {
  if (stored === undefined) return undefined;
  if (stored.holder === null) return stored.released;
  return stored.mine ? undefined : stored.holder;
}

function sameHolder(a: GeometryStateHolder | null, b: GeometryStateHolder | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.clientId === b.clientId &&
    a.viewId === b.viewId &&
    a.holderGeneration === b.holderGeneration &&
    a.face?.kind === b.face?.kind &&
    a.face?.name === b.face?.name &&
    a.face?.os === b.face?.os
  );
}
