// EY-1 (2026-11-24) — an ACT whose answer comes back late (BU-9; journal.ts `dropLate`). The client is refused a late
// answer (pages-endpoint-late), so it believes the command failed: what the command set must then not stay on the
// page, and must never come back at a put-down. The bridge takes it off for good, on the session it was set on, and
// the client hears so. On the real windows, journal and policy; the page's answer is given late by the row.
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
const ADD = "Page.addScriptToEvaluateOnNewDocument";
const REMOVE = "Page.removeScriptToEvaluateOnNewDocument";

describe("an act whose answer comes back late is taken off the page for good (EY-1, 2026-11-24)", () => {
  it("a route answered after its call's window closed, the page leased and in nobody's hand: Fetch.disable goes on the client's session and the entry ends", async () => {
    const enable = deferred<Record<string, never>>();
    const answer: PageAnswer = (method) => (method === "Fetch.enable" ? enable.promise : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    const pending = c.call("Fetch.enable", ROUTE, s);
    w.close(call);
    enable.resolve({});
    refusedAs((await pending).answer, "outside-window");
    const sent = w.session().sent;
    await expect
      .poll(() => sent)
      .toEqual([
        { method: "Fetch.enable", params: ROUTE },
        { method: "Fetch.disable", params: {} },
      ]);
    expect(w.journal.rows(PAGE).route.entries.map((e) => e.state)).toEqual(["ended"]);
  });

  it("an init script answered after the act lease ran out is removed by the identifier the page minted for it", async () => {
    const add = deferred<{ identifier: string }>();
    const answer: PageAnswer = (method) => (method === ADD ? add.promise : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    const pending = c.call(ADD, { source: "1" }, s);
    w.tick(5_001);
    add.resolve({ identifier: "LATE-SCRIPT" });
    const r = await pending;
    refusedAs(r.answer, "outside-window");
    expect(JSON.stringify(c.frames)).not.toContain("LATE-SCRIPT");
    const sent = w.session().sent;
    await expect
      .poll(() => sent)
      .toEqual([
        { method: ADD, params: { source: "1" } },
        { method: REMOVE, params: { identifier: "LATE-SCRIPT" } },
      ]);
    expect(w.journal.rows(PAGE)["init-script"].entries.map((e) => e.state)).toEqual(["ended"]);
  });

  it("an init script answered after a pick-up is removed and never minted again at the put-down, and the client's own retry leaves one script", async () => {
    const add = deferred<{ identifier: string }>();
    let adds = 0;
    const answer: PageAnswer = (method) => {
      if (method !== ADD) return {};
      adds += 1;
      return adds === 1 ? add.promise : { identifier: `s-${adds}` };
    };
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    const pending = c.call(ADD, { source: "1" }, s);
    await pickUp(w);
    add.resolve({ identifier: "LATE-SCRIPT" });
    refusedAs((await pending).answer, "held");
    const sent = w.session().sent;
    await expect
      .poll(() => sent)
      .toEqual([
        { method: ADD, params: { source: "1" } },
        { method: REMOVE, params: { identifier: "LATE-SCRIPT" } },
      ]);
    await putDown(w);
    // the client was told the add failed: nothing mints it again behind its back
    expect(sent.map((m) => m.method)).toEqual([ADD, REMOVE]);
    w.open("act");
    const again = await c.call(ADD, { source: "1" }, s);
    expect(again.answer?.result).toEqual({ identifier: "s-2" });
    expect(w.journal.rows(PAGE)["init-script"].entries.map((e) => e.state)).toEqual([
      "ended",
      "active",
    ]);
  });

  it("drops the late act alone: what the client set and was told of stays, and comes back at the put-down", async () => {
    const enable = deferred<Record<string, never>>();
    const answer: PageAnswer = (method) => (method === "Fetch.enable" ? enable.promise : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    const headers = { headers: { "x-row": "1" } };
    expect((await c.call("Network.setExtraHTTPHeaders", headers, s)).answer?.result).toEqual({});
    const pending = c.call("Fetch.enable", ROUTE, s);
    await pickUp(w);
    enable.resolve({});
    refusedAs((await pending).answer, "held");
    const sent = w.session().sent;
    await expect.poll(() => sent.at(-1)).toEqual({ method: "Fetch.disable", params: {} });
    const held = sent.length;
    await putDown(w);
    expect(sent.slice(held)).toEqual([{ method: "Network.setExtraHTTPHeaders", params: headers }]);
    expect(w.journal.rows(PAGE).route.entries.map((e) => e.state)).toEqual(["ended"]);
    expect(w.journal.rows(PAGE)["extra-headers"].entries.map((e) => e.state)).toEqual(["active"]);
  });

  it("a late act on a frame's session is taken off on that frame's session", async () => {
    const enable = deferred<Record<string, never>>();
    const answer: PageAnswer = (method, _params, child) =>
      method === "Fetch.enable" && child === "C-1" ? enable.promise : {};
    const w = wall({ answer });
    const c = client(w.endpoint);
    await c.attach();
    w.session().emit({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "C-1",
        targetInfo: { targetId: "T-1", type: "iframe", url: "", title: "" },
        waitingForDebugger: false,
      },
    });
    const call = w.open("act");
    const pending = c.call("Fetch.enable", ROUTE, "C-1");
    w.close(call);
    enable.resolve({});
    refusedAs((await pending).answer, "outside-window");
    const sent = w.session().sent;
    await expect
      .poll(() => sent.at(-1))
      .toEqual({ method: "Fetch.disable", params: {}, child: "C-1" });
  });

  it("tells the client the page keeps nothing of the command, and says the plan in the log by its counts alone", async () => {
    const add = deferred<{ identifier: string }>();
    const answer: PageAnswer = (method) => (method === ADD ? add.promise : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    const pending = c.call(ADD, { source: "SENTINEL-SOURCE" }, s);
    w.close(call);
    add.resolve({ identifier: "LATE-SCRIPT" });
    const r = await pending;
    refusedAs(r.answer, "outside-window");
    expect(r.answer?.error?.message).toContain("taken off the page");
    const lines = () => w.log.mock.calls.map(([line]) => line);
    await expect
      .poll(() => lines().filter((line) => line.event === "desktop.pages.journal_plan"))
      .toEqual([
        { event: "desktop.pages.journal_plan", plan: "late-act", items: 1, failed: 0, unsent: 0 },
      ]);
    expect(JSON.stringify(lines())).not.toContain("SENTINEL");
    expect(JSON.stringify(lines())).not.toContain("LATE-SCRIPT");
    // a late act is no call's refusal: the call it was admitted in has had its answer
    expect(w.refused).not.toHaveBeenCalled();
  });

  it("goes at once: it does not wait for the page to answer the pick-up's own plan", async () => {
    const enable = deferred<Record<string, never>>();
    const cleared = deferred<Record<string, never>>();
    const answer: PageAnswer = (method, params) => {
      if (method === "Fetch.enable") return enable.promise;
      const clear =
        method === "Network.setExtraHTTPHeaders" && JSON.stringify(params.headers) === "{}";
      return clear ? cleared.promise : {};
    };
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    await c.call("Network.setExtraHTTPHeaders", { headers: { "x-row": "1" } }, s);
    const pending = c.call("Fetch.enable", ROUTE, s);
    const up = pickUp(w);
    const sent = w.session().sent;
    const headersOff = { method: "Network.setExtraHTTPHeaders", params: { headers: {} } };
    await expect.poll(() => sent.at(-1)).toEqual(headersOff);
    enable.resolve({});
    refusedAs((await pending).answer, "held");
    // the page has not answered the pick-up's plan, and the late route is off all the same
    await expect.poll(() => sent.at(-1)).toEqual({ method: "Fetch.disable", params: {} });
    cleared.resolve({});
    await up;
  });

  it("a late act whose session went with the grant sends nothing: the page dropped it with the session, and its entry ends", async () => {
    const add = deferred<{ identifier: string }>();
    const answer: PageAnswer = (method) => (method === ADD ? add.promise : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    const pending = c.call(ADD, { source: "1" }, s);
    w.windows.unlease(PAGE);
    w.endpoint.ungrant(PAGE, "grant-end");
    add.resolve({ identifier: "LATE-SCRIPT" });
    refusedAs((await pending).answer, "no-lease");
    expect(w.session().sent).toEqual([{ method: ADD, params: { source: "1" } }]);
    expect(w.journal.rows(PAGE)["init-script"].entries.map((e) => e.state)).toEqual(["ended"]);
  });

  it("a late clear stays a clear: the client is refused its answer, the journal follows the page, and nothing is set again", async () => {
    const disable = deferred<Record<string, never>>();
    const answer: PageAnswer = (method) => (method === "Fetch.disable" ? disable.promise : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    await c.call("Fetch.enable", ROUTE, s);
    const pending = c.call("Fetch.disable", {}, s);
    w.close(call);
    disable.resolve({});
    const r = await pending;
    refusedAs(r.answer, "outside-window");
    expect(r.answer?.error?.message).not.toContain("taken off the page");
    expect(w.journal.rows(PAGE).route.entries.map((e) => e.state)).toEqual(["ended"]);
    await pickUp(w);
    await putDown(w);
    expect(w.session().sent.map((m) => m.method)).toEqual(["Fetch.enable", "Fetch.disable"]);
  });
});

describe("a removal that waited for the bridge's own plan (EY-1, 2026-11-24)", () => {
  /** A page whose first init script is `s-1`, whose second (the put-down's re-mint) answers when the row says. */
  function reminting() {
    const readd = deferred<{ identifier: string }>();
    let adds = 0;
    const answer: PageAnswer = (method) => {
      if (method !== ADD) return {};
      adds += 1;
      if (adds === 1) return { identifier: "s-1" };
      return adds === 2 ? readd.promise : { identifier: `s-${adds}` };
    };
    return { readd, answer };
  }

  it("goes only while the window it was admitted in still stands: after that window closed it is refused, not sent, and is no other call's refusal", async () => {
    const { readd, answer } = reminting();
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const first = w.open("act");
    await c.call(ADD, { source: "1" }, s);
    w.close(first);
    await pickUp(w);
    const sent = w.session().sent;
    const before = sent.length;
    // the put-down's re-mint is still on its way when the client removes its script in its next call
    const down = putDown(w);
    const second = w.open("act");
    const pending = c.call(REMOVE, { identifier: "s-1" }, s);
    w.close(second);
    w.open("act");
    readd.resolve({ identifier: "s-2" });
    await down;
    refusedAs((await pending).answer, "outside-window");
    expect(sent.slice(before)).toEqual([{ method: ADD, params: { source: "1" } }]);
    expect(w.refused).not.toHaveBeenCalled();
    // the script is still the client's to remove, in a window of its own, under the identifier the put-down minted
    const again = await c.call(REMOVE, { identifier: "s-1" }, s);
    expect(again.answer?.error).toBeUndefined();
    expect(sent.at(-1)).toEqual({ method: REMOVE, params: { identifier: "s-2" } });
  });

  it("is refused held, and not sent, when the person picked the page up again while it waited: the pick-up's undo is the one removal, and the put-down sets the script again", async () => {
    const { readd, answer } = reminting();
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    const first = w.open("act");
    await c.call(ADD, { source: "1" }, s);
    w.close(first);
    await pickUp(w);
    const sent = w.session().sent;
    const before = sent.length;
    const down = putDown(w);
    w.open("act");
    const pending = c.call(REMOVE, { identifier: "s-1" }, s);
    const up = pickUp(w);
    readd.resolve({ identifier: "s-2" });
    await down;
    await up;
    refusedAs((await pending).answer, "held");
    expect(sent.slice(before)).toEqual([
      { method: ADD, params: { source: "1" } },
      { method: REMOVE, params: { identifier: "s-2" } },
    ]);
    await putDown(w);
    expect(sent.at(-1)).toEqual({ method: ADD, params: { source: "1" } });
    expect(w.journal.rows(PAGE)["init-script"].entries.map((e) => e.state)).toEqual(["active"]);
  });
});
