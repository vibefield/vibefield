import { describe, expect, it } from "vitest";
import {
  type MonitorParameterGroup,
  monitorParameterDefaults,
  normalizeMonitorParameters,
} from "../src/godview/monitor/parameters";
import {
  DEFAULT_MONITOR_VIEW_ID,
  MONITOR_VIEWS,
  monitorViewFor,
} from "../src/godview/monitor/registry";
import { STAGE_HEIGHT_KEY, STAGE_PARAMETER_GROUPS } from "../src/godview/monitor/stage-parameters";
import {
  DEFAULT_SWARM_PARAMETERS,
  normalizeSwarmParameters,
  radiusForStatus,
  SWARM_PARAMETER_GROUPS,
} from "../src/godview/views/swarm/swarm-parameters";

// The reference app's `monitor/parameters.test.ts` and
// `views/swarm/swarm-parameters.test.ts`, ported, plus the registry's fallback.

const groups: readonly MonitorParameterGroup[] = [
  {
    title: "GROUP",
    controls: [
      { key: "speed", label: "Speed", min: 0, max: 10, step: 1, defaultValue: 4 },
      { key: "depth", label: "Depth", min: 1, max: 3, step: 0.5, defaultValue: 2 },
    ],
  },
];

describe("monitor parameters", () => {
  it("collects defaults across every declared group", () => {
    expect(monitorParameterDefaults(groups)).toEqual({ speed: 4, depth: 2 });
  });

  it("clamps stored values and falls back to the default for anything unusable", () => {
    expect(normalizeMonitorParameters(groups, { speed: 99, depth: Number.NaN })).toEqual({
      speed: 10,
      depth: 2,
    });
    expect(normalizeMonitorParameters(groups, { speed: -1 })).toEqual({ speed: 0, depth: 2 });
    expect(normalizeMonitorParameters(groups, "not an object")).toEqual({ speed: 4, depth: 2 });
  });

  it("drops keys no control declares, so a removed control cannot outlive it", () => {
    expect(normalizeMonitorParameters(groups, { speed: 3, radiusIdle: 40 })).toEqual({
      speed: 3,
      depth: 2,
    });
  });
});

describe("swarm parameters", () => {
  it("keeps the prototype physics and adds VibeField's glass-body default", () => {
    expect(DEFAULT_SWARM_PARAMETERS).toEqual({
      gravityPull: 0.0002,
      restitution: 0,
      frictionAir: 0.2,
      bubbleFillOpacity: 0.72,
      radiusIdle: 40,
      radiusWorking: 50,
      radiusWaiting: 70,
    });
  });

  it("declares the same defaults to the shell that it applies itself", () => {
    expect(monitorParameterDefaults(SWARM_PARAMETER_GROUPS)).toEqual({
      ...DEFAULT_SWARM_PARAMETERS,
    });
  });

  it("restores finite values and clamps them to the panel ranges", () => {
    expect(
      normalizeSwarmParameters({
        gravityPull: 2,
        restitution: -1,
        radiusWorking: 91,
        radiusWaiting: NaN,
      }),
    ).toMatchObject({ gravityPull: 0.005, restitution: 0, radiusWorking: 91, radiusWaiting: 70 });
  });

  it("maps every live status to its configured radius", () => {
    expect(radiusForStatus(DEFAULT_SWARM_PARAMETERS, "idle")).toBe(40);
    expect(radiusForStatus(DEFAULT_SWARM_PARAMETERS, "working")).toBe(50);
    expect(radiusForStatus(DEFAULT_SWARM_PARAMETERS, "waiting")).toBe(70);
  });
});

describe("the monitor view registry", () => {
  it("offers swarm, list and rain, with swarm the default", () => {
    expect(MONITOR_VIEWS.map((view) => view.id)).toEqual(["swarm", "list", "rain"]);
    expect(DEFAULT_MONITOR_VIEW_ID).toBe("swarm");
  });

  it("falls back rather than stranding the stage on an id it no longer has", () => {
    // The property the fallback exists for: a persisted preference naming a view
    // this build deleted must resolve to SOMETHING, because the alternative is a
    // stage that draws nothing and looks broken.
    expect(monitorViewFor("rain").id).toBe("rain");
    expect(monitorViewFor("a-view-that-was-removed").id).toBe(DEFAULT_MONITOR_VIEW_ID);
    expect(monitorViewFor(null).id).toBe(DEFAULT_MONITOR_VIEW_ID);
    expect(monitorViewFor(undefined).id).toBe(DEFAULT_MONITOR_VIEW_ID);
  });

  it("gives every view a distinct id and its own declared controls", () => {
    expect(new Set(MONITOR_VIEWS.map((view) => view.id)).size).toBe(MONITOR_VIEWS.length);
    for (const view of MONITOR_VIEWS) {
      expect(view.parameterGroups.length, `${view.id} declares no controls`).toBeGreaterThan(0);
      expect(view.label).not.toBe("");
    }
  });

  it("keeps the stage's own height out of every view's bag", () => {
    // The split the reference draws and we keep: stage height belongs to no
    // single view, so no view may declare it and every view must survive it
    // moving.
    expect(monitorParameterDefaults(STAGE_PARAMETER_GROUPS)).toHaveProperty(STAGE_HEIGHT_KEY);
    for (const view of MONITOR_VIEWS) {
      expect(monitorParameterDefaults(view.parameterGroups)).not.toHaveProperty(STAGE_HEIGHT_KEY);
    }
  });
});
