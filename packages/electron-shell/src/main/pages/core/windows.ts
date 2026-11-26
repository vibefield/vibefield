// EY-1 (2026-11-19) — WHEN A CLIENT'S COMMAND MAY PASS: read and act windows, the hold and the Fetch exception (track
// EY; draft/tool-plane/browser-use.md §4.2 "when", BU:419-426). Ported from the lab's pure windows.js, with the lab's
// `no-window` renamed `outside-window` (that word is the door's, for the app's window: pages.ts:18-24).
//
// A window is a lease window in time, never a BrowserWindow. The broker opens one per control call (a read window or
// an act window) and closes it when the call ends, so a same-uid process driving the engine between calls meets a
// closed window. The act window IS the act lease: one window per page at a time, and an act window ends `actLeaseMs`
// after it opened, whatever its call is doing. The lease is the caller's, held below the control deadline.
//
// `admit` applies, in order:
// - the hold: while the person holds the page every read, still and act is `held` (BU-9). `hold` closes the open
//   window at once and nothing is replayed; the broker learns it from `close`'s `closedBy: "hold"`.
// - the lease: a page with no live lease admits nothing (`no-lease`).
// - the Fetch exception: the engine answers paused requests from a background handler, between calls. An answer
//   passes outside a window only for a requestId the bridge forwarded as paused (`notePaused`), once per forward, and
//   only a PLAIN one (`fetchAnswerPlain`: continue as sent, or continueWithAuth). Any other answer for an owed id
//   spends it and is refused with `replaceWith`, the plain answer the bridge sends itself, so the page keeps loading
//   the real site. An answer for an id never forwarded as paused is refused in or out of a window.
// - the grace (EY-1, 2026-11-19): a pause noted while a window is open is tagged with that window's call, on its
//   page. After the window's call-end close it may still take a non-plain answer, until FETCH_ANSWER_GRACE_MS past
//   the close or while that call drains; a pause first seen outside any window stays plain-only. A window that
//   expires gives none (the act lease is the bound), and a hold, a grant end or a new epoch ends it early (each
//   clears the page's pauses). Only pauses already in flight at a window's close can take a non-plain answer after
//   it, only within the bound, and a route re-pointed between calls still gets plain-only for every pause it sees:
//   the exposure is the window's own, extended by the bound, never a new class of request (EL7). Each answer the
//   grace admits is counted on its window (`graceAnswers`) and logged (`pages.fetch_grace`: its method and count).
//
// And, for the broker and the bridge:
// - draining (`drain`, `drained`): a call answered `held`, or one whose engine call timed out, may still have commands
//   queued in the engine; no new window opens on that page until it settles or its bound passes.
// - `lateVerdict`: the bridge forwards without awaiting, so a result can come back after its window closed; it is
//   refused then, never replied.
// - BU-19: a page a call made (a pop-up, a new tab) shares that call's window (`adopt`), of its kind and its end,
//   until the call ends; `closeCall` closes every window of the call.
// - the pin (BU:427-430): a call window holds its page's pacing pin and nobody else does. `open` and `adopt` pin
//   the page once through the injected `pins`, and the one finish every close path goes through (`shut`) gives
//   it back once. The broker never pins; it awaits the open window's `applied` before a still.
//
// Pure: time comes from the injected `now`.

import { PAGES_COMMAND_CLASSES, SURFACE_AUTHORITY_LIMITS } from "@vibefield/contracts";
import {
  type Admission,
  type AdmitVerdict,
  BRIDGE_OK,
  type BridgeRefusal,
  type BridgeRefusalCode,
  type BridgeVerdict,
  type CallWindow,
  type CdpCall,
  type CdpParams,
  type PageLease,
  type PagePins,
  type PinApplied,
  type PinHandle,
  type WindowClosedBy,
  type WindowKind,
  type WindowState,
  type Windows,
} from "./types";

/** The four Fetch methods that answer a paused request. `Fetch.continueResponse` is not one: the engine never sends
 * it, so it gets no exception and falls to the window rules. */
export const FETCH_ANSWER_METHODS: ReadonlySet<string> = Object.freeze(
  new Set([
    "Fetch.continueRequest",
    "Fetch.fulfillRequest",
    "Fetch.failRequest",
    "Fetch.continueWithAuth",
  ]),
);

/** The events whose requestId a Fetch answer may name; an auth pause is answered by `continueWithAuth`. */
export const FETCH_PAUSE_EVENTS: ReadonlySet<string> = Object.freeze(
  new Set(["Fetch.requestPaused", "Fetch.authRequired"]),
);

/** What makes a Fetch.continueRequest other than "continue as sent". */
const CONTINUE_OVERRIDES = ["url", "method", "postData", "headers", "interceptResponse"] as const;

/** How long after a window's call-end close a pause noted inside it may still take a non-plain answer (EY-1,
 * 2026-11-19). The engine answers a pause from its own handler, so an answer already in flight when the call ends
 * lands just after its window closes. Provisional: equal to the broker's drain bound (PAGES_DRAIN_MS), the longest
 * main already waits for a call's commands to settle; EY-S1-07's row on the test Mac measures the lag from the close
 * to the answer. Main's own bound, never a wire value. */
export const FETCH_ANSWER_GRACE_MS = 2_000;
/** Paused ids kept per page before the oldest is dropped: a bound on memory, never reached by a live page. */
export const MAX_PAUSED = 4096;
/** Windows kept per page for `close` and `history`; the oldest goes first. */
export const WINDOW_HISTORY_MAX = 64;

const KINDS: ReadonlySet<string> = new Set<string>(PAGES_COMMAND_CLASSES);

/** The requestId a Fetch answer names ("" when it names none, which matches nothing), or undefined when the method
 * is not a Fetch answer. The bridge passes it as `admit`'s `fetchAnswer`. */
export function fetchAnswerOf(method: string, params: CdpParams): string | undefined {
  if (!FETCH_ANSWER_METHODS.has(method)) return undefined;
  const id = params !== null && typeof params === "object" ? params.requestId : undefined;
  return typeof id === "string" ? id : "";
}

/** True for an answer that lets the page load the real site: continueRequest with no override, or continueWithAuth.
 * The bridge passes it as `admit`'s `fetchPlain`; absent reads as not plain. */
export function fetchAnswerPlain(method: string, params: CdpParams): boolean {
  if (method === "Fetch.continueWithAuth") return true;
  if (method !== "Fetch.continueRequest") return false;
  const p: CdpParams = params !== null && typeof params === "object" ? params : {};
  return CONTINUE_OVERRIDES.every((key) => p[key] === undefined);
}

/** The plain answer the bridge sends itself in place of a refused one (an auth pause takes continueWithAuth). */
function plainAnswer(requestId: string, auth: boolean): CdpCall {
  return auth
    ? {
        method: "Fetch.continueWithAuth",
        params: { requestId, authChallengeResponse: { response: "Default" } },
      }
    : { method: "Fetch.continueRequest", params: { requestId } };
}

function refuse(code: BridgeRefusalCode, reason: string): BridgeRefusal {
  return { ok: false, code, reason };
}

/** Null when a forwarded command's result may be replied, else the refusal to reply in its place. `admittedCallId` is
 * the window's callId at admission (null for an owed Fetch answer, which needs no window); `state` is
 * `windows.state(pageId)` read when the result came back. */
export function lateVerdict(
  admittedCallId: string | null,
  state: WindowState | null,
  fetchAnswer: string | undefined,
): BridgeVerdict | null {
  if (state === null || typeof state !== "object") return refuse("no-lease", "the page is gone");
  if (state.held)
    return refuse("held", "the person picked the page up before the result came back");
  if (!state.leased) return refuse("no-lease", "the grant ended before the result came back");
  if (fetchAnswer !== undefined) return null;
  if (state.window === null || state.window.callId !== admittedCallId) {
    return refuse("outside-window", "the call's window closed before the result came back");
  }
  return null;
}

/** The pages whose open act window may admit a pane change (Target.createTarget, Target.closeTarget). A close is gated
 * by the window of the page being CLOSED, never the sender's: a window on page A must not close B. A create from a
 * page session is gated by that page's window; from the root, by any of the run's pages. */
export function paneGatePages(a: {
  readonly op: "create" | "close";
  readonly originPageId?: string | null;
  readonly targetPageId?: string | null;
  readonly runPageIds?: readonly string[];
}): readonly string[] {
  const { op, originPageId = null, targetPageId = null, runPageIds = [] } = a;
  if (op === "close")
    return typeof targetPageId === "string" && targetPageId !== "" ? [targetPageId] : [];
  if (op !== "create") throw new TypeError(`paneGatePages: op must be "create" or "close"`);
  if (typeof originPageId === "string" && originPageId !== "") return [originPageId];
  return [...runPageIds];
}

/** The one open window, mutable inside this module; every caller gets a frozen copy. */
interface OpenWindow {
  readonly pageId: string;
  readonly kind: WindowKind;
  readonly callId: string;
  readonly action: string;
  readonly openedAt: number;
  stillsTaken: number;
  expiresAt?: number;
  madeBy?: string;
  closedAt?: number;
  closedBy?: WindowClosedBy;
  graceAnswers?: number;
}

interface Owed {
  n: number;
  auth: boolean;
  /** the call of the window open on this page when the pause was noted, or null: the grace's tag */
  callId: string | null;
  /** set at that window's call-end close: the last instant a non-plain answer may come */
  graceUntil?: number;
  /** that window ended otherwise (expired): no grace, not even while its call drains */
  noGrace?: boolean;
}

interface PageRecord {
  lease: PageLease | null;
  held: boolean;
  window: OpenWindow | null;
  /** this page's windows, oldest first, at most WINDOW_HISTORY_MAX */
  readonly history: OpenWindow[];
  /** requestId → how many answers are owed, and whether the pause was an auth pause */
  readonly paused: Map<string, Owed>;
  /** callId → its deadline (Infinity until `drained`) */
  readonly draining: Map<string, number>;
}

function snapshot(w: OpenWindow | null): CallWindow | null {
  return w === null ? null : Object.freeze({ ...w });
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "")
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

export function createWindows(o: {
  readonly actLeaseMs: number;
  readonly now?: () => number;
  /** the page owners' pins (main's registry); without them no window pins and `applied` answers null */
  readonly pins?: PagePins;
  /** main's log: a warn per Fetch answer admitted by the grace (`pages.fetch_grace`, its method and count) */
  readonly log?: (event: string, fields: Readonly<Record<string, number | string>>) => void;
}): Windows {
  const given: unknown = o?.actLeaseMs;
  if (typeof given !== "number" || !Number.isFinite(given) || given <= 0) {
    throw new TypeError("actLeaseMs must be a positive number, given by the caller");
  }
  const actLeaseMs: number = given;
  const deadline = SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS;
  if (actLeaseMs >= deadline) {
    throw new RangeError(`actLeaseMs must stay below the control deadline (${deadline} ms)`);
  }
  const now = o.now ?? (() => Date.now());
  const pages = new Map<string, PageRecord>();
  // Each live window's pin, never a field of the window: no snapshot or history entry carries it, and a pin given
  // back leaves the map.
  const pinned = new WeakMap<OpenWindow, PinHandle>();

  function page(pageId: string): PageRecord {
    nonEmpty(pageId, "pageId");
    let p = pages.get(pageId);
    if (p === undefined) {
      p = {
        lease: null,
        held: false,
        window: null,
        history: [],
        paused: new Map(),
        draining: new Map(),
      };
      pages.set(pageId, p);
    }
    return p;
  }

  // The one finish: every close path (call end, closeCall, hold, grant end, expiry) comes here, so a window's pin
  // is given back exactly once. A release that throws is the owner's; the window is closed all the same.
  function shut(p: PageRecord, closedBy: WindowClosedBy, at = now()): OpenWindow | null {
    const w = p.window;
    if (w === null) return null;
    w.closedAt = at;
    w.closedBy = closedBy;
    p.window = null;
    // The grace: a call-end close gives the pauses noted in this window their bound; any other close gives none.
    for (const owed of p.paused.values()) {
      if (owed.callId !== w.callId) continue;
      if (closedBy === "call-end") owed.graceUntil = at + FETCH_ANSWER_GRACE_MS;
      else owed.noGrace = true;
    }
    const pin = pinned.get(w);
    if (pin !== undefined) {
      pinned.delete(w);
      try {
        pin.release();
      } catch {
        // the owner's release failed; the window is closed and its pin forgotten
      }
    }
    return w;
  }

  // Pin a window's page once, as it opens. A pin that throws holds a handle answering "failed", never read as the
  // page gone; its release does nothing.
  function pinFor(w: OpenWindow): void {
    if (o.pins === undefined) return;
    let pin: PinHandle;
    try {
      pin = o.pins.pin(w.pageId);
    } catch {
      pin = { applied: Promise.resolve<PinApplied>("failed"), release: () => undefined };
    }
    pinned.set(w, pin);
  }

  // The bound is read lazily: an act window past its `expiresAt` is closed as of that instant on the next look.
  function expire(p: PageRecord): void {
    const w = p.window;
    if (w !== null && w.expiresAt !== undefined && now() >= w.expiresAt)
      shut(p, "expired", w.expiresAt);
  }

  function stillDraining(p: PageRecord): boolean {
    const t = now();
    for (const [callId, until] of p.draining) if (t >= until) p.draining.delete(callId);
    return p.draining.size > 0;
  }

  function callDraining(p: PageRecord, callId: string): boolean {
    const until = p.draining.get(callId);
    if (until === undefined) return false;
    if (now() < until) return true;
    p.draining.delete(callId);
    return false;
  }

  // An answer the grace admitted: counted on the window it extends, and logged with its method and the count, never
  // its request.
  function countGrace(p: PageRecord, callId: string, method: string | undefined): void {
    let w: OpenWindow | undefined;
    for (let i = p.history.length - 1; i >= 0 && w === undefined; i -= 1) {
      if (p.history[i]?.callId === callId) w = p.history[i];
    }
    if (w !== undefined) w.graceAnswers = (w.graceAnswers ?? 0) + 1;
    o.log?.("pages.fetch_grace", {
      method: method ?? "unknown",
      count: w?.graceAnswers ?? "unrecorded",
    });
  }

  function remember(p: PageRecord, w: OpenWindow): void {
    p.window = w;
    p.history.push(w);
    while (p.history.length > WINDOW_HISTORY_MAX) p.history.shift();
  }

  function closedFor(p: PageRecord, callId: string): CallWindow | null {
    expire(p);
    if (p.window !== null && p.window.callId === callId) return snapshot(shut(p, "call-end"));
    for (let i = p.history.length - 1; i >= 0; i -= 1) {
      const w = p.history[i];
      if (w !== undefined && w.callId === callId) return snapshot(w);
    }
    return null;
  }

  function lease(pageId: string, l: PageLease): void {
    const p = page(pageId);
    if (p.lease !== null) {
      const same =
        p.lease.runKey === l.runKey &&
        p.lease.producerEpoch === l.producerEpoch &&
        p.lease.bindingRevision === l.bindingRevision;
      if (same) return;
      // One lease per page: another run, epoch or revision goes through `unlease` first.
      throw new Error("page already leased; unlease it first");
    }
    nonEmpty(l?.runKey, "lease.runKey");
    p.lease = {
      runKey: l.runKey,
      producerEpoch: l.producerEpoch,
      bindingRevision: l.bindingRevision,
    };
  }

  function unlease(pageId: string): CallWindow | null {
    const p = page(pageId);
    expire(p);
    const closed = shut(p, "grant-end");
    p.lease = null;
    p.paused.clear();
    return snapshot(closed);
  }

  function open(
    pageId: string,
    w: {
      readonly kind: WindowKind;
      readonly callId: string;
      readonly action: string;
      readonly bindingRevision?: number;
    },
  ): BridgeVerdict {
    if (!KINDS.has(w?.kind)) throw new TypeError(`window kind must be "read" or "act"`);
    const callId = nonEmpty(w.callId, "callId");
    const p = page(pageId);
    if (p.lease === null) return refuse("no-lease", "the page has no live lease");
    if (w.bindingRevision !== undefined && w.bindingRevision !== p.lease.bindingRevision) {
      return refuse("no-lease", "the call names a stale binding revision");
    }
    if (p.held) return refuse("held", "the person holds the page");
    expire(p);
    if (p.window !== null) return refuse("outside-window", "a window is already open");
    if (stillDraining(p)) return refuse("outside-window", "the last call is still draining");
    if (p.history.some((x) => x.callId === callId))
      throw new Error("callId already used on this page");
    const openedAt = now();
    const win: OpenWindow = {
      pageId,
      kind: w.kind,
      callId,
      action: String(w.action ?? ""),
      openedAt,
      stillsTaken: 0,
    };
    if (w.kind === "act") win.expiresAt = openedAt + actLeaseMs;
    remember(p, win);
    pinFor(win);
    return BRIDGE_OK;
  }

  function adopt(pageId: string, madeBy: string, callId: string): BridgeVerdict {
    nonEmpty(madeBy, "madeBy");
    nonEmpty(callId, "callId");
    if (pageId === madeBy) throw new TypeError("a page cannot adopt its own call's window");
    const p = page(pageId);
    const maker = page(madeBy);
    if (p.lease === null) return refuse("no-lease", "the made page has no live lease");
    if (p.held) return refuse("held", "the person holds the made page");
    expire(maker);
    const making = maker.window;
    if (making === null || making.callId !== callId) {
      return refuse("outside-window", "the making call's window is not open");
    }
    expire(p);
    if (p.window !== null) return refuse("outside-window", "a window is already open");
    if (stillDraining(p)) return refuse("outside-window", "the last call is still draining");
    if (p.history.some((x) => x.callId === callId))
      throw new Error("callId already used on this page");
    // The made page's window is the call's: its kind, and its end (no fresh act lease).
    const win: OpenWindow = {
      pageId,
      kind: making.kind,
      callId,
      action: making.action,
      openedAt: now(),
      stillsTaken: 0,
      madeBy,
    };
    if (making.expiresAt !== undefined) win.expiresAt = making.expiresAt;
    remember(p, win);
    pinFor(win);
    return BRIDGE_OK;
  }

  // close → the window that call had, however it ended (call-end now, or earlier by hold, grant end or expiry), or
  // null when the page never had a window for that call (or it is older than the history keeps).
  function close(pageId: string, callId: string): CallWindow | null {
    return closedFor(page(pageId), callId);
  }

  function closeCall(callId: string): readonly CallWindow[] {
    nonEmpty(callId, "callId");
    const out: CallWindow[] = [];
    for (const p of pages.values()) {
      const w = closedFor(p, callId);
      if (w !== null) out.push(w);
    }
    // in opening order; a tie keeps the pages' own order
    return out.sort((a, b) => a.openedAt - b.openedAt);
  }

  function hold(pageId: string): { readonly closed: CallWindow | null } {
    const p = page(pageId);
    expire(p);
    p.held = true;
    // A paused request forwarded before the hold is released by the journal's undo (Fetch.disable); its answer would
    // arrive stale, so the allowance goes with the hold.
    p.paused.clear();
    return { closed: snapshot(shut(p, "hold")) };
  }

  function putDown(pageId: string): void {
    page(pageId).held = false;
  }

  // drain(pageId, callId, { forMs }): the call's commands may still be in the engine. Without `forMs` it drains until
  // `drained`; with it, until then or `forMs` from now, whichever is first.
  function drain(pageId: string, callId: string, d?: { readonly forMs?: number }): void {
    nonEmpty(callId, "callId");
    const forMs = d?.forMs;
    if (forMs !== undefined && !Number.isFinite(forMs))
      throw new TypeError("forMs must be a finite number");
    page(pageId).draining.set(
      callId,
      forMs === undefined ? Number.POSITIVE_INFINITY : now() + forMs,
    );
  }

  function drained(pageId: string, callId: string): void {
    page(pageId).draining.delete(callId);
  }

  function notePaused(
    pageId: string,
    requestId: string,
    event: "Fetch.requestPaused" | "Fetch.authRequired" = "Fetch.requestPaused",
  ): void {
    if (typeof requestId !== "string" || requestId === "") return;
    const p = page(pageId);
    expire(p);
    const was = p.paused.get(requestId);
    p.paused.set(requestId, {
      n: (was?.n ?? 0) + 1,
      auth: was?.auth === true || event === "Fetch.authRequired",
      callId: p.window?.callId ?? null,
    });
    if (p.paused.size > MAX_PAUSED) {
      const oldest = p.paused.keys().next();
      if (oldest.done !== true) p.paused.delete(oldest.value);
    }
  }

  function forgetPaused(pageId: string): void {
    page(pageId).paused.clear();
  }

  function admit(pageId: string, c: Admission): AdmitVerdict {
    const p = page(pageId);
    if (p.held) return refuse("held", "the person holds the page");
    if (p.lease === null) return refuse("no-lease", "the page has no live lease");
    expire(p);
    if (typeof c.fetchAnswer === "string") {
      const owed = p.paused.get(c.fetchAnswer);
      if (owed !== undefined) {
        if (owed.n <= 1) p.paused.delete(c.fetchAnswer);
        else owed.n -= 1;
        if (p.window !== null || c.fetchPlain === true) return BRIDGE_OK;
        if (owed.callId !== null && owed.noGrace !== true) {
          if (callDraining(p, owed.callId)) return BRIDGE_OK;
          if (owed.graceUntil !== undefined && now() <= owed.graceUntil) {
            countGrace(p, owed.callId, c.fetchMethod);
            return BRIDGE_OK;
          }
        }
        return {
          ...refuse(
            "outside-window",
            "outside a window a paused request is only continued as sent; the bridge continued it",
          ),
          replaceWith: plainAnswer(c.fetchAnswer, owed.auth),
        };
      }
      // Never legitimate: the engine answers only what it saw paused, and the bridge noted every pause it forwarded.
      if (p.window === null) {
        return refuse(
          "outside-window",
          "a Fetch answer outside a window, for a request not paused",
        );
      }
      return refuse(
        "forbidden",
        "a Fetch answer for a request the bridge never forwarded as paused",
      );
    }
    const w = p.window;
    if (w === null) {
      // The reason names an expiry until the next window opens, so the report can tell it from a closed call.
      const last = p.history[p.history.length - 1];
      if (last !== undefined && last.closedBy === "expired") {
        return refuse("outside-window", "the act lease expired");
      }
      return refuse("outside-window", "no window is open");
    }
    const script = c.script ?? null;
    const actScript =
      script !== null && (script.source === "agent" || script.commandClass === "act");
    if (w.kind === "read") {
      if (c.mutation === true || actScript) {
        return refuse("outside-window", "a read window is not an act window");
      }
      if (c.capture === true) {
        if (w.stillsTaken >= 1) return refuse("outside-window", "one still per read window");
        w.stillsTaken += 1;
      }
      return BRIDGE_OK;
    }
    if (c.capture === true)
      return refuse("outside-window", "a still is taken only in a read window");
    return BRIDGE_OK;
  }

  function state(pageId: string): WindowState {
    const p = page(pageId);
    expire(p);
    let paused = 0;
    for (const owed of p.paused.values()) paused += owed.n;
    return {
      leased: p.lease !== null,
      held: p.held,
      window: snapshot(p.window),
      paused,
      draining: stillDraining(p),
    };
  }

  function history(pageId: string): readonly CallWindow[] {
    const p = page(pageId);
    expire(p);
    return p.history.map((w) => Object.freeze({ ...w }));
  }

  function applied(pageId: string, callId: string): Promise<PinApplied> | null {
    const p = page(pageId);
    expire(p);
    const w = p.window;
    if (w === null || w.callId !== callId) return null;
    return pinned.get(w)?.applied ?? null;
  }

  return {
    lease,
    unlease,
    open,
    adopt,
    close,
    closeCall,
    hold,
    putDown,
    drain,
    drained,
    admit,
    notePaused,
    forgetPaused,
    state,
    history,
    applied,
  };
}
