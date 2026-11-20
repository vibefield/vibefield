import type { AgentModelSelection, AgentSessionOrigin } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { SparkStarts } from "../src/objects/spark-starts";
import {
  type SparkSpawnDeps,
  type SparkSpawnLaunch,
  sparkSpawn,
} from "../src/tool-plane/rooms/talk/spawn";

// The one spawn a spark's agents start by (the talk room's, and the needs-you queue's Allow one more): what it asks of
// the runtime, the crew member it records, and (item 550, 2026-11-18) the spark it remembers starting the run for,
// which is what puts that spark's printed star on the run's mark on the desk.

const SPARK = "sp-7k2m9q4x";
const CREW = { id: "cr-3n8w5t1v", sparkRun: "run-spark" };
const LAUNCH = { agent: "codex", profileSet: "native", cwd: "/work/vibe-field" };

function spawning() {
  const asked: { launch: SparkSpawnLaunch; origin: AgentSessionOrigin }[] = [];
  const members: unknown[][] = [];
  const starts = new SparkStarts();
  const deps: SparkSpawnDeps = {
    spawn: async (launch, origin) => {
      asked.push({ launch, origin });
      return { runtimeRunId: `run-${asked.length}` };
    },
    starts,
    crews: { started: (...args) => void members.push(args) },
  };
  return { spawn: sparkSpawn(deps), asked, members, starts };
}

describe("a spark's spawn", () => {
  it("starts the agent under the spark's origin with its crew, records the member, and remembers the spark it started the run for", async () => {
    const s = spawning();
    const model: AgentModelSelection = { modelId: "gpt-5" };
    await expect(s.spawn({ ...LAUNCH, model }, SPARK, CREW)).resolves.toEqual({
      runtimeRunId: "run-1",
    });
    expect(s.asked).toEqual([
      {
        launch: {
          provider: "codex",
          cwd: "/work/vibe-field",
          profileSet: "native",
          modelSelection: model,
        },
        origin: { by: "spark", spark: SPARK, crew: CREW.id },
      },
    ]);
    expect(s.members).toEqual([
      [SPARK, CREW, { runtimeRunId: "run-1", agent: "codex", folder: "vibe-field" }],
    ]);
    expect(s.starts.of("run-1")).toBe(SPARK);
  });

  it("joins no crew for a held spawn kept before crews, and still remembers whose run it is", async () => {
    const s = spawning();
    await s.spawn(LAUNCH, SPARK);
    expect(s.asked[0]?.origin).toEqual({ by: "spark", spark: SPARK });
    expect(s.asked[0]?.launch).not.toHaveProperty("modelSelection");
    expect(s.members).toEqual([]);
    expect(s.starts.of("run-1")).toBe(SPARK);
  });
});
