import { useEffect, useState } from "react";
import { hexToRgb255 } from "../../field/theme-constants";
import type { AgentVisualStatus } from "./agent-status";

// The monitor's colors, READ FROM THE TOKENS — `deck-theme.ts`'s idiom, applied
// to a stage that draws on canvas as well as in the DOM.
//
// Two of the three views paint into a canvas (the swarm's bodies are DOM but its
// physics is not; the rain is entirely 2D context), and a canvas cannot inherit
// a custom property. So the values are RESOLVED once at mount and re-resolved
// when the theme changes, exactly the way the deck's terminal palette is built
// from `--vf-*` instead of transcribed. Transcribing here would put DESIGN.md's
// numbers in a second place and guarantee they drift the first time §2 moves.
//
// The mapping is GT-D13's, which is §2.5's:
//   working → --vf-green    · the healthy, running state
//   waiting → --vf-orange   · "needs attention", and the Godview ring-1 color
//   idle    → the text ramp · muted, no hue — §2.5 is explicit that waiting/idle
//                             take the ramp rather than a status color, because
//                             an agent doing nothing is not a state to alarm at
// and the per-agent relationship color is §2.6's organizational accent set,
// which groups and labels and never signals state.

/** How many accent slots §2.6 defines. Read here so a ninth accent is one token
 * plus this number, not a hunt through the views. */
export const ACCENT_SLOTS = 8;

export interface MonitorPalette {
  /** §2.6, in declared order. Index is the accent SLOT an id hashes to. */
  accents: readonly string[];
  /** §2.5 + §2.4, as CSS colors. */
  status: Readonly<Record<AgentVisualStatus, string>>;
  /** The same three, as `"r, g, b"` for canvas `rgba()` composition. */
  statusRgb: Readonly<Record<AgentVisualStatus, string>>;
  /** The control-room stage's own ground, for a canvas that must clear itself. */
  stage: string;
  /** §2.4's ramp on a dark surface: primary, secondary, tertiary. */
  text: { primary: string; secondary: string; tertiary: string };
  /** Canvas-only colors from the Chopsticks rain view. DOM views consume the
   * scoped Godview CSS palette directly; canvas needs these resolved values. */
  rain: {
    stage: string;
    activeHead: string;
    hoverTailRgb: string;
    status: Readonly<Record<AgentVisualStatus, { head: string; tailRgb: string; speed?: number }>>;
  };
}

/** DESIGN.md §2.4 — text is surface color + opacity, never a fixed gray. The
 * Godview commits to dark in both app themes (GT-2), so the surface color here
 * is white and these are the ramp, not invented values. */
const TEXT_PRIMARY = "rgba(255,255,255,1)";
const TEXT_SECONDARY = "rgba(255,255,255,0.7)";
const TEXT_TERTIARY = "rgba(255,255,255,0.4)";

function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/**
 * Sample the live tokens.
 *
 * Fallbacks are BLACK-ish rather than plausible colors on purpose: an absent
 * token means the stylesheet is not in the document, and a monitor that quietly
 * paints a hardcoded green in that case would be hiding the fault it should be
 * showing. The one exception is the accent list, which falls back to the stage
 * color — every bubble the same, obviously wrong, cheap to notice.
 */
export function readMonitorPalette(): MonitorPalette {
  const stage = readToken("--vf-card-deep", "#000000");
  const accents = Array.from({ length: ACCENT_SLOTS }, (_, index) =>
    readToken(`--vf-accent-${index + 1}`, stage),
  );
  const status = {
    working: readToken("--vf-green", "#000000"),
    waiting: readToken("--vf-orange", "#000000"),
    idle: TEXT_TERTIARY,
  } as const;
  return {
    accents,
    status,
    statusRgb: {
      working: hexToRgb255(status.working),
      waiting: hexToRgb255(status.waiting),
      // The ramp is already an rgba; its channels are white by construction.
      idle: "255, 255, 255",
    },
    stage,
    text: { primary: TEXT_PRIMARY, secondary: TEXT_SECONDARY, tertiary: TEXT_TERTIARY },
    rain: {
      stage: readToken("--vf-card-deep", "#000000"),
      activeHead: readToken("--vf-godview-rain-working-head", "#ffffff"),
      hoverTailRgb: hexToRgb255(readToken("--vf-godview-rain-hover-tail", "#000000")),
      status: {
        working: {
          head: readToken("--vf-godview-rain-working-head", "#ffffff"),
          tailRgb: hexToRgb255(readToken("--vf-godview-rain-working-tail", "#000000")),
        },
        waiting: {
          head: readToken("--vf-godview-rain-waiting-head", "#ffffff"),
          tailRgb: hexToRgb255(readToken("--vf-godview-rain-waiting-tail", "#000000")),
          speed: 0.02,
        },
        idle: {
          head: readToken("--vf-godview-rain-idle-head", "#ffffff"),
          tailRgb: hexToRgb255(readToken("--vf-godview-rain-idle-tail", "#000000")),
          speed: 0.1,
        },
      },
    },
  };
}

/**
 * The palette, live.
 *
 * Re-sampled on a `data-theme` change because that is how the spine stamps a
 * theme (`theme.ts`: the `.dark` class and `data-theme` move together). Today
 * §2.6's accents and §2.5's states are theme-invariant, so this observer will
 * usually change nothing — it is here so that the day one of them GAINS a dark
 * variant, the canvas views follow without anyone remembering they exist.
 */
export function useMonitorPalette(): MonitorPalette {
  const [palette, setPalette] = useState(readMonitorPalette);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setPalette(readMonitorPalette()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    // The first read happened during the initial state, which for the very first
    // mount can precede the stylesheet. Re-read once on commit so a monitor that
    // opened mid-load does not keep the fallbacks it was born with.
    setPalette(readMonitorPalette());
    return () => observer.disconnect();
  }, []);
  return palette;
}
