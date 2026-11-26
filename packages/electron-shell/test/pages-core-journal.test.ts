// EY-1 (2026-11-19) — the journal of what a client leaves on a page: the lab's journal tests
// (draft/browser-spike/ey/test/journal.test.js), ported whole, each call on the client's own session. The owner's
// identifiers live on another session, so mayRemove takes no owner sets; a signed-in reload names its session.
import { describe, expect, it } from "vitest";
import { createJournal, NEUTRAL_CONDITIONS } from "../src/main/pages/core/journal";
import { type CdpCall, JOURNAL_KINDS, type PlanItem } from "../src/main/pages/core/types";

const PAGE = "pg-0000aaaa";
const A = "conn-a";
const B = "conn-b";
const S_A = "sess-a";
const S_B = "sess-b";

const ROUTE: CdpCall = {
  method: "Fetch.enable",
  params: { patterns: [{ urlPattern: "*/route-dev/*", requestStage: "Request" }] },
};
const HEADERS: CdpCall = {
  method: "Network.setExtraHTTPHeaders",
  params: { headers: { "x-lab": "1" } },
};
const SCRIPT: CdpCall = {
  method: "Page.addScriptToEvaluateOnNewDocument",
  params: { source: "window.__lab = 1" },
};
const SLOW: CdpCall = {
  method: "Network.emulateNetworkConditions",
  params: { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};
const BINDING: CdpCall = { method: "Runtime.addBinding", params: { name: "__vfLab" } };

function strip(plan: readonly PlanItem[]): CdpCall[] {
  return plan.map(({ method, params }) => ({ method, params }));
}

function seeded() {
  const j = createJournal({ now: () => 0 });
  j.observe(PAGE, A, S_A, ROUTE, {});
  j.observe(PAGE, A, S_A, HEADERS, {});
  j.observe(PAGE, A, S_A, SCRIPT, { identifier: "3" });
  j.observe(PAGE, A, S_A, SLOW, {});
  j.observe(PAGE, A, S_A, BINDING, {});
  return j;
}

const REMOVE = (identifier: string): CdpCall => ({
  method: "Page.removeScriptToEvaluateOnNewDocument",
  params: { identifier },
});

describe("the journal of what a client leaves (the lab's journal tests, ported)", () => {
  it("observe records each stateful kind with an undo it derived itself", () => {
    const r = seeded().rows(PAGE);
    expect(Object.keys(r).sort()).toEqual([...JOURNAL_KINDS].sort());
    expect(r.route.entries[0]?.undo.method).toBe("Fetch.disable");
    expect(r.route.entries[0]?.key).toMatch(/^[0-9a-f]{8}$/u);
    expect(r["extra-headers"].entries[0]?.undo).toEqual({
      method: "Network.setExtraHTTPHeaders",
      params: { headers: {} },
    });
    expect(r["init-script"].entries[0]?.key).toBe("3");
    expect(r.throttling.entries[0]?.undo.params).toEqual(NEUTRAL_CONDITIONS);
    expect(r.binding.entries[0]?.undo).toEqual({
      method: "Runtime.removeBinding",
      params: { name: "__vfLab" },
    });
    for (const kind of [
      "route",
      "extra-headers",
      "init-script",
      "throttling",
      "binding",
    ] as const) {
      expect(r[kind].exercised).toBe(true);
      expect(r[kind].entries[0]?.state).toBe("active");
      expect(r[kind].entries[0]?.session).toBe(S_A);
    }
    // The emulation row stays empty, and says so.
    expect(r.emulation).toEqual({ entries: [], exercised: false });
  });

  it("non-stateful commands are not journaled", () => {
    const j = createJournal();
    const none: CdpCall[] = [
      { method: "Runtime.evaluate", params: { expression: "1" } },
      { method: "Input.dispatchMouseEvent", params: {} },
      { method: "Page.addScriptToEvaluateOnNewDocument", params: {} },
    ];
    for (const call of none) expect(j.observe(PAGE, A, S_A, call, {})).toBeNull();
    for (const row of Object.values(j.rows(PAGE))) expect(row.exercised).toBe(false);
  });

  it("pick-up undoes newest first; a second pick-up sends nothing", () => {
    const j = seeded();
    expect(strip(j.undoPlan(PAGE))).toEqual([
      { method: "Runtime.removeBinding", params: { name: "__vfLab" } },
      { method: "Network.emulateNetworkConditions", params: { ...NEUTRAL_CONDITIONS } },
      { method: "Page.removeScriptToEvaluateOnNewDocument", params: { identifier: "3" } },
      { method: "Network.setExtraHTTPHeaders", params: { headers: {} } },
      { method: "Fetch.disable", params: {} },
    ]);
    for (const row of Object.values(j.rows(PAGE))) {
      for (const e of row.entries) expect(e.state).toBe("undone");
    }
    expect(j.undoPlan(PAGE)).toEqual([]);
  });

  it("put-down redoes oldest first with the client's own params; a re-minted init script is aliased", () => {
    const j = seeded();
    j.undoPlan(PAGE);
    const redo = j.redoPlan(PAGE);
    expect(strip(redo)).toEqual([ROUTE, HEADERS, SCRIPT, SLOW, BINDING]);
    expect(j.redoPlan(PAGE)).toEqual([]);
    j.applyResults(PAGE, redo, [{}, {}, { identifier: "7" }, {}, {}]);
    expect(j.rows(PAGE)["init-script"].entries[0]?.alias).toBe("7");
    // The client still names "3"; the bridge forwards "7".
    expect(j.translate(PAGE, A, S_A, REMOVE("3")).params).toEqual({ identifier: "7" });
    // Another client naming "3" is not translated (and mayRemove refuses it first).
    expect(j.translate(PAGE, B, S_B, REMOVE("3")).params).toEqual({ identifier: "3" });
    // The next pick-up removes the live identifier.
    const again = j
      .undoPlan(PAGE)
      .find((x) => x.method === "Page.removeScriptToEvaluateOnNewDocument");
    expect(again?.params).toEqual({ identifier: "7" });
  });

  it("grant end undoes for good, from active or from held", () => {
    const j = seeded();
    const plan = j.endPlan(PAGE);
    expect(plan).toHaveLength(5);
    expect(plan[plan.length - 1]?.method).toBe("Fetch.disable");
    for (const row of Object.values(j.rows(PAGE))) {
      for (const e of row.entries) expect(e.state).toBe("ended");
    }
    expect(j.redoPlan(PAGE)).toEqual([]);
    expect(j.undoPlan(PAGE)).toEqual([]);

    const held = seeded();
    held.undoPlan(PAGE);
    expect(held.endPlan(PAGE)).toEqual([]);
    expect(held.redoPlan(PAGE)).toEqual([]);
  });

  it("whole-state kinds: a new set replaces the old entry, a neutral set ends it", () => {
    const j = createJournal();
    j.observe(PAGE, A, S_A, ROUTE, {});
    const second: CdpCall = {
      method: "Fetch.enable",
      params: { patterns: [{ urlPattern: "*" }], handleAuthRequests: true },
    };
    j.observe(PAGE, A, S_A, second, {});
    let route = j.rows(PAGE).route.entries;
    expect(route.map((e) => e.state)).toEqual(["ended", "active"]);
    expect(route[0]?.key).not.toBe(route[1]?.key);
    j.undoPlan(PAGE);
    expect(strip(j.redoPlan(PAGE))).toEqual([second]);
    j.observe(PAGE, A, S_A, { method: "Fetch.disable", params: {} }, {});
    route = j.rows(PAGE).route.entries;
    expect(route.map((e) => e.state)).toEqual(["ended", "ended"]);

    j.observe(PAGE, A, S_A, HEADERS, {});
    j.observe(PAGE, A, S_A, { method: "Network.setExtraHTTPHeaders", params: { headers: {} } }, {});
    j.observe(PAGE, A, S_A, SLOW, {});
    j.observe(
      PAGE,
      A,
      S_A,
      { method: "Network.emulateNetworkConditions", params: { ...NEUTRAL_CONDITIONS } },
      {},
    );
    expect(j.undoPlan(PAGE)).toEqual([]);
  });

  it("throttling is keyed by method: the two overrides are separate", () => {
    const j = createJournal();
    j.observe(PAGE, A, S_A, SLOW, {});
    j.observe(
      PAGE,
      A,
      S_A,
      {
        method: "Network.overrideNetworkState",
        params: { offline: true, latency: 5, downloadThroughput: 1, uploadThroughput: 1 },
      },
      {},
    );
    expect(strip(j.undoPlan(PAGE)).map((x) => x.method)).toEqual([
      "Network.overrideNetworkState",
      "Network.emulateNetworkConditions",
    ]);
  });

  it("a client's own removals end its entries", () => {
    const j = seeded();
    j.observe(PAGE, A, S_A, REMOVE("3"), {});
    j.observe(PAGE, A, S_A, { method: "Runtime.removeBinding", params: { name: "__vfLab" } }, {});
    const r = j.rows(PAGE);
    expect(r["init-script"].entries[0]?.state).toBe("ended");
    expect(r.binding.entries[0]?.state).toBe("ended");
    expect(strip(j.undoPlan(PAGE)).map((x) => x.method)).toEqual([
      "Network.emulateNetworkConditions",
      "Network.setExtraHTTPHeaders",
      "Fetch.disable",
    ]);
  });

  it("mayRemove: only what this client minted (P§6)", () => {
    const j = seeded();
    expect(j.mayRemove(PAGE, A, S_A, "init-script", "3")).toEqual({ ok: true });
    expect(j.mayRemove(PAGE, A, S_A, "binding", "__vfLab")).toEqual({ ok: true });
    const refused: [string, string, "init-script" | "binding", string][] = [
      // the owner's identifiers and bindings live on its own session: never this client's
      [A, S_A, "init-script", "1"],
      [A, S_A, "binding", "__vfFrame"],
      [B, S_B, "init-script", "3"],
      [B, S_B, "binding", "__vfLab"],
      [A, S_A, "init-script", "99"],
      [A, S_A, "binding", "nobody"],
    ];
    for (const [client, session, kind, key] of refused) {
      expect(j.mayRemove(PAGE, client, session, kind, key)).toMatchObject({
        ok: false,
        code: "forbidden",
      });
    }
    // The alias is not the client's name for it.
    j.undoPlan(PAGE);
    const redo = j.redoPlan(PAGE);
    j.applyResults(PAGE, redo, [{}, {}, { identifier: "7" }, {}, {}]);
    expect(j.mayRemove(PAGE, A, S_A, "init-script", "7").ok).toBe(false);
    expect(j.mayRemove(PAGE, A, S_A, "init-script", "3").ok).toBe(true);
    // Once removed, it is gone.
    j.observe(PAGE, A, S_A, REMOVE("7"), {});
    expect(j.mayRemove(PAGE, A, S_A, "init-script", "3").ok).toBe(false);
    expect(() => j.mayRemove(PAGE, A, S_A, "route" as "binding", "x")).toThrow(TypeError);
  });

  it("an Emulation.* that passed anyway turns the row non-empty and is never undone by the journal", () => {
    const j = createJournal();
    const emu: CdpCall = {
      method: "Emulation.setGeolocationOverride",
      params: { latitude: 1, longitude: 2, accuracy: 3 },
    };
    expect(j.observe(PAGE, A, S_A, emu, {})?.kind).toBe("emulation");
    const row = j.rows(PAGE).emulation;
    expect(row.exercised).toBe(true);
    expect(row.entries).toHaveLength(1);
    expect(j.undoPlan(PAGE)).toEqual([]);
    expect(j.redoPlan(PAGE)).toEqual([]);
    expect(j.endPlan(PAGE)).toEqual([]);
    expect(j.rows(PAGE).emulation.entries[0]?.state).toBe("ended");
  });

  it("BU-3's script grant end: everything the grant gated undone for good, then the reload on signed-in", () => {
    const j = seeded();
    const plan = j.scriptGrantEndPlan(PAGE, { pageClass: "signed-in", reloadSession: S_A });
    // The route and the headers were admitted on this class only under the grant: they end with it, BEFORE the
    // reload, so no request of the reload pauses for the client to answer.
    expect(strip(plan)).toEqual([
      { method: "Runtime.removeBinding", params: { name: "__vfLab" } },
      { method: "Page.removeScriptToEvaluateOnNewDocument", params: { identifier: "3" } },
      { method: "Network.setExtraHTTPHeaders", params: { headers: {} } },
      { method: "Fetch.disable", params: {} },
      { method: "Page.reload", params: {} },
    ]);
    expect(plan[plan.length - 1]).toMatchObject({ reload: true, session: S_A });
    const r = j.rows(PAGE);
    expect(r["init-script"].entries[0]?.state).toBe("ended");
    expect(r.binding.entries[0]?.state).toBe("ended");
    expect(r.route.entries[0]?.state).toBe("ended");
    expect(r["extra-headers"].entries[0]?.state).toBe("ended");
    // Throttling is not the grant's (refused on signed-in anyway): it stays journaled; a pick-up still undoes it.
    expect(j.undoPlan(PAGE)).toHaveLength(1);
    // Nothing the grant gated comes back at put-down.
    expect(j.redoPlan(PAGE).map((x) => x.method)).toEqual(["Network.emulateNetworkConditions"]);

    const own = seeded();
    const ownPlan = own.scriptGrantEndPlan(PAGE, { pageClass: "own" });
    expect(ownPlan.some((x) => x.reload)).toBe(false);
    expect(ownPlan).toHaveLength(2);

    // Ending the grant while the page is held: already undone, so only the reload remains, and put-down re-sends
    // neither the route nor the headers as the bridge's own traffic.
    const held = seeded();
    held.undoPlan(PAGE);
    expect(strip(held.scriptGrantEndPlan(PAGE, { reloadSession: S_A }))).toEqual([
      { method: "Page.reload", params: {} },
    ]);
    const redo = held.redoPlan(PAGE).map((x) => x.method);
    expect(redo.some((m) => m === "Runtime.addBinding" || m === "Fetch.enable")).toBe(false);
    expect(redo.includes("Network.setExtraHTTPHeaders")).toBe(false);

    // A signed-in page's end reloads on a named session: with none, nothing is planned and nothing ends.
    const bare = seeded();
    expect(() => bare.scriptGrantEndPlan(PAGE)).toThrow(TypeError);
    expect(bare.rows(PAGE).route.entries[0]?.state).toBe("active");
  });

  it("pages are independent, and rows are copies", () => {
    const j = seeded();
    expect(j.undoPlan("pg-0000bbbb")).toHaveLength(0);
    const rows = j.rows(PAGE);
    (rows.route.entries[0] as { state: string }).state = "tampered";
    expect(j.rows(PAGE).route.entries[0]?.state).toBe("active");
    // A client's params are copied on observe: mutating the original changes nothing.
    const cmd = { method: "Network.setExtraHTTPHeaders", params: { headers: { "x-a": "1" } } };
    const j2 = createJournal();
    j2.observe(PAGE, A, S_A, cmd, {});
    cmd.params.headers["x-a"] = "2";
    const kept = j2.rows(PAGE)["extra-headers"].entries[0]?.set.params.headers;
    expect((kept as Record<string, string>)["x-a"]).toBe("1");
  });

  // ---- the hole review (2026-10-31) ----

  it("settleLate: a result that comes back after the plan ran is settled the same way", () => {
    // Pick-up first: the hold's plan ran without the route; the route's result comes back while held.
    const held = createJournal({ now: () => 0 });
    held.observe(PAGE, A, S_A, HEADERS, {});
    expect(held.undoPlan(PAGE)).toHaveLength(1);
    const lateRoute = held.observe(PAGE, A, S_A, ROUTE, {});
    const s1 = held.settleLate(PAGE, lateRoute, {
      leased: true,
      held: true,
      pageClass: "own",
      scriptGrant: false,
    });
    expect(s1?.label).toBe("late-hold");
    expect(strip(s1?.plan ?? [])).toEqual([{ method: "Fetch.disable", params: {} }]);
    // Put-down redoes it with the rest, oldest first.
    expect(held.redoPlan(PAGE).map((x) => x.method)).toEqual([
      "Network.setExtraHTTPHeaders",
      "Fetch.enable",
    ]);

    // The grant ended first: the late entry ends for good.
    const ended = createJournal({ now: () => 0 });
    ended.endPlan(PAGE);
    const lateScript = ended.observe(PAGE, A, S_A, SCRIPT, { identifier: "9" });
    const s2 = ended.settleLate(PAGE, lateScript, {
      leased: false,
      held: false,
      pageClass: "own",
      scriptGrant: false,
    });
    expect(s2?.label).toBe("late-grant-end");
    expect(strip(s2?.plan ?? [])).toEqual([REMOVE("9")]);
    expect(ended.rows(PAGE)["init-script"].entries[0]?.state).toBe("ended");

    // BU-3's script grant ended first on a signed-in page: the late route ends, and the page reloads again (the add
    // reached Chromium before the plan's reload).
    const gated = createJournal({ now: () => 0 });
    gated.scriptGrantEndPlan(PAGE, { pageClass: "signed-in", reloadSession: S_A });
    const lateGated = gated.observe(PAGE, A, S_A, ROUTE, {});
    const s3 = gated.settleLate(PAGE, lateGated, {
      leased: true,
      held: false,
      pageClass: "signed-in",
      scriptGrant: false,
      reloadSession: S_A,
    });
    expect(s3?.label).toBe("late-script-grant-end");
    expect(strip(s3?.plan ?? [])).toEqual([
      { method: "Fetch.disable", params: {} },
      { method: "Page.reload", params: {} },
    ]);

    // Nothing to settle: the grant still stands, the page is not held, or nothing was recorded.
    const fine = createJournal({ now: () => 0 });
    const e = fine.observe(PAGE, A, S_A, ROUTE, {});
    const standing = { leased: true, held: false, scriptGrant: true } as const;
    expect(fine.settleLate(PAGE, e, { ...standing, pageClass: "signed-in" })).toBeNull();
    expect(fine.settleLate(PAGE, e, { ...standing, pageClass: "own" })).toBeNull();
    expect(
      fine.settleLate(PAGE, null, {
        leased: false,
        held: true,
        pageClass: "own",
        scriptGrant: false,
      }),
    ).toBeNull();
  });

  // ---- a late act the client was refused (2026-11-24) ----

  it("dropLate: a late act ends for good and answers its undo on its own session; it never comes back at a put-down", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, HEADERS, {});
    const late = j.observe(PAGE, A, S_A, SCRIPT, { identifier: "9" });
    const plan = j.dropLate(PAGE, late);
    expect(strip(plan)).toEqual([REMOVE("9")]);
    expect(plan[0]?.session).toBe(S_A);
    expect(j.rows(PAGE)["init-script"].entries[0]?.state).toBe("ended");
    // the rest of what the client left is untouched, and is the cycle's alone
    expect(strip(j.undoPlan(PAGE))).toEqual([
      { method: "Network.setExtraHTTPHeaders", params: { headers: {} } },
    ]);
    expect(strip(j.redoPlan(PAGE))).toEqual([HEADERS]);
    // the client never received "9": it is not its to remove; a second drop answers nothing
    expect(j.mayRemove(PAGE, A, S_A, "init-script", "9").ok).toBe(false);
    expect(j.dropLate(PAGE, late)).toEqual([]);
  });

  it("dropLate: one a pick-up already took off answers nothing, the debugger aside; none and an unknown one answer nothing", () => {
    const j = createJournal({ now: () => 0 });
    const route = j.observe(PAGE, A, S_A, ROUTE, {});
    const dbg = j.observe(
      PAGE,
      A,
      S_A,
      { method: "Debugger.enable", params: {} },
      { debuggerId: "d" },
    );
    j.undoPlan(PAGE);
    expect(j.dropLate(PAGE, route)).toEqual([]);
    // a pick-up only silences the debugger: its end still takes it off
    expect(strip(j.dropLate(PAGE, dbg))).toEqual([{ method: "Debugger.disable", params: {} }]);
    expect(j.redoPlan(PAGE)).toEqual([]);
    expect(j.dropLate(PAGE, null)).toEqual([]);
    expect(j.dropLate("pg-0000bbbb", route)).toEqual([]);
  });

  it("dropLate: a late whole-state set leaves its kind neutral on its session: the value it replaced is not set again, and another session's is untouched", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, ROUTE, {});
    j.observe(PAGE, B, S_B, ROUTE, {});
    const wider: CdpCall = { method: "Fetch.enable", params: { patterns: [{ urlPattern: "*" }] } };
    const late = j.observe(PAGE, A, S_A, wider, {});
    expect(j.dropLate(PAGE, late)).toEqual([
      { method: "Fetch.disable", params: {}, session: S_A, entrySeq: late?.seq },
    ]);
    const states = j
      .rows(PAGE)
      .route.entries.map((e) => `${e.session}:${e.state}`)
      .sort();
    expect(states).toEqual([`${S_A}:ended`, `${S_A}:ended`, `${S_B}:active`]);
    // nothing of the dropped session is set again; the other client's route is the cycle's as before
    j.undoPlan(PAGE);
    expect(j.redoPlan(PAGE).map((x) => x.session)).toEqual([S_B]);
  });

  it("the debugger: silenced at pick-up, restored at put-down, removed at any end (held or not)", () => {
    const j = createJournal({ now: () => 0 });
    const enable: CdpCall = { method: "Debugger.enable", params: {} };
    expect(j.observe(PAGE, A, S_A, enable, { debuggerId: "d" })?.kind).toBe("debugger");
    // one entry while on
    expect(j.observe(PAGE, A, S_A, enable, {})).toBeNull();
    const bp = j.observe(
      PAGE,
      A,
      S_A,
      {
        method: "Debugger.setBreakpointByUrl",
        params: { lineNumber: 3, url: "http://vfey-a.test/a.js", condition: "fetch('//x')" },
      },
      { breakpointId: "1:3:0:a" },
    );
    expect(bp?.kind).toBe("breakpoint");
    j.observe(PAGE, A, S_A, { method: "Debugger.setSkipAllPauses", params: { skip: true } }, {});
    // Pick-up: no pause, no breakpoint hit, the page runs on; the breakpoint itself is pinned (its id never changes).
    expect(strip(j.undoPlan(PAGE))).toEqual([
      { method: "Debugger.setBreakpointsActive", params: { active: false } },
      { method: "Debugger.setSkipAllPauses", params: { skip: true } },
      { method: "Debugger.resume", params: {} },
    ]);
    // Put-down: the client's own values (it had set skip: true itself).
    expect(strip(j.redoPlan(PAGE))).toEqual([
      { method: "Debugger.setBreakpointsActive", params: { active: true } },
      { method: "Debugger.setSkipAllPauses", params: { skip: true } },
    ]);
    // A grant end while held: the breakpoint is removed and the debugger disabled, though the debugger was "undone".
    j.undoPlan(PAGE);
    expect(strip(j.endPlan(PAGE))).toEqual([
      { method: "Debugger.removeBreakpoint", params: { breakpointId: "1:3:0:a" } },
      { method: "Debugger.disable", params: {} },
    ]);
    expect(j.redoPlan(PAGE)).toEqual([]);
  });

  it("the debugger ends with BU-3's script grant on signed-in, before the reload; the client's disable ends it", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, { method: "Debugger.enable", params: {} }, {});
    j.observe(
      PAGE,
      A,
      S_A,
      {
        method: "Debugger.setBreakpoint",
        params: { location: { scriptId: "5", lineNumber: 1 }, condition: "x()" },
      },
      { breakpointId: "bp-1" },
    );
    expect(
      strip(j.scriptGrantEndPlan(PAGE, { pageClass: "signed-in", reloadSession: S_A })),
    ).toEqual([
      { method: "Debugger.removeBreakpoint", params: { breakpointId: "bp-1" } },
      { method: "Debugger.disable", params: {} },
      { method: "Page.reload", params: {} },
    ]);
    const k = createJournal({ now: () => 0 });
    k.observe(PAGE, A, S_A, { method: "Debugger.enable", params: {} }, {});
    k.observe(
      PAGE,
      A,
      S_A,
      { method: "Debugger.setBreakpoint", params: {} },
      { breakpointId: "bp-2" },
    );
    k.observe(PAGE, A, S_A, { method: "Debugger.disable", params: {} }, {});
    expect(k.endPlan(PAGE)).toEqual([]);
    expect(k.rows(PAGE).breakpoint.entries[0]?.state).toBe("ended");
  });

  it("a trace ends at pick-up and is never redone; Tracing.end ends it", () => {
    const j = createJournal({ now: () => 0 });
    const t = j.observe(PAGE, A, S_A, { method: "Tracing.start", params: { traceConfig: {} } }, {});
    expect(t?.kind).toBe("tracing");
    expect(strip(j.undoPlan(PAGE))).toEqual([{ method: "Tracing.end", params: {} }]);
    expect(j.rows(PAGE).tracing.entries[0]?.state).toBe("ended");
    expect(j.redoPlan(PAGE)).toEqual([]);
    const k = createJournal({ now: () => 0 });
    k.observe(PAGE, A, S_A, { method: "Tracing.start", params: {} }, {});
    k.observe(PAGE, A, S_A, { method: "Tracing.end", params: {} }, {});
    expect(k.endPlan(PAGE)).toEqual([]);
    // A grant end while tracing stops it.
    const g = createJournal({ now: () => 0 });
    g.observe(PAGE, A, S_A, { method: "Tracing.start", params: {} }, {});
    expect(strip(g.endPlan(PAGE))).toEqual([{ method: "Tracing.end", params: {} }]);
  });
});

const CHILD_A = "sess-a-frame-1";

describe("the journal keys each entry by its client's session (one session per client)", () => {
  it("every plan item names the session its entry was set on; a child's entries go to the child", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, ROUTE, {});
    j.observe(PAGE, A, CHILD_A, SCRIPT, { identifier: "4" });
    j.observe(PAGE, B, S_B, BINDING, {});
    const at = (plan: readonly PlanItem[]) => plan.map((x) => [x.method, x.session]);
    expect(at(j.undoPlan(PAGE))).toEqual([
      ["Runtime.removeBinding", S_B],
      ["Page.removeScriptToEvaluateOnNewDocument", CHILD_A],
      ["Fetch.disable", S_A],
    ]);
    expect(at(j.redoPlan(PAGE))).toEqual([
      ["Fetch.enable", S_A],
      ["Page.addScriptToEvaluateOnNewDocument", CHILD_A],
      ["Runtime.addBinding", S_B],
    ]);
    expect(at(j.endPlan(PAGE))).toEqual([
      ["Runtime.removeBinding", S_B],
      ["Page.removeScriptToEvaluateOnNewDocument", CHILD_A],
      ["Fetch.disable", S_A],
    ]);
  });

  it("a whole-state set replaces only its own session's entry: two clients' routes stand side by side", () => {
    const j = createJournal({ now: () => 0 });
    const states = () => j.rows(PAGE).route.entries.map((e) => [e.session, e.state]);
    j.observe(PAGE, A, S_A, ROUTE, {});
    j.observe(
      PAGE,
      B,
      S_B,
      { method: "Fetch.enable", params: { patterns: [{ urlPattern: "*" }] } },
      {},
    );
    expect(states()).toEqual([
      [S_A, "active"],
      [S_B, "active"],
    ]);
    // B's own clear ends B's route alone
    j.observe(PAGE, B, S_B, { method: "Fetch.disable", params: {} }, {});
    expect(states()).toEqual([
      [S_A, "active"],
      [S_B, "ended"],
    ]);
    // headers and throttling, the same
    j.observe(PAGE, A, S_A, HEADERS, {});
    j.observe(PAGE, B, S_B, HEADERS, {});
    j.observe(PAGE, B, S_B, SLOW, {});
    j.observe(PAGE, A, S_A, SLOW, {});
    expect(j.undoPlan(PAGE).map((x) => [x.method, x.session])).toEqual([
      ["Network.emulateNetworkConditions", S_A],
      ["Network.emulateNetworkConditions", S_B],
      ["Network.setExtraHTTPHeaders", S_B],
      ["Network.setExtraHTTPHeaders", S_A],
      ["Fetch.disable", S_A],
    ]);
  });

  it("the debugger and a trace are one entry per session, and a session's disable ends its own", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, { method: "Debugger.enable", params: {} }, {});
    expect(j.observe(PAGE, B, S_B, { method: "Debugger.enable", params: {} }, {})?.kind).toBe(
      "debugger",
    );
    j.observe(PAGE, A, S_A, { method: "Tracing.start", params: {} }, {});
    j.observe(PAGE, B, S_B, { method: "Tracing.start", params: {} }, {});
    expect(j.rows(PAGE).tracing.entries.map((e) => e.state)).toEqual(["active", "active"]);
    j.observe(PAGE, B, S_B, { method: "Debugger.disable", params: {} }, {});
    expect(j.rows(PAGE).debugger.entries.map((e) => [e.session, e.state])).toEqual([
      [S_A, "active"],
      [S_B, "ended"],
    ]);
  });

  it("sessionEnded ends a detached session's entries and returns no plan; the others stand", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, ROUTE, {});
    j.observe(PAGE, A, CHILD_A, SCRIPT, { identifier: "4" });
    j.observe(PAGE, B, S_B, BINDING, {});
    // the bridge calls it once per detached session, the child's too
    expect(j.sessionEnded(PAGE, CHILD_A)).toBe(1);
    expect(j.sessionEnded(PAGE, S_A)).toBe(1);
    expect(j.rows(PAGE)["init-script"].entries[0]?.state).toBe("ended");
    expect(j.rows(PAGE).route.entries[0]?.state).toBe("ended");
    expect(j.undoPlan(PAGE).map((x) => [x.method, x.session])).toEqual([
      ["Runtime.removeBinding", S_B],
    ]);
    expect(j.sessionEnded(PAGE, S_A)).toBe(0);
  });

  it("mayRemove: a client removes only what it minted on its own session", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, SCRIPT, { identifier: "3" });
    j.observe(PAGE, A, S_A, BINDING, {});
    expect(j.mayRemove(PAGE, A, S_A, "init-script", "3")).toEqual({ ok: true });
    expect(j.mayRemove(PAGE, A, S_A, "binding", "__vfLab")).toEqual({ ok: true });
    // the same client on another of its sessions: not where it minted them
    expect(j.mayRemove(PAGE, A, CHILD_A, "init-script", "3")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(j.mayRemove(PAGE, A, CHILD_A, "binding", "__vfLab")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("translate maps only the identifier its own session received", () => {
    const j = createJournal({ now: () => 0 });
    j.observe(PAGE, A, S_A, SCRIPT, { identifier: "3" });
    j.undoPlan(PAGE);
    j.applyResults(PAGE, j.redoPlan(PAGE), [{ identifier: "7" }]);
    expect(j.translate(PAGE, A, S_A, REMOVE("3")).params).toEqual({ identifier: "7" });
    expect(j.translate(PAGE, A, CHILD_A, REMOVE("3")).params).toEqual({ identifier: "3" });
  });
});
