import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { Duplex } from "node:stream";
import {
  FLOW_LIMITS,
  FLOW_LOG_MAX,
  type FlowHostEnding,
  flowAnswerBytes,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { FlowsHostLaunch, FlowsHostLaunchChoice } from "./launch";
import { flowScriptOf } from "./module-script";
import {
  FLOW_FRAME_ENVELOPE,
  FrameReader,
  type FrameRefusal,
  type FromFlowHost,
  frameOf,
  readFromFlowHost,
  type ToFlowHost,
} from "./protocol";

// CP-4a2a (CP-D8, CP-D9; 4A2-Q1 (a), 4A2-Q5 (a), 4A2-Q6 (b), 4A2-Q7 (a), ruled by VF-PM 2026-11-05 08:51Z) — ONE
// run's flow host: fieldd starts a child for the run (launch.ts), hands it the approved bytes rewritten into one script
// (module-script.ts), answers each call the script makes through a FlowCallHandler, pings it, and ends it. The child's
// environment is PATH alone. A run's calls reach the world only through the handler: in CP-4a2a a scripted one in the
// tests, behind the journal's replay (replay.ts); the runs (CP-4a2b) implement it.
//
// - Before any child: bytes past FLOW_LIMITS.SCRIPT_MAX_BYTES, and bytes the rewrite refuses, are `refused`; a copy that
//   cannot start a host is `unconfigured`. Nothing is spawned for either.
// - The pipe is the child's fd 3, read by fieldd's own FrameReader (bth's review H1/P2): a frame past
//   FLOW_LIMITS.RESULT_MAX_BYTES and FLOW_FRAME_ENVELOPE is refused before it is held whole, and it, or a frame that
//   is not JSON, ends the run as `protocol` at once (SIGKILL), whatever its child still says.
// - The pipe carries bounded control (4A2-Q5 (a)): the script once; a call whose arguments are past
//   FLOW_LIMITS.RESULT_MAX_BYTES is refused (the child holds the same bound before it sends); an answer past it never
//   crosses whole: text is cut to fit, anything else is refused, in the words the script's `await` throws with.
// - The host is pinged every `pingMs` once READY. A host that says nothing for `pingMisses` pings in a row is ended at
//   once (SIGKILL: a script that spins cannot hear a `shutdown`), as `unanswered` (FLOW_HOST_ENDINGS).
// - Its heap is CAPPED BY V8 (4A2-Q7 (b) as re-ruled 11:46Z): the script runs in a worker_threads Worker inside the
//   host, under `resourceLimits.maxOldGenerationSizeMb` = `heapMb` (a packaged SEA takes no `--max-old-space-size`; a
//   worker's resourceLimits are no node option). A worker V8 ends past it is the host's `memory`, and the run is
//   ended as `memory`. Each pong's heap is telemetry, kept for the log. A child V8 aborts whole for its heap (SIGABRT,
//   or its stderr's heap line, read as a bounded tail) is read as `memory` too, never as a host that left, so its run
//   is never started again.
// - A run's end is settled when the child has LEFT, never before: when `ended` resolves, its process is gone.

/** A call the script made, as the host sent it: what it is (FLOW_CALL_WHATS, OPEN) and its arguments; `call`, its
 * number in the run's journal, once replay (replay.ts) has journaled it, so a step's origin can name it. */
export interface FlowHostCall {
  readonly what: string;
  readonly args: readonly unknown[];
  readonly call?: number;
}

/** A call's answer: the script's `await` resolves with `value`, or throws with `refused`'s words. */
export type FlowHostAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly refused: string };

/** What answers a run's calls and hears its log lines. */
export interface FlowCallHandler {
  call(call: FlowHostCall): Promise<FlowHostAnswer>;
  log(text: string): void;
}

/** How a run's host ended:
 * - `done`: the default export returned (`value`, or `cut` when it was past FLOW_LIMITS.RESULT_MAX_BYTES);
 * - `threw`: it threw, or the script would not evaluate (SES's own refusals among them);
 * - `ended`: fieldd ended the host, for FLOW_HOST_ENDINGS' reason;
 * - `stopped`: fieldd stopped it when asked (`stop()`: the run's Stop, fieldd's own stop);
 * - `left`: the child left on its own (its pipe closed under it, killed alone);
 * - `fatal`: the host could not run a script (it would not start, never said READY, or said why);
 * - `refused`: no host was started for these bytes (too big, or not a flow fieldd can rewrite);
 * - `unconfigured`: this copy of VibeField cannot start a host (FLOW_HOST.STATE_UNCONFIGURED). */
export type FlowHostEnd =
  | { readonly kind: "done"; readonly value?: unknown; readonly cut?: true }
  | { readonly kind: "threw"; readonly message: string }
  | { readonly kind: "ended"; readonly why: FlowHostEnding }
  | { readonly kind: "stopped" }
  | { readonly kind: "left"; readonly code: number | null; readonly signal: string | null }
  | { readonly kind: "fatal"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unconfigured"; readonly reason: string };

/** The host's clock, FLOW_LIMITS' by default; tests shorten it. `stopGraceMs`: how long a `shutdown` is given before
 * SIGKILL. */
export interface FlowHostTimings {
  readonly readyMs: number;
  readonly pingMs: number;
  readonly pingMisses: number;
  readonly stopGraceMs: number;
}

export interface FlowHostOptions {
  readonly launch: FlowsHostLaunchChoice;
  /** the approved bytes (the version the run runs, CP-D10) */
  readonly bytes: Uint8Array;
  readonly input: Readonly<Record<string, string>>;
  readonly handler: FlowCallHandler;
  readonly timings?: Partial<FlowHostTimings>;
  /** the V8 old-generation cap on the host's worker, MB (FLOW_LIMITS.HOST_HEAP_MB by default; tests lower it) */
  readonly heapMb?: number;
  /** the environment the child's PATH is read from; fieldd's own by default */
  readonly environment?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  /** how the child is started: Node's own spawn; a test hands its own to reach the child it started */
  readonly spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}

export interface FlowHostRun {
  /** the child's pid once it said READY; undefined when no host started or it never did */
  readonly ready: Promise<number | undefined>;
  readonly ended: Promise<FlowHostEnd>;
  /** end the host: `shutdown`, then SIGKILL past the grace; answered with how it ended */
  stop(): Promise<FlowHostEnd>;
}

/** How long fieldd waits for a host's READY before it ends the child and says so: fieldd's own timing, as the files
 * and transcript workers' are (cp-landing 11:17Z, upheld), not a run's bound. */
const HOST_READY_MS = 10_000;

/** The host's clock by default: FLOW_LIMITS' ping, fieldd's READY wait, and a `shutdown`'s grace before SIGKILL. */
const DEFAULT_TIMINGS: FlowHostTimings = {
  readyMs: HOST_READY_MS,
  pingMs: FLOW_LIMITS.HOST_PING_MS,
  pingMisses: FLOW_LIMITS.HOST_PING_MISSES,
  stopGraceMs: 2_000,
};

/** V8's own words when it aborts a process for its heap ("Reached heap limit", "JavaScript heap out of memory"). */
const V8_HEAP_LINE = /heap limit|JavaScript heap out of memory/;

/** Lines of the child's stderr kept for fieldd's log, each cut. */
const STDERR_LINES = 4;
const STDERR_LINE_MAX = 512;
/** The stderr tail V8's heap line is looked for in: a line split across writes is still read whole (bth 11:48Z). */
const STDERR_TAIL_MAX = 4_096;

const kib = (bytes: number): string => `${Math.floor(bytes / 1024)} KiB (${bytes} bytes)`;

/** The child's environment: PATH alone (4A2-Q6 (b)), so no FIELD_* or FIELDD_* variable, and nothing else of
 * fieldd's, reaches a person's script or the runtime under it (EL7). */
function flowsHostEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const path = source["PATH"];
  return path === undefined ? {} : { PATH: path };
}

/** An answer as the pipe may carry it, and as a run's journal keeps it (replay.ts): whole up to
 * FLOW_LIMITS.RESULT_MAX_BYTES; past it, text cut to fit (`cut`) and anything else refused. */
export function boundedAnswer(answer: FlowHostAnswer): FlowHostAnswer & { readonly cut?: true } {
  const max = FLOW_LIMITS.RESULT_MAX_BYTES;
  if (!answer.ok) return { ok: false, refused: cutText(answer.refused, FLOW_LOG_MAX) };
  if (flowAnswerBytes(answer.value) <= max) return answer;
  if (typeof answer.value !== "string")
    return {
      ok: false,
      refused: `VibeField can't hand this answer on: an answer is at most ${kib(max)}`,
    };
  return { ok: true, value: longestWithin(answer.value, max), cut: true };
}

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** `n` code units of `text`, or one fewer where `n` would split a surrogate pair: a prefix of whole characters. */
const wholeAt = (text: string, n: number): number =>
  n > 0 && n < text.length && isHigh(text.charCodeAt(n - 1)) && isLow(text.charCodeAt(n))
    ? n - 1
    : n;

/** The longest prefix of `text`, in whole characters, whose JSON is at most `max` bytes (bth's review finding 7): a
 * binary search against flowAnswerBytes itself, so a character JSON spends 6 bytes on (a control character, an ANSI
 * escape) is counted as it costs, and the prefix's end is held at 0 or above. Over whole-character prefixes the bytes
 * only grow, so the search finds the longest. Each code unit costs at least one byte, so no prefix longer than `max`
 * code units fits. */
function longestWithin(text: string, max: number): string {
  let fits = 0;
  let over = Math.min(text.length, max) + 1;
  while (over - fits > 1) {
    const mid = Math.floor((fits + over) / 2);
    if (flowAnswerBytes(text.slice(0, wholeAt(text, mid))) <= max) fits = mid;
    else over = mid;
  }
  return text.slice(0, wholeAt(text, fits));
}

const cutText = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;

/** A run that never had a host: its end, at once. */
function settled(end: FlowHostEnd): FlowHostRun {
  const ended = Promise.resolve(end);
  return { ready: Promise.resolve(undefined), ended, stop: () => ended };
}

/** Start a run's host. */
export function startFlowHost(opts: FlowHostOptions): FlowHostRun {
  const size = opts.bytes.byteLength;
  if (size > FLOW_LIMITS.SCRIPT_MAX_BYTES)
    return settled({
      kind: "refused",
      reason: `a flow's script is at most ${kib(FLOW_LIMITS.SCRIPT_MAX_BYTES)}; this one is ${size} bytes`,
    });
  if (opts.launch.kind === "unconfigured")
    return settled({ kind: "unconfigured", reason: opts.launch.reason });
  const read = flowScriptOf(opts.bytes);
  if (read.kind === "refused") return settled({ kind: "refused", reason: read.reason });
  return new FlowHostChild(opts.launch.launch, read.script, opts).run;
}

/** One child, from its spawn to its exit. */
class FlowHostChild {
  readonly run: FlowHostRun;
  readonly #opts: FlowHostOptions;
  readonly #script: string;
  readonly #t: FlowHostTimings;
  readonly #logger: Logger;
  readonly #proc: ChildProcess;
  /** the child's fd 3 (protocol.ts) */
  readonly #pipe: Duplex;
  readonly #stderr: string[] = [];
  readonly #heapMb: number;
  /** the last of the child's stderr, where V8's heap line is looked for */
  #stderrTail = "";
  /** the heap the worker last said it used (a pong's telemetry), bytes */
  #heap: number | undefined;
  #settle: (end: FlowHostEnd) => void = () => {};
  #ready: (pid: number | undefined) => void = () => {};
  #isReady = false;
  #settled = false;
  /** the end fieldd chose before the child left (its script's end, `ended`, `stopped`) */
  #chosen: FlowHostEnd | undefined;
  #heardAt = 0;
  #pingN = 0;
  #readyTimer: NodeJS.Timeout | undefined;
  #pingTimer: NodeJS.Timeout | undefined;
  #killTimer: NodeJS.Timeout | undefined;

  constructor(launch: FlowsHostLaunch, script: string, opts: FlowHostOptions) {
    this.#opts = opts;
    this.#script = script;
    this.#t = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.#heapMb = opts.heapMb ?? FLOW_LIMITS.HOST_HEAP_MB;
    this.#logger = opts.logger ?? createNoopLogger();
    const ready = new Promise<number | undefined>((resolve) => {
      this.#ready = resolve;
    });
    const ended = new Promise<FlowHostEnd>((resolve) => {
      this.#settle = resolve;
    });
    this.run = { ready, ended, stop: () => this.#stop() };
    this.#proc = (opts.spawn ?? nodeSpawn)(launch.command, [...launch.args], {
      stdio: ["ignore", "ignore", "pipe", "pipe"],
      env: flowsHostEnvironment(opts.environment ?? process.env),
    });
    // ChildProcess says 'error' for a spawn that failed, and also for a kill or a write that failed while the child
    // lives (bth's review finding 8): only the first settles the run; the others are logged, and the child's own exit
    // (`close`) settles it, with its own end
    this.#proc.on("error", (error) => {
      if (this.#proc.pid === undefined) {
        this.#finish({ kind: "fatal", reason: `the flow host did not start: ${error.message}` });
        return;
      }
      this.#logger.warn("fieldd.flows.host.error", "The flow host's process said an error", {
        error: error.message,
      });
    });
    this.#pipe = this.#proc.stdio[3] as Duplex;
    const reader = new FrameReader(
      FLOW_LIMITS.RESULT_MAX_BYTES + FLOW_FRAME_ENVELOPE,
      (raw) => this.#hear(raw),
      (why) => this.#unread(why),
    );
    this.#pipe.on("data", (chunk: Buffer) => reader.read(chunk));
    this.#pipe.on("error", (error) => {
      // a write to a child that has left (EPIPE): its exit says how it ended
      this.#logger.debug("fieldd.flows.host.pipe", "The flow host's pipe failed", {
        error: error.message,
      });
    });
    // `close`, not `exit`: the child has left AND its stderr is read to its end (V8's heap line is often its last)
    this.#proc.on("close", (code, signal) =>
      this.#finish(this.#chosen ?? this.#leftAs(code, signal)),
    );
    this.#proc.stderr?.setEncoding("utf8");
    this.#proc.stderr?.on("data", (chunk: string) => this.#heardStderr(chunk));
    this.#readyTimer = setTimeout(
      () =>
        this.#end(
          {
            kind: "fatal",
            reason: `the flow host did not say it was ready in ${this.#t.readyMs} ms`,
          },
          "kill",
        ),
      this.#t.readyMs,
    );
  }

  #send(message: ToFlowHost): void {
    if (this.#pipe.writable && !this.#pipe.destroyed) this.#pipe.write(frameOf(message));
  }

  /** A frame fieldd does not read ends the run at once: the child no longer holds its own bounds. */
  #unread(why: FrameRefusal): void {
    this.#logger.warn("fieldd.flows.host.protocol", "The flow host broke its pipe's bounds", {
      why,
    });
    this.#end({ kind: "ended", why: "protocol" }, "kill");
  }

  #hear(raw: unknown): void {
    const message: FromFlowHost | null = readFromFlowHost(raw);
    if (message === null) {
      this.#logger.warn(
        "fieldd.flows.host.unread",
        "The flow host sent a message fieldd does not read",
      );
      return;
    }
    this.#heardAt = Date.now();
    switch (message.t) {
      case "ready":
        if (this.#isReady) return;
        this.#isReady = true;
        clearTimeout(this.#readyTimer);
        this.#ready(message.pid);
        this.#send({
          t: "run",
          script: this.#script,
          input: this.#opts.input,
          limits: {
            callMaxBytes: FLOW_LIMITS.RESULT_MAX_BYTES,
            logMaxChars: FLOW_LOG_MAX,
            heapMb: this.#heapMb,
          },
        });
        this.#pingTimer = setInterval(() => this.#tick(), this.#t.pingMs);
        return;
      case "call":
        this.#call(message.id, message.what, message.args);
        return;
      case "log":
        if (this.#chosen === undefined) this.#opts.handler.log(cutText(message.text, FLOW_LOG_MAX));
        return;
      case "pong":
        if (message.heap !== undefined) this.#heap = message.heap;
        return;
      case "memory":
        this.#end({ kind: "ended", why: "memory" }, "shutdown");
        return;
      case "done": {
        // the value is bounded here again: a child's word that it is within RESULT_MAX_BYTES is not fieldd's (P2)
        const whole =
          "value" in message && flowAnswerBytes(message.value) <= FLOW_LIMITS.RESULT_MAX_BYTES;
        this.#end(
          {
            kind: "done",
            ...(whole ? { value: message.value } : {}),
            ...(message.cut === true || ("value" in message && !whole)
              ? { cut: true as const }
              : {}),
          },
          "shutdown",
        );
        return;
      }
      case "threw":
        this.#end({ kind: "threw", message: message.message }, "shutdown");
        return;
      case "fatal":
        this.#end({ kind: "fatal", reason: message.reason }, "shutdown");
        return;
    }
  }

  #call(id: number, what: string, args: unknown[]): void {
    if (this.#chosen !== undefined) return;
    if (flowAnswerBytes(args) > FLOW_LIMITS.RESULT_MAX_BYTES) {
      this.#answer(id, {
        ok: false,
        refused: `VibeField can't send this ${what}: a call is at most ${kib(FLOW_LIMITS.RESULT_MAX_BYTES)}`,
      });
      return;
    }
    this.#opts.handler.call({ what, args }).then(
      (answer) => this.#answer(id, answer),
      (error: unknown) => {
        this.#logger.warn("fieldd.flows.host.handler", "A flow call's handler failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.#answer(id, { ok: false, refused: "VibeField could not answer this call." });
      },
    );
  }

  #answer(id: number, answer: FlowHostAnswer): void {
    if (this.#chosen !== undefined) return;
    const bounded = boundedAnswer(answer);
    this.#send(
      bounded.ok
        ? { t: "answer", id, ok: true, value: bounded.value }
        : { t: "answer", id, ok: false, refused: bounded.refused },
    );
  }

  /** One ping: a host silent for `pingMisses` pings in a row is ended, as `unanswered`. */
  #tick(): void {
    if (Date.now() - this.#heardAt >= this.#t.pingMs * this.#t.pingMisses) {
      this.#end({ kind: "ended", why: "unanswered" }, "kill");
      return;
    }
    this.#pingN += 1;
    this.#send({ t: "ping", n: this.#pingN });
  }

  #stop(): Promise<FlowHostEnd> {
    this.#end({ kind: "stopped" }, "shutdown");
    return this.run.ended;
  }

  /** Choose the run's end, once, and see the child out: `shutdown` with a grace, or SIGKILL now. */
  #end(end: FlowHostEnd, how: "shutdown" | "kill"): void {
    if (this.#chosen !== undefined || this.#settled) return;
    this.#chosen = end;
    clearTimeout(this.#readyTimer);
    clearInterval(this.#pingTimer);
    if (how === "kill") {
      this.#proc.kill("SIGKILL");
      return;
    }
    this.#send({ t: "shutdown" });
    this.#killTimer = setTimeout(() => this.#proc.kill("SIGKILL"), this.#t.stopGraceMs);
  }

  /** How a child that left on its own ended: V8's abort for its heap is `memory`; any other way, a host that left. */
  #leftAs(code: number | null, signal: NodeJS.Signals | null): FlowHostEnd {
    if (signal === "SIGABRT" || V8_HEAP_LINE.test(this.#stderrTail))
      return { kind: "ended", why: "memory" };
    return { kind: "left", code, signal };
  }

  #heardStderr(chunk: string): void {
    this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_TAIL_MAX);
    for (const line of chunk.split("\n")) {
      if (line.trim() === "" || this.#stderr.length >= STDERR_LINES) continue;
      this.#stderr.push(line.slice(0, STDERR_LINE_MAX));
    }
  }

  #finish(end: FlowHostEnd): void {
    if (this.#settled) return;
    this.#settled = true;
    clearTimeout(this.#readyTimer);
    clearInterval(this.#pingTimer);
    clearTimeout(this.#killTimer);
    if (!this.#isReady) this.#ready(undefined);
    if (this.#stderr.length > 0)
      this.#logger.info("fieldd.flows.host.stderr", "The flow host wrote to stderr", {
        lines: this.#stderr,
      });
    this.#logger.debug("fieldd.flows.host.ended", "A flow host left", {
      end: end.kind,
      ...(this.#heap !== undefined ? { heap: this.#heap } : {}),
    });
    this.#settle(end);
  }
}
