// EY-1 (2026-11-19) — THE PAGE ENGINE'S SUPERVISOR: one engine per run (BU-20), main's own child.
// - Start: the identity check first, every time. Then the pinned binary in daemon mode, spawned as
//   main's DIRECT child (no setsid, so main holds the child and needs no pid file), in its own
//   surroundings, with the environment built from nothing. Ready means its socket answers. The
//   broker then arms a key and sends the engine's own `launch`.
// - The stream stays off (the release binary's stream port, 2026-11-24): the engine is the pin's
//   source build, spawned with its three switches on and THIS process as its socket's one peer
//   (surroundings.ts). Once it is ready its socket folder is read: a stream's port file there
//   means the listener came up after all. That engine is refused and stopped, never leased, and
//   this supervisor starts no engine after it: the same file would open the same listener.
//   Errata (2026-11-24, a folder main cannot read): a folder that could not be READ was taken for
//   that file, so one failed read turned pages off for main's whole life under the reason
//   `stream-on`. It says nothing of the build. That engine alone is refused and stopped, never
//   leased (what main cannot tell, it refuses), under the reason `stream-unread`, and the run's
//   next call starts another, read afresh. It is not permanent, and it is bounded: each such
//   engine's exit is counted, so three inside the crash window stop the run's engine.
// - One start at a time per run: a second caller waits for the first start's answer.
// - Restart is lazy: an engine that exits is started again by the run's next call. Too many exits
//   in a short window stop the run's engine, and its calls are answered unavailable.
// - An exit is told to the broker at once (`onExit`), so the calls in flight on it are failed.
//   Errata (2026-11-24, an engine's exits and restarts): until this day nothing listened, so that
//   sentence was false; the broker subscribes as it is made, and a row holds it on the real two.
//   Errata (2026-11-24, an exit's number): "an exit" is the exit of the engine its run holds. A
//   run that was stopped is forgotten and counts its generations from one again, so the exit of
//   an engine the run no longer holds (stopped, or already succeeded) is told to nobody: its
//   number may be its successor's, and a listener would fail the calls of an engine that runs.
// - A start that misses its ready deadline is a slow start, not a crash (2026-11-24): main ends it
//   and its exit is not counted, so a loaded minute cannot stop the run's engine. An engine that
//   exits by itself before it is ready is counted, as any exit is.
// - `replace` (2026-11-24) ends a run's engine and keeps the run: for an engine that hangs or has
//   left the bridge while its process lives. It is counted once as an exit, so an engine main keeps
//   replacing is stopped as one that keeps exiting is. `stop` forgets the run, count and all.
// - Stop is a ladder: the engine's own `close` over its socket, then SIGTERM, then SIGKILL, each
//   to this child alone, resolving once it has exited. A pid read from a file is never signalled:
//   those files are writable by any same-uid process (EL7). Every engine is stopped at once, and
//   the ones that did not end are said by count.
// - Roots: an instance's root ends once its engine's exit has been seen (or when its start
//   failed), and before the first root is made, the roots earlier mains left are swept (roots.ts).
//   The daemon runs in the child itself (agent-browser's main.rs:1423-1434 at v0.41.0: no fork),
//   so an engine never outlives main's quit, and after a crash it ends at its own idle bound.
// The numbers here are provisional; EY-1's desk row measures them (2026-11-19).

import {
  type DaemonExchangeOptions,
  daemonReady,
  daemonRequestId,
  exchangeDaemon,
  type PagesDaemonCommand,
  type PagesDaemonExchange,
} from "./daemon-client";
import type { PagesEngineIdentityResult } from "./engine-identity";
import {
  type PagesStreamShown,
  type PagesSurroundings,
  pagesEngineEnv,
  pagesStreamShown,
} from "./surroundings";

/** How long a started engine has to answer on its socket. */
export const ENGINE_READY_MS = 10_000;
/** Each rung of the stop ladder waits this long for the child's exit. */
export const ENGINE_STOP_RUNG_MS = 3_000;
/** A run whose engine exits this many times inside the window is stopped, not restarted. */
export const ENGINE_CRASH_LOOP = { exits: 3, windowMs: 60_000 } as const;

/** The daemon exchange's options: the deadline, and the clock and the connect only when given, so
 * an absent option stays absent (exactOptionalPropertyTypes). */
export function daemonOptions(
  deadlineAt: number,
  given: {
    readonly now?: (() => number) | undefined;
    readonly connect?: DaemonExchangeOptions["connect"];
  },
): DaemonExchangeOptions {
  return {
    deadlineAt,
    ...(given.now === undefined ? {} : { now: given.now }),
    ...(given.connect === undefined ? {} : { connect: given.connect }),
  };
}

/** The states a pages UNAVAILABLE names when a run's engine is down. They join contracts'
 * PAGES_UNAVAILABLE_STATES (today `no-window` alone) by addition. */
export type PagesEngineUnavailable =
  | "not-installed"
  | "engine-refused"
  | "engine-starting"
  | "engine-stopped";

/** The child as the supervisor uses it: node's ChildProcess in the product, a fake in a test. */
export interface EngineChild {
  readonly pid?: number | undefined;
  kill(signal: "SIGTERM" | "SIGKILL"): boolean;
  once(event: "exit", listener: (code: number | null, signal: string | null) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
}

export type SpawnEngine = (
  file: string,
  args: readonly string[],
  o: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
) => EngineChild;

/** A started engine, as the broker holds it for one call. */
export interface EngineLease {
  readonly run: string;
  readonly generation: number;
  readonly socketPath: string;
  readonly surroundings: PagesSurroundings;
}

export type EnsureAnswer =
  | { readonly ok: true; readonly engine: EngineLease }
  | { readonly ok: false; readonly unavailable: PagesEngineUnavailable };

export interface PagesEngineSupervisorDeps {
  /** The pinned binary's path (resources' `pagesEnginePath`); null when this build has none. */
  readonly enginePath: () => string | null;
  /** The identity check, run before every start, in the new instance's surroundings. */
  readonly identity: (path: string, s: PagesSurroundings) => Promise<PagesEngineIdentityResult>;
  /** Makes one instance's surroundings (makePagesSurroundings, bound to its parent). */
  readonly surroundings: () => PagesSurroundings;
  /** The smoke's run mark, in a smoke only. */
  readonly smokeRun?: string | undefined;
  /** The ONE process the engine's socket admits (its peer list): main itself, which makes every
   * exchange with the engine. This process's own pid when none is given, as in the product. */
  readonly peerPid?: number | undefined;
  /** What a ready engine's socket folder shows of its stream (surroundings' `pagesStreamShown`
   * when none is given, as in the product). */
  readonly stream?: ((s: PagesSurroundings) => PagesStreamShown) | undefined;
  readonly spawn: SpawnEngine;
  /** Run once, before this supervisor's first root is made: the sweep of earlier mains' roots. */
  readonly sweep?: () => Promise<unknown>;
  /** Ends an instance's root: once its engine's exit has been seen, or when its start failed. */
  readonly forget?: (s: PagesSurroundings) => void;
  readonly now?: () => number;
  readonly exchange?: typeof exchangeDaemon;
  readonly ready?: typeof daemonReady;
  readonly connect?: DaemonExchangeOptions["connect"];
  /** The ready wait and each stop rung (the constants above in the product; short in a test). */
  readonly readyMs?: number;
  readonly stopRungMs?: number;
  /** Durations and counts only, never a value, a key or a path. */
  readonly log?: (event: string, fields: Readonly<Record<string, number | string>>) => void;
  /** A testing hook alone (src/testing/pages-engine-kill.ts): told each engine child once it is
   * spawned. Production passes none, so main holds no child beyond the supervisor's own. */
  readonly onSpawned?: (run: string, generation: number, child: EngineChild) => void;
}

interface Engine {
  readonly lease: EngineLease;
  readonly child: EngineChild;
  readonly exited: Promise<void>;
  gone: boolean;
  /** main is ending it (a slow start, a replace): never handed out again, and its exit is not
   * counted when it comes, since what it is counted as was settled when main ended it */
  retired: boolean;
}

interface RunState {
  engine: Engine | null;
  starting: Promise<EnsureAnswer> | null;
  exits: number[];
  stopped: boolean;
  generation: number;
}

export class PagesEngineSupervisor {
  readonly #deps: PagesEngineSupervisorDeps;
  readonly #runs = new Map<string, RunState>();
  readonly #exitListeners = new Set<(run: string, generation: number) => void>();
  /** the ladders of the engines being replaced: a stop of everything waits for them too */
  readonly #replacing = new Set<Promise<boolean>>();
  #closed = false;
  /** An engine came up with its stream on: no engine is started after it. */
  #streamOn = false;
  #swept: Promise<void> | null = null;
  #starts = 0;
  #exits = 0;

  constructor(deps: PagesEngineSupervisorDeps) {
    this.#deps = deps;
  }

  /** Tells `listener` of every engine exit, by run and generation. */
  onExit(listener: (run: string, generation: number) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  /** The run's engine, started if it has none. One start at a time per run. */
  ensure(run: string): Promise<EnsureAnswer> {
    if (this.#closed) return Promise.resolve({ ok: false, unavailable: "engine-stopped" });
    if (this.#streamOn) return Promise.resolve({ ok: false, unavailable: "engine-refused" });
    const state = this.#state(run);
    if (state.stopped) return Promise.resolve({ ok: false, unavailable: "engine-stopped" });
    if (state.engine !== null && !state.engine.gone && !state.engine.retired) {
      return Promise.resolve({ ok: true, engine: state.engine.lease });
    }
    if (state.starting !== null) return state.starting;
    const starting = this.#start(run, state).finally(() => {
      if (state.starting === starting) state.starting = null;
    });
    state.starting = starting;
    return starting;
  }

  /** Stops the run's engine (the ladder) and forgets the run. */
  async stop(run: string): Promise<void> {
    await this.#stopRun(run);
  }

  /** Ends the run's engine (the ladder) and keeps the run: its next call starts the next
   * generation, and its count of exits stands, with this one in it. Nothing to do for a run with
   * no engine, or one whose engine is gone or already being ended. Retired before the first wait,
   * so a call that comes while it ends is never handed it. */
  async replace(run: string): Promise<void> {
    const state = this.#runs.get(run);
    if (state === undefined) return;
    if (state.starting !== null) {
      await state.starting.catch(() => undefined);
      if (this.#runs.get(run) !== state) return;
    }
    const engine = state.engine;
    if (engine === null || engine.gone || engine.retired) return;
    engine.retired = true;
    this.#count(state);
    const ended = this.#ladder(engine);
    this.#replacing.add(ended);
    try {
      await ended;
    } finally {
      this.#replacing.delete(ended);
    }
  }

  /** Stops every engine at once; nothing starts after. Answers how many ended and how many did
   * not, and says the second by count. */
  async stopAll(): Promise<{ ended: number; unended: number }> {
    this.#closed = true;
    const results = await Promise.all([
      ...[...this.#runs.keys()].map((run) => this.#stopRun(run)),
      ...this.#replacing,
    ]);
    const ended = results.filter((r) => r === true).length;
    const unended = results.filter((r) => r === false).length;
    if (unended > 0) this.#deps.log?.("pages.engine.unended", { unended });
    return { ended, unended };
  }

  /** True when the run's engine ended, false when it did not, null when it had none. */
  async #stopRun(run: string): Promise<boolean | null> {
    const state = this.#runs.get(run);
    if (state === undefined) return null;
    this.#runs.delete(run);
    await state.starting?.catch(() => undefined);
    return state.engine === null ? null : this.#ladder(state.engine);
  }

  stats(): { engines: number; starts: number; exits: number } {
    let engines = 0;
    for (const state of this.#runs.values()) {
      if (state.engine !== null && !state.engine.gone) engines += 1;
    }
    return { engines, starts: this.#starts, exits: this.#exits };
  }

  #state(run: string): RunState {
    let state = this.#runs.get(run);
    if (state === undefined) {
      state = { engine: null, starting: null, exits: [], stopped: false, generation: 0 };
      this.#runs.set(run, state);
    }
    return state;
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  async #start(run: string, state: RunState): Promise<EnsureAnswer> {
    const path = this.#deps.enginePath();
    if (path === null) return { ok: false, unavailable: "not-installed" };
    this.#swept ??= Promise.resolve()
      .then(() => this.#deps.sweep?.())
      .then(
        () => undefined,
        () => undefined,
      );
    await this.#swept;
    let s: PagesSurroundings;
    try {
      s = this.#deps.surroundings();
    } catch {
      this.#deps.log?.("pages.engine.refused", { reason: "surroundings" });
      return { ok: false, unavailable: "engine-refused" };
    }
    const identity = await this.#deps.identity(path, s);
    if (!identity.ok) {
      this.#forget(s);
      this.#deps.log?.("pages.engine.refused", { reason: identity.reason });
      const unavailable = identity.reason === "no-path" ? "not-installed" : "engine-refused";
      return { ok: false, unavailable };
    }
    const env = pagesEngineEnv(s, {
      smokeRun: this.#deps.smokeRun,
      peerPid: this.#deps.peerPid ?? process.pid,
    });
    const startedAt = this.#now();
    let child: EngineChild;
    try {
      child = this.#deps.spawn(identity.path, [], { cwd: s.cwd, env });
    } catch {
      this.#forget(s);
      return { ok: false, unavailable: "engine-refused" };
    }
    this.#starts += 1;
    state.generation += 1;
    const lease: EngineLease = {
      run,
      generation: state.generation,
      socketPath: s.socketPath,
      surroundings: s,
    };
    let markGone: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      markGone = resolve;
    });
    const engine: Engine = { lease, child, exited, gone: false, retired: false };
    const onGone = () => {
      if (engine.gone) return;
      engine.gone = true;
      this.#exits += 1;
      markGone();
      this.#forget(s);
      this.#exited(run, engine);
    };
    child.once("exit", onGone);
    child.once("error", onGone);
    state.engine = engine;
    this.#deps.onSpawned?.(run, state.generation, child);
    const ready = await (this.#deps.ready ?? daemonReady)(
      s.socketPath,
      daemonOptions(startedAt + (this.#deps.readyMs ?? ENGINE_READY_MS), this.#deps),
    );
    if (!ready || engine.gone) {
      // still running and not ready in time: a slow start, which main ends and does not count
      if (!engine.gone) engine.retired = true;
      await this.#ladder(engine);
      return { ok: false, unavailable: "engine-starting" };
    }
    // An engine with the stream on writes its port file before it binds the socket, so a ready
    // engine's folder says which it is. Refused before any lease: the broker never speaks to it.
    // A stream that is on is the build's, and starts no engine again. A folder main could not read
    // refuses this engine alone (2026-11-24): the next start reads its own folder.
    const shown = (this.#deps.stream ?? pagesStreamShown)(s);
    if (shown !== "off") {
      if (shown === "on") this.#streamOn = true;
      const reason = shown === "on" ? "stream-on" : "stream-unread";
      this.#deps.log?.("pages.engine.refused", { reason });
      await this.#ladder(engine);
      return { ok: false, unavailable: "engine-refused" };
    }
    this.#deps.log?.("pages.engine.ready", {
      ms: this.#now() - startedAt,
      identity: identity.kind,
      stream: "off",
    });
    return { ok: true, engine: lease };
  }

  /** The root goes only after its engine is gone; its failure is said, never thrown. */
  #forget(s: PagesSurroundings): void {
    try {
      this.#deps.forget?.(s);
    } catch {
      this.#deps.log?.("pages.engine.root", { forgotten: "no" });
    }
  }

  /** One exit against the run: too many inside the window stop its engine. */
  #count(state: RunState): void {
    const at = this.#now();
    state.exits = [...state.exits, at].filter((t) => at - t < ENGINE_CRASH_LOOP.windowMs);
    if (state.exits.length >= ENGINE_CRASH_LOOP.exits) state.stopped = true;
  }

  #exited(run: string, engine: Engine): void {
    const state = this.#runs.get(run);
    // An engine its run no longer holds (2026-11-24): main stopped it and forgot the run, or the
    // run's next engine has started. Nobody is told. Main ended it, so only its own ladder waits
    // for this exit, and its generation may be the number of the engine the run holds now.
    if (state === undefined || state.engine !== engine) return;
    // an engine main retired was counted, or excused, when main ended it
    if (!engine.retired) this.#count(state);
    for (const listener of this.#exitListeners) {
      try {
        listener(run, engine.lease.generation);
      } catch {
        // a listener's failure is its own; the next is still told
      }
    }
  }

  /** The engine's own close, then SIGTERM, then SIGKILL: each to this child alone, each rung
   * waiting for its exit. True once the child has exited; false if it outlived every rung. */
  async #ladder(engine: Engine): Promise<boolean> {
    const waitExit = (ms: number) =>
      Promise.race([
        engine.exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
      ]);
    if (engine.gone) return true;
    const rung = this.#deps.stopRungMs ?? ENGINE_STOP_RUNG_MS;
    const close: PagesDaemonCommand = { id: daemonRequestId(this.#deps.now), action: "close" };
    const answer: PagesDaemonExchange = await (this.#deps.exchange ?? exchangeDaemon)(
      engine.lease.socketPath,
      close,
      daemonOptions(this.#now() + rung, this.#deps),
    );
    this.#deps.log?.("pages.engine.close", { answered: answer.ok ? "yes" : answer.failure });
    if (await waitExit(rung)) return true;
    engine.child.kill("SIGTERM");
    if (await waitExit(rung)) return true;
    engine.child.kill("SIGKILL");
    return waitExit(rung);
  }
}
