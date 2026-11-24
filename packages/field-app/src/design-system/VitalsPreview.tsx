import type { ReactElement } from "react";
import "../vitals/vitals.css";
import { VitalsView } from "../vitals/VitalsView";
import {
  vitalsFixtureLogs,
  vitalsFixtureModel,
  vitalsFixtureOff,
  vitalsFixtureUnavailable,
  vitalsFixtureWaiting,
} from "./vitals-fixtures";

// The Vitals window's fixture ADAPTER (track VT; docs/UI_SYSTEM.md): the shipping view — `VitalsView` — over five
// minutes of fixture readings and log lines, one plate per state. What it replaces is only what a host supplies:
// fieldd's snapshot and the lines the window keeps. The markup, the words and the CSS are the product's; the plate
// gives the view a window's size and nothing else.

export const VITALS_PLATE_STATES = ["recording", "waiting", "unavailable", "off"] as const;
export type VitalsPlateState = (typeof VITALS_PLATE_STATES)[number];

const MODELS = {
  recording: vitalsFixtureModel,
  waiting: vitalsFixtureWaiting,
  unavailable: vitalsFixtureUnavailable,
  off: vitalsFixtureOff,
} as const;

export function VitalsPlate({ state }: { readonly state: VitalsPlateState }): ReactElement {
  return (
    <div className="vf-ds-vitals-plate" data-state={state}>
      <VitalsView
        model={MODELS[state]()}
        logs={state === "recording" ? vitalsFixtureLogs() : []}
        initialWidth={620}
      />
    </div>
  );
}
