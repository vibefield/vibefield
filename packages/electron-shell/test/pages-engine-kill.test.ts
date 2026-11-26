import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { EngineChild } from "../src/main/pages/broker/engine-supervisor";
import { PAGES_DAEMON_KILL_FLAG, pagesDaemonKillAsked } from "../src/main/pages/broker/index";
import { createPagesEngineKill } from "../src/testing/pages-engine-kill";

// EY-1 (1e, 2026-11-19): the testing engine kill, on fake children: nothing is signalled here. A
// real engine is killed only in 1i's daemon-kill cases, on the test Mac.

class FakeChild extends EventEmitter implements EngineChild {
  readonly signals: string[] = [];
  constructor(readonly pid: number) {
    super();
  }
  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signals.push(signal);
    return true;
  }
}

describe("the testing engine kill (1i's daemon-kill)", () => {
  it("is asked only in a smoke run whose command line carries its flag", () => {
    const mark = { VF_SMOKE_RUN: "smoke-1" };
    expect(pagesDaemonKillAsked({}, ["electron", "."])).toBe(false);
    expect(pagesDaemonKillAsked(mark, ["electron", "."])).toBe(false);
    expect(pagesDaemonKillAsked({}, ["electron", PAGES_DAEMON_KILL_FLAG])).toBe(false);
    expect(pagesDaemonKillAsked({ VF_SMOKE_RUN: "" }, [PAGES_DAEMON_KILL_FLAG])).toBe(false);
    expect(pagesDaemonKillAsked(mark, ["electron", ".", PAGES_DAEMON_KILL_FLAG])).toBe(true);
  });

  it("signals the run's own held child, and no other", () => {
    const kill = createPagesEngineKill();
    const a = new FakeChild(101);
    const b = new FakeChild(202);
    kill.onSpawned("run-1", 1, a);
    kill.onSpawned("run-2", 1, b);
    expect(kill.killEngine("run-1", "SIGKILL")).not.toBeNull();
    expect(a.signals).toEqual(["SIGKILL"]);
    expect(b.signals).toEqual([]);
  });

  it("names the child by a salted hash of its pid, never the pid", () => {
    const kill = createPagesEngineKill({ salt: () => "salt-1" });
    kill.onSpawned("run-1", 1, new FakeChild(4242));
    const answer = kill.killEngine("run-1", "SIGTERM");
    expect(Object.keys(answer ?? {})).toEqual(["pidHash"]);
    expect(answer?.pidHash).toBe(createHash("sha256").update("salt-1:4242").digest("hex"));
    expect(answer?.pidHash).not.toBe(createHash("sha256").update("4242").digest("hex"));
  });

  it("holds the run's newest child until its exit, and then answers null", () => {
    const kill = createPagesEngineKill();
    const first = new FakeChild(1);
    const second = new FakeChild(2);
    kill.onSpawned("run-1", 1, first);
    kill.onSpawned("run-1", 2, second);
    first.emit("exit", 0, null);
    expect(kill.killEngine("run-1", "SIGTERM")).not.toBeNull();
    expect(first.signals).toEqual([]);
    expect(second.signals).toEqual(["SIGTERM"]);
    second.emit("exit", null, "SIGTERM");
    expect(kill.killEngine("run-1", "SIGKILL")).toBeNull();
    expect(kill.killEngine("run-9", "SIGKILL")).toBeNull();
    expect(second.signals).toEqual(["SIGTERM"]);
  });
});
