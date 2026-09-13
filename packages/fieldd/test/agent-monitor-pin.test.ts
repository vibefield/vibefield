import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_MONITOR_SCHEMA_VERSION as UPSTREAM_MONITOR_SCHEMA_VERSION } from "@vibecook/puppeteer-core";
import { AGENT_MONITOR_SCHEMA_VERSION, AgentMonitorMirror } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";

// The monitor generation pin, gated against the PINNED puppeteer itself (AR-4b;
// the AR-3 ledger claimed "a generation bump upstream is a red gate here" while
// nothing in the tree read the upstream constant — this is the gate that makes
// the claim true). A bump of `AGENT_MONITOR_SCHEMA_VERSION` at the pinned
// revision fails here until the contract's mirror is re-read against the new
// shape, the golden regenerated and the contract's constant moved — the
// deliberate event, never a silent drift. A field rename WITHOUT a generation
// bump is not caught here: the mirror is a passthrough by law, and drift in
// the fields fieldd reads surfaces as `fieldd.agents.monitor_shape_drift`.

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../contracts/fixtures/agent-monitor-state.valid.json",
);

describe("the monitor schema pin against the pinned puppeteer", () => {
  it("the contract's generation IS puppeteer's, and the golden is of that generation", () => {
    expect(AGENT_MONITOR_SCHEMA_VERSION).toBe(UPSTREAM_MONITOR_SCHEMA_VERSION);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as { schemaVersion: number };
    expect(golden.schemaVersion).toBe(UPSTREAM_MONITOR_SCHEMA_VERSION);
    expect(AgentMonitorMirror.safeParse(golden).success).toBe(true);
  });
});
