// @vitest-environment happy-dom
/**
 * WHAT IS STILL OURS ABOUT THE MONITOR'S NUMBERS (AR-5).
 *
 * This file was `godview-monitor-parameters.test.ts` and held three things: the
 * parameter helpers, the swarm's own defaults, and the view registry. All three
 * moved into `@vibecook/puppeteer-views` with the views, and all three are
 * tested there (96 rows) — keeping a second copy here would be a transcription
 * that agrees until the day it quietly does not.
 *
 * Two claims did NOT move, because they are about the seam rather than about a
 * view:
 *
 *   1. THE SPLIT. Stage height belongs to no view. It is what lets a view's own
 *      controls come and go with it, so the stage group must declare it and no
 *      view in the package's registry may.
 *   2. THE KEY. A view's tunables are stored per view AND per `parametersRevision`
 *      — the reference's 2026-09-09 lock. A view whose defaults were re-decided
 *      stores under the revision, so every installation lands on the new numbers
 *      instead of keeping what an older design saved; later tunes persist as
 *      before. Only `useMonitorTuning` is exported, so the key is asserted the
 *      way a user would meet it: through the hook, against real storage.
 */

import {
  DEFAULT_MONITOR_VIEW_ID,
  MONITOR_VIEWS,
  monitorParameterDefaults,
  monitorViewFor,
} from "@vibecook/puppeteer-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MonitorTuning,
  monitorTuningSections,
  useMonitorTuning,
} from "../src/godview/monitor/monitor-tuning";
import { STAGE_HEIGHT_KEY, STAGE_PARAMETER_GROUPS } from "../src/godview/monitor/stage-parameters";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW_KEY = "vf-godview-monitor-view-v1";
const PARAMETERS_PREFIX = "vf-godview-monitor-parameters-v1";

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Mount the hook and hand back its live value. Mounted for real rather than
 * called, because the persistence under test happens in effects. */
async function mountTuning(): Promise<() => MonitorTuning> {
  let current: MonitorTuning | undefined;
  const Probe = (): null => {
    current = useMonitorTuning();
    return null;
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Probe));
  });
  return () => current as MonitorTuning;
}

/** Every parameter key storage holds, with what is under it. */
function storedParameterKeys(): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PARAMETERS_PREFIX))
      found[key] = JSON.parse(localStorage.getItem(key) ?? "");
  }
  return found;
}

describe("the stage's own parameters", () => {
  it("keeps the stage's height out of every view's bag", () => {
    // The split the reference draws and we keep: stage height belongs to no
    // single view, so no view may declare it and every view must survive it
    // moving.
    expect(monitorParameterDefaults(STAGE_PARAMETER_GROUPS)).toHaveProperty(STAGE_HEIGHT_KEY);
    for (const view of MONITOR_VIEWS) {
      expect(
        monitorParameterDefaults(view.parameterGroups),
        `${view.id} declares the stage's height`,
      ).not.toHaveProperty(STAGE_HEIGHT_KEY);
    }
  });

  it("hands the panel the stage's groups first, then the active view's own", async () => {
    // What makes a view's controls come and go with it: the sections are
    // rebuilt around whichever view is chosen, and the stage's own always lead.
    const tuning = await mountTuning();
    const sections = monitorTuningSections(tuning());
    expect(sections.slice(0, STAGE_PARAMETER_GROUPS.length).map((section) => section.id)).toEqual(
      STAGE_PARAMETER_GROUPS.map((group) => `stage:${group.title}`),
    );
    const view = monitorViewFor(DEFAULT_MONITOR_VIEW_ID);
    expect(sections.slice(STAGE_PARAMETER_GROUPS.length).map((section) => section.id)).toEqual(
      view.parameterGroups.map((group) => `${view.id}:${group.title}`),
    );
  });

  it("starts the stage at its declared default height and clamps an edit to the control", async () => {
    const tuning = await mountTuning();
    const declared = monitorParameterDefaults(STAGE_PARAMETER_GROUPS)[STAGE_HEIGHT_KEY];
    expect(tuning().stageHeight).toBe(declared);
    await act(async () => tuning().setStageParameter(STAGE_HEIGHT_KEY, 10_000));
    const control = STAGE_PARAMETER_GROUPS.flatMap((group) => group.controls).find(
      (candidate) => candidate.key === STAGE_HEIGHT_KEY,
    );
    expect(tuning().stageHeight).toBe(control?.max);
  });
});

describe("a view's tunables are stored per view and per revision (AR-5)", () => {
  it("stores a revised view's numbers under its revision, and an unrevised view's without one", async () => {
    // The swarm's defaults were re-decided on 2026-09-09 and it carries the
    // revision; the list's were not and it carries none. The two must not share
    // a key, or the lock would be unable to reach an installation that had
    // already saved something.
    const swarm = MONITOR_VIEWS.find((view) => view.parametersRevision !== undefined);
    const plain = MONITOR_VIEWS.find((view) => view.parametersRevision === undefined);
    expect(swarm, "no view in the registry declares a parameters revision").toBeDefined();
    expect(plain, "every view in the registry declares a parameters revision").toBeDefined();

    const tuning = await mountTuning();
    await act(async () => tuning().selectView(swarm?.id as string));
    await act(async () => tuning().selectView(plain?.id as string));

    const keys = Object.keys(storedParameterKeys());
    expect(keys).toContain(`${PARAMETERS_PREFIX}:${swarm?.id}:${swarm?.parametersRevision}`);
    expect(keys).toContain(`${PARAMETERS_PREFIX}:${plain?.id}`);
    // …and the revised view never writes the bare key, which is the whole
    // mechanism: a bare key left by an older build is simply not read.
    expect(keys).not.toContain(`${PARAMETERS_PREFIX}:${swarm?.id}`);
  });

  it("lands a revised view on its new defaults rather than on what an older build saved", async () => {
    const swarm = MONITOR_VIEWS.find((view) => view.parametersRevision !== undefined);
    const control = swarm?.parameterGroups[0]?.controls[0];
    expect(control, "the revised view declares no controls to re-decide").toBeDefined();
    const stale = (control?.defaultValue as number) === 0 ? 1 : 0;
    // What an installation tuned under the OLD design left behind, under the
    // key that build used.
    localStorage.setItem(
      `${PARAMETERS_PREFIX}:${swarm?.id}`,
      JSON.stringify({ [control?.key as string]: stale }),
    );
    localStorage.setItem(VIEW_KEY, swarm?.id as string);

    const tuning = await mountTuning();
    expect(tuning().view.id).toBe(swarm?.id);
    expect(tuning().parameters[control?.key as string]).toBe(control?.defaultValue);
  });

  it("keeps a tune made AFTER the revision, which is the other half of the lock", async () => {
    const swarm = MONITOR_VIEWS.find((view) => view.parametersRevision !== undefined);
    const control = swarm?.parameterGroups[0]?.controls[0];
    const tuned = Math.min(
      control?.max as number,
      (control?.defaultValue as number) + (control?.step as number),
    );
    localStorage.setItem(VIEW_KEY, swarm?.id as string);

    const first = await mountTuning();
    await act(async () => first().setParameter(control?.key as string, tuned));
    expect(first().parameters[control?.key as string]).toBe(tuned);
    act(() => root?.unmount());
    container?.remove();
    root = null;

    // A second open reads it back: persistence is what the per-view key is for,
    // and the revision only gates what an OLDER key may say.
    const second = await mountTuning();
    expect(second().view.id).toBe(swarm?.id);
    expect(second().parameters[control?.key as string]).toBe(tuned);
  });

  it("falls back to the default view rather than stranding the stage on a stored id it no longer has", async () => {
    // Ours because the FALLBACK is read through our storage: a preference this
    // build cannot resolve must still open on something.
    localStorage.setItem(VIEW_KEY, "a-view-that-was-removed");
    const tuning = await mountTuning();
    expect(tuning().view.id).toBe(DEFAULT_MONITOR_VIEW_ID);
  });
});

describe("the view registry's invariant (the deleted parameters test's claim, kept — AR-5b)", () => {
  it("gives every package view a distinct id, a label and its own declared controls", () => {
    // The registry is the package's now and no upstream test asserts this;
    // the stage iterates it, so a duplicate id or a control-less view is a
    // stage defect as much as a package one.
    expect(new Set(MONITOR_VIEWS.map((view) => view.id)).size).toBe(MONITOR_VIEWS.length);
    for (const view of MONITOR_VIEWS) {
      expect(view.label, view.id).not.toBe("");
      expect(view.parameterGroups.length, `${view.id} declares no controls`).toBeGreaterThan(0);
    }
  });
});
