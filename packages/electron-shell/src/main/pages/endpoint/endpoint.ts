// EY-1 (2026-11-19) — THE AGENT'S ENDPOINT (track EY; BU-6, BU-19, BU-22, BU-23; EY-S2-E5). The routing core of the
// bridge, pure of I/O: no socket, no file, no timer of its own. It answers the root and a tab session itself, and
// forwards a page or child session through the page's port (browser-electron-native.ts, `browserAgentPortOf`), each
// client on its own second session. It composes what each owner cut: the call windows, the journal and the cleaned
// events, the method policy, the broker's panes, the input. A refusal is CDP -32000 with its word
// (`vf:<word>: <reason>`, `data: vf:<word>`); a forward the page rejects is -32001 with the page's message.
//
// A page's target id as a client sees it is the page's own DevTools id (the broker's tab switch reads it); session ids
// are virtual (`vf-tab-N`, `vf-page-N`) but a child's, which is the page's own.
//
// A pause (Fetch.requestPaused, Fetch.authRequired) is noted against its page BEFORE it is said to the client, in the
// same turn, whichever of the client's sessions it came on and whether or not the client is then told of it: an answer
// the client sends at once finds it owed (2026-11-19, EY-S1-07).
//
// A client's command on a page or child session meets the wall in one order: the window's state (no lease, held), the
// method policy, the window's admission, the client's worlds (BU-23), the journal's word on a removal, the input, the
// command rewrite, then the client's own session. A client removes only an init script or a binding it minted on that
// session, by the name it was given (journal.ts `mayRemove`): another client's, another session's, the owner's, an
// unknown one and one already removed are refused, and the agent hears why. A command's answer goes back through the
// worlds; an agent's still past its bound is refused there, before the journal sees it, and its body is never logged.
// An answer is relayed only while the window its command was admitted in still stands (2026-11-24, windows.ts
// `lateVerdict`): one that comes back after the person picked the page up, after its call's window closed or expired,
// or after its grant ended is refused in its place (`held`, `outside-window`, `no-lease`) and is no call's refusal;
// the page's own error for such a command is not relayed either. An owed Fetch answer needs no window, so only the
// hold and the grant's end make its answer late. A late answer's command still reached the page. What a late ACT set
// there (a route, extra headers, an init script, a binding, throttling, the debugger, a breakpoint, a trace) is taken
// off for good as its answer is refused, on the session it was set on, and the refusal says so. The client holds the
// command failed, so nothing of it stays and nothing of it comes back at a put-down (journal.ts `dropLate`).
// An event of the client's session goes through the worlds, then the cleaning, and reaches the client under the session
// id it knows.
//
// Grants are none until the person's consent reaches main (BU-3): the policy is asked with no grants, so a signed-in
// page passes only what needs no grant (2026-11-19).
//
// A CLIENT'S CHILDREN (2026-11-24; BU-22). A client's own `Target.setAutoAttach` on a page or child session is
// forwarded never waiting and for frames and dedicated workers alone, as far as its own filter admits them. A child
// that attaches waiting all the same is resumed by the bridge; a child of any other type (a service worker, a shared
// worker) is let run and detached by the bridge and is never a session of the client's.
//
// THE PERSON'S HAND (2026-11-24; BU-9, EY-L2). The wall refuses a client everything while the person holds a page, so
// the bridge itself takes off what the client left: at the pick-up (`hold`) it sends the journal's undo, at the
// put-down (`putDown`) its redo, each item on the client's own session that set it (a frame's or a worker's on that
// session), as the bridge's own traffic: no hold, lease or window is asked of it. A route's undo is what frees a
// request paused under the hold. One plan at a time per page, each built when its turn comes, so an init script the
// put-down re-minted is named by its new identifier at the next pick-up; a client's removal waits for the plan in
// flight for the same reason, and goes after it only while the window it was admitted in still stands. An act whose
// answer comes back after the pick-up is a late act: taken off at once and never set again (above). The grant's end
// sends nothing: closing the client's session drops what it set (journal.ts `sessionEnded`).
//
// A PAGE SAID AGAIN (2026-11-24, a new tab's first moments). A client that discovers targets is told of a granted page
// once, at its grant. The pinned engine attaches to a page it is told of in its next drain and keeps the page only if
// its first enable passes the wall; refused (no window stood on the page then), the event is spent and the engine
// never holds the page. `announce` says the page's `Target.targetCreated` to the run's discovering clients again: the
// bridge's own word, about a page the client already holds a grant of, and nothing a `Target.getTargets` would not
// say. The broker asks it inside a call's window on that page, when the engine's own list lacks it.
//
// THE ORDER A RUN'S PAGES ARE LISTED IN (2026-11-24). `Target.getTargets` listed a run's pages in the order they were
// granted. The pinned engine, as it joins the bridge, takes the first page listed that answers a probe as its active
// page (an error is an answer) and enables its domains there alone; refused, its connect fails. The broker launches
// an engine inside the window of the call's own page, so with two pages and a call on the second, the enable fell on
// the first, outside every window, and the launch failed for that call and each retry of it. A page a call's window
// stands on is now listed first, the rest in the order they were granted. Nothing else of the list moves, and it
// names the same pages.

import type { PagesNeed } from "@vibefield/contracts";
import type {
  BrowserAgentEvent,
  BrowserAgentPort,
  BrowserAgentSession,
} from "../../live-surfaces/browser-electron-native";
import {
  redactQuery,
  rewriteCommand,
  signInHostFor,
  targetEventAllowed,
  targetInfoView,
} from "../core/events";
import {
  BRIDGE_FORWARD_FAILED_CODE,
  BRIDGE_OK,
  BRIDGE_REFUSALS,
  BRIDGE_REFUSED_CODE,
  type BridgePage,
  type BridgeRefusalCode,
  type BridgeVerdict,
  type CallRefusal,
  CDP_FRAME_MAX_BYTES,
  CDP_METHOD_MAX_CHARS,
  type CdpCall,
  type CdpEvent,
  type CdpParams,
  type CleanContext,
  type CleanedEvent,
  type Journal,
  type JournalEntry,
  type MethodDecision,
  type MethodQuestion,
  NO_GRANTS,
  type PageLease,
  type PlanItem,
  type SessionKind,
  type Windows,
} from "../core/types";
import {
  FETCH_PAUSE_EVENTS,
  fetchAnswerOf,
  fetchAnswerPlain,
  lateVerdict,
  paneGatePages,
} from "../core/windows";
import { type ClientWorlds, clientWorlds } from "./worlds";

/** What Browser.getVersion answers: the engine's identity (ElectronBrowserSurfaceNative.engineAgent()). */
export interface EndpointEngine {
  readonly product: string;
  readonly userAgent: string;
  readonly protocolVersion: string;
  readonly revision: string;
  readonly jsVersion: string;
}

/** The broker's refusals of a new pane (EY-1 1e): each is the client's -32000 with its word, nothing attached. */
export const MAKE_REFUSALS = [
  "outside-window",
  "no-window",
  "run-full",
  "desk-full",
  "address",
] as const;
export type MakeRefusal = (typeof MAKE_REFUSALS)[number];

export type MakeAnswer =
  | { readonly ok: true; readonly pageId: string; readonly targetId: string }
  | { readonly ok: false; readonly refused: MakeRefusal };

/** Everything the endpoint is handed; each is its owner's. */
export interface EndpointDeps {
  readonly engine: () => EndpointEngine;
  readonly windows: Windows;
  readonly classify: (q: MethodQuestion) => MethodDecision;
  readonly journal: Journal;
  readonly clean: (e: CdpEvent, c: CleanContext) => CleanedEvent;
  /** a new pane of the run's own (BU-6); the broker grants it here before it answers */
  readonly make: (o: {
    readonly runKey: string;
    readonly callId: string;
    readonly url: string;
  }) => Promise<MakeAnswer>;
  /** closes a pane the run made */
  readonly closeMade: (o: { readonly runKey: string; readonly pageId: string }) => Promise<void>;
  /** whether the broker made this page for the run, by any of its doors (a client's createTarget, the run form's open,
   * a pop-up): the broker's own record decides a close, never this endpoint's (EY-1 1d, 2026-11-19) */
  readonly made: (runKey: string, pageId: string) => boolean;
  /** gives a HANDED page back: the broker ends its grant by its own path (calling `ungrant` here); the person's page is
   * never closed. A refusal is the client's -32000 with the broker's word. */
  readonly giveBack: (o: {
    readonly runKey: string;
    readonly pageId: string;
  }) => Promise<{ readonly ok: true } | { readonly ok: false; readonly refused: string }>;
  /** points and key-like input (input.ts) */
  readonly input: (o: {
    readonly call: CdpCall;
    readonly session: SessionKind;
    readonly port: BrowserAgentPort;
  }) => { readonly verdict: BridgeVerdict; readonly call: CdpCall };
  /** an agent's still past this is refused before it is relayed (contracts PAGES_STILL_MAX_BYTES) */
  readonly stillMaxBytes: number;
  /** warn-level lines: methods and codes only, never a key, a query, a path outside the run, a body or a typed value */
  readonly log: (line: { readonly event: string; readonly [k: string]: unknown }) => void;
  /** a refusal the bridge made inside a call's window, for that call's end (the broker reads them in order) */
  readonly refused: (r: CallRefusal) => void;
}

/** One client's socket, as the server hands it over once its key is claimed. */
export interface EndpointConnection {
  send(frame: string): void;
  close(code: 1000 | 1003 | 1008, reason: string): void;
}

export interface EndpointClient {
  message(frame: string): Promise<void>;
  closed(): void;
}

export interface Endpoint {
  /** a page handed to a run: one run at a time per page, refused as an answer, never thrown */
  grant(runKey: string, page: BridgePage, port: BrowserAgentPort, lease: PageLease): BridgeVerdict;
  /** the grant's end: the client's children first, then the page, then targetDestroyed */
  ungrant(pageId: string, reason: string): void;
  /** a connection whose key the server claimed */
  connect(runKey: string, epoch: number, conn: EndpointConnection): EndpointClient;
  /** the person picked the page up (2026-11-24): what its clients left on it is undone, as the bridge's own traffic.
   * Settles once the page has answered the plan; never rejects. A page no run holds takes nothing. */
  hold(pageId: string): Promise<void>;
  /** the person put the page down: what the pick-up undid is set again, and a re-minted init script is the journal's
   * before the next plan is built. Settles once the page has answered; never rejects. */
  putDown(pageId: string): Promise<void>;
  /** a granted page said again to its run's clients that discover targets (2026-11-24): how many were told. None for
   * a page no run holds, one the person holds on the signed-in class, or a run with no such client. */
  announce(pageId: string): number;
}

/** A Chromium error message, as the client gets it: bounded, never a body. */
const FORWARD_MESSAGE_MAX_CHARS = 200;

/** What a client is told, after the late refusal's own reason, of an act whose answer came back late (2026-11-24):
 * the page took the command, and the bridge took what it set off again. A whole-state set (a route, extra headers,
 * throttling, a binding of the same name) had replaced the session's earlier value on the page, so that value is off
 * with it. */
const LATE_ACT_SAYS =
  "what the command set is taken off the page, with any earlier value of its kind it replaced there";

/** The removals the journal answers for, and the parameter naming what is removed. */
const REMOVALS: Readonly<
  Record<string, { readonly kind: "init-script" | "binding"; readonly param: string }>
> = {
  "Page.removeScriptToEvaluateOnNewDocument": { kind: "init-script", param: "identifier" },
  "Runtime.removeBinding": { kind: "binding", param: "name" },
};

/** One page, one run: a second run's grant is answered, never thrown, so the broker releases what it made. */
const ANOTHER_RUNS: BridgeVerdict = Object.freeze({
  ok: false,
  code: "no-lease",
  reason: "the page is another run's",
} as const);

type Refusal = { readonly ok: false; readonly code: string; readonly reason: string };
const refuse = (code: string, reason: string): Refusal => ({ ok: false, code, reason });

interface Entry {
  readonly runKey: string;
  readonly page: BridgePage;
  readonly port: BrowserAgentPort;
  readonly lease: PageLease;
  ended: boolean;
  /** the attaches its grant started for the run's auto-attaching clients */
  attaching: Promise<unknown>;
  /** the pick-up's and the put-down's plans on the page, one at a time: the last one's end (it never rejects). A
   * late act's one undo is not among them: it goes at once */
  hand: Promise<void>;
  readonly offDetach: () => void;
}

interface Session {
  /** what the client sees: `vf-tab-N`, `vf-page-N`, or a child's own id */
  readonly id: string;
  readonly kind: "tab" | "page" | "child";
  readonly pageId: string;
  /** the client-visible session it attached on; undefined: the root */
  readonly parent: string | undefined;
  /** a page's own second session; a child's is its page session's, sent with `child` */
  readonly real: BrowserAgentSession | null;
  /** what the worlds and the journal key it by: the real session's id, or the child's */
  readonly key: string;
  readonly child?: string;
  ended: boolean;
  off?: () => void;
  /** a tab's page session */
  pageSession?: string | null;
  /** a page session's children the bridge turned away (BU-22), until Chromium says each detached: their detach is
   * not the client's to hear */
  turnedAway?: Set<string>;
}

interface Conn {
  readonly id: string;
  readonly runKey: string;
  readonly epoch: number;
  readonly io: EndpointConnection;
  readonly worlds: ClientWorlds;
  discover: boolean;
  discoverFilter: readonly unknown[] | undefined;
  autoAttach: boolean;
  autoFilter: readonly unknown[] | undefined;
  readonly announced: Map<string, { page: boolean; tab: boolean }>;
  readonly autoAttached: Set<string>;
  readonly sessions: Map<string, Session>;
  closed: boolean;
}

interface Ctx {
  readonly conn: Conn;
  readonly id: number;
  readonly method: string;
  readonly params: CdpParams;
  readonly sessionId: string | undefined;
  readonly session: Session | null;
  readonly entry: Entry | null;
}

/** How the wall admitted a command: the policy's facts, the window's call at admission (null for an owed Fetch
 * answer, which needs no window) and the Fetch answer's request id. */
interface Admitted {
  readonly decision: MethodDecision;
  readonly callId: string | null;
  readonly fetchAnswer: string | undefined;
}

interface TargetInfo {
  readonly targetId: string;
  readonly type: string;
  readonly title: string;
  readonly url: string;
  readonly attached: boolean;
  readonly canAccessOpener: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** CDP's target filter: the first entry naming the type (or none) decides; no filter admits all but tabs and the
 * browser. */
function filterAdmits(filter: readonly unknown[] | undefined, type: string): boolean {
  if (filter === undefined) return type !== "browser" && type !== "tab";
  for (const f of filter) {
    if (!isPlainObject(f)) continue;
    if (f.type === undefined || f.type === type) return f.exclude !== true;
  }
  return false;
}

/** What a client's own auto-attach may bring under its session (BU-22): a frame of another site, and a dedicated
 * worker the page starts. A service worker, a shared worker and every other target type never reach the agent. */
export const CLIENT_CHILD_TYPES: readonly string[] = Object.freeze(["iframe", "worker"]);

/** A target type as a log line may say it: Chromium's own word, or "unknown". */
const TARGET_TYPE_WORD = /^[a-z_]{1,32}$/u;

/** A client's `Target.setAutoAttach` on a page or child session, as it is forwarded (2026-11-24). Never waiting: the
 * wall may be refusing the client when a child starts, so no child is held for its resume. Flat. Narrowed to
 * CLIENT_CHILD_TYPES, as far as the client's own filter admits each (BU-22); with neither admitted the auto-attach is
 * turned off, so nothing else can attach. Nothing else the client sent is forwarded. */
function clientAutoAttach(params: CdpParams): CdpParams {
  const filter = Array.isArray(params.filter) ? params.filter : undefined;
  const types =
    params.autoAttach === true
      ? CLIENT_CHILD_TYPES.filter((type) => filterAdmits(filter, type))
      : [];
  if (types.length === 0) {
    return { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };
  }
  return {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: types.map((type) => ({ type })),
  };
}

/** A base64 body's byte length, without decoding it. */
function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, FORWARD_MESSAGE_MAX_CHARS);
}

export function createEndpoint(deps: EndpointDeps): Endpoint {
  const pages = new Map<string, Entry>();
  const conns = new Set<Conn>();
  let sessionCounter = 0;
  let clientCounter = 0;

  const visibleEntries = (conn: Conn): Entry[] =>
    [...pages.values()].filter((e) => !e.ended && e.runKey === conn.runKey);
  const runConns = (runKey: string): Conn[] =>
    [...conns].filter((c) => !c.closed && c.runKey === runKey);
  const held = (entry: Entry): boolean => deps.windows.state(entry.page.pageId).held;

  const send = (conn: Conn, message: Record<string, unknown>): void => {
    if (!conn.closed) conn.io.send(JSON.stringify(message));
  };
  const reply = (ctx: Ctx, body: Record<string, unknown>): void =>
    send(ctx.conn, {
      id: ctx.id,
      ...body,
      ...(ctx.sessionId === undefined ? {} : { sessionId: ctx.sessionId }),
    });
  const answer = (ctx: Ctx, result: unknown): void => reply(ctx, { result });
  const no = (
    ctx: Ctx,
    verdict: { readonly code: string; readonly reason: string; readonly need?: PagesNeed },
  ): void => {
    deps.log({
      event: "desktop.pages.bridge_refused",
      method: ctx.method,
      session: ctx.session?.kind ?? "root",
      code: verdict.code,
    });
    // the bridge's own refusals inside a call's window go to that call (a broker's own word stays the broker's)
    const callId =
      ctx.entry === null ? undefined : deps.windows.state(ctx.entry.page.pageId).window?.callId;
    if (callId !== undefined && (BRIDGE_REFUSALS as readonly string[]).includes(verdict.code)) {
      deps.refused({
        callId,
        method: ctx.method,
        code: verdict.code as BridgeRefusalCode,
        ...(verdict.need === undefined ? {} : { need: verdict.need }),
      });
    }
    refusal(ctx, verdict);
  };
  const refusal = (ctx: Ctx, verdict: { readonly code: string; readonly reason: string }): void =>
    reply(ctx, {
      error: {
        code: BRIDGE_REFUSED_CODE,
        message: `vf:${verdict.code}: ${verdict.reason}`,
        data: `vf:${verdict.code}`,
      },
    });
  /** An answer that came back late (windows.ts `lateVerdict`, 2026-11-24): refused in its place. It is no call's
   * refusal: the call it was admitted in has had its answer already, and a window open now is another call's. */
  const tooLate = (ctx: Ctx, verdict: { readonly code: string; readonly reason: string }): void => {
    deps.log({
      event: "desktop.pages.bridge_late",
      method: ctx.method,
      session: ctx.session?.kind ?? "root",
      code: verdict.code,
    });
    refusal(ctx, verdict);
  };
  const failed = (ctx: Ctx, error: unknown): void =>
    reply(ctx, { error: { code: BRIDGE_FORWARD_FAILED_CODE, message: messageOf(error) } });

  // ---- target info ----

  const pageInfo = (entry: Entry): TargetInfo => {
    const { url, title } = entry.port.info();
    const live: TargetInfo = {
      targetId: entry.port.targetId,
      type: "page",
      title,
      url: entry.page.pageClass === "signed-in" && url !== "" ? redactQuery(url) : url,
      attached: true,
      canAccessOpener: false,
    };
    return targetInfoView({ pageClass: entry.page.pageClass, held: held(entry), live });
  };
  const tabInfo = (entry: Entry): TargetInfo => ({
    ...pageInfo(entry),
    targetId: `vf-tab-${entry.port.targetId}`,
    type: "tab",
  });
  const targetIdOf = (entry: Entry, session: Session): string =>
    session.kind === "page"
      ? entry.port.targetId
      : session.kind === "tab"
        ? `vf-tab-${entry.port.targetId}`
        : (session.child ?? "");

  /** a target this client may see: one of its run's pages or tabs (a child is never a target here) */
  const findTarget = (
    conn: Conn,
    targetId: unknown,
  ): { readonly entry: Entry; readonly type: "page" | "tab" } | null => {
    if (typeof targetId !== "string" || targetId === "") return null;
    for (const entry of visibleEntries(conn)) {
      if (entry.port.targetId === targetId) return { entry, type: "page" };
      if (`vf-tab-${entry.port.targetId}` === targetId) return { entry, type: "tab" };
    }
    return null;
  };

  /** the run's pages as a client is listed them: one a call's window stands on first, then the rest, each part in
   * the order granted (2026-11-24) */
  const listedEntries = (conn: Conn): Entry[] => {
    const entries = visibleEntries(conn);
    const inWindow = (e: Entry): boolean => deps.windows.state(e.page.pageId).window !== null;
    return [...entries.filter(inWindow), ...entries.filter((e) => !inWindow(e))];
  };

  const targetInfos = (conn: Conn, filter: unknown): TargetInfo[] => {
    const f = Array.isArray(filter) ? filter : conn.discoverFilter;
    const out: TargetInfo[] = [];
    for (const entry of listedEntries(conn)) {
      if (filterAdmits(f, "tab")) out.push(tabInfo(entry));
      if (filterAdmits(f, "page")) out.push(pageInfo(entry));
    }
    return out;
  };

  const announceCreated = (conn: Conn, entry: Entry): void => {
    if (!targetEventAllowed({ pageClass: entry.page.pageClass, held: held(entry) })) return;
    const done = conn.announced.get(entry.page.pageId) ?? { page: false, tab: false };
    if (!done.tab && filterAdmits(conn.discoverFilter, "tab")) {
      send(conn, { method: "Target.targetCreated", params: { targetInfo: tabInfo(entry) } });
      done.tab = true;
    }
    if (!done.page && filterAdmits(conn.discoverFilter, "page")) {
      send(conn, { method: "Target.targetCreated", params: { targetInfo: pageInfo(entry) } });
      done.page = true;
    }
    conn.announced.set(entry.page.pageId, done);
  };

  // ---- sessions ----

  const newVirtual = (kind: "tab" | "page"): string => {
    sessionCounter += 1;
    return `vf-${kind}-${sessionCounter}`;
  };

  const sayAttached = (conn: Conn, session: Session, info: TargetInfo): void =>
    send(conn, {
      method: "Target.attachedToTarget",
      params: { sessionId: session.id, targetInfo: info, waitingForDebugger: false },
      ...(session.parent === undefined ? {} : { sessionId: session.parent }),
    });

  const attachTab = (conn: Conn, entry: Entry, parent: string | undefined): string => {
    const id = newVirtual("tab");
    const session: Session = {
      id,
      kind: "tab",
      pageId: entry.page.pageId,
      parent,
      real: null,
      key: id,
      ended: false,
      pageSession: null,
    };
    conn.sessions.set(id, session);
    sayAttached(conn, session, tabInfo(entry));
    return id;
  };

  /** a page session: the client's own second session on the page (EY-S2-E5), said before it is answered */
  const attachPage = async (
    conn: Conn,
    entry: Entry,
    parent: string | undefined,
  ): Promise<string | null> => {
    const real = await entry.port.openClientSession();
    if (conn.closed || entry.ended) {
      await real.close().catch(() => {});
      return null;
    }
    const session: Session = {
      id: newVirtual("page"),
      kind: "page",
      pageId: entry.page.pageId,
      parent,
      real,
      key: real.id,
      ended: false,
    };
    conn.sessions.set(session.id, session);
    session.off = real.onEvent((event) => onEvent(conn, session, event));
    void real.closed.then(() => {
      if (!session.ended) endSession(conn, session, { notify: true });
    });
    sayAttached(conn, session, pageInfo(entry));
    return session.id;
  };

  const endSession = (conn: Conn, session: Session, o: { readonly notify: boolean }): void => {
    for (const other of [...conn.sessions.values()]) {
      if (other.parent === session.id && other !== session) endSession(conn, other, o);
    }
    if (session.ended) return;
    session.ended = true;
    session.off?.();
    conn.sessions.delete(session.id);
    if (session.parent === undefined) conn.autoAttached.delete(session.pageId);
    conn.worlds.sessionEnded(session.key);
    if (session.kind !== "tab") deps.journal.sessionEnded(session.pageId, session.key);
    if (session.kind === "page") void session.real?.close().catch(() => {});
    const entry = pages.get(session.pageId);
    if (o.notify) {
      send(conn, {
        method: "Target.detachedFromTarget",
        params: {
          sessionId: session.id,
          targetId: entry === undefined ? "" : targetIdOf(entry, session),
        },
        ...(session.parent === undefined ? {} : { sessionId: session.parent }),
      });
    }
  };

  const autoAttachRoot = async (conn: Conn, entry: Entry): Promise<void> => {
    if (conn.autoAttached.has(entry.page.pageId)) return;
    conn.autoAttached.add(entry.page.pageId);
    if (filterAdmits(conn.autoFilter, "page")) await attachPage(conn, entry, undefined);
    else if (filterAdmits(conn.autoFilter, "tab")) attachTab(conn, entry, undefined);
    else conn.autoAttached.delete(entry.page.pageId);
  };

  // ---- the bridge's own traffic: what a client left, undone and set again (2026-11-24) ----

  /** the live session a plan item goes back to: a client's own second session on the page, or a session under it */
  const sessionOfKey = (entry: Entry, key: string): Session | null => {
    for (const conn of runConns(entry.runKey)) {
      for (const s of conn.sessions.values()) {
        if (!s.ended && s.real !== null && s.pageId === entry.page.pageId && s.key === key) {
          return s;
        }
      }
    }
    return null;
  };

  /** Sends a journal plan as the bridge's own traffic: each item on the session it names, in the plan's order, past
   * the wall (the hold that refuses the client is the reason the bridge sends it). An item whose session is gone is
   * not sent: Chromium dropped what that session set. One the page refuses is counted and the rest still go. Answers
   * each item's result, in order, for `applyResults`; never throws. The log line carries counts alone. */
  const sendPlan = async (
    entry: Entry,
    label: string,
    plan: readonly PlanItem[],
  ): Promise<readonly (CdpParams | { readonly error: string })[]> => {
    if (plan.length === 0) return [];
    let unsent = 0;
    let failed = 0;
    const results = await Promise.all(
      plan.map((item): Promise<CdpParams | { readonly error: string }> => {
        const session = sessionOfKey(entry, item.session);
        if (session === null || session.real === null) {
          unsent += 1;
          return Promise.resolve({ error: "no session" });
        }
        let answered: Promise<unknown>;
        try {
          answered = session.real.send(item.method, item.params, session.child);
        } catch (error) {
          answered = Promise.reject(error);
        }
        return answered.then(
          (result): CdpParams => (isPlainObject(result) ? result : {}),
          (error: unknown) => {
            failed += 1;
            return { error: messageOf(error) };
          },
        );
      }),
    );
    deps.log({
      event: "desktop.pages.journal_plan",
      plan: label,
      items: plan.length,
      failed,
      unsent,
    });
    return results;
  };

  /** One plan at a time per page, each built when its turn comes. Never rejects. */
  const turn = (entry: Entry, work: () => Promise<void>): Promise<void> => {
    const next = entry.hand.then(work).catch((error: unknown) => {
      deps.log({ event: "desktop.pages.journal_plan_failed", message: messageOf(error) });
    });
    entry.hand = next;
    return next;
  };

  /** An act the journal recorded from an answer the client is refused as late (2026-11-24): the client holds the
   * command failed, so what it set must not stay on the page, nor come back at a put-down. Its entry ends for good
   * (journal.ts `dropLate`) and its undo is sent at once, on the session it was set on. At once, not in the page's
   * turn: the entry is out of every later plan, so no plan waits on this one, and the sooner the undo follows the
   * act the less of the client's later work it can take with it. An act whose own session is gone left nothing:
   * Chromium dropped it with the session, and its entry ends. */
  const dropLate = (entry: Entry, session: Session, left: JournalEntry): void => {
    const pageId = entry.page.pageId;
    if (entry.ended || session.ended) {
      deps.journal.sessionEnded(pageId, session.key);
      return;
    }
    void sendPlan(entry, "late-act", deps.journal.dropLate(pageId, left)).catch(() => {});
  };

  // ---- events of a client's own session ----

  const onEvent = (conn: Conn, pageSession: Session, raw: BrowserAgentEvent): void => {
    if (conn.closed || pageSession.ended) return;
    const entry = pages.get(pageSession.pageId);
    if (entry === undefined || entry.ended) return;
    // A PAUSE IS NOTED BEFORE IT IS SAID (2026-11-19, EY-S1-07): a pause is owed by the page whichever of the client's
    // sessions it came on (its own, or a frame's or a worker's under it), so it is noted against the page first, in this
    // same turn — before anything may drop it, and before the client can hear it — and an answer the client sends at
    // once finds it owed.
    const pause = FETCH_PAUSE_EVENTS.has(raw.method) && typeof raw.params.requestId === "string";
    if (pause) {
      deps.windows.notePaused(
        entry.page.pageId,
        raw.params.requestId as string,
        raw.method as "Fetch.requestPaused" | "Fetch.authRequired",
      );
    }
    // a session under the page session: the client's own auto-attach made it (a frame of another site, a worker)
    let session: Session = pageSession;
    if (raw.child !== undefined) {
      const child = conn.sessions.get(raw.child);
      if (child === undefined || child.kind !== "child" || child.pageId !== entry.page.pageId) {
        if (pause) deps.log({ event: "desktop.pages.pause_unrouted", method: raw.method });
        return;
      }
      session = child;
    }
    let params = raw.params;
    if (raw.method === "Target.attachedToTarget" && typeof raw.params.sessionId === "string") {
      const childId = raw.params.sessionId;
      // A CLIENT'S CHILDREN ARE FRAMES AND DEDICATED WORKERS ALONE (BU-22; 2026-11-24). The forwarded filter asks
      // for no other type; one that attaches all the same (a service worker, a shared worker, anything else) is
      // let run and detached by the bridge, on the session that attached it, and is never a session of the client's:
      // its attach, its events and its detach are not said, and a command naming it is `not-handed`.
      const info = raw.params.targetInfo;
      const type = isPlainObject(info) && typeof info.type === "string" ? info.type : "";
      if (!CLIENT_CHILD_TYPES.includes(type)) {
        pageSession.turnedAway ??= new Set();
        pageSession.turnedAway.add(childId);
        const real = pageSession.real;
        void real?.send("Runtime.runIfWaitingForDebugger", {}, childId).catch(() => {});
        void real
          ?.send("Target.detachFromTarget", { sessionId: childId }, session.child)
          .catch(() => {});
        deps.log({
          event: "desktop.pages.child_refused",
          type: TARGET_TYPE_WORD.test(type) ? type : "unknown",
        });
        return;
      }
      const made: Session = {
        id: childId,
        kind: "child",
        pageId: entry.page.pageId,
        parent: session.id,
        real: pageSession.real,
        key: childId,
        child: childId,
        ended: false,
      };
      conn.sessions.set(childId, made);
      // NO CHILD WAITS FOR THE CLIENT (2026-11-24): a client's auto-attach is forwarded never to wait, and one that
      // waits all the same is resumed here, by the bridge, before anything may drop its event. The client is refused
      // while the person holds the page and between calls, and on a held page with sign-ins it is never told of the
      // child at all: left to the client, the frame would stay frozen in the person's hand.
      if (raw.params.waitingForDebugger === true) {
        void pageSession.real?.send("Runtime.runIfWaitingForDebugger", {}, childId).catch(() => {});
        params = { ...raw.params, waitingForDebugger: false };
      }
    }
    if (raw.method === "Target.detachedFromTarget" && typeof raw.params.sessionId === "string") {
      // a child the bridge turned away was never said: nor is its end
      if (pageSession.turnedAway?.delete(raw.params.sessionId) === true) return;
      const gone = conn.sessions.get(raw.params.sessionId);
      if (gone !== undefined && gone.kind === "child") {
        endSession(conn, gone, { notify: false });
      }
    }
    const event: CdpEvent = { method: raw.method, params };
    const worlds = conn.worlds.event(session.key, event);
    if (worlds.action === "drop") {
      // A pause in a script of a world that is not the client's (BU-23, 2026-11-24) is not the client's to hear or
      // to end: the bridge lets the page run on, on the session the pause was said on.
      if (worlds.reason === "foreign-pause") {
        void pageSession.real?.send("Debugger.resume", {}, session.child).catch(() => {});
        deps.log({ event: "desktop.pages.foreign_pause" });
      }
      return;
    }
    const state = deps.windows.state(entry.page.pageId);
    const cleaned = deps.clean(worlds.event, {
      pageClass: entry.page.pageClass,
      held: state.held,
      signInHost: signInHostFor(entry.page.pageClass),
      isClients: (id) => id === undefined || conn.sessions.has(id),
    });
    if (cleaned.action === "drop") return;
    send(conn, {
      method: cleaned.event.method,
      params: cleaned.event.params,
      sessionId: session.id,
    });
  };

  // ---- the root and tab tables ----

  const attachToTarget = async (ctx: Ctx): Promise<void> => {
    if (ctx.params.flatten !== true) return no(ctx, refuse("forbidden", "flat sessions only"));
    const found = findTarget(ctx.conn, ctx.params.targetId);
    if (found === null)
      return no(ctx, refuse("not-handed", "no target with that id is this run's"));
    if (found.type === "tab")
      return answer(ctx, { sessionId: attachTab(ctx.conn, found.entry, ctx.sessionId) });
    let id: string | null;
    try {
      id = await attachPage(ctx.conn, found.entry, ctx.sessionId);
    } catch (error) {
      return failed(ctx, error);
    }
    if (id === null) return no(ctx, refuse("no-lease", "the page's grant has ended"));
    answer(ctx, { sessionId: id });
  };

  const detachFromTarget = (ctx: Ctx): void => {
    const { conn, params, sessionId } = ctx;
    let target =
      typeof params.sessionId === "string" ? conn.sessions.get(params.sessionId) : undefined;
    if (target === undefined && typeof params.targetId === "string") {
      for (const s of conn.sessions.values()) {
        const entry = pages.get(s.pageId);
        if (
          s.parent === sessionId &&
          entry !== undefined &&
          targetIdOf(entry, s) === params.targetId
        ) {
          target = s;
          break;
        }
      }
    }
    if (target === undefined || target.parent !== sessionId || target.kind === "child") {
      no(ctx, refuse("not-handed", "no session of this client attached there"));
      return;
    }
    endSession(conn, target, { notify: true });
    answer(ctx, {});
  };

  const getTargetInfo = (ctx: Ctx): void => {
    const { conn, params, session, entry } = ctx;
    let info: TargetInfo | null = null;
    if (params.targetId !== undefined) {
      const found = findTarget(conn, params.targetId);
      if (found !== null)
        info = found.type === "page" ? pageInfo(found.entry) : tabInfo(found.entry);
    } else if (session !== null && entry !== null) {
      info =
        session.kind === "page"
          ? pageInfo(entry)
          : session.kind === "tab"
            ? tabInfo(entry)
            : { ...pageInfo(entry), targetId: targetIdOf(entry, session), type: "iframe" };
    } else {
      info = {
        targetId: "vf-browser",
        type: "browser",
        title: "",
        url: "",
        attached: true,
        canAccessOpener: false,
      };
    }
    if (info === null) {
      no(ctx, refuse("not-handed", "no target with that id is this run's"));
      return;
    }
    answer(ctx, { targetInfo: info });
  };

  const activateTarget = (ctx: Ctx): void => {
    if (findTarget(ctx.conn, ctx.params.targetId) === null) {
      no(ctx, refuse("not-handed", "no target with that id is this run's"));
      return;
    }
    answer(ctx, {});
  };

  /** the call whose act window may change the run's panes: a create, the sender page's or any of the run's; a close,
   * the closed page's (c2's paneGatePages) */
  const paneGate = (
    conn: Conn,
    o: {
      readonly op: "create" | "close";
      readonly origin?: Entry | null;
      readonly target?: Entry | null;
    },
  ): { readonly ok: true; readonly callId: string } | Refusal => {
    const pageIds = paneGatePages({
      op: o.op,
      originPageId: o.origin?.page.pageId ?? null,
      targetPageId: o.target?.page.pageId ?? null,
      runPageIds: visibleEntries(conn).map((e) => e.page.pageId),
    });
    let last: Refusal = refuse("outside-window", "no act window is open on the page this changes");
    for (const pageId of pageIds) {
      const verdict = deps.windows.admit(pageId, { mutation: true, capture: false, script: null });
      const window = deps.windows.state(pageId).window;
      if (verdict.ok && window !== null) return { ok: true, callId: window.callId };
      if (!verdict.ok && (verdict.code === "held" || pageIds.length === 1)) {
        last = refuse(verdict.code, verdict.reason);
      }
    }
    return last;
  };

  const createTarget = async (ctx: Ctx, origin: Entry | null): Promise<void> => {
    const { conn, params } = ctx;
    const url = params.url === undefined || params.url === "" ? "about:blank" : params.url;
    if (typeof url !== "string")
      return no(ctx, refuse("forbidden", "a new target's address is a string"));
    if (params.browserContextId !== undefined) {
      return no(ctx, refuse("not-handed", "no browser context is this run's"));
    }
    const gate = paneGate(conn, { op: "create", origin });
    if (!gate.ok) return no(ctx, gate);
    let made: MakeAnswer;
    try {
      made = await deps.make({ runKey: conn.runKey, callId: gate.callId, url });
    } catch (error) {
      return failed(ctx, error);
    }
    if (!made.ok) return no(ctx, refuse(made.refused, "the broker made no pane"));
    const entry = pages.get(made.pageId);
    if (entry === undefined || entry.ended || entry.runKey !== conn.runKey) {
      return failed(ctx, new Error("the broker granted no page"));
    }
    await entry.attaching;
    answer(ctx, { targetId: entry.port.targetId });
  };

  const closeTarget = async (ctx: Ctx, targetId: unknown, result: unknown): Promise<void> => {
    const found = findTarget(ctx.conn, targetId);
    if (found === null)
      return no(ctx, refuse("not-handed", "no target with that id is this run's"));
    const entry = found.entry;
    if (held(entry)) return no(ctx, refuse("held", "the person holds the page"));
    const gate = paneGate(ctx.conn, { op: "close", target: entry });
    if (!gate.ok) return no(ctx, gate);
    // the broker's record decides (EY-1 1d, 2026-11-19): a pane it made by any door is closed; a page it handed is
    // given back
    if (deps.made(entry.runKey, entry.page.pageId)) {
      ungrant(entry.page.pageId, "closed by its client");
      try {
        await deps.closeMade({ runKey: entry.runKey, pageId: entry.page.pageId });
      } catch (error) {
        deps.log({ event: "desktop.pages.pane_close_failed", message: messageOf(error) });
      }
      answer(ctx, result);
      return;
    }
    // A HANDED page is the person's (2026-11-19): never closed, and its grant never ended here behind the broker's
    // back. The broker gives it back by its own path (windows, the journal's undo, the room told), which ends the grant
    // here; to the client the target is gone, as if it closed.
    let back: { readonly ok: true } | { readonly ok: false; readonly refused: string };
    try {
      back = await deps.giveBack({ runKey: entry.runKey, pageId: entry.page.pageId });
    } catch (error) {
      return failed(ctx, error);
    }
    if (!back.ok) return no(ctx, refuse(back.refused, "the broker kept the page"));
    if (!entry.ended) ungrant(entry.page.pageId, "given back");
    answer(ctx, result);
  };

  /** Browser.close would quit the app: refused, then the client is let go */
  const browserClose = (ctx: Ctx): void => {
    no(ctx, refuse("forbidden", "Browser.close is a disconnect here, never forwarded"));
    ctx.conn.io.close(1000, "Browser.close");
  };

  const onRoot = async (ctx: Ctx): Promise<void> => {
    const { conn, method, params } = ctx;
    switch (method) {
      case "Target.getBrowserContexts":
        return answer(ctx, { browserContextIds: [] });
      case "Target.setDiscoverTargets":
        conn.discover = params.discover === true;
        conn.discoverFilter = Array.isArray(params.filter) ? params.filter : undefined;
        if (conn.discover) for (const entry of visibleEntries(conn)) announceCreated(conn, entry);
        return answer(ctx, {});
      case "Target.getTargets":
        return answer(ctx, { targetInfos: targetInfos(conn, params.filter) });
      case "Target.setAutoAttach": {
        const on = params.autoAttach === true;
        if (on && params.flatten !== true)
          return no(ctx, refuse("forbidden", "flat sessions only"));
        conn.autoAttach = on;
        conn.autoFilter = Array.isArray(params.filter) ? params.filter : undefined;
        if (on) {
          try {
            for (const entry of visibleEntries(conn)) await autoAttachRoot(conn, entry);
          } catch (error) {
            return failed(ctx, error);
          }
        }
        return answer(ctx, {});
      }
      case "Target.attachToTarget":
        return attachToTarget(ctx);
      case "Target.detachFromTarget":
        return detachFromTarget(ctx);
      case "Target.getTargetInfo":
        return getTargetInfo(ctx);
      case "Target.activateTarget":
        return activateTarget(ctx);
      case "Target.createTarget":
        return createTarget(ctx, null);
      case "Target.closeTarget":
        return closeTarget(ctx, params.targetId, { success: true });
      case "Browser.setDownloadBehavior":
        return answer(ctx, {});
      case "Browser.close":
        return browserClose(ctx);
      default:
        return no(ctx, refuse("forbidden", "the root forwards nothing"));
    }
  };

  const onTab = async (ctx: Ctx, session: Session, entry: Entry): Promise<void> => {
    const { conn, method, params } = ctx;
    switch (method) {
      case "Target.setAutoAttach": {
        const on = params.autoAttach === true;
        if (on && params.flatten !== true)
          return no(ctx, refuse("forbidden", "flat sessions only"));
        const filter = Array.isArray(params.filter) ? params.filter : undefined;
        const live =
          typeof session.pageSession === "string" && conn.sessions.has(session.pageSession);
        if (on && !live && filterAdmits(filter, "page")) {
          try {
            session.pageSession = await attachPage(conn, entry, session.id);
          } catch (error) {
            return failed(ctx, error);
          }
        }
        return answer(ctx, {});
      }
      case "Runtime.runIfWaitingForDebugger":
        return answer(ctx, {});
      case "Target.getTargetInfo":
        return getTargetInfo(ctx);
      case "Target.detachFromTarget":
        return detachFromTarget(ctx);
      case "Target.getTargets":
        return answer(ctx, { targetInfos: targetInfos(conn, params.filter) });
      case "Browser.close":
        return browserClose(ctx);
      default:
        return no(ctx, refuse("forbidden", "a tab session carries no page methods"));
    }
  };

  // ---- page and child sessions: the bridge's own answers, then the wall ----

  const onPageSession = async (ctx: Ctx, session: Session, entry: Entry): Promise<void> => {
    const { method, params } = ctx;
    switch (method) {
      case "Target.getTargets":
        return answer(ctx, { targetInfos: targetInfos(ctx.conn, params.filter) });
      case "Target.getTargetInfo":
        return getTargetInfo(ctx);
      case "Target.attachToTarget":
        return attachToTarget(ctx);
      case "Target.detachFromTarget": {
        // a child the client's own auto-attach made is detached by its own session; Chromium says it
        const child =
          typeof params.sessionId === "string"
            ? ctx.conn.sessions.get(params.sessionId)
            : undefined;
        if (child !== undefined && child.kind === "child" && child.parent === session.id) {
          return forward(ctx, session, entry, { method, params: { sessionId: params.sessionId } });
        }
        return detachFromTarget(ctx);
      }
      case "Target.activateTarget":
        return activateTarget(ctx);
      case "Target.createTarget":
        return createTarget(ctx, entry);
      case "Target.closeTarget":
        return closeTarget(ctx, params.targetId, { success: true });
      case "Page.close":
        if (session.kind === "page") return closeTarget(ctx, entry.port.targetId, {});
        return no(ctx, refuse("forbidden", "Page.close closes a page, not a frame"));
      case "Runtime.runIfWaitingForDebugger":
        // the page is never waiting; a child waits for the client's own auto-attach to resume it
        if (session.kind === "page") return answer(ctx, {});
        return forward(ctx, session, entry, { method, params });
      case "Browser.setDownloadBehavior":
        return answer(ctx, {});
      case "Browser.close":
        return browserClose(ctx);
      case "Target.setAutoAttach":
        // the client's own session: its auto-attach acts there alone (EY-S2-E5); flat only, never waiting, and for
        // frames and dedicated workers alone (`clientAutoAttach`)
        if (params.autoAttach === true && params.flatten !== true) {
          return no(ctx, refuse("forbidden", "flat sessions only"));
        }
        return forward(ctx, session, entry, { method, params: clientAutoAttach(params) });
      default:
        break;
    }
    if (method.startsWith("Target.") || method.startsWith("Browser.")) {
      return no(ctx, refuse("forbidden", "Target and Browser are answered by the bridge"));
    }
    if (method.startsWith("Emulation.") || method === "Debugger.pause") {
      return no(ctx, refuse("forbidden", "it acts on the page, not the session"));
    }
    return wall(ctx, session, entry);
  };

  /** The refusal an answer meets when it comes back late, or null while it may be relayed (windows.ts
   * `lateVerdict`): the person holds the page, its grant or its session has ended, or the window the call was
   * admitted in is no longer the open one. */
  const lateFor = (
    entry: Entry,
    session: Session,
    via: Admitted,
  ): { readonly code: string; readonly reason: string } | null => {
    const gone = entry.ended || session.ended;
    const late = lateVerdict(
      via.callId,
      gone ? null : deps.windows.state(entry.page.pageId),
      via.fetchAnswer,
    );
    return late === null || late.ok ? null : late;
  };

  const wall = async (ctx: Ctx, session: Session, entry: Entry): Promise<void> => {
    const pageId = entry.page.pageId;
    const state = deps.windows.state(pageId);
    if (!state.leased) return no(ctx, refuse("no-lease", "main holds no lease of the page"));
    if (state.held) return no(ctx, refuse("held", "the person holds the page"));
    const asked: CdpCall = { method: ctx.method, params: ctx.params };
    const decision = deps.classify({
      call: asked,
      page: entry.page,
      session: session.kind,
      grants: NO_GRANTS,
    });
    if (!decision.verdict.ok) return no(ctx, decision.verdict);
    const fetchAnswer = fetchAnswerOf(asked.method, asked.params);
    const admitted = deps.windows.admit(pageId, {
      mutation: decision.mutation,
      capture: decision.capture,
      script: decision.script,
      ...(fetchAnswer === undefined
        ? {}
        : { fetchAnswer, fetchPlain: fetchAnswerPlain(asked.method, asked.params) }),
    });
    if (!admitted.ok) {
      if ("replaceWith" in admitted && session.real !== null) {
        await session.real
          .send(admitted.replaceWith.method, admitted.replaceWith.params, session.child)
          .catch(() => {});
      }
      return no(ctx, admitted);
    }
    // the window the call was admitted in, kept from this instant for its answer (an owed Fetch answer needs none)
    const via: Admitted = {
      decision,
      callId:
        fetchAnswer === undefined ? (deps.windows.state(pageId).window?.callId ?? null) : null,
      fetchAnswer,
    };
    const worlds = ctx.conn.worlds.command(session.key, asked);
    if (!worlds.verdict.ok) return no(ctx, worlds.verdict);
    const removal = REMOVALS[worlds.call.method];
    if (removal !== undefined) {
      // the bridge's own plan in flight first (2026-11-24): a put-down's re-minted identifier is the journal's before
      // a removal is judged and translated
      await entry.hand;
      // The wait may have outlasted the wall that admitted the removal: the person picked the page up again, the
      // window it was admitted in closed, the grant ended. Then it is not sent, and it is no call's refusal: a window
      // open now is another call's.
      const stale = lateFor(entry, session, via);
      if (stale !== null) {
        return tooLate(ctx, {
          code: stale.code,
          reason: "the wall closed while the removal waited for the bridge's own plan",
        });
      }
      const key = worlds.call.params[removal.param];
      const may = deps.journal.mayRemove(
        pageId,
        ctx.conn.id,
        session.key,
        removal.kind,
        typeof key === "string" ? key : "",
      );
      if (!may.ok) return no(ctx, may);
    }
    const input = deps.input({ call: worlds.call, session: session.kind, port: entry.port });
    if (!input.verdict.ok) return no(ctx, input.verdict);
    const rewritten = rewriteCommand(input.call, { pageClass: entry.page.pageClass });
    const call = deps.journal.translate(pageId, ctx.conn.id, session.key, rewritten);
    return forward(ctx, session, entry, call, via);
  };

  /** A command sent to the page on the client's own session, and its answer. `via` is the wall's admission: a
   * command the bridge forwards by its own table (a child's auto-attach, its resume, its detach) has none, and its
   * answer is relayed as it comes. An answer the wall admitted is relayed only while its window stands (2026-11-24):
   * the worlds and the journal still hear it, since the page did take the command, and the client is refused. What
   * a refused act set is then taken off the page (`dropLate`); a refused clear stays a clear, which the client may
   * send again in a window. */
  const forward = async (
    ctx: Ctx,
    session: Session,
    entry: Entry,
    call: CdpCall,
    via?: Admitted,
  ): Promise<void> => {
    if (session.real === null)
      return no(ctx, refuse("forbidden", "a tab session carries no page methods"));
    let result: unknown;
    try {
      result = await session.real.send(call.method, call.params, session.child);
    } catch (error) {
      const late = via === undefined ? null : lateFor(entry, session, via);
      return late === null ? failed(ctx, error) : tooLate(ctx, late);
    }
    const params: CdpParams = isPlainObject(result) ? result : {};
    if (via?.decision.capture === true && typeof params.data === "string") {
      const bytes = base64Bytes(params.data);
      if (bytes > deps.stillMaxBytes) {
        deps.log({ event: "desktop.pages.still_past_bound", method: call.method, bytes });
        // one that comes back late is refused as late: it is not a refusal of the call whose window is open now
        const late = lateFor(entry, session, via);
        return late === null
          ? no(ctx, refuse("forbidden", "the still is past its bound"))
          : tooLate(ctx, late);
      }
    }
    ctx.conn.worlds.answered(session.key, call, params);
    if (via === undefined) return answer(ctx, params);
    const left = deps.journal.observe(entry.page.pageId, ctx.conn.id, session.key, call, params);
    const late = lateFor(entry, session, via);
    if (late === null) return answer(ctx, params);
    if (left === null) return tooLate(ctx, late);
    // A LATE ACT IS TAKEN OFF THE PAGE FOR GOOD (2026-11-24). The client is refused the answer and holds the command
    // failed: left in the journal, the act would stay on the page between calls, or be set again at a put-down, under
    // an identifier the client never received and so could never remove.
    dropLate(entry, session, left);
    tooLate(ctx, { code: late.code, reason: `${late.reason}; ${LATE_ACT_SAYS}` });
  };

  // ---- a frame ----

  const onFrame = async (conn: Conn, frame: string): Promise<void> => {
    if (Buffer.byteLength(frame, "utf8") > CDP_FRAME_MAX_BYTES) {
      return conn.io.close(1008, "frame too large");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      return conn.io.close(1003, "not JSON");
    }
    if (!isPlainObject(parsed)) return conn.io.close(1008, "not a command");
    const { id, method, params, sessionId } = parsed;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) return conn.io.close(1008, "bad id");
    if (typeof method !== "string" || method.length === 0 || method.length > CDP_METHOD_MAX_CHARS) {
      return conn.io.close(1008, "bad method");
    }
    if (params !== undefined && !isPlainObject(params)) return conn.io.close(1008, "bad params");
    if (sessionId !== undefined && typeof sessionId !== "string") {
      return conn.io.close(1008, "bad session");
    }
    const sid = sessionId === "" ? undefined : sessionId;
    const session = sid === undefined ? null : (conn.sessions.get(sid) ?? null);
    const entry = session === null ? null : (pages.get(session.pageId) ?? null);
    const ctx: Ctx = { conn, id, method, params: params ?? {}, sessionId: sid, session, entry };
    if (method === "Browser.getVersion") return answer(ctx, deps.engine());
    if (sid === undefined) return onRoot(ctx);
    if (session === null)
      return no(ctx, refuse("not-handed", "no session with that id is this client's"));
    if (session.ended || entry === null || entry.ended || entry.runKey !== conn.runKey) {
      return no(ctx, refuse("no-lease", "the page's grant has ended"));
    }
    if (session.kind === "tab") return onTab(ctx, session, entry);
    return onPageSession(ctx, session, entry);
  };

  // ---- the endpoint ----

  function ungrant(pageId: string, reason: string): void {
    const entry = pages.get(pageId);
    if (entry === undefined || entry.ended) return;
    entry.ended = true;
    entry.offDetach();
    const rank = { child: 0, page: 1, tab: 2 } as const;
    for (const conn of runConns(entry.runKey)) {
      const sessions = [...conn.sessions.values()]
        .filter((s) => s.pageId === pageId && !s.ended)
        .sort((a, b) => rank[a.kind] - rank[b.kind]);
      for (const s of sessions) endSession(conn, s, { notify: true });
      conn.autoAttached.delete(pageId);
      const announced = conn.announced.get(pageId);
      if (announced !== undefined) {
        if (announced.page) {
          send(conn, {
            method: "Target.targetDestroyed",
            params: { targetId: entry.port.targetId },
          });
        }
        if (announced.tab) {
          send(conn, {
            method: "Target.targetDestroyed",
            params: { targetId: `vf-tab-${entry.port.targetId}` },
          });
        }
        conn.announced.delete(pageId);
      }
    }
    pages.delete(pageId);
    deps.log({ event: "desktop.pages.grant_ended", reason });
  }

  return {
    grant(runKey, page, port, lease) {
      const live = pages.get(page.pageId);
      if (live !== undefined && !live.ended) return ANOTHER_RUNS;
      for (const e of pages.values()) {
        if (!e.ended && e.port.targetId === port.targetId) return ANOTHER_RUNS;
      }
      const entry: Entry = {
        runKey,
        page,
        port,
        lease,
        ended: false,
        attaching: Promise.resolve(),
        hand: Promise.resolve(),
        offDetach: port.onDetach((why) => ungrant(page.pageId, why)),
      };
      pages.set(page.pageId, entry);
      const attaches: Promise<unknown>[] = [];
      for (const conn of runConns(runKey)) {
        if (conn.discover) announceCreated(conn, entry);
        if (conn.autoAttach) attaches.push(autoAttachRoot(conn, entry).catch(() => {}));
      }
      entry.attaching = Promise.all(attaches);
      return BRIDGE_OK;
    },
    ungrant,
    hold(pageId) {
      const entry = pages.get(pageId);
      if (entry === undefined || entry.ended) return Promise.resolve();
      return turn(entry, async () => {
        await sendPlan(entry, "pick-up", deps.journal.undoPlan(pageId));
      });
    },
    putDown(pageId) {
      const entry = pages.get(pageId);
      if (entry === undefined || entry.ended) return Promise.resolve();
      return turn(entry, async () => {
        const plan = deps.journal.redoPlan(pageId);
        deps.journal.applyResults(pageId, plan, await sendPlan(entry, "put-down", plan));
      });
    },
    announce(pageId) {
      const entry = pages.get(pageId);
      if (entry === undefined || entry.ended) return 0;
      if (!targetEventAllowed({ pageClass: entry.page.pageClass, held: held(entry) })) return 0;
      let told = 0;
      for (const conn of runConns(entry.runKey)) {
        if (!conn.discover || !filterAdmits(conn.discoverFilter, "page")) continue;
        send(conn, { method: "Target.targetCreated", params: { targetInfo: pageInfo(entry) } });
        told += 1;
      }
      return told;
    },
    connect(runKey, epoch, io) {
      clientCounter += 1;
      const conn: Conn = {
        id: `vf-client-${clientCounter}`,
        runKey,
        epoch,
        io,
        worlds: clientWorlds(clientCounter),
        discover: false,
        discoverFilter: undefined,
        autoAttach: false,
        autoFilter: undefined,
        announced: new Map(),
        autoAttached: new Set(),
        sessions: new Map(),
        closed: false,
      };
      conns.add(conn);
      return {
        message: (frame) => onFrame(conn, frame),
        closed: () => {
          if (conn.closed) return;
          for (const s of [...conn.sessions.values()]) {
            if (s.parent === undefined) endSession(conn, s, { notify: false });
          }
          conn.closed = true;
          conns.delete(conn);
        },
      };
    },
  };
}
