import type { MonitorParameterGroup } from "../../monitor/parameters";

export interface RainParameters {
  speedMultiplier: number;
  tailMultiplier: number;
  refreshRate: number;
  scrambleWorking: number;
  scramblePending: number;
  fontSize: number;
  headGlow: number;
  paneTint: number;
}

export const DEFAULT_RAIN_PARAMETERS: Readonly<RainParameters> = {
  speedMultiplier: 1,
  tailMultiplier: 1,
  refreshRate: 30,
  scrambleWorking: 0.15,
  scramblePending: 0.8,
  // The prototype's 16px sat on a ~50-row window; the stage is shorter, and
  // rows are what the stream needs to spell anything.
  fontSize: 12,
  headGlow: 10,
  paneTint: 0.12,
};

export const RAIN_PARAMETER_GROUPS: readonly MonitorParameterGroup[] = [
  {
    title: "STREAM",
    controls: [
      {
        key: "speedMultiplier",
        label: "Clock speed",
        min: 0.1,
        max: 5,
        step: 0.1,
        defaultValue: 1,
      },
      {
        key: "tailMultiplier",
        label: "Tail multiplier",
        min: 0.2,
        max: 3,
        step: 0.1,
        defaultValue: 1,
      },
      // Deliberately low by default: the chunky repaint is the terminal feel.
      { key: "refreshRate", label: "Refresh rate", min: 10, max: 60, step: 1, defaultValue: 30 },
    ],
  },
  {
    title: "LEGIBILITY",
    controls: [
      {
        key: "scrambleWorking",
        label: "Work scramble",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.15,
      },
      {
        key: "scramblePending",
        label: "Pend scramble",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.8,
      },
      { key: "fontSize", label: "Terminal font", min: 8, max: 36, step: 1, defaultValue: 12 },
    ],
  },
  {
    title: "PRESENTATION",
    controls: [
      { key: "headGlow", label: "Head glow", min: 0, max: 40, step: 1, defaultValue: 10 },
      { key: "paneTint", label: "Pane tint", min: 0, max: 0.4, step: 0.02, defaultValue: 0.12 },
    ],
  },
];

const definitions = RAIN_PARAMETER_GROUPS.flatMap((group) => group.controls);

export function normalizeRainParameters(value: unknown): RainParameters {
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof RainParameters, unknown>>)
      : {};
  const normalized = { ...DEFAULT_RAIN_PARAMETERS };
  for (const definition of definitions) {
    const key = definition.key as keyof RainParameters;
    const candidate = source[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    normalized[key] = Math.max(definition.min, Math.min(definition.max, candidate));
  }
  return normalized;
}
