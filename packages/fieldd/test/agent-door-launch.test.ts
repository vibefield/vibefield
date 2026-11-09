// Item 124 — a birth whose executable takes no door (`agent-door-launch.ts`): refused for the door, the birth is made
// once more with no briefing, its facts written; a second refusal surfaces as the launch's own, and nothing loops.
import { createNoopLogger } from "@vibefield/logging";
import type { AgentRunBriefing } from "@vibefield/puppeteer-core";
import { describe, expect, it } from "vitest";
import {
  birthWithDoor,
  carriesDoor,
  doorRefusalCode,
  type HelperRootFloor,
  RunHelperRoots,
  refusedTheDoor,
  UNSUPPORTED_LAUNCH_FIELD,
  withHelperProcess,
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

describe("a run's helper process, named to the floor (OB-3d)", () => {
  function floor(answer: () => Promise<unknown> = async () => ({ startedAtMs: 1 })) {
    const calls: unknown[] = [];
    return {
      calls,
      set: async (rootId: string, pid: number) => {
        calls.push(["set", rootId, pid]);
        return answer();
      },
      clear: async (rootId: string) => {
        calls.push(["clear", rootId]);
        return { cleared: true };
      },
    };
  }
  const logged = () => {
    const warned: string[] = [];
    const logger = {
      ...createNoopLogger(),
      warn: (event: string) => void warned.push(event),
      child: () => logger,
    };
    return { logger: logger as ReturnType<typeof createNoopLogger>, warned };
  };

  it("adds the hook beside what the ingress already says, and an adapter that never calls it holds no root", () => {
    const onBound = () => undefined;
    const hook = async () => undefined;
    const ingress = withHelperProcess({ onBound }, hook) as {
      onBound: unknown;
      onHelperProcess: unknown;
    };
    expect(ingress.onBound).toBe(onBound);
    expect(ingress.onHelperProcess).toBe(hook);
    const roots = new RunHelperRoots({ floor: floor(), logger: createNoopLogger() });
    roots.announce("attempt-1");
    expect(roots.birth("attempt-1")).toBeUndefined();
  });

  it("names each attempt's helper to the floor before it answers, keyed to the attempt", async () => {
    const f = floor();
    const roots = new RunHelperRoots({ floor: f, logger: createNoopLogger() });
    await roots.announce("attempt-1")({ pid: 4242, startedAtMs: 7 });
    await roots.announce("attempt-2", "sp-7k2m9q4x")({ pid: 4243, startedAtMs: 8 });
    expect(f.calls).toEqual([
      ["set", "attempt-1", 4242],
      ["set", "attempt-2", 4243],
    ]);
    expect(roots.birth("attempt-1")).toEqual({ entering: true });
    expect(roots.birth("attempt-2")).toEqual({ entering: true, spark: "sp-7k2m9q4x" });
  });

  it("never fails the launch: a floor that refuses or is down leaves a run with no root, and says so", async () => {
    const { logger, warned } = logged();
    const refusing = new RunHelperRoots({
      floor: floor(() => Promise.reject(new Error("pid-held"))),
      logger,
    });
    await expect(
      refusing.announce("attempt-1")({ pid: 1, startedAtMs: 0 }),
    ).resolves.toBeUndefined();
    expect(refusing.birth("attempt-1")).toBeUndefined();
    expect(warned).toEqual(["fieldd.agents.helper_root_refused"]);

    const noFloor = new RunHelperRoots({ logger });
    await expect(
      noFloor.announce("attempt-2")({ pid: 1, startedAtMs: 0 }),
    ).resolves.toBeUndefined();
    expect(warned).toEqual([
      "fieldd.agents.helper_root_refused",
      "fieldd.agents.helper_root_refused",
    ]);
  });

  // puppeteer refuses a launch whose hook throws or rejects (`announceRunHelper`), and Codex fires it on every run,
  // briefed or not, so a plain launch would be refused for the door's sake
  it("never rejects on the ingress, whatever the floor does and however its line fails to write", async () => {
    const helper = { pid: 4242, startedAtMs: 7 };
    const throwing = () => {
      throw new Error("the log is gone");
    };
    const floors: [string, HelperRootFloor][] = [
      ["refuses", floor(() => Promise.reject(new Error("pid-unreadable")))],
      ["down", floor(() => Promise.reject(new Error("NOT_CONNECTED")))],
      ["rejects with nothing", floor(() => Promise.reject(undefined))],
      ["throws at the call", { set: throwing, clear: async () => undefined }],
    ];
    for (const [label, f] of floors) {
      for (const logger of [
        createNoopLogger(),
        { ...createNoopLogger(), warn: throwing } as ReturnType<typeof createNoopLogger>,
      ]) {
        const roots = new RunHelperRoots({ floor: f, logger });
        const ingress = withHelperProcess({}, roots.announce("attempt-1")) as {
          onHelperProcess: (h: typeof helper) => Promise<void>;
        };
        await expect(ingress.onHelperProcess(helper), label).resolves.toBeUndefined();
        expect(roots.birth("attempt-1"), label).toBeUndefined();
      }
    }
  });

  it("clears a root the floor holds when its run ends, once, and asks nothing of a run that has none", async () => {
    const f = floor();
    const roots = new RunHelperRoots({ floor: f, logger: createNoopLogger() });
    await roots.announce("attempt-1")({ pid: 4242, startedAtMs: 7 });
    roots.end("attempt-1");
    roots.end("attempt-1");
    roots.end("attempt-never-named");
    expect(f.calls).toEqual([
      ["set", "attempt-1", 4242],
      ["clear", "attempt-1"],
    ]);
    expect(roots.birth("attempt-1")).toBeUndefined();
  });

  it("logs a clear the floor did not hear, and the run's end goes on", async () => {
    const { logger, warned } = logged();
    const f = {
      ...floor(),
      clear: () => Promise.reject(new Error("the floor is down")),
    };
    const roots = new RunHelperRoots({ floor: f, logger });
    await roots.announce("attempt-1")({ pid: 4242, startedAtMs: 7 });
    expect(() => roots.end("attempt-1")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warned).toEqual(["fieldd.agents.helper_root_clear_failed"]);
  });
});

describe("a birth whose executable takes no door (item 124)", () => {
  // OB-3d review: a person with their own `[mcp_servers.vibefield]` is refused at Codex's preflight, and every spawn or
  // resume of theirs would otherwise fail. A door must never fail a person's launch.
  it("treats a person's own conflicting server as a refused door: the birth goes ahead without it", async () => {
    const CONFLICT = {
      ...REFUSED,
      error: { ...REFUSED.error, refusal: { code: "CONFLICTING_LAUNCH_FIELD" } },
    };
    expect(refusedTheDoor(CONFLICT)).toBe(true);
    expect(doorRefusalCode(CONFLICT)).toBe("CONFLICTING_LAUNCH_FIELD");
    expect(doorRefusalCode(REFUSED)).toBe(UNSUPPORTED_LAUNCH_FIELD);
    const { briefed, launch } = launcher(CONFLICT, BORN);
    const birth = await birthWithDoor(DOOR, launch, refusedTheDoor, (_refusal, again) => again());
    expect(birth).toEqual({ born: BORN, withheld: true });
    expect(briefed).toEqual([DOOR, {}]);
    // anything else an adapter refuses stays the launch's own
    const other = { ...REFUSED, error: { ...REFUSED.error, refusal: { code: "NOT_INSTALLED" } } };
    expect(refusedTheDoor(other)).toBe(false);
    expect(doorRefusalCode(other)).toBeUndefined();
  });

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
