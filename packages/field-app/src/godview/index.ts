// The Godview module: the view's content and its deck (GT-D2; since One Frame
// FR-1 a VIEW drawn inside the frame's cover, opened by the window's one view
// owner — `frame/view-state.ts` — rather than a bit of its own). Internal to
// field-app — nothing outside this package imports it, so it stays off the
// package's public entries (wall R5's list is for cross-package doors).
export { GodviewOverlay } from "./GodviewOverlay";
export { type DeckSession, describePane, type PaneFace } from "./pane-faces";
