import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
// a restart affordance — never a spin, never a blank. Two failures are TERMINAL
// on sight because retrying cannot fix them: a protocol mismatch (the wrong
// binary for this fieldd) and a spawn that cannot happen (ENOENT/EACCES).
//
// EL7 note: rosettad has no authentication today (RO-1 is the open upstream
// ask). fieldd binds it to 127.0.0.1:0 and never hands the origin to a
// renderer; the ticketed direct plane waits on RO-1 (design §4).

export type RosettadPhase =
  | "unconfigured"
  | "starting"
  | "ready"
  | "restarting"
  | "failed"
  | "stopped";

/** fieldd's EXTERNAL judgment of the index daemon, projected into FielddHealth
 * and (AR-1) into UNAVAILABLE {service:"index", state} on the index doors. */
export interface RosettadState {
  phase: RosettadPhase;
  /** `http://127.0.0.1:<port>` while ready; null otherwise. */
  origin: string | null;
  /** the last failure or restart reason; null when there is none */
  detail: string | null;
  /** the current generation's pid; null when no child is alive */
  pid: number | null;
  /** the announce file the daemon published (`--announce`); null until ready */
  announce: string | null;
  protocolVersion: number | null;
}

export const ROSETTAD_UNCONFIGURED: RosettadState = Object.freeze({
  phase: "unconfigured",
  origin: null,
  detail: "no rosettad binary was configured (FIELDD_ROSETTAD_BIN)",
  pid: null,
  announce: null,
  protocolVersion: null,
});

/** Supervision timings. The startup budget covers rosettad's cold open of an
 * existing projection (the ledger replays lazily — the ready line precedes
 * the backfill); intensity is bounded the way NATIVE_SUPERVISION bounds
 * floor respawns. */
export const ROSETTAD_SUPERVISION = {
  STARTUP_TIMEOUT_MS: 8_000,
  /** SIGINT → this much patience → SIGKILL. rosettad's Drop guard removes its
   * announce file on a clean SIGINT exit; a SIGKILL leaves it for the reaper. */
  SHUTDOWN_TIMEOUT_MS: 10_000,
  RESTART_BASE_MS: 500,
  RESTART_MAX_MS: 10_000,
  /** a generation that stays ready this long resets the backoff */
  STABLE_AFTER_MS: 30_000,
  /** bounded intensity; past it: the permanent honest "failed" + requestRestart */
  RESTART_MAX: 5,
  RESTART_WINDOW_MS: 60_000,
  /** the ready line must arrive within this much stdout (a runaway banner is a
   * failure, not a buffer) */
  GREETING_LIMIT_BYTES: 64 * 1024,
} as const;

export type RosettadTimings = { [K in keyof typeof ROSETTAD_SUPERVISION]: number };

export interface RosettadSupervisorOptions {
  /** absolute path of the rosettad binary (FIELDD_ROSETTAD_BIN) */
  bin: string;
  /** the SQLite projection rosettad serves (`--db`); its directory is created */
  dbPath: string;
  /** the wire version fieldd's client speaks (`@rosetta/protocol`
   * PROTOCOL_VERSION); a daemon that announces another is the wrong binary. */
  expectedProtocolVersion: number;
  /** rosettad `--home DIR` — the home its discovery scans. Absent = the
   * process's own home (v1: personas are puppeteer profiles, AR-D11; the
   * per-persona home waits on RO-2). */
  home?: string | undefined;
  /** rosettad `--announce-dir DIR`. Absent = rosetta's platform default
   * (`~/Library/Application Support/rosetta/daemons` on macOS). Tests point it
   * at a temp dir. */
  announceDir?: string | undefined;
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
  /** a terminal failure: exit must NOT schedule a retry */
  terminal: boolean;
  greeting: string;
  startupTimer: NodeJS.Timeout | null;
  stableTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  ready: Promise<string | null>;
  exit: Promise<void>;
  settle: (origin: string | null) => void;
  resolveExit: () => void;
}

/** Emits `"transition"` `(state: RosettadState)` on every state change. */
export class RosettadSupervisor extends EventEmitter {
  private current: Generation | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private attempts = 0;
  private restartStamps: number[] = [];
  private stateValue: RosettadState = {
    phase: "starting",
    origin: null,
    detail: null,
    pid: null,
    announce: null,
    protocolVersion: null,
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

  /** A snapshot — never the live object (health projections are copied out). */
  state(): RosettadState {
    return { ...this.stateValue };
  }

  /** Launch (or join) the current generation. Resolves with the loopback
   * origin once the daemon says ready, or null when this generation failed. */
  start(): Promise<string | null> {
    return this.launch();
  }

  /** The escalation affordance: a human said "try again". Resets the intensity
   * window — the machine stopped on purpose and the human overrode it — and
   * runs one launch now. A terminal failure is retried too: the binary may
   * have been rebuilt since. */
  async requestRestart(): Promise<string | null> {
    if (this.stopped) return null;
    this.restartStamps = [];
    this.attempts = 0;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.current !== null) {
      await this.terminate(this.current);
    }
    return this.launch();
  }

  /** SIGINT, then SIGKILL after the shutdown budget; resolves after the child
   * has actually exited (or immediately when none is alive). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.current !== null) await this.terminate(this.current);
    this.publish({ phase: "stopped", origin: null, pid: null, announce: null });
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
      if (!generation.exited) this.signal(generation, "SIGKILL");
    }, this.t.SHUTDOWN_TIMEOUT_MS);
    generation.killTimer.unref?.();
    this.signal(generation, "SIGINT");
    return generation.exit;
  }

  private launch(): Promise<string | null> {
    if (this.stopped) return Promise.resolve(null);
    if (this.current !== null) return this.current.ready;
    this.publish({
      phase: this.attempts === 0 ? "starting" : "restarting",
      origin: null,
      announce: null,
    });
    const args = [
      "serve",
      "--db",
      this.opts.dbPath,
      "--addr",
      "127.0.0.1:0",
      "--json",
      "--announce",
      ...(this.opts.home !== undefined ? ["--home", this.opts.home] : []),
      ...(this.opts.announceDir !== undefined ? ["--announce-dir", this.opts.announceDir] : []),
    ];
    let proc: ChildProcess;
    try {
      mkdirSync(dirname(this.opts.dbPath), { recursive: true });
      proc = this.spawnProcess(this.opts.bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        // WIN-3 — a background daemon never flashes a console window.
        windowsHide: true,
      });
    } catch (error) {
      this.publish({ phase: "failed", detail: `rosettad could not be spawned: ${String(error)}` });
      return Promise.resolve(null);
    }
    let settle!: (origin: string | null) => void;
    let resolveExit!: () => void;
    const generation: Generation = {
      proc,
      exited: false,
      settled: false,
      terminating: false,
      terminal: false,
      greeting: "",
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
      resolveExit: () => undefined,
    };
    generation.settle = (origin) => {
      if (generation.settled) return;
      generation.settled = true;
      settle(origin);
    };
    generation.resolveExit = resolveExit;
    this.current = generation;
    this.publish({ pid: proc.pid ?? null });

    const fail = (detail: string, terminal = false): void => {
      if (this.current !== generation || generation.exited || generation.terminating) return;
      generation.terminal = terminal;
      this.publish({ phase: terminal ? "failed" : "restarting", origin: null, detail });
      generation.settle(null);
      void this.terminate(generation);
    };
    const exited = (detail: string): void => {
      if (generation.exited) return;
      generation.exited = true;
      if (generation.startupTimer) clearTimeout(generation.startupTimer);
      if (generation.stableTimer) clearTimeout(generation.stableTimer);
      if (generation.killTimer) clearTimeout(generation.killTimer);
      generation.settle(null);
      generation.resolveExit();
      if (this.current !== generation) return;
      this.current = null;
      if (this.stopped) return;
      if (generation.terminal) {
        this.publish({ origin: null, pid: null, announce: null });
        return;
      }
      this.publish({ phase: "restarting", origin: null, pid: null, announce: null, detail });
      this.scheduleRetry();
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      if (this.current !== generation || generation.settled || generation.terminating) {
        this.logger.debug("fieldd.rosettad.stdout", "rosettad stdout", {
          line: String(chunk).slice(0, 512),
        });
        return;
      }
      generation.greeting += String(chunk);
      let end = generation.greeting.indexOf("\n");
      while (end !== -1) {
        const line = generation.greeting.slice(0, end);
        generation.greeting = generation.greeting.slice(end + 1);
        end = generation.greeting.indexOf("\n");
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof event !== "object" || event === null) continue;
        const ready = event as {
          event?: unknown;
          origin?: unknown;
          protocol_version?: unknown;
          announce?: unknown;
        };
        if (ready.event !== "ready") continue;
        if (ready.protocol_version !== this.opts.expectedProtocolVersion) {
          fail(
            `rosettad speaks protocol ${String(ready.protocol_version)} but this fieldd expects ${this.opts.expectedProtocolVersion} — rebuild the sibling (pnpm siblings:build)`,
            true,
          );
          return;
        }
        let url: URL;
        try {
          url = new URL(String(ready.origin));
        } catch {
          fail("rosettad reported an invalid origin", true);
          return;
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
          fail("rosettad reported a non-loopback origin", true);
          return;
        }
        if (generation.startupTimer) clearTimeout(generation.startupTimer);
        this.publish({
          phase: "ready",
          origin: url.origin,
          detail: null,
          announce: typeof ready.announce === "string" ? ready.announce : null,
          protocolVersion: this.opts.expectedProtocolVersion,
        });
        generation.settle(url.origin);
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
    proc.stderr?.on("data", (chunk: Buffer) => {
      this.logger.debug("fieldd.rosettad.stderr", "rosettad stderr", {
        line: String(chunk).slice(0, 512),
      });
    });
    proc.on("exit", (code, sig) => exited(`rosettad exited (${sig ?? code})`));
    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (proc.pid === undefined) {
        // Failed spawns have no process and emit no exit event. A missing or
        // unexecutable binary is terminal: retrying cannot make it appear.
        generation.terminal = error.code === "ENOENT" || error.code === "EACCES";
        if (generation.terminal) {
          this.publish({
            phase: "failed",
            detail: `rosettad could not be spawned (${error.code ?? "error"}): ${this.opts.bin}`,
          });
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
    return generation.ready;
  }
}
