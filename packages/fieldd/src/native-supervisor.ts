import { EventEmitter } from "node:events";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
  NATIVE_REFUSALS,
  NATIVE_SUPERVISION,
  type NativeLinkHealth,
  type NativeLinkState,
  type NativePrepareRestartParams,
  NativePrepareRestartResult,
  type NativeUnavailableDetails,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { FloorOsWaits } from "./floor-os-waits";
import type { NativeDeadlineMiss, NativeLateReply, NativeLink } from "./native-link";
import { RpcCallError } from "./native-link";

// NativeSupervisor (terminal-custody spec TC-D1/TC-D2, slice TC-S1; the wedge
// ladder WG-D0…WG-D6, `draft/thinking-floor-wedge.md` §4 and §5.3, ruled
// 2026-10-19): fieldd owns the floor's respawn, and a wedge is a failure mode
// of its own, distinct from a crash.
//
// CRASH: the kernel says so (the socket closes) → NativeLink redials; after
// RESPAWN_AFTER_REDIALS failed attempts AND a fresh endpoint probe confirming
// no listener (the double-spawn guard), respawn — at most RESPAWN_MAX per
// RESPAWN_WINDOW_MS, then the honest "gone" with the restart affordance
// (`requestRestart`), never a spin.
//
// WEDGE: the process is alive and the socket open, but the control path does
// not answer.
// - Detection is a state, reversible: the heartbeat (native.lifecycle.ping over
//   the full mgmt path) misses, one stage-2 probe misses ⇒ "unresponsive"
//   (≤ ~250 ms at the default timings). A miss counts only if fieldd's own
//   deadline timer fired on time (WG-E1): one that fired past its whole
//   deadline was fieldd's loop stalling, with the pong perhaps unread in the
//   socket. Two clean pongs in a row return the link to "up". From detection
//   on, the doors that ride the floor's mgmt path answer UNAVAILABLE {service:
//   "native", state: "unresponsive"} at once (`doorRefusal`, WG-D4), until the
//   floor answers again.
// - The kill clock is silence of REPLIES (WG-E2/E3): the time since the link
//   last read a response to anything — a pong or any other answer, a late one
//   included. Any reply restarts it. The floor's tick and its subscription
//   deltas never do: they come from its forwarder tasks, not its reader.
// - WEDGE_REDIAL_MS of silence: once per episode the link is dropped and
//   dialled again (WG-E4). It costs no session, and a fresh hello meets a
//   fresh reader. The clock runs on across it: an unanswered hello is more
//   silence, and the state stays "unresponsive", never "connecting".
// - WEDGE_CONFIRM_MS of silence, the redial tried (it always gets the rest of
//   the bound to answer): the census decides (WG-E6), read from the cells
//   themselves. Empty, every cell answering and no birth in flight ⇒ the
//   automatic restart (unplanned, so never announced). Otherwise the floor is
//   held "unresponsive" with its numbers (`health()`), the census is read
//   again every WEDGE_RECOUNT_MS, and the person's consented restart is offered
//   where this fieldd can act (`requestRestart`, WG-D5). It is taken only for
//   a floor held past the bound (or "gone"), on a census a reading grounds.
// - Headless — no window, so nobody to ask — once replies AND the floor's own
//   tick have both been silent WEDGE_HEADLESS_MS: a floor stalled whole, whose
//   cells stall behind their undrained stderr. The restart proceeds, and its
//   warning names every session it ends. While the tick flows it is a reader
//   or dispatch wedge, the cells run on, and the ladder waits. The decision is
//   read again after the census and the yield, so a tick read meanwhile
//   cancels it; and where the OS says the floor's threads wait on I/O (WG-E5,
//   Linux procfs), the clause holds: that floor is slow, not deadlocked.
// - Before every ladder step, one yield to I/O; a reply read in it cancels the
//   step (WG-E1).
// - Wedge restarts have their own intensity bound, WEDGE_RESTART_MAX per
//   WEDGE_RESTART_WINDOW_MS, past which the link is "gone": a floor that wedges
//   on every boot is never restarted once a minute forever.
//
// AUTHORITY over a live floor: a pid to signal — the floor this fieldd spawned,
// or the pid the paired floor stated in its hello ack (WG-D6) — and the spawner
// to start the next. Without both, a held floor says "restart it outside
// VibeField", and no restart is offered.
//
// THE DRAIN LADDER, every deliberate stop's signals: SIGTERM starts the floor's
// own drain; the SIGKILL rung waits out the drain ladder before it fires
// (KILL_DRAIN_WAIT_MS, past every cell's drain budget and grace), and fires
// only if the floor has not exited and no other floor's pid is the target now.
// There is no vault, so a restart ends every session on the floor, and every
// line that logs one says so.
//
// Wedge EPISODES (WG-D0): an episode runs from entering "unresponsive" until
// something ends it — back to "up" (recovered), a restart (restarted), the
// intensity bound or a floor found down with no spawn authority (gone), the
// link closing for good (link-closed), or stop() (stopped) — and closes with
// ONE line, `fieldd.native_supervisor.wedge_episode`: the misses, the requests
// that timed out and how late fieldd's own deadline timers fired, the late
// replies with the floor's last `ts`, and fieldd's event-loop lag over the
// window, and what the OS said the floor waited on (WG-E5, where it says). The
// ladder's steps log as they happen: the redial and every restart at warn.
//
// *Corrected 2026-10-19 (WG-D1):* this header said the destructive step waited
// out WEDGE_CONFIRM_MS of CONTINUED silence, and the detection comment said the
// doors answered UNAVAILABLE {state: "unresponsive"} from there. Neither held:
// the clock cleared only on two clean pongs in a row, so a lone pong left it
// running, and nothing emitted that UNAVAILABLE (`thinking-floor-wedge.md`
// §2.2).

export interface NativeSupervisorOptions {
  link: NativeLink;
  /** Re-runs the SAME spawn bin.ts used (identical env composition). Returns
   * the child pid, or undefined when the spawn itself failed. Absent = this
   * fieldd has no respawn authority (an embedded composition). */
  spawnNative?: (() => number | undefined) | undefined;
  /** Fresh endpoint probe — the double-spawn guard. Never spawn over a
   * listener that answers. */
  probeAlive: () => Promise<boolean>;
  /** Signal delivery; false = the process was already gone. */
  killNative?: ((pid: number, signal: NodeJS.Signals) => boolean) | undefined;
  /** The drain ladder's witness that the floor has exited: is this pid still a
   * process? Absent, the management socket closing is the witness. */
  pidAlive?: ((pid: number) => boolean) | undefined;
  /** pid of the floor WE spawned this boot; an adopted floor has none, and
   * its own pid is the one it states in its hello ack (`NativeLink.floorPid`). */
  nativePid?: number | undefined;
  /** WG-E6 — the floor census, read from the cells (`TerminalService.floorCensus`).
   * Absent, every census is unknown: no automatic restart, and no consented
   * one either. */
  census?: ((forStop: boolean) => Promise<FloorCensus>) | undefined;
  /** WG-E5 — what the OS says the floor's threads wait on, by pid
   * (`floor-os-waits.ts`: Linux procfs, WG-D3). Absent, or undefined for a
   * reading, the platform says nothing, and reply silence and the floor's tick
   * decide alone. */
  osWaits?: ((pid: number) => FloorOsWaits | undefined) | undefined;
  /** WG-D1 — is a person here to ask: a window open on this desktop. The phone
   * alone is not one (it can neither see a held floor nor restart it). Absent,
   * nobody is, and the headless clause applies. */
  personPresent?: (() => boolean) | undefined;
  /** Test seam; production uses NATIVE_SUPERVISION. */
  timings?: NativeSupervisionTimings;
  /** Test seam; production samples fieldd's own event loop with perf_hooks'
   * `monitorEventLoopDelay`, enabled only while a wedge episode is open. */
  loopDelay?: LoopDelayMonitor;
  /** WG-E1 test seam: the one yield before a ladder step. Production yields one
   * `setImmediate`, which runs after the poll phase has read every socket
   * that was ready. */
  yieldToIo?: (() => Promise<void>) | undefined;
  logger?: Logger;
}

/** The contract constant's shape with the literal values widened — a test
 * injects faster numbers without fighting `as const`. */
export type NativeSupervisionTimings = { [K in keyof typeof NATIVE_SUPERVISION]: number };

/** WG-E6 — what a restart of the floor would end, read at decision time with
 * the cells' own answers (`TerminalCensus` in terminal-service.ts is this
 * shape). */
export interface FloorCensus {
  /** the session ids the floor holds, sorted */
  readonly live: readonly string[];
  /** every cell answered; false is "unknown", which counts as holding sessions */
  readonly complete: boolean;
  /** `live` names every session this fieldd knows the floor may hold: every
   * cell answered, or a silent cell's last observed sessions stand in for it.
   * false — a silent cell fieldd never observed, or no census at all — grounds
   * no consent: no list can name what nothing has seen */
  readonly grounded: boolean;
  /** births in flight as it was read: any refuses a stop */
  readonly births: number;
  /** reopens births if the census closed them */
  release(): void;
}

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

/** The drain ladder's last rung: after SIGKILL, how long to watch for the exit
 * before going on to the next floor. */
const KILL_SETTLE_MS = 2_000;

/** How often the drain ladder asks whether the floor's pid is still a process. */
const EXIT_POLL_MS = 100;

/** What a census nothing can take answers: unknown, which counts as holding
 * sessions. */
export const UNKNOWN_FLOOR_CENSUS: FloorCensus = {
  live: [],
  complete: false,
  grounded: false,
  births: 0,
  release: () => undefined,
};

/** WG-E1 — one turn of the event loop's I/O: a setImmediate callback runs after
 * the poll phase has read every socket that was ready, so a reply already
 * waiting is read before the step goes on. */
const yieldToIo = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** WG-D0 — what a wedge episode saw. Outside an episode it holds the current
 * miss streak and is reset at every pong, so the episode a streak opens keeps
 * its own detection: the misses that opened it, and how late fieldd's timers
 * fired for them, are the first evidence of whose stall it was. */
interface WedgeEvidence {
  /** heartbeat misses, beat and stage-2 probe alike, counted on time */
  misses: number;
  /** every request that settled TIMEOUT ("deadline-miss"), pings included */
  requestsTimedOut: number;
  lateReplies: number;
  maxLateMs: number;
  /** the floor's `ts` from the last late pong */
  lastFloorTs: number | undefined;
  /** the latest any deadline timer fired past its deadline — fieldd's own loop */
  timerLateMaxMs: number;
  /** WG-E5 — the episode's first and latest OS readings, and the most threads
   * any reading found in uninterruptible wait; undefined where the platform
   * says nothing */
  osFirst: FloorOsWaits | undefined;
  osLast: FloorOsWaits | undefined;
  osUninterruptibleMax: number;
}

type WedgeEpisodeOutcome = "recovered" | "restarted" | "gone" | "link-closed" | "stopped";

/** How leaving "unresponsive" for each state ends the episode. A link that
 * drops inside an episode keeps the state (the clock runs on across it), so no
 * step of the ladder leads to `connecting`; the row stays because the map
 * covers every state. */
const EPISODE_END: Record<Exclude<NativeLinkState, "unresponsive">, WedgeEpisodeOutcome> = {
  up: "recovered",
  respawning: "restarted",
  connecting: "link-closed",
  gone: "gone",
};

function freshEvidence(): WedgeEvidence {
  return {
    misses: 0,
    requestsTimedOut: 0,
    lateReplies: 0,
    maxLateMs: 0,
    lastFloorTs: undefined,
    timerLateMaxMs: 0,
    osFirst: undefined,
    osLast: undefined,
    osUninterruptibleMax: 0,
  };
}

/** Milliseconds to one decimal place: the episode line's precision. */
function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** A silence in the words a state's detail uses: seconds under two minutes,
 * whole minutes after. */
function spoken(ms: number): string {
  const seconds = Math.round(ms / 1_000);
  return seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** What a held floor's detail says it holds, as last counted. */
function holding(atRisk: number | null, births: number): string {
  if (atRisk === null) {
    return "a terminal cell did not answer the census, so the floor counts as holding sessions";
  }
  if (atRisk === 0) return births > 0 ? "a session is being born on it" : "it holds no session";
  return atRisk === 1 ? "its 1 session still runs" : `its ${atRisk} sessions still run`;
}

/** Emits `"transition"` `(state: NativeLinkState, detail: string)` on every
 * state or detail change — the daemon's health stream listens (it is
 * constructed after this supervisor must already be watching the link). */
export class NativeSupervisor extends EventEmitter {
  state: NativeLinkState = "connecting";
  stateDetail = "boot";
  /** unix ms when `state` last changed */
  private stateSince = Date.now();

  /** the floor this fieldd spawned (or respawned); cleared when the paired
   * floor states another pid in its hello */
  private pid: number | undefined;
  private readonly t: NativeSupervisionTimings;
  private readonly logger: Logger;

  private hbTimer: NodeJS.Timeout | null = null;
  private pingInFlight = false;
  private misses = 0;
  private cleanPongs = 0;

  private redials = 0;
  private respawnInFlight = false;
  private respawnStamps: number[] = [];
  private stopped = false;

  // ---- the wedge ladder (WG-D1) ----
  /** `performance.now()` of the last reply the link read; undefined before the first */
  private lastReplyAt: number | undefined;
  /** `performance.now()` of the last floor tick; undefined before the first */
  private lastTickAt: number | undefined;
  private ladderTimer: NodeJS.Timeout | null = null;
  /** a ladder step is running; its end re-arms the timer */
  private stepping = false;
  /** counts episodes, so a step that awaited something knows whether its own is still open */
  private episodeId = 0;
  /** when this episode's redial ran; undefined until it has */
  private redialedAt: number | undefined;
  /** when the census was last read in this episode */
  private lastCountAt: number | undefined;
  /** the sessions a restart would end, as last counted; null = unknown or not counted */
  private atRisk: number | null = null;
  /** the births in flight at that count */
  private birthsCounted = 0;
  /** unix ms of each wedge restart, inside WEDGE_RESTART_WINDOW_MS */
  private wedgeRestartStamps: number[] = [];
  /** a deliberate restart's drain ladder is running: the crash path does not respawn under it */
  private draining = false;
  /** WG-D4 — the redialled link's hello was answered in this episode and no
   * miss has counted since: the doors pass again while the pongs decide */
  private answeringAgain = false;

  // ---- wedge episodes (WG-D0) ----
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
    opts.link.on("reply", this.onReply);
    opts.link.on("tick", this.onTick);
  }

  /** The floor pid this supervisor spawned and still holds; undefined for a
   * floor it adopted. Health reads it — the product.json record from boot goes
   * stale after the first respawn, and this is the live answer. The pid an
   * adopted floor stated in its hello is `health().pid`. */
  get currentPid(): number | undefined {
    return this.pid;
  }

  /** WG-D1 (`NativeLinkHealth`, contracts mgmt.ts) — the state with its numbers
   * and provenance, for fieldd's health block. */
  health(): NativeLinkHealth {
    const now = performance.now();
    const age = (at: number | undefined): number | null =>
      at === undefined ? null : Math.max(0, Math.round(now - at));
    const present = this.personPresent();
    const canRestart = this.canRestartLive();
    const held = this.heldPastBound(now);
    let loopLagMs: number | null = null;
    const loop = this.loopDelay;
    if (this.episodeSince !== undefined && loop !== undefined && loop.count > 0) {
      loopLagMs = roundMs(loop.percentile(99) / 1e6);
    }
    return {
      state: this.state,
      detail: this.stateDetail,
      pid: this.killTarget() ?? null,
      since: this.stateSince,
      lastReplyAgeMs: age(this.lastReplyAt),
      lastTickAgeMs: age(this.lastTickAt),
      loopLagMs,
      sessionsAtRisk: this.state === "up" || this.state === "connecting" ? null : this.atRisk,
      requestsTimedOut: this.episodeSince === undefined ? 0 : this.evidence.requestsTimedOut,
      restartOffered:
        present &&
        ((held && canRestart) ||
          (this.state === "gone" && this.opts.spawnNative !== undefined && !this.stopped)),
      headlessAt:
        held && canRestart && !present
          ? Math.round(Date.now() - (now - this.wholeSilenceSince()) + this.t.WEDGE_HEADLESS_MS)
          : null,
    };
  }

  /** WG-D4 — what a door that rides the floor's mgmt path answers while the
   * floor is held "unresponsive" (`NativeUnavailableDetails`): at once,
   * retryable, never after the request's own deadline. undefined while the
   * floor is answering — including on a redialled link whose hello was
   * answered, until a miss counts again (WG-E4: a fresh reader works, and the
   * doors' own re-arms on "connected" must not be refused by a stale state).
   * The daemon hands it to the link (`NativeLink.setDoorGate`). */
  doorRefusal(): NativeUnavailableDetails | undefined {
    if (this.state !== "unresponsive" || this.answeringAgain) return undefined;
    return {
      service: NATIVE_REFUSALS.SERVICE,
      state: NATIVE_REFUSALS.STATE_UNRESPONSIVE,
      since: this.stateSince,
      detail: this.stateDetail,
    };
  }

  /** WG-D5 — the person's restart, and TC-D1's escalation affordance.
   *
   * A floor that is down (no listener answers the probe) ends nothing: the
   * intensity windows reset — the machine stopped on purpose and a human
   * overrode it — and one respawn cycle runs now.
   *
   * A live floor's restart ends its sessions, so it is the person's consented
   * act, in the shape of `system.shutdown {native}` (design-00 EL1), and only
   * for a floor held "unresponsive" past the bound, or "gone" (the states
   * `health().restartOffered` offers it in): an answering floor, or one not yet
   * past the bound, refuses PRECONDITION_FAILED {state}. This fieldd must be
   * able to act (a pid to signal and a spawner), and `consent` must name
   * exactly the sessions the floor census finds, read from the cells with
   * births closed (WG-E6). A census no reading grounds (`FloorCensus.grounded`)
   * refuses {unobserved}; any difference, a birth in flight, or no consent at
   * all refuses PRECONDITION_FAILED {live, births, complete}; births reopen
   * either way. An exact match restarts the floor through the drain ladder;
   * this returns once it has begun ("respawning"). */
  async requestRestart(consent?: { sessions: readonly string[] }): Promise<void> {
    if (this.stopped) return;
    if (!(await this.opts.probeAlive())) {
      this.respawnStamps = [];
      this.wedgeRestartStamps = [];
      this.redials = 0;
      if (this.state === "gone") this.setState("respawning", "manual restart requested");
      await this.considerRespawn("manual restart requested");
      return;
    }
    const pid = this.killTarget();
    if (pid === undefined || !this.canRestartLive()) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "no kill authority over this floor — restart it outside VibeField",
        false,
        { authority: false },
      );
    }
    this.refuseWhileRestarting();
    this.refuseUnlessHeld();
    const census = await this.takeCensus(true);
    let handedOn = false;
    try {
      // the floor may have answered, or begun restarting, while the census read
      this.refuseWhileRestarting();
      this.refuseUnlessHeld();
      const live = [...census.live].sort();
      if (!census.grounded) {
        this.logger.info(
          "fieldd.native_supervisor.consented_restart_refused",
          "A restart of the floor was refused: a terminal cell did not answer and none was ever observed, so no consent can name its sessions",
          { live: live.length, births: census.births, complete: census.complete },
        );
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "the floor's sessions cannot be counted: a terminal cell did not answer, and none was ever observed",
          false,
          { live, births: census.births, complete: census.complete, unobserved: true },
        );
      }
      const named = [...new Set(consent?.sessions ?? [])].sort();
      const exact =
        consent !== undefined &&
        census.births === 0 &&
        live.length === named.length &&
        live.every((sessionId, index) => sessionId === named[index]);
      if (!exact) {
        this.logger.info(
          "fieldd.native_supervisor.consented_restart_refused",
          "A restart of the floor was refused: the consent does not name exactly the sessions it would end",
          {
            live: live.length,
            consented: consent === undefined ? null : named.length,
            births: census.births,
            complete: census.complete,
          },
        );
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          consent === undefined
            ? "restarting a live floor ends its sessions, so the restart must name them"
            : census.births > 0
              ? "a session is being born that the consent does not name; ask again"
              : "the floor's sessions differ from the set consented to end; ask again",
          false,
          { live, births: census.births, complete: census.complete },
        );
      }
      if (this.stopped) return;
      this.respawnStamps = [];
      this.wedgeRestartStamps = [];
      this.redials = 0;
      this.atRisk = live.length;
      this.setState(
        "respawning",
        live.length === 1
          ? "restarted by the person; its 1 session ends"
          : `restarted by the person; its ${live.length} sessions end`,
      );
      this.logger.warn(
        "fieldd.native_supervisor.consented_restart",
        "The person restarted the floor; the sessions they named end with it",
        { pid, sessions: live.length, sessionIds: live },
      );
      handedOn = true;
      void this.restartFloor(pid, census, "the person's restart: the floor exited");
    } finally {
      if (!handedOn) census.release();
    }
  }

  /** WP12 L2b (`build-wp12-updater.md` §9 R2; the PM's ruling 2026-10-15 12:20Z) — stop the floor for an update, in
   * ONE place and in this order:
   *   1. suppress respawn (and the heartbeat: misses during the drain would read as a wedge);
   *   2. `native.lifecycle.prepareRestart` — the intent the next boot reports as `lastExit`;
   *   3. `native.lifecycle.shutdown` — the floor runs its own SIGTERM drain;
   *   4. a bounded wait for the management socket to close — the witness;
   *   5. the drain ladder ONLY if this fieldd holds a pid (a floor it spawned) and the wait passed.
   * An ADOPTED floor — the update path's case by construction — has no pid here: the socket closing is the whole
   * witness, and one that does not close inside the bound is reported `lingering`, never signalled. The caller
   * (`system.shutdown` in daemon.ts) has already matched the person's consent against the live set.
   *
   * The shutdown is asked once and wanted for the whole wait: its deadline (`deadlineAt`, WG-D6) covers
   * `rungMs + closeWaitMs`, so a floor that reads it late still stops rather than answering TIMEOUT. The forced
   * rung is the drain ladder's: after SIGTERM it waits `drainWaitMs` (KILL_DRAIN_WAIT_MS) before SIGKILL. */
  async stopForUpdate(
    intent: NativePrepareRestartParams,
    bounds: { closeWaitMs?: number; rungMs?: number; drainWaitMs?: number } = {},
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
    // a floor already draining may close before its reply lands; the socket closing is the witness either way
    void link
      .request(
        "native.lifecycle.shutdown",
        { reason: intent.reason },
        { deadlineMs: rungMs + closeWaitMs },
      )
      .catch(() => undefined);
    if (await this.closedWithin(rungMs + closeWaitMs)) {
      return this.stoppedForUpdate("closed", fields);
    }
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
      "The floor this fieldd spawned did not close inside the bound; the drain ladder is the backstop",
      { ...fields, closeWaitMs },
    );
    await this.drainLadder(pid, bounds.drainWaitMs ?? this.t.KILL_DRAIN_WAIT_MS, rungMs);
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
    this.disarmLadder();
    this.opts.link.off("connected", this.onConnected);
    this.opts.link.off("reconnecting", this.onReconnecting);
    this.opts.link.off("superseded", this.onSuperseded);
    this.opts.link.off("closed", this.onLinkClosed);
    this.opts.link.off("deadline-miss", this.onDeadlineMiss);
    this.opts.link.off("late-reply", this.onLateReply);
    this.opts.link.off("reply", this.onReply);
    this.opts.link.off("tick", this.onTick);
    this.endEpisode("stopped");
  }

  private readonly onConnected = (): void => {
    // WG-D6 — a hello naming another pid than the one this fieldd spawned is the
    // floor's own word that the spawn is not the floor this link pairs with (it
    // died, and another took the endpoint): the spawn's pid is no target now.
    const stated = this.opts.link.floorPid;
    if (this.pid !== undefined && stated !== undefined && stated !== this.pid) {
      this.logger.info(
        "fieldd.native_supervisor.pid_followed",
        "The paired floor stated a pid other than the one this fieldd spawned; following the floor's word",
        { spawned: this.pid, stated },
      );
      this.pid = undefined;
    }
    this.redials = 0;
    this.misses = 0;
    this.cleanPongs = 0;
    this.startHeartbeat();
    if (this.state === "unresponsive") {
      // WG-E4 — the redial's hello was answered: a fresh reader works. The
      // episode goes on until two clean pongs, as any return to "up" does.
      this.answeringAgain = true;
      this.setState(
        "unresponsive",
        "the redialled link's hello was answered; waiting for two clean pongs",
      );
      return;
    }
    this.evidence = freshEvidence();
    this.atRisk = null;
    this.setState("up", "mgmt link connected");
  };

  private readonly onReconnecting = (): void => {
    this.stopHeartbeat();
    if (this.stopped || this.state === "gone") return;
    // Inside an episode the link going down is the ladder's own redial failing
    // to pair, or the floor's end, which the probe below finds: either way the
    // kill clock runs on, and the state stays "unresponsive".
    if (this.state !== "respawning" && this.state !== "unresponsive") {
      this.setState("connecting", "mgmt link down; redialing");
    }
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

  /** WG-E2 — any response the link read: the kill clock restarts. */
  private readonly onReply = (): void => {
    this.lastReplyAt = performance.now();
  };

  /** WG-D6 — the floor's own tick: the headless clause's witness that its
   * runtime still runs. It never restarts the kill clock. */
  private readonly onTick = (): void => {
    this.lastTickAt = performance.now();
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
    this.episodeId += 1;
    this.answeringAgain = false;
    this.redialedAt = undefined;
    this.lastCountAt = undefined;
    this.atRisk = null;
    this.readOsWaits(); // WG-E5 — the episode's first reading, where the platform gives one
    if (this.loopDelay === undefined) {
      this.loopDelay =
        this.opts.loopDelay ?? monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS });
    }
    this.loopDelay.enable();
    this.armLadder();
  }

  /** Close the open episode, if any, with its one line; the evidence starts
   * over and the ladder stops. Info when the floor recovered, warn for every
   * other ending. */
  private endEpisode(outcome: WedgeEpisodeOutcome): void {
    const since = this.episodeSince;
    if (since === undefined) return;
    this.episodeSince = undefined;
    this.disarmLadder();
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
      osUninterruptibleMax: e.osLast === undefined ? null : e.osUninterruptibleMax,
      osPageins:
        e.osFirst === undefined || e.osLast === undefined
          ? null
          : e.osLast.majorFaults - e.osFirst.majorFaults,
      pid: this.killTarget() ?? null,
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
    if (this.stopped || this.state === "gone" || this.respawnInFlight || this.draining) return;
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

  // ---- detection (TC-D2) ----

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
      const kind = this.missKind(e);
      if (kind === "miss") await this.onMiss();
      else if (kind === "own-stall") this.onOwnStall(e);
      // other failures (the link dropped mid-ping) are the crash path's
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
    // Hysteresis: one lucky pong through a struggling path is not recovery. A
    // floor held "gone" by the wedge intensity bound is alive, and answering
    // again brings it back the same way.
    if ((this.state === "unresponsive" || this.state === "gone") && this.cleanPongs >= 2) {
      this.setState("up", "control path answering again");
    }
  }

  private async onMiss(): Promise<void> {
    this.cleanPongs = 0;
    this.misses += 1;
    this.evidence.misses += 1;
    // WG-D4 — the redialled link stopped answering too: the doors close again
    this.answeringAgain = false;
    if (this.misses === 1) {
      // Stage 2: one immediate short-deadline probe, so a single scheduling
      // hiccup never reaches the threshold on its own.
      try {
        await this.opts.link.ping(this.t.HEARTBEAT_PROBE_DEADLINE_MS);
        this.onPong();
        return;
      } catch (e) {
        const probe = this.missKind(e);
        if (probe === "own-stall") this.onOwnStall(e);
        if (probe !== "miss") return;
        this.misses += 1;
        this.evidence.misses += 1;
      }
    }
    if (this.misses < this.t.HEARTBEAT_MISS_THRESHOLD) return;
    if (this.state === "up") {
      // Detection-to-STATE: reversible, honest, and distinct from "crashed".
      // The ladder runs from here, on the silence of replies.
      this.setState("unresponsive", "the control path stopped answering (process alive)");
    }
  }

  /** WG-E1 — what a failed ping says. A TIMEOUT whose own deadline timer fired
   * past its whole deadline (`firedLateMs`) is fieldd's loop stalling, not the
   * floor: the pong may be sitting unread in the socket. */
  private missKind(error: unknown): "miss" | "own-stall" | "other" {
    if (!(error instanceof RpcCallError) || error.kind !== "TIMEOUT") return "other";
    const details = error.details as { deadlineMs?: unknown; firedLateMs?: unknown } | undefined;
    const late = details?.firedLateMs;
    const deadline = details?.deadlineMs;
    if (typeof late === "number" && typeof deadline === "number" && late >= deadline) {
      return "own-stall";
    }
    return "miss";
  }

  /** A miss fieldd's own stall made: it counts neither way. */
  private onOwnStall(error: unknown): void {
    const details = (error as RpcCallError).details as
      | { deadlineMs?: unknown; firedLateMs?: unknown }
      | undefined;
    this.logger.debug(
      "fieldd.native_supervisor.own_timer_late",
      "A heartbeat's deadline timer fired past its whole deadline: fieldd's loop stalled, and the miss does not count",
      {
        deadlineMs: typeof details?.deadlineMs === "number" ? details.deadlineMs : null,
        firedLateMs: typeof details?.firedLateMs === "number" ? details.firedLateMs : null,
      },
    );
  }

  // ---- the wedge ladder (WG-D1) ----

  /** The kill clock's origin: the last reply, or the episode's start when no
   * reply has come since this fieldd first dialled. */
  private silenceSince(): number {
    return this.lastReplyAt ?? this.episodeSince ?? performance.now();
  }

  /** When the bound falls for a clock started at `since`: WEDGE_CONFIRM_MS of
   * silence, and never sooner than the rest of that bound after the redial,
   * so the redial always has the time a punctual one would have had. */
  private boundAt(since: number): number {
    const redialed = this.redialedAt;
    if (redialed === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(
      since + this.t.WEDGE_CONFIRM_MS,
      redialed + this.t.WEDGE_CONFIRM_MS - this.t.WEDGE_REDIAL_MS,
    );
  }

  private heldPastBound(now: number): boolean {
    return this.state === "unresponsive" && now >= this.boundAt(this.silenceSince());
  }

  private sameEpisode(episode: number): boolean {
    return !this.stopped && this.state === "unresponsive" && this.episodeId === episode;
  }

  /** When the ladder next has something to do: the redial, the bound, then
   * the recount and the headless deadline. */
  private nextStepAt(): number {
    const since = this.silenceSince();
    if (this.redialedAt === undefined) return since + this.t.WEDGE_REDIAL_MS;
    const bound = this.boundAt(since);
    const now = performance.now();
    if (now < bound) return bound;
    const counted = this.lastCountAt;
    const recount =
      counted === undefined || counted < bound ? now : counted + this.t.WEDGE_RECOUNT_MS;
    const headless = this.wholeSilenceSince() + this.t.WEDGE_HEADLESS_MS;
    return now < headless ? Math.min(recount, headless) : recount;
  }

  private armLadder(): void {
    this.disarmLadder();
    if (this.stopped || this.state !== "unresponsive" || this.episodeSince === undefined) return;
    const delay = Math.max(0, this.nextStepAt() - performance.now());
    this.ladderTimer = setTimeout(() => void this.advanceLadder(), delay);
    this.ladderTimer.unref?.();
  }

  private disarmLadder(): void {
    if (this.ladderTimer) {
      clearTimeout(this.ladderTimer);
      this.ladderTimer = null;
    }
  }

  private async advanceLadder(): Promise<void> {
    this.ladderTimer = null;
    if (this.stepping || this.stopped || this.state !== "unresponsive") return;
    const episode = this.episodeId;
    this.stepping = true;
    try {
      const since = this.silenceSince();
      const now = performance.now();
      if (this.redialedAt === undefined) {
        if (now - since >= this.t.WEDGE_REDIAL_MS) await this.redialStep(episode, since);
      } else if (now >= this.boundAt(since)) {
        await this.boundStep(episode, since);
      }
    } catch (error) {
      this.logger.error(
        "fieldd.native_supervisor.ladder_step_failed",
        "A step of the wedge ladder failed; the ladder goes on from the clock",
        error,
      );
    } finally {
      this.stepping = false;
      this.armLadder();
    }
  }

  /** WG-E1 — one yield to I/O before a ladder step: a reply already waiting in
   * the socket is read in that turn's poll phase and restarts the clock, and
   * the step is not taken. */
  private async quietSince(
    since: number,
    episode: number,
    step: "redial" | "restart",
  ): Promise<boolean> {
    await (this.opts.yieldToIo ?? yieldToIo)();
    if (!this.sameEpisode(episode)) return false;
    if (this.silenceSince() === since) return true;
    this.logger.info(
      "fieldd.native_supervisor.wedge_step_cancelled",
      "A reply arrived before the wedge ladder's step; the clock restarts and the step is not taken",
      { step },
    );
    return false;
  }

  /** WG-E4 — the reversible step, once per episode. */
  private async redialStep(episode: number, since: number): Promise<void> {
    if (!(await this.quietSince(since, episode, "redial"))) return;
    const silenceMs = performance.now() - since;
    this.redialedAt = performance.now();
    this.logger.warn(
      "fieldd.native_supervisor.wedge_redial",
      "The floor has not replied; redialling the management link, which ends no session",
      { silenceMs: Math.round(silenceMs), pid: this.killTarget() ?? null },
    );
    this.setState(
      "unresponsive",
      `no reply for ${spoken(silenceMs)}; the management link was redialled`,
    );
    this.opts.link.redial();
  }

  /** WG-E6 and WG-D1's headless clause, past the bound: the count, the
   * empty-floor restart, the hold with its numbers, and the headless restart. */
  private async boundStep(episode: number, since: number): Promise<void> {
    const counted = this.lastCountAt;
    if (
      counted === undefined ||
      counted < this.boundAt(since) ||
      performance.now() - counted >= this.t.WEDGE_RECOUNT_MS
    ) {
      // a count only: births stay open unless the floor reads empty
      const census = await this.takeCensus(false);
      if (!this.sameEpisode(episode)) return;
      this.lastCountAt = performance.now();
      this.atRisk = census.complete ? census.live.length : null;
      this.birthsCounted = census.births;
      const empty = census.complete && census.live.length === 0 && census.births === 0;
      if (empty && this.canRestartLive()) await this.restartWedged(episode, since, "empty");
      if (!this.sameEpisode(episode)) return;
      this.holdDetail();
    }
    if (this.headlessDue() && !this.osWaiting()) {
      await this.restartWedged(episode, since, "headless");
    }
  }

  /** The held floor's detail: how long it has been silent (on the clock as it
   * stands: a reply during the step restarted it), what it holds, and whether
   * anyone can act on it. */
  private holdDetail(): void {
    const silence = `no reply for ${spoken(performance.now() - this.silenceSince())}`;
    const holds = holding(this.atRisk, this.birthsCounted);
    if (!this.canRestartLive()) {
      this.setState(
        "unresponsive",
        `${silence}; ${holds} — this fieldd has no kill authority over this floor; restart it outside VibeField`,
      );
      return;
    }
    let detail = `${silence}; ${holds}`;
    if (!this.personPresent()) {
      detail += this.tickStopped()
        ? "; its tick has stopped and nobody is here to ask"
        : "; nobody is here to ask, and its tick still flows";
    }
    this.setState("unresponsive", detail);
  }

  /** The automatic restart, once its decision stands. `empty`: the decisive
   * census, births closed, must still find an empty floor. `headless`: it
   * proceeds whatever the floor holds, and its warning names every session it
   * ends (the loss receipt). */
  private async restartWedged(
    episode: number,
    since: number,
    cause: "empty" | "headless",
  ): Promise<void> {
    const census = await this.takeCensus(true);
    let handedOn = false;
    try {
      if (!this.sameEpisode(episode)) return;
      const live = [...census.live].sort();
      if (cause === "empty" && !(census.complete && live.length === 0 && census.births === 0)) {
        // a session or a birth landed between the count and this census
        this.atRisk = census.complete ? live.length : null;
        this.birthsCounted = census.births;
        return;
      }
      const pid = this.killTarget();
      if (pid === undefined || !this.canRestartLive()) return;
      if (!(await this.quietSince(since, episode, "restart"))) return;
      // the headless decision was taken before the census and the yield, and
      // either may have read a tick (one fieldd's own stall left unread, or
      // one that came meanwhile): it is taken again here, on what was read
      if (cause === "headless") {
        if (!this.headlessDue()) {
          this.logger.info(
            "fieldd.native_supervisor.wedge_step_cancelled",
            "The floor's tick moved or a person came before the headless restart; it is not taken",
            { step: "restart", cause },
          );
          return;
        }
        if (this.osWaiting()) return;
      }
      const now = Date.now();
      this.wedgeRestartStamps = this.wedgeRestartStamps.filter(
        (at) => now - at < this.t.WEDGE_RESTART_WINDOW_MS,
      );
      if (this.wedgeRestartStamps.length >= this.t.WEDGE_RESTART_MAX) {
        this.setState(
          "gone",
          `the floor wedged and was restarted ${this.t.WEDGE_RESTART_MAX} times in ${this.t.WEDGE_RESTART_WINDOW_MS}ms — something is wrong with the floor itself; use the restart affordance to try again`,
        );
        this.logger.warn(
          "fieldd.native_supervisor.wedge_intensity",
          "The floor keeps wedging; the wedge ladder stops restarting it until a person asks",
          { pid, restarts: this.wedgeRestartStamps.length },
        );
        return;
      }
      this.wedgeRestartStamps.push(now);
      const os = this.readOsWaits(); // WG-E5 — the reading at the irreversible step
      const silenceMs = performance.now() - since;
      this.atRisk = census.complete ? live.length : null;
      const lost = census.complete
        ? live.length === 1
          ? "its 1 session is lost"
          : `its ${live.length} sessions are lost`
        : "its sessions, not all counted, are lost";
      this.setState(
        "respawning",
        cause === "empty"
          ? `no reply for ${spoken(silenceMs)} and the floor holds no session; restarting it`
          : `no reply for ${spoken(silenceMs)}, its tick has stopped and nobody is here; restarting it — ${lost}`,
      );
      this.logger.warn(
        "fieldd.native_supervisor.wedge_restart",
        cause === "empty"
          ? "The floor stopped replying and holds no session; restarting it"
          : "The floor stalled whole with nobody to ask; restarting it — its sessions are lost",
        {
          cause,
          pid,
          silenceMs: Math.round(silenceMs),
          tickAgeMs:
            this.lastTickAt === undefined ? null : Math.round(performance.now() - this.lastTickAt),
          sessions: live.length,
          complete: census.complete,
          lostSessionIds: live,
          osUninterruptible: os?.uninterruptible ?? null,
          osMajorFaults: os?.majorFaults ?? null,
        },
      );
      handedOn = true;
      await this.restartFloor(pid, census, `wedge restart (${cause}): the floor exited`);
    } finally {
      if (!handedOn) census.release();
    }
  }

  /** A deliberate restart of the live floor once it is decided: the drain
   * ladder, births reopened, then the next floor. The crash path does not
   * respawn while the ladder runs; this does, once the floor has gone. */
  private async restartFloor(pid: number, census: FloorCensus, reason: string): Promise<void> {
    this.draining = true;
    try {
      await this.drainLadder(pid);
    } catch (error) {
      this.logger.error(
        "fieldd.native_supervisor.drain_failed",
        "The drain ladder failed; the respawn path goes on",
        error,
      );
    } finally {
      this.draining = false;
      census.release();
    }
    if (!this.stopped) await this.considerRespawn(reason);
  }

  /** THE DRAIN LADDER (WG-D1), every deliberate stop's signals. SIGTERM starts
   * the floor's own drain, which collects every cell's drain report
   * (CELL_SUPERVISION's DRAIN_BUDGET_MS + EXIT_GRACE_MS) before it exits; the
   * SIGKILL rung waits out the drain ladder before it fires (`drainWaitMs`,
   * KILL_DRAIN_WAIT_MS), and fires only if the floor has not exited and no
   * other floor's pid is the target now. */
  private async drainLadder(
    pid: number,
    drainWaitMs = this.t.KILL_DRAIN_WAIT_MS,
    settleMs = KILL_SETTLE_MS,
  ): Promise<"exited" | "killed"> {
    const kill = this.opts.killNative;
    if (kill === undefined || !kill(pid, "SIGTERM")) return "exited"; // already gone
    if (await this.exitedWithin(pid, drainWaitMs)) return "exited";
    const target = this.killTarget();
    if (target !== undefined && target !== pid) return "exited"; // another floor is paired now
    this.logger.warn(
      "fieldd.native_supervisor.drain_overrun",
      "The floor did not exit after its whole drain; SIGKILL",
      { pid, drainWaitMs },
    );
    kill(pid, "SIGKILL");
    await this.exitedWithin(pid, settleMs);
    return "killed";
  }

  /** The floor has exited: its pid is no process (polled), or — with no pid
   * witness — its management socket closed. */
  private async exitedWithin(pid: number, ms: number): Promise<boolean> {
    const alive = this.opts.pidAlive;
    if (alive === undefined) return await this.closedWithin(ms);
    const deadline = performance.now() + ms;
    for (;;) {
      if (!alive(pid)) return true;
      const left = deadline - performance.now();
      if (left <= 0) return false;
      await sleep(Math.min(EXIT_POLL_MS, left));
    }
  }

  private async takeCensus(forStop: boolean): Promise<FloorCensus> {
    const census = this.opts.census;
    if (census === undefined) return UNKNOWN_FLOOR_CENSUS;
    try {
      return await census(forStop);
    } catch (error) {
      this.logger.warn(
        "fieldd.native_supervisor.census_failed",
        "The floor census could not be read; the floor counts as holding sessions",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return UNKNOWN_FLOOR_CENSUS;
    }
  }

  /** The pid a deliberate stop signals: the floor this fieldd spawned, else the
   * one the paired floor stated in its hello (WG-D6). */
  private killTarget(): number | undefined {
    return this.pid ?? this.opts.link.floorPid;
  }

  /** May this fieldd restart the live floor: a pid to signal, and the
   * authority to start the next one. */
  private canRestartLive(): boolean {
    return (
      this.killTarget() !== undefined &&
      this.opts.killNative !== undefined &&
      this.opts.spawnNative !== undefined
    );
  }

  private refuseWhileRestarting(): void {
    if (this.draining || this.state === "respawning") {
      throw new RpcCallError("PRECONDITION_FAILED", "the floor is already restarting", false);
    }
  }

  /** WG-D5 — the person's restart of a live floor is taken only in the states
   * `health().restartOffered` offers it in: held "unresponsive" past the bound,
   * or "gone" (the wedge intensity bound holds a live floor there). */
  private refuseUnlessHeld(): void {
    if (this.heldPastBound(performance.now()) || this.state === "gone") return;
    const why =
      this.state === "up"
        ? "the floor is answering"
        : this.state === "unresponsive"
          ? "the floor is not yet held past the bound"
          : `the floor is ${this.state}`;
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      `${why}; only a floor held unresponsive past the bound is restarted on the person's word`,
      false,
      { state: this.state },
    );
  }

  private personPresent(): boolean {
    return this.opts.personPresent?.() ?? false;
  }

  /** WG-D1 — the floor's tick has stopped: one was seen, and the last is older
   * than TICK_STALE_MS. A floor that never ticked (one predating WG-D6) gives
   * the headless clause no witness, and the clause waits. */
  private tickStopped(): boolean {
    return (
      this.lastTickAt !== undefined && performance.now() - this.lastTickAt > this.t.TICK_STALE_MS
    );
  }

  /** WG-D1's headless clause measures a floor stalled WHOLE: the silence of
   * replies and of the tick together, from the later of the last reply and the
   * last tick. A tick that stopped a moment ago starts it over, however long
   * the replies have been silent. */
  private wholeSilenceSince(): number {
    const replies = this.silenceSince();
    return Math.max(replies, this.lastTickAt ?? replies);
  }

  /** WG-D1's headless clause, as it stands now: this fieldd can act, nobody is
   * here to ask, the tick has stopped, and replies and the tick have both been
   * silent WEDGE_HEADLESS_MS. */
  private headlessDue(): boolean {
    return (
      this.canRestartLive() &&
      !this.personPresent() &&
      this.tickStopped() &&
      performance.now() - this.wholeSilenceSince() >= this.t.WEDGE_HEADLESS_MS
    );
  }

  /** WG-E5 — one reading of the floor's OS waits, kept as the episode's
   * evidence; undefined where the platform says nothing. */
  private readOsWaits(): FloorOsWaits | undefined {
    const read = this.opts.osWaits;
    const pid = this.killTarget();
    if (read === undefined || pid === undefined) return undefined;
    const reading = read(pid);
    if (reading === undefined) return undefined;
    const e = this.evidence;
    if (e.osFirst === undefined) e.osFirst = reading;
    e.osLast = reading;
    e.osUninterruptibleMax = Math.max(e.osUninterruptibleMax, reading.uninterruptible);
    return reading;
  }

  /** WG-E5 — does the OS say the floor waits on I/O: a thread in
   * uninterruptible wait, or page-ins that climbed since the episode's last
   * reading. A floor stalled on disk resumes on its own, so the headless
   * restart holds while it does. false where the platform says nothing. */
  private osWaiting(): boolean {
    const before = this.evidence.osLast;
    const reading = this.readOsWaits();
    if (reading === undefined) return false;
    const climbing = before !== undefined && reading.majorFaults > before.majorFaults;
    if (reading.uninterruptible === 0 && !climbing) return false;
    this.logger.info(
      "fieldd.native_supervisor.wedge_step_held",
      "The OS says the floor's threads wait on I/O; the wedge ladder holds its step",
      {
        step: "headless",
        uninterruptible: reading.uninterruptible,
        pageins: before === undefined ? null : reading.majorFaults - before.majorFaults,
      },
    );
    return true;
  }

  private setState(state: NativeLinkState, detail: string): void {
    if (this.state === state && this.stateDetail === detail) return;
    const changed = this.state !== state;
    this.state = state;
    this.stateDetail = detail;
    if (changed) this.stateSince = Date.now();
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
