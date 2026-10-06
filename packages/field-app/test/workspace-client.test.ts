import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeHostEvent } from "@rosetta/room";
import {
  WORKSPACE_LIMITS,
  WorkspaceOpenTicketResult,
  WorkspacePickFolderResult,
  WorkspaceRootsResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceRoot, WorkspaceClient } from "../src/workspace/client";

const fixtures = join(import.meta.dirname, "../../contracts/fixtures");
const roots = WorkspaceRootsResult.parse(
  JSON.parse(readFileSync(join(fixtures, "workspace-roots.valid.json"), "utf8")),
);
const grant = WorkspaceOpenTicketResult.parse(
  JSON.parse(readFileSync(join(fixtures, "workspace-open-ticket.valid.json"), "utf8")),
);
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
  vi.useRealTimers();
});
function world() {
  const workers: FakeWorker[] = [];
  const copied = vi.fn(async () => {});
  let count = 0;
  const request = vi.fn(
    async (method: string, params: Record<string, unknown>): Promise<unknown> => {
      if (method === "workspace.roots") return roots;
      if (method === "workspace.openTicket")
        return {
          ...grant,
          ticket: String(++count).repeat(43),
          expiresAt: Date.now() + WORKSPACE_LIMITS.TICKET_TTL_MS,
        };
      if (method === "workspace.closeTicket") return { closed: true };
      if (method === "workspace.fileAction") return { path: `${grant.rootPath}/${params.path}` };
      if (method === "workspace.gitFacts") return null;
      throw new Error(`unexpected ${method}`);
    },
  );
  const client = new WorkspaceClient(
    { request },
    {
      copyText: copied,
      worker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    },
  );
  cleanup.push(() => client.dispose());
  const events: WorktreeHostEvent[] = [];
  client.ports((event) => events.push(event));
  return { client, workers, request, events, copied };
}
function ports() {
  return { type: "ports", treePort: { close: vi.fn() }, gitPort: { close: vi.fn() } };
}
async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("workspace leases at the Worker boundary", () => {
  it("resolves a place before home, with exact boundaries and Windows paths", () => {
    expect(resolveWorkspaceRoot(roots.roots, `${grant.rootPath}/src`)?.root.kind).toBe("place");
    expect(resolveWorkspaceRoot(roots.roots, "/Users/ada/elsewhere")?.path).toBe("elsewhere");
    expect(resolveWorkspaceRoot(roots.roots, "/Users/adam")).toBeNull();
    expect(resolveWorkspaceRoot(roots.roots, `${grant.rootPath}/../secret`)).toBeNull();
    const windows = [{ ...roots.roots[0]!, path: "C:\\Users\\Ada\\repo" }];
    expect(resolveWorkspaceRoot(windows, "c:/users/ada/repo/src")?.path).toBe("src");
  });
  it("hands the room ports, renews before expiry, and resnapshots after a worker death", async () => {
    vi.useFakeTimers();
    const w = world();
    expect(await w.client.open(grant.rootPath)).toEqual({ ok: true, generation: 1 });
    await settle();
    const first = w.workers[0]!;
    const one = ports();
    first.emit(one);
    expect(w.events.at(-1)).toMatchObject({ type: "ports", generation: 1, treePort: one.treePort });
    await vi.advanceTimersByTimeAsync(
      WORKSPACE_LIMITS.TICKET_TTL_MS - WORKSPACE_LIMITS.RENEW_BEFORE_MS,
    );
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(w.request).toHaveBeenCalledWith("workspace.closeTicket", { ticket: "1".repeat(43) });
    expect(w.workers).toHaveLength(2);
    w.workers[1]!.emit({ type: "closed" });
    expect(w.events.at(-1)).toMatchObject({ type: "status", state: "error", generation: 2 });
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIMITS.RETRY_MIN_MS);
    expect(w.workers).toHaveLength(3);
    w.workers[2]!.emit(ports());
    expect(w.events.at(-1)).toMatchObject({ type: "ports", generation: 3 });
    w.client.dispose();
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIMITS.TICKET_TTL_MS);
    expect(w.workers).toHaveLength(3);
  });
  it("closes a ticket that arrived after disposal without starting a worker", async () => {
    const w = world();
    let answer: (value: unknown) => void = () => {};
    w.request.mockImplementation(async (method) =>
      method === "workspace.roots"
        ? roots
        : method === "workspace.openTicket"
          ? new Promise((resolve) => {
              answer = resolve;
            })
          : { closed: true },
    );
    await w.client.open(grant.rootPath);
    await settle();
    w.client.dispose();
    answer(grant);
    await settle();
    expect(w.workers).toHaveLength(0);
    expect(w.request).toHaveBeenCalledWith("workspace.closeTicket", { ticket: grant.ticket });
  });
  it("copies the confined absolute answer and refuses stale file actions", async () => {
    const w = world();
    const opened = await w.client.open(grant.rootPath);
    await settle();
    if (!opened.ok) throw new Error(opened.error);
    expect(
      await w.client.fileAction({
        root: grant.rootPath,
        generation: opened.generation,
        paths: ["src/main.ts"],
        action: "copyPath",
      }),
    ).toEqual({ ok: true });
    expect(w.copied).toHaveBeenCalledWith(`${grant.rootPath}/src/main.ts`);
    expect(
      await w.client.fileAction({
        root: grant.rootPath,
        generation: 999,
        paths: ["x"],
        action: "copyPath",
      }),
    ).toMatchObject({ ok: false });
  });
  it("reports a refusal without endlessly retrying it", async () => {
    vi.useFakeTimers();
    const w = world();
    w.request.mockImplementation(async (method) => {
      if (method === "workspace.roots") return roots;
      throw Object.assign(new Error("This folder is gone"), { kind: "NOT_FOUND" });
    });
    await w.client.open(grant.rootPath);
    await settle();
    expect(w.events.at(-1)).toMatchObject({
      type: "status",
      state: "error",
      message: "This folder is gone",
    });
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIMITS.TICKET_TTL_MS);
    expect(
      w.request.mock.calls.filter(([method]) => method === "workspace.openTicket"),
    ).toHaveLength(1);
  });
});

it("a picked root can attach by id even beyond the bounded roots listing", async () => {
  const w = world();
  const selected = WorkspacePickFolderResult.parse(
    JSON.parse(readFileSync(join(fixtures, "workspace-pick-folder.valid.json"), "utf8")),
  );
  if (selected.canceled) throw new Error("expected a picked root fixture");
  const picked = selected.root;
  const original = w.request.getMockImplementation()!;
  w.request.mockImplementation(async (method, params) =>
    method === "workspace.pickFolder"
      ? { canceled: false, root: picked }
      : original(method, params),
  );
  expect(await w.client.pickFolder()).toEqual(picked);
  const lease = await w.client.attach(picked);
  cleanup.push(() => lease.dispose());
  await settle();
  expect(w.request).toHaveBeenCalledWith("workspace.openTicket", {
    rootId: picked.rootId,
    path: "",
  });
  expect(w.request.mock.calls.filter(([method]) => method === "workspace.roots")).toHaveLength(0);
  const events: WorktreeHostEvent[] = [];
  lease.ports((event) => events.push(event));
  w.workers[0]!.emit(ports());
  expect(events.at(-1)).toMatchObject({ type: "ports", root: picked.path });
});
it("canceling a folder pick creates no ticket or Worker", async () => {
  const w = world();
  w.request.mockResolvedValue(
    JSON.parse(readFileSync(join(fixtures, "workspace-pick-folder.cancelled.json"), "utf8")),
  );
  expect(await w.client.pickFolder()).toBeNull();
  expect(w.request).toHaveBeenCalledExactlyOnceWith("workspace.pickFolder", {});
  expect(w.workers).toHaveLength(0);
});
