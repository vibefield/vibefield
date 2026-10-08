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
  CONTRACTS_VERSION,
  computeEffectiveGrants,
  LAYOUT,
  PEER_FIELDD_SCOPES,
  type PlaceFacts,
  ProjectChangesDelta,
  ProjectGetResult,
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
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

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
    daemon.tokens.mint(["project.read", "settings.manage"], "pj3-window").token,
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

  it("only a desktop window acts (P2): the phone is refused; the window hears the records are not built yet", async () => {
    const page = ProjectListResult.parse(await world.window.call("project.list", {}));
    const key = keyOf(page, "app");
    const fromPhone = await world.phone.callErr("project.intent", { key, op: "rename", name: "A" });
    expect(fromPhone.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(fromPhone.data?.details).toEqual({ required: "settings.manage" });
    const fromWindow = await world.window.callErr("project.intent", {
      key,
      op: "rename",
      name: "App",
    });
    expect(fromWindow.data?.kind).toBe("UNAVAILABLE");
    expect(fromWindow.data?.details).toEqual({ service: "projects", state: "records-unbuilt" });
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
