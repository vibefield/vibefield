import {
  loadMonitorParameters,
  type MonitorParameterGroup,
  type MonitorParameters,
  type MonitorViewEntry,
  monitorParameterDefaults,
  monitorViewFor,
  normalizeMonitorParameters,
  saveMonitorParameters,
} from "@vibefield/puppeteer-views";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STAGE_PARAMETER_GROUPS } from "./stage-parameters";

// The monitor's chosen view and its tunables — state that lives ABOVE the stage.
//
// It has to: the stage unmounts on every close (PF6), and state inside it would
// reset every time James pressed ⇧⇧. The overlay outlives the stage, so this
// hook lives there and the numbers come down as props — which also mirrors the
// reference app, where the same state sits in its window component and feeds
// both the tweak panel and the view.
//
// PERSISTED, unlike the surface lab's stage knobs beside it, and the difference
// is deliberate. The lab's values are a temporary measuring instrument with no
// life outside a session (its own comment says so). These are a view's own
// tunables: a swarm radius James settles on should survive a close, and with the
// stage unmounting on every one of them, memory-only would mean re-tuning from
// defaults every single open. *(Since LP-6, 2026-11-05: in development builds,
// where System control tunes them; a production build draws the defaults —
// `loadTunables`.)*

const VIEW_STORAGE_KEY = "vf-godview-monitor-view-v1";
const STAGE_STORAGE_KEY = "vf-godview-monitor-stage-v1";

/** A view whose defaults were re-decided stores its tunables under the
 * revision (AR-5: the reference's `parametersRevision`, the 2026-09-09 lock),
 * so every installation lands on the new defaults instead of keeping what an
 * older design had saved; later tunes persist as before. */
function viewParametersKey(view: MonitorViewEntry): string {
  return `vf-godview-monitor-parameters-v1:${view.id}${view.parametersRevision ? `:${view.parametersRevision}` : ""}`;
}

function storedViewId(): string {
  try {
    return monitorViewFor(localStorage.getItem(VIEW_STORAGE_KEY)).id;
  } catch {
    // A disabled storage partition is not a reason to have no view.
    return monitorViewFor(undefined).id;
  }
}

/** A bag of tunables as this build draws it. The only control that sets or
 * resets them is System control, the surface lab, which is development's alone
 * (LP-6, HK Q3: James 2026-10-28 "B"). So a production build draws every view
 * and the stage at their defaults, and never reads what an earlier build's
 * panel saved: a value the shipped app offers no control to change or reset
 * never reaches its picture. Storage is left as it was. The view CHOICE is not
 * a tunable (the monitor's own head switches it) and persists in every build.
 * The literal `import.meta.env.DEV` is what `vite build` folds. */
function loadTunables(
  storageKey: string,
  groups: readonly MonitorParameterGroup[],
): MonitorParameters {
  return import.meta.env.DEV
    ? loadMonitorParameters(storageKey, groups)
    : monitorParameterDefaults(groups);
}

/** The stage's saved tunables, read once — for a surface that draws Godview
 * without being it (Settings → Terminal's miniature, GT-7): it shows the CRT
 * lines and vignette the user actually tuned, and never writes them (in a
 * production build, the defaults Godview itself draws: `loadTunables`). */
export function storedStageParameters(): MonitorParameters {
  return loadTunables(STAGE_STORAGE_KEY, STAGE_PARAMETER_GROUPS);
}

export interface MonitorTuning {
  view: MonitorViewEntry;
  /** The active view's own bag, already normalized to its controls. */
  parameters: MonitorParameters;
  stageParameters: MonitorParameters;
  selectView(viewId: string): void;
  setParameter(key: string, value: number): void;
  setStageParameter(key: string, value: number): void;
  resetParameters(): void;
}

export function useMonitorTuning(): MonitorTuning {
  const [viewId, setViewId] = useState(storedViewId);
  const view = monitorViewFor(viewId);
  const [parametersByView, setParametersByView] = useState<Record<string, MonitorParameters>>(
    () => ({ [view.id]: loadTunables(viewParametersKey(view), view.parameterGroups) }),
  );
  const [stageParameters, setStageParameters] = useState<MonitorParameters>(() =>
    loadTunables(STAGE_STORAGE_KEY, STAGE_PARAMETER_GROUPS),
  );

  // Seeded on boot and on every switch, so the fallback is a guard rather than a
  // path. Memoized regardless: a fresh object here would re-fire the save effect
  // on every render.
  const parameters = useMemo(
    () => parametersByView[view.id] ?? monitorParameterDefaults(view.parameterGroups),
    [parametersByView, view],
  );

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewId);
    } catch {
      // Keep the switcher usable when persistence is unavailable.
    }
  }, [viewId]);

  // A production build writes no tunable back either (`loadTunables`): the
  // defaults it draws are not a tune, and what the lab saved stays the lab's.
  useEffect(() => {
    if (import.meta.env.DEV) saveMonitorParameters(viewParametersKey(view), parameters);
  }, [parameters, view]);
  useEffect(() => {
    if (import.meta.env.DEV) saveMonitorParameters(STAGE_STORAGE_KEY, stageParameters);
  }, [stageParameters]);

  const selectView = useCallback((nextViewId: string): void => {
    const next = monitorViewFor(nextViewId);
    setParametersByView((current) =>
      current[next.id]
        ? current
        : {
            ...current,
            [next.id]: loadTunables(viewParametersKey(next), next.parameterGroups),
          },
    );
    setViewId(next.id);
  }, []);

  const setParameter = useCallback(
    (key: string, value: number): void => {
      setParametersByView((current) => ({
        ...current,
        [view.id]: normalizeMonitorParameters(view.parameterGroups, {
          ...current[view.id],
          [key]: value,
        }),
      }));
    },
    [view],
  );

  const setStageParameter = useCallback((key: string, value: number): void => {
    setStageParameters((current) =>
      normalizeMonitorParameters(STAGE_PARAMETER_GROUPS, { ...current, [key]: value }),
    );
  }, []);

  const resetParameters = useCallback((): void => {
    setStageParameters(monitorParameterDefaults(STAGE_PARAMETER_GROUPS));
    setParametersByView((current) => ({
      ...current,
      [view.id]: monitorParameterDefaults(view.parameterGroups),
    }));
  }, [view]);

  return {
    view,
    parameters,
    stageParameters,
    selectView,
    setParameter,
    setStageParameter,
    resetParameters,
  };
}

/** One tuning group bound to whichever store owns its keys — the reference's
 * `TweakSection`, folded into the surface lab so there is ONE instrument. */
export interface MonitorTuningSection {
  id: string;
  group: MonitorParameterGroup;
  values: MonitorParameters;
  onChange: (key: string, value: number) => void;
}

/** The stage's groups first, then the active view's own. Rebuilt when the view
 * changes, which is what makes a view's controls come and go with it. */
export function monitorTuningSections(tuning: MonitorTuning): readonly MonitorTuningSection[] {
  return [
    ...STAGE_PARAMETER_GROUPS.map((group) => ({
      id: `stage:${group.title}`,
      group,
      values: tuning.stageParameters,
      onChange: tuning.setStageParameter,
    })),
    ...tuning.view.parameterGroups.map((group) => ({
      id: `${tuning.view.id}:${group.title}`,
      group,
      values: tuning.parameters,
      onChange: tuning.setParameter,
    })),
  ];
}
