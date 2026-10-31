import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentSessionRecord, AgentSessionSummary } from "../src/agent-session";
import { ComposeSparksHatchParams, SparkRecord, SparkSummary } from "../src/compose";
import { METHODS } from "../src/methods";

// CO — the compose plane, version 2 (ruled 2026-10-29; draft/compose-plane/v2/). What these hold: the window's spark
// doors are local agents.manage rows; a spark thinks under one of its own profiles; and a run's origin is read the way
// spawnedBy is, OPEN. The verb catalog moved to tools.ts in MT-0 (2026-10-30), and its lint to tools.test.ts.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

describe("the window's spark doors (CP-0)", () => {
  it("are local agents.manage rows, as the other doors that start agents for the person here", () => {
    for (const m of ["compose.sparks.list", "compose.sparks.hatch", "compose.sparks.open"]) {
      const row = METHODS.find((r) => r.method === m);
      expect(row?.scope, m).toBe("agents.manage");
      expect(row?.locality, m).toBe("local");
    }
  });
});

describe("a spark (NS-D1, NS-D2 B, NS-D5)", () => {
  const params = ComposeSparksHatchParams.parse(fixture("compose-sparks-hatch-params.valid"));

  it("thinks under one of its own profiles, in the sheet and in the record", () => {
    expect(params.profiles).toContain(params.thinksUnder);
    expect(ComposeSparksHatchParams.safeParse({ ...params, thinksUnder: "home" }).success).toBe(
      false,
    );
    const record = SparkRecord.parse(fixture("compose-spark-record.valid"));
    expect(SparkRecord.safeParse({ ...record, thinksUnder: "home" }).success).toBe(false);
  });

  it("works in at least one profile", () => {
    expect(ComposeSparksHatchParams.safeParse({ ...params, profiles: [] }).success).toBe(false);
  });

  it("carries its face apart from its name, as a seed the engine draws", () => {
    expect(params.face.seed).toBeGreaterThanOrEqual(0);
    expect(ComposeSparksHatchParams.safeParse({ ...params, face: { seed: -1 } }).success).toBe(
      false,
    );
    expect(ComposeSparksHatchParams.safeParse({ ...params, face: { seed: 2 ** 32 } }).success).toBe(
      false,
    );
    expect(
      ComposeSparksHatchParams.parse({ ...params, face: { seed: 7, engine: 2 } }).face,
    ).toMatchObject({ seed: 7, engine: 2 });
  });

  it("is named on one line, with no blank ends", () => {
    for (const name of ["", " Vela", "Vela ", "x".repeat(33)])
      expect(ComposeSparksHatchParams.safeParse({ ...params, name }).success, name).toBe(false);
    expect(ComposeSparksHatchParams.safeParse({ ...params, name: "Vela 2" }).success).toBe(true);
  });

  it("answers the window with whether its session is awake", () => {
    const summary = SparkSummary.parse({
      ...params,
      id: "sp-7k2m9q4x",
      folder: "/f",
      createdAt: "2026-10-29T11:02:10.118Z",
      updatedAt: "2026-10-29T11:02:10.118Z",
      session: { runtimeRunId: "run-12", live: false },
    });
    expect(summary.session?.live).toBe(false);
  });
});

describe("a run's origin (CP-D15)", () => {
  it("names the spark that started a run, and the spark a session is", () => {
    const started = AgentSessionRecord.parse(fixture("agent-session-record.spark-started"));
    expect(started.origin).toEqual({ by: "spark", spark: "sp-7k2m9q4x" });
    expect(started.spark).toBeUndefined();
    const own = AgentSessionRecord.parse(fixture("agent-session-record.spark"));
    expect(own.spark).toBe("sp-7k2m9q4x");
    expect(own.origin?.by).toBe("you");
    const row = AgentSessionSummary.parse(fixture("agent-session-summary.spark"));
    expect(row.origin?.spark).toBe("sp-7k2m9q4x");
  });

  it("is OPEN: a word this build never heard of still reads, and absent reads as before", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.spark"));
    expect(AgentSessionRecord.safeParse({ ...record, origin: { by: "phone" } }).success).toBe(true);
    const { origin: _o, spark: _s, ...before } = record;
    expect(AgentSessionRecord.safeParse(before).success).toBe(true);
    expect(AgentSessionRecord.safeParse({ ...record, spark: "Vela" }).success).toBe(false);
  });
});
