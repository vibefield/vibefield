import { LIVING_MARK_SIZE, LivingMark } from "@vibefield/design-kit/living-mark";
// the room's types only, which ride no chunk: this module is the canvas's, with History's first open
import type { RoomWaitMark, RoomWaitPlace } from "@vibefield/rosetta-room";
import type { ReactElement } from "react";

// HISTORY'S MARK (track HG: HG-W1, HG-W4 and HG-L1; DESIGN.md §8 "History" and "The living mark, drawn as SVG"; §6).
// The kit's living mark in History's three places: the view's hold, a conversation's hold in the transcript's
// column, and the import card's head. It stands on the theme's ground and at rest while its work is paused. History's
// first open wears it (`HistoryOpening.tsx`), and the room's waits wear it through rosetta-room's `waitMark` host
// input (R10, `RoomWaitMark`, rosetta-room 0.1.6), which `HistoryRoomView` hands the room. The opening hold and the
// room's own land together, so History's open stays one state.

/** The mark's width in each place (HG-W4): its own in a hold, 40 where IMPORTING HISTORY stood. */
export const HISTORY_MARK_WIDTH: Readonly<Record<RoomWaitPlace, number>> = {
  view: LIVING_MARK_SIZE.width,
  column: LIVING_MARK_SIZE.width,
  card: 40,
};

/** A hold's late (§6, FG-4b): nothing for 120ms, so a wait answered at once shows none. The sheet's own delay
 * (`history-room-view.css`). */
export const HISTORY_HOLD_LATE_MS = 120;

/** Whether History's opening, standing since `shownAt` (null: it never stood), had begun to show by `now`. Only then
 * does the room's first hold carry it, standing at once: a carried hold has shown, so it keeps its 800ms floor. */
export function carriesOpening(shownAt: number | null, now: number): boolean {
  return shownAt !== null && now - shownAt >= HISTORY_HOLD_LATE_MS;
}

/** The living mark on the theme's ground: `light` (black ink) by day, `dark` (white ink) by night. Both grounds are
 * drawn and the theme's class shows one (`history-room-view.css`), so the catalog, which sets that class itself,
 * draws what the product does. It is decoration: the words beside it say what loads. */
export function HistoryMark({
  width,
  resting = false,
}: {
  readonly width: number;
  /** Its work is paused: the mark stands at rest (HG-L1). */
  readonly resting?: boolean;
}): ReactElement {
  return (
    <span className="vf-history-mark" data-resting={resting ? "" : undefined}>
      <LivingMark ground="dark" width={width} resting={resting} className="vf-history-mark-dark" />
      <LivingMark
        ground="light"
        width={width}
        resting={resting}
        className="vf-history-mark-light"
      />
    </span>
  );
}

/** What the room's waits wear (R10): the mark in each place, at rest while its work is paused, and `carried` when
 * History's own opening hold stood where the room's first one comes (`carriesOpening`). */
export function historyWaitMark(carried: boolean): RoomWaitMark {
  return {
    mark: (place, { resting }) => (
      <HistoryMark width={HISTORY_MARK_WIDTH[place]} resting={resting} />
    ),
    carried,
  };
}
