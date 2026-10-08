// The real worker and loopback sockets. No file body crosses fieldd RPC.
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectFileExplorerChannel } from "@vibecook/mille/port";
import { connectWebSocketChannel } from "@vibecook/mille/remote";
import {
  WORKSPACE_LIMITS,
  WorkspaceGitOpened,
  WorkspaceGitPortResponse,
} from "@vibefield/contracts";
import { afterEach, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import type { FilesHostLaunch } from "../src/workspace/launch";
import type { AttachRegistration } from "../src/workspace/protocol";
import { FilesHostSupervisor } from "../src/workspace/supervisor";
import { filesHostLaunch } from "./files-host-bundle";
import { until } from "./ws-rpc";

let launch: FilesHostLaunch;
const cleanup: Array<() => void | Promise<void>> = [];
beforeAll(async () => {
  launch = await filesHostLaunch();
}, 60_000);
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vf-attach-")));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "README.md"), "a real file over the direct socket\n");
  writeFileSync(join(root, "src", "main.ts"), "export {};\n");
  const supervisor = new FilesHostSupervisor({
    launch: { kind: "launch", launch },
    timings: { RESTART_BASE_MS: 50, RESTART_MAX_MS: 200 },
  });
  cleanup.push(() => supervisor.stop());
  supervisor.start();
  await until(() => supervisor.health().phase === "ready", 20_000);
  async function ticket(overrides: Partial<AttachRegistration> = {}) {
    const registration: AttachRegistration = {
      attachId: `att_${randomBytes(8).toString("hex")}`,
      rootId: "r_test",
      rootPath: root,
      clientId: "window-one",
      ticket: randomBytes(32).toString("base64url"),
      gitTicket: randomBytes(32).toString("base64url"),
      expiresAt: Date.now() + WORKSPACE_LIMITS.TICKET_TTL_MS,
      ...overrides,
    };
    const { port } = await supervisor.request("registerTicket", registration);
    return { ...registration, port };
  }
  return { root, supervisor, ticket };
}
function connect(
  ticket: AttachRegistration & { port: number },
  credential = ticket.ticket,
  rootId = ticket.rootId,
) {
  return connectWebSocketChannel(`ws://127.0.0.1:${ticket.port}/tree`, {
    exportId: rootId,
    credential,
    access: "read-only",
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
  });
}

/** Does the git leg open with this grant's credential? */
async function gitOpens(ticket: AttachRegistration & { port: number }): Promise<boolean> {
  const git = new WebSocket(`ws://127.0.0.1:${ticket.port}/git`);
  cleanup.push(() => git.terminate());
  await once(git, "open");
  const answer = new Promise<boolean>((resolve) => {
    git.once("message", () => resolve(true));
    git.once("close", () => resolve(false));
  });
  git.send(JSON.stringify({ type: "open", rootId: ticket.rootId, credential: ticket.gitTicket }));
  return answer;
}

/** Both legs of one grant, as the renderer's Worker opens them. */
async function attachBoth(ticket: AttachRegistration & { port: number }) {
  const tree = await connect(ticket);
  cleanup.push(() => tree.close());
  const git = new WebSocket(`ws://127.0.0.1:${ticket.port}/git`);
  cleanup.push(() => git.terminate());
  await once(git, "open");
  const ready = once(git, "message");
  git.send(JSON.stringify({ type: "open", rootId: ticket.rootId, credential: ticket.gitTicket }));
  WorkspaceGitOpened.parse(JSON.parse(String((await ready)[0])));
  let treeOpen = true;
  const treeClosed = new Promise<void>((resolve) =>
    tree.channel.onClose(() => {
      treeOpen = false;
      resolve();
    }),
  );
  const gitClosed = git.readyState === WebSocket.CLOSED ? Promise.resolve() : once(git, "close");
  let probes = 0;
  return {
    tree,
    git,
    /** both legs still serving: the tree's socket open, the git leg answering */
    async alive(): Promise<boolean> {
      if (!treeOpen || git.readyState !== WebSocket.OPEN) return false;
      const id = ++probes;
      const answer = once(git, "message");
      git.send(JSON.stringify({ id, op: "stage", args: ["README.md"] }));
      return WorkspaceGitPortResponse.parse(JSON.parse(String((await answer)[0]))).id === id;
    },
    /** resolves when BOTH legs have closed */
    closed: Promise.all([treeClosed, gitClosed]).then(() => undefined),
  };
}

it("lists, expands, reads and searches on the same engine as row reads; refuses writes and replays", async () => {
  const { root, supervisor, ticket } = await world();
  const listed = await supervisor.request("list", {
    rootPath: root,
    segments: [],
    kinds: "all",
    offset: 0,
    limit: 50,
  });
  const grant = await ticket();
  await expect(connect(grant, grant.ticket, "another-export")).rejects.toThrow();
  await expect(connect(grant, grant.gitTicket)).rejects.toThrow();
  const connection = await connect(grant);
  cleanup.push(() => connection.close());
  expect(connection.accepted.export.access).toBe("read-only");
  expect(connection.accepted.limits.maxFileBytes).toBe(WORKSPACE_LIMITS.MAX_FILE_BYTES);
  const fx = await connectFileExplorerChannel(connection.channel);
  cleanup.push(async () => {
    await fx.dispose();
  });
  await until(() => fx.getSnapshot().roots().length === 1);
  const entry = fx.getSnapshot().roots()[0]!;
  await fx.setExpanded({ add: [entry.id], remove: [] });
  fx.setViewport({ offset: 0, limit: 50 });
  const rows = () =>
    fx.getSnapshot().visibleRows({ offset: 0, limit: 50, expanded: new Set([entry.id]) });
  await until(() => rows().some((row) => row.name === "README.md"));
  const file = rows().find((row) => row.name === "README.md")!;
  expect(file.id).toBe(listed.entries.find((row) => row.name === "README.md")!.id);
  expect(await fx.readText(file.id)).toContain("a real file");
  expect((await fx.search("README")).map((hit) => hit.entry.id)).toContain(file.id);
  await expect(fx.create(entry.id, "refused.txt", 0)).rejects.toMatchObject({ code: "EROFS" });
  await expect(connect(grant)).rejects.toThrow();
  expect((await supervisor.request("stats", {})).engines).toBe(1);
});

it("authorizes the git port separately, refuses writes, and revokes both sockets together", async () => {
  const { supervisor, ticket } = await world();
  const grant = await ticket();
  const tree = await connect(grant);
  cleanup.push(() => tree.close());
  const git = new WebSocket(`ws://127.0.0.1:${grant.port}/git`);
  cleanup.push(() => git.terminate());
  await once(git, "open");
  const opened = once(git, "message");
  git.send(JSON.stringify({ type: "open", rootId: grant.rootId, credential: grant.gitTicket }));
  WorkspaceGitOpened.parse(JSON.parse(String((await opened)[0])));
  const answer = once(git, "message");
  git.send(JSON.stringify({ id: 1, op: "stage", args: ["README.md"] }));
  expect(WorkspaceGitPortResponse.parse(JSON.parse(String((await answer)[0])))).toEqual({
    id: 1,
    ok: false,
    error: "read-only in v1",
  });
  const treeClosed = new Promise<void>((resolve) => tree.channel.onClose(() => resolve()));
  const gitClosed = once(git, "close");
  await supervisor.request("revokeClient", { clientId: grant.clientId });
  await Promise.all([treeClosed, gitClosed]);
  await expect(connect(grant)).rejects.toThrow();
});

it("R1: an established session outlives its ticket's expiry; an unredeemed or half-redeemed pair does not", async () => {
  const { ticket } = await world();
  const expiresAt = Date.now() + 2_000;
  const live = await attachBoth(await ticket({ expiresAt }));
  const unused = await ticket({ expiresAt });
  const half = await ticket({ expiresAt });
  const halfTree = await connect(half);
  cleanup.push(() => halfTree.close());
  const halfClosed = new Promise<void>((resolve) => halfTree.channel.onClose(() => resolve()));
  let liveClosed = false;
  void live.closed.then(() => {
    liveClosed = true;
  });
  // the pair whose git leg never came is dropped at expiry, both legs together
  await halfClosed;
  await until(() => Date.now() > expiresAt + 1_000, 5_000);
  // the unused ticket is refused past its expiry, on either leg
  await expect(connect(unused)).rejects.toThrow();
  expect(await gitOpens(half)).toBe(false);
  // the established one is untouched: no revoke, both legs serving
  expect(liveClosed).toBe(false);
  expect(await live.alive()).toBe(true);
  const fx = await connectFileExplorerChannel(live.tree.channel);
  cleanup.push(async () => {
    await fx.dispose();
  });
  await until(() => fx.getSnapshot().roots().length === 1);
  expect(liveClosed).toBe(false);
}, 20_000);

it("R1: every real loss still ends both legs together", async () => {
  const { root, supervisor, ticket } = await world();
  const causes: Array<[string, (grant: AttachRegistration) => Promise<unknown>]> = [
    [
      "workspace.closeTicket",
      (grant) =>
        supervisor.request("closeTicket", { clientId: grant.clientId, ticket: grant.ticket }),
    ],
    [
      "principal revoked",
      (grant) => supervisor.request("revokeClient", { clientId: grant.clientId }),
    ],
    ["root withdrawn", () => supervisor.request("retainRoots", { rootIds: [] })],
  ];
  for (const [cause, end] of causes) {
    const grant = await ticket({ expiresAt: Date.now() + 1_000 });
    const session = await attachBoth(grant);
    await until(() => Date.now() > grant.expiresAt + 200, 5_000);
    expect(await session.alive(), cause).toBe(true);
    await end(grant);
    await session.closed;
  }
  for (const leg of ["tree", "git"] as const) {
    const session = await attachBoth(await ticket());
    if (leg === "tree") session.tree.close();
    else session.git.close();
    await session.closed;
  }
  // a folder swapped for a link elsewhere is a root lost (ATTACHED_ROOT_CHECK_MS)
  const swapped = await attachBoth(await ticket());
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "vf-attach-elsewhere-")));
  cleanup.push(() => rmSync(elsewhere, { recursive: true, force: true }));
  renameSync(root, `${root}.moved`);
  cleanup.push(() => rmSync(`${root}.moved`, { recursive: true, force: true }));
  symlinkSync(elsewhere, root);
  cleanup.push(() => rmSync(root, { force: true }));
  await swapped.closed;
}, 45_000);

it("applies session caps and confines cancellation to its principal", async () => {
  const { supervisor, ticket } = await world();
  const held = await Promise.all(
    Array.from({ length: WORKSPACE_LIMITS.SESSIONS_PER_CLIENT }, () => ticket()),
  );
  await expect(ticket()).rejects.toMatchObject({ error: { code: "busy" } });
  expect(
    await supervisor.request("closeTicket", {
      clientId: "different-window",
      ticket: held[0]!.ticket,
    }),
  ).toBe(false);
  expect(
    await supervisor.request("closeTicket", {
      clientId: held[0]!.clientId,
      ticket: held[0]!.ticket,
    }),
  ).toBe(true);
  await ticket();
  await supervisor.request("retainRoots", { rootIds: [] });
  await expect(connect(held[1]!)).rejects.toThrow();
  await ticket();
});

it("dies mid-session and serves a fresh snapshot on the next worker generation", async () => {
  const { root, supervisor, ticket } = await world();
  const session = await attachBoth(await ticket());
  process.kill(supervisor.health().pid!, "SIGKILL");
  await session.closed;
  writeFileSync(join(root, "after-restart.txt"), "new");
  await until(
    () => supervisor.health().generation > 1 && supervisor.health().phase === "ready",
    20_000,
  );
  const next = await connect(await ticket());
  cleanup.push(() => next.close());
  const fx = await connectFileExplorerChannel(next.channel);
  cleanup.push(async () => {
    await fx.dispose();
  });
  await until(() => fx.getSnapshot().roots().length === 1);
  const entry = fx.getSnapshot().roots()[0]!;
  await fx.setExpanded({ add: [entry.id], remove: [] });
  fx.setViewport({ offset: 0, limit: 50 });
  await until(() =>
    fx
      .getSnapshot()
      .visibleRows({ offset: 0, limit: 50, expanded: new Set([entry.id]) })
      .some((row) => row.name === "after-restart.txt"),
  );
});

it("withdraws an attached root that disappears without another door read", async () => {
  const { root, ticket } = await world();
  const session = await attachBoth(await ticket());
  let closed = false;
  void session.closed.then(() => {
    closed = true;
  });
  rmSync(root, { recursive: true, force: true });
  await until(() => closed, WORKSPACE_LIMITS.ATTACHED_ROOT_CHECK_MS + 5_000);
}, 30_000);

it("a stopping worker (fieldd's stop) ends both legs", async () => {
  const { supervisor, ticket } = await world();
  const session = await attachBoth(await ticket());
  await supervisor.stop();
  await session.closed;
});
