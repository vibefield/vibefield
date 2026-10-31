// THE FRAME'S GEOMETRY (DESIGN.md §10 "One frame, every view"; One Frame
// FC-D6, FC-D15; LN-D1). The numbers a covered view is laid out by, in one
// place, so a view that needs them as numbers — a package's props, a
// measurement — reads them here rather than retyping DESIGN.md. The frame's own
// stylesheets still spell the same numbers (`view-frame.css`, `godview.css`,
// `composer.css`); this file is where script reads them.

/** The head's band: the window's top 0–52, its controls on y 28 (DESIGN.md
 * §10). A covered view's own top band — History's is empty since GV-D10 moved
 * the search to the frame's button — sits in it. */
export const HEAD_BAND_PX = 52;

/** FC-D15 — the reserve: a covered view's content ends this far above the
 * window's foot (at 692 in the default 1180 × 780 window), where the line
 * floats over the view's own ground. Its sides are the window's: the 8 it kept
 * clear at each for the notches' slivers left with the edges (HN-8; §10). */
export const COVER_RESERVE_PX = 88;

/** LN-D1 — the line, `[views] snapshot create` (DESIGN.md §10, §8 "The line"):
 * 300 × 52 on the line's glass, standing 76 from the window's left — never
 * nearer, so it never meets the face in the corner — and 20 above its foot: y
 * 708–760 in the default window, its centre on the foot axis (734), as before
 * it shortened. The hand fans from 28 past its right end (`CARDS_LINE_RIGHT`,
 * the hand's own copy of 76 + 300). */
export const LINE_LEFT_PX = 76;
export const LINE_WIDTH_PX = 300;
export const LINE_BOTTOM_PX = 20;
export const LINE_HEIGHT_PX = 52;
