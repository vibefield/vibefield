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
export class IndexService {
  private readonly logger: Logger;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  /** the roll call as a join table, per daemon generation (see kindsByLayoutRoot) */
  private rollCall: { pid: number | null; kinds: ReadonlyMap<string, string> } | null = null;

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
      return { phase: foldPhase(health.phase), rosettad: { ...health }, enrollment, runtimes: [] };
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

  /** One GET against the daemon's loopback origin — read from the supervisor's
   * STATE here and nowhere else, never handed on. A protocol header that is
   * not ours is the wrong binary (INCOMPATIBLE, not retryable). */
  private async get<T>(path: string): Promise<T> {
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
    return (await response.json()) as T;
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
