import type { FrameView } from "@vibefield/contracts";
import { type GodviewFindDoor, getGodviewFindDoor, whenGodviewFindDoor } from "./find-door";
import { type LineViewDoor, whenGodviewCanPlace } from "./line-door";
import type { PeekLiveRow } from "./peek-live";
import { requestView } from "./view-state";

// OPENING A LIVE ROW (P2; DESIGN.md §8 "Search — the Peek": "a live result
// opens in the terminals"). In Godview it is what the find sheet's pick did —
// the view's own select, through the find door: a local run's PTY mounted in
// the active pane, a peer's attached there. From History (PK5) it is Jump to's
// path (P3, `history/HistoryView.tsx`): the frame asks for Godview, waits for
// a deck that can place, and the deck REVEALS the pane showing the run's floor
// session — activated, or mounted in the active pane; a peer's run, which has
// no floor session here, is selected through the find door Godview publishes
// as it opens.

/** How long a pick from History waits for Godview's deck (or its monitor) —
 * mounted on Godview's first open — to be able to show the run (Resume's). */
export const LIVE_OPEN_WAIT_MS = 20_000;

export type LiveOpenOutcome =
  | { readonly state: "shown" }
  | { readonly state: "refused"; readonly reason: string };

export interface LiveOpenDoors {
  requestView(view: FrameView): unknown;
  whenGodviewCanPlace(timeoutMs: number): Promise<LineViewDoor | null>;
  whenGodviewFindDoor(timeoutMs: number): Promise<GodviewFindDoor | null>;
  godviewFindDoor(): GodviewFindDoor | null;
}

const FRAME_DOORS: LiveOpenDoors = {
  requestView: (view) => requestView(view),
  whenGodviewCanPlace,
  whenGodviewFindDoor,
  godviewFindDoor: getGodviewFindDoor,
};

export async function openLiveRow(
  row: PeekLiveRow,
  from: FrameView,
  doors: LiveOpenDoors = FRAME_DOORS,
): Promise<LiveOpenOutcome> {
  if (from === "godview") {
    const door = doors.godviewFindDoor();
    if (door === null) return { state: "refused", reason: "Godview is not showing its runs" };
    door.select(row.id);
    return { state: "shown" };
  }
  void doors.requestView("godview");
  if (row.floorSessionId !== null) {
    const deck = await doors.whenGodviewCanPlace(LIVE_OPEN_WAIT_MS);
    if (deck === null) return { state: "refused", reason: "the deck did not open to show it" };
    const shown = await deck.reveal(row.floorSessionId);
    return shown.state === "opened" ? { state: "shown" } : shown;
  }
  const door = await doors.whenGodviewFindDoor(LIVE_OPEN_WAIT_MS);
  if (door === null) return { state: "refused", reason: "Godview did not open to show it" };
  door.select(row.id);
  return { state: "shown" };
}
