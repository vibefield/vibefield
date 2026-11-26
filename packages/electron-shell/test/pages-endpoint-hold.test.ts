// EY-1 (2026-11-24) — the person's hand at the bridge (BU-9, EY-L2): a pick-up undoes what a client left on the page,
// as the bridge's own traffic on the session each thing was set on, and a put-down sets it again. The journal's plans
// are the journal's own rows (pages-core-journal); these hold that the endpoint SENDS them: on the real windows,
// journal and policy, with a stand-in page that records what reaches each client session.
import { describe, expect, it } from "vitest";
import {
  client,
  deferred,
  PAGE,
  type PageAnswer,
  pickUp,
  putDown,
  refusedAs,
  wall,
} from "./pages-wall-kit";

const ROUTE = { patterns: [{ urlPattern: "*" }] };

describe("a pick-up undoes what a client left on the page, and a put-down sets it again (EY-1, 2026-11-24)", () => {
  it("frees a route: Fetch.disable goes to the client's own session at the pick-up, though the wall still refuses the client held", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    expect((await c.call("Fetch.enable", ROUTE, s)).answer?.result).toEqual({});
    w.close(call);
    const sent = w.session().sent;
    const before = sent.length;
    await pickUp(w);
    expect(sent.slice(before)).toEqual([{ method: "Fetch.disable", params: {} }]);
    expect(w.journal.rows(PAGE).route.entries.map((e) => e.state)).toEqual(["undone"]);
    // the client's own answer for a request it saw paused stays refused: the bridge's undo is what frees the request
    refusedAs((await c.call("Fetch.continueRequest", { requestId: "r-1" }, s)).answer, "held");
    expect(sent.slice(before).map((m) => m.method)).toEqual(["Fetch.disable"]);
  });

  it("sets the route again at the put-down, on the same session", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    await c.call("Fetch.enable", ROUTE, s);
    w.close(call);
    await pickUp(w);
    const sent = w.session().sent;
    const before = sent.length;
    await putDown(w);
    expect(sent.slice(before)).toEqual([{ method: "Fetch.enable", params: ROUTE }]);
    expect(w.journal.rows(PAGE).route.entries.map((e) => e.state)).toEqual(["active"]);
  });

  it("silences a client's debugger and lets a paused page run on, keeps its breakpoint, and gives the client's own values back at the put-down", async () => {
    const answer: PageAnswer = (method) =>
      method === "Debugger.setBreakpointByUrl" ? { breakpointId: "bp-1", locations: [] } : {};
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    await c.call("Debugger.enable", {}, s);
    await c.call("Debugger.setBreakpointByUrl", { lineNumber: 3, url: "https://a.test/app.js" }, s);
    w.close(call);
    const sent = w.session().sent;
    const before = sent.length;
    await pickUp(w);
    expect(sent.slice(before)).toEqual([
      { method: "Debugger.setBreakpointsActive", params: { active: false } },
      { method: "Debugger.setSkipAllPauses", params: { skip: true } },
      { method: "Debugger.resume", params: {} },
    ]);
    const held = sent.length;
    await putDown(w);
    expect(sent.slice(held)).toEqual([
      { method: "Debugger.setBreakpointsActive", params: { active: true } },
      { method: "Debugger.setSkipAllPauses", params: { skip: false } },
    ]);
    expect(sent.map((m) => m.method)).not.toContain("Debugger.removeBreakpoint");
  });

  it("goes on with the plan when the page refuses one item of it: a page that was not paused refuses the resume, and the route is still freed", async () => {
    const answer: PageAnswer = (method) => {
      if (method === "Debugger.resume") throw new Error("Can only perform operation while paused.");
      return {};
    };
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    await c.call("Fetch.enable", ROUTE, s);
    await c.call("Debugger.enable", {}, s);
    w.close(call);
    const sent = w.session().sent;
    const before = sent.length;
    await pickUp(w);
    // newest first: the debugger's three, then the route's
    expect(sent.slice(before).map((m) => m.method)).toEqual([
      "Debugger.setBreakpointsActive",
      "Debugger.setSkipAllPauses",
      "Debugger.resume",
      "Fetch.disable",
    ]);
  });

  it("undoes what a client set on a frame's session on that frame's session", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    w.session().emit({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "C-1",
        targetInfo: { targetId: "T-1", type: "iframe", url: "", title: "" },
        waitingForDebugger: false,
      },
    });
    const call = w.open("act");
    expect((await c.call("Fetch.enable", ROUTE, "C-1")).answer?.result).toEqual({});
    await c.call("Network.setExtraHTTPHeaders", { headers: { "x-row": "1" } }, s);
    w.close(call);
    const sent = w.session().sent;
    const before = sent.length;
    await pickUp(w);
    expect(sent.slice(before)).toEqual([
      { method: "Network.setExtraHTTPHeaders", params: { headers: {} } },
      { method: "Fetch.disable", params: {}, child: "C-1" },
    ]);
  });

  it("re-mints an init script at the put-down, and the client's removal by its own name then goes under the new identifier", async () => {
    let minted = 0;
    const answer: PageAnswer = (method) => {
      if (method !== "Page.addScriptToEvaluateOnNewDocument") return {};
      minted += 1;
      return { identifier: `s-${minted}` };
    };
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const first = w.open("act");
    const added = await c.call("Page.addScriptToEvaluateOnNewDocument", { source: "1" }, s);
    expect(added.answer?.result).toEqual({ identifier: "s-1" });
    w.close(first);
    const sent = w.session().sent;
    const before = sent.length;
    await pickUp(w);
    await putDown(w);
    expect(sent.slice(before)).toEqual([
      { method: "Page.removeScriptToEvaluateOnNewDocument", params: { identifier: "s-1" } },
      { method: "Page.addScriptToEvaluateOnNewDocument", params: { source: "1" } },
    ]);
    w.open("act");
    const removed = await c.call(
      "Page.removeScriptToEvaluateOnNewDocument",
      { identifier: "s-1" },
      s,
    );
    expect(removed.answer?.error).toBeUndefined();
    expect(sent.at(-1)).toEqual({
      method: "Page.removeScriptToEvaluateOnNewDocument",
      params: { identifier: "s-2" },
    });
  });

  it("a second pick-up that comes before the put-down's answers removes the script by the identifier the put-down minted", async () => {
    const readd = deferred<{ identifier: string }>();
    let adds = 0;
    const answer: PageAnswer = (method) => {
      if (method !== "Page.addScriptToEvaluateOnNewDocument") return {};
      adds += 1;
      return adds === 1 ? { identifier: "s-1" } : readd.promise;
    };
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    await c.call("Page.addScriptToEvaluateOnNewDocument", { source: "1" }, s);
    w.close(call);
    await pickUp(w);
    const sent = w.session().sent;
    const before = sent.length;
    // the put-down's re-mint is still on its way when the person picks the page up again
    const down = putDown(w);
    const up = pickUp(w);
    readd.resolve({ identifier: "s-2" });
    await down;
    await up;
    expect(sent.slice(before)).toEqual([
      { method: "Page.addScriptToEvaluateOnNewDocument", params: { source: "1" } },
      { method: "Page.removeScriptToEvaluateOnNewDocument", params: { identifier: "s-2" } },
    ]);
  });

  it("takes off for good an act that landed after the pick-up: a route whose answer came back late is freed at once, and the put-down does not set it again", async () => {
    const enable = deferred<Record<string, never>>();
    const answer: PageAnswer = (method) => (method === "Fetch.enable" ? enable.promise : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    const pending = c.call("Fetch.enable", ROUTE, s);
    await pickUp(w);
    const sent = w.session().sent;
    // nothing was the journal's yet: the pick-up had nothing to undo
    expect(sent.map((m) => m.method)).toEqual(["Fetch.enable"]);
    enable.resolve({});
    // the client is refused the answer, so it holds the route failed
    refusedAs((await pending).answer, "held");
    await expect.poll(() => sent.map((m) => m.method)).toEqual(["Fetch.enable", "Fetch.disable"]);
    expect(w.journal.rows(PAGE).route.entries.map((e) => e.state)).toEqual(["ended"]);
    await putDown(w);
    expect(sent.map((m) => m.method)).toEqual(["Fetch.enable", "Fetch.disable"]);
  });

  it("sends nothing for a page with nothing left on it, and nothing for a page no run was handed", async () => {
    const w = wall();
    const c = client(w.endpoint);
    await c.attach();
    await pickUp(w);
    await putDown(w);
    expect(w.session().sent).toEqual([]);
    await w.endpoint.hold("P-never");
    await w.endpoint.putDown("P-never");
    expect(w.session().sent).toEqual([]);
  });

  it("says each plan in the log by its counts alone: no method's parameters, no source, no header", async () => {
    const answer: PageAnswer = (method) =>
      method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: "s-1" } : {};
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    await c.call("Network.setExtraHTTPHeaders", { headers: { "x-row": "SENTINEL-HEADER" } }, s);
    await c.call("Page.addScriptToEvaluateOnNewDocument", { source: "SENTINEL-SOURCE" }, s);
    w.close(call);
    await pickUp(w);
    await putDown(w);
    const lines = w.log.mock.calls.map(([line]) => line);
    expect(lines.filter((line) => line.event === "desktop.pages.journal_plan")).toEqual([
      { event: "desktop.pages.journal_plan", plan: "pick-up", items: 2, failed: 0, unsent: 0 },
      { event: "desktop.pages.journal_plan", plan: "put-down", items: 2, failed: 0, unsent: 0 },
    ]);
    expect(JSON.stringify(lines)).not.toContain("SENTINEL");
  });
});
