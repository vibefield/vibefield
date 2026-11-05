import {
  type ArtifactMarkResult,
  type ArtifactOpenResult,
  type IndexApp,
  type IndexAppsSource,
  type IndexArtifactEntry,
  MADE_APP_LIMITS,
  type MADE_APP_OPEN_REFUSAL_STATES,
} from "@vibefield/contracts";

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
// RED SKELETON (MA-4a): every export below is typed as the green builds it and answers a WRONG
// value, so the suite fails by its assertions.

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
/** The pages one reading walks at most: one desktop's `MADE_APP_LIMITS.ROWS` at a page each. */
export const MADE_APPS_MAX_PAGES = Math.ceil(MADE_APP_LIMITS.ROWS / MADE_APPS_PAGE_LIMIT);
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

/** The order and the day of an app: the serving row's `publishedAt ?? capturedAt ?? 0` (H6). */
export function madeAppAt(_app: IndexApp): number {
  return -1;
}

/** The group's days, newest first: "Today", "Yesterday", then the weekday and the date (Chat's
 * `dayWords`), and an app with no time last, under "No date". */
export function madeAppDays(
  _apps: readonly IndexApp[],
  _now: number,
  _locale?: string,
): MadeAppDay[] {
  return [];
}

/** The agent's label through the catalog's readers (R23b): the row's `provider`, else its `kind`. */
export function madeAppAgentLabel(_app: IndexApp): string | undefined {
  return undefined;
}

/** The fact line (§8): `‹agent› · ‹project›`, either alone when the other is unknown, else the
 * page's file name. */
export function madeAppFacts(_app: IndexApp, _projects: ReadonlyMap<string, string>): string {
  return "";
}

/** The fallback icon's letter (§2.9's exception): the title's first letter or digit, upper case. */
export function madeAppInitial(_app: Pick<IndexApp, "title" | "filename">): string {
  return "";
}

/** The host of an app's recorded hosted link, read as data (L22), for "Open in ‹host›". */
export function madeAppHost(_hostedUrl: string | undefined): string | undefined {
  return undefined;
}

/** The app's preview image: `madeAppPreviewUrl` over its OWN desktop's `previewsBase` (RULINGS L2,
 * C6), never stored; undefined with no preview or no base. */
export function madeAppImageUrl(
  _app: IndexApp,
  _sources: readonly IndexAppsSource[],
): string | undefined {
  return "";
}

/** A desktop's name as the field names it, and this desktop's own word when the roster names none. */
export function madeAppDesktop(
  _source: IndexAppsSource | undefined,
  _device: string,
  _here: string,
): string {
  return "";
}

/** "‹desktop› is still reading its history", for each desktop whose library has not finished its
 * first reading (`libraryReady: false`). */
export function madeAppsReadingWords(
  _sources: readonly IndexAppsSource[],
  _here: string,
): string[] {
  return [];
}

/** A made tile's state from its row, its desktop's standing and this window's last open of it. */
export function madeAppStateOf(
  _app: IndexApp,
  _source: IndexAppsSource | undefined,
  _act: MadeAppAct | undefined,
  _desktop: string,
): MadeAppState {
  return { tone: "healthy", word: null, opens: true, why: null };
}

/** The refusal state an `artifact.open` error carries (`UNAVAILABLE {service: "apps", state}`). */
export function madeAppRefusalOf(_error: unknown): MadeAppRefusalState | null {
  return null;
}

/** The words for an act that failed other than by a refusal state. */
export function madeAppErrorWords(
  _error: unknown,
  _act: "open" | "keep" | "hide" | "versions",
  _title: string,
  _desktop: string,
): string {
  return "";
}

/** One reading of the group: every page of `index.apps.list {scope: "mesh", q?}`, by its cursor, at
 * most `MADE_APPS_MAX_PAGES`; the last page's sources; `clipped` when any page said so. */
export async function pageMadeApps(
  _client: MadeAppsClient,
  _q: string,
): Promise<{ apps: IndexApp[]; sources: IndexAppsSource[]; clipped: boolean }> {
  return { apps: [], sources: [], clipped: false };
}

/** Project names by key (`project.list`, one page at its most), for the fact line; none on a
 * refusal. */
export async function madeAppProjectNames(_client: MadeAppsClient): Promise<Map<string, string>> {
  return new Map();
}

/** Open an app, or one of its versions: `artifact.open {appId, device, presentationId?, reveal: true}`. */
export async function openMadeApp(
  _client: MadeAppsClient,
  _app: IndexApp,
  _presentationId?: string,
): Promise<ArtifactOpenResult> {
  return { state: "starting" };
}

/** Keep or hide an app, ONCE at the home: `artifact.mark {foldKey, kept?, hidden?}`. */
export async function markMadeApp(
  _client: MadeAppsClient,
  app: IndexApp,
  _flags: { readonly kept?: boolean; readonly hidden?: boolean },
): Promise<ArtifactMarkResult> {
  return { foldKey: app.foldKey, kept: false, hidden: false };
}

/** An app's versions, newest first: `index.artifacts {device, appId}`, every page by its cursor. */
export async function madeAppVersions(
  _client: MadeAppsClient,
  _app: IndexApp,
): Promise<IndexArtifactEntry[]> {
  return [];
}

/** The group's feed: the paged list, re-paged on every ping and on a new search; the project names. */
export function useMadeAppsFeed(
  _client: MadeAppsClient,
  _q: string,
): {
  readonly feed: MadeAppsFeed;
  readonly projects: ReadonlyMap<string, string>;
  readonly retry: () => void;
} {
  return { feed: { phase: "loading" }, projects: new Map(), retry: () => undefined };
}
