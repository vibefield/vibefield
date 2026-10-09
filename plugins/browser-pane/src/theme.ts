// The BROWSER PANE's LOOK (BROWSER.md §3; the prototype's lab/theme.ts `PANE_FINISHES`, `BROWSER_LOOK`, `paneFinish`,
// `paneLook`, moved). Its colours are its own, like the clock's dials and the pad's paper — the glass, the frost, the
// page's dark film, and the environment the glass mirrors (the phone's: one sky over one desk) — as TOKENS, each naming
// its source; a host may dress the pane by naming `browserPanes` in its palette (`BrowserPanePalette`). Two are read
// from the host's palette: the loading line is the host's selection colour (`select`, the lab's), and nothing else.
//
// A FINISH is the glass: the colour a long path through it shows (what you see looking into its edge) and the path that
// colour is measured over, in mm — low-iron glass (the default: water-white, a whisper of aqua at the edge), ordinary
// float glass (the green edge iron gives it), a grey smoke, a bronze. None is a DESIGN.md token yet: the material book
// moves first (BROWSER.md Q-10).
//
// THE CAST: the colour a shadow casts on the mat is the desk's (ICE `MAT_COLORS.cast` — the tree-shadow design's
// `--cast-rgb`), which the SDK's door does not carry (PT-1 ruling 10). The pane keeps a COPY here, named for its
// source, until the cast is a palette role (the ask: I46) — the comment pad draws its shadow black instead.
//
// The same colours by day and by night: the LIGHT changes (the Moon, the night's chain — the kit's).

import { type Palette, type RGB, rgb, type TokenRef } from "@vibefield/plugin-sdk/desk";
import { PANE_FINISHES, type PaneFinishName } from "./ids";
import type { PaneFinish, PaneLookValues } from "./layout";

/** A finish as a token: its edge colour and the path (mm) the colour is measured over. */
export interface FinishToken extends TokenRef {
  readonly path: number;
}

/** The pane's own colours as tokens (a CSS colour each; `token` names its source). */
export interface PaneTokens {
  readonly finishes: Readonly<Record<PaneFinishName, FinishToken>>;
  readonly panelOff: TokenRef;
  readonly frost: TokenRef;
  readonly cast: TokenRef;
  readonly sky: TokenRef;
  readonly leaves: TokenRef;
  readonly room: TokenRef;
  readonly nightSky: TokenRef;
  readonly nightLeaves: TokenRef;
}

/** A host's palette as the pane reads it: its `select` (the loading line), and optionally its own dress for the pane. */
export interface BrowserPanePalette extends Palette {
  readonly browserPanes?: PaneTokens;
}

const t = (token: string, css: string): TokenRef => ({ token: `browser-pane: ${token}`, css });
const glass = (token: string, css: string, path: number): FinishToken => ({
  ...t(token, css),
  path,
});

/** The plugin's own dress (the prototype's, value for value). */
export const BROWSER_PANE_PALETTE: PaneTokens = {
  finishes: {
    "low-iron": glass(
      "low-iron glass: water-white, aqua at the edge (a 100 mm path)",
      "#c9e4dd",
      100,
    ),
    float: glass("float glass: the green edge iron gives it (a 100 mm path)", "#7fae8e", 100),
    smoke: glass("grey smoked glass (a 40 mm path)", "#5d6163", 40),
    bronze: glass("bronze-tinted glass (a 40 mm path)", "#8d6f55", 40),
  },
  panelOff: t("a page's film with nothing on it (the phone's black, a hair lifted)", "#08090b"),
  frost: t("sandblasted glass (a pale grey-white)", "#e4e6e2"),
  cast: t(
    "the mat's cast — a copy of ICE MAT.cast (tree-shadow --cast-rgb) until the desk lends it (I46)",
    "#0e1a0a",
  ),
  sky: t(
    "the day's sky over the desk, mirrored (a pale, slightly cool white — the phone's)",
    "#dfe7ee",
  ),
  leaves: t(
    "the palm's leaves against the sky, back-lit (a leaf in shade — the phone's)",
    "#26331d",
  ),
  room: t("the room's dim side, mirrored at a slant (the phone's)", "#6b7075"),
  nightSky: t("the Moon's sky, mirrored (the phone's)", "#0f1726"),
  nightLeaves: t("the canopy by night (the phone's)", "#040605"),
};

/** A finish's glass, parsed: the edge colour and the path it is measured over (mm). */
export const paneFinish = (look: PaneLookValues, name: string): PaneFinish =>
  look.finishes[name] ?? (look.finishes["low-iron"] as PaneFinish);

/** The look the record reads: the pane's colours parsed, the host's selection as the loading line. */
export function paneLook(palette: BrowserPanePalette): PaneLookValues {
  const own = palette.browserPanes ?? BROWSER_PANE_PALETTE;
  const finishes: Record<string, PaneFinish> = {};
  for (const name of PANE_FINISHES) {
    const f = own.finishes[name] ?? BROWSER_PANE_PALETTE.finishes[name];
    finishes[name] = { edge: rgb(f.css), path: f.path };
  }
  const c = (token: TokenRef): RGB => rgb(token.css);
  return {
    cast: c(own.cast),
    panelOff: c(own.panelOff),
    frost: c(own.frost),
    progress: rgb(palette.select.css),
    sky: c(own.sky),
    leaves: c(own.leaves),
    room: c(own.room),
    nightSky: c(own.nightSky),
    nightLeaves: c(own.nightLeaves),
    finishes,
  };
}
