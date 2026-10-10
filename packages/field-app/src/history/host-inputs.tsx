import type { SessionRow } from "@rosetta/protocol";
import type {
  RoomAct,
  RoomFilter,
  RoomFolder,
  RoomFolderGroup,
  RoomFolders,
  RoomHeadActs,
  RoomHostInputs,
  RoomMenuGroup,
  RoomMenuItem,
  RoomProjectRow,
  RoomSection,
  RoomSessionRow,
} from "@rosetta/room";
import type {
  AgentProviderSummary,
  IndexSession,
  ProjectIntentParams,
  ProjectPlace,
  ProjectSuggestion,
  ProjectSummary,
} from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { projectInk } from "@vibefield/design-kit/project-ink";
import { type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { FOLDER_GONE } from "../godview/launcher-doors";
import { OS_LABEL, OsMark } from "../godview/os-marks";
import { hostKeyOf, type NewAgentAsk, type SessionTarget } from "./acts";
import {
  deviceOf,
  elsewhereCounts,
  folderKeyOf,
  type HistoryHostModel,
  type HostDevice,
  isLive,
  liveCountOf,
  placeOfKey,
  sessionsOf,
  usualPlaceOf,
  workingIn,
} from "./host-model";

// HISTORY BY PROJECT, AS THE ROOM DRAWS IT (PJ-4's second half; H1 "we map,
// the room draws"; rosetta `host-inputs.ts`, ROOM API v1/v2). Everything here
// is a host input the room draws in its own vocabulary and never interprets
// (A-D9): a colour, marks, sections, row and head acts, ③'s folders, chips. It
// is PURE — `historyHostInputs(model, state, acts)` over the host model
// (`host-model.ts`), the controller's small UI state (filters, a rename) and
// its acts (`acts.ts`) — so the product and the catalog draw the same thing
// over different data. The room calls these during its render: the controller
// memoizes the whole object per model and state (ROOM API v1).
//
// What each one is, in the record's words (thinking-project-places.md §6.1,
// DESIGN.md §8 "History by project"):
//   R1 the project's ink (§2.9), never the room's dealt tint;
//   R2 one OS mark per desktop the project lives on, left-aligned, faint
//      while asleep (PJ-D24, PJ-L6), "n sessions on Studio" (H3), "n live";
//   R3 Live now first, Pinned, the projects in the room's order, Temporary
//      one folded row at the foot (H5), Hidden folded under it (H4) — and in
//      a project, Live now first, its days, and Temporary's sessions older
//      than 14 days behind "Show older";
//   R4 a session's mark and folder in the id slot, Resume or Jump to — or the
//      reason — at its end (PJ-D9), and a device-qualified host key;
//   R5 New agent (H6) and the project's acts (H4) in ②'s head, the
//      suggestions or a rename in its card, Resume or Jump to in ④'s;
//   R6 ③'s head as every folder by desktop — one on another desktop says
//      "Files stay on Studio" (PJ-D22) and is never opened here;
//   R7 a desktop chip over the list, an agent chip over a project.

/* ── the state the controller keeps, and its acts ──────────────────────── */

export interface HistoryHostState {
  /** ①'s desktop chip: a desktop's id, or null for any */
  readonly desktop: string | null;
  /** ②'s agent chip: a catalog id, or null for any */
  readonly agent: string | null;
  /** the project being renamed in its card (H4), or null */
  readonly renaming: string | null;
  /** each project's suggestions, once `project.get` answered them (PJ-D16) */
  readonly suggestions: ReadonlyMap<string, readonly ProjectSuggestion[]>;
  /** the window's home, so a path under it reads `~/…` (AR-8 L2) */
  readonly home: string | null;
}

export const NO_HOST_STATE: HistoryHostState = {
  desktop: null,
  agent: null,
  renaming: null,
  suggestions: new Map(),
  home: null,
};

export interface HistoryHostActs {
  setDesktop(desktop: string | null): void;
  setAgent(agent: string | null): void;
  resume(target: SessionTarget): void;
  jump(target: SessionTarget): void;
  newAgent(ask: NewAgentAsk): void;
  /** H4 — an act on a project, and the words its outcome is said in */
  intent(params: ProjectIntentParams, words: { done: string; verb: string }): void;
  rename(key: string | null): void;
  /** ③ shows a folder of a project now (R6's `onShow`) */
  shown(project: string, folder: string | null): void;
}

/* ── small parts the room draws where it is told ──────────────────────── */

/** A path under the window's home as `~/…`, else in full. */
export function homePath(path: string, home: string | null): string {
  if (home === null || home === "") return path;
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === base) return "~";
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

/** FitPath (PJ §6.1): a path that drops whole leading folders until it fits
 * its slot (`~/Projects/p/vibe-field` → `…/p/vibe-field` → `…/vibe-field`),
 * never a folder cut mid-word; the whole path is its title. */
export function FitPath({ path }: { path: string }): ReactElement {
  const names = path.split("/").filter((name, index) => name !== "" || index === 0);
  const [drop, setDrop] = useState({ path, drop: 0 });
  const dropped = drop.path === path ? drop.drop : 0;
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || el.clientWidth <= 0) return;
    if (el.scrollWidth > el.clientWidth + 0.5 && dropped < names.length - 1)
      setDrop({ path, drop: dropped + 1 });
  });
  const shown = dropped === 0 ? path : `…/${names.slice(dropped).join("/")}`;
  return (
    <span ref={ref} className="vf-history-fitpath" title={path}>
      {shown}
    </span>
  );
}

/** One desktop's mark (PJ-D24): its OS, never a hue; faint while asleep. */
export function DeviceMark({ device }: { device: HostDevice }): ReactElement {
  const words = `${device.name}${device.here ? " (here)" : ""}${device.asleep ? " · asleep" : ""}`;
  return (
    <span
      className="vf-history-mark"
      data-asleep={device.asleep ? "true" : undefined}
      title={words}
      aria-label={`${OS_LABEL[device.os]} — ${words}`}
      role="img"
    >
      <OsMark os={device.os} size={11} />
    </span>
  );
}

function glyphAct(glyph: "resume" | "jump" | "start" | "ellipsis", word?: string): ReactNode {
  return (
    <span className="vf-history-act">
      <FieldGlyph name={glyph} size={13} />
      {word !== undefined && <span>{word}</span>}
    </span>
  );
}

/* ── R4 / R5 ④: a session's act ────────────────────────────────────────── */

/** The provider a session ran under, as this desktop offers it now. */
function providerOf(
  model: HistoryHostModel,
  session: IndexSession,
): AgentProviderSummary | undefined {
  return model.providers.find((provider) => provider.id === session.provider);
}

/** The place a session's folder is, in its project (fieldd's join, R6). */
function placeOfSession(model: HistoryHostModel, session: IndexSession): ProjectPlace | undefined {
  if (session.place === undefined || session.projectKey === undefined) return undefined;
  const project = model.projects.get(session.projectKey);
  return project?.places.find(
    (place) =>
      place.ref.placeId === session.place?.placeId && place.ref.device === session.place.device,
  );
}

/** Why a session cannot be resumed from here, read from what the model
 * holds (the launcher's words), or null. The press reads it again whole
 * (`readResume`), so a folder gone since the scan is still said then. */
export function resumeWaits(model: HistoryHostModel, session: IndexSession): string | null {
  // the empty pane launcher's own words and order (`launcher-doors.ts`'s
  // `unresumable`): a folder gone before an install, which a person can fix
  if (session.provider === undefined || session.nativeSessionId === "") return "can’t resume";
  const provider = providerOf(model, session);
  if (provider === undefined) return "not offered here";
  if (!provider.resumable || provider.offers?.resume === false) return "can’t resume";
  const place = placeOfSession(model, session);
  if (place !== undefined && !place.mounted) return "its volume is not connected";
  if (place !== undefined && !place.exists) return FOLDER_GONE;
  if (!provider.available) return "not installed";
  return null;
}

function targetOf(model: HistoryHostModel, session: IndexSession): SessionTarget {
  return {
    sessionId: session.sessionId,
    nativeSessionId: session.nativeSessionId,
    folder: session.cwd ?? null,
    hostKey: hostKeyOf(session.device ?? model.self ?? "", session.sessionId),
  };
}

/** A session's act — Jump to while it runs here (P3), else Resume — or the
 * reason it has none (PJ-D9), for its row (R4) and ④'s head (R5). */
function sessionAct(
  model: HistoryHostModel,
  session: IndexSession,
  acts: HistoryHostActs,
  place: "row" | "head",
): { act?: RoomAct; reason?: ReactNode } {
  const target = targetOf(model, session);
  if (isLive(model, session))
    return {
      act: {
        key: "jump",
        label: "Jump to this session",
        content: glyphAct("jump", place === "row" ? "Jump to" : "Jump to"),
        onPress: () => acts.jump(target),
      },
    };
  const waits = resumeWaits(model, session);
  if (waits !== null) return { reason: <span className="vf-history-reason">{waits}</span> };
  return {
    act: {
      key: "resume",
      label: "Resume this session",
      content: glyphAct("resume", "Resume"),
      onPress: () => acts.resume(target),
    },
  };
}

/* ── R6: ③'s folders ───────────────────────────────────────────────────── */

function placeDetail(model: HistoryHostModel, place: ProjectPlace): string | undefined {
  const working = workingIn(model, place);
  const parts = [
    place.branch,
    working > 0 ? `${working} working` : place.sessions > 0 ? `${place.sessions} sessions` : null,
  ].filter((part): part is string => typeof part === "string" && part !== "");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Why a folder cannot be opened here — ③ draws this instead (R6's
 * `elsewhere`) — or undefined. */
function elsewhereOf(
  model: HistoryHostModel,
  place: ProjectPlace,
  device: HostDevice,
): string | undefined {
  if (!device.here)
    return device.asleep
      ? `${device.name} is asleep — its files stay on ${device.name}`
      : `Files stay on ${device.name}`;
  if (!place.mounted) return "Its volume is not connected";
  if (!place.exists) return "This folder is gone";
  return undefined;
}

function foldersOf(
  model: HistoryHostModel,
  project: ProjectSummary,
  state: HistoryHostState,
  acts: HistoryHostActs,
): RoomFolders {
  const groups: RoomFolderGroup[] = [];
  let count = 0;
  for (const device of model.devices) {
    const places = project.places.filter((place) => place.ref.device === device.id);
    if (places.length === 0) continue;
    count += places.length;
    groups.push({
      key: device.id,
      title: (
        <span className="vf-history-group">
          <DeviceMark device={device} />
          <span>{device.name}</span>
          {device.here ? <small>here</small> : device.asleep ? <small>asleep</small> : null}
        </span>
      ),
      folders: places.map((place): RoomFolder => {
        const elsewhere = elsewhereOf(model, place, device);
        const path = place.path ?? place.name;
        return {
          key: folderKeyOf(place),
          path,
          mark: <DeviceMark device={device} />,
          label: homePath(path, device.here ? state.home : null),
          ...(placeDetail(model, place) !== undefined ? { detail: placeDetail(model, place) } : {}),
          ...(place.worktreeOf !== undefined ? { depth: 1 as const } : {}),
          // lane room's finding 4: an elsewhere folder leaves the worktree
          // engine on its last root, so ITS caption names it — always
          ...(elsewhere !== undefined
            ? {
                caption: [device.here ? null : device.name, place.branch ?? place.name]
                  .filter((part): part is string => part !== null && part !== undefined)
                  .join(" · "),
                elsewhere: <span className="vf-history-elsewhere">{elsewhere}</span>,
              }
            : {}),
        };
      }),
    });
  }
  const usual = usualPlaceOf(model, project);
  return {
    groups,
    ...(usual !== undefined ? { initial: folderKeyOf(usual) } : {}),
    of: (session: SessionRow) => {
      const own = model.sessions.get(session.root_session_id) ?? model.sessions.get(session.id);
      const place = own === undefined ? undefined : placeOfSession(model, own);
      return place === undefined ? null : folderKeyOf(place);
    },
    filterAfter: 9,
    filterPlaceholder: `Filter ${count} folders`,
    onShow: (key) => acts.shown(project.key, key),
  };
}

/* ── R5 ②: New agent and the project's acts ────────────────────────────── */

/** The agents New agent offers: this desktop's, installed and able to start
 * (the catalog's ids — `agent.providers` — never a literal, R23), newest
 * used first; each persona its own row. */
function newAgentRows(
  model: HistoryHostModel,
  start: ((provider: AgentProviderSummary, profileId?: string) => void) | null,
  why: string | null,
): RoomMenuItem[] {
  const usable = model.providers
    .filter(
      (provider) =>
        provider.available && provider.offers?.spawn !== false && provider.status !== "declined",
    )
    .sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0));
  return usable.flatMap((provider) => {
    const personas = provider.personas.length > 0 ? provider.personas : [null];
    return personas.map((persona): RoomMenuItem => {
      const pick = start;
      return {
        key: `${provider.id}\u001f${persona?.profileId ?? ""}`,
        label: provider.label,
        aside: persona === null ? "its own" : persona.label,
        ...(why !== null ? { disabled: true, detail: why } : {}),
        ...(pick !== null && why === null
          ? { onSelect: () => pick(provider, persona?.profileId) }
          : {}),
      };
    });
  });
}

function newAgentAct(
  model: HistoryHostModel,
  project: ProjectSummary,
  folder: string | null,
  state: HistoryHostState,
  acts: HistoryHostActs,
): RoomAct {
  const place = placeOfKey(project, folder) ?? usualPlaceOf(model, project);
  const device = place === undefined ? undefined : deviceOf(model, place.ref.device);
  const path = place?.path ?? place?.name ?? null;
  let why: string | null = null;
  if (place === undefined || path === null) why = "no folder of this project is here to start in";
  else if (device !== undefined && !device.here)
    why = `it starts on ${device.name} — not from here until routed acts (DS-2)`;
  else if (!place.mounted) why = "its volume is not connected";
  else if (!place.exists) why = "the folder is gone";
  const where = path === null ? "" : homePath(path, device?.here === true ? state.home : null);
  const working = place === undefined ? 0 : workingIn(model, place);
  const startsIn: RoomMenuGroup = {
    key: "starts-in",
    title: "Starts in",
    items: [
      {
        key: "where",
        ...(device !== undefined ? { mark: <DeviceMark device={device} /> } : {}),
        label: where === "" ? "nowhere yet" : where,
        ...(why !== null
          ? { detail: why, disabled: true }
          : {
              detail:
                [
                  place?.branch,
                  working === 1
                    ? "1 agent is already working there"
                    : working > 1
                      ? `${working} agents are already working there`
                      : null,
                ]
                  .filter((part): part is string => typeof part === "string")
                  .join(" · ") || "follows the folder shown on the right",
            }),
      },
    ],
  };
  const agents = newAgentRows(
    model,
    path === null
      ? null
      : (provider, profileId) =>
          acts.newAgent({ provider: provider.id, profileId, cwd: path, where }),
    why,
  );
  return {
    key: "new-agent",
    label: "New agent",
    content: glyphAct("start"),
    primary: true,
    menu: {
      label: "New agent",
      groups: [
        startsIn,
        { key: "agents", title: "Agent", items: agents },
        {
          key: "options",
          title: "Model and effort",
          items: [
            {
              key: "model-effort",
              label: "Each agent's own",
              detail: "Model and effort can't be set from here yet (PJ-6)",
              disabled: true,
            },
          ],
        },
      ],
      empty: "No agent here can start one",
    },
  };
}

/** H4 — the project's acts, in ②'s head behind its `···`: rename, pin, hide,
 * and a folder's "Not part of this project" (split). Temporary is not a
 * project: it has none (absent, never disabled — D-i6). */
function projectActsAct(project: ProjectSummary, acts: HistoryHostActs): RoomAct | null {
  if (project.bucket === "temp") return null;
  const key = project.key;
  const main: RoomMenuItem[] = [
    { key: "rename", label: "Rename…", onSelect: () => acts.rename(key) },
    {
      key: "pin",
      label: project.pinned === true ? "Unpin" : "Pin to the top",
      onSelect: () =>
        acts.intent(
          { key, op: "pin", pinned: project.pinned !== true },
          project.pinned === true
            ? { done: `Unpinned ${project.name}`, verb: "unpin" }
            : { done: `Pinned ${project.name}`, verb: "pin" },
        ),
    },
    {
      key: "hide",
      label: project.hidden === true ? "Show again" : "Hide",
      detail: project.hidden === true ? undefined : "It folds under Hidden, at the list's foot",
      onSelect: () =>
        acts.intent(
          { key, op: "hide", hidden: project.hidden !== true },
          project.hidden === true
            ? { done: `${project.name} shows again`, verb: "show it again" }
            : { done: `Hid ${project.name}`, verb: "hide it" },
        ),
    },
  ];
  const groups: RoomMenuGroup[] = [{ key: "project", items: main }];
  // a desktop's Home groups by its desktop alone: nothing to split (J11)
  if (project.kind !== "home" && project.places.length > 1)
    groups.push({
      key: "split",
      title: "Not part of this project",
      items: project.places.map(
        (place): RoomMenuItem => ({
          key: folderKeyOf(place),
          label: place.path ?? place.name,
          ...(place.branch !== undefined ? { detail: place.branch } : {}),
          filterText: place.path ?? place.name,
          onSelect: () =>
            acts.intent(
              { key, op: "split", place: place.ref },
              { done: `${place.name} is no longer part of ${project.name}`, verb: "split it" },
            ),
        }),
      ),
    });
  return {
    key: "project-acts",
    label: "Project acts",
    content: glyphAct("ellipsis"),
    menu: {
      label: `${project.name} — acts`,
      groups,
      filterAfter: 12,
      filterPlaceholder: "Filter folders",
    },
  };
}

/* ── the cards ─────────────────────────────────────────────────────────── */

/** H4's rename, in ②'s card slot: the name in a field, Enter to keep it,
 * Escape to leave it. (The room has no editable name of its own: a v3 ask.) */
export function RenameCard({
  name,
  onDone,
}: {
  name: string;
  onDone: (next: string | null) => void;
}): ReactElement {
  const [value, setValue] = useState(name);
  return (
    <form
      className="vf-history-card vf-history-rename"
      onSubmit={(event) => {
        event.preventDefault();
        const next = value.trim();
        onDone(next === "" || next === name ? null : next);
      }}
    >
      <label>
        <span>Rename the project</span>
        <input
          // biome-ignore lint/a11y/noAutofocus: the person just asked to rename it
          autoFocus
          value={value}
          maxLength={120}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onDone(null);
            }
          }}
        />
      </label>
      <div className="vf-history-card-acts">
        <button type="button" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" data-primary="true">
          Rename
        </button>
      </div>
    </form>
  );
}

const SUGGESTION_WORDS: Record<string, string> = {
  "related-history": "shares old history with",
  "shared-remote": "shares a remote with",
  "same-folder": "is in the same folder as",
  "same-name": "has the same name as",
};

/** PJ-D16 — what only SUGGESTS this project is another's (§4.2), one row per
 * pair: join them (a link), or say they are not (a dismissal). */
function SuggestionsCard({
  project,
  suggestions,
  model,
  acts,
}: {
  project: ProjectSummary;
  suggestions: readonly ProjectSuggestion[];
  model: HistoryHostModel;
  acts: HistoryHostActs;
}): ReactElement {
  return (
    <section className="vf-history-card vf-history-suggestions" aria-label="Suggestions">
      {suggestions.map((suggestion) => {
        const other = model.projects.get(suggestion.with);
        const name = other?.name ?? "another project";
        return (
          <div key={`${suggestion.type}\u001f${suggestion.with}`} className="vf-history-suggestion">
            <p>
              {project.name} {SUGGESTION_WORDS[suggestion.type] ?? "may be the same as"}{" "}
              <b>{name}</b>
            </p>
            <div className="vf-history-card-acts">
              <button
                type="button"
                onClick={() =>
                  acts.intent(
                    { key: project.key, op: "dismiss", with: suggestion.with },
                    { done: `Kept ${project.name} and ${name} apart`, verb: "keep them apart" },
                  )
                }
              >
                Not the same
              </button>
              <button
                type="button"
                data-primary="true"
                onClick={() =>
                  acts.intent(
                    { key: project.key, op: "link", place: suggestion.b },
                    { done: `Joined ${name} to ${project.name}`, verb: "join them" },
                  )
                }
              >
                One project
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ── R7: the chips ─────────────────────────────────────────────────────── */

function desktopChip(
  model: HistoryHostModel,
  chosen: string | null,
  counts: (device: HostDevice) => number,
  onChoose: (desktop: string | null) => void,
  why: (device: HostDevice) => string | null,
): RoomFilter {
  const device = chosen === null ? undefined : deviceOf(model, chosen);
  return {
    key: "desktop",
    label:
      device === undefined ? (
        "any desktop"
      ) : (
        <span className="vf-history-chip">
          <DeviceMark device={device} />
          {device.name}
        </span>
      ),
    accessibleLabel: "Filter by desktop",
    set: device !== undefined,
    menu: {
      label: "Desktops",
      groups: [
        {
          key: "any",
          items: [
            {
              key: "any",
              label: "Any desktop",
              checked: chosen === null,
              onSelect: () => onChoose(null),
            },
          ],
        },
        {
          key: "desktops",
          items: model.devices.map((each): RoomMenuItem => {
            const reason = why(each);
            return {
              key: each.id,
              mark: <DeviceMark device={each} />,
              label: each.name,
              aside: each.here ? "here" : each.asleep ? "asleep" : String(counts(each)),
              ...(reason !== null ? { disabled: true, detail: reason } : {}),
              checked: chosen === each.id,
              ...(reason === null ? { onSelect: () => onChoose(each.id) } : {}),
            };
          }),
        },
      ],
    },
  };
}

function agentChip(
  model: HistoryHostModel,
  sessions: readonly IndexSession[],
  chosen: string | null,
  onChoose: (agent: string | null) => void,
): RoomFilter | null {
  const counts = new Map<string, number>();
  for (const session of sessions)
    if (session.provider !== undefined)
      counts.set(session.provider, (counts.get(session.provider) ?? 0) + 1);
  if (counts.size === 0) return null;
  const labelOf = (id: string) =>
    model.providers.find((provider) => provider.id === id)?.label ?? id;
  return {
    key: "agent",
    label: chosen === null ? "any agent" : labelOf(chosen),
    accessibleLabel: "Filter by agent",
    set: chosen !== null,
    menu: {
      label: "Agents",
      groups: [
        {
          key: "any",
          items: [
            {
              key: "any",
              label: "Any agent",
              checked: chosen === null,
              onSelect: () => onChoose(null),
            },
          ],
        },
        {
          key: "agents",
          items: [...counts.entries()].map(
            ([id, count]): RoomMenuItem => ({
              key: id,
              label: labelOf(id),
              aside: String(count),
              checked: chosen === id,
              onSelect: () => onChoose(id),
            }),
          ),
        },
      ],
    },
  };
}

/* ── R3: the sections ──────────────────────────────────────────────────── */

/** ①'s sections: Live now · Pinned · the projects (the room's order) ·
 * Temporary folded (H5) · Hidden folded (H4). With a desktop chosen, every
 * section names its rows, so a project without a place there is not drawn. */
export function projectSectionsOf(model: HistoryHostModel, state: HistoryHostState): RoomSection[] {
  const listed = [...model.projects.values()].filter((project) =>
    project.places.some((place) => place.ref.device === model.self),
  );
  const passes = (project: ProjectSummary) =>
    state.desktop === null || project.places.some((place) => place.ref.device === state.desktop);
  const shown = listed.filter(passes);
  const hidden = shown.filter((project) => project.hidden === true);
  const temporary = shown.filter((project) => project.bucket === "temp" && project.hidden !== true);
  const live = shown.filter(
    (project) => project.hidden !== true && liveCountOf(model, project.key) > 0,
  );
  const pinned = shown.filter((project) => project.pinned === true && project.hidden !== true);
  const sections: RoomSection[] = [
    { key: "live", title: "Live now", ids: live.map((p) => p.key), order: "room" },
    { key: "pinned", title: "Pinned", ids: pinned.map((p) => p.key), order: "room" },
  ];
  const rest = shown.filter((project) => project.hidden !== true && project.bucket !== "temp");
  sections.push(
    state.desktop === null
      ? { key: "projects" }
      : { key: "projects", ids: rest.map((p) => p.key), order: "room" },
  );
  const recent = model.sections.temporary?.recent.length ?? 0;
  if (temporary.length > 0)
    sections.push({
      key: "temporary",
      ids: temporary.map((p) => p.key),
      fold: { label: "Temporary", act: "Show", count: recent },
    });
  if (hidden.length > 0)
    sections.push({
      key: "hidden",
      ids: hidden.map((p) => p.key),
      fold: { label: "Hidden", act: "Show" },
    });
  // with no desktop chosen the list keeps a home for every other row (the
  // section without ids); with one chosen, every section names its rows
  return sections;
}

/** ②'s sections for one project: Live now · its days (the room's) · and for
 * Temporary, the sessions older than 14 days behind "Show older" (H5). With
 * an agent chosen, every section names its rows. */
export function sessionSectionsOf(
  model: HistoryHostModel,
  state: HistoryHostState,
  key: string,
): RoomSection[] {
  const all = sessionsOf(model, key);
  const passes = (session: IndexSession) =>
    state.agent === null || session.provider === state.agent;
  const shown = all.filter(passes);
  const live = shown.filter((session) => isLive(model, session));
  const older =
    model.sections.temporary?.key === key
      ? new Set(model.sections.temporary.older)
      : new Set<string>();
  const sections: RoomSection[] = [
    { key: "live", title: "Live now", ids: live.map((s) => s.sessionId) },
  ];
  const days = shown.filter((session) => !older.has(session.sessionId));
  sections.push(
    state.agent === null
      ? { key: "days" }
      : { key: "days", ids: days.map((s) => s.sessionId), order: "room" },
  );
  const folded = shown.filter((session) => older.has(session.sessionId));
  if (older.size > 0)
    sections.push({
      key: "older",
      ids: folded.map((s) => s.sessionId),
      order: "room",
      fold: { label: "Older than 14 days", act: "Show older" },
    });
  return sections;
}

/* ── everything, as the room takes it ──────────────────────────────────── */

export function historyHostInputs(
  model: HistoryHostModel,
  state: HistoryHostState,
  acts: HistoryHostActs,
): RoomHostInputs {
  const project = (key: string) => model.projects.get(key);
  return {
    projectTint: (key) => {
      const found = project(key);
      return found === undefined ? null : projectInk(found.ink);
    },
    projectRow: (key): RoomProjectRow | null => {
      const found = project(key);
      if (found === undefined) return null;
      const devices = model.devices.filter((device) => found.devices.includes(device.id));
      const elsewhere = elsewhereCounts(model, found);
      return {
        marks: (
          <span className="vf-history-marks">
            {devices.map((device) => (
              <DeviceMark key={device.id} device={device} />
            ))}
          </span>
        ),
        ...(elsewhere.length > 0
          ? {
              line: (
                <span className="vf-history-elsewhere-line">
                  {elsewhere
                    .map(
                      ({ device, sessions }) =>
                        `${sessions} ${sessions === 1 ? "session" : "sessions"} on ${device.name}${device.asleep ? " (asleep)" : ""}`,
                    )
                    .join(" · ")}
                </span>
              ),
            }
          : {}),
        live: liveCountOf(model, key),
      };
    },
    projectSections: projectSectionsOf(model, state),
    sessionSections: (key) =>
      project(key) === undefined ? null : sessionSectionsOf(model, state, key),
    sessionRow: (row): RoomSessionRow | null => {
      const session = model.sessions.get(row.id);
      if (session === undefined) return null;
      const here = deviceOf(model, session.device ?? model.self ?? "");
      const path = session.cwd ?? null;
      const { act, reason } = sessionAct(model, session, acts, "row");
      return {
        hostKey: hostKeyOf(here.id, session.sessionId),
        id: (
          <span className="vf-history-where">
            <DeviceMark device={here} />
            {path !== null && <FitPath path={homePath(path, state.home)} />}
          </span>
        ),
        ...(path !== null ? { idTitle: path } : {}),
        ...(act !== undefined ? { act } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };
    },
    projectActs: (key, context) => {
      const found = project(key);
      if (found === undefined) return null;
      const own = projectActsAct(found, acts);
      return [
        newAgentAct(model, found, context.folder, state, acts),
        ...(own === null ? [] : [own]),
      ];
    },
    projectCard: (key) => {
      const found = project(key);
      if (found === undefined) return null;
      if (state.renaming === key)
        return (
          <RenameCard
            key={`rename-${key}`}
            name={found.name}
            onDone={(next) => {
              acts.rename(null);
              if (next !== null)
                acts.intent(
                  { key, op: "rename", name: next },
                  { done: `Renamed to ${next}`, verb: "rename it" },
                );
            }}
          />
        );
      const suggestions = state.suggestions.get(key) ?? [];
      return suggestions.length === 0 ? null : (
        <SuggestionsCard project={found} suggestions={suggestions} model={model} acts={acts} />
      );
    },
    sessionActs: (row): RoomHeadActs | null => {
      const session = model.sessions.get(row.root_session_id) ?? model.sessions.get(row.id);
      if (session === undefined) return null;
      const { act, reason } = sessionAct(model, session, acts, "head");
      return {
        ...(act !== undefined ? { acts: [act] } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };
    },
    folders: (key) => {
      const found = project(key);
      return found === undefined ? null : foldersOf(model, found, state, acts);
    },
    projectFilters: [
      desktopChip(
        model,
        state.desktop,
        (device) =>
          [...model.projects.values()].filter(
            (each) =>
              each.places.some((place) => place.ref.device === model.self) &&
              each.places.some((place) => place.ref.device === device.id),
          ).length,
        acts.setDesktop,
        (device) =>
          device.here ||
          [...model.projects.values()].some(
            (each) =>
              each.places.some((place) => place.ref.device === model.self) &&
              each.places.some((place) => place.ref.device === device.id),
          )
            ? null
            : "none of the projects here lives on it",
      ),
    ],
    sessionFilters: (key) => {
      const found = project(key);
      if (found === undefined) return null;
      const chips: RoomFilter[] = [];
      const agent = agentChip(model, sessionsOf(model, key), state.agent, acts.setAgent);
      if (agent !== null) chips.push(agent);
      return chips;
    },
  };
}
