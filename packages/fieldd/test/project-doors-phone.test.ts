// PJ-3 — THE PHONE'S WITNESS (build-pj23.md §1; P1 and P2 RULED (a)
// 2026-10-08): ONE real daemon over the scripted rosettad, its places
// published through the catalog's own write path (the scanner's
// `setPlaces`), reached the ways a caller arrives — the phone through the
// sidecar's door (a WhoIs login and no token), a guest (a login that is not
// this desktop's), a peer daemon (a node the roster vouches for as a
// desktop, D1) and a window by a local token. What it proves, in the slice's
// words:
//   · the phone lists projects from its desktop;
//   · a place in an answer carries a path for a self principal and none for
//     a guest (a guest is answered nothing at all: its preset is empty);
//   · the phone cannot aim a request at a folder by path (P1);
//   · a regroup moves a key, `project.get` on the old key answers `movedTo`,
//     the pings carry `regrouped`, and the key memory is on disk (D9);
//   · a peer daemon is refused every `project.*` door (DS-L4), though its
//     derived preset holds `project.read`;
//   · a plugin can never hold `project.read`; the phone cannot act (P2).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentSpawnResult,
  CONTRACTS_VERSION,
  computeEffectiveGrants,
  IndexSessionsResult,
  LAYOUT,
  PEER_FIELDD_SCOPES,
  type PlaceFacts,
  ProjectChangesDelta,
  ProjectFiguresDayResult,
  ProjectFiguresResult,
  ProjectGetResult,
  ProjectIntentResult,
  ProjectListResult,
  ProjectSessionsResult,
  SOCKETS,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { KeyJournal } from "../src/projects/key-journal";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { born } from "./agent-birth";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { bootPhoneWorld, type PhoneWorld } from "./phone-world";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");
const ROOT_SHA = "a".repeat(40);

/** rosetta's SessionRow, as the scripted daemon serves it */
const sessionRow = (id: string, project: string, cwd: string, lastAt: number) => ({
  id,
  native_session_id: `nat-${id}`,
  root_session_id: id,
  parent_session_id: null,
  runtime_id: "rt-claude",
  project_id: project,
  cwd,
  title: `title ${id}`,
  summary: null,
  started_at: 1_000,
  updated_at: lastAt,
  activity: { first_at: 1_000, last_at: lastAt },
  stream_state: "indexed",
  role: "primary",
  delegation: null,
});

function facts(placeId: string, path: string, over: Partial<PlaceFacts> = {}): PlaceFacts {
  return {
    placeId,
    path,
    aliases: [],
    kind: "project",
    caseless: true,
    exists: true,
    mounted: true,
    git: false,
    remotes: [],
    samples: [],
    hits: [],
    observedAt: 1,
    ...over,
  };
}
const APP = facts("pl_app", "/work/app", {
  git: true,
  root: ROOT_SHA,
  identityRemote: "github.com/acme/app",
  remotes: ["github.com/acme/app"],
  branch: "main",
});
const NOTES = facts("pl_notes", "/work/notes");
/** a fork of the app's first commit, under another identity: it only
 * suggests — but the first commit stops being the app's alone */
const FORK = facts("pl_fork", "/work/fork", {
  git: true,
  root: ROOT_SHA,
  identityRemote: "github.com/other/fork",
  remotes: ["github.com/other/fork"],
});

let cleanup: Array<() => void | Promise<void>> = [];

interface World {
  daemon: FielddDaemon;
  dataDir: string;
  self: string;
  phone: WsRpc;
  guest: WsRpc;
  peer: WsRpc;
  window: WsRpc;
  phoneScopes: string[];
  guestScopes: string[];
  peerScopes: string[];
}
let world: World;

/** The peer link's dialer: this world has one desktop. */
class Unreachable extends WebSocket {
  constructor(_url: string) {
    super("ws://127.0.0.1:1/");
  }
}

async function open(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-pj3-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir, TEST_LOGIN);
  const files = {
    sessions: join(dataDir, "sessions.json"),
    runtimes: join(dataDir, "runtimes.json"),
  };
  writeFileSync(
    files.sessions,
    JSON.stringify([
      sessionRow("s-app-1", "p-app", "/work/app/src", 30_000),
      sessionRow("s-app-2", "p-app", "/work/app", 20_000),
      sessionRow("s-notes", "p-notes", "/work/notes", 10_000),
      sessionRow("s-fork", "p-fork", "/work/fork", 5_000),
    ]),
  );
  writeFileSync(
    files.runtimes,
    JSON.stringify([
      { id: "rt-claude", kind: "claude-code", data_root: "~/.claude", enabled: true },
    ]),
  );

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.meshPeers = [
    registryPeer({ nodeId: "node-c", deviceId: "dev-c", name: "device-c", login: TEST_LOGIN }),
  ];
  mock.storeSlices = new Map<string, unknown>([["dev-c", desktopSlice("dev-c", "device-c")]]);
  await mock.start();
  cleanup.push(() => mock.stop());

  const env = {
    FAKE_ROSETTAD_MODE: "ok",
    FAKE_ROSETTAD_SESSIONS: files.sessions,
    FAKE_ROSETTAD_RUNTIMES: files.runtimes,
  };
  const fakeSpawner = ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: { ...process.env, ...env },
    })) as unknown as typeof spawn;
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    peerWebSocket: Unreachable as unknown as WsCtor,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner,
    rosettadHome: home,
    indexCatalog: { batchMs: 20, digestIntervalMs: 300 },
  });
  cleanup.push(() => daemon.stop());

  const step = async (label: string, fn: () => boolean, ms: number) => {
    try {
      await until(fn, ms);
    } catch {
      throw new Error(
        `the world did not come up: ${label} (catalog: ${daemon.indexCatalog.projects.size} projects, ${daemon.indexCatalog.sessions.size} sessions)`,
      );
    }
  };
  await step("rosettad ready", () => daemon.health().rosettad.phase === "ready", 15_000);
  await step("catalog ready", () => daemon.indexCatalog.ready, 30_000);
  await step("three projects", () => daemon.indexCatalog.projects.size === 3, 15_000);
  await step("product serve", () => mock.meshServes.get("product") !== undefined, 15_000);
  await step("mesh identity", () => daemon.devices.currentDeviceId() === mock.meshDeviceId, 15_000);
  await step("peer desktop", () => daemon.devices.isDocHost("dev-c"), 15_000);

  // the places, through the catalog's own write path (the scanner's: this
  // world runs no files worker, so nothing else writes them)
  daemon.indexCatalog.setPlaces(
    new Map([
      ["p-app", [APP]],
      ["p-notes", [NOTES]],
    ]),
  );
  daemon.projects.regroupNow();

  const door = `ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`;
  const tailnet = async (headers: Record<string, string>, clientKind: "ios" | "peer-fieldd") => {
    const rpc = await open(door, headers);
    const ack = (await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind,
      ...(clientKind === "peer-fieldd" ? { deviceId: "dev-c" } : {}),
    })) as { grantedScopes: string[] };
    return { rpc, granted: ack.grantedScopes };
  };
  const phone = await tailnet({ "Tailscale-User-Login": TEST_LOGIN }, "ios");
  const guest = await tailnet({ "Tailscale-User-Login": "else@example.com" }, "ios");
  const peer = await tailnet(
    { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-c" },
    "peer-fieldd",
  );
  const window = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(
    window,
    daemon.tokens.mint(["project.read", "settings.manage", "index.search"], "pj3-window").token,
  );
  world = {
    daemon,
    dataDir,
    self: daemon.devices.currentDeviceId(),
    phone: phone.rpc,
    guest: guest.rpc,
    peer: peer.rpc,
    window,
    phoneScopes: phone.granted,
    guestScopes: guest.granted,
    peerScopes: peer.granted,
  };
}, 90_000);

afterAll(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
}, 30_000);

const keyOf = (page: ProjectListResult, name: string): string => {
  const row = page.rows.find((r) => r.name === name);
  if (row === undefined) throw new Error(`no project named ${name}`);
  return row.key;
};

describe("PJ-3 — the phone reads its desktop's projects (P1, D8, D10)", () => {
  it("the phone is granted project.read by its preset; the phone lists its desktop's projects", async () => {
    expect(world.phoneScopes).toEqual([...TAILNET_SCOPES]);
    expect(world.phoneScopes).toContain("project.read");
    const page = ProjectListResult.parse(await world.phone.call("project.list", {}));
    // newest first: the app (30 s), the notes (10 s), the fork (no place yet)
    expect(page.rows.map((r) => r.name)).toEqual(["app", "notes"]);
    const app = page.rows[0]!;
    expect(app.devices).toEqual([world.self]);
    expect(app.sessions).toBe(2);
    expect(app.places).toEqual([
      {
        ref: { device: world.self, placeId: "pl_app" },
        name: "app",
        // P1 (a): an answer to the person's own device may carry the path
        path: "/work/app",
        class: "repo",
        branch: "main",
        exists: true,
        mounted: true,
        sessions: 2,
        lastAt: 30_000,
      },
    ]);
    // D10: across the tailnet, the place anchors only
    expect(app.anchors).toEqual(["place:pl_app"]);
    expect(page.sources.map((s) => s.device)).toContain(world.self);
    expect(app.asOf[world.self]).toBeDefined();
  }, 30_000);

  it("the phone reads one project and its sessions, each joined to its place — no `via` reaches it", async () => {
    const page = ProjectListResult.parse(await world.phone.call("project.list", {}));
    const key = keyOf(page, "app");
    const got = ProjectGetResult.parse(await world.phone.call("project.get", { key }));
    expect(got.project.key).toBe(key);
    expect(JSON.stringify(got)).not.toMatch(/github\.com|root:/);
    const sessions = ProjectSessionsResult.parse(
      await world.phone.call("project.sessions", {
        key,
        places: [{ device: world.self, placeId: "pl_app" }],
      }),
    );
    expect(sessions.rows.map((r) => [r.sessionId, r.place.placeId, r.cwd])).toEqual([
      ["s-app-1", "pl_app", "/work/app/src"],
      ["s-app-2", "pl_app", "/work/app"],
    ]);
    // the window is told what joined it and every anchor
    const window = ProjectGetResult.parse(await world.window.call("project.get", { key }));
    expect(window.project.anchors).toEqual([
      "place:pl_app",
      "remote:github.com/acme/app",
      `root:${ROOT_SHA}`,
    ]);
  }, 30_000);

  it("a guest is answered nothing — no project, so no path — its preset is empty", async () => {
    expect(world.guestScopes).toEqual([]);
    for (const [method, params] of [
      ["project.list", {}],
      ["project.get", { anchor: "place:pl_app" }],
      ["project.sessions", { key: "p1:x" }],
      ["project.subscribe", {}],
    ] as const) {
      const refused = await world.guest.callErr(method, params);
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(JSON.stringify(refused)).not.toContain("/work/");
    }
  }, 30_000);

  it("the phone cannot aim a request at a folder by its path (P1)", async () => {
    const page = ProjectListResult.parse(await world.phone.call("project.list", {}));
    const key = keyOf(page, "app");
    const asks: Array<[string, unknown, string]> = [
      [
        "project.sessions",
        { key, places: [{ device: world.self, placeId: "pl_app", path: "/work/app" }] },
        "places.0.path",
      ],
      ["project.list", { cwd: "/work/app" }, "cwd"],
      ["project.get", { anchor: "remote:local:/work/app" }, "anchor"],
      ["project.subscribe", { path: "/work" }, "path"],
    ];
    for (const [method, params, field] of asks) {
      const refused = await world.phone.callErr(method, params);
      expect(refused.data?.kind, method).toBe("PRECONDITION_FAILED");
      expect(refused.data?.details, method).toEqual({ reason: "path-in-request", field });
    }
  }, 30_000);

  it("a regroup moves a key: project.get on the old key answers movedTo, the pings say regrouped, the memory is on disk", async () => {
    const before = ProjectListResult.parse(await world.phone.call("project.list", {}));
    const oldKey = keyOf(before, "app");
    const sub = (await world.phone.call("project.subscribe", {})) as { subId: string };
    // a fork of the app's first commit is published: the first commit is no
    // longer the app's alone, so its key falls back to its identity remote
    world.daemon.indexCatalog.setPlaces(
      new Map([
        ["p-app", [APP]],
        ["p-notes", [NOTES]],
        ["p-fork", [FORK]],
      ]),
    );
    world.daemon.projects.regroupNow();
    const after = ProjectListResult.parse(await world.phone.call("project.list", {}));
    const newKey = keyOf(after, "app");
    expect(newKey).not.toBe(oldKey);
    const moved = ProjectGetResult.parse(await world.phone.call("project.get", { key: oldKey }));
    expect(moved.movedTo).toBe(newKey);
    expect(moved.project.key).toBe(newKey);
    // the fork only suggests (§4.2): the phone hears the suggestion, not why
    expect(moved.suggestions).toEqual([
      {
        type: "related-history",
        with: keyOf(after, "fork"),
        a: { device: world.self, placeId: "pl_app" },
        b: { device: world.self, placeId: "pl_fork" },
      },
    ]);
    // the reads follow a moved key; the session door says so too
    const sessions = ProjectSessionsResult.parse(
      await world.phone.call("project.sessions", { key: oldKey }),
    );
    expect(sessions.movedTo).toBe(newKey);
    expect(sessions.key).toBe(newKey);
    // the open page heard the move
    await until(
      () =>
        world.phone.notifications.some(
          (n) =>
            n.method === "project.delta" &&
            n.params.subId === sub.subId &&
            (ProjectChangesDelta.parse(n.params.payload).regrouped ?? []).length > 0,
        ),
      5_000,
    );
    const ping = world.phone.notifications.find(
      (n) => n.method === "project.delta" && n.params.subId === sub.subId,
    );
    expect(ProjectChangesDelta.parse(ping?.params.payload).regrouped).toContainEqual({
      from: oldKey,
      to: newKey,
    });
    // D9: the key memory is persisted — a daemon that restarts reads it back
    const file = join(world.dataDir, ...LAYOUT.PROJECT_KEYS_FILE);
    expect(existsSync(file)).toBe(true);
    expect(new KeyJournal({ file }).movedTo(oldKey, (key) => key === newKey)).toBe(newKey);
    await world.phone.call("system.unsubscribe", { subId: sub.subId });
  }, 30_000);

  it("a peer daemon is refused every project door, though its derived preset holds the scope (DS-L4)", async () => {
    expect(world.peerScopes).toEqual([...PEER_FIELDD_SCOPES]);
    expect(world.peerScopes).toContain("project.read");
    for (const [method, params] of [
      ["project.list", {}],
      ["project.get", { anchor: "place:pl_app" }],
      ["project.sessions", { key: "p1:x" }],
      ["project.subscribe", {}],
    ] as const) {
      const refused = await world.peer.callErr(method, params);
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.data?.details, method).toEqual({ method, principal: "peer-fieldd" });
    }
    // the act is not even in its preset
    const act = await world.peer.callErr("project.intent", {
      key: "p1:x",
      op: "pin",
      pinned: true,
    });
    expect(act.data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);

  it("only a desktop window acts (P2): the phone is refused; the window's act is a record the phone reads", async () => {
    const page = ProjectListResult.parse(await world.window.call("project.list", {}));
    const key = keyOf(page, "app");
    const fromPhone = await world.phone.callErr("project.intent", { key, op: "rename", name: "A" });
    expect(fromPhone.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(fromPhone.data?.details).toEqual({ required: "settings.manage" });
    // PJ-2 — the records are wired: the window's rename is the project's
    // first act, so it makes the record and the key moves to it
    const act = ProjectIntentResult.parse(
      await world.window.call("project.intent", { key, op: "rename", name: "Field" }),
    );
    expect(act.key).toBe(`r:${act.recordId}`);
    const read = ProjectListResult.parse(await world.phone.call("project.list", {}));
    expect(read.rows.find((row) => row.key === act.key)).toMatchObject({
      name: "Field",
      nameFrom: "you",
    });
    // the old key moved (D9): an act aimed at it is refused, never misdirected
    const stale = await world.window.callErr("project.intent", { key, op: "pin", pinned: true });
    expect(stale.data?.details).toMatchObject({ reason: "key-moved", movedTo: act.key });
  }, 30_000);

  it("a plugin can never hold project.read — no source, no entry kind", () => {
    for (const source of ["bundled", "dev-linked", "registry", "sideload"] as const) {
      const grants = computeEffectiveGrants({
        requested: ["project.read"],
        hasRenderer: true,
        hasService: true,
        source,
      });
      expect(grants.granted, source).toEqual([]);
      expect(grants.denied, source).toEqual([{ capability: "project.read", reason: "entry-kind" }]);
    }
  });
});

describe("PJ-4 — the join column over the real door (A-D4)", () => {
  it("a window's listing carries each session's project key — project.list's — and a peer daemon's none (DS-L4)", async () => {
    const projects = ProjectListResult.parse(await world.window.call("project.list", {}));
    // by place, not by name: the window renamed the app's project above
    const keyAt = (placeId: string): string => {
      const row = projects.rows.find((r) => r.places.some((p) => p.ref.placeId === placeId));
      if (row === undefined) throw new Error(`no project holds ${placeId}`);
      return row.key;
    };
    const listing = IndexSessionsResult.parse(
      await world.window.call("index.sessions", { scope: "local", limit: 500 }),
    );
    const keys = Object.fromEntries(listing.rows.map((row) => [row.sessionId, row.projectKey]));
    expect(keys).toEqual({
      "s-app-1": keyAt("pl_app"),
      "s-app-2": keyAt("pl_app"),
      "s-notes": keyAt("pl_notes"),
      "s-fork": keyAt("pl_fork"),
    });
    // R6: the place beside the key
    expect(listing.rows.find((row) => row.sessionId === "s-app-1")?.place).toEqual({
      device: world.self,
      placeId: "pl_app",
    });
    // the launcher's and the Peek's latest list carries it too
    const recent = (await world.window.call("index.recent", { scope: "all", limit: 50 })) as {
      rows: Array<{ sessionId: string; projectKey?: string }>;
    };
    expect(recent.rows.find((row) => row.sessionId === "s-app-1")?.projectKey).toBe(
      keyAt("pl_app"),
    );
    // the phone is the person's own device: it reads the same column
    const phone = IndexSessionsResult.parse(
      await world.phone.call("index.sessions", { scope: "local", limit: 500 }),
    );
    expect(phone.rows.find((row) => row.sessionId === "s-app-1")?.projectKey).toBe(keyAt("pl_app"));
    // a peer daemon groups its own: this desktop's aggregate never reaches it
    const peer = IndexSessionsResult.parse(
      await world.peer.call("index.sessions", { scope: "local", limit: 500 }),
    );
    expect(peer.rows.length).toBe(4);
    for (const row of peer.rows) {
      expect(row).not.toHaveProperty("projectKey");
      expect(row).not.toHaveProperty("place");
    }
  }, 30_000);
});

describe("PJ-4 — the merged figures over the real door (H2)", () => {
  it("a window reads a project's figures from this desktop's index, each rosetta project asked once; a peer daemon is refused (DS-L4)", async () => {
    const projects = ProjectListResult.parse(await world.window.call("project.list", {}));
    const app = projects.rows.find((r) => r.places.some((p) => p.ref.placeId === "pl_app"));
    if (app === undefined) throw new Error("no project holds pl_app");
    const figures = ProjectFiguresResult.parse(
      await world.window.call("project.figures", {
        key: app.key,
        sinceMs: 1_000,
        offsetMinutes: -420,
      }),
    );
    // the scripted index answers one golden-shaped day for the app's rosetta
    // project (both its sessions are filed there: a WHOLE part)
    expect(figures.heatmap.map((d) => [d.day, d.tokens])).toEqual([["2026-08-26", 123]]);
    expect(figures.contribution.map((c) => [c.device, c.projectId])).toEqual([
      [world.self, "p-app"],
    ]);
    expect(figures.sources).toEqual([
      expect.objectContaining({ device: world.self, state: "answered", projects: 1, split: 0 }),
    ]);
    expect(figures).toMatchObject({ partial: false, lifetimePartial: false, clipped: false });
    const day = ProjectFiguresDayResult.parse(
      await world.phone.call("project.figuresDay", { key: app.key, day: "2026-08-26" }),
    );
    expect(day.models).toEqual([{ hour: 16, model: "claude-opus-5-5", tokens: 123 }]);
    // a peer daemon never reads this desktop's aggregate
    for (const method of ["project.figures", "project.figuresDay"] as const) {
      const refused = await world.peer.callErr(method, { key: app.key, day: "2026-08-26" });
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
    }
  }, 30_000);
});

// PJ-7 — THE PHONE LAUNCHES INTO A PLACE (build-pj7.md slice 4). A second
// world, over the REAL floor (an agent's birth needs a terminal cell), with the
// sidecar's half stood in by `MeshStandIn` (phone-world.ts says what is real).
// The phone arrives the way it does on the tailnet — the product door's secret
// path and a login header, a self device — and reads, launches and resumes
// with no path on the wire. The place is a git checkout with an identity
// remote: a project, not Temporary, so the launch writes the recipe.

/** Polls an async condition every 100 ms until it holds. */
async function eventually(fn: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > deadline) throw new Error(`not met within ${ms} ms: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(process.platform === "win32")(
  "PJ-7 — the phone launches into a place and resumes with no path (the REAL floor, as a self tailnet phone)",
  () => {
    let phoneWorld: PhoneWorld;
    let phone: WsRpc;
    let local: WsRpc;
    let ref: { device: string; placeId: string };

    beforeAll(async () => {
      phoneWorld = await bootPhoneWorld();
      phone = await open(phoneWorld.doorUrl, { "Tailscale-User-Login": phoneWorld.login });
      const ack = (await phone.call("system.hello", {
        contractsVersion: CONTRACTS_VERSION,
        minCompatible: CONTRACTS_VERSION,
        clientKind: "ios",
      })) as { grantedScopes: string[] };
      expect(ack.grantedScopes).toEqual([...TAILNET_SCOPES]);
      // a window of this desktop, for what only a window does (ending a run)
      local = await open(`ws://127.0.0.1:${phoneWorld.daemon.controlPort}`);
      await helloAs(
        local,
        phoneWorld.daemon.tokens.mint(["agent.spawn", "agent.observe", "terminal.attach"], "pj7")
          .token,
      );
    }, 180_000);

    afterAll(async () => {
      await phoneWorld?.stop();
    }, 60_000);

    const placeRow = async (): Promise<ProjectListResult["rows"][number]> => {
      const page = ProjectListResult.parse(await phone.call("project.list", {}));
      const row = page.rows.find((r) => r.places.some((p) => p.path === phoneWorld.placePath));
      if (row === undefined) throw new Error("the phone's list holds no project at the place");
      return row;
    };

    it("lists the place's project, opens it, launches by its ref: the run starts in the place's folder, the recipe names the place, project.sessions joins the session there, and the field row carries its id", async () => {
      const { daemon, births, placePath } = phoneWorld;
      // list → get, as the phone reads them: a repository, not Temporary
      const listed = await placeRow();
      expect(listed).toMatchObject({ kind: "repo", bucket: null });
      const got = ProjectGetResult.parse(await phone.call("project.get", { key: listed.key }));
      const place = got.project.places.find((p) => p.path === placePath);
      if (place === undefined) throw new Error("project.get answered no place at the path");
      expect(place.ref.device).toBe(daemon.devices.currentDeviceId());
      ref = { device: place.ref.device, placeId: place.ref.placeId };

      // the launch: a provider, a place, an Agent Profile — no path
      const spawned = AgentSpawnResult.parse(
        await born(phone, "agent.spawn", {
          provider: "scripted",
          place: ref,
          profileSet: "native",
        }),
      );
      expect(births.at(-1)?.cwd).toBe(placePath);
      // the self phone's ticket names the tailnet's doors, never this Mac's loopback
      expect(spawned.terminal.endpoints.controlUrl).not.toContain("127.0.0.1");

      // the recipe, written at the confirmed birth, names the place it entered
      let recipe: Record<string, unknown> | undefined;
      await eventually(
        async () => {
          recipe = (await placeRow()).recipe as Record<string, unknown> | undefined;
          return recipe?.["place"] !== undefined;
        },
        15_000,
        "the project's recipe names the place",
      );
      expect(recipe).toMatchObject({ provider: "scripted", profileSet: "native", place: ref });
      const key = (await placeRow()).key;

      // the index reads the conversation (as rosetta would), and the project's
      // sessions join it to that place on this desktop
      const conversation = spawned.session.sessionId;
      phoneWorld.fileConversation(conversation, placePath);
      let joined: ProjectSessionsResult["rows"][number] | undefined;
      await eventually(
        async () => {
          const page = ProjectSessionsResult.parse(await phone.call("project.sessions", { key }));
          joined = page.rows.find((row) => row.nativeSessionId === conversation);
          return joined !== undefined;
        },
        15_000,
        "project.sessions joins the launched session",
      );
      expect(joined).toMatchObject({ device: daemon.devices.currentDeviceId(), place: ref });

      // Jump to: the phone's field row knows the conversation by its id
      const board = (await phone.call("agent.subscribe", { projection: "field" })) as {
        snapshot: { rows: Array<{ runtimeRunId: string; nativeSessionId?: string }> };
      };
      expect(
        board.snapshot.rows.find((row) => row.runtimeRunId === spawned.session.runtimeRunId)
          ?.nativeSessionId,
      ).toBe(conversation);

      await local.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    }, 90_000);

    it("refuses another desktop's place `not-here`, before anything starts", async () => {
      const before = phoneWorld.births.length;
      const refused = await phone.callErr("agent.spawn", {
        provider: "scripted",
        place: { device: "dev-studio", placeId: ref.placeId },
      });
      expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
      expect(refused.data?.details).toMatchObject({
        reason: "not-here",
        place: { device: "dev-studio", placeId: ref.placeId },
      });
      expect(phoneWorld.births).toHaveLength(before);
    }, 30_000);

    it("a native resume with no path runs in the conversation's own folder", async () => {
      const { births, placePath } = phoneWorld;
      const conversation = births[0]!.sessionId;
      let resumed: AgentSpawnResult | undefined;
      // the run the first row ended may still be leaving: a resume beside it is
      // refused `terminal-alive` until it has gone (AR-4b's one-run law)
      await eventually(
        async () => {
          try {
            resumed = AgentSpawnResult.parse(
              await born(phone, "agent.resume", {
                provider: "scripted",
                nativeSessionId: conversation,
              }),
            );
            return true;
          } catch (error) {
            const data = (error as { rpc?: RpcErrorShape }).rpc?.data;
            if ((data?.details as { state?: unknown } | undefined)?.state === "terminal-alive")
              return false;
            throw error;
          }
        },
        15_000,
        "the conversation resumes once its run has ended",
      );
      expect(births.at(-1)).toMatchObject({ resume: conversation, cwd: placePath });
      await local.call("terminal.terminate", { sessionId: resumed!.terminal.sessionId });
    }, 60_000);
  },
);
