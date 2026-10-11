// GODVIEW'S HEAD, THE ROW'S ARITHMETIC (DESIGN.md §8 "Godview's head —
// Stories"; One Frame §23, GV-D1). Pure: how many whole circles a room shows,
// where its pages start, and how a view's name is said. The view
// (`GodviewHeadView.tsx`) measures the room and draws; its stylesheet
// (`godview-head.css`) spells the same numbers.

/** The head's reserve: a monitor view keeps its words and controls clear of
 * the window's top this far — the head's foot at 48 (its 40 at top 8), plus 8.
 * The stage publishes it as its top inset; the stylesheet spells the same
 * number (`--vf-godview-head-reserve`, the kit's token sheet). */
export const HEAD_RESERVE = 56;

/** A circle, and the gap between two. */
export const STORY_SIZE = 40;
export const STORY_GAP = 12;
/** One step of the row: a circle and its gap. */
export const STORY_STEP = STORY_SIZE + STORY_GAP;
/** Nine circles in view at most. */
export const STORIES_SHOWN_MAX = 9;
/** A turn of the page moves three whole circles. */
export const STORIES_PAGE = 3;
/** The chevron outside an end that has more, one gap from the row. */
export const STORY_CHEVRON = 28;
/** How long after the pointer leaves the head a row paged past the current
 * view comes back to it. */
export const STORIES_RETURN_MS = 700;

/**
 * How many WHOLE circles the row shows in a room `room` px wide — nine at
 * most, never a part of one. A room not measured yet (`null`) shows them all,
 * up to the nine. When they do not all fit the row pages, and a chevron with
 * its gap comes off each end of the room before the circles are counted; it
 * always shows one.
 */
export function storiesShown(count: number, room: number | null): number {
  const most = Math.min(count, STORIES_SHOWN_MAX);
  if (most <= 0) return 0;
  if (room === null) return most;
  const fit = (width: number): number => Math.floor((width + STORY_GAP) / STORY_STEP);
  if (count <= STORIES_SHOWN_MAX && fit(room) >= count) return count;
  const paged = fit(room - 2 * (STORY_CHEVRON + STORY_GAP));
  return Math.max(1, Math.min(most, paged));
}

/** The furthest the row pages: the last circle at the row's end. */
const lastOffset = (count: number, shown: number): number => Math.max(0, count - shown);

/** A page turn's length: three circles, or the row's own when it shows fewer
 * (a row of two turned by three would skip one). */
const turnOf = (shown: number): number => Math.max(1, Math.min(STORIES_PAGE, shown));

/** Where each page starts: every turn from the first circle, the last page
 * ending on the last circle. */
export function storyPages(count: number, shown: number): number[] {
  const last = lastOffset(count, shown);
  const pages: number[] = [];
  for (let at = 0; at < last; at += turnOf(shown)) pages.push(at);
  pages.push(last);
  return pages;
}

/** Whether the row at `offset` shows circle `index`. */
export function storyInView(offset: number, shown: number, index: number): boolean {
  return index >= offset && index < offset + shown;
}

/** The page that holds circle `index`: the first whose circles include it. */
export function storyHome(count: number, shown: number, index: number): number {
  const pages = storyPages(count, shown);
  return pages.find((at) => storyInView(at, shown, index)) ?? pages[pages.length - 1] ?? 0;
}

/** One press of a chevron: a turn on (1) or back (-1), never past an end. */
export function storyTurn(offset: number, direction: -1 | 1, count: number, shown: number): number {
  const next = offset + direction * turnOf(shown);
  return Math.max(0, Math.min(lastOffset(count, shown), next));
}

/**
 * A view's name as the head says it. A manifest's label is the instrument's —
 * capitals, "SWARM" — and the head is drawn in the frame's language, which
 * says a name in sentence case (DESIGN.md §9), so a label in capitals is said
 * "Swarm". A label its view already wrote in mixed case is said as written.
 */
export function storyName(label: string): string {
  if (label !== label.toUpperCase()) return label;
  return `${label.slice(0, 1)}${label.slice(1).toLowerCase()}`;
}
