import { EventEmitter } from "node:events";
import { NATIVE_SUPERVISION, type NativeLinkState } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { NativeLink } from "./native-link";
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
//
// Bounded intensity (RESPAWN_MAX per RESPAWN_WINDOW_MS), then the permanent
// honest degraded state "gone" with a user-visible restart affordance
// (requestRestart) — never a spin. Sessions do not survive a floor death at
// TC-S1 and the respawn log says so plainly (the TC-S1 honesty string).

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
  logger?: Logger;
}

/** The contract constant's shape with the literal values widened — a test
 * injects faster numbers without fighting `as const`. */
export type NativeSupervisionTimings = { [K in keyof typeof NATIVE_SUPERVISION]: number };

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

  constructor(private readonly opts: NativeSupervisorOptions) {
    super();
    this.t = opts.timings ?? NATIVE_SUPERVISION;
    this.logger = opts.logger ?? createNoopLogger();
    this.pid = opts.nativePid;
    opts.link.on("connected", this.onConnected);
    opts.link.on("reconnecting", this.onReconnecting);
    opts.link.on("superseded", this.onSuperseded);
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
  }

  private readonly onConnected = (): void => {
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
    // Hysteresis: one lucky pong through a struggling path is not recovery.
    if (this.state === "unresponsive" && this.cleanPongs >= 2) {
      this.wedgeSince = undefined;
      this.setState("up", "control path answering again");
    }
  }

  private async onMiss(): Promise<void> {
    this.cleanPongs = 0;
    this.misses += 1;
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
    this.emit("transition", state, detail);
  }
}
