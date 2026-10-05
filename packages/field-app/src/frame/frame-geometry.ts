// THE FRAME'S GEOMETRY (DESIGN.md §10 "One frame, every view"; One Frame
// FC-D6, FC-D15). The numbers a covered view is laid out by, in one place, so
// a view that needs them as numbers — a package's props, a measurement — reads
// them here rather than retyping DESIGN.md. The frame's own stylesheets still
// spell the same numbers (`view-frame.css`, `godview.css`); this file is where
// script reads them.

/** The head's band: the window's top 0–52, its controls on y 28 (DESIGN.md
 * §10). A covered view's own top band — History's is empty since GV-D10 moved
 * the search to the frame's button — sits in it. */
export const HEAD_BAND_PX = 52;

/** FC-D15 — the reserve: a covered view's content ends this far above the
 * window's foot (at 692 in the default 1180 × 780 window), where the line
 * floats over the view's own ground. */
export const COVER_RESERVE_PX = 88;

/** FC-D15 — what a covered view keeps clear at each side edge, for the notches'
 * slivers (DESIGN.md §8, edge trays). */
export const COVER_EDGE_CLEAR_PX = 8;
