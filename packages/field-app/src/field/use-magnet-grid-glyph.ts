import { useCallback, useEffect, useState } from "react";
import type { MagnetGridGlyph } from "./canvas-appearance";

/** Device-local tuning for ICE's build-selected magnet grid implementation. */
export const MAGNET_GRID_GLYPH_STORAGE_KEY = "vf-magnet-grid-glyph";

function initialMagnetGridGlyph(): MagnetGridGlyph {
  try {
    return localStorage.getItem(MAGNET_GRID_GLYPH_STORAGE_KEY) === "needle" ? "needle" : "dot";
  } catch {
    return "dot";
  }
}

export function useMagnetGridGlyph(): {
  magnetGridGlyph: MagnetGridGlyph;
  setMagnetGridGlyph: (glyph: MagnetGridGlyph) => void;
} {
  const [magnetGridGlyph, setMagnetGridGlyphState] = useState(initialMagnetGridGlyph);
  useEffect(() => {
    try {
      localStorage.setItem(MAGNET_GRID_GLYPH_STORAGE_KEY, magnetGridGlyph);
    } catch {
      /* preference stays session-local when storage is unavailable */
    }
  }, [magnetGridGlyph]);
  const setMagnetGridGlyph = useCallback(
    (glyph: MagnetGridGlyph) => setMagnetGridGlyphState(glyph),
    [],
  );
  return { magnetGridGlyph, setMagnetGridGlyph };
}
