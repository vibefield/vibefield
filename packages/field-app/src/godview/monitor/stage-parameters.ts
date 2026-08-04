import type { MonitorParameterGroup } from "./parameters";

/**
 * Stage-level tunables — the monitor's share of the overlay, which belongs to no
 * single view.
 *
 * The reference splits the same way and for the same reason: splitting these out
 * is what lets a view's own controls come and go with it. Its second group (a
 * CRT scanline/vignette treatment over the whole window) is deliberately NOT
 * ported. That is the reference app's own art direction; ours is DESIGN.md, and
 * §5's material tiers are what this overlay already wears.
 *
 * Height matters more than it looks. The rain spells each agent's project,
 * branch, model and context down its column and needs enough rows to finish a
 * cycle; the swarm needs room for a 70px waiting body not to be wall-to-wall.
 * The default splits the overlay roughly a third/two-thirds — enough monitor to
 * read, enough deck to work in, which is the balance the reference landed on
 * after the same argument.
 */
export const STAGE_PARAMETER_GROUPS: readonly MonitorParameterGroup[] = [
  {
    title: "MONITOR STAGE",
    controls: [
      { key: "stageHeight", label: "Monitor height", min: 15, max: 70, step: 1, defaultValue: 34 },
    ],
  },
];

export const STAGE_HEIGHT_KEY = "stageHeight";
