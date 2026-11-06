import type { ProfileTab } from "@vibefield/puppeteer-views";
import type { LiveFilters } from "../../frame/find-door";
import { choiceNote, type DeviceChoice } from "./device-filter";
import { agentProfileSet } from "./profile-tabs";
import type { MonitorAgent } from "./types";
import { deviceOfRow } from "./window-rows";

// THE VIEW'S FILTERS AS SEARCH CARRIES THEM (GV-D3; SE-D1 A, 2026-11-06;
// DESIGN.md §8 "Search — the Peek"): the desktops and the profiles Live now's
// Filter menu offers, each with what it holds, made from the monitor's choices
// and the window's rows. Pure — `GodviewMonitor` holds the choices and
// publishes what this answers on the find door. A count is every session's,
// whatever the other filter holds, as the drawing counts them.

/** What the monitor knows when it publishes its filters. */
export interface LiveFiltersInput {
  /** DS-3 — every desktop on the board, this one first */
  readonly devices: readonly DeviceChoice[];
  /** the chosen desktop as the board still has it (null = every one) */
  readonly desk: string | null;
  /** AR-S5 — the profiles, or null while This Mac is the only one (no choice to make) */
  readonly tabs: readonly ProfileTab[] | null;
  /** the chosen profile as the feed still has it (null = every one) */
  readonly profile: string | null;
  /** TS-4 (TS-D7) — this Mac is not connected: This Mac alone is offered, for its ghost row */
  readonly connect: boolean;
  /** every row the window holds, no filter applied: what each choice counts */
  readonly agents: readonly MonitorAgent[];
  /** which desktop is here: where this desktop's rows count */
  readonly here: string | undefined;
}

/** Search's Live now filters: a desktop offered only when there is a choice to
 * make — two or more, or This Mac alone while it is not connected (TS-4) — and
 * a profile only while one besides This Mac exists. Each counts its live
 * sessions, the shells too; a desktop also its agents, as its note says them.
 * A peer's run counts on its desktop and under Every profile, never under a
 * profile of this desktop's (`agentProfileSet`). */
export function liveFiltersOf(input: LiveFiltersInput): LiveFilters {
  const onDesk = new Map<string, number>();
  const underProfile = new Map<string, number>();
  for (const row of input.agents) {
    const desk = deviceOfRow(row, input.here);
    if (desk !== undefined) onDesk.set(desk, (onDesk.get(desk) ?? 0) + 1);
    const profile = agentProfileSet(row);
    if (profile !== undefined) underProfile.set(profile, (underProfile.get(profile) ?? 0) + 1);
  }
  const { devices } = input;
  return {
    desks:
      devices.length > 1 || (input.connect && devices.length === 1)
        ? devices.map((device) => ({
            id: device.id,
            name: device.name,
            os: device.os,
            here: device.here,
            note: choiceNote(device),
            quiet: device.state !== "live",
            agents: device.agents,
            sessions: onDesk.get(device.id) ?? 0,
          }))
        : [],
    desk: input.desk,
    profiles: (input.tabs ?? []).map((tab) => ({
      ...tab,
      sessions: underProfile.get(tab.id) ?? 0,
    })),
    profile: input.profile,
    connect: input.connect,
    sessions: input.agents.length,
  };
}
