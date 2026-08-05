import type { MonitorParameterGroup } from "../../monitor/parameters";
import { PHYSICS_HZ_FLOOR } from "./swarm-physics";

export interface SwarmParameters {
  gravityPull: number;
  restitution: number;
  frictionAir: number;
  /** GT-D15.2: how often the engine steps, in Hz — DECOUPLED from paint. The
   * render loop interpolates between the last two solved states, so this is a
   * cost knob and not a smoothness knob: the swarm looks the same at 30 as at
   * 120 and does a quarter of the solving. */
  physicsHz: number;
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
  physicsHz: 30,
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
      {
        // The floor is a STABILITY limit, not a taste one, and it is stated
        // once — beside the physics that depends on it (`swarm-physics.ts`),
        // which clamps to the same constant. GT-3c put the engine behind a
        // message, and a floor only the slider enforced would be a floor the
        // next caller walks straight past.
        key: "physicsHz",
        label: "Physics rate (Hz)",
        min: PHYSICS_HZ_FLOOR,
        max: 120,
        step: 5,
        defaultValue: 30,
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
