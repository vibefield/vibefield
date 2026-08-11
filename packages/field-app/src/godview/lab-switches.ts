import { useSyncExternalStore } from "react";

// THE LAB'S KILL SWITCHES (GT-3p) — diagnostic instruments, not product settings.
//
// GT-D15.4 requires a perf change to qualify by measurement, and measuring a
// layer's cost means being able to turn that layer OFF and watch the frame
// readout move. That is all these are for. They are deliberately:
//
//   - MEMORY-ONLY. Nothing persists them, so no reopen inherits a swarm someone
//     switched off an hour ago while hunting a number. The lab's stage knobs
//     already work this way and for the same reason (GT-3m's residual note);
//     the monitor PARAMETERS persist because they are tuning, and these are not.
//   - unlabelled as preferences. The panel says what they are: a way to remove a
//     layer and see what it was costing.
//
// They never reach the deck. A switch that could silence a terminal would be a
// product behaviour wearing a diagnostic's clothes.

export interface LabSwitches {
  /** The monitor stage — swarm, physics, bubbles, the whole upper half. */
  monitor: boolean;
  /** Every ambient CSS animation on the stage (the ignition core, the particle
   * ring, the breathe and wait pulses). Off leaves the same layout and the same
   * colors, so what the frame readout shows is the animations' cost alone. */
  animations: boolean;
}

const DEFAULTS: LabSwitches = { monitor: true, animations: true };

let current: LabSwitches = DEFAULTS;
const listeners = new Set<() => void>();

export function getLabSwitches(): LabSwitches {
  return current;
}

export function subscribeLabSwitches(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setLabSwitches(next: LabSwitches): void {
  current = next;
  for (const fn of listeners) fn();
}

export function useLabSwitches(): LabSwitches {
  return useSyncExternalStore(subscribeLabSwitches, getLabSwitches, getLabSwitches);
}

/** Test seam: the singleton is per-app-life by design. */
export function resetLabSwitchesForTest(): void {
  current = DEFAULTS;
  listeners.clear();
}
