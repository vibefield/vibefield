import type { MonitorParameterGroup } from "@vibecook/puppeteer-views";

/**
 * Stage-level tunables, which belong to no single view.
 *
 * The reference splits the same way and for the same reason: splitting these out
 * is what lets a view's own controls come and go with it. The CRT group is part
 * of that source's exact visual signature and is now part of DESIGN.md §1.1.
 *
 * The monitor's HEIGHT is no tunable since N15 (a) (James 2026-10-11): the
 * `Monitor height` slider that stood here (35%, a 170px floor) is gone, and the
 * deck rests at the ruled drawing's share of the stage above a floor (DESIGN.md
 * §8 "Rest"; `--vf-godview-deck-rest`). A height an older build stored is
 * dropped as the stored bag is read.
 */
export const STAGE_PARAMETER_GROUPS: readonly MonitorParameterGroup[] = [
  {
    title: "CRT OVERLAYS",
    controls: [
      { key: "scanlineDensity", label: "Line density", min: 2, max: 16, step: 1, defaultValue: 2 },
      {
        key: "scanlineOpacity",
        label: "Line opacity",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.4,
      },
      {
        key: "vignetteOpacity",
        label: "Vignette",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 1,
      },
    ],
  },
];

export const SCANLINE_DENSITY_KEY = "scanlineDensity";
export const SCANLINE_OPACITY_KEY = "scanlineOpacity";
export const VIGNETTE_OPACITY_KEY = "vignetteOpacity";
