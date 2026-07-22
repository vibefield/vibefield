import { type ChildProcess, spawn } from "node:child_process";
import { assertDataRootUsable } from "./paths";
import { type ProbeResult, tryAdopt } from "./probe";
import { createLineBuffer, createLogTail } from "./process-log";
import {
  type FielddHandle,
  type FielddSupervisor,
  type FielddSupervisorOptions,
  type ProbeFailure,
  SupervisorError,
} from "./types";

// The adopt-or-spawn state machine (spec §5.3). Ownership is explicit and
// determined by evidence: the handle is "spawned" only when product.json's pid
// IS our child's pid — anything else that became ready in the root is adopted,
// and adopted daemons are never killed by any path here.

const READINESS_DEADLINE_MS = 20_000;
const ADOPT_PROBE_MS = 1_500;
const POLL_PROBE_MS = 600;
const POLL_INTERVAL_MS = 200;
const STOP_TERM_WAIT_MS = 2_000;

export function createFielddSupervisor(opts: FielddSupervisorOptions): FielddSupervisor {
  const log = (line: string) => opts.onLog?.(line);
  const internal = new AbortController(); // dispose() cancels everything through this
  let inflight: Promise<FielddHandle> | null = null;
  let handle: FielddHandle | null = null;
  let child: ChildProcess | null = null;
  let disposed = false;

  function ensure(options?: { signal?: AbortSignal }): Promise<FielddHandle> {
    if (disposed) return Promise.reject(new SupervisorError("disposed", "supervisor disposed"));
    // a resolved handle stays THE handle while its client lives (spec: same
    // live handle for concurrent callers); closed/failed clears for a re-run
    if (handle) {
      const s = handle.client.status;
      if (s !== "closed" && s !== "failed") return Promise.resolve(handle);
      handle = null;
    }
    if (inflight) return inflight;
    const signal = options?.signal
      ? AbortSignal.any([options.signal, internal.signal])
      : internal.signal;
    inflight = run(signal).then(
      (h) => {
        handle = h;
        inflight = null;
        return h;
      },
      (e: unknown) => {
        inflight = null;
        throw e;
      },
    );
    return inflight;
  }

  async function run(signal: AbortSignal): Promise<FielddHandle> {
    assertDataRootUsable(opts.dataRoot);
    throwIfAborted(signal);

    const adopted = await tryAdopt(opts.dataRoot, opts.adoptProbeMs ?? ADOPT_PROBE_MS, signal);
    throwIfAborted(signal);
    if (adopted.ok) {
      log(`adopted running fieldd :${adopted.info.port} (${adopted.info.bootId})`);
      return makeHandle("adopted", adopted);
    }
    log(`no adoptable fieldd (${adopted.failure}) — spawning`);

    const tail = createLogTail();
    const spawned = spawnFieldd(tail);
    child = spawned;

    // child exit before readiness rejects PROMPTLY (spec; slice-0 finding 3)
    const exitState: { info: { code: number | null; signal: NodeJS.Signals | null } | null } = {
      info: null,
    };
    const exitWaiters = new Set<() => void>();
    const noteExit = (code: number | null, sig: NodeJS.Signals | null) => {
      exitState.info = { code, signal: sig };
      for (const wake of [...exitWaiters]) wake();
    };
    spawned.on("exit", (code, sig) => noteExit(code, sig));
    spawned.on("error", (e) => {
      tail.note(String(e));
      noteExit(null, null);
    });

    const deadline = Date.now() + (opts.readinessDeadlineMs ?? READINESS_DEADLINE_MS);
    let lastFailure: ProbeFailure = "no-run-files";
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const exited = exitState.info;
      if (exited) {
        throw new SupervisorError(
          "child-exit",
          `fieldd exited before readiness (code ${exited.code}, signal ${exited.signal})` +
            (tail.lines().length > 0 ? `\n  ${tail.lines().join("\n  ")}` : ""),
          lastFailure,
        );
      }
      const probe = await tryAdopt(opts.dataRoot, POLL_PROBE_MS, signal);
      if (probe.ok) {
        const ownership = probe.info.pid === spawned.pid ? "spawned" : "adopted";
        if (ownership === "adopted") {
          // someone else's daemon owns the root — ours lost the race; stop it
          log(`root already served by pid ${probe.info.pid} — stopping our spawn`);
          spawned.kill("SIGTERM");
          child = null;
        } else {
          log(`fieldd up :${probe.info.port} (${probe.info.bootId})`);
        }
        return makeHandle(ownership, probe);
      }
      lastFailure = probe.failure;
      // sleep, but wake early on child exit or abort — never sit out the
      // interval while the child is already dead
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, POLL_INTERVAL_MS);
        function done(): void {
          clearTimeout(t);
          signal.removeEventListener("abort", done);
          exitWaiters.delete(done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
        exitWaiters.add(done);
      });
    }
    throw new SupervisorError(
      "readiness-timeout",
      `fieldd did not come up within ${opts.readinessDeadlineMs ?? READINESS_DEADLINE_MS}ms ` +
        `(last probe: ${lastFailure})`,
      lastFailure,
    );
  }

  function spawnFieldd(tail: ReturnType<typeof createLogTail>): ChildProcess {
    const env: Record<string, string | undefined> = {
      ...opts.environment,
      FIELDD_DATA_DIR: opts.dataRoot,
      ...(opts.nativeExecutable ? { FIELDD_NATIVE_BIN: opts.nativeExecutable } : {}),
      ...(opts.allowedOrigins && opts.allowedOrigins.length > 0
        ? { FIELDD_ALLOWED_ORIGINS: opts.allowedOrigins.join(",") }
        : {}),
      ...(opts.controlPort !== undefined ? { FIELDD_CONTROL_PORT: String(opts.controlPort) } : {}),
      ...(opts.dataPort !== undefined ? { FIELDD_DATA_PORT: String(opts.dataPort) } : {}),
    };
    let spawned: ChildProcess;
    try {
      spawned = spawn(opts.spawn.command, [...opts.spawn.args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      throw new SupervisorError(
        "spawn-failed",
        `could not spawn fieldd: ${String(e)}`,
        undefined,
        e,
      );
    }
    const sink = (line: string) => {
      tail.note(line);
      log(line);
    };
    const out = createLineBuffer(sink);
    const err = createLineBuffer(sink);
    spawned.stdout?.on("data", (d: Buffer) => out.push(d));
    spawned.stderr?.on("data", (d: Buffer) => err.push(d));
    spawned.on("close", () => {
      out.flush();
      err.flush();
    });
    log(`spawned fieldd pid=${spawned.pid}`);
    return spawned;
  }

  function makeHandle(
    ownership: "adopted" | "spawned",
    probe: Extract<ProbeResult, { ok: true }>,
  ): FielddHandle {
    const ownedChild = ownership === "spawned" ? child : null;
    let stopping: Promise<void> | null = null;
    return {
      ownership,
      info: probe.info,
      client: probe.client,
      ...(ownedChild?.pid !== undefined ? { childPid: ownedChild.pid } : {}),
      stopOwned(): Promise<void> {
        if (ownership !== "spawned" || !ownedChild) return Promise.resolve(); // never kill adopted
        stopping ??= stopChild(ownedChild, probe.info.nativePid);
        return stopping;
      },
    };
  }

  async function stopChild(proc: ChildProcess, nativePid: number | null): Promise<void> {
    // stop-owned is FULL dev/smoke teardown: the spawned fieldd and the
    // field-native it recorded. (In production nothing calls this — the
    // two-plane law keeps daemons alive past the shell.)
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve();
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, STOP_TERM_WAIT_MS);
      proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    if (nativePid !== null) {
      try {
        process.kill(nativePid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    internal.abort();
    const h = handle;
    handle = null;
    if (h) {
      h.client.close();
      if (opts.shutdownPolicy === "stop-owned") await h.stopOwned();
    } else if (opts.shutdownPolicy === "stop-owned" && child && child.exitCode === null) {
      // ensure() never resolved but we DID spawn — don't leak the child
      // (slice-0 finding 3: failure paths must not orphan daemons)
      await stopChild(child, null);
    }
    child = null;
  }

  return { ensure, dispose };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new SupervisorError("aborted", "supervisor operation aborted");
}
