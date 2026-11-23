import type { ProfileTab } from "@vibefield/puppeteer-views";
import type {
  LiveAgentChoice,
  LiveFilters,
  LivePlanChoice,
  LiveProjectChoice,
} from "../../frame/find-door";
import { choiceNote, type DeviceChoice } from "./device-filter";
import { agentProfileSet } from "./profile-tabs";
import type { MonitorAgent } from "./types";
import { deviceOfRow } from "./window-rows";
import { drawsGroup, type WorkFacet, type WorkFacets } from "./work-facets";

// THE VIEW'S FILTERS AS SEARCH CARRIES THEM (GV-D3; SE-D1 A, 2026-11-06;
// DESIGN.md §8 "Search — the Peek"): the desktops and the profiles Live now's
// Filter menu offers, each with what it holds, made from the monitor's choices
// and the window's rows. Pure — `GodviewMonitor` holds the choices and
// publishes what this answers on the find door. A count is every session's,
// whatever the other filter holds, as the drawing counts them. WL-1
// (2026-11-23): the work column's projects and agents join them, each group
// offered while the column draws it.

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
  /** UM-5a — the chosen plan as the feed still has it; absent while none stands */
  readonly plan?: LivePlanChoice | undefined;
  /** TS-4 (TS-D7) — this Mac is not connected: This Mac alone is offered, for its ghost row */
  readonly connect: boolean;
  /** WL-1 — the work column's groups as the stage has them (`workFacets`) */
  readonly work: WorkFacets;
  /** the chosen project and agent as the stage still has them (`standingWork`; null = every one) */
  readonly project: string | null;
  readonly agent: string | null;
  /** every row the window holds, no filter applied: what each choice counts —
   * or `NO_COUNTED_ROWS` while nobody reads the counts */
  readonly agents: readonly MonitorAgent[];
  /** which desktop is here: where this desktop's rows count */
  readonly here: string | undefined;
}

/** The rows the monitor hands while the Peek's Live now is not listening:
 * only its menu and a typed name's offer read the counts, so nothing is
 * counted and a session that starts or ends republishes no filter (the find
 * door stays the same object for a closed Peek). WL-1: the work column's
 * groups then hold only the chosen value, counted 0, which the button names. */
export const NO_COUNTED_ROWS: readonly MonitorAgent[] = Object.freeze([]);

/** A group's values as Live now offers them: none while the column does not draw it; every one while the menu
 * reads them; else only the chosen one, which the button names. */
function offered<T extends WorkFacet>(
  facets: readonly T[],
  chosen: string | null,
  counted: boolean,
): readonly T[] {
  if (!drawsGroup(facets, chosen)) return [];
  return counted ? facets : facets.filter((facet) => facet.id === chosen);
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
  const counted = input.agents !== NO_COUNTED_ROWS;
  const projects = offered(input.work.projects, input.project, counted).map(
    (project): LiveProjectChoice => ({
      id: project.id,
      label: project.label,
      ...(project.seq !== undefined ? { seq: project.seq } : {}),
      waiting: counted && project.waiting > 0,
      sessions: counted ? project.sessions : 0,
    }),
  );
  const agents = offered(input.work.agents, input.agent, counted).map(
    (agent): LiveAgentChoice => ({
      id: agent.id,
      label: agent.label,
      shell: agent.shell,
      waiting: counted && agent.waiting > 0,
      sessions: counted ? agent.sessions : 0,
    }),
  );
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
    ...(input.plan !== undefined ? { plan: input.plan } : {}),
    projects,
    project: input.project,
    agents,
    agent: input.agent,
    connect: input.connect,
    sessions: input.agents.length,
  };
}
