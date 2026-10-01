import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DeviceInfo,
  INDEX_MESH,
  IndexCatalogProject,
  IndexCatalogSession,
  type IndexCatalogSource,
  type IndexCatalogTable,
  type IndexProjectsParams,
  type IndexProjectsResult,
  type IndexSearchHit,
  type IndexSearchParams,
  type IndexSearchResult,
  type IndexSearchSource,
  type IndexSession,
  type IndexSessionsParams,
  type IndexSessionsResult,
  type RowsCursor,
  type RowsDeviceState,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { RowsCopy } from "./catalog-rows";
import { type IndexCatalog, sessionActivityAt } from "./index-catalog";
import { RpcCallError } from "./native-link";
import type { PeerLinkState } from "./peer-link";

// DS-6 — history across desktops, the AGGREGATOR half (design-06 §5 "History";
// `thinking-desktop-sync-plane.md` §6.4; DS-D8/D9/D10 RULED 2026-09-30). The
// source half is index-catalog.ts (this desktop's rosetta, followed into two
// rows tables); this file is everything a daemon does with the OTHER self
// desktops' tables, and the doors a window or the phone reads them through:
//
//   · THE REPLICA. For every self peer the roster lists online, one standing
//     `index.catalog.subscribe` per table, applied into a RowsCopy and
//     persisted at `users/<fuid>/mesh/catalog/<device>.<table>.json` (the rows
//     and the cursor, atomically). A peer that sleeps KEEPS its rows (DS-L8);
//     its subscription resumes from the kept cursor when it wakes, and resets
//     on an epoch change or a digest that disagrees (a reset, never a repair).
//   · THE DOORS. `index.projects` / `index.sessions` (listing) page the MERGED
//     replica by keyset — newest activity first by the OWNER's clock, the
//     device as tie-break (clocks differ; nothing depends on their agreeing) —
//     with one row per `{agent kind, native session id}` and every desktop
//     that holds it (DS-D10). `index.search {scope: "mesh"}` ASKS every awake
//     self desktop (search by asking: transcripts never replicate), merges BY
//     TIME, and says who answered (`sources`). `index.changes.subscribe` pings
//     a visible page when anything it reads moved.
//
// Why the replica does not ride FederatedSubscriptionManager: its `attach`
// adds a subscriber to its members only AFTER the upstream subscribe resolves,
// and FielddClient delivers frames that arrive in the same tick as the reply
// BEFORE the awaiting caller resumes — so the frames the catalog door sends
// right behind its open answer (a resume's catch-up delta, a paged snapshot's
// later pages: ProductAPI's `start` hook) reach no member and are lost; and
// its recovery re-subscribes with the FIRST attach's params, a stale cursor.
// The replica holds the same UpstreamLink capability (PeerLink) directly:
// it buffers frames until its own open answer lands, re-attaches with its
// CURRENT cursor, and owns its backoff (findings reported to the lead).
//
// DS-L2: a daemon never edits another device's row — a replica's `device` is
// the one it subscribed to, enforced on every row it serves. DS-L4: the daemon
// aggregates; a client never merges.

/** The roster slice the aggregator reads (DeviceService's). */
export interface MeshRoster {
  list(): DeviceInfo[];
  currentDeviceId(): string;
  on(event: "changed", listener: () => void): unknown;
  off(event: "changed", listener: () => void): unknown;
}

/** The PeerLink capability the aggregator rides (the federated manager's
 * `UpstreamLink`, plus the unary forward and the link verdict). */
export interface MeshLink {
  subscribe(
    deviceId: string,
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
    onDrop: () => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
  request(deviceId: string, method: string, params: unknown): Promise<unknown>;
  linkState(deviceId: string): PeerLinkState | undefined;
}

export interface IndexMeshOptions {
  /** this desktop's own catalog (the follower) */
  local: IndexCatalog;
  roster: MeshRoster;
  link: MeshLink;
  /** this desktop's own search (`IndexService.search`) */
  searchLocal: (params: IndexSearchParams) => Promise<IndexSearchResult>;
  /** where the replicas live (`LAYOUT.MESH_CATALOG_DIR` under the user root) */
  dir: string;
  logger?: Logger;
  now?: () => number;
  /** test seams for the cadences (defaults: INDEX_MESH) */
  searchTimeoutMs?: number;
  staleAfterMs?: number;
  persistDebounceMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  changesMinIntervalMs?: number;
}

const FILE_FORMAT = 1;
const TABLES: readonly IndexCatalogTable[] = ["projects", "sessions"];

type Row<T extends IndexCatalogTable> = T extends "projects"
  ? IndexCatalogProject
  : IndexCatalogSession;

interface PeerTable<T extends IndexCatalogTable> {
  copy: RowsCopy<Row<T>>;
  sub: { unsubscribe: () => void } | null;
  /** bumped per attach/detach: a superseded subscription's events are ignored */
  generation: number;
  attaching: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  retryMs: number;
  /** the next attach asks for a snapshot (a digest or epoch the copy cannot follow) */
  forceReset: boolean;
  persist: ReturnType<typeof setTimeout> | null;
}

interface Peer {
  device: string;
  projects: PeerTable<"projects">;
  sessions: PeerTable<"sessions">;
  /** the last frame from this peer, either table (epoch ms) */
  heardAt: number | null;
  /** refused as another build or principal (DS-L9) — not asked again until
   * the roster says the peer came back */
  incompatible: boolean;
  inRoster: boolean;
  online: boolean;
  name: string | undefined;
}

/** A merged session row, with what the filters need beside it. */
interface MergedSession {
  row: IndexSession;
  /** sort stamp (the owner's activity), device and key — the keyset */
  at: number | undefined;
  device: string;
  key: string;
  members: Array<{ device: string; projectId: string | undefined }>;
}

type SortKey = [at: number | null, device: string, key: string];

/** Sort: newest `at` first (absent last), then device, then key — the
 * owner's clock decides inside a device, the device breaks every tie. */
function compareKeys(a: SortKey, b: SortKey): number {
  const left = a[0] ?? Number.NEGATIVE_INFINITY;
  const right = b[0] ?? Number.NEGATIVE_INFINITY;
  if (left !== right) return left > right ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

function encodeCursor(key: SortKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): SortKey | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      (value[0] === null || (typeof value[0] === "number" && Number.isFinite(value[0]))) &&
      typeof value[1] === "string" &&
      typeof value[2] === "string"
    ) {
      return [value[0], value[1], value[2]];
    }
  } catch {
    // fall through to the refusal
  }
  throw new RpcCallError("PRECONDITION_FAILED", "the cursor is not one this door issued", false);
}

/** One page by keyset over a sorted list: the first `limit` accepted rows
 * strictly after `cursor`, and the next cursor when an accepted row remains. */
function pageOf<T>(
  sorted: readonly T[],
  keyOf: (item: T) => SortKey,
  cursor: SortKey | undefined,
  limit: number,
  accept: (item: T) => boolean,
): { items: T[]; next: string | undefined } {
  let start = 0;
  if (cursor !== undefined) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const item = sorted[mid];
      if (item !== undefined && compareKeys(keyOf(item), cursor) <= 0) lo = mid + 1;
      else hi = mid;
    }
    start = lo;
  }
  const items: T[] = [];
  let at = start;
  for (; at < sorted.length && items.length < limit; at += 1) {
    const item = sorted[at];
    if (item !== undefined && accept(item)) items.push(item);
  }
  let more = false;
  for (; at < sorted.length; at += 1) {
    const item = sorted[at];
    if (item !== undefined && accept(item)) {
      more = true;
      break;
    }
  }
  const last = items.at(-1);
  return { items, next: more && last !== undefined ? encodeCursor(keyOf(last)) : undefined };
}

const parseProject = (raw: unknown): IndexCatalogProject | undefined => {
  const parsed = IndexCatalogProject.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};
const parseSession = (raw: unknown): IndexCatalogSession | undefined => {
  const parsed = IndexCatalogSession.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};

export class IndexMesh extends EventEmitter {
  readonly #opts: IndexMeshOptions;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #searchTimeoutMs: number;
  readonly #staleAfterMs: number;
  readonly #persistDebounceMs: number;
  readonly #retryMinMs: number;
  readonly #retryMaxMs: number;
  readonly #changesMinIntervalMs: number;
  readonly #peers = new Map<string, Peer>();
  #started = false;
  #disposed = false;
  #standingTimer: ReturnType<typeof setInterval> | null = null;
  #lastStandings = "";
  /** bumped on any change the merged views read */
  #version = 0;
  /** merged + sorted sessions per {scope, who may speak}, for one version */
  #sortedSessions = new Map<string, { version: number; rows: MergedSession[] }>();
  #sortedProjects: { version: number; rows: IndexCatalogProject[] } | null = null;
  /** the change pings' chain: one epoch per daemon, a revision per change */
  readonly #changesEpoch = `changes-${randomUUID()}`;
  #changesRevision = { local: 0, mesh: 0 };
  #localOff: Array<() => void> = [];
  readonly #saidOnce = new Set<string>();

  constructor(opts: IndexMeshOptions) {
    super();
    this.setMaxListeners(0); // one listener per change subscriber
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "index_mesh" });
    this.#now = opts.now ?? Date.now;
    this.#searchTimeoutMs = opts.searchTimeoutMs ?? INDEX_MESH.SEARCH_FANOUT_TIMEOUT_MS;
    this.#staleAfterMs = opts.staleAfterMs ?? INDEX_MESH.STALE_AFTER_MS;
    this.#persistDebounceMs = opts.persistDebounceMs ?? INDEX_MESH.PERSIST_DEBOUNCE_MS;
    this.#retryMinMs = opts.retryMinMs ?? INDEX_MESH.REPLICA_RETRY_MIN_MS;
    this.#retryMaxMs = opts.retryMaxMs ?? INDEX_MESH.REPLICA_RETRY_MAX_MS;
    this.#changesMinIntervalMs = opts.changesMinIntervalMs ?? INDEX_MESH.CHANGES_MIN_INTERVAL_MS;
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#loadPersisted();
    const onLocal = () => this.#changed("local");
    const local = this.#opts.local;
    const offProjects = local.projects.onDelta(onLocal);
    const offSessions = local.sessions.onDelta(onLocal);
    local.on("phase", onLocal);
    this.#localOff = [offProjects, offSessions, () => local.off("phase", onLocal)];
    this.#opts.roster.on("changed", this.#onRoster);
    this.#reconcile();
    const tick = Math.max(250, Math.min(10_000, Math.floor(this.#staleAfterMs / 2)));
    this.#standingTimer = setInterval(() => this.#checkStandings(), tick);
    this.#standingTimer.unref?.();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#opts.roster.off("changed", this.#onRoster);
    for (const off of this.#localOff) off();
    this.#localOff = [];
    if (this.#standingTimer !== null) clearInterval(this.#standingTimer);
    this.#standingTimer = null;
    for (const peer of this.#peers.values()) {
      for (const table of TABLES) {
        this.#detach(peer, table);
        const entry = this.#table(peer, table);
        if (entry.persist !== null) {
          clearTimeout(entry.persist);
          entry.persist = null;
          this.#persist(peer, table); // what was heard is kept
        }
      }
    }
    this.removeAllListeners();
  }

  // ── the doors ──

  /** `index.projects` — a page of the answering scope's projects. */
  projects(params: IndexProjectsParams): IndexProjectsResult {
    const scope = params.scope ?? "local";
    this.#requireLocalForLocalScope(scope);
    const devices = this.#devicesInScope(scope, params.devices);
    const cursor = decodeCursor(params.cursor);
    const limit = clampLimit(params.limit);
    const sorted = this.#projectsSorted();
    const { items, next } = pageOf(
      sorted,
      (row) => [row.lastActivityAt ?? null, row.device, row.projectId],
      cursor,
      limit,
      (row) =>
        devices.has(row.device) && (params.family === undefined || row.family === params.family),
    );
    return {
      rows: items,
      ...(next !== undefined ? { cursor: next } : {}),
      sources: this.#sources("projects", devices),
    };
  }

  /** `index.sessions` — the LISTING arm (the lookup stays IndexService's). */
  sessions(params: IndexSessionsParams): IndexSessionsResult {
    const scope = params.scope ?? "local";
    this.#requireLocalForLocalScope(scope);
    const devices = this.#devicesInScope(scope, params.devices);
    const cursor = decodeCursor(params.cursor);
    const limit = clampLimit(params.limit);
    const sorted = this.#sessionsSorted(scope, devices);
    const { items, next } = pageOf(
      sorted,
      (merged) => [merged.at ?? null, merged.device, merged.key],
      cursor,
      limit,
      (merged) => this.#acceptSession(merged, devices, params),
    );
    return {
      rows: items.map((merged) => merged.row),
      ...(next !== undefined ? { cursor: next } : {}),
      sources: this.#sources("sessions", devices),
    };
  }

  /** `index.search {scope: "mesh"}` — ask every awake self desktop, merge by
   * time, say who answered. A local search never reaches here. */
  async search(params: IndexSearchParams): Promise<IndexSearchResult> {
    const self = this.#opts.roster.currentDeviceId();
    const wanted = params.devices === undefined ? undefined : new Set(params.devices);
    const ask: Promise<{
      hits: IndexSearchHit[];
      source: IndexSearchSource;
      local?: IndexSearchResult;
    }>[] = [];
    const { scope: _scope, devices: _devices, ...question } = params;
    const forwarded = { ...question, scope: "local" as const };
    if (wanted === undefined || wanted.has(self)) {
      ask.push(this.#askLocal(self, forwarded));
    }
    for (const device of this.#knownPeerDevices()) {
      if (wanted !== undefined && !wanted.has(device)) continue;
      ask.push(this.#askPeer(device, forwarded));
    }
    const answers = await Promise.all(ask);
    const hits = answers
      .flatMap((answer) => answer.hits)
      .sort((a, b) =>
        compareKeys(
          [a.at ?? null, a.device ?? "", `${a.sessionId}\u0000${a.timelineId}`],
          [b.at ?? null, b.device ?? "", `${b.sessionId}\u0000${b.timelineId}`],
        ),
      );
    const limit = params.limit ?? 300;
    const sources = answers.map((answer) => answer.source);
    const answered = sources.some((source) => source.state === "answered");
    const local = answers.find((answer) => answer.local !== undefined)?.local;
    return {
      answered,
      // the state of THIS desktop's index when it was asked (it is what the
      // sheet's foot has always described); otherwise what the mesh amounted to
      state: local?.state ?? { readiness: answered ? "ready" : "unknown" },
      hits: hits.slice(0, limit),
      clipped: hits.length > limit || sources.some((source) => source.clipped === true),
      sources,
    };
  }

  /** `index.changes.subscribe` — invalidation pings: a rows subscription whose
   * rows are always empty and whose revision moves when the scope's catalog
   * (or a desktop's standing) moves. */
  changes(
    params: {
      scope?: "local" | "mesh" | undefined;
      since?: RowsCursor | undefined;
      minIntervalMs?: number | undefined;
    },
    emit: (payload: unknown, kind: "delta" | "snapshot") => void,
  ): { open: unknown; start: () => void; dispose: () => void } {
    const scope = params.scope ?? "local";
    const floor = params.minIntervalMs ?? this.#changesMinIntervalMs;
    const head = () => this.#changesRevision[scope];
    const since = params.since;
    let sent = head();
    const open =
      since !== undefined && since.epoch === this.#changesEpoch && since.revision <= head()
        ? { resumed: { epoch: this.#changesEpoch, revision: since.revision } }
        : { snapshot: { epoch: this.#changesEpoch, revision: head(), rows: [] } };
    if ("resumed" in open) sent = since?.revision ?? head();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = Number.NEGATIVE_INFINITY;
    let disposed = false;
    const tables = new Set<IndexCatalogTable>();
    const devices = new Set<string>();
    const flush = () => {
      timer = null;
      if (disposed || head() === sent) return;
      lastAt = this.#now();
      emit(
        {
          epoch: this.#changesEpoch,
          since: sent,
          revision: head(),
          upserts: [],
          removed: [],
          tables: [...tables],
          devices: [...devices],
        },
        "delta",
      );
      sent = head();
      tables.clear();
      devices.clear();
    };
    const onChange = (change: {
      scope: "local" | "mesh";
      table?: IndexCatalogTable;
      device?: string;
    }) => {
      if (disposed || (scope === "local" && change.scope !== "local")) return;
      if (change.table !== undefined) tables.add(change.table);
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

  /** Every desktop's standing for a table (the listing's `sources`). */
  sourcesFor(table: IndexCatalogTable, scope: "local" | "mesh" = "mesh"): IndexCatalogSource[] {
    return this.#sources(table, this.#devicesInScope(scope, undefined));
  }

  /** A peer's replica, for tests and diagnostics. */
  replica(
    device: string,
  ): { projects: IndexCatalogProject[]; sessions: IndexCatalogSession[] } | undefined {
    const peer = this.#peers.get(device);
    return peer === undefined
      ? undefined
      : { projects: peer.projects.copy.rows(), sessions: peer.sessions.copy.rows() };
  }

  // ── the merged views ──

  #requireLocalForLocalScope(scope: "local" | "mesh"): void {
    if (scope !== "local") return;
    const local = this.#opts.local;
    if (!local.ready) {
      throw new RpcCallError(
        "UNAVAILABLE",
        "the history catalog has not read the index yet",
        true,
        {
          service: "index",
          state: local.phase,
        },
      );
    }
  }

  #devicesInScope(scope: "local" | "mesh", wanted: readonly string[] | undefined): Set<string> {
    const self = this.#opts.roster.currentDeviceId();
    const all = scope === "local" ? [self] : [self, ...this.#knownPeerDevices()];
    return new Set(wanted === undefined ? all : all.filter((device) => wanted.includes(device)));
  }

  /** Every peer the aggregator has rows or a roster entry for. */
  #knownPeerDevices(): string[] {
    const self = this.#opts.roster.currentDeviceId();
    return [...this.#peers.keys()].filter((device) => device !== self).sort();
  }

  #projectsSorted(): IndexCatalogProject[] {
    if (this.#sortedProjects?.version === this.#version) return this.#sortedProjects.rows;
    const self = this.#opts.roster.currentDeviceId();
    const rows: IndexCatalogProject[] = this.#opts.local.projects
      .rows()
      .map((row) => (row.device === self ? row : { ...row, device: self }));
    for (const peer of this.#peers.values()) {
      if (peer.device === self) continue;
      for (const row of peer.projects.copy.rows()) {
        rows.push(row.device === peer.device ? row : { ...row, device: peer.device });
      }
    }
    rows.sort((a, b) =>
      compareKeys(
        [a.lastActivityAt ?? null, a.device, a.projectId],
        [b.lastActivityAt ?? null, b.device, b.projectId],
      ),
    );
    this.#sortedProjects = { version: this.#version, rows };
    return rows;
  }

  #familyOf(device: string, projectId: string | undefined): string | undefined {
    if (projectId === undefined) return undefined;
    const self = this.#opts.roster.currentDeviceId();
    if (device === self) return this.#opts.local.projects.get(projectId)?.family;
    return this.#peers.get(device)?.projects.copy.get(projectId)?.family;
  }

  /** One row per `{agent kind, native session id}` (DS-D10): every desktop
   * that holds it is named, and the member with the newest activity among the
   * desktops the page reads (`speakers`, the device breaks a tie) speaks for
   * the row — so a page narrowed to one desktop shows THAT desktop's copy,
   * with every badge still on it. A session whose agent kind is not known
   * stays its own row — the duplicate rule needs both halves of the key. The
   * LOCAL scope reads this desktop's own rows only: nothing of a peer's may
   * speak for, or badge, a row there. */
  #sessionsSorted(scope: "local" | "mesh", speakers: Set<string>): MergedSession[] {
    const cacheKey = `${scope}|${[...speakers].sort().join(",")}`;
    const cached = this.#sortedSessions.get(cacheKey);
    if (cached?.version === this.#version) return cached.rows;
    for (const [key, entry] of this.#sortedSessions) {
      if (entry.version !== this.#version) this.#sortedSessions.delete(key);
    }
    const self = this.#opts.roster.currentDeviceId();
    const groups = new Map<string, Array<{ device: string; row: IndexCatalogSession }>>();
    const add = (device: string, row: IndexCatalogSession) => {
      const key =
        row.kind !== undefined && row.nativeSessionId !== ""
          ? `${row.kind}\u0000${row.nativeSessionId}`
          : `\u0001${device}\u0000${row.sessionId}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = [];
        groups.set(key, group);
      }
      group.push({ device, row });
    };
    for (const row of this.#opts.local.sessions.rows()) add(self, row);
    for (const peer of scope === "mesh" ? this.#peers.values() : []) {
      if (peer.device === self) continue;
      for (const row of peer.sessions.copy.rows()) add(peer.device, row);
    }
    const merged: MergedSession[] = [];
    for (const group of groups.values()) {
      group.sort((a, b) =>
        compareKeys(
          [sessionActivityAt(a.row) ?? null, a.device, a.row.sessionId],
          [sessionActivityAt(b.row) ?? null, b.device, b.row.sessionId],
        ),
      );
      const primary = group.find((member) => speakers.has(member.device));
      if (primary === undefined) continue; // no desktop this page reads holds it
      const devices = [
        primary.device,
        ...[...new Set(group.map((member) => member.device))]
          .filter((device) => device !== primary.device)
          .sort(),
      ];
      let family = this.#familyOf(primary.device, primary.row.projectId);
      for (const member of group) {
        if (family !== undefined) break;
        family = this.#familyOf(member.device, member.row.projectId);
      }
      const provider =
        primary.row.provider ??
        group.find((member) => member.row.provider !== undefined)?.row.provider;
      const { row } = primary;
      merged.push({
        row: {
          sessionId: row.sessionId,
          nativeSessionId: row.nativeSessionId,
          rootSessionId: row.sessionId,
          ...(row.title !== undefined ? { title: row.title } : {}),
          ...(row.summary !== undefined ? { summary: row.summary } : {}),
          ...(row.cwd !== undefined ? { cwd: row.cwd } : {}),
          ...(row.updatedAt !== undefined ? { updatedAt: row.updatedAt } : {}),
          activity: row.activity,
          streamState: row.streamState,
          device: primary.device,
          devices,
          ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
          ...(family !== undefined ? { family } : {}),
          ...(provider !== undefined ? { provider } : {}),
          ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
        },
        at: sessionActivityAt(row),
        device: primary.device,
        key: row.sessionId,
        members: group.map((member) => ({
          device: member.device,
          projectId: member.row.projectId,
        })),
      });
    }
    merged.sort((a, b) =>
      compareKeys([a.at ?? null, a.device, a.key], [b.at ?? null, b.device, b.key]),
    );
    this.#sortedSessions.set(cacheKey, { version: this.#version, rows: merged });
    return merged;
  }

  #acceptSession(
    merged: MergedSession,
    devices: Set<string>,
    params: IndexSessionsParams,
  ): boolean {
    if (params.family !== undefined && merged.row.family !== params.family) return false;
    if (params.projectId !== undefined) {
      return merged.members.some(
        (member) => devices.has(member.device) && member.projectId === params.projectId,
      );
    }
    return true;
  }

  #sources(table: IndexCatalogTable, devices: Set<string>): IndexCatalogSource[] {
    const self = this.#opts.roster.currentDeviceId();
    const roster = new Map(this.#opts.roster.list().map((info) => [info.deviceId, info]));
    const out: IndexCatalogSource[] = [];
    if (devices.has(self)) {
      const local = this.#opts.local;
      const heardAt = local.heardAt;
      const name = roster.get(self)?.name;
      out.push({
        device: self,
        ...(name !== undefined ? { name } : {}),
        self: true,
        state:
          local.phase === "incompatible"
            ? "incompatible"
            : local.phase === "live"
              ? "live"
              : "stale",
        ...(heardAt !== null ? { asOf: new Date(heardAt).toISOString() } : {}),
        rows: local.table(table).size,
      });
    }
    for (const device of this.#knownPeerDevices()) {
      if (!devices.has(device)) continue;
      const peer = this.#peers.get(device);
      if (peer === undefined) continue;
      const name = roster.get(device)?.name ?? peer.name;
      out.push({
        device,
        ...(name !== undefined ? { name } : {}),
        self: false,
        state: this.#standing(peer),
        ...(peer.heardAt !== null ? { asOf: new Date(peer.heardAt).toISOString() } : {}),
        rows: this.#table(peer, table).copy.size,
      });
    }
    return out;
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
      if (info.link === "incompatible") peer.incompatible = true;
      else if (wasAway && info.online) peer.incompatible = false; // it came back: ask again
      for (const table of TABLES) {
        if (peer.online && !peer.incompatible) this.#ensureAttached(peer, table);
        else this.#detach(peer, table);
      }
    }
    for (const peer of this.#peers.values()) {
      if (listed.has(peer.device)) continue;
      peer.inRoster = false;
      for (const table of TABLES) this.#detach(peer, table);
    }
    this.#checkStandings();
  }

  #peer(device: string): Peer {
    let peer = this.#peers.get(device);
    if (peer === undefined) {
      peer = {
        device,
        projects: this.#newTable<"projects">(parseProject, (row) => row.projectId),
        sessions: this.#newTable<"sessions">(parseSession, (row) => row.sessionId),
        heardAt: null,
        incompatible: false,
        inRoster: false,
        online: false,
        name: undefined,
      };
      this.#peers.set(device, peer);
    }
    return peer;
  }

  #newTable<T extends IndexCatalogTable>(
    parseRow: (raw: unknown) => Row<T> | undefined,
    keyOf: (row: Row<T>) => string,
    initial?: { epoch: string; revision: number; rows: Row<T>[] },
  ): PeerTable<T> {
    return {
      copy: new RowsCopy<Row<T>>(
        {
          keyOf,
          parseRow,
          onDropped: () => this.#sayOnce("row", "A replica dropped a row it cannot read"),
        },
        initial,
      ),
      sub: null,
      generation: 0,
      attaching: false,
      retry: null,
      retryMs: this.#retryMinMs,
      forceReset: false,
      persist: null,
    };
  }

  #table<T extends IndexCatalogTable>(peer: Peer, table: T): PeerTable<T> {
    return (table === "projects" ? peer.projects : peer.sessions) as PeerTable<T>;
  }

  #ensureAttached(peer: Peer, table: IndexCatalogTable): void {
    const entry = this.#table(peer, table);
    if (entry.sub !== null || entry.attaching || entry.retry !== null) return;
    void this.#attach(peer, table);
  }

  async #attach(peer: Peer, table: IndexCatalogTable): Promise<void> {
    const entry = this.#table(peer, table);
    const generation = ++entry.generation;
    entry.attaching = true;
    const cursor = entry.forceReset ? undefined : entry.copy.cursor();
    entry.forceReset = false;
    /** frames that beat the open answer to us (FielddClient routes them the
     * moment the reply installs the route, before the await resumes) */
    const early: unknown[] = [];
    let opened = false;
    const onEvent = (payload: unknown): void => {
      if (entry.generation !== generation || this.#disposed) return;
      if (!opened) early.push(payload);
      else this.#apply(peer, table, payload);
    };
    const onDrop = (): void => {
      if (entry.generation !== generation || this.#disposed) return;
      // the link under it died: nothing more from this subscription counts
      entry.generation += 1;
      const dead = entry.sub;
      entry.sub = null;
      dead?.unsubscribe();
      this.#scheduleRetry(peer, table);
      this.#checkStandings();
    };
    try {
      const sub = await this.#opts.link.subscribe(
        peer.device,
        "index.catalog.subscribe",
        { table, ...(cursor !== undefined ? { since: cursor } : {}) },
        onEvent,
        onDrop,
      );
      if (entry.generation !== generation || this.#disposed) {
        sub.unsubscribe();
        return;
      }
      entry.attaching = false;
      entry.sub = { unsubscribe: sub.unsubscribe };
      entry.retryMs = this.#retryMinMs;
      opened = true;
      this.#apply(peer, table, sub.snapshot);
      for (const payload of early.splice(0)) {
        if (entry.generation !== generation) break;
        this.#apply(peer, table, payload);
      }
      this.#checkStandings();
    } catch (error) {
      if (entry.generation !== generation || this.#disposed) return;
      entry.attaching = false;
      const kind = (error as { kind?: unknown }).kind;
      const retryable = (error as { retryable?: unknown }).retryable === true;
      if (!retryable && kind !== "TIMEOUT" && kind !== "UNAVAILABLE") {
        // another build, another principal, or a door it does not have: the
        // skew is a STATE (DS-L9) — not asked again until the roster says so
        peer.incompatible = true;
        this.#sayOnce(
          `incompatible:${peer.device}`,
          "A self desktop refused the history catalog door; it is not asked again until it returns",
          { device: peer.device, kind: typeof kind === "string" ? kind : "unknown" },
        );
      } else {
        this.#scheduleRetry(peer, table);
      }
      this.#checkStandings();
    }
  }

  #apply(peer: Peer, table: IndexCatalogTable, payload: unknown): void {
    const entry = this.#table(peer, table);
    const outcome = entry.copy.apply(payload);
    peer.heardAt = this.#now();
    if (outcome.changed) {
      this.#schedulePersist(peer, table);
      this.#changed("mesh", table, peer.device);
    }
    if (outcome.resubscribe !== undefined) {
      this.#logger.info(
        "fieldd.index_mesh.resubscribe",
        "A replica re-subscribes to a self desktop's catalog",
        { device: peer.device, table, how: outcome.resubscribe, reason: outcome.reason ?? null },
      );
      this.#detach(peer, table);
      if (outcome.resubscribe === "reset") entry.forceReset = true;
      if (peer.online && !peer.incompatible) void this.#attach(peer, table);
    }
  }

  #detach(peer: Peer, table: IndexCatalogTable): void {
    const entry = this.#table(peer, table);
    entry.generation += 1;
    entry.attaching = false;
    if (entry.retry !== null) clearTimeout(entry.retry);
    entry.retry = null;
    const sub = entry.sub;
    entry.sub = null;
    sub?.unsubscribe();
  }

  #scheduleRetry(peer: Peer, table: IndexCatalogTable): void {
    const entry = this.#table(peer, table);
    if (this.#disposed || entry.retry !== null || !peer.online || peer.incompatible) return;
    const delay = entry.retryMs;
    entry.retryMs = Math.min(entry.retryMs * 2, this.#retryMaxMs);
    entry.retry = setTimeout(() => {
      entry.retry = null;
      if (!this.#disposed && peer.online && !peer.incompatible && entry.sub === null) {
        void this.#attach(peer, table);
      }
    }, delay);
    entry.retry.unref?.();
  }

  #standing(peer: Peer): RowsDeviceState {
    if (peer.incompatible || this.#opts.link.linkState(peer.device) === "incompatible") {
      return "incompatible";
    }
    if (!peer.inRoster || !peer.online) return "asleep";
    const attached = peer.projects.sub !== null && peer.sessions.sub !== null;
    const fresh = peer.heardAt !== null && this.#now() - peer.heardAt <= this.#staleAfterMs;
    return attached && fresh ? "live" : "stale";
  }

  /** A standing that moved is a change a visible page must hear. */
  #checkStandings(): void {
    const signature = [...this.#peers.values()]
      .map((peer) => `${peer.device}=${this.#standing(peer)}`)
      .sort()
      .join(",");
    if (signature === this.#lastStandings) return;
    this.#lastStandings = signature;
    this.#changed("mesh");
  }

  #changed(scope: "local" | "mesh", table?: IndexCatalogTable, device?: string): void {
    this.#version += 1;
    if (scope === "local") this.#changesRevision.local += 1;
    this.#changesRevision.mesh += 1;
    this.emit("change", {
      scope,
      ...(table !== undefined ? { table } : {}),
      ...(device !== undefined
        ? { device }
        : scope === "local"
          ? { device: this.#opts.roster.currentDeviceId() }
          : {}),
    });
  }

  // ── persistence: users/<fuid>/mesh/catalog/<device>.<table>.json ──

  #file(device: string, table: IndexCatalogTable): string {
    return join(this.#opts.dir, `${encodeURIComponent(device)}.${table}.json`);
  }

  #schedulePersist(peer: Peer, table: IndexCatalogTable): void {
    const entry = this.#table(peer, table);
    if (entry.persist !== null || this.#disposed) return;
    entry.persist = setTimeout(() => {
      entry.persist = null;
      this.#persist(peer, table);
    }, this.#persistDebounceMs);
    entry.persist.unref?.();
  }

  #persist(peer: Peer, table: IndexCatalogTable): void {
    const state = this.#table(peer, table).copy.state();
    if (state === undefined) return;
    const target = this.#file(peer.device, table);
    try {
      mkdirSync(this.#opts.dir, { recursive: true, mode: 0o700 });
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify({
          format: FILE_FORMAT,
          device: peer.device,
          table,
          heardAt: peer.heardAt,
          epoch: state.epoch,
          revision: state.revision,
          rows: state.rows,
        }),
        { mode: 0o600 },
      );
      durableRenameSync(tmp, target);
    } catch (error) {
      this.#logger.warn("fieldd.index_mesh.persist_failed", "A replica could not be written", {
        device: peer.device,
        table,
        error: error instanceof Error ? error.message : String(error),
      });
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
      const match = /^(.+)\.(projects|sessions)\.json$/.exec(name);
      if (match === null) continue;
      const table = match[2] as IndexCatalogTable;
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
        if (
          kept["format"] !== FILE_FORMAT ||
          kept["device"] !== device ||
          kept["table"] !== table ||
          typeof kept["epoch"] !== "string" ||
          typeof kept["revision"] !== "number" ||
          !Array.isArray(kept["rows"])
        ) {
          this.#sayOnce("kept-shape", "A kept replica is not one this build wrote; it is ignored", {
            file: name,
          });
          continue;
        }
        const peer = this.#peer(device);
        const heardAt = kept["heardAt"];
        if (typeof heardAt === "number" && (peer.heardAt === null || heardAt > peer.heardAt)) {
          peer.heardAt = heardAt;
        }
        const epoch = kept["epoch"];
        const revision = kept["revision"];
        if (table === "projects") {
          const rows = (kept["rows"] as unknown[]).flatMap((raw) => parseProject(raw) ?? []);
          peer.projects = this.#newTable<"projects">(parseProject, (row) => row.projectId, {
            epoch,
            revision,
            rows,
          });
        } else {
          const rows = (kept["rows"] as unknown[]).flatMap((raw) => parseSession(raw) ?? []);
          peer.sessions = this.#newTable<"sessions">(parseSession, (row) => row.sessionId, {
            epoch,
            revision,
            rows,
          });
        }
      } catch (error) {
        this.#sayOnce(`kept:${name}`, "A kept replica could not be read; it is ignored", {
          file: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.#peers.size > 0) this.#changed("mesh");
  }

  // ── search by asking ──

  async #askLocal(
    device: string,
    params: IndexSearchParams,
  ): Promise<{ hits: IndexSearchHit[]; source: IndexSearchSource; local?: IndexSearchResult }> {
    const started = this.#now();
    try {
      const result = await this.#withTimeout(this.#opts.searchLocal(params));
      if (result === "timeout")
        return { hits: [], source: { device, state: "timeout", tookMs: this.#took(started) } };
      return {
        hits: result.hits.map((hit) => ({ ...hit, device })),
        source: {
          device,
          state: result.answered ? "answered" : "building",
          tookMs: this.#took(started),
          ...(result.clipped ? { clipped: true } : {}),
          ...(result.answered
            ? {}
            : { detail: result.state.detail ?? "this desktop's index has no answer yet" }),
        },
        local: result,
      };
    } catch (error) {
      return {
        hits: [],
        source: {
          device,
          state: "building",
          tookMs: this.#took(started),
          detail: error instanceof Error ? error.message : "this desktop's index did not answer",
        },
      };
    }
  }

  async #askPeer(
    device: string,
    params: IndexSearchParams,
  ): Promise<{ hits: IndexSearchHit[]; source: IndexSearchSource }> {
    const peer = this.#peers.get(device);
    if (peer !== undefined) {
      const standing = this.#standing(peer);
      if (standing === "incompatible") {
        return { hits: [], source: { device, state: "incompatible", tookMs: 0 } };
      }
      if (standing === "asleep") {
        return {
          hits: [],
          source: {
            device,
            state: "asleep",
            tookMs: 0,
            detail: "this desktop is asleep; wake it to search its history",
          },
        };
      }
    }
    const started = this.#now();
    try {
      const result = await this.#withTimeout(
        this.#opts.link.request(device, "index.search", params),
      );
      if (result === "timeout") {
        return { hits: [], source: { device, state: "timeout", tookMs: this.#took(started) } };
      }
      const answer = result as Partial<IndexSearchResult> | null;
      const hits = Array.isArray(answer?.hits) ? answer.hits : [];
      return {
        hits: hits.map((hit) => ({ ...hit, device })),
        source: {
          device,
          state: answer?.answered === true ? "answered" : "building",
          tookMs: this.#took(started),
          ...(answer?.clipped === true ? { clipped: true } : {}),
        },
      };
    } catch (error) {
      const kind = (error as { kind?: unknown }).kind;
      const retryable = (error as { retryable?: unknown }).retryable === true;
      const state: IndexSearchSource["state"] =
        kind === "UNAVAILABLE" &&
        (error as { details?: { service?: unknown } }).details?.service === "index"
          ? "building" // its door answered: its INDEX is not up
          : kind === "UNAVAILABLE" || kind === "TIMEOUT" || retryable
            ? "asleep"
            : "incompatible";
      return { hits: [], source: { device, state, tookMs: this.#took(started) } };
    }
  }

  async #withTimeout<T>(promise: Promise<T>): Promise<T | "timeout"> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), this.#searchTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  #took(started: number): number {
    return Math.max(0, Math.round(this.#now() - started));
  }

  #sayOnce(
    key: string,
    message: string,
    fields: Record<string, string | number | null> = {},
  ): void {
    if (this.#saidOnce.has(key)) return;
    this.#saidOnce.add(key);
    this.#logger.warn("fieldd.index_mesh.notice", message, fields);
  }
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? INDEX_MESH.PAGE_DEFAULT_LIMIT, 1), INDEX_MESH.PAGE_MAX_LIMIT);
}
