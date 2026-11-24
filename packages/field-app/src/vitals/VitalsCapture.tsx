import { VITALS_CAPTURES } from "@vibefield/contracts/registries";
import type {
  VitalsCaptureKind,
  VitalsCaptureSeconds,
  VitalsCaptureState,
} from "@vibefield/contracts/vitals";
import { SegmentedControl, UiButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import "./vitals-capture.css";
import {
  CAPTURE_KIND_WORDS,
  CAPTURE_WORDS,
  failedWords,
  lengthWords,
  runningWords,
  savedWords,
} from "./vitals-capture-words";

// VT-5 (track VT, 2026-11-24; DESIGN.md §8 "Vitals", "Captures") — THE CAPTURE CONTROL, controller-free: the capture's
// state and the seconds left in, a person's intents out (arm, show in Finder). What it holds is only the person's
// pick before they press. The kit's small segmented controls and its quiet pill, in the kit's dark ramp (the window is
// committed dark).

const KINDS: readonly VitalsCaptureKind[] = ["trace", "profile", "frames"];
const LENGTHS = VITALS_CAPTURES.SECONDS.map(String) as readonly string[];

export interface VitalsCaptureProps {
  state: VitalsCaptureState;
  /** a running capture's whole seconds left, by the controller's clock */
  secondsLeft?: number;
  onArm(kind: VitalsCaptureKind, seconds: VitalsCaptureSeconds): void;
  onReveal(name: string): void;
  /** the pick a plate opens with */
  initialKind?: VitalsCaptureKind;
}

export function VitalsCapture({
  state,
  secondsLeft,
  onArm,
  onReveal,
  initialKind = "trace",
}: VitalsCaptureProps): ReactElement {
  const [kind, setKind] = useState<VitalsCaptureKind>(initialKind);
  const [length, setLength] = useState<string>(String(VITALS_CAPTURES.SECONDS[0]));
  const running = state.state === "running";
  const shownKind = running ? state.kind : kind;
  const shownLength = running ? String(state.seconds) : length;

  return (
    <div className="vf-vitals-capture dark" data-state={state.state}>
      <div className="vf-vitals-capture__controls">
        <SegmentedControl
          size="small"
          label={CAPTURE_WORDS.whatLabel}
          disabled={running}
          value={shownKind}
          onChange={setKind}
          options={KINDS.map((id) => ({ id, label: CAPTURE_KIND_WORDS[id] }))}
        />
        <SegmentedControl
          size="small"
          label={CAPTURE_WORDS.lengthLabel}
          disabled={running}
          value={shownLength}
          onChange={setLength}
          options={LENGTHS.map((id) => ({ id, label: lengthWords(Number(id)) }))}
        />
        <UiButton
          className="vf-vitals-capture__go"
          running={running}
          onClick={() => onArm(kind, Number(length) as VitalsCaptureSeconds)}
        >
          {running ? CAPTURE_WORDS.capturing : CAPTURE_WORDS.capture}
        </UiButton>
      </div>
      {running ? (
        <p className="vf-vitals-capture__line" aria-live="polite">
          {runningWords(state.kind, secondsLeft ?? state.seconds)}
        </p>
      ) : null}
      {state.state === "saved" ? (
        <p className="vf-vitals-capture__line">
          <span className="vf-vitals-capture__file">{state.name}</span>
          <span className="vf-vitals-capture__holds">{savedWords(state)}</span>
          <button
            type="button"
            className="vf-vitals-capture__reveal"
            onClick={() => onReveal(state.name)}
          >
            {CAPTURE_WORDS.reveal}
          </button>
        </p>
      ) : null}
      {state.state === "failed" ? (
        <p className="vf-vitals-capture__line" role="status">
          {failedWords(state.kind, state.reason)}
        </p>
      ) : null}
      {!running && kind === "trace" ? (
        <p className="vf-vitals-capture__note">{CAPTURE_WORDS.traceNote}</p>
      ) : null}
    </div>
  );
}
