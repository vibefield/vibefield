import { describe, expect, it } from "vitest";
import { FLOOR_INTERRUPT_KEY, stopKeyOf } from "../src/agent-sessions";

// Q08 (ruled C, per agent) — the key the stop verb presses is the run's
// adapter's word, repeated: fieldd names no agent and picks no key of its own,
// except the floor's ⌃C, which it still sends while an adapter names no stop
// (and then says so, rather than naming nothing).

describe("Q08 — the key the stop verb presses for a run", () => {
  it("is the adapter's key, none for the agent's own control, and the floor's ⌃C while the adapter names no stop", () => {
    expect(stopKeyOf({ kind: "key", key: "escape" })).toBe("escape");
    expect(stopKeyOf({ kind: "key", key: "ctrl-c" })).toBe("ctrl-c");
    expect(stopKeyOf({ kind: "native" })).toBeUndefined();
    expect(stopKeyOf(undefined)).toBe(FLOOR_INTERRUPT_KEY);
    expect(FLOOR_INTERRUPT_KEY).toBe("ctrl-c");
  });
});
