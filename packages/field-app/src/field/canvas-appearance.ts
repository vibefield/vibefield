// The canvas's plain ground (DESIGN.md §2.1): `--vf-canvas-bg`, the ground the field's wrapper projects
// and the one the unavailable card stands on when nothing can draw the desk (§8). DK-17 (the retire
// table's magnet/world-grid row): the 0.11 ground's half of this file — ICE's retired `GridConfig` and
// `GridMagnetConfig` shapes, the world grid's projection, the magnet's tuning and the dot inks that fed
// it — left with that ground; the desk draws its own mat (`GridConfig { fadeIn, mat }`, ICE's `/desk`).
// ICE's own theme test reads the two literals below by name (`packages/objects/test/vf-theme.test.ts`,
// risk 9): keep them string literals.

/** Theme-aware colors of the canvas's plain ground. */
export interface CanvasPalette {
  bgLight: string;
  bgDark: string;
}

export interface CanvasAppearance {
  canvasPalette: CanvasPalette;
}

/**
 * The reviewed product appearance. A factory keeps Studio edits and
 * imports isolated from the immutable defaults consumed by the app.
 */
export function defaultCanvasAppearance(): CanvasAppearance {
  return {
    canvasPalette: {
      bgLight: "#FAFAFA",
      bgDark: "#171717",
    },
  };
}
