// EY-1 (2026-11-24) — A NEW PAGE'S FIRST MOMENTS WITH THE ENGINE. The second live run made a tab by the run form's
// `tab_new` and the bridge then refused the engine `Page.enable` on it twice, `outside-window`. Read at the pin's
// source (the model's head, pages-engine-kit.ts): the engine attaches to a page it is told of in its next drain, and
// registers it only if its first enable passes. A refused enable spends the event, so the engine never holds the
// page: every later call on it finds no such tab and answers `loading`, until the run's engine is replaced.
//
// These rows are on the plane as main composes it (the real windows core, endpoint, bridge, keyring and broker core)
// with the engine's attach modelled from that source.
import type { ShellSurfacesControlResult } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { type EnginePlane, enginePlane } from "./pages-engine-kit";
import { client, fakePort, LEASE, PAGE, TARGET, wall } from "./pages-wall-kit";

const RUN = "run-1";

/** The run form's open: the run's first page, and its engine on the bridge. */
async function opened(p: EnginePlane, url = "https://a.test/"): Promise<string> {
  const answer = await p.plane.control(
    { run: RUN, window: "act", command: { action: "navigate", url } },
    p.within(),
  );
  const surfaceId = answer.made?.[0]?.surfaceId;
  if (surfaceId === undefined) throw new Error("the open made no page");
  return surfaceId;
}

const outside = (p: EnginePlane) => p.refusals().filter((r) => r.code === "outside-window");

describe("a new page's first moments with the run's engine (EY-1, 2026-11-24)", () => {
  it("the engine's own connect and first call pass the wall: the model is the engine the first live runs met", async () => {
    const p = enginePlane();
    try {
      const a = await opened(p);
      expect(p.engine.knows(p.pageOf(a).targetId)).toBe(true);
      // the one refusal a good connect leaves, twice: once at the connect, once at the first drain
      expect(p.refusals()).toEqual([
        { method: "WebMCP.enable", code: "forbidden" },
        { method: "WebMCP.enable", code: "forbidden" },
      ]);
    } finally {
      await p.plane.stop("quit");
    }
  });

  it("the run form's tab_new: the engine's attach and first enable on the new tab fall inside the call's window, and the engine holds the tab", async () => {
    const p = enginePlane();
    try {
      await opened(p);
      const answer: ShellSurfacesControlResult = await p.plane.control(
        { run: RUN, window: "act", command: { action: "tab_new", url: "https://b.test/" } },
        p.within(),
      );
      expect(answer).toMatchObject({
        status: "done",
        made: [{ url: "https://b.test/", by: "tab" }],
      });
      const b = answer.made?.[0]?.surfaceId ?? "";
      // the engine's idle ticks after the call's answer: nothing of the tab is left for the wall to refuse
      await p.engine.tick();
      await p.engine.tick();
      expect(outside(p)).toEqual([]);
      expect(p.engine.knows(p.pageOf(b).targetId)).toBe(true);
      // the call's window closed with the call: nothing passes on the tab between calls
      expect(p.plane.windows.state(b).window).toBeNull();
      expect(
        p.plane.windows.admit(b, { mutation: false, capture: false, script: null }),
      ).toMatchObject({ ok: false, code: "outside-window" });
      // and the run's next call on the tab is answered
      const next = await p.plane.control(
        { run: RUN, surfaceId: b, window: "read", command: { action: "snapshot" } },
        p.within(),
      );
      expect(next).toMatchObject({ status: "done" });
    } finally {
      await p.plane.stop("quit");
    }
  });

  it("a page the engine could not attach to (a pop-up bound after its call ended) is said to it again inside the run's next call on it, which is answered", async () => {
    const p = enginePlane();
    try {
      const a = await opened(p);
      // the page opens a pop-up inside an act window, and the pop-up's own page is bound only after that call ended
      p.custody.bindAtOnce = false;
      p.engine.during = async (command) => {
        const policy = p.pageOf(a).policy;
        if (command.action !== "click" || policy === null) return undefined;
        if (policy.decide("https://pop.test/") === "allow") policy.open("https://pop.test/");
        return undefined;
      };
      await p.plane.control(
        { run: RUN, surfaceId: a, window: "act", command: { action: "click", selector: "@e1" } },
        p.within(),
      );
      const popup = p.made.at(-1);
      if (popup === undefined || popup.surfaceId === a) throw new Error("no pop-up page was made");
      popup.bound = true;
      await vi.waitFor(() =>
        expect(
          p.logged.some((l) => l.event === "desktop.pages.made" && l.fields.by === "popup"),
        ).toBe(true),
      );
      // made after its call ended, it has no window; the engine's idle ticks find the wall closed, as the live run's did
      await p.engine.tick();
      await p.engine.tick();
      expect(outside(p)).toEqual([
        { method: "Page.enable", code: "outside-window" },
        { method: "Page.enable", code: "outside-window" },
      ]);
      expect(p.engine.knows(popup.targetId)).toBe(false);
      // the run's next call on the page: main says the page to the engine again inside this call's window
      const next = await p.plane.control(
        { run: RUN, surfaceId: popup.surfaceId, window: "read", command: { action: "snapshot" } },
        p.within(),
      );
      expect(next).toMatchObject({ status: "done" });
      expect(p.engine.knows(popup.targetId)).toBe(true);
      expect(p.engine.commands.at(-1)).toMatchObject({ action: "snapshot" });
      // nothing more was refused outside a window on the way
      expect(outside(p)).toHaveLength(2);
    } finally {
      await p.plane.stop("quit");
    }
  });
});

// The engine's connect. As it joins the bridge the pinned engine lists the run's pages, attaches to each, and takes
// the FIRST that answers a probe (an error is an answer) as its active page: there alone it enables its domains, and
// a refused enable fails the connect, so the launch (browser.rs `discover_and_attach_targets`, `find_live_page_index`).
// The broker launches inside the window of the call's own page. The bridge listed the run's pages in the order they
// were granted, so with two pages and a call on the second, the engine enabled the first, outside any window.
describe("an engine that joins the bridge while its run holds several pages (EY-1, 2026-11-24)", () => {
  it("is listed the call's own page first, so its connect's enable falls inside that call's window: a call on the run's second page is answered", async () => {
    const p = enginePlane();
    try {
      const a = await opened(p);
      const tab = await p.plane.control(
        { run: RUN, window: "act", command: { action: "tab_new", url: "https://b.test/" } },
        p.within(),
      );
      const b = tab.made?.[0]?.surfaceId ?? "";
      // the run's engine ends (main's idle reap, or its own exit), and the run's next call is on its SECOND page
      p.engineExited(RUN);
      const launches = p.engine.commands.filter((c) => c.action === "launch").length;
      const next = await p.plane
        .control(
          { run: RUN, surfaceId: b, window: "act", command: { action: "click", selector: "@e1" } },
          p.within(),
        )
        .catch((error: unknown) => error);
      expect(next).toMatchObject({ status: "done" });
      expect(p.engine.commands.filter((c) => c.action === "launch")).toHaveLength(launches + 1);
      expect(p.engine.pages[p.engine.active]?.targetId).toBe(p.pageOf(b).targetId);
      // One refusal is left, and it changes nothing: the bridge said the engine's own attach to the OTHER page at
      // the connect, and the engine's first drain enables that page too, with no window on it. The page is the
      // engine's from the connect all the same (a line the live log will show once per other page at a launch).
      const other = [{ method: "Page.enable", code: "outside-window" }];
      expect(outside(p)).toEqual(other);
      expect(p.engine.knows(p.pageOf(a).targetId)).toBe(true);
      // and a call on the first page switches to it inside its own window: nothing more is refused
      const first = await p.plane.control(
        { run: RUN, surfaceId: a, window: "act", command: { action: "click", selector: "@e1" } },
        p.within(),
      );
      expect(first).toMatchObject({ status: "done" });
      expect(p.engine.pages[p.engine.active]?.targetId).toBe(p.pageOf(a).targetId);
      expect(outside(p)).toEqual(other);
    } finally {
      await p.plane.stop("quit");
    }
  });
});

describe("a granted page said again, on the endpoint's real parts (EY-1, 2026-11-24)", () => {
  it("is said to a client of its run that discovers targets, and to no other; a page with no grant is said to nobody", async () => {
    const w = wall();
    const quiet = client(w.endpoint);
    const listening = client(w.endpoint);
    await listening.call("Target.setDiscoverTargets", { discover: true });
    const another = client(w.endpoint, "run-2");
    await another.call("Target.setDiscoverTargets", { discover: true });
    const from = listening.frames.length;
    expect(w.endpoint.announce(PAGE)).toBe(1);
    expect(listening.frames.slice(from)).toEqual([
      {
        method: "Target.targetCreated",
        params: { targetInfo: expect.objectContaining({ targetId: TARGET, type: "page" }) },
      },
    ]);
    expect(quiet.frames).toEqual([]);
    expect(another.frames.filter((frame) => frame.method === "Target.targetCreated")).toEqual([]);
    expect(w.endpoint.announce("P-none")).toBe(0);
    // the grant's end: nothing is said of a page the run no longer holds
    w.endpoint.ungrant(PAGE, "row");
    expect(w.endpoint.announce(PAGE)).toBe(0);
  });
});

describe("the order a run's pages are listed in, on the endpoint's real parts (EY-1, 2026-11-24)", () => {
  it("a page a call's window stands on is listed first; with no window open, the order granted", async () => {
    const w = wall();
    const second = fakePort("DEVTOOLS-B");
    const page = { ...w.page, pageId: "P-b" };
    expect(w.endpoint.grant(RUN, page, second.port, { ...LEASE })).toEqual({ ok: true });
    w.windows.lease("P-b", { ...LEASE });
    const c = client(w.endpoint);
    const listed = async (): Promise<unknown[]> => {
      const infos = (await c.call("Target.getTargets")).answer?.result?.targetInfos;
      return (Array.isArray(infos) ? infos : []).map(
        (info: { targetId?: unknown }) => info.targetId,
      );
    };
    expect(await listed()).toEqual([TARGET, "DEVTOOLS-B"]);
    expect(w.windows.open("P-b", { kind: "read", callId: "call-b", action: "row" })).toEqual({
      ok: true,
    });
    expect(await listed()).toEqual(["DEVTOOLS-B", TARGET]);
    w.windows.close("P-b", "call-b");
    expect(await listed()).toEqual([TARGET, "DEVTOOLS-B"]);
  });
});

// A fieldd that was replaced (EY-1, 2026-11-24). A run that made no page is the broker's alone: custody holds no
// record of it, so custody's end of every run names it to nobody. Its grant on the person's page it was handed stood
// for a run no room would end, and a new run handed the same page was refused (one page is one run's). Main's boot
// fence asks the plane's own door, `endEveryRun`, beside custody's.
describe("a fieldd that was replaced, on the plane as main composes it (EY-1, 2026-11-24)", () => {
  it("a run that made no page is ended by the plane's own door: its grant on the person's page ends, and another run is answered there", async () => {
    const p = enginePlane();
    try {
      const page = p.handed("https://a.test/");
      const read = (run: string) =>
        p.plane.control(
          { run, surfaceId: page, window: "read", command: { action: "snapshot" } },
          p.within(),
        );
      expect(await read(RUN)).toMatchObject({ status: "done" });
      // one page is one run's: a second run handed the same page is refused while the first holds it
      expect(await read("run-2").catch((error: unknown) => error)).toMatchObject({
        kind: "PRECONDITION_FAILED",
      });
      // both runs are the gone fieldd's, the refused one too (the broker holds a run from its first call), and
      // custody holds a record of neither
      expect(await p.plane.endEveryRun()).toEqual({ runs: 2, unended: 0 });
      expect(p.logged).toContainEqual({
        event: "desktop.pages.broker.runs_ended",
        fields: { runs: 2, unended: 0 },
      });
      expect(p.lines.some((line) => line.event === "desktop.pages.grant_ended")).toBe(true);
      // the person's page stands, and a run of the new fieldd handed it is answered
      expect(p.pageOf(page).closed).toBe(false);
      expect(await read("run-3")).toMatchObject({ status: "done" });
    } finally {
      await p.plane.stop("quit");
    }
  });
});
