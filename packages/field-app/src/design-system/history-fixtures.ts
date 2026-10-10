import type { CatalogPort, CatalogStatus, RoomPorts } from "@rosetta/room";
import { createDemoPorts, createRoomDemo, type RoomDemo } from "@rosetta/room/fixtures";
import type {
  IndexCatalogSource,
  IndexSession,
  ProjectFiguresDayResult,
  ProjectFiguresResult,
  ProjectSummary,
} from "@vibefield/contracts";
import { catalogPortOver, type HistoryDoorClient } from "../history/doors";

// History's FIXTURE ADAPTER (AR-8c; docs/UI_SYSTEM.md "Catalog fidelity"). The
// catalog mounts the SHIPPING `HistoryRoomView` over the room package's own
// fixture entry (`@rosetta/room/fixtures`: six projects, eleven sessions, a
// year of figures, two transcripts — all relative to now), never a copy of the
// room's markup or CSS. What this file adds is only what a HOST supplies in
// the two states the package's demo does not draw: an index that cannot
// answer, and one waiting for consent — each a catalog port whose answers say
// so, the way fieldd's doors would.

/** The states the catalog draws History in. `projects`: History BY PROJECT
 * (PJ-4) — the shipping adapter (`history/doors.ts`) over a fixture fieldd
 * that answers `project.list`, the keyed listing and the merged figures. */
export const HISTORY_STATES = ["room", "chosen", "projects", "unavailable", "consent"] as const;
export type HistoryState = (typeof HISTORY_STATES)[number];

/** The words the frame says under "rosettad is not answering" in the
 * unavailable plate — fieldd's own UNAVAILABLE message for an index that is
 * coming up, as `history/doors.ts` says it. */
export const FIXTURE_UNAVAILABLE_WORDS = "The agent index is starting";

/** The demo session the chosen plate opens at: the conversation with images,
 * web lines and a run still going. */
export const FIXTURE_CHOSEN_SESSION = "s0";

/** The words the Peek's plate holds (`PeekPreview.tsx`): the demo catalog's
 * own `search` answers them from the transcripts' words — three messages in
 * the chosen conversation say "plus", so the row carries three lines and the
 * peek beside it shows them. */
export const FIXTURE_SEARCH_QUERY = "plus";

/** An index that does not answer: the topology stream closes without a row,
 * and the status door refuses in the frame's words. */
function unavailableCatalog(catalog: CatalogPort): CatalogPort {
  return {
    ...catalog,
    subscribeMeta(handlers) {
      let open = true;
      queueMicrotask(() => {
        if (open) handlers.onStatus?.("closed");
      });
      return {
        close: () => {
          open = false;
        },
      };
    },
    status: async () => {
      throw new Error(FIXTURE_UNAVAILABLE_WORDS);
    },
    unavailable: () => FIXTURE_UNAVAILABLE_WORDS,
  };
}

/** An index that has found agents and reads nothing until it is told which:
 * an empty topology, and the ingest phase that says why. */
const AWAITING_CONSENT: CatalogStatus = {
  canonicalReady: false,
  searchReadiness: "building",
  searchProgress: null,
  ingest: { phase: "awaiting_consent", runtimes: [], projects: [] },
  startedAt: null,
  uptimeMs: 0,
};

function consentCatalog(catalog: CatalogPort): CatalogPort {
  return {
    ...catalog,
    subscribeMeta(handlers) {
      let open = true;
      queueMicrotask(() => {
        if (!open) return;
        handlers.onStatus?.("live");
        handlers.onChange?.({ runtimes: [], projects: [], sessions: [] }, "snapshot");
      });
      return {
        close: () => {
          open = false;
        },
      };
    },
    status: async () => AWAITING_CONSENT,
  };
}

/* ── History by project (PJ-4): a fixture fieldd under the shipping adapter ── */

/** The desktop the plate is drawn on, and the one beside it that is asleep. */
export const FIXTURE_DESKTOP = "01J9ZK3M5Q8XR2V7N4B6C1D0EF";
const FIXTURE_LAPTOP = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9";

/** The catalog agent each demo runtime stands for (the catalog's own ids). */
const FIXTURE_AGENT: Record<string, string> = { claude: "claude", codex: "codex" };

const keyOf = (name: string): string => `p1:demo-${name}`;

/** fieldd's projects over the demo's folders, as `project.list` answers a
 * window: one per demo folder (the first also holds a checkout on the asleep
 * laptop — a place the room is never handed), and this desktop's Home and
 * the Temporary bucket. */
function fixtureProjects(demo: RoomDemo): ProjectSummary[] {
  const place = (device: string, id: string, path: string, sessions: number) => ({
    ref: { device, placeId: `pl_${id}` },
    name: path.split("/").pop() ?? path,
    path,
    class: "repo" as const,
    exists: true,
    mounted: true,
    sessions,
  });
  const counted = (projectId: string) =>
    demo.meta.sessions.filter((row) => row.project_id === projectId).length;
  const repos = demo.meta.projects.map((row, index): ProjectSummary => {
    const here = place(
      FIXTURE_DESKTOP,
      row.id,
      row.root_paths[0] ?? `/Users/demo/${row.name}`,
      counted(row.id),
    );
    const places =
      index === 0
        ? [here, place(FIXTURE_LAPTOP, `${row.id}-laptop`, `/Users/demo/code/${row.name}`, 0)]
        : [here];
    return {
      key: keyOf(row.name),
      provisional: true,
      name: row.name,
      nameFrom: row.git_repo === null ? "folder" : "repository",
      ink: index * 83,
      kind: row.git_repo === null ? "folder" : "repo",
      bucket: null,
      devices: [...new Set(places.map((p) => p.ref.device))],
      places,
      sessions: counted(row.id),
      allGone: false,
      anchors: [
        ...places.map((p) => `place:${p.ref.placeId}`),
        ...(row.git_repo === null ? [] : [`remote:${row.git_repo}`]),
      ],
      asOf: {},
      groupingVersion: 2,
    };
  });
  const bucket = (
    key: string,
    name: string,
    kind: "home" | "temp",
    path: string,
  ): ProjectSummary => ({
    key,
    provisional: true,
    name,
    nameFrom: kind === "home" ? "home" : "bucket",
    ink: kind === "home" ? 17 : 0,
    kind,
    bucket: kind === "temp" ? "temp" : null,
    devices: [FIXTURE_DESKTOP],
    places: [{ ...place(FIXTURE_DESKTOP, key, path, 0), class: kind }],
    sessions: 0,
    allGone: false,
    anchors: [`place:pl_${key}`],
    asOf: {},
    groupingVersion: 2,
  });
  return [
    ...repos,
    bucket("p1:demo-home", "Home", "home", "/Users/demo"),
    bucket("p1:demo-temp", "Temporary", "temp", "/private/tmp"),
  ];
}

/** The demo's sessions as this desktop's listing — each filed by fieldd under
 * its project's key (A-D4). */
function fixtureSessions(demo: RoomDemo): IndexSession[] {
  const names = new Map(demo.meta.projects.map((row) => [row.id, row.name]));
  return demo.meta.sessions.map((row) => {
    const project = row.project_id === null ? undefined : names.get(row.project_id);
    const provider = FIXTURE_AGENT[row.runtime_id];
    return {
      sessionId: row.id,
      nativeSessionId: row.native_session_id,
      rootSessionId: row.root_session_id,
      ...(row.title !== null ? { title: row.title } : {}),
      ...(row.cwd !== null ? { cwd: row.cwd } : {}),
      updatedAt: row.updated_at,
      activity:
        row.activity === null
          ? null
          : { firstAt: row.activity.first_at, lastAt: row.activity.last_at },
      streamState: row.stream_state,
      device: FIXTURE_DESKTOP,
      ...(provider !== undefined ? { provider } : {}),
      startedAt: row.started_at,
      ...(project !== undefined ? { projectKey: keyOf(project) } : {}),
    };
  });
}

/** A project's merged figures, as `project.figures` answers them: the demo's
 * own figures for its one folder, every desktop that holds it saying how. */
function fixtureFigures(demo: RoomDemo, key: string): ProjectFiguresResult {
  const row = demo.meta.projects.find((project) => keyOf(project.name) === key);
  const stats = row === undefined ? undefined : demo.stats.get(row.id);
  const usage = row === undefined ? undefined : demo.usage.get(row.id);
  const figures = (day: {
    tokens: number;
    cost_micro_usd: number | null;
    billed_micro_usd: number | null;
    unpriced_tokens: number;
    unrecorded_output: number;
    reported_cost_adjustment_micro_usd: number;
  }) => ({
    tokens: day.tokens,
    costMicroUsd: day.cost_micro_usd,
    billedMicroUsd: day.billed_micro_usd,
    unpricedTokens: day.unpriced_tokens,
    unrecordedOutput: day.unrecorded_output,
    reportedCostAdjustmentMicroUsd: day.reported_cost_adjustment_micro_usd,
  });
  const laptop = key === keyOf(demo.meta.projects[0]?.name ?? "");
  return {
    key,
    heatmap: (stats?.heat ?? []).map((day) => ({ day: day.day, ...figures(day) })),
    usage: {
      models: (usage?.models ?? []).map((model) => ({
        day: model.day,
        model: model.model,
        ...figures(model),
      })),
      hours: (usage?.hours ?? []).map((hour) => ({ hour: hour.hour, ...figures(hour) })),
    },
    contribution: (stats?.contribution ?? []).map((c) => ({
      sessionId: c.session_id,
      projectId: c.project_id ?? null,
      commits: c.commits,
      edits: c.edits,
      loc: c.loc,
      messages: c.messages,
      ...figures(c),
      device: FIXTURE_DESKTOP,
    })),
    sources: [
      { device: FIXTURE_DESKTOP, state: "answered", tookMs: 4, projects: 1, split: 0 },
      ...(laptop
        ? [
            {
              device: FIXTURE_LAPTOP,
              state: "asleep" as const,
              tookMs: 0,
              detail: "this desktop is asleep",
              projects: 1,
              split: 0,
            },
          ]
        : []),
    ],
    partial: laptop,
    lifetimePartial: laptop,
    clipped: false,
  };
}

/** A fieldd that answers History's doors from the demo, as a window is
 * answered: `project.list`, the keyed listing, no threads, the merged
 * figures, a day's hours, and pings that never move. Data only — the
 * adapter, the room and their CSS are the shipping ones. */
export function historyProjectsClient(demo: RoomDemo): HistoryDoorClient {
  const sources: IndexCatalogSource[] = [
    {
      device: FIXTURE_DESKTOP,
      name: "studio",
      self: true,
      state: "live",
      rows: demo.meta.sessions.length,
    },
    { device: FIXTURE_LAPTOP, name: "laptop", self: false, state: "asleep", rows: 0 },
  ];
  const demoCatalog = createDemoPorts(demo).catalog;
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    async request(method, params) {
      switch (method) {
        case "project.list":
          return { rows: fixtureProjects(demo), sources, groupingVersion: 2 };
        case "index.sessions":
          return { rows: fixtureSessions(demo), sources };
        case "index.threads":
          return { rows: [] };
        case "project.figures":
          return fixtureFigures(demo, String(params["key"]));
        case "project.figuresDay": {
          const key = String(params["key"]);
          const row = demo.meta.projects.find((project) => keyOf(project.name) === key);
          const day = String(params["day"]);
          const answer =
            row === undefined
              ? { day, models: [] }
              : await demoCatalog.dayUsage(row.id, day, Number(params["offsetMinutes"] ?? 0));
          return {
            key,
            day: answer.day,
            models: answer.models,
            sources: [
              { device: FIXTURE_DESKTOP, state: "answered", tookMs: 2, projects: 1, split: 0 },
            ],
            partial: false,
          } satisfies ProjectFiguresDayResult;
        }
        default:
          throw Object.assign(new Error(`${method} is not in the catalog's fixture`), {
            kind: "NOT_FOUND",
          });
      }
    },
    async subscribe() {
      return {
        snapshot: { snapshot: { epoch: "projects-fixture", revision: 0, rows: [] } },
        unsubscribe: () => undefined,
      };
    },
  };
}

/** History by project: the demo's room, its catalog the SHIPPING adapter
 * over the fixture fieldd (the index's own state is the demo's). */
function projectsPorts(demo: RoomDemo): RoomPorts {
  const ports = createDemoPorts(demo);
  const catalog = catalogPortOver(historyProjectsClient(demo), { now: () => demo.now });
  return { ...ports, catalog: { ...catalog, status: ports.catalog.status } };
}

/** The room's ports for one catalog state, over the package's demo. */
export function historyFixturePorts(state: HistoryState, now: number = Date.now()): RoomPorts {
  const demo = createRoomDemo(now);
  const ports = createDemoPorts(demo);
  if (state === "projects") return projectsPorts(demo);
  if (state === "unavailable") return { ...ports, catalog: unavailableCatalog(ports.catalog) };
  if (state === "consent") return { ...ports, catalog: consentCatalog(ports.catalog) };
  return ports;
}
