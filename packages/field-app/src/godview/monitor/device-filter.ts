import type { RowsDeviceState } from "@vibefield/contracts";
import { deviceFacet, type RosterView } from "./devices";
import type { MeshFieldSnapshot } from "./mesh-field";
import { meshHere } from "./mesh-rows";
import type { MonitorAgent, MonitorDeviceFacet } from "./types";

/**
 * DS-3 — THE DEVICE FILTER, pure (the chip that draws it is
 * `godview/DeviceFilterChip.tsx`; `GodviewMonitor` holds the choice).
 *
 * A filter is a DROPDOWN, never a row of text tabs (James, 2026-09-30, the PJ
 * notes; `thinking-project-places.md` §6.2, PJ-D23's lean — a desktop chip
 * beside the profile tabs). Its choices are every desktop on the mesh board,
 * THIS one first, each with its standing and how many agents it runs; "all"
 * is the default and the fallback. The choice narrows the rows handed to the
 * swarm and the list; it never asks the daemon anything.
 */

/** One desktop as the chip offers it: a choice is its mark and its name. */
export interface DeviceChoice extends MonitorDeviceFacet {
  state: RowsDeviceState;
  /** agents on the stage that live there */
  agents: number;
}

/** The chip's choices: this desktop first, then the others in the board's
 * order. Empty when the board has not answered — and a single desktop is no
 * choice, which the chip says by not drawing at all. */
export function deviceChoices(
  field: MeshFieldSnapshot,
  roster: RosterView,
  rows: readonly MonitorAgent[],
): readonly DeviceChoice[] {
  const here = meshHere(field, roster);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row.device?.id;
    if (id === undefined || row.agent === undefined) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const choices: DeviceChoice[] = [];
  for (const entry of field.devices.values()) {
    const choice: DeviceChoice = {
      ...deviceFacet(entry.device, roster.byId, here),
      state: entry.state,
      agents: counts.get(entry.device) ?? 0,
    };
    if (choice.here) choices.unshift(choice);
    else choices.push(choice);
  }
  return choices;
}

/** The choice as the board still has it: a desktop that left falls back to
 * all (null), never to a filter that shows nothing for a reason no one can see. */
export function standingChoice(
  choices: readonly DeviceChoice[],
  selected: string | null,
): string | null {
  return selected !== null && choices.some((choice) => choice.id === selected) ? selected : null;
}

/** The rows a choice keeps: all of them for "all", else the chosen desktop's. */
export function filterByDevice(
  rows: readonly MonitorAgent[],
  selected: string | null,
): readonly MonitorAgent[] {
  if (selected === null) return rows;
  return rows.filter((row) => row.device?.id === selected);
}

/** The few words a choice is SAID in where it has no room for a mark — its
 * state when the desktop is not answering, else its agents. */
export function choiceNote(choice: DeviceChoice): string {
  if (choice.state === "asleep") return "asleep";
  if (choice.state === "stale") return "not answering";
  if (choice.state === "incompatible") return "another version";
  return `${choice.agents} agent${choice.agents === 1 ? "" : "s"}`;
}
