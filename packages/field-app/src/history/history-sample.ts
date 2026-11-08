import {
  AGENT_CATALOG_READERS,
  type AgentModelsResult,
  type AgentProfileSet,
  type AgentProviderSummary,
  type DeviceInfo,
  type IndexArtifactEntry,
  type IndexArtifactsResult,
  type IndexCatalogSource,
  type IndexSession,
  type ProjectFiguresDayResult,
  type ProjectFiguresResult,
  type ProjectSummary,
} from "@vibefield/contracts";
import type { HostPort, RoomPorts } from "@vibefield/rosetta-room";
import { createDemoPorts, createRoomDemo, type RoomDemo } from "@vibefield/rosetta-room/fixtures";
import {
  type ArtifactReader,
  catalogPortOver,
  type HistoryCatalogPort,
  type HistoryDoorClient,
} from "./doors";

// HISTORY'S SAMPLE, ITS DATA (track HG, HG-2; HG-D2 ruled by James 2026-11-08; DESIGN.md §8 "History" — before its
// past, the room behind glass). The room behind History's consent card is the room itself: the package's demo
// (`@vibefield/rosetta-room/fixtures`) through the SHIPPING by-project adapter (`doors.ts`) over a data-only fixture
// fieldd — this file — so it is History as it ships. Moved here from the catalog's `history-fixtures.ts` at HG-2,
// unchanged but for its exported names, so the catalog's projects plate and the product's sample are one fieldd and
// never two copies. It answers History's doors from the demo as a window is answered; nothing in it reaches a real
// fieldd. It rides the room's chunk: only `HistorySample.tsx` (and the catalog, its own build) imports it.

/** The demo session the sample opens at, and the catalog's chosen plates too: the conversation with images, web
 * lines and a run still going. */
export const SAMPLE_SESSION = "s0";

/* ── History by project (PJ-4): a fixture fieldd under the shipping adapter ── */

/** The desktop the plate is drawn on, and the one beside it that is asleep. */
export const SAMPLE_DESKTOP = "01J9ZK3M5Q8XR2V7N4B6C1D0EF";
const FIXTURE_LAPTOP = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9";

const keyOf = (name: string): string => `p1:demo-${name}`;

/** The agent the demo's first runtime stands for, read through the catalog by
 * its rosetta kind — never an agent id written here (R23b, AR-L1). */
function firstAgent(demo: RoomDemo): string | undefined {
  const kind = demo.meta.runtimes[0]?.kind;
  return kind === undefined ? undefined : AGENT_CATALOG_READERS.idForKind(kind);
}

/** PJ-6 — the Agent Profile beside This Mac that holds the first agent's
 * sign-in, so New agent's rows show an agent under two profiles. */
const FIXTURE_WORK = "work";

/** PJ-6 — the first agent's own picker under Work, as `agent.models` answers
 * it: three made-up models (the plate names no vendor's), two with an effort
 * control — and under This Mac a read that wants a sign-in, so the plate shows
 * both what a picker says and why one is not there. */
function fixtureModels(demo: RoomDemo, provider: string, profileSet: string): AgentModelsResult {
  if (profileSet !== FIXTURE_WORK)
    return {
      provider,
      profileSet,
      failure: {
        status: "auth-required",
        code: "auth-required",
        message: "Sign in to discover models.",
        at: new Date(demo.now - 60_000).toISOString(),
      },
      refreshing: false,
    };
  const effort = (values: string[], defaultValue?: string) => ({
    id: "effort",
    label: "Effort",
    role: "effort",
    values: values.map((id) => ({ id, label: id })),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  });
  return {
    provider,
    profileSet,
    catalog: {
      provider,
      cwd: "/Users/demo",
      observedAt: new Date(demo.now - 4 * 60_000).toISOString(),
      source: { kind: "native-protocol", freshness: "live" },
      completeness: "complete",
      customModels: false,
      models: [
        {
          id: "deep",
          label: "Deep",
          description: "For the long, hard ones",
          controls: [effort(["low", "medium", "high", "max"], "medium")],
        },
        {
          id: "quick",
          label: "Quick",
          description: "For the small things",
          controls: [effort(["low", "high"])],
        },
        { id: "plain", label: "Plain", description: "No settings of its own", controls: [] },
      ],
    },
    refreshing: false,
  };
}

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
  const agent = firstAgent(demo);
  const repos = demo.meta.projects.map((row, index): ProjectSummary => {
    const here = place(
      SAMPLE_DESKTOP,
      row.id,
      row.root_paths[0] ?? `/Users/demo/${row.name}`,
      counted(row.id),
    );
    const places =
      index === 0
        ? [here, place(FIXTURE_LAPTOP, `${row.id}-laptop`, `/Users/demo/code/${row.name}`, 4)]
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
      // PJ-6 — the first project's last launch: Deep at high, under Work
      ...(index === 0 && agent !== undefined
        ? {
            recipe: {
              provider: agent,
              profileSet: FIXTURE_WORK,
              selection: { modelId: "deep" },
              controlsByModel: { deep: { effort: "high" }, quick: { effort: "low" } },
              at: demo.now - 3_600_000,
            },
          }
        : {}),
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
    devices: [SAMPLE_DESKTOP],
    places: [{ ...place(SAMPLE_DESKTOP, key, path, 0), class: kind }],
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
  // the agent a demo runtime stands for, read through the catalog by its
  // rosetta kind — never an agent id written here (R23b, AR-L1)
  const kinds = new Map(demo.meta.runtimes.map((runtime) => [runtime.id, runtime.kind]));
  return demo.meta.sessions.map((row) => {
    const project = row.project_id === null ? undefined : names.get(row.project_id);
    const kind = kinds.get(row.runtime_id);
    const provider = kind === undefined ? undefined : AGENT_CATALOG_READERS.idForKind(kind);
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
      device: SAMPLE_DESKTOP,
      ...(provider !== undefined ? { provider } : {}),
      startedAt: row.started_at,
      ...(project !== undefined ? { projectKey: keyOf(project) } : {}),
      ...(row.project_id !== null
        ? { place: { device: SAMPLE_DESKTOP, placeId: `pl_${row.project_id}` } }
        : {}),
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
      device: SAMPLE_DESKTOP,
    })),
    sources: [
      { device: SAMPLE_DESKTOP, state: "answered", tookMs: 4, projects: 1, split: 0 },
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

/* ── the library (MA-4b): this desktop's made pages, for the room's port ── */

// What the plate's fixture fieldd answers `index.artifacts` with, in the
// contract's shape, so the SHIPPING library port (`history/doors.ts`) maps it
// as it maps fieldd's: one app per demo project that has a session here, made
// in that project's newest session by its agent (the catalog's, read by the
// demo runtime's kind — never an agent id written here), newest first. The
// first is presented twice (Versions: `appId` asks its every presentation);
// one was not kept (`not_captured`, the room's honest card). The filters the
// door takes narrow it as fieldd would (`q` in the title, `kind`,
// `projectKey`, `appId`). No path, no recovered-from, no asset URL: the
// contract carries none. Each kept page's bytes are a plain HTML document
// (`fixtureArtifactReader`), read in place of the session port's
// read-through. The room keeps the library's launcher dormant until RO-37,
// so no plate draws it yet; 4d's plate opens it over this.

/** One presentation of the fixture library, and its document when it was
 * kept. */
interface FixturePage {
  readonly entry: IndexArtifactEntry;
  readonly document: string | null;
}

/** An id in rosetta's spelling (the contract's `MadeAppId`: 64 lowercase hex),
 * the same for the same seed: FNV-1a over the seed, eight salted rounds. */
function fixtureId(seed: string): string {
  let out = "";
  for (let round = 0; round < 8; round += 1) {
    let hash = 2166136261;
    for (const char of `${round}:${seed}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    out += (hash >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A kept page: a plain HTML document, its title the app's. */
function pageDocument(title: string, project: string, version: number): string {
  const name = escapeHtml(title);
  return [
    "<!doctype html>",
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${name}</title></head>`,
    `<body><h1>${name}</h1><p>${escapeHtml(project)} · version ${version}</p></body>`,
    "</html>",
  ].join("\n");
}

/** A page's file name, a basename from its title (the contract's
 * `MadeAppFilename`). */
function filenameOf(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${slug.replace(/^-|-$/g, "") || "page"}.html`;
}

/** The library as the fixture fieldd holds it, newest first (above). */
function fixtureLibrary(demo: RoomDemo): FixturePage[] {
  const kinds = new Map(demo.meta.runtimes.map((runtime) => [runtime.id, runtime.kind]));
  const newest = new Map<string, RoomDemo["meta"]["sessions"][number]>();
  for (const row of demo.meta.sessions) {
    if (row.project_id === null) continue;
    const seen = newest.get(row.project_id);
    if (seen === undefined || row.updated_at > seen.updated_at) newest.set(row.project_id, row);
  }
  const made = demo.meta.projects.flatMap((project) => {
    const session = newest.get(project.id);
    return session === undefined ? [] : [{ project, session }];
  });
  const pages = made.flatMap(({ project, session }, index): FixturePage[] => {
    const kind = kinds.get(session.runtime_id);
    const provider = kind === undefined ? undefined : AGENT_CATALOG_READERS.idForKind(kind);
    const title = session.title ?? project.name;
    const kept = index < made.length - 1;
    const presented = index === 0 ? 2 : 1;
    return Array.from({ length: presented }, (_, older): FixturePage => {
      const version = presented - older;
      const publishedAt = session.updated_at - 60_000 - older * 20 * 60_000;
      const document = kept ? pageDocument(title, project.name, version) : null;
      return {
        document,
        entry: {
          device: SAMPLE_DESKTOP,
          presentationId: fixtureId(`page:${project.id}:${version}`),
          appId: fixtureId(`app:${project.id}`),
          sessionId: session.id,
          timelineId: `artifact-${session.id}-${version}`,
          title,
          filename: filenameOf(title),
          version: String(version),
          publishedAt,
          ...(document !== null
            ? {
                capturedAt: publishedAt + 5_000,
                mediaType: "text/html; charset=utf-8",
                byteLen: new TextEncoder().encode(document).byteLength,
              }
            : {}),
          availability: document !== null ? "captured" : "not_captured",
          recovered: false,
          ...(kind !== undefined ? { kind } : {}),
          ...(provider !== undefined ? { provider } : {}),
          ...(session.title !== null ? { sessionTitle: session.title } : {}),
          projectId: project.id,
          projectName: project.name,
          projectKey: keyOf(project.name),
          versions: presented,
        },
      };
    });
  });
  return pages.sort((a, b) => (b.entry.publishedAt ?? 0) - (a.entry.publishedAt ?? 0));
}

/** `index.artifacts`, as the fixture fieldd answers the plate: narrowed by
 * the ask's words, kind and project, then one app's every presentation
 * (`appId`) or each app's newest; one page, read whole. */
function fixtureArtifacts(demo: RoomDemo, params: Record<string, unknown>): IndexArtifactsResult {
  const word = (name: string): string | null => {
    const value = params[name];
    return typeof value === "string" ? value : null;
  };
  const q = word("q")?.toLowerCase() ?? null;
  const kind = word("kind");
  const projectKey = word("projectKey");
  const appId = word("appId");
  const seen = new Set<string>();
  const entries = fixtureLibrary(demo)
    .map((page) => page.entry)
    .filter(
      (entry) =>
        (q === null || entry.title.toLowerCase().includes(q)) &&
        (kind === null || entry.kind === kind) &&
        (projectKey === null || entry.projectKey === projectKey),
    )
    .filter((entry) => {
      if (appId !== null) return entry.appId === appId;
      if (seen.has(entry.appId)) return false;
      seen.add(entry.appId);
      return true;
    });
  const limit = typeof params["limit"] === "number" ? params["limit"] : entries.length;
  return { entries: entries.slice(0, limit), canonicalReady: true };
}

/** A kept page's bytes, for the plate's library port, in place of the
 * session port's read-through. */
function fixtureArtifactReader(demo: RoomDemo): ArtifactReader {
  const pages = fixtureLibrary(demo);
  return async (sessionId, publicationId) => {
    const page = pages.find((candidate) => candidate.entry.presentationId === publicationId);
    if (page === undefined || page.entry.sessionId !== sessionId || page.document === null)
      throw new Error("the catalog kept no page for this presentation; these are fixtures");
    return new TextEncoder().encode(page.document);
  };
}

/** A fieldd that answers History's doors from the demo, as a window is
 * answered: `project.list`, the keyed listing, no threads, the merged
 * figures, a day's hours, and pings that never move. Data only — the
 * adapter, the room and their CSS are the shipping ones. MA-4b: and
 * `index.artifacts`, this desktop's library (above). */
export function historySampleClient(demo: RoomDemo): HistoryDoorClient {
  const sources: IndexCatalogSource[] = [
    {
      device: SAMPLE_DESKTOP,
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
        case "index.artifacts":
          return fixtureArtifacts(demo, params);
        case "agent.models":
          return fixtureModels(
            demo,
            String(params["provider"]),
            typeof params["profileSet"] === "string" ? params["profileSet"] : "",
          );
        case "project.intent":
          // H4's acts reach no project from a catalog: the refusal's look,
          // in words that say so (the room says them under its name field)
          throw new Error("a catalog changes no project; these are fixtures");
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
              { device: SAMPLE_DESKTOP, state: "answered", tookMs: 2, projects: 1, split: 0 },
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

/** The catalog's desktop: no files to show. ③'s head — the folder list and
 * its acts — is drawn; the worktree under it says why it has none, as a
 * desktop whose files engine refused would. */
const NO_FILES = "the catalog has no files; its folders are fixtures";
const CATALOG_DESKTOP: HostPort = {
  homeDir: "/Users/demo",
  platform: "darwin",
  openInBrowser: async () => false,
  favicon: async () => null,
  worktree: {
    open: async () => ({ ok: false, error: NO_FILES }),
    gitFacts: async () => null,
    fileAction: async () => ({ ok: false, error: NO_FILES }),
    ports: () => () => undefined,
  },
};

/** History by project: the demo's room, its catalog the SHIPPING adapter
 * over the fixture fieldd (the index's own state is the demo's); MA-4b: its
 * library's bytes the fixture's kept pages. */
function samplePorts(
  demo: RoomDemo,
  client: HistoryDoorClient,
): { ports: RoomPorts; catalog: HistoryCatalogPort } {
  const ports = createDemoPorts(demo);
  const shipping = catalogPortOver(client, {
    now: () => demo.now,
    readArtifact: fixtureArtifactReader(demo),
  });
  const catalog: HistoryCatalogPort = { ...shipping, status: ports.catalog.status };
  return { ports: { ...ports, catalog, host: CATALOG_DESKTOP }, catalog };
}

/** PJ-4 — what the history controller gathers beside the listing, for the
 * projects plate's host inputs (`historyHostInputs`, the shipping builder):
 * the roster that names the two desktops by their OS (PJ-D24), what runs here
 * now (one session of the first project — Live now, and its row's Jump to),
 * and the agents this desktop offers, read from the catalog by the demo's
 * runtimes' kinds — never an agent id written here (R23b, AR-L1). */
export interface HistorySampleData {
  /** the fixture fieldd: H4's acts ask it, as the product's ask fieldd */
  readonly client: HistoryDoorClient;
  readonly ports: RoomPorts;
  readonly catalog: HistoryCatalogPort;
  readonly roster: readonly DeviceInfo[];
  readonly runs: readonly unknown[];
  readonly providers: readonly AgentProviderSummary[];
  /** PJ-6 — This Mac and Work, Work holding the first agent's sign-in */
  readonly profileSets: readonly AgentProfileSet[];
}

export function historySample(now: number = Date.now()): HistorySampleData {
  const demo = createRoomDemo(now);
  const client = historySampleClient(demo);
  const { ports, catalog } = samplePorts(demo, client);
  const roster: DeviceInfo[] = [
    {
      deviceId: SAMPLE_DESKTOP,
      name: "Studio",
      platform: "darwin",
      self: true,
      online: true,
      lastSeenAt: now,
    },
    {
      deviceId: FIXTURE_LAPTOP,
      name: "Laptop",
      platform: "darwin",
      self: false,
      online: false,
      lastSeenAt: now - 3_600_000,
    },
  ];
  const first = demo.meta.projects[0]?.id;
  const live = demo.meta.sessions.filter((row) => row.project_id === first)[1];
  const kinds = [...new Set(demo.meta.runtimes.map((runtime) => runtime.kind))];
  const providers = kinds.flatMap((kind): AgentProviderSummary[] => {
    const id = AGENT_CATALOG_READERS.idForKind(kind);
    const entry = id === undefined ? undefined : AGENT_CATALOG_READERS.entry(id);
    if (id === undefined || entry === undefined) return [];
    return [
      {
        id,
        label: entry.label,
        available: true,
        resumable: true,
        personas: [],
        offers: { spawn: true, personas: true },
      },
    ];
  });
  const agent = firstAgent(demo);
  const created = new Date(now - 30 * 86_400_000).toISOString();
  const profileSets: AgentProfileSet[] = [
    {
      id: "native",
      kind: "native",
      label: "This Mac",
      default: false,
      createdAt: created,
      personas: [],
    },
    {
      id: FIXTURE_WORK,
      kind: "managed",
      label: "Work",
      default: true,
      createdAt: created,
      personas:
        agent === undefined
          ? []
          : [
              {
                profileId: `${agent}:work`,
                provider: agent,
                label: "Work",
                kind: "managed",
                createdAt: created,
                set: FIXTURE_WORK,
              },
            ],
    },
  ];
  const liveKind = demo.meta.runtimes.find((runtime) => runtime.id === live?.runtime_id)?.kind;
  const liveProvider =
    liveKind === undefined ? undefined : AGENT_CATALOG_READERS.idForKind(liveKind);
  const runs =
    live === undefined || liveProvider === undefined
      ? []
      : [
          {
            sessionId: live.native_session_id,
            kind: liveProvider,
            label: providers.find((row) => row.id === liveProvider)?.label ?? liveProvider,
            device: SAMPLE_DESKTOP,
            tier: "managed",
            runtimeRunId: "run-fixture",
            runtimeEpoch: 1,
            terminal: { hosted: "local", runtimeSessionId: "sess-fixture", workloadClass: "agent" },
            status: "working",
            observationLevel: "native-hooks",
            createdAt: new Date(now - 600_000).toISOString(),
            stateChangedAt: new Date(now - 60_000).toISOString(),
          },
        ];
  return { client, ports, catalog, roster, runs, providers, profileSets };
}
