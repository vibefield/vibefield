import { type ChildProcess, spawn } from "node:child_process";
import type { FielddClient } from "@vibefield/fieldd-client";
import { assertDataRootUsable } from "./paths";
import { type ProbeResult, tryAdopt } from "./probe";
import { createLineBuffer, createLogTail, redactLine } from "./process-log";
import {
  type FielddHandle,
  type FielddReadySignal,
  type FielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  type ProbeFailure,
  SupervisorError,
  type SupervisorLifecycleEventName,
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
/** WIN-D5 — how long the stop VERB gets before the signal ladder takes over.
 * Short: the request is one loopback round trip; a daemon that cannot answer
 * it inside this budget is what the ladder exists for. */
const SHUTDOWN_RPC_WAIT_MS = 1_500;

export function createFielddSupervisor(opts: FielddSupervisorOptions): FielddSupervisor {
  const emit = (event: FielddSupervisorEvent): void => {
    try {
      opts.onEvent?.(event);
    } catch {
      // Observation must never control daemon ownership or lifecycle.
    }
  };
  const lifecycle = (
    event: SupervisorLifecycleEventName,
    message: string,
    attrs?: Readonly<Record<string, string | number | boolean | null>>,
  ): void => {
    emit({
      kind: "lifecycle",
      event,
      message,
      ...(attrs !== undefined ? { attrs } : {}),
    });
  };
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

    const adopted = await tryAdopt(
      opts.dataRoot,
      opts.adoptProbeMs ?? ADOPT_PROBE_MS,
      signal,
      opts.expectedBuildId,
      opts.userId,
    );
    throwIfAborted(signal);
    if (adopted.ok) {
      lifecycle("fieldd.supervisor.adopted", "Adopted a running fieldd", {
        port: adopted.info.port,
        pid: adopted.info.pid,
        bootId: adopted.info.bootId,
      });
      return makeHandle("adopted", adopted);
    }
    lifecycle("fieldd.supervisor.spawn_required", "No adoptable fieldd was available", {
      probeFailure: adopted.failure,
    });
    if (adopted.failure === "incompatible-build") {
      throw new SupervisorError(
        "incompatible-build",
        "a live fieldd from a different development build already owns this data root",
        adopted.failure,
      );
    }

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
      const line = redactLine(e.message);
      tail.note(`[stderr] ${line}`);
      emit({ kind: "stderr", line });
      noteExit(null, null);
    });

    try {
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
        const probe = await tryAdopt(
          opts.dataRoot,
          POLL_PROBE_MS,
          signal,
          opts.expectedBuildId,
          opts.userId,
        );
        if (probe.ok) {
          const ownership = probe.info.pid === spawned.pid ? "spawned" : "adopted";
          if (ownership === "adopted") {
            // someone else's daemon owns the root — ours lost the race; stop it
            // BOUNDED (TERM→KILL), not fire-and-forget: a surviving loser could
            // later be adopted and become unkillable
            lifecycle(
              "fieldd.supervisor.spawn_race_lost",
              "Another fieldd won the data-root spawn race",
              { incumbentPid: probe.info.pid, spawnedPid: spawned.pid ?? null },
            );
            await stopChild(spawned, null);
            child = null;
          } else {
            lifecycle("fieldd.supervisor.ready", "Spawned fieldd became ready", {
              port: probe.info.port,
              pid: probe.info.pid,
              bootId: probe.info.bootId,
            });
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
    } catch (error) {
      // The attempt is TERMINAL: it must never leak its child into a retry
      // (2026-07-23 review P1 — a timed-out spawn survived, the next attempt's
      // spawnFieldd overwrote `child`, orphaning the first; worse, a surviving
      // half-start could later be probed as "adopted" and become unkillable).
      // A child that never reached readiness is not a daemon the two-plane law
      // protects, so this stop applies under EVERY shutdown policy. fieldd's
      // own SIGTERM path tears down any field-native it started; pre-ready we
      // have no recorded nativePid to escalate on.
      if (exitState.info === null && spawned.exitCode === null) {
        await stopChild(spawned, null);
      }
      if (child === spawned) child = null;
      throw error;
    }
  }

  function spawnFieldd(tail: ReturnType<typeof createLogTail>): ChildProcess {
    const env: Record<string, string | undefined> = {
      ...opts.environment,
      FIELDD_DATA_DIR: opts.dataRoot,
      // UA-1 — the supervisor already resolved the attached USER root; the
      // explicit variable tells fieldd's standalone entry to skip its own
      // ensure (a bare run without it treats FIELDD_DATA_DIR as the VibeField
      // root and is its own supervisor).
      FIELDD_USER_ROOT: opts.dataRoot,
      // UA-2 — and WHICH user that root serves; fieldd records it in
      // product.json and asserts it in every hello ack.
      ...(opts.userId !== undefined ? { FIELDD_USER_ID: opts.userId } : {}),
      ...(opts.nativeExecutable ? { FIELDD_NATIVE_BIN: opts.nativeExecutable } : {}),
      ...(opts.allowedOrigins && opts.allowedOrigins.length > 0
        ? { FIELDD_ALLOWED_ORIGINS: opts.allowedOrigins.join(",") }
        : {}),
      ...(opts.controlPort !== undefined ? { FIELDD_CONTROL_PORT: String(opts.controlPort) } : {}),
      ...(opts.dataPort !== undefined ? { FIELDD_DATA_PORT: String(opts.dataPort) } : {}),
      ...(opts.expectedBuildId !== undefined ? { FIELDD_BUILD_ID: opts.expectedBuildId } : {}),
    };
    let spawned: ChildProcess;
    try {
      spawned = spawn(opts.spawn.command, [...opts.spawn.args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        // WIN-3 — a spawned fieldd is a background daemon; without this every
        // launch flashes a console window on Windows (EDP §10.2 forbids it).
        // Detach and job breakaway are a separate decision (§4.3), not here.
        windowsHide: true,
      });
    } catch (e) {
      throw new SupervisorError(
        "spawn-failed",
        `could not spawn fieldd: ${String(e)}`,
        undefined,
        e,
      );
    }
    let readySeen = false;
    const stdoutSink = (line: string) => {
      const signal = readySeen ? null : parseReadySignal(line);
      if (signal) {
        readySeen = true;
        emit({ kind: "readiness", signal });
        return;
      }
      tail.note(`[stdout] ${line}`);
      emit({ kind: "unexpected-stdout", line });
    };
    const stderrSink = (line: string) => {
      tail.note(`[stderr] ${line}`);
      emit({ kind: "stderr", line });
    };
    const out = createLineBuffer(stdoutSink);
    const err = createLineBuffer(stderrSink);
    spawned.stdout?.on("data", (d: Buffer) => out.push(d));
    spawned.stderr?.on("data", (d: Buffer) => err.push(d));
    spawned.on("close", () => {
      out.flush();
      err.flush();
    });
    lifecycle("fieldd.supervisor.spawned", "Spawned fieldd", {
      ...(spawned.pid !== undefined ? { pid: spawned.pid } : {}),
    });
    return spawned;
  }

  function makeHandle(
    ownership: "adopted" | "spawned",
    probe: Extract<ProbeResult, { ok: true }>,
  ): FielddHandle {
    const ownedChild = ownership === "spawned" ? child : null;
    let stopping: Promise<void> | null = null;
    const result: FielddHandle = {
      ownership,
      info: probe.info,
      client: probe.client,
      ...(ownedChild?.pid !== undefined ? { childPid: ownedChild.pid } : {}),
      stopOwned(): Promise<void> {
        if (ownership !== "spawned" || !ownedChild) return Promise.resolve(); // never kill adopted
        stopping ??= stopChild(ownedChild, probe.info.nativePid, probe.client);
        return stopping;
      },
    };
    if (ownedChild !== null) {
      const invalidate = (code: number | null, signal: NodeJS.Signals | null): void => {
        // A reconnecting client does not prove that its server process still
        // exists. Positive child exit retires this exact handle so the next
        // ensure() may probe/spawn a fresh boot instead of returning it forever.
        probe.client.close();
        if (stopping === null && !disposed) {
          lifecycle("fieldd.supervisor.owned_child_exited", "Owned fieldd exited after readiness", {
            ...(ownedChild.pid !== undefined ? { pid: ownedChild.pid } : {}),
            code,
            signal,
          });
        }
      };
      if (ownedChild.exitCode !== null || ownedChild.signalCode !== null) {
        invalidate(ownedChild.exitCode, ownedChild.signalCode);
      } else {
        ownedChild.once("exit", invalidate);
      }
    }
    return result;
  }

  async function stopChild(
    proc: ChildProcess,
    nativePid: number | null,
    client?: FielddClient,
  ): Promise<void> {
    // stop-owned is FULL dev/smoke teardown: the spawned fieldd and the
    // field-native it recorded. (In production nothing calls this — the
    // two-plane law keeps daemons alive past the shell.)
    lifecycle("fieldd.supervisor.stop_requested", "Requested fieldd shutdown", {
      ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      nativePid,
    });
    // WIN-D5 — ask before signalling: the stop REQUEST rides the authenticated
    // channel (system.shutdown), because a signal is not a request — on win32
    // SIGTERM is a hard TerminateProcess and fieldd's graceful path (child
    // sweep, run-file cleanup, audit close) never ran. Refusal, timeout, or a
    // dead socket all fall through to the ladder below, which is unchanged.
    if (client && proc.exitCode === null) {
      const asked = await Promise.race([
        client.request("system.shutdown", {}).then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SHUTDOWN_RPC_WAIT_MS)),
      ]);
      if (asked) {
        lifecycle("fieldd.supervisor.shutdown_requested_rpc", "fieldd accepted system.shutdown", {
          ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
        });
      }
    }
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve();
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        lifecycle("fieldd.supervisor.force_killed", "fieldd exceeded its shutdown deadline", {
          ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
        });
        resolve();
      }, opts.stopDeadlineMs ?? STOP_TERM_WAIT_MS);
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
    lifecycle("fieldd.supervisor.stopped", "Owned fieldd shutdown completed", {
      ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
    });
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    internal.abort();
    // an in-flight attempt runs its own terminal cleanup on abort (stops the
    // child it spawned, bounded); wait for it so handle/child are settled here
    if (inflight) {
      await inflight.then(
        () => undefined,
        () => undefined,
      );
    }
    const h = handle;
    handle = null;
    if (h) {
      // stop BEFORE closing the client: the WIN-D5 stop verb rides that
      // connection. Close afterwards is idempotent on a dead socket.
      if (opts.shutdownPolicy === "stop-owned") await h.stopOwned();
      h.client.close();
    } else if (opts.shutdownPolicy === "stop-owned" && child && child.exitCode === null) {
      // ensure() never resolved but we DID spawn — don't leak the child
      // (slice-0 finding 3: failure paths must not orphan daemons)
      await stopChild(child, null);
    }
    child = null;
    lifecycle("fieldd.supervisor.disposed", "fieldd supervisor disposed");
  }

  return { ensure, dispose };
}

function parseReadySignal(line: string): FielddReadySignal | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (
      value["ready"] !== true ||
      !Number.isInteger(value["port"]) ||
      (value["port"] as number) <= 0 ||
      (value["port"] as number) > 65_535 ||
      typeof value["bootId"] !== "string" ||
      value["bootId"].length === 0 ||
      value["bootId"].length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(value["bootId"])
    ) {
      return null;
    }
    return { ready: true, port: value["port"] as number, bootId: value["bootId"] };
  } catch {
    return null;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new SupervisorError("aborted", "supervisor operation aborted");
}
