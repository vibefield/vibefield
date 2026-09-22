import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// RosettadSupervisor (AR-0, thinking-ar-agent-plane §3/§9): fieldd owns ONE
// rosettad generation per user root — the agent-history daemon that indexes
// every vendor's transcripts under the user's home and serves them on an
// ephemeral loopback port. It is a port of rosetta's own supervisor
// (`clients/app/electron/daemon-service.mjs`, the reference the triad doc names)
// into fieldd's idiom: readiness is the daemon's STRUCTURED `--json` line, never
// a scraped banner; failed children are reaped before a retry; shutdown awaits
// the real exit so two generations never overlap on one database.
//
// Durability ceiling (AR-D6, v1): the index is fieldd-lifetime. A rosettad that
// dies is restarted with backoff; a rosettad that keeps dying stops being
// restarted (bounded intensity, TC-D1's shape) and the state says "failed" with
// a restart affordance (`system.index.restart`) — never a spin, never a blank.
// Two failures are TERMINAL on sight because retrying cannot fix them: a
// protocol mismatch (the wrong binary for this fieldd) and a spawn that cannot
// happen (ENOENT/EACCES).
//
// EL7: rosettad has no authentication today (RO-1 is the open upstream ask), so
// the daemon's ORIGIN is the secret. fieldd binds it to 127.0.0.1:0 and keeps
// the origin to itself: what reaches FielddHealth is the RosettadHealth
// projection (phase, reason, pid, protocol) — `system.health.subscribe` is
// scope-null, every authenticated product client reads it — never the
// RosettadState the index doors (AR-1) dial with. The announce file goes to a
// fieldd-PRIVATE directory under the user root (LAYOUT.INDEX_DAEMONS_DIR), never
// rosetta's shared per-user directory, so no sibling app or same-uid agent is
// pointed at the daemon; fieldd itself is that directory's only reader.
//
// Orphans: a fieldd that dies without its stop ladder (SIGKILL, a crash) leaves
// its rosettad alive, holding rosetta's EXCLUSIVE projection lock (`<db>.lock`,
// rosettad main.rs projection_lock). The next fieldd's child would exit on that
// lock, trip the restart intensity, and sit in a permanent "failed" through no
// fault of its own. So every launch first reads the private announce directory:
// a file whose pid is dead is stale and removed; one whose pid is alive AND
// answers `/api/status` with the rosetta protocol header on its announced
// loopback origin is a previous fieldd's rosettad over this projection and is
// put down (SIGINT, then SIGKILL) before the new generation spawns. A live pid
// that does NOT answer as rosettad is left alone — the pid may have been reused
// (rosetta's announce.rs states the same reader rule) — and the child's lock
// error then surfaces in the failure detail, honestly, with its stderr.

export type RosettadPhase =
  | "unconfigured"
  | "starting"
  | "ready"
  | "restarting"
  | "failed"
  | "stopped";

/** The projection EVERY authenticated product client may see
 * (`FielddHealth.rosettad`; the index doors answer UNAVAILABLE {service:"index",
 * state} from the same phase): the phase and its reason — never the origin. */
export interface RosettadHealth {
  phase: RosettadPhase;
  /** the last failure or restart reason; null when there is none */
  detail: string | null;
  /** the current generation's pid; null when no child is alive */
  pid: number | null;
  protocolVersion: number | null;
}

/** fieldd's full judgment: the health projection plus what stays INSIDE
 * fieldd — the loopback origin the index doors dial and the announce file the
 * daemon published. Never sent to a client (EL7, header). */
export interface RosettadState extends RosettadHealth {
  /** `http://127.0.0.1:<port>` while ready; null otherwise. */
  origin: string | null;
  /** the announce file (`--announce`, fieldd's private dir); null until ready */
  announce: string | null;
  /** AC-D8 — the daemon's enrollment refusals from the generation's stderr, IN
   * FULL: `--enroll <file>: runtime #N (kind "k", data_root "r"): <reason>`.
   * The failure `detail` keeps a 256-char tail per line, which cuts a real
   * path off before the reason; the index service reads these instead. Never
   * projected to a client (the path is inside). Empty while nothing refused. */
  enrollRefusals: readonly string[];
}

const NO_REFUSALS: readonly string[] = Object.freeze([]);
/** refusal lines kept per generation, each bounded — a daemon that prints one
 * per runtime says the whole file before it exits */
const ENROLL_REFUSAL_LINES = 32;
const ENROLL_REFUSAL_CHARS = 4_096;

export const ROSETTAD_UNCONFIGURED: RosettadHealth = Object.freeze({
  phase: "unconfigured",
  detail: "no rosettad binary was configured (FIELDD_ROSETTAD_BIN)",
  pid: null,
  protocolVersion: null,
});

/** The client-facing projection of a state — the ONLY way a state reaches a
 * FielddHealth (a spread of the state would carry the origin along). */
export function rosettadHealthOf(state: RosettadState): RosettadHealth {
  return {
    phase: state.phase,
    detail: state.detail,
    pid: state.pid,
    protocolVersion: state.protocolVersion,
  };
}

/** Supervision timings. The startup budget covers rosettad's cold open of an
 * existing projection (the ledger replays lazily — the ready line precedes
 * the backfill); intensity is bounded the way NATIVE_SUPERVISION bounds
 * floor respawns. */
export const ROSETTAD_SUPERVISION = {
  STARTUP_TIMEOUT_MS: 8_000,
  /** SIGINT → this much patience → SIGKILL. rosettad's Drop guard removes its
   * announce file on a clean SIGINT exit; a SIGKILL leaves it for the reaper
   * (the next launch's orphan pass). */
  SHUTDOWN_TIMEOUT_MS: 10_000,
  /** SIGKILL → this much patience → the generation is given up on (a process
   * that outlives SIGKILL is stuck in the kernel; the stop ladder must not
   * hang on it). */
  KILL_WAIT_MS: 2_000,
  RESTART_BASE_MS: 500,
  RESTART_MAX_MS: 10_000,
  /** a generation that stays ready this long resets the backoff */
  STABLE_AFTER_MS: 30_000,
  /** bounded intensity; past it: the permanent honest "failed" + requestRestart */
  RESTART_MAX: 5,
  RESTART_WINDOW_MS: 60_000,
  /** an UNTERMINATED stdout line longer than this before the ready line is a
   * failure, not a buffer to grow (complete lines drain as they arrive, so a
   * chatty banner is fine; a stream that never newlines is not the contract) */
  GREETING_LIMIT_BYTES: 64 * 1024,
  /** the orphan pass: how long an announced origin gets to answer `/api/status` */
  ORPHAN_PROBE_TIMEOUT_MS: 2_000,
} as const;

export type RosettadTimings = { [K in keyof typeof ROSETTAD_SUPERVISION]: number };

/** stderr lines kept per generation for the failure detail (the lock error,
 * a panic) — the last few, never the stream */
const STDERR_TAIL_LINES = 4;

/** rosetta's announce file shape (announce.rs); readers ignore other schemas */
const ANNOUNCEMENT_SCHEMA = "rosetta-daemon/1";

export interface RosettadSupervisorOptions {
  /** absolute path of the rosettad binary (FIELDD_ROSETTAD_BIN) */
  bin: string;
  /** the SQLite projection rosettad serves (`--db`), absolute; its directory
   * is created */
  dbPath: string;
  /** the wire version fieldd's client speaks (`@rosetta/protocol`
   * PROTOCOL_VERSION); a daemon that announces another is the wrong binary. */
  expectedProtocolVersion: number;
  /** rosettad `--announce-dir DIR`: fieldd's PRIVATE announce directory for
   * this user root (LAYOUT.INDEX_DAEMONS_DIR), never rosetta's platform
   * default. Required — it is how the next fieldd finds an orphan (header). */
  announceDir: string;
  /** rosettad `--home DIR` — the home its discovery scans: the OS user's own
   * home, always (thinking-ar-data-topology.md R7 — a persona is never a
   * home; its root is ENROLLED through the file below). Absent = the
   * process's own home. */
  home?: string | undefined;
  /** rosettad `--enroll FILE` (AR-1, RO-2): this user's enrollment record
   * (LAYOUT.INDEX_ENROLLMENT_FILE) — consent for discovered kinds and the
   * managed roots, read by the daemon once at start. fieldd's EnrollmentStore
   * publishes it before every launch; the supervisor only names it. */
  enrollFile?: string | undefined;
  /** test seam — a fake daemon script */
  spawnProcess?: typeof nodeSpawn;
  /** test seam; production uses ROSETTAD_SUPERVISION */
  timings?: Partial<RosettadTimings>;
  logger?: Logger;
}

interface Generation {
  proc: ChildProcess;
  exited: boolean;
  settled: boolean;
  terminating: boolean;
  /** what the exit means once it comes: "retry" (the daemon died on its own
   * or missed its startup budget) or "settle" (fieldd ended it on purpose —
   * stop, a restart request, a terminal failure — and no retry follows, so
   * the intensity window is not charged) */
  onExit: "retry" | "settle";
  /** the reason fieldd ended this generation, kept over the bare exit code */
  failure: string | null;
  greeting: string;
  stderrLine: string;
  stderrTail: string[];
  /** AC-D8 — the `--enroll …` refusal lines, in full (see RosettadState) */
  enrollRefusals: string[];
  startupTimer: NodeJS.Timeout | null;
  stableTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  ready: Promise<string | null>;
  exit: Promise<void>;
  settle: (origin: string | null) => void;
  /** the exit path, also taken when a SIGKILL goes unanswered */
  exitedBy: (detail: string) => void;
}

type Announcement =
  | { kind: "unreadable" }
  | { kind: "foreign-schema"; schema: string }
  | { kind: "ok"; pid: number; origin: string; db: string | null };

function readAnnouncement(file: string): Announcement {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { kind: "unreadable" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "unreadable" };
  const record = parsed as { schema?: unknown; pid?: unknown; origin?: unknown; db?: unknown };
  if (typeof record.schema !== "string") return { kind: "unreadable" };
  if (record.schema !== ANNOUNCEMENT_SCHEMA)
    return { kind: "foreign-schema", schema: record.schema };
  if (typeof record.pid !== "number" || typeof record.origin !== "string") {
    return { kind: "unreadable" };
  }
  return {
    kind: "ok",
    pid: record.pid,
    origin: record.origin,
    db: typeof record.db === "string" ? record.db : null,
  };
}

/** The loopback origin a daemon may serve on, normalized — or null for
 * anything else (another host, a path, credentials, a query). */
function loopbackOrigin(value: unknown): string | null {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.port === "0" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.origin;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but is not ours to signal — alive for our purposes
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (processAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

/** Emits `"transition"` `(state: RosettadState)` on every state change. */
export class RosettadSupervisor extends EventEmitter {
  private current: Generation | null = null;
  /** the spawn step in flight (the orphan pass is async) — one at a time */
  private launching: Promise<Generation | null> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** generations spawned so far — the first is "starting", the rest "restarting" */
  private generations = 0;
  private attempts = 0;
  private restartStamps: number[] = [];
  private stateValue: RosettadState = {
    phase: "starting",
    origin: null,
    detail: null,
    pid: null,
    announce: null,
    protocolVersion: null,
    enrollRefusals: NO_REFUSALS,
  };
  private readonly t: RosettadTimings;
  private readonly logger: Logger;
  private readonly spawnProcess: typeof nodeSpawn;

  constructor(private readonly opts: RosettadSupervisorOptions) {
    super();
    this.t = { ...ROSETTAD_SUPERVISION, ...opts.timings };
    this.logger = opts.logger ?? createNoopLogger();
    this.spawnProcess = opts.spawnProcess ?? nodeSpawn;
  }

  /** fieldd's full judgment, a snapshot — never the live object. Internal:
   * the origin is in it. */
  state(): RosettadState {
    return { ...this.stateValue };
  }

  /** The client-facing projection (FielddHealth.rosettad). */
  health(): RosettadHealth {
    return rosettadHealthOf(this.stateValue);
  }

  /** Launch (or join) the current generation. Resolves with the loopback
   * origin once the daemon says ready, or null when this generation failed. */
  start(): Promise<string | null> {
    return this.launch();
  }

  /** The escalation affordance (`system.index.restart`): a human said "try
   * again". Resets the intensity window — the machine stopped on purpose and
   * the human overrode it — puts the live generation down WITHOUT charging the
   * window (a requested exit is not a crash), and runs one launch now. A
   * terminal failure is retried too: the binary may have been rebuilt since. */
  async requestRestart(): Promise<string | null> {
    if (this.stopped) return null;
    if (this.launching !== null) await this.launching;
    this.restartStamps = [];
    this.attempts = 0;
    this.clearRetry();
    const generation = this.current;
    if (generation !== null) {
      generation.onExit = "settle";
      this.publish({
        phase: "restarting",
        origin: null,
        announce: null,
        detail: "restart requested",
      });
      await this.terminate(generation);
    }
    return this.launch();
  }

  /** SIGINT, then SIGKILL after the shutdown budget; resolves after the child
   * has actually exited (or immediately when none is alive). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearRetry();
    if (this.launching !== null) await this.launching;
    const generation = this.current;
    if (generation !== null) {
      generation.onExit = "settle";
      await this.terminate(generation);
    }
    this.publish({ phase: "stopped", origin: null, pid: null, announce: null });
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private publish(patch: Partial<RosettadState>): void {
    const next = { ...this.stateValue, ...patch };
    const changed = (Object.keys(next) as Array<keyof RosettadState>).some(
      (k) => next[k] !== this.stateValue[k],
    );
    if (!changed) return;
    this.stateValue = next;
    this.logger.info("fieldd.rosettad.state", "Index daemon supervision state changed", {
      phase: next.phase,
      detail: next.detail,
      pid: next.pid,
    });
    this.emit("transition", this.state());
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return;
    const now = Date.now();
    this.restartStamps = this.restartStamps.filter((s) => now - s < this.t.RESTART_WINDOW_MS);
    if (this.restartStamps.length >= this.t.RESTART_MAX) {
      this.publish({
        phase: "failed",
        origin: null,
        detail: `restart intensity exceeded (${this.t.RESTART_MAX} in ${this.t.RESTART_WINDOW_MS}ms) — something is wrong with rosettad itself; use the restart affordance to try again`,
      });
      return;
    }
    this.restartStamps.push(now);
    const delay = Math.min(this.t.RESTART_MAX_MS, this.t.RESTART_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.launch();
    }, delay);
    this.retryTimer.unref?.();
  }

  private signal(generation: Generation, name: NodeJS.Signals): void {
    try {
      generation.proc.kill(name);
    } catch (error) {
      // A failed signal is not evidence that the process exited. Keep owning
      // this generation until the OS reports its exit; never overlap children.
      this.publish({ phase: "failed", detail: `could not stop rosettad: ${String(error)}` });
    }
  }

  private terminate(generation: Generation): Promise<void> {
    if (generation.exited || generation.terminating) return generation.exit;
    generation.terminating = true;
    if (generation.startupTimer) clearTimeout(generation.startupTimer);
    if (generation.stableTimer) clearTimeout(generation.stableTimer);
    generation.killTimer = setTimeout(() => {
      if (generation.exited) return;
      this.signal(generation, "SIGKILL");
      generation.killTimer = setTimeout(() => {
        if (generation.exited) return;
        this.logger.warn(
          "fieldd.rosettad.unkillable",
          "rosettad did not exit after SIGKILL — giving up on this generation",
          { pid: generation.proc.pid ?? null },
        );
        generation.exitedBy("rosettad did not exit after SIGKILL");
      }, this.t.KILL_WAIT_MS);
      generation.killTimer.unref?.();
    }, this.t.SHUTDOWN_TIMEOUT_MS);
    generation.killTimer.unref?.();
    this.signal(generation, "SIGINT");
    return generation.exit;
  }

  private launch(): Promise<string | null> {
    if (this.stopped) return Promise.resolve(null);
    if (this.current !== null) return this.current.ready;
    if (this.launching === null) {
      this.launching = this.spawnGeneration().finally(() => {
        this.launching = null;
      });
    }
    return this.launching.then((generation) => generation?.ready ?? Promise.resolve(null));
  }

  // --- the orphan pass -------------------------------------------------------

  private async probeRosettad(origin: string): Promise<boolean> {
    try {
      const response = await fetch(`${origin}/api/status`, {
        signal: AbortSignal.timeout(this.t.ORPHAN_PROBE_TIMEOUT_MS),
        redirect: "manual",
      });
      await response.body?.cancel();
      return response.headers.has("x-rosetta-protocol-version");
    } catch {
      return false;
    }
  }

  private async putDown(pid: number): Promise<boolean> {
    const send = (name: NodeJS.Signals): void => {
      try {
        process.kill(pid, name);
      } catch {
        // already gone — waitGone answers below
      }
    };
    send("SIGINT");
    if (await waitGone(pid, this.t.SHUTDOWN_TIMEOUT_MS)) return true;
    send("SIGKILL");
    return waitGone(pid, this.t.KILL_WAIT_MS);
  }

  /** Read fieldd's private announce directory and put down any rosettad a
   * previous fieldd left behind over this projection (header: it holds the
   * exclusive projection lock). Stale files are removed; a live pid that does
   * not answer as rosettad is left alone. */
  private async reapOrphans(): Promise<void> {
    let names: string[];
    try {
      names = readdirSync(this.opts.announceDir);
    } catch {
      return; // no directory yet — nothing was ever announced here
    }
    for (const name of names) {
      if (name.startsWith(".") || !name.endsWith(".json")) continue;
      const file = join(this.opts.announceDir, name);
      const announced = readAnnouncement(file);
      if (announced.kind === "unreadable") {
        // rosetta publishes by atomic rename, so a half-written file is
        // impossible; an unreadable one was never an announcement
        rmSync(file, { force: true });
        this.logger.info("fieldd.rosettad.announce_discarded", "Removed an unreadable file", {
          file,
        });
        continue;
      }
      if (announced.kind === "foreign-schema") {
        this.logger.warn(
          "fieldd.rosettad.announce_unknown_schema",
          "An announce file of another schema is in the private directory — left alone",
          { file, schema: announced.schema },
        );
        continue;
      }
      if (announced.db !== null && announced.db !== this.opts.dbPath) {
        this.logger.warn(
          "fieldd.rosettad.announce_other_projection",
          "An announce file for another projection is in the private directory — left alone",
          { file, db: announced.db },
        );
        continue;
      }
      if (!processAlive(announced.pid)) {
        rmSync(file, { force: true });
        this.logger.info(
          "fieldd.rosettad.announce_stale",
          "Removed a stale announce file (its pid is gone)",
          { file, pid: announced.pid },
        );
        continue;
      }
      const origin = loopbackOrigin(announced.origin);
      const answers = origin !== null && (await this.probeRosettad(origin));
      if (!answers) {
        this.logger.warn(
          "fieldd.rosettad.orphan_unproven",
          "A live pid in the private announce directory does not answer as rosettad — left alone (pid reuse?)",
          { file, pid: announced.pid, origin: announced.origin },
        );
        continue;
      }
      this.logger.warn(
        "fieldd.rosettad.orphan_reaped",
        "Putting down a rosettad a previous fieldd left behind over this projection",
        { pid: announced.pid },
      );
      const gone = await this.putDown(announced.pid);
      if (!gone) {
        this.logger.warn(
          "fieldd.rosettad.orphan_survived",
          "The orphan rosettad did not exit — the new generation will report the projection lock",
          { pid: announced.pid },
        );
        continue;
      }
      rmSync(file, { force: true }); // its own Drop guard usually beat us to it
    }
  }

  // --- a generation ------------------------------------------------------------

  private async spawnGeneration(): Promise<Generation | null> {
    await this.reapOrphans();
    if (this.stopped) return null;
    this.publish({
      phase: this.generations === 0 ? "starting" : "restarting",
      origin: null,
      announce: null,
      enrollRefusals: NO_REFUSALS,
    });
    const args = [
      "serve",
      "--db",
      this.opts.dbPath,
      "--addr",
      "127.0.0.1:0",
      "--json",
      "--announce",
      "--announce-dir",
      this.opts.announceDir,
      ...(this.opts.home !== undefined ? ["--home", this.opts.home] : []),
      ...(this.opts.enrollFile !== undefined ? ["--enroll", this.opts.enrollFile] : []),
    ];
    let proc: ChildProcess;
    try {
      mkdirSync(dirname(this.opts.dbPath), { recursive: true });
      mkdirSync(this.opts.announceDir, { recursive: true });
      proc = this.spawnProcess(this.opts.bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        // WIN-3 — a background daemon never flashes a console window.
        windowsHide: true,
      });
    } catch (error) {
      this.publish({ phase: "failed", detail: `rosettad could not be spawned: ${String(error)}` });
      return null;
    }
    this.generations += 1;
    let settle!: (origin: string | null) => void;
    let resolveExit!: () => void;
    const generation: Generation = {
      proc,
      exited: false,
      settled: false,
      terminating: false,
      onExit: "retry",
      failure: null,
      greeting: "",
      stderrLine: "",
      stderrTail: [],
      enrollRefusals: [],
      startupTimer: null,
      stableTimer: null,
      killTimer: null,
      ready: new Promise<string | null>((resolve) => {
        settle = resolve;
      }),
      exit: new Promise<void>((resolve) => {
        resolveExit = resolve;
      }),
      settle: () => undefined,
      exitedBy: () => undefined,
    };
    generation.settle = (origin) => {
      if (generation.settled) return;
      generation.settled = true;
      settle(origin);
    };
    this.current = generation;
    this.publish({ pid: proc.pid ?? null });

    const fail = (detail: string, terminal = false): void => {
      if (this.current !== generation || generation.exited || generation.terminating) return;
      generation.failure = detail;
      if (terminal) generation.onExit = "settle";
      this.publish({
        phase: terminal ? "failed" : "restarting",
        origin: null,
        announce: null,
        detail,
        ...(generation.enrollRefusals.length > 0
          ? { enrollRefusals: [...generation.enrollRefusals] }
          : {}),
      });
      generation.settle(null);
      void this.terminate(generation);
    };
    const exited = (exitDetail: string): void => {
      if (generation.exited) return;
      generation.exited = true;
      if (generation.startupTimer) clearTimeout(generation.startupTimer);
      if (generation.stableTimer) clearTimeout(generation.stableTimer);
      if (generation.killTimer) clearTimeout(generation.killTimer);
      const last = generation.stderrLine.trim();
      if (last.length > 0) generation.stderrTail.push(last.slice(0, 256));
      generation.settle(null);
      resolveExit();
      if (this.current !== generation) return;
      this.current = null;
      if (this.stopped) return;
      if (generation.onExit === "settle") {
        // ended on purpose (a restart request or a terminal failure): the
        // reason is already published; only the child facts change
        this.publish({ origin: null, pid: null, announce: null });
        return;
      }
      // the daemon's own death, or a missed startup budget: carry its last
      // words — the projection lock, a panic — so the detail names the cause
      const tail =
        generation.stderrTail.length > 0 ? ` — ${generation.stderrTail.join(" | ")}` : "";
      this.publish({
        phase: "restarting",
        origin: null,
        pid: null,
        announce: null,
        detail: `${generation.failure ?? exitDetail}${tail}`,
        ...(generation.enrollRefusals.length > 0
          ? { enrollRefusals: [...generation.enrollRefusals] }
          : {}),
      });
      this.scheduleRetry();
    };
    generation.exitedBy = exited;

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      if (this.current !== generation || generation.settled || generation.terminating) {
        // after the ready line stdout is the daemon's own evidence, not protocol
        for (const line of chunk.split("\n")) {
          if (line.length > 0) {
            this.logger.debug("fieldd.rosettad.stdout", "rosettad stdout", {
              line: line.slice(0, 512),
            });
          }
        }
        return;
      }
      generation.greeting += chunk;
      let end = generation.greeting.indexOf("\n");
      while (end !== -1) {
        const line = generation.greeting.slice(0, end);
        generation.greeting = generation.greeting.slice(end + 1);
        end = generation.greeting.indexOf("\n");
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          event = null;
        }
        const ready =
          typeof event === "object" && event !== null
            ? (event as {
                event?: unknown;
                origin?: unknown;
                protocol_version?: unknown;
                announce?: unknown;
              })
            : null;
        if (ready === null || ready.event !== "ready") {
          // whatever the daemon says before its ready line is evidence too —
          // the thing that explains a startup that never becomes ready
          if (line.trim().length > 0) {
            this.logger.info("fieldd.rosettad.stdout", "rosettad stdout before ready", {
              line: line.slice(0, 512),
            });
          }
          continue;
        }
        if (ready.protocol_version !== this.opts.expectedProtocolVersion) {
          fail(
            `rosettad speaks protocol ${String(ready.protocol_version)} but this fieldd expects ${this.opts.expectedProtocolVersion} — rebuild the sibling (pnpm siblings:build)`,
            true,
          );
          return;
        }
        const origin = loopbackOrigin(ready.origin);
        if (origin === null) {
          fail("rosettad reported a non-loopback origin", true);
          return;
        }
        if (generation.startupTimer) clearTimeout(generation.startupTimer);
        this.publish({
          phase: "ready",
          origin,
          detail: null,
          announce: typeof ready.announce === "string" ? ready.announce : null,
          protocolVersion: this.opts.expectedProtocolVersion,
          enrollRefusals: NO_REFUSALS,
        });
        generation.settle(origin);
        generation.stableTimer = setTimeout(() => {
          if (this.current === generation) {
            this.attempts = 0;
            this.restartStamps = [];
          }
        }, this.t.STABLE_AFTER_MS);
        generation.stableTimer.unref?.();
        return;
      }
      if (generation.greeting.length > this.t.GREETING_LIMIT_BYTES) {
        fail("rosettad's readiness message exceeded its limit", true);
      }
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      generation.stderrLine += chunk;
      let end = generation.stderrLine.indexOf("\n");
      while (end !== -1) {
        const line = generation.stderrLine.slice(0, end).trimEnd();
        generation.stderrLine = generation.stderrLine.slice(end + 1);
        end = generation.stderrLine.indexOf("\n");
        if (line.length === 0) continue;
        this.logger.info("fieldd.rosettad.stderr", "rosettad stderr", { line: line.slice(0, 512) });
        generation.stderrTail.push(line.slice(0, 256));
        if (generation.stderrTail.length > STDERR_TAIL_LINES) generation.stderrTail.shift();
        // AC-D8 — a refusal names a root, and a real root is longer than the
        // tail's line budget: keep the daemon's `--enroll` lines whole
        if (line.startsWith("--enroll ")) {
          generation.enrollRefusals.push(line.slice(0, ENROLL_REFUSAL_CHARS));
          if (generation.enrollRefusals.length > ENROLL_REFUSAL_LINES)
            generation.enrollRefusals.shift();
        }
      }
      // an unterminated line keeps only its tail — never a growing buffer
      if (generation.stderrLine.length > 4_096) {
        generation.stderrLine = generation.stderrLine.slice(-2_048);
      }
    });
    proc.on("exit", (code, sig) => exited(`rosettad exited (${sig ?? code})`));
    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (proc.pid === undefined) {
        // Failed spawns have no process and emit no exit event. A missing or
        // unexecutable binary is terminal: retrying cannot make it appear.
        if (error.code === "ENOENT" || error.code === "EACCES") {
          generation.onExit = "settle";
          generation.failure = `rosettad could not be spawned (${error.code}): ${this.opts.bin}`;
          this.publish({ phase: "failed", detail: generation.failure });
        }
        exited(error.message);
      } else {
        this.publish({ phase: "failed", detail: error.message });
      }
    });
    generation.startupTimer = setTimeout(
      () => fail("rosettad did not become ready in time"),
      this.t.STARTUP_TIMEOUT_MS,
    );
    generation.startupTimer.unref?.();
    return generation;
  }
}
