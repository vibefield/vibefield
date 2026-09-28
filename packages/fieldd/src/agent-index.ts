import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
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
  AGENT_CATALOG,
  type AgentCatalogEntry,
  type AgentCatalogReaders,
  AgentKind,
  createAgentCatalogReaders,
  INDEX_RECENT_DEFAULT_LIMIT,
  type IndexDiscoveriesResult,
  type IndexEnrollmentRecord,
  IndexEnrollmentRecord as IndexEnrollmentRecordSchema,
  type IndexEnrollmentSummary,
  type IndexMutationResult,
  type IndexPhase,
  IndexPhase as IndexPhaseSchema,
  type IndexProjectRow,
  IndexProjectsResponse,
  type IndexRecentParams,
  type IndexRecentResult,
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
import {
  ROSETTAD_UNCONFIGURED,
  type RosettadState,
  type RosettadSupervisor,
} from "./rosettad-supervisor";

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
/** the roll call's poll while a ready daemon has not published its census
 * yet (rosettad prints `ready` before it walks the roots): first step, then
 * doubling to the ceiling, for as long as the caller said it would wait */
const ROLL_CALL_POLL_MS = 100;
const ROLL_CALL_POLL_MAX_MS = 1_000;

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
/** A search's attribution walk fetches session rows in flights this wide: a
 * local daemon answers a row in milliseconds, and a flat sequential budget
 * (32 lookups) dropped a fifth of a 40-agent board's matches (AR-5b). */
const ROOT_LOOKUP_CONCURRENCY = 8;
/** One deadline for the whole walk, so a slow daemon clips the answer
 * rather than turning one keystroke into a minute of round trips. */
const SEARCH_ATTRIBUTION_DEADLINE_MS = 8_000;

/** A daemon path without its query string — the only form a log line or an
 * error sentence may carry: `/api/search?q=…` holds the reader's own words
 * (EL7: fieldd's log segments are readable by every same-uid agent). */
function routeOf(path: string): string {
  const at = path.indexOf("?");
  return at === -1 ? path : path.slice(0, at);
}
/** rosetta 18 added `sessions=` (the scope) and `prefix=` (fragment widening) */
const SESSION_SCOPE_PROTOCOL = 18;

// QL — `index.recent`'s two join tables (`/api/projects`, `/api/runtimes`)
// change only when the index meets a new repo or a runtime is enrolled, so a
// launcher opening in pane after pane reads them from a short cache; a MISS (a
// folder no cached project holds, a row whose runtime is not cached) re-reads
// once, but never more often than the floor below.
const RECENT_TABLE_TTL_MS = 30_000;
const RECENT_TABLE_MISS_FLOOR_MS = 2_000;
/** rosetta's own ceiling on a list (`MAX_LIMIT`): a folder outside every
 * project is answered by filtering the newest this many sessions by cwd */
const RECENT_SCAN_LIMIT = 1_000;

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
        ...(rt.refused !== undefined
          ? { refused: { reason: refusalReason(rt.refused.detail) } }
          : {}),
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
  retireRuntime(row: { kind: string; data_root: string }, refused?: { detail: string }): boolean {
    const at = this.record.runtimes.findIndex((rt) => sameRuntime(rt, row));
    if (at === -1) return false;
    const [entry] = this.record.runtimes.splice(at, 1);
    this.record.retired = [
      ...(this.record.retired ?? []).filter((rt) => !sameRuntime(rt, row)),
      {
        ...(entry as IndexEnrollmentRecord["runtimes"][number]),
        retired_at: this.now().toISOString(),
        // AC-D8 — the daemon's refusal, kept so the summary can say why the
        // persona is not indexed; absent when the user retired it
        ...(refused !== undefined ? { refused } : {}),
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
  /** AC-3 test seam: the catalog (default: THE table) — the kind → id column */
  catalog?: readonly AgentCatalogEntry[];
  logger?: Logger;
}

/** AC-D8 — the daemon's refusal of an enrolled root at start, as rosettad and
 * the scripted daemon both word it (`enroll.rs`: `--enroll <file>: runtime #N
 * (kind "<k>", data_root "<root>"): unknown agent kind`). The root is printed
 * `{:?}`-quoted, so a backslash escape is admitted and unescaped below. */
const REFUSED_KIND_RE =
  /runtime #\d+ \(kind "(?<kind>[^"]+)", data_root "(?<root>(?:[^"\\]|\\.)*)"\): unknown agent kind/g;

/** AC-D8 — the daemon's reason from its refusal line (`… (kind "k", data_root
 * "r"): <reason>`), for the projection: the path stays in the record. A line
 * with no such clause is said generically rather than copied. */
function refusalReason(detail: string): string {
  const at = detail.lastIndexOf("): ");
  return at === -1
    ? "refused by the daemon"
    : detail.slice(at + 3).trim() || "refused by the daemon";
}

/** AC-D8 — Rust's `{:?}` spelling of a string, undone: `\u{HEX}` (a decomposed
 * accent on macOS is one), `\x..`, `\n`/`\r`/`\t`/`\0` and the quoted `\"`,
 * `\'`, `\\`. JSON.parse cannot read `\u{…}`. */
function unescapeRustDebug(quoted: string): string {
  return quoted.replace(
    /\\(u\{([0-9a-fA-F]{1,6})\}|x([0-9a-fA-F]{2})|[\s\S])/g,
    (_m, whole: string, hex6?: string, hex2?: string) => {
      if (hex6 !== undefined) return String.fromCodePoint(Number.parseInt(hex6, 16));
      if (hex2 !== undefined) return String.fromCharCode(Number.parseInt(hex2, 16));
      switch (whole) {
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "0":
          return "\0";
        default:
          return whole;
      }
    },
  );
}

/** AC-3 — the projections' `agent` column: present only when a catalog row maps the kind. */
function agentColumn(agent: string | undefined): { agent?: string } {
  return agent === undefined ? {} : { agent };
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
/** the same, for `/api/projects` (QL) */
const PROJECTS_BODY_KEYS = Object.keys(IndexProjectsResponse.shape);

/** QL — one of `index.recent`'s cached join tables, stamped with the daemon
 * generation it was read from and when. */
interface RecentTable<T> {
  pid: number | null;
  at: number;
  value: T;
}

/** QL — what a session's runtime says about it: rosetta's kind (→ the catalog
 * id) and, for an enrolled root, the persona it was filed under. */
interface RecentRuntime {
  kind: string;
  profileId?: string;
}

export class IndexService {
  private readonly logger: Logger;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  /** the roll call as a join table, per daemon generation (see kindsByLayoutRoot) */
  private rollCall: { pid: number | null; kinds: ReadonlyMap<string, string> } | null = null;
  /** the tolerant reader's logging half: `<shape>.<key>` said once, ever */
  private readonly seenUnknownFields = new Set<string>();
  /** AC-3 — the catalog's readers (the kind → id column for the projections) */
  private readonly catalog: AgentCatalogReaders;
  private readonly onTransition: ((state: RosettadState) => void) | null;
  /** AC-D8 — a subtraction happened since the daemon last came up: the
   * supervisor's own retry carries it, and if the retry window closes first
   * (`failed` arrives with the same, already-consumed refusal lines) this is
   * what says one restart is still owed */
  private pendingRestart = false;
  /** AC-D8 — a subtraction the record on disk does not carry yet (its write
   * failed inside the daemon's exit handler); retried at the next refusal */
  private publishOwed = false;
  /** QL — `index.recent`'s join tables, per daemon generation (see RECENT_TABLE_TTL_MS) */
  private recentProjects: RecentTable<readonly IndexProjectRow[]> | null = null;
  private recentRuntimes: RecentTable<ReadonlyMap<string, RecentRuntime>> | null = null;

  constructor(private readonly opts: IndexServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.catalog = createAgentCatalogReaders(opts.catalog ?? AGENT_CATALOG);
    // AC-D8 — a daemon that refuses the record at start (`unknown agent kind`:
    // the catalog names a kind this daemon's registry lacks, a skew the gate
    // cannot see past a FIELDD_ROSETTAD_BIN override) is not left failing:
    // the refused roots are subtracted from `runtimes[]` — kept as retired
    // rows carrying the refusal — and the daemon is started again. The
    // ready-time reconcile cannot re-add them: it joins through the roll
    // call, which never names a kind the daemon does not register.
    // (a unit seam may stub the supervisor with `health()` alone: no
    // transitions to watch, nothing to subtract)
    if (opts.supervisor !== null && typeof opts.supervisor.on === "function") {
      this.onTransition = (state) => {
        if (state.phase === "ready") this.pendingRestart = false;
        if (state.phase === "restarting" || state.phase === "failed") this.subtractRefused(state);
      };
      opts.supervisor.on("transition", this.onTransition);
    } else {
      this.onTransition = null;
    }
  }

  /** Stop listening to the daemon (the daemon's shutdown). */
  dispose(): void {
    if (this.onTransition !== null) this.opts.supervisor?.off("transition", this.onTransition);
  }

  private subtractRefused(state: RosettadState): void {
    // the refusal lines in full (the supervisor keeps them whole because the
    // failure detail's per-line tail cuts a real root off before the reason),
    // then the detail itself for a supervisor that carries none
    const text = [...(state.enrollRefusals ?? []), state.detail ?? ""].join("\n");
    if (!text.includes("unknown agent kind")) return;
    const phase = state.phase;
    let changed = false;
    for (const match of text.matchAll(REFUSED_KIND_RE)) {
      const kind = match.groups?.kind;
      const quoted = match.groups?.root;
      if (kind === undefined || quoted === undefined) continue;
      const dataRoot = unescapeRustDebug(quoted);
      const refusal = { detail: match[0].slice(0, 512) };
      if (!this.opts.store.retireRuntime({ kind, data_root: dataRoot }, refusal)) continue;
      changed = true;
      this.logger.warn(
        "fieldd.index.enrollment_refused",
        "The daemon refused an enrolled root at start; subtracted so the index can come up",
        { kind, dataRoot, detail: refusal.detail },
      );
    }
    if (changed || this.publishOwed) {
      // This runs inside the supervisor's transition emit, which runs inside
      // the child's exit handler: a throw here (a full disk, an unwritable
      // user root) would take fieldd down with the daemon — nothing at the
      // process level catches it — while the record on disk still named the
      // root for the next start. The subtraction stands in memory; the write
      // is owed and retried at the next refusal (or by the next settle).
      try {
        this.opts.store.publish();
        this.publishOwed = false;
      } catch (error) {
        this.publishOwed = true;
        this.logger.warn(
          "fieldd.index.refusal_publish_failed",
          "The subtracted enrollment record could not be written; the subtraction stands in memory and the write is owed",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    // `restarting` = the supervisor's own bounded retry is already scheduled
    // and launches with the rewritten record — a second launch from here would
    // race it; remember that a restart is owed. `failed` = the intensity
    // window closed, which the supervisor publishes with the SAME refusal
    // lines the retry already consumed, so `changed` is false there: the owed
    // restart is the daemon's own act, deferred past the supervisor's
    // bookkeeping for this transition, once.
    if (changed && phase === "restarting") this.pendingRestart = true;
    if (phase === "failed" && (changed || this.pendingRestart)) {
      this.pendingRestart = false;
      setTimeout(() => {
        // caught: fieldd installs no unhandled-rejection handler, and a
        // launch that fails (a reap that cannot remove an orphan's dir) is
        // the supervisor's own honest `failed`, not a reason to exit
        this.opts.supervisor?.requestRestart().catch((error: unknown) => {
          this.logger.warn(
            "fieldd.index.refusal_restart_failed",
            "The restart owed after a refusal did not launch",
            { error: error instanceof Error ? error.message : String(error) },
          );
        });
      }, 0);
    }
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
        // AC-3 — the catalog id for the kind; absent when no row maps it (shown
        // by its wire kind, never selectable)
        ...agentColumn(this.catalog.idForKind(row.kind)),
        dataRoot: row.data_root,
        installed: row.installed,
        files: Number(row.files),
        bytes: Number(row.bytes),
        newestModifiedMs: Number(row.newest_modified_ms),
        consented: consented.has(row.kind),
      })),
    };
  }

  /** Declare the complete consented set of discovered kinds. AC-3 — consent
   * is over the agents the catalog shows and offers history for: a kind no
   * visible row maps, or one whose row claims no history, is refused typed
   * (`unsupported-agent`), the same word the persona doors use. A deprecated
   * row's history stays consentable (AC-D3: its sessions and history stay). */
  async enroll(kinds: readonly string[]): Promise<IndexMutationResult> {
    for (const kind of kinds) {
      const id = this.catalog.idForKind(kind);
      const row = id === undefined ? undefined : this.catalog.entry(id);
      if (
        id === undefined ||
        row === undefined ||
        !this.catalog.isVisible(id) ||
        !row.offers.history
      ) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `the catalog offers no history for agent kind ${kind}`,
          false,
          {
            kind,
            reason: "unsupported-agent",
            ...(row !== undefined ? { status: row.status } : {}),
          },
        );
      }
    }
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
   * read at the seam). Cached per daemon generation once it has rows. EMPTY
   * while the daemon is not ready, does not answer, or has not published its
   * census yet — rosettad prints `ready` BEFORE it walks the roots, and the
   * roll call fills in behind the line, seconds later on a big home — so a
   * caller that can wait says so (`waitMs`) and is answered by the first
   * census with rows, the generation's end, or the deadline, whichever comes
   * first; one that cannot degrades to "not indexed yet". Either way the
   * next ready re-applies (topology R4), rather than failing the persona. */
  async kindsByLayoutRoot(opts: { waitMs?: number } = {}): Promise<ReadonlyMap<string, string>> {
    const deadline = Date.now() + (opts.waitMs ?? 0);
    let delay = ROLL_CALL_POLL_MS;
    for (;;) {
      const health = this.opts.supervisor?.health() ?? ROSETTAD_UNCONFIGURED;
      if (health.phase !== "ready") return new Map();
      if (this.rollCall !== null && this.rollCall.pid === health.pid) return this.rollCall.kinds;
      const kinds = await this.readRollCall();
      if (kinds.size > 0) {
        this.rollCall = { pid: health.pid, kinds };
        return kinds;
      }
      if (Date.now() + delay > deadline) return kinds;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, ROLL_CALL_POLL_MAX_MS);
    }
  }

  /** one read of the census; empty when the daemon does not answer */
  private async readRollCall(): Promise<Map<string, string>> {
    try {
      const census = await this.get<DiscoveriesResponse>("/api/discoveries");
      return new Map(census.discoveries.map((row) => [row.data_root, row.kind]));
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
      ...agentColumn(this.catalog.idForKind(row.kind)),
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

  /** QL-D10 (the review's hardening) — the agent whose conversation this
   * native id is, as the INDEX files it: the canonical row for the id (the
   * same choice `sessionByNativeId` makes), its runtime's kind, and the
   * catalog id that kind maps to. `undefined` when the index has never read
   * the id; `{}` when it has, but no catalog row maps its kind. A native
   * resume takes an id only the index vouches for, and only for the agent the
   * index says it belongs to — the renderer's word is not provenance. */
  async nativeSessionAgent(
    nativeSessionId: string,
  ): Promise<{ provider?: string; profileId?: string } | undefined> {
    this.requireReady();
    const rows = (await this.fetchSessionRows([nativeSessionId], SESSION_FACTS_LIMIT)).filter(
      (row) => row.native_session_id === nativeSessionId,
    );
    const row = rows.find((candidate) => candidate.root_session_id === candidate.id) ?? rows[0];
    if (row === undefined) return undefined;
    const runtimes = await this.recentRuntimeTable([row]);
    const runtime = typeof row.runtime_id === "string" ? runtimes.get(row.runtime_id) : undefined;
    const provider = runtime === undefined ? undefined : this.catalog.idForKind(runtime.kind);
    return {
      ...(provider !== undefined ? { provider } : {}),
      ...(runtime?.profileId !== undefined ? { profileId: runtime.profileId } : {}),
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
    // THE WALK IS THE ORDINARY PATH, not an edge: rosetta widens each named
    // root to its delegated children, so hits arrive from sessions the
    // question never named. Every distinct unknown session is resolved —
    // concurrently, in bounded flights, under one deadline for the call —
    // and a walk that stopped early clips the answer rather than dropping
    // hits in silence (AR-5b, the review's probe: 40 hits in, 32 out).
    const deadlineMs = Date.now() + SEARCH_ATTRIBUTION_DEADLINE_MS;
    const unknownSessions = [...new Set(parsed.data.hits.map((hit) => hit.session_id))].filter(
      (id) => !roots.has(id) && !known.has(id),
    );
    if (!(await this.resolveSessions(unknownSessions, known, deadlineMs))) clipped = true;
    const hits: IndexSearchHit[] = [];
    for (const hit of parsed.data.hits) {
      let rootId: string | undefined = roots.has(hit.session_id) ? hit.session_id : undefined;
      if (rootId === undefined) {
        // the child's own row names its root — a FACT even when the root's
        // row was not fetched; a hit whose row is unknown carries no root at
        // all, never its own id in the root's place (that made a subagent
        // transcript read as top-level)
        rootId = known.get(hit.session_id)?.root_session_id;
        if (rootId === undefined) clipped = true;
        // a scoped question never answers outside its scope — and an answer
        // that dropped a hit for it says so, rather than reading as complete
        if (scoped && (rootId === undefined || !roots.has(rootId))) {
          clipped = true;
          continue;
        }
      }
      const root = rootId === undefined ? undefined : (roots.get(rootId) ?? known.get(rootId));
      const at = hit.at;
      hits.push({
        sessionId: hit.session_id,
        ...(rootId !== undefined ? { rootSessionId: rootId } : {}),
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

  // ── QL — the empty pane launcher's list ────────────────────────────────

  /** `index.recent` — a folder's past sessions (scope `here`: the rosetta
   * project the pane's folder belongs to) or every project's (`all`, each row
   * saying whether it is here), newest first as rosetta orders them.
   *
   * "Here" is QL-D9: the project whose `root_paths` hold the folder's git root
   * or its worktree group's root (found by the walk rosetta itself does, so a
   * pane in a worktree nobody has run an agent in still finds the repo's
   * sessions); a folder in no repo takes the project whose root is the
   * longest prefix of it. A folder in no project at all is "here" by folder:
   * the sessions run in it or under it. Readiness and every degraded state
   * are `index.sessions`' own: UNAVAILABLE `{service: "index", state}`. */
  async recent(params: IndexRecentParams): Promise<IndexRecentResult> {
    this.requireReady();
    const limit = params.limit ?? INDEX_RECENT_DEFAULT_LIMIT;
    const cwd = params.cwd === undefined ? undefined : normalizeRoot(params.cwd);
    const project = cwd === undefined ? undefined : await this.projectFor(cwd);
    const named = project === undefined ? {} : { project: { id: project.id, name: project.name } };

    let rows: IndexSessionRow[];
    if (params.scope === "all") {
      rows = await this.listSessions(`limit=${limit}`);
    } else if (project !== undefined) {
      rows = await this.listSessions(`project=${encodeURIComponent(project.id)}&limit=${limit}`);
    } else if (cwd !== undefined) {
      // no project to ask by: the newest sessions the index will list,
      // filtered by folder — a folder whose sessions are all older than
      // rosetta's list ceiling answers fewer than it holds, never wrong ones
      rows = (await this.listSessions(`limit=${RECENT_SCAN_LIMIT}`)).filter((row) =>
        withinFolder(row.cwd, cwd),
      );
    } else {
      // no folder: nothing is here
      return { rows: [] };
    }

    const here = (row: IndexSessionRow): boolean =>
      project !== undefined ? row.project_id === project.id : withinFolder(row.cwd, cwd);
    const top = rows.filter((row) => (row.parent_session_id ?? null) === null).slice(0, limit);
    const runtimes = await this.recentRuntimeTable(top);
    const projects =
      params.scope === "all" && top.some((row) => typeof row.project_id === "string")
        ? await this.recentProjectTable()
        : project !== undefined
          ? [project]
          : [];
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return {
      rows: top.map((row) => {
        const runtime =
          typeof row.runtime_id === "string" ? runtimes.get(row.runtime_id) : undefined;
        const provider = runtime === undefined ? undefined : this.catalog.idForKind(runtime.kind);
        const projectId = typeof row.project_id === "string" ? row.project_id : undefined;
        const projectName = projectId === undefined ? undefined : projectNames.get(projectId);
        return {
          ...projectSession(row),
          ...(provider !== undefined ? { provider } : {}),
          ...(runtime?.profileId !== undefined ? { profileId: runtime.profileId } : {}),
          ...(typeof row.started_at === "number" ? { startedAt: row.started_at } : {}),
          here: here(row),
          ...(projectId !== undefined && projectName !== undefined
            ? { project: { id: projectId, name: projectName } }
            : {}),
        };
      }),
      ...named,
    };
  }

  /** QL-D9 — the rosetta project a folder belongs to, or undefined. Tried for
   * the folder as spelled AND as the filesystem resolves it: rosetta files a
   * session under the cwd its agent reported (a resolved path), while a pane
   * reports its shell's (`/tmp` where the agent said `/private/tmp`). */
  private async projectFor(cwd: string): Promise<IndexProjectRow | undefined> {
    const spellings = folderSpellings(cwd);
    const repos = spellings.flatMap((dir) => {
      const found = repoRoots(dir);
      return found === undefined ? [] : [found.root, found.groupRoot];
    });
    const match = (projects: readonly IndexProjectRow[]): IndexProjectRow | undefined =>
      repos.length > 0
        ? projects.find((p) => p.root_paths.some((root) => repos.includes(normalizeRoot(root))))
        : longestPrefixProject(projects, spellings);
    const cached = match(await this.recentProjectTable());
    if (cached !== undefined) return cached;
    // a miss may be a repo the index met since the cache was read
    return match(await this.recentProjectTable(RECENT_TABLE_MISS_FLOOR_MS));
  }

  /** `/api/projects`, PARSED (the resolution reads every root) and cached for
   * this daemon generation. */
  private async recentProjectTable(
    maxAgeMs = RECENT_TABLE_TTL_MS,
  ): Promise<readonly IndexProjectRow[]> {
    const pid = this.opts.supervisor?.health().pid ?? null;
    const held = this.recentProjects;
    if (held !== null && held.pid === pid && Date.now() - held.at < maxAgeMs) return held.value;
    const body = await this.getBody("/api/projects");
    const parsed = IndexProjectsResponse.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.logger.warn(
        "fieldd.index.projects_malformed",
        "The index answered project rows fieldd cannot read",
        { issue: issue === undefined ? "?" : `${issue.path.join(".")}: ${issue.message}` },
      );
      throw new RpcCallError("UNAVAILABLE", "the agent index answered malformed projects", true, {
        service: "index",
        state: "malformed",
      });
    }
    this.noteUnknownFields("projects", body, PROJECTS_BODY_KEYS);
    this.recentProjects = { pid, at: Date.now(), value: parsed.data.projects };
    return parsed.data.projects;
  }

  /** `/api/runtimes` as the join `index.recent` needs — each runtime's kind,
   * and the persona an ENROLLED root was filed under — cached for this daemon
   * generation and re-read once when a row names a runtime it does not hold.
   * Cast like `index.status`' read of the same body: a row that is not what
   * the generated type promises is skipped (its sessions carry no provider),
   * never a refusal of the list. */
  private async recentRuntimeTable(
    rows: readonly IndexSessionRow[],
  ): Promise<ReadonlyMap<string, RecentRuntime>> {
    const wanted = rows.flatMap((row) =>
      typeof row.runtime_id === "string" ? [row.runtime_id] : [],
    );
    if (wanted.length === 0) return new Map();
    const table = await this.readRuntimeTable(RECENT_TABLE_TTL_MS);
    if (wanted.every((id) => table.has(id))) return table;
    return await this.readRuntimeTable(RECENT_TABLE_MISS_FLOOR_MS);
  }

  private async readRuntimeTable(maxAgeMs: number): Promise<ReadonlyMap<string, RecentRuntime>> {
    const pid = this.opts.supervisor?.health().pid ?? null;
    const held = this.recentRuntimes;
    if (held !== null && held.pid === pid && Date.now() - held.at < maxAgeMs) return held.value;
    const { runtimes } = await this.get<RuntimesResponse>("/api/runtimes");
    const table = new Map<string, RecentRuntime>();
    for (const row of Array.isArray(runtimes) ? runtimes : []) {
      if (typeof row?.id !== "string" || typeof row.kind !== "string") continue;
      const profileId =
        typeof row.data_root === "string" && isEnrolledRow(row)
          ? this.opts.store.lookup(row).profileId
          : undefined;
      table.set(row.id, { kind: row.kind, ...(profileId !== undefined ? { profileId } : {}) });
    }
    this.recentRuntimes = { pid, at: Date.now(), value: table };
    return table;
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
    return await this.listSessions(`native_session_id=${selector}&limit=${limit}`);
  }

  /** One `/api/sessions?<query>` read, parsed (see `fetchSessionRows`). */
  private async listSessions(query: string): Promise<IndexSessionRow[]> {
    const body = await this.getBody(`/api/sessions?${query}`);
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

  /** Resolve every listed session, then each one's root, in bounded
   * concurrent flights until the call's deadline. The budget is the
   * answer's own size (a row and a root per session); false means the walk
   * stopped early and the answer is CLIPPED — under-attributed, never
   * wrong. Two passes and no more: a row names its root and a root names
   * itself, so there is nothing to cycle through. */
  private async resolveSessions(
    ids: readonly string[],
    known: Map<string, IndexSessionRow>,
    deadlineMs: number,
  ): Promise<boolean> {
    const budget = { remaining: ids.length * 2 };
    const fetchAll = async (wanted: readonly string[]): Promise<boolean> => {
      for (let start = 0; start < wanted.length; start += ROOT_LOOKUP_CONCURRENCY) {
        if (Date.now() >= deadlineMs) return false;
        const flight = wanted.slice(start, start + ROOT_LOOKUP_CONCURRENCY);
        await Promise.all(flight.map((id) => this.sessionRow(id, known, budget)));
      }
      return true;
    };
    if (!(await fetchAll(ids))) return false;
    const rootIds = [...new Set(ids.map((id) => known.get(id)?.root_session_id))].filter(
      (id): id is string => id !== undefined && !known.has(id),
    );
    return await fetchAll(rootIds);
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
        route: routeOf(path),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new RpcCallError(
        "UNAVAILABLE",
        `the agent index did not answer ${routeOf(path)}`,
        true,
        {
          service: "index",
          state: "unreachable",
        },
      );
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
        `the agent index answered ${response.status} on ${routeOf(path)}`,
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
        { route: routeOf(path), error: error instanceof Error ? error.message : String(error) },
      );
      throw new RpcCallError(
        "UNAVAILABLE",
        `the agent index answered an unreadable body on ${routeOf(path)}`,
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

// ── QL-D9's folds: which rosetta project a pane's folder belongs to ────────

/** rosetta's `ids::normalize_root`, mirrored: separators to `/`, `.` and empty
 * segments dropped, `..` folded (never above an absolute root), no trailing
 * slash. The spelling every `root_paths` entry and session cwd is filed under,
 * so comparing in any other spelling would miss. */
export function normalizeRoot(path: string): string {
  const portable = path.replaceAll("\\", "/");
  const absolute = portable.startsWith("/");
  const parts: string[] = [];
  for (const part of portable.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      const last = parts.at(-1);
      if (last !== undefined && last !== "..") parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined;
}

/** The folder as spelled, and as the filesystem resolves it when that differs
 * (a folder that does not exist has only its spelling). */
function folderSpellings(cwd: string): string[] {
  try {
    const real = normalizeRoot(realpathSync(cwd));
    return real === cwd ? [cwd] : [cwd, real];
  } catch {
    return [cwd];
  }
}

/** The repository a folder is in, found the way rosetta finds it (its
 * `pipeline/src/project.rs` `find_git_dir` + `common_git_dir`, mirrored, so the
 * two can never disagree about a folder): the nearest ancestor holding `.git`
 * — a directory (a checkout) or a `gitdir:` FILE (a linked worktree, or a
 * submodule) — is the `root`; the `groupRoot` is the checkout every worktree
 * of the repo shares (the common git dir's parent), which is the project's
 * identity. A `.git` file that is not a `gitdir:` line ends the walk with no
 * repo, as rosetta's does. Undefined outside any repo. Reads two small files
 * at most; nothing here is ever answered to a caller. */
export function repoRoots(dir: string): { root: string; groupRoot: string } | undefined {
  let at = normalizeRoot(dir);
  for (;;) {
    const dotGit = join(at, ".git");
    let gitDir: string | undefined;
    let isDir = false;
    try {
      isDir = statSync(dotGit).isDirectory();
    } catch {
      // no `.git` here: keep walking
    }
    if (isDir) {
      gitDir = dotGit;
    } else {
      let text: string | undefined;
      try {
        text = readFileSync(dotGit, "utf8");
      } catch {
        text = undefined;
      }
      if (text !== undefined) {
        const trimmed = text.trim();
        if (!trimmed.startsWith("gitdir:")) return undefined;
        const target = trimmed.slice("gitdir:".length).trim();
        gitDir = isAbsolute(target) ? target : join(at, target);
      }
    }
    if (gitDir !== undefined) {
      return { root: at, groupRoot: normalizeRoot(commonRoot(gitDir) ?? at) };
    }
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
}

/** The worktree group's root from a git dir's `commondir` (absent for a
 * checkout's own `.git`): the common dir's parent when it is a `.git`, the
 * common dir itself for a bare repository. */
function commonRoot(gitDir: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(gitDir, "commondir"), "utf8");
  } catch {
    return undefined;
  }
  const target = text.trim();
  const common = normalizeRoot(isAbsolute(target) ? target : join(gitDir, target));
  return basename(common) === ".git" ? dirname(common) : common;
}

/** A folder in no repo: the project with a root that is the folder itself or
 * its nearest ancestor (the longest such root wins). */
function longestPrefixProject(
  projects: readonly IndexProjectRow[],
  spellings: readonly string[],
): IndexProjectRow | undefined {
  let best: { project: IndexProjectRow; length: number } | undefined;
  for (const project of projects) {
    for (const raw of project.root_paths) {
      const root = normalizeRoot(raw);
      if (!spellings.some((cwd) => withinFolder(cwd, root))) continue;
      if (best === undefined || root.length > best.length) best = { project, length: root.length };
    }
  }
  return best?.project;
}

/** `path` is `folder` or somewhere under it (both normalized). */
function withinFolder(path: string | null | undefined, folder: string | undefined): boolean {
  if (typeof path !== "string" || folder === undefined || folder === "") return false;
  const at = normalizeRoot(path);
  if (at === folder) return true;
  return at.startsWith(folder === "/" ? "/" : `${folder}/`);
}
