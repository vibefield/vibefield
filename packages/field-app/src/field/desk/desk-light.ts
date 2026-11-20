import {
  DEFAULT_MAT_CONFIG,
  EIGENGRAU,
  type GroundTheme,
  lightText,
  MAT_COLORS,
  MAT_GRID,
  type MatConfig,
  NIGHT,
  type NightSpec,
  nightLight,
  SOFT_LIGHT,
  setLightText,
  softShade,
} from "@vibecook/ice/desk";
import type { DeskLightValues } from "@vibefield/contracts";

// THE DESK'S LIGHT (item 583; DESIGN.md §2.1 "soft light" and "the gentler night", §8 "Settings → Canvas"; ICE I56):
// what a person's rows mean to the engine. By day the mat is under SOFT LIGHT, the chosen plant's plate laid flat in
// two layers and read through a soft disc; by night under the GENTLER NIGHT. One pure function turns the seven rows
// into ICE's config (`deskLightLook`), so the desk, the catalog's specimen and the tests read the same numbers.

/**
 * THE LIGHT'S TEXT. ICE draws soft light and the night's contrast from a second TEXT of its light shader, chosen ONCE
 * per page, before any desk program is composed (the mat's, a kind's, a plugin's: they share this page's ICE). This
 * module chooses it as it loads, and the mounts import it before anything that draws a desk. ICE refuses the choice
 * when a program composed the light first; the desk then wears the cone and ICE's own night, and says so once in its
 * log (`deskLightRefusal`): an honest state, never a desk that fails to mount.
 */
let refusal: string | null = null;
try {
  setLightText("soft");
} catch (error) {
  refusal = error instanceof Error ? error.message : String(error);
}
/** The text this page's desks are drawn from: `soft`, or `cone` where ICE refused the choice. */
export const DESK_LIGHT_TEXT = lightText();
/** Why this page has the cone's text, when it does: ICE's own words. */
export const deskLightRefusal = (): string | null => refusal;

/** The Sun's warmth the shade is weighed against (ICE's `softShade`): fixed, never a row. */
const SUN = 0.12;

export interface DeskLightLook {
  /** The gobo's part of the mat's config, for the mount's grid and for `configureMat({ gobo })`. */
  readonly gobo: MatConfig["gobo"];
  /** The desk's ambient: the wind blows until the desk has rested (`idle`), or never (`still`: Wind at Still). */
  readonly ambient: "idle" | "still";
}

/**
 * A person's rows as the engine's numbers (the table is DESIGN.md §2.1's):
 * - Plant: `none` turns the gobo off (opacity 0); a plant's plate goes into slot `c` (`desk-feed.ts`).
 * - Mirror: both layers flipped left to right.
 * - Softness: × each layer's blur disc. Size: × each layer's side.
 * - Shade and Tint: the deepest shade's depth and its pull toward the sky, through ICE's `softShade`.
 * - Wind: × the silhouette's wind strength and × the layers' sway; at 0 the ambient is still.
 * The room's light stays over the viewport while the desk moves underneath it (`space`), as before.
 */
export function deskLightLook(values: DeskLightValues): DeskLightLook {
  const base = { ...DEFAULT_MAT_CONFIG.gobo, space: "viewport" as const };
  const opacity = values.plant === "none" ? 0 : base.opacity;
  const ambient = values.wind > 0 ? "idle" : "still";
  if (DESK_LIGHT_TEXT !== "soft") return { gobo: { ...base, opacity }, ambient };
  const layer = (from: typeof SOFT_LIGHT.near) => ({
    ...from,
    span: from.span * values.size,
    disc: from.disc * values.softness,
  });
  return {
    gobo: {
      ...base,
      opacity,
      model: "soft",
      strength: MAT_GRID.gobo.plates.c.strength * values.wind,
      softLight: {
        ...SOFT_LIGHT,
        near: layer(SOFT_LIGHT.near),
        far: layer(SOFT_LIGHT.far),
        mirror: values.mirror,
        sway: SOFT_LIGHT.sway * values.wind,
        shade: softShade(values.shade, values.tint, SUN),
      },
    },
    ambient,
  };
}

/**
 * THE GENTLER NIGHT (DESIGN.md §2.1): the Moon's colour and the eye's noise are ICE's; the scene is lit a little more
 * and adapted to (lux, adaptation), its shadow keeps half the light (fill), and the dark-adapted eye's report loses
 * contrast as a scene in a dim surround does (contrast), taken from what the day shows (fromDay) at a stated level
 * (exposure). No row of Settings moves it: the theme decides the night.
 */
export const DESK_NIGHT: NightSpec = {
  kelvin: NIGHT.kelvin,
  lux: 0.74,
  fill: 0.5,
  rodHue: { nm: 485, purity: 0.2 },
  eigengrau: EIGENGRAU,
  // the level is stated (`exposure`), so nothing is fitted to a lit luminance
  litLuminance: 0,
  snow: NIGHT.snow,
  surround: NIGHT.surround,
  contrast: 0.855,
  fromDay: 1,
  exposure: 0.42,
  adaptation: 0.85,
};

let moon: GroundTheme["matLight"] | null = null;

/** ICE's theme with the desk's night: the gentler night in the dark theme, where this page's text can draw it. */
export function deskNightTheme(theme: GroundTheme): GroundTheme {
  if (theme.name !== "dark" || DESK_LIGHT_TEXT !== "soft") return theme;
  moon ??= nightLight(DESK_NIGHT, MAT_COLORS.ground);
  return { ...theme, matLight: moon };
}

/** Under the Moon the plant's shadow over the lit mat, per channel, as the display shows the two (DESIGN.md §2.1: the
 * gentler night's (41, 53, 59) in the shadow over (52, 69, 72) in the dapples). No row moves it. */
const MOON_SHADE = [41 / 52, 53 / 69, 59 / 72] as const;

/**
 * The colour Settings' still multiplies the mat by where the plant's shadow is deepest (`LightSettingsModel.shade`):
 * by day the engine's own shade for the rows, written as the display shows it (the chain's light through 1 / 2.2); by
 * night the Moon's. A likeness for a preview; the desk behind it is the engine's.
 */
export function deskShadeCss(values: DeskLightValues, theme: "light" | "dark"): string {
  const shade =
    theme === "dark"
      ? MOON_SHADE
      : softShade(values.shade, values.tint, SUN).map((light) => light ** (1 / 2.2));
  return `rgb(${shade.map((share) => `${Math.round(Math.min(1, share) * 1000) / 10}%`).join(" ")})`;
}
