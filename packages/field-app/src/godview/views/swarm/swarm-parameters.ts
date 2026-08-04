import type { MonitorParameterGroup } from "../../monitor/parameters";

export interface SwarmParameters {
  gravityPull: number;
  restitution: number;
  frictionAir: number;
  bubbleFillOpacity: number;
  radiusIdle: number;
  radiusWorking: number;
  radiusWaiting: number;
}

export type SwarmParameterKey = keyof SwarmParameters;

export const DEFAULT_SWARM_PARAMETERS: Readonly<SwarmParameters> = {
  gravityPull: 0.0002,
  restitution: 0,
  frictionAir: 0.2,
  bubbleFillOpacity: 0.72,
  radiusIdle: 40,
  radiusWorking: 50,
  radiusWaiting: 70,
};

export const SWARM_PARAMETER_GROUPS: readonly MonitorParameterGroup[] = [
  {
    title: "ENGINE VARIABLES",
    controls: [
      {
        key: "gravityPull",
        label: "Center gravity",
        min: 0,
        max: 0.005,
        step: 0.0001,
        defaultValue: 0.0002,
      },
      { key: "restitution", label: "Bounciness", min: 0, max: 1, step: 0.1, defaultValue: 0 },
      {
        key: "frictionAir",
        label: "Air friction",
        min: 0,
        max: 0.2,
        step: 0.01,
        defaultValue: 0.2,
      },
    ],
  },
  {
    title: "PRESENTATION",
    controls: [
      {
        key: "bubbleFillOpacity",
        label: "Bubble fill opacity",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.72,
      },
    ],
  },
  {
    title: "AGENT SIZES",
    controls: [
      { key: "radiusIdle", label: "Idle size", min: 20, max: 80, step: 1, defaultValue: 40 },
      { key: "radiusWorking", label: "Working size", min: 40, max: 120, step: 1, defaultValue: 50 },
      { key: "radiusWaiting", label: "Waiting size", min: 60, max: 160, step: 1, defaultValue: 70 },
    ],
  },
];

const definitions = SWARM_PARAMETER_GROUPS.flatMap((group) => group.controls);

/** The view's own narrowing of the shell's flat bag back into typed physics inputs. */
export function normalizeSwarmParameters(value: unknown): SwarmParameters {
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<SwarmParameterKey, unknown>>)
      : {};
  const normalized = { ...DEFAULT_SWARM_PARAMETERS };
  for (const definition of definitions) {
    const key = definition.key as SwarmParameterKey;
    const candidate = source[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    normalized[key] = Math.max(definition.min, Math.min(definition.max, candidate));
  }
  return normalized;
}

export function radiusForStatus(
  parameters: Pick<SwarmParameters, "radiusIdle" | "radiusWorking" | "radiusWaiting">,
  status: "idle" | "working" | "waiting",
): number {
  switch (status) {
    case "idle":
      return parameters.radiusIdle;
    case "working":
      return parameters.radiusWorking;
    case "waiting":
      return parameters.radiusWaiting;
  }
}
