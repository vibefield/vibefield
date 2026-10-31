// Item 124 — a birth whose executable takes no door (`agent-door-launch.ts`): refused for the door, the birth is made
// once more with no briefing, its facts written; a second refusal surfaces as the launch's own, and nothing loops.
import type { AgentRunBriefing } from "@vibefield/puppeteer-core";
import { describe, expect, it } from "vitest";
import {
  birthWithDoor,
  carriesDoor,
  refusedTheDoor,
  UNSUPPORTED_LAUNCH_FIELD,
} from "../src/agent-door-launch";
import { type SummarizeInput, summarizeManaged } from "../src/agent-sessions";

const DOOR: AgentRunBriefing = {
  mcpServers: { vibefield: { command: "/floor/door", args: ["--bridge"] } },
  allowTools: ["vibefield/history_search"],
};

/** puppeteer's refusal of a launch field, as a spawn answers it (AGENT_LAUNCH_REFUSED + the adapter's code). */
const REFUSED = {
  runtimeRunId: "run-1",
  error: {
    code: "AGENT_LAUNCH_REFUSED",
    message: "This Claude executable does not support launch field: mcpServers.",
    refusal: { code: UNSUPPORTED_LAUNCH_FIELD },
  },
};
const BORN = { info: { runtimeRunId: "run-2" } };

/** A launcher the test scripts: each attempt's briefing kept, its answers in order. */
function launcher(...answers: unknown[]) {
  const briefed: AgentRunBriefing[] = [];
  return {
    briefed,
    launch: async (briefing: AgentRunBriefing): Promise<unknown> => {
      briefed.push(briefing);
      return answers[briefed.length - 1];
    },
  };
}

describe("a birth whose executable takes no door (item 124)", () => {
  it("is made once more with no briefing, its refusal heard and the second attempt wrapped", async () => {
    const { briefed, launch } = launcher(REFUSED, BORN);
    const heard: unknown[] = [];
    const birth = await birthWithDoor(DOOR, launch, refusedTheDoor, async (refusal, again) => {
      heard.push(refusal);
      return again();
    });
    expect(birth).toEqual({ born: BORN, withheld: true });
    expect(briefed).toEqual([DOOR, {}]);
    expect(heard).toEqual([REFUSED]);
  });

  it("surfaces a second refusal as the launch's own, and never loops", async () => {
    const { briefed, launch } = launcher(REFUSED, REFUSED, BORN);
    const birth = await birthWithDoor(DOOR, launch, refusedTheDoor, (_refusal, again) => again());
    expect(birth).toEqual({ born: REFUSED, withheld: true });
    expect(briefed).toHaveLength(2);
  });

  it("leaves every other answer alone: a birth, another refusal, or an unbriefed launch refused", async () => {
    const never = async (): Promise<unknown> => {
      throw new Error("withheld a door that was not refused");
    };
    for (const answer of [
      BORN,
      { ...REFUSED, error: { ...REFUSED.error, refusal: { code: "INVALID_MODEL_SELECTION" } } },
      { ...REFUSED, error: { code: "AGENT_NOT_FOUND", message: "no such agent" } },
    ]) {
      const { briefed, launch } = launcher(answer);
      const birth = await birthWithDoor(DOOR, launch, refusedTheDoor, never);
      expect(birth).toEqual({ born: answer, withheld: false });
      expect(briefed).toEqual([DOOR]);
    }
    // a launch that carried no door has none to withhold: its refusal is its own
    const { briefed, launch } = launcher(REFUSED);
    expect(await birthWithDoor({}, launch, refusedTheDoor, never)).toEqual({
      born: REFUSED,
      withheld: false,
    });
    expect(briefed).toEqual([{}]);
  });

  it("reads the refusal by its codes, never its words, and a door by any briefing field", () => {
    expect(refusedTheDoor(REFUSED)).toBe(true);
    expect(
      refusedTheDoor({ error: { code: "AGENT_LAUNCH_REFUSED", message: REFUSED.error.message } }),
    ).toBe(false);
    expect(refusedTheDoor(null)).toBe(false);
    expect(carriesDoor(DOOR)).toBe(true);
    expect(carriesDoor({ instructions: "You are Vela." })).toBe(true);
    expect(carriesDoor({})).toBe(false);
  });
});

describe("the fold's row says so (item 124: `door: off`, a fact of this process)", () => {
  // the run as puppeteer reports it, at the depth the summary reads
  const info = {
    nativeSession: { id: "native-24", basis: "configured" },
    provider: { id: "claude", label: "Claude Code" },
    runtimeRunId: "run-24",
    runtimeEpoch: 1,
    terminalSessionId: "sess-24",
    workspace: { mode: "direct", root: "/w", sourcePath: "/w" },
  } as unknown as SummarizeInput["info"];
  const input: SummarizeInput = {
    info,
    monitor: undefined,
    observationLevel: "native-hooks",
    device: "dev-1",
    terminal: undefined,
    hosted: true,
    record: { persisted: true, resumable: false },
    createdAt: "2026-10-31T06:00:00.000Z",
    stateChangedAt: "2026-10-31T06:00:00.000Z",
  };

  it("carries the door's word for a birth that withheld it, and nothing for one that did not", () => {
    expect(summarizeManaged({ ...input, door: "off" }).door).toBe("off");
    expect(Object.keys(summarizeManaged(input))).not.toContain("door");
  });
});
