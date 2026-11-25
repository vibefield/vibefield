// History QA (2026-11-24) — the room's files pane asks git on a timer, without waiting for answers and for as long
// as it is mounted. What the window does about it: a timed ask already in flight is joined, never sent twice (the
// files worker ends a connection with too many open); and while History is not the view showing, or the window is
// hidden, the timed asks are answered in the window and the repository's facts are not read again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WORKSPACE_LIMITS,
  type WorkspaceGitPortRequest,
  type WorkspaceGitPortResponse,
  WorkspaceOpenTicketResult,
  WorkspaceRootsResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogPortOver, historyPortsOver } from "../src/history/doors";
import { WorkspaceClient, type WorkspacePage } from "../src/workspace/client";
import { createGitAskRelay, WORKSPACE_GIT_PAUSED } from "../src/workspace/relay";

const fixtures = join(import.meta.dirname, "../../contracts/fixtures");
const roots = WorkspaceRootsResult.parse(
  JSON.parse(readFileSync(join(fixtures, "workspace-roots.valid.json"), "utf8")),
);
const grant = WorkspaceOpenTicketResult.parse(
  JSON.parse(readFileSync(join(fixtures, "workspace-open-ticket.valid.json"), "utf8")),
);

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function relay() {
  const posted: WorkspaceGitPortResponse[] = [];
  const sent: WorkspaceGitPortRequest[] = [];
  const asks = createGitAskRelay((response) => posted.push(response));
  const send = (request: WorkspaceGitPortRequest): boolean => {
    sent.push(request);
    return true;
  };
  return { asks, posted, sent, send };
}

describe("the room's git asks on their way to the files worker", () => {
  it("joins a timed ask that is already in flight: one crosses, every asker is answered under its own id", () => {
    const { asks, posted, sent, send } = relay();
    // three ticks of the room's timer before the first answer: nine asks
    for (let tick = 0; tick < 3; tick += 1)
      for (const [n, op] of ["branch", "status", "log"].entries())
        expect(asks.ask({ id: tick * 3 + n + 1, op }, send)).toBe(true);
    expect(sent.map((request) => [request.id, request.op])).toEqual([
      [1, "branch"],
      [2, "status"],
      [3, "log"],
    ]);
    // never more open than the worker allows, however slow the repository
    expect(sent.length).toBeLessThanOrEqual(WORKSPACE_LIMITS.GIT_REQUESTS_IN_FLIGHT);

    asks.answer({ id: 2, ok: true, value: { entries: [], error: null } });
    expect(posted).toEqual([
      { id: 2, ok: true, value: { entries: [], error: null } },
      { id: 5, ok: true, value: { entries: [], error: null } },
      { id: 8, ok: true, value: { entries: [], error: null } },
    ]);
    // answered: the next ask of that op crosses again
    expect(asks.ask({ id: 10, op: "status" }, send)).toBe(true);
    expect(sent.at(-1)).toEqual({ id: 10, op: "status" });
  });

  it("never joins an ask with arguments: two diffs are two asks", () => {
    const { asks, sent, send } = relay();
    asks.ask({ id: 1, op: "diff", args: { path: "a.ts", staged: false } }, send);
    asks.ask({ id: 2, op: "diff", args: { path: "b.ts", staged: false } }, send);
    expect(sent.map((request) => request.id)).toEqual([1, 2]);
  });

  it("says when an ask could not be sent, and holds nothing for it", () => {
    const { asks, sent, send } = relay();
    expect(asks.ask({ id: 1, op: "log" }, () => false)).toBe(false);
    // nothing in flight was recorded: the next one is sent, not joined to an ask that never left
    expect(asks.ask({ id: 2, op: "log" }, send)).toBe(true);
    expect(sent.map((request) => request.id)).toEqual([2]);
  });

  it("while paused answers the timed asks itself and still sends a person's", () => {
    const { asks, posted, sent, send } = relay();
    asks.setPaused(true);
    asks.ask({ id: 1, op: "status" }, send);
    asks.ask({ id: 2, op: "diff", args: { path: "a.ts", staged: false } }, send);
    expect(posted).toEqual([{ id: 1, ok: false, error: WORKSPACE_GIT_PAUSED }]);
    expect(sent.map((request) => request.id)).toEqual([2]);
    asks.setPaused(false);
    asks.ask({ id: 3, op: "status" }, send);
    expect(sent.map((request) => request.id)).toEqual([2, 3]);
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}
class FakePage implements WorkspacePage {
  visibilityState = "visible";
  #listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.#listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.#listeners.delete(listener);
  }
  set(state: "visible" | "hidden"): void {
    this.visibilityState = state;
    for (const listener of [...this.#listeners]) listener();
  }
  get listeners(): number {
    return this.#listeners.size;
  }
}

function world(facts: () => unknown) {
  const workers: FakeWorker[] = [];
  const page = new FakePage();
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "workspace.roots") return roots;
    if (method === "workspace.openTicket")
      return { ...grant, expiresAt: Date.now() + WORKSPACE_LIMITS.TICKET_TTL_MS };
    if (method === "workspace.closeTicket") return { closed: true };
    if (method === "workspace.gitFacts") return facts();
    throw new Error(`unexpected ${method}`);
  });
  const client = new WorkspaceClient(
    { request },
    {
      page,
      worker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    },
  );
  cleanup.push(() => client.dispose());
  client.ports(() => {});
  const asked = () =>
    request.mock.calls.filter(([method]) => method === "workspace.gitFacts").length;
  const told = () =>
    (workers[0]?.postMessage.mock.calls ?? [])
      .map(([message]) => message as { type: string; paused?: boolean })
      .filter((message) => message.type === "paused")
      .map((message) => message.paused);
  return { client, workers, page, request, asked, told };
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
const FACTS = {
  root: grant.rootPath,
  branch: "main",
  dirty: 2,
  worktrees: [{ path: grant.rootPath, branch: "main", current: true }],
};

describe("the files client while its pane is out of sight", () => {
  it("tells its worker to pause when the view stops showing or the window hides, and to go on when both are back", async () => {
    const w = world(() => null);
    await w.client.open(grant.rootPath);
    await settle();
    // the worker is told the state before the attach, and at each change after
    expect(w.workers[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "paused",
      "attach",
    ]);
    expect(w.told()).toEqual([false]);
    w.client.setActive(false);
    w.client.setActive(false);
    expect(w.told()).toEqual([false, true]);
    w.page.set("hidden");
    w.client.setActive(true);
    // showing again, but the window is hidden: still paused
    expect(w.told().at(-1)).toBe(true);
    w.page.set("visible");
    expect(w.told().at(-1)).toBe(false);
  });

  it("answers the repository's facts from its last reading while paused, and reads again when shown", async () => {
    const w = world(() => structuredClone(FACTS));
    const { generation } = (await w.client.open(grant.rootPath)) as { generation: number };
    const first = await w.client.gitFacts(grant.rootPath, generation);
    expect(first).toMatchObject({ branch: "main" });
    expect(w.asked()).toBe(1);
    w.client.setActive(false);
    expect(await w.client.gitFacts(grant.rootPath, generation)).toBe(first);
    expect(await w.client.gitFacts(grant.rootPath, generation)).toBe(first);
    expect(w.asked()).toBe(1);
    w.client.setActive(true);
    await w.client.gitFacts(grant.rootPath, generation);
    expect(w.asked()).toBe(2);
  });

  it("hands back the SAME object for an answer that says what the last one said, and a new one when it moved", async () => {
    let dirty = 2;
    const w = world(() => ({ ...structuredClone(FACTS), dirty }));
    const { generation } = (await w.client.open(grant.rootPath)) as { generation: number };
    const first = await w.client.gitFacts(grant.rootPath, generation);
    expect(await w.client.gitFacts(grant.rootPath, generation)).toBe(first);
    dirty = 3;
    const moved = await w.client.gitFacts(grant.rootPath, generation);
    expect(moved).not.toBe(first);
    expect(moved).toMatchObject({ dirty: 3 });
  });

  it("paused before any reading, it still reads once: there is nothing to answer from", async () => {
    const w = world(() => structuredClone(FACTS));
    const { generation } = (await w.client.open(grant.rootPath)) as { generation: number };
    w.client.setActive(false);
    expect(await w.client.gitFacts(grant.rootPath, generation)).toMatchObject({ branch: "main" });
    expect(w.asked()).toBe(1);
  });

  it("stops watching the page when it is disposed", () => {
    const w = world(() => null);
    expect(w.page.listeners).toBe(1);
    w.client.dispose();
    expect(w.page.listeners).toBe(0);
  });
});

describe("the view's active flag reaches the files client", () => {
  it("the catalog tells its owner each time the view starts or stops showing, after its own listeners", () => {
    const seen: boolean[] = [];
    const catalog = catalogPortOver(
      { request: async () => ({}), subscribe: () => () => {} } as never,
      { onActive: (active) => seen.push(active) },
    );
    cleanup.push(() => catalog.dispose());
    catalog.setActive(true);
    expect(seen).toEqual([]);
    catalog.setActive(false);
    catalog.setActive(false);
    catalog.setActive(true);
    expect(seen).toEqual([false, true]);
  });

  it("History's ports pause their files client with the view", () => {
    const paused = vi.spyOn(WorkspaceClient.prototype, "setActive");
    cleanup.push(() => paused.mockRestore());
    const ports = historyPortsOver(
      { request: async () => ({}), subscribe: () => () => {} } as never,
      { platform: null },
    );
    cleanup.push(() => ports.dispose());
    ports.catalog.setActive(false);
    expect(paused).toHaveBeenCalledWith(false);
  });
});
