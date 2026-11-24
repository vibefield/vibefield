import type { ReactElement } from "react";
import "../vitals/vitals.css";
import { VitalsView } from "../vitals/VitalsView";
import {
  VITALS_CAPTURE_FIXTURE_STATES,
  type VitalsCaptureFixtureState,
  vitalsCaptureFixture,
} from "./vitals-capture-fixtures";
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
// gives the view a window's size and nothing else. VT-5: the capture control's states are plates of the same view,
// recording, with the control's fixture state handed in as its host would.

export const VITALS_PLATE_STATES = [
  "recording",
  "waiting",
  "unavailable",
  "off",
  ...VITALS_CAPTURE_FIXTURE_STATES,
] as const;
export type VitalsPlateState = (typeof VITALS_PLATE_STATES)[number];

const MODELS = {
  recording: vitalsFixtureModel,
  waiting: vitalsFixtureWaiting,
  unavailable: vitalsFixtureUnavailable,
  off: vitalsFixtureOff,
} as const;

const isCapture = (state: VitalsPlateState): state is VitalsCaptureFixtureState =>
  (VITALS_CAPTURE_FIXTURE_STATES as readonly string[]).includes(state);

export function VitalsPlate({ state }: { readonly state: VitalsPlateState }): ReactElement {
  const capture = isCapture(state) ? vitalsCaptureFixture(state) : undefined;
  const model = isCapture(state) ? vitalsFixtureModel() : MODELS[state]();
  return (
    <div className="vf-ds-vitals-plate" data-state={state}>
      <VitalsView
        model={model}
        logs={state === "recording" || capture !== undefined ? vitalsFixtureLogs() : []}
        initialWidth={620}
        {...(capture === undefined ? {} : { capture })}
      />
    </div>
  );
}
