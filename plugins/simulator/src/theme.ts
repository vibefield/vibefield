// The PHONE's LOOK (DESIGN.md §5.1, "The phone's materials" — every colour here is a number of that section's, and
// test/design.test.ts holds them to it; the prototype's lab/theme.ts `PHONE_FINISHES`, `PHONE_LOOK`, `phoneFinish`,
// `phoneLook`, moved). Its colours are its own, like the clock's dials and the pane's glass — as TOKENS, each naming its
// DESIGN.md source; a host may dress the phone by naming `simulators` in its palette (`SimulatorPalette`). One is read from
// the host's palette: the colour a shadow casts on the mat (`KindPalette.cast`, ICE I46 — the desk's, never a copy).
//
// A FINISH is a model's launch colour: the band's colour from above (its metal's own — which metal is the model's,
// catalog.gen.ts) and the colour of the glass's border ink (white on the silver, gold and rose gold home-button phones and
// the 7's red, black on every other), with a mirror polish where the metal was finished to one. Approximated from product
// imagery. What a finish and a metal MEAN is the device's likeness — which iPhone the object stands for (DESIGN.md §5.1,
// James's choice 6, ruled 2026-10-29): they say which device, and nothing else.
//
// The same colours by day and by night: the LIGHT changes (the Moon, the night's chain — the kit's).

import {
  type KindPalette,
  MISSING_INK,
  type RGB,
  rgb,
  type TokenRef,
} from "@vibefield/plugin-sdk/desk";
import type { FinishValues, PhoneLookValues } from "./layout";

/** A finish as a token: its band's colour (`css`), its front's ink, its polish (0 satin … 1 a mirror). */
export interface FinishToken extends TokenRef {
  readonly front: "black" | "white";
  readonly polish: number;
}

const SOURCE = "DESIGN.md §5.1 the phone";
const fin = (
  launched: string,
  css: string,
  front: "black" | "white" = "black",
  polish = 0,
): FinishToken => ({
  token: `${SOURCE}: finish — ${launched}`,
  css,
  front,
  polish,
});

/** Every model's launch finishes (DESIGN.md §5.1's finishes table, row for row), keyed as the catalog names them. */
export const SIMULATOR_FINISHES: Readonly<Record<string, FinishToken>> = {
  "space-gray-6s": fin("6s · SE · Space Gray", "#86878b"),
  "silver-6s": fin("6s · SE · 7 · Silver", "#d9dadc", "white"),
  "gold-6s": fin("6s · SE · 7 · Gold", "#e3cdb0", "white"),
  "rose-gold-6s": fin("6s · SE · 7 · Rose Gold", "#e7c5bd", "white"),
  "black-7": fin("7 · Black", "#2a2b2e"),
  "jet-black": fin("7 · Jet Black", "#0c0c0e", "black", 1),
  "red-7": fin("7 · (PRODUCT)RED", "#b0121f", "white"),
  "space-gray-8": fin("8 · Space Gray", "#707174"),
  "silver-8": fin("8 · Silver", "#dcdcde", "white"),
  "gold-8": fin("8 · Gold", "#e9d4bd", "white"),
  "red-8": fin("8 · (PRODUCT)RED", "#a5061a"),
  "space-gray-x": fin("X · Xs · Space Gray (steel)", "#4a4a4d"),
  "silver-x": fin("X · Xs · Silver (steel)", "#d6d6d8"),
  "gold-xs": fin("Xs · Gold (steel)", "#e6c8a0"),
  "black-xr": fin("Xʀ · Black", "#28292c"),
  "white-xr": fin("Xʀ · White", "#e9e9ea"),
  "blue-xr": fin("Xʀ · Blue", "#3e84c6"),
  "yellow-xr": fin("Xʀ · Yellow", "#f6c93f"),
  "coral-xr": fin("Xʀ · Coral", "#f36b5a"),
  "red-xr": fin("Xʀ · 11 · (PRODUCT)RED", "#b2091c"),
  "black-11": fin("11 · Black", "#2b2c2f"),
  "white-11": fin("11 · White", "#eaeaea"),
  "green-11": fin("11 · Green", "#b3d5c2"),
  "yellow-11": fin("11 · Yellow", "#f7e5a0"),
  "purple-11": fin("11 · Purple", "#d2cce2"),
  "midnight-green": fin("11 Pro · Midnight Green (steel)", "#4d5a52"),
  "space-gray-11p": fin("11 Pro · Space Gray (steel)", "#52504e"),
  "silver-11p": fin("11 Pro · Silver (steel)", "#dcdcd9"),
  "gold-11p": fin("11 Pro · Gold (steel)", "#e5cdb0"),
  "black-se": fin("SE (2nd) · Black", "#2a2a2d"),
  "white-se": fin("SE (2nd) · White", "#e5e5e6"),
  "red-se": fin("SE · (PRODUCT)RED", "#b3001d"),
  "black-12": fin("12 · Black", "#232427"),
  "white-12": fin("12 · White", "#efefee"),
  "blue-12": fin("12 · Blue", "#1f4f80"),
  "green-12": fin("12 · Green", "#c7e2cd"),
  "purple-12": fin("12 · Purple", "#bab1e5"),
  "red-12": fin("12 · 13 · 14 · (PRODUCT)RED", "#b10a21"),
  "pacific-blue": fin("12 Pro · Pacific Blue (steel)", "#2e4d5b"),
  graphite: fin("12 Pro · 13 Pro · Graphite (steel)", "#4f4e4b"),
  "silver-steel": fin("12 Pro · 13 Pro · 14 Pro · Silver (steel)", "#dcdcd8"),
  "gold-steel": fin("12 Pro · 13 Pro · Gold (steel)", "#eed8b6"),
  midnight: fin("13 · 14 · SE (3rd) · Midnight", "#232a31"),
  starlight: fin("13 · 14 · SE (3rd) · Starlight", "#eeeae2"),
  "blue-13": fin("13 · Blue", "#2b5c86"),
  "pink-13": fin("13 · Pink", "#f4d7d4"),
  "green-13": fin("13 · Green", "#3c4d3a"),
  "sierra-blue": fin("13 Pro · Sierra Blue (steel)", "#9fb7cf"),
  "alpine-green": fin("13 Pro · Alpine Green (steel)", "#56695a"),
  "blue-14": fin("14 · Blue", "#a1b5c8"),
  "purple-14": fin("14 · Purple", "#e1d8e8"),
  "yellow-14": fin("14 · Yellow", "#f7e27b"),
  "deep-purple": fin("14 Pro · Deep Purple (steel)", "#5a4f64"),
  "space-black": fin("14 Pro · Space Black (steel)", "#3f3d3c"),
  "gold-14p": fin("14 Pro · Gold (steel)", "#f3e5cb"),
  "pink-15": fin("15 · Pink", "#f3cfd3"),
  "black-15": fin("15 · Black", "#34383a"),
  "blue-15": fin("15 · Blue", "#cbdbe5"),
  "green-15": fin("15 · Green", "#d8e3d3"),
  "yellow-15": fin("15 · Yellow", "#f6ebbf"),
  "natural-titanium": fin("15 Pro · 16 Pro · Natural Titanium", "#b4ada3"),
  "blue-titanium": fin("15 Pro · Blue Titanium", "#3e4855"),
  "white-titanium": fin("15 Pro · 16 Pro · White Titanium", "#dddbd6"),
  "black-titanium": fin("15 Pro · 16 Pro · Black Titanium", "#3a3938"),
  ultramarine: fin("16 · Ultramarine", "#5a6fe0"),
  "teal-16": fin("16 · Teal", "#98cbc4"),
  "pink-16": fin("16 · Pink", "#efabc4"),
  "white-16": fin("16 · White", "#f1f1f1"),
  "black-16": fin("16 · Black", "#3b3c3e"),
  "desert-titanium": fin("16 Pro · Desert Titanium", "#c4ab94"),
  "black-16e": fin("16e · Black", "#2b2c2e"),
  "white-16e": fin("16e · White", "#ebe9e5"),
  lavender: fin("17 · Lavender", "#cfc3e3"),
  "mist-blue": fin("17 · Mist Blue", "#a7bbd2"),
  "sage-17": fin("17 · Sage", "#b3bea3"),
  "white-17": fin("17 · White", "#f0f0ee"),
  "black-17": fin("17 · Black", "#2b2c2e"),
  "cosmic-orange": fin("17 Pro · Cosmic Orange", "#e0692a"),
  "deep-blue": fin("17 Pro · Deep Blue", "#2b3c5c"),
  "silver-17p": fin("17 Pro · Silver", "#dededb"),
  "sky-blue": fin("Air · Sky Blue (titanium)", "#cadcec"),
  "light-gold": fin("Air · Light Gold (titanium)", "#eddcc0"),
  "cloud-white": fin("Air · Cloud White (titanium)", "#f2f1ed"),
  "space-black-air": fin("Air · Space Black (titanium)", "#28292b"),
};

/** The phone's own colours as tokens (a CSS colour each; `token` names its DESIGN.md source). */
export interface SimulatorTokens {
  /** The border ink under the glass round the display: black, and the white fronts' white. */
  readonly inkBlack: TokenRef;
  readonly inkWhite: TokenRef;
  /** A panel that is off: an OLED's true black; an LCD's backlight grey-blue. */
  readonly oledOff: TokenRef;
  readonly lcdOff: TokenRef;
  /** The sensor housing's glass (the Simulator's own sensor-bar fill), a lens's coated glass and its ring, an earpiece's mesh. */
  readonly housing: TokenRef;
  readonly lens: TokenRef;
  readonly lensRing: TokenRef;
  readonly mesh: TokenRef;
  /** The sky the glass mirrors — the pane's, one sky over one desk: by day the sky, the leaves against it, the room; by night the Moon's sky, the canopy. */
  readonly sky: TokenRef;
  readonly leaves: TokenRef;
  readonly room: TokenRef;
  readonly nightSky: TokenRef;
  readonly nightLeaves: TokenRef;
  /** The words a face says, and the marks a still carries. */
  readonly words: TokenRef;
}

/** A host's palette as the phone reads it: its `cast` (the shadow's colour on the mat), and optionally its own dress for the phone. */
export interface SimulatorPalette extends KindPalette {
  readonly simulators?: SimulatorTokens;
}

const t = (what: string, css: string): TokenRef => ({ token: `${SOURCE}: ${what}`, css });

/** The plugin's own dress (DESIGN.md §5.1's recipes table, value for value). */
export const SIMULATOR_PALETTE: SimulatorTokens = {
  inkBlack: t("border ink, black", "#0b0c0e"),
  inkWhite: t("border ink, white", "#f0efeb"),
  oledOff: t("panel off, OLED", "#050507"),
  lcdOff: t("panel off, LCD", "#0e1014"),
  housing: t("sensor housing", "#1a191a"),
  lens: t("a lens", "#0a0f1c"),
  lensRing: t("a lens's ring", "#2a2c33"),
  mesh: t("an earpiece's mesh", "#1e1f22"),
  sky: t("the sky the glass mirrors, day sky", "#dfe7ee"),
  leaves: t("the sky the glass mirrors, leaves", "#26331d"),
  room: t("the sky the glass mirrors, room", "#6b7075"),
  nightSky: t("the sky the glass mirrors, night sky", "#0f1726"),
  nightLeaves: t("the sky the glass mirrors, canopy", "#040605"),
  words: t("the words on a face", "#e6e8ea"),
};

/** The first finish of the table — what an unknown name is drawn in (law.ts `finishOf` keeps names to a model's own). */
const FIRST_FINISH = Object.keys(SIMULATOR_FINISHES)[0] ?? "";

/** What a finish is drawn in when its look holds none at all (a host's dress that dropped the table): the desk's missing ink. */
const MISSING_FINISH: FinishValues = {
  band: [MISSING_INK[0], MISSING_INK[1], MISSING_INK[2]],
  front: [MISSING_INK[0], MISSING_INK[1], MISSING_INK[2]],
  white: 0,
  polish: 0,
};

/** A finish's colours as the record takes them (an unknown name: the table's first). */
export const phoneFinish = (look: PhoneLookValues, name: string): FinishValues =>
  look.finishes[name] ?? look.finishes[FIRST_FINISH] ?? MISSING_FINISH;

/** The look the record and the knobs read: the phone's colours parsed, the host's cast for its shadow. */
export function phoneLook(palette: SimulatorPalette): PhoneLookValues {
  const own = palette.simulators ?? SIMULATOR_PALETTE;
  const c = (token: TokenRef): RGB => rgb(token.css);
  const black = c(own.inkBlack);
  const white = c(own.inkWhite);
  const finishes: Record<string, FinishValues> = {};
  for (const [name, f] of Object.entries(SIMULATOR_FINISHES)) {
    const front = f.front === "white";
    finishes[name] = {
      band: rgb(f.css),
      front: front ? white : black,
      white: front ? 1 : 0,
      polish: f.polish,
    };
  }
  return {
    cast: rgb(palette.cast.css),
    oledOff: c(own.oledOff),
    lcdOff: c(own.lcdOff),
    housing: c(own.housing),
    lens: c(own.lens),
    lensRing: c(own.lensRing),
    mesh: c(own.mesh),
    sky: c(own.sky),
    leaves: c(own.leaves),
    room: c(own.room),
    nightSky: c(own.nightSky),
    nightLeaves: c(own.nightLeaves),
    words: c(own.words),
    finishes,
  };
}
