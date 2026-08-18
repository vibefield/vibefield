// NativeSupervisor unit rows (terminal-custody TC-D1/TC-D2, slice TC-S1),
// against a scripted link: the state machine is exercised through the same
// events the real NativeLink emits, with injected fast timings. State
// SEQUENCES are the assertions — never wall-clock precision, which this
// loaded host would flake.
import { EventEmitter } from "node:events";
import type { PingAck } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { NativeLink } from "../src/native-link";
import { RpcCallError } from "../src/native-link";
import { type NativeSupervisionTimings, NativeSupervisor } from "../src/native-supervisor";

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

class FakeLink extends EventEmitter {
  connected = false;
  wedged = false;
  dialNow(): void {}
  async ping(_deadlineMs: number): Promise<PingAck> {
    if (this.wedged) throw new RpcCallError("TIMEOUT", "mgmt request exceeded its deadline", true);
    return { bootId: "fake-native-boot", ts: Date.now() };
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

function rig(opts?: { spawner?: boolean; probeAlive?: boolean }): Rig {
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
    timings: T,
  });
  return { link, sup, spawns, kills, alive };
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
