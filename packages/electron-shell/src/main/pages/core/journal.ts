// EY-1 (2026-11-19) — WHAT A CLIENT LEAVES ON A PAGE, AND HOW IT IS UNDONE (track EY; draft/tool-plane/browser-use.md
// §4.2 "what is left behind", BU:427-430). Ported from the lab's pure journal.js. Each client drives a page through its
// own second debugger session (EY-S2-E5), so every entry names the session it was set on, its plans go back to that
// session, and a whole-state set replaces only its own session's value.
//
// Routes, extra headers, init scripts, throttling, emulation overrides and runtime bindings stay on a page after the
// call that set them. The bridge calls `observe` after every successful forward; the journal keeps one entry per thing
// left and derives its undo itself, never from the client. Then:
// - pick-up (the hold): `undoPlan` undoes every active entry, newest first, so the page behaves in the person's hand
//   as the site does;
// - put-down: `redoPlan` re-sends each undone entry's set, oldest first; a re-sent init script gets a new identifier,
//   mapped back through `applyResults` and `translate` (`alias`);
// - grant end: `endPlan` undoes for good (state `ended`);
// - BU-3's script grant (EY-5): `scriptGrantEndPlan` undoes for good every kind the grant gates on the signed-in
//   class (routes and headers too), init scripts and bindings on the own class, then reloads a signed-in page on
//   `reloadSession`;
// - a late result: `settleLate` settles an entry whose forward came back after a hold, a grant end or a script grant
//   end had already built its plan;
// - a late act the client was refused (2026-11-24): `dropLate` ends that one entry for good and answers its undo;
// - a detached session: `sessionEnded` ends its entries with no plan, since Chromium dropped what it set.
// Plans mutate entry states as they are produced: the bridge sends them as its own traffic, outside any window.
//
// Who sends what (2026-11-24; until then no plan here had a caller): the endpoint sends `undoPlan` at the pick-up,
// `redoPlan` with `applyResults` at the put-down, and `dropLate`'s plan for an act whose answer came back late: after
// a pick-up, after its call's window closed, or after the lease went. The client is refused a late answer, so it holds
// the command failed, and the act is taken off for good, never redone. `settleLate` has no caller for that reason:
// its late-hold leaves the entry `undone`, and the put-down's redo would set again what the client was told had
// failed (this paragraph first said the endpoint sent `settleLate`'s plan; corrected the same day). `endPlan` is NOT
// sent at a grant's end: the grant's end closes the client's session, and Chromium drops what that session set
// (`sessionEnded`). `scriptGrantEndPlan` waits for EY-5, with the grant it ends.
//
// Whole-state kinds (route, extra headers, throttling) keep one value per session: a new set replaces that session's
// active entry of its kind and key, and a neutral set (Fetch.disable, empty headers, neutral conditions) ends it.
// Keyed kinds (init scripts by identifier, bindings by name) are one entry each. The debugger: `debugger`
// (Debugger.enable) is silenced at pick-up (no breakpoint hit, no pause, resumed) and restored at put-down; a
// `breakpoint` is pinned through both and removed at an end; `tracing` ends at pick-up or any end and is never redone
// (a trace does not record the page in the person's hand, BU-9). `Emulation.*` is refused on a client's session (it
// acts on the page), so the emulation row stays empty: one observed anyway is recorded, the row's red, and never
// undone, since its only undo would clear the owner's own viewport.
//
// Pure: time comes from the injected `now`.

import {
  BRIDGE_OK,
  type BridgeRefusal,
  type BridgeVerdict,
  type CdpCall,
  type CdpParams,
  JOURNAL_KINDS,
  type Journal,
  type JournalEntry,
  type JournalKind,
  type LateSettle,
  type PageClass,
  type PlanItem,
} from "./types";

/** What BU-3's script grant gates on the signed-in class: ending the grant ends every one of them. */
const SCRIPT_GRANT_KINDS: ReadonlySet<JournalKind> = new Set<JournalKind>([
  "route",
  "extra-headers",
  "init-script",
  "binding",
  "breakpoint",
  "debugger",
  "tracing",
]);
/** On the own class nothing needs the grant; init scripts and bindings still end with it. */
const OWN_SCRIPT_KINDS: ReadonlySet<JournalKind> = new Set<JournalKind>(["init-script", "binding"]);

const BREAKPOINT_METHODS: ReadonlySet<string> = new Set([
  "Debugger.setBreakpoint",
  "Debugger.setBreakpointByUrl",
  "Debugger.setBreakpointOnFunctionCall",
]);
/** The debugger entry's pick-up: no breakpoint hits, no pause (a `debugger;` statement included), and a page paused
 * right now runs on. */
const DEBUGGER_HOLD: readonly CdpCall[] = [
  { method: "Debugger.setBreakpointsActive", params: { active: false } },
  { method: "Debugger.setSkipAllPauses", params: { skip: true } },
  { method: "Debugger.resume", params: {} },
];

/** The neutral network conditions (the engine's own "online" call). */
export const NEUTRAL_CONDITIONS: Readonly<Record<string, number | boolean>> = Object.freeze({
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
const THROTTLING_METHODS: ReadonlySet<string> = new Set([
  "Network.emulateNetworkConditions",
  "Network.overrideNetworkState",
]);
/** The undo placeholder of an emulation entry: filtered out of every plan. */
const NO_UNDO = "vf.no-undo";

/** Every method `observe` acts on, sets and the client's own clears. A stateful method that is not here leaves state
 * the journal cannot undo, so policy may cite it. */
export const JOURNALED_METHODS: ReadonlySet<string> = Object.freeze(
  new Set([
    "Fetch.enable",
    "Fetch.disable",
    "Network.setExtraHTTPHeaders",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.removeScriptToEvaluateOnNewDocument",
    ...THROTTLING_METHODS,
    "Runtime.addBinding",
    "Runtime.removeBinding",
    "Debugger.enable",
    "Debugger.disable",
    "Debugger.setBreakpointsActive",
    "Debugger.setSkipAllPauses",
    ...BREAKPOINT_METHODS,
    "Debugger.removeBreakpoint",
    "Tracing.start",
    "Tracing.end",
  ]),
);

/** A stable key for a value (sorted object keys), and a short non-cryptographic digest of it (FNV-1a, 32 bit): a
 * route's key names its pattern set without holding the patterns. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A deep copy of a call's params; none reads as {}. */
function copyParams(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || typeof value !== "object") return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function copyCall(c: CdpCall): CdpCall {
  return { method: c.method, params: copyParams(c.params) };
}

function isNeutralConditions(params: CdpParams): boolean {
  return Object.keys(NEUTRAL_CONDITIONS).every((k) => params[k] === NEUTRAL_CONDITIONS[k]);
}

function refuse(reason: string): BridgeRefusal {
  return { ok: false, code: "forbidden", reason };
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "")
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

/** One entry as the journal keeps it; every caller gets a JournalEntry copy. */
interface Entry {
  readonly seq: number;
  readonly pageId: string;
  readonly clientId: string;
  readonly session: string;
  readonly kind: JournalKind;
  readonly key: string;
  readonly set: CdpCall;
  readonly undo: CdpCall;
  readonly at: number;
  state: "active" | "undone" | "ended";
  endedAt?: number;
  alias?: string;
  /** the client's own setBreakpointsActive / setSkipAllPauses values, restored at put-down */
  debugger?: { active: boolean; skip: boolean };
  /** a breakpoint stays through pick-up and put-down (the debugger entry silences it, so its id never changes) */
  pinned?: true;
  /** a trace is never redone */
  noRedo?: true;
}

interface PageEntries {
  readonly entries: Entry[];
  readonly exercised: Set<JournalKind>;
}

function view(e: Entry): JournalEntry {
  return {
    seq: e.seq,
    pageId: e.pageId,
    clientId: e.clientId,
    session: e.session,
    kind: e.kind,
    key: e.key,
    set: copyCall(e.set),
    undo: copyCall(e.undo),
    state: e.state,
    ...(e.alias !== undefined ? { alias: e.alias } : {}),
  };
}

function live(e: Entry): boolean {
  return e.state === "active" || e.state === "undone";
}

/** The current identifier of an init script: its alias after a redo re-minted it, else the one the client received. */
function current(e: Entry): string {
  return e.alias ?? e.key;
}

function undoable(e: Entry): boolean {
  return e.undo.method !== NO_UNDO;
}

function undoItem(e: Entry): PlanItem {
  const params = copyParams(e.undo.params);
  if (e.kind === "init-script") params.identifier = current(e);
  return { method: e.undo.method, params, session: e.session, entrySeq: e.seq };
}

/** The pick-up's items for one entry: the debugger is silenced, not removed; the rest send their undo. */
function holdItems(e: Entry): PlanItem[] {
  if (e.kind === "debugger") {
    return DEBUGGER_HOLD.map((x) => ({ ...copyCall(x), session: e.session, entrySeq: e.seq }));
  }
  return undoable(e) ? [undoItem(e)] : [];
}

/** An end's items for one entry. An `undone` entry is already off the page, except the debugger, which a pick-up only
 * silenced: it still needs its Debugger.disable. */
function endItems(e: Entry): PlanItem[] {
  if (e.state === "undone" && e.kind !== "debugger") return [];
  return undoable(e) ? [undoItem(e)] : [];
}

function newestFirst(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => b.seq - a.seq);
}

export function createJournal(o?: { readonly now?: () => number }): Journal {
  const now = o?.now ?? (() => Date.now());
  const pages = new Map<string, PageEntries>();
  let seq = 0;

  function page(pageId: string): PageEntries {
    nonEmpty(pageId, "pageId");
    let p = pages.get(pageId);
    if (p === undefined) {
      p = { entries: [], exercised: new Set() };
      pages.set(pageId, p);
    }
    return p;
  }

  function end(p: PageEntries, pred: (e: Entry) => boolean): void {
    for (const e of p.entries) {
      if (live(e) && pred(e)) {
        e.state = "ended";
        e.endedAt = now();
      }
    }
  }

  function record(
    p: PageEntries,
    head: { readonly pageId: string; readonly clientId: string; readonly session: string },
    kind: JournalKind,
    key: string,
    set: CdpCall,
    undo: CdpCall,
    extra: Partial<Pick<Entry, "debugger" | "pinned" | "noRedo">> = {},
  ): JournalEntry {
    seq += 1;
    const entry: Entry = {
      seq,
      ...head,
      kind,
      key,
      set,
      undo,
      at: now(),
      state: "active",
      ...extra,
    };
    p.entries.push(entry);
    p.exercised.add(kind);
    return view(entry);
  }

  function observe(
    pageId: string,
    clientId: string,
    session: string,
    call: CdpCall,
    result: CdpParams,
  ): JournalEntry | null {
    const p = page(pageId);
    const head = {
      pageId,
      clientId: nonEmpty(clientId, "clientId"),
      session: nonEmpty(session, "session"),
    };
    const method = call?.method;
    if (typeof method !== "string") return null;
    const params = copyParams(call.params);
    const set: CdpCall = { method, params };
    // One session per client: CDP keeps a whole-state value per session, so a set or a clear touches its own alone.
    const mine = (e: Entry): boolean => e.session === session;
    switch (method) {
      case "Fetch.enable": {
        end(p, (e) => mine(e) && e.kind === "route");
        const key = digest(
          canonical({
            patterns: params.patterns ?? null,
            auth: params.handleAuthRequests === true,
          }),
        );
        return record(p, head, "route", key, set, { method: "Fetch.disable", params: {} });
      }
      case "Fetch.disable":
        end(p, (e) => mine(e) && e.kind === "route");
        return null;
      case "Network.setExtraHTTPHeaders": {
        end(p, (e) => mine(e) && e.kind === "extra-headers");
        const headers = params.headers;
        if (headers === null || typeof headers !== "object" || Object.keys(headers).length === 0) {
          return null;
        }
        const undo = { method: "Network.setExtraHTTPHeaders", params: { headers: {} } };
        return record(p, head, "extra-headers", "*", set, undo);
      }
      case "Page.addScriptToEvaluateOnNewDocument": {
        const id = result?.identifier;
        if (typeof id !== "string" || id === "") return null;
        const undo = {
          method: "Page.removeScriptToEvaluateOnNewDocument",
          params: { identifier: id },
        };
        return record(p, head, "init-script", id, set, undo);
      }
      case "Page.removeScriptToEvaluateOnNewDocument": {
        // Called with the command as forwarded, after `translate`: match the current identifier.
        const id = params.identifier;
        end(p, (e) => mine(e) && e.kind === "init-script" && current(e) === id);
        return null;
      }
      case "Network.emulateNetworkConditions":
      case "Network.overrideNetworkState": {
        // Keyed by method: the two are separate overrides in Chromium, and undoing one does not undo the other.
        end(p, (e) => mine(e) && e.kind === "throttling" && e.key === method);
        if (isNeutralConditions(params)) return null;
        return record(p, head, "throttling", method, set, {
          method,
          params: { ...NEUTRAL_CONDITIONS },
        });
      }
      case "Runtime.addBinding": {
        const name = params.name;
        if (typeof name !== "string" || name === "") return null;
        end(p, (e) => mine(e) && e.kind === "binding" && e.key === name);
        const undo = { method: "Runtime.removeBinding", params: { name } };
        return record(p, head, "binding", name, set, undo);
      }
      case "Runtime.removeBinding":
        end(p, (e) => mine(e) && e.kind === "binding" && e.key === params.name);
        return null;
      case "Debugger.enable": {
        // Idempotent in Chromium: one entry while the debugger is on.
        if (p.entries.some((e) => mine(e) && e.kind === "debugger" && live(e))) return null;
        return record(
          p,
          head,
          "debugger",
          "*",
          set,
          { method: "Debugger.disable", params: {} },
          { debugger: { active: true, skip: false } },
        );
      }
      case "Debugger.disable":
        // Chromium drops the session's breakpoints with the domain.
        end(p, (e) => mine(e) && (e.kind === "debugger" || e.kind === "breakpoint"));
        return null;
      case "Debugger.setBreakpointsActive":
      case "Debugger.setSkipAllPauses": {
        // The client's own values, restored at put-down; no entry of their own.
        const dbg = p.entries.find((e) => mine(e) && e.kind === "debugger" && live(e));
        if (dbg?.debugger !== undefined) {
          if (method === "Debugger.setBreakpointsActive")
            dbg.debugger.active = params.active === true;
          else dbg.debugger.skip = params.skip === true;
        }
        return null;
      }
      case "Debugger.setBreakpoint":
      case "Debugger.setBreakpointByUrl":
      case "Debugger.setBreakpointOnFunctionCall": {
        const id = result?.breakpointId;
        if (typeof id !== "string" || id === "") return null;
        const undo = { method: "Debugger.removeBreakpoint", params: { breakpointId: id } };
        return record(p, head, "breakpoint", id, set, undo, { pinned: true });
      }
      case "Debugger.removeBreakpoint":
        end(p, (e) => mine(e) && e.kind === "breakpoint" && e.key === params.breakpointId);
        return null;
      case "Tracing.start":
        end(p, (e) => mine(e) && e.kind === "tracing");
        return record(
          p,
          head,
          "tracing",
          "*",
          set,
          { method: "Tracing.end", params: {} },
          { noRedo: true },
        );
      case "Tracing.end":
        end(p, (e) => mine(e) && e.kind === "tracing");
        return null;
      default:
        if (method.startsWith("Emulation.")) {
          return record(p, head, "emulation", method, set, { method: NO_UNDO, params: {} });
        }
        return null;
    }
  }

  function undoPlan(pageId: string): readonly PlanItem[] {
    const p = page(pageId);
    const active = newestFirst(p.entries.filter((e) => e.state === "active" && e.pinned !== true));
    const plan = active.flatMap(holdItems);
    for (const e of active) {
      if (e.noRedo === true) {
        e.state = "ended";
        e.endedAt = now();
      } else {
        e.state = "undone";
      }
    }
    return plan;
  }

  function redoPlan(pageId: string): readonly PlanItem[] {
    const p = page(pageId);
    const undone = p.entries.filter((e) => e.state === "undone").sort((a, b) => a.seq - b.seq);
    for (const e of undone) e.state = "active";
    return undone.filter(undoable).flatMap((e): PlanItem[] => {
      if (e.kind !== "debugger" || e.debugger === undefined) {
        return [{ ...copyCall(e.set), session: e.session, entrySeq: e.seq }];
      }
      return [
        {
          method: "Debugger.setBreakpointsActive",
          params: { active: e.debugger.active },
          session: e.session,
          entrySeq: e.seq,
        },
        {
          method: "Debugger.setSkipAllPauses",
          params: { skip: e.debugger.skip },
          session: e.session,
          entrySeq: e.seq,
        },
      ];
    });
  }

  function endPlan(pageId: string): readonly PlanItem[] {
    const p = page(pageId);
    const plan = newestFirst(p.entries.filter(live)).flatMap(endItems);
    end(p, () => true);
    return plan;
  }

  function scriptGrantEndPlan(
    pageId: string,
    o?: { readonly pageClass?: PageClass; readonly reloadSession?: string },
  ): readonly PlanItem[] {
    const pageClass = o?.pageClass ?? "signed-in";
    // A signed-in page is reloaded at the grant's end (BU:429-430), on the session the caller names.
    const reloadOn = pageClass === "signed-in" ? nonEmpty(o?.reloadSession, "reloadSession") : null;
    const p = page(pageId);
    const kinds = pageClass === "signed-in" ? SCRIPT_GRANT_KINDS : OWN_SCRIPT_KINDS;
    const gated = (e: Entry): boolean => kinds.has(e.kind);
    const plan = newestFirst(p.entries.filter((e) => live(e) && gated(e))).flatMap(endItems);
    end(p, gated);
    if (reloadOn !== null)
      plan.push({ method: "Page.reload", params: {}, session: reloadOn, reload: true });
    return plan;
  }

  function settleLate(
    pageId: string,
    entry: JournalEntry | null,
    s: {
      readonly leased: boolean;
      readonly held: boolean;
      readonly pageClass: PageClass;
      readonly scriptGrant: boolean;
      readonly reloadSession?: string;
    },
  ): LateSettle | null {
    if (entry === null || entry === undefined) return null;
    const e = page(pageId).entries.find((x) => x.seq === entry.seq);
    if (e === undefined || e.state !== "active") return null;
    if (s.leased !== true) return { label: "late-grant-end", plan: endPlan(pageId) };
    if (s.held === true) return { label: "late-hold", plan: undoPlan(pageId) };
    if (s.pageClass === "signed-in" && s.scriptGrant !== true && SCRIPT_GRANT_KINDS.has(e.kind)) {
      const plan = scriptGrantEndPlan(pageId, {
        pageClass: s.pageClass,
        ...(s.reloadSession !== undefined ? { reloadSession: s.reloadSession } : {}),
      });
      return { label: "late-script-grant-end", plan };
    }
    return null;
  }

  // dropLate: a late act the client was refused (2026-11-24). The page took the command and the client was told it
  // had not, so that one entry ends for good, out of the pick-up and put-down cycle, and what takes it off the page
  // is answered: its undo, or nothing for one a pick-up already took off (the debugger aside, which a pick-up only
  // silences). Nothing is set in its place. A whole-state set (a route, extra headers, throttling, a binding of the
  // same name) replaced its session's earlier value on the page, and `observe` ended that entry as it recorded this
  // one, so the undo leaves the kind neutral on that session. Setting the earlier value again would be a SET of the
  // bridge's own: a clear of the client's still on its way would then end the entry while the value stayed on the
  // page, and no pick-up would undo it.
  function dropLate(pageId: string, entry: JournalEntry | null): readonly PlanItem[] {
    if (entry === null || entry === undefined) return [];
    const e = page(pageId).entries.find((x) => x.seq === entry.seq);
    if (e === undefined || !live(e)) return [];
    const plan = endItems(e);
    e.state = "ended";
    e.endedAt = now();
    return plan;
  }

  function applyResults(
    pageId: string,
    plan: readonly PlanItem[],
    results: readonly (CdpParams | { readonly error: string })[],
  ): void {
    const p = page(pageId);
    plan.forEach((item, i) => {
      if (item.method !== "Page.addScriptToEvaluateOnNewDocument") return;
      const id = (results[i] as CdpParams | undefined)?.identifier;
      const e = p.entries.find((x) => x.seq === item.entrySeq);
      if (e === undefined || typeof id !== "string" || id === "") return;
      if (id === e.key) delete e.alias;
      else e.alias = id;
    });
  }

  // translate: a client's removal names the identifier IT received; after a redo the live script has another.
  function translate(pageId: string, clientId: string, session: string, call: CdpCall): CdpCall {
    const out = copyCall(call);
    if (call.method !== "Page.removeScriptToEvaluateOnNewDocument") return out;
    const id = out.params.identifier;
    const e = page(pageId).entries.find(
      (x) =>
        x.kind === "init-script" &&
        x.clientId === clientId &&
        x.session === session &&
        x.key === id &&
        live(x),
    );
    if (e === undefined) return out;
    return { method: out.method, params: { ...out.params, identifier: current(e) } };
  }

  // mayRemove: a client removes only what it minted on its own session, by the name it received. The owner's
  // identifiers live on another session; another client's, another session's, an unknown one and one already
  // ended are all refused.
  function mayRemove(
    pageId: string,
    clientId: string,
    session: string,
    kind: "init-script" | "binding",
    key: string,
  ): BridgeVerdict {
    if (kind !== "init-script" && kind !== "binding") {
      throw new TypeError("mayRemove covers init-script and binding");
    }
    const p = page(pageId);
    const mine = p.entries.filter(
      (e) => e.kind === kind && e.key === key && e.clientId === clientId && e.session === session,
    );
    if (mine.some(live)) return BRIDGE_OK;
    if (mine.length > 0) return refuse(`this ${kind} was already removed`);
    if (p.entries.some((e) => e.kind === kind && (e.key === key || current(e) === key))) {
      return refuse(`another client or session minted this ${kind}`);
    }
    return refuse(`this client never minted this ${kind}`);
  }

  // sessionEnded: the client's session detached, and Chromium dropped what it set there (measured in the endpoint's
  // first case on the test Mac). Its
  // entries end, and nothing is sent: there is no session left to send it on.
  function sessionEnded(pageId: string, session: string): number {
    nonEmpty(session, "session");
    let n = 0;
    for (const e of page(pageId).entries) {
      if (live(e) && e.session === session) {
        e.state = "ended";
        e.endedAt = now();
        n += 1;
      }
    }
    return n;
  }

  // rows → every kind present, so an empty row is a stated result.
  function rows(
    pageId: string,
  ): Readonly<
    Record<JournalKind, { readonly entries: readonly JournalEntry[]; readonly exercised: boolean }>
  > {
    const p = page(pageId);
    const out = {} as Record<
      JournalKind,
      { readonly entries: readonly JournalEntry[]; readonly exercised: boolean }
    >;
    for (const kind of JOURNAL_KINDS) {
      out[kind] = {
        entries: p.entries.filter((e) => e.kind === kind).map(view),
        exercised: p.exercised.has(kind),
      };
    }
    return out;
  }

  return {
    observe,
    undoPlan,
    redoPlan,
    endPlan,
    scriptGrantEndPlan,
    settleLate,
    dropLate,
    applyResults,
    translate,
    mayRemove,
    sessionEnded,
    rows,
  };
}
