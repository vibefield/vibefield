// NativeSupervisor unit rows (terminal-custody TC-D1/TC-D2, slice TC-S1),
// against a scripted link: the state machine is exercised through the same
// events the real NativeLink emits, with injected fast timings. State
// SEQUENCES are the assertions — never wall-clock precision, which this
// loaded host would flake.
import { EventEmitter } from "node:events";
import type { PingAck } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import type { NativeDeadlineMiss, NativeLateReply, NativeLink } from "../src/native-link";
import { RpcCallError } from "../src/native-link";
import {
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
  WEDGE_CONFIRM_MS: 80,
  RESPAWN_AFTER_REDIALS: 2,
  RESPAWN_MAX: 3,
  RESPAWN_WINDOW_MS: 500,
};

/** No kill inside the row: the WG-D0 rows end their episodes themselves. */
const PATIENT: NativeSupervisionTimings = { ...T, WEDGE_CONFIRM_MS: 60_000 };

class FakeLink extends EventEmitter {
  connected = false;
  wedged = false;
  /** WG-D0 — how late fieldd's own deadline timer fires on a wedged ping */
  firedLateMs = 0;
  dialNow(): void {}
  async ping(deadlineMs: number): Promise<PingAck> {
    if (this.wedged) {
      // the real link's order: the evidence event, then the TIMEOUT
      const miss: NativeDeadlineMiss = {
        method: "native.lifecycle.ping",
        deadlineMs,
        firedLateMs: this.firedLateMs,
      };
      this.emit("deadline-miss", miss);
      throw new RpcCallError("TIMEOUT", "mgmt request exceeded its deadline", true);
    }
    return { bootId: "fake-native-boot", ts: Date.now() };
  }
  /** WG-D0 — a reply that came after its request had settled TIMEOUT */
  lateReply(late: NativeLateReply): void {
    this.emit("late-reply", late);
  }
  up(): void {
    this.connected = true;
    this.emit("connected");
  }
  down(): void {
    this.connected = false;
    this.emit("reconnecting", 0);
  }
}

interface Rig {
  link: FakeLink;
  sup: NativeSupervisor;
  spawns: number[];
  kills: Array<{ pid: number; signal: string }>;
  alive: { value: boolean };
}

function rig(opts?: {
  spawner?: boolean;
  probeAlive?: boolean;
  timings?: NativeSupervisionTimings;
  logger?: Logger;
  loopDelay?: LoopDelayMonitor;
}): Rig {
  const link = new FakeLink();
  const spawns: number[] = [];
  const kills: Array<{ pid: number; signal: string }> = [];
  const alive = { value: opts?.probeAlive ?? false };
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
            return nextPid;
          },
        }),
    killNative: (pid, signal) => {
      kills.push({ pid, signal });
      return true;
    },
    nativePid: 999,
    timings: opts?.timings ?? T,
    ...(opts?.logger !== undefined ? { logger: opts.logger } : {}),
    ...(opts?.loopDelay !== undefined ? { loopDelay: opts.loopDelay } : {}),
  });
  return { link, sup, spawns, kills, alive };
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
const episodes = (said: Said[]): Said[] => said.filter((s) => s.event === WEDGE_EPISODE);

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

describe("NativeSupervisor (TC-D1/TC-D2)", () => {
  it("detects a wedge as unresponsive — distinct from crash, no kill before confirm", async () => {
    const { link, sup, kills } = rig();
    link.up();
    expect(sup.state).toBe("up");
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    expect(sup.stateDetail).toContain("control path");
    // detection is a STATE — the destructive step waits out the confirm window
    expect(kills).toHaveLength(0);
    sup.stop();
  });

  it("recovers to up only after two clean pongs (hysteresis)", async () => {
    const { link, sup, kills, spawns } = rig();
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    link.wedged = false;
    await until(() => sup.state === "up");
    expect(kills).toHaveLength(0);
    expect(spawns).toHaveLength(0);
    sup.stop();
  });

  it("kills and respawns after the wedge confirm window", async () => {
    const { link, sup, kills } = rig();
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    await until(() => kills.length > 0, 3_000);
    expect(kills[0]).toEqual({ pid: 999, signal: "SIGTERM" });
    expect(sup.state).toBe("respawning");
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

// WG-D0 (draft/thinking-floor-wedge.md §10): each unresponsive episode closes
// with ONE line that says whose stall it was. Observability only — the rows
// above are the ladder, and nothing here moves it.
describe("NativeSupervisor wedge episodes (WG-D0)", () => {
  it("a recovered episode logs exactly one line: its counts, the floor's ts, fieldd's lag", async () => {
    const { said, logger } = recorder();
    const loopDelay = new FakeLoopDelay();
    const { link, sup, kills } = rig({ logger, loopDelay, timings: PATIENT });
    link.up();
    link.firedLateMs = 7;
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
      timerLateMaxMs: 7,
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

  it("an episode the kill ends logs outcome restarted, ahead of the kill's own warning", async () => {
    const { said, logger } = recorder();
    const { link, sup, kills } = rig({ logger, loopDelay: new FakeLoopDelay() });
    link.up();
    link.wedged = true;
    await until(() => kills.length > 0, 3_000);
    sup.stop();

    const lines = episodes(said);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", attrs: { outcome: "restarted", pid: 999 } });
    const order = said.map((s) => s.event);
    expect(order.indexOf(WEDGE_EPISODE)).toBeLessThan(
      order.indexOf("fieldd.native_supervisor.wedge_restart"),
    );
  });

  it("a link that drops mid-episode closes it as link-closed", async () => {
    const { said, logger } = recorder();
    const { link, sup } = rig({ logger, loopDelay: new FakeLoopDelay(), timings: PATIENT });
    link.up();
    link.wedged = true;
    await until(() => sup.state === "unresponsive");
    link.down();
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
