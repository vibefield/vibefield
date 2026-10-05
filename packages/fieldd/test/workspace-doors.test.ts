// FS-1a — the files service's DOOR TIER through a booted fieldd and its REAL
// worker (`workspace.*`, workspace/doors.ts). The rows answer to the brief's
// witnesses: who is served and who is refused (FS-D6 (a) — by PRINCIPAL, not
// scope: a window, a self phone and a self peer daemon read; a renderer
// plugin, a service plugin, an MCP agent and a tailnet guest are refused
// FORBIDDEN_SCOPE whatever they hold); the request path rule at the door
// (`..`, absolute, a symlink out); pages and cursors, a phone's cut at the
// tailnet page (L4); a search and a git root's facts; a place gone missing
// (never dropped); the roots as rows (L3); the worker killed mid-life — the
// door honest (UNAVAILABLE restarting) and recovered; the L6 knob (`off`).
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CallerContext,
  CONTRACTS_VERSION,
  type Scope,
  SOCKETS,
  WORKSPACE_LIMITS,
  WorkspaceGitFactsResult,
  WorkspaceListResult,
  type WorkspaceRoot,
  WorkspaceRootsDelta,
  WorkspaceRootsOpen,
  WorkspaceRootsResult,
  WorkspaceSearchResult,
  WorkspaceUnavailableDetails,
} from "@vibefield/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import type { BrowseFacts } from "../src/workspace/browse-exports";
import type { FilesHostLaunch } from "../src/workspace/launch";
import { rootIdFor } from "../src/workspace/paths";
import { filesHostLaunch } from "./files-host-bundle";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

let launch: FilesHostLaunch;
beforeAll(async () => {
  launch = await filesHostLaunch();
}, 60_000);

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

const DOORS = [
  ["workspace.roots", {}],
  ["workspace.list", { rootId: "r_x" }],
  ["workspace.search", { rootId: "r_x", q: "x" }],
  ["workspace.gitFacts", { rootId: "r_x" }],
] as const;

interface World {
  daemon: FielddDaemon;
  mock: MockMgmtServer;
  home: string;
  outside: string;
}

/** A home of the test's own: a wide folder, a git repository, a link out. */
function homeTree(): { home: string; outside: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-wsd-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "home");
  const outside = join(base, "outside");
  mkdirSync(join(outside, "private"), { recursive: true });
  for (let i = 0; i < 230; i += 1)
    mkdirSync(join(home, "wide", `f${String(i).padStart(3, "0")}`), { recursive: true });
  mkdirSync(join(home, "Projects", "repo", "src"), { recursive: true });
  writeFileSync(join(home, "Projects", "repo", "src", "a.ts"), "one\n");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: join(home, "Projects", "repo"),
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Ada",
        GIT_AUTHOR_EMAIL: "ada@example.com",
        GIT_COMMITTER_NAME: "Ada",
        GIT_COMMITTER_EMAIL: "ada@example.com",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  writeFileSync(join(home, "Projects", "repo", "src", "a.ts"), "two\n");
  symlinkSync(outside, join(home, "escape"));
  return { home, outside };
}

/** The browse enumerator over the test's home, no volumes. The home's real
 * path is read as the alias it was made through: macOS keeps temporary
 * folders under /private, which is never exported. */
function browseOf(home: string): () => BrowseFacts {
  return () => ({
    platform: process.platform,
    home,
    user: "",
    fs: {
      readdir: () => [],
      realpath: (path) => path.replace(/^\/private\//, "/"),
      isDirectory: (path) => existsSync(path),
      exists: existsSync,
    },
  });
}

async function boot(opts: { filesHost?: false } = {}): Promise<World> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-wsd-d-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir, TEST_LOGIN);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const { home, outside } = homeTree();
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    allowedOrigins: ["file://"],
    filesHost: opts.filesHost === false ? false : launch,
    filesHostTimings: { RESTART_BASE_MS: 50, RESTART_MAX_MS: 200 },
    workspace: { browse: browseOf(home), isExcluded: () => false, rootsPollMs: 100 },
  });
  cleanup.push(() => daemon.stop());
  if (opts.filesHost !== false)
    await until(() => daemon.workspace.supervisor.health().phase === "ready", 20_000);
  return { daemon, mock, home, outside };
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

/** A renderer window on this desktop holding `scopes`, as the shell mints it. */
async function windowOf(daemon: FielddDaemon, scopes: Scope[]): Promise<WsRpc> {
  const shell = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: "window-fs",
    rendererParticipant: {
      participantId: "renderer:fs:w1",
      incarnation: "renderer:fs:w1:document-1",
    },
  })) as { token: string };
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(rpc, minted.token);
  return rpc;
}

/** A renderer PLUGIN's token holding `workspace.read` (`{kind: "plugin"}`). */
async function pluginOf(daemon: FielddDaemon): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(
    rpc,
    daemon.tokens.mint(["workspace.read"], "fs-plugin", { pluginId: "example.files" }).token,
  );
  return rpc;
}

/** The product door the way the SIDECAR delivers a tailnet caller. */
async function tailnetCaller(world: World, login: string): Promise<WsRpc> {
  await until(() => world.mock.meshServes.get("product") !== undefined, 15_000);
  const rpc = await open(
    `ws://127.0.0.1:${world.daemon.controlPort}${productDoorPath(world.mock)}`,
    { "Tailscale-User-Login": login },
  );
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
}

function homeRoot(roots: WorkspaceRootsResult) {
  const home = roots.roots.find((root) => root.browse === "home");
  if (home === undefined) throw new Error("no home root");
  return home;
}

const ctxOf = (principal: CallerContext["principal"], transport: CallerContext["transport"]) =>
  ({ principal, transport, receivedAt: Date.now() }) as CallerContext;

describe("the door tier, by principal (FS-D6 (a))", () => {
  it("serves a window: the roots, a folder page by page, a search, a repository's facts", async () => {
    const world = await boot();
    const win = await windowOf(world.daemon, ["workspace.read"]);
    const roots = WorkspaceRootsResult.parse(await win.call("workspace.roots", {}));
    const home = homeRoot(roots);
    expect(home).toMatchObject({
      rootId: rootIdFor("browse", world.home),
      path: world.home,
      kind: "browse",
      device: world.daemon.devices.currentDeviceId(),
      missing: false,
    });
    const first = WorkspaceListResult.parse(
      await win.call("workspace.list", { rootId: home.rootId, path: "wide" }),
    );
    expect(first.entries).toHaveLength(WORKSPACE_LIMITS.LIST_PAGE);
    expect(first).toMatchObject({ clipped: true, nextCursor: "o:200", total: 230 });
    expect(first.path).toBe(join(world.home, "wide"));
    expect(first.entries[0]?.path).toBe(join(world.home, "wide", "f000"));
    const second = WorkspaceListResult.parse(
      await win.call("workspace.list", {
        rootId: home.rootId,
        path: "wide",
        cursor: first.nextCursor,
      }),
    );
    expect(second.entries.map((entry) => entry.name)[0]).toBe("f200");
    expect(second).toMatchObject({ clipped: false, nextCursor: null });
    // folders only by default; files beside them on `all`
    const top = WorkspaceListResult.parse(
      await win.call("workspace.list", { rootId: home.rootId }),
    );
    expect(top.entries.map((entry) => entry.name)).toEqual(["Projects", "wide"]);
    const all = WorkspaceListResult.parse(
      await win.call("workspace.list", { rootId: home.rootId, kinds: "all" }),
    );
    expect(all.entries.map((entry) => entry.name)).toContain("escape");
    const found = WorkspaceSearchResult.parse(
      await win.call("workspace.search", { rootId: home.rootId, q: "repo", kinds: "dirs" }),
    );
    expect(found.hits.map((hit) => hit.path)).toEqual([join(world.home, "Projects", "repo")]);
    expect(found).toMatchObject({ rootId: home.rootId, clipped: false, complete: true });
    // a place: the repository, as a spawn there makes it
    world.daemon.workspace.registry.touchPlace(join(world.home, "Projects", "repo"));
    const facts = WorkspaceGitFactsResult.parse(
      await win.call("workspace.gitFacts", {
        rootId: rootIdFor("place", join(world.home, "Projects", "repo")),
      }),
    );
    expect(facts).toMatchObject({ branch: "main", dirty: 1 });
    expect(
      WorkspaceGitFactsResult.parse(await win.call("workspace.gitFacts", { rootId: home.rootId })),
    ).toBeNull();
  });

  it("refuses a plugin (renderer or service), an MCP agent and a guest — whatever they hold", async () => {
    const world = await boot();
    const plugin = await pluginOf(world.daemon);
    for (const [method, params] of DOORS) {
      const error = await plugin.callErr(method, params);
      expect(error.data?.kind, method).toBe("FORBIDDEN_SCOPE");
    }
    const pluginSub = await plugin.callErr("workspace.subscribe", { scope: "roots" });
    expect(pluginSub.data?.kind).toBe("FORBIDDEN_SCOPE");
    const guest = await tailnetCaller(world, "someone-else@example.com");
    for (const [method, params] of DOORS) {
      const error = await guest.callErr(method, params);
      expect(error.data?.kind, method).toBe("FORBIDDEN_SCOPE");
    }
    // the kinds no WebSocket here can be: a service plugin over its in-process
    // port, an MCP agent over the MCP door — the door reads the principal
    const doors = world.daemon.workspace.doors;
    for (const principal of [
      { kind: "plugin", id: "example.files", scopes: ["workspace.read"] },
      { kind: "mcp-agent", sessionId: "s1", scopes: ["workspace.read"] },
      { kind: "tailnet-guest", login: "x@example.com" },
      // a tailnet principal that is not the owner's own is refused as well
      { kind: "tailnet", login: TEST_LOGIN },
    ] as const) {
      const ctx = ctxOf(principal as CallerContext["principal"], "inproc-port");
      expect(() => doors.roots(ctx, {}), principal.kind).toThrow(
        expect.objectContaining({ kind: "FORBIDDEN_SCOPE" }),
      );
      await expect(doors.list(ctx, { rootId: "r_x" }), principal.kind).rejects.toMatchObject({
        kind: "FORBIDDEN_SCOPE",
      });
    }
  });

  it("serves the owner's phone at the tailnet's page, and a self peer daemon at a window's", async () => {
    const world = await boot();
    const phone = await tailnetCaller(world, TEST_LOGIN);
    const roots = WorkspaceRootsResult.parse(await phone.call("workspace.roots", {}));
    const home = homeRoot(roots);
    const page = WorkspaceListResult.parse(
      await phone.call("workspace.list", { rootId: home.rootId, path: "wide", limit: 200 }),
    );
    expect(page.entries).toHaveLength(WORKSPACE_LIMITS.TAILNET_PAGE);
    expect(page).toMatchObject({ clipped: true, nextCursor: "o:100", total: 230 });
    // the absolute path rides the answer: the phone copies it into a prompt
    expect(page.entries[0]?.path).toBe(join(world.home, "wide", "f000"));
    const peer = ctxOf({ kind: "peer-fieldd", deviceId: "dev_other" }, "ws-tailnet");
    const peerPage = await world.daemon.workspace.doors.list(peer, {
      rootId: home.rootId,
      path: "wide",
    });
    expect(peerPage.entries).toHaveLength(WORKSPACE_LIMITS.LIST_PAGE);
  });
});

describe("the path rule at the door (FS-D4: requests confined)", () => {
  it("refuses a climb and an absolute path as the caller's to fix, a link out as absent", async () => {
    const world = await boot();
    const win = await windowOf(world.daemon, ["workspace.read"]);
    const home = homeRoot(WorkspaceRootsResult.parse(await win.call("workspace.roots", {})));
    for (const path of ["..", "wide/../..", world.outside, "/etc", "C:\\Windows", "a\\b"]) {
      const error = await win.callErr("workspace.list", { rootId: home.rootId, path });
      expect(error.data?.kind, path).toBe("PRECONDITION_FAILED");
    }
    for (const path of ["escape", "escape/private", "no-such-folder"]) {
      const error = await win.callErr("workspace.list", { rootId: home.rootId, path });
      expect(error.data?.kind, path).toBe("NOT_FOUND");
    }
    expect((await win.callErr("workspace.list", { rootId: "r_unknown" })).data?.kind).toBe(
      "NOT_FOUND",
    );
    expect(
      (await win.callErr("workspace.list", { rootId: home.rootId, cursor: "page-2" })).data?.kind,
    ).toBe("PRECONDITION_FAILED");
    expect((await win.callErr("workspace.list", { path: "x" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
  });
});

describe("places, rows and the worker's life", () => {
  it("keeps a place whose folder vanished as missing, and its doors answer NOT_FOUND", async () => {
    const world = await boot();
    const win = await windowOf(world.daemon, ["workspace.read"]);
    const place = join(world.home, "Projects", "repo");
    world.daemon.workspace.registry.touchPlace(place);
    rmSync(place, { recursive: true });
    const roots = WorkspaceRootsResult.parse(await win.call("workspace.roots", {}));
    expect(roots.roots.find((root) => root.path === place)).toMatchObject({
      kind: "place",
      missing: true,
    });
    const error = (await win.callErr("workspace.list", {
      rootId: rootIdFor("place", place),
    })) as RpcErrorShape;
    expect(error.data).toMatchObject({ kind: "NOT_FOUND", details: { missing: true } });
  });

  it("streams the roots as rows: the snapshot, then a place's arrival", async () => {
    const world = await boot();
    const win = await windowOf(world.daemon, ["workspace.read"]);
    const opened = (await win.call("workspace.subscribe", { scope: "roots" })) as {
      subId: string;
      snapshot: unknown;
    };
    WorkspaceRootsOpen.parse(opened.snapshot);
    const open = opened.snapshot as { snapshot?: { rows: WorkspaceRoot[] } };
    if (open.snapshot === undefined) throw new Error("expected a snapshot");
    expect(open.snapshot.rows.map((row) => row.kind)).toEqual(["browse"]);
    const place = join(world.home, "wide", "f007");
    world.daemon.workspace.registry.touchPlace(place);
    await until(
      () =>
        win.notifications.some(
          (frame) =>
            frame.method === "workspace.delta" &&
            WorkspaceRootsDelta.safeParse(frame.params.payload).success &&
            WorkspaceRootsDelta.parse(frame.params.payload).upserts.some(
              (row) => row.path === place,
            ),
        ),
      5_000,
    );
  });

  it("answers UNAVAILABLE restarting while a killed worker comes back, then serves again", async () => {
    const world = await boot();
    const win = await windowOf(world.daemon, ["workspace.read"]);
    const home = homeRoot(WorkspaceRootsResult.parse(await win.call("workspace.roots", {})));
    const before = world.daemon.workspace.supervisor.health();
    process.kill(before.pid as number, "SIGKILL");
    await until(() => world.daemon.workspace.supervisor.health().phase !== "ready", 5_000);
    const error = await win.callErr("workspace.list", { rootId: home.rootId });
    expect(error.data).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(WorkspaceUnavailableDetails.parse(error.data?.details)).toEqual({
      service: "workspace",
      state: "restarting",
    });
    await until(() => world.daemon.workspace.supervisor.health().phase === "ready", 20_000);
    expect(world.daemon.workspace.supervisor.health().generation).toBe(before.generation + 1);
    const page = WorkspaceListResult.parse(
      await win.call("workspace.list", { rootId: home.rootId }),
    );
    expect(page.entries.map((entry) => entry.name)).toEqual(["Projects", "wide"]);
  });

  it("answers UNAVAILABLE off when the worker is switched off (L6), roots still listed", async () => {
    const world = await boot({ filesHost: false });
    const win = await windowOf(world.daemon, ["workspace.read"]);
    const home = homeRoot(WorkspaceRootsResult.parse(await win.call("workspace.roots", {})));
    const error = await win.callErr("workspace.list", { rootId: home.rootId });
    expect(error.data).toMatchObject({ kind: "UNAVAILABLE", retryable: false });
    expect(WorkspaceUnavailableDetails.parse(error.data?.details).state).toBe("off");
  });
});
