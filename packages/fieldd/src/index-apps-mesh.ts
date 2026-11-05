import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  artifactRootUrlClaim,
  type CallerContext,
  type DeviceInfo,
  INDEX_MESH,
  type IndexApp,
  type IndexAppsParams,
  type IndexAppsResult,
  type IndexAppsSource,
  IndexCatalogApp,
  MADE_APP_OPEN,
  madeAppFoldKey,
  type PlaceRef,
  type ProjectKey,
  type RowsCursor,
  type RowsDeviceState,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { type CatalogTable, RowsCopy } from "./catalog-rows";
import { canonicalTailnetDnsName } from "./device-service";
import {
  compareKeys,
  decodeCursor,
  type MeshLink,
  type MeshRoster,
  pageOf,
  type SortKey,
} from "./index-mesh";
import { RpcCallError } from "./native-link";
import { readsProjects } from "./projects/project-doors";
import { tailnetRowLimit } from "./tailnet-rows";

// MA-3d (`draft/thinking-mini-apps.md` v0.2 §4, RULED 2026-11-05; the build plan's §3 "3d" as the lead ruled it,
// 2026-11-05 09:30Z) — the made apps across desktops, the AGGREGATOR half. The source half is index-apps.ts (3a:
// this desktop's rosetta library, walked into one `apps` rows table); this file is everything a daemon does with the
// OTHER self desktops' tables, and the fold a window or the phone pages:
//
//   · THE REPLICA. For every self peer the roster lists online, ONE standing `index.apps.catalog.subscribe` (the
//     table's own door, the plan's L1), applied into a RowsCopy and persisted atomically, 0600, at
//     `<dir>/<device>.json` (`dir` is LAYOUT.MESH_APPS_DIR under the user root; daemon.ts joins it, 3e). A peer
//     that sleeps KEEPS its rows (DS-L8). It rides PeerLink directly, as IndexMesh does (index-mesh.ts' header):
//     frames that beat the open answer are buffered, and a replay asks from the copy's CURRENT cursor.
//   · A REFUSAL IS PER TABLE. An older peer has no apps door: its refusal (NOT_FOUND, method-not-found, any
//     non-retryable answer) marks ONLY that peer's apps unsupported, never the peer (the maps' fact 1, H5). Its
//     projects and sessions are IndexMesh's and stay live. It is not asked again until the roster says it returned
//     or names another build of it (`bootId`, `fielddVersion`): an update in place keeps the tailnet node online.
//   · THE STANDING. Every frame the owner sends declares `libraryReady?` and `previewsBase?` (contracts'
//     OWNER_STANDING); the newest frame's pair stands, and a fact a frame lacks is unknown. `sources()` answers it
//     beside each desktop's state, a peer's `previewsBase` only once it passes `artifactRootUrlClaim` with its host
//     equal to that peer's MagicDNS name as the roster authenticates it — else stripped, never rewritten (C16).
//   · THE FOLD (MA-D4). One row per `madeAppFoldKey` (contracts' one composer; never re-spelled here), the newest
//     presentation (`publishedAt ?? capturedAt ?? 0`) serving it, `devices` naming every holder, the serving one
//     first. The merged intent (an injected reader; empty until 3h) drops a hidden app unless `includeHidden`. `q`,
//     `devices`, `projectKey` and `kept` narrow; keyset pages; a tailnet caller's page is cut at
//     INDEX_TAILNET_LIMITS.MAX_ROWS and says `clipped`. The project joins at THIS door through an injected
//     `joinProject` (3e wires ProjectDoors), never from a row (PJ-4), and never for a peer daemon (DS-L4), whose
//     `projectKey` is refused with a word rather than answered a blank.
//   · ITS OWN PINGS. `changes()` is the shelf's `index.apps.subscribe` (rows always empty). It is never wired to
//     IndexMesh's `change`, so an app's move never regroups the projects (the fieldd map's Q13).
//
// DS-L2: a replica row is served as the device it was subscribed from, whatever it claims. EL2: a row is metadata,
// never a path (contracts refuse one) and never bytes.

/** This desktop's own apps (index-apps.ts' `IndexApps`, 3a), read through its public face alone. */
export interface AppsLocalSource {
  /** the `apps` rows table, keyed by `appId` */
  readonly table: CatalogTable<IndexCatalogApp>;
  /** the first walk landed (DS-L8: no answer before it) */
  readonly ready: boolean;
  /** this desktop's standing as its own frames declare it (`IndexApps.standing()`): rosetta's last
   * `canonical_ready`, and the previews serve's root URL as its own listener reported it (3b). Absent: unknown. */
  standing(): { libraryReady?: boolean; previewsBase?: string };
  /** when the library was last read (epoch ms), for the source's `asOf` */
  readonly heardAt?: number | null | undefined;
  /** `ready` or the standing moved */
  on(event: "changed", listener: () => void): unknown;
  off(event: "changed", listener: () => void): unknown;
}

/** The person's merged keep-and-hide intent, by fold key (the lead's ruling on L8; slice 3h). Until 3h it is
 * empty: no app is kept or hidden. */
export interface MadeAppIntentReader {
  of(foldKey: string): { kept?: true; hidden?: true } | undefined;
  /** the merged intent moved; the answer is how to stop listening */
  onChanged?(listener: () => void): () => void;
}

/** What `joinProject` answers for an app's root session on its desktop (PJ-4, the grouping's key). */
export interface AppProjectJoin {
  projectKey: ProjectKey;
  place?: PlaceRef;
  ink?: number;
}

export interface AppsMeshOptions {
  local: AppsLocalSource;
  roster: MeshRoster;
  link: MeshLink;
  /** where the replicas live (LAYOUT.MESH_APPS_DIR under the user root) */
  dir: string;
  /** the project an app's ROOT session sits in on its desktop (3e: ProjectDoors over the session's cwd) */
  joinProject: (device: string, rootSessionId: string) => AppProjectJoin | undefined;
  /** the merged intent (3h); absent: none */
  intents?: MadeAppIntentReader;
  /** whether a desktop can export a page (RO-A1). Absent: no desktop can, which rosetta 0.1.3 says */
  exportReady?: (device: string) => boolean;
  logger?: Logger;
  now?: () => number;
  /** test seams for the cadences (defaults: INDEX_MESH) */
  staleAfterMs?: number;
  persistIntervalMs?: number;
  replicaMinIntervalMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  changesMinIntervalMs?: number;
}

/** The pings' open answer and lifetime, in ProductAPI's `SubscriptionInstall` shape (IndexMesh.changes'). */
export interface AppsChanges {
  open: unknown;
  start: () => void;
  dispose: () => void;
}

/** `index.apps.catalog.subscribe` — the `apps` table's own peer door (L1), self peers only. */
const APPS_CATALOG_DOOR = "index.apps.catalog.subscribe";

const FILE_FORMAT = 1;
/** A kept replica's name, and the temporary one a write goes through (`<file>.<pid>.tmp`). */
const KEPT_FILE = /^(.+)\.json$/;
const KEPT_TMP = /^.+\.json\.\d+\.tmp$/;

/** An owner's standing as its newest frame declared it (contracts' OWNER_STANDING). `previewsBase` is held only once
 * it passes `artifactRootUrlClaim`; its host is bound to the peer's authenticated name at every read, never here. */
interface Standing {
  libraryReady?: boolean;
  previewsBase?: string;
}

/** A peer's build as the roster names it (its published slice): another value is another fieldd, worth asking. */
interface PeerBuild {
  bootId: string | null;
  fielddVersion: string | null;
}

const sameBuild = (a: PeerBuild, b: PeerBuild): boolean =>
  a.bootId === b.bootId && a.fielddVersion === b.fielddVersion;

interface Peer {
  device: string;
  copy: RowsCopy<IndexCatalogApp>;
  standing: Standing;
  sub: { unsubscribe: () => void } | null;
  /** bumped per attach/detach: a superseded subscription's events are ignored */
  generation: number;
  attaching: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  retryMs: number;
  /** every attach (and every replay) asks for a snapshot until one LANDS (IndexMesh's DS-6b rule) */
  forceReset: boolean;
  persist: ReturnType<typeof setTimeout> | null;
  /** the `heardAt` its kept file holds (null: none written or read this boot) */
  written: number | null;
  /** the last frame from this peer (epoch ms) */
  heardAt: number | null;
  /** DS-L9 — the roster says another contracts major or a link it cannot speak: the roster's one truth, read afresh
   * at every roster change */
  rosterIncompatible: boolean;
  /** its apps door was refused as another build or principal — this TABLE's state alone (H5) — latched with the
   * build the roster named when it was asked. Not asked again until the roster says the peer came back, or names
   * another build of it: a fieldd updated in place restarts while its tailnet node stays online. */
  refused: PeerBuild | null;
  /** the build the roster names for it, as the last reconcile read it */
  build: PeerBuild;
  inRoster: boolean;
  online: boolean;
  name: string | undefined;
}

/** Whether a peer's apps are not asked: the roster says so, or its apps door refused this build. */
const incompatibleOf = (peer: Peer): boolean => peer.rosterIncompatible || peer.refused !== null;

/** One holder of a fold: its row, stamped with the device it was read from (DS-L2), and its sort time. */
interface Member {
  device: string;
  row: IndexCatalogApp;
  at: number;
}

/** One app across desktops (MA-D4): its key, the serving row, and what the door says beside it. */
interface Fold {
  foldKey: string;
  /** the newest presentation among the desktops the page reads */
  serving: IndexCatalogApp;
  at: number;
  /** the serving desktop first, then every other holder in scope, sorted */
  devices: string[];
  /** rosetta's `presentations`, summed over every holder in scope */
  versions: number;
}

interface Change {
  scope: "local" | "mesh";
  device?: string;
}

/** The order's time: `publishedAt ?? capturedAt ?? 0` (H6). */
const sortAt = (row: IndexCatalogApp): number => row.publishedAt ?? row.capturedAt ?? 0;
const foldSortKey = (fold: Fold): SortKey => [fold.at, fold.serving.device, fold.serving.appId];

const parseApp = (raw: unknown): IndexCatalogApp | undefined => {
  const parsed = IndexCatalogApp.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};

/** The key of a row the gate cannot read, so the replica's digest still counts it (DS-6b). */
const rawAppKey = (raw: unknown): string | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const key = (raw as Record<string, unknown>)["appId"];
  return typeof key === "string" && key.length > 0 ? key : undefined;
};

/** A base this build can read: `artifactRootUrlClaim`'s half that does not depend on the origin. */
const readableBase = (value: unknown): string | undefined =>
  typeof value === "string" && artifactRootUrlClaim(value) !== null ? value : undefined;

/** The standing a frame declares, or undefined when the payload is no rows frame at all (an unreadable frame never
 * moves the standing). The open answer carries it beside `resumed` or inside its snapshot page; a later page or
 * delta carries it at its top. A fact the frame lacks, or one this build cannot read, is unknown. */
function standingOf(payload: unknown): Standing | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  let inner: unknown;
  if ("resumed" in record) {
    if (typeof record["resumed"] !== "object" || record["resumed"] === null) return undefined;
    inner = record;
  } else {
    inner =
      "snapshot" in record ? record["snapshot"] : "delta" in record ? record["delta"] : record;
    if (typeof inner !== "object" || inner === null) return undefined;
    if (typeof (inner as Record<string, unknown>)["epoch"] !== "string") return undefined;
  }
  const facts = inner as Record<string, unknown>;
  const libraryReady = facts["libraryReady"];
  const previewsBase = readableBase(facts["previewsBase"]);
  return {
    ...(typeof libraryReady === "boolean" ? { libraryReady } : {}),
    ...(previewsBase !== undefined ? { previewsBase } : {}),
  };
}

const sameStanding = (a: Standing, b: Standing): boolean =>
  a.libraryReady === b.libraryReady && a.previewsBase === b.previewsBase;

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? INDEX_MESH.PAGE_DEFAULT_LIMIT, 1), INDEX_MESH.PAGE_MAX_LIMIT);
}

export class AppsMesh extends EventEmitter {
  readonly #opts: AppsMeshOptions;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #staleAfterMs: number;
  readonly #persistIntervalMs: number;
  readonly #replicaMinIntervalMs: number;
  readonly #retryMinMs: number;
  readonly #retryMaxMs: number;
  readonly #changesMinIntervalMs: number;
  readonly #exportReady: (device: string) => boolean;
  readonly #peers = new Map<string, Peer>();
  #started = false;
  #disposed = false;
  #standingTimer: ReturnType<typeof setInterval> | null = null;
  #lastStandings = "";
  /** bumped on any change the fold reads */
  #version = 0;
  /** the sorted fold per {scope, who may serve}, for one version */
  #folds = new Map<string, { version: number; rows: Fold[] }>();
  /** the pings' chains: one epoch per daemon and scope, a revision per change */
  readonly #changesEpoch = randomUUID();
  #changesRevision = { local: 0, mesh: 0 };
  #off: Array<() => void> = [];
  readonly #saidOnce = new Set<string>();

  constructor(opts: AppsMeshOptions) {
    super();
    this.setMaxListeners(0); // one listener per change subscriber
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "index_apps_mesh" });
    this.#now = opts.now ?? Date.now;
    this.#staleAfterMs = opts.staleAfterMs ?? INDEX_MESH.STALE_AFTER_MS;
    this.#persistIntervalMs = opts.persistIntervalMs ?? INDEX_MESH.PERSIST_INTERVAL_MS;
    this.#replicaMinIntervalMs = opts.replicaMinIntervalMs ?? INDEX_MESH.REPLICA_MIN_INTERVAL_MS;
    this.#retryMinMs = opts.retryMinMs ?? INDEX_MESH.REPLICA_RETRY_MIN_MS;
    this.#retryMaxMs = opts.retryMaxMs ?? INDEX_MESH.REPLICA_RETRY_MAX_MS;
    this.#changesMinIntervalMs = opts.changesMinIntervalMs ?? INDEX_MESH.CHANGES_MIN_INTERVAL_MS;
    // rosetta 0.1.3 has no export door (RO-A1): until 3e/3f say otherwise, no desktop exports
    this.#exportReady = opts.exportReady ?? (() => false);
  }

  /** Load the kept replicas, follow the roster and this desktop's table, and attach every online self peer. */
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#loadPersisted();
    const local = this.#opts.local;
    const offTable = local.table.onDelta(() =>
      this.#changed("local", this.#opts.roster.currentDeviceId()),
    );
    // `ready` or this desktop's standing moved: a local page re-reads (and so does a mesh one)
    const onLocal = () => this.#changed("local");
    local.on("changed", onLocal);
    this.#off = [offTable, () => local.off("changed", onLocal)];
    // the merged intent moves every scope's fold (3h); until then the reader is absent or empty
    const offIntents = this.#opts.intents?.onChanged?.(() => {
      if (!this.#disposed) this.#changed("local");
    });
    if (offIntents !== undefined) this.#off.push(offIntents);
    this.#opts.roster.on("changed", this.#onRoster);
    this.#reconcile();
    const tick = Math.max(250, Math.min(10_000, Math.floor(this.#staleAfterMs / 2)));
    this.#standingTimer = setInterval(() => this.#checkStandings(), tick);
    this.#standingTimer.unref?.();
  }

  /** Stop every subscription and write each replica whose file is behind what was heard. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#opts.roster.off("changed", this.#onRoster);
    for (const off of this.#off) off();
    this.#off = [];
    if (this.#standingTimer !== null) clearInterval(this.#standingTimer);
    this.#standingTimer = null;
    for (const peer of this.#peers.values()) {
      this.#detach(peer);
      const pending = peer.persist !== null;
      if (peer.persist !== null) clearTimeout(peer.persist);
      peer.persist = null;
      // IndexMesh's DS-6b rule: what was heard is kept, every file BEHIND it, never one already current
      if (pending || peer.written !== peer.heardAt) this.#persist(peer);
    }
    this.removeAllListeners();
  }

  // ── the doors (3e registers them) ──

  /** `index.apps.list` — a page of the answering scope's fold. A `tailnet` caller's page is cut at
   * INDEX_TAILNET_LIMITS.MAX_ROWS; a `peer-fieldd` caller (a routed call) is answered this desktop's own apps,
   * with no project column. */
  list(params: IndexAppsParams, ctx: CallerContext): IndexAppsResult {
    // DS-L4 — a peer daemon asks on behalf of a window that aggregates on its own desktop: it is answered this
    // desktop's library alone, never a fold of what this desktop replicated (methods.ts' routed-call doc)
    const routed = ctx.principal.kind === "peer-fieldd";
    // PJ-4 — the project column is joined only for a caller the projects answer (never a peer daemon)
    const joins = !routed && readsProjects(ctx);
    // ... and a project narrows only where it is joined. Filtered without the join, a routed call naming one would
    // refuse every row and answer a blank where apps exist (MA-L10): the asking desktop narrows by project over its
    // own replica (`devices`, never a routed `device`), so the call is refused with that word.
    if (params.projectKey !== undefined && !joins) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        routed
          ? "a project narrows the apps at the asking desktop's own door; a peer daemon groups its own (DS-L4)"
          : "the projects do not answer this caller, so no project narrows its apps",
        false,
        { principal: ctx.principal.kind },
      );
    }
    const scope = routed ? "local" : (params.scope ?? "local");
    if (scope === "local") this.#requireLocalReady();
    const speakers = this.#devicesInScope(scope, params.devices);
    const cursor = decodeCursor(params.cursor);
    const asked = clampLimit(params.limit);
    const limit = clampLimit(
      tailnetRowLimit(ctx.principal, params.limit, INDEX_MESH.PAGE_DEFAULT_LIMIT) ?? asked,
    );
    const joined = new Map<Fold, AppProjectJoin | undefined>();
    const joinOf = (fold: Fold): AppProjectJoin | undefined => {
      if (!joins) return undefined;
      if (joined.has(fold)) return joined.get(fold);
      const { device, rootSessionId, sessionId } = fold.serving;
      const join = this.#opts.joinProject(device, rootSessionId ?? sessionId);
      joined.set(fold, join);
      return join;
    };
    const intentOf = (fold: Fold) => this.#opts.intents?.of(fold.foldKey);
    const needle = params.q?.toLowerCase();
    const { items, next } = pageOf(
      this.#folded(scope, speakers),
      foldSortKey,
      cursor,
      limit,
      (fold) => {
        const intent = intentOf(fold);
        if (intent?.hidden === true && params.includeHidden !== true) return false;
        if (params.kept !== undefined && (intent?.kept === true) !== params.kept) return false;
        if (
          needle !== undefined &&
          !fold.serving.title.toLowerCase().includes(needle) &&
          !fold.serving.filename.toLowerCase().includes(needle)
        )
          return false;
        if (params.projectKey !== undefined && joinOf(fold)?.projectKey !== params.projectKey)
          return false;
        return true;
      },
    );
    // `clipped` is the tailnet bound's word alone: it lowered the page below the ask AND more rows remain
    // (`index.timeline`'s `boundedBelow` rule); a page that ends where it was asked to is paged by its cursor
    const clipped = limit < asked && next !== undefined;
    return {
      rows: items.map((fold) => this.#rowOf(fold, intentOf(fold), joinOf(fold))),
      ...(next !== undefined ? { cursor: next } : {}),
      sources: this.#sources(speakers),
      ...(clipped ? { clipped: true } : {}),
    };
  }

  /** Every desktop's standing in the scope: state, rows, `libraryReady`, a validated `previewsBase`. */
  sources(scope: "local" | "mesh" = "mesh"): IndexAppsSource[] {
    return this.#sources(this.#devicesInScope(scope, undefined));
  }

  /** `index.apps.subscribe` — invalidation pings: rows always empty, the revision moving when the scope's fold moves
   * (an app on any desktop, a desktop's standing, the merged intent). */
  changes(
    params: {
      scope?: "local" | "mesh" | undefined;
      since?: RowsCursor | undefined;
      minIntervalMs?: number | undefined;
    },
    emit: (payload: unknown, kind: "delta" | "snapshot") => void,
  ): AppsChanges {
    const scope = params.scope ?? "local";
    const floor = params.minIntervalMs ?? this.#changesMinIntervalMs;
    const head = () => this.#changesRevision[scope];
    // each scope is its own chain: a local cursor never resumes a mesh one
    const epoch = `apps-changes-${scope}-${this.#changesEpoch}`;
    const since = params.since;
    let sent = head();
    const open =
      since !== undefined && since.epoch === epoch && since.revision <= head()
        ? { resumed: { epoch, revision: since.revision } }
        : { snapshot: { epoch, revision: head(), rows: [] } };
    if ("resumed" in open) sent = since?.revision ?? head();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = Number.NEGATIVE_INFINITY;
    let disposed = false;
    const devices = new Set<string>();
    const flush = () => {
      timer = null;
      if (disposed || head() === sent) return;
      lastAt = this.#now();
      // INDEX_CATALOG_TABLES names no `apps`, so a ping carries the desktops it heard and no `tables`
      emit(
        { epoch, since: sent, revision: head(), upserts: [], removed: [], devices: [...devices] },
        "delta",
      );
      sent = head();
      devices.clear();
    };
    const onChange = (change: Change) => {
      if (disposed || (scope === "local" && change.scope !== "local")) return;
      if (change.device !== undefined) devices.add(change.device);
      if (timer !== null) return;
      timer = setTimeout(flush, Math.max(0, lastAt + floor - this.#now()));
      timer.unref?.();
    };
    return {
      open,
      start: () => {
        this.on("change", onChange);
        if (head() !== sent) onChange({ scope });
      },
      dispose: () => {
        disposed = true;
        this.off("change", onChange);
        if (timer !== null) clearTimeout(timer);
      },
    };
  }

  /** A peer's replica as the copy holds it, for tests and diagnostics. */
  replica(device: string): IndexCatalogApp[] | undefined {
    return this.#peers.get(device)?.copy.rows();
  }

  // ── the fold ──

  /** DS-L8 — no local answer before the first walk: the library is still being read, said in the apps' words. */
  #requireLocalReady(): void {
    if (this.#opts.local.ready) return;
    throw new RpcCallError(
      "UNAVAILABLE",
      "this desktop's apps have not been read from its library yet",
      true,
      { service: MADE_APP_OPEN.SERVICE, state: MADE_APP_OPEN.STATE_READING },
    );
  }

  #devicesInScope(scope: "local" | "mesh", wanted: readonly string[] | undefined): Set<string> {
    const self = this.#opts.roster.currentDeviceId();
    const all = scope === "local" ? [self] : [self, ...this.#knownPeerDevices()];
    return new Set(wanted === undefined ? all : all.filter((device) => wanted.includes(device)));
  }

  /** Every peer the aggregator has a copy or a roster entry for. */
  #knownPeerDevices(): string[] {
    const self = this.#opts.roster.currentDeviceId();
    return [...this.#peers.keys()].filter((device) => device !== self).sort();
  }

  /** One fold per `madeAppFoldKey` over every holder the scope reads (`local`: this desktop's library alone). The
   * newest presentation among the desktops the page reads (`speakers`) serves it, the device breaking a tie, so a
   * page narrowed to some desktops shows THEIR copy and still names every holder. */
  #folded(scope: "local" | "mesh", speakers: Set<string>): Fold[] {
    const cacheKey = `${scope}|${[...speakers].sort().join(",")}`;
    const cached = this.#folds.get(cacheKey);
    if (cached?.version === this.#version) return cached.rows;
    for (const [key, entry] of this.#folds) {
      if (entry.version !== this.#version) this.#folds.delete(key);
    }
    const self = this.#opts.roster.currentDeviceId();
    const groups = new Map<string, Member[]>();
    const add = (device: string, raw: IndexCatalogApp) => {
      // DS-L2 — a row is the desktop it was read from, whatever it claims; the fold key is composed after the stamp
      const row = raw.device === device ? raw : { ...raw, device };
      const foldKey = madeAppFoldKey(row);
      let group = groups.get(foldKey);
      if (group === undefined) {
        group = [];
        groups.set(foldKey, group);
      }
      group.push({ device, row, at: sortAt(row) });
    };
    for (const row of this.#opts.local.table.rows()) add(self, row);
    if (scope === "mesh") {
      for (const peer of this.#peers.values()) {
        if (peer.device === self) continue;
        for (const row of peer.copy.rows()) add(peer.device, row);
      }
    }
    const folds: Fold[] = [];
    for (const [foldKey, members] of groups) {
      members.sort((a, b) =>
        compareKeys([a.at, a.device, a.row.appId], [b.at, b.device, b.row.appId]),
      );
      const serving = members.find((member) => speakers.has(member.device));
      if (serving === undefined) continue; // no desktop this page reads holds it
      const devices = [
        serving.device,
        ...[...new Set(members.map((member) => member.device))]
          .filter((device) => device !== serving.device)
          .sort(),
      ];
      const versions = members.reduce((sum, member) => sum + member.row.versions, 0);
      folds.push({ foldKey, serving: serving.row, at: serving.at, devices, versions });
    }
    folds.sort((a, b) => compareKeys(foldSortKey(a), foldSortKey(b)));
    this.#folds.set(cacheKey, { version: this.#version, rows: folds });
    return folds;
  }

  /** The door's row: the serving row's columns (never rosetta's project id, never a path: EL2), then the fold's and
   * this door's own. A column this door owns is never taken from a row, whoever sent it: the project is joined here
   * (PJ-4, as ProjectDoors' `keyed` drops a row's stale key) and Keep and Hide are the person's intent, never a row's
   * fact (the lead's ruling on L8). A replicated row that carries one is read as carrying none. */
  #rowOf(
    fold: Fold,
    intent: { kept?: true; hidden?: true } | undefined,
    join: AppProjectJoin | undefined,
  ): IndexApp {
    const {
      projectId: _projectId,
      path: _path,
      recoveredFrom: _recoveredFrom,
      recovered_from: _recovered_from,
      asset: _asset,
      projectKey: _projectKey,
      place: _place,
      ink: _ink,
      kept: _kept,
      hidden: _hidden,
      appKey: _appKey,
      foldKey: _foldKey,
      devices: _devices,
      openable: _openable,
      ...columns
    } = fold.serving;
    const hidden = intent?.hidden === true;
    return {
      ...columns,
      versions: fold.versions,
      appKey: `${fold.serving.device}:${fold.serving.appId}`,
      foldKey: fold.foldKey,
      devices: fold.devices,
      ...(join?.projectKey !== undefined ? { projectKey: join.projectKey } : {}),
      ...(join?.place !== undefined ? { place: join.place } : {}),
      ...(join?.ink !== undefined ? { ink: join.ink } : {}),
      ...(intent?.kept === true ? { kept: true as const } : {}),
      ...(hidden ? { hidden: true as const } : {}),
      openable:
        fold.serving.availability === "captured" &&
        !hidden &&
        this.#exportReady(fold.serving.device),
    };
  }

  #sources(devices: Set<string>): IndexAppsSource[] {
    const self = this.#opts.roster.currentDeviceId();
    const roster = new Map(this.#opts.roster.list().map((info) => [info.deviceId, info]));
    const out: IndexAppsSource[] = [];
    if (devices.has(self)) {
      const local = this.#opts.local;
      const heardAt = local.heardAt;
      const name = roster.get(self)?.name;
      const standing = local.standing();
      // this desktop's own base is what its own listener reported (3b): the claim is checked, no binding is owed
      const previewsBase = readableBase(standing.previewsBase);
      out.push({
        device: self,
        ...(name !== undefined ? { name } : {}),
        self: true,
        state: local.ready ? "live" : "stale",
        ...(heardAt !== null && heardAt !== undefined
          ? { asOf: new Date(heardAt).toISOString() }
          : {}),
        rows: local.table.size,
        ...(standing.libraryReady !== undefined ? { libraryReady: standing.libraryReady } : {}),
        ...(previewsBase !== undefined ? { previewsBase } : {}),
      });
    }
    for (const device of this.#knownPeerDevices()) {
      if (!devices.has(device)) continue;
      const peer = this.#peers.get(device);
      if (peer === undefined) continue;
      const info = roster.get(device);
      const name = info?.name ?? peer.name;
      const previewsBase = this.#boundBase(peer, info);
      out.push({
        device,
        ...(name !== undefined ? { name } : {}),
        self: false,
        state: this.#standing(peer),
        ...(peer.heardAt !== null ? { asOf: new Date(peer.heardAt).toISOString() } : {}),
        rows: peer.copy.size,
        ...(peer.standing.libraryReady !== undefined
          ? { libraryReady: peer.standing.libraryReady }
          : {}),
        ...(previewsBase !== undefined ? { previewsBase } : {}),
      });
    }
    return out;
  }

  /** A peer's `previewsBase`, kept only when its host is that peer's MagicDNS name as this desktop's roster
   * authenticates it (AH's `projectCatalogEntry` rule); with no authenticated name, or another host, it is stripped.
   * Validate or strip, never rewrite (C16). */
  #boundBase(peer: Peer, info: DeviceInfo | undefined): string | undefined {
    const base = peer.standing.previewsBase;
    if (base === undefined) return undefined;
    const claim = artifactRootUrlClaim(base);
    if (claim === null) return undefined;
    const host = canonicalTailnetDnsName(info?.tailnetDnsName);
    return host !== undefined && host === claim.hostname ? base : undefined;
  }

  // ── the replica ──

  readonly #onRoster = (): void => {
    if (!this.#disposed) this.#reconcile();
  };

  #reconcile(): void {
    const self = this.#opts.roster.currentDeviceId();
    const listed = new Map<string, DeviceInfo>();
    for (const info of this.#opts.roster.list()) {
      if (!info.self && info.deviceId !== self) listed.set(info.deviceId, info);
    }
    for (const info of listed.values()) {
      const peer = this.#peer(info.deviceId);
      const wasAway = !peer.inRoster || !peer.online;
      peer.inRoster = true;
      peer.online = info.online;
      peer.name = info.name;
      const build: PeerBuild = {
        bootId: info.bootId ?? null,
        fielddVersion: info.fielddVersion ?? null,
      };
      peer.build = build;
      // DS-L9 — another contracts major or link is not asked (the roster's one truth, as IndexMesh reads it), read
      // afresh at every roster change
      peer.rosterIncompatible = info.link === "incompatible" || info.state === "incompatible";
      // a peer that refused the apps door is asked again once it left and came back, or once the roster names
      // another build of it (an update in place restarts fieldd while the tailnet keeps the node online)
      if (peer.refused !== null && ((wasAway && info.online) || !sameBuild(peer.refused, build))) {
        peer.refused = null;
      }
      if (peer.online && !incompatibleOf(peer)) this.#ensureAttached(peer);
      else this.#detach(peer);
    }
    for (const peer of this.#peers.values()) {
      if (listed.has(peer.device)) continue;
      peer.inRoster = false;
      this.#detach(peer);
    }
    this.#checkStandings();
  }

  #peer(device: string): Peer {
    let peer = this.#peers.get(device);
    if (peer === undefined) {
      peer = {
        device,
        copy: this.#newCopy(),
        standing: {},
        sub: null,
        generation: 0,
        attaching: false,
        retry: null,
        retryMs: this.#retryMinMs,
        forceReset: false,
        persist: null,
        written: null,
        heardAt: null,
        rosterIncompatible: false,
        refused: null,
        build: { bootId: null, fielddVersion: null },
        inRoster: false,
        online: false,
        name: undefined,
      };
      this.#peers.set(device, peer);
    }
    return peer;
  }

  #newCopy(initial?: {
    epoch: string;
    revision: number;
    rows: IndexCatalogApp[];
    unreadable?: string[];
  }): RowsCopy<IndexCatalogApp> {
    return new RowsCopy<IndexCatalogApp>(
      {
        keyOf: (row) => row.appId,
        // the contract's gate: a row carrying a path or an asset (EL2) is refused, never listed
        parseRow: parseApp,
        rawKeyOf: rawAppKey,
        onDropped: () =>
          this.#sayOnce("row", "An apps replica holds a row it cannot read; it is not listed"),
      },
      initial,
    );
  }

  #ensureAttached(peer: Peer): void {
    if (peer.sub !== null || peer.attaching || peer.retry !== null) return;
    void this.#attach(peer);
  }

  async #attach(peer: Peer): Promise<void> {
    const generation = ++peer.generation;
    peer.attaching = true;
    /** the build this ask reaches, as the roster names it: a refusal is latched against it alone */
    const askedUnder = peer.build;
    const cursor = peer.forceReset ? undefined : peer.copy.cursor();
    peer.copy.abandonSnapshot();
    /** frames that beat the open answer to us (FielddClient routes them before the await resumes) */
    const early: unknown[] = [];
    let opened = false;
    const onEvent = (payload: unknown): void => {
      if (peer.generation !== generation || this.#disposed) return;
      if (!opened) early.push(payload);
      else this.#apply(peer, payload);
    };
    const onDrop = (): void => {
      if (peer.generation !== generation || this.#disposed) return;
      // the link under it died: nothing more from this subscription counts, a snapshot it was sending included
      peer.generation += 1;
      const dead = peer.sub;
      peer.sub = null;
      dead?.unsubscribe();
      peer.copy.abandonSnapshot();
      this.#scheduleRetry(peer);
      this.#checkStandings();
    };
    // its own door names no table (L1); history is not a live fold, so the replica's floor
    const ask = (since: RowsCursor | undefined) => ({
      minIntervalMs: this.#replicaMinIntervalMs,
      ...(since !== undefined ? { since } : {}),
    });
    try {
      const sub = await this.#opts.link.subscribe(
        peer.device,
        APPS_CATALOG_DOOR,
        ask(cursor),
        onEvent,
        onDrop,
        // S3 — a socket blip's replay resumes from where the copy IS
        { params: () => ask(peer.forceReset ? undefined : peer.copy.cursor()) },
      );
      if (peer.generation !== generation || this.#disposed) {
        sub.unsubscribe();
        return;
      }
      peer.attaching = false;
      peer.sub = { unsubscribe: sub.unsubscribe };
      peer.retryMs = this.#retryMinMs;
      opened = true;
      this.#apply(peer, sub.snapshot);
      for (const payload of early.splice(0)) {
        if (peer.generation !== generation) break;
        this.#apply(peer, payload);
      }
      this.#checkStandings();
    } catch (error) {
      if (peer.generation !== generation || this.#disposed) return;
      peer.attaching = false;
      const kind = (error as { kind?: unknown }).kind;
      const retryable = (error as { retryable?: unknown }).retryable === true;
      const refused = !retryable && kind !== "TIMEOUT" && kind !== "UNAVAILABLE";
      // a refusal heard after the roster named another build is that build's due: it has not been asked yet
      if (refused && sameBuild(askedUnder, peer.build)) {
        // an older build without the door (NOT_FOUND, method-not-found), another principal: the skew is this
        // TABLE's state (H5). The peer's projects and sessions are IndexMesh's and never hear of it.
        peer.refused = askedUnder;
        this.#sayOnce(
          `incompatible:${peer.device}:${askedUnder.bootId ?? ""}:${askedUnder.fielddVersion ?? ""}`,
          "A self desktop refused the apps door; its apps are not asked for again until it returns or updates",
          { device: peer.device, kind: typeof kind === "string" ? kind : "unknown" },
        );
      } else {
        this.#scheduleRetry(peer);
      }
      this.#checkStandings();
    }
  }

  #apply(peer: Peer, payload: unknown): void {
    const outcome = peer.copy.apply(payload);
    peer.heardAt = this.#now();
    // the newest frame's standing stands whole: a fact it lacks is unknown (contracts' OWNER_STANDING)
    const standing = standingOf(payload);
    let standingMoved = false;
    if (standing !== undefined && !sameStanding(peer.standing, standing)) {
      peer.standing = standing;
      standingMoved = true;
    }
    if (outcome.replaced === true) peer.forceReset = false;
    if (outcome.changed || standingMoved) {
      this.#schedulePersist(peer);
      this.#changed("mesh", peer.device);
    }
    if (outcome.resubscribe !== undefined) {
      this.#logger.info(
        "fieldd.index_apps_mesh.resubscribe",
        "An apps replica re-subscribes to a self desktop's apps",
        { device: peer.device, how: outcome.resubscribe, reason: outcome.reason ?? null },
      );
      this.#detach(peer);
      if (outcome.resubscribe === "reset") peer.forceReset = true;
      if (peer.online && !incompatibleOf(peer)) void this.#attach(peer);
    }
  }

  #detach(peer: Peer): void {
    peer.generation += 1;
    peer.attaching = false;
    if (peer.retry !== null) clearTimeout(peer.retry);
    peer.retry = null;
    const sub = peer.sub;
    peer.sub = null;
    sub?.unsubscribe();
    peer.copy.abandonSnapshot();
  }

  #scheduleRetry(peer: Peer): void {
    if (this.#disposed || peer.retry !== null || !peer.online || incompatibleOf(peer)) return;
    const delay = peer.retryMs;
    peer.retryMs = Math.min(peer.retryMs * 2, this.#retryMaxMs);
    peer.retry = setTimeout(() => {
      peer.retry = null;
      if (!this.#disposed && peer.online && !incompatibleOf(peer) && peer.sub === null) {
        void this.#attach(peer);
      }
    }, delay);
    peer.retry.unref?.();
  }

  #standing(peer: Peer): RowsDeviceState {
    if (incompatibleOf(peer) || this.#opts.link.linkState(peer.device) === "incompatible") {
      return "incompatible";
    }
    if (!peer.inRoster || !peer.online) return "asleep";
    const fresh = peer.heardAt !== null && this.#now() - peer.heardAt <= this.#staleAfterMs;
    return peer.sub !== null && fresh ? "live" : "stale";
  }

  /** A standing that moved (a desktop's state, or whether its base still binds to its name) is a change a visible
   * page must hear. */
  #checkStandings(): void {
    const roster = new Map(this.#opts.roster.list().map((info) => [info.deviceId, info]));
    const signature = [...this.#peers.values()]
      .map(
        (peer) =>
          `${peer.device}=${this.#standing(peer)}|${this.#boundBase(peer, roster.get(peer.device)) ?? ""}`,
      )
      .sort()
      .join(",");
    if (signature === this.#lastStandings) return;
    this.#lastStandings = signature;
    this.#changed("mesh");
  }

  /** The fold moved. A local change is on both chains (a mesh page reads this desktop too); a mesh one on the mesh
   * chain alone. Never IndexMesh's `change`: an app never regroups the projects (the fieldd map's Q13). */
  #changed(scope: "local" | "mesh", device?: string): void {
    this.#version += 1;
    if (scope === "local") this.#changesRevision.local += 1;
    this.#changesRevision.mesh += 1;
    const change: Change = { scope, ...(device !== undefined ? { device } : {}) };
    this.emit("change", change);
  }

  // ── persistence: <dir>/<device>.json (LAYOUT.MESH_APPS_DIR under the user root) ──

  #file(device: string): string {
    return join(this.#opts.dir, `${encodeURIComponent(device)}.json`);
  }

  #schedulePersist(peer: Peer): void {
    if (peer.persist !== null || this.#disposed) return;
    // a THROTTLE, not a debounce: the first change after a write schedules the next one
    peer.persist = setTimeout(() => {
      peer.persist = null;
      this.#persist(peer);
    }, this.#persistIntervalMs);
    peer.persist.unref?.();
  }

  #persist(peer: Peer): void {
    const state = peer.copy.state();
    if (state === undefined) return;
    const target = this.#file(peer.device);
    try {
      mkdirSync(this.#opts.dir, { recursive: true, mode: 0o700 });
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify({
          format: FILE_FORMAT,
          device: peer.device,
          heardAt: peer.heardAt,
          epoch: state.epoch,
          revision: state.revision,
          rows: state.rows,
          ...(state.unreadable !== undefined ? { unreadable: state.unreadable } : {}),
          // the standing is kept so an asleep desktop keeps its base; it is bound to the roster again at every read
          ...(peer.standing.libraryReady !== undefined
            ? { libraryReady: peer.standing.libraryReady }
            : {}),
          ...(peer.standing.previewsBase !== undefined
            ? { previewsBase: peer.standing.previewsBase }
            : {}),
        }),
        { mode: 0o600 },
      );
      durableRenameSync(tmp, target);
      peer.written = peer.heardAt;
    } catch (error) {
      this.#logger.warn(
        "fieldd.index_apps_mesh.persist_failed",
        "An apps replica could not be written",
        {
          device: peer.device,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  #loadPersisted(): void {
    let names: string[];
    try {
      names = readdirSync(this.#opts.dir);
    } catch {
      return; // nothing kept yet
    }
    const self = this.#opts.roster.currentDeviceId();
    for (const name of names) {
      if (KEPT_TMP.test(name)) {
        // a write that died before its rename: nothing is writing yet, so it is debris
        try {
          unlinkSync(join(this.#opts.dir, name));
        } catch {
          // gone already, or not ours to remove: the next write replaces it
        }
        continue;
      }
      const match = KEPT_FILE.exec(name);
      if (match === null) continue;
      let device: string;
      try {
        device = decodeURIComponent(match[1] ?? "");
      } catch {
        continue;
      }
      if (device === "" || device === self) continue;
      try {
        const kept = JSON.parse(readFileSync(join(this.#opts.dir, name), "utf8")) as Record<
          string,
          unknown
        >;
        const epoch = kept["epoch"];
        const revision = kept["revision"];
        const rows = kept["rows"];
        if (
          kept["format"] !== FILE_FORMAT ||
          kept["device"] !== device ||
          typeof epoch !== "string" ||
          typeof revision !== "number" ||
          !Array.isArray(rows)
        ) {
          this.#sayOnce(
            "kept-shape",
            "A kept apps replica is not one this build wrote; it is ignored",
            { file: name },
          );
          continue;
        }
        const peer = this.#peer(device);
        const heardAt = kept["heardAt"];
        if (typeof heardAt === "number" && (peer.heardAt === null || heardAt > peer.heardAt)) {
          peer.heardAt = heardAt;
        }
        // a kept row this build cannot read keeps its key like a live one (DS-6b), and so do the keys kept as such
        const unreadable = Array.isArray(kept["unreadable"])
          ? (kept["unreadable"] as unknown[]).filter(
              (key): key is string => typeof key === "string" && key.length > 0,
            )
          : [];
        const readable: IndexCatalogApp[] = [];
        for (const raw of rows as unknown[]) {
          const row = parseApp(raw);
          if (row !== undefined) readable.push(row);
          else {
            const key = rawAppKey(raw);
            if (key !== undefined) unreadable.push(key);
          }
        }
        peer.copy = this.#newCopy({ epoch, revision, rows: readable, unreadable });
        const libraryReady = kept["libraryReady"];
        const previewsBase = readableBase(kept["previewsBase"]);
        peer.standing = {
          ...(typeof libraryReady === "boolean" ? { libraryReady } : {}),
          ...(previewsBase !== undefined ? { previewsBase } : {}),
        };
        // what this file says was heard: dispose rewrites it only if behind
        peer.written = typeof heardAt === "number" ? heardAt : null;
      } catch (error) {
        this.#sayOnce(`kept:${name}`, "A kept apps replica could not be read; it is ignored", {
          file: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.#peers.size > 0) this.#changed("mesh");
  }

  #sayOnce(
    key: string,
    message: string,
    fields: Record<string, string | number | null> = {},
  ): void {
    if (this.#saidOnce.has(key)) return;
    this.#saidOnce.add(key);
    this.#logger.warn("fieldd.index_apps_mesh.notice", message, fields);
  }
}
