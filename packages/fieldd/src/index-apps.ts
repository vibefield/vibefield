import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  AgentCatalogEntry,
  IndexArtifactPageResponse,
  IndexCatalogApp,
  IndexCatalogTable,
  IndexThread,
  MadeAppPreview,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { IndexArtifactsRead } from "./agent-index";
import { CatalogTable, type RowsPump, type RowsPumpOptions } from "./catalog-rows";

// MA-3a (`draft/thinking-mini-apps.md` v0.2 §4.1–§4.2, RULED 2026-11-05; the
// build plan's 3a as the lead ruled it, RULINGS L13 + C10) — the `apps` table's
// SOURCE on this desktop. fieldd walks its own rosetta's LIBRARY (`GET
// /api/artifacts`, `IndexService.artifacts`) and republishes it as one FACT
// table of rows (`IndexCatalogApp`), keyed by `appId` and stamped by this
// desktop alone (DS-L2), for every self desktop to replicate through its own
// peer door (`index.apps.catalog.subscribe`, the plan's L1) and for the fold
// to page. It is a SIBLING of `IndexCatalog`, never inside it: the catalog's
// tables, its peer door and History's pings stay as they are (L1), and this
// class reads only the catalog's PUBLIC surface (`ready`, `threads`,
// `device()`, its `changed` event) — never a private method (C10).
//
// THE WALK (L13). rosetta's cursor expires on every ingest batch (its
// `(epoch, revision)` moves; fieldd-index map fact 2), so a walk on a desktop
// where an agent is talking meets 410s:
//   · a walk reads pages of MADE_APP_LIMITS.WALK_PAGE, newest first, from the
//     head, and UPSERTS what each page holds — it never removes while walking;
//   · a 410 restarts it from the head, keeping every row it read, at most
//     WALK_RESTARTS times; a walk that gives up removes NOTHING and waits for
//     the next timer;
//   · REMOVALS come only from a walk that COMPLETED (the last page, or the
//     cap): the table then holds exactly the ROWS newest of what that walk
//     read (`replaceAll`), by `publishedAt ?? capturedAt ?? 0` (H6).
// The first walk starts when the catalog's first snapshot has landed (the
// root of a delegated session is resolved through its `threads`), and then
// every INDEX_MESH.META_RESNAPSHOT_MS on this class's OWN timer (C10: a
// catalog re-snapshot that moves nothing emits no `changed`). Between walks a
// `sessions` change re-reads the newest REREAD_PAGE apps REREAD_DELAY_MS
// later, at most once per REREAD_MIN_INTERVAL_MS (a session mutation fires on
// every message; RO-A4's library signal retires this floor), stopping at a
// presentation it already holds; a re-read only upserts.
//
// DS-L8: the table speaks for the library only once the FIRST walk completed
// (`ready`). Before it the door refuses (3e) and nothing is announced.
//
// A ROW is safe metadata built by PROJECTION from rosetta's entry, never by a
// spread: `publication.path`, `recovered_from` and `asset.url` are rosetta's
// and the contract refuses a row that carries one (MA §4.2, EL2). The agent is
// named through the catalog's public reader (`idForKind`, R23b: no agent-id
// literal). The title is clipped to ARTIFACT_LIMITS.TITLE_CHARS (H7) and falls
// back to the file name; a row whose identities do not parse is dropped and
// said once. Keep and hide are the person's intent (RULINGS L8, slice 3h):
// they never ride a row, whatever a stamp says. The PREVIEW is the origin's
// own (3b's `MadeAppService`, through `AppIntentStamps`).
//
// THE STANDING. Every frame this table's pump sends (the open answer's either
// arm, each snapshot page, each delta, the digest heartbeat) declares the
// owner's standing: `libraryReady` (rosetta's last `canonical_ready`) and
// `previewsBase` (the previews serve's root URL, from an injected getter). A
// standing that moved with no row moved goes to every subscriber AT ONCE as a
// delta with no rows, at the revision that subscriber holds (a no-op every
// reader applies; the table's revision moves only with a row).
//
// EL7: a log line names what happened, never a title, a path or the origin.

/** What the catalog's `changed` event carries (`IndexCatalog`'s `#changed`). */
export interface IndexCatalogChange {
  tables: readonly IndexCatalogTable[];
}

/** The catalog's public surface this class reads; a real `IndexCatalog` is one (the test's compile witness). */
export interface IndexAppsCatalog {
  /** this boot's first snapshot has landed */
  readonly ready: boolean;
  /** the delegated threads: a child session's root */
  readonly threads: Pick<CatalogTable<IndexThread>, "get">;
  /** the device the rows carry, read at every stamp */
  device(): string;
  on(event: "changed", listener: (change: IndexCatalogChange) => void): unknown;
  off(event: "changed", listener: (change: IndexCatalogChange) => void): unknown;
}

/** The library reader (`IndexService.artifacts`, injected by the daemon, 3e). It throws `RpcCallError`s: a
 * PRECONDITION_FAILED whose `details.reason` is `cursor-expired` is a 410. */
export type IndexAppsReader = (ask: IndexArtifactsRead) => Promise<IndexArtifactPageResponse>;

/** The plan's §1.5 seam (3b's `MadeAppService` implements it): what the origin stamps on an app's row besides the
 * library's facts. After RULINGS L8 only `preview` is read from it; `kept` and `hidden` are intent (3h) and are never
 * stamped on a row, whatever this answers. */
export interface AppIntentStamps {
  of(appId: string): AppIntentStamp | undefined;
}

/** One app's stamp as the origin answers it (`AppIntentStamps.of`). */
export interface AppIntentStamp {
  kept?: true | undefined;
  hidden?: true | undefined;
  preview?: MadeAppPreview | undefined;
}

/** The owner's standing as every frame declares it (`IndexAppsCatalog*`'s OWNER_STANDING). Absent: unknown. */
export interface IndexAppsStanding {
  libraryReady?: boolean;
  previewsBase?: string;
}

export interface IndexAppsOptions {
  /** the history catalog (its first snapshot gates the first walk; its `threads` resolve a child's root; its
   * `sessions` changes schedule a re-read; its `device()` stamps the rows) */
  catalog: IndexAppsCatalog;
  /** the library reader (`IndexService.artifacts`) */
  artifacts: IndexAppsReader;
  /** the origin's stamps (3b); absent: no row carries a preview */
  stamps?: AppIntentStamps;
  /** the previews serve's root URL as its own listener reported it (3b); absent or undefined: none up */
  previewsBase?: () => string | undefined;
  /** AC-3 test seam: the agent catalog (default: THE table) — rosetta's kind → the catalog id */
  agentCatalog?: readonly AgentCatalogEntry[];
  /** the table's epoch (default: a fresh id per boot) */
  epoch?: string;
  /** test seams for the cadences and bounds (defaults: INDEX_MESH.META_RESNAPSHOT_MS and MADE_APP_LIMITS) */
  resnapshotMs?: number;
  walkPage?: number;
  walkRestarts?: number;
  rowCap?: number;
  rereadPage?: number;
  rereadDelayMs?: number;
  rereadMinIntervalMs?: number;
  journalDepth?: number;
  pageBytes?: number;
  now?: () => number;
  logger?: Logger;
}

export class IndexApps extends EventEmitter {
  readonly epoch: string;
  readonly table: CatalogTable<IndexCatalogApp>;
  readonly #opts: IndexAppsOptions;

  constructor(opts: IndexAppsOptions) {
    super();
    this.#opts = opts;
    this.epoch = opts.epoch ?? `apps-${randomUUID()}`;
    this.table = new CatalogTable<IndexCatalogApp>({
      epoch: this.epoch,
      keyOf: (row) => row.appId,
      ...(opts.journalDepth !== undefined ? { journalDepth: opts.journalDepth } : {}),
      ...(opts.pageBytes !== undefined ? { pageBytes: opts.pageBytes } : {}),
    });
  }

  /** The first walk of this boot completed: the table speaks for the library (DS-L8). */
  get ready(): boolean {
    // MA-3a RED — the skeleton never lands a walk
    return false;
  }

  /** rosetta's last `canonical_ready` (undefined: no page read yet). */
  get libraryReady(): boolean | undefined {
    // MA-3a RED — the skeleton has heard nothing
    return undefined;
  }

  /** The owner's standing as the next frame will declare it. */
  standing(): IndexAppsStanding {
    // MA-3a RED — the skeleton declares nothing
    return {};
  }

  /** One subscriber of the table — `index.apps.catalog.subscribe`'s body (3e): the rows protocol's open, then its
   * frames (catalog-rows.ts), every one of them declaring the owner's standing. */
  pump(opts: Omit<RowsPumpOptions<IndexCatalogApp>, "table">): RowsPump {
    // MA-3a RED — the skeleton answers an empty snapshot that declares no standing and sends nothing
    void opts;
    return {
      open: { snapshot: { epoch: this.epoch, revision: 0, rows: [], more: false } },
      start: () => undefined,
      dispose: () => undefined,
    };
  }

  /** The origin's stamps moved for these apps (3b): their rows are stamped again, as one frame. */
  restampIntents(appIds: readonly string[]): void {
    // MA-3a RED — the skeleton stamps nothing
    void appIds;
  }

  /** The injected standing (the previews serve's URL) may have moved: when it did, every subscriber hears it at once,
   * as a delta with no rows. */
  standingChanged(): void {
    // MA-3a RED — the skeleton says nothing
  }

  start(): void {
    // MA-3a RED — the skeleton never walks
    void this.#opts;
  }

  dispose(): void {
    this.removeAllListeners();
  }
}
