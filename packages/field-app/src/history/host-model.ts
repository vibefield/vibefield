import type {
  AgentProfileSet,
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
// catalog's ids, R23) with the Agent Profiles they run in
// (`agents.profileSets.list`, PJ-6 Q2). Pure: the controller (`HistoryView`)
// gathers, this folds; `host-inputs.tsx` draws from it.
// *DS-7 (2026-10-31): the sessions are the mesh's listing now, and the model
// keeps those the room is handed (`isHandedToRoom`): this desktop's, and
// another desktop's of a project that has a folder here.*

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
  /** the sessions the room is handed, by rosetta's id: this desktop's, and
   * since DS-7 another desktop's of a project that has a folder here
   * (`isHandedToRoom`) */
  readonly sessions: ReadonlyMap<string, IndexSession>;
  /** every desktop the listing names, in its order (this one first) */
  readonly devices: readonly HostDevice[];
  /** this desktop's live runs, by the conversation's native id */
  readonly live: ReadonlyMap<string, LiveRun>;
  readonly providers: readonly AgentProviderSummary[];
  /** PJ-6 — the Agent Profiles New agent starts under; empty when unread */
  readonly profileSets: readonly AgentProfileSet[];
  readonly sections: HistorySections;
}

export const EMPTY_HOST_MODEL: HistoryHostModel = {
  self: null,
  projects: new Map(),
  sessions: new Map(),
  devices: [],
  live: new Map(),
  providers: [],
  profileSets: [],
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

/** DS-7 — the projects with a folder on this desktop, by key: the ones
 * History lists (H3), and the ones another desktop's sessions are handed to
 * the room under. None while this desktop is unknown. */
export function projectsHereOf(
  projects: readonly ProjectSummary[],
  self: string | null,
): Set<string> {
  if (self === null) return new Set();
  return new Set(
    projects
      .filter((project) => project.places.some((place) => place.ref.device === self))
      .map((project) => project.key),
  );
}

/** DS-7 (H3 (a)'s "remote sessions arrive with DS-7") — whether the room is
 * handed a session: this desktop's own (its `device`, or none named), or
 * another desktop's whose project has a folder here, its transcript read from
 * its own desktop by ticket (`session-port.ts`) and its acts said, never
 * pressed, here (`resumeWaits`). Another desktop's session with no project
 * here — its Home, its Temporary, a project only it holds — is not handed
 * over; nor, with this desktop unknown, is anything that names a desktop. */
export function isHandedToRoom(
  session: Pick<IndexSession, "device" | "projectKey">,
  self: string | null,
  here: ReadonlySet<string>,
): boolean {
  if (session.device === undefined) return true;
  if (self === null) return false;
  return (
    session.device === self || (session.projectKey !== undefined && here.has(session.projectKey))
  );
}

/** DS-7 — a session another desktop holds and this one does not (DS-D10: a
 * row whose `devices` names this desktop is read here), or null. */
export function elsewhereDeviceOf(
  session: Pick<IndexSession, "device" | "devices">,
  self: string | null,
): string | null {
  if (session.device === undefined || self === null || session.device === self) return null;
  return session.devices?.includes(self) === true ? null : session.device;
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
  profileSets: readonly AgentProfileSet[] = [],
): HistoryHostModel {
  const here = projectsHereOf(listing.projects, listing.self);
  const sessions = new Map(
    listing.sessions
      .filter((session) => isHandedToRoom(session, listing.self, here))
      .map((session) => [session.sessionId, session]),
  );
  return {
    self: listing.self,
    projects: new Map(listing.projects.map((project) => [project.key, project])),
    sessions,
    devices: hostDevicesOf(listing.sources, roster, listing.self),
    live: liveRunsOf(liveRows, sessions.values()),
    providers,
    profileSets,
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
