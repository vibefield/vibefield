import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  AGENT_CATALOG,
  type AgentCatalogEntry,
  type AgentCatalogReaders,
  AgentKind,
  ARTIFACT_LIMITS,
  artifactRootUrlClaim,
  Blake3Hex,
  createAgentCatalogReaders,
  INDEX_MESH,
  type IndexArtifactEntryRow,
  type IndexArtifactPageResponse,
  IndexCatalogApp,
  type IndexCatalogTable,
  type IndexThread,
  MADE_APP_LIMITS,
  MadeAppAvailability,
  MadeAppHostedUrl,
  MadeAppPreview,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { IndexArtifactsRead } from "./agent-index";
import { CatalogTable, createRowsPump, type RowsPump, type RowsPumpOptions } from "./catalog-rows";
import { RpcCallError } from "./native-link";

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
//     read (`replaceAll`), by `publishedAt ?? capturedAt ?? 0` (H6). A page
//     with no entries that still points on is no completion: that walk lands
//     nothing (`walk-stalled`).
// The first walk starts when the catalog's first snapshot has landed (the
// root of a delegated session is resolved through its `threads`), and then
// every INDEX_MESH.META_RESNAPSHOT_MS on this class's OWN timer (C10: a
// catalog re-snapshot that moves nothing emits no `changed`). Between walks a
// `sessions` change re-reads the newest REREAD_PAGE apps REREAD_DELAY_MS
// later, at most once per REREAD_MIN_INTERVAL_MS (a session mutation fires on
// every message; RO-A4's library signal retires this floor), stopping at a
// presentation it already holds; a re-read only upserts. A `sessions` change
// while the first walk reads owes a re-read once it lands (its head page may
// predate the change).
//   · ONE read at a time. A re-read due while a walk reads waits for it, and
//     a walk due while a re-read reads waits for that: a walk's landing judges
//     what is gone from what IT read, so no row may arrive beside it unread.
//   · THE CAP never removes outside a landing (L13: removals come only from a
//     completed walk). A frame that is not a landing upserts every app the
//     table holds, and admits a NEW app only while the table holds fewer than
//     ROWS, the newest first; the rest wait for the next landing, and a
//     re-read that held back one newer than the oldest row owes a walk, which
//     runs when it settles. The table never holds more than ROWS.
//   · A first walk that did not land (rosetta refused it, it gave up, or it
//     stalled) is tried again at the re-read floor, doubling with each walk
//     that does not land, up to the cadence: until one lands the door has
//     nothing to say, and `refusal` says why in the refusal's own words.
//   · What a row takes from THIS desktop is read when its frame is made, never
//     when its page was read: the device id and the root (every held row, every
//     frame; a `threads` change re-roots the held rows as one frame, since a
//     child's thread can reach the catalog after its app was read), and the
//     origin's preview (every row the frame read), so a restamp that lands
//     while a walk reads survives that walk's landing.
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
  /** MA-3f (RO-35): rosetta's `artifacts_changed` on `/ws/meta`, the library itself moving */
  on(event: "library-changed", listener: () => void): unknown;
  off(event: "changed", listener: (change: IndexCatalogChange) => void): unknown;
  off(event: "library-changed", listener: () => void): unknown;
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

/** The last library read that did not complete, in the words its log line says (never the ask, EL7): which read
 * (`walk-gave-up`: more 410s than WALK_RESTARTS; `walk-stalled`: an empty page that pointed on), and the refusal's
 * `kind` with its `state` or `reason` when the reader refused it. */
export type IndexAppsRefusal = {
  read: "walk" | "walk-gave-up" | "walk-stalled" | "reread";
  kind?: string;
  state?: string;
  reason?: string;
};

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

/** rosetta's 410 as the reader says it: the library moved under the cursor. */
function isCursorExpired(error: unknown): boolean {
  return (
    error instanceof RpcCallError &&
    error.kind === "PRECONDITION_FAILED" &&
    wordOf(error.details, "reason") === "cursor-expired"
  );
}

/** One string member of a refusal's details, for a log line (never the message). */
function wordOf(details: unknown, key: string): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const word = (details as Record<string, unknown>)[key];
  return typeof word === "string" ? word : undefined;
}

/** What a failed read says in a log line: the refusal's kind and its word, nothing of the ask (EL7). */
function failureOf(error: unknown): Omit<IndexAppsRefusal, "read"> {
  if (!(error instanceof RpcCallError)) return { kind: "error" };
  const state = wordOf(error.details, "state");
  const reason = wordOf(error.details, "reason");
  return {
    kind: error.kind,
    ...(state !== undefined ? { state } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

/** The table's order and the cap's (H6): rosetta's `published_at` is nullable, so an unpublished page ranks by when it
 * was captured. */
function sortKeyOf(row: IndexCatalogApp): number {
  return row.publishedAt ?? row.capturedAt ?? 0;
}

/** Newest first; a tie is broken by the key, so the cap cuts the same rows however they arrived. */
function newestFirst(a: IndexCatalogApp, b: IndexCatalogApp): number {
  return sortKeyOf(b) - sortKeyOf(a) || (a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0);
}

/** At most `chars` UTF-16 units, never half a surrogate pair. */
function clip(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** The preview a stamp offers, by projection, when the contract reads it (validate or strip, the lead's C16). */
function previewOf(stamp: AppIntentStamp | undefined): MadeAppPreview | undefined {
  const offered = stamp?.preview;
  if (offered === undefined || !MadeAppPreview.safeParse(offered).success) return undefined;
  return {
    id: offered.id,
    digest: offered.digest,
    pageDigest: offered.pageDigest,
    capturedAt: offered.capturedAt,
  };
}

export class IndexApps extends EventEmitter {
  readonly epoch: string;
  readonly table: CatalogTable<IndexCatalogApp>;
  readonly #opts: IndexAppsOptions;
  readonly #logger: Logger;
  readonly #agents: AgentCatalogReaders;
  readonly #now: () => number;
  readonly #resnapshotMs: number;
  readonly #walkPage: number;
  readonly #walkRestarts: number;
  readonly #rowCap: number;
  readonly #rereadPage: number;
  readonly #rereadDelayMs: number;
  readonly #rereadMinIntervalMs: number;
  #started = false;
  #disposed = false;
  /** the first walk of this boot completed */
  #ready = false;
  /** a first walk was asked for (the catalog's first snapshot); later ones are the timer's */
  #walkAsked = false;
  #libraryReady: boolean | undefined;
  #heardAt: number | null = null;
  /** the read in flight: one at a time */
  #busy: "walk" | "reread" | null = null;
  #walkOwed = false;
  #rereadOwed = false;
  #walkTimer: ReturnType<typeof setTimeout> | null = null;
  #rereadTimer: ReturnType<typeof setTimeout> | null = null;
  #lastRereadAt = Number.NEGATIVE_INFINITY;
  /** the standing as `changed` last announced it, encoded */
  #standingSaid: string;
  /** each live pump's "the standing may have moved" */
  readonly #followers = new Set<() => void>();
  /** `<what>` said once: a row this build cannot make, a previews base it cannot vouch for */
  readonly #saidOnce = new Set<string>();
  /** a read failed and was said at warn; the next failures are debug until a read completes */
  #failing = false;
  /** the last read that did not complete, until one does */
  #refusal: IndexAppsRefusal | null = null;
  /** the walks in a row that did not land before the first one did (the first walk's retry backs off by them) */
  #unlanded = 0;

  constructor(opts: IndexAppsOptions) {
    super();
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "index_apps" });
    this.#agents = createAgentCatalogReaders(opts.agentCatalog ?? AGENT_CATALOG);
    this.#now = opts.now ?? Date.now;
    this.#resnapshotMs = opts.resnapshotMs ?? INDEX_MESH.META_RESNAPSHOT_MS;
    this.#walkPage = opts.walkPage ?? MADE_APP_LIMITS.WALK_PAGE;
    this.#walkRestarts = opts.walkRestarts ?? MADE_APP_LIMITS.WALK_RESTARTS;
    this.#rowCap = Math.max(1, opts.rowCap ?? MADE_APP_LIMITS.ROWS);
    this.#rereadPage = opts.rereadPage ?? MADE_APP_LIMITS.REREAD_PAGE;
    this.#rereadDelayMs = opts.rereadDelayMs ?? MADE_APP_LIMITS.REREAD_DELAY_MS;
    this.#rereadMinIntervalMs = opts.rereadMinIntervalMs ?? MADE_APP_LIMITS.REREAD_MIN_INTERVAL_MS;
    this.epoch = opts.epoch ?? `apps-${randomUUID()}`;
    this.table = new CatalogTable<IndexCatalogApp>({
      epoch: this.epoch,
      keyOf: (row) => row.appId,
      ...(opts.journalDepth !== undefined ? { journalDepth: opts.journalDepth } : {}),
      ...(opts.pageBytes !== undefined ? { pageBytes: opts.pageBytes } : {}),
    });
    this.#standingSaid = JSON.stringify(this.standing());
  }

  /** The first walk of this boot completed: the table speaks for the library (DS-L8). */
  get ready(): boolean {
    return this.#ready;
  }

  /** rosetta's last `canonical_ready` (undefined: no page read yet). */
  get libraryReady(): boolean | undefined {
    return this.#libraryReady;
  }

  /** epoch ms of the last page the library answered (null: none yet, this boot). */
  get heardAt(): number | null {
    return this.#heardAt;
  }

  /** The last library read that did not complete, until a read completes (null: none). While the table is not ready
   * this is why, in the refusal's own words (3e's door can say it). */
  get refusal(): IndexAppsRefusal | null {
    return this.#refusal === null ? null : { ...this.#refusal };
  }

  /** The owner's standing as the next frame will declare it. A fact that is unknown is absent, never `undefined`. */
  standing(): IndexAppsStanding {
    const previewsBase = this.#previewsBase();
    return {
      ...(this.#libraryReady !== undefined ? { libraryReady: this.#libraryReady } : {}),
      ...(previewsBase !== undefined ? { previewsBase } : {}),
    };
  }

  /** One subscriber of the table — `index.apps.catalog.subscribe`'s body (3e): the rows protocol's open, then its
   * frames (catalog-rows.ts), every one of them declaring the owner's standing. */
  pump(opts: Omit<RowsPumpOptions<IndexCatalogApp>, "table">): RowsPump {
    const emit = opts.emit;
    /** the revision this reader holds once every frame sent so far lands */
    let held = this.table.revision;
    /** the standing this reader was last told, encoded */
    let told = "";
    let started = false;
    let disposed = false;
    const declare = (frame: object): object => {
      const standing = this.standing();
      told = JSON.stringify(standing);
      return { ...frame, ...standing };
    };
    const inner = createRowsPump<IndexCatalogApp>({
      ...opts,
      table: this.table,
      emit: (payload, kind) => {
        const revision = (payload as { revision?: unknown }).revision;
        if (typeof revision === "number") held = revision;
        emit(declare(payload as object), kind);
      },
    });
    let open: RowsPump["open"];
    if ("resumed" in inner.open) {
      held = inner.open.resumed.revision;
      open = declare(inner.open) as RowsPump["open"];
    } else {
      const page = (inner.open.snapshot ?? {}) as { revision?: unknown };
      if (typeof page.revision === "number") held = page.revision;
      open = { snapshot: declare(page) };
    }
    /** a standing that moved with no row: a delta with no rows, at once, at the revision the reader holds */
    const tell = (): void => {
      if (!started || disposed) return;
      const standing = this.standing();
      const said = JSON.stringify(standing);
      if (said === told) return;
      told = said;
      emit(
        {
          epoch: this.table.epoch,
          since: held,
          revision: held,
          upserts: [],
          removed: [],
          ...standing,
        },
        "delta",
      );
    };
    this.#followers.add(tell);
    return {
      open,
      start: () => {
        if (started || disposed) return;
        started = true;
        inner.start();
        tell();
      },
      dispose: () => {
        disposed = true;
        this.#followers.delete(tell);
        inner.dispose();
      },
    };
  }

  /** The origin's stamps moved for these apps (3b): their rows are stamped again, as one frame. An app the table does
   * not hold yet takes its stamp when its page is committed. */
  restampIntents(appIds: readonly string[]): void {
    if (this.#disposed) return;
    const rows: IndexCatalogApp[] = [];
    for (const appId of appIds) {
      const held = this.table.get(appId);
      if (held !== undefined) rows.push(held);
    }
    if (rows.length > 0) this.#commit(rows, false);
  }

  /** The injected standing (the previews serve's URL) may have moved: when it did, every subscriber hears it at once,
   * as a delta with no rows. */
  standingChanged(): void {
    if (this.#disposed) return;
    this.#standingCheck();
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#opts.catalog.on("changed", this.#onCatalog);
    this.#opts.catalog.on("library-changed", this.#onLibrary);
    if (this.#opts.catalog.ready) this.#walkNow();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#opts.catalog.off("changed", this.#onCatalog);
    this.#opts.catalog.off("library-changed", this.#onLibrary);
    if (this.#walkTimer !== null) clearTimeout(this.#walkTimer);
    if (this.#rereadTimer !== null) clearTimeout(this.#rereadTimer);
    this.#walkTimer = null;
    this.#rereadTimer = null;
    this.#followers.clear();
    this.removeAllListeners();
  }

  /** The catalog moved. Before the first walk landed, its first snapshot starts that walk, and a later `sessions`
   * change owes a re-read once it lands; after it, a `threads` change re-roots the held rows and a `sessions` change
   * re-reads the head. */
  readonly #onCatalog = (change: IndexCatalogChange): void => {
    if (this.#disposed) return;
    if (!this.#ready) {
      if (!this.#walkAsked) {
        if (this.#opts.catalog.ready) this.#walkNow();
      } else if (change.tables.includes("sessions")) {
        // the first walk may have read the head before this change: what it moved is read once the walk lands
        this.#rereadOwed = true;
      }
      return;
    }
    // a child's thread can reach the catalog after its app was read: every held row takes its root again (one frame)
    if (change.tables.includes("threads")) this.#commit([], false);
    if (change.tables.includes("sessions")) this.#scheduleReread();
  };

  /** MA-3f (RO-35) — rosetta says the library moved: what a `sessions` change owes, by the same delay and floor. */
  readonly #onLibrary = (): void => {
    if (this.#disposed) return;
    if (!this.#ready) {
      if (this.#walkAsked) this.#rereadOwed = true;
      return;
    }
    this.#scheduleReread();
  };

  // ── the reads ──

  #walkNow(): void {
    if (this.#disposed) return;
    this.#walkAsked = true;
    if (this.#walkTimer !== null) clearTimeout(this.#walkTimer);
    this.#walkTimer = null;
    if (this.#busy !== null) {
      this.#walkOwed = true;
      return;
    }
    this.#walkOwed = false;
    this.#busy = "walk";
    void this.#walk().finally(() => this.#settled("walk"));
  }

  /** A whole walk: pages from the head until the library ends or the cap is read, restarted on a 410. */
  async #walk(): Promise<void> {
    for (let restarts = 0; ; restarts += 1) {
      const read: IndexCatalogApp[] = [];
      let seen = 0;
      let cursor: string | undefined;
      try {
        for (;;) {
          const page = await this.#opts.artifacts({
            limit: this.#walkPage,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          if (this.#disposed) return;
          const rows = this.#rowsOf(page.entries);
          read.push(...rows);
          seen += page.entries.length;
          this.#commit(rows, false);
          this.#heard(page.canonical_ready);
          cursor = page.next_cursor ?? undefined;
          // the end of the library, or the cap read: the walk completed
          if (cursor === undefined || seen >= this.#rowCap) break;
          // a page that holds nothing yet points on moves the walk nowhere: it did not reach the end, so it lands
          // nothing (its landing would remove every app it never reached)
          if (page.entries.length === 0) {
            this.#failed("walk-stalled");
            return;
          }
        }
      } catch (error) {
        if (this.#disposed) return;
        const expired = isCursorExpired(error);
        if (expired && restarts < this.#walkRestarts) continue;
        this.#failed(expired ? "walk-gave-up" : "walk", error);
        return;
      }
      this.#land(read);
      return;
    }
  }

  /** The walk completed: the table is what it read (the ROWS newest), and the first one makes the table speak. */
  #land(read: readonly IndexCatalogApp[]): void {
    const first = !this.#ready;
    this.#ready = true;
    this.#failing = false;
    this.#refusal = null;
    this.#unlanded = 0;
    const { moved } = this.#commit(read, true);
    if (!first) return;
    this.#logger.info("fieldd.index_apps.ready", "The apps table speaks for the library", {
      apps: this.table.size,
      ...(this.#libraryReady !== undefined ? { libraryReady: this.#libraryReady } : {}),
    });
    if (!moved) this.emit("changed");
  }

  #scheduleReread(): void {
    if (this.#disposed || this.#rereadTimer !== null) return;
    const now = this.#now();
    const due = Math.max(now + this.#rereadDelayMs, this.#lastRereadAt + this.#rereadMinIntervalMs);
    this.#rereadTimer = setTimeout(() => {
      this.#rereadTimer = null;
      this.#rereadNow();
    }, due - now);
    this.#rereadTimer.unref?.();
  }

  #rereadNow(): void {
    if (this.#disposed || !this.#ready) return;
    if (this.#busy !== null) {
      this.#rereadOwed = true;
      return;
    }
    this.#busy = "reread";
    this.#lastRereadAt = this.#now();
    void this.#reread().finally(() => this.#settled("reread"));
  }

  /** The newest pages of REREAD_PAGE, until one holds a presentation the table already has (bounded by the cap). */
  async #reread(): Promise<void> {
    let seen = 0;
    let cursor: string | undefined;
    try {
      for (;;) {
        const page = await this.#opts.artifacts({
          limit: this.#rereadPage,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        if (this.#disposed) return;
        const rows = this.#rowsOf(page.entries);
        const met = rows.some(
          (row) => this.table.get(row.appId)?.presentationId === row.presentationId,
        );
        seen += page.entries.length;
        // a new app held back at the cap that the ROWS newest would hold: a walk lands it, once this settles
        if (this.#commit(rows, false).owed) this.#walkOwed = true;
        this.#heard(page.canonical_ready);
        cursor = page.next_cursor ?? undefined;
        if (met || cursor === undefined || page.entries.length === 0 || seen >= this.#rowCap) break;
      }
      this.#failing = false;
      this.#refusal = null;
    } catch (error) {
      if (this.#disposed) return;
      // a 410 here is the library moving, which a `sessions` change will say again: the next re-read reads it
      if (isCursorExpired(error)) {
        this.#logger.debug("fieldd.index_apps.reread_expired", "A re-read met a moved library", {});
        return;
      }
      this.#failed("reread", error);
    }
  }

  /** A read finished: what it held back runs now (an owed walk first, since it reads the head too), and a walk arms
   * the next one. */
  #settled(read: "walk" | "reread"): void {
    this.#busy = null;
    if (this.#disposed) return;
    if (read === "walk" && !this.#ready) this.#unlanded += 1;
    if (this.#walkOwed) {
      this.#walkNow();
      return;
    }
    if (read === "walk") this.#armWalk();
    if (this.#rereadOwed) {
      this.#rereadOwed = false;
      // before the first landing the walk's own retry starts after the change, and reads it
      if (this.#ready) this.#scheduleReread();
    }
  }

  /** The next walk: the cadence's; while no first walk has landed, the re-read floor, doubled for each walk in a row
   * that did not land, up to the cadence. 0 is never. */
  #armWalk(): void {
    let ms = this.#resnapshotMs;
    if (!this.#ready) {
      const backoff =
        this.#rereadMinIntervalMs * 2 ** Math.min(Math.max(this.#unlanded - 1, 0), 20);
      ms = ms > 0 ? Math.min(ms, backoff) : backoff;
    }
    if (ms <= 0) return;
    if (this.#walkTimer !== null) clearTimeout(this.#walkTimer);
    this.#walkTimer = setTimeout(() => {
      this.#walkTimer = null;
      this.#walkNow();
    }, ms);
    this.#walkTimer.unref?.();
  }

  #failed(read: IndexAppsRefusal["read"], error?: unknown): void {
    const fields: IndexAppsRefusal = { read, ...(error === undefined ? {} : failureOf(error)) };
    this.#refusal = fields;
    if (this.#failing) {
      this.#logger.debug(
        "fieldd.index_apps.read_failed",
        "The library read did not complete",
        fields,
      );
      return;
    }
    this.#failing = true;
    this.#logger.warn(
      "fieldd.index_apps.read_failed",
      "The library read did not complete; the apps table keeps what it holds",
      fields,
    );
  }

  /** A page answered: when it was heard, and rosetta's word on its own first ingestion. */
  #heard(canonicalReady: boolean): void {
    this.#heardAt = this.#now();
    if (this.#libraryReady === canonicalReady) return;
    this.#libraryReady = canonicalReady;
    this.#standingCheck();
  }

  // ── the table ──

  /** ONE frame. What a row takes from this desktop is read NOW: every held row takes the catalog's current device id
   * and root, and every row read takes those and the origin's preview as its stamp says it now (never as it said when
   * the page was read). `whole` (a completed walk's landing, the ONLY frame that removes, L13): the table becomes
   * exactly the ROWS newest of what the walk read. Otherwise the rows read are upserted: an app the table holds
   * always, a new one only while the table holds fewer than ROWS, the newest first. The rest wait for a landing, and
   * `owed` says one of them is newer than the oldest row (the ROWS newest would hold it). */
  #commit(read: readonly IndexCatalogApp[], whole: boolean): { moved: boolean; owed: boolean } {
    const device = this.#opts.catalog.device();
    const current = (row: IndexCatalogApp): IndexCatalogApp =>
      this.#rooted(row.device === device ? row : { ...row, device });
    const incoming = new Map<string, IndexCatalogApp>();
    for (const row of read) incoming.set(row.appId, current(this.#stamped(row)));
    let moved: boolean;
    let owed = false;
    if (whole) {
      let rows = [...incoming.values()];
      if (rows.length > this.#rowCap) rows = rows.sort(newestFirst).slice(0, this.#rowCap);
      moved = this.table.replaceAll(rows) !== null;
    } else {
      const upserts: IndexCatalogApp[] = [];
      /** the row the cap would cut first, once this frame lands */
      let oldest: IndexCatalogApp | undefined;
      const hold = (row: IndexCatalogApp): void => {
        if (oldest === undefined || newestFirst(row, oldest) > 0) oldest = row;
      };
      for (const held of this.table.rows()) {
        const row = incoming.get(held.appId) ?? current(held);
        if (row !== held) upserts.push(row);
        hold(row);
      }
      const added = [...incoming.values()]
        .filter((row) => !this.table.has(row.appId))
        .sort(newestFirst);
      const room = Math.max(0, this.#rowCap - this.table.size);
      for (const row of added.slice(0, room)) {
        upserts.push(row);
        hold(row);
      }
      const waiting = added[room];
      owed = waiting !== undefined && oldest !== undefined && newestFirst(waiting, oldest) < 0;
      moved = upserts.length > 0 && this.table.apply({ upserts }) !== null;
    }
    if (moved && this.#ready) this.emit("changed");
    return { moved, owed };
  }

  /** A delegated session's root as the catalog's threads say it now (absent: the session is its own root). */
  #rootOf(sessionId: string): string | undefined {
    const thread = this.#opts.catalog.threads.get(sessionId);
    return thread !== undefined && thread.rootSessionId !== sessionId
      ? thread.rootSessionId
      : undefined;
  }

  /** The row with its root as the threads say it now: the same row when that has not moved, otherwise the row again
   * with `rootSessionId` in its own place (after `sessionId`), so its JSON is the one a fresh read would make. */
  #rooted(row: IndexCatalogApp): IndexCatalogApp {
    const root = this.#rootOf(row.sessionId);
    if (root === row.rootSessionId) return row;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "rootSessionId") continue;
      next[key] = value;
      if (key === "sessionId" && root !== undefined) next.rootSessionId = root;
    }
    return next as IndexCatalogApp;
  }

  #rowsOf(entries: readonly IndexArtifactEntryRow[]): IndexCatalogApp[] {
    const device = this.#opts.catalog.device();
    const rows: IndexCatalogApp[] = [];
    for (const entry of entries) {
      const row = this.#rowOf(entry, device);
      if (row !== undefined) rows.push(row);
    }
    return rows;
  }

  /** One entry's row, built member by member from what the contract declares (never a spread of rosetta's entry).
   * MA-3f: rosetta's `description` and `dropped_files` are read onto the row, so "page only" is true from the first
   * served page. The description keeps the door's rule (an empty one, or one longer than
   * MADE_APP_LIMITS.DESCRIPTION_CHARS, costs the field) and is checked before the row is built, as `nativeId` is: the
   * row is returned as built, not as parsed. */
  #rowOf(entry: IndexArtifactEntryRow, device: string): IndexCatalogApp | undefined {
    const at = entry.publication;
    const kind = AgentKind.safeParse(entry.agent).success ? entry.agent : undefined;
    const provider = kind === undefined ? undefined : this.#agents.idForKind(kind);
    const rootSessionId = this.#rootOf(at.session_id);
    const projectId =
      typeof entry.project_id === "string" && entry.project_id !== ""
        ? entry.project_id
        : undefined;
    const asset = entry.asset ?? undefined;
    const digest =
      asset !== undefined && Blake3Hex.safeParse(asset.digest).success ? asset.digest : undefined;
    const hostedUrl =
      typeof at.url === "string" && MadeAppHostedUrl.safeParse(at.url).success ? at.url : undefined;
    const nativeId =
      typeof at.native_id === "string" &&
      at.native_id !== "" &&
      at.native_id.length <= MADE_APP_LIMITS.NATIVE_ID_CHARS
        ? at.native_id
        : undefined;
    const description =
      typeof at.description === "string" &&
      at.description !== "" &&
      at.description.length <= MADE_APP_LIMITS.DESCRIPTION_CHARS
        ? at.description
        : undefined;
    const droppedFiles = typeof at.dropped_files === "number" ? at.dropped_files : undefined;
    const row: IndexCatalogApp = {
      device,
      appId: at.artifact_id,
      presentationId: at.id,
      title: clip(at.title.trim() === "" ? at.filename : at.title, ARTIFACT_LIMITS.TITLE_CHARS),
      filename: at.filename,
      ...(kind !== undefined ? { kind } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      sessionId: at.session_id,
      ...(rootSessionId !== undefined ? { rootSessionId } : {}),
      timelineId: at.timeline_id,
      versions: entry.presentations,
      ...(typeof at.published_at === "number" ? { publishedAt: at.published_at } : {}),
      ...(typeof entry.captured_at === "number" ? { capturedAt: entry.captured_at } : {}),
      availability: MadeAppAvailability.parse(entry.availability),
      ...(asset !== undefined ? { byteLen: asset.byte_len } : {}),
      ...(digest !== undefined ? { digest } : {}),
      ...(hostedUrl !== undefined ? { hostedUrl } : {}),
      ...(nativeId !== undefined ? { nativeId } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(droppedFiles !== undefined ? { droppedFiles } : {}),
    };
    const checked = IndexCatalogApp.safeParse(row);
    if (!checked.success) {
      this.#unreadable(checked.error);
      return undefined;
    }
    // the preview is stamped when the row's frame is made (`#commit`), never here
    return row;
  }

  /** The row with the origin's preview as its stamp says it now (and nothing else of the stamp: RULINGS L8). */
  #stamped(row: IndexCatalogApp): IndexCatalogApp {
    const { preview: _held, ...facts } = row;
    const preview = previewOf(this.#opts.stamps?.of(row.appId));
    return (preview !== undefined ? { ...facts, preview } : facts) as IndexCatalogApp;
  }

  /** A page this build cannot make a row of, said once per member (its name, never its value: EL7). */
  #unreadable(error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> }): void {
    const issue = error.issues[0];
    const member =
      issue === undefined || issue.path.length === 0 ? "?" : issue.path.map(String).join(".");
    if (this.#saidOnce.has(`row:${member}`)) return;
    this.#saidOnce.add(`row:${member}`);
    this.#logger.warn(
      "fieldd.index_apps.unreadable_row",
      "The library holds a page this build cannot make a row of; it is left out",
      { member },
    );
  }

  // ── the standing ──

  /** The previews serve's root as the getter answers it, when it is one (AH §6's rule); otherwise none, said once. */
  #previewsBase(): string | undefined {
    const offered = this.#opts.previewsBase?.();
    if (offered === undefined) return undefined;
    if (artifactRootUrlClaim(offered) !== null) return offered;
    if (!this.#saidOnce.has("previewsBase")) {
      this.#saidOnce.add("previewsBase");
      this.#logger.warn(
        "fieldd.index_apps.previews_base_refused",
        "The previews serve's URL is not a root https URL; no frame declares it",
        {},
      );
    }
    return undefined;
  }

  /** The standing may have moved: every live pump compares and tells its reader, and the door hears `changed`. */
  #standingCheck(): void {
    const said = JSON.stringify(this.standing());
    if (said === this.#standingSaid) return;
    this.#standingSaid = said;
    for (const tell of [...this.#followers]) tell();
    if (this.#ready) this.emit("changed");
  }
}
