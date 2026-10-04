// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/src/glyphs.ts`, design-016 K8b) — re-wrapped by this repo's formatter.

// The clock's OWN glyphs (K8a's `HeldGlyph { path }` — a plugin draws no React): SVG path data in the bar's 24-unit box, stroked
// 2 units in the bar's ink as the bar's own are. One each for its menu act and its held tools.

/** A stopwatch: the seconds hand on or off. */
export const SECONDS_GLYPH = "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 13l3-3M10 2h4M12 2v3";
/** A dial with a second ring: the 24-hour ring. */
export const RING24_GLYPH =
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 3v2M21 12h-2M12 21v-2M3 12h2";
/** An hour back (west): the zone one hour behind. */
export const ZONE_BACK_GLYPH = "M12 20a8 8 0 1 0-8-8M4 12l-2-3M4 12l3-2M12 8v4l2 2";
/** An hour ahead (east): the zone one hour ahead. */
export const ZONE_AHEAD_GLYPH = "M12 20a8 8 0 1 1 8-8M20 12l2-3M20 12l-3-2M12 8v4l-2 2";
/** Three dials: the next style. */
export const DIAL_GLYPH =
  "M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z";
