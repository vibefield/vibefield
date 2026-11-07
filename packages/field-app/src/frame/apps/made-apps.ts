import {
  AGENT_CATALOG_READERS,
  ArtifactMarkResult,
  ArtifactOpenResult,
  type IndexApp,
  IndexAppsParams,
  IndexAppsResult,
  type IndexAppsSource,
  type IndexArtifactEntry,
  IndexArtifactsResult,
  MADE_APP_LIMITS,
  MADE_APP_OPEN,
  type MADE_APP_OPEN_REFUSAL_STATES,
  MadeAppOpenRefusal,
  madeAppPreviewUrl,
  PROJECT_DOORS,
  ProjectListResult,
} from "@vibefield/contracts";
import { useCallback, useEffect, useState } from "react";
import { dayWords } from "../../chat/transcript-items";
import { getRendererLogger } from "../../logging";

// FROM YOUR AGENTS (track MA, slice 4a; DESIGN.md §8 "Artifacts — the Artifacts shelf's contents", as
// amended 2026-11-05, and §9 "Apps"; the build plan's §3 "4a" as the lead's RULINGS amend it): the
// shelf's second group, the pages the person's agents made, which field-app draws beside the hosted
// Hub because its doors are no plugin's. This module is the group's reading and its acts; nothing
// here is drawn (`MadeApps.tsx`, `MadeAppTile.tsx` draw it).
// - THE FEED is `index.apps.list {scope: "mesh"}`, paged by its cursor, and `index.apps.subscribe`'s
//   pings, each of which re-pages (the door's rows are always empty; L3). The project's NAME is
//   joined here from `project.list` (the row carries `projectKey` and `ink`, never a name).
// - OPEN is `artifact.open {appId, device, reveal: true}`: the HOME opens the URL it validated
//   through its shell's `shell.openLink` (RULINGS L4, C1, C2). The window never holds `shell.open`
//   and never calls `shell.openExternal`.
// - KEEP and HIDE are `artifact.mark {foldKey, kept | hidden}`, ONCE: the person's intent, written
//   at the home and replicated (RULINGS L8, C5), never a call per holder in `devices`.
// - VERSIONS is `index.artifacts {device, appId}`, paged, each presentation opened by its id.
// - Every state is said in words (MA-L10): a library still reading, a desktop asleep or on another
//   build, a page not kept or too large, and — at rosetta 0.1.3, MA-4's witness (C4) — an app its
//   desktop cannot write out yet, with "Open in ‹host›" when it has a hosted link.
// - Every answer is PARSED, never cast (tolerant reader): a page this build cannot read refuses the
//   whole reading in words rather than drawing half of it.

/** The calls the group makes of fieldd: the window's FielddClient (structurally), or a test's or the
 * catalog's fixture client. */
export interface MadeAppsClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  subscribe(
    method: string,
    params: Record<string, unknown>,
    onEvent: (payload: unknown) => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
}

/** The group's heading (DESIGN.md §9 "Apps": the desktop's groups are Live and From your agents). */
export const FROM_YOUR_AGENTS = "From your agents";
/** The search field's words (§9: "The shelf's field says "Search apps""). */
export const SEARCH_APPS = "Search apps";

/** One page of `index.apps.list` (the door admits 1..500). */
export const MADE_APPS_PAGE_LIMIT = 100;
/** The pages one reading walks at most FOR EACH DESKTOP in its sources: `MADE_APP_LIMITS.ROWS` is
 * one desktop's bound, and the mesh's reading holds every desktop's. A walk this bound stops with
 * pages left says so (`clipped`). */
export const MADE_APPS_MAX_PAGES = Math.ceil(MADE_APP_LIMITS.ROWS / MADE_APPS_PAGE_LIMIT);
/** The longest search the door admits (`IndexAppsParams`' `q`): the field holds no more, so a long
 * search never reaches the door as an ask it refuses. */
export const MADE_APPS_QUERY_MAX: number | undefined =
  IndexAppsParams.shape.q.unwrap().maxLength ?? undefined;
/** One page of `index.artifacts` (rosetta's own bound, 1..100). */
export const MADE_APPS_VERSIONS_LIMIT = 100;
/** The pages Versions walks at most. */
export const MADE_APPS_VERSIONS_MAX_PAGES = 10;
/** The search field's settle before it asks (the History room's library waits the same). */
export const MADE_APPS_SEARCH_DEBOUNCE_MS = 180;
/** A preview image's two retries (the Hub's `THUMBNAIL_RETRY_DELAYS_MS`), then the fallback icon. */
export const MADE_APP_PREVIEW_RETRY_DELAYS_MS = [500, 1_500] as const;
/** An open answered `starting` is asked again after each of these, then left starting. */
export const MADE_APP_OPEN_RETRY_DELAYS_MS = [1_000, 2_000] as const;
/** §9's "Opening on ‹desktop›…" is LATE: nothing for this long, then a fade (History's opening
 * words' figure). */
export const MADE_APP_OPENING_LATE_MS = 120;
/** How long this window's own `serving` answer stands: a serve nobody opens closes after
 * `MADE_APP_LIMITS.IDLE_CLOSE_MS`, so past that from this window's open the window cannot know it
 * still serves, and the tile rests (the row carries no serve state). */
export const MADE_APP_SERVING_HELD_MS = MADE_APP_LIMITS.IDLE_CLOSE_MS;

/** A refusal state `artifact.open` answers in its UNAVAILABLE's details (`MADE_APP_OPEN`). */
export type MadeAppRefusalState = (typeof MADE_APP_OPEN_REFUSAL_STATES)[number];

/** What this window last heard from an open of one app. */
export type MadeAppAct =
  | { readonly kind: "opening" }
  | { readonly kind: "serving" }
  | { readonly kind: "starting" }
  | { readonly kind: "refused"; readonly state: MadeAppRefusalState };

/** A made tile's state (§8: serving green, failed red, the rest muted, each with its words). */
export interface MadeAppState {
  /** the status dot's tone (§2.5) */
  readonly tone: "muted" | "healthy" | "error";
  /** the word after the desktop's name ("mini · asleep"), or null while it serves or rests ready */
  readonly word: string | null;
  /** whether a press asks `artifact.open` */
  readonly opens: boolean;
  /** what the group says when a press cannot open the app: its heading and its line */
  readonly why: { readonly title: string; readonly detail: string | null } | null;
  /** this window's open is in flight: the tile says §9's "Opening on ‹desktop›…", late */
  readonly opening?: true;
}

/** One line the group says of a library still reading, keyed by the desktop it is about. */
export interface MadeAppsReadingLine {
  readonly key: string;
  readonly words: string;
}

/** An app's versions as `index.artifacts` answered them, newest first, and whether its desktop's library has
 * finished its first reading (`canonicalReady`; until then the list may be short). */
export interface MadeAppVersionsRead {
  readonly entries: readonly IndexArtifactEntry[];
  readonly canonicalReady: boolean;
}

/** One day of the group, newest first. */
export interface MadeAppDay {
  readonly label: string;
  readonly apps: readonly IndexApp[];
}

/** The group's reading. */
export type MadeAppsFeed =
  | { readonly phase: "loading" }
  | {
      readonly phase: "live";
      readonly apps: readonly IndexApp[];
      readonly sources: readonly IndexAppsSource[];
      readonly clipped: boolean;
    }
  /** the answering desktop's library has not been read yet (`library-reading`): never an empty group */
  | { readonly phase: "reading"; readonly device: string | undefined }
  | { readonly phase: "error"; readonly message: string };

/** The day an app with no time stands under, last (provisional words, owed to James). */
const NO_DATE = "No date";
/** A desktop the roster names none for (provisional words, owed to James). */
const ANOTHER_DESKTOP = "Another desktop";

/** The order and the day of an app: the serving row's `publishedAt ?? capturedAt ?? 0` (H6). */
export function madeAppAt(app: Pick<IndexApp, "publishedAt" | "capturedAt">): number {
  return app.publishedAt ?? app.capturedAt ?? 0;
}

/** A day's words: Chat's `dayWords` ("Today", "Yesterday", "Mon, Nov 3"), and "No date" for an app
 * with no time. */
export function madeAppDayWords(at: number, now: number, locale?: string): string {
  return at > 0 ? dayWords(at, now, locale) : NO_DATE;
}

/** The group's days, newest first: "Today", "Yesterday", then the weekday and the date (Chat's
 * `dayWords`), and an app with no time last, under "No date". The door's own order breaks a tie. */
export function madeAppDays(apps: readonly IndexApp[], now: number, locale?: string): MadeAppDay[] {
  const ordered = [...apps].sort((a, b) => madeAppAt(b) - madeAppAt(a));
  const days: { label: string; apps: IndexApp[] }[] = [];
  for (const app of ordered) {
    const label = madeAppDayWords(madeAppAt(app), now, locale);
    const last = days[days.length - 1];
    if (last !== undefined && last.label === label) last.apps.push(app);
    else days.push({ label, apps: [app] });
  }
  return days;
}

/** The agent's label through the catalog's readers (R23b): the row's `provider`, else its `kind`;
 * nothing when the catalog names neither. */
export function madeAppAgentLabel(app: IndexApp): string | undefined {
  const byProvider =
    app.provider === undefined ? undefined : AGENT_CATALOG_READERS.entry(app.provider)?.label;
  if (byProvider !== undefined) return byProvider;
  const id = app.kind === undefined ? undefined : AGENT_CATALOG_READERS.idForKind(app.kind);
  return id === undefined ? undefined : AGENT_CATALOG_READERS.entry(id)?.label;
}

/** The fact line (§8): `‹agent› · ‹project›`, either alone when the other is unknown, else the
 * page's file name. */
export function madeAppFacts(app: IndexApp, projects: ReadonlyMap<string, string>): string {
  const agent = madeAppAgentLabel(app);
  const project = app.projectKey === undefined ? undefined : projects.get(app.projectKey);
  const facts = [agent, project].filter(
    (fact): fact is string => fact !== undefined && fact !== "",
  );
  return facts.length > 0 ? facts.join(" · ") : app.filename;
}

/** The fallback icon's letter (§2.9's exception): the title's first letter or digit, upper case,
 * else the file name's. Its combining marks ride with it, so "é" written either way is "É". */
export function madeAppInitial(app: Pick<IndexApp, "title" | "filename">): string {
  for (const words of [app.title, app.filename]) {
    const letter = /[\p{L}\p{N}]\p{M}*/u.exec(words.normalize("NFC"))?.[0];
    if (letter !== undefined) return letter.toUpperCase().normalize("NFC");
  }
  return "";
}

/** The host of an app's recorded hosted link, read as data (L22), for "Open in ‹host›". */
export function madeAppHost(hostedUrl: string | undefined): string | undefined {
  if (hostedUrl === undefined) return undefined;
  try {
    const url = new URL(hostedUrl);
    return url.protocol === "https:" && url.hostname !== "" ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

/** The app's desktop's standing in the answer, by its serving row's device. */
export function madeAppSourceOf(
  app: Pick<IndexApp, "device">,
  sources: readonly IndexAppsSource[],
): IndexAppsSource | undefined {
  return sources.find((source) => source.device === app.device);
}

/** The app's preview image: `madeAppPreviewUrl` over its OWN desktop's `previewsBase` (RULINGS L2,
 * C6), never stored; undefined with no preview or no base. */
export function madeAppImageUrl(
  app: IndexApp,
  sources: readonly IndexAppsSource[],
): string | undefined {
  if (app.preview === undefined) return undefined;
  const base = madeAppSourceOf(app, sources)?.previewsBase;
  return base === undefined ? undefined : madeAppPreviewUrl(base, app.preview);
}

/** A desktop's name as the field names it, and this desktop's own word when the roster names none. */
export function madeAppDesktop(
  source: IndexAppsSource | undefined,
  _device: string,
  here: string,
): string {
  const name = source?.name?.trim();
  if (name !== undefined && name !== "") return name;
  return source?.self === true ? here : ANOTHER_DESKTOP;
}

/** Whether this desktop's own apps have not been read from its library yet. In a mesh answer the home
 * says so by its own source's standing: `stale` until its first walk completes (3e's fold:
 * `local.ready ? "live" : "stale"`), whatever `libraryReady` says, which is absent until a page is
 * heard. A peer's `stale` is a desktop not answering, never this. */
function selfUnread(source: IndexAppsSource): boolean {
  return source.self === true && source.state === "stale";
}

/** Whether an app's desktop is away (DS-L8: asleep, not answering or on another build), so its tile
 * is greyed and asks nothing. This desktop still reading its library is not away: the group says
 * that once, above its tiles. */
export function madeAppAway(source: IndexAppsSource | undefined): boolean {
  return source !== undefined && source.state !== "live" && !selfUnread(source);
}

/** "‹desktop› is still reading its history" (§9). */
export function madeAppReadingLine(desktop: string): string {
  return `${desktop} is still reading its history`;
}

/** The group's lines for each desktop whose library has not finished its first reading, keyed by
 * the desktop: one whose `libraryReady` is false, and this desktop before its first walk lands
 * (`selfUnread`). `libraryReady` absent on any other is unknown, and says nothing. */
export function madeAppsReadingLines(
  sources: readonly IndexAppsSource[],
  here: string,
): MadeAppsReadingLine[] {
  return sources
    .filter((source) => source.libraryReady === false || selfUnread(source))
    .map((source) => ({
      key: source.device,
      words: madeAppReadingLine(madeAppDesktop(source, source.device, here)),
    }));
}

/** What the group says of the libraries still reading: each source's (`madeAppsReadingLines`), or the
 * answering desktop's own when the list itself is refused `library-reading` (the door's word for a
 * local ask; the refusal names a desktop only when it was carried there). */
export function madeAppsFeedReadingLines(feed: MadeAppsFeed, here: string): MadeAppsReadingLine[] {
  if (feed.phase === "reading")
    return [
      {
        key: feed.device ?? "here",
        words: madeAppReadingLine(feed.device === undefined ? here : ANOTHER_DESKTOP),
      },
    ];
  return feed.phase === "live" ? madeAppsReadingLines(feed.sources, here) : [];
}

/** What a reading said of an app (`clipped`): it holds fewer apps than the fold, because the door cut
 * its page or the walk stopped at its bound (provisional words, owed to James). */
export function madeAppsClippedLine(shown: number): string {
  return `Showing the newest ${shown} apps`;
}

/** The row an answer of this window's open was about: the serving presentation, its availability,
 * whether it opens, and whether its desktop is away. An answer stands while the row it was about is
 * unchanged; once a newer reading moves any of these, the row's truth wins. */
export function madeAppActBasis(app: IndexApp, source: IndexAppsSource | undefined): string {
  return [app.presentationId, app.availability, app.openable, madeAppAway(source)].join("|");
}

const muted = (
  word: string | null,
  opens: boolean,
  why: MadeAppState["why"] = null,
): MadeAppState => ({ tone: "muted", word, opens, why });

/** A made tile's state from its row, its desktop's standing and this window's last open of it (the
 * caller hands only an act that still stands over the row: `madeAppActBasis`). The order: the
 * desktop's standing (DS-L8: an asleep desktop's apps are listed and greyed), then this window's
 * act, then the page's availability, then whether its desktop can write it out. A tile at rest is
 * muted with no word: the row carries no serve state, so only this window's own open turns it
 * green. One of the app's older versions (`entry`, from Versions) is judged by its OWN availability;
 * the serving row says only whether its desktop can write an app out. Words not in DESIGN.md §9 are
 * provisional, owed to James. */
export function madeAppStateOf(
  app: IndexApp,
  source: IndexAppsSource | undefined,
  act: MadeAppAct | undefined,
  desktop: string,
  entry?: Pick<IndexArtifactEntry, "availability">,
): MadeAppState {
  switch (source?.state) {
    case "asleep":
      return muted("asleep", false, {
        title: `${desktop} is asleep`,
        detail: `This app runs on ${desktop}. It opens when ${desktop} wakes.`,
      });
    case "stale":
      // this desktop before its first walk is reading its library, which the group says above
      if (source !== undefined && selfUnread(source)) break;
      return muted("not answering", false, {
        title: `Can't reach ${desktop}`,
        detail: "It isn't answering.",
      });
    case "incompatible":
      return muted("another build", false, {
        title: `${desktop} runs another build of VibeField`,
        detail: "Its apps open here once it's updated.",
      });
    default:
      break;
  }
  switch (act?.kind) {
    case "opening":
      return { tone: "muted", word: null, opens: false, why: null, opening: true };
    case "serving":
      return { tone: "healthy", word: null, opens: true, why: null };
    case "starting":
      return muted("starting", true);
    case "refused":
      return refusedState(act.state, app, desktop);
    default:
      break;
  }
  switch (entry?.availability ?? app.availability) {
    case "not_captured":
    case "missing":
    case "changed_during_read":
      return NOT_KEPT;
    case "too_large":
      return TOO_LARGE;
    case "unsupported":
      return CANT_BE_KEPT;
    case "unknown":
      return muted("unknown", false, { title: "This app can't open here yet", detail: null });
    case "captured":
      break;
  }
  // `openable` is the serving row's: its own page kept, and its desktop able to write it out. For
  // another version only the second half carries over, and a captured row that does not open says it.
  const unbuilt =
    entry === undefined ? !app.openable : app.availability === "captured" && !app.openable;
  if (unbuilt) return unbuiltState(desktop);
  return muted(null, true);
}

const NOT_KEPT = muted("not kept", false, { title: "This page wasn't kept", detail: null });
const TOO_LARGE = muted("too large", false, { title: "Too large to keep", detail: null });
const CANT_BE_KEPT = muted("can't be kept", false, {
  title: "This page can't be kept",
  detail: null,
});

/** C4, MA-4's witness: at rosetta 0.1.3 no desktop can write an app out (‹for James›, §9).
 * *2026-11-07:* rosetta 0.1.4 has the door (RO-32); none writes one out until MA-3f calls it. */
function unbuiltState(desktop: string): MadeAppState {
  return muted("not written out yet", false, {
    title: `${desktop} can't write this app out yet`,
    detail: null,
  });
}

function refusedState(state: MadeAppRefusalState, app: IndexApp, desktop: string): MadeAppState {
  switch (state) {
    case MADE_APP_OPEN.STATE_EXPORT_UNBUILT:
      return unbuiltState(desktop);
    case MADE_APP_OPEN.STATE_NOT_KEPT:
      return NOT_KEPT;
    case MADE_APP_OPEN.STATE_TOO_LARGE:
      return TOO_LARGE;
    case MADE_APP_OPEN.STATE_UNSUPPORTED:
      return CANT_BE_KEPT;
    case MADE_APP_OPEN.STATE_READING:
      return muted("reading", true, { title: madeAppReadingLine(desktop), detail: null });
    case MADE_APP_OPEN.STATE_EXPORT_FAILED:
      return {
        tone: "error",
        word: "failed",
        opens: true,
        why: { title: `${desktop} couldn't open ${app.title}`, detail: "Try again." },
      };
    case MADE_APP_OPEN.STATE_NOT_LINKED:
      return muted("not linked", true, {
        title: `Can't reach ${desktop}`,
        detail: "It isn't connected to your tailnet yet.",
      });
  }
}

/** An error's kind, as the window's client throws it (`FielddRpcError.kind`); "" for any other. */
export function madeAppErrorKind(error: unknown): string {
  return typeof error === "object" && error !== null && "kind" in error
    ? String((error as { kind: unknown }).kind)
    : "";
}

function errorDetails(error: unknown): unknown {
  return typeof error === "object" && error !== null && "details" in error
    ? (error as { details?: unknown }).details
    : undefined;
}

/** The refusal state an `artifact.open` error carries (`UNAVAILABLE {service: "apps", state}`), or
 * null for any other error and for a state this build does not know. */
export function madeAppRefusalOf(error: unknown): MadeAppRefusalState | null {
  if (madeAppErrorKind(error) !== "UNAVAILABLE") return null;
  const refusal = MadeAppOpenRefusal.safeParse(errorDetails(error));
  return refusal.success ? refusal.data.state : null;
}

/** Whether an error is an UNAVAILABLE of the apps service, whatever its state: how a mark refused
 * until slice 3h is read (by its service alone, never by 3e's word). */
function appsUnavailable(error: unknown): boolean {
  if (madeAppErrorKind(error) !== "UNAVAILABLE") return false;
  const details = errorDetails(error);
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { service?: unknown }).service === MADE_APP_OPEN.SERVICE
  );
}

/** The words for an act that failed other than by a refusal state (provisional, owed to James). */
export function madeAppErrorWords(
  error: unknown,
  act: "open" | "keep" | "unkeep" | "hide" | "versions",
  title: string,
  desktop: string,
): string {
  if (act === "versions") return `The versions of ${title} can't be read right now.`;
  const kind = madeAppErrorKind(error);
  if (kind === "NOT_FOUND") return `${title} is no longer in Apps.`;
  if (act === "open") {
    if (kind === "RESOURCE_EXHAUSTED") return `${desktop} has too many apps open right now.`;
    if (kind === "FORBIDDEN_SCOPE" || kind === "UNAUTHORIZED")
      return "This window can't open apps yet.";
    return `Couldn't open ${title}. Try again.`;
  }
  if (appsUnavailable(error)) return "Keeping and hiding apps isn't ready yet.";
  if (kind === "FORBIDDEN_SCOPE" || kind === "UNAUTHORIZED")
    return "This window can't keep or hide apps yet.";
  if (act === "keep") return `Couldn't keep ${title}. Try again.`;
  if (act === "unkeep") return `Couldn't stop keeping ${title}. Try again.`;
  return `Couldn't hide ${title}. Try again.`;
}

/** An answer this build cannot read: the reading is refused whole, in words. */
class MadeAppsUnreadable extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`${method} answered a page this build cannot read`);
    this.name = "MadeAppsUnreadable";
    this.method = method;
  }
}

function logger() {
  return getRendererLogger().child({ component: "apps.made" });
}

/** One reading of the group: every page of `index.apps.list {scope: "mesh", q?}`, by its cursor, at
 * most `MADE_APPS_MAX_PAGES` for each desktop the newest page's sources name; the last page's
 * sources; `clipped` when any page said so or the walk stopped at its bound with pages left. A page
 * this build cannot read refuses the whole reading. */
export async function pageMadeApps(
  client: MadeAppsClient,
  q: string,
): Promise<{ apps: IndexApp[]; sources: IndexAppsSource[]; clipped: boolean }> {
  const apps: IndexApp[] = [];
  const seen = new Set<string>();
  let sources: IndexAppsSource[] = [];
  let clipped = false;
  let cursor: string | undefined;
  let bound = MADE_APPS_MAX_PAGES;
  for (let page = 0; page < bound; page += 1) {
    const raw = await client.request("index.apps.list", {
      scope: "mesh",
      limit: MADE_APPS_PAGE_LIMIT,
      ...(q !== "" ? { q } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    const parsed = IndexAppsResult.safeParse(raw);
    if (!parsed.success) {
      logger().warn("renderer.apps.page_rejected", "An unreadable page of made apps was rejected", {
        issue: parsed.error.issues[0]?.message ?? "unknown",
      });
      throw new MadeAppsUnreadable("index.apps.list");
    }
    for (const app of parsed.data.rows) {
      if (seen.has(app.appKey)) continue;
      seen.add(app.appKey);
      apps.push(app);
    }
    sources = parsed.data.sources;
    clipped ||= parsed.data.clipped === true;
    cursor = parsed.data.cursor;
    if (cursor === undefined) break;
    bound = MADE_APPS_MAX_PAGES * Math.max(1, sources.length);
  }
  // a walk its bound stopped with pages left holds fewer apps than the fold: said, never silent
  return { apps, sources, clipped: clipped || cursor !== undefined };
}

/** Project names by key (`project.list`, one page at its most), for the fact line; none on a
 * refusal or an answer this build cannot read. */
export async function madeAppProjectNames(client: MadeAppsClient): Promise<Map<string, string>> {
  let raw: unknown;
  try {
    raw = await client.request("project.list", { limit: PROJECT_DOORS.PAGE_MAX_LIMIT });
  } catch {
    return new Map();
  }
  const parsed = ProjectListResult.safeParse(raw);
  if (!parsed.success) return new Map();
  return new Map(parsed.data.rows.map((project) => [project.key, project.name]));
}

/** Open an app, or one of its versions: `artifact.open {appId, device, presentationId?,
 * reveal: true}`. The home opens the answered URL itself; this window never does. */
export async function openMadeApp(
  client: MadeAppsClient,
  app: IndexApp,
  presentationId?: string,
): Promise<ArtifactOpenResult> {
  const raw = await client.request("artifact.open", {
    appId: app.appId,
    device: app.device,
    ...(presentationId !== undefined ? { presentationId } : {}),
    reveal: true,
  });
  const parsed = ArtifactOpenResult.safeParse(raw);
  // an answer this build cannot read promises nothing is up (the contract's `starting`)
  return parsed.success ? parsed.data : { state: "starting" };
}

/** Keep or hide an app, ONCE at the home: `artifact.mark {foldKey, kept?, hidden?}`. */
export async function markMadeApp(
  client: MadeAppsClient,
  app: IndexApp,
  flags: { readonly kept?: boolean; readonly hidden?: boolean },
): Promise<ArtifactMarkResult> {
  const raw = await client.request("artifact.mark", {
    foldKey: app.foldKey,
    ...(flags.kept !== undefined ? { kept: flags.kept } : {}),
    ...(flags.hidden !== undefined ? { hidden: flags.hidden } : {}),
  });
  const parsed = ArtifactMarkResult.safeParse(raw);
  if (!parsed.success) throw new MadeAppsUnreadable("artifact.mark");
  return parsed.data;
}

/** An app's versions, newest first: `index.artifacts {device, appId}`, every page by its cursor, at
 * most `MADE_APPS_VERSIONS_MAX_PAGES`, and whether every page said its desktop's library had finished
 * its first reading. No `projectKey` is ever sent (a routed one is refused at the home, the lead's 3e
 * fix #6). */
export async function madeAppVersions(
  client: MadeAppsClient,
  app: IndexApp,
): Promise<MadeAppVersionsRead> {
  const entries: IndexArtifactEntry[] = [];
  let canonicalReady = true;
  let cursor: string | undefined;
  for (let page = 0; page < MADE_APPS_VERSIONS_MAX_PAGES; page += 1) {
    const raw = await client.request("index.artifacts", {
      device: app.device,
      appId: app.appId,
      limit: MADE_APPS_VERSIONS_LIMIT,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    const parsed = IndexArtifactsResult.safeParse(raw);
    if (!parsed.success) throw new MadeAppsUnreadable("index.artifacts");
    entries.push(...parsed.data.entries);
    canonicalReady &&= parsed.data.canonicalReady;
    cursor = parsed.data.nextCursor;
    if (cursor === undefined) break;
  }
  return { entries: entries.sort((a, b) => madeAppAt(b) - madeAppAt(a)), canonicalReady };
}

const NO_PROJECTS: ReadonlyMap<string, string> = new Map();

function feedOfError(error: unknown): MadeAppsFeed {
  if (madeAppRefusalOf(error) === MADE_APP_OPEN.STATE_READING) {
    const device = MadeAppOpenRefusal.safeParse(errorDetails(error)).data?.device;
    return { phase: "reading", device };
  }
  return { phase: "error", message: madeAppErrorKind(error) || String(error) };
}

/** The group's feed: the paged list, re-paged on every ping and on a new search; the project names,
 * read again with every re-page that a ping or `refresh` asks, so the fact line follows PJ's
 * grouping. The pings' subscription is asked before the first page, so a change after that page was
 * read pings. A reading that a newer one overtakes is dropped. `retry` asks everything again (the
 * pings, the names and the page); `refresh` re-pages and re-reads the names. */
export function useMadeAppsFeed(
  client: MadeAppsClient,
  q: string,
): {
  readonly feed: MadeAppsFeed;
  readonly projects: ReadonlyMap<string, string>;
  readonly retry: () => void;
  readonly refresh: () => void;
} {
  const [feed, setFeed] = useState<MadeAppsFeed>({ phase: "loading" });
  const [projects, setProjects] = useState<ReadonlyMap<string, string>>(NO_PROJECTS);
  const [epoch, setEpoch] = useState(0);
  const [tick, setTick] = useState(0);

  // the pings: each moves the tick, which re-pages (L3)
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch is the explicit retry signal.
  useEffect(() => {
    let live = true;
    let unsubscribe: (() => void) | null = null;
    client
      .subscribe("index.apps.subscribe", { scope: "mesh" }, () => {
        if (live) setTick((value) => value + 1);
      })
      .then(
        (subscription) => {
          if (live) unsubscribe = subscription.unsubscribe;
          else subscription.unsubscribe();
        },
        (error: unknown) => {
          if (!live) return;
          logger().info("renderer.apps.pings_refused", "The made apps' pings were refused", {
            kind: madeAppErrorKind(error),
          });
        },
      );
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [client, epoch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch and tick are the explicit signals.
  useEffect(() => {
    let live = true;
    void madeAppProjectNames(client).then((names) => {
      if (live) setProjects(names);
    });
    return () => {
      live = false;
    };
  }, [client, epoch, tick]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch and tick are the explicit signals.
  useEffect(() => {
    let live = true;
    pageMadeApps(client, q).then(
      (read) => {
        if (live) setFeed({ phase: "live", ...read });
      },
      (error: unknown) => {
        if (live) setFeed(feedOfError(error));
      },
    );
    return () => {
      live = false;
    };
  }, [client, q, tick, epoch]);

  const retry = useCallback(() => setEpoch((value) => value + 1), []);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { feed, projects, retry, refresh };
}
