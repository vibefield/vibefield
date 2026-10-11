// @vitest-environment node
/**
 * AR-8c — the History room's ports (`history/doors.ts`, `session-port.ts`,
 * `asset-source.ts`): pure adapters over a fieldd client, read here against
 * the CONTRACT fixtures (EL9 — the same JSON fieldd's own suites parse) and a
 * scripted client. The rows: the catalog assembled from the listings and
 * pings into the room's meta shapes; the session lease renewed before its
 * grant expires and repointed when the ticket's origin moves; the asset
 * cache's bound and its revokes; a recorded file read with the window's grant
 * (RO-13), and the honest refusal when rosettad refuses the grant's reach. And
 * (AR-8 L1) the delegated threads: `index.threads`' rows as rosetta's children
 * in the room's meta, read again only when a ping names their table.
 *
 * PJ-4 (H1 — "we map, the room draws"): the room's projects are fieldd's PJ
 * projects (`project.list`), its sessions filed under the key fieldd joined
 * each to (`projectKey`, A-D4 — the keyed fixtures), its figures the merged
 * ones (`project.figures`, H2), its pings `project.subscribe` (whose
 * `regrouped` re-keys the selection), and THE DEVICE GUARD (V6): nothing of
 * another desktop — a row, a path — reaches the room.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AssetRef,
  type MetaState,
  PROTOCOL_VERSION,
  RosettaClient,
  type SubscriptionStatus,
} from "@rosetta/protocol";
import {
  IndexSessionsResult,
  IndexStatus,
  IndexThreadsResult,
  ProjectFiguresDayResult,
  ProjectFiguresResult,
  ProjectListResult,
  type ProjectSummary,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetSourceOver } from "../src/history/asset-source";
import {
  catalogPortOver,
  catalogStatusOf,
  dayUsageOf,
  type HistoryDoorClient,
  type HistoryRegroup,
  isThisDesktops,
  metaStateOf,
  pingParts,
  projectRowOf,
  projectStatsOf,
  selfOf,
  sessionRowOf,
  threadRowOf,
  usageOf,
} from "../src/history/doors";
import {
  FILE_TARGET_REFUSAL,
  sessionPortOver,
  TICKET_RENEW_LEAD_MS,
} from "../src/history/session-port";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/** studio is this desktop; the laptop is asleep (project-list.valid) */
const STUDIO = "01J9ZK3M5Q8XR2V7N4B6C1D0EF";
const LAPTOP = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9";
/** the projects, one page (the fixture's own answer says a page follows) */
const PROJECTS = (() => {
  const { cursor: _next, ...page } = ProjectListResult.parse(fixture("project-list.valid.json"));
  return page;
})();
/** this desktop's listing, each row keyed to its project (A-D4) */
const SESSIONS = IndexSessionsResult.parse(fixture("index-sessions.keyed.json"));
const STATUS = IndexStatus.parse(fixture("index-status.valid.json"));
const THREADS = IndexThreadsResult.parse(fixture("index-threads.valid.json"));
const KEYED_THREADS = IndexThreadsResult.parse(fixture("index-threads.keyed.json"));
const FIGURES = ProjectFiguresResult.parse(fixture("project-figures.valid.json"));
const DAY = ProjectFiguresDayResult.parse(fixture("project-figures-day.valid.json"));
const TICKET = fixture("index-open-ticket.local.json") as {
  device: string;
  endpoints: { sessionUrl: string; restUrl: string };
  grant: string;
  expiresAt: number;
};
const VIBE_FIELD = "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8";
const HOME = "p1:h0m3pr0j3cth0m3pr0j3cth0m3";

/** A second page of the listing: a session the catalog maps to no agent, with
 * no activity and a stream state this build never heard of. */
const PAGE_TWO = {
  rows: [
    {
      sessionId: "ses-unmapped",
      nativeSessionId: "n-2",
      rootSessionId: "ses-unmapped",
      activity: null,
      streamState: "rewinding",
      projectId: "p-4f1c2a9e",
      updatedAt: 1759000000000,
      device: STUDIO,
      projectKey: HOME,
    },
  ],
  sources: SESSIONS.sources,
};

afterEach(() => {
  vi.useRealTimers();
});

/* ── a scripted fieldd client ──────────────────────────────────────────── */

function client(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let onFrame: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
  let revision = 0;
  const door: HistoryDoorClient & {
    calls: typeof calls;
    ping(kind?: "snapshot" | "delta", tables?: string[], extra?: Record<string, unknown>): void;
  } = {
    calls,
    ping: (kind = "delta", tables = ["sessions"], extra = {}) => {
      revision += 1;
      onFrame?.(
        {
          epoch: "projects-1",
          since: revision - 1,
          revision,
          upserts: [],
          removed: [],
          ...(tables.length > 0 ? { tables } : {}),
          ...extra,
        },
        kind,
      );
    },
    request: async (method, params) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (answer === undefined) {
        throw Object.assign(new Error(`${method} is not scripted`), { kind: "NOT_FOUND" });
      }
      return answer(params);
    },
    subscribe: async (method, params, frame) => {
      calls.push({ method, params });
      onFrame = frame;
      return {
        snapshot: { snapshot: { epoch: "projects-1", revision: 0, rows: [] } },
        unsubscribe: () => {
          onFrame = null;
        },
      };
    },
  };
  return door;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/** A project only another desktop holds: a place on the laptop alone. */
const LAPTOP_ONLY: ProjectSummary = {
  ...PROJECTS.rows[0]!,
  key: "p1:l4pt0p0nly",
  name: "laptop-notes",
  places: [PROJECTS.rows[0]!.places[1]!],
  devices: [LAPTOP],
  anchors: [`place:${PROJECTS.rows[0]!.places[1]!.ref.placeId}`],
};

/* ── the catalog: PJ projects and the keyed listings → the room's meta ─── */

describe("the catalog port's rows (AR-8c; PJ-4 H1)", () => {
  it("maps a listing row field by field into rosetta's SessionRow, filed under the key fieldd joined it to", () => {
    const row = SESSIONS.rows[0];
    if (row === undefined) throw new Error("fixture has no row");
    expect(sessionRowOf(row)).toEqual({
      id: "ses-9b2f0c7d",
      native_session_id: "665e3e71-7c12-4810-925a-e8b92cb6f29d",
      // the agent, read through the catalog: the provider's rosetta kind
      runtime_id: "claude-code",
      // PJ-4 (A-D4): the PJ key, never rosetta's id (`p-4f1c2a9e`)
      project_id: VIBE_FIELD,
      cwd: "/Users/me/Projects/vibe-field",
      parent_session_id: null,
      delegation: null,
      root_session_id: "ses-9b2f0c7d",
      role: "main",
      title: "the history catalog across desktops",
      summary: null,
      started_at: 1759270000000,
      updated_at: 1759276790000,
      activity: { first_at: 1759270000000, last_at: 1759276800000 },
      stream_state: "indexed",
    });
    // a second clone of the same repository (another rosetta project): the
    // same project in History — fieldd joined it, the window grouped nothing
    expect(sessionRowOf(SESSIONS.rows[1]!).project_id).toBe(VIBE_FIELD);
    // a folder no place holds yet: rosetta's own unassigned bucket says so
    expect(sessionRowOf(SESSIONS.rows[2]!).project_id).toBeNull();
    // a row with less: no agent, no activity, a word this build does not know
    expect(sessionRowOf(IndexSessionsResult.parse(PAGE_TWO).rows[0]!)).toMatchObject({
      runtime_id: "unknown",
      activity: null,
      stream_state: "indexed",
      // no start and no activity: its freshness is the nearest fact there is
      started_at: 1759000000000,
      updated_at: 1759000000000,
      cwd: null,
      title: null,
    });
  });

  it("AR-8 (L1): maps a delegated thread into rosetta's child row — parent, root, role and delegation in rosetta's spelling again", () => {
    const [subagent, member, unknown] = THREADS.rows;
    if (subagent === undefined || member === undefined || unknown === undefined)
      throw new Error("fixture has three threads");
    expect(threadRowOf(subagent)).toEqual({
      id: "ses-5d1e88a0",
      native_session_id: "a3f0c2d9e1b7",
      runtime_id: "claude-code",
      // an unkeyed thread, with no root's key handed: unassigned
      project_id: null,
      cwd: "/Users/me/Projects/vibe-field",
      parent_session_id: "ses-9b2f0c7d",
      delegation: {
        parent_tool_native_id: "toolu_01Hx7Qd2",
        workflow_run_id: null,
        team: null,
        color: null,
        configured_model: "claude-haiku-4-5",
      },
      root_session_id: "ses-9b2f0c7d",
      role: "subagent",
      title: "map the catalog's readers",
      summary: "Explore",
      started_at: 1759270600000,
      updated_at: 1759270900000,
      activity: { first_at: 1759270600000, last_at: 1759270880000 },
      stream_state: "indexed",
    });
    // a thread of a thread: its own parent, the same root; a team member's colour
    expect(threadRowOf(member)).toMatchObject({
      parent_session_id: "ses-5d1e88a0",
      root_session_id: "ses-9b2f0c7d",
      role: "team",
      delegation: { team: "catalog-crew", color: "cyan" },
      activity: null,
      stream_state: "streaming",
    });
    // a role the room does not draw is a subagent — a child it is — and a
    // colour outside rosetta's eight is no colour
    expect(threadRowOf(unknown)).toMatchObject({ role: "subagent", delegation: null });
    expect(threadRowOf({ ...member, delegation: { color: "teal" } }).delegation?.color).toBeNull();
  });

  it("PJ-4: files a thread under its ROOT's project — fieldd's key, else the root's as the roots were read", () => {
    const [keyed, orphan] = KEYED_THREADS.rows;
    expect(threadRowOf(keyed!).project_id).toBe(VIBE_FIELD);
    // its root's key, for a thread read a moment before its root was keyed
    expect(threadRowOf(orphan!, HOME).project_id).toBe(HOME);
    expect(threadRowOf(orphan!).project_id).toBeNull();
  });

  it("PJ-4: a PJ project as the room's row — its key, its name, THIS desktop's places as roots, its identity remote", () => {
    const [vibeField, home] = PROJECTS.rows;
    expect(projectRowOf(vibeField!, STUDIO)).toEqual({
      id: VIBE_FIELD,
      name: "vibe-field",
      // the laptop's place (/Users/me/code/vf-docs) is never handed: the room
      // would open this Mac's same-spelled folder for it (A4.2)
      root_paths: ["/Users/me/Projects/vibe-field"],
      // the normalized key the room opens as https://… (R9)
      git_repo: "github.com/acme/vibe-field",
    });
    expect(projectRowOf(home!, STUDIO)).toEqual({
      id: HOME,
      name: "Home",
      root_paths: ["/Users/me"],
      git_repo: null,
    });
    // two projects that read alike: the parent folder that tells them apart
    expect(projectRowOf({ ...home!, name: "Mochi", disambiguation: "p018" }, STUDIO).name).toBe(
      "Mochi · p018",
    );
    // a remote that is a local path is no repository to open
    expect(
      projectRowOf({ ...vibeField!, anchors: ["remote:local:/Users/me/bare.git"] }, STUDIO)
        .git_repo,
    ).toBeNull();
    // no desktop known: no path at all
    expect(projectRowOf(vibeField!, null).root_paths).toEqual([]);
  });

  it("assembles the room's whole topology: one runtime per agent kind, the projects with a place here, every session filed by its key", () => {
    const self = selfOf(SESSIONS.sources);
    expect(self).toBe(STUDIO);
    const meta = metaStateOf(
      [...PROJECTS.rows, LAPTOP_ONLY],
      [...SESSIONS.rows, ...IndexSessionsResult.parse(PAGE_TWO).rows],
      [],
      self,
    );
    expect(meta.runtimes.map((runtime) => [runtime.id, runtime.kind])).toEqual([
      ["claude-code", "claude-code"],
      ["codex", "codex"],
      ["unknown", "unknown"],
    ]);
    // H3 (a): a project only the laptop holds is not listed yet
    expect(meta.projects.map((project) => project.id)).toEqual([VIBE_FIELD, HOME]);
    expect(meta.sessions.map((row) => [row.id, row.project_id])).toEqual([
      ["ses-9b2f0c7d", VIBE_FIELD],
      ["ses-31c0de55", VIBE_FIELD],
      ["ses-a07b1f62", null],
      ["ses-unmapped", HOME],
    ]);
    // AR-8 (L1): the threads ride beside the roots — the room builds its
    // subthreads and its search grouping from the one list — and each takes
    // its root's key when fieldd's own is not on it yet
    const withThreads = metaStateOf(PROJECTS.rows, SESSIONS.rows, THREADS.rows, self);
    expect(
      withThreads.sessions.map((row) => [
        row.id,
        row.parent_session_id,
        row.root_session_id,
        row.project_id,
      ]),
    ).toEqual([
      ["ses-9b2f0c7d", null, "ses-9b2f0c7d", VIBE_FIELD],
      ["ses-31c0de55", null, "ses-31c0de55", VIBE_FIELD],
      ["ses-a07b1f62", null, "ses-a07b1f62", null],
      ["ses-5d1e88a0", "ses-9b2f0c7d", "ses-9b2f0c7d", VIBE_FIELD],
      ["ses-7c40aa19", "ses-5d1e88a0", "ses-9b2f0c7d", VIBE_FIELD],
      ["ses-0e93b7c2", "ses-9b2f0c7d", "ses-9b2f0c7d", VIBE_FIELD],
    ]);
  });

  it("PJ-4 — THE DEVICE GUARD (V6): another desktop's session never reaches the room, nor anything that names a desktop when none is known", () => {
    const remote = {
      ...SESSIONS.rows[0]!,
      sessionId: "ses-on-the-laptop",
      device: LAPTOP,
      // the same spelling as this Mac's checkout: the room would resume HERE
      cwd: "/Users/me/Projects/vibe-field",
    };
    expect(isThisDesktops(remote, STUDIO)).toBe(false);
    expect(isThisDesktops(SESSIONS.rows[0]!, STUDIO)).toBe(true);
    const meta = metaStateOf(PROJECTS.rows, [...SESSIONS.rows, remote], [], STUDIO);
    expect(meta.sessions.map((row) => row.id)).not.toContain("ses-on-the-laptop");
    expect(meta.projects.flatMap((project) => project.root_paths)).toEqual([
      "/Users/me/Projects/vibe-field",
      "/Users/me",
    ]);
    // which desktop is this one, unknown: no project, no row that names one
    const blind = metaStateOf(PROJECTS.rows, [...SESSIONS.rows, remote], [], null);
    expect(blind.projects).toEqual([]);
    expect(blind.sessions).toEqual([]);
  });

  it("AR-8 (L1): reads a ping's `tables` — the parts it names; none, or a word it does not know, is both", () => {
    expect(pingParts({ tables: ["threads"] })).toEqual({ roots: false, threads: true });
    expect(pingParts({ tables: ["sessions"] })).toEqual({ roots: true, threads: false });
    expect(pingParts({ tables: ["projects", "threads"] })).toEqual({ roots: true, threads: true });
    for (const payload of [{ tables: [] }, {}, null, { tables: ["sessions", "graphs"] }]) {
      expect(pingParts(payload), JSON.stringify(payload)).toEqual({ roots: true, threads: true });
    }
  });

  it("folds index.status into the room's CatalogStatus, and an index that is not up into no status", () => {
    expect(catalogStatusOf(STATUS)).toEqual({
      canonicalReady: true,
      searchReadiness: "ready",
      searchProgress: null,
      ingest: {
        phase: "live",
        runtimes: [
          expect.objectContaining({
            kind: "claude-code",
            runtime_id: "rt_5f0c9a2e1b7d4c3a",
            state: "done",
            files_total: 1284,
            sessions_total: 212,
            records: 90411,
          }),
          expect.objectContaining({ runtime_id: "rt_0b7e2c4d9a1f3e58", label: "Kim" }),
        ],
        projects: [],
      },
      startedAt: null,
      uptimeMs: 0,
    });
    expect(
      catalogStatusOf({
        ...STATUS,
        phase: "starting",
        rosettad: { ...STATUS.rosettad, phase: "starting" },
      }),
    ).toBeNull();
  });

  it("PJ-4 (H2): splits ONE project.figures answer into the panel's figures and its usage, nulls kept null", () => {
    const stats = projectStatsOf(FIGURES);
    expect(stats.heat[0]).toEqual({
      day: "2026-09-29",
      tokens: 182000,
      cost_micro_usd: 1240000,
      billed_micro_usd: null,
      unpriced_tokens: 0,
      unrecorded_output: 0,
      reported_cost_adjustment_micro_usd: 0,
    });
    // every desktop's rows, the room's facts by session id
    expect(stats.contribution.map((row) => [row.session_id, row.tokens])).toEqual([
      ["ses-9b2f0c7d", 182000],
      ["ses-31c0de55", 96000],
    ]);
    const usage = usageOf(FIGURES);
    expect(usage.models.map((row) => [row.model, row.cost_micro_usd])).toEqual([
      ["claude-opus-5-5", 1240000],
      ["gpt-6-astra", 610000],
    ]);
    expect(usage.hours[0]).toMatchObject({ hour: 15, tokens: 278000 });
    expect(dayUsageOf(DAY)).toEqual({
      day: "2026-09-29",
      models: [
        { hour: 14, model: "claude-opus-5-5", tokens: 120000 },
        { hour: 15, model: "claude-opus-5-5", tokens: 62000 },
      ],
    });
  });
});

describe("the catalog port's meta feed (AR-8c; PJ-4)", () => {
  function scripted(pages: { sessions: unknown[]; threads?: unknown[]; projects?: unknown }) {
    return client({
      "project.list": () => pages.projects ?? PROJECTS,
      "index.sessions": (params) => {
        const page = params["cursor"] === undefined ? 0 : Number(params["cursor"]);
        return pages.sessions[page];
      },
      "index.threads": (params) => {
        const page = params["cursor"] === undefined ? 0 : Number(params["cursor"]);
        return (pages.threads ?? [{ rows: [] }])[page];
      },
      "index.status": () => fixture("index-status.valid.json"),
      "project.figures": () => fixture("project-figures.valid.json"),
      "project.figuresDay": () => fixture("project-figures-day.valid.json"),
    });
  }

  it("answers one snapshot assembled from every page of the projects and this desktop's listing, then a mutation per ping", async () => {
    const pages: { sessions: unknown[] } = {
      sessions: [{ ...SESSIONS, cursor: "1" }, PAGE_TWO],
    };
    const door = scripted(pages);
    const catalog = catalogPortOver(door);
    const changes: Array<{ meta: MetaState; source: string }> = [];
    const statuses: SubscriptionStatus[] = [];
    const feed = catalog.subscribeMeta({
      onChange: (meta, source) => changes.push({ meta, source }),
      onStatus: (status) => statuses.push(status),
    });
    await flush();
    // PJ-4: the projects' pings, never the index's
    expect(door.calls.find((call) => call.method.endsWith("subscribe"))).toEqual({
      method: "project.subscribe",
      params: {},
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.source).toBe("snapshot");
    expect(changes[0]?.meta.projects.map((row) => row.name)).toEqual(["vibe-field", "Home"]);
    expect(changes[0]?.meta.sessions.map((row) => row.id)).toEqual([
      "ses-9b2f0c7d",
      "ses-31c0de55",
      "ses-a07b1f62",
      "ses-unmapped",
    ]);
    // the listings at the doors' page ceilings: every project; this desktop's sessions
    expect(door.calls.find((call) => call.method === "project.list")?.params).toEqual({
      limit: 500,
    });
    expect(door.calls.find((call) => call.method === "index.sessions")?.params).toEqual({
      scope: "local",
      limit: 500,
    });
    expect(statuses).toEqual(["connecting", "live"]);

    // a ping: the listing is read again and said as a mutation
    pages.sessions[1] = {
      ...PAGE_TWO,
      rows: [{ ...PAGE_TWO.rows[0], title: "renamed" }],
    };
    door.ping();
    await flush();
    expect(changes).toHaveLength(2);
    expect(changes[1]?.source).toBe("mutation");
    expect(changes[1]?.meta.sessions[3]?.title).toBe("renamed");

    // hidden, a ping is noted, not read; showing reads it once
    catalog.setActive(false);
    door.ping();
    await flush();
    expect(changes).toHaveLength(2);
    catalog.setActive(true);
    await flush();
    expect(changes).toHaveLength(3);
    feed.close();
  });

  it("AR-8 (L1): the threads ride the first read; a ping that names only one part reads only that part again", async () => {
    const pages: { sessions: unknown[]; threads: unknown[] } = {
      sessions: [SESSIONS],
      threads: [{ rows: THREADS.rows.slice(0, 2), cursor: "1" }, { rows: THREADS.rows.slice(2) }],
    };
    const door = scripted(pages);
    const catalog = catalogPortOver(door);
    const changes: MetaState[] = [];
    const feed = catalog.subscribeMeta({ onChange: (meta) => changes.push(meta) });
    await flush();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.sessions.map((row) => row.id)).toEqual([
      "ses-9b2f0c7d",
      "ses-31c0de55",
      "ses-a07b1f62",
      "ses-5d1e88a0",
      "ses-7c40aa19",
      "ses-0e93b7c2",
    ]);
    // every page of the threads, asked with no scope: they are this desktop's
    const threadAsks = door.calls.filter((call) => call.method === "index.threads");
    expect(threadAsks.map((call) => call.params)).toEqual([
      { limit: 500 },
      { limit: 500, cursor: "1" },
    ]);
    const asked = (): string[] => door.calls.map((call) => call.method);
    const askedSince = (at: number): string[] =>
      asked()
        .slice(at)
        .filter((method) => method !== "project.subscribe");

    // a thread moved: only the threads are read again — the roots are kept
    let at = asked().length;
    pages.threads = [{ rows: [{ ...THREADS.rows[0], title: "renamed thread" }] }];
    door.ping("delta", ["threads"]);
    await flush();
    expect(askedSince(at)).toEqual(["index.threads"]);
    expect(changes.at(-1)?.sessions.map((row) => row.title)).toEqual([
      "the history catalog across desktops",
      "a second clone of the same repository",
      "a folder the place scanner has not read yet",
      "renamed thread",
    ]);

    // a root moved: the projects and the listing, and the threads are kept
    at = asked().length;
    door.ping("delta", ["sessions"]);
    await flush();
    expect(askedSince(at).sort()).toEqual(["index.sessions", "project.list"]);
    expect(changes.at(-1)?.sessions).toHaveLength(4);

    // a ping that names nothing (the grouping or a standing moved): all three
    at = asked().length;
    door.ping("delta", []);
    await flush();
    expect(askedSince(at).sort()).toEqual(["index.sessions", "index.threads", "project.list"]);
    feed.close();
  });

  it("PJ-4: a regroup re-files sessions — the host hears the moves and which sessions moved, AFTER the room has the listing that files them anew", async () => {
    const pages: { sessions: unknown[]; projects: unknown } = {
      sessions: [SESSIONS],
      projects: PROJECTS,
    };
    const door = scripted(pages);
    const catalog = catalogPortOver(door);
    const order: string[] = [];
    const regroups: HistoryRegroup[] = [];
    catalog.onRegrouped((regroup) => {
      order.push("regrouped");
      regroups.push(regroup);
    });
    const changes: MetaState[] = [];
    const feed = catalog.subscribeMeta({
      onChange: (meta) => {
        order.push("change");
        changes.push(meta);
      },
    });
    await flush();
    expect(regroups).toEqual([]);
    // the project's first record re-keys it p1: → r: (D9)
    const RECORD = "r:01JA0B1C2D3E4F5G6H7J8K9M0N";
    pages.projects = {
      ...PROJECTS,
      rows: PROJECTS.rows.map((row) => (row.key === VIBE_FIELD ? { ...row, key: RECORD } : row)),
    };
    pages.sessions = [
      {
        ...SESSIONS,
        rows: SESSIONS.rows.map((row) =>
          row.projectKey === VIBE_FIELD ? { ...row, projectKey: RECORD } : row,
        ),
      },
    ];
    door.ping("delta", [], { regrouped: [{ from: VIBE_FIELD, to: RECORD }] });
    await flush();
    expect(order).toEqual(["change", "change", "regrouped"]);
    expect(changes.at(-1)?.projects[0]?.id).toBe(RECORD);
    expect(regroups).toEqual([
      {
        moves: [{ from: VIBE_FIELD, to: RECORD }],
        sessions: new Set(["ses-9b2f0c7d", "ses-31c0de55"]),
      },
    ]);
    // a ping that moved nothing tells the host nothing
    door.ping("delta", ["sessions"]);
    await flush();
    expect(regroups).toHaveLength(1);
    feed.close();
  });

  it("PJ-4: ONE feed however many read it — the room and the Peek's reader share its reads, a late reader is handed what it holds", async () => {
    const door = scripted({ sessions: [SESSIONS] });
    const catalog = catalogPortOver(door);
    const room: Array<{ meta: MetaState; source: string }> = [];
    const reader: Array<{ meta: MetaState; source: string }> = [];
    const first = catalog.subscribeMeta({
      onChange: (meta, source) => room.push({ meta, source }),
    });
    await flush();
    const count = (method: string) => door.calls.filter((call) => call.method === method).length;
    expect(count("project.list")).toBe(1);
    const second = catalog.subscribeMeta({
      onChange: (meta, source) => reader.push({ meta, source }),
    });
    await flush();
    // the late reader is handed the listing the feed holds, asking nothing
    expect(reader.map((change) => change.source)).toEqual(["snapshot"]);
    expect(reader[0]?.meta).toBe(room[0]?.meta);
    expect(count("project.list")).toBe(1);
    expect(count("project.subscribe")).toBe(1);
    // a ping is ONE read, heard by both
    door.ping();
    await flush();
    expect(count("project.list")).toBe(2);
    expect(room.map((change) => change.source)).toEqual(["snapshot", "mutation"]);
    expect(reader.map((change) => change.source)).toEqual(["snapshot", "mutation"]);
    // one reader leaves: the feed stays for the other; the last closes it
    first.close();
    door.ping();
    await flush();
    expect(reader).toHaveLength(3);
    expect(room).toHaveLength(2);
    second.close();
    door.ping();
    await flush();
    expect(count("project.list")).toBe(3);
    // a reader after every one left opens a fresh feed
    catalog.subscribeMeta({});
    await flush();
    expect(count("project.subscribe")).toBe(2);
  });

  it("says the projects' refusal in fieldd's words and asks again, never a blank", async () => {
    vi.useFakeTimers();
    let ready = false;
    const door = client({
      "project.list": () => {
        if (!ready) {
          throw Object.assign(new Error("this desktop has not grouped its places yet"), {
            kind: "UNAVAILABLE",
            retryable: true,
            details: { service: "projects", state: "grouping" },
          });
        }
        return PROJECTS;
      },
      "index.sessions": () => SESSIONS,
      "index.threads": () => ({ rows: [] }),
    });
    const catalog = catalogPortOver(door);
    const changes: string[] = [];
    catalog.subscribeMeta({ onChange: (_meta, source) => changes.push(source) });
    await vi.advanceTimersByTimeAsync(0);
    expect(changes).toEqual([]);
    expect(catalog.words()).toBe("This desktop has not grouped its places yet (grouping)");
    expect(catalog.unavailable?.()).toBe(catalog.words());
    ready = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(changes).toEqual(["snapshot"]);
    expect(catalog.words()).toBeNull();
  });

  it("refuses status for an index that is not up, in fieldd's own words", async () => {
    const catalog = catalogPortOver(
      client({
        "index.status": () => ({
          ...(fixture("index-status.valid.json") as object),
          phase: "failed",
          rosettad: { phase: "failed", detail: "exited 101", pid: null, protocolVersion: null },
        }),
      }),
    );
    await expect(catalog.status()).rejects.toThrow("The agent index is failed: exited 101");
    expect(catalog.unavailable?.()).toBe("The agent index is failed: exited 101");
  });

  it("PJ-4 (H2): shares ONE project.figures flight between the panel's figures and its usage, by the PJ key; a day is project.figuresDay", async () => {
    const door = scripted({ sessions: [SESSIONS] });
    const catalog = catalogPortOver(door);
    const window = { sinceMs: 1_700_000_000_000, offsetMinutes: -420 };
    const [stats, usage] = await Promise.all([
      catalog.projectStats(VIBE_FIELD, window),
      catalog.usage(VIBE_FIELD, window),
    ]);
    expect(stats.heat).toHaveLength(2);
    expect(usage.hours).toHaveLength(1);
    expect(door.calls.filter((call) => call.method === "project.figures")).toEqual([
      {
        method: "project.figures",
        params: { key: VIBE_FIELD, sinceMs: 1_700_000_000_000, offsetMinutes: -420 },
      },
    ]);
    const day = await catalog.dayUsage(VIBE_FIELD, "2026-09-29", -420);
    expect(day.models).toHaveLength(2);
    expect(door.calls.find((call) => call.method === "project.figuresDay")?.params).toEqual({
      key: VIBE_FIELD,
      day: "2026-09-29",
      offsetMinutes: -420,
    });
    // no rosetta id reaches a figures door: the room's id IS the project
    expect(door.calls.some((call) => call.method === "index.project")).toBe(false);
  });

  it("PJ-4 (H5): keeps the listing's sections — this desktop's Home and the Temporary bucket", async () => {
    const door = scripted({ sessions: [SESSIONS] });
    const catalog = catalogPortOver(door);
    expect(catalog.sections()).toBeNull();
    const feed = catalog.subscribeMeta({});
    await flush();
    expect(catalog.sections()).toEqual({ home: [{ key: HOME, device: STUDIO }], temporary: null });
    feed.close();
  });
});

/* ── the session lease ─────────────────────────────────────────────────── */

/** rosetta's client's transport in a test: sockets recorded, frames served. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeSocket.opened.push(this);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  serve(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** the daemon went away under the stream */
  drop(): void {
    this.close();
  }
}

/** The bytes rosettad answers for a recorded file in these rows. */
const RECORDED_BYTES = [7, 8, 9];

/** rosettad's REST in a test: every read recorded with the credential it
 * carried; a 401 `expired` the first time `refuseOnce` names a path; and
 * `answer` scripts any path's whole response (a refusal of the grant's reach,
 * a file that is gone). A recorded file answers its bytes. */
function rosettadFetch(
  refuseOnce: Set<string> = new Set(),
  answer: (path: string, headers: Record<string, string>) => Response | null = () => null,
) {
  const reads: Array<{ url: string; authorization: string | null }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization");
    reads.push({ url, authorization });
    const path = new URL(url).pathname;
    const headers = { "x-rosetta-protocol-version": String(PROTOCOL_VERSION) };
    if (refuseOnce.delete(path)) {
      return new Response("", {
        status: 401,
        headers: { ...headers, "x-rosetta-auth": "expired" },
      });
    }
    const scripted = answer(path, headers);
    if (scripted !== null) return scripted;
    if (path.startsWith("/api/assets/")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers });
    }
    if (/\/read\/\d+$/.test(path)) {
      return new Response(new Uint8Array(RECORDED_BYTES), { status: 200, headers });
    }
    return new Response(JSON.stringify({ entry: { timeline_id: "t1" }, generation: 1 }), {
      status: 200,
      headers: { ...headers, "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, reads };
}

function ticket(port: number, grant: string, expiresAt: number) {
  return {
    ...TICKET,
    endpoints: {
      sessionUrl: `ws://127.0.0.1:${port}/ws/sessions/s1`,
      restUrl: `http://127.0.0.1:${port}`,
    },
    grant,
    expiresAt,
  };
}

describe("the session port's lease (AR-8c)", () => {
  it("renews the grant before it expires, and repoints the one client when the ticket names a new origin", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    FakeSocket.opened = [];
    const tickets = [
      ticket(52811, "g1", 1_000_000 + 600_000),
      ticket(52811, "g2", 1_000_000 + 540_000 + 600_000),
      // far ahead: its own renewal falls outside this row's window
      ticket(52999, "g3", 1_000_000 + 10_000_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const rest = rosettadFetch();
    const port = sessionPortOver(door, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      fetchFn: rest.fetchFn,
    });
    const session = await port.open("s1");
    const statuses: SubscriptionStatus[] = [];
    session.subscribeSession("s1", { onStatus: (status) => statuses.push(status) });
    const first = FakeSocket.opened[0];
    expect(first?.url).toBe("ws://127.0.0.1:52811/ws/sessions/s1");
    expect(first?.protocols).toEqual(["rosetta", "rosetta.grant.g1"]);
    first?.serve({ frame: "hello", protocol_version: PROTOCOL_VERSION, stamp: null });
    first?.serve({ frame: "caught_up", stamp: { epoch: 1, seq: 0 } });
    expect(statuses.at(-1)).toBe("live");

    // the lead before the grant's exp: the next ticket is asked, and the
    // client presents it from then on — the live stream is left alone
    await vi.advanceTimersByTimeAsync(600_000 - TICKET_RENEW_LEAD_MS - 1);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(2);
    await session.timelineEntry("s1", "t1");
    expect(rest.reads.at(-1)).toEqual({
      url: "http://127.0.0.1:52811/api/sessions/s1/timeline/t1",
      authorization: "Rosetta-Grant g2",
    });
    expect(FakeSocket.opened).toHaveLength(1);

    // the next renewal names ANOTHER origin (a daemon restarted on a new port):
    // the same client repoints — its stream reconnects there with the new grant
    await vi.advanceTimersByTimeAsync(600_000);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(3);
    const moved = FakeSocket.opened.at(-1);
    expect(moved?.url).toBe("ws://127.0.0.1:52999/ws/sessions/s1");
    expect(moved?.protocols).toEqual(["rosetta", "rosetta.grant.g3"]);
    await session.timelineEntry("s1", "t1");
    expect(rest.reads.at(-1)?.url.startsWith("http://127.0.0.1:52999/")).toBe(true);
    // RO-13: a recorded file rides the same lease — the moved origin, the new grant
    expect([...(await session.readFileTarget("s1", "t1", 0))]).toEqual(RECORDED_BYTES);
    expect(rest.reads.at(-1)).toEqual({
      url: "http://127.0.0.1:52999/api/sessions/s1/timeline/t1/read/0",
      authorization: "Rosetta-Grant g3",
    });
    port.dispose();
  });

  it("a stream that drops after it was live asks for a fresh grant at once — the retry only carries it", async () => {
    vi.useFakeTimers({ now: 5_000_000 });
    FakeSocket.opened = [];
    const tickets = [
      ticket(41000, "g1", 5_000_000 + 600_000),
      ticket(41001, "g2", 5_000_000 + 600_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const port = sessionPortOver(door, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      fetchFn: rosettadFetch().fetchFn,
    });
    const session = await port.open("s1");
    session.subscribeSession("s1", {});
    const socket = FakeSocket.opened[0];
    socket?.serve({ frame: "hello", protocol_version: PROTOCOL_VERSION, stamp: null });
    socket?.serve({ frame: "caught_up", stamp: { epoch: 1, seq: 0 } });
    socket?.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(2);
    // the restarted daemon's origin: the stream is there with the new grant
    const again = FakeSocket.opened.at(-1);
    expect(again?.url).toBe("ws://127.0.0.1:41001/ws/sessions/s1");
    expect(again?.protocols).toEqual(["rosetta", "rosetta.grant.g2"]);
    port.dispose();
  });

  it("a read rosettad refuses renews the grant once and is asked again", async () => {
    const tickets = [
      ticket(42000, "g1", Date.now() + 600_000),
      ticket(42000, "g2", Date.now() + 600_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const rest = rosettadFetch(new Set(["/api/sessions/s1/timeline/t1"]));
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    const session = await port.open("s1");
    await expect(session.timelineEntry("s1", "t1")).resolves.toMatchObject({ timeline_id: "t1" });
    expect(rest.reads.map((read) => read.authorization)).toEqual([
      "Rosetta-Grant g1",
      "Rosetta-Grant g2",
    ]);
    port.dispose();
  });

  it("reads a recorded file through the lease's client with the window's grant (RO-13)", async () => {
    const door = client({ "index.openTicket": () => ticket(43000, "g1", Date.now() + 600_000) });
    const rest = rosettadFetch();
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    const session = await port.open("s1");
    expect([...(await session.readFileTarget("s1", "t1", 2))]).toEqual(RECORDED_BYTES);
    expect(rest.reads).toEqual([
      {
        url: "http://127.0.0.1:43000/api/sessions/s1/timeline/t1/read/2",
        authorization: "Rosetta-Grant g1",
      },
    ]);
    port.dispose();
  });

  it("an expired grant on a file read is renewed once and the file is read again", async () => {
    const tickets = [
      ticket(43100, "g1", Date.now() + 600_000),
      ticket(43100, "g2", Date.now() + 600_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const rest = rosettadFetch(new Set(["/api/sessions/s1/timeline/t1/read/0"]));
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    const session = await port.open("s1");
    expect([...(await session.readFileTarget("s1", "t1", 0))]).toEqual(RECORDED_BYTES);
    expect(rest.reads.map((read) => read.authorization)).toEqual([
      "Rosetta-Grant g1",
      "Rosetta-Grant g2",
    ]);
    port.dispose();
  });

  it("a file read rosettad refuses for the grant's reach is the room's honest refusal, and no fresh grant is asked for", async () => {
    // wrong-scope: a grant minted without `files`; wrong-route: a daemon from
    // before the scope — a fresh grant from the same minter repeats either
    for (const reason of ["wrong-scope", "wrong-route"]) {
      const door = client({
        "index.openTicket": () => ticket(43200, "g1", Date.now() + 600_000),
      });
      const rest = rosettadFetch(new Set(), (path, headers) =>
        path.endsWith("/read/0")
          ? new Response("", { status: 401, headers: { ...headers, "x-rosetta-auth": reason } })
          : null,
      );
      const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
      const session = await port.open("s1");
      await expect(session.readFileTarget("s1", "t1", 0), reason).rejects.toThrow(
        FILE_TARGET_REFUSAL,
      );
      expect(
        door.calls.filter((call) => call.method === "index.openTicket"),
        reason,
      ).toHaveLength(1);
      // the session's other reads are untouched by it
      await expect(session.timelineEntry("s1", "t1")).resolves.toMatchObject({
        timeline_id: "t1",
      });
      port.dispose();
    }
  });

  it("a recorded file that is gone stays rosetta's own words, never the room's refusal", async () => {
    const door = client({ "index.openTicket": () => ticket(43300, "g1", Date.now() + 600_000) });
    const rest = rosettadFetch(new Set(), (path, headers) =>
      path.endsWith("/read/0")
        ? new Response(
            JSON.stringify({
              error: { code: "not_found", message: "the recorded file is no longer available" },
            }),
            { status: 404, headers: { ...headers, "content-type": "application/json" } },
          )
        : null,
    );
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    const session = await port.open("s1");
    const refused = await session.readFileTarget("s1", "t1", 0).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toMatchObject({
      status: 404,
      code: "not_found",
      message: "the recorded file is no longer available",
    });
    expect((refused as Error).message).not.toBe(FILE_TARGET_REFUSAL);
    port.dispose();
  });

  it("an open refused by fieldd rejects in the room's words", async () => {
    const door = client({
      "index.openTicket": () => {
        throw Object.assign(new Error("the direct plane is off"), {
          kind: "UNAVAILABLE",
          retryable: false,
          details: { service: "index", state: "direct-plane-off" },
        });
      },
    });
    const port = sessionPortOver(door);
    await expect(port.open("s1")).rejects.toThrow(
      "This desktop has the direct plane switched off — its transcripts can't be read here",
    );
  });
});

/* ── the asset cache ───────────────────────────────────────────────────── */

function asset(digest: string): AssetRef {
  return { url: `/api/assets/${digest}.webp`, digest, media_type: "image/webp", byte_len: 3 };
}

describe("the asset source (AR-8c, AR-D40 (a))", () => {
  it("reads an image with the grant into an object URL, bounded: the oldest is revoked, a hit is kept", async () => {
    const rest = rosettadFetch();
    const rosetta = new RosettaClient({
      baseUrl: "http://127.0.0.1:44000",
      credential: { kind: "grant", grant: "g1" },
      fetchFn: rest.fetchFn,
    });
    let made = 0;
    const revoked: string[] = [];
    const assets = assetSourceOver(
      { anyClient: () => rosetta },
      {
        limit: 2,
        createObjectURL: () => {
          made += 1;
          return `blob:history/${made}`;
        },
        revokeObjectURL: (url) => revoked.push(url),
      },
    );
    expect(await assets.imageAssetUrl(asset("a"), "full")).toBe("blob:history/1");
    expect(rest.reads[0]).toEqual({
      url: "http://127.0.0.1:44000/api/assets/a.webp",
      authorization: "Rosetta-Grant g1",
    });
    expect(await assets.imageAssetUrl(asset("b"), "full")).toBe("blob:history/2");
    // a hit answers at once and becomes the newest
    expect(assets.imageAssetUrl(asset("a"), "full")).toBe("blob:history/1");
    expect(await assets.imageAssetUrl(asset("c"), "full")).toBe("blob:history/3");
    expect(revoked).toEqual(["blob:history/2"]);
    expect(assets.size).toBe(2);
    // a rendition the timeline does not name is asked by recipe, as rosetta's
    // own address spells it
    await assets.imageAssetUrl(asset("d"), "tile");
    expect(rest.reads.at(-1)?.url).toBe("http://127.0.0.1:44000/api/assets/d.webp?image=tile&v=1");
    assets.dispose();
    expect(revoked.sort()).toEqual([
      "blob:history/1",
      "blob:history/2",
      "blob:history/3",
      "blob:history/4",
    ]);
    expect(assets.size).toBe(0);
  });

  it("keeps no failure — the next ask reads again — and answers null with no session open", async () => {
    let fail = true;
    const rosetta = new RosettaClient({
      baseUrl: "http://127.0.0.1:45000",
      fetchFn: (async () =>
        fail
          ? new Response("", {
              status: 500,
              headers: { "x-rosetta-protocol-version": String(PROTOCOL_VERSION) },
            })
          : new Response(new Uint8Array([9]), {
              status: 200,
              headers: { "x-rosetta-protocol-version": String(PROTOCOL_VERSION) },
            })) as typeof fetch,
    });
    const assets = assetSourceOver(
      { anyClient: () => rosetta },
      { createObjectURL: () => "blob:ok", revokeObjectURL: () => undefined },
    );
    expect(await assets.imageAssetUrl(asset("x"), "full")).toBeNull();
    fail = false;
    expect(await assets.imageAssetUrl(asset("x"), "full")).toBe("blob:ok");
    expect(assetSourceOver({ anyClient: () => null }).imageAssetUrl(asset("y"), "full")).toBeNull();
  });

  it("addresses an attachment by rosettad's own route — a path that outlives the port — and nothing else", () => {
    const assets = assetSourceOver({ anyClient: () => null });
    // the room's gate: with an address it asks for the renditions; without
    // one every recorded image read "Image data was not recorded" (D1)
    expect(assets.attachmentAssetUrl(asset("ab12"))).toBe("/api/assets/ab12.webp");
    expect(assets.attachmentAssetUrl({ ...asset("ab12"), url: "/api/assets/ab12.png" })).toBe(
      "/api/assets/ab12.png",
    );
    // a member the route does not name by its digest, an origin, a nested or
    // queried path: no address, so the room offers no open
    for (const url of [
      "/api/assets/cd34.webp",
      "http://127.0.0.1:45000/api/assets/ab12.webp",
      "/api/assets/x/ab12.webp",
      "/api/assets/ab12.webp?image=tile",
      "/api/sessions/s1/timeline/t1/read/0",
    ]) {
      expect(assets.attachmentAssetUrl({ ...asset("ab12"), url }), url).toBeNull();
    }
  });
});
