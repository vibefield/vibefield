// EY-1 (2026-11-19) — THE BRIDGE'S SHARED SHAPES (track EY; draft/tool-plane/browser-use.md §4.2–§4.3, SITTINGS
// §4 and §6). Every pure core in pages/core names its inputs and answers here; the endpoint and owner (1d), the broker
// (1e), tabs (1f), the hold (1g) and stills (1h) read the same names. Ported from the lab's shared shapes
// (draft/browser-spike/ey/ARCHITECTURE.md §1), narrowed to Path 2, the path the product ships (BU-7 B).
// Each client drives a page through its own second debugger session (EY-S2-E5), so what a client leaves lives on that
// session and no domain disable is counted. Until EY-5 every page here is the agent's own, signed out: the
// signed-in class is named so the policy can refuse it. Pure: type imports from contracts, and nothing else.

import type {
  PagesCommandClass,
  PagesNeed,
  ShellSurfacesControlRefusalFact,
} from "@vibefield/contracts";

// ── the wire ──

/** A client frame over this closes its socket; a longer method name is refused (ARCHITECTURE.md:111). */
export const CDP_FRAME_MAX_BYTES = 2 * 1024 * 1024;
export const CDP_METHOD_MAX_CHARS = 160;
/** A refusal of the wall; a forward Electron rejected, with Electron's message (ARCHITECTURE.md:130-132). */
export const BRIDGE_REFUSED_CODE = -32_000;
export const BRIDGE_FORWARD_FAILED_CODE = -32_001;

export type CdpParams = Readonly<Record<string, unknown>>;
export interface CdpCall {
  readonly method: string;
  readonly params: CdpParams;
}
export interface CdpCommand extends CdpCall {
  readonly id: number;
  readonly sessionId?: string;
}
export interface CdpEvent extends CdpCall {
  readonly sessionId?: string;
}

/** Where a client's command arrives: `root` and `tab` are the bridge's own and forward nothing; `page` and `child`
 * forward (ARCHITECTURE.md:816-819). */
export const SESSION_KINDS = ["root", "tab", "page", "child"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

// ── pages ──

/** The column follows the profile, not who opened the page (BU:470-472): a persistent profile's page carries the
 * person's sign-ins; a memory profile's page is the agent's own, signed out (live-surfaces.ts:216-221). */
export const PAGE_CLASSES = ["own", "signed-in"] as const;
export type PageClass = (typeof PAGE_CLASSES)[number];

/** A page as the bridge holds it while a run has it. */
export interface BridgePage {
  /** the surface's id, as control and release name it (shell.ts:1110) */
  readonly pageId: string;
  readonly pageClass: PageClass;
  /** fieldd's key for the run: it picks the engine and is never authority (shell.ts:1104) */
  readonly runKey: string;
  /** a signed-in page's registrable domain, the one it was handed on (EY-D5); null on an own page */
  readonly site: string | null;
  /** the run's folder, absolute, as fieldd names it, never the agent; null: every path argument is refused */
  readonly runFolder: string | null;
}

/** BU-3's grants on one page. EY-1 opens none; EY-5 does. */
export interface BridgeGrants {
  readonly script: boolean;
  readonly bodies: boolean;
}
export const NO_GRANTS: BridgeGrants = Object.freeze({ script: false, bodies: false });

/** What main holds a page to for one run: the binding it was leased on (browser-control-target.ts:14-21). A call on
 * another revision or epoch is `no-lease`. */
export interface PageLease {
  readonly runKey: string;
  readonly producerEpoch: number;
  readonly bindingRevision: number;
}

// ── verdicts ──

/**
 * The bridge's answers on the CDP wire (the lab's Verdict, ARCHITECTURE.md:115-131):
 * - `held`: the person holds the page; reads, stills and acts alike (BU-9 A);
 * - `forbidden`: never on this class or session;
 * - `outside-window`: no call window is open, or this one does not take it. The lab's `no-window`, renamed: that
 *   word is the door's, for the app's window (pages.ts:18-24);
 * - `no-lease`: main holds no live lease of the page for this run;
 * - `off-site`: a navigation outside a signed-in page's site (EY-D5);
 * - `outside-folder`: a path outside the run's folder;
 * - `not-handed`: a target this run never held;
 * - `unknown-connection`: a missing, forged, spent, revoked or superseded key, at the upgrade;
 * - `needs-you`: the person does it, with its `need`.
 * `reason` is prose for the log: never a key, a URL's query, a path outside the run, or a typed value.
 */
export const BRIDGE_REFUSALS = [
  "held",
  "forbidden",
  "outside-window",
  "no-lease",
  "off-site",
  "outside-folder",
  "not-handed",
  "unknown-connection",
  "needs-you",
] as const;
export type BridgeRefusalCode = (typeof BRIDGE_REFUSALS)[number];
export type BridgeRefusal = {
  readonly ok: false;
  readonly code: BridgeRefusalCode;
  readonly reason: string;
  readonly need?: PagesNeed;
};
export type BridgeVerdict = { readonly ok: true } | BridgeRefusal;
export const BRIDGE_OK: BridgeVerdict = Object.freeze({ ok: true } as const);

/** A refusal the bridge made inside a call's window; the broker reads them at the call's end. */
export interface CallRefusal {
  readonly callId: string;
  readonly method: string;
  readonly code: BridgeRefusalCode;
  readonly need?: PagesNeed;
}

// ── policy (1c-i; SITTINGS §4) ──

/** The engine's own script by exact source (PAGES_SCRIPT_SET), else the agent's (SITTINGS:357-374). */
export type ScriptFacts =
  | {
      readonly source: "engine";
      readonly commandClass: PagesCommandClass;
      readonly entryId: string;
    }
  | { readonly source: "agent" };
export type ScriptMatch =
  | { readonly matched: true; readonly entryId: string; readonly commandClass: PagesCommandClass }
  | { readonly matched: false };
/** A script-carrying call's body against the set: by method, UTF-8 length and SHA-256 (pages.ts:45-50). */
export type ScriptMatcher = (body: string, method: string) => ScriptMatch;

export interface MethodQuestion {
  readonly call: CdpCall;
  readonly page: BridgePage;
  readonly session: SessionKind;
  readonly grants: BridgeGrants;
}
export interface PolicyContext {
  readonly matchScript: ScriptMatcher;
  /** the Public Suffix List's registrable domain of a host; absent, a signed-in navigation is `off-site` */
  readonly siteOf?: (host: string) => string | null;
}
/** policy.classify's answer: whether a call may pass at all, and what windows.admit and the journal read of it. */
export interface MethodDecision {
  readonly verdict: BridgeVerdict;
  /** passes only inside an act window (SITTINGS:375-377) */
  readonly mutation: boolean;
  /** a still: one per read window, none in an act window, none while held (SITTINGS:378-381) */
  readonly capture: boolean;
  readonly script: ScriptFacts | null;
  /** refused and counted apart, never unexpected (WebMCP.enable, SITTINGS:382-386) */
  readonly expected: boolean;
  /** the journal row a successful forward records */
  readonly journal: JournalKind | null;
}

/** Input methods carrying a point. On the page's main target CDP reads it in view-image pixels, so the owner carries
 * it by the capture scale unless a call window pins scale 1; never a wheel's deltas
 * (browser-electron-native.ts:1171-1172, :1531-1535). */
export const POINT_METHODS = [
  "Input.dispatchMouseEvent",
  "Input.dispatchTouchEvent",
  "Input.synthesizeScrollGesture",
  "Input.synthesizeTapGesture",
  "Input.synthesizePinchGesture",
] as const;

/** A trace records these renderer-side categories only (the lab's policy.js:203-213); policy and events read it. */
export const TRACE_CATEGORIES: readonly string[] = Object.freeze([
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "v8.execute",
  "v8",
  "disabled-by-default-v8.cpu_profiler",
  "disabled-by-default-v8.cpu_profiler.hires",
  "blink.user_timing",
]);

// ── windows (1c-ii; BU:419-426) ──

/** The window a call runs in, as the control call names it (shell.ts:1111; pages.ts:70-75). */
export type WindowKind = PagesCommandClass;
export const WINDOW_CLOSERS = ["call-end", "hold", "grant-end", "expired"] as const;
export type WindowClosedBy = (typeof WINDOW_CLOSERS)[number];

/** A lease window in time, never a BrowserWindow: the broker opens one per control call. */
export interface CallWindow {
  readonly pageId: string;
  readonly kind: WindowKind;
  readonly callId: string;
  /** the command's `action` (shell.ts:1113), for the log; never its arguments */
  readonly action: string;
  readonly openedAt: number;
  readonly stillsTaken: number;
  /** an act window's end: openedAt + the act lease */
  readonly expiresAt?: number;
  /** BU-19: the page whose call made this page; the window ends with that call */
  readonly madeBy?: string;
  readonly closedAt?: number;
  readonly closedBy?: WindowClosedBy;
  /** EY-1 (2026-11-19): the Fetch answers this window's pauses took non-plain after its call-end close, within
   * FETCH_ANSWER_GRACE_MS: a count, never their requests */
  readonly graceAnswers?: number;
}

export interface WindowState {
  readonly leased: boolean;
  readonly held: boolean;
  readonly window: CallWindow | null;
  /** Fetch answers owed outside a window (BU:422-426) */
  readonly paused: number;
  readonly draining: boolean;
}

/** What windows.admit reads of one command: policy's facts, and a Fetch answer's request id. */
export interface Admission {
  readonly mutation: boolean;
  readonly capture: boolean;
  readonly script: ScriptFacts | null;
  readonly fetchAnswer?: string;
  readonly fetchPlain?: boolean;
  /** EY-1 (2026-11-19): the Fetch answer's method, for the grace's log line alone */
  readonly fetchMethod?: string;
}
/** A refused non-plain owed Fetch answer outside a window: the bridge sends `replaceWith` itself (windows.js:15-19). */
export type AdmitVerdict = BridgeVerdict | (BridgeRefusal & { readonly replaceWith: CdpCall });

/** The act lease, proposed at 10 s (EYD:188-189); 1e measures it. Held below CONTROL_DEADLINE_MS by a test. */
export const ACT_LEASE_MS_PROPOSED = 10_000;

/** What a page's pin answered (EY-1, 2026-11-19): the window's pacing applied, a frame painted at its capture
 * scale; or the deadline passed; or the call was cancelled (a hold included); or the page is gone; or the owner's
 * pin failed, which is never read as the page gone. */
export type PinApplied = "applied" | "timeout" | "cancelled" | "gone" | "failed";

/** One pin of a page's pacing, held by one call window and nobody else: taken once when the window opens, given back
 * once when it ends, by whatever path. */
export interface PinHandle {
  readonly applied: Promise<PinApplied>;
  release(): void;
}

/** The page owners' pins, found through main's registry. The windows module calls it; the broker never does. */
export interface PagePins {
  pin(pageId: string): PinHandle;
}

export interface Windows {
  lease(pageId: string, lease: PageLease): void;
  unlease(pageId: string): CallWindow | null;
  open(
    pageId: string,
    w: {
      readonly kind: WindowKind;
      readonly callId: string;
      readonly action: string;
      readonly bindingRevision?: number;
    },
  ): BridgeVerdict;
  /** BU-19: the page a call made shares that call's window, of its kind, until the call ends */
  adopt(pageId: string, madeBy: string, callId: string): BridgeVerdict;
  close(pageId: string, callId: string): CallWindow | null;
  /** every window of the call, made pages' included */
  closeCall(callId: string): readonly CallWindow[];
  hold(pageId: string): { readonly closed: CallWindow | null };
  putDown(pageId: string): void;
  drain(pageId: string, callId: string, o?: { readonly forMs?: number }): void;
  drained(pageId: string, callId: string): void;
  admit(pageId: string, c: Admission): AdmitVerdict;
  notePaused(
    pageId: string,
    requestId: string,
    event?: "Fetch.requestPaused" | "Fetch.authRequired",
  ): void;
  forgetPaused(pageId: string): void;
  state(pageId: string): WindowState;
  history(pageId: string): readonly CallWindow[];
  /** The live window's pin for this call: its `applied` ("failed" when the owner's pin threw), or null when no
   * window of that call is open on the page or no pins were given. */
  applied(pageId: string, callId: string): Promise<PinApplied> | null;
}

// ── the journal (1c-ii; BU:427-430) ──

export const JOURNAL_KINDS = [
  "route",
  "extra-headers",
  "init-script",
  "throttling",
  "emulation",
  "binding",
  "breakpoint",
  "debugger",
  "tracing",
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/** One thing a client left on a page, with the undo the journal derived (never the client's). */
export interface JournalEntry {
  readonly seq: number;
  readonly pageId: string;
  readonly clientId: string;
  /** the real session it was set on: the client's own second session or a child of it; its plans go there */
  readonly session: string;
  readonly kind: JournalKind;
  /** a pattern digest, an identifier, a binding name, a method, or "*" for a whole-state kind */
  readonly key: string;
  readonly set: CdpCall;
  readonly undo: CdpCall;
  readonly state: "active" | "undone" | "ended";
  /** an init script's identifier after a redo re-minted it */
  readonly alias?: string;
}

/** A command the bridge sends as its own traffic, outside any window, on `session`. */
export interface PlanItem extends CdpCall {
  readonly session: string;
  readonly entrySeq?: number;
  /** the script grant's end reloads a signed-in page (BU:429-430) */
  readonly reload?: true;
}
export interface LateSettle {
  readonly label: "late-grant-end" | "late-hold" | "late-script-grant-end";
  readonly plan: readonly PlanItem[];
}

/** The bridge's half of the person's hand on a page a run holds (2026-11-24), beside the windows' `hold` and
 * `putDown` and named by the surface as they are: the pick-up sends the journal's undo for what the run's client left
 * on the page, the put-down its redo. Each is the bridge's own traffic, sent on the client's own session outside the
 * wall, so the hold that refuses the client never refuses it. A surface no run holds takes neither. */
export interface BridgeHand {
  hold(surfaceId: string): void;
  putDown(surfaceId: string): void;
}

export interface Journal {
  observe(
    pageId: string,
    clientId: string,
    session: string,
    call: CdpCall,
    result: CdpParams,
  ): JournalEntry | null;
  /** pick-up: every active entry undone, newest first */
  undoPlan(pageId: string): readonly PlanItem[];
  /** put-down: what the pick-up undid, redone oldest first */
  redoPlan(pageId: string): readonly PlanItem[];
  /** grant end: undone for good */
  endPlan(pageId: string): readonly PlanItem[];
  /** BU-3's script grant ends (EY-5): what it gated, undone for good, then a reload on a signed-in page */
  scriptGrantEndPlan(
    pageId: string,
    o?: { readonly pageClass?: PageClass; readonly reloadSession?: string },
  ): readonly PlanItem[];
  settleLate(
    pageId: string,
    entry: JournalEntry | null,
    s: {
      readonly leased: boolean;
      readonly held: boolean;
      readonly pageClass: PageClass;
      readonly scriptGrant: boolean;
      /** where a late script-grant end's reload goes on a signed-in page (EY-5) */
      readonly reloadSession?: string;
    },
  ): LateSettle | null;
  /** a late act the client was refused (2026-11-24): that one entry ends for good, out of the pick-up and put-down
   * cycle, and what takes it off the page is answered (nothing for one already off or already ended); nothing is set
   * in its place */
  dropLate(pageId: string, entry: JournalEntry | null): readonly PlanItem[];
  applyResults(
    pageId: string,
    plan: readonly PlanItem[],
    results: readonly (CdpParams | { readonly error: string })[],
  ): void;
  translate(pageId: string, clientId: string, session: string, call: CdpCall): CdpCall;
  mayRemove(
    pageId: string,
    clientId: string,
    session: string,
    kind: "init-script" | "binding",
    key: string,
  ): BridgeVerdict;
  /** a client's own session detached and Chromium dropped what it left (measured at 1d): its entries end, no plan */
  sessionEnded(pageId: string, session: string): number;
  rows(
    pageId: string,
  ): Readonly<
    Record<JournalKind, { readonly entries: readonly JournalEntry[]; readonly exercised: boolean }>
  >;
}

// ── cleaned events (1c-ii; BU:431-439) ──

export interface CleanContext {
  readonly pageClass: PageClass;
  readonly held: boolean;
  /** hosts whose query values and fragments are redacted: every host of a signed-in page, none of an own page */
  readonly signInHost: (host: string) => boolean;
  /** the client's own sessions: its second session and that session's children */
  readonly isClients?: (sessionId: string | undefined) => boolean;
}
/** `foreign-pause` (2026-11-24): a `Debugger.paused` with a frame in a script of a world the client was not given
 * (BU-23). It is not the client's to hear, and the bridge lets the page run on. */
export type CleanDrop = "held" | "extra-info" | "not-the-clients" | "foreign-pause";
export type CleanedEvent =
  | { readonly action: "forward"; readonly event: CdpEvent }
  | { readonly action: "drop"; readonly reason: CleanDrop };

// ── one-use keys (1c-i; SITTINGS:283-296) ──

/** Path 2's run endpoint `/browser/<routeId>/<key>`; a ticket route (`/ticket/…`, BU-21) joins at EY-7. */
export const KEY_ROUTE_PREFIX = "browser";
export const KEY_ROUTE_ID_BYTES = 16;
export const KEY_BYTES = 32;
/** Hands a minted URL to the broker, which gives it to the engine's own launch; null: the route is revoked. Never a
 * file, never argv. */
export type KeyDelivery = (routeKey: string, url: string | null) => void;
export interface KeyRoute {
  readonly routeKey: string;
  readonly routeId: string;
}
/** A key is minted only when the broker arms a launch, and never again at a spend: no key rests waiting, so the lab's
 * silent pre-connect race (BU:1067-1069) cannot open. A spent key presented again is `unknown-connection`; nothing is
 * superseded. */
export type KeyClaim =
  | { readonly ok: true; readonly routeKey: string; readonly epoch: number }
  | { readonly ok: false; readonly verdict: BridgeRefusal };
export interface KeyLedgerRow {
  readonly epoch: number;
  readonly state: "unspent" | "spent" | "revoked";
  readonly mintedAt: number;
  readonly spentAt?: number;
  readonly spentBy?: string;
  readonly releasedAt?: number;
  readonly revokedAt?: number;
  /** a spent key presented again, refused: the broker revokes the route and restarts the engine */
  readonly replayedAt?: number;
  readonly deliveryError?: string;
}
export interface Keyring {
  addRoute(r: { readonly routeKey: string; readonly port: number }): KeyRoute;
  /** mints one key for the route's next launch and delivers it; the epoch it returns is the key's */
  arm(routeKey: string): { readonly epoch: number };
  claim(requestPath: string, connId: string): KeyClaim;
  released(connId: string): void;
  revoke(routeKey: string): void;
  ledger(routeKey: string): readonly KeyLedgerRow[];
  liveConnections(routeKey: string): readonly { readonly connId: string; readonly epoch: number }[];
}

// ── the bridge's per-client record (1d writes it; ARCHITECTURE.md:816-819, one session per client) ──

export interface BridgeSession {
  /** what the client sees: `vf-tab-N`, `vf-page-N`, or a child's own id */
  readonly virtualId: string;
  readonly kind: Exclude<SessionKind, "root">;
  readonly pageId: string;
  /** none for a tab; for a page, the client's own second session (Target.attachToTarget {targetId: self,
   * flatten: true} from the owner, BU:1158-1159); for a child, Chromium's id (a frame, or the page's dedicated
   * worker, BU-22) */
  readonly real: string | null;
  readonly parent: string | null;
  readonly ended: boolean;
}
export interface BridgeClient {
  readonly connId: string;
  readonly runKey: string;
  /** the key epoch it spent */
  readonly epoch: number;
  /** a root auto-attach filter that leaves out `page` (Puppeteer) gets tab sessions */
  readonly filter: "none" | "page-excluded";
  readonly discover: boolean;
  readonly sessions: ReadonlyMap<string, BridgeSession>;
  /** BU-23: the isolated worlds this client made, by page (Page.createIsolatedWorld's executionContextId) */
  readonly isolatedWorlds: ReadonlyMap<string, ReadonlySet<number>>;
}

// ── a call window's pins (1c-ii; reader A §e) ──

/** What the person's demand gives the page (browser-producer.ts:3152-3169, :3207-3215; law.ts:142). */
export interface PacingDemand {
  readonly mode: "live" | "paused";
  /** live: the demand's target fps; paused: 1 */
  readonly fps: number;
  /** the transport's ceiling (the cpu-bgra fallback caps at 10, CPU_FALLBACK_MAX_FPS): a pin's floor never passes it */
  readonly maxFps: number;
  /** ≤ 1 on a desktop page (browser-electron-native.ts:266-286); a mobile page keeps its own */
  readonly captureScale: number;
  readonly mobile: boolean;
}
export interface Pacing {
  readonly captureScale: number;
  readonly frameRate: number;
  readonly painting: boolean;
}
/** Inside a call window the page is its own size, awake and painting (reader A: A.md:44, :80). */
export interface CallWindowPins {
  readonly captureScale: 1;
  readonly minFrameRate: number;
  readonly painting: true;
}
/** Proposed: the floor is measured in 1i's desk row on the test Mac. */
export const CALL_WINDOW_PINS: CallWindowPins = Object.freeze({
  captureScale: 1,
  minFrameRate: 30,
  painting: true,
} as const);
/** The owner's steps between two pacings. `metrics`: re-send its own metrics at this scale (setBackingRaster's
 * override); `device`: re-send the person's own device (browser-electron-native.ts:1066-1078). */
export type PacingStep =
  | { readonly kind: "painting"; readonly on: boolean }
  | { readonly kind: "frame-rate"; readonly fps: number }
  | { readonly kind: "metrics"; readonly captureScale: number }
  | { readonly kind: "device" };

// ── the facts (shell.ts:1123-1155; tools.ts:90-115) ──

/** A call's control answer from how its window closed; null: `done` with the engine's output, which fieldd maps. */
export const WINDOW_CLOSE_FACT: Readonly<
  Record<WindowClosedBy, ShellSurfacesControlRefusalFact | null>
> = Object.freeze({
  "call-end": null,
  hold: "held",
  "grant-end": "gone",
  expired: "loading",
});

/** What a refusal recorded in a call's window makes of its answer, after the closer. `forbidden` and `not-handed`
 * are fieldd's facts, never main's (shell.ts:1123-1124): the engine meets them as its CDP error, nothing more. */
export const BRIDGE_REFUSAL_FACT: Readonly<
  Record<BridgeRefusalCode, ShellSurfacesControlRefusalFact | "needs-you" | null>
> = Object.freeze({
  held: "held",
  forbidden: null,
  "outside-window": null,
  "no-lease": "gone",
  "off-site": "off-site",
  "outside-folder": null,
  "not-handed": null,
  "unknown-connection": null,
  "needs-you": "needs-you",
});
