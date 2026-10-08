import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DeviceInfo,
  type DeviceState,
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
function desktop(device: string, epoch = `${device}-boot-1`, opts: { pageBytes?: number } = {}) {
  const projects = new CatalogTable<IndexCatalogProject>({
    epoch,
    keyOf: (row) => row.projectId,
    ...opts,
  });
  const sessions = new CatalogTable<IndexCatalogSession>({
    epoch,
    keyOf: (row) => row.sessionId,
    ...opts,
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
  /** how the desktop's door answers a search, or why it does not: `asleep` is
   * PeerLink's own failure (the call deadline, an unreachable node), `timeout`
   * the owner's door saying its own work timed out, `not-ready` its door
   * answering UNAVAILABLE about its own daemon */
  search?: IndexSearchResult | "asleep" | "hang" | "incompatible" | "timeout" | "not-ready";
  /** refuse the catalog door (another build) */
  refuseCatalog?: boolean;
  /** S3 — the door answers UNAVAILABLE {service: "index"}: a desktop that
   * restarted and whose catalog has not read the index yet */
  catalogNotReady?: boolean;
  digestIntervalMs?: number;
  /** DS-6b — the NEXT subscribe to this table that asks for a snapshot (no
   * cursor) is cut mid-transfer: the open answer and `afterPages` more pages
   * arrive, then the link under it dies. One cut, then it is spent. */
  cutReset?: { table: "projects" | "sessions"; afterPages: number };
}

/** The fake link: serves each desktop's tables through the REAL pump and
 * hands over its frames the way FielddClient does — the frames that follow
 * the reply first, then the open answer as the subscribe's result. */
function link(desktops: Map<string, Desktop>, behaviour: Map<string, Behaviour>) {
  const subscribes: Array<{
    device: string;
    params: Record<string, unknown>;
    /** what a socket blip's replay of this subscription would ask with */
    replay: (() => unknown) | undefined;
  }> = [];
  const refused: Array<{ device: string; params: Record<string, unknown> }> = [];
  /** DS-6b — what a socket blip's replay would have asked at each cut */
  const cutReplays: unknown[] = [];
  const drops = new Map<string, Set<() => void>>();
  const pumps = new Map<string, Set<{ dispose: () => void }>>();
  const meshLink: MeshLink = {
    async subscribe(device, method, params, onEvent, onDrop, opts) {
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
      if (how.catalogNotReady === true) {
        refused.push({ device, params: ask as Record<string, unknown> });
        throw new RpcCallError(
          "UNAVAILABLE",
          "the history catalog has not read the index yet",
          true,
          {
            service: "index",
            state: "waiting",
          },
        );
      }
      subscribes.push({ device, params: ask as Record<string, unknown>, replay: opts?.params });
      const cut =
        how.cutReset !== undefined && how.cutReset.table === ask.table && ask.since === undefined
          ? how.cutReset.afterPages
          : undefined;
      if (cut !== undefined) delete how.cutReset; // one cut, then spent
      let forwarded = 0;
      const deliver = (payload: unknown, kind: "delta" | "snapshot") => {
        if (cut !== undefined && forwarded >= cut) return; // the transfer died here
        forwarded += 1;
        onEvent(payload, kind);
      };
      const pump =
        ask.table === "projects"
          ? createRowsPump({
              table: source.projects,
              since: ask.since,
              minIntervalMs: 16,
              digestIntervalMs: how.digestIntervalMs ?? 0,
              emit: deliver,
            })
          : createRowsPump({
              table: source.sessions,
              since: ask.since,
              minIntervalMs: 16,
              digestIntervalMs: how.digestIntervalMs ?? 0,
              emit: deliver,
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
      if (cut !== undefined) {
        // the link under THIS subscription dies once its owner holds the open
        // answer: the pages that did not arrive never will
        setTimeout(() => {
          cutReplays.push(opts?.params?.());
          pump.dispose();
          live?.delete(pump);
          if (set?.delete(onDrop) === true) onDrop();
        }, 0);
      }
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
        // PeerLink's own words, as every one of its sites says them since fx1
        throw new RpcCallError("UNAVAILABLE", "peer call timed out", true, {
          service: "peer-link",
          device,
          state: "unreachable",
        });
      }
      if (how === "timeout") throw new RpcCallError("TIMEOUT", "the search timed out", true);
      if (how === "not-ready") {
        throw new RpcCallError("UNAVAILABLE", "the daemon is starting", true, {
          service: "fieldd",
          state: "starting",
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
    refused,
    cutReplays,
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

function roster(
  self: string,
  peers: Array<{ deviceId: string; online: boolean; name?: string; state?: DeviceState }>,
) {
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
        // DS-L8/L9 — the roster's own state, when a row says one (deviceState)
        ...(peer.state !== undefined ? { state: peer.state } : {}),
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
  peers: Array<{ deviceId: string; online: boolean; state?: DeviceState }>;
  behaviour?: Map<string, Behaviour>;
  dir?: string;
  localSearch?: IndexSearchResult;
  now?: () => number;
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
    ...(opts.now !== undefined ? { now: opts.now } : {}),
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

  it("PJ-1: reads a peer's places tolerantly — an older row lacks them, a bad place is dropped, never the row; no door answers them", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    const sha = "a".repeat(40);
    const good = {
      placeId: "pl_good",
      path: "/work/pb-app",
      aliases: [],
      kind: "project" as const,
      caseless: true,
      exists: true,
      mounted: true,
      git: true,
      remotes: ["github.com/o/app"],
      identityRemote: "github.com/o/app",
      root: sha,
      samples: [{ sha, depth: 0 }],
      hits: [],
      observedAt: 5,
      someday: "a field a newer peer adds rides along",
    };
    const forged = { ...good, placeId: "pl_forged", samples: [{ sha: "--output=/x", depth: 0 }] };
    b.projects.upsert([
      // raw rows as a peer's wire could carry them (the replica parses them)
      {
        ...project("dev-b", "pb-app", "github.com/o/app", 950),
        places: [good, forged, 42] as unknown as IndexCatalogProject["places"],
      },
      // an older peer's row: no places at all
      project("dev-b", "pb-old", undefined, 900),
      {
        ...project("dev-b", "pb-junk", undefined, 800),
        places: "not a list" as unknown as IndexCatalogProject["places"],
      },
    ]);
    a.projects.upsert([
      {
        ...project("dev-a", "pa-app", "github.com/o/app", 990),
        places: [{ ...good, placeId: "pl_mine" }],
      },
    ]);
    const { aggregator } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
    });
    await until(() => aggregator.replica("dev-b")?.projects.length === 3, 3_000, "B's projects");
    // every row stays — the bad places cost their row nothing
    expect(
      aggregator
        .replica("dev-b")
        ?.projects.map((row) => row.projectId)
        .sort(),
    ).toEqual(["pb-app", "pb-junk", "pb-old"]);
    // only the PEERS' places, only the readable ones, unknown fields kept
    const places = aggregator.peerPlaces();
    expect(places).toEqual([{ device: "dev-b", projectId: "pb-app", places: [good] }]);
    // the doors list the rows without their places (PJ-3 owns what crosses)
    const listed = IndexProjectsResult.parse(aggregator.projects({ scope: "mesh" }));
    expect(listed.rows.map((row) => row.projectId)).toEqual([
      "pa-app",
      "pb-app",
      "pb-old",
      "pb-junk",
    ]);
    expect(listed.rows.every((row) => !("places" in row))).toBe(true);
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

  it("DS-L9: a peer the roster calls incompatible — another published contracts major — is never asked, before any dial", async () => {
    // The link pins a peer only after a dial was refused; the roster knows from
    // the row's published major (deviceState) before anyone dials. One roster
    // truth (the landing fix-up, 2026-10-01): the replica never attaches, the
    // search never asks, and both say `incompatible`.
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    b.sessions.upsert([session("dev-b", "b1", 800)]);
    const { aggregator, wire } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true, state: "incompatible" }],
    });
    // every chance to attach wrongly: the replica's retry floor here is 30 ms
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(wire.subscribes.filter((ask) => ask.device === "dev-b")).toEqual([]);
    expect(aggregator.replica("dev-b")?.sessions ?? []).toEqual([]);
    const listed = aggregator
      .sessions({ scope: "mesh" })
      .sources?.find((source) => source.device === "dev-b");
    if (listed !== undefined) expect(listed.state).toBe("incompatible");
    const found = await aggregator.search({ q: "b1", scope: "mesh" });
    expect(found.sources?.find((source) => source.device === "dev-b")).toMatchObject({
      state: "incompatible",
      tookMs: 0,
    });
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

  it("S3: a restarted peer whose catalog answers UNAVAILABLE keeps the replica retrying on its backoff — rows kept, never incompatible — and every replay or re-attach asks from the CURRENT cursor", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    b.sessions.upsert([session("dev-b", "b1", 800)]);
    const behaviour = new Map<string, Behaviour>();
    const { aggregator, wire } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
      behaviour,
    });
    const sessionAsks = () => wire.subscribes.filter((ask) => ask.params["table"] === "sessions");
    const sessionRefusals = () => wire.refused.filter((ask) => ask.params["table"] === "sessions");
    const standingOfB = () =>
      aggregator.sessions({ scope: "mesh" }).sources?.find((source) => source.device === "dev-b")
        ?.state;
    await until(() => aggregator.replica("dev-b")?.sessions.length === 1, 3_000, "B's replica");
    expect(sessionAsks().at(-1)?.params["since"]).toBeUndefined(); // nothing to resume yet

    // B moves on and the copy follows: a socket blip's REPLAY now asks from
    // revision 2 — it used to re-send this attach's first params (no cursor)
    b.sessions.upsert([session("dev-b", "b2", 900)]);
    await until(() => aggregator.replica("dev-b")?.sessions.length === 2, 3_000, "the delta");
    expect(sessionAsks().at(-1)?.replay?.()).toMatchObject({
      table: "sessions",
      since: { epoch: "dev-b-boot-1", revision: 2 },
    });

    // B restarts and its catalog has not read the index yet: the replay it
    // refused reaches the replica as this subscription's onDrop (PeerLink's
    // S3 hand-off), and every re-attach on the backoff is refused UNAVAILABLE
    behaviour.set("dev-b", { catalogNotReady: true });
    wire.drop("dev-b");
    await until(() => sessionRefusals().length >= 3, 3_000, "three refusals on the backoff");
    expect(standingOfB()).toBe("stale"); // not incompatible: asked again, and again
    expect(
      aggregator
        .replica("dev-b")
        ?.sessions.map((row) => row.sessionId)
        .sort(),
    ).toEqual(["b1", "b2"]); // asleep or restarting, its rows stay (DS-L8)
    expect(sessionRefusals().every((ask) => ask.params["since"] !== undefined)).toBe(true);

    // ready: the next attempt is served, from the cursor the copy holds
    const served = sessionAsks().length;
    behaviour.set("dev-b", {});
    await until(() => sessionAsks().length > served, 3_000, "the re-attach");
    expect(sessionAsks().at(-1)?.params["since"]).toEqual({ epoch: "dev-b-boot-1", revision: 2 });
    await until(() => standingOfB() === "live", 3_000, "live again");
  });

  // DS-6b (2026-10-01) — the landing review's DS-6 list: `forceReset` was
  // cleared when the reset's subscribe LEFT, so a link that died mid-transfer
  // re-attached from the drifted cursor; the copy kept the half snapshot, which
  // then held every frame of the epoch — the digest included — and the replica
  // froze with the drift it was resetting to remove.
  it("DS-6b: an interrupted reset restarts FROM A RESET — never the drifted cursor — and the replica converges", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b", "dev-b-boot-1", { pageBytes: 700 });
    const rows = Array.from({ length: 12 }, (_, i) => session("dev-b", `b${i}`, 100 + i));
    b.sessions.upsert(rows);
    // A kept a copy at B's own cursor that DRIFTED: a ghost B no longer holds
    const dir = mkdtempSync(join(tmpdir(), "vf-ixm-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "dev-b.sessions.json"),
      JSON.stringify({
        format: 1,
        device: "dev-b",
        table: "sessions",
        heardAt: 1,
        epoch: "dev-b-boot-1",
        revision: b.sessions.revision,
        rows: [...rows, session("dev-b", "ghost", 1)],
      }),
    );
    expect(b.sessions.snapshotPages().length).toBeGreaterThan(3);
    // the digest catches the ghost; the reset that follows is cut after one page
    const behaviour = new Map<string, Behaviour>([
      ["dev-b", { digestIntervalMs: 40, cutReset: { table: "sessions", afterPages: 1 } }],
    ]);
    const { aggregator, wire } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
      behaviour,
      dir,
    });
    const sessionAsks = () => wire.subscribes.filter((ask) => ask.params["table"] === "sessions");
    const held = () =>
      (aggregator.replica("dev-b")?.sessions ?? []).map((row) => row.sessionId).sort();
    await until(() => sessionAsks().length >= 3, 3_000, "the reset, its cut, and the next ask");
    expect(sessionAsks()[0]?.params["since"]).toEqual({ epoch: "dev-b-boot-1", revision: 1 });
    expect(sessionAsks()[1]?.params["since"]).toBeUndefined(); // the reset the digest asked for
    // the transfer died: the next ask is a reset again, never the drifted cursor
    expect(sessionAsks()[2]?.params["since"]).toBeUndefined();
    // …and so is what a socket blip's replay (S3's supplier) asked mid-transfer
    expect(wire.cutReplays).toHaveLength(1);
    expect(wire.cutReplays[0]).toMatchObject({ table: "sessions" });
    expect(wire.cutReplays[0]).not.toHaveProperty("since");
    await until(() => !held().includes("ghost"), 3_000, "the reset landing");
    expect(held()).toEqual(rows.map((row) => row.sessionId).sort());

    // landed: the reset is spent, and the next re-attach resumes the new cursor
    const before = sessionAsks().length;
    wire.drop("dev-b");
    await until(() => sessionAsks().length > before, 3_000, "the re-attach");
    expect(sessionAsks().at(-1)?.params["since"]).toEqual({
      epoch: "dev-b-boot-1",
      revision: b.sessions.revision,
    });
  });

  // DS-6b — a row the replica could not read was dropped with its KEY, so the
  // replica's digest disagreed with B's at every heartbeat: a reset, the whole
  // table again, the same row dropped again — per peer per minute.
  it("DS-6b: a row the replica cannot read keeps its key — the digest agrees, nothing resets, and a restart keeps agreeing", async () => {
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    const unreadable = { ...session("dev-b", "odd", 300), streamState: 42 };
    b.sessions.upsert([session("dev-b", "b1", 800), unreadable as unknown as IndexCatalogSession]);
    const behaviour = new Map<string, Behaviour>([["dev-b", { digestIntervalMs: 30 }]]);
    const first = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
      behaviour,
    });
    const sessionAsks = () =>
      first.wire.subscribes.filter((ask) => ask.params["table"] === "sessions");
    await until(() => first.aggregator.replica("dev-b")?.sessions.length === 1, 3_000, "B's rows");
    await new Promise((resolve) => setTimeout(resolve, 300)); // ten heartbeats
    expect(sessionAsks()).toHaveLength(1); // no reset: the digests agree
    expect(first.aggregator.replica("dev-b")?.sessions.map((row) => row.sessionId)).toEqual(["b1"]);
    const file = join(first.dir, "dev-b.sessions.json");
    await until(
      () =>
        existsSync(file) &&
        (JSON.parse(readFileSync(file, "utf8")) as { unreadable?: unknown }).unreadable !==
          undefined,
      3_000,
      "the kept copy",
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ unreadable: ["odd"] });
    first.aggregator.dispose();

    // a fresh aggregator over the same directory resumes, and still agrees
    const second = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
      behaviour,
      dir: first.dir,
    });
    const resumed = () =>
      second.wire.subscribes.filter((ask) => ask.params["table"] === "sessions");
    await until(() => resumed().length === 1, 3_000, "the resume");
    expect(resumed()[0]?.params["since"]).toEqual({
      epoch: "dev-b-boot-1",
      revision: b.sessions.revision,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(resumed()).toHaveLength(1);
  });

  // DS-6b — dispose wrote only the tables with a write pending, so a replica
  // that had heard B since its last write (a heartbeat, no change) came back
  // after a restart with B's `asOf` as old as that write.
  it("DS-6b: dispose writes EVERY table — the kept `heardAt` is the last frame heard, not the last change", async () => {
    let clock = 1_000_000;
    const a = desktop("dev-a");
    const b = desktop("dev-b");
    b.sessions.upsert([session("dev-b", "b1", 800)]);
    const { aggregator, dir } = mesh({
      self: a,
      desktops: [a, b],
      peers: [{ deviceId: "dev-b", online: true }],
      behaviour: new Map([["dev-b", { digestIntervalMs: 30 }]]),
      now: () => clock,
    });
    const kept = (table: string) =>
      JSON.parse(readFileSync(join(dir, `dev-b.${table}.json`), "utf8")) as { heardAt: number };
    const written = (table: string) => existsSync(join(dir, `dev-b.${table}.json`));
    await until(() => written("sessions") && written("projects"), 3_000, "both tables kept");
    expect(kept("sessions").heardAt).toBe(1_000_000);
    // B is heard again — heartbeats only, nothing changes, nothing to write
    clock = 2_000_000;
    const asOfB = () =>
      aggregator.sourcesFor("sessions").find((source) => source.device === "dev-b")?.asOf;
    await until(() => asOfB() === new Date(2_000_000).toISOString(), 3_000, "a heartbeat heard");
    aggregator.dispose();
    expect(kept("sessions").heardAt).toBe(2_000_000);
    expect(kept("projects").heardAt).toBe(2_000_000);

    // …and a file already current is left alone: a replica that heard nothing
    // new this boot (B asleep) rewrites nothing at shutdown — every write is a
    // rename, so the same inode is the same file
    const inode = (table: string) => statSync(join(dir, `dev-b.${table}.json`)).ino;
    const before = { sessions: inode("sessions"), projects: inode("projects") };
    const quiet = mesh({
      self: a,
      desktops: [a],
      peers: [{ deviceId: "dev-b", online: false }],
      dir,
      now: () => clock,
    });
    expect(quiet.aggregator.replica("dev-b")?.sessions.map((row) => row.sessionId)).toEqual(["b1"]);
    quiet.aggregator.dispose();
    expect({ sessions: inode("sessions"), projects: inode("projects") }).toEqual(before);
  });

  it("DS-6b: a write that died midway leaves `<file>.<pid>.tmp` — start sweeps it, and nothing else", async () => {
    const a = desktop("dev-a");
    const dir = mkdtempSync(join(tmpdir(), "vf-ixm-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "dev-b.sessions.json.4242.tmp"), '{"partial":');
    writeFileSync(join(dir, `dev%2Fc.projects.json.${process.pid}.tmp`), "");
    writeFileSync(join(dir, "notes.tmp"), "not ours");
    mesh({ self: a, desktops: [a], peers: [], dir });
    expect(readdirSync(dir).sort()).toEqual(["notes.tmp"]);
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
      // asked, and the link failed while the roster calls it awake: no answer
      // — `asleep` here until DS-6b (2026-10-01): the error is not the state
      "dev-c": "timeout",
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

  // DS-6b (2026-10-01, the landing review's DS-6 list) — a retryable refusal or
  // a TIMEOUT read `asleep`: the ERROR was taken for the STATE. The roster says
  // whether a desktop is away; a desktop it calls awake or restarting that did
  // not answer is a `timeout`, and one whose door said "not ready" is building.
  it("DS-6b: the error is not the state — a refusal or a timeout reads what the roster says, never `asleep` for a desktop it calls awake or restarting", async () => {
    const a = desktop("dev-a");
    const behaviour = new Map<string, Behaviour>([
      ["dev-b", { search: "asleep" }], // the link failed (its deadline, the node's daemon gone)
      ["dev-c", { search: "timeout" }], // the owner said its own search timed out
      ["dev-d", { search: "not-ready" }], // the owner's door: its daemon is starting
      ["dev-e", { search: "asleep" }],
    ]);
    const { aggregator, people } = mesh({
      self: a,
      desktops: [a],
      peers: [
        { deviceId: "dev-b", online: true, state: "restarting" },
        { deviceId: "dev-c", online: true, state: "awake" },
        { deviceId: "dev-d", online: true, state: "awake" },
        { deviceId: "dev-e", online: true, state: "awake" },
      ],
      behaviour,
    });
    const result = IndexSearchResultSchema.parse(
      await aggregator.search({ q: "needle", scope: "mesh" }),
    );
    const byDevice = new Map((result.sources ?? []).map((source) => [source.device, source]));
    expect(byDevice.get("dev-b")).toMatchObject({ state: "timeout" });
    expect(byDevice.get("dev-b")?.detail).toMatch(/restarting/);
    expect(byDevice.get("dev-c")).toMatchObject({ state: "timeout" });
    expect(byDevice.get("dev-d")).toMatchObject({ state: "building" });
    expect(byDevice.get("dev-e")).toMatchObject({ state: "timeout" });

    // the replica's standing reads the roster too: a desktop whose door does
    // not answer while the roster calls it restarting is `stale`, not asleep
    expect(
      aggregator.sessions({ scope: "mesh" }).sources?.find((source) => source.device === "dev-b")
        ?.state,
    ).toBe("stale");

    // …and when the roster DOES say a desktop is away, that is what it reads
    people.set([
      { deviceId: "dev-b", online: false, state: "asleep" },
      { deviceId: "dev-c", online: true, state: "awake" },
      { deviceId: "dev-d", online: true, state: "awake" },
      { deviceId: "dev-e", online: true, state: "awake" },
    ]);
    const later = await aggregator.search({ q: "needle", scope: "mesh" });
    expect(later.sources?.find((source) => source.device === "dev-b")).toMatchObject({
      state: "asleep",
      tookMs: 0,
    });
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
