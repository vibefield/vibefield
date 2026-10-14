// DEBTS (s-debts-fieldd.md Appendix 3) — the real-floor births' retry
// (agent-birth.ts), over a scripted door: what it asks again, what it never
// does, and its budget.
import { describe, expect, it } from "vitest";
import { born, retryableBirthRefusal } from "./agent-birth";
import type { RpcErrorShape } from "./ws-rpc";

const refusal = (data: RpcErrorShape["data"], message = "refused") =>
  Object.assign(new Error(message), { rpc: { code: -32006, message, data } });
const FLOOR_ABSENT = {
  kind: "UNAVAILABLE",
  retryable: true,
  details: { service: "terminal", state: "absent" },
};

/** A door that answers its script in order, then the last line for ever. */
function door(script: Array<Error | unknown>) {
  const asked: string[] = [];
  return {
    asked,
    call: async (method: string) => {
      asked.push(method);
      const next = script.length > 1 ? script.shift() : script[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe("born — a real-floor birth asked again while the floor is not there yet", () => {
  it("asks again after `the terminal floor is not available`, and says so", async () => {
    const lines: string[] = [];
    const rpc = door([
      refusal(FLOOR_ABSENT, "the terminal floor is not available"),
      refusal(FLOOR_ABSENT, "the terminal floor is not available"),
      { session: { runtimeRunId: "run-1" } },
    ]);
    const answer = await born(rpc, "agent.spawn", { provider: "scripted" }, 5_000, {
      pauseMs: 1,
      warn: (line) => lines.push(line),
    });
    expect(answer).toEqual({ session: { runtimeRunId: "run-1" } });
    expect(rpc.asked).toEqual(["agent.spawn", "agent.spawn", "agent.spawn"]);
    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toBe("agent.spawn was born on attempt 3");
  });

  it("never asks again for a run already born, nor for any other refusal", async () => {
    // a run born whose ticket could not be minted: a second ask is a second agent
    const bornWithoutTicket = refusal({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "terminal", state: "grants_not_landed", runtimeRunId: "run-1" },
    });
    for (const error of [
      bornWithoutTicket,
      refusal({ kind: "UNAVAILABLE", retryable: false, details: { state: "absent" } }),
      refusal({ kind: "PRECONDITION_FAILED", retryable: false, details: { reason: "not-here" } }),
      new Error("socket closed"),
    ]) {
      const rpc = door([error, { ok: true }]);
      await expect(
        born(rpc, "agent.resume", {}, 5_000, { pauseMs: 1, warn: () => {} }),
      ).rejects.toBe(error);
      expect(rpc.asked).toHaveLength(1);
    }
    expect(retryableBirthRefusal((bornWithoutTicket as { rpc: RpcErrorShape }).rpc)).toBe(false);
  });

  it("throws the last refusal once the row's budget is spent", async () => {
    let clock = 0;
    const absent = refusal(FLOOR_ABSENT);
    const rpc = door([absent]);
    const asking = born(rpc, "agent.spawn", {}, 1_000, {
      pauseMs: 1,
      now: () => (clock += 400),
      warn: () => {},
    });
    await expect(asking).rejects.toBe(absent);
    // the deadline is 1,400 on the row's clock; after each ask it reads 800,
    // 1,200, then 1,600 — spent
    expect(rpc.asked).toHaveLength(3);
  });
});
