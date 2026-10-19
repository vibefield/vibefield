import { EventEmitter } from "node:events";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
  NATIVE_SUPERVISION,
  type NativeLinkState,
  type NativePrepareRestartParams,
  NativePrepareRestartResult,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { NativeDeadlineMiss, NativeLateReply, NativeLink } from "./native-link";
import { RpcCallError } from "./native-link";

// NativeSupervisor (terminal-custody spec TC-D1/TC-D2, slice TC-S1): fieldd
// owns floor respawn, and wedge is a first-class failure mode distinct from
// crash. Before this module, bin.ts spawned field-native ONCE and NativeLink
// only redialed — design-00 §4.2's "fieldd restarts it" was claimed, never
// built.
//
// Two failure classes, two detectors, one ladder:
// - CRASH: the kernel says so (socket close) → NativeLink redials; after
//   RESPAWN_AFTER_REDIALS failed attempts AND a fresh endpoint probe confirming
//   no listener (the double-spawn guard), respawn.
// - WEDGE: the process is alive and the socket is open but the control path
//   does not answer. The heartbeat (native.lifecycle.ping riding the full
//   mgmt path) detects it: miss → immediate stage-2 probe → miss again ⇒
//   state "unresponsive" (detection-to-STATE ≤ ~250ms at the default
//   timings). The DESTRUCTIVE step waits out WEDGE_CONFIRM_MS of continued
//   silence: a loaded-host scheduling stall (measured: vault-free round trips
//   p99 24–37ms at load ~40, max 69ms) must never kill a healthy floor.
//   State is reversible; SIGKILL is not.
//   Phase 0 correction (2026-09-25): native dispatch queues external mesh work
//   separately from the shared reader/writer. A pending TLS listener must not
//   starve this probe and be mistaken for a floor wedge (§2.7 of design-02).
//
// Bounded intensity (RESPAWN_MAX per RESPAWN_WINDOW_MS), then the permanent
// honest degraded state "gone" with a user-visible restart affordance
// (requestRestart) — never a spin. Sessions do not survive a floor death at
// TC-S1 and the respawn log says so plainly (the TC-S1 honesty string).
//
// Wedge EPISODES (WG-D0) are observability only: they move no state, timing or
// kill. An episode runs from entering "unresponsive" until something ends it —
// back to "up" (recovered), a kill (restarted), the link dropping or redialing
// (link-closed), or stop() (stopped) — and closes with ONE line,
// `fieldd.native_supervisor.wedge_episode`: the misses, the requests that timed
// out and how late fieldd's own deadline timers fired, the late replies with
// the floor's last `ts`, and fieldd's event-loop lag over the window. That line
// is what tells a floor's stall from fieldd's own (draft/thinking-floor-wedge.md
// §4, WG-E1/WG-E2). The miss streak that opened the episode is counted in it.

export interface NativeSupervisorOptions {
  link: NativeLink;
  /** Re-runs the SAME spawn bin.ts used (identical env composition). Returns
   * the child pid, or undefined when the spawn itself failed. Absent = this
   * fieldd adopted an externally-run floor and has no respawn authority. */
  spawnNative?: (() => number | undefined) | undefined;
  /** Fresh endpoint probe — the double-spawn guard. Never spawn over a
   * listener that answers. */
  probeAlive: () => Promise<boolean>;
  /** Signal delivery; false = the process was already gone. */
  killNative?: ((pid: number, signal: NodeJS.Signals) => boolean) | undefined;
  /** pid of the floor WE spawned this boot; adopted floors have none, so a
   * confirmed wedge on one surfaces honestly instead of killing blind. */
  nativePid?: number | undefined;
  /** Test seam; production uses NATIVE_SUPERVISION. */
  timings?: NativeSupervisionTimings;
  /** Test seam; production samples fieldd's own event loop with perf_hooks'
   * `monitorEventLoopDelay`, enabled only while a wedge episode is open. */
  loopDelay?: LoopDelayMonitor;
  logger?: Logger;
}

/** The contract constant's shape with the literal values widened — a test
 * injects faster numbers without fighting `as const`. */
export type NativeSupervisionTimings = { [K in keyof typeof NATIVE_SUPERVISION]: number };

/** WG-D0 — the slice of perf_hooks' `IntervalHistogram` a wedge episode reads.
 * Its values are nanoseconds. */
export interface LoopDelayMonitor {
  enable(): void;
  disable(): void;
  reset(): void;
  percentile(percentile: number): number;
  readonly count: number;
  readonly max: number;
}

/** perf_hooks' own default sampling interval. A stall that fails a 100 ms
 * heartbeat spans many samples at this rate. */
const LOOP_DELAY_RESOLUTION_MS = 10;

/** WG-D0 — what a wedge episode saw. Outside an episode it holds the current
 * miss streak and is reset at every pong, so the episode a streak opens keeps
 * its own detection: the misses that opened it, and how late fieldd's timers
 * fired for them, are the first evidence of whose stall it was. */
interface WedgeEvidence {
  /** heartbeat misses, beat and stage-2 probe alike */
  misses: number;
  /** every request that settled TIMEOUT ("deadline-miss"), pings included */
  requestsTimedOut: number;
  lateReplies: number;
  maxLateMs: number;
  /** the floor's `ts` from the last late pong */
  lastFloorTs: number | undefined;
  /** the latest any deadline timer fired past its deadline — fieldd's own loop */
  timerLateMaxMs: number;
}

type WedgeEpisodeOutcome = "recovered" | "restarted" | "link-closed" | "stopped";

/** How leaving "unresponsive" for each state ends the episode. `gone` is
 * reached from it only when the restart affordance finds no listener and
 * cannot respawn one. */
const EPISODE_END: Record<Exclude<NativeLinkState, "unresponsive">, WedgeEpisodeOutcome> = {
  up: "recovered",
  respawning: "restarted",
  connecting: "link-closed",
  gone: "link-closed",
};

function freshEvidence(): WedgeEvidence {
  return {
    misses: 0,
    requestsTimedOut: 0,
    lateReplies: 0,
    maxLateMs: 0,
    lastFloorTs: undefined,
    timerLateMaxMs: 0,
  };
}

/** Milliseconds to one decimal place: the episode line's precision. */
function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** Emits `"transition"` `(state: NativeLinkState, detail: string)` on every
 * state change — the daemon's health stream listens (it is constructed after
 * this supervisor must already be watching the link). */
export class NativeSupervisor extends EventEmitter {
  state: NativeLinkState = "connecting";
  stateDetail = "boot";

  private pid: number | undefined;
  private readonly t: NativeSupervisionTimings;
  private readonly logger: Logger;

  private hbTimer: NodeJS.Timeout | null = null;
  private ladderTimer: NodeJS.Timeout | null = null;
  private pingInFlight = false;
  private misses = 0;
  private cleanPongs = 0;
  private wedgeSince: number | undefined;
  private killing = false;

  private redials = 0;
  private respawnInFlight = false;
  private respawnStamps: number[] = [];
  private stopped = false;

  // ---- wedge episodes (WG-D0): observability only ----
  private evidence: WedgeEvidence = freshEvidence();
  /** `performance.now()` when the open episode began; undefined between episodes */
  private episodeSince: number | undefined;
  /** created at the first episode, enabled only while one is open */
  private loopDelay: LoopDelayMonitor | undefined;

  constructor(private readonly opts: NativeSupervisorOptions) {
    super();
    this.t = opts.timings ?? NATIVE_SUPERVISION;
    this.logger = opts.logger ?? createNoopLogger();
    this.pid = opts.nativePid;
    opts.link.on("connected", this.onConnected);
    opts.link.on("reconnecting", this.onReconnecting);
    opts.link.on("superseded", this.onSuperseded);
    opts.link.on("closed", this.onLinkClosed);
    opts.link.on("deadline-miss", this.onDeadlineMiss);
    opts.link.on("late-reply", this.onLateReply);
  }

  /** The floor pid this supervisor can vouch for (the one it spawned or was
   * handed at boot); undefined for adopted floors. Health reads it — the
   * product.json record from boot goes stale after the first respawn, and
   * this is the live answer. */
  get currentPid(): number | undefined {
    return this.pid;
  }

  /** TC-D1's escalation affordance: a human said "try again". Resets the
   * intensity window (that is the point — the machine stopped on purpose and
   * the human overrode it) and runs one respawn cycle now. */
  async requestRestart(): Promise<void> {
    if (this.stopped) return;
    this.respawnStamps = [];
    this.redials = 0;
    if (this.state === "gone") this.setState("respawning", "manual restart requested");
    // Kill only what is ALIVE: after an intensity trip the held pid is a
    // corpse, and a ladder aimed at it would wait forever for a socket close
    // that already happened. The endpoint probe is the discriminator.
    if (this.pid !== undefined && this.opts.killNative && (await this.opts.probeAlive())) {
      this.killLadder("manual restart requested");
      return; // the socket close → redial → respawn path takes it from here
    }
    await this.considerRespawn("manual restart requested");
  }

  /** WP12 L2b (`build-wp12-updater.md` §9 R2; the PM's ruling 2026-10-15 12:20Z) — stop the floor for an update, in
   * ONE place and in this order:
   *   1. suppress respawn (and the heartbeat: misses during the drain would read as a wedge);
   *   2. `native.lifecycle.prepareRestart` — the intent the next boot reports as `lastExit`;
   *   3. `native.lifecycle.shutdown` — the floor runs its own SIGTERM drain;
   *   4. a bounded wait for the management socket to close — the witness;
   *   5. the kill ladder ONLY if this fieldd holds a pid (a floor it spawned) and the wait passed.
   * An ADOPTED floor — the update path's case by construction — has no pid: the socket closing is the whole witness,
   * and one that does not close inside the bound is reported `lingering`, never signalled. The caller
   * (`system.shutdown` in daemon.ts) has already matched the person's consent against the live set. */
  async stopForUpdate(
    intent: NativePrepareRestartParams,
    bounds: { closeWaitMs?: number; rungMs?: number } = {},
  ): Promise<"closed" | "forced" | "lingering"> {
    const closeWaitMs = bounds.closeWaitMs ?? 5_000;
    const rungMs = bounds.rungMs ?? 2_000;
    const link = this.opts.link;
    this.stop(); // 1
    const fields = { reason: intent.reason, pid: this.pid ?? null };
    try {
      const answer = NativePrepareRestartResult.safeParse(
        await link.request("native.lifecycle.prepareRestart", intent, { deadlineMs: rungMs }),
      );
      this.logger.info(
        "fieldd.native_supervisor.restart_prepared",
        "The floor recorded its restart intent",
        {
          ...fields,
          recorded: answer.success ? answer.data.recorded : null,
        },
      );
    } catch (error) {
      // the stop goes on: a floor that could not record reads `unplanned` at its next boot — honest, not blocking
      this.logger.warn(
        "fieldd.native_supervisor.restart_intent_failed",
        "The floor did not record its restart intent; its next boot will read unplanned",
        { ...fields, error: error instanceof Error ? error.message : String(error) },
      );
    }
    try {
      await link.request(
        "native.lifecycle.shutdown",
        { reason: intent.reason },
        { deadlineMs: rungMs },
      );
    } catch {
      // a floor already draining may close before its reply lands; the socket closing is the witness either way
    }
    if (await this.closedWithin(closeWaitMs)) return this.stoppedForUpdate("closed", fields);
    if (this.pid === undefined || !this.opts.killNative) {
      this.logger.warn(
        "fieldd.native_supervisor.stop_lingering",
        "The floor did not close inside the bound, and this fieldd holds no pid for it (adopted): reported, never signalled",
        { ...fields, closeWaitMs },
      );
      return "lingering";
    }
    const pid = this.pid;
    this.logger.warn(
      "fieldd.native_supervisor.stop_forced",
      "The floor this fieldd spawned did not close inside the bound; the kill ladder is the backstop",
      { ...fields, closeWaitMs },
    );
    this.opts.killNative(pid, "SIGTERM");
    if (!(await this.closedWithin(rungMs))) {
      this.opts.killNative(pid, "SIGKILL");
      await this.closedWithin(rungMs);
    }
    return this.stoppedForUpdate("forced", fields);
  }

  /** Resolves true the moment the management link reports its socket closed, false when `ms` passes first. */
  private closedWithin(ms: number): Promise<boolean> {
    const link = this.opts.link;
    if (!link.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (closed: boolean): void => {
        clearTimeout(timer);
        link.off("reconnecting", onClose);
        link.off("closed", onClose);
        resolve(closed);
      };
      const onClose = (): void => done(true);
      const timer = setTimeout(() => done(!link.connected), ms);
      link.on("reconnecting", onClose);
      link.on("closed", onClose);
    });
  }

  private stoppedForUpdate(
    how: "closed" | "forced",
    fields: Record<string, unknown>,
  ): "closed" | "forced" {
    this.setState("gone", "stopped for an app update; the next shell starts a fresh floor");
    this.logger.info(
      "fieldd.native_supervisor.stopped_for_update",
      "The floor stopped for an update",
      {
        ...fields,
        how,
      },
    );
    return how;
  }

  stop(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.ladderTimer) {
      clearTimeout(this.ladderTimer);
      this.ladderTimer = null;
    }
    this.opts.link.off("connected", this.onConnected);
    this.opts.link.off("reconnecting", this.onReconnecting);
    this.opts.link.off("superseded", this.onSuperseded);
    this.opts.link.off("closed", this.onLinkClosed);
    this.opts.link.off("deadline-miss", this.onDeadlineMiss);
    this.opts.link.off("late-reply", this.onLateReply);
    this.endEpisode("stopped");
  }

  private readonly onConnected = (): void => {
    // A fresh connection is a fresh witness: whatever was counted belonged to
    // the connection that went.
    this.endEpisode("link-closed");
    this.evidence = freshEvidence();
    this.redials = 0;
    this.misses = 0;
    this.cleanPongs = 0;
    this.wedgeSince = undefined;
    this.killing = false;
    this.setState("up", "mgmt link connected");
    this.startHeartbeat();
  };

  private readonly onReconnecting = (): void => {
    this.stopHeartbeat();
    if (this.stopped || this.state === "gone") return;
    if (this.state !== "respawning") this.setState("connecting", "mgmt link down; redialing");
    this.redials += 1;
    if (this.redials >= this.t.RESPAWN_AFTER_REDIALS) {
      void this.considerRespawn(`link down after ${this.redials} redials`);
    }
  };

  private readonly onSuperseded = (): void => {
    // Another fieldd owns the native plane now; supervising it would be a
    // fight, not a recovery. The daemon's SUPERSEDED path shuts us down.
    this.stop();
  };

  /** The link will not redial (closed, superseded, or reconnect off): an open
   * episode ends with it. */
  private readonly onLinkClosed = (): void => {
    this.endEpisode("link-closed");
  };

  // ---- wedge evidence (WG-D0) ----

  private readonly onDeadlineMiss = (miss: NativeDeadlineMiss): void => {
    this.evidence.requestsTimedOut += 1;
    this.evidence.timerLateMaxMs = Math.max(this.evidence.timerLateMaxMs, miss.firedLateMs);
  };

  private readonly onLateReply = (late: NativeLateReply): void => {
    this.evidence.lateReplies += 1;
    this.evidence.maxLateMs = Math.max(this.evidence.maxLateMs, late.lateByMs);
    // only a pong carries the floor's clock
    if (late.floorTs !== undefined) this.evidence.lastFloorTs = late.floorTs;
  };

  private beginEpisode(): void {
    if (this.episodeSince !== undefined || this.stopped) return;
    this.episodeSince = performance.now();
    if (this.loopDelay === undefined) {
      this.loopDelay =
        this.opts.loopDelay ?? monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS });
    }
    this.loopDelay.enable();
  }

  /** Close the open episode, if any, with its one line; the evidence starts
   * over. Info when the floor recovered, warn for every other ending. */
  private endEpisode(outcome: WedgeEpisodeOutcome): void {
    const since = this.episodeSince;
    if (since === undefined) return;
    this.episodeSince = undefined;
    let loopLagP99Ms: number | null = null;
    let loopLagMaxMs: number | null = null;
    const loop = this.loopDelay;
    if (loop !== undefined) {
      // an episode shorter than one sample has no reading, which is not 0 ms
      if (loop.count > 0) {
        loopLagP99Ms = roundMs(loop.percentile(99) / 1e6);
        loopLagMaxMs = roundMs(loop.max / 1e6);
      }
      loop.disable();
      loop.reset();
    }
    const e = this.evidence;
    this.evidence = freshEvidence();
    const attrs = {
      outcome,
      ms: Math.round(performance.now() - since),
      misses: e.misses,
      requestsTimedOut: e.requestsTimedOut,
      lateReplies: e.lateReplies,
      maxLateMs: roundMs(e.maxLateMs),
      lastFloorTs: e.lastFloorTs ?? null,
      timerLateMaxMs: roundMs(e.timerLateMaxMs),
      loopLagP99Ms,
      loopLagMaxMs,
      pid: this.pid ?? null,
    };
    const event = "fieldd.native_supervisor.wedge_episode";
    if (outcome === "recovered") {
      this.logger.info(event, "The floor answered again; its unresponsive episode closed", attrs);
    } else {
      this.logger.warn(event, "The floor's unresponsive episode closed without recovering", attrs);
    }
  }

  // ---- crash path (TC-D1) ----

  private async considerRespawn(reason: string): Promise<void> {
    if (this.stopped || this.state === "gone" || this.respawnInFlight) return;
    this.respawnInFlight = true;
    try {
      // The double-spawn guard: a listener that answers is a floor that exists
      // — the link's own redial will reach it; spawning would fork the plane.
      if (await this.opts.probeAlive()) {
        this.redials = 0;
        return;
      }
      // `state` mutates across the await above (TS's narrowing notwithstanding)
      if (this.stopped || (this.state as NativeLinkState) === "gone") return;
      if (!this.opts.spawnNative) {
        this.setState(
          "gone",
          "the floor is down and this fieldd has no spawn authority (adopted floor) — restart it externally",
        );
        return;
      }
      const now = Date.now();
      this.respawnStamps = this.respawnStamps.filter((s) => now - s < this.t.RESPAWN_WINDOW_MS);
      if (this.respawnStamps.length >= this.t.RESPAWN_MAX) {
        this.setState(
          "gone",
          `respawn intensity exceeded (${this.t.RESPAWN_MAX} in ${this.t.RESPAWN_WINDOW_MS}ms) — something is wrong with the floor itself; use the restart affordance to try again`,
        );
        return;
      }
      this.respawnStamps.push(now);
      this.setState("respawning", reason);
      // The honest loss report (the TC-S1 string): daemon-lifetime is the
      // ceiling, and the previous boot's sessions died with it.
      this.logger.warn(
        "fieldd.native_supervisor.respawn",
        "Respawning field-native; terminal sessions from the previous native boot are lost",
        { reason, attempt: this.respawnStamps.length, previousPid: this.pid ?? null },
      );
      this.pid = this.opts.spawnNative();
      // don't serve the fresh floor the backoff its predecessor's corpse earned
      this.opts.link.dialNow();
      if (this.pid === undefined) {
        // Spawn itself failed. The link keeps redialing, which routes back
        // here — bounded by the same intensity window, never a spin.
        this.logger.error(
          "fieldd.native_supervisor.spawn_failed",
          "The field-native respawn did not produce a process",
          { reason },
        );
      }
      this.redials = 0;
    } finally {
      this.respawnInFlight = false;
    }
  }

  // ---- wedge path (TC-D2) ----

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => void this.beat(), this.t.HEARTBEAT_INTERVAL_MS);
    this.hbTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
    this.pingInFlight = false;
  }

  private async beat(): Promise<void> {
    if (this.stopped || this.pingInFlight || !this.opts.link.connected) return;
    this.pingInFlight = true;
    try {
      await this.opts.link.ping(this.t.HEARTBEAT_DEADLINE_MS);
      this.onPong();
    } catch (e) {
      if (this.isMiss(e)) await this.onMiss();
      // non-deadline failures (link dropped mid-ping) are the crash path's
      // business — the reconnecting event is already driving it
    } finally {
      this.pingInFlight = false;
    }
  }

  private onPong(): void {
    this.misses = 0;
    this.cleanPongs += 1;
    // WG-D0 — outside an episode the evidence is the current miss streak, and
    // a pong ends the streak. Inside one, a lone pong ends nothing.
    if (this.episodeSince === undefined) this.evidence = freshEvidence();
    // Hysteresis: one lucky pong through a struggling path is not recovery.
    if (this.state === "unresponsive" && this.cleanPongs >= 2) {
      this.wedgeSince = undefined;
      this.setState("up", "control path answering again");
    }
  }

  private async onMiss(): Promise<void> {
    this.cleanPongs = 0;
    this.misses += 1;
    this.evidence.misses += 1;
    if (this.misses === 1) {
      // Stage 2: one immediate short-deadline probe, so a single scheduling
      // hiccup never reaches the threshold on its own.
      try {
        await this.opts.link.ping(this.t.HEARTBEAT_PROBE_DEADLINE_MS);
        this.onPong();
        return;
      } catch (e) {
        if (!this.isMiss(e)) return;
        this.misses += 1;
        this.evidence.misses += 1;
      }
    }
    if (this.misses < this.t.HEARTBEAT_MISS_THRESHOLD) return;
    if (this.state === "up") {
      this.wedgeSince = Date.now();
      // Detection-to-STATE: doors answer UNAVAILABLE {state:"unresponsive"}
      // from here — reversible, honest, and distinct from "crashed".
      this.setState("unresponsive", "the control path stopped answering (process alive)");
      return;
    }
    if (
      this.state === "unresponsive" &&
      this.wedgeSince !== undefined &&
      Date.now() - this.wedgeSince >= this.t.WEDGE_CONFIRM_MS &&
      !this.killing
    ) {
      if (this.pid === undefined || !this.opts.killNative) {
        // Adopted floor: no kill authority. Unresponsive is then a state we
        // report, not one we can fix — say so once.
        if (this.stateDetail.includes("no kill authority")) return;
        this.setState(
          "unresponsive",
          "wedge confirmed, but this fieldd has no kill authority over the floor (adopted) — restart it externally",
        );
        return;
      }
      this.setState("respawning", "wedge confirmed; restarting the floor");
      this.logger.warn(
        "fieldd.native_supervisor.wedge_restart",
        "The floor wedged past the confirmation window; killing and respawning it — its sessions are lost",
        { pid: this.pid, wedgeMs: Date.now() - this.wedgeSince },
      );
      this.killLadder("wedge confirmed");
    }
  }

  private killLadder(reason: string): void {
    if (this.pid === undefined || !this.opts.killNative || this.killing) return;
    this.killing = true;
    const pid = this.pid;
    // WG-D0 — a kill ends an open episode as a restart, whoever asked for it.
    // The wedge path has already closed it on entering "respawning"; the
    // restart affordance kills from "unresponsive" itself.
    this.endEpisode("restarted");
    this.opts.killNative(pid, "SIGTERM");
    this.ladderTimer = setTimeout(() => {
      this.ladderTimer = null;
      // Still holding the pid we signalled ⇒ TERM did not take. A wedged
      // process rarely honors TERM — KILL is the ladder's honest last rung.
      if (!this.stopped && this.killing && this.pid === pid) {
        this.opts.killNative?.(pid, "SIGKILL");
      }
    }, 2_000);
    this.ladderTimer.unref?.();
    // The kill lands → socket closes → onReconnecting → considerRespawn.
    void reason;
  }

  private isMiss(e: unknown): boolean {
    return e instanceof RpcCallError && e.kind === "TIMEOUT";
  }

  private setState(state: NativeLinkState, detail: string): void {
    if (this.state === state && this.stateDetail === detail) return;
    this.state = state;
    this.stateDetail = detail;
    this.logger.info("fieldd.native_supervisor.state", "Floor supervision state changed", {
      state,
      detail,
    });
    // WG-D0 — an episode is the time spent "unresponsive": it opens on entry
    // and closes, with its one line, on whatever state ends it.
    if (state === "unresponsive") this.beginEpisode();
    else this.endEpisode(EPISODE_END[state]);
    this.emit("transition", state, detail);
  }
}
