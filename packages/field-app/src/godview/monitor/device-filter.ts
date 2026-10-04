import type { RowsDeviceState } from "@vibefield/contracts";
import type { MonitorDeviceFacet } from "./types";

/**
 * DS-3 — THE DEVICE FILTER, pure (the chip that draws it is
 * `godview/DeviceFilterChip.tsx`; `GodviewMonitor` holds the choice).
 *
 * A filter is a DROPDOWN, never a row of text tabs (James, 2026-09-30, the PJ
 * notes; `thinking-project-places.md` §6.2, PJ-D23's lean — a desktop chip
 * beside the profile tabs). Its choices are every desktop on the board, THIS
 * one first, each with its standing and how many agents it runs; "all" is the
 * default and the fallback. The choice narrows the rows handed to the swarm and
 * the list (`window-rows.ts` `narrowToDevice`); it never asks the daemon
 * anything. MV-3b: the choices are built in `useMonitorAgents` off the model
 * board's devices (`GodviewMonitorFeed.devices`) and the window's rows.
 */

/** One desktop as the chip offers it: a choice is its mark and its name. */
export interface DeviceChoice extends MonitorDeviceFacet {
  state: RowsDeviceState;
  /** agents on the stage that live there */
  agents: number;
}

/** The choice as the board still has it: a desktop that left falls back to
 * all (null), never to a filter that shows nothing for a reason no one can see. */
export function standingChoice(
  choices: readonly DeviceChoice[],
  selected: string | null,
): string | null {
  return selected !== null && choices.some((choice) => choice.id === selected) ? selected : null;
}

/** The few words a choice is SAID in where it has no room for a mark — its
 * state when the desktop is not answering, else its agents. */
export function choiceNote(choice: DeviceChoice): string {
  if (choice.state === "asleep") return "asleep";
  if (choice.state === "stale") return "not answering";
  if (choice.state === "incompatible") return "another version";
  return `${choice.agents} agent${choice.agents === 1 ? "" : "s"}`;
}
