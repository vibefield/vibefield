import {
  ShellSurfacesControlRefusalFact,
  SURFACE_AUTHORITY_LIMITS,
  TOOL_FACTS,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  ACT_LEASE_MS_PROPOSED,
  BRIDGE_REFUSAL_FACT,
  BRIDGE_REFUSALS,
  WINDOW_CLOSE_FACT,
  WINDOW_CLOSERS,
} from "../src/main/pages/core/types";

// EY-1 (2026-11-19): the bridge's shared shapes, held to the control call they answer through.

describe("the bridge's shared shapes (EY-1)", () => {
  it("maps every bridge refusal and window closer to a control fact or to none, each one of TOOL_FACTS", () => {
    expect(Object.keys(BRIDGE_REFUSAL_FACT).sort()).toEqual([...BRIDGE_REFUSALS].sort());
    expect(Object.keys(WINDOW_CLOSE_FACT).sort()).toEqual([...WINDOW_CLOSERS].sort());
    const facts: readonly string[] = TOOL_FACTS;
    for (const fact of [
      ...Object.values(BRIDGE_REFUSAL_FACT),
      ...Object.values(WINDOW_CLOSE_FACT),
    ]) {
      if (fact !== null) expect(facts).toContain(fact);
    }
    // a window's closer answers through the control result's own refusal facts
    const controlFacts: readonly string[] = ShellSurfacesControlRefusalFact.options;
    for (const fact of Object.values(WINDOW_CLOSE_FACT)) {
      if (fact !== null) expect(controlFacts).toContain(fact);
    }
  });

  it("proposes an act lease under the control call's deadline", () => {
    expect(ACT_LEASE_MS_PROPOSED).toBeLessThan(SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS);
  });

  it("never says no-window: that word is the door's, for the app's window", () => {
    const refusals: readonly string[] = BRIDGE_REFUSALS;
    expect(refusals).not.toContain("no-window");
    expect(refusals).toContain("outside-window");
  });
});
