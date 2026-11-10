// Q17's seam (2026-11-10): what `endLive` hands `endTypedRun`, read by identity. A test may
// hand the signal a typed run's end sends (`agentGateway.kill` → `typedKill`); none handed, the deps
// carry no `kill`, and `endTypedRun` takes its own default, `process.kill`: the one place fieldd's
// end of a typed run reaches the system. Nothing here calls a kill, a table or a watch.
// item 537 (2026-11-18, EL7): the table read is the runtime's own (`ps` under the agents' allow-list
// snapshot, or a test's table), which `endLive` hands in; the deps carry it as handed.
import { describe, expect, it, vi } from "vitest";
import { typedEndDeps } from "../src/agent-runtime";

describe("typedEndDeps — what endLive hands endTypedRun (Q17's seam)", () => {
  it("hands no kill when none was given, so endTypedRun's own default is the one that runs", () => {
    const table = vi.fn(async () => undefined);
    const deps = typedEndDeps({}, table, 4001);
    expect("kill" in deps, "no kill key: endTypedRun's `deps.kill ?? process.kill`").toBe(false);
    expect(deps.readTable, "the runtime's one table read, as handed").toBe(table);
    expect(deps.shellPid).toBe(4001);
    expect(table).not.toHaveBeenCalled();
  });

  it("hands the kill and the table a test gave, by identity, and calls neither", () => {
    const kill = vi.fn();
    const table = vi.fn(async () => undefined);
    const deps = typedEndDeps({ typedKill: kill }, table, undefined);
    expect(deps.kill).toBe(kill);
    expect(deps.readTable).toBe(table);
    expect(deps.shellPid).toBeUndefined();
    expect(kill).not.toHaveBeenCalled();
    expect(table).not.toHaveBeenCalled();
  });
});
