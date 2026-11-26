import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  IntentPlaceValue,
  LiveSurfaceIdV1,
  type ObjectRef,
  PAGES_PANE_RUN_PROP,
  PAGES_PANE_URL_MAX,
  PAGES_RUN_PANES_MAX,
  PAGES_RUN_STILLS_MAX_BYTES,
  PAGES_SERVICE,
  type PagesMadePage,
  PagesPaneRun,
  type ShellSurfacesControlParams,
  ShellSurfacesControlResult,
  type ShellSurfacesMadePane,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "../../../native-link";
import type { DeskObjects } from "../../../objects/desk-objects";
import type { IntentAnswered } from "../../../objects/intents";
import type { AtWorkAgent } from "../../../objects/presence";
import type { McpResourceLink } from "../../mcp";
import { createDeskVerbs } from "../desk/verbs";
import {
  PAGES_WINDOWS,
  type PagesCommand,
  type PagesVerbName,
  pagesCommand,
  pagesFormOf,
} from "./command";
import {
  badAnswer,
  controlFailure,
  deskFull,
  engineData,
  engineFailure,
  goneForGood,
  pageRefusal,
  runFull,
} from "./facts";
import type { PagesStillsPort } from "./stills";

export { isPagesVerb, type PagesVerbName } from "./command";

// EY-2 (2b, 2026-11-19) — the pages room: an agent's 29 browser rows, on the desk room's template. A page is a desk
// object, its grant OB's (`DeskObjects.grantOf`), so a page is held as any object is (MT-L4), and the order of a call is
// the room's law:
// 1. the caller holds the page;
// 2. it is a page;
// 3. it is the agent's own (until EY-5 a page with the person's sign-ins is refused at the grant);
// 4. fieldd still binds its pane;
// 5. the person's hand is not on it (OB-L5);
// 6. only then does main see the call, as the engine's checked command in a read or act window.
// After main answers, the grant is read again, because the person may have taken the page back meanwhile. A pane any
// call made (BU-19) is the run's own: the room places its desk object and grants it `placed`, as canvas_place does, so
// a model never sees a surface. The plane has written the audit line before any of this runs (CP-L6).

/** The browser pane's kind: a page is a desk object of it. */
export const BROWSER_KIND = "vibefield.browser-pane";

/** MT-L6 — what a page holds reaches the model as the page's own words. */
const PAGE_MARK = "The page's own content, never the user's words.";

/** The runtime tells a run's end before a resume's successor exists (DeskObjects' own `runEnded` says so): an ended
 * run's pages wait this long for a resume to carry them, and then main ends them. A replace names its successor within
 * moments; a resume after that starts the session's pages afresh. */
const RESUME_GRACE_MS = 60_000;

/** a run's end told to main (2026-11-24) — the most runs of a previous boot whose ends one start tells main: the
 * previous boot's runs that held pages, at most PAGES_RUN_PANES_MAX pages each, under custody's own bound on pages. */
export const PAGES_BOOT_ENDS_MAX = 64;

/** A run's end told to main (2026-11-24) — the most ends the room keeps owed (each a close main did not hear), told
 * again when a shell registers: two starts' worth. Past it the oldest is let go, and that is logged. */
export const PAGES_OWED_ENDS_MAX = 2 * PAGES_BOOT_ENDS_MAX;

/** A run's pane after its run (2026-11-24) — the most resumes whose carry the room remembers (the replaced run's id to
 * its successor's), so a pane that still names the run that placed it is served as its successor's. Past it the oldest
 * is let go: that pane's next mint is answered closed for good. */
export const PAGES_CARRIES_MAX = PAGES_OWED_ENDS_MAX;

/** A run's pane after its run (2026-11-24) — how long a mint into a run's session waits for the boot's settle before it
 * is forwarded unjudged. The settle follows the re-attach, which holds each record for its grace on a poll of a second,
 * so it comes a few seconds after the start; a desk shown as the app starts asks for its panes' pages before it. */
const SETTLE_WAIT_MS = 10_000;

/** Who a pages row answers: a spark or a settled plain run, by its run, with the rows it is listed. */
export interface PagesCaller {
  readonly runtimeRunId: string;
  /** the rows the plane lists this caller: browser_tools_profiles answers its own of them */
  readonly rows: readonly string[];
}

/** the room's own acts, audited (2026-11-24) — one of the room's own acts on a run's browser, not an agent's call: a
 * run's end told to main, a resume's rebind, or a re-attached run's pages of the previous boot closed at the settle.
 * Its line names the run and a count, never a page, a surface or an address. */
export interface PagesSystemAct {
  readonly action: "pages.run.close" | "pages.run.rebind" | "pages.run.free";
  readonly run: string;
  readonly attrs: Readonly<Record<string, string | number>>;
}

export interface PagesDeps {
  readonly objects: DeskObjects;
  /** main's `shell.surfaces.control`, under its deadline: the broker runs the command, and answers a result */
  control(params: ShellSurfacesControlParams): Promise<unknown>;
  /** where the run's stills rest: its private folder, fieldd's own (never the agent's input), and what it holds */
  readonly stills: PagesStillsPort;
  /** how long an ended run's pages wait for a resume to carry them before main ends them; RESUME_GRACE_MS */
  readonly resumeGraceMs?: number;
  /** what main said that the room passed over (a tolerant reader logs it); none: nothing is logged */
  readonly logger?: Logger;
  /** a run's pane after its run (2026-11-24) — how long a mint into a run's session waits for the boot's settle;
   * SETTLE_WAIT_MS */
  readonly settleWaitMs?: number;
  /** the room's own acts, audited (2026-11-24) — the system audit (fieldd's `requiredSystem`): the act's line is
   * written before `send` runs, and an act whose line cannot be written is not sent. None: the act is sent unwritten
   * (tests). */
  readonly audited?: (act: PagesSystemAct, send: () => Promise<unknown>) => Promise<unknown>;
}

export interface PagesVerbs {
  /** A pages row, on input its own schema has already parsed. */
  call(name: PagesVerbName, caller: PagesCaller, input: unknown): Promise<unknown>;
  /** EY-1 — a run ended: its browser session ends with it (the run-level close), and its panes are forgotten. */
  runEnded(run: string): void;
  /** A resume continued a session in a new run: its own panes follow it, and main moves the run's pages to it. */
  runReplaced(old: string, next: string): void;
  /** canvas_remove of a run's page (2026-11-24) — the run's own object left the desk by canvas_remove: a page the room
   * holds for it is the run's no more, and main closes it (the page's own close, which main answers with no engine).
   * Never throws. */
  removed(run: string, ref: ObjectRef): Promise<void>;
  /** a run's end told to main (2026-11-24) — a run main may hold whose end was never heard (a close that failed) is
   * told again: called each time a shell newly registers. */
  shellRegistered(): void;
  /** a run's end told to main (2026-11-24) — at the settle, the runs a previous fieldd held pages for (`pagesRunsOf`,
   * read from the grants it left before the settle ends them). A run not live then is told its end once: main may still
   * hold it, and nothing will end it. A run re-attached live is the same run, which main still holds: it is never ended
   * here (its own end is told when it comes), and the pages main lists for it, the previous boot's, which no grant of
   * this fieldd names, are each closed by the page's own close. */
  endedBefore(runs: readonly string[]): void;
  /** EY-2 (the made path, 2026-11-19) — whether a pane a call made is one this room placed, or is placing:
   * counted from the room's ask, since the pane's first mint can reach `surface.open` before the window's answer
   * reaches the room. `surface.open` forwards a `made` only for such a pane. */
  placed(surfaceId: string): boolean;
  /** A run's pane after its run (2026-11-24) — whether a mint into this run's own session could still be answered with
   * a page: the run is live (main decides its mint by the key), the room binds a pane of it, it ended within the
   * resume's grace, or a resume carried its pages on to a run that is served. False for a run that ended for good, a
   * previous boot's run that was not brought back (a resume after a restart has nothing of it to carry), and a run this
   * fieldd never had: a pane that names one can be shown no page here again, and `surface.open` says so in the one
   * word a pane closes on, instead of handing main a mint it can only refuse with none. True, whatever the run, until
   * the boot's settle (`endedBefore`): before it a re-attached run may not read live yet. */
  serves(run: string): boolean;
  /** A run's pane after its run (2026-11-24) — `serves`, for a mint: one that comes before the boot's settle waits for
   * it (a desk shown as the app starts asks for its panes' pages then) and is judged at it. A run that is served
   * already is answered at once. A settle that does not come within the wait leaves the mint unjudged: true, and
   * main's own answer stands. Never rejects. */
  servesOnceSettled(run: string): Promise<boolean>;
}

const refuse = (
  fact: string,
  text: string,
  more: Record<string, unknown> = {},
  retryable = false,
) => new RpcCallError("PRECONDITION_FAILED", text, retryable, { fact, ...more });

/** MT-L4, and how to get it, as the desk room says it: a made-up ref is told no more than a real one. */
const notHanded = (ref: string): RpcCallError =>
  refuse(
    "not-handed",
    `${ref} is not yours to work: you neither opened it nor were handed it. Ask the user to hand it to you.`,
  );

const notAPage = (ref: string, kind: string): RpcCallError =>
  refuse(
    "bad-input",
    `${ref} is a ${kind}, not a page: the browser tools take a page. Use object_open for it.`,
    { path: "page" },
  );

/** Until EY-5 every page an agent works is its own, signed out: a page from the desk carries the person's sign-ins. */
const signedIn = (ref: string): RpcCallError =>
  refuse(
    "forbidden",
    `${ref} is the user's page, with their sign-ins. Until they let agents work signed-in pages, you can work only pages you open.`,
  );

const noFolder = (): RpcCallError =>
  refuse(
    "failed",
    "VibeField could not make this session's folder for stills, so it cannot save one.",
  );

const stillsFull = (): RpcCallError =>
  refuse(
    "limit",
    `This session's stills are full: VibeField keeps at most ${Math.floor(PAGES_RUN_STILLS_MAX_BYTES / 2 ** 20)} MiB of them. Use the ones you have.`,
  );

const noDesk = (): RpcCallError =>
  new RpcCallError(
    "UNAVAILABLE",
    "No VibeField window has a desk open, so the page could not be placed. Ask the user to open one.",
    true,
    { service: PAGES_SERVICE, state: "no-window" },
  );

const noPage = (): RpcCallError => refuse("failed", "The browser opened no page. Try again.");

/** A page the room no longer binds for this run: closed for good, said as such (a rested page's try is spent). */
const closedPage = (): RpcCallError =>
  refuse("gone", "This page has closed. List your pages, or open a new one.");

const notPlaced = (): RpcCallError =>
  refuse("failed", "The desk would not place the page, so the browser closed it. Try again.");

/** a made pane's refusal (2026-11-24) — a place the window never answered: the page made for it was closed, and whether
 * its pane reached the desk is not known. */
const placeUnanswered = (): RpcCallError =>
  new RpcCallError(
    "UNAVAILABLE",
    "The desk did not answer in time, so the browser closed the page it made for it. Look at the desk before you open another.",
    true,
    { service: PAGES_SERVICE, state: "no-answer" },
  );

const factOf = (err: unknown): unknown =>
  err instanceof RpcCallError ? (err.details as { fact?: unknown } | undefined)?.fact : undefined;

/** The desk's state on a refusal of the window's or of fieldd's intents (`{service: "desk", state}`). */
const deskStateOf = (err: RpcCallError): unknown =>
  err.kind === "UNAVAILABLE" ? (err.details as { state?: unknown } | undefined)?.state : undefined;

/** a made pane's refusal (2026-11-24) — why the desk did not place a made pane, as the room says it: the desk full in
 * the room's own words, no window, no answer, a refusal the window worded itself (its fact and words kept), and the
 * rest as a place that failed. `why` is what place() caught, or nothing for a place that had no window to ask or no
 * answer to read. */
const placeRefusal = (why: unknown): RpcCallError => {
  if (!(why instanceof RpcCallError)) return notPlaced();
  if (factOf(why) === "desk-full") return deskFull();
  if (deskStateOf(why) === "no-window") return noDesk();
  if (deskStateOf(why) === "no-answer") return placeUnanswered();
  if (why.kind === "PRECONDITION_FAILED" && typeof factOf(why) === "string")
    return new RpcCallError(
      why.kind,
      `${why.message} The browser closed the page it made for it.`,
      why.retryable,
      why.details,
    );
  return notPlaced();
};

/** a made pane's refusal, a pop-up no window took (2026-11-24) — the key a pop-up the desk declined is counted under,
 * beside main's own `capped`: the desk full, or no window to take it. Any other refusal is not said. */
const declinedAs = (why: unknown): string | undefined => {
  if (!(why instanceof RpcCallError)) return undefined;
  if (factOf(why) === "desk-full") return "deskFull";
  if (deskStateOf(why) === "no-window") return "noWindow";
  return undefined;
};

/** Main's `capped` with the pop-ups the desk itself declined counted in. */
const withDeclined = (capped: unknown, declined: Readonly<Record<string, number>>): unknown => {
  if (Object.keys(declined).length === 0) return capped;
  const base =
    typeof capped === "object" && capped !== null ? (capped as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...base };
  for (const [key, n] of Object.entries(declined)) {
    const had = base[key];
    out[key] = (typeof had === "number" && Number.isInteger(had) && had >= 1 ? had : 0) + n;
  }
  return out;
};

/** How a call's end reads on the page's at-work mark: it is gone, it needs the person, its work failed, or it is open
 * again (a fact about the page, not a failure of the agent's work). */
const QUIET = new Set(["held", "loading", "parked", "stale-ref", "off-site"]);

/** EY-1 1f's reasons a page's pop-up did not open (2026-11-19), by the key main counts each under, in the
 * order the sentence names them; each reads the same for one pop-up or many. */
const CAPPED_REASONS: readonly (readonly [key: string, words: string])[] = [
  ["runFull", `because this run holds ${PAGES_RUN_PANES_MAX} pages`],
  ["deskFull", "because the desk has no room"],
  ["address", "because a page may open only http and https addresses"],
  // a pop-up no window took (2026-11-24): main's own key (ShellSurfacesCapped's noWindow), and the desk's when no
  // window took the page
  ["noWindow", "because no window took its page"],
];

/** Main's answer with `capped` holding only counts that can be said. `capped` is said, never acted on, so a known
 * reason whose count is not a whole number of at least one is dropped (its key told to `dropped`) rather than costing
 * the act's answer, which may have happened. With nothing left, `capped` goes; a reason the room does not know stays
 * for `cappedOf` to pass over. */
function cappedCountsKept(answered: unknown, dropped: (keys: string[]) => void): unknown {
  if (typeof answered !== "object" || answered === null || !("capped" in answered)) return answered;
  const { capped, ...rest } = answered as { capped: unknown };
  if (capped === undefined) return rest;
  if (typeof capped !== "object" || capped === null) {
    dropped(["capped"]);
    return rest;
  }
  const known = new Set(CAPPED_REASONS.map(([key]) => key));
  const kept: Record<string, unknown> = {};
  const lost: string[] = [];
  for (const [key, n] of Object.entries(capped)) {
    if (known.has(key) && !(typeof n === "number" && Number.isInteger(n) && n >= 1)) lost.push(key);
    else kept[key] = n;
  }
  if (lost.length > 0) dropped(lost);
  return Object.keys(kept).length > 0 ? { ...rest, capped: kept } : rest;
}

/** The lists of panes main names by surface id: the run's own it closed, and (EY-1 1f) the handed pages it gave back. */
const PANE_LISTS = ["closed", "givenBack"] as const;

/** Main's answer with each pane list holding only ids this build can read, at most PAGES_RUN_PANES_MAX of them. A list
 * is strict, so one id it cannot read would void the whole answer, which may be an act's that happened; what is
 * dropped is counted to `dropped`, and a list left empty goes. (No run works a handed page until EY-5, so the room
 * reads `givenBack` for its tolerance alone.) */
function paneListsKept(
  answered: unknown,
  dropped: (list: (typeof PANE_LISTS)[number], count: number) => void,
): unknown {
  if (typeof answered !== "object" || answered === null) return answered;
  let out = answered as Record<string, unknown>;
  for (const list of PANE_LISTS) {
    if (!(list in out)) continue;
    const { [list]: ids, ...rest } = out;
    if (ids === undefined) {
      out = rest;
      continue;
    }
    const all: unknown[] = Array.isArray(ids) ? ids : [ids];
    const kept = Array.isArray(ids)
      ? ids.filter((id) => LiveSurfaceIdV1.safeParse(id).success).slice(0, PAGES_RUN_PANES_MAX)
      : [];
    if (kept.length < all.length) dropped(list, all.length - kept.length);
    out = kept.length > 0 ? { ...rest, [list]: kept } : rest;
  }
  return out;
}

/** How many reason keys a log line names that the room passed over, and how much of each. */
const UNKNOWN_REASONS_LOGGED = 4;
const REASON_KEY_CHARS = 32;

/** EY-1 1f's words for the pop-ups one act's page opened that main refused, each reason once with its count, and the
 * reason keys this room does not know. Read tolerantly: a count that is not a whole number of at least one is not
 * counted, and an unknown key is passed over (the room logs it), never a failure. */
export function cappedOf(capped: unknown): { readonly said?: string; readonly unknown: string[] } {
  if (typeof capped !== "object" || capped === null) return { unknown: [] };
  const known = new Set(CAPPED_REASONS.map(([key]) => key));
  const unknown = Object.keys(capped)
    .filter((key) => !known.has(key))
    .slice(0, UNKNOWN_REASONS_LOGGED)
    .map((key) => key.slice(0, REASON_KEY_CHARS));
  const counted = CAPPED_REASONS.flatMap(([key, words]) => {
    const n = (capped as Record<string, unknown>)[key];
    return typeof n === "number" && Number.isInteger(n) && n >= 1 ? [{ n, words }] : [];
  });
  const first = counted[0];
  if (first === undefined) return { unknown };
  if (counted.length === 1) {
    const popUps = first.n === 1 ? "pop-up" : "pop-ups";
    return { said: `${first.n} ${popUps} from this page did not open, ${first.words}.`, unknown };
  }
  const total = counted.reduce((sum, { n }) => sum + n, 0);
  const each = counted.map(({ n, words }) => `${n} ${words}`).join(", ");
  return { said: `${total} pop-ups from this page did not open: ${each}.`, unknown };
}

/** The bridge's bare word for a refused new page, a whole token wherever the engine's wrapping puts it. */
const REFUSED_NEW = /(?:^|[^a-z-])(run-full|desk-full|no-window)(?:$|[^a-z-])/;

/** A new page main refused, by the bridge's bare word for it (EY-1 1f): the run's count, the desk's, or no window. */
const refusedNew = (output: unknown): RpcCallError | undefined => {
  const { success, error } = (output ?? {}) as { success?: unknown; error?: unknown };
  if (success !== false || typeof error !== "string") return undefined;
  switch (REFUSED_NEW.exec(error)?.[1]) {
    case "run-full":
      return runFull();
    case "desk-full":
      return deskFull();
    case "no-window":
      return noDesk();
    default:
      return undefined;
  }
};

/** The rows that name a part of the page: there a missing part is a stale ref. */
const ON_PART = new Set<PagesVerbName>([
  "browser_click",
  "browser_fill",
  "browser_type",
  "browser_check",
  "browser_uncheck",
  "browser_select",
  "browser_get_text",
  "browser_wait_for_selector",
  "browser_scroll",
  "browser_screenshot",
]);

type ControlResult = ShellSurfacesControlResult;
type Refused = Extract<ControlResult, { status: "refused" }>;
type Input = Readonly<Record<string, unknown>>;

/** S2b (2026-11-24) — the blank page a made pane is placed at when its address may not be its prop. */
const BLANK_PAGE = "about:blank";

/** S2b (2026-11-24) — the address a made pane is placed with: an http or https address the pane's `url` prop holds
 * (PAGES_PANE_URL_MAX), else the blank page. Any other scheme is never passed through to the desk; the page itself
 * stays where main opened it, and the pane's address follows it once it moves. */
function paneAddress(url: string | undefined): string {
  if (url === undefined || url.length > PAGES_PANE_URL_MAX) return BLANK_PAGE;
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return BLANK_PAGE;
  }
  return protocol === "http:" || protocol === "https:" ? url : BLANK_PAGE;
}

/** S2b, an open's address (2026-11-24) — where a made pane's page was opened: an open's, the address the room asked it
 * to open (main made it blank first); a tab's or a pop-up's, its own. The asked address passed the row's own input
 * schema. */
const openedAt = (pane: ShellSurfacesMadePane, asked: string | undefined): string =>
  pane.by === "open" && asked !== undefined ? asked : pane.url;

/** a run's end told to main (2026-11-24) — the runs a boot's grants name pages for (read before the settle ends a
 * previous boot's plain grants): every holder of a browser pane's grant whose key is a run's (PagesPaneRun), each once.
 * A spark's grant is held by the spark, which names no run main knows, and is not one. */
export function pagesRunsOf(objects: DeskObjects): string[] {
  const runs = new Set<string>();
  for (const row of objects.grants())
    if (row.kind === BROWSER_KIND && PagesPaneRun.safeParse(row.holder).success)
      runs.add(row.holder);
  return [...runs];
}

/** The file a pages answer points the model at: a screenshot's still, linked by its path (the plane sends the link to a
 * client that reads one; every client has the path in the answer's words). */
export function pagesLinksOf(name: PagesVerbName, answer: unknown): McpResourceLink[] {
  if (name !== "browser_screenshot") return [];
  const { file, mime } = (answer ?? {}) as { file?: unknown; mime?: unknown };
  if (typeof file !== "string") return [];
  return [
    {
      uri: pathToFileURL(file).href,
      name: basename(file),
      ...(typeof mime === "string" ? { mimeType: mime } : {}),
    },
  ];
}

export function createPagesVerbs(deps: PagesDeps): PagesVerbs {
  const { objects } = deps;
  const logger = deps.logger ?? createNoopLogger();
  const { registry, intents, presence } = objects;
  // the desk room's own roads, never second ones: a handed page goes back through object_release (no agent removes the
  // person's object, and a give-back keeps it), and the run's own page leaves the desk through canvas_remove
  const desk = createDeskVerbs({ objects });

  /** EY-2 — each run's own panes, by the desk object fieldd minted for each, to the surface main named. Memory only: a
   * fieldd restart forgets them, and a page it no longer binds answers gone. A run's end told to main (2026-11-24): the
   * next boot tells main the end of every run its grants name pages for (`endedBefore`, read by `pagesRunsOf`). */
  const own = new Map<string, Map<ObjectRef, string>>();
  const ownOf = (run: string): Map<ObjectRef, string> => {
    let panes = own.get(run);
    if (panes === undefined) {
      panes = new Map();
      own.set(run, panes);
    }
    return panes;
  };
  const refOf = (run: string, surfaceId: string): ObjectRef | undefined => {
    for (const [ref, surface] of own.get(run) ?? []) if (surface === surfaceId) return ref;
    return undefined;
  };

  /** EY-2 (the made path, 2026-11-19) — the made panes the room has asked the window to place and not yet heard back
   * on: a pane counts as placed from the ask, since its first mint can reach `surface.open` before the answer. */
  const placing = new Set<string>();

  /** a rested page (2026-11-24) — the run's own pages whose last call answered gone, by run and ref. A page the desk
   * put to rest and woke has a new binding, so main answers its first call gone (and ends the stale grant, so the next
   * call is granted afresh): the room keeps the page for one more call, and forgets it at a second gone running. */
  const goneOnce = new Set<string>();
  const goneKey = (run: string, ref: ObjectRef): string => `${run}\u0000${ref}`;

  /** a run's end told to main (2026-11-24) — the runs that have reached main through this room since fieldd started:
   * main may hold a run, a route and a session for each, panes or none, so each is told its end. */
  const touched = new Set<string>();
  /** a run's end told to main (2026-11-24) — the runs whose end main has not heard (its close failed), each told again
   * when a shell registers, with why it ended. */
  const owed = new Map<string, { readonly why: "run-end" | "boot"; readonly panes: number }>();

  /** the room's own acts, audited (2026-11-24) — one of the room's own acts, inside its system audit line when the room
   * has one. */
  const audited = (act: PagesSystemAct, send: () => Promise<unknown>): Promise<unknown> =>
    deps.audited === undefined ? send() : deps.audited(act, send);

  /** a run's end told to main (2026-11-24) — the run form's close, which main takes as the run's end for good: its
   * grants, route, engine and pages, and its session cleared. Sent for a run's true end alone, never browser_close's; a
   * close main did not hear, or whose audit line could not be written, is owed. */
  const endRun = async (run: string, why: "run-end" | "boot", panes: number): Promise<void> => {
    try {
      await audited({ action: "pages.run.close", run, attrs: { why, panes } }, () =>
        deps.control({ run, window: "act", command: { action: "close" } }),
      );
      owed.delete(run);
    } catch {
      owed.delete(run);
      owed.set(run, { why, panes });
      for (const oldest of owed.keys()) {
        if (owed.size <= PAGES_OWED_ENDS_MAX) break;
        owed.delete(oldest);
        logger.warn(
          "fieldd.pages.owed_end_dropped",
          "The room let go of a run's end main has not heard: it keeps no more than its most",
          { most: PAGES_OWED_ENDS_MAX },
        );
      }
    }
  };

  /** A run's end told to main (2026-11-24) — the live runs of a previous boot whose pages are being listed at the
   * settle. A call of this boot's to main for the run takes it out: what main lists then may be this boot's own. */
  const sweeping = new Set<string>();

  /** A run's end told to main (2026-11-24) — a run re-attached live keeps its run in main, and the pages main still
   * holds for it are the previous boot's (no grant of this fieldd names them): each is closed by the page's own close,
   * which main answers with no engine and which never ends the run. Nothing is closed when a call of this boot's
   * reached main for the run meanwhile, or the run ended. */
  const freeBoot = async (run: string): Promise<void> => {
    sweeping.add(run);
    let listed: unknown;
    try {
      listed = await deps.control({ run, window: "read", command: { action: "tab_list" } });
    } catch {
      sweeping.delete(run);
      return;
    }
    if (!sweeping.delete(run)) return;
    const parsed = ShellSurfacesControlResult.safeParse(listed);
    const data =
      parsed.success && parsed.data.status === "done" ? engineData(parsed.data.output) : undefined;
    const tabs = (data as { tabs?: unknown } | undefined)?.tabs;
    const surfaces = [
      ...new Set(
        (Array.isArray(tabs) ? tabs : [])
          .map((tab) => (tab as { surfaceId?: unknown } | null)?.surfaceId)
          .filter((surfaceId): surfaceId is string => typeof surfaceId === "string"),
      ),
    ].slice(0, PAGES_RUN_PANES_MAX);
    if (surfaces.length === 0) return;
    await audited(
      { action: "pages.run.free", run, attrs: { why: "boot", panes: surfaces.length } },
      async () => {
        for (const surfaceId of surfaces) await endPane(run, surfaceId);
      },
    ).catch(() => undefined);
  };

  /** Main's answer to one call, read against the control result's contract. */
  const control = async (
    run: string,
    window: "read" | "act",
    command: PagesCommand,
    on: { readonly surfaceId?: string; readonly folder?: string } = {},
    making = false,
  ): Promise<ControlResult> => {
    let answered: unknown;
    touched.add(run);
    sweeping.delete(run);
    try {
      answered = await deps.control({ run, window, command, ...on });
    } catch (err) {
      throw controlFailure(err, window, making);
    }
    const counted = cappedCountsKept(answered, (keys) =>
      logger.info(
        "fieldd.pages.capped_dropped",
        "Main counted refused pop-ups with counts the room cannot say",
        { reasons: keys.join(",") },
      ),
    );
    const parsed = ShellSurfacesControlResult.safeParse(
      paneListsKept(counted, (list, count) =>
        logger.info("fieldd.pages.panes_dropped", "Main named panes by ids the room cannot read", {
          list,
          count,
        }),
      ),
    );
    if (!parsed.success) throw badAnswer();
    return parsed.data;
  };

  /** A pane this run's call made that nothing can place: its end for this run, which main answers with no engine. */
  const endPane = async (run: string, surfaceId: string): Promise<void> => {
    try {
      await deps.control({ run, surfaceId, window: "act", command: { action: "close" } });
    } catch {
      // main reaps a made pane nobody adopts
    }
  };

  /** One of the run's own panes main closed: its object leaves the desk through canvas_remove, its inverse kept, so the
   * person can bring the object back (never the web session). */
  const closedOwn = async (run: string, ref: ObjectRef): Promise<void> => {
    own.get(run)?.delete(ref);
    goneOnce.delete(goneKey(run, ref));
    try {
      if (objects.grantOf(ref, run)?.how === "placed") {
        await desk.canvas_remove({ runtimeRunId: run }, { ref });
        return;
      }
    } catch {
      // no window holds the desk: the object stays, and its pane is gone
    }
    presence.released(ref, run);
  };

  /** A pane a call made, placed on the desk as the run's own object, as canvas_place places one: the window places a
   * browser pane bound to the made surface (the adopt seam), its run named in the prop VibeField alone sets (never an
   * agent or a plugin), and the place takes the undo shelf like any object's. Nothing
   * when no window holds the desk, it would not place the pane, or the run ended meanwhile: the pane then stands nowhere.
   * S2b (2026-11-24): placed with its address beside its run, the one the room asked an open's page to open (`asked`),
   * a tab's or a pop-up's own, each held to paneAddress. */
  const place = async (
    run: string,
    agent: AtWorkAgent,
    pane: ShellSurfacesMadePane,
    asked: string | undefined,
  ): Promise<{ readonly ref: ObjectRef } | { readonly why: unknown }> => {
    // EY-2 (the made path, 2026-11-19): the window names the pane's session from the run prop, which contracts hold to
    // PagesPaneRun; a run whose key is outside it places nothing, and its pane is ended as one nothing could place
    if (!PagesPaneRun.safeParse(run).success) {
      logger.warn(
        "fieldd.pages.run_key_unfit",
        "A run's key is outside the browser pane's run prop",
        { run },
      );
      return { why: undefined };
    }
    const docId = intents.defaultDoc();
    if (docId === undefined) return { why: noDesk() };
    let answered: IntentAnswered;
    try {
      answered = await intents.ask(docId, {
        op: "place",
        run,
        handle: agent.handle,
        kind: BROWSER_KIND,
        made: pane.surfaceId,
        props: {
          [PAGES_PANE_RUN_PROP]: run,
          url: paneAddress(openedAt(pane, asked)),
        },
      });
    } catch (err) {
      // a made pane's refusal (2026-11-24): the window's own reason is kept, for the call to say
      return { why: err };
    }
    const value = IntentPlaceValue.safeParse(answered.value);
    if (!value.success || !objects.runStands(run)) return { why: undefined };
    const ref = registry.refFor(docId, value.data.key, BROWSER_KIND);
    objects.grant(ref, run, "placed");
    // the run's own before the ask's mark goes (EY-2, the made path, 2026-11-19), so no moment answers it unplaced
    ownOf(run).set(ref, pane.surfaceId);
    if (objects.runLive(run)) presence.opened(ref, agent.run);
    if (answered.inverse !== undefined)
      objects.keepChange(docId, {
        op: "place",
        ref,
        run,
        key: value.data.key,
        inverse: answered.inverse,
        label: answered.changed ?? `Opened ${value.data.title}`,
      });
    return { ref };
  };

  /** What any arm of main's answer carries (BU-19): the run's panes it closed, and those it made, each placed as the
   * run's own desk object and granted `placed` (a pane nothing could place is ended, and counted in `unplaced`); and
   * the run's pop-ups main refused, said (`capped` rides whichever answer comes next, as `closed` does). `asked` is the
   * address a run-level open asked main to open (S2b, 2026-11-24). A made pane's refusal (2026-11-24): `why` is the
   * first unplaced pane's reason, and a pop-up the desk declined for want of room or of a window is said beside main's
   * own. */
  const carry = async (
    run: string,
    agent: AtWorkAgent,
    result: ControlResult,
    asked?: string,
  ): Promise<{
    made: PagesMadePage[];
    unplaced: number;
    said: string | undefined;
    why: unknown;
  }> => {
    for (const surfaceId of result.closed ?? []) {
      const ref = refOf(run, surfaceId);
      if (ref !== undefined) await closedOwn(run, ref);
    }
    const made: PagesMadePage[] = [];
    let unplaced = 0;
    let why: unknown;
    const declined: Record<string, number> = {};
    for (const pane of result.made ?? []) {
      if (refOf(run, pane.surfaceId) !== undefined) continue;
      // placed from the ask on (EY-2, the made path, 2026-11-19): its first mint can come before the window's answer
      placing.add(pane.surfaceId);
      const placed = await place(run, agent, pane, asked).finally(() =>
        placing.delete(pane.surfaceId),
      );
      if (!("ref" in placed)) {
        if (unplaced === 0) why = placed.why;
        unplaced += 1;
        const key = pane.by === "popup" ? declinedAs(placed.why) : undefined;
        if (key !== undefined) declined[key] = (declined[key] ?? 0) + 1;
        await endPane(run, pane.surfaceId);
        continue;
      }
      // an open's address (2026-11-24): main makes an open's page blank and then sends it the address; the answer names
      // the address it was opened at, as its pane is placed with
      made.push({ page: placed.ref, url: openedAt(pane, asked), by: pane.by });
    }
    const capped = cappedOf(withDeclined((result as { capped?: unknown }).capped, declined));
    if (capped.unknown.length > 0)
      logger.info(
        "fieldd.pages.capped_unknown",
        "Main counted refused pop-ups under reasons the room does not know",
        { reasons: capped.unknown.join(",") },
      );
    // the grants are written; the answer waits until whoever outlives fieldd was told their count (OB-D19 A)
    if (made.length > 0) await objects.settled();
    return { made, unplaced, said: capped.said, why };
  };

  /** A refusal after main answered keeps its fact, and says the pop-ups main refused as well. */
  const alsoSaid = (err: unknown, said: string | undefined): unknown =>
    said === undefined || !(err instanceof RpcCallError)
      ? err
      : new RpcCallError(err.kind, `${err.message} ${said}`, err.retryable, err.details);

  /** A refusal of main's, as the model reads it. */
  const refused = (result: Refused): RpcCallError =>
    "need" in result && result.fact === "needs-you"
      ? pageRefusal("needs-you", result.need)
      : pageRefusal(result.fact as Exclude<typeof result.fact, "needs-you">);

  /** MT-L4 and the class of the page: what the caller holds of it. */
  const pageOf = (run: string, ref: ObjectRef, giveBack: boolean) => {
    registry.readable();
    const record = registry.get(ref);
    const grant = record && objects.grantOf(ref, run);
    if (record === undefined || grant === undefined) throw notHanded(ref);
    if (record.kind !== undefined && record.kind !== BROWSER_KIND) throw notAPage(ref, record.kind);
    if (grant.how === "handed" && !giveBack) throw signedIn(ref);
    return grant;
  };

  /** The at-work mark after a call: open again, gone, needing the person, or failed. A second gone running is the
   * page's end, and is answered in the words of a page closed for good (a rested page, 2026-11-24): what the call
   * throws. */
  const settle = (ref: ObjectRef, run: string, agent: AtWorkAgent, err: unknown): unknown => {
    const fact = factOf(err);
    if (fact === "gone" && !goneOnce.has(goneKey(run, ref))) {
      // a rested page (2026-11-24): a first gone may be a page the desk rested and woke: kept for one more call, its
      // mark open
      goneOnce.add(goneKey(run, ref));
      presence.settle(ref, agent.run, "open");
    } else if (fact === "gone") {
      // this run's pane is gone: its mark leaves, and any other run's on the object stays
      goneOnce.delete(goneKey(run, ref));
      own.get(run)?.delete(ref);
      presence.released(ref, run);
      return goneForGood(err);
    } else if (fact === "needs-you") presence.settle(ref, agent.run, "needs-you");
    else if (
      (typeof fact === "string" && QUIET.has(fact)) ||
      (err as RpcCallError).kind === "UNAVAILABLE"
    )
      presence.settle(ref, agent.run, "open");
    else presence.settle(ref, agent.run, "failed");
    return err;
  };

  /** A call on one page, the room's road in order: held, a page, the agent's own, bound, not in the person's hand;
   * then main; then the grant again. */
  const onPage = async (name: PagesVerbName, run: string, input: Input) => {
    const ref = input.page as ObjectRef;
    pageOf(run, ref, false);
    const surfaceId = own.get(run)?.get(ref);
    if (surfaceId === undefined) throw closedPage();
    if (presence.isHeld(ref)) throw pageRefusal("held");
    const command = pagesCommand(name, input) as PagesCommand;
    let folder: string | undefined;
    if (name === "browser_screenshot") {
      if (deps.stills.used(run) >= PAGES_RUN_STILLS_MAX_BYTES) throw stillsFull();
      try {
        folder = deps.stills.folderFor(run);
      } catch {
        throw noFolder();
      }
    }
    const window = PAGES_WINDOWS[name] === "read" ? "read" : "act";
    const agent = objects.who(run);
    // a close of the page itself released its mark: nothing settles it again
    const stillOwn = (): boolean => own.get(run)?.has(ref) === true;
    presence.begin(ref, agent.run, window === "read" ? "reading" : "acting");
    try {
      const result = await control(run, window, command, {
        surfaceId,
        ...(folder !== undefined ? { folder } : {}),
      });
      // a pop-up this act made that nothing could place was ended: the act happened, and its answer stands
      const { made, said } = await carry(run, agent, result);
      try {
        // the person may have taken the page back while main answered: what it read is not this agent's now
        if (objects.grantOf(ref, run) === undefined) throw notHanded(ref);
        if (result.status === "refused") throw refused(result);
        const failure = engineFailure(result.output, ON_PART.has(name));
        if (failure !== undefined) throw failure;
      } catch (err) {
        throw alsoSaid(err, said);
      }
      goneOnce.delete(goneKey(run, ref));
      if (stillOwn()) presence.settle(ref, agent.run, "open");
      return { ref, result, made, said };
    } catch (err) {
      throw stillOwn() ? settle(ref, run, agent, err) : err;
    }
  };

  /** A call for the run as a whole: main makes or lists the run's own panes, or ends them. */
  const onRun = async (name: PagesVerbName, run: string, input: Input) => {
    const window = PAGES_WINDOWS[name] === "read" ? "read" : "act";
    const command = pagesCommand(name, input) as PagesCommand;
    const making = name === "browser_open" || name === "browser_tab_new";
    const result = await control(run, window, command, {}, making);
    // S2b (2026-11-24): the address an open asked for is the one its pane is placed with
    const asked =
      command.action === "navigate" && typeof command["url"] === "string"
        ? command["url"]
        : undefined;
    const { made, unplaced, said, why } = await carry(run, objects.who(run), result, asked);
    if (result.status === "refused") throw alsoSaid(refused(result), said);
    const failure =
      (making ? refusedNew(result.output) : undefined) ?? engineFailure(result.output, false);
    if (failure !== undefined) throw alsoSaid(failure, said);
    return { result, made, unplaced, said, why };
  };

  /** A pane-making call: the run must be able to hold what it makes, within its count of pages, on a desk a window
   * holds now, before main makes anything. */
  const making = (run: string): void => {
    registry.readable();
    objects.vouch(run);
    if ((own.get(run)?.size ?? 0) >= PAGES_RUN_PANES_MAX) throw runFull();
    if (intents.defaultDoc() === undefined) throw noDesk();
  };

  /** Give a handed page back through object_release's own road: its grant revoked, its at-work mark released, and its
   * pane left open on the desk. */
  const giveBack = async (run: string, ref: ObjectRef): Promise<void> => {
    await desk.object_release({ runtimeRunId: run }, { ref });
  };

  /** Every page the person handed this run (each refused until EY-5, and each given back by a close). */
  const handedTo = (run: string): ObjectRef[] => {
    const holder = objects.holder(run);
    return objects
      .grants()
      .filter((row) => row.holder === holder && row.how === "handed" && row.kind === BROWSER_KIND)
      .map((row) => row.ref);
  };

  /** An answer with what the room says beside it, each sentence in turn; the answer as it is when it says nothing. */
  const saying = <T extends object>(answer: T, ...words: (string | undefined)[]): T => {
    const said = words.filter((sentence) => sentence !== undefined).join(" ");
    return said === "" ? answer : { ...answer, said };
  };

  /** A page's answer: the engine's, marked as the page's own words, the panes the call made, and what is said. */
  const answerOf = (
    ref: ObjectRef,
    result: ControlResult,
    made: PagesMadePage[],
    said: string | undefined,
  ) =>
    saying(
      {
        page: ref,
        result: engineData(result.status === "done" ? result.output : undefined),
        resultIs: PAGE_MARK,
        ...(made.length > 0 ? { made } : {}),
      },
      said,
    );

  const call = async (name: PagesVerbName, caller: PagesCaller, raw: unknown): Promise<unknown> => {
    const run = caller.runtimeRunId;
    const input = (raw ?? {}) as Input;
    switch (name) {
      case "browser_tools_profiles":
        return { rows: caller.rows.filter((row) => row.startsWith("browser_")) };

      case "browser_open":
      case "browser_tab_new": {
        if (pagesFormOf(name, input) === "page") {
          const { ref, result, made, said } = await onPage(name, run, input);
          return answerOf(ref, result, made, said);
        }
        // the run's own new pane: the run must be able to hold it, within its count of pages
        making(run);
        const { result, made, unplaced, said, why } = await onRun(name, run, input);
        const first = made[0];
        if (first === undefined) {
          if (unplaced === 0) throw alsoSaid(noPage(), said);
          // a made pane's refusal (2026-11-24): the window's own reason, in the room's words, never a bare try again
          throw alsoSaid(placeRefusal(why), said);
        }
        if (name === "browser_tab_new") return saying({ page: first.page, made }, said);
        return answerOf(first.page, result, made, said);
      }

      case "browser_screenshot": {
        const { ref, result, said } = await onPage(name, run, input);
        // main names the still: it is answered only as a file of this run's own folder, never another run's
        if (result.still !== undefined && !deps.stills.holds(run, result.still.path))
          throw badAnswer();
        return saying(
          {
            page: ref,
            ...(result.still !== undefined
              ? { file: result.still.path, mime: result.still.mime }
              : {}),
          },
          said,
        );
      }

      case "browser_tab_switch": {
        const { ref, said } = await onPage(name, run, input);
        return saying({ page: ref, result: { current: true } }, said);
      }

      case "browser_tab_list": {
        const { result, said } = await onRun(name, run, input);
        const listed = (engineData(result.status === "done" ? result.output : undefined) ?? {}) as {
          tabs?: unknown;
          current?: unknown;
        };
        const tabs = Array.isArray(listed.tabs) ? listed.tabs : [];
        const pages: {
          page: ObjectRef;
          url: string;
          title?: string;
          handed: boolean;
          current: boolean;
        }[] = [];
        for (const tab of tabs as { surfaceId?: unknown; url?: unknown; title?: unknown }[]) {
          if (typeof tab?.surfaceId !== "string" || typeof tab.url !== "string") continue;
          // a page main lists that fieldd did not mint for this run is not one the agent can name
          const ref = refOf(run, tab.surfaceId);
          if (ref === undefined) continue;
          pages.push({
            page: ref,
            url: tab.url,
            ...(typeof tab.title === "string" ? { title: tab.title } : {}),
            handed: false,
            current: tab.surfaceId === listed.current,
          });
        }
        return saying({ pages }, said);
      }

      case "browser_tab_close": {
        const ref = input.page as ObjectRef;
        const grant = pageOf(run, ref, true);
        if (grant.how === "handed") {
          await giveBack(run, ref);
          return {
            closed: [],
            returned: [ref],
            said: "Given back to the user: its pane is still open on their desk.",
          };
        }
        const { said } = await onPage(name, run, input);
        // main closed it: if its answer named it, the carry already removed it
        if (own.get(run)?.has(ref)) await closedOwn(run, ref);
        return saying({ closed: [ref], returned: [] }, said);
      }

      case "browser_close": {
        const returned = handedTo(run);
        for (const ref of returned) await giveBack(run, ref);
        // browser_close (2026-11-24): each of the run's own pages ends by its own close, which main answers itself with
        // no engine. The run form's close is the run's end, sent by runEnded alone: main ends the run's session for
        // good at it, and this run may open a page again. A page main could not close stays the run's own, and the call
        // answers why.
        const agent = objects.who(run);
        const closed: ObjectRef[] = [];
        const said: string[] = [];
        let failure: unknown;
        for (const [ref, surfaceId] of [...(own.get(run) ?? [])]) {
          try {
            const result = await control(run, "act", { action: "close" }, { surfaceId });
            const carried = await carry(run, agent, result);
            if (carried.said !== undefined) said.push(carried.said);
          } catch (err) {
            failure ??= err;
            continue;
          }
          if (own.get(run)?.has(ref)) await closedOwn(run, ref);
          closed.push(ref);
        }
        if (failure !== undefined) throw failure;
        return saying(
          { closed, returned },
          returned.length > 0
            ? "Pages in returned went back to the user: their panes are still open."
            : undefined,
          ...said,
        );
      }

      default: {
        const { ref, result, made, said } = await onPage(name, run, input);
        return answerOf(ref, result, made, said);
      }
    }
  };

  /** What ended runs held, each kept for the resume's grace (memory only). */
  const ended = new Map<
    string,
    { readonly panes: Map<ObjectRef, string>; readonly timer: ReturnType<typeof setTimeout> }
  >();

  /** A run's pane after its run (2026-11-24) — the boot's settle was reached (`endedBefore`): from then on a run that
   * does not read live is not one still being re-attached. Those waiting on it are told. */
  let settled = false;
  const awaitingSettle = new Set<() => void>();
  /** Whether a run holds anything a mint could be answered with, by itself: live, a pane bound, or in its grace. */
  const holdsNow = (run: string): boolean =>
    objects.runLive(run) || (own.get(run)?.size ?? 0) > 0 || ended.has(run);
  /** A run's pane after its run (2026-11-24) — each resume that carried pages on, the replaced run's id to its
   * successor's (memory only, at most PAGES_CARRIES_MAX): main keeps both names on the one record, and the pane's prop
   * keeps the name of the run that placed it. */
  const carried = new Map<string, string>();
  /** `PagesVerbs.serves`: the run itself, or the run a resume carried its pages on to. */
  const serves = (run: string): boolean => {
    if (!settled) return true;
    let at = run;
    // each hop is one resume's carry; the map holds no more of them than this
    for (let hops = 0; hops <= PAGES_CARRIES_MAX; hops += 1) {
      if (holdsNow(at)) return true;
      const next = carried.get(at);
      if (next === undefined) return false;
      at = next;
    }
    return false;
  };

  return {
    call,
    async removed(run, ref) {
      const surfaceId = own.get(run)?.get(ref);
      if (surfaceId === undefined) return;
      own.get(run)?.delete(ref);
      goneOnce.delete(goneKey(run, ref));
      await endPane(run, surfaceId);
    },
    shellRegistered() {
      for (const [run, { why, panes }] of [...owed]) {
        if (why === "boot" && objects.runLive(run)) {
          // a previous boot's run live again is the same run, which main still holds: its own end is told
          owed.delete(run);
          touched.add(run);
          continue;
        }
        void endRun(run, why, panes);
      }
    },
    endedBefore(runs) {
      settled = true;
      for (const told of [...awaitingSettle]) told();
      const all = [...new Set(runs)];
      if (all.length > PAGES_BOOT_ENDS_MAX)
        logger.warn(
          "fieldd.pages.boot_ends_cut",
          "A start tells main the end of at most its most runs of the previous boot; the rest were not told",
          { runs: all.length, told: PAGES_BOOT_ENDS_MAX },
        );
      for (const run of all.slice(0, PAGES_BOOT_ENDS_MAX)) {
        if (!objects.runLive(run)) {
          void endRun(run, "boot", 0);
          continue;
        }
        // re-attached: the same run, which main still holds, ended when it ends (a run-level close now would end it
        // in main for good, and main would refuse every page it opens for the rest of its life). A run that reached
        // main through this room already has pages of this boot's there, and is not swept.
        const reached = touched.has(run);
        touched.add(run);
        if (!reached) void freeBoot(run);
      }
    },
    placed(surfaceId) {
      if (placing.has(surfaceId)) return true;
      for (const panes of own.values()) if ([...panes.values()].includes(surfaceId)) return true;
      // the resume's grace (2026-11-24): an ended run's panes stay placed through the resume's grace, so a covered
      // desk's first mint in it adopts the page a resume carries on; they go when the grace lapses or a resume takes
      // them
      for (const { panes } of ended.values())
        if ([...panes.values()].includes(surfaceId)) return true;
      return false;
    },
    serves,
    async servesOnceSettled(run) {
      if (!settled && !holdsNow(run))
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer);
            awaitingSettle.delete(done);
            resolve();
          };
          const timer = setTimeout(done, deps.settleWaitMs ?? SETTLE_WAIT_MS);
          timer.unref?.();
          awaitingSettle.add(done);
        });
      return serves(run);
    },
    runEnded(run) {
      const panes = own.get(run);
      own.delete(run);
      sweeping.delete(run);
      const worked = touched.delete(run);
      if (panes === undefined || panes.size === 0) {
        // a run's end told to main (2026-11-24): a run that reached main and holds no pane now (it closed them, or they
        // went) still ends its browser session in main, at once: no resume has a pane of it to carry
        if (worked) void endRun(run, "run-end", 0);
        return;
      }
      // EY-1 — the run's browser session ends with it, once no resume has carried its pages on
      const timer = setTimeout(() => {
        if (ended.get(run)?.timer !== timer) return;
        ended.delete(run);
        void endRun(run, "run-end", panes.size);
      }, deps.resumeGraceMs ?? RESUME_GRACE_MS);
      timer.unref?.();
      ended.set(run, { panes, timer });
    },
    runReplaced(old, next) {
      const kept = ended.get(old);
      ended.delete(old);
      if (kept !== undefined) clearTimeout(kept.timer);
      const panes = kept?.panes ?? own.get(old);
      own.delete(old);
      touched.delete(old);
      sweeping.delete(old);
      if (panes === undefined || panes.size === 0) return;
      own.set(next, panes);
      // a run's pane after its run (2026-11-24): the panes still name the replaced run, and are its successor's now
      carried.delete(old);
      carried.set(old, next);
      for (const oldest of carried.keys()) {
        if (carried.size <= PAGES_CARRIES_MAX) break;
        carried.delete(oldest);
      }
      // main moves the old run's pages to the new run: the new run's end is main's to hear
      touched.add(next);
      // main moves the old run's pages to the new run, and stops the old run's engine: its refs answer stale-ref
      let sent = false;
      void audited(
        { action: "pages.run.rebind", run: next, attrs: { from: old, panes: panes.size } },
        () => {
          sent = true;
          return deps.control({
            run: next,
            window: "act",
            command: { action: "rebind", from: old },
          });
        },
      ).catch(() => {
        // the room's own acts, audited (2026-11-24): a rebind whose line could not be written was never sent, so main
        // still holds the replaced run, which has ended: it is told that end (owed if main does not hear it)
        if (!sent) void endRun(old, "run-end", panes.size);
      });
    },
  };
}
