// The real worker and loopback sockets. No file body crosses fieldd RPC.
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

it("expires pending and attached tickets, applies session caps, and confines cancellation to its principal", async () => {
  const { supervisor, ticket } = await world();
  const expiring = await ticket({ expiresAt: Date.now() + 2_000 });
  const tree = await connect(expiring);
  cleanup.push(() => tree.close());
  await new Promise<void>((resolve) => tree.channel.onClose(() => resolve()));
  await expect(connect(expiring)).rejects.toThrow();
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
  const grant = await ticket();
  const tree = await connect(grant);
  cleanup.push(() => tree.close());
  const closed = new Promise<void>((resolve) => tree.channel.onClose(() => resolve()));
  process.kill(supervisor.health().pid!, "SIGKILL");
  await closed;
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
  const tree = await connect(await ticket());
  cleanup.push(() => tree.close());
  let closed = false;
  tree.channel.onClose(() => {
    closed = true;
  });
  rmSync(root, { recursive: true, force: true });
  await until(() => closed, WORKSPACE_LIMITS.ATTACHED_ROOT_CHECK_MS + 5_000);
}, 30_000);
