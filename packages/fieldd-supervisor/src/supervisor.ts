import { type ChildProcess, spawn } from "node:child_process";
import type { ProductInfo, ShellLeaveReason } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FIELDD_LIVENESS, type LivenessWatch, watchLiveness } from "./liveness";
import { assertDataRootUsable } from "./paths";
import {
  awaitDeparture,
  type ProbeResult,
  readRecordedProduct,
  type StaleDaemon,
  tryAdopt,
} from "./probe";
import { createLineBuffer, createLogTail, redactLine } from "./process-log";
import {
  type FielddHandle,
  type FielddLiveness,
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
// and an adopted fieldd is never killed by any path here. A spawned one's stop
// also ends the floor its record names, one that fieldd adopted included.
// Item 212 (RV #30): a probe-timeout is a fieldd BUSY, not gone — it is waited on
// for the spawn's own readiness bound before any takeover — and the record a
// spawn supersedes, answering late, is never read as the race's winner.
// Item 212 (RV #67): every handle's link is watched for the silence of its
// replies (liveness.ts); a SPAWNED fieldd silent past the wedge bound is ended
// alone, by the same child-only ladder a failed start uses, and an adopted one
// is only said.

const READINESS_DEADLINE_MS = 20_000;
const ADOPT_PROBE_MS = 1_500;
const POLL_PROBE_MS = 600;
const POLL_INTERVAL_MS = 200;
const STOP_TERM_WAIT_MS = 2_000;
/** WIN-D5 — how long the stop VERB gets before the signal ladder takes over.
 * Short: the request is one loopback round trip; a daemon that cannot answer
 * it inside this budget is what the ladder exists for. */
const SHUTDOWN_RPC_WAIT_MS = 1_500;
/** WP12 D10 — how long a replaced build's fieldd has to go before this build's is spawned anyway. */
const REPLACE_WAIT_MS = 3_000;
const REPLACE_POLL_MS = 100;
/** WP12 D10 — a live listener we cannot adopt: the new fieldd supersedes it at field-native (one client at a time,
 * `field-native/src/mgmt/mod.rs` single-client rule), so these spawn as NAMED takeovers, never refusals — a refusal
 * would hand any same-uid listener a lever to stop the app's own fieldd (EL7). */
const TAKEOVER_FAILURES: ReadonlySet<ProbeFailure> = new Set([
  "incompatible-contracts",
  "user-mismatch",
  "foreign-listener",
]);

/** Item 212 (RV #30) — what the busy wait hands run()'s one decision. */
interface BusyWait {
  /** the probe the decision dispatches: an answer, another result, or the last probe-timeout */
  readonly probe: ProbeResult;
  readonly waitedMs: number;
  /** the recorded pid no longer exists: the spawn supersedes nothing live, so it is no takeover */
  readonly gone: boolean;
}

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

    const first = await adoptProbe(opts.adoptProbeMs ?? ADOPT_PROBE_MS, signal);
    throwIfAborted(signal);
    // item 212 (RV #30) — a probe-timeout is busy, not gone: the wait's final probe goes to the ONE decision below,
    // exactly as a first probe would
    const waited =
      !first.ok && first.failure === "probe-timeout" && first.recorded !== undefined
        ? await awaitBusyIncumbent(first, first.recorded, signal)
        : null;
    const adopted = waited?.probe ?? first;
    if (adopted.ok) {
      lifecycle("fieldd.supervisor.adopted", "Adopted a running fieldd", {
        port: adopted.info.port,
        pid: adopted.info.pid,
        bootId: adopted.info.bootId,
      });
      if (waited !== null) {
        lifecycle(
          "fieldd.supervisor.adopted_after_wait",
          "The busy fieldd answered inside the patience and was adopted, never superseded",
          { waitedMs: waited.waitedMs },
        );
      }
      return makeHandle("adopted", adopted);
    }
    lifecycle("fieldd.supervisor.spawn_required", "No adoptable fieldd was available", {
      probeFailure: adopted.failure,
    });
    // item 212 — a listener that took the dial and never the hello, past the patience, is a live one superseded
    const takeover =
      TAKEOVER_FAILURES.has(adopted.failure) ||
      (adopted.failure === "probe-timeout" && waited?.gone !== true);
    if (adopted.failure === "incompatible-build") {
      if (opts.buildMismatch !== "replace" || adopted.stale === undefined) {
        adopted.stale?.client.close();
        throw new SupervisorError(
          "incompatible-build",
          "a live fieldd from a different development build already owns this data root",
          adopted.failure,
        );
      }
      await replaceStaleBuild(adopted.stale, signal);
    } else if (takeover) {
      lifecycle(
        "fieldd.supervisor.takeover",
        "A live listener on this root cannot be adopted; the new fieldd supersedes it at field-native",
        {
          probeFailure: adopted.failure,
          ...(waited !== null ? { waitedMs: waited.waitedMs } : {}),
        },
      );
    }
    // item 212 — the record this spawn supersedes, when one was read: its late answer is never the race's winner
    const superseding = adopted.recorded?.bootId;

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
      let answeredLate = false;
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
        if (!probe.ok) {
          lastFailure = probe.failure;
        } else if (probe.info.pid !== spawned.pid && probe.info.bootId === superseding) {
          // item 212 (RV #30) — the incumbent this spawn supersedes, answering late: no race winner, and our child
          // is never stopped for it. Its client is closed (an open probe client reconnects forever); the poll goes
          // on for our child, whose record replaces this one.
          probe.client.close();
          if (!answeredLate) {
            answeredLate = true;
            lifecycle(
              "fieldd.supervisor.incumbent_answered_late",
              "The fieldd this spawn supersedes answered late; the poll waits for ours",
              { pid: probe.info.pid, bootId: probe.info.bootId, spawnedPid: spawned.pid ?? null },
            );
          }
        } else {
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

  /** The adopt phase's probe: this build and this user only, and (`replace`) the other build's client kept open. */
  function adoptProbe(probeMs: number, signal: AbortSignal): Promise<ProbeResult> {
    return tryAdopt(opts.dataRoot, probeMs, signal, opts.expectedBuildId, opts.userId, {
      keepStaleClient: opts.buildMismatch === "replace",
    });
  }

  /** Item 212 (RV #30) — a probe-timeout is a listener that took the dial and not the hello inside the budget: a
   * fieldd busy, not gone. It is waited on as long as a spawn is waited for (the readiness bound; no new constant).
   * Each round first asks whether its recorded pid exists — `process.kill(pid, 0)` checks and delivers NO signal, so
   * WP12 D10's "no signal is ever sent to a pid read from a file" holds — then probes again (re-reading product.json),
   * the budget doubling from the first probe's and clipped to the patience left. It returns:
   * - the first result that is not this boot's probe-timeout (an answer, another boot's record, no run files, a
   *   refusal), for run()'s one decision;
   * - at once, the last probe-timeout with `gone`, when the pid no longer exists;
   * - past the patience, the last probe-timeout, which that decision spawns as a NAMED takeover (EL7, the reasoning
   *   of TAKEOVER_FAILURES: a silent same-uid listener can delay the spawn by the bound, never block it).
   * Abort-aware: dispose ends it. */
  async function awaitBusyIncumbent(
    first: ProbeResult,
    recorded: ProductInfo,
    signal: AbortSignal,
  ): Promise<BusyWait> {
    const started = Date.now();
    const deadline = started + (opts.readinessDeadlineMs ?? READINESS_DEADLINE_MS);
    lifecycle(
      "fieldd.supervisor.adopt_waiting",
      "A live fieldd took the dial but not the hello; waiting for it within the readiness bound",
      { pid: recorded.pid, bootId: recorded.bootId },
    );
    let last = first;
    let budgetMs = opts.adoptProbeMs ?? ADOPT_PROBE_MS;
    for (;;) {
      throwIfAborted(signal);
      if (!pidExists(recorded.pid)) {
        const waitedMs = Date.now() - started;
        lifecycle(
          "fieldd.supervisor.incumbent_gone",
          "The busy fieldd's recorded pid is gone; the wait ends and the spawn goes ahead",
          { pid: recorded.pid, bootId: recorded.bootId, waitedMs },
        );
        return { probe: last, waitedMs, gone: true };
      }
      const leftMs = deadline - Date.now();
      if (leftMs <= 0) return { probe: last, waitedMs: Date.now() - started, gone: false };
      budgetMs = Math.min(budgetMs * 2, leftMs);
      const probe = await adoptProbe(budgetMs, signal);
      if (signal.aborted) {
        // an answer that lands with the abort is closed here: an open probe client reconnects forever
        if (probe.ok) probe.client.close();
        else probe.stale?.client.close();
      }
      throwIfAborted(signal);
      if (
        probe.ok ||
        probe.failure !== "probe-timeout" ||
        probe.recorded?.bootId !== recorded.bootId
      ) {
        return { probe, waitedMs: Date.now() - started, gone: false };
      }
      last = probe;
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
    /** item 212 (RV #67) — the child-only ladder a wedge started. It ends no floor, so it is never the handle's stop:
     * a stop-owned stop after it still ends the floor the record names. */
    let wedgeStop: Promise<void> | null = null;
    // item 212 (RV #67) — the link's liveness, by the silence of its replies (liveness.ts), on every handle
    let liveness: FielddLiveness = { kind: "responsive" };
    const livenessListeners = new Set<(liveness: FielddLiveness) => void>();
    let watch: LivenessWatch | null = null;
    /** At the wedge bound, an OWNED fieldd is ended alone by the child-only ladder: `stopChild` with no record has no
     * floor pid to signal and, with no client, asks no verb a stalled loop could not answer (as run()'s failure path
     * uses it). Its exit invalidates this handle, and the shell's recovery starts the next. An ADOPTED fieldd is never
     * signalled (ESR §5.3): it stays said, and a relaunch takes it over (RV #30's named takeover). */
    const endWedged = (silentMs: number): void => {
      if (ownedChild === null || stopping !== null || wedgeStop !== null || disposed) return;
      lifecycle(
        "fieldd.supervisor.wedge_killed",
        "The fieldd this shell spawned stopped answering past the wedge bound; it is ended alone",
        { silentMs, ...(ownedChild.pid !== undefined ? { pid: ownedChild.pid } : {}) },
      );
      watch?.stop();
      wedgeStop = stopChild(ownedChild, null);
    };
    const result: FielddHandle = {
      ownership,
      info: probe.info,
      client: probe.client,
      ...(ownedChild?.pid !== undefined ? { childPid: ownedChild.pid } : {}),
      get liveness(): FielddLiveness {
        return liveness;
      },
      onLiveness(listener: (liveness: FielddLiveness) => void): () => void {
        livenessListeners.add(listener);
        return () => {
          livenessListeners.delete(listener);
        };
      },
      stopOwned(): Promise<void> {
        if (ownership !== "spawned" || !ownedChild) return Promise.resolve(); // never kill adopted
        // item 212 (RV #67): the stop begins, and a stopping fieldd's silence is no wedge
        watch?.stop();
        // after a wedge kill the stop is still stop-owned's whole teardown: the child-only ladder first, then the
        // floor the record names, with no verb (the child, and with it the link, went with that ladder)
        stopping ??=
          wedgeStop === null
            ? stopChild(ownedChild, probe.info, probe.client)
            : wedgeStop.then(() => stopChild(ownedChild, probe.info));
        return stopping;
      },
    };
    const livenessOptions = opts.liveness ?? FIELDD_LIVENESS;
    if (livenessOptions !== false) {
      watch = watchLiveness(probe.client, {
        ...livenessOptions,
        onChange: (next) => {
          liveness = next;
          for (const listener of [...livenessListeners]) {
            try {
              listener(next);
            } catch {
              // Observation must never control daemon ownership or lifecycle.
            }
          }
          if (next.kind === "wedged") endWedged(next.silentMs);
        },
      });
    }
    if (ownedChild !== null) {
      const invalidate = (code: number | null, signal: NodeJS.Signals | null): void => {
        // A reconnecting client does not prove that its server process still
        // exists. Positive child exit retires this exact handle so the next
        // ensure() may probe/spawn a fresh boot instead of returning it forever.
        probe.client.close();
        if (stopping === null && wedgeStop === null && !disposed) {
          lifecycle("fieldd.supervisor.owned_child_exited", "Owned fieldd exited after readiness", {
            ...(ownedChild.pid !== undefined ? { pid: ownedChild.pid } : {}),
            code,
            signal,
          });
        }
      };
      if (hasExited(ownedChild)) {
        invalidate(ownedChild.exitCode, ownedChild.signalCode);
      } else {
        ownedChild.once("exit", invalidate);
      }
    }
    return result;
  }

  /** WP12 D10 — the bounded replace path: ask the other build's fieldd to stop over the channel our token already
   * authenticated (`system.shutdown`: it releases its sessions to field-native and removes its run files), wait
   * up to REPLACE_WAIT_MS for its run files to go or change hands, and return — the caller spawns either way. */
  async function replaceStaleBuild(stale: StaleDaemon, signal: AbortSignal): Promise<void> {
    lifecycle(
      "fieldd.supervisor.replacing_build",
      "A fieldd from another build owns this root; asking it to stop before spawning this build's",
      { pid: stale.info.pid, from: stale.info.buildId ?? null, to: opts.expectedBuildId ?? null },
    );
    const asked = await Promise.race([
      stale.client.request("system.shutdown", {}).then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SHUTDOWN_RPC_WAIT_MS)),
    ]);
    stale.client.close();
    const gone = await awaitDeparture(opts.dataRoot, stale.info.bootId, REPLACE_WAIT_MS, {
      pollMs: REPLACE_POLL_MS,
      signal,
    });
    throwIfAborted(signal);
    if (gone) {
      lifecycle("fieldd.supervisor.replaced_build", "The other build's fieldd stopped", {
        pid: stale.info.pid,
        asked,
      });
    } else {
      lifecycle(
        "fieldd.supervisor.replace_wait_expired",
        "The other build's fieldd did not stop in time; the new fieldd supersedes it at field-native",
        { pid: stale.info.pid, asked },
      );
    }
  }

  /** The floor a stop ends beside its fieldd: product.json's `nativePid` read
   * NOW, before the stop verb (fieldd's stop removes the file). fieldd
   * rewrites it whenever its floor changes — a respawn, a hello stating
   * another pid — so the probe's copy can name a floor that has gone. The
   * record is believed only while it is still this fieldd's (its pid is the
   * child's, its bootId the probe's); otherwise the probe's value stands. */
  async function nativePidAtStop(proc: ChildProcess, probed: ProductInfo): Promise<number | null> {
    const current = await readRecordedProduct(opts.dataRoot);
    if (current !== null && current.pid === proc.pid && current.bootId === probed.bootId) {
      return current.nativePid;
    }
    return probed.nativePid;
  }

  async function stopChild(
    proc: ChildProcess,
    probed: ProductInfo | null,
    client?: FielddClient,
  ): Promise<void> {
    // stop-owned is FULL dev/smoke teardown: the spawned fieldd and the
    // field-native its record names. (In production nothing calls this — the
    // two-plane law keeps daemons alive past the shell.)
    const nativePid = probed === null ? null : await nativePidAtStop(proc, probed);
    lifecycle("fieldd.supervisor.stop_requested", "Requested fieldd shutdown", {
      ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      nativePid,
    });
    // WIN-D5 — ask before signalling: the stop REQUEST rides the authenticated
    // channel (system.shutdown), because a signal is not a request — on win32
    // SIGTERM is a hard TerminateProcess and fieldd's graceful path (child
    // sweep, run-file cleanup, audit close) never ran. Refusal, timeout, or a
    // dead socket all fall through to the ladder below, which is unchanged.
    if (client && !hasExited(proc)) {
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
    if (!hasExited(proc) && !proc.killed) proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      // a child a signal ended keeps a null exitCode: read as live, its stop would wait out the deadline for an exit
      // that already came and force-kill a corpse (item 212, RV #67: the stop after a wedge kill)
      if (hasExited(proc)) return resolve();
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

  /** AL-7 — the leave verb rides the client this supervisor holds, bounded like the stop verb: a pair that cannot
   * answer it inside the budget records the exit unplanned, which is the honest reading. Said on a LIVE connection
   * only: the lease reads that connection's close, and a pair already gone (a quit's consented stop) has none to read,
   * so the dispose never waits out a reconnect for it. */
  async function sayLeave(client: FielddClient, why: ShellLeaveReason): Promise<void> {
    if (client.status !== "ready") return;
    await Promise.race([
      client.request("system.shell.leave", { why }).then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_RPC_WAIT_MS)),
    ]);
  }

  async function dispose(options?: { readonly leave?: ShellLeaveReason }): Promise<void> {
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
      else if (options?.leave !== undefined) await sayLeave(h.client, options.leave);
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

/** A child that has exited, by its own code or by a signal (its `exitCode` stays null then). */
function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
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

/** Item 212 (RV #30) — does `pid` name a process? `process.kill(pid, 0)` is the existence check and delivers no
 * signal. ESRCH is gone; EPERM is a process we may not signal, so it lives (and so does anything else the check
 * cannot read). On win32 the check is an OpenProcess. A reused pid only lengthens a bounded wait. */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
