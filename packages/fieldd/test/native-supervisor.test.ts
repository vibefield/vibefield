// NativeSupervisor unit rows (terminal-custody TC-D1/TC-D2, slice TC-S1; the
// wedge ladder WG-D0…WG-D6, draft/thinking-floor-wedge.md §6), against a
// scripted link: the state machine is exercised through the same events the
// real NativeLink emits, with injected fast timings. State SEQUENCES are the
// assertions — never wall-clock precision, which this loaded host would flake
// (a lower bound on a timer is the one exception: timers never fire early).
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { NATIVE_SUPERVISION, type PingAck } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import type { FloorOsWaits } from "../src/floor-os-waits";
import type { NativeDeadlineMiss, NativeLateReply, NativeLink } from "../src/native-link";
import { RpcCallError } from "../src/native-link";
import {
  type FloorCensus,
  type LoopDelayMonitor,
  type NativeSupervisionTimings,
  NativeSupervisor,
} from "../src/native-supervisor";

const T: NativeSupervisionTimings = {
  REQUEST_DEADLINE_MS: 1_000,
  HEARTBEAT_INTERVAL_MS: 10,
  HEARTBEAT_DEADLINE_MS: 10,
  HEARTBEAT_PROBE_DEADLINE_MS: 5,
  HEARTBEAT_MISS_THRESHOLD: 2,
  WEDGE_REDIAL_MS: 60,
  WEDGE_CONFIRM_MS: 150,
  WEDGE_HEADLESS_MS: 400,
  WEDGE_RECOUNT_MS: 50,
  WEDGE_RESTART_MAX: 3,
  WEDGE_RESTART_WINDOW_MS: 10_000,
  KILL_DRAIN_WAIT_MS: 100,
  TICK_STALE_MS: 60,
  RESPAWN_AFTER_REDIALS: 2,
  RESPAWN_MAX: 3,
  RESPAWN_WINDOW_MS: 500,
};

/** No ladder step inside the row: the WG-D0 rows end their episodes themselves. */
const PATIENT: NativeSupervisionTimings = {
  ...T,
  WEDGE_REDIAL_MS: 60_000,
  WEDGE_CONFIRM_MS: 60_000,
  WEDGE_HEADLESS_MS: 600_000,
};

class FakeLink extends EventEmitter {
  connected = false;
  wedged = false;
  /** WG-E3 — when set, only every n-th ping is answered: a path that answers
   * some pings and misses the rest */
  answerEvery: number | undefined;
  private pings = 0;
  /** WG-D0/WG-E1 — how late fieldd's own deadline timer fires on a wedged ping */
  firedLateMs = 0;
  /** WG-D6 — the pid the paired floor stated in its hello */
  floorPid: number | undefined;
  /** WG-E4 — whether a redial's hello is answered */
  helloAnswers = false;
  redials = 0;
  private tickSeq = 0;
  dialNow(): void {}
  async ping(deadlineMs: number): Promise<PingAck> {
    this.pings += 1;
    const skipped = this.answerEvery !== undefined && this.pings % this.answerEvery !== 0;
    if (this.wedged || skipped) {
      // the real link's order: the evidence event, then the TIMEOUT with its own lateness
      const miss: NativeDeadlineMiss = {
        method: "native.lifecycle.ping",
        deadlineMs,
        firedLateMs: this.firedLateMs,
      };
      this.emit("deadline-miss", miss);
      throw new RpcCallError("TIMEOUT", "mgmt request exceeded its deadline", true, {
        method: "native.lifecycle.ping",
        deadlineMs,
        firedLateMs: this.firedLateMs,
      });
    }
    this.emit("reply");
    return { bootId: "fake-native-boot", ts: Date.now() };
  }
  /** WG-D0 — a reply that came after its request had settled TIMEOUT: still a reply */
  lateReply(late: NativeLateReply): void {
    this.emit("reply");
    this.emit("late-reply", late);
  }
  /** WG-D6 — the floor's own tick */
  tick(): void {
    this.tickSeq += 1;
    this.emit("tick", { bootId: "fake-native-boot", ts: Date.now(), seq: this.tickSeq });
  }
  /** WG-E4 — the link drops its paired connection and dials again */
  redial(): void {
    this.redials += 1;
    this.connected = false;
    setTimeout(() => {
      if (this.helloAnswers) this.up();
      else this.emit("reconnecting", 500); // the hello went unanswered: the link's backoff
    }, 5);
  }
  /** a hello answered: a reply, then the link is up */
  up(): void {
    this.connected = true;
    this.emit("reply");
    this.emit("connected");
  }
  down(): void {
    this.connected = false;
    this.emit("reconnecting", 0);
  }
}

/** WG-E6 — the floor census, scripted: what the cells hold, whether every one
 * answered, whether a reading grounds it, the births in flight, and how many
 * stop-holds are open. */
class FakeCensus {
  live: string[] = [];
  complete = true;
  grounded = true;
  births = 0;
  /** `forStop` of every read, in order */
  readonly reads: boolean[] = [];
  /** births closed by a read and not yet reopened */
  holds = 0;
  /** runs before each read answers: a row moves the floor here */
  onRead: ((forStop: boolean) => void) | undefined;
  readonly take = async (forStop: boolean): Promise<FloorCensus> => {
    this.reads.push(forStop);
    this.onRead?.(forStop);
    if (forStop) this.holds += 1;
    let released = !forStop;
    return {
      live: [...this.live].sort(),
      complete: this.complete,
      grounded: this.grounded,
      births: this.births,
      release: () => {
        if (released) return;
        released = true;
        this.holds -= 1;
      },
    };
  };
}

interface Kill {
  pid: number;
  signal: string;
  at: number;
}

interface Rig {
  link: FakeLink;
  sup: NativeSupervisor;
  spawns: number[];
  kills: Kill[];
  /** what the endpoint probe answers: a listener is there */
  alive: { value: boolean };
  /** the pids that are processes (the drain ladder's witness) */
  procs: Set<number>;
  present: { value: boolean };
}

function rig(opts?: {
  spawner?: boolean;
  probeAlive?: boolean;
  timings?: NativeSupervisionTimings;
  logger?: Logger;
  loopDelay?: LoopDelayMonitor;
  /** the floor this fieldd spawned; null = an adopted floor (default 999) */
  nativePid?: number | null;
  /** the pid the paired floor states in its hello */
  floorPid?: number;
  census?: FakeCensus;
  personPresent?: boolean;
  /** a SIGTERM'd floor exits after its drain, this long; undefined = it ignores SIGTERM */
  drainMs?: number;
  /** a respawned floor pairs on its own, and comes up wedged when the link is */
  respawnPairs?: boolean;
  yieldToIo?: () => Promise<void>;
  /** WG-E5 — what the OS says the floor waits on; absent, the platform says nothing */
  osWaits?: (pid: number) => FloorOsWaits | undefined;
}): Rig {
  const link = new FakeLink();
  if (opts?.floorPid !== undefined) link.floorPid = opts.floorPid;
  const spawns: number[] = [];
  const kills: Kill[] = [];
  const alive = { value: opts?.probeAlive ?? false };
  const present = { value: opts?.personPresent ?? false };
  const nativePid = opts?.nativePid === undefined ? 999 : opts.nativePid;
  const procs = new Set<number>();
  if (nativePid !== null) procs.add(nativePid);
  if (opts?.floorPid !== undefined) procs.add(opts.floorPid);
  let nextPid = 1000;
  const sup = new NativeSupervisor({
    link: link as unknown as NativeLink,
    probeAlive: () => Promise.resolve(alive.value),
    ...(opts?.spawner === false
      ? {}
      : {
          spawnNative: () => {
            nextPid += 1;
            spawns.push(nextPid);
            procs.add(nextPid);
            if (opts?.respawnPairs === true) {
              const pid = nextPid;
              setTimeout(() => {
                alive.value = true;
                link.floorPid = pid;
                link.up();
              }, 5);
            }
            return nextPid;
          },
        }),
    killNative: (pid, signal) => {
      kills.push({ pid, signal, at: performance.now() });
      if (!procs.has(pid)) return false;
      const exit = (): void => {
        if (!procs.delete(pid)) return;
        alive.value = false;
        link.down();
      };
      if (signal === "SIGKILL") exit();
      else if (opts?.drainMs !== undefined) setTimeout(exit, opts.drainMs);
      return true;
    },
    pidAlive: (pid) => procs.has(pid),
    ...(nativePid !== null ? { nativePid } : {}),
    ...(opts?.census !== undefined ? { census: opts.census.take } : {}),
    personPresent: () => present.value,
    timings: opts?.timings ?? T,
    ...(opts?.logger !== undefined ? { logger: opts.logger } : {}),
    ...(opts?.loopDelay !== undefined ? { loopDelay: opts.loopDelay } : {}),
    ...(opts?.yieldToIo !== undefined ? { yieldToIo: opts.yieldToIo } : {}),
    ...(opts?.osWaits !== undefined ? { osWaits: opts.osWaits } : {}),
  });
  return { link, sup, spawns, kills, alive, procs, present };
}

interface Said {
  level: string;
  event: string;
  attrs: LogFields | undefined;
}

/** The supervisor's log, in order. */
function recorder(): { said: Said[]; logger: Logger } {
  const said: Said[] = [];
  const at =
    (level: string) =>
    (event: string, _message: string, attrs?: LogFields): void => {
      said.push({ level, event, attrs });
    };
  const logger: Logger = {
    child: () => logger,
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: (event, _message, _error, attrs) => {
      said.push({ level: "error", event, attrs });
    },
    fatal: (event, _message, _error, attrs) => {
      said.push({ level: "fatal", event, attrs });
    },
    isLevelEnabled: () => true,
  };
  return { said, logger };
}

const WEDGE_EPISODE = "fieldd.native_supervisor.wedge_episode";
const WEDGE_RESTART = "fieldd.native_supervisor.wedge_restart";
const CANCELLED = "fieldd.native_supervisor.wedge_step_cancelled";
const episodes = (said: Said[]): Said[] => said.filter((s) => s.event === WEDGE_EPISODE);
const signals = (kills: Kill[]): string[] => kills.map((kill) => kill.signal);

/** A pong that came `lateByMs` past a 100 ms deadline, stamped by the floor at `floorTs`. */
const latePong = (lateByMs: number, floorTs: number): NativeLateReply => ({
  method: "native.lifecycle.ping",
  lateByMs,
  roundTripMs: 100 + lateByMs,
  floorTs,
});

/** perf_hooks' loop-delay histogram, scripted. Its readings are nanoseconds,
 * as the real one's are: p99 12.5 ms, max 42 ms. */
class FakeLoopDelay implements LoopDelayMonitor {
  enables = 0;
  disables = 0;
  resets = 0;
  count = 4;
  max = 42_000_000;
  enable(): void {
    this.enables += 1;
  }
  disable(): void {
    this.disables += 1;
  }
  reset(): void {
    this.resets += 1;
  }
  percentile(percentile: number): number {
    return percentile === 99 ? 12_500_000 : 0;
  }
}

const until = async (cond: () => boolean, ms = 2_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("until: condition never held");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Keeps the floor's tick flowing every `everyMs` until the returned stop is called. */
function ticking(link: FakeLink, everyMs: number): () => void {
  const timer = setInterval(() => link.tick(), everyMs);
  return () => clearInterval(timer);
}

/** WG-D5 — wedge the rig's floor and wait until it is held past the bound with
 * a person present: the one state, beside "gone", the person's restart of a
 * live floor is taken in. */
async function heldPastBound(r: Rig): Promise<void> {
  r.link.wedged = true;
  await until(() => r.sup.health().restartOffered);
}

describe("NativeSupervisor (TC-D1/TC-D2)", () => {
  it("detects a wedge as unresponsive — distinct from crash, no kill before confirm", async () => {
    const { link, sup, kills } = rig({ timings: PATIENT });
    link.up();
    expect(sup.state).toBe("up");
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    expect(sup.stateDetail).toContain("control path");
    // detection is a STATE — the destructive step waits out the ladder
    expect(kills).toHaveLength(0);
    sup.stop();
  });

  it("recovers to up only after two clean pongs (hysteresis)", async () => {
    const { link, sup, kills, spawns } = rig({ timings: PATIENT });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    link.wedged = false;
    await until(() => sup.state === "up");
    expect(kills).toHaveLength(0);
    expect(spawns).toHaveLength(0);
    sup.stop();
  });

  it("respawns after redials exhaust and the endpoint probe says dead", async () => {
    const { link, sup, spawns } = rig();
    link.up();
    link.down();
    link.emit("reconnecting", 0); // second failed redial reaches the threshold
    await until(() => spawns.length === 1);
    expect(sup.state).toBe("respawning");
    expect(sup.currentPid).toBe(spawns[0]);
    sup.stop();
  });

  it("never spawns over a live listener (the double-spawn guard)", async () => {
    const { link, sup, spawns, alive } = rig({ probeAlive: true });
    alive.value = true;
    link.up();
    link.down();
    link.emit("reconnecting", 0);
    // the probe answered: the floor exists; give the async path a beat and
    // assert nothing was spawned — this row can fail (drop the probe and it does)
    await new Promise((r) => setTimeout(r, 50));
    expect(spawns).toHaveLength(0);
    expect(sup.state).toBe("connecting");
    sup.stop();
  });

  it("trips to gone at the intensity bound; the restart affordance resets it", async () => {
    const { link, sup, spawns } = rig();
    link.up();
    for (let i = 1; i <= 3; i += 1) {
      link.down();
      link.emit("reconnecting", 0);
      await until(() => spawns.length === i);
    }
    // fourth death inside the window: the machine stops ON PURPOSE
    link.down();
    link.emit("reconnecting", 0);
    await until(() => sup.state === "gone");
    expect(spawns).toHaveLength(3);
    expect(sup.stateDetail).toContain("intensity");
    await sup.requestRestart();
    await until(() => spawns.length === 4);
    sup.stop();
  });

  it("an adopted floor going down surfaces gone with no spawn authority", async () => {
    const { link, sup, spawns } = rig({ spawner: false });
    link.up();
    link.down();
    link.emit("reconnecting", 0);
    await until(() => sup.state === "gone");
    expect(sup.stateDetail).toContain("no spawn authority");
    expect(spawns).toHaveLength(0);
    sup.stop();
  });
});

// WG-D1's ladder (draft/thinking-floor-wedge.md §5.3; the unit rows of §6).
describe("NativeSupervisor — the wedge ladder (WG-E1…E6, WG-D1)", () => {
  it("a fieldd-side stutter, its timers firing past their whole deadline, never starts the ladder (WG-E1)", async () => {
    const { link, sup, kills } = rig({ census: new FakeCensus() });
    link.up();
    link.firedLateMs = 500; // every deadline timer fires 50× past the beat's deadline
    link.wedged = true;
    await sleep(T.WEDGE_REDIAL_MS + T.WEDGE_CONFIRM_MS + 100);
    expect(sup.state, "a miss fieldd's own stall made counts neither way").toBe("up");
    expect(link.redials).toBe(0);
    expect(kills).toEqual([]);
    sup.stop();
  });

  it("a reply already waiting when the step yields cancels the step, and the clock restarts (WG-E1)", async () => {
    const { said, logger } = recorder();
    let waiting = true;
    const { link, sup } = rig({
      logger,
      census: new FakeCensus(),
      yieldToIo: async () => {
        // the poll phase reads the reply that was sitting in the socket
        if (waiting) {
          waiting = false;
          link.emit("reply");
        }
      },
    });
    link.up();
    link.wedged = true;
    await until(() => said.some((s) => s.event === CANCELLED));
    const cancelled = said.find((s) => s.event === CANCELLED);
    expect(cancelled?.attrs).toMatchObject({ step: "redial" });
    expect(link.redials, "the step was not taken").toBe(0);
    // the clock restarted at that reply: the redial comes a whole WEDGE_REDIAL_MS later
    await until(() => link.redials === 1);
    sup.stop();
  });

  it("a late pong restarts the kill clock and is logged with the floor's ts (WG-E2)", async () => {
    const { said, logger } = recorder();
    const timings = { ...T, WEDGE_REDIAL_MS: 300, WEDGE_CONFIRM_MS: 500 };
    const { link, sup, kills } = rig({ logger, census: new FakeCensus(), timings });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    // a slow reader: every pong comes back late, well inside the redial's window
    for (let i = 0; i < 8; i += 1) {
      link.lateReply(latePong(30, 1_000 + i));
      await sleep(50);
    }
    expect(link.redials, "a late reply proves the reader moves").toBe(0);
    expect(kills).toEqual([]);
    link.wedged = false;
    await until(() => sup.state === "up");
    sup.stop();
    expect(episodes(said)[0]?.attrs).toMatchObject({ outcome: "recovered", lastFloorTs: 1_007 });
  });

  it("notifications alone never restart the clock: the redial comes while the tick flows (WG-E2)", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const { link, sup, kills } = rig({ census, personPresent: true });
    const stopTicking = ticking(link, 10);
    link.up();
    link.wedged = true;
    await until(() => link.redials === 1);
    await until(() => census.reads.length > 0);
    expect(sup.health().lastTickAgeMs).toBeLessThan(T.TICK_STALE_MS);
    expect(sup.health().lastReplyAgeMs).toBeGreaterThanOrEqual(T.WEDGE_CONFIRM_MS);
    expect(kills).toEqual([]);
    stopTicking();
    sup.stop();
  });

  it("intermittent pongs never reach a kill (WG-E3)", async () => {
    const census = new FakeCensus();
    const timings = { ...T, WEDGE_REDIAL_MS: 300, WEDGE_CONFIRM_MS: 500 };
    const { link, sup, kills } = rig({ census, timings });
    link.up();
    link.answerEvery = 3; // a path that answers some pings and misses the rest
    await sleep(timings.WEDGE_CONFIRM_MS + 200);
    expect(link.redials).toBe(0);
    expect(census.reads).toEqual([]);
    expect(kills).toEqual([]);
    sup.stop();
  });

  it("the redial runs before anything irreversible, and an unanswered hello keeps the clock running (WG-E4)", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const states: string[] = [];
    const { link, sup, kills } = rig({ census, personPresent: true });
    sup.on("transition", (state: string) => states.push(state));
    link.up();
    link.wedged = true;
    await until(() => link.redials === 1);
    expect(census.reads, "no census before the redial").toEqual([]);
    expect(sup.stateDetail).toContain("redialled");
    // the hello goes unanswered: the clock runs on, and the bound comes on it
    await until(() => census.reads.length > 0);
    expect(states, "never connecting").not.toContain("connecting");
    expect(sup.state).toBe("unresponsive");
    expect(link.redials, "once per episode").toBe(1);
    expect(kills).toEqual([]);
    sup.stop();
  });

  it("a redial whose hello answers recovers a per-connection wedge outright, through two clean pongs (WG-E4)", async () => {
    const { link, sup, kills } = rig({ census: new FakeCensus() });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    link.helloAnswers = true;
    // the wedge was this connection's reader: a fresh one answers
    const recovered = until(() => sup.state === "up");
    await until(() => link.redials === 1);
    link.wedged = false;
    await recovered;
    expect(kills).toEqual([]);
    sup.stop();
  });

  it("past the bound an empty floor is restarted; one holding sessions is held, and its state names the count (WG-E6)", async () => {
    // empty: the census decides, the drain ladder runs, the next floor is spawned
    const empty = new FakeCensus();
    const a = rig({ census: empty, drainMs: 20, personPresent: true });
    a.link.up();
    a.link.wedged = true;
    await until(() => a.spawns.length === 1);
    expect(signals(a.kills)).toEqual(["SIGTERM"]);
    expect(empty.reads, "a count, then the decisive census with births closed").toEqual([
      false,
      true,
    ]);
    expect(empty.holds, "births reopen once the floor has gone").toBe(0);
    a.sup.stop();

    // three sessions: held with its numbers, the person's restart offered
    const held = new FakeCensus();
    held.live = ["s-1", "s-2", "s-3"];
    const b = rig({ census: held, drainMs: 20, personPresent: true });
    b.link.up();
    b.link.wedged = true;
    await until(() => held.reads.length > 0);
    await until(() => b.sup.stateDetail.includes("3 sessions"));
    expect(b.sup.state).toBe("unresponsive");
    expect(b.sup.health()).toMatchObject({
      state: "unresponsive",
      sessionsAtRisk: 3,
      restartOffered: true,
      headlessAt: null,
      pid: 999,
    });
    expect(b.kills).toEqual([]);
    expect(
      held.reads.every((forStop) => !forStop),
      "a held floor is counted, never closed",
    ).toBe(true);
    b.sup.stop();
  });

  it("a session born cell-direct during the window blocks the empty-floor restart (WG-E6)", async () => {
    const census = new FakeCensus();
    // the count reads empty; by the decisive census a session has been born
    census.onRead = (forStop) => {
      if (forStop) census.live = ["born-cell-direct"];
    };
    const { link, sup, kills } = rig({ census, drainMs: 20, personPresent: true });
    link.up();
    link.wedged = true;
    await until(() => census.reads.includes(true));
    await until(() => sup.stateDetail.includes("1 session"));
    expect(kills).toEqual([]);
    expect(census.holds, "births reopened").toBe(0);
    expect(sup.health().sessionsAtRisk).toBe(1);
    sup.stop();
  });

  it("an unknown census — a cell that did not answer — counts as holding sessions", async () => {
    const census = new FakeCensus();
    census.complete = false;
    const { link, sup, kills } = rig({ census, drainMs: 20, personPresent: true });
    link.up();
    link.wedged = true;
    await until(() => census.reads.length >= 2); // the bound, then a recount
    expect(kills).toEqual([]);
    expect(sup.health().sessionsAtRisk).toBeNull();
    expect(sup.stateDetail).toContain("did not answer the census");
    sup.stop();
  });

  it("floors that wedge on every boot reach gone after the wedge intensity bound, never a restart a minute forever", async () => {
    const census = new FakeCensus();
    const { said, logger } = recorder();
    const { link, sup, spawns, kills } = rig({
      census,
      drainMs: 10,
      respawnPairs: true,
      logger,
      // the crash path's own bound stays out of this row
      timings: { ...T, RESPAWN_MAX: 100 },
    });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "gone", 8_000);
    expect(spawns).toHaveLength(T.WEDGE_RESTART_MAX);
    expect(signals(kills).filter((signal) => signal === "SIGTERM")).toHaveLength(
      T.WEDGE_RESTART_MAX,
    );
    expect(sup.stateDetail).toContain("wedged and was restarted");
    expect(said.filter((s) => s.event === WEDGE_RESTART)).toHaveLength(T.WEDGE_RESTART_MAX);
    expect(said.some((s) => s.event === "fieldd.native_supervisor.wedge_intensity")).toBe(true);
    sup.stop();
  });

  it("the SIGKILL rung waits out the drain ladder, and a floor that drains in time never sees it", async () => {
    // a floor that finishes its drain inside the wait: SIGTERM only
    const drains = rig({ census: new FakeCensus(), drainMs: T.KILL_DRAIN_WAIT_MS / 2 });
    drains.link.up();
    drains.link.wedged = true;
    await until(() => drains.spawns.length === 1);
    expect(signals(drains.kills)).toEqual(["SIGTERM"]);
    drains.sup.stop();

    // a floor that ignores SIGTERM: SIGKILL, and only after the whole wait
    const deaf = rig({ census: new FakeCensus() });
    deaf.link.up();
    deaf.link.wedged = true;
    await until(() => deaf.kills.length === 2);
    const [term, kill] = deaf.kills;
    expect(signals(deaf.kills)).toEqual(["SIGTERM", "SIGKILL"]);
    expect((kill?.at ?? 0) - (term?.at ?? 0)).toBeGreaterThanOrEqual(T.KILL_DRAIN_WAIT_MS - 1);
    deaf.sup.stop();
  });

  it("a SIGTERM'd floor with a live agent session is not SIGKILLed before its drain report", async () => {
    const census = new FakeCensus();
    census.live = ["agent-1"];
    // the agent cell's drain takes time, and it ends inside the wait
    const r = rig({
      census,
      probeAlive: true,
      drainMs: T.KILL_DRAIN_WAIT_MS / 2,
      personPresent: true,
    });
    const { link, sup, kills, spawns } = r;
    link.up();
    await heldPastBound(r);
    await sup.requestRestart({ sessions: ["agent-1"] });
    expect(sup.state).toBe("respawning");
    await until(() => spawns.length === 1);
    expect(signals(kills)).toEqual(["SIGTERM"]);
    sup.stop();
  });

  it("headless: a held floor waits while its tick flows, and proceeds with loss receipts once it stops", async () => {
    const census = new FakeCensus();
    census.live = ["s-1", "s-2"];
    const { said, logger } = recorder();
    const { link, sup, kills, spawns } = rig({ census, drainMs: 10, logger });
    let lastTick = 0;
    link.on("tick", () => {
      lastTick = performance.now();
    });
    const stopTicking = ticking(link, 10);
    link.up();
    link.wedged = true;
    await until(() => census.reads.length > 0);
    expect(sup.health().headlessAt, "the clause is armed: nobody is here").not.toBeNull();
    expect(sup.health().restartOffered).toBe(false);
    // past the headless deadline, the tick still flowing: a reader wedge; it waits
    await sleep(T.WEDGE_HEADLESS_MS + 100);
    expect(kills).toEqual([]);
    expect(sup.stateDetail).toContain("tick still flows");

    stopTicking(); // the floor stalled whole
    await until(() => spawns.length === 1);
    expect(signals(kills)[0]).toBe("SIGTERM");
    // the replies were silent far past the deadline already; the clause counts
    // the WHOLE floor's silence, so the SIGTERM waits WEDGE_HEADLESS_MS from the
    // last tick, never a TICK_STALE_MS gap
    expect((kills[0]?.at ?? 0) - lastTick).toBeGreaterThanOrEqual(T.WEDGE_HEADLESS_MS - 1);
    const receipt = said.find((s) => s.event === WEDGE_RESTART);
    expect(receipt).toMatchObject({
      level: "warn",
      attrs: { cause: "headless", sessions: 2, lostSessionIds: ["s-1", "s-2"] },
    });
    sup.stop();
  });

  it("headless never proceeds with a person present, nor on a floor that has never ticked", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const withPerson = rig({ census, drainMs: 10, personPresent: true });
    withPerson.link.up();
    withPerson.link.tick(); // one tick, then silence: stalled whole
    withPerson.link.wedged = true;
    await sleep(T.WEDGE_HEADLESS_MS + 200);
    expect(withPerson.kills).toEqual([]);
    expect(withPerson.sup.health()).toMatchObject({ restartOffered: true, headlessAt: null });
    withPerson.sup.stop();

    const held = new FakeCensus();
    held.live = ["s-1"];
    const old = rig({ census: held, drainMs: 10 });
    old.link.up();
    old.link.wedged = true;
    await sleep(T.WEDGE_HEADLESS_MS + 200);
    expect(old.kills, "no tick was ever seen: the clause has no witness").toEqual([]);
    old.sup.stop();
  });

  it("headless: a tick read while the decisive census was taken cancels the restart", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const { said, logger } = recorder();
    const { link, sup, kills } = rig({ census, drainMs: 10, logger });
    // the floor's tick arrives while the stop-census waits on the cells
    census.onRead = (forStop) => {
      if (forStop) link.tick();
    };
    link.up();
    link.tick(); // one tick, then silence: stalled whole, as far as fieldd has read
    link.wedged = true;
    await until(() => said.some((s) => s.event === CANCELLED && s.attrs?.step === "restart"));
    expect(census.reads, "the decision reached its census").toContain(true);
    expect(kills, "the floor's runtime moved: nothing is signalled").toEqual([]);
    expect(census.holds, "births reopened").toBe(0);
    sup.stop();
  });

  it("headless: ticks fieldd's own stall left unread are read at the yield, and cancel the restart", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const { said, logger } = recorder();
    const { link, sup, kills } = rig({
      census,
      drainMs: 10,
      logger,
      // fieldd's loop was blocked past TICK_STALE_MS when the deadline fired:
      // the poll phase after the decision reads the ticks that sat in the socket
      yieldToIo: async () => {
        link.tick();
      },
    });
    link.up();
    link.wedged = true;
    await until(() => said.some((s) => s.event === CANCELLED && s.attrs?.step === "restart"));
    expect(kills, "a tick that was only unread is no floor stalled whole").toEqual([]);
    sup.stop();
  });

  it("headless holds while the OS says the floor's threads wait on I/O, and its lines carry the reading (WG-E5)", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const { said, logger } = recorder();
    // a floor stalled on disk: a thread in uninterruptible wait, its page-ins climbing
    const os = { uninterruptible: 1, majorFaults: 100 };
    const { link, sup, kills, spawns } = rig({
      census,
      drainMs: 10,
      logger,
      osWaits: () => {
        if (os.uninterruptible > 0) os.majorFaults += 7;
        return { ...os };
      },
    });
    link.up();
    link.tick(); // then silence: the tick has stopped
    link.wedged = true;
    const HELD = "fieldd.native_supervisor.wedge_step_held";
    await until(() => said.some((s) => s.event === HELD));
    expect(kills, "a floor stalled on disk resumes on its own").toEqual([]);
    expect(said.find((s) => s.event === HELD)?.attrs).toMatchObject({
      step: "headless",
      uninterruptible: 1,
    });

    // its threads sleep as a deadlocked floor's do, and nothing pages in: it proceeds
    os.uninterruptible = 0;
    await until(() => spawns.length === 1);
    expect(said.find((s) => s.event === WEDGE_RESTART)?.attrs).toMatchObject({
      cause: "headless",
      osUninterruptible: 0,
    });
    sup.stop();
    const line = episodes(said)[0]?.attrs as { osUninterruptibleMax: number; osPageins: number };
    expect(line.osUninterruptibleMax).toBe(1);
    expect(line.osPageins).toBeGreaterThan(0);
  });

  it("this incident's row: a 3.5 s silence never ends a floor that holds sessions", async () => {
    const census = new FakeCensus();
    census.live = ["claude", "codex", "grok"];
    const { link, sup, kills } = rig({ census, timings: NATIVE_SUPERVISION, drainMs: 10 });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    await sleep(3_500);
    expect(kills).toEqual([]);
    expect(link.redials, "3.5 s is inside the redial's 10 s").toBe(0);
    link.wedged = false;
    await until(() => sup.state === "up");
    sup.stop();
  }, 10_000);
});

// WG-D5 — the person's restart: consent-shaped, census-checked, only for a
// floor held past the bound, and only where this fieldd can act.
describe("NativeSupervisor — the person's restart (WG-D5)", () => {
  it("an adopted floor with no stated pid: requestRestart kills nothing and says so", async () => {
    const { link, sup, kills } = rig({
      nativePid: null,
      probeAlive: true,
      census: new FakeCensus(),
    });
    link.up();
    await expect(sup.requestRestart({ sessions: [] })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      message: "no kill authority over this floor — restart it outside VibeField",
    });
    expect(kills).toEqual([]);
    sup.stop();
  });

  it("an adopted floor that stated its pid (WG-D6) can be restarted on the person's word", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const r = rig({
      nativePid: null,
      floorPid: 4_242,
      probeAlive: true,
      census,
      drainMs: 10,
      personPresent: true,
    });
    const { link, sup, kills } = r;
    link.up();
    await heldPastBound(r);
    await sup.requestRestart({ sessions: ["s-1"] });
    await until(() => kills.length > 0);
    expect(kills[0]).toMatchObject({ pid: 4_242, signal: "SIGTERM" });
    sup.stop();
  });

  it("the consent must name exactly the census: a difference, a birth, or no list refuses, and births reopen", async () => {
    const census = new FakeCensus();
    census.live = ["s-1", "s-2"];
    const r = rig({ probeAlive: true, census, drainMs: 10, personPresent: true });
    const { link, sup, kills } = r;
    link.up();
    await heldPastBound(r);

    const differs = await sup.requestRestart({ sessions: ["s-1"] }).catch((e: RpcCallError) => e);
    expect(differs).toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { live: ["s-1", "s-2"], births: 0, complete: true },
    });
    const unnamed = await sup.requestRestart().catch((e: RpcCallError) => e);
    expect(unnamed).toMatchObject({ kind: "PRECONDITION_FAILED" });
    census.births = 1;
    const exactSet = { sessions: ["s-2", "s-1"] };
    const birth = await sup.requestRestart(exactSet).catch((e: RpcCallError) => e);
    expect(birth).toMatchObject({ kind: "PRECONDITION_FAILED", details: { births: 1 } });
    expect(census.holds, "every refusal reopened births").toBe(0);
    expect(kills).toEqual([]);

    // the exact set, in any order, is the person's consent
    census.births = 0;
    await sup.requestRestart(exactSet);
    expect(sup.state).toBe("respawning");
    await until(() => kills.length > 0);
    expect(kills[0]).toMatchObject({ pid: 999, signal: "SIGTERM" });
    sup.stop();
  });

  it("an answering floor, or one not yet held past the bound, is not restarted on the person's word", async () => {
    const census = new FakeCensus();
    census.live = ["s-1"];
    const { link, sup, kills } = rig({
      probeAlive: true,
      census,
      personPresent: true,
      timings: PATIENT,
    });
    link.up();
    const answering = await sup.requestRestart({ sessions: ["s-1"] }).catch((e: RpcCallError) => e);
    expect(answering).toMatchObject({
      kind: "PRECONDITION_FAILED",
      message: expect.stringContaining("the floor is answering"),
      details: { state: "up" },
    });
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    const early = await sup.requestRestart({ sessions: ["s-1"] }).catch((e: RpcCallError) => e);
    expect(early).toMatchObject({
      kind: "PRECONDITION_FAILED",
      message: expect.stringContaining("not yet held past the bound"),
      details: { state: "unresponsive" },
    });
    expect(census.reads, "no census is read for a floor that is not held").toEqual([]);
    expect(kills).toEqual([]);
    sup.stop();
  });

  it("a census no reading grounds names nothing to consent to: [] refuses, and nothing is signalled", async () => {
    // no census at all: unknown
    const none = rig({ probeAlive: true, personPresent: true });
    none.link.up();
    await heldPastBound(none);
    const unknown = await none.sup.requestRestart({ sessions: [] }).catch((e: RpcCallError) => e);
    expect(unknown).toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { live: [], complete: false, unobserved: true },
    });
    expect(none.kills).toEqual([]);
    none.sup.stop();

    // a silent cell this fieldd never observed: nothing stands in for it
    const census = new FakeCensus();
    census.complete = false;
    census.grounded = false;
    const mute = rig({ probeAlive: true, personPresent: true, census });
    mute.link.up();
    await heldPastBound(mute);
    const refused = await mute.sup.requestRestart({ sessions: [] }).catch((e: RpcCallError) => e);
    expect(refused).toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { unobserved: true },
    });
    expect(census.holds, "births reopened").toBe(0);
    expect(mute.kills).toEqual([]);
    mute.sup.stop();
  });

  it("the adopted-floor wedge: held past the bound with no kill authority, it says so and offers nothing", async () => {
    const census = new FakeCensus();
    const { link, sup, kills } = rig({ nativePid: null, census, personPresent: true });
    link.up();
    link.wedged = true;
    await until(() => sup.stateDetail.includes("no kill authority"));
    expect(sup.stateDetail).toContain("restart it outside VibeField");
    // an empty count with no birth in flight says so, never "a session is being born"
    expect(sup.stateDetail).toContain("it holds no session");
    expect(sup.health()).toMatchObject({ restartOffered: false, pid: null, headlessAt: null });
    expect(
      census.reads.every((forStop) => !forStop),
      "an empty count is no decision here",
    ).toBe(true);
    expect(kills).toEqual([]);
    sup.stop();
  });
});

// WG-D0 (draft/thinking-floor-wedge.md §10): each unresponsive episode closes
// with ONE line that says whose stall it was.
describe("NativeSupervisor wedge episodes (WG-D0)", () => {
  it("a recovered episode logs exactly one line: its counts, the floor's ts, fieldd's lag", async () => {
    const { said, logger } = recorder();
    const loopDelay = new FakeLoopDelay();
    const { link, sup, kills } = rig({ logger, loopDelay, timings: PATIENT });
    link.up();
    // late, but inside the probe's 5 ms deadline: every miss counts (WG-E1)
    link.firedLateMs = 3;
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    expect(loopDelay.enables, "fieldd's loop is sampled while the episode is open").toBe(1);
    link.lateReply(latePong(30, 111));
    link.lateReply(latePong(55, 222));
    // a slow mesh verb's answer: the latest of the three, and no floor clock on it
    link.lateReply({ method: "native.mesh.serve.remove", lateByMs: 400.04, roundTripMs: 10_400 });
    link.wedged = false;
    await until(() => sup.state === "up");
    sup.stop(); // a closed episode is never logged twice

    const lines = episodes(said);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(lines[0]?.attrs).toMatchObject({
      outcome: "recovered",
      lateReplies: 3,
      maxLateMs: 400, // to the line's 0.1 ms
      lastFloorTs: 222,
      timerLateMaxMs: 3,
      loopLagP99Ms: 12.5,
      loopLagMaxMs: 42,
      pid: 999,
    });
    const attrs = lines[0]?.attrs as { misses: number; requestsTimedOut: number; ms: number };
    // the miss streak that opened the episode is in it: the detection pair at least
    expect(attrs.misses).toBeGreaterThanOrEqual(2);
    // every miss was a ping that timed out, and nothing else timed out
    expect(attrs.requestsTimedOut).toBe(attrs.misses);
    expect(attrs.ms).toBeGreaterThanOrEqual(0);
    expect(loopDelay).toMatchObject({ enables: 1, disables: 1, resets: 1 });
    expect(kills).toHaveLength(0);
  });

  it("an episode a restart ends logs outcome restarted, ahead of the restart's own warning", async () => {
    const { said, logger } = recorder();
    const { link, sup, kills } = rig({
      logger,
      loopDelay: new FakeLoopDelay(),
      census: new FakeCensus(),
      drainMs: 10,
    });
    link.up();
    link.wedged = true;
    await until(() => kills.length > 0, 3_000);
    sup.stop();

    const lines = episodes(said);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", attrs: { outcome: "restarted", pid: 999 } });
    const order = said.map((s) => s.event);
    expect(order.indexOf(WEDGE_EPISODE)).toBeLessThan(order.indexOf(WEDGE_RESTART));
    // the ladder's steps log as they happen: the redial at warn, before the restart
    const redial = said.find((s) => s.event === "fieldd.native_supervisor.wedge_redial");
    expect(redial?.level).toBe("warn");
    expect(order.indexOf("fieldd.native_supervisor.wedge_redial")).toBeLessThan(
      order.indexOf(WEDGE_RESTART),
    );
  });

  it("a link that drops mid-episode keeps it open: the clock runs across the drop", async () => {
    const { said, logger } = recorder();
    const { link, sup } = rig({ logger, loopDelay: new FakeLoopDelay(), timings: PATIENT });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    link.down();
    expect(sup.state).toBe("unresponsive");
    expect(episodes(said)).toEqual([]);
    sup.stop();
    expect(episodes(said).map((s) => s.attrs?.outcome)).toEqual(["stopped"]);
  });

  it("a link that closes for good mid-episode closes it as link-closed", async () => {
    const { said, logger } = recorder();
    const { link, sup } = rig({ logger, loopDelay: new FakeLoopDelay(), timings: PATIENT });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    link.emit("closed");
    sup.stop();

    expect(episodes(said).map((s) => s.attrs?.outcome)).toEqual(["link-closed"]);
    expect(episodes(said)[0]?.level).toBe("warn");
  });

  it("stop() mid-episode closes it as stopped, and the loop sampler with it", async () => {
    const { said, logger } = recorder();
    const loopDelay = new FakeLoopDelay();
    const { link, sup } = rig({ logger, loopDelay, timings: PATIENT });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    sup.stop();

    expect(episodes(said).map((s) => s.attrs?.outcome)).toEqual(["stopped"]);
    expect(loopDelay).toMatchObject({ enables: 1, disables: 1 });
  });
});
