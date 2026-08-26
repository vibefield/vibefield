import { useCallback, useEffect, useState } from "react";

/**
 * The magnet grid's DOT mode as a device preference (ICE design-010).
 *
 * The magnet grid replaces the classic dot grid's pixels — not its interfaces
 * — with a field-reactive lattice; in dot mode each site stays on the lattice
 * and swells with field strength, resting at the classic dot radius. Our
 * cursor halo drives the field through the `haloPoles` adapter
 * (cursor/halo-poles.ts), already wired and inert while this is off.
 *
 * Persisted per device (localStorage at P0), mirroring `useTheme` — the same
 * P0-graduates-to-D29-device-scope posture; it is presentation preference,
 * never document state, so it never touches the doc.
 *
 * ONLY the dot glyph is exposed. Needle mode is deliberately not offered:
 * our dark canvas ink (#1C1C1C on #171717) reads as invisible in thin
 * strokes, while dots keep the classic radius floor and stay legible in both
 * themes (ICE design-010 §7 dark-ink caveat).
 */
const KEY = "vf-magnet-dots";

function initialMagnetDots(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false; // private mode / blocked storage — classic grid, the default
  }
}

export function useMagnetDots(): { magnetDots: boolean; setMagnetDots: (on: boolean) => void } {
  const [magnetDots, setMagnetDotsState] = useState(initialMagnetDots);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(magnetDots));
    } catch {
      /* preference stays session-local */
    }
  }, [magnetDots]);
  const setMagnetDots = useCallback((on: boolean) => setMagnetDotsState(on), []);
  return { magnetDots, setMagnetDots };
}
