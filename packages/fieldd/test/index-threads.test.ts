// AR-8 (build-hf.md L1, the lead's decision 2026-10-08) — `index.threads`, the
// window's door on this desktop's DELEGATED threads. rosettad's meta stream
// sends every child session; the catalog kept them out of `sessions` by design
// (its rows are the listing, the figures, the replica and the phone), so the
// History room never saw a subthread and dropped every search hit inside one.
// They are held now in a local-only third table, and this door pages it.
//
// The first block is the caller rule alone. The rest is ONE real daemon over
// the scripted rosettad (fixtures/fake-rosettad.mjs) holding two roots and
// three children, reached the ways a caller arrives: a window by a local token,
// the phone and a guest through the sidecar's door, and a peer daemon from a
// node the roster vouches for (D1). The rows: the window pages the threads by
// keyset; nothing that is not a window is served; every roots-only reader is
// as it was; and the change pings name the table when a thread moves.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CallerContext,
  CONTRACTS_VERSION,
  IndexProjectsResult,
  IndexSessionsResult,
  IndexThread,
  IndexThreadsResult,
  type Principal,
  SOCKETS,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { checkThreadsCaller } from "../src/index-threads";
import { RpcCallError } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

// ── the rule ────────────────────────────────────────────────────────────────

const ctxOf = (principal: Principal): CallerContext =>
  ({ principal, transport: "ws-loopback" }) as unknown as CallerContext;

describe("index.threads — who may ask (AR-8 L1)", () => {
  it("serves this desktop's window and shell, and refuses every other principal before a row is read", () => {
    for (const principal of [
      { kind: "local-token", tokenId: "tk-window", scopes: ["index.search"] },
      { kind: "shell-main", tokenId: "tk-shell", scopes: ["index.search"] },
    ] satisfies Principal[]) {
      expect(() => checkThreadsCaller(ctxOf(principal)), principal.kind).not.toThrow();
    }
    for (const principal of [
      { kind: "plugin", id: "plugin-a", scopes: ["index.search"] },
      { kind: "mcp-agent", sessionId: "mcp-a", scopes: ["index.search"] },
      { kind: "tailnet", login: TEST_LOGIN, self: true },
      { kind: "tailnet-guest", login: "else@example.com" },
      { kind: "peer-fieldd", deviceId: "dev-c" },
    ] satisfies Principal[]) {
      let refused: unknown;
      try {
        checkThreadsCaller(ctxOf(principal));
      } catch (error) {
        refused = error;
      }
      expect(refused, principal.kind).toBeInstanceOf(RpcCallError);
      expect(refused, principal.kind).toMatchObject({
        kind: "FORBIDDEN_SCOPE",
        retryable: false,
        details: { method: "index.threads", principal: principal.kind },
      });
    }
  });
});

// ── the door, on a real daemon ──────────────────────────────────────────────

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");

/** rosetta's SessionRow, as the scripted daemon serves it */
const sessionRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  native_session_id: `nat-${id}`,
  root_session_id: id,
  parent_session_id: null,
  runtime_id: "rt-claude",
  project_id: "p-app",
  cwd: "/work/app",
  title: `title ${id}`,
  summary: null,
  started_at: 1_000,
  updated_at: 2_000,
  activity: { first_at: 1_000, last_at: 5_000 },
  stream_state: "indexed",
  role: "main",
  delegation: null,
  ...over,
});
const child = (id: string, parent: string, root: string, over: Record<string, unknown> = {}) =>
  sessionRow(id, {
    parent_session_id: parent,
    root_session_id: root,
    role: "subagent",
    delegation: { parent_tool_native_id: `toolu-${id}` },
    ...over,
  });

const ROOTS = [sessionRow("r1"), sessionRow("r2", { activity: { first_at: 1, last_at: 9_000 } })];
const CHILDREN = [
  child("c1", "r1", "r1"),
  child("c2", "c1", "r1", { role: "team", delegation: { team: "crew", color: "green" } }),
  child("c3", "r2", "r2", { delegation: null }),
];

let cleanup: Array<() => void | Promise<void>> = [];

interface World {
  daemon: FielddDaemon;
  sessionsFile: string;
  window: WsRpc;
  phone: WsRpc;
  guest: WsRpc;
  peer: WsRpc;
}
let world: World;

/** The peer link's dialer: this world has one desktop, so nothing answers. */
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

/** The door the way the SIDECAR delivers a tailnet caller. */
async function tailnet(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  headers: Record<string, string>,
  clientKind: "ios" | "peer-fieldd",
): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, headers);
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    ...(clientKind === "peer-fieldd" ? { deviceId: "dev-c" } : {}),
  });
  return rpc;
}

beforeAll(async () => {
  // a SHORT root: the mock mgmt socket must stay inside macOS's sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-thr-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  // the desktop has an account: an unlinked one mints guests at the door
  writeLinkFixture(dataDir, TEST_LOGIN);
  const files = {
    sessions: join(dataDir, "sessions.json"),
    projects: join(dataDir, "projects.json"),
    runtimes: join(dataDir, "runtimes.json"),
    control: join(dataDir, "control.json"),
  };
  writeFileSync(files.sessions, JSON.stringify([...ROOTS, ...CHILDREN]));
  writeFileSync(
    files.projects,
    JSON.stringify([{ id: "p-app", name: "app", root_paths: ["/work/app"], git_repo: null }]),
  );
  writeFileSync(
    files.runtimes,
    JSON.stringify([
      { id: "rt-claude", kind: "claude-code", data_root: "~/.claude", enabled: true },
    ]),
  );
  writeFileSync(files.control, "{}");

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  // D1 — the roster vouches for a peer desktop, so a hello from its node is
  // minted `peer-fieldd`
  mock.meshPeers = [
    registryPeer({ nodeId: "node-c", deviceId: "dev-c", name: "device-c", login: TEST_LOGIN }),
  ];
  mock.storeSlices = new Map<string, unknown>([["dev-c", desktopSlice("dev-c", "device-c")]]);
  await mock.start();
  cleanup.push(() => mock.stop());

  const env = {
    FAKE_ROSETTAD_MODE: "ok",
    FAKE_ROSETTAD_SESSIONS: files.sessions,
    FAKE_ROSETTAD_PROJECTS: files.projects,
    FAKE_ROSETTAD_RUNTIMES: files.runtimes,
    FAKE_ROSETTAD_META_CONTROL: files.control,
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
    indexMesh: { changesMinIntervalMs: 20 },
  });
  cleanup.push(() => daemon.stop());

  await until(() => daemon.health().rosettad.phase === "ready", 15_000);
  await until(() => daemon.indexCatalog.ready, 30_000);
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  await until(() => daemon.devices.currentDeviceId() === mock.meshDeviceId, 15_000);
  await until(() => daemon.devices.isDocHost("dev-c"), 15_000);

  const window = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(window, daemon.tokens.mint(["index.read", "index.search"], "thr-window").token);
  world = {
    daemon,
    sessionsFile: files.sessions,
    window,
    phone: await tailnet(daemon, mock, { "Tailscale-User-Login": TEST_LOGIN }, "ios"),
    guest: await tailnet(daemon, mock, { "Tailscale-User-Login": "else@example.com" }, "ios"),
    peer: await tailnet(
      daemon,
      mock,
      { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-c" },
      "peer-fieldd",
    ),
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

describe("index.threads — the delegated threads, a window's door (AR-8 L1)", () => {
  it("the window pages every thread by keyset — by root, then by id — each where it hangs, with no device", async () => {
    const first = IndexThreadsResult.parse(await world.window.call("index.threads", { limit: 2 }));
    expect(first.rows.map((row) => row.sessionId)).toEqual(["c1", "c2"]);
    expect(first.cursor).toBeDefined();
    const second = IndexThreadsResult.parse(
      await world.window.call("index.threads", { limit: 2, cursor: first.cursor }),
    );
    expect(second.rows.map((row) => row.sessionId)).toEqual(["c3"]);
    expect(second.cursor).toBeUndefined();
    const [c1, c2, c3] = [...first.rows, ...second.rows];
    expect(c1).toMatchObject({
      parentSessionId: "r1",
      rootSessionId: "r1",
      role: "subagent",
      delegation: { parentToolNativeId: "toolu-c1" },
      kind: "claude-code",
      projectId: "p-app",
    });
    expect(c2).toMatchObject({
      parentSessionId: "c1",
      rootSessionId: "r1",
      role: "team",
      delegation: { team: "crew", color: "green" },
    });
    expect(c3).toMatchObject({ parentSessionId: "r2", rootSessionId: "r2", delegation: null });
    for (const row of [c1, c2, c3]) {
      expect(IndexThread.safeParse(row).success).toBe(true);
      expect(row).not.toHaveProperty("device");
    }
    // a cursor this door did not issue is the caller's to fix
    const bad = await world.window.callErr("index.threads", { cursor: "not-a-cursor" });
    expect(bad.data?.kind).toBe("PRECONDITION_FAILED");
  }, 30_000);

  it("every roots-only reader is as it was: the listing, the project's count, the peer's replication door", async () => {
    const sessions = IndexSessionsResult.parse(await world.window.call("index.sessions", {}));
    expect(sessions.rows.map((row) => row.sessionId).sort()).toEqual(["r1", "r2"]);
    const projects = IndexProjectsResult.parse(await world.window.call("index.projects", {}));
    expect(projects.rows[0]).toMatchObject({ projectId: "p-app", sessionCount: 2 });
    // the phone's listing too: roots alone
    const phone = IndexSessionsResult.parse(await world.phone.call("index.sessions", {}));
    expect(phone.rows.map((row) => row.sessionId).sort()).toEqual(["r1", "r2"]);
    // a peer replicates the two tables it always did — never the threads
    const refused = await world.peer.callErr("index.catalog.subscribe", { table: "threads" });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    const replicated = (await world.peer.call("index.catalog.subscribe", {
      table: "sessions",
    })) as { snapshot: { snapshot?: { rows: Array<{ sessionId: string }> } } };
    expect(replicated.snapshot.snapshot?.rows.map((row) => row.sessionId).sort()).toEqual([
      "r1",
      "r2",
    ]);
  }, 30_000);

  it("nothing that is not this desktop's window is served: the phone and a guest at the door, a peer daemon at the D36 wall", async () => {
    const phone = await world.phone.callErr("index.threads", {});
    expect(phone.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(phone.data?.details).toEqual({ method: "index.threads", principal: "tailnet" });
    const guest = await world.guest.callErr("index.threads", {});
    expect(guest.data?.kind).toBe("FORBIDDEN_SCOPE");
    const peer = await world.peer.callErr("index.threads", {});
    expect(peer.data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);

  it("a thread that moves pings a local History page by name; a root's leaving takes its threads", async () => {
    const opened = (await world.window.call("index.changes.subscribe", { scope: "local" })) as {
      subId: string;
    };
    const pings = (): Array<{ tables?: string[] }> =>
      world.window.notifications
        .filter((frame) => frame.params.subId === opened.subId)
        .map((frame) => frame.params.payload as { tables?: string[] });
    const before = pings().length;
    writeFileSync(
      world.sessionsFile,
      JSON.stringify([...ROOTS, ...CHILDREN, child("c4", "r2", "r2")]),
    );
    await until(
      () =>
        pings()
          .slice(before)
          .some((ping) => ping.tables?.includes("threads")),
      10_000,
    );
    expect(
      pings()
        .slice(before)
        .flatMap((ping) => ping.tables ?? []),
    ).not.toContain("sessions");
    const threads = IndexThreadsResult.parse(await world.window.call("index.threads", {}));
    expect(threads.rows.map((row) => row.sessionId)).toEqual(["c1", "c2", "c3", "c4"]);

    // r2 leaves without a word; the re-snapshot finds it — and its threads go
    // with it, though the stream still names them
    writeFileSync(
      world.sessionsFile,
      JSON.stringify([ROOTS[0], ...CHILDREN, child("c4", "r2", "r2")]),
    );
    world.daemon.indexCatalog.resnapshot();
    await until(() => !world.daemon.indexCatalog.sessions.has("r2"), 10_000);
    const after = IndexThreadsResult.parse(await world.window.call("index.threads", {}));
    expect(after.rows.map((row) => row.sessionId)).toEqual(["c1", "c2"]);
  }, 30_000);
});
