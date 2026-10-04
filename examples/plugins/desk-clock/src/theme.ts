// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/src/theme.ts`, design-016 K8b) — re-wrapped by this repo's formatter,
// its imports moved to the SDK's `/desk` door — a VibeField plugin imports nothing of ICE but what the SDK re-exports (K-L1).

// The desk clock's LOOK: its dials' colours, per style — the plugin's own palette (a kind in its own package ships its look as the
// reference kinds ship theirs in `deskPalette`), which a host may replace by naming `clocks` in the palette it mounts the desk with
// (`ClockPalette`). The same colours by day and by night: the LIGHT changes (the Moon, the night's chain — the kit's), and the
// graphite dial's lume glows. The shader names no colour; the record carries these.

import { type Palette, type RGB, rgb, type TokenRef } from "@vibefield/plugin-sdk/desk";
import { CLOCK_STYLES, type ClockStyle } from "./law";
import type { DialColours } from "./layout";

/** One dial's colours as tokens (a CSS colour each; `token` names its source). */
export interface DialTokens {
  readonly dial: TokenRef;
  readonly grain: number;
  readonly ink: TokenRef;
  readonly case: TokenRef;
  readonly metal: number;
  readonly hands: TokenRef;
  readonly second: TokenRef;
  readonly lume: TokenRef;
  readonly glow: number;
}

/** A host's palette that names the clocks' dials — absent, the plugin's own (`CLOCK_PALETTE`). */
export interface ClockPalette extends Palette {
  readonly clocks?: Readonly<Record<ClockStyle, DialTokens>>;
}

const t = (token: string, css: string): TokenRef => ({ token: `desk-clock: ${token}`, css });

/** The plugin's dials: an ivory enamel in brass with blued hands; the railway's white and black with its red disc; graphite with lume. */
export const CLOCK_PALETTE: Readonly<Record<ClockStyle, DialTokens>> = {
  classic: {
    dial: t("classic dial, ivory enamel", "#f2ead8"),
    grain: 0.014,
    ink: t("classic printing", "#1d1a16"),
    case: t("classic case, brass", "#b8904a"),
    metal: 0.9,
    hands: t("classic hands, blued steel", "#1c2538"),
    second: t("classic seconds, red", "#a02a1c"),
    lume: t("classic, no lume", "#000000"),
    glow: 0,
  },
  station: {
    dial: t("station dial, white", "#f5f5f1"),
    grain: 0.006,
    ink: t("station bars, black", "#121212"),
    case: t("station case, steel", "#9aa1a8"),
    metal: 1,
    hands: t("station hands, black", "#121212"),
    second: t("station seconds, signal red", "#c8231a"),
    lume: t("station, no lume", "#000000"),
    glow: 0,
  },
  graphite: {
    dial: t("graphite dial", "#2b2e33"),
    grain: 0.01,
    ink: t("graphite printing", "#d6d7d1"),
    case: t("graphite case, dark steel", "#4b4f55"),
    metal: 0.75,
    hands: t("graphite hands", "#e7e5dc"),
    second: t("graphite seconds, orange", "#ef7b2b"),
    lume: t("graphite lume paint", "#bfe9c9"),
    glow: 0.85,
  },
};

/** The look the record reads: every style's colours, parsed. */
export interface ClockLook {
  readonly styles: Readonly<Record<ClockStyle, DialColours>>;
}

export function clockLook(
  dials: Readonly<Record<ClockStyle, DialTokens>> = CLOCK_PALETTE,
): ClockLook {
  const styles = {} as Record<ClockStyle, DialColours>;
  for (const s of CLOCK_STYLES) {
    const d = dials[s] ?? CLOCK_PALETTE[s];
    const c = (x: TokenRef): RGB => rgb(x.css);
    styles[s] = {
      dial: c(d.dial),
      grain: d.grain,
      ink: c(d.ink),
      case: c(d.case),
      metal: d.metal,
      hands: c(d.hands),
      second: c(d.second),
      lume: c(d.lume),
      glow: d.glow,
    };
  }
  return { styles };
}
