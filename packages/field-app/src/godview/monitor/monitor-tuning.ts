import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadMonitorParameters,
  type MonitorParameterGroup,
  type MonitorParameters,
  monitorParameterDefaults,
  normalizeMonitorParameters,
  saveMonitorParameters,
} from "./parameters";
import { monitorViewFor } from "./registry";
import { STAGE_HEIGHT_KEY, STAGE_PARAMETER_GROUPS } from "./stage-parameters";
import type { AgentMonitorView } from "./types";

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
// defaults every single open.

const VIEW_STORAGE_KEY = "vf-godview-monitor-view-v1";
const STAGE_STORAGE_KEY = "vf-godview-monitor-stage-v1";

function viewParametersKey(viewId: string): string {
  return `vf-godview-monitor-parameters-v1:${viewId}`;
}

function storedViewId(): string {
  try {
    return monitorViewFor(localStorage.getItem(VIEW_STORAGE_KEY)).id;
  } catch {
    // A disabled storage partition is not a reason to have no view.
    return monitorViewFor(undefined).id;
  }
}

export interface MonitorTuning {
  view: AgentMonitorView;
  /** The active view's own bag, already normalized to its controls. */
  parameters: MonitorParameters;
  stageParameters: MonitorParameters;
  /** The monitor's share of the overlay height, as a percentage. */
  stageHeight: number;
  selectView(viewId: string): void;
  setParameter(key: string, value: number): void;
  setStageParameter(key: string, value: number): void;
  resetParameters(): void;
}

export function useMonitorTuning(): MonitorTuning {
  const [viewId, setViewId] = useState(storedViewId);
  const view = monitorViewFor(viewId);
  const [parametersByView, setParametersByView] = useState<Record<string, MonitorParameters>>(
    () => ({ [view.id]: loadMonitorParameters(viewParametersKey(view.id), view.parameterGroups) }),
  );
  const [stageParameters, setStageParameters] = useState<MonitorParameters>(() =>
    loadMonitorParameters(STAGE_STORAGE_KEY, STAGE_PARAMETER_GROUPS),
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

  useEffect(() => {
    saveMonitorParameters(viewParametersKey(view.id), parameters);
  }, [parameters, view]);
  useEffect(() => saveMonitorParameters(STAGE_STORAGE_KEY, stageParameters), [stageParameters]);

  const selectView = useCallback((nextViewId: string): void => {
    const next = monitorViewFor(nextViewId);
    setParametersByView((current) =>
      current[next.id]
        ? current
        : {
            ...current,
            [next.id]: loadMonitorParameters(viewParametersKey(next.id), next.parameterGroups),
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
    stageHeight: stageParameters[STAGE_HEIGHT_KEY] as number,
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
