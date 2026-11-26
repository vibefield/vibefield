// EY-1 (2026-11-19) — the agent's endpoint (BU-6, BU-19, BU-23; EY-S2-E5): the root and a tab are answered, never
// forwarded; a page is a client's own session through the page's port; a target is named by its DevTools id; a pane is
// the broker's to make and close; one page is one run's; an agent's still past its bound is refused before it is
// relayed, and its body is in no journal and no log line.
import { describe, expect, it, vi } from "vitest";
import type {
  BrowserAgentEvent,
  BrowserAgentPort,
  BrowserAgentSession,
} from "../src/main/live-surfaces/browser-electron-native";
import { createJournal } from "../src/main/pages/core/journal";
import {
  BRIDGE_OK,
  BRIDGE_REFUSED_CODE,
  type BridgePage,
  type CallWindow,
  type Journal,
  type MethodDecision,
  type PageLease,
  type Windows,
} from "../src/main/pages/core/types";
import {
  createEndpoint,
  type Endpoint,
  type EndpointDeps,
  type EndpointEngine,
  MAKE_REFUSALS,
  type MakeAnswer,
} from "../src/main/pages/endpoint/endpoint";

type Frame = {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: string };
};

const ENGINE: EndpointEngine = {
  product: "Chrome/150.0.0.0",
  userAgent: "Mozilla/5.0 Chrome/150.0.0.0",
  protocolVersion: "1.3",
  revision: "",
  jsVersion: "15.0",
};

const page = (pageId: string, runKey = "run-1"): BridgePage => ({
  pageId,
  pageClass: "own",
  runKey,
  site: null,
  runFolder: null,
});
const lease = (runKey = "run-1"): PageLease => ({ runKey, producerEpoch: 1, bindingRevision: 1 });

interface FakeSession extends BrowserAgentSession {
  readonly sent: { readonly method: string; readonly params: unknown; readonly child?: string }[];
  emit(event: BrowserAgentEvent): void;
}

function fakePort(
  targetId: string,
  answer: (method: string) => unknown = () => ({}),
): { readonly port: BrowserAgentPort; readonly sessions: FakeSession[] } {
  const sessions: FakeSession[] = [];
  let n = 0;
  const port: BrowserAgentPort = {
    targetId,
    openClientSession: async () => {
      n += 1;
      const sent: FakeSession["sent"] = [];
      const listeners = new Set<(event: BrowserAgentEvent) => void>();
      const session: FakeSession = {
        id: `real-${targetId}-${n}`,
        sent,
        emit: (event) => {
          for (const listener of listeners) listener(event);
        },
        send: async (method, params, child) => {
          sent.push({ method, params, ...(child === undefined ? {} : { child }) });
          return answer(method);
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close: async () => {},
        closed: new Promise(() => {}),
      };
      sessions.push(session);
      return session;
    },
    captureScale: () => 1,
    info: () => ({ url: "https://a.test/", title: "A" }),
    onDetach: () => () => {},
    pin: () => ({ applied: Promise.resolve("applied"), release: () => {} }),
    framesHoldFocus: () => false,
    viewImagePoint: (p) => p,
  };
  return { port, sessions };
}

/** Every page leased, none held, an act window open on call-1; every admission passed but a Fetch answer for a pause
 * never noted, which is refused as windows.ts refuses one outside its window. */
function fakeWindows(o: { readonly noWindow?: boolean } = {}): Windows {
  const noted = new Set<string>();
  const window = (pageId: string): CallWindow => ({
    pageId,
    kind: "act",
    callId: "call-1",
    action: "test",
    openedAt: 0,
    stillsTaken: 0,
  });
  return {
    lease: () => {},
    unlease: () => null,
    open: () => BRIDGE_OK,
    adopt: () => BRIDGE_OK,
    close: () => null,
    closeCall: () => [],
    hold: () => ({ closed: null }),
    putDown: () => {},
    drain: () => {},
    drained: () => {},
    admit: (_pageId, c) =>
      c.fetchAnswer !== undefined && !noted.has(c.fetchAnswer)
        ? { ok: false, code: "outside-window", reason: "no pause owed by that id" }
        : BRIDGE_OK,
    notePaused: (_pageId, requestId) => {
      noted.add(requestId);
    },
    forgetPaused: () => {},
    state: (pageId) => ({
      leased: true,
      held: false,
      window: o.noWindow === true ? null : window(pageId),
      paused: 0,
      draining: false,
    }),
    history: () => [],
    applied: () => null,
  };
}

function fakeJournal(): Journal & { readonly observe: ReturnType<typeof vi.fn> } {
  return {
    observe: vi.fn(() => null),
    undoPlan: () => [],
    redoPlan: () => [],
    endPlan: () => [],
    scriptGrantEndPlan: () => [],
    settleLate: () => null,
    dropLate: () => [],
    applyResults: () => {},
    translate: (_p, _c, _s, call) => call,
    mayRemove: () => BRIDGE_OK,
    sessionEnded: () => 0,
    rows: () => ({}) as ReturnType<Journal["rows"]>,
  };
}

const classify = (q: { readonly call: { readonly method: string } }): MethodDecision => ({
  verdict: BRIDGE_OK,
  mutation: false,
  capture: q.call.method === "Page.captureScreenshot",
  script: null,
  expected: false,
  journal: null,
});

function harness(o: Partial<EndpointDeps> = {}) {
  const journal = fakeJournal();
  // the broker's record of the panes it made for a run, by any door
  const madeBy = new Set<string>();
  const log = vi.fn();
  const make = vi.fn(async (): Promise<MakeAnswer> => ({ ok: false, refused: "no-window" }));
  const closeMade = vi.fn(async () => {});
  const refused = vi.fn();
  const giveBack = vi.fn(
    async (_o: {
      readonly runKey: string;
      readonly pageId: string;
    }): Promise<{ readonly ok: true } | { readonly ok: false; readonly refused: string }> => ({
      ok: false,
      refused: "held",
    }),
  );
  const deps: EndpointDeps = {
    engine: () => ENGINE,
    windows: fakeWindows(),
    classify,
    journal,
    clean: (event) => ({ action: "forward", event }),
    make,
    closeMade,
    made: (_runKey, pageId) => madeBy.has(pageId),
    giveBack,
    refused,
    input: ({ call }) => ({ verdict: BRIDGE_OK, call }),
    stillMaxBytes: 64,
    log,
    ...o,
  };
  const endpoint = createEndpoint(deps);
  return { endpoint, journal, log, make, closeMade, giveBack, refused, madeBy, deps };
}

function client(
  endpoint: Endpoint,
  runKey = "run-1",
  onFrame?: (frame: Frame, answer: (frame: string) => Promise<void>) => void,
) {
  const frames: Frame[] = [];
  const closes: { readonly code: number; readonly reason: string }[] = [];
  const c = endpoint.connect(runKey, 1, {
    send: (frame) => {
      const parsed = JSON.parse(frame) as Frame;
      frames.push(parsed);
      onFrame?.(parsed, (f) => c.message(f));
    },
    close: (code, reason) => closes.push({ code, reason }),
  });
  let next = 0;
  const call = async (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    next += 1;
    const id = next;
    const from = frames.length;
    await c.message(
      JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
    );
    const said = frames.slice(from);
    const at = said.findIndex((f) => f.id === id);
    return { answer: said[at], before: at < 0 ? said : said.slice(0, at), said };
  };
  return { call, frames, closes };
}

const refusedAs = (answer: Frame | undefined, word: string) => {
  expect(answer?.error?.code).toBe(BRIDGE_REFUSED_CODE);
  expect(answer?.error?.data).toBe(`vf:${word}`);
  expect(answer?.error?.message.startsWith(`vf:${word}: `)).toBe(true);
};

const attachedTo = (frames: readonly Frame[], targetId: string) =>
  frames.filter(
    (f) =>
      f.method === "Target.attachedToTarget" &&
      (f.params?.targetInfo as { targetId?: string } | undefined)?.targetId === targetId,
  );
const createdOf = (frames: readonly Frame[], targetId: string) =>
  frames.filter(
    (f) =>
      f.method === "Target.targetCreated" &&
      (f.params?.targetInfo as { targetId?: string } | undefined)?.targetId === targetId,
  );

describe("the agent's endpoint (EY-1 1d)", () => {
  it("answers Browser.getVersion from the engine, at the root and on a page session, never forwarding it", async () => {
    const { endpoint } = harness();
    const a = fakePort("DEVTOOLS-A");
    endpoint.grant("run-1", page("P-a"), a.port, lease());
    const c = client(endpoint);
    expect((await c.call("Browser.getVersion")).answer?.result).toEqual(ENGINE);
    const attach = await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true });
    const sessionId = attach.answer?.result?.sessionId as string;
    expect((await c.call("Browser.getVersion", {}, sessionId)).answer?.result).toEqual(ENGINE);
    expect(a.sessions.flatMap((s) => s.sent.map((m) => m.method))).not.toContain(
      "Browser.getVersion",
    );
  });

  it("answers the root's Target.getBrowserContexts with none", async () => {
    const { endpoint } = harness();
    const c = client(endpoint);
    expect((await c.call("Target.getBrowserContexts")).answer?.result).toEqual({
      browserContextIds: [],
    });
  });

  it("announces the run's own pages before setDiscoverTargets' answer, by their DevTools ids", async () => {
    const { endpoint } = harness();
    endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    endpoint.grant("run-2", page("P-b", "run-2"), fakePort("DEVTOOLS-B").port, lease("run-2"));
    const c = client(endpoint);
    const r = await c.call("Target.setDiscoverTargets", { discover: true });
    expect(r.answer?.result).toEqual({});
    expect(createdOf(r.before, "DEVTOOLS-A")).toHaveLength(1);
    expect(JSON.stringify(c.frames)).not.toContain("DEVTOOLS-B");
  });

  it("lists the run's own pages alone in Target.getTargets, each by its DevTools id", async () => {
    const { endpoint } = harness();
    endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    endpoint.grant("run-2", page("P-b", "run-2"), fakePort("DEVTOOLS-B").port, lease("run-2"));
    const c = client(endpoint);
    const infos = ((await c.call("Target.getTargets")).answer?.result?.targetInfos ?? []) as {
      targetId: string;
      type: string;
    }[];
    expect(infos.filter((t) => t.type === "page").map((t) => t.targetId)).toEqual(["DEVTOOLS-A"]);
    expect(JSON.stringify(infos)).not.toContain("DEVTOOLS-B");
  });

  it("refuses a root auto-attach that is not flat; flat, each page attaches on a session of its own before the answer", async () => {
    const { endpoint } = harness();
    const a = fakePort("DEVTOOLS-A");
    endpoint.grant("run-1", page("P-a"), a.port, lease());
    const c = client(endpoint);
    refusedAs((await c.call("Target.setAutoAttach", { autoAttach: true })).answer, "forbidden");
    const r = await c.call("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    expect(r.answer?.result).toEqual({});
    const attached = attachedTo(r.before, "DEVTOOLS-A");
    expect(attached).toHaveLength(1);
    expect(attached[0]?.params?.sessionId).toMatch(/^vf-page-\d+$/);
    expect(attached[0]?.params?.waitingForDebugger).toBe(false);
    expect(a.sessions).toHaveLength(1);
  });

  it("gives a second attach a second session of the client's own, each said before its answer", async () => {
    const { endpoint } = harness();
    const a = fakePort("DEVTOOLS-A");
    endpoint.grant("run-1", page("P-a"), a.port, lease());
    const c = client(endpoint);
    const first = await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true });
    const second = await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true });
    const ids = [first, second].map((r) => r.answer?.result?.sessionId);
    expect(new Set(ids).size).toBe(2);
    for (const r of [first, second]) {
      expect(attachedTo(r.before, "DEVTOOLS-A")[0]?.params?.sessionId).toBe(
        r.answer?.result?.sessionId,
      );
    }
    expect(new Set(a.sessions.map((s) => s.id)).size).toBe(2);
  });

  it("refuses a target or a session this run was never handed as not-handed", async () => {
    const { endpoint } = harness();
    endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    endpoint.grant("run-2", page("P-b", "run-2"), fakePort("DEVTOOLS-B").port, lease("run-2"));
    const c = client(endpoint);
    refusedAs(
      (await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-B", flatten: true })).answer,
      "not-handed",
    );
    refusedAs(
      (await c.call("Target.getTargetInfo", { targetId: "DEVTOOLS-X" })).answer,
      "not-handed",
    );
    refusedAs(
      (await c.call("Runtime.evaluate", { expression: "1" }, "vf-page-99")).answer,
      "not-handed",
    );
  });

  it("makes a pane through the broker in the call's window, says it before the answer and answers its DevTools id", async () => {
    const h = harness();
    const made = fakePort("DEVTOOLS-MADE");
    h.make.mockImplementation(async () => {
      h.endpoint.grant("run-1", page("P-made"), made.port, lease());
      return { ok: true, pageId: "P-made", targetId: "DEVTOOLS-MADE" };
    });
    h.endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    const c = client(h.endpoint);
    await c.call("Target.setDiscoverTargets", { discover: true });
    await c.call("Target.setAutoAttach", { autoAttach: true, flatten: true });
    const r = await c.call("Target.createTarget", { url: "https://b.test/" });
    expect(h.make).toHaveBeenCalledTimes(1);
    expect(h.make).toHaveBeenCalledWith({
      runKey: "run-1",
      callId: "call-1",
      url: "https://b.test/",
    });
    expect(createdOf(r.before, "DEVTOOLS-MADE")).toHaveLength(1);
    expect(attachedTo(r.before, "DEVTOOLS-MADE")).toHaveLength(1);
    expect(r.answer?.result).toEqual({ targetId: "DEVTOOLS-MADE" });
  });

  it.each(MAKE_REFUSALS)(
    "answers the broker's %s as the client's -32000 with its word, nothing attached",
    async (word) => {
      const h = harness();
      h.make.mockResolvedValue({ ok: false, refused: word });
      const a = fakePort("DEVTOOLS-A");
      h.endpoint.grant("run-1", page("P-a"), a.port, lease());
      const c = client(h.endpoint);
      await c.call("Target.setAutoAttach", { autoAttach: true, flatten: true });
      const sessionsBefore = a.sessions.length;
      const r = await c.call("Target.createTarget", { url: "https://b.test/" });
      refusedAs(r.answer, word);
      expect(r.said.filter((f) => f.method !== undefined)).toEqual([]);
      expect(a.sessions).toHaveLength(sessionsBefore);
    },
  );

  it("closes a pane the run made through the broker; a target never held is not-handed", async () => {
    const h = harness();
    h.make.mockImplementation(async () => {
      h.madeBy.add("P-made");
      h.endpoint.grant("run-1", page("P-made"), fakePort("DEVTOOLS-MADE").port, lease());
      return { ok: true, pageId: "P-made", targetId: "DEVTOOLS-MADE" };
    });
    h.endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    const c = client(h.endpoint);
    await c.call("Target.createTarget", { url: "https://b.test/" });
    const closed = await c.call("Target.closeTarget", { targetId: "DEVTOOLS-MADE" });
    expect(closed.answer?.result).toEqual({ success: true });
    expect(h.closeMade).toHaveBeenCalledWith({ runKey: "run-1", pageId: "P-made" });
    refusedAs(
      (await c.call("Target.closeTarget", { targetId: "DEVTOOLS-X" })).answer,
      "not-handed",
    );
    expect(h.closeMade).toHaveBeenCalledTimes(1);
  });

  it("gives a handed page back through the broker: the page stays the person's, the client sees it go, and a second close is not-handed", async () => {
    const h = harness();
    h.giveBack.mockImplementation(async ({ pageId }) => {
      h.endpoint.ungrant(pageId, "given back");
      return { ok: true };
    });
    const a = fakePort("DEVTOOLS-A");
    h.endpoint.grant("run-1", page("P-a"), a.port, lease());
    const c = client(h.endpoint);
    await c.call("Target.setDiscoverTargets", { discover: true });
    const sessionId = (
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })
    ).answer?.result?.sessionId as string;
    const closed = await c.call("Target.closeTarget", { targetId: "DEVTOOLS-A" });
    expect(closed.answer?.result).toEqual({ success: true });
    expect(h.giveBack).toHaveBeenCalledTimes(1);
    expect(h.giveBack).toHaveBeenCalledWith({ runKey: "run-1", pageId: "P-a" });
    expect(h.closeMade).not.toHaveBeenCalled();
    expect(
      closed.said.some(
        (f) => f.method === "Target.detachedFromTarget" && f.params?.sessionId === sessionId,
      ),
    ).toBe(true);
    expect(
      closed.said.some(
        (f) => f.method === "Target.targetDestroyed" && f.params?.targetId === "DEVTOOLS-A",
      ),
    ).toBe(true);
    refusedAs(
      (await c.call("Target.closeTarget", { targetId: "DEVTOOLS-A" })).answer,
      "not-handed",
    );
    expect(h.giveBack).toHaveBeenCalledTimes(1);
  });

  it("closes a pane the broker made by another door (granted, never created here) through closeMade; a handed page still goes back", async () => {
    const h = harness();
    h.giveBack.mockImplementation(async ({ pageId }) => {
      h.endpoint.ungrant(pageId, "given back");
      return { ok: true };
    });
    // a pop-up's pane: the broker made it and granted it, and no client asked for it
    h.madeBy.add("P-pop");
    h.endpoint.grant("run-1", page("P-pop"), fakePort("DEVTOOLS-POP").port, lease());
    h.endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    const c = client(h.endpoint);
    const pop = await c.call("Target.closeTarget", { targetId: "DEVTOOLS-POP" });
    expect(pop.answer?.result).toEqual({ success: true });
    expect(h.closeMade).toHaveBeenCalledWith({ runKey: "run-1", pageId: "P-pop" });
    expect(h.giveBack).not.toHaveBeenCalled();
    const handed = await c.call("Target.closeTarget", { targetId: "DEVTOOLS-A" });
    expect(handed.answer?.result).toEqual({ success: true });
    expect(h.giveBack).toHaveBeenCalledWith({ runKey: "run-1", pageId: "P-a" });
    expect(h.closeMade).toHaveBeenCalledTimes(1);
  });

  it("closes, on Page.close, a pane the broker made by another door, never giving it back", async () => {
    const h = harness();
    h.madeBy.add("P-pop");
    h.endpoint.grant("run-1", page("P-pop"), fakePort("DEVTOOLS-POP").port, lease());
    const c = client(h.endpoint);
    const sessionId = (
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-POP", flatten: true })
    ).answer?.result?.sessionId as string;
    const closed = await c.call("Page.close", {}, sessionId);
    expect(closed.answer?.error).toBeUndefined();
    expect(h.closeMade).toHaveBeenCalledWith({ runKey: "run-1", pageId: "P-pop" });
    expect(h.giveBack).not.toHaveBeenCalled();
  });

  it("answers the broker's refusal to take a handed page back with its word, saying nothing and keeping the page", async () => {
    const h = harness();
    h.giveBack.mockResolvedValue({ ok: false, refused: "held" });
    h.endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    const c = client(h.endpoint);
    const r = await c.call("Target.closeTarget", { targetId: "DEVTOOLS-A" });
    refusedAs(r.answer, "held");
    expect(r.said.filter((f) => f.method !== undefined)).toEqual([]);
    expect(h.giveBack).toHaveBeenCalledTimes(1);
    const infos = (await c.call("Target.getTargets")).answer?.result?.targetInfos;
    expect(JSON.stringify(infos ?? [])).toContain("DEVTOOLS-A");
  });

  it("keeps one page one run's: a second run's grant is refused as an answer and the first run keeps the page", async () => {
    const { endpoint } = harness();
    const a = fakePort("DEVTOOLS-A");
    expect(endpoint.grant("run-1", page("P-a"), a.port, lease())).toEqual(BRIDGE_OK);
    expect(endpoint.grant("run-2", page("P-a", "run-2"), a.port, lease("run-2"))).toMatchObject({
      ok: false,
      code: "no-lease",
    });
    const first = (await client(endpoint, "run-1").call("Target.getTargets")).answer?.result;
    const second = (await client(endpoint, "run-2").call("Target.getTargets")).answer?.result;
    expect(JSON.stringify(first)).toContain("DEVTOOLS-A");
    expect(second).toEqual({ targetInfos: [] });
  });

  it("notes a client's Fetch pause for the page, and admits its Fetch.failRequest in the window as a Fetch answer", async () => {
    const windows = fakeWindows();
    const admit = vi.spyOn(windows, "admit");
    const notePaused = vi.spyOn(windows, "notePaused");
    const { endpoint } = harness({ windows });
    const a = fakePort("DEVTOOLS-A");
    endpoint.grant("run-1", page("P-a"), a.port, lease());
    const c = client(endpoint);
    const sessionId = (
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })
    ).answer?.result?.sessionId as string;
    a.sessions[0]?.emit({
      method: "Fetch.requestPaused",
      params: { requestId: "r-1", request: { url: "https://a.test/fetch-exception/x" } },
    });
    expect(notePaused).toHaveBeenCalledWith("P-a", "r-1", "Fetch.requestPaused");
    expect(c.frames.filter((f) => f.method === "Fetch.requestPaused")[0]?.sessionId).toBe(
      sessionId,
    );
    const r = await c.call(
      "Fetch.failRequest",
      { requestId: "r-1", errorReason: "Failed" },
      sessionId,
    );
    expect(r.answer?.result).toEqual({});
    expect(admit).toHaveBeenCalledWith(
      "P-a",
      expect.objectContaining({ fetchAnswer: "r-1", fetchPlain: false }),
    );
    expect(a.sessions[0]?.sent.map((m) => m.method)).toEqual(["Fetch.failRequest"]);
  });

  it("notes a pause before the client hears it, so an answer the client sends at once is admitted", async () => {
    const { endpoint } = harness();
    const a = fakePort("DEVTOOLS-A");
    endpoint.grant("run-1", page("P-a"), a.port, lease());
    let at: Promise<void> | undefined;
    const c = client(endpoint, "run-1", (f, answer) => {
      if (f.method !== "Fetch.requestPaused") return;
      at = answer(
        JSON.stringify({
          id: 900,
          method: "Fetch.failRequest",
          params: { requestId: f.params?.requestId, errorReason: "Failed" },
          sessionId: f.sessionId,
        }),
      );
    });
    await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true });
    a.sessions[0]?.emit({ method: "Fetch.requestPaused", params: { requestId: "r-now" } });
    await at;
    expect(c.frames.find((f) => f.id === 900)?.result).toEqual({});
  });

  it.each(["iframe", "worker"])(
    "notes a pause on a %s under the client's session against its page, and admits its answer there",
    async (type) => {
      const windows = fakeWindows();
      const notePaused = vi.spyOn(windows, "notePaused");
      const { endpoint } = harness({ windows });
      const a = fakePort("DEVTOOLS-A");
      endpoint.grant("run-1", page("P-a"), a.port, lease());
      const c = client(endpoint);
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true });
      a.sessions[0]?.emit({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "C-1",
          targetInfo: { targetId: "T-1", type, url: "", title: "" },
          waitingForDebugger: true,
        },
      });
      a.sessions[0]?.emit({
        method: "Fetch.requestPaused",
        params: { requestId: "r-child" },
        child: "C-1",
      });
      expect(notePaused).toHaveBeenCalledWith("P-a", "r-child", "Fetch.requestPaused");
      expect(c.frames.find((f) => f.method === "Fetch.requestPaused")?.sessionId).toBe("C-1");
      const r = await c.call(
        "Fetch.failRequest",
        { requestId: "r-child", errorReason: "Failed" },
        "C-1",
      );
      expect(r.answer?.result).toEqual({});
      expect(a.sessions[0]?.sent.at(-1)).toEqual({
        method: "Fetch.failRequest",
        params: { requestId: "r-child", errorReason: "Failed" },
        child: "C-1",
      });
    },
  );

  it("notes a pause the client was never told of against its page, and says nothing of it", async () => {
    const windows = fakeWindows();
    const notePaused = vi.spyOn(windows, "notePaused");
    const h = harness({ windows });
    const a = fakePort("DEVTOOLS-A");
    h.endpoint.grant("run-1", page("P-a"), a.port, lease());
    const c = client(h.endpoint);
    await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true });
    const before = c.frames.length;
    a.sessions[0]?.emit({
      method: "Fetch.requestPaused",
      params: { requestId: "r-lost" },
      child: "C-never",
    });
    expect(notePaused).toHaveBeenCalledWith("P-a", "r-lost", "Fetch.requestPaused");
    expect(c.frames.slice(before)).toEqual([]);
    expect(JSON.stringify(h.log.mock.calls)).toContain("desktop.pages.pause_unrouted");
  });

  it("hands a refusal made inside a call's window to that call", async () => {
    const h = harness();
    h.endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    const c = client(h.endpoint);
    const sessionId = (
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })
    ).answer?.result?.sessionId as string;
    refusedAs(
      (await c.call("Emulation.setDeviceMetricsOverride", {}, sessionId)).answer,
      "forbidden",
    );
    expect(h.refused.mock.calls).toEqual([
      [{ callId: "call-1", method: "Emulation.setDeviceMetricsOverride", code: "forbidden" }],
    ]);
  });

  it("hands no call a refusal made outside any window: at the root, or on a page with none open", async () => {
    const h = harness({ windows: fakeWindows({ noWindow: true }) });
    h.endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    const c = client(h.endpoint);
    const sessionId = (
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })
    ).answer?.result?.sessionId as string;
    refusedAs((await c.call("Target.bogus")).answer, "forbidden");
    refusedAs(
      (await c.call("Emulation.setDeviceMetricsOverride", {}, sessionId)).answer,
      "forbidden",
    );
    expect(h.log.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.refused).not.toHaveBeenCalled();
    // the control: the same refusal inside a window does reach its call
    const w = harness();
    w.endpoint.grant("run-1", page("P-a"), fakePort("DEVTOOLS-A").port, lease());
    const cw = client(w.endpoint);
    const inWindow = (
      await cw.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })
    ).answer?.result?.sessionId as string;
    await cw.call("Emulation.setDeviceMetricsOverride", {}, inWindow);
    expect(w.refused).toHaveBeenCalledTimes(1);
  });

  it("relays a still within the bound", async () => {
    const small = Buffer.from("tiny still").toString("base64");
    const { endpoint } = harness();
    endpoint.grant(
      "run-1",
      page("P-a"),
      fakePort("DEVTOOLS-A", () => ({ data: small })).port,
      lease(),
    );
    const c = client(endpoint);
    const sessionId = (
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })
    ).answer?.result?.sessionId as string;
    const r = await c.call("Page.captureScreenshot", { format: "png" }, sessionId);
    expect(r.answer?.result).toEqual({ data: small });
  });

  it("refuses a still past the bound before it is relayed; its body is in no frame, journal entry or log line", async () => {
    const big = Buffer.from("SENTINEL-STILL-BODY-".repeat(8)).toString("base64");
    const h = harness();
    const a = fakePort("DEVTOOLS-A", () => ({ data: big }));
    h.endpoint.grant("run-1", page("P-a"), a.port, lease());
    const c = client(h.endpoint);
    const sessionId = (
      await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })
    ).answer?.result?.sessionId as string;
    const r = await c.call("Page.captureScreenshot", { format: "png" }, sessionId);
    expect(a.sessions.flatMap((s) => s.sent.map((m) => m.method))).toEqual([
      "Page.captureScreenshot",
    ]);
    refusedAs(r.answer, "forbidden");
    expect(JSON.stringify(c.frames)).not.toContain(big);
    expect(JSON.stringify(h.journal.observe.mock.calls)).not.toContain(big);
    expect(JSON.stringify(h.log.mock.calls)).not.toContain(big);
  });

  /** a page whose init scripts are answered `s-1`, `s-2`, …; a client attached on it */
  async function scripted() {
    const journal = createJournal();
    const h = harness({ journal });
    let n = 0;
    const a = fakePort("DEVTOOLS-A", (method) =>
      method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: `s-${++n}` } : {},
    );
    h.endpoint.grant("run-1", page("P-a"), a.port, lease());
    const attach = async (c: ReturnType<typeof client>) =>
      (await c.call("Target.attachToTarget", { targetId: "DEVTOOLS-A", flatten: true })).answer
        ?.result?.sessionId as string;
    const removals = () =>
      a.sessions.flatMap((s) =>
        s.sent
          .filter(
            (m) => m.method.startsWith("Page.removeScript") || m.method === "Runtime.removeBinding",
          )
          .map((m) => `${s.id} ${m.method} ${JSON.stringify(m.params)}`),
      );
    return { h, a, journal, attach, removals };
  }

  it("forwards a client's removal of its own init script and binding, and refuses each once removed", async () => {
    const { h, attach, removals } = await scripted();
    const c = client(h.endpoint);
    const s = await attach(c);
    const added = await c.call("Page.addScriptToEvaluateOnNewDocument", { source: "1" }, s);
    expect(added.answer?.result).toEqual({ identifier: "s-1" });
    await c.call("Runtime.addBinding", { name: "vfAgentHook" }, s);
    expect(
      (await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-1" }, s)).answer
        ?.error,
    ).toBeUndefined();
    expect(
      (await c.call("Runtime.removeBinding", { name: "vfAgentHook" }, s)).answer?.error,
    ).toBeUndefined();
    expect(removals()).toHaveLength(2);
    refusedAs(
      (await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-1" }, s)).answer,
      "forbidden",
    );
    refusedAs(
      (await c.call("Runtime.removeBinding", { name: "vfAgentHook" }, s)).answer,
      "forbidden",
    );
    expect(removals()).toHaveLength(2);
  });

  it("refuses removing what another client or another session minted, forwarding nothing, and the minter's own still goes", async () => {
    const { h, attach, removals } = await scripted();
    const first = client(h.endpoint);
    const s1 = await attach(first);
    await first.call("Page.addScriptToEvaluateOnNewDocument", { source: "1" }, s1);
    await first.call("Runtime.addBinding", { name: "vfAgentHook" }, s1);
    const second = client(h.endpoint);
    const s2 = await attach(second);
    refusedAs(
      (await second.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-1" }, s2))
        .answer,
      "forbidden",
    );
    refusedAs(
      (await second.call("Runtime.removeBinding", { name: "vfAgentHook" }, s2)).answer,
      "forbidden",
    );
    const s1b = await attach(first);
    refusedAs(
      (await first.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-1" }, s1b))
        .answer,
      "forbidden",
    );
    expect(removals()).toEqual([]);
    expect(
      (await first.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-1" }, s1))
        .answer?.error,
    ).toBeUndefined();
    expect(removals()).toHaveLength(1);
  });

  it("refuses removing an init script or binding the client never minted, the owner's or an unknown one, forwarding nothing", async () => {
    const { h, attach, removals } = await scripted();
    const c = client(h.endpoint);
    const s = await attach(c);
    await c.call("Page.addScriptToEvaluateOnNewDocument", { source: "1" }, s);
    // the owner's guards are its own session's: an identifier this client was never answered
    refusedAs(
      (await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "1" }, s)).answer,
      "forbidden",
    );
    refusedAs(
      (await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-9" }, s)).answer,
      "forbidden",
    );
    refusedAs(
      (await c.call("Page.removeScriptToEvaluateOnNewDocument", {}, s)).answer,
      "forbidden",
    );
    refusedAs(
      (await c.call("Runtime.removeBinding", { name: "neverAdded" }, s)).answer,
      "forbidden",
    );
    expect(removals()).toEqual([]);
  });

  it("after a put-down re-mints a client's script, its removal by its own name is forwarded under the new identifier", async () => {
    const { h, journal, attach, removals } = await scripted();
    const asked = vi.spyOn(journal, "mayRemove");
    const c = client(h.endpoint);
    const s = await attach(c);
    await c.call("Page.addScriptToEvaluateOnNewDocument", { source: "1" }, s);
    // the person picks the page up and puts it down: the script is re-minted, and the page answers it anew
    journal.undoPlan("P-a");
    const redo = journal.redoPlan("P-a");
    journal.applyResults(
      "P-a",
      redo,
      redo.map((item) =>
        item.method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: "s-redo" } : {},
      ),
    );
    // the new identifier was never the client's to name
    refusedAs(
      (await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-redo" }, s))
        .answer,
      "forbidden",
    );
    expect(removals()).toEqual([]);
    const own = await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "s-1" }, s);
    expect(own.answer?.error).toBeUndefined();
    expect(asked).toHaveBeenLastCalledWith(
      "P-a",
      expect.any(String),
      expect.any(String),
      "init-script",
      "s-1",
    );
    expect(removals()).toEqual([
      expect.stringMatching(
        / Page\.removeScriptToEvaluateOnNewDocument \{"identifier":"s-redo"\}$/,
      ),
    ]);
  });
});
