import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  DaemonStatus,
  DiscoveriesResponse,
  RuntimeBackfill,
  RuntimeIngestStatus,
  RuntimeRow,
  RuntimesResponse,
  StatusResponse,
} from "@rosetta/protocol";
import {
  AbsoluteDataRoot,
  AgentKind,
  type IndexDiscoveriesResult,
  type IndexEnrollmentRecord,
  IndexEnrollmentRecord as IndexEnrollmentRecordSchema,
  type IndexEnrollmentSummary,
  type IndexMutationResult,
  type IndexPhase,
  IndexPhase as IndexPhaseSchema,
  type IndexRuntimeStatus,
  type IndexSearchCapabilities,
  type IndexSearchHealth,
  type IndexSearchHit,
  type IndexSearchParams,
  type IndexSearchReadiness,
  IndexSearchReadiness as IndexSearchReadinessSchema,
  IndexSearchResponse,
  type IndexSearchResult,
  type IndexSearchState,
  type IndexSession,
  IndexSessionResponse,
  type IndexSessionRow,
  IndexSessionsResponse,
  type IndexSessionsResult,
  type IndexStatus,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";
import { ROSETTAD_UNCONFIGURED, type RosettadSupervisor } from "./rosettad-supervisor";

// The agent index through fieldd (AR-1; thinking-ar-data-topology.md
// AR-D17/D18/D19): the enrollment RECORD this user's consent lives in, and the
// SERVICE behind the `index.*` doors.
//
// The record (`users/<fuid>/index/enrollment.json`, LAYOUT.INDEX_ENROLLMENT_FILE)
// is VibeField's truth for "what this user consented to" and "which persona
// maps to which runtime" — and, byte for byte, rosettad's `--enroll` input.
// fieldd publishes it BEFORE every spawn and restarts the daemon when it
// changes (RO-2's start-time scoping: live mutation and rediscover are
// rosetta's open decisions; `RosettadSupervisor.requestRestart` is ours and
// cheap). rosetta's own `enabled` flags are the cache the daemon derives from
// the file on every start (RO-2c: the file is authoritative).
//
// What the record must never contain: anything the daemon refuses at start
// (a refusal is a non-zero exit before the daemon binds, and the supervisor
// would retry it into a permanent "failed"). So the store validates every
// managed root the way rosetta does — absolute, an existing directory, not a
// duplicate — and a root that has gone missing is retired at publish time
// with a logged reason rather than handed to the daemon.
//
// What the doors must never carry: the daemon's loopback origin (EL7 —
// rosettad is unauthenticated; the origin is the secret and stays in
// RosettadState) and an enrolled root's path (a persona is named by its
// profile id; where fieldd keeps its root is fieldd's business).

const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;

// AR-5e — the find sheet's two questions. The numbers are the reference
// client's (puppeteer `apps/godview/src/main/history-search.ts`), which is the
// client these doors replace for VibeField: one ask per 64 native ids, the
// list's own limit well above a chunk, 300 hits a keystroke, and a hard
// ceiling on the per-hit root lookups a stranger-heavy answer can provoke.
const SESSION_LOOKUP_CHUNK = 64;
const SESSION_LIST_LIMIT = 1_000;
/** the AR-4 single-id lookup's limit, unchanged: one native id, its children */
const SESSION_FACTS_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 300;
const MAX_ROOT_LOOKUPS_PER_SEARCH = 32;
/** rosetta 18 added `sessions=` (the scope) and `prefix=` (fragment widening) */
const SESSION_SCOPE_PROTOCOL = 18;

export interface EnrollmentStoreOptions {
  /** the record's absolute path (LAYOUT.INDEX_ENROLLMENT_FILE under the user root) */
  path: string;
  now?: () => Date;
  logger?: Logger;
}

export interface EnrollRuntimeSpec {
  kind: string;
  /** the persona's OBSERVATION root (puppeteer PU-7), absolute */
  dataRoot: string;
  label?: string | undefined;
  profileId?: string | undefined;
}

function emptyRecord(): IndexEnrollmentRecord {
  return { format: 1, enabled_kinds: [], runtimes: [], retired: [] };
}

function sameRuntime(
  a: { kind: string; data_root: string },
  b: { kind: string; data_root: string },
) {
  return a.kind === b.kind && a.data_root === b.data_root;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The enrollment record: loaded once at construction, mutated in memory by
 * the doors, published to disk atomically (temp + rename, 0600) before every
 * rosettad spawn and after every change. */
export class EnrollmentStore {
  private record: IndexEnrollmentRecord;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(private readonly opts: EnrollmentStoreOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
    this.record = this.load();
  }

  path(): string {
    return this.opts.path;
  }

  /** a deep copy — callers never hold the live record */
  snapshot(): IndexEnrollmentRecord {
    return structuredClone(this.record);
  }

  /** The projection (no paths) every product client may see. */
  summary(): IndexEnrollmentSummary {
    const r = this.record;
    return {
      enabledKinds: [...r.enabled_kinds],
      runtimes: r.runtimes.map((rt) => ({
        kind: rt.kind,
        ...(rt.label !== undefined ? { label: rt.label } : {}),
        ...(rt.profile_id !== undefined ? { profileId: rt.profile_id } : {}),
      })),
      retired: (r.retired ?? []).map((rt) => ({
        kind: rt.kind,
        ...(rt.label !== undefined ? { label: rt.label } : {}),
        ...(rt.profile_id !== undefined ? { profileId: rt.profile_id } : {}),
        retiredAt: rt.retired_at,
      })),
      updatedAt: r.updated_at ?? null,
    };
  }

  /** The record's view of one of the daemon's rows: watched (the record still
   * names it) or retired, and the persona it belongs to. */
  lookup(row: { kind: string; data_root: string }): {
    watched: boolean;
    label: string | undefined;
    profileId: string | undefined;
  } {
    const enrolled = this.record.runtimes.find((rt) => sameRuntime(rt, row));
    if (enrolled !== undefined) {
      return { watched: true, label: enrolled.label, profileId: enrolled.profile_id };
    }
    const retired = (this.record.retired ?? []).find((rt) => sameRuntime(rt, row));
    if (retired !== undefined) {
      return { watched: false, label: retired.label, profileId: retired.profile_id };
    }
    return { watched: false, label: undefined, profileId: undefined };
  }

  /** Consent for discovered kinds — the COMPLETE set (declarative). Returns
   * whether the record changed. */
  setEnabledKinds(kinds: readonly string[]): boolean {
    const next = [...new Set(kinds.map((k) => AgentKind.parse(k)))].sort();
    const current = [...this.record.enabled_kinds].sort();
    if (next.length === current.length && next.every((k, i) => k === current[i])) return false;
    this.record.enabled_kinds = next;
    this.touch();
    return true;
  }

  /** Withdraw consent for one discovered kind (rows stay, AR-D19). */
  retireKind(kind: string): boolean {
    if (!this.record.enabled_kinds.includes(kind)) return false;
    this.record.enabled_kinds = this.record.enabled_kinds.filter((k) => k !== kind);
    this.touch();
    return true;
  }

  /** Enroll a managed root (a persona's observation root). Validates what the
   * daemon validates; throws on what the daemon would refuse. A root that was
   * retired earlier is simply enrolled again (its rows were never purged). */
  enrollRuntime(spec: EnrollRuntimeSpec): boolean {
    const kind = AgentKind.parse(spec.kind);
    const dataRoot = AbsoluteDataRoot.parse(spec.dataRoot);
    if (!isDirectory(dataRoot)) {
      throw new Error(`enrollment: data_root is not an existing directory: ${dataRoot}`);
    }
    const entry = { kind, data_root: dataRoot };
    const existing = this.record.runtimes.find((rt) => sameRuntime(rt, entry));
    if (existing !== undefined) {
      const changed = existing.label !== spec.label || existing.profile_id !== spec.profileId;
      if (!changed) return false;
      if (spec.label !== undefined) existing.label = spec.label;
      else delete existing.label;
      if (spec.profileId !== undefined) existing.profile_id = spec.profileId;
      else delete existing.profile_id;
      this.touch();
      return true;
    }
    for (const other of this.record.runtimes) {
      if (other.data_root === dataRoot || nested(other.data_root, dataRoot)) {
        throw new Error(
          `enrollment: ${dataRoot} duplicates or nests with the enrolled root ${other.data_root}`,
        );
      }
    }
    this.record.retired = (this.record.retired ?? []).filter((rt) => !sameRuntime(rt, entry));
    this.record.runtimes.push({
      ...entry,
      ...(spec.label !== undefined ? { label: spec.label } : {}),
      ...(spec.profileId !== undefined ? { profile_id: spec.profileId } : {}),
    });
    this.touch();
    return true;
  }

  /** Retire a managed root: watch off, rows kept, the persona still named
   * (AR-D19). Purge is a separate act (RO-8). */
  retireRuntime(row: { kind: string; data_root: string }): boolean {
    const at = this.record.runtimes.findIndex((rt) => sameRuntime(rt, row));
    if (at === -1) return false;
    const [entry] = this.record.runtimes.splice(at, 1);
    this.record.retired = [
      ...(this.record.retired ?? []).filter((rt) => !sameRuntime(rt, row)),
      {
        ...(entry as IndexEnrollmentRecord["runtimes"][number]),
        retired_at: this.now().toISOString(),
      },
    ];
    this.touch();
    return true;
  }

  /** Write the record to disk — atomically, 0600, the directory created. Called
   * before every spawn (so `--enroll` always names a file the daemon accepts)
   * and after every change. A managed root that no longer exists is retired
   * here with a logged reason: the daemon would refuse it, and a refusal is a
   * dead daemon. */
  publish(): void {
    const missing = this.record.runtimes.filter((rt) => !isDirectory(rt.data_root));
    for (const rt of missing) {
      this.logger.warn("fieldd.index.enrollment_root_missing", "Enrolled root is gone; retired", {
        kind: rt.kind,
        ...(rt.profile_id !== undefined ? { profileId: rt.profile_id } : {}),
      });
      this.retireRuntime(rt);
    }
    const bytes = `${JSON.stringify(this.record, null, 2)}\n`;
    mkdirSync(dirname(this.opts.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.opts.path}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o600 });
    durableRenameSync(tmp, this.opts.path);
  }

  private touch(): void {
    this.record.updated_at = this.now().toISOString();
  }

  private load(): IndexEnrollmentRecord {
    let text: string;
    try {
      text = readFileSync(this.opts.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRecord();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = IndexEnrollmentRecordSchema.safeParse(parsed);
    if (record.success) return { retired: [], ...record.data };
    // An unreadable record is set aside, never handed to the daemon (it would
    // refuse it) and never silently overwritten: the user's consent is asked
    // again, and the bytes stay for a human to look at.
    const aside = `${this.opts.path}.unreadable-${Date.now()}`;
    this.logger.error(
      "fieldd.index.enrollment_unreadable",
      "Enrollment record is unreadable; set aside, starting from an empty record",
      undefined,
      { aside, issue: record.success ? "invalid json" : (record.error.issues[0]?.message ?? "?") },
    );
    try {
      renameSync(this.opts.path, aside);
    } catch {
      // nothing more to do: publish() will overwrite it
    }
    return emptyRecord();
  }
}

function nested(a: string, b: string): boolean {
  const sep = a.includes("\\") ? "\\" : "/";
  return (
    a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`) ||
    b.startsWith(a.endsWith(sep) ? a : `${a}${sep}`)
  );
}

export interface IndexServiceOptions {
  /** null = no daemon configured (FIELDD_ROSETTAD_BIN empty); the record still exists */
  supervisor: RosettadSupervisor | null;
  store: EnrollmentStore;
  /** the wire version fieldd speaks (`@rosetta/protocol` PROTOCOL_VERSION);
   * every answer is checked against it (the daemon's header) */
  expectedProtocolVersion: number;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  logger?: Logger;
}

/** The `index.*` doors' service: reads fold the daemon's answers with the
 * record; mutations rewrite the record, publish it, and restart the daemon
 * when something changed. Auditing is the caller's (the daemon wraps the
 * mutations in `audit.required`). */
/** AR-4 — what the index says about one native session (see
 * `IndexService.sessionByNativeId`). Timestamps are rosetta's epoch ms. */
export interface IndexSessionFacts {
  /** rosetta's canonical session id */
  id: string;
  nativeSessionId: string;
  /** Timestamped conversation evidence; null until rosetta has read some —
   * and null when what it read is nonsense (bounds that contradict each
   * other). Epoch ms, always FINITE (the schema refuses a body whose stamps
   * are not), but NOT necessarily in the past: rosetta derives these from the
   * provider's own records, so a skewed clock can date a message in the
   * FUTURE. A caller must not read a future stamp as idle — `now - lastAt`
   * goes NEGATIVE there, younger than any threshold; test `lastAt <= now`
   * explicitly rather than trusting the subtraction's sign. */
  activity: { firstAt: number; lastAt: number } | null;
  /** rosetta's ingest state for the session's source (open vocabulary) */
  streamState: string;
}

/** The `/api/sessions` envelope's OWN keys, read off the schema so the two
 * can never drift apart: everything else at that level is unknown-field news. */
const SESSIONS_BODY_KEYS = Object.keys(IndexSessionsResponse.shape);
/** the same, for `/api/search` (AR-5e) */
const SEARCH_BODY_KEYS = Object.keys(IndexSearchResponse.shape);

export class IndexService {
  private readonly logger: Logger;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  /** the roll call as a join table, per daemon generation (see kindsByLayoutRoot) */
  private rollCall: { pid: number | null; kinds: ReadonlyMap<string, string> } | null = null;
  /** the tolerant reader's logging half: `<shape>.<key>` said once, ever */
  private readonly seenUnknownFields = new Set<string>();

  constructor(private readonly opts: IndexServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** The honest picture: the folded phase, the daemon projection, the record,
   * and every runtime the daemon lists (none until it is ready). */
  async status(): Promise<IndexStatus> {
    const health = this.opts.supervisor?.health() ?? ROSETTAD_UNCONFIGURED;
    const enrollment = this.opts.store.summary();
    if (health.phase !== "ready") {
      return {
        phase: foldPhase(health.phase),
        rosettad: { ...health },
        enrollment,
        runtimes: [],
        // AR-5e — the find sheet's foot is honest before the daemon is: not
        // reachable, and the reason is the phase itself
        search: {
          reachable: false,
          capabilities: this.searchCapabilities(),
          detail: `the agent index is ${health.phase}`,
        },
      };
    }
    const [status, runtimes] = await Promise.all([
      this.get<StatusResponse>("/api/status"),
      this.get<RuntimesResponse>("/api/runtimes"),
    ]);
    const daemon: DaemonStatus | null = status.daemon ?? null;
    const backfills = new Map<string, RuntimeBackfill>();
    for (const b of daemon?.ingest?.runtimes ?? [])
      if (b.runtime_id) backfills.set(b.runtime_id, b);
    const lives = new Map<string, RuntimeIngestStatus>();
    for (const l of daemon?.runtimes ?? []) if (l.runtime_id) lives.set(l.runtime_id, l);
    return {
      phase: foldPhase(daemon?.ingest?.phase ?? "unknown"),
      rosettad: { ...health },
      enrollment,
      runtimes: runtimes.runtimes.map((row) =>
        this.projectRuntime(row, backfills.get(row.id), lives.get(row.id)),
      ),
      // AR-5e — folded from the SAME `/api/status` read; the search
      // projection's readiness is its own question, never the ingest phase
      search: this.foldSearchHealth(status),
    };
  }

  /** The roll call: what discovery found in the OS user's home (census facts,
   * never content), with THIS user's consent from the record. Managed roots
   * are absent by construction. */
  async discoveries(): Promise<IndexDiscoveriesResult> {
    this.requireReady();
    const census = await this.get<DiscoveriesResponse>("/api/discoveries");
    const consented = new Set(this.opts.store.snapshot().enabled_kinds);
    return {
      discoveries: census.discoveries.map((row) => ({
        kind: row.kind,
        dataRoot: row.data_root,
        installed: row.installed,
        files: Number(row.files),
        bytes: Number(row.bytes),
        newestModifiedMs: Number(row.newest_modified_ms),
        consented: consented.has(row.kind),
      })),
    };
  }

  /** Declare the complete consented set of discovered kinds. */
  async enroll(kinds: readonly string[]): Promise<IndexMutationResult> {
    const changed = this.opts.store.setEnabledKinds(kinds);
    return await this.settle(changed);
  }

  /** Stop watching one runtime the daemon lists; its rows stay (AR-D19). */
  async retire(runtimeId: string): Promise<IndexMutationResult> {
    this.requireReady();
    const { runtimes } = await this.get<RuntimesResponse>("/api/runtimes");
    const row = runtimes.find((r) => r.id === runtimeId);
    if (row === undefined) {
      throw new RpcCallError("NOT_FOUND", `no runtime ${runtimeId} in this user's index`, false, {
        runtimeId,
      });
    }
    const changed = isEnrolledRow(row)
      ? this.opts.store.retireRuntime(row)
      : this.opts.store.retireKind(row.kind);
    return await this.settle(changed);
  }

  /** Enroll a managed root — the persona path (AR-2 calls it with puppeteer's
   * `observationRoot(profile)`, never `dataRoot`). */
  async enrollRuntime(spec: EnrollRuntimeSpec): Promise<IndexMutationResult> {
    return await this.enrollRuntimes([spec]);
  }

  /** Enroll several managed roots and settle ONCE (the boot reconcile: every
   * persona the record does not name yet, one publish, one bounce). A spec the
   * store refuses (a vanished or nested root) is logged and skipped — the
   * others still land; the record never carries what the daemon refuses. */
  async enrollRuntimes(specs: readonly EnrollRuntimeSpec[]): Promise<IndexMutationResult> {
    let changed = false;
    for (const spec of specs) {
      try {
        changed = this.opts.store.enrollRuntime(spec) || changed;
      } catch (error) {
        this.logger.warn("fieldd.index.enroll_refused", "Managed root not enrolled", {
          kind: spec.kind,
          ...(spec.profileId !== undefined ? { profileId: spec.profileId } : {}),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return await this.settle(changed);
  }

  /** Retire a managed root the RECORD names — the persona path's other half
   * (AR-D19: watch off, rows kept, the persona still named). Needs no daemon:
   * the record is the truth and the next start reads it. */
  async retireEnrolled(spec: { kind: string; dataRoot: string }): Promise<IndexMutationResult> {
    const changed = this.opts.store.retireRuntime({ kind: spec.kind, data_root: spec.dataRoot });
    return await this.settle(changed);
  }

  /** The record as it stands (a copy) — what a reconcile compares personas
   * against. Internal to fieldd: it carries the managed roots' paths. */
  record(): IndexEnrollmentRecord {
    return this.opts.store.snapshot();
  }

  /** The roll call as a JOIN TABLE: rosetta's kind for each layout root in its
   * `~/…` spelling. A persona's provider maps to a kind through it — puppeteer
   * names the provider's native layout root (PU-7's observation root of the
   * native-default profile), folded to the same spelling — so neither sibling's
   * registry is ever enumerated here (design-01 §1: the registries are theirs,
   * read at the seam). Cached per daemon generation. EMPTY while the daemon is
   * not ready or does not answer: a caller degrades to "not indexed yet" and
   * the next ready re-applies (topology R4), rather than failing the persona. */
  async kindsByLayoutRoot(): Promise<ReadonlyMap<string, string>> {
    const health = this.opts.supervisor?.health() ?? ROSETTAD_UNCONFIGURED;
    if (health.phase !== "ready") return new Map();
    if (this.rollCall !== null && this.rollCall.pid === health.pid) return this.rollCall.kinds;
    try {
      const census = await this.get<DiscoveriesResponse>("/api/discoveries");
      const kinds = new Map(census.discoveries.map((row) => [row.data_root, row.kind]));
      this.rollCall = { pid: health.pid, kinds };
      return kinds;
    } catch {
      return new Map();
    }
  }

  /** The daemon's runtime ids keyed by root — an enrolled row by its absolute
   * root (what fieldd enrolled), a discovered one by its `~` form. EMPTY while
   * the daemon is not ready or does not answer (a persona then simply carries
   * no `runtimeId`). */
  async runtimeIdsByRoot(): Promise<ReadonlyMap<string, string>> {
    const health = this.opts.supervisor?.health() ?? ROSETTAD_UNCONFIGURED;
    if (health.phase !== "ready") return new Map();
    try {
      const { runtimes } = await this.get<RuntimesResponse>("/api/runtimes");
      return new Map(runtimes.map((row) => [row.data_root, row.id]));
    } catch {
      return new Map();
    }
  }

  /** Publish the record and, when it changed, bounce the daemon so it reads
   * the new file (RO-2's start-time scoping). Awaits the new generation's
   * readiness (or its honest failure) so the answer's status is current. */
  private async settle(changed: boolean): Promise<IndexMutationResult> {
    if (changed) {
      this.opts.store.publish();
      this.logger.info("fieldd.index.enrollment_changed", "Enrollment record rewritten", {
        enabledKinds: this.opts.store.snapshot().enabled_kinds.length,
        runtimes: this.opts.store.snapshot().runtimes.length,
      });
      await this.opts.supervisor?.requestRestart();
    }
    return { changed, status: await this.status() };
  }

  private projectRuntime(
    row: RuntimeRow,
    backfill: RuntimeBackfill | undefined,
    live: RuntimeIngestStatus | undefined,
  ): IndexRuntimeStatus {
    const enrolled = isEnrolledRow(row);
    const known = this.opts.store.lookup(row);
    const watched = enrolled
      ? known.watched
      : this.opts.store.snapshot().enabled_kinds.includes(row.kind);
    const label = enrolled ? (known.label ?? row.label ?? undefined) : undefined;
    return {
      runtimeId: row.id,
      kind: row.kind,
      provenance: enrolled ? "enrolled" : "discovered",
      // a discovered root is the layout's `~` form; an enrolled root's path
      // stays inside fieldd (the persona is named by profileId)
      ...(enrolled ? {} : { dataRoot: row.data_root }),
      ...(label !== undefined ? { label } : {}),
      ...(enrolled && known.profileId !== undefined ? { profileId: known.profileId } : {}),
      watched,
      ...(backfill !== undefined
        ? {
            backfill: {
              state: backfill.state,
              filesTotal: Number(backfill.files_total),
              bytesTotal: Number(backfill.bytes_total),
              filesSkimmed: Number(backfill.files_skimmed),
              bytesStreamed: Number(backfill.bytes_streamed),
              sessionsTotal: Number(backfill.sessions_total),
              records: Number(backfill.records),
            },
          }
        : {}),
      ...(live !== undefined
        ? {
            live: {
              events: Number(live.events),
              liveRows: Number(live.live_rows),
              lastActivityMs: live.last_activity_ms === null ? null : Number(live.last_activity_ms),
            },
          }
        : {}),
    };
  }

  private requireReady(): void {
    const health = this.opts.supervisor?.health() ?? ROSETTAD_UNCONFIGURED;
    if (health.phase !== "ready") {
      throw new RpcCallError(
        "UNAVAILABLE",
        `the agent index is ${health.phase}${health.detail ? `: ${health.detail}` : ""}`,
        health.phase !== "unconfigured",
        { service: "index", state: health.phase },
      );
    }
  }

  /** AR-4 — the index's facts about ONE provider-native session (the spine
   * id every repo joins on): whether rosetta knows it, and when its
   * conversation last moved. Read by resume-when-idle, which resumes a
   * pending run only on this evidence — never on the absence of it. The
   * canonical row is preferred when the native id resolves to a thread
   * (`root_session_id == id`); undefined when the index has never read it.
   *
   * The one read on this service whose body is PARSED rather than cast: the
   * answer ends in a TERMINATE (resume-when-idle replaces the pending run's
   * PTY), and a cast is a shape TypeScript merely believes. A body the reader
   * cannot vouch for is UNAVAILABLE {state:"malformed"} — an honest degraded
   * state that reads as "not idle", never a silent `undefined`. */
  async sessionByNativeId(nativeSessionId: string): Promise<IndexSessionFacts | undefined> {
    this.requireReady();
    // the id is ONE query value here (encoded) and is matched AGAIN below,
    // because the server reads the parameter as a comma-separated selector
    // list: an id that carries a comma must never widen the answer to a
    // session this run is not about.
    const sessions = await this.fetchSessionRows([nativeSessionId], SESSION_FACTS_LIMIT);
    const rows = sessions.filter((row) => row.native_session_id === nativeSessionId);
    const row = rows.find((candidate) => candidate.root_session_id === candidate.id) ?? rows[0];
    if (row === undefined) return undefined;
    // bounds that contradict each other are NOT evidence: a reader that
    // believed them would be deciding a terminate on nonsense.
    const bounds = row.activity;
    const activity =
      bounds !== null && bounds.first_at <= bounds.last_at
        ? { firstAt: bounds.first_at, lastAt: bounds.last_at }
        : null;
    if (bounds !== null && activity === null) {
      this.logger.debug(
        "fieldd.index.activity_nonsense",
        "A session's activity bounds contradict each other; read as no evidence",
        { session: row.id },
      );
    }
    return {
      id: row.id,
      nativeSessionId: row.native_session_id,
      activity,
      streamState: row.stream_state,
    };
  }

  // ── AR-5e — the find sheet's two doors ─────────────────────────────────
  //
  // One keystroke is TWO asks, the way the reference client asks them: the
  // facts lookup resolves the live runs' CANONICAL ids, and the search is
  // scoped by those (rosetta widens each to its subagent tree, so a hit inside
  // a delegated child still answers for the root the reader navigates to).
  // Both answer projections; the daemon's origin stays inside fieldd (EL7).

  /** `index.sessions` — what the index knows about these live runs, by the
   * provider-native id every repo joins on. The ask is CHUNKED (the server
   * reads `native_session_id` as a comma-separated selector list, and a
   * keystroke can name every agent on the board) and the answers merged into
   * one set of rows, in the caller's order. A native id the index has never
   * read is simply ABSENT: a placeholder row would read as "known and empty",
   * and the sheet would offer a session rosetta cannot open. */
  async sessions(nativeSessionIds: readonly string[]): Promise<IndexSessionsResult> {
    this.requireReady();
    const wanted = [...new Set(nativeSessionIds)].filter((id) => id !== "");
    if (wanted.length === 0) return { rows: [] };
    const byNative = await this.rowsByNativeId(wanted);
    return {
      rows: wanted.flatMap((id) => {
        const row = byNative.get(id);
        return row === undefined ? [] : [projectSession(row)];
      }),
    };
  }

  /** `index.search` — one question over the transcript history, scoped to the
   * live runs a reader can jump to.
   *
   * A daemon that cannot answer is `answered: false` with the reason in its
   * state — NEVER an empty success: "no matches" is a claim about the history,
   * and a building projection, an unreachable daemon or a readiness this build
   * does not know have made no such claim (rosetta's own rule, and the reason
   * its `SearchState` exists). The one thing that still refuses is a body
   * fieldd cannot vouch for: that is UNAVAILABLE {state:"malformed"}, the same
   * answer `sessionByNativeId` gives. */
  async search(params: IndexSearchParams): Promise<IndexSearchResult> {
    const health = this.opts.supervisor?.health() ?? ROSETTAD_UNCONFIGURED;
    if (health.phase !== "ready") {
      return unansweredSearch({
        readiness: "unknown",
        detail: `the agent index is ${health.phase}`,
      });
    }
    const capabilities = this.searchCapabilities();
    if (!capabilities.sessionScope) {
      // Unreachable against a pinned pair: `getBody` refuses any protocol but
      // the one fieldd speaks, so a daemon without the session scope never
      // gets this far. Kept because the capability is projected and must not
      // be decoration — if the pin ever moved below 18, the honest answer is
      // that this build cannot ask the question, not a silently unscoped
      // search across every session the index holds.
      return unansweredSearch({
        readiness: "unknown",
        detail: `the agent index speaks protocol ${this.opts.expectedProtocolVersion}, which has no session scope`,
      });
    }

    const scope = [...new Set(params.nativeSessionIds ?? [])].filter((id) => id !== "");
    const scoped = scope.length > 0;
    /** every row this call has seen, by canonical id (the facts lookup's rows
     * and any root a hit made us resolve) — the call's own cache */
    const known = new Map<string, IndexSessionRow>();
    /** the roots the question is scoped to, by canonical id */
    const roots = new Map<string, IndexSessionRow>();
    if (scoped) {
      let byNative: Map<string, IndexSessionRow>;
      try {
        byNative = await this.rowsByNativeId(scope);
      } catch (error) {
        return this.searchFailure(error);
      }
      for (const row of byNative.values()) known.set(row.id, row);
      for (const row of byNative.values()) {
        const root = row.root_session_id === row.id ? row : (known.get(row.root_session_id) ?? row);
        roots.set(root.id, root);
      }
      if (roots.size === 0) return await this.scopeUnknown();
    }

    const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
    const query = new URLSearchParams({ q: params.q });
    if (scoped) query.set("sessions", [...roots.keys()].join(","));
    query.set("prefix", String(params.prefix ?? true));
    query.set("limit", String(limit));
    if (params.afterMs !== undefined) query.set("after_ts", String(params.afterMs));
    if (params.kind !== undefined) query.set("kind", params.kind);

    let body: unknown;
    try {
      body = await this.getBody(`/api/search?${query.toString()}`);
    } catch (error) {
      return this.searchFailure(error);
    }
    const parsed = IndexSearchResponse.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.logger.warn(
        "fieldd.index.search_malformed",
        "The index answered search hits fieldd cannot read",
        { issue: issue === undefined ? "?" : `${issue.path.join(".")}: ${issue.message}` },
      );
      throw new RpcCallError("UNAVAILABLE", "the agent index answered a malformed search", true, {
        service: "index",
        state: "malformed",
      });
    }
    this.noteUnknownFields("search", body, SEARCH_BODY_KEYS);
    const progress = foldSearchProgress(parsed.data.state.progress);
    const state: IndexSearchState = {
      readiness: IndexSearchReadinessSchema.parse(parsed.data.state.readiness),
      ...(progress !== undefined ? { progress } : {}),
    };
    if (!answersSearch(state.readiness)) {
      return unansweredSearch({
        ...state,
        detail: `the index's search projection is ${state.readiness}`,
      });
    }

    // the daemon stopped at its limit, so some sessions may be under-reported
    let clipped = parsed.data.hits.length >= limit;
    const hits: IndexSearchHit[] = [];
    const budget = { remaining: MAX_ROOT_LOOKUPS_PER_SEARCH };
    for (const hit of parsed.data.hits) {
      let root = roots.get(hit.session_id);
      if (root === undefined) {
        // a hit inside a delegated child: walk it up to the root a reader
        // navigates to, within the call's budget
        root = await this.rootOf(hit.session_id, known, budget);
        if (root === undefined) clipped = true;
        // a scoped question never answers outside its scope
        if (scoped && (root === undefined || !roots.has(root.id))) continue;
      }
      const at = hit.at;
      hits.push({
        sessionId: hit.session_id,
        rootSessionId: root?.id ?? hit.session_id,
        ...(root !== undefined && root.native_session_id !== ""
          ? { nativeSessionId: root.native_session_id }
          : {}),
        ...(root?.title ? { title: root.title } : {}),
        timelineId: hit.timeline_id,
        kind: hit.kind,
        ...(typeof at === "number" ? { at } : {}),
        snippet: hit.snippet,
      });
    }
    return { answered: true, state, hits, clipped };
  }

  /** A scoped question whose live runs the index has never read. A session
   * list carries no readiness, so an empty scope is not yet an answer: ask
   * the daemon, and only a serveable canonical projection whose search
   * readiness answers turns "I know none of these" into an honest
   * answered-and-empty. Anything else stays unanswered and the sheet keeps
   * what it last showed. */
  private async scopeUnknown(): Promise<IndexSearchResult> {
    let health: IndexSearchHealth;
    try {
      health = this.foldSearchHealth(await this.get<StatusResponse>("/api/status"));
    } catch (error) {
      return this.searchFailure(error);
    }
    const answered = health.canonicalReady === true && answersSearch(health.readiness);
    const state: IndexSearchState = {
      readiness: health.readiness ?? "unknown",
      ...(health.canonicalReady !== undefined ? { canonicalReady: health.canonicalReady } : {}),
      ...(health.progress !== undefined ? { progress: health.progress } : {}),
      detail: answered
        ? "none of these sessions are in the history index yet"
        : "the index has not read these sessions yet",
    };
    return { answered, state, hits: [], clipped: false };
  }

  /** A failed leg of a search. A daemon that could not answer is an honest
   * `answered: false`; a body fieldd cannot vouch for is not an answer at all
   * and stays a refusal (as does anything that is not a call failure). The
   * sentence is derived from the STATE, never from the failed URL: a detail
   * built out of the path would carry the reader's own query into a foot, and
   * the origin must never leave fieldd at all (EL7). */
  private searchFailure(error: unknown): IndexSearchResult {
    if (!(error instanceof RpcCallError)) throw error;
    const details = error.details;
    const state =
      typeof details === "object" && details !== null && "state" in details
        ? String((details as { state: unknown }).state)
        : "unreachable";
    if (state === "malformed") throw error;
    const detail =
      state === "unreachable"
        ? "the agent index did not answer"
        : state === "error"
          ? "the agent index refused the question"
          : state === "incompatible"
            ? "the agent index speaks a protocol this build does not"
            : `the agent index is ${state}`;
    return unansweredSearch({ readiness: "unknown", detail });
  }

  /** What this pinned pair can do. Not a negotiation: `getBody` refuses any
   * protocol but the one fieldd speaks, so these are facts about the version
   * in the manifest. */
  private searchCapabilities(): IndexSearchCapabilities {
    const speaks = this.opts.expectedProtocolVersion >= SESSION_SCOPE_PROTOCOL;
    return { sessionScope: speaks, prefix: speaks };
  }

  /** The find sheet's foot, folded from a `/api/status` body. Read
   * TOLERANTLY: this body is cast rather than parsed (nothing destructive
   * hangs off it), so a field that is not what the generated type promises
   * degrades the foot instead of throwing — an unheard-of readiness folds to
   * `unknown`, which does not answer. */
  private foldSearchHealth(status: StatusResponse): IndexSearchHealth {
    const search: unknown = (status as { search?: unknown }).search;
    const readiness = IndexSearchReadinessSchema.parse(
      typeof search === "object" && search !== null
        ? (search as { readiness?: unknown }).readiness
        : undefined,
    );
    const progress = foldSearchProgress(
      typeof search === "object" && search !== null
        ? (search as { progress?: unknown }).progress
        : undefined,
    );
    const canonicalReady: unknown = (status as { canonical_ready?: unknown }).canonical_ready;
    return {
      reachable: true,
      capabilities: this.searchCapabilities(),
      ...(typeof canonicalReady === "boolean" ? { canonicalReady } : {}),
      readiness,
      ...(progress !== undefined ? { progress } : {}),
    };
  }

  /** The rows for a set of native ids, chunked and merged. */
  private async rowsByNativeId(
    nativeSessionIds: readonly string[],
  ): Promise<Map<string, IndexSessionRow>> {
    const wanted = new Set(nativeSessionIds);
    const found = new Map<string, IndexSessionRow>();
    for (let start = 0; start < nativeSessionIds.length; start += SESSION_LOOKUP_CHUNK) {
      const chunk = nativeSessionIds.slice(start, start + SESSION_LOOKUP_CHUNK);
      for (const row of await this.fetchSessionRows(chunk, SESSION_LIST_LIMIT)) {
        // the server reads the parameter as a SELECTOR LIST, so a row is only
        // this ask's if its native id is one the ask actually named
        if (!wanted.has(row.native_session_id)) continue;
        const held = found.get(row.native_session_id);
        // a native id can name a delegated child as well as its root; the row
        // a reader navigates to wins (the rule `sessionByNativeId` decides on)
        const better =
          held === undefined ||
          (held.root_session_id !== held.id && row.root_session_id === row.id);
        if (better) found.set(row.native_session_id, row);
      }
    }
    return found;
  }

  /** `/api/sessions?native_session_id=…` — PARSED, never cast: these rows are
   * the evidence a terminate rides on (AR-4) and the identity a sheet joins
   * on, and a body the reader cannot vouch for is an honest UNAVAILABLE. */
  private async fetchSessionRows(
    nativeSessionIds: readonly string[],
    limit: number,
  ): Promise<IndexSessionRow[]> {
    const selector = encodeURIComponent(nativeSessionIds.join(","));
    const body = await this.getBody(`/api/sessions?native_session_id=${selector}&limit=${limit}`);
    const parsed = IndexSessionsResponse.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.logger.warn(
        "fieldd.index.sessions_malformed",
        "The index answered session rows fieldd cannot read",
        { issue: issue === undefined ? "?" : `${issue.path.join(".")}: ${issue.message}` },
      );
      throw new RpcCallError(
        "UNAVAILABLE",
        "the agent index answered malformed session rows",
        true,
        {
          service: "index",
          state: "malformed",
        },
      );
    }
    this.noteUnknownFields("sessions", body, SESSIONS_BODY_KEYS);
    return parsed.data.sessions;
  }

  /** The root a hit's session rolls up to, within the call's budget. */
  private async rootOf(
    sessionId: string,
    known: Map<string, IndexSessionRow>,
    budget: { remaining: number },
  ): Promise<IndexSessionRow | undefined> {
    const row = await this.sessionRow(sessionId, known, budget);
    if (row === undefined || row.root_session_id === row.id) return row;
    return await this.sessionRow(row.root_session_id, known, budget);
  }

  /** One session by canonical id, cached for the call and BOUNDED: an answer
   * full of strangers must not turn one keystroke into hundreds of round
   * trips. Unresolvable is an ANSWER here — the hit rides without a join key
   * and the result says it was clipped — never a refusal: the search itself
   * answered, and this leg only decorates it. */
  private async sessionRow(
    sessionId: string,
    known: Map<string, IndexSessionRow>,
    budget: { remaining: number },
  ): Promise<IndexSessionRow | undefined> {
    const held = known.get(sessionId);
    if (held !== undefined) return held;
    if (budget.remaining <= 0) return undefined;
    budget.remaining -= 1;
    let body: unknown;
    try {
      body = await this.getBody(`/api/sessions/${encodeURIComponent(sessionId)}`);
    } catch {
      // a session the index does not hold answers 404; either way this hit
      // simply carries no root
      return undefined;
    }
    const parsed = IndexSessionResponse.safeParse(body);
    if (!parsed.success || parsed.data.session.id !== sessionId) return undefined;
    known.set(parsed.data.session.id, parsed.data.session);
    return parsed.data.session;
  }

  /** One GET against the daemon's loopback origin — read from the supervisor's
   * STATE here and nowhere else, never handed on. A protocol header that is
   * not ours is the wrong binary (INCOMPATIBLE, not retryable); a body that is
   * not JSON at all is an honest UNAVAILABLE {state:"malformed"}, never a raw
   * SyntaxError out of a door. The body comes back UNPARSED — what to make of
   * it is the caller's (`get` casts; `sessionByNativeId` parses). */
  private async getBody(path: string): Promise<unknown> {
    const state = this.opts.supervisor?.state();
    const origin = state?.origin ?? null;
    if (origin === null) {
      throw new RpcCallError("UNAVAILABLE", "the agent index has no origin yet", true, {
        service: "index",
        state: state?.phase ?? "unconfigured",
      });
    }
    let response: Response;
    try {
      response = await this.fetchFn(`${origin}${path}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      this.logger.warn("fieldd.index.unreachable", "Index daemon did not answer", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new RpcCallError("UNAVAILABLE", `the agent index did not answer ${path}`, true, {
        service: "index",
        state: "unreachable",
      });
    }
    const version = response.headers.get("x-rosetta-protocol-version");
    if (version !== String(this.opts.expectedProtocolVersion)) {
      throw new RpcCallError(
        "INCOMPATIBLE",
        `index daemon speaks protocol ${version ?? "unknown"}, fieldd expects ${this.opts.expectedProtocolVersion}`,
        false,
        { service: "index", state: "incompatible" },
      );
    }
    if (!response.ok) {
      throw new RpcCallError(
        "UNAVAILABLE",
        `the agent index answered ${response.status} on ${path}`,
        true,
        {
          service: "index",
          state: "error",
        },
      );
    }
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      this.logger.warn(
        "fieldd.index.unreadable_body",
        "The index answered a body that is not JSON",
        { path, error: error instanceof Error ? error.message : String(error) },
      );
      throw new RpcCallError(
        "UNAVAILABLE",
        `the agent index answered an unreadable body on ${path}`,
        true,
        { service: "index", state: "malformed" },
      );
    }
  }

  /** The reads that are CAST, not parsed: the status, the roll call, the
   * runtime rows. Nothing destructive hangs off them — a shape that drifts
   * degrades a projection, and `index.status` is where that shows. The session
   * rows do NOT come through here (AR-4 review; see `sessionByNativeId`). */
  private async get<T>(path: string): Promise<T> {
    return (await this.getBody(path)) as T;
  }

  /** The tolerant reader's logging half at this seam: keys this build has
   * never heard of, said ONCE per shape and key, at debug. Cheap by
   * construction — a Set, and only the ENVELOPE's keys: rosetta's rows are
   * deliberately wider than fieldd's reading of them, so a column fieldd does
   * not read is not drift, and naming it every poll would be noise. */
  private noteUnknownFields(shape: string, body: unknown, known: readonly string[]): void {
    if (typeof body !== "object" || body === null) return;
    const fresh = Object.keys(body).filter(
      (key) => !known.includes(key) && !this.seenUnknownFields.has(`${shape}.${key}`),
    );
    if (fresh.length === 0) return;
    for (const key of fresh) this.seenUnknownFields.add(`${shape}.${key}`);
    this.logger.debug(
      "fieldd.index.unknown_fields",
      "The index answered fields this build does not read",
      { shape, keys: fresh },
    );
  }
}

/** An enrolled runtime carries an ABSOLUTE root (a discovered one, the `~`
 * form) — rosetta's own invariant; `provenance` is the decoration a daemon
 * with the file adds on top, so absence is not "discovered". */
function isEnrolledRow(row: RuntimeRow): boolean {
  return row.provenance === "enrolled" || !row.data_root.startsWith("~");
}

/** A phase neither the supervisor nor rosetta named reads as "unknown"
 * (the contract's tolerant reader). */
function foldPhase(phase: string): IndexPhase {
  return IndexPhaseSchema.parse(phase);
}

// ── AR-5e's folds ────────────────────────────────────────────────────────

/** A search readiness that may carry hits: ready, or behind but consistent.
 * Everything else — building, stale, failed, a word this build has never
 * heard of — is a daemon with NO answer, never an empty one. */
function answersSearch(readiness: IndexSearchReadiness | undefined): boolean {
  return readiness === "ready" || readiness === "catching-up";
}

function unansweredSearch(state: IndexSearchState): IndexSearchResult {
  return { answered: false, state, hits: [], clipped: false };
}

/** rosetta's build progress, narrowed to the two counters a foot shows. Both
 * must be finite numbers or there is no progress to show. */
function foldSearchProgress(value: unknown): { done: number; total: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const done = (value as { documents_done?: unknown }).documents_done;
  const total = (value as { documents_total?: unknown }).documents_total;
  if (typeof done !== "number" || !Number.isFinite(done)) return undefined;
  if (typeof total !== "number" || !Number.isFinite(total)) return undefined;
  return { done, total };
}

/** rosetta's session row → the door's answer (AR-5e). The evidence is folded
 * exactly as `sessionByNativeId` folds it — bounds that contradict each other
 * are not evidence — and a display column rosetta sent as null is simply
 * absent rather than an empty string a sheet would draw. */
function projectSession(row: IndexSessionRow): IndexSession {
  const bounds = row.activity;
  const activity =
    bounds !== null && bounds !== undefined && bounds.first_at <= bounds.last_at
      ? { firstAt: bounds.first_at, lastAt: bounds.last_at }
      : null;
  return {
    sessionId: row.id,
    nativeSessionId: row.native_session_id,
    rootSessionId: row.root_session_id,
    ...(row.title ? { title: row.title } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(typeof row.updated_at === "number" ? { updatedAt: row.updated_at } : {}),
    activity,
    streamState: row.stream_state,
  };
}
