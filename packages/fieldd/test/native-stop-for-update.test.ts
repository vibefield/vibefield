// WP12 L2b (`build-wp12-updater.md` §9 R2; the PM's ruling 2026-10-15 12:20Z) — `NativeSupervisor.stopForUpdate`,
// against a scripted link: ONE function, in this order — suppress respawn → prepareRestart → shutdown → a bounded
// wait for the management socket to close → the kill ladder only if this fieldd holds a pid and the wait passed.
// The ADOPTED case (no pid) is the update path's by construction: no ladder, and the socket closing is the witness.
// The real floor's half is the kill matrix's rows WP12-R2a/R2b.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { NativeLink } from "../src/native-link";
import { NativeSupervisor } from "../src/native-supervisor";

/** A link that records each request, and closes its socket when the floor is asked to stop — unless told the floor
 * will not go. */
class FakeLink extends EventEmitter {
  connected = true;
  readonly asked: string[] = [];
  floorGoes = true;
  failPrepare = false;
  dialNow(): void {}
  async ping(): Promise<{ bootId: string; ts: number }> {
    return { bootId: "fake-native-boot", ts: Date.now() };
  }
  async request(method: string, _params: unknown): Promise<unknown> {
    this.asked.push(method);
    if (method === "native.lifecycle.prepareRestart") {
      if (this.failPrepare) throw new Error("the floor could not record");
      return { recorded: true };
    }
    if (method === "native.lifecycle.shutdown") {
      if (this.floorGoes) setTimeout(() => this.close(), 5);
      return { stopping: true };
    }
    throw new Error(`unexpected ${method}`);
  }
  close(): void {
    if (!this.connected) return;
    this.connected = false;
    this.emit("reconnecting", 0);
  }
}

function rig(opts: { pid?: number; dieOn?: NodeJS.Signals } = {}) {
  const link = new FakeLink();
  const kills: Array<{ pid: number; signal: string }> = [];
  const spawns: number[] = [];
  const sup = new NativeSupervisor({
    link: link as unknown as NativeLink,
    probeAlive: () => Promise.resolve(false),
    spawnNative: () => {
      spawns.push(1);
      return 2000;
    },
    killNative: (pid, signal) => {
      kills.push({ pid, signal });
      if (signal === opts.dieOn) link.close();
      return true;
    },
    ...(opts.pid === undefined ? {} : { nativePid: opts.pid }),
  });
  link.emit("connected");
  return { link, sup, kills, spawns };
}

const FAST = { closeWaitMs: 60, rungMs: 40 };

describe("NativeSupervisor.stopForUpdate (WP12 L2b)", () => {
  it("an ADOPTED floor (no pid): prepareRestart, then shutdown; the socket closing is the witness; no ladder", async () => {
    const { link, sup, kills, spawns } = rig();
    await expect(sup.stopForUpdate({ reason: "update", toVersion: "0.9.0" }, FAST)).resolves.toBe(
      "closed",
    );
    expect(link.asked).toEqual(["native.lifecycle.prepareRestart", "native.lifecycle.shutdown"]);
    expect(kills).toEqual([]);
    expect(sup.state).toBe("gone");
    // respawn stays suppressed: the closed socket's redials never become a spawn
    link.emit("reconnecting", 0);
    link.emit("reconnecting", 0);
    link.emit("reconnecting", 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(spawns).toEqual([]);
  });

  it("an ADOPTED floor that does not close is reported lingering — never signalled", async () => {
    const { link, sup, kills } = rig();
    link.floorGoes = false;
    await expect(sup.stopForUpdate({ reason: "update" }, FAST)).resolves.toBe("lingering");
    expect(kills).toEqual([]);
  });

  it("a SPAWNED floor that does not close meets the ladder only after the wait: TERM, then KILL", async () => {
    const { link, sup, kills } = rig({ pid: 4242 });
    link.floorGoes = false;
    await expect(sup.stopForUpdate({ reason: "update" }, FAST)).resolves.toBe("forced");
    expect(link.asked).toEqual(["native.lifecycle.prepareRestart", "native.lifecycle.shutdown"]);
    expect(kills).toEqual([
      { pid: 4242, signal: "SIGTERM" },
      { pid: 4242, signal: "SIGKILL" },
    ]);
  });

  it("a SPAWNED floor that goes at TERM never sees KILL", async () => {
    const { link, sup, kills } = rig({ pid: 4242, dieOn: "SIGTERM" });
    link.floorGoes = false;
    await expect(sup.stopForUpdate({ reason: "update" }, FAST)).resolves.toBe("forced");
    expect(kills).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
  });

  it("a SPAWNED floor that closes in time is never signalled at all", async () => {
    const { sup, kills } = rig({ pid: 4242 });
    await expect(sup.stopForUpdate({ reason: "update" }, FAST)).resolves.toBe("closed");
    expect(kills).toEqual([]);
  });

  it("a floor that cannot record its intent is still stopped (its next boot reads unplanned)", async () => {
    const { link, sup } = rig();
    link.failPrepare = true;
    await expect(sup.stopForUpdate({ reason: "update" }, FAST)).resolves.toBe("closed");
    expect(link.asked).toEqual(["native.lifecycle.prepareRestart", "native.lifecycle.shutdown"]);
  });
});
