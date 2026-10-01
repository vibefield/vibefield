import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DeviceInfo,
  type IndexCatalogProject,
  type IndexCatalogSession,
  IndexProjectsResult,
  type IndexSearchResult,
  IndexSearchResult as IndexSearchResultSchema,
  IndexSessionsResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogTable, createRowsPump } from "../src/catalog-rows";
import type { IndexCatalog } from "../src/index-catalog";
import { IndexMesh, type MeshLink, type MeshRoster } from "../src/index-mesh";
import { RpcCallError } from "../src/native-link";

// DS-6 — the aggregator (index-mesh.ts) over in-memory sources: each "desktop"
// is a pair of CatalogTables served through the real rows pump, the link a
// fake that delivers the pump's frames the way FielddClient does (the frames
// that follow the reply reach the listener BEFORE the caller holds the open
// answer). The two-daemon witness over real sockets is index-mesh.e2e.test.ts;
// this file pins the rules: the merge (one row per {agent kind, native id},
// every holder named), the keyset pages, the family filter, asleep-is-a-state
// with a persisted replica, search by asking merged by time with an honest
// `sources`, the change pings, a digest that disagrees resetting the copy.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const until = async (predicate: () => boolean, timeoutMs = 3_000, what = "condition") => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const session = (
  device: string,
  id: string,
  lastAt: number | null,
  over: Partial<IndexCatalogSession> = {},
): IndexCatalogSession => ({
  device,
  sessionId: id,
  nativeSessionId: `nat-${id}`,
  kind: "claude-code",
  projectId: "p-app",
  title: `title ${id}`,
  activity: lastAt === null ? null : { firstAt: 1, lastAt },
  streamState: "indexed",
  ...over,
});

const project = (
  device: string,
  id: string,
  family: string | undefined,
  lastActivityAt: number | undefined,
): IndexCatalogProject => ({
  device,
  projectId: id,
  name: id,
  rootPaths: [`/work/${id}`],
  ...(family !== undefined ? { family } : {}),
  sessionCount: 1,
  ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
});

/** One desktop's catalog, as a source. */
function desktop(device: string, epoch = `${device}-boot-1`) {
  const projects = new CatalogTable<IndexCatalogProject>({
    epoch,
    keyOf: (row) => row.projectId,
  });
  const sessions = new CatalogTable<IndexCatalogSession>({
    epoch,
    keyOf: (row) => row.sessionId,
  });
  const events = new EventEmitter();
  const local = Object.assign(events, {
    projects,
    sessions,
    ready: true,
    phase: "live",
    heardAt: Date.now(),
    table: (name: string) => (name === "projects" ? projects : sessions),
  });
  return { device, projects, sessions, local: local as unknown as IndexCatalog };
}

type Desktop = ReturnType<typeof desktop>;

interface Behaviour {
  /** how the desktop's door answers a search, or why it does not */
  search?: IndexSearchResult | "asleep" | "hang" | "incompatible";
  /** refuse the catalog door (another build) */
  refuseCatalog?: boolean;
  digestIntervalMs?: number;
}

/** The fake link: serves each desktop's tables through the REAL pump and
 * hands over its frames the way FielddClient does — the frames that follow
 * the reply first, then the open answer as the subscribe's result. */
function link(desktops: Map<string, Desktop>, behaviour: Map<string, Behaviour>) {
  const subscribes: Array<{ device: string; params: Record<string, unknown> }> = [];
  const drops = new Map<string, Set<() => void>>();
  const pumps = new Map<string, Set<{ dispose: () => void }>>();
  const meshLink: MeshLink = {
    async subscribe(device, method, params, onEvent, onDrop) {
      expect(method).toBe("index.catalog.subscribe");
      const source = desktops.get(device);
      const how = behaviour.get(device) ?? {};
      if (source === undefined) {
        throw new RpcCallError("UNAVAILABLE", "peer unreachable", true, { device });
      }
      if (how.refuseCatalog === true) {
        throw new RpcCallError("NOT_FOUND", "method not found", false);
      }
      const ask = params as {
        table: "projects" | "sessions";
        since?: { epoch: string; revision: number };
      };
      subscribes.push({ device, params: ask as Record<string, unknown> });
      const pump =
        ask.table === "projects"
          ? createRowsPump({
              table: source.projects,
              since: ask.since,
              minIntervalMs: 16,
              digestIntervalMs: how.digestIntervalMs ?? 0,
              emit: (payload, kind) => onEvent(payload, kind),
            })
          : createRowsPump({
              table: source.sessions,
              since: ask.since,
              minIntervalMs: 16,
              digestIntervalMs: how.digestIntervalMs ?? 0,
              emit: (payload, kind) => onEvent(payload, kind),
            });
      // FielddClient's order: the continuation frames reach the listener in
      // the same tick as the reply, before the awaiting caller resumes
      pump.start();
      let live = pumps.get(device);
      if (live === undefined) {
        live = new Set();
        pumps.set(device, live);
      }
      live.add(pump);
      let set = drops.get(device);
      if (set === undefined) {
        set = new Set();
        drops.set(device, set);
      }
      set.add(onDrop);
      return {
        snapshot: pump.open,
        unsubscribe: () => {
          pump.dispose();
          set?.delete(onDrop);
        },
      };
    },
    async request(device, method, params) {
      expect(method).toBe("index.search");
      expect((params as { scope?: string }).scope).toBe("local"); // never fans out twice
      const how = behaviour.get(device)?.search;
      if (how === undefined || how === "asleep") {
        throw new RpcCallError("UNAVAILABLE", "peer unreachable", true, {
          device,
          state: "unreachable",
        });
      }
      if (how === "incompatible") throw new RpcCallError("INCOMPATIBLE", "major", false);
      if (how === "hang") return await new Promise(() => {});
      return how;
    },
    linkState: () => undefined,
  };
  return {
    meshLink,
    subscribes,
    /** the link under a device dies (what PeerLink's dropLink does: the
     * client closes, so its pumps stop, and every owner hears onDrop once) */
    drop(device: string) {
      for (const pump of [...(pumps.get(device) ?? [])]) pump.dispose();
      pumps.get(device)?.clear();
      for (const fn of [...(drops.get(device) ?? [])]) fn();
      drops.get(device)?.clear();
    },
  };
}

function roster(self: string, peers: Array<{ deviceId: string; online: boolean; name?: string }>) {
  const events = new EventEmitter();
  let list: DeviceInfo[] = [];
  const set = (next: typeof peers) => {
    list = [
      { deviceId: self, name: `${self}-name`, self: true, online: true, lastSeenAt: 1 },
      ...next.map((peer) => ({
        deviceId: peer.deviceId,
        name: peer.name ?? `${peer.deviceId}-name`,
        self: false,
        online: peer.online,
        lastSeenAt: 1,
      })),
    ];
    events.emit("changed", list);
  };
  set(peers);
  const meshRoster: MeshRoster = Object.assign(events, {
    list: () => list,
    currentDeviceId: () => self,
  });
  return { meshRoster, set };
}

function mesh(opts: {
  self: Desktop;
  desktops: Desktop[];
  peers: Array<{ deviceId: string; online: boolean }>;
  behaviour?: Map<string, Behaviour>;
  dir?: string;
  localSearch?: IndexSearchResult;
}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "vf-ixm-"));
  if (opts.dir === undefined) cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const behaviour = opts.behaviour ?? new Map();
  const wire = link(new Map(opts.desktops.map((d) => [d.device, d])), behaviour);
  const people = roster(opts.self.device, opts.peers);
  const aggregator = new IndexMesh({
    local: opts.self.local,
    roster: people.meshRoster,
    link: wire.meshLink,
    searchLocal: async () =>
      opts.localSearch ?? {
        answered: true,
        state: { readiness: "ready" },
        hits: [],
        clipped: false,
      },
    dir,
    searchTimeoutMs: 150,
    staleAfterMs: 400,
    persistIntervalMs: 20,
    retryMinMs: 30,
    retryMaxMs: 120,
    changesMinIntervalMs: 20,
  });
  cleanup.push(() => aggregator.dispose());
  aggregator.start();
  return { aggregator, wire, people, dir };
}

describe("IndexMesh — the merged replica (DS-6)", () => {
  it("one row per {agent kind, native session id}, every holder named; keyset pages never repeat or skip", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    a.sessions.upsert([
      session("dev-a", "a1", 900),
      session("dev-a", "a2", 500),
      // the same conversation B holds — older here
      session("dev-a", "a-shared", 300, { nativeSessionId: "nat-shared" }),
      // same native id, ANOTHER agent kind: not the same conversation
      session("dev-a", "a-codex", 200, { nativeSessionId: "nat-shared", kind: "codex" }),
    ]);
    b.sessions.upsert([
      session("dev-b", "b1", 800),
      session("dev-b", "b-shared", 700, { nativeSessionId: "nat-shared" }),
      // no activity yet: sorts last
      session("dev-b", "b-pending", null),
    ]);
    const { aggregator } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
    });
    await until(() => aggregator.replica("dev-b")?.sessions.length === 3, 3_000, "B's replica");

    const all: Array<{
      sessionId: string;
      device?: string | undefined;
      devices?: string[] | undefined;
    }> = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = IndexSessionsResult.parse(
        aggregator.sessions({
          scope: "mesh",
          limit: 2,
          ...(cursor !== undefined ? { cursor } : {}),
        }),
      );
      all.push(...page.rows);
      cursor = page.cursor;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    expect(all.map((row) => row.sessionId)).toEqual([
      "a1", // 900
      "b1", // 800
      "b-shared", // 700 — speaks for nat-shared: the newest member
      "a2", // 500
      "a-codex", // 200 — codex's nat-shared is its own conversation
      "b-pending", // no activity: last
    ]);
    const shared = all.find((row) => row.sessionId === "b-shared");
    expect(shared?.device).toBe("dev-b");
    expect(shared?.devices).toEqual(["dev-b", "dev-a"]); // the owner first, then the rest
    expect(all.find((row) => row.sessionId === "a1")?.devices).toEqual(["dev-a"]);
    expect(pages).toBe(3);

    // local scope: this desktop's rows only — no peer row may speak there
    const local = aggregator.sessions({ scope: "local", limit: 50 });
    expect(local.rows.map((row) => row.sessionId)).toEqual(["a1", "a2", "a-shared", "a-codex"]);
    expect(local.rows.find((row) => row.sessionId === "a-shared")?.devices).toEqual(["dev-a"]);
    expect(local.sources?.map((source) => source.device)).toEqual(["dev-a"]);
  });

  it("groups by repository family across desktops; projects page by keyset; devices narrow", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    a.projects.upsert([
      project("dev-a", "pa-app", "github.com/o/app", 900),
      project("dev-a", "pa-scratch", undefined, 100),
    ]);
    a.sessions.upsert([
      session("dev-a", "a1", 900, { projectId: "pa-app" }),
      session("dev-a", "a2", 100, { projectId: "pa-scratch" }),
    ]);
    b.projects.upsert([project("dev-b", "pb-app", "github.com/o/app", 950)]);
    b.sessions.upsert([session("dev-b", "b1", 950, { projectId: "pb-app" })]);
    const { aggregator } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
    });
    await until(() => aggregator.replica("dev-b")?.projects.length === 1, 3_000, "B's projects");

    const projects = IndexProjectsResult.parse(aggregator.projects({ scope: "mesh" }));
    expect(projects.rows.map((row) => [row.device, row.projectId])).toEqual([
      ["dev-b", "pb-app"],
      ["dev-a", "pa-app"],
      ["dev-a", "pa-scratch"],
    ]);
    const family = aggregator.projects({ scope: "mesh", family: "github.com/o/app", limit: 1 });
    expect(family.rows.map((row) => row.projectId)).toEqual(["pb-app"]);
    const second = aggregator.projects({
      scope: "mesh",
      family: "github.com/o/app",
      limit: 1,
      ...(family.cursor !== undefined ? { cursor: family.cursor } : {}),
    });
    expect(second.rows.map((row) => row.projectId)).toEqual(["pa-app"]);
    expect(second.cursor).toBeUndefined();

    const grouped = aggregator.sessions({ scope: "mesh", family: "github.com/o/app" });
    expect(grouped.rows.map((row) => [row.device, row.sessionId, row.family])).toEqual([
      ["dev-b", "b1", "github.com/o/app"],
      ["dev-a", "a1", "github.com/o/app"],
    ]);
    const onlyB = aggregator.sessions({ scope: "mesh", devices: ["dev-b"] });
    expect(onlyB.rows.map((row) => row.sessionId)).toEqual(["b1"]);
    expect(onlyB.sources?.map((source) => source.device)).toEqual(["dev-b"]);
    const byProject = aggregator.sessions({ scope: "mesh", projectId: "pa-scratch" });
    expect(byProject.rows.map((row) => row.sessionId)).toEqual(["a2"]);
    expect(() => aggregator.sessions({ scope: "mesh", cursor: "not-ours" })).toThrow(
      /cursor is not one this door issued/,
    );
  });

  it("asleep is a state: a peer that leaves keeps its rows, persisted — a new aggregator lists them before anyone answers", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    b.sessions.upsert([session("dev-b", "b1", 800), session("dev-b", "b2", 700)]);
    const first = mesh({ self: a, desktops: [a, b], peers: [{ deviceId: "dev-b", online: true }] });
    await until(
      () => first.aggregator.replica("dev-b")?.sessions.length === 2,
      3_000,
      "B's replica",
    );
    expect(first.aggregator.sessions({ scope: "mesh" }).sources).toMatchObject([
      { device: "dev-a", self: true, state: "live" },
      { device: "dev-b", self: false, state: "live", rows: 2 },
    ]);
    const file = join(first.dir, "dev-b.sessions.json");
    await until(() => existsSync(file), 3_000, "the replica on disk");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      format: 1,
      device: "dev-b",
      table: "sessions",
      epoch: "dev-b-boot-1",
    });

    // B leaves the roster's online set: its rows stay, greyed
    first.people.set([{ deviceId: "dev-b", online: false }]);
    const asleep = first.aggregator.sessions({ scope: "mesh" });
    expect(asleep.rows.map((row) => row.sessionId)).toEqual(["b1", "b2"]);
    expect(asleep.sources?.find((source) => source.device === "dev-b")).toMatchObject({
      state: "asleep",
      rows: 2,
    });
    first.aggregator.dispose();

    // a fresh aggregator over the same directory, B unreachable: still listed
    const second = mesh({
      self: a,
      desktops: [a],
      peers: [{ deviceId: "dev-b", online: false }],
      dir: first.dir,
    });
    const kept = second.aggregator.sessions({ scope: "mesh" });
    expect(kept.rows.map((row) => row.sessionId)).toEqual(["b1", "b2"]);
    expect(kept.sources?.find((source) => source.device === "dev-b")).toMatchObject({
      state: "asleep",
      rows: 2,
    });
    expect(kept.sources?.find((source) => source.device === "dev-b")?.asOf).toMatch(/Z$/);
  });

  it("a kept cursor resumes after a link death; a new epoch REPLACES the copy", async () => {
    const a = desktop("dev-a");
    let b = desktop("dev-b");
    b.sessions.upsert([session("dev-b", "b1", 800)]);
    const desktops = new Map([
      ["dev-a", a],
      ["dev-b", b],
    ]);
    const behaviour = new Map<string, Behaviour>();
    const dir = mkdtempSync(join(tmpdir(), "vf-ixm-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const wire = link(desktops, behaviour);
    const people = roster("dev-a", [{ deviceId: "dev-b", online: true }]);
    const aggregator = new IndexMesh({
      local: a.local,
      roster: people.meshRoster,
      link: wire.meshLink,
      searchLocal: async () => ({
        answered: true,
        state: { readiness: "ready" },
        hits: [],
        clipped: false,
      }),
      dir,
      retryMinMs: 20,
      retryMaxMs: 60,
      persistIntervalMs: 10,
    });
    cleanup.push(() => aggregator.dispose());
    aggregator.start();
    await until(() => aggregator.replica("dev-b")?.sessions.length === 1, 3_000, "B's replica");

    // the link dies while B moves on: the re-attach carries the KEPT cursor,
    // and the catch-up it resumes with is what brings b2
    const sessionAsks = () => wire.subscribes.filter((ask) => ask.params["table"] === "sessions");
    const before = sessionAsks().length;
    wire.drop("dev-b");
    b.sessions.upsert([session("dev-b", "b2", 900)]);
    await until(() => aggregator.replica("dev-b")?.sessions.length === 2, 3_000, "the catch-up");
    expect(sessionAsks().length).toBe(before + 1);
    expect(sessionAsks().at(-1)?.params["since"]).toEqual({ epoch: "dev-b-boot-1", revision: 1 });

    // B restarts: a new epoch — the reader's copy is REPLACED, not merged
    b = desktop("dev-b", "dev-b-boot-2");
    b.sessions.upsert([session("dev-b", "b9", 100)]);
    desktops.set("dev-b", b);
    wire.drop("dev-b");
    await until(
      () =>
        aggregator
          .replica("dev-b")
          ?.sessions.map((row) => row.sessionId)
          .join() === "b9",
      3_000,
      "the reset",
    );
  });
});

describe("IndexMesh — search by asking (DS-D8)", () => {
  const answer = (
    hits: Array<{ at: number; id: string }>,
    over: Partial<IndexSearchResult> = {},
  ): IndexSearchResult => ({
    answered: true,
    state: { readiness: "ready" },
    hits: hits.map((hit) => ({
      sessionId: hit.id,
      timelineId: `tl-${hit.id}`,
      kind: "agent",
      at: hit.at,
      snippet: `[needle] ${hit.id}`,
    })),
    clipped: false,
    ...over,
  });

  it("asks every known desktop, merges BY TIME, and says who answered — an asleep desktop is never 'nothing found'", async () => {
    const a = desktop("dev-a");
    const behaviour = new Map<string, Behaviour>([
      [
        "dev-b",
        {
          search: answer([
            { at: 500, id: "b1" },
            { at: 50, id: "b2" },
          ]),
        },
      ],
      ["dev-c", { search: "asleep" }],
      ["dev-d", { search: "hang" }],
      ["dev-e", { search: answer([], { answered: false, state: { readiness: "building" } }) }],
      ["dev-f", { search: "incompatible" }],
    ]);
    const { aggregator } = mesh({
      self: a,
      desktops: [a],
      peers: [
        { deviceId: "dev-b", online: true },
        { deviceId: "dev-c", online: true },
        { deviceId: "dev-d", online: true },
        { deviceId: "dev-e", online: true },
        { deviceId: "dev-f", online: true },
        { deviceId: "dev-g", online: false },
      ],
      behaviour,
      localSearch: answer([{ at: 300, id: "a1" }]),
    });
    const result = IndexSearchResultSchema.parse(
      await aggregator.search({ q: "needle", scope: "mesh" }),
    );
    expect(result.hits.map((hit) => [hit.device, hit.sessionId])).toEqual([
      ["dev-b", "b1"], // 500
      ["dev-a", "a1"], // 300
      ["dev-b", "b2"], // 50
    ]);
    const states = Object.fromEntries(
      (result.sources ?? []).map((source) => [source.device, source.state]),
    );
    expect(states).toEqual({
      "dev-a": "answered",
      "dev-b": "answered",
      "dev-c": "asleep", // the door did not answer
      "dev-d": "timeout", // asked, silent past the budget
      "dev-e": "building", // answered that it has no answer yet
      "dev-f": "incompatible",
      "dev-g": "asleep", // the roster says it is away: not asked at all
    });
    expect(result.sources?.find((source) => source.device === "dev-g")?.tookMs).toBe(0);
    expect(result.answered).toBe(true);
    expect(result.clipped).toBe(false);
  });

  it("the merged answer clips at the limit and says so; `devices` narrows who is asked", async () => {
    const a = desktop("dev-a");
    const behaviour = new Map<string, Behaviour>([
      [
        "dev-b",
        {
          search: answer([
            { at: 500, id: "b1" },
            { at: 400, id: "b2" },
          ]),
        },
      ],
    ]);
    const { aggregator } = mesh({
      self: a,
      desktops: [a],
      peers: [{ deviceId: "dev-b", online: true }],
      behaviour,
      localSearch: answer([{ at: 450, id: "a1" }]),
    });
    const clipped = await aggregator.search({ q: "needle", scope: "mesh", limit: 2 });
    expect(clipped.hits.map((hit) => hit.sessionId)).toEqual(["b1", "a1"]);
    expect(clipped.clipped).toBe(true);
    const onlyB = await aggregator.search({ q: "needle", scope: "mesh", devices: ["dev-b"] });
    expect(onlyB.sources?.map((source) => source.device)).toEqual(["dev-b"]);
    expect(onlyB.hits.every((hit) => hit.device === "dev-b")).toBe(true);
  });
});

describe("IndexMesh — the change pings", () => {
  it("a mesh page hears a peer's rows move; a local page hears only its own", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    const { aggregator } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
    });
    await until(() => aggregator.replica("dev-b") !== undefined, 3_000, "B known");
    const meshPings: unknown[] = [];
    const localPings: unknown[] = [];
    const meshSub = aggregator.changes({ scope: "mesh" }, (payload) => meshPings.push(payload));
    const localSub = aggregator.changes({ scope: "local" }, (payload) => localPings.push(payload));
    expect(meshSub.open).toMatchObject({ snapshot: { rows: [] } });
    meshSub.start();
    localSub.start();
    cleanup.push(() => meshSub.dispose());
    cleanup.push(() => localSub.dispose());

    b.sessions.upsert([session("dev-b", "b1", 10)]);
    await until(() => meshPings.length > 0, 3_000, "the mesh ping");
    expect(meshPings.at(-1)).toMatchObject({
      upserts: [],
      removed: [],
      tables: ["sessions"],
      devices: ["dev-b"],
    });
    expect(localPings).toHaveLength(0);

    a.sessions.upsert([session("dev-a", "a1", 10)]);
    await until(() => localPings.length > 0, 3_000, "the local ping");
    const ping = localPings.at(-1) as { since: number; revision: number };
    expect(ping.revision).toBeGreaterThan(ping.since);
  });
});
