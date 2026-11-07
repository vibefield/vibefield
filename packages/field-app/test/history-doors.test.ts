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
 *
 * MA-4b (the build plan's 4b): the room's LIBRARY port — `index.artifacts`
 * (the contract's fixture, EL9) mapped into rosetta's `ArtifactPage` with no
 * path for any caller, the PJ key as each entry's project and the room's
 * runtime kind as its agent, paged with the room's cursor and its
 * `cursor_expired`; its bytes read through the session port OUTSIDE the
 * leases (never `open()`, which releases the room's own), bounded at 16 MiB,
 * from the session's own desktop (DS-7); and the projects plate's fixture
 * library under the shipping port. Dormant in the room until RO-37.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IndexArtifactsResult,
  IndexSessionsResult,
  IndexStatus,
  IndexThreadsResult,
  ProjectFiguresDayResult,
  ProjectFiguresResult,
  ProjectListResult,
  type ProjectSummary,
} from "@vibefield/contracts";
import {
  type ArtifactListRequest,
  type AssetRef,
  CursorExpiredError,
  type MetaState,
  PROTOCOL_VERSION,
  RosettaClient,
  type SubscriptionStatus,
  UnauthorizedError,
} from "@vibefield/rosetta-protocol";
import { createRoomDemo } from "@vibefield/rosetta-room/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_DESKTOP,
  historyProjectsClient,
  historyProjectsFixture,
} from "../src/design-system/history-fixtures";
import { assetSourceOver, blobType } from "../src/history/asset-source";
import {
  type ArtifactReader,
  artifactEntryOf,
  artifactParamsOf,
  catalogPortOver,
  catalogStatusOf,
  dayUsageOf,
  type HistoryCatalogPort,
  type HistoryDoorClient,
  type HistoryRegroup,
  historyPortsOver,
  metaStateOf,
  pingParts,
  projectRowOf,
  projectStatsOf,
  selfOf,
  sessionHomeOf,
  sessionRowOf,
  threadRowOf,
  usageOf,
} from "../src/history/doors";
import { isHandedToRoom, projectsHereOf } from "../src/history/host-model";
import {
  ARTIFACT_READ_MAX_BYTES,
  ARTIFACT_TOO_LARGE,
  FILE_TARGET_REFUSAL,
  sessionPortOver,
  TICKET_RENEW_LEAD_MS,
  TICKET_RETRY_MIN_MS,
  ticketRefusalWords,
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

  // PJ-4 wrote the guard as "another desktop's session never reaches the
  // room"; DS-7 (2026-10-31) hands the room another desktop's sessions of a
  // project with a place here — read from their own desktop, acted on there —
  // and keeps the rest of the guard.
  it("DS-7 — THE DEVICE GUARD, as amended: another desktop's session of a project with a place here reaches the room under its project; its Home, a project only it holds and a session with no project do not; a remote place is never a root; nothing that names a desktop when none is known", () => {
    const remote = {
      ...SESSIONS.rows[0]!,
      sessionId: "ses-on-the-laptop",
      device: LAPTOP,
      devices: [LAPTOP],
      // the same spelling as this Mac's checkout: its acts are the host's to
      // refuse (its host key names the laptop), its root never this Mac's
      cwd: "/Users/me/Projects/vibe-field",
    };
    const onlyThere = { ...remote, sessionId: "ses-laptop-only", projectKey: LAPTOP_ONLY.key };
    const { projectKey: _none, ...unkeyed } = { ...remote, sessionId: "ses-laptop-unkeyed" };
    const projects = [...PROJECTS.rows, LAPTOP_ONLY];
    const here = projectsHereOf(projects, STUDIO);
    expect([...here].sort()).toEqual([VIBE_FIELD, HOME].sort());
    expect(isHandedToRoom(remote, STUDIO, here)).toBe(true);
    expect(isHandedToRoom(onlyThere, STUDIO, here)).toBe(false);
    expect(isHandedToRoom(unkeyed, STUDIO, here)).toBe(false);
    expect(isHandedToRoom(SESSIONS.rows[0]!, STUDIO, here)).toBe(true);
    const meta = metaStateOf(projects, [...SESSIONS.rows, remote, onlyThere, unkeyed], [], STUDIO);
    expect(meta.sessions.map((row) => [row.id, row.project_id])).toContainEqual([
      "ses-on-the-laptop",
      VIBE_FIELD,
    ]);
    const ids = meta.sessions.map((row) => row.id);
    expect(ids).not.toContain("ses-laptop-only");
    expect(ids).not.toContain("ses-laptop-unkeyed");
    expect(meta.projects.map((project) => project.id)).toEqual([VIBE_FIELD, HOME]);
    expect(meta.projects.flatMap((project) => project.root_paths)).toEqual([
      "/Users/me/Projects/vibe-field",
      "/Users/me",
    ]);
    // which desktop is this one, unknown: no project, no row that names one
    const blind = metaStateOf(projects, [...SESSIONS.rows, remote], [], null);
    expect(blind.projects).toEqual([]);
    expect(blind.sessions).toEqual([]);
  });

  it("DS-7 — a session's home: another desktop that alone holds it, named as the listing's sources name it; this desktop's own, one it also holds (DS-D10), or one the listing does not name, is read here", () => {
    const remote = {
      ...SESSIONS.rows[0]!,
      sessionId: "ses-on-the-laptop",
      device: LAPTOP,
      devices: [LAPTOP],
    };
    const shared = { ...remote, sessionId: "ses-on-both", devices: [LAPTOP, STUDIO] };
    const listing = {
      sessions: [...SESSIONS.rows, remote, shared],
      sources: [
        { device: STUDIO, name: "Studio", self: true, state: "live" as const, rows: 3 },
        { device: LAPTOP, name: "Laptop", self: false, state: "asleep" as const, rows: 1 },
      ],
      self: STUDIO,
    };
    expect(sessionHomeOf(listing, "ses-on-the-laptop")).toEqual({
      device: LAPTOP,
      name: "Laptop",
      asleep: true,
    });
    expect(sessionHomeOf(listing, "ses-on-both")).toBeNull();
    expect(sessionHomeOf(listing, SESSIONS.rows[0]!.sessionId)).toBeNull();
    expect(sessionHomeOf(listing, "not-listed")).toBeNull();
    expect(sessionHomeOf(null, "ses-on-the-laptop")).toBeNull();
    expect(
      sessionHomeOf({ ...listing, sources: [] }, "ses-on-the-laptop"),
      "a desktop the sources do not name has no name to say",
    ).toEqual({ device: LAPTOP, name: null, asleep: false });
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

  it("AO-4: feeds the room's first reading — the per-project fold keyed as the room keys projects, the search build's stage, the daemon's clock", () => {
    const cold = IndexStatus.parse(fixture("index-status.cold-start.json"));
    const started = cold.startedAt ?? 0;
    const answer = catalogStatusOf(cold, started + 95_000);
    // a null key is the room's unassigned bucket
    expect(answer?.ingest?.projects).toEqual([
      {
        project_id: VIBE_FIELD,
        sessions_total: 1840,
        sessions_done: 612,
        bytes_total: 5_300_000_000,
        bytes_streamed: 1_900_000_000,
      },
      expect.objectContaining({ project_id: HOME, sessions_done: 233 }),
      expect.objectContaining({ project_id: null, sessions_total: 71 }),
    ]);
    // "elapsed" counts from the daemon's start, as rosetta derives its uptime
    expect(answer?.startedAt).toBe(started);
    expect(answer?.uptimeMs).toBe(95_000);
    expect(catalogStatusOf(cold, started - 5)?.uptimeMs).toBe(0);
    // no search build under way yet: no progress claimed
    expect(answer?.searchProgress).toBeNull();

    const building = IndexStatus.parse(fixture("index-status.search-building.json"));
    expect(catalogStatusOf(building)?.searchProgress).toEqual({
      stage: "indexing",
      documents_done: 41230,
      documents_total: 90411,
    });
    // a stage this build cannot name is no named step and no count
    expect(
      catalogStatusOf({
        ...building,
        search: { ...building.search!, progress: { done: 1, total: 2, stage: "unknown" } },
      })?.searchProgress,
    ).toBeNull();
  });

  it("rosetta 0.1.3: hands the room each runtime's admission course, and none it cannot read", () => {
    const cold = IndexStatus.parse(fixture("index-status.cold-start.json"));
    const courses = (status: IndexStatus) =>
      catalogStatusOf(status)?.ingest?.runtimes.map((row) => [
        row.runtime_id,
        row.admission_course,
      ]);
    // the not-imported face reads when a pending session opens from this
    expect(courses(cold)).toEqual([
      ["rt_5f0c9a2e1b7d4c3a", "per_tree"],
      ["rt_9c1d7e3a5b2f4068", "at_runtime_close"],
    ]);
    // a course fieldd folded to unknown, or none named, is no course: the
    // room infers one as it does for a daemon that predates the field
    const unnamed = {
      ...cold,
      runtimes: cold.runtimes.map((row, index) => ({
        ...row,
        backfill:
          row.backfill === undefined
            ? undefined
            : index === 0
              ? { ...row.backfill, admissionCourse: "unknown" as const }
              : (({ admissionCourse: _, ...rest }) => rest)(row.backfill),
      })),
    };
    for (const row of catalogStatusOf(unnamed)?.ingest?.runtimes ?? [])
      expect(row, row.runtime_id).not.toHaveProperty("admission_course");
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
    // the listings at the doors' page ceilings: every project; the mesh's
    // sessions (DS-7 — another desktop's of a project here reach the room)
    expect(door.calls.find((call) => call.method === "project.list")?.params).toEqual({
      limit: 500,
    });
    expect(door.calls.find((call) => call.method === "index.sessions")?.params).toEqual({
      scope: "mesh",
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

  it("fix7: keeps the index's phase beside its words — FAILED is what the frame's restart keys on — and says each change", async () => {
    let phase = "failed";
    const catalog = catalogPortOver(
      client({
        "index.status": () => ({
          ...(fixture("index-status.valid.json") as object),
          phase,
          rosettad: {
            phase,
            detail: "restart intensity exceeded",
            pid: null,
            protocolVersion: null,
          },
        }),
      }),
    );
    expect(catalog.indexPhase()).toBeNull();
    let heard = 0;
    catalog.onWordsChange(() => {
      heard += 1;
    });
    await expect(catalog.status()).rejects.toThrow();
    expect(catalog.indexPhase()).toBe("failed");
    expect(heard).toBeGreaterThanOrEqual(1);
    // the restart took: the phase moves and is said
    phase = "live";
    heard = 0;
    await catalog.status();
    expect(catalog.indexPhase()).toBe("live");
    expect(heard).toBeGreaterThanOrEqual(1);
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

  // DS-7 — a session another desktop holds
  const laptop = (id: string) =>
    id === "s1" ? { device: LAPTOP, name: "Laptop", asleep: false } : null;

  it("DS-7: a session another desktop holds is asked for by its owner, and reads through the same loopback lease; this desktop's own is asked as before", async () => {
    const door = client({
      "index.openTicket": () => ({ ...ticket(42100, "g1", Date.now() + 600_000), device: LAPTOP }),
    });
    const rest = rosettadFetch();
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn }, laptop);
    const session = await port.open("s1");
    await session.timelineEntry("s1", "t1");
    expect(rest.reads.at(-1)).toEqual({
      url: "http://127.0.0.1:42100/api/sessions/s1/timeline/t1",
      authorization: "Rosetta-Grant g1",
    });
    await port.open("s2");
    expect(
      door.calls.filter((call) => call.method === "index.openTicket").map((call) => call.params),
    ).toEqual([{ sessionId: "s1", device: LAPTOP }, { sessionId: "s2" }]);
    port.dispose();
  });

  it("DS-7: the owner asleep, not answering, out of road or not serving is said at once, in its name — never retried behind a spinner", async () => {
    const refusals: Array<[Record<string, unknown>, string]> = [
      [
        { service: "peer-link", device: LAPTOP, state: "offline" },
        "Laptop is asleep — its transcript opens when it wakes",
      ],
      [
        { service: "peer-link", device: LAPTOP, state: "unreachable" },
        "Laptop isn't answering — its transcript opens when it does",
      ],
      [
        { service: "index", device: LAPTOP, state: "egress_unavailable" },
        "No road to Laptop from this desktop yet",
      ],
      [
        { service: "index", device: LAPTOP, state: "doors_not_published" },
        "Laptop isn't serving its history right now — open it again in a moment",
      ],
    ];
    for (const [details, words] of refusals) {
      const door = client({
        "index.openTicket": () => {
          throw Object.assign(new Error("refused"), {
            kind: "UNAVAILABLE",
            retryable: true,
            details,
          });
        },
      });
      const port = sessionPortOver(door, {}, laptop);
      await expect(port.open("s1")).rejects.toThrow(words);
      expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(1);
    }
    // a desktop the listing already calls asleep is said so at once, never asked
    const door = client({ "index.openTicket": () => ticket(42100, "g1", Date.now() + 600_000) });
    const port = sessionPortOver(door, {}, (id) =>
      id === "s1" ? { device: LAPTOP, name: "Laptop", asleep: true } : null,
    );
    await expect(port.open("s1")).rejects.toThrow(
      "Laptop is asleep — its transcript opens when it wakes",
    );
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toEqual([]);
    // a desktop the listing does not name is still said, as that desktop
    expect(
      ticketRefusalWords({
        kind: "UNAVAILABLE",
        retryable: true,
        details: { service: "peer-link", device: LAPTOP, state: "offline" },
      }),
    ).toBe("That desktop is asleep — its transcript opens when it wakes");
    // and a refusal naming no desktop keeps the patient retry it had
    expect(
      ticketRefusalWords({
        kind: "UNAVAILABLE",
        retryable: true,
        details: { service: "index", state: "starting" },
        message: "the agent index is starting",
      }),
    ).toBe("the agent index is starting");
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
    // rosetta 0.1.3: a recorded original with no bundle is asked by recipe,
    // its full rendition too
    expect(rest.reads[0]).toEqual({
      url: "http://127.0.0.1:44000/api/assets/a.webp?image=full&v=1",
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

  it("rosetta 0.1.3: a recorded original comes back WebP, and its object URL says so; bytes that are not WebP keep the type the timeline recorded", async () => {
    const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
    const rest = rosettadFetch(new Set(), (path, headers) =>
      path === "/api/assets/shot.png"
        ? new Response(WEBP, { status: 200, headers: { ...headers, "content-type": "image/webp" } })
        : null,
    );
    const rosetta = new RosettaClient({
      baseUrl: "http://127.0.0.1:44000",
      credential: { kind: "grant", grant: "g1" },
      fetchFn: rest.fetchFn,
    });
    const types: string[] = [];
    const assets = assetSourceOver(
      { anyClient: () => rosetta },
      {
        createObjectURL: (blob) => {
          types.push(blob.type);
          return `blob:history/${types.length}`;
        },
        revokeObjectURL: () => undefined,
      },
    );
    const png: AssetRef = {
      url: "/api/assets/shot.png",
      digest: "shot",
      media_type: "image/png",
      byte_len: 13,
    };
    expect(await assets.imageAssetUrl(png, "full")).toBe("blob:history/1");
    expect(rest.reads[0]?.url).toBe("http://127.0.0.1:44000/api/assets/shot.png?image=full&v=1");
    const svg: AssetRef = {
      url: "/api/assets/mark.svg",
      digest: "mark",
      media_type: "image/svg+xml",
      byte_len: 3,
    };
    await assets.imageAssetUrl(svg, "full");
    expect(types).toEqual(["image/webp", "image/svg+xml"]);
    expect(blobType(new Uint8Array([0x52, 0x49, 0x46, 0x46]), "image/png")).toBe("image/png");
    assets.dispose();
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

/* ── MA-4b: the room's library — index.artifacts as rosetta's page ──────── */

/** `index.artifacts`' answer (EL9: the contract's own fixture): this
 * desktop's library — an app's newest presentation, kept, and its older one,
 * recovered from another file and missing, whose publish request's
 * description and dropped files (none) rosetta 0.1.4 recorded. */
const LIBRARY = IndexArtifactsResult.parse(fixture("index-artifacts.valid.json"));
const KEPT = LIBRARY.entries[0]!;
const OLDER = LIBRARY.entries[1]!;

/** The room's library ask with no filter, as its loader sends it. */
const ASK: ArtifactListRequest = {
  q: null,
  agent: null,
  project: null,
  artifact_id: null,
  cursor: null,
  limit: 100,
};

/** The bytes rosettad answers for a page in these rows. */
const PAGE_BYTES = [60, 104, 49, 62];

const ticketCalls = (door: { calls: Array<{ method: string; params: unknown }> }) =>
  door.calls.filter((call) => call.method === "index.openTicket");
const libraryCalls = (door: { calls: Array<{ method: string; params: unknown }> }) =>
  door.calls.filter((call) => call.method === "index.artifacts").map((call) => call.params);

/** The port's library, asserted offered (a guard, not a red). */
function libraryOf(catalog: HistoryCatalogPort) {
  const library = catalog.artifacts;
  expect(library, "the catalog port offers the room its library").toBeDefined();
  return library as NonNullable<typeof library>;
}

/** A fieldd for the library rows: the listing (so the port knows the
 * projects' names) and `index.artifacts`, scripted. */
function libraryDoor(answer: (params: Record<string, unknown>) => unknown) {
  return client({
    "project.list": () => PROJECTS,
    "index.sessions": () => SESSIONS,
    "index.threads": () => ({ rows: [] }),
    "index.status": () => fixture("index-status.valid.json"),
    "index.artifacts": answer,
  });
}

const noRead: ArtifactReader = async () => new Uint8Array();

describe("MA-4b — the room's library: index.artifacts as rosetta's ArtifactPage (dormant until RO-37)", () => {
  const names = new Map([[VIBE_FIELD, "vibe-field · code"]]);

  it("maps an entry field by field into rosetta's ArtifactEntry — no path, no recovered-from, no asset; the PJ key named as the listing names it; the agent as the room's runtime kind", () => {
    expect(artifactEntryOf(KEPT, names)).toEqual({
      publication: {
        id: KEPT.presentationId,
        artifact_id: KEPT.appId,
        session_id: "ses-9b2f0c7d",
        timeline_id: "artifact-message-1",
        title: "Checkout design review",
        filename: "checkout.html",
        path: null,
        url: "https://claude.ai/code/artifact/review",
        native_id: "review",
        version: "2",
        published_at: 1793836800000,
        source_offset: 0,
        description: null,
        dropped_files: null,
      },
      availability: "captured",
      captured_at: 1793836805000,
      recovered_from: null,
      asset: null,
      agent: "claude-code",
      session_title: "Review checkout",
      project_id: VIBE_FIELD,
      project_name: "vibe-field · code",
      presentations: 2,
    });
    // the older presentation was recovered from another file: a path
    // upstream, a flag in the contract — the room is handed neither
    const older = artifactEntryOf(OLDER, names);
    expect(older.publication.version, "the older presentation").toBe("1");
    expect(older.availability).toBe("missing");
    expect(older.recovered_from).toBeNull();
    expect(older.captured_at).toBeNull();
    expect(older.asset).toBeNull();
    expect(older.publication.path).toBeNull();
  });

  it("carries the publish request's description and dropped files (rosetta 0.1.4) as fieldd answered them, and rosetta's own null for each fieldd did not send", () => {
    const older = artifactEntryOf(OLDER, names);
    expect(older.publication.description, "the contract's fixture, as the request said it").toBe(
      "The first checkout flow, before the review.",
    );
    expect(older.publication.dropped_files, "none dropped is a count, never unknown").toBe(0);
    const told = IndexArtifactsResult.parse({
      entries: [{ ...KEPT, description: "A checkout flow, for review.", droppedFiles: 2 }],
      canonicalReady: true,
    }).entries[0]!;
    const mapped = artifactEntryOf(told, names);
    expect(mapped.publication.description).toBe("A checkout flow, for review.");
    expect(mapped.publication.dropped_files).toBe(2);
    const unsaid = artifactEntryOf(KEPT, names);
    expect(unsaid.publication.description, "no description: rosetta's null").toBeNull();
    expect(unsaid.publication.dropped_files, "an unknown count: rosetta's null").toBeNull();
  });

  it("before any listing a project is its key, unnamed — never rosetta's own name; no catalog row is the room's unknown; an availability this build cannot read is no local copy", () => {
    const strange = IndexArtifactsResult.parse({
      entries: [{ ...KEPT, availability: "smudged" }],
      canonicalReady: true,
    }).entries[0]!;
    const mapped = artifactEntryOf(strange, new Map());
    expect(mapped.project_id, "the PJ key fieldd joined").toBe(VIBE_FIELD);
    expect(mapped.project_name, "rosetta's project name is not History's").toBeNull();
    expect(mapped.availability).toBe("not_captured");
    const { provider: _provider, ...unmapped } = KEPT;
    expect(artifactEntryOf(unmapped, names).agent).toBe("unknown");
  });

  it("asks in the contract's spelling — words trimmed and bounded, the agent's kind only when the catalog maps it, the PJ project, one app's history, the cursor, the limit clamped — and an ask nothing can match is none", () => {
    expect(
      artifactParamsOf({
        q: "  checkout  ",
        agent: "claude-code",
        project: VIBE_FIELD,
        artifact_id: null,
        cursor: "c1",
        limit: 100,
      }),
    ).toEqual({
      q: "checkout",
      kind: "claude-code",
      projectKey: VIBE_FIELD,
      cursor: "c1",
      limit: 100,
    });
    expect(artifactParamsOf(ASK)).toEqual({ limit: 100 });
    expect(artifactParamsOf({ ...ASK, limit: null })).toEqual({});
    expect(artifactParamsOf({ ...ASK, artifact_id: KEPT.appId })).toEqual({
      appId: KEPT.appId,
      limit: 100,
    });
    expect(artifactParamsOf({ ...ASK, q: "   ", cursor: "", limit: 500 })).toEqual({ limit: 100 });
    expect(artifactParamsOf({ ...ASK, limit: 0 })).toEqual({ limit: 1 });
    expect(artifactParamsOf({ ...ASK, q: "x".repeat(600) })?.["q"]).toHaveLength(512);
    // the room's "unknown" (a session no catalog row maps) is no kind rosetta
    // files under: never sent, the port filters it itself
    expect(artifactParamsOf({ ...ASK, agent: "unknown" })).toEqual({ limit: 100 });
    // a project or an app spelled outside the contract's grammar: nothing can match
    expect(artifactParamsOf({ ...ASK, project: "not a key" })).toBeNull();
    expect(artifactParamsOf({ ...ASK, artifact_id: "app-1" })).toBeNull();
  });

  it("pages this desktop's library through index.artifacts — the room's cursor in, the next one out, canonicalReady kept — each entry named from the listing", async () => {
    const pages = [
      {
        entries: [{ ...KEPT, projectName: "rosetta's own name" }],
        nextCursor: "c2",
        canonicalReady: false,
      },
      { entries: [OLDER], canonicalReady: true },
    ];
    const door = libraryDoor((params) => (params["cursor"] === "c2" ? pages[1] : pages[0]));
    const catalog = catalogPortOver(door, { readArtifact: noRead });
    const feed = catalog.subscribeMeta({ onChange: () => undefined, onStatus: () => undefined });
    await flush();
    const library = libraryOf(catalog);
    const first = await library.list(ASK);
    expect(
      first.entries.map((entry) => entry.publication.id),
      "the first page's entries",
    ).toEqual([KEPT.presentationId]);
    expect(first.entries[0]?.project_name, "the listing's name").toBe("vibe-field");
    expect(first.next_cursor).toBe("c2");
    expect(first.canonical_ready).toBe(false);
    const second = await library.list({ ...ASK, cursor: "c2" });
    expect(second.entries.map((entry) => entry.publication.id)).toEqual([OLDER.presentationId]);
    expect(second.next_cursor).toBeNull();
    expect(second.canonical_ready).toBe(true);
    // this desktop's library: no device is named
    expect(libraryCalls(door)).toEqual([{ limit: 100 }, { cursor: "c2", limit: 100 }]);
    feed.close();
  });

  it("keeps the room's agent filter on the mapped kinds: a kind the catalog maps narrows at the library; the room's unknown is filtered here", async () => {
    const { provider: _provider, kind: _kind, ...unmapped } = OLDER;
    const door = libraryDoor(() => ({ entries: [KEPT, unmapped], canonicalReady: true }));
    const library = libraryOf(catalogPortOver(door, { readArtifact: noRead }));
    const known = await library.list({ ...ASK, agent: "claude-code" });
    expect(
      known.entries.map((entry) => entry.publication.id),
      "a kind the catalog maps",
    ).toEqual([KEPT.presentationId]);
    const unknown = await library.list({ ...ASK, agent: "unknown" });
    expect(unknown.entries.map((entry) => entry.publication.id)).toEqual([OLDER.presentationId]);
    expect(libraryCalls(door)).toEqual([{ kind: "claude-code", limit: 100 }, { limit: 100 }]);
  });

  it("a cursor the library moved under is rosetta's own cursor_expired — the room's loader reads again from the head; any other refusal is said in fieldd's words", async () => {
    let refuse: () => never = () => {
      throw Object.assign(
        new Error("the library moved under the cursor; read again from the head"),
        {
          kind: "PRECONDITION_FAILED",
          retryable: false,
          details: { service: "index", reason: "cursor-expired" },
        },
      );
    };
    const library = libraryOf(
      catalogPortOver(
        libraryDoor(() => refuse()),
        { readArtifact: noRead },
      ),
    );
    const expired = await library.list({ ...ASK, cursor: "c2" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(expired, "fieldd's cursor-expired").toBeInstanceOf(CursorExpiredError);
    expect(expired).toMatchObject({ status: 410, code: "cursor_expired" });
    refuse = () => {
      throw Object.assign(new Error("the agent index is starting"), {
        kind: "UNAVAILABLE",
        retryable: true,
        details: { service: "index", state: "starting" },
      });
    };
    await expect(library.list(ASK)).rejects.toThrow("The agent index is starting (starting)");
  });

  it("a page the room's loader cancels comes back as its own cancel, never re-worded as fieldd's refusal", async () => {
    const door = libraryDoor(() => new Promise(() => undefined));
    const library = libraryOf(catalogPortOver(door, { readArtifact: noRead }));
    const controller = new AbortController();
    const listing = library.list(ASK, controller.signal);
    controller.abort();
    await expect(listing, "the loader's cancel, as it came").rejects.toBe(controller.signal.reason);
    expect(libraryCalls(door), "the page was asked").toEqual([{ limit: 100 }]);
  });

  it("an ask nothing can match is an empty page, settled, and the door is never asked", async () => {
    const door = libraryDoor(() => LIBRARY);
    const library = libraryOf(catalogPortOver(door, { readArtifact: noRead }));
    expect(await library.list({ ...ASK, project: "not a key" })).toEqual({
      entries: [],
      next_cursor: null,
      canonical_ready: true,
    });
    expect(libraryCalls(door)).toEqual([]);
  });

  it("offers the library only with a reader, and its read IS the reader's — the session's grant, never fieldd", async () => {
    const door = libraryDoor(() => LIBRARY);
    expect(catalogPortOver(door).artifacts, "no reader, no library").toBeUndefined();
    const asked: Array<[string, string]> = [];
    const page = new Uint8Array(PAGE_BYTES);
    const library = libraryOf(
      catalogPortOver(door, {
        readArtifact: async (sessionId, publicationId) => {
          asked.push([sessionId, publicationId]);
          return page;
        },
      }),
    );
    expect([...(await library.read("ses-9b2f0c7d", KEPT.presentationId))]).toEqual(PAGE_BYTES);
    expect(asked).toEqual([["ses-9b2f0c7d", KEPT.presentationId]]);
    expect(door.calls, "a read asks fieldd nothing").toEqual([]);
  });

  it("the window's ports: the room's library reads through the session port — a one-shot ticket and rosettad's content route", async () => {
    const door = client({ "index.openTicket": () => ticket(44000, "g1", Date.now() + 600_000) });
    const rest = pageFetch();
    const ports = historyPortsOver(door, { platform: null, sessions: { fetchFn: rest.fetchFn } });
    const library = libraryOf(ports.catalog);
    expect([...(await library.read("s1", KEPT.presentationId))]).toEqual(PAGE_BYTES);
    expect(rest.reads).toEqual([
      {
        url: `http://127.0.0.1:44000/api/sessions/s1/artifacts/${KEPT.presentationId}/content`,
        authorization: "Rosetta-Grant g1",
      },
    ]);
    ports.dispose();
  });
});

/** rosettad's REST for the page rows: a page's content route answers
 * `PAGE_BYTES` unless `page` scripts it; everything else as `rosettadFetch`. */
function pageFetch(
  refuseOnce: Set<string> = new Set(),
  page: (headers: Record<string, string>) => Response | null = () => null,
) {
  return rosettadFetch(refuseOnce, (path, headers) =>
    /^\/api\/sessions\/[^/]+\/artifacts\/[^/]+\/content$/.test(path)
      ? (page(headers) ?? new Response(new Uint8Array(PAGE_BYTES), { status: 200, headers }))
      : null,
  );
}

describe("MA-4b — the session port reads a page outside its leases", () => {
  const PUB = KEPT.presentationId;
  const content = (port: number, session = "s1") =>
    `http://127.0.0.1:${port}/api/sessions/${session}/artifacts/${PUB}/content`;
  const MIB = 1024 * 1024;

  it("with no lease open: ONE ticket for that session, the content route with its grant, the bytes — and nothing left behind: no lease, no renewal", async () => {
    vi.useFakeTimers({ now: 2_000_000 });
    const door = client({ "index.openTicket": () => ticket(44100, "g1", 2_000_000 + 600_000) });
    const rest = pageFetch();
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    expect([...(await port.readArtifact("s1", PUB))], "the page's bytes").toEqual(PAGE_BYTES);
    expect(rest.reads).toEqual([{ url: content(44100), authorization: "Rosetta-Grant g1" }]);
    expect(ticketCalls(door).map((call) => call.params)).toEqual([{ sessionId: "s1" }]);
    expect(port.anyClient(), "no lease is left behind").toBeNull();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(ticketCalls(door), "a one-shot ticket is never renewed").toHaveLength(1);
    port.dispose();
  });

  it("with the room's lease open on that session: its grant reads the page — no ticket of its own — and the room's lease and stream are untouched (never open(), which releases it)", async () => {
    FakeSocket.opened = [];
    const tickets = [ticket(44200, "g1", Date.now() + 600_000)];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const rest = pageFetch();
    const port = sessionPortOver(door, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      fetchFn: rest.fetchFn,
    });
    const session = await port.open("s1");
    const statuses: SubscriptionStatus[] = [];
    session.subscribeSession("s1", { onStatus: (status) => statuses.push(status) });
    const socket = FakeSocket.opened[0];
    socket?.serve({ frame: "hello", protocol_version: PROTOCOL_VERSION, stamp: null });
    socket?.serve({ frame: "caught_up", stamp: { epoch: 1, seq: 0 } });
    const lease = port.anyClient();
    expect([...(await port.readArtifact("s1", PUB))], "the page's bytes").toEqual(PAGE_BYTES);
    expect(rest.reads.at(-1)).toEqual({ url: content(44200), authorization: "Rosetta-Grant g1" });
    expect(ticketCalls(door), "the lease's grant, no ticket of its own").toHaveLength(1);
    expect(socket?.closed, "the room's stream stays open").toBe(false);
    expect(statuses.at(-1)).toBe("live");
    expect(port.anyClient(), "the room's lease stands").toBe(lease);
    await expect(session.timelineEntry("s1", "t1")).resolves.toMatchObject({ timeline_id: "t1" });
    port.dispose();
  });

  it("a lease open on ANOTHER session lends nothing: the page's session gets a one-shot ticket, and that lease is left alone", async () => {
    const tickets = [
      ticket(44300, "g-s2", Date.now() + 600_000),
      ticket(44301, "g-s1", Date.now() + 600_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const rest = pageFetch();
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    await port.open("s2");
    expect([...(await port.readArtifact("s1", PUB))], "the page's bytes").toEqual(PAGE_BYTES);
    expect(rest.reads.at(-1)).toEqual({ url: content(44301), authorization: "Rosetta-Grant g-s1" });
    expect(ticketCalls(door).map((call) => call.params)).toEqual([
      { sessionId: "s2" },
      { sessionId: "s1" },
    ]);
    expect(port.anyClient()?.baseUrl, "the other session's lease stands").toBe(
      "http://127.0.0.1:44300",
    );
    port.dispose();
  });

  it("an expired grant on a page read is renewed once and read again — a one-shot's by one more ticket, a lease's by its own renewal", async () => {
    const route = `/api/sessions/s1/artifacts/${PUB}/content`;
    // the second ticket names a new origin: a restarted rosettad binds a new loopback port
    const once = [
      ticket(44400, "g1", Date.now() + 600_000),
      ticket(44401, "g2", Date.now() + 600_000),
    ];
    const door = client({ "index.openTicket": () => once.shift() });
    const rest = pageFetch(new Set([route]));
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    expect([...(await port.readArtifact("s1", PUB))], "a one-shot's page").toEqual(PAGE_BYTES);
    expect(rest.reads.map((read) => read.authorization)).toEqual([
      "Rosetta-Grant g1",
      "Rosetta-Grant g2",
    ]);
    expect(
      rest.reads.map((read) => read.url),
      "read again at the renewed ticket's origin",
    ).toEqual([content(44400), content(44401)]);
    expect(port.anyClient(), "no lease is left behind").toBeNull();
    port.dispose();

    const leased = [
      ticket(44500, "g1", Date.now() + 600_000),
      ticket(44500, "g2", Date.now() + 600_000),
    ];
    const leaseDoor = client({ "index.openTicket": () => leased.shift() });
    const leaseRest = pageFetch(new Set([route]));
    const leasePort = sessionPortOver(leaseDoor, { fetchFn: leaseRest.fetchFn });
    const room = await leasePort.open("s1");
    const lease = leasePort.anyClient();
    expect([...(await leasePort.readArtifact("s1", PUB))], "a lease's page").toEqual(PAGE_BYTES);
    expect(leaseRest.reads.map((read) => read.authorization)).toEqual([
      "Rosetta-Grant g1",
      "Rosetta-Grant g2",
    ]);
    expect(ticketCalls(leaseDoor)).toHaveLength(2);
    // the LEASE was renewed, not passed by: the room's next read presents the
    // new grant on the same client, and asks no third ticket
    await expect(room.timelineEntry("s1", "t1")).resolves.toMatchObject({ timeline_id: "t1" });
    expect(leaseRest.reads.at(-1)?.authorization, "the lease's own grant, renewed").toBe(
      "Rosetta-Grant g2",
    );
    expect(ticketCalls(leaseDoor), "no third ticket").toHaveLength(2);
    expect(leasePort.anyClient(), "the room's lease keeps its one client").toBe(lease);
    leasePort.dispose();
  });

  it("a one-shot's read refused for the grant's REACH is never renewed: one ticket, one read, rosetta's refusal as it came", async () => {
    for (const reason of ["wrong-scope", "wrong-route"]) {
      const door = client({ "index.openTicket": () => ticket(44450, "g1", Date.now() + 600_000) });
      const rest = pageFetch(
        new Set(),
        (headers) =>
          new Response("", { status: 401, headers: { ...headers, "x-rosetta-auth": reason } }),
      );
      const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
      const refused = await port.readArtifact("s1", PUB).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused, reason).toBeInstanceOf(UnauthorizedError);
      expect((refused as UnauthorizedError).reason, reason).toBe(reason);
      expect(ticketCalls(door), `${reason}: one ticket`).toHaveLength(1);
      expect(rest.reads, `${reason}: one read`).toEqual([
        { url: content(44450), authorization: "Rosetta-Grant g1" },
      ]);
      port.dispose();
    }
  });

  it(`bounded at ${ARTIFACT_READ_MAX_BYTES} bytes: a page at the bound reads whole; one past it is refused in the room's words, its body not read past the bound — nor at all when its length says so`, async () => {
    const door = client({ "index.openTicket": () => ticket(44600, "g1", Date.now() + 600_000) });
    let serve: (headers: Record<string, string>) => Response = (headers) =>
      new Response(new Uint8Array(ARTIFACT_READ_MAX_BYTES), { status: 200, headers });
    const rest = pageFetch(new Set(), (headers) => serve(headers));
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    expect((await port.readArtifact("s1", PUB)).byteLength, "a page at the bound").toBe(
      ARTIFACT_READ_MAX_BYTES,
    );
    // past it, streamed with no declared length
    let pulls = 0;
    const stream = (): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            if (pulls > 64) controller.close();
            else controller.enqueue(new Uint8Array(MIB));
          },
        },
        { highWaterMark: 0 },
      );
    serve = (headers) => new Response(stream(), { status: 200, headers });
    await expect(port.readArtifact("s1", PUB), "a streamed page past the bound").rejects.toThrow(
      ARTIFACT_TOO_LARGE,
    );
    expect(pulls, "the body is not read past the bound").toBeLessThanOrEqual(
      ARTIFACT_READ_MAX_BYTES / MIB + 2,
    );
    // a length that says it is past the bound: no body is read
    pulls = 0;
    serve = (headers) =>
      new Response(stream(), {
        status: 200,
        headers: { ...headers, "content-length": String(ARTIFACT_READ_MAX_BYTES + 1) },
      });
    await expect(port.readArtifact("s1", PUB), "a declared length past the bound").rejects.toThrow(
      ARTIFACT_TOO_LARGE,
    );
    expect(pulls, "a declared length past the bound reads no body").toBe(0);
    port.dispose();

    // through the room's own lease on the session: the same bound, and the
    // lease is left as it was — its client, its stream, no ticket of the read's
    FakeSocket.opened = [];
    const leaseDoor = client({
      "index.openTicket": () => ticket(44601, "g1", Date.now() + 600_000),
    });
    const leasePort = sessionPortOver(leaseDoor, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      fetchFn: rest.fetchFn,
    });
    const room = await leasePort.open("s1");
    room.subscribeSession("s1", {});
    const socket = FakeSocket.opened[0];
    socket?.serve({ frame: "hello", protocol_version: PROTOCOL_VERSION, stamp: null });
    socket?.serve({ frame: "caught_up", stamp: { epoch: 1, seq: 0 } });
    const lease = leasePort.anyClient();
    pulls = 0;
    serve = (headers) => new Response(stream(), { status: 200, headers });
    // a page read whole is said by its size, never printed (64 MiB would not print)
    const leaseRead = await leasePort.readArtifact("s1", PUB).then(
      (bytes) => `${bytes.byteLength} bytes read`,
      (error: unknown) => error,
    );
    expect(leaseRead, "a streamed page past the bound, through the lease").toBeInstanceOf(Error);
    expect((leaseRead as Error).message).toBe(ARTIFACT_TOO_LARGE);
    expect(pulls, "the lease's body is not read past the bound").toBeLessThanOrEqual(
      ARTIFACT_READ_MAX_BYTES / MIB + 2,
    );
    expect(rest.reads.at(-1)?.url, "read at the lease's origin").toBe(content(44601));
    expect(ticketCalls(leaseDoor), "the lease's grant, no ticket of the read's").toHaveLength(1);
    expect(leasePort.anyClient(), "the room's lease stands").toBe(lease);
    expect(socket?.closed, "the room's stream stays open").toBe(false);
    leasePort.dispose();
  });

  it("DS-7: a page on a session another desktop holds is read by that desktop's ticket; one the listing calls asleep is said so at once, never asked", async () => {
    const door = client({
      "index.openTicket": () => ({ ...ticket(44700, "g1", Date.now() + 600_000), device: LAPTOP }),
    });
    const rest = pageFetch();
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn }, (id) =>
      id === "s1" ? { device: LAPTOP, name: "Laptop", asleep: false } : null,
    );
    expect([...(await port.readArtifact("s1", PUB))], "the page's bytes").toEqual(PAGE_BYTES);
    expect(ticketCalls(door).map((call) => call.params)).toEqual([
      { sessionId: "s1", device: LAPTOP },
    ]);
    port.dispose();

    const asleepDoor = client({
      "index.openTicket": () => ticket(44701, "g1", Date.now() + 600_000),
    });
    const asleep = sessionPortOver(asleepDoor, {}, (id) =>
      id === "s1" ? { device: LAPTOP, name: "Laptop", asleep: true } : null,
    );
    await expect(asleep.readArtifact("s1", PUB)).rejects.toThrow(
      "Laptop is asleep — its transcript opens when it wakes",
    );
    expect(ticketCalls(asleepDoor), "an asleep desktop is never asked").toEqual([]);
  });

  it("a ticket fieldd refuses is said in the room's words, and a road refusal at once, in its desktop's name — never retried behind a spinner", async () => {
    const off = client({
      "index.openTicket": () => {
        throw Object.assign(new Error("the direct plane is off"), {
          kind: "UNAVAILABLE",
          retryable: false,
          details: { service: "index", state: "direct-plane-off" },
        });
      },
    });
    await expect(sessionPortOver(off).readArtifact("s1", PUB)).rejects.toThrow(
      "This desktop has the direct plane switched off — its transcripts can't be read here",
    );
    const road = client({
      "index.openTicket": () => {
        throw Object.assign(new Error("refused"), {
          kind: "UNAVAILABLE",
          retryable: true,
          details: { service: "peer-link", device: LAPTOP, state: "unreachable" },
        });
      },
    });
    const port = sessionPortOver(road, {}, (id) =>
      id === "s1" ? { device: LAPTOP, name: "Laptop", asleep: false } : null,
    );
    await expect(port.readArtifact("s1", PUB)).rejects.toThrow(
      "Laptop isn't answering — its transcript opens when it does",
    );
    expect(ticketCalls(road), "said at once").toHaveLength(1);
  });

  /** fieldd cannot mint the ticket YET: a refusal the port asks again for. */
  const starting = () =>
    Object.assign(new Error("the agent index is starting"), {
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "index", state: "starting" },
    });

  it("a one-shot read the room cancels stops asking fieldd for its ticket, and answers the room's own cancel — never a ticket refusal", async () => {
    vi.useFakeTimers({ now: 3_000_000 });
    const door = client({
      "index.openTicket": () => {
        throw starting();
      },
    });
    const port = sessionPortOver(door, { fetchFn: pageFetch().fetchFn });
    const controller = new AbortController();
    let outcome: unknown = "still reading";
    void port.readArtifact("s1", PUB, controller.signal).then(
      () => {
        outcome = "read";
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    await vi.advanceTimersByTimeAsync(TICKET_RETRY_MIN_MS);
    const asked = ticketCalls(door).length;
    expect(asked, "asked again while the read stands").toBeGreaterThan(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcome, "the room's own cancel, as it came").toBe(controller.signal.reason);
    expect(ticketCalls(door), "never asked again once cancelled").toHaveLength(asked);
    port.dispose();
  });

  it("dispose() stops a one-shot read's asking too: it ends in the room's words for the refusal, and fieldd is asked no more", async () => {
    vi.useFakeTimers({ now: 3_000_000 });
    const door = client({
      "index.openTicket": () => {
        throw starting();
      },
    });
    const port = sessionPortOver(door, { fetchFn: pageFetch().fetchFn });
    let outcome: unknown = "still reading";
    void port.readArtifact("s1", PUB).then(
      () => {
        outcome = "read";
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    await vi.advanceTimersByTimeAsync(TICKET_RETRY_MIN_MS);
    const asked = ticketCalls(door).length;
    expect(asked, "asked again while the read stands").toBeGreaterThan(1);
    port.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcome, "the read ends").toBeInstanceOf(Error);
    expect((outcome as Error).message, "in the room's words").toBe(ticketRefusalWords(starting()));
    expect(ticketCalls(door), "never asked again once disposed").toHaveLength(asked);
  });
});

describe("MA-4b — the History plate's fixture library (the projects plate)", () => {
  const NOW = 1_793_836_800_000;

  it("the plate's fixture fieldd answers index.artifacts in the contract's shape: one app per demo project with a session here, under its PJ key, by its agent; one presented twice, one not kept; its filters narrow", async () => {
    const demo = createRoomDemo(NOW);
    const door = historyProjectsClient(demo);
    const answer = IndexArtifactsResult.parse(await door.request("index.artifacts", {}));
    const projects = new Set(demo.meta.sessions.flatMap((row) => row.project_id ?? []));
    expect(answer.entries, "one app per demo project with a session").toHaveLength(projects.size);
    const sessions = new Set(demo.meta.sessions.map((row) => row.id));
    for (const entry of answer.entries) {
      expect(entry.device, entry.title).toBe(FIXTURE_DESKTOP);
      expect(sessions.has(entry.sessionId), entry.sessionId).toBe(true);
      expect(entry.projectKey?.startsWith("p1:demo-"), entry.title).toBe(true);
      expect(entry.provider, entry.title).toBeDefined();
    }
    expect(answer.canonicalReady).toBe(true);
    const twice = answer.entries.find((entry) => entry.versions > 1);
    expect(twice, "an app presented twice").toBeDefined();
    expect(
      answer.entries.some((entry) => entry.availability !== "captured"),
      "an app whose page was not kept",
    ).toBe(true);
    const versions = IndexArtifactsResult.parse(
      await door.request("index.artifacts", { appId: twice?.appId }),
    );
    expect(versions.entries.map((entry) => entry.appId)).toEqual([twice?.appId, twice?.appId]);
    const key = answer.entries[0]?.projectKey;
    const narrowed = IndexArtifactsResult.parse(
      await door.request("index.artifacts", { projectKey: key }),
    );
    expect(narrowed.entries.every((entry) => entry.projectKey === key)).toBe(true);
    expect(narrowed.entries.length).toBeLessThan(answer.entries.length);
    // by words: one app's title, in any case, is that app alone
    const first = answer.entries[0];
    const byWords = IndexArtifactsResult.parse(
      await door.request("index.artifacts", { q: first?.title.toUpperCase() }),
    );
    expect(
      byWords.entries.map((entry) => entry.appId),
      "an app's title narrows to it",
    ).toEqual([first?.appId]);
    // by the agent's kind: each demo runtime's kind holds its own apps and no other's
    const sizes: number[] = [];
    for (const { kind } of demo.meta.runtimes) {
      const byKind = IndexArtifactsResult.parse(await door.request("index.artifacts", { kind }));
      expect(
        byKind.entries.map((entry) => entry.appId),
        kind,
      ).toEqual(answer.entries.filter((entry) => entry.kind === kind).map((entry) => entry.appId));
      sizes.push(byKind.entries.length);
    }
    expect(
      sizes.some((size) => size < answer.entries.length),
      "a kind narrows",
    ).toBe(true);
  });

  it("through the SHIPPING library port the plate's apps reach the room as rosetta's entries — no path — and each kept page reads as an HTML document", async () => {
    const plate = historyProjectsFixture(NOW);
    const library = libraryOf(plate.catalog);
    const page = await library.list(ASK);
    expect(page.entries.length, "the plate's library").toBeGreaterThanOrEqual(3);
    for (const entry of page.entries) {
      expect(entry.publication.path).toBeNull();
      expect(entry.project_id?.startsWith("p1:demo-"), entry.publication.title).toBe(true);
    }
    const kept = page.entries.filter((entry) => entry.availability === "captured");
    expect(kept.length, "kept pages").toBeGreaterThan(0);
    for (const entry of kept) {
      const text = new TextDecoder().decode(
        await library.read(entry.publication.session_id, entry.publication.id),
      );
      expect(text.toLowerCase().startsWith("<!doctype html>"), entry.publication.title).toBe(true);
    }
    // the reader serves a kept page to its own session alone, and no page that was not kept
    const refusal = "the catalog kept no page for this presentation; these are fixtures";
    const notKept = page.entries.find((entry) => entry.availability !== "captured");
    expect(notKept, "an app whose page was not kept").toBeDefined();
    await expect(
      library.read(notKept?.publication.session_id ?? "", notKept?.publication.id ?? ""),
      "a page that was not kept",
    ).rejects.toThrow(refusal);
    const [one, other] = kept;
    expect(other, "two kept apps, in two sessions").toBeDefined();
    expect(one?.publication.session_id).not.toBe(other?.publication.session_id);
    await expect(
      library.read(other?.publication.session_id ?? "", one?.publication.id ?? ""),
      "a kept page asked under another session",
    ).rejects.toThrow(refusal);
  });
});
