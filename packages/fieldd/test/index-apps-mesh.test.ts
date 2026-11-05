import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CallerContext,
  type DeviceInfo,
  type DeviceState,
  INDEX_MESH,
  INDEX_TAILNET_LIMITS,
  IndexAppsResult,
  type IndexCatalogApp,
  type IndexCatalogProject,
  type IndexCatalogSession,
  type IndexThread,
  MADE_APP_OPEN,
  madeAppFoldKey,
  type Principal,
  type RowsCursor,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogTable, createRowsPump } from "../src/catalog-rows";
import {
  type AppProjectJoin,
  type AppsLocalSource,
  AppsMesh,
  type MadeAppIntentReader,
} from "../src/index-apps-mesh";
import type { IndexCatalog } from "../src/index-catalog";
import { IndexMesh, type MeshLink, type MeshRoster } from "../src/index-mesh";
import { RpcCallError } from "../src/native-link";

// MA-3d — the made apps' aggregator (index-apps-mesh.ts) over in-memory owners: each "desktop" holds an `apps`
// CatalogTable served through the REAL rows pump, its owner's standing (`libraryReady`, `previewsBase`) stamped on
// every frame as contracts' OWNER_STANDING says, and the link a fake that hands frames over the way FielddClient
// does (the frames behind the reply reach the listener before the caller holds the open answer). The same fake
// serves `index.catalog.subscribe`, so a co-running IndexMesh stands in for the history replica beside it. This
// file pins the rules: one apps door per online peer, a refusal that costs that peer's apps alone, the persisted
// replica, asleep-is-a-state, the fold by contracts' fold key, the newest presentation serving, the merged intent,
// `q`, keyset pages, the tailnet clip, the standing in `sources`, the project join at the door, and the pings.
// The two-daemon witness is 3e's (index-apps.e2e.test.ts).
//
// RED (MA-3d, 2026-11-05): every row below fails BY ASSERTION on the skeleton, except the one named PIN.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A bounded wait that never throws: it answers whether the condition came true, and the row asserts on the
 * value it was waiting for (a red names the wrong value, never "timed out"). */
const settle = async (ready: () => boolean, ms = 3_000): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) return false;
    await sleep(10);
  }
  return true;
};

const tmpDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const hex = (seed: string): string => createHash("sha256").update(seed).digest("hex");

/** One app as its owner republishes it. */
function app(
  device: string,
  name: string,
  publishedAt: number | null,
  over: Partial<IndexCatalogApp> = {},
): IndexCatalogApp {
  return {
    device,
    appId: hex(`app:${device}:${name}`),
    presentationId: hex(`presentation:${device}:${name}`),
    title: `App ${name}`,
    filename: `${name}.html`,
    kind: "claude-code",
    sessionId: `ses-${device}-${name}`,
    timelineId: `tl-${name}`,
    versions: 1,
    ...(publishedAt !== null ? { publishedAt } : {}),
    availability: "captured",
    ...over,
  };
}

const session = (device: string, id: string, lastAt: number): IndexCatalogSession => ({
  device,
  sessionId: id,
  nativeSessionId: `nat-${id}`,
  kind: "claude-code",
  title: `title ${id}`,
  activity: { firstAt: 1, lastAt },
  streamState: "indexed",
});

const titles = (result: { rows: Array<{ title: string }> }): string[] =>
  result.rows.map((row) => row.title);

const ctxOf = (principal: Principal): CallerContext => ({
  principal,
  transport:
    principal.kind === "tailnet" || principal.kind === "peer-fieldd" ? "ws-tailnet" : "ws-loopback",
  receivedAt: 0,
});
const windowCtx = ctxOf({ kind: "local-token", tokenId: "tok-window", scopes: ["index.search"] });
const phoneCtx = ctxOf({ kind: "tailnet", login: "james@example.com", self: true });
const peerCtx = ctxOf({ kind: "peer-fieldd", deviceId: "dev-b" });

const dnsOf = (device: string) => `${device}.tail1234.ts.net`;
const baseOf = (device: string, port: number) => `https://${dnsOf(device)}:${port}/`;

/** The owner's standing, as every frame of its apps door declares it. */
interface Standing {
  libraryReady?: boolean;
  previewsBase?: string;
}

/** One desktop: its `apps` table, its history tables (for the IndexMesh stand-in), and its standing. */
interface Owner {
  device: string;
  apps: CatalogTable<IndexCatalogApp>;
  projects: CatalogTable<IndexCatalogProject>;
  sessions: CatalogTable<IndexCatalogSession>;
  threads: CatalogTable<IndexThread>;
  standing: Standing;
  /** the live apps subscriptions, told a standing change at once */
  sinks: Set<(payload: unknown) => void>;
}

function owner(device: string, standing?: Standing, epoch = `${device}-boot-1`): Owner {
  return {
    device,
    apps: new CatalogTable<IndexCatalogApp>({ epoch, keyOf: (row) => row.appId }),
    projects: new CatalogTable<IndexCatalogProject>({ epoch, keyOf: (row) => row.projectId }),
    sessions: new CatalogTable<IndexCatalogSession>({ epoch, keyOf: (row) => row.sessionId }),
    threads: new CatalogTable<IndexThread>({ epoch, keyOf: (row) => row.sessionId }),
    standing: standing ?? { libraryReady: true, previewsBase: baseOf(device, 14211) },
    sinks: new Set(),
  };
}

/** The owner's standing moved with no row: every live apps subscription hears it at once, on a frame with no rows
 * (the heartbeat's shape, which a copy applies as a no-op). */
function say(desk: Owner, standing: Standing): void {
  desk.standing = standing;
  const revision = desk.apps.revision;
  for (const sink of desk.sinks) {
    sink({
      epoch: desk.apps.epoch,
      since: revision,
      revision,
      upserts: [],
      removed: [],
      ...standing,
    });
  }
}

/** This desktop's IndexApps (3a), by its public face. */
class LocalApps extends EventEmitter implements AppsLocalSource {
  ready = true;
  libraryReady: boolean | undefined = true;
  previewsBase: string | undefined;
  heardAt: number | null = Date.now();
  constructor(readonly table: CatalogTable<IndexCatalogApp>) {
    super();
  }
  standing(): Standing {
    return {
      ...(this.libraryReady !== undefined ? { libraryReady: this.libraryReady } : {}),
      ...(this.previewsBase !== undefined ? { previewsBase: this.previewsBase } : {}),
    };
  }
  set(next: { ready?: boolean; libraryReady?: boolean }): void {
    if (next.ready !== undefined) this.ready = next.ready;
    if (next.libraryReady !== undefined) this.libraryReady = next.libraryReady;
    this.emit("changed");
  }
}

/** This desktop's history catalog, for the IndexMesh stand-in. */
function catalogOf(desk: Owner): IndexCatalog {
  const events = new EventEmitter();
  return Object.assign(events, {
    projects: desk.projects,
    sessions: desk.sessions,
    threads: desk.threads,
    ready: true,
    phase: "live",
    heardAt: Date.now(),
    table: (name: string) => (name === "projects" ? desk.projects : desk.sessions),
  }) as unknown as IndexCatalog;
}

interface Behaviour {
  /** the apps door is unknown to this peer (an older build): NOT_FOUND, not retryable */
  refuseApps?: boolean;
  /** the apps door answers UNAVAILABLE (its library not read yet) this many times first */
  appsNotReady?: number;
}

const APPS_DOOR = "index.apps.catalog.subscribe";
const HISTORY_DOOR = "index.catalog.subscribe";

/** The fake link: serves each owner's tables through the REAL pump and hands its frames over the way FielddClient
 * does — the frames that follow the reply first, then the open answer as the subscribe's result. */
function link(owners: Map<string, Owner>, behaviour: Map<string, Behaviour>) {
  const asks: Array<{
    device: string;
    method: string;
    params: Record<string, unknown>;
    replay: (() => unknown) | undefined;
  }> = [];
  const refusals: Array<{ device: string; method: string; kind: string }> = [];
  const drops = new Map<string, Set<() => void>>();
  const pumps = new Map<string, Set<{ dispose: () => void }>>();
  const meshLink: MeshLink = {
    async subscribe(device, method, params, onEvent, onDrop, opts) {
      const desk = owners.get(device);
      if (desk === undefined) {
        throw new RpcCallError("UNAVAILABLE", "peer call timed out", true, {
          service: "peer-link",
          device,
        });
      }
      const how = behaviour.get(device) ?? {};
      if (method === APPS_DOOR && how.refuseApps === true) {
        refusals.push({ device, method, kind: "NOT_FOUND" });
        throw new RpcCallError("NOT_FOUND", `method not found: ${method}`, false);
      }
      if (method === APPS_DOOR && (how.appsNotReady ?? 0) > 0) {
        how.appsNotReady = (how.appsNotReady ?? 0) - 1;
        refusals.push({ device, method, kind: "UNAVAILABLE" });
        throw new RpcCallError("UNAVAILABLE", "the apps library has not been read yet", true, {
          service: MADE_APP_OPEN.SERVICE,
          state: MADE_APP_OPEN.STATE_READING,
        });
      }
      if (method !== APPS_DOOR && method !== HISTORY_DOOR) {
        refusals.push({ device, method, kind: "NOT_FOUND" });
        throw new RpcCallError("NOT_FOUND", `method not found: ${method}`, false);
      }
      const ask = params as Record<string, unknown>;
      asks.push({ device, method, params: ask, replay: opts?.params });
      const since = ask["since"] as RowsCursor | undefined;
      let open: unknown;
      let pump: { open: unknown; start: () => void; dispose: () => void };
      let sink: ((payload: unknown) => void) | undefined;
      if (method === APPS_DOOR) {
        const stamp = (payload: unknown): unknown =>
          typeof payload === "object" && payload !== null
            ? { ...(payload as Record<string, unknown>), ...desk.standing }
            : payload;
        const apps = createRowsPump({
          table: desk.apps,
          since,
          minIntervalMs: 16,
          digestIntervalMs: 0,
          emit: (payload, kind) => onEvent(stamp(payload), kind),
        });
        open =
          "resumed" in apps.open
            ? { ...apps.open, ...desk.standing }
            : { snapshot: stamp(apps.open.snapshot) };
        pump = apps;
        sink = (payload) => onEvent(payload, "delta");
        desk.sinks.add(sink);
      } else {
        const follow = { since, minIntervalMs: 16, digestIntervalMs: 0, emit: onEvent };
        const history =
          ask["table"] === "projects"
            ? createRowsPump({ table: desk.projects, ...follow })
            : createRowsPump({ table: desk.sessions, ...follow });
        open = history.open;
        pump = history;
      }
      const stop = () => {
        pump.dispose();
        if (sink !== undefined) desk.sinks.delete(sink);
      };
      // FielddClient's order: the continuation frames reach the listener in the same tick as the reply, before
      // the awaiting caller resumes
      pump.start();
      let live = pumps.get(device);
      if (live === undefined) {
        live = new Set();
        pumps.set(device, live);
      }
      live.add({ dispose: stop });
      let set = drops.get(device);
      if (set === undefined) {
        set = new Set();
        drops.set(device, set);
      }
      set.add(onDrop);
      return {
        snapshot: open,
        unsubscribe: () => {
          stop();
          set?.delete(onDrop);
        },
      };
    },
    async request(_device, method) {
      throw new RpcCallError("NOT_FOUND", `no unary door in this fake: ${method}`, false);
    },
    linkState: () => undefined,
  };
  return {
    meshLink,
    asks,
    refusals,
    /** the link under a device dies: its pumps stop and every owner hears onDrop once */
    drop(device: string) {
      for (const pump of [...(pumps.get(device) ?? [])]) pump.dispose();
      pumps.get(device)?.clear();
      for (const fn of [...(drops.get(device) ?? [])]) fn();
      drops.get(device)?.clear();
    },
  };
}

interface PeerSpec {
  deviceId: string;
  online: boolean;
  /** the roster's AUTHENTICATED MagicDNS name (absent: no transport binding) */
  dns?: string;
  state?: DeviceState;
}

function roster(self: string, peers: PeerSpec[]) {
  const events = new EventEmitter();
  let list: DeviceInfo[] = [];
  const set = (next: PeerSpec[]) => {
    list = [
      { deviceId: self, name: `${self}-name`, self: true, online: true, lastSeenAt: 1 },
      ...next.map((peer) => ({
        deviceId: peer.deviceId,
        name: `${peer.deviceId}-name`,
        self: false,
        online: peer.online,
        lastSeenAt: 1,
        ...(peer.state !== undefined ? { state: peer.state } : {}),
        ...(peer.dns !== undefined ? { tailnetDnsName: peer.dns } : {}),
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

/** The link and the roster one daemon sees, shared by its AppsMesh and an IndexMesh stand-in. */
function world(
  self: string,
  owners: Owner[],
  peers: PeerSpec[],
  behaviour = new Map<string, Behaviour>(),
) {
  const wire = link(new Map(owners.map((desk) => [desk.device, desk])), behaviour);
  const people = roster(self, peers);
  return { wire, people, behaviour };
}
type World = ReturnType<typeof world>;

function appsMesh(
  w: World,
  self: Owner,
  opts: {
    dir?: string;
    local?: LocalApps;
    intents?: MadeAppIntentReader;
    joinProject?: (device: string, rootSessionId: string) => AppProjectJoin | undefined;
    exportReady?: (device: string) => boolean;
  } = {},
) {
  const dir = opts.dir ?? tmpDir("vf-apps-mesh-");
  const local = opts.local ?? new LocalApps(self.apps);
  const joins: Array<[string, string]> = [];
  const mesh = new AppsMesh({
    local,
    roster: w.people.meshRoster,
    link: w.wire.meshLink,
    dir,
    joinProject: (device, rootSessionId) => {
      joins.push([device, rootSessionId]);
      return opts.joinProject?.(device, rootSessionId);
    },
    ...(opts.intents !== undefined ? { intents: opts.intents } : {}),
    ...(opts.exportReady !== undefined ? { exportReady: opts.exportReady } : {}),
    staleAfterMs: 5_000,
    persistIntervalMs: 20,
    retryMinMs: 30,
    retryMaxMs: 120,
    changesMinIntervalMs: 20,
  });
  cleanup.push(() => mesh.dispose());
  mesh.start();
  return { mesh, local, dir, joins };
}

/** The history replica beside it (DS-6), over the same link and roster. */
function indexMesh(w: World, self: Owner): IndexMesh {
  const history = new IndexMesh({
    local: catalogOf(self),
    roster: w.people.meshRoster,
    link: w.wire.meshLink,
    searchLocal: async () => ({
      answered: true,
      state: { readiness: "ready" },
      hits: [],
      clipped: false,
    }),
    dir: tmpDir("vf-apps-history-"),
    staleAfterMs: 5_000,
    persistIntervalMs: 20,
    retryMinMs: 30,
    retryMaxMs: 120,
    changesMinIntervalMs: 20,
  });
  cleanup.push(() => history.dispose());
  history.start();
  return history;
}

/** A refusal a door threw, or undefined when it answered. */
function refusalOf(call: () => unknown): RpcCallError | undefined {
  try {
    call();
    return undefined;
  } catch (error) {
    return error as RpcCallError;
  }
}

/** The merged intent, by fold key, with its change listeners. */
function intentsOf(entries: Array<[string, { kept?: true; hidden?: true }]>) {
  const map = new Map(entries);
  const listeners = new Set<() => void>();
  const reader: MadeAppIntentReader = {
    of: (foldKey) => map.get(foldKey),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    reader,
    set(foldKey: string, intent: { kept?: true; hidden?: true } | undefined) {
      if (intent === undefined) map.delete(foldKey);
      else map.set(foldKey, intent);
      for (const listener of listeners) listener();
    },
  };
}

describe("AppsMesh — the replica (MA-3d)", () => {
  it("replicates each online self peer through ONE index.apps.catalog.subscribe at the replica floor; rows serve as their subscriber's (DS-L2); a row carrying a path is never listed (EL2)", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    const c = owner("dev-c");
    const d = owner("dev-d");
    b.apps.upsert([
      app("dev-b", "b1", 200),
      // DS-L2 — a row that claims another desktop is still B's
      { ...app("dev-b", "b-claims-c", 150), device: "dev-c" },
      // EL2 — a producer that spread rosetta's entry: refused by the contract, never listed
      {
        ...app("dev-b", "b-path", 100),
        path: "/Users/x/b-path.html",
      } as unknown as IndexCatalogApp,
    ]);
    c.apps.upsert([app("dev-c", "c1", 300)]);
    d.apps.upsert([app("dev-d", "d1", 400)]);
    const w = world(
      "dev-a",
      [a, b, c, d],
      [
        { deviceId: "dev-b", online: true },
        { deviceId: "dev-c", online: true },
        { deviceId: "dev-d", online: false },
      ],
    );
    const { mesh } = appsMesh(w, a);
    const settled = await settle(
      () => mesh.replica("dev-b")?.length === 2 && mesh.replica("dev-c")?.length === 1,
    );

    const page = mesh.list({ scope: "mesh" }, windowCtx);
    expect(titles(page), `both online peers' apps replicated (settled: ${settled})`).toEqual([
      "App c1",
      "App b1",
      "App b-claims-c",
    ]);
    expect(
      page.rows.find((row) => row.title === "App b-claims-c")?.device,
      "DS-L2: a replica row is served as the desktop it was subscribed from",
    ).toBe("dev-b");
    const asks = w.wire.asks.filter((ask) => ask.method === APPS_DOOR);
    expect(
      asks.map((ask) => ask.device).sort(),
      "one apps door per ONLINE self peer, never this desktop",
    ).toEqual(["dev-b", "dev-c"]);
    expect(
      asks.map((ask) => ask.params["minIntervalMs"]),
      "asked at the replica's floor (history is not a live fold)",
    ).toEqual([INDEX_MESH.REPLICA_MIN_INTERVAL_MS, INDEX_MESH.REPLICA_MIN_INTERVAL_MS]);
    expect(
      asks.filter((ask) => "table" in ask.params).length,
      "its own door names no table (L1)",
    ).toBe(0);
    expect(IndexAppsResult.safeParse(page).success, "the page is the contract's").toBe(true);
  });

  it("an older peer refusing the apps door marks ONLY its apps unsupported: its projects and sessions stay live beside, and it is not asked again until it returns", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    const c = owner("dev-c");
    b.sessions.upsert([session("dev-b", "s-b1", 500)]);
    b.apps.upsert([app("dev-b", "b1", 200)]);
    c.apps.upsert([app("dev-c", "c1", 300)]);
    const w = world(
      "dev-a",
      [a, b, c],
      [
        { deviceId: "dev-b", online: true },
        { deviceId: "dev-c", online: true },
      ],
      new Map([["dev-b", { refuseApps: true }]]),
    );
    const history = indexMesh(w, a);
    const { mesh } = appsMesh(w, a);
    const settled = await settle(
      () => history.replica("dev-b")?.sessions.length === 1 && mesh.replica("dev-c")?.length === 1,
    );

    const appsOfB = mesh.sources("mesh").find((source) => source.device === "dev-b");
    expect(appsOfB?.state, `B's apps read unsupported (DS-L9's state; settled: ${settled})`).toBe(
      "incompatible",
    );
    expect(appsOfB?.rows, "B lists no apps").toBe(0);
    expect(titles(mesh.list({ scope: "mesh" }, windowCtx)), "C's apps are still listed").toEqual([
      "App c1",
    ]);
    // the history replica beside it never hears of the refusal
    expect(
      history.sourcesFor("sessions").find((source) => source.device === "dev-b")?.state,
      "B's history stays live",
    ).toBe("live");
    expect(history.sessions({ scope: "mesh" }).rows.map((row) => row.sessionId)).toEqual(["s-b1"]);
    // a refusal that will not change is not asked again while the peer stays (the retry floor here is 30 ms)
    const refusedB = () =>
      w.wire.refusals.filter(
        (refusal) => refusal.device === "dev-b" && refusal.method === APPS_DOOR,
      ).length;
    await sleep(200);
    expect(refusedB(), "asked once while B stays").toBe(1);
    // B leaves and returns: asked once more
    w.people.set([
      { deviceId: "dev-b", online: false },
      { deviceId: "dev-c", online: true },
    ]);
    w.people.set([
      { deviceId: "dev-b", online: true },
      { deviceId: "dev-c", online: true },
    ]);
    const askedAgain = await settle(() => refusedB() === 2);
    expect(refusedB(), `asked again when B returns (settled: ${askedAgain})`).toBe(2);
  });

  it("a peer whose apps door is not ready yet (UNAVAILABLE, retryable) is asked again on the backoff, never marked unsupported, and its apps land", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    b.apps.upsert([app("dev-b", "b1", 200)]);
    const w = world(
      "dev-a",
      [a, b],
      [{ deviceId: "dev-b", online: true }],
      new Map([["dev-b", { appsNotReady: 2 }]]),
    );
    const { mesh } = appsMesh(w, a);
    const settled = await settle(() => mesh.replica("dev-b")?.length === 1);

    expect(
      titles(mesh.list({ scope: "mesh" }, windowCtx)),
      `B's app landed (settled: ${settled})`,
    ).toEqual(["App b1"]);
    expect(
      w.wire.refusals
        .filter((refusal) => refusal.device === "dev-b")
        .map((refusal) => refusal.kind),
      "two refusals, each retried",
    ).toEqual(["UNAVAILABLE", "UNAVAILABLE"]);
    expect(mesh.sources("mesh").find((source) => source.device === "dev-b")?.state).toBe("live");
  });

  it("a link death re-attaches from the copy's kept cursor, and a socket blip's replay asks from where the copy IS", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    b.apps.upsert([app("dev-b", "b1", 100)]);
    const w = world("dev-a", [a, b], [{ deviceId: "dev-b", online: true }]);
    const { mesh } = appsMesh(w, a);
    const first = await settle(() => mesh.replica("dev-b")?.length === 1);
    expect(
      mesh.replica("dev-b")?.map((row) => row.title),
      `B's first app replicated (settled: ${first})`,
    ).toEqual(["App b1"]);
    const asksOfB = () =>
      w.wire.asks.filter((ask) => ask.device === "dev-b" && ask.method === APPS_DOOR);
    expect(asksOfB()[0]?.params["since"], "the first attach has no cursor").toBeUndefined();

    b.apps.upsert([app("dev-b", "b2", 200)]);
    await settle(() => mesh.replica("dev-b")?.length === 2);
    const held = b.apps.revision;
    expect(asksOfB()[0]?.replay?.(), "a replay asks from the copy's CURRENT cursor").toMatchObject({
      since: { epoch: "dev-b-boot-1", revision: held },
    });

    w.wire.drop("dev-b");
    b.apps.upsert([app("dev-b", "b3", 300)]);
    const again = await settle(() => mesh.replica("dev-b")?.length === 3);
    expect(asksOfB().length, `re-attached once after the drop (settled: ${again})`).toBe(2);
    expect(asksOfB()[1]?.params["since"], "the re-attach resumes the kept cursor").toEqual({
      epoch: "dev-b-boot-1",
      revision: held,
    });
    expect(titles(mesh.list({ scope: "mesh" }, windowCtx))).toEqual(["App b3", "App b2", "App b1"]);
  });

  it("asleep is a state: a peer that leaves keeps its apps listed (DS-L8) and its source says asleep", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    b.apps.upsert([app("dev-b", "b1", 200), app("dev-b", "b2", 100)]);
    const w = world("dev-a", [a, b], [{ deviceId: "dev-b", online: true, dns: dnsOf("dev-b") }]);
    const { mesh } = appsMesh(w, a);
    const settled = await settle(() => mesh.replica("dev-b")?.length === 2);
    expect(
      titles(mesh.list({ scope: "mesh" }, windowCtx)),
      `B's apps replicated (settled: ${settled})`,
    ).toEqual(["App b1", "App b2"]);

    w.people.set([{ deviceId: "dev-b", online: false, dns: dnsOf("dev-b") }]);
    const asleep = mesh.list({ scope: "mesh" }, windowCtx);
    expect(titles(asleep), "an asleep desktop's apps stay listed").toEqual(["App b1", "App b2"]);
    expect(asleep.rows.map((row) => row.devices)).toEqual([["dev-b"], ["dev-b"]]);
    expect(asleep.sources.find((source) => source.device === "dev-b")).toMatchObject({
      self: false,
      state: "asleep",
      rows: 2,
    });
  });

  it("the replica persists at <dir>/<device>.json atomically, 0600, standing included; a new aggregator lists it before anyone answers", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b", { libraryReady: true, previewsBase: baseOf("dev-b", 14211) });
    b.apps.upsert([app("dev-b", "b1", 200), app("dev-b", "b2", 100)]);
    const w = world("dev-a", [a, b], [{ deviceId: "dev-b", online: true, dns: dnsOf("dev-b") }]);
    const first = appsMesh(w, a);
    const file = join(first.dir, "dev-b.json");
    const written = await settle(() => existsSync(file));
    expect(written, `B's replica is written at ${file}`).toBe(true);
    expect((statSync(file).mode & 0o777).toString(8), "owner-only").toBe("600");
    expect(
      readdirSync(first.dir).filter((name) => name.endsWith(".tmp")),
      "the write went through a rename: no temporary file left",
    ).toEqual([]);
    const kept = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(kept).toMatchObject({
      format: 1,
      device: "dev-b",
      epoch: "dev-b-boot-1",
      libraryReady: true,
      previewsBase: baseOf("dev-b", 14211),
    });
    expect((kept["rows"] as unknown[]).length).toBe(2);
    first.mesh.dispose();

    // a fresh aggregator over the same folder, B unreachable: listed from the kept file
    const w2 = world("dev-a", [a], [{ deviceId: "dev-b", online: false, dns: dnsOf("dev-b") }]);
    const second = appsMesh(w2, a, { dir: first.dir });
    const page = second.mesh.list({ scope: "mesh" }, windowCtx);
    expect(titles(page)).toEqual(["App b1", "App b2"]);
    const source = page.sources.find((entry) => entry.device === "dev-b");
    expect(source).toMatchObject({ state: "asleep", rows: 2, libraryReady: true });
    expect(source?.previewsBase, "the kept base, bound again to B's name").toBe(
      baseOf("dev-b", 14211),
    );
    expect(source?.asOf).toMatch(/Z$/);
  });
});

describe("AppsMesh — the fold (MA-D4)", () => {
  it("folds by contracts' fold key: native id (per agent kind), else the hosted link, else the app on its desktop", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    const hosted = "https://claude.ai/code/artifact/plan";
    const sameId = hex("the same rosetta identity on two desktops");
    const nA = app("dev-a", "n-a", 100, { nativeId: "review" });
    const hA = app("dev-a", "h-a", 110, { hostedUrl: hosted });
    const kA = app("dev-a", "k-a", 120, { appId: sameId });
    const xA = app("dev-a", "x-a", 90, { nativeId: "review", kind: "codex" });
    const nB = app("dev-b", "n-b", 200, { nativeId: "review" });
    const hB = app("dev-b", "h-b", 210, { hostedUrl: hosted });
    const kB = app("dev-b", "k-b", 130, { appId: sameId });
    a.apps.upsert([nA, hA, kA, xA]);
    b.apps.upsert([nB, hB, kB]);
    const w = world("dev-a", [a, b], [{ deviceId: "dev-b", online: true }]);
    const { mesh } = appsMesh(w, a);
    const settled = await settle(() => mesh.replica("dev-b")?.length === 3);

    const page = mesh.list({ scope: "mesh" }, windowCtx);
    expect(titles(page), `one row per fold (settled: ${settled})`).toEqual([
      "App h-b", // the hosted link folds h-a and h-b; the newest serves
      "App n-b", // claude-code's "review" folds n-a and n-b
      "App k-b", // no native id, no link: the app on its desktop, even with rosetta's same id
      "App k-a",
      "App x-a", // codex's "review" is another app
    ]);
    expect(
      page.rows.map((row) => row.foldKey),
      "the fold key is contracts' composer's",
    ).toEqual([
      madeAppFoldKey(hB),
      madeAppFoldKey(nB),
      madeAppFoldKey(kB),
      madeAppFoldKey(kA),
      madeAppFoldKey(xA),
    ]);
    expect(page.rows.map((row) => row.devices)).toEqual([
      ["dev-b", "dev-a"],
      ["dev-b", "dev-a"],
      ["dev-b"],
      ["dev-a"],
      ["dev-a"],
    ]);
  });

  it("the newest presentation serves (publishedAt ?? capturedAt ?? 0): its device, ids and appKey; devices name every holder, the serving one first; versions are summed; `devices` narrows who serves", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    const c = owner("dev-c");
    const fromA = app("dev-a", "r-a", 100, { nativeId: "review", versions: 2 });
    // no publishedAt: its capture time sorts it, and it is the newest
    const fromB = app("dev-b", "r-b", null, { nativeId: "review", versions: 1, capturedAt: 300 });
    const fromC = app("dev-c", "r-c", 200, { nativeId: "review", versions: 3 });
    // neither time: sorts as 0, last
    const lone = app("dev-a", "lone", null);
    a.apps.upsert([fromA, lone]);
    b.apps.upsert([fromB]);
    c.apps.upsert([fromC]);
    const w = world(
      "dev-a",
      [a, b, c],
      [
        { deviceId: "dev-b", online: true },
        { deviceId: "dev-c", online: true },
      ],
    );
    const { mesh } = appsMesh(w, a);
    const settled = await settle(
      () => mesh.replica("dev-b")?.length === 1 && mesh.replica("dev-c")?.length === 1,
    );

    const page = mesh.list({ scope: "mesh" }, windowCtx);
    expect(titles(page), `the fold, then the lone app (settled: ${settled})`).toEqual([
      "App r-b",
      "App lone",
    ]);
    const served = page.rows[0];
    expect(served).toMatchObject({
      device: "dev-b",
      appId: fromB.appId,
      presentationId: fromB.presentationId,
      appKey: `dev-b:${fromB.appId}`,
      devices: ["dev-b", "dev-a", "dev-c"],
      versions: 6,
    });
    expect(served?.publishedAt, "the serving row's own columns, none borrowed").toBeUndefined();

    // a page narrowed to A and C: the newest of THEIRS serves, every holder still named
    const narrowed = mesh.list({ scope: "mesh", devices: ["dev-a", "dev-c"] }, windowCtx);
    expect(narrowed.rows[0]).toMatchObject({
      device: "dev-c",
      appId: fromC.appId,
      devices: ["dev-c", "dev-a", "dev-b"],
    });
    expect(narrowed.sources.map((source) => source.device)).toEqual(["dev-a", "dev-c"]);
  });

  it("the merged intent: a hidden app is dropped unless includeHidden; kept is marked and filters; openable = captured ∧ not hidden ∧ its desktop exports", async () => {
    const a = owner("dev-a");
    const kept = app("dev-a", "kept", 400);
    const hidden = app("dev-a", "hidden", 300);
    const plain = app("dev-a", "plain", 200);
    const missing = app("dev-a", "missing", 100, { availability: "missing" });
    a.apps.upsert([kept, hidden, plain, missing]);
    const intent = intentsOf([
      [madeAppFoldKey(kept), { kept: true }],
      [madeAppFoldKey(hidden), { hidden: true }],
    ]);
    const w = world("dev-a", [a], []);
    const { mesh } = appsMesh(w, a, { intents: intent.reader, exportReady: () => true });

    const page = mesh.list({ scope: "local" }, windowCtx);
    expect(titles(page), "the hidden app is dropped").toEqual([
      "App kept",
      "App plain",
      "App missing",
    ]);
    expect(page.rows.map((row) => [row.kept ?? null, row.hidden ?? null, row.openable])).toEqual([
      [true, null, true],
      [null, null, true],
      [null, null, false], // no verified copy
    ]);
    const all = mesh.list({ scope: "local", includeHidden: true }, windowCtx);
    expect(titles(all)).toEqual(["App kept", "App hidden", "App plain", "App missing"]);
    expect(all.rows[1]).toMatchObject({ hidden: true, openable: false });
    expect(titles(mesh.list({ scope: "local", kept: true }, windowCtx))).toEqual(["App kept"]);

    // the intent moves: the fold follows at once
    intent.set(madeAppFoldKey(hidden), undefined);
    expect(titles(mesh.list({ scope: "local" }, windowCtx))).toEqual([
      "App kept",
      "App hidden",
      "App plain",
      "App missing",
    ]);
  });

  it("`q` keeps the apps whose title or file name holds it, case-folded", async () => {
    const a = owner("dev-a");
    a.apps.upsert([
      app("dev-a", "review", 300, { title: "Checkout design review" }),
      app("dev-a", "checkout-notes", 200, { title: "Notes" }),
      app("dev-a", "budget", 100, { title: "Budget" }),
    ]);
    const w = world("dev-a", [a], []);
    const { mesh } = appsMesh(w, a);
    expect(
      titles(mesh.list({ scope: "local", q: "CHECKOUT" }, windowCtx)),
      "a title, then a file name, that hold it",
    ).toEqual(["Checkout design review", "Notes"]);
    expect(titles(mesh.list({ scope: "local", q: "budg" }, windowCtx))).toEqual(["Budget"]);
  });

  it("keyset pages never repeat or skip across an insert, and a cursor this door never issued is refused", async () => {
    const a = owner("dev-a");
    a.apps.upsert([1, 2, 3, 4, 5].map((n) => app("dev-a", `a${n}`, n * 100)));
    const w = world("dev-a", [a], []);
    const { mesh } = appsMesh(w, a);

    const first = mesh.list({ scope: "local", limit: 2 }, windowCtx);
    expect(titles(first), "the newest two").toEqual(["App a5", "App a4"]);
    expect(first.cursor, "a next page is owed").toBeTypeOf("string");
    // one app newer than the page, one between its cursor and the rest
    a.apps.upsert([app("dev-a", "a6", 600), app("dev-a", "a3.5", 350)]);
    const second = mesh.list({ scope: "local", limit: 2, cursor: first.cursor ?? "" }, windowCtx);
    const third = mesh.list({ scope: "local", limit: 2, cursor: second.cursor ?? "" }, windowCtx);
    expect([...titles(second), ...titles(third)]).toEqual([
      "App a3.5",
      "App a3",
      "App a2",
      "App a1",
    ]);
    expect(third.cursor, "the last page owes none").toBeUndefined();

    const refused = refusalOf(() =>
      mesh.list({ scope: "local", cursor: "not-a-cursor" }, windowCtx),
    );
    expect(refused?.kind, "a foreign cursor").toBe("PRECONDITION_FAILED");
  });

  it("the phone's page is cut at INDEX_TAILNET_LIMITS.MAX_ROWS and says `clipped`; a window's is not", async () => {
    const a = owner("dev-a");
    a.apps.upsert(Array.from({ length: 150 }, (_, n) => app("dev-a", `a${n}`, 1_000 + n)));
    const w = world("dev-a", [a], []);
    const { mesh } = appsMesh(w, a);

    const phone = mesh.list({ scope: "local", limit: 500 }, phoneCtx);
    expect(phone.rows.length, "the phone's page").toBe(INDEX_TAILNET_LIMITS.MAX_ROWS);
    expect(phone.clipped, "the bound cut what the phone asked").toBe(true);
    expect(phone.cursor, "the rest is a next page").toBeTypeOf("string");
    const window = mesh.list({ scope: "local", limit: 500 }, windowCtx);
    expect(window.rows.length, "a window's page").toBe(150);
    expect(window.clipped ?? false).toBe(false);
    expect(window.cursor).toBeUndefined();
    // the phone asking no more than its bound is paged, never told it was cut
    const asked = mesh.list({ scope: "local" }, phoneCtx);
    expect(asked.rows.length).toBe(INDEX_TAILNET_LIMITS.MAX_ROWS);
    expect(asked.clipped ?? false).toBe(false);
    expect(asked.cursor).toBeTypeOf("string");
  });
});

describe("AppsMesh — sources, the project join and the doors' callers", () => {
  it("sources: each desktop's state, rows, libraryReady and previewsBase — a peer's base kept only when its host is that peer's authenticated MagicDNS name, else stripped; the newest frame's standing stands", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b", { libraryReady: false, previewsBase: baseOf("dev-b", 14211) });
    const c = owner("dev-c", { libraryReady: true, previewsBase: baseOf("dev-x", 14212) });
    const d = owner("dev-d", { previewsBase: baseOf("dev-d", 14213) });
    a.apps.upsert([app("dev-a", "a1", 100)]);
    b.apps.upsert([app("dev-b", "b1", 100)]);
    c.apps.upsert([app("dev-c", "c1", 100)]);
    d.apps.upsert([app("dev-d", "d1", 100)]);
    const w = world(
      "dev-a",
      [a, b, c, d],
      [
        // the roster's name, spelled with a capital and a terminal dot: canonical, it is B's host
        { deviceId: "dev-b", online: true, dns: "DEV-B.tail1234.ts.net." },
        { deviceId: "dev-c", online: true, dns: dnsOf("dev-c") },
        // no transport binding at all
        { deviceId: "dev-d", online: true },
      ],
    );
    const own = baseOf("dev-a", 14000);
    const local = new LocalApps(a.apps);
    local.previewsBase = own;
    const { mesh } = appsMesh(w, a, { local });
    const settled = await settle(() =>
      ["dev-b", "dev-c", "dev-d"].every((device) => mesh.replica(device)?.length === 1),
    );

    const sources = mesh.sources("mesh");
    expect(
      sources.map((source) => [source.device, source.self, source.state, source.rows]),
      `every desktop's standing (settled: ${settled})`,
    ).toEqual([
      ["dev-a", true, "live", 1],
      ["dev-b", false, "live", 1],
      ["dev-c", false, "live", 1],
      ["dev-d", false, "live", 1],
    ]);
    const of = (device: string) => mesh.sources("mesh").find((source) => source.device === device);
    expect(of("dev-a")).toMatchObject({ libraryReady: true, previewsBase: own });
    expect(of("dev-b")).toMatchObject({
      libraryReady: false,
      previewsBase: baseOf("dev-b", 14211),
    });
    expect(of("dev-c")?.libraryReady).toBe(true);
    expect(of("dev-c")?.previewsBase, "C's base names another host: stripped").toBeUndefined();
    expect(of("dev-d")?.previewsBase, "D has no authenticated name: stripped").toBeUndefined();
    expect(of("dev-d")?.libraryReady, "D never said: unknown").toBeUndefined();
    expect(mesh.list({ scope: "mesh" }, windowCtx).sources).toEqual(mesh.sources("mesh"));

    // the standing moves with no row: heard at once
    say(b, { libraryReady: true, previewsBase: baseOf("dev-b", 14211) });
    const ready = await settle(() => of("dev-b")?.libraryReady === true);
    expect(of("dev-b")?.libraryReady, `B finished reading (settled: ${ready})`).toBe(true);
    // a frame without a base leaves none
    say(b, { libraryReady: true });
    await settle(() => of("dev-b")?.previewsBase === undefined);
    expect(of("dev-b")?.previewsBase, "the newest frame said no base").toBeUndefined();
    // a base that is not a root URL in AH's range is no base
    say(b, { libraryReady: true, previewsBase: `${baseOf("dev-b", 14211)}?v=1` });
    await sleep(50);
    expect(of("dev-b")?.previewsBase, "a base with a query is stripped").toBeUndefined();
  });

  it("the project joins at THIS door through joinProject(device, root session), never from the row; a projectKey narrows", async () => {
    const a = owner("dev-a");
    a.apps.upsert([
      app("dev-a", "child", 200, {
        sessionId: "ses-child",
        rootSessionId: "ses-root-1",
        projectId: "rosetta-project-1",
      }),
      app("dev-a", "own-root", 100, { sessionId: "ses-root-2" }),
    ]);
    const w = world("dev-a", [a], []);
    const { mesh, joins } = appsMesh(w, a, {
      joinProject: (device, root) =>
        root === "ses-root-1"
          ? { projectKey: "p1:alpha", place: { device, placeId: "place-1" }, ink: 3 }
          : undefined,
    });

    const page = mesh.list({ scope: "local" }, windowCtx);
    expect(titles(page), "both apps listed").toEqual(["App child", "App own-root"]);
    expect(page.rows[0]).toMatchObject({
      projectKey: "p1:alpha",
      place: { device: "dev-a", placeId: "place-1" },
      ink: 3,
    });
    expect(
      "projectId" in (page.rows[0] ?? {}),
      "rosetta's project id is the replicated row's, never the door's",
    ).toBe(false);
    expect(page.rows[1]?.projectKey, "no project for its root").toBeUndefined();
    expect(
      [...new Set(joins.map(([device, root]) => `${device}|${root}`))].sort(),
      "joined through the ROOT session (a session is its own root when none is named)",
    ).toEqual(["dev-a|ses-root-1", "dev-a|ses-root-2"]);
    expect(titles(mesh.list({ scope: "local", projectKey: "p1:alpha" }, windowCtx))).toEqual([
      "App child",
    ]);
  });

  it("DS-L4: a routed call (peer-fieldd) is answered only this desktop's own apps, and never the project column", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    a.apps.upsert([app("dev-a", "a1", 100, { sessionId: "ses-root-1" })]);
    b.apps.upsert([app("dev-b", "b1", 200)]);
    const w = world("dev-a", [a, b], [{ deviceId: "dev-b", online: true }]);
    const { mesh } = appsMesh(w, a, {
      joinProject: () => ({ projectKey: "p1:alpha", ink: 1 }),
    });
    const settled = await settle(() => mesh.replica("dev-b")?.length === 1);
    expect(
      titles(mesh.list({ scope: "mesh" }, windowCtx)),
      `the window reads the mesh (settled: ${settled})`,
    ).toEqual(["App b1", "App a1"]);

    const routed = mesh.list({ scope: "mesh" }, peerCtx);
    expect(titles(routed), "a peer daemon is answered this desktop's own apps").toEqual(["App a1"]);
    expect(
      routed.rows[0]?.projectKey,
      "a peer daemon never receives the project column",
    ).toBeUndefined();
    expect(routed.sources.map((source) => source.device)).toEqual(["dev-a"]);
  });

  it("DS-L8: a local page before the first walk is UNAVAILABLE in the apps' words, never an empty shelf", async () => {
    const a = owner("dev-a");
    a.apps.upsert([app("dev-a", "a1", 100)]);
    const local = new LocalApps(a.apps);
    local.ready = false;
    const w = world("dev-a", [a], []);
    const { mesh } = appsMesh(w, a, { local });

    const refused = refusalOf(() => mesh.list({ scope: "local" }, windowCtx));
    expect(refused?.kind, "no answer before the first walk").toBe("UNAVAILABLE");
    expect(refused?.retryable).toBe(true);
    expect(refused?.details).toMatchObject({
      service: MADE_APP_OPEN.SERVICE,
      state: MADE_APP_OPEN.STATE_READING,
    });
    expect(mesh.sources("local")[0]?.state, "this desktop reads stale until then").toBe("stale");
    local.set({ ready: true });
    expect(titles(mesh.list({ scope: "local" }, windowCtx))).toEqual(["App a1"]);
  });
});

describe("AppsMesh — its own pings", () => {
  it("a mesh page hears a peer's app, a desktop's standing and the merged intent move; a local page hears only its own", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    const intent = intentsOf([]);
    const w = world("dev-a", [a, b], [{ deviceId: "dev-b", online: true, dns: dnsOf("dev-b") }]);
    const { mesh } = appsMesh(w, a, { intents: intent.reader });
    const attached = await settle(() => mesh.replica("dev-b") !== undefined);
    expect(mesh.replica("dev-b"), `B's (empty) replica is attached (settled: ${attached})`).toEqual(
      [],
    );
    const meshPings: Array<Record<string, unknown>> = [];
    const localPings: Array<Record<string, unknown>> = [];
    const meshSub = mesh.changes({ scope: "mesh" }, (payload) =>
      meshPings.push(payload as Record<string, unknown>),
    );
    const localSub = mesh.changes({ scope: "local" }, (payload) =>
      localPings.push(payload as Record<string, unknown>),
    );
    meshSub.start();
    localSub.start();
    cleanup.push(() => meshSub.dispose());
    cleanup.push(() => localSub.dispose());

    b.apps.upsert([app("dev-b", "b1", 100)]);
    const heard = await settle(() => meshPings.length > 0);
    expect(meshPings.length, `a mesh page hears B's app (settled: ${heard})`).toBeGreaterThan(0);
    expect(meshPings.at(-1)?.["upserts"], "pings carry no rows").toEqual([]);
    expect(meshPings.at(-1)?.["devices"]).toEqual(["dev-b"]);
    expect(localPings.length, "a local page never hears a peer").toBe(0);

    // a standing that moves with no row
    let before = meshPings.length;
    say(b, { libraryReady: false, previewsBase: baseOf("dev-b", 14211) });
    await settle(() => meshPings.length > before);
    expect(meshPings.length, "B's standing moved").toBeGreaterThan(before);

    // the merged intent
    before = meshPings.length;
    const beforeLocal = localPings.length;
    intent.set("app:dev-a:whatever", { hidden: true });
    await settle(() => meshPings.length > before && localPings.length > beforeLocal);
    expect(meshPings.length, "the intent moved (mesh)").toBeGreaterThan(before);
    expect(localPings.length, "the intent moved (local)").toBeGreaterThan(beforeLocal);

    // this desktop's own app
    const ownBefore = localPings.length;
    a.apps.upsert([app("dev-a", "a1", 100)]);
    await settle(() => localPings.length > ownBefore);
    const ping = localPings.at(-1) as { since?: number; revision?: number } | undefined;
    expect(ping?.revision ?? 0, "a local page hears its own").toBeGreaterThan(ping?.since ?? 0);
    expect(meshSub.open).toMatchObject({ snapshot: { rows: [] } });
  });

  it("PIN: the apps replica rides its own door and its own pings — a co-running IndexMesh never asks the apps door, and hears nothing when an app moves", async () => {
    const a = owner("dev-a");
    const b = owner("dev-b");
    b.sessions.upsert([session("dev-b", "s-b1", 500)]);
    const w = world("dev-a", [a, b], [{ deviceId: "dev-b", online: true }]);
    const history = indexMesh(w, a);
    appsMesh(w, a);
    await settle(() => history.replica("dev-b")?.sessions.length === 1);
    let historyChanges = 0;
    history.on("change", () => {
      historyChanges += 1;
    });
    b.apps.upsert([app("dev-b", "b1", 100)]);
    a.apps.upsert([app("dev-a", "a1", 100)]);
    await sleep(150);
    expect(historyChanges, "no history change for an app").toBe(0);
    expect(
      w.wire.asks
        .filter((ask) => ask.method === HISTORY_DOOR)
        .map((ask) => ask.params["table"])
        .filter((table) => table !== "projects" && table !== "sessions"),
      "the history door is never asked for apps",
    ).toEqual([]);
  });
});
