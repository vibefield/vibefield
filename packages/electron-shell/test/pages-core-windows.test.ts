// EY-1 (2026-11-19) — read and act windows, the hold, the Fetch exception and the act lease: the lab's windows tests
// (draft/browser-spike/ey/test/windows.test.js), ported whole, with `no-window` renamed `outside-window` and the act
// lease given by the caller.
import { SURFACE_AUTHORITY_LIMITS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  ACT_LEASE_MS_PROPOSED,
  type Admission,
  type PageLease,
  type PagePins,
  type PinApplied,
} from "../src/main/pages/core/types";
import {
  createWindows,
  FETCH_ANSWER_GRACE_MS,
  FETCH_ANSWER_METHODS,
  fetchAnswerOf,
  fetchAnswerPlain,
  lateVerdict,
  paneGatePages,
  WINDOW_HISTORY_MAX,
} from "../src/main/pages/core/windows";

const PAGE = "pg-0000aaaa";
const LEASE: PageLease = { runKey: "run-1", producerEpoch: 1, bindingRevision: 1 };

function clock(start = 1000): { t: number; now: () => number } {
  const c = { t: start, now: () => c.t };
  return c;
}

type Log = (event: string, fields: Readonly<Record<string, number | string>>) => void;

function windows(
  o: { readonly now?: () => number; readonly actLeaseMs?: number; readonly log?: Log } = {},
) {
  return createWindows({
    actLeaseMs: o.actLeaseMs ?? ACT_LEASE_MS_PROPOSED,
    ...(o.now ? { now: o.now } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
}

function leased(
  o: { readonly now?: () => number; readonly actLeaseMs?: number; readonly log?: Log } = {},
) {
  const w = windows(o);
  w.lease(PAGE, LEASE);
  return w;
}

const READ: Admission = { mutation: false, capture: false, script: null };
const ACT: Admission = { mutation: true, capture: false, script: null };
const STILL: Admission = { mutation: false, capture: true, script: null };
const PLAIN = { fetchPlain: true } as const;

function code(v: { readonly ok: boolean; readonly code?: string }): string | undefined {
  return v.ok ? undefined : v.code;
}

describe("read and act windows (the lab's windows tests, ported)", () => {
  it("no window opens without a lease", () => {
    const w = windows();
    expect(code(w.open(PAGE, { kind: "read", callId: "c1", action: "get" }))).toBe("no-lease");
    expect(code(w.admit(PAGE, READ))).toBe("no-lease");
  });

  it("a read window admits a read during its call and nothing after it closes", () => {
    const w = leased();
    expect(w.open(PAGE, { kind: "read", callId: "c1", action: "get" })).toEqual({ ok: true });
    expect(w.admit(PAGE, READ).ok).toBe(true);
    expect(w.close(PAGE, "c1")?.closedBy).toBe("call-end");
    const v = w.admit(PAGE, READ);
    expect(v).toMatchObject({ ok: false, code: "outside-window", reason: "no window is open" });
  });

  it("a read window is not an act window (S1-W 3b)", () => {
    const w = leased();
    w.open(PAGE, { kind: "read", callId: "c1", action: "get" });
    const acts: Admission[] = [
      ACT,
      {
        mutation: false,
        capture: false,
        script: { source: "engine", commandClass: "act", entryId: "t" },
      },
      { mutation: false, capture: false, script: { source: "agent" } },
    ];
    for (const c of acts) {
      expect(w.admit(PAGE, c)).toMatchObject({
        code: "outside-window",
        reason: "a read window is not an act window",
      });
    }
    const readScript: Admission = {
      mutation: false,
      capture: false,
      script: { source: "engine", commandClass: "read", entryId: "t" },
    };
    expect(w.admit(PAGE, readScript).ok).toBe(true);
  });

  it("one still per read window, none in an act window", () => {
    const w = leased();
    w.open(PAGE, { kind: "read", callId: "c1", action: "screenshot" });
    expect(w.admit(PAGE, STILL).ok).toBe(true);
    expect(code(w.admit(PAGE, STILL))).toBe("outside-window");
    expect(w.state(PAGE).window?.stillsTaken).toBe(1);
    w.close(PAGE, "c1");
    w.open(PAGE, { kind: "act", callId: "c2", action: "click" });
    expect(code(w.admit(PAGE, STILL))).toBe("outside-window");
    expect(w.admit(PAGE, ACT).ok).toBe(true);
  });

  it("one window per page at a time: the act lease is serialised", () => {
    const w = leased();
    expect(w.open(PAGE, { kind: "act", callId: "c1", action: "click" }).ok).toBe(true);
    expect(w.open(PAGE, { kind: "act", callId: "c2", action: "fill" })).toMatchObject({
      code: "outside-window",
      reason: "a window is already open",
    });
    expect(code(w.open(PAGE, { kind: "read", callId: "c3", action: "get" }))).toBe(
      "outside-window",
    );
    // Another page is independent.
    w.lease("pg-0000bbbb", { ...LEASE, bindingRevision: 2 });
    expect(w.open("pg-0000bbbb", { kind: "act", callId: "c1", action: "click" }).ok).toBe(true);
  });

  it("the act lease is bounded: it expires and admits nothing more", () => {
    const c = clock();
    const w = leased({ now: c.now, actLeaseMs: 500 });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    c.t += 499;
    expect(w.admit(PAGE, ACT).ok).toBe(true);
    c.t += 1;
    expect(w.admit(PAGE, ACT)).toMatchObject({
      code: "outside-window",
      reason: "the act lease expired",
    });
    const closed = w.close(PAGE, "c1");
    expect(closed?.closedBy).toBe("expired");
    expect(closed?.closedAt).toBe(1500);
    expect(w.open(PAGE, { kind: "act", callId: "c2", action: "click" }).ok).toBe(true);
    expect(w.admit(PAGE, ACT).ok).toBe(true);
  });

  it("read windows carry no expiry", () => {
    const c = clock();
    const w = leased({ now: c.now, actLeaseMs: 500 });
    w.open(PAGE, { kind: "read", callId: "c1", action: "wait" });
    c.t += 10_000;
    expect(w.admit(PAGE, READ).ok).toBe(true);
  });

  it("the hold closes the act window at once; the in-flight call learns it; nothing replays (S1-W 12)", () => {
    const w = leased();
    w.open(PAGE, { kind: "act", callId: "c1", action: "fill" });
    const { closed } = w.hold(PAGE);
    expect(closed?.callId).toBe("c1");
    expect(closed?.closedBy).toBe("hold");
    expect(code(w.admit(PAGE, ACT))).toBe("held");
    // The broker's close after the engine returns sees the hold.
    expect(w.close(PAGE, "c1")?.closedBy).toBe("hold");
    expect(code(w.open(PAGE, { kind: "act", callId: "c2", action: "fill" }))).toBe("held");
    w.putDown(PAGE);
    // Nothing reopened by itself.
    expect(w.state(PAGE).window).toBeNull();
    expect(code(w.admit(PAGE, ACT))).toBe("outside-window");
    expect(w.open(PAGE, { kind: "act", callId: "c3", action: "fill" }).ok).toBe(true);
  });

  it("while held, reads and stills are refused as held too (S1-W 11b)", () => {
    const w = leased();
    w.open(PAGE, { kind: "read", callId: "c1", action: "snapshot" });
    w.hold(PAGE);
    expect(code(w.open(PAGE, { kind: "read", callId: "c2", action: "snapshot" }))).toBe("held");
    expect(code(w.admit(PAGE, READ))).toBe("held");
    expect(code(w.admit(PAGE, STILL))).toBe("held");
    expect(w.hold(PAGE).closed).toBeNull();
    w.putDown(PAGE);
    w.open(PAGE, { kind: "read", callId: "c3", action: "screenshot" });
    expect(w.admit(PAGE, STILL).ok).toBe(true);
  });

  it("fetchAnswerOf names only the four answers", () => {
    expect(FETCH_ANSWER_METHODS.size).toBe(4);
    expect(fetchAnswerOf("Fetch.continueRequest", { requestId: "r1" })).toBe("r1");
    expect(fetchAnswerOf("Fetch.continueWithAuth", { requestId: "r2" })).toBe("r2");
    expect(fetchAnswerOf("Fetch.failRequest", {})).toBe("");
    expect(fetchAnswerOf("Fetch.enable", { requestId: "r1" })).toBeUndefined();
    expect(fetchAnswerOf("Fetch.continueResponse", { requestId: "r1" })).toBeUndefined();
  });

  it("the Fetch exception: an answer outside a window passes once, only for a forwarded pause (S1-W 7)", () => {
    const w = leased();
    w.notePaused(PAGE, "interception-1");
    expect(w.state(PAGE).paused).toBe(1);
    expect(w.admit(PAGE, { ...READ, ...PLAIN, fetchAnswer: "interception-1" }).ok).toBe(true);
    expect(w.state(PAGE).paused).toBe(0);
    // Spent: a replay is refused.
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "interception-1" }))).toBe("outside-window");
    // A forged id, and an answer naming no id.
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "interception-9" }))).toBe("outside-window");
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "" }))).toBe("outside-window");
  });

  it("a paused request paused twice may be answered twice (request then response stage)", () => {
    const w = leased();
    w.notePaused(PAGE, "r1");
    w.notePaused(PAGE, "r1");
    expect(w.admit(PAGE, { ...READ, ...PLAIN, fetchAnswer: "r1" }).ok).toBe(true);
    expect(w.admit(PAGE, { ...READ, ...PLAIN, fetchAnswer: "r1" }).ok).toBe(true);
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "r1" }))).toBe("outside-window");
  });

  it("inside a window a paused answer passes even in a read window; a forged one is still refused", () => {
    const w = leased();
    w.open(PAGE, { kind: "read", callId: "c1", action: "get" });
    w.notePaused(PAGE, "r1");
    expect(
      w.admit(PAGE, { mutation: true, capture: false, script: null, fetchAnswer: "r1" }).ok,
    ).toBe(true);
    expect(code(w.admit(PAGE, { ...ACT, fetchAnswer: "r2" }))).toBe("forbidden");
    w.close(PAGE, "c1");
    w.open(PAGE, { kind: "act", callId: "c2", action: "click" });
    expect(code(w.admit(PAGE, { ...ACT, fetchAnswer: "r2" }))).toBe("forbidden");
  });

  it("the hold and the grant end take the paused allowances with them", () => {
    const w = leased();
    w.notePaused(PAGE, "r1");
    w.hold(PAGE);
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "r1" }))).toBe("held");
    w.putDown(PAGE);
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "r1" }))).toBe("outside-window");
    w.notePaused(PAGE, "r2");
    w.unlease(PAGE);
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "r2" }))).toBe("no-lease");
    w.lease(PAGE, LEASE);
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "r2" }))).toBe("outside-window");
  });

  it("unlease closes the open window as grant-end; one lease per page", () => {
    const w = leased();
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    expect(() =>
      w.lease(PAGE, { runKey: "run-2", producerEpoch: 1, bindingRevision: 1 }),
    ).toThrow();
    w.lease(PAGE, LEASE); // the same lease again is a no-op
    expect(w.unlease(PAGE)?.closedBy).toBe("grant-end");
    expect(w.close(PAGE, "c1")?.closedBy).toBe("grant-end");
    expect(code(w.admit(PAGE, ACT))).toBe("no-lease");
    expect(w.unlease(PAGE)).toBeNull();
    w.lease(PAGE, { runKey: "run-2", producerEpoch: 1, bindingRevision: 1 });
    expect(w.state(PAGE).leased).toBe(true);
  });

  it("a call naming a stale binding revision is no-lease", () => {
    const w = leased();
    expect(
      code(w.open(PAGE, { kind: "read", callId: "c1", action: "get", bindingRevision: 2 })),
    ).toBe("no-lease");
    expect(w.open(PAGE, { kind: "read", callId: "c1", action: "get", bindingRevision: 1 }).ok).toBe(
      true,
    );
  });

  it("history keeps every window in order, frozen; state reports the open one", () => {
    const c = clock();
    const w = leased({ now: c.now });
    w.open(PAGE, { kind: "read", callId: "c1", action: "get" });
    c.t += 5;
    w.close(PAGE, "c1");
    w.open(PAGE, { kind: "act", callId: "c2", action: "click" });
    const s = w.state(PAGE);
    expect({ leased: s.leased, held: s.held, paused: s.paused }).toEqual({
      leased: true,
      held: false,
      paused: 0,
    });
    expect(s.window?.callId).toBe("c2");
    const h = w.history(PAGE);
    expect(h.map((x) => [x.callId, x.kind, x.closedBy])).toEqual([
      ["c1", "read", "call-end"],
      ["c2", "act", undefined],
    ]);
    expect((h[0]?.closedAt ?? 0) - (h[0]?.openedAt ?? 0)).toBe(5);
    expect(Object.isFrozen(h[0])).toBe(true);
    expect(w.close(PAGE, "nope")).toBeNull();
  });

  it("programming errors throw rather than answer", () => {
    const w = leased();
    expect(() => w.open(PAGE, { kind: "write" as "read", callId: "c1", action: "get" })).toThrow(
      TypeError,
    );
    expect(() => w.open(PAGE, { kind: "read", callId: "", action: "get" })).toThrow(TypeError);
    w.open(PAGE, { kind: "read", callId: "c1", action: "get" });
    w.close(PAGE, "c1");
    expect(() => w.open(PAGE, { kind: "read", callId: "c1", action: "get" })).toThrow();
    expect(() => w.state("")).toThrow(TypeError);
  });

  // ---- the hole review (2026-10-31) ----

  it("fetchAnswerPlain: continue as sent, or continueWithAuth; anything that rewrites is not plain", () => {
    expect(fetchAnswerPlain("Fetch.continueRequest", { requestId: "r1" })).toBe(true);
    expect(fetchAnswerPlain("Fetch.continueWithAuth", { requestId: "r1" })).toBe(true);
    for (const extra of [
      { url: "http://x.test/" },
      { method: "POST" },
      { postData: "e30=" },
      { headers: [{ name: "x", value: "1" }] },
      { interceptResponse: true },
    ]) {
      expect(fetchAnswerPlain("Fetch.continueRequest", { requestId: "r1", ...extra })).toBe(false);
    }
    expect(fetchAnswerPlain("Fetch.fulfillRequest", { requestId: "r1", responseCode: 200 })).toBe(
      false,
    );
    expect(fetchAnswerPlain("Fetch.failRequest", { requestId: "r1", errorReason: "Failed" })).toBe(
      false,
    );
  });

  it("a forged answer outside a window is replaced: the id is spent and the bridge continues the request", () => {
    const w = leased();
    w.notePaused(PAGE, "r1");
    const v = w.admit(PAGE, { ...READ, fetchAnswer: "r1", fetchPlain: false });
    expect(v).toMatchObject({
      ok: false,
      code: "outside-window",
      replaceWith: { method: "Fetch.continueRequest", params: { requestId: "r1" } },
    });
    expect(w.state(PAGE).paused).toBe(0);
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "r1", fetchPlain: true }))).toBe(
      "outside-window",
    );
    expect(w.admit(PAGE, { ...READ, fetchAnswer: "r1", fetchPlain: false })).not.toHaveProperty(
      "replaceWith",
    );
    // An auth pause is continued by continueWithAuth's default.
    w.notePaused(PAGE, "a1", "Fetch.authRequired");
    expect(w.admit(PAGE, { ...READ, fetchAnswer: "a1" })).toMatchObject({
      replaceWith: {
        method: "Fetch.continueWithAuth",
        params: { requestId: "a1", authChallengeResponse: { response: "Default" } },
      },
    });
    // Inside a window the mock passes (the call that set the route is running).
    w.notePaused(PAGE, "r2");
    w.open(PAGE, { kind: "act", callId: "c1", action: "open" });
    expect(w.admit(PAGE, { ...ACT, fetchAnswer: "r2", fetchPlain: false }).ok).toBe(true);
  });

  it("forgetPaused: the owed answers go with the script grant's route", () => {
    const w = leased();
    w.notePaused(PAGE, "r1");
    w.forgetPaused(PAGE);
    expect(w.state(PAGE).paused).toBe(0);
    expect(code(w.admit(PAGE, { ...READ, fetchAnswer: "r1", fetchPlain: true }))).toBe(
      "outside-window",
    );
  });

  it("draining: no window opens while a held or timed-out call may still be in the engine", () => {
    const c = clock();
    const w = leased({ now: c.now });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    w.hold(PAGE);
    w.drain(PAGE, "c1");
    w.putDown(PAGE);
    expect(w.state(PAGE).draining).toBe(true);
    const refused = w.open(PAGE, { kind: "act", callId: "c2", action: "click" });
    expect(refused).toMatchObject({
      code: "outside-window",
      reason: expect.stringMatching(/draining/u),
    });
    w.drained(PAGE, "c1");
    expect(w.open(PAGE, { kind: "act", callId: "c2", action: "click" }).ok).toBe(true);
    w.close(PAGE, "c2");
    // A timed-out engine call: a bound, then windows open again.
    w.drain(PAGE, "c2", { forMs: 1000 });
    expect(code(w.open(PAGE, { kind: "read", callId: "c3", action: "get" }))).toBe(
      "outside-window",
    );
    c.t += 1000;
    expect(w.open(PAGE, { kind: "read", callId: "c3", action: "get" }).ok).toBe(true);
    expect(w.state(PAGE).draining).toBe(false);
  });

  it("lateVerdict: a result that comes back after its window is refused in place of the reply", () => {
    const w = leased();
    w.open(PAGE, { kind: "read", callId: "c1", action: "get" });
    expect(lateVerdict("c1", w.state(PAGE), undefined)).toBeNull();
    w.hold(PAGE);
    expect(lateVerdict("c1", w.state(PAGE), undefined)).toMatchObject({ code: "held" });
    w.putDown(PAGE);
    // the window closed with the hold
    expect(lateVerdict("c1", w.state(PAGE), undefined)).toMatchObject({ code: "outside-window" });
    w.open(PAGE, { kind: "read", callId: "c2", action: "get" });
    // the next call's window
    expect(lateVerdict("c1", w.state(PAGE), undefined)).toMatchObject({ code: "outside-window" });
    // An owed Fetch answer needs no window, only the lease and no hold.
    expect(lateVerdict(null, w.state(PAGE), "r1")).toBeNull();
    w.unlease(PAGE);
    expect(lateVerdict("c2", w.state(PAGE), undefined)).toMatchObject({ code: "no-lease" });
    expect(lateVerdict("c2", null, undefined)).toMatchObject({ code: "no-lease" });
  });

  it("paneGatePages: a close is gated by the page being closed, never the sender's", () => {
    expect(
      paneGatePages({ op: "close", originPageId: "A", targetPageId: "B", runPageIds: ["A", "B"] }),
    ).toEqual(["B"]);
    expect(
      paneGatePages({ op: "close", originPageId: null, targetPageId: "B", runPageIds: ["A", "B"] }),
    ).toEqual(["B"]);
    expect(paneGatePages({ op: "create", originPageId: "A", runPageIds: ["A", "B"] })).toEqual([
      "A",
    ]);
    expect(paneGatePages({ op: "create", runPageIds: ["A", "B"] })).toEqual(["A", "B"]);
    expect(() => paneGatePages({ op: "move" as "close" })).toThrow(TypeError);
    // With the windows: an act window on A admits a close of A, never of B.
    const w = windows();
    w.lease("A", LEASE);
    w.lease("B", { ...LEASE, bindingRevision: 2 });
    w.open("A", { kind: "act", callId: "c1", action: "tab close" });
    const gate = (pageIds: readonly string[]) =>
      pageIds.map((id) => w.admit(id, ACT)).find((v) => v.ok) ?? { ok: false };
    expect(gate(paneGatePages({ op: "close", originPageId: "A", targetPageId: "B" })).ok).toBe(
      false,
    );
    expect(gate(paneGatePages({ op: "close", originPageId: "B", targetPageId: "A" })).ok).toBe(
      true,
    );
  });
});

const MADE = "pg-0000cccc";

describe("the act lease is the caller's, and a made pane shares its call's window (BU-19)", () => {
  it("the act lease is given, never defaulted, and one at or past the control deadline is refused", () => {
    const deadline = SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS;
    expect(() => createWindows({} as { readonly actLeaseMs: number })).toThrow(TypeError);
    expect(() => createWindows({ actLeaseMs: 0 })).toThrow(TypeError);
    expect(() => createWindows({ actLeaseMs: deadline })).toThrow(RangeError);
    expect(() => createWindows({ actLeaseMs: deadline + 5_000 })).toThrow(RangeError);
    expect(() => createWindows({ actLeaseMs: ACT_LEASE_MS_PROPOSED })).not.toThrow();
  });

  it("adopt opens the making call's window on the page it made, of its kind and its end", () => {
    const c = clock();
    const w = leased({ now: c.now, actLeaseMs: 500 });
    w.lease(MADE, { ...LEASE, bindingRevision: 2 });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    c.t += 100;
    expect(w.adopt(MADE, PAGE, "c1")).toEqual({ ok: true });
    expect(w.state(MADE).window).toMatchObject({
      pageId: MADE,
      kind: "act",
      callId: "c1",
      action: "click",
      madeBy: PAGE,
      openedAt: 1100,
      expiresAt: 1500,
    });
    expect(w.admit(MADE, ACT).ok).toBe(true);
    // no fresh lease: the made page's window ends when the call's does
    c.t += 400;
    expect(w.admit(MADE, ACT)).toMatchObject({
      code: "outside-window",
      reason: "the act lease expired",
    });
    expect(w.close(MADE, "c1")?.closedBy).toBe("expired");
  });

  it("adopt refuses a page the call cannot share", () => {
    const w = leased();
    // not leased
    w.open(PAGE, { kind: "read", callId: "c1", action: "tab new" });
    expect(code(w.adopt(MADE, PAGE, "c1"))).toBe("no-lease");
    w.lease(MADE, { ...LEASE, bindingRevision: 2 });
    // held
    w.hold(MADE);
    expect(code(w.adopt(MADE, PAGE, "c1"))).toBe("held");
    w.putDown(MADE);
    // the making call's window is not open, or is another call's
    expect(code(w.adopt(MADE, PAGE, "c9"))).toBe("outside-window");
    w.close(PAGE, "c1");
    expect(code(w.adopt(MADE, PAGE, "c1"))).toBe("outside-window");
    // the made page has a window of its own
    w.open(PAGE, { kind: "read", callId: "c2", action: "tab new" });
    w.open(MADE, { kind: "read", callId: "c3", action: "get" });
    expect(code(w.adopt(MADE, PAGE, "c2"))).toBe("outside-window");
    // a page never adopts its own call's window
    expect(() => w.adopt(PAGE, PAGE, "c2")).toThrow(TypeError);
  });

  it("closeCall closes every window of the call, the made page's too, in opening order", () => {
    const w = leased();
    w.lease(MADE, { ...LEASE, bindingRevision: 2 });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    w.adopt(MADE, PAGE, "c1");
    const closed = w.closeCall("c1");
    expect(closed.map((x) => [x.pageId, x.closedBy, x.madeBy])).toEqual([
      [PAGE, "call-end", undefined],
      [MADE, "call-end", PAGE],
    ]);
    expect(w.state(PAGE).window).toBeNull();
    expect(w.state(MADE).window).toBeNull();
  });

  it("a hold on the made page closes only its own window", () => {
    const w = leased();
    w.lease(MADE, { ...LEASE, bindingRevision: 2 });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    w.adopt(MADE, PAGE, "c1");
    expect(w.hold(MADE).closed).toMatchObject({ pageId: MADE, closedBy: "hold" });
    expect(w.state(PAGE).window?.callId).toBe("c1");
    expect(w.admit(PAGE, ACT).ok).toBe(true);
    w.putDown(MADE);
    expect(w.closeCall("c1").map((x) => [x.pageId, x.closedBy])).toEqual([
      [PAGE, "call-end"],
      [MADE, "hold"],
    ]);
  });

  it("history keeps at most WINDOW_HISTORY_MAX windows per page, the oldest going first", () => {
    const w = leased();
    for (let i = 0; i < WINDOW_HISTORY_MAX + 3; i += 1) {
      w.open(PAGE, { kind: "read", callId: `c${i}`, action: "get" });
      w.close(PAGE, `c${i}`);
    }
    const h = w.history(PAGE);
    expect(h).toHaveLength(WINDOW_HISTORY_MAX);
    expect(h[0]?.callId).toBe("c3");
    expect(w.close(PAGE, "c0")).toBeNull();
  });
});

describe("the call window holds its page's pin (BU:427-430)", () => {
  const MADE = "pg-0000bbbb";

  /** A fake of the page owners' pins: each pin and release counted by page, each `applied` answering `answer`. */
  function fakePins(answer: PinApplied = "applied") {
    const log: string[] = [];
    const pins: PagePins = {
      pin(pageId) {
        log.push(`pin ${pageId}`);
        return { applied: Promise.resolve(answer), release: () => log.push(`release ${pageId}`) };
      },
    };
    return { pins, log };
  }

  function pinned(o: { readonly now?: () => number; readonly pins: PagePins }) {
    const w = createWindows({
      actLeaseMs: 500,
      pins: o.pins,
      ...(o.now ? { now: o.now } : {}),
    });
    w.lease(PAGE, LEASE);
    return w;
  }

  it("a window pins its page once at open and releases once at its close; a refused open pins nothing, and no copy carries the handle", () => {
    const f = fakePins();
    const w = pinned({ pins: f.pins });
    expect(w.open(PAGE, { kind: "read", callId: "c1", action: "screenshot" })).toEqual({
      ok: true,
    });
    expect(f.log).toEqual([`pin ${PAGE}`]);
    // a second open while one stands is refused, and pins nothing
    expect(code(w.open(PAGE, { kind: "read", callId: "c2", action: "get" }))).toBe(
      "outside-window",
    );
    expect(f.log).toEqual([`pin ${PAGE}`]);
    expect(Object.keys(w.state(PAGE).window ?? {})).not.toContain("pin");
    expect(w.close(PAGE, "c1")?.closedBy).toBe("call-end");
    expect(w.close(PAGE, "c1")?.closedBy).toBe("call-end");
    expect(f.log).toEqual([`pin ${PAGE}`, `release ${PAGE}`]);
    for (const past of w.history(PAGE)) expect(past).not.toHaveProperty("pin");
    // held and unleased pages pin nothing
    w.hold(PAGE);
    expect(code(w.open(PAGE, { kind: "read", callId: "c3", action: "get" }))).toBe("held");
    expect(f.log).toHaveLength(2);
  });

  it("every close path releases exactly once: call end, closeCall, hold, grant end, and expiry on the next look", () => {
    const c = clock();
    const f = fakePins();
    const w = pinned({ now: c.now, pins: f.pins });
    const releases = () => f.log.filter((line) => line.startsWith("release")).length;
    w.open(PAGE, { kind: "read", callId: "a", action: "get" });
    w.closeCall("a");
    w.closeCall("a");
    expect(releases()).toBe(1);
    w.open(PAGE, { kind: "read", callId: "b", action: "get" });
    w.hold(PAGE);
    w.close(PAGE, "b");
    expect(releases()).toBe(2);
    w.putDown(PAGE);
    w.open(PAGE, { kind: "read", callId: "d", action: "get" });
    w.unlease(PAGE);
    w.close(PAGE, "d");
    expect(releases()).toBe(3);
    w.lease(PAGE, LEASE);
    w.open(PAGE, { kind: "act", callId: "e", action: "click" });
    c.t += 500;
    // expiry is read lazily: the pin is given back on the next look, and only once
    expect(releases()).toBe(3);
    expect(w.state(PAGE).window).toBeNull();
    w.close(PAGE, "e");
    expect(releases()).toBe(4);
    expect(f.log.filter((line) => line.startsWith("pin"))).toHaveLength(4);
  });

  it("adopt pins the made page; closeCall releases the made page's and the maker's", () => {
    const f = fakePins();
    const w = pinned({ pins: f.pins });
    w.lease(MADE, { ...LEASE, bindingRevision: 2 });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    expect(w.adopt(MADE, PAGE, "c1")).toEqual({ ok: true });
    expect(f.log).toEqual([`pin ${PAGE}`, `pin ${MADE}`]);
    w.closeCall("c1");
    expect([...f.log].sort()).toEqual([
      `pin ${PAGE}`,
      `pin ${MADE}`,
      `release ${PAGE}`,
      `release ${MADE}`,
    ]);
  });

  it("applied answers the live window's promise, and null for a closed or unknown call or with no pins", async () => {
    const f = fakePins("timeout");
    const w = pinned({ pins: f.pins });
    w.open(PAGE, { kind: "read", callId: "c1", action: "screenshot" });
    const live = w.applied(PAGE, "c1");
    expect(live).not.toBeNull();
    await expect(live).resolves.toBe("timeout");
    expect(w.applied(PAGE, "other")).toBeNull();
    w.close(PAGE, "c1");
    expect(w.applied(PAGE, "c1")).toBeNull();
    const bare = leased();
    bare.open(PAGE, { kind: "read", callId: "c1", action: "screenshot" });
    expect(bare.applied(PAGE, "c1")).toBeNull();
  });

  it("a pin that throws holds a handle answering failed, never null; a release that throws still closes the window", async () => {
    const log: string[] = [];
    const throwing: PagePins = {
      pin(pageId) {
        log.push(`pin ${pageId}`);
        if (pageId === PAGE) throw new Error("the owner is gone mid-pin");
        return {
          applied: Promise.resolve<PinApplied>("applied"),
          release: () => {
            log.push(`release ${pageId}`);
            throw new Error("the owner's release failed");
          },
        };
      },
    };
    const w = pinned({ pins: throwing });
    expect(w.open(PAGE, { kind: "read", callId: "c1", action: "screenshot" })).toEqual({
      ok: true,
    });
    const failed = w.applied(PAGE, "c1");
    expect(failed).not.toBeNull();
    await expect(failed).resolves.toBe("failed");
    expect(w.close(PAGE, "c1")?.closedBy).toBe("call-end");
    w.lease(MADE, { ...LEASE, bindingRevision: 2 });
    expect(w.open(MADE, { kind: "read", callId: "c2", action: "get" })).toEqual({ ok: true });
    expect(w.close(MADE, "c2")?.closedBy).toBe("call-end");
    expect(w.state(MADE).window).toBeNull();
    expect(log).toEqual([`pin ${PAGE}`, `pin ${MADE}`, `release ${MADE}`]);
  });
});

describe("the Fetch grace: a pause in flight at its window's call end (EY-1, 2026-11-19)", () => {
  const FAIL = { fetchMethod: "Fetch.failRequest" } as const;
  const Q = "pg-0000bbbb";
  const replaced = (requestId: string) => ({
    ok: false,
    code: "outside-window",
    replaceWith: { method: "Fetch.continueRequest", params: { requestId } },
  });

  it("a pause noted in a window takes a non-plain answer until its call-end close plus the bound, read or act, and is replaced past it", () => {
    for (const kind of ["act", "read"] as const) {
      const c = clock();
      const w = leased({ now: c.now });
      w.open(PAGE, { kind, callId: "c1", action: "click" });
      w.notePaused(PAGE, "r1");
      w.notePaused(PAGE, "r2");
      w.close(PAGE, "c1");
      c.t += FETCH_ANSWER_GRACE_MS;
      expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r1" }).ok).toBe(true);
      c.t += 1;
      expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r2" })).toMatchObject(replaced("r2"));
    }
  });

  it("a pause first seen outside any window stays plain-only, even just after a window's close", () => {
    const w = leased({ now: clock().now });
    w.notePaused(PAGE, "r0");
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    w.notePaused(PAGE, "r1");
    w.close(PAGE, "c1");
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r1" }).ok).toBe(true);
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r0" })).toMatchObject(replaced("r0"));
  });

  it("the tag binds the page: window A's pause on page P is not admitted non-plain by an answer while window B is open on page Q", () => {
    const w = leased({ now: clock().now });
    w.lease(Q, LEASE);
    w.open(PAGE, { kind: "act", callId: "a", action: "click" });
    w.notePaused(PAGE, "r1");
    w.close(PAGE, "a");
    w.open(Q, { kind: "act", callId: "b", action: "click" });
    expect(code(w.admit(Q, { ...ACT, ...FAIL, fetchAnswer: "r1" }))).toBe("forbidden");
    // P's owed answer is untouched, and on its own page, within the bound, it still passes.
    expect(w.state(PAGE).paused).toBe(1);
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r1" }).ok).toBe(true);
  });

  it("a window that expires gives no grace, even while its call drains; a call-end close whose call drains admits past the bound until drained", () => {
    const c = clock();
    const w = leased({ now: c.now, actLeaseMs: 500 });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    w.notePaused(PAGE, "r1");
    c.t += 500;
    w.drain(PAGE, "c1");
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r1" })).toMatchObject(replaced("r1"));
    w.drained(PAGE, "c1");
    w.open(PAGE, { kind: "act", callId: "c2", action: "click" });
    w.notePaused(PAGE, "r2");
    w.notePaused(PAGE, "r3");
    w.close(PAGE, "c2");
    w.drain(PAGE, "c2");
    c.t += FETCH_ANSWER_GRACE_MS + 1;
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r2" }).ok).toBe(true);
    w.drained(PAGE, "c2");
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r3" })).toMatchObject(replaced("r3"));
  });

  it("a hold inside the bound ends the grace: the answer is refused, and the hold's own release leaves nothing to replace", () => {
    const w = leased({ now: clock().now });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    w.notePaused(PAGE, "r1");
    w.notePaused(PAGE, "r2");
    w.close(PAGE, "c1");
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r1" }).ok).toBe(true);
    w.hold(PAGE);
    expect(code(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r2" }))).toBe("held");
    w.putDown(PAGE);
    const after = w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r2" });
    expect(code(after)).toBe("outside-window");
    expect(after).not.toHaveProperty("replaceWith");
  });

  it("a grant end inside the bound ends the grace, and a new epoch's lease brings none back", () => {
    const w = leased({ now: clock().now });
    w.open(PAGE, { kind: "act", callId: "c1", action: "click" });
    w.notePaused(PAGE, "r1");
    w.notePaused(PAGE, "r2");
    w.close(PAGE, "c1");
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r1" }).ok).toBe(true);
    w.unlease(PAGE);
    expect(code(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r2" }))).toBe("no-lease");
    w.lease(PAGE, { ...LEASE, producerEpoch: 2 });
    const after = w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r2" });
    expect(code(after)).toBe("outside-window");
    expect(after).not.toHaveProperty("replaceWith");
  });

  it("an answer the grace admits is counted on its window and logged with its method and count; one inside a window or by a drain is not", () => {
    const c = clock();
    const lines: [string, Readonly<Record<string, number | string>>][] = [];
    const w = leased({ now: c.now, log: (event, fields) => lines.push([event, fields]) });
    w.open(PAGE, { kind: "read", callId: "c1", action: "get" });
    w.notePaused(PAGE, "r0");
    w.notePaused(PAGE, "r1");
    w.notePaused(PAGE, "r2");
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r0" }).ok).toBe(true);
    w.close(PAGE, "c1");
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r1" }).ok).toBe(true);
    expect(
      w.admit(PAGE, { ...READ, fetchMethod: "Fetch.fulfillRequest", fetchAnswer: "r2" }).ok,
    ).toBe(true);
    expect(w.history(PAGE)[0]?.graceAnswers).toBe(2);
    expect(lines).toEqual([
      ["pages.fetch_grace", { method: "Fetch.failRequest", count: 1 }],
      ["pages.fetch_grace", { method: "Fetch.fulfillRequest", count: 2 }],
    ]);
    w.open(PAGE, { kind: "act", callId: "c2", action: "click" });
    w.notePaused(PAGE, "r3");
    w.close(PAGE, "c2");
    w.drain(PAGE, "c2");
    c.t += FETCH_ANSWER_GRACE_MS + 1;
    expect(w.admit(PAGE, { ...READ, ...FAIL, fetchAnswer: "r3" }).ok).toBe(true);
    expect(w.history(PAGE)[1]?.graceAnswers).toBeUndefined();
    expect(lines).toHaveLength(2);
  });
});
