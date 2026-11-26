// EY-1 (2026-11-24) — the sessions under a client's own session (BU-22; EY-S2-E5): the frames of another site and the
// dedicated workers its own auto-attach brings. A child must never wait on the client: the wall refuses the client
// while the person holds the page and between calls, so a frame held for the client's resume would stay frozen in
// the person's hand. On the real windows, journal, policy and cleaning; the page is a stand-in that records what is
// sent on the client's session.
import { describe, expect, it } from "vitest";
import { client, type FakeSession, pickUp, type Sent, wall } from "./pages-wall-kit";

/** The engine's own auto-attach on a page session, as the pin sends it at connect. */
const ENGINE_AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

const attached = (session: FakeSession, sessionId: string, type: string, waiting: boolean) =>
  session.emit({
    method: "Target.attachedToTarget",
    params: {
      sessionId,
      targetInfo: { targetId: `T-${sessionId}`, type, url: "", title: "" },
      waitingForDebugger: waiting,
    },
  });

const autoAttaches = (sent: readonly Sent[]) =>
  sent.filter((m) => m.method === "Target.setAutoAttach");

describe("no child of a client's session waits for the client (EY-1, 2026-11-24)", () => {
  it("a client's auto-attach is forwarded with waitForDebuggerOnStart false, whatever it asked, in a window or out of one", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    // outside any window: the client's own session's auto-attach, as before
    expect((await c.call("Target.setAutoAttach", ENGINE_AUTO_ATTACH, s)).answer?.result).toEqual(
      {},
    );
    w.open("act");
    expect((await c.call("Target.setAutoAttach", ENGINE_AUTO_ATTACH, s)).answer?.result).toEqual(
      {},
    );
    const sent = autoAttaches(w.session().sent);
    expect(sent).toHaveLength(2);
    for (const m of sent) {
      expect(m.params).toMatchObject({
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      expect(m.child).toBeUndefined();
    }
  });

  it("a frame's own auto-attach is forwarded the same way, on the frame's session", async () => {
    const w = wall();
    const c = client(w.endpoint);
    await c.attach();
    attached(w.session(), "C-1", "iframe", false);
    expect(
      (await c.call("Target.setAutoAttach", ENGINE_AUTO_ATTACH, "C-1")).answer?.result,
    ).toEqual({});
    const sent = autoAttaches(w.session().sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.child).toBe("C-1");
    expect(sent[0]?.params).toMatchObject({ autoAttach: true, waitForDebuggerOnStart: false });
  });

  it("a child that attaches waiting all the same is resumed by the bridge at once, and the client hears it is not waiting", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    attached(w.session(), "C-1", "iframe", true);
    expect(w.session().sent).toEqual([
      { method: "Runtime.runIfWaitingForDebugger", params: {}, child: "C-1" },
    ]);
    const said = c.frames.filter(
      (f) => f.method === "Target.attachedToTarget" && f.params?.sessionId === "C-1",
    );
    expect(said).toHaveLength(1);
    expect(said[0]?.sessionId).toBe(s);
    expect(said[0]?.params?.waitingForDebugger).toBe(false);
  });

  it("on a held page with sign-ins the child's attach is not said to the client, and the bridge has resumed it all the same", async () => {
    const w = wall({ pageClass: "signed-in" });
    const c = client(w.endpoint);
    await c.attach();
    await pickUp(w);
    const before = c.frames.length;
    attached(w.session(), "C-1", "iframe", true);
    expect(c.frames.slice(before)).toEqual([]);
    expect(w.session().sent).toEqual([
      { method: "Runtime.runIfWaitingForDebugger", params: {}, child: "C-1" },
    ]);
  });

  it("the client's own resume of a child is still forwarded to that child, and a page session's is answered by the bridge", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    attached(w.session(), "C-1", "iframe", false);
    expect((await c.call("Runtime.runIfWaitingForDebugger", {}, "C-1")).answer?.result).toEqual({});
    expect((await c.call("Runtime.runIfWaitingForDebugger", {}, s)).answer?.result).toEqual({});
    expect(w.session().sent).toEqual([
      { method: "Runtime.runIfWaitingForDebugger", params: {}, child: "C-1" },
    ]);
  });
});

describe("a client's children are frames and dedicated workers alone: a service worker never reaches the agent (BU-22; EY-1, 2026-11-24)", () => {
  const FRAMES_AND_WORKERS = [{ type: "iframe" }, { type: "worker" }];

  it.each([
    ["no filter (the engine's own)", undefined, FRAMES_AND_WORKERS],
    ["every type", [{}], FRAMES_AND_WORKERS],
    [
      "service workers and frames",
      [{ type: "service_worker" }, { type: "iframe" }],
      [{ type: "iframe" }],
    ],
    [
      "everything but dedicated workers",
      [{ type: "worker", exclude: true }, {}],
      [{ type: "iframe" }],
    ],
    [
      "shared workers and dedicated workers",
      [{ type: "shared_worker" }, { type: "worker" }],
      [{ type: "worker" }],
    ],
  ] as const)(
    "a client's auto-attach filter is narrowed to them: %s",
    async (_name, filter, forwarded) => {
      const w = wall();
      const c = client(w.endpoint);
      const s = await c.attach();
      const asked = filter === undefined ? ENGINE_AUTO_ATTACH : { ...ENGINE_AUTO_ATTACH, filter };
      expect((await c.call("Target.setAutoAttach", asked, s)).answer?.result).toEqual({});
      expect(autoAttaches(w.session().sent)).toEqual([
        {
          method: "Target.setAutoAttach",
          params: {
            autoAttach: true,
            waitForDebuggerOnStart: false,
            flatten: true,
            filter: forwarded,
          },
        },
      ]);
    },
  );

  it("a filter that admits neither a frame nor a dedicated worker turns the client's auto-attach off: nothing else may attach", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    const asked = { ...ENGINE_AUTO_ATTACH, filter: [{ type: "service_worker" }] };
    expect((await c.call("Target.setAutoAttach", asked, s)).answer?.result).toEqual({});
    expect(autoAttaches(w.session().sent)).toEqual([
      {
        method: "Target.setAutoAttach",
        params: { autoAttach: false, waitForDebuggerOnStart: false, flatten: true },
      },
    ]);
  });

  it.each(["service_worker", "shared_worker", "page", "browser", "other", ""])(
    "a child of type %j is resumed, detached and never said: its session takes no command and its events and its detach are not said",
    async (type) => {
      const w = wall();
      const c = client(w.endpoint);
      await c.attach();
      const before = c.frames.length;
      attached(w.session(), "S-1", type, true);
      expect(w.session().sent).toEqual([
        { method: "Runtime.runIfWaitingForDebugger", params: {}, child: "S-1" },
        { method: "Target.detachFromTarget", params: { sessionId: "S-1" } },
      ]);
      w.open("act");
      const refused = await c.call("Runtime.enable", {}, "S-1");
      expect(refused.answer?.error?.data).toBe("vf:not-handed");
      w.session().emit({
        method: "Runtime.consoleAPICalled",
        params: { type: "log", args: [{ type: "string", value: "SENTINEL-WORKER" }] },
        child: "S-1",
      });
      w.session().emit({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S-1", targetId: "T-S-1" },
      });
      expect(c.frames.slice(before).filter((f) => f.method !== undefined)).toEqual([]);
      expect(JSON.stringify(c.frames)).not.toContain("SENTINEL-WORKER");
      expect(w.session().sent.filter((m) => m.method === "Runtime.enable")).toEqual([]);
    },
  );

  it("a service worker that attaches under a frame's session is detached on that frame's session", async () => {
    const w = wall();
    const c = client(w.endpoint);
    await c.attach();
    attached(w.session(), "C-1", "iframe", false);
    const before = c.frames.length;
    w.session().emit({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "S-2",
        targetInfo: { targetId: "T-S-2", type: "service_worker", url: "", title: "" },
        waitingForDebugger: false,
      },
      child: "C-1",
    });
    expect(w.session().sent).toEqual([
      { method: "Runtime.runIfWaitingForDebugger", params: {}, child: "S-2" },
      { method: "Target.detachFromTarget", params: { sessionId: "S-2" }, child: "C-1" },
    ]);
    expect(c.frames.slice(before)).toEqual([]);
  });

  it.each(["iframe", "worker"])(
    "a %s still attaches, is said to the client, and takes its commands",
    async (type) => {
      const w = wall();
      const c = client(w.endpoint);
      const s = await c.attach();
      attached(w.session(), "C-1", type, false);
      const said = c.frames.filter(
        (f) => f.method === "Target.attachedToTarget" && f.sessionId === s,
      );
      expect(said.map((f) => f.params?.sessionId)).toEqual(["C-1"]);
      w.open("read");
      expect((await c.call("Runtime.enable", {}, "C-1")).answer?.result).toEqual({});
      expect(w.session().sent).toEqual([{ method: "Runtime.enable", params: {}, child: "C-1" }]);
    },
  );

  it("says a child it turned away in the log by its type's word alone", async () => {
    const w = wall();
    const c = client(w.endpoint);
    await c.attach();
    attached(w.session(), "S-1", "service_worker", false);
    attached(w.session(), "S-2", "https://a.test/?SENTINEL", false);
    const lines = w.log.mock.calls.map(([line]) => line);
    expect(lines.filter((line) => line.event === "desktop.pages.child_refused")).toEqual([
      { event: "desktop.pages.child_refused", type: "service_worker" },
      { event: "desktop.pages.child_refused", type: "unknown" },
    ]);
  });
});
