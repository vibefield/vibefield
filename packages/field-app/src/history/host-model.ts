import type {
  AgentProviderSummary,
  DeviceInfo,
  IndexCatalogSource,
  IndexSession,
  ProjectPlace,
  ProjectSummary,
} from "@vibefield/contracts";
import { osOf } from "../godview/monitor/devices";
import type { MonitorDeviceFacet } from "../godview/monitor/types";
import { type LiveRun, liveRunOf } from "./jump";
import type { HistorySections } from "./sections";

// HISTORY'S HOST MODEL (PJ-4's second half, H1–H6). The room draws what a
// host hands it (rosetta `host-inputs.ts`: colours, marks, sections, row acts,
// head acts, folders, filters) and interprets none of it (A-D9); this is what
// VibeField hands it FROM — one plain model per listing the catalog port
// delivers, never a second grouping (DS-L4): fieldd's projects and this
// desktop's keyed sessions (`project.list`, `index.sessions`), each desktop as
// the listing's `sources` stand it and the roster names it (`device.list`:
// its name and its OS, PJ-D24), which conversations run here now (one plain
// `agent.list` per listing — P3's reading, PF6-safe: History asks only while
// it shows), and the agents this desktop offers (`agent.providers`, the
// catalog's ids, R23). Pure: the controller (`HistoryView`) gathers, this
// folds; `host-inputs.tsx` draws from it.

/** A desktop as History draws it: its OS mark and its name (PJ-D24), and
 * whether it is this one or asleep (PJ-L6). */
export interface HostDevice {
  readonly id: string;
  readonly name: string;
  readonly os: MonitorDeviceFacet["os"];
  readonly here: boolean;
  readonly asleep: boolean;
  /** when its rows were last heard (ISO), for "asleep · read 14:14" */
  readonly asOf?: string | undefined;
}

export interface HistoryHostModel {
  readonly self: string | null;
  /** every project fieldd groups, by key */
  readonly projects: ReadonlyMap<string, ProjectSummary>;
  /** this desktop's sessions, by rosetta's id */
  readonly sessions: ReadonlyMap<string, IndexSession>;
  /** every desktop the listing names, in its order (this one first) */
  readonly devices: readonly HostDevice[];
  /** this desktop's live runs, by the conversation's native id */
  readonly live: ReadonlyMap<string, LiveRun>;
  readonly providers: readonly AgentProviderSummary[];
  readonly sections: HistorySections;
}

export const EMPTY_HOST_MODEL: HistoryHostModel = {
  self: null,
  projects: new Map(),
  sessions: new Map(),
  devices: [],
  live: new Map(),
  providers: [],
  sections: { home: [], temporary: null },
};

/** What the catalog port read last (its `listing()`). */
export interface HistoryListing {
  readonly projects: readonly ProjectSummary[];
  readonly sessions: readonly IndexSession[];
  readonly sources: readonly IndexCatalogSource[];
  readonly self: string | null;
  readonly sections: HistorySections;
}

/** The desktops, in the listing's order with this one first: the roster's
 * name and platform when it has them (a desktop it has not heard is a plain
 * screen, never a guess), the listing's standing for asleep. */
export function hostDevicesOf(
  sources: readonly IndexCatalogSource[],
  roster: readonly DeviceInfo[],
  self: string | null,
): HostDevice[] {
  const byId = new Map(roster.map((device) => [device.deviceId, device]));
  const ids = [...new Set([...sources.map((source) => source.device)])];
  if (self !== null && !ids.includes(self)) ids.unshift(self);
  ids.sort((a, b) => Number(b === self) - Number(a === self));
  return ids.map((id): HostDevice => {
    const source = sources.find((candidate) => candidate.device === id);
    const info = byId.get(id);
    const state = info?.state ?? source?.state;
    return {
      id,
      name: info?.name ?? source?.name ?? "a desktop",
      os: osOf(info?.platform),
      here: id === self,
      asleep: id !== self && (state === "asleep" || (info !== undefined && !info.online)),
      ...(source?.asOf !== undefined ? { asOf: source.asOf } : {}),
    };
  });
}

/** This desktop's live runs, by native id (`agent.list`'s rows, P3's rule:
 * the conversation, not stamped ended, its terminal on this floor). */
export function liveRunsOf(
  rows: readonly unknown[],
  sessions: Iterable<IndexSession>,
): Map<string, LiveRun> {
  const out = new Map<string, LiveRun>();
  for (const session of sessions) {
    if (session.nativeSessionId === "") continue;
    const run = liveRunOf(rows, session.nativeSessionId);
    if (run !== null) out.set(session.nativeSessionId, run);
  }
  return out;
}

export function hostModelOf(
  listing: HistoryListing,
  roster: readonly DeviceInfo[],
  liveRows: readonly unknown[],
  providers: readonly AgentProviderSummary[],
): HistoryHostModel {
  const sessions = new Map(
    listing.sessions
      .filter((session) => session.device === undefined || session.device === listing.self)
      .map((session) => [session.sessionId, session]),
  );
  return {
    self: listing.self,
    projects: new Map(listing.projects.map((project) => [project.key, project])),
    sessions,
    devices: hostDevicesOf(listing.sources, roster, listing.self),
    live: liveRunsOf(liveRows, sessions.values()),
    providers,
    sections: listing.sections,
  };
}

/* ── reads over the model ──────────────────────────────────────────────── */

export function deviceOf(model: HistoryHostModel, id: string): HostDevice {
  return (
    model.devices.find((device) => device.id === id) ?? {
      id,
      name: "a desktop",
      os: "unknown",
      here: id === model.self,
      asleep: false,
    }
  );
}

/** A project's sessions here, newest first. */
export function sessionsOf(model: HistoryHostModel, key: string): IndexSession[] {
  return [...model.sessions.values()]
    .filter((session) => session.projectKey === key)
    .sort((a, b) => lastAtOf(b) - lastAtOf(a));
}

export function lastAtOf(session: IndexSession): number {
  return session.activity?.lastAt ?? session.updatedAt ?? session.startedAt ?? 0;
}

/** Whether a session of this desktop runs here now. */
export function isLive(model: HistoryHostModel, session: IndexSession): boolean {
  return session.nativeSessionId !== "" && model.live.has(session.nativeSessionId);
}

/** How many of a project's sessions run here now (R2's "n live"). */
export function liveCountOf(model: HistoryHostModel, key: string): number {
  return sessionsOf(model, key).filter((session) => isLive(model, session)).length;
}

/** H3 — a project's sessions on each OTHER desktop, by its places' counts
 * (the owner's catalog, replicated): "4 sessions on Studio". */
export function elsewhereCounts(
  model: HistoryHostModel,
  project: ProjectSummary,
): Array<{ device: HostDevice; sessions: number }> {
  const out: Array<{ device: HostDevice; sessions: number }> = [];
  for (const id of project.devices) {
    if (id === model.self) continue;
    const sessions = project.places
      .filter((place) => place.ref.device === id)
      .reduce((sum, place) => sum + place.sessions, 0);
    if (sessions > 0) out.push({ device: deviceOf(model, id), sessions });
  }
  return out;
}

/** A place's key in ③'s list: its desktop and its id (never a path). */
export function folderKeyOf(place: Pick<ProjectPlace, "ref">): string {
  return `${place.ref.device}\u001f${place.ref.placeId}`;
}

/** The place a folder key names, in one project. */
export function placeOfKey(
  project: ProjectSummary,
  key: string | null | undefined,
): ProjectPlace | undefined {
  if (key === null || key === undefined) return undefined;
  return project.places.find((place) => folderKeyOf(place) === key);
}

/** The project's usual place here (PJ-D6, as far as PJ-4 reads it): the
 * newest place on this desktop that is there to start in; else the newest
 * here at all. fieldd lists places newest first. */
export function usualPlaceOf(
  model: HistoryHostModel,
  project: ProjectSummary,
): ProjectPlace | undefined {
  const here = project.places.filter((place) => place.ref.device === model.self);
  return here.find((place) => place.exists && place.mounted) ?? here[0];
}

/** How many runs work in a place now (New agent's "1 agent is already
 * working there", PJ-L5: load never moves the default; it is said). */
export function workingIn(model: HistoryHostModel, place: ProjectPlace): number {
  let working = 0;
  for (const session of model.sessions.values()) {
    if (
      session.place?.placeId === place.ref.placeId &&
      session.place.device === place.ref.device &&
      isLive(model, session)
    )
      working += 1;
  }
  return working;
}
