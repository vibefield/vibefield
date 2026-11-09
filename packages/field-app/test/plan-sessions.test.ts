/**
 * The plan filter's join (UM-5a, UM-D14; DESIGN.md §8 "Godview's profiles column"): which plan a session spends, read
 * from what every run already says, its Agent Profile SET and its agent (a set holds one account per agent, so the
 * pair names the persona). Pure: the stage (`GodviewMonitor`, `useMonitorAgents`) and the Peek read it, and the phone's
 * port (`PlanSessions.swift`) is held to the same answers by the usage bands golden.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentHolding,
  type AgentPersona,
  type AgentPlan,
  type AgentProfileSet,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { planMeters } from "../src/usage/meters";
import {
  planChoice,
  planFamily,
  planKeyOfRun,
  planRunSet,
  planRuns,
  runRecedes,
} from "../src/usage/plan-sessions";

const here = dirname(fileURLToPath(import.meta.url));
const SETS = (
  JSON.parse(
    readFileSync(join(here, "../../contracts/fixtures/agents-profile-sets.meters.json"), "utf8"),
  ) as { sets: AgentProfileSet[] }
).sets;

const KIMI_PERSONA = "e9b3c5a7-2d14-4f6e-8a0b-3c7f1e5d9a62";
const WORK_CLAUDE = "7c2e9a41-3b5d-4f08-9e6a-1d4c8b2f5a73";

const AT = "2026-11-09T00:00:00.000Z";
const SERVICE = { id: "anthropic", label: "Anthropic" };

const persona = (
  profileId: string,
  provider: string,
  holds?: readonly AgentHolding[],
): AgentPersona => ({
  profileId,
  provider,
  label: provider,
  kind: "managed",
  createdAt: AT,
  ...(holds === undefined ? {} : { holds: [...holds] }),
});
const plan = (id: string, holders: readonly string[], extra: Partial<AgentPlan> = {}): AgentPlan => ({
  id,
  service: SERVICE,
  holders: [...holders],
  alsoIn: [],
  ...extra,
});
const holding = (over: Partial<AgentHolding>): AgentHolding => ({
  service: SERVICE,
  key: false,
  runsOn: true,
  ...over,
});
const setOf = (
  id: string,
  personas: readonly AgentPersona[],
  plans: readonly AgentPlan[] = [],
): AgentProfileSet => ({
  id,
  kind: "managed",
  label: id,
  default: false,
  createdAt: AT,
  personas: [...personas],
  plans: [...plans],
});

describe("which plan a run spends (`planKeyOfRun`)", () => {
  it("joins the run's set and agent to the plan its sign-in runs on, as the union keys it", () => {
    expect(planKeyOfRun(SETS, { profileSet: "native", provider: "claude" })).toBe(
      "native/plan:anthropic",
    );
    expect(planKeyOfRun(SETS, { profileSet: "work", provider: "claude" })).toBe(
      "work/plan:anthropic",
    );
    expect(planKeyOfRun(SETS, { profileSet: "side", provider: "claude" })).toBe(
      "side/plan:anthropic",
    );
  });

  it("an agent on no plan joins its own meter row, by the agent's one id on every seam", () => {
    const row = AGENT_CATALOG.find((entry) => entry.id === "kimi");
    const provider = row?.seams.puppeteer?.provider;
    expect(provider).toBeDefined();
    expect(planKeyOfRun(SETS, { profileSet: "work", provider })).toBe(
      `work/agent:${KIMI_PERSONA}`,
    );
  });

  it("joins nothing for a set with no such agent, an unknown set, or a run with no agent (a terminal)", () => {
    expect(planKeyOfRun(SETS, { profileSet: "native", provider: "kimi" })).toBeUndefined();
    expect(planKeyOfRun(SETS, { profileSet: "gone", provider: "claude" })).toBeUndefined();
    expect(planKeyOfRun(SETS, { profileSet: "work", provider: undefined })).toBeUndefined();
    expect(planKeyOfRun(SETS, { profileSet: undefined, provider: "claude" })).toBeUndefined();
  });

  it("a present runsOn holding decides over the plans' holders", () => {
    const sets = [
      setOf(
        "s",
        [persona("p", "claude", [holding({ planId: "b" })])],
        [plan("a", ["p"]), plan("b", [])],
      ),
    ];
    expect(planKeyOfRun(sets, { profileSet: "s", provider: "claude" })).toBe("s/plan:b");
  });

  it("a key run beside a subscription sign-in spends no plan: it is pay per use", () => {
    const sets = [
      setOf(
        "s",
        [
          persona("p", "claude", [
            holding({ key: true }),
            holding({ planId: "a", runsOn: false }),
          ]),
        ],
        [plan("a", ["p"])],
      ),
    ];
    expect(planKeyOfRun(sets, { profileSet: "s", provider: "claude" })).toBeUndefined();
    expect(planRuns(sets, "s/plan:a")).toBe("");
  });

  it("a key-only persona joins its own meter row", () => {
    const sets = [setOf("s", [persona("p", "claude", [holding({ key: true })])])];
    expect(planKeyOfRun(sets, { profileSet: "s", provider: "claude" })).toBe("s/agent:p");
  });

  it("with no holds at all (an older daemon, the tolerant reader), the plan whose holders has it, then its row", () => {
    const sets = [setOf("s", [persona("p", "claude"), persona("q", "codex")], [plan("a", ["p"])])];
    expect(planKeyOfRun(sets, { profileSet: "s", provider: "claude" })).toBe("s/plan:a");
    expect(planKeyOfRun(sets, { profileSet: "s", provider: "codex" })).toBe("s/agent:q");
  });
});

describe("a plan's family and its runs", () => {
  it("native's and work's Anthropic are one account, its twins; side's is another", () => {
    expect(planFamily(SETS, "native/plan:anthropic")).toEqual([
      "native/plan:anthropic",
      "work/plan:anthropic",
    ]);
    expect(planFamily(SETS, "work/plan:anthropic")).toEqual([
      "native/plan:anthropic",
      "work/plan:anthropic",
    ]);
    expect(planFamily(SETS, "side/plan:anthropic")).toEqual(["side/plan:anthropic"]);
  });

  it("an agent's row and a plan with nothing to share are their own family", () => {
    const key = `work/agent:${KIMI_PERSONA}`;
    expect(planFamily(SETS, key)).toEqual([key]);
    const sets = [setOf("s", [persona("p", "claude")], [plan("a", ["p"])])];
    expect(planFamily(sets, "s/plan:a")).toEqual(["s/plan:a"]);
  });

  it("`planRuns` names every run on the family, the same string for cloned sets (it reaches the stage by value)", () => {
    const runs = planRuns(SETS, "work/plan:anthropic");
    expect(runs).toBe("native\u0000claude\nwork\u0000claude");
    expect(planRuns(structuredClone(SETS), "work/plan:anthropic")).toBe(runs);
    expect(planRuns(SETS, "side/plan:anthropic")).toBe("side\u0000claude");
  });
});

describe("the choice as the stage reads it (`planChoice`)", () => {
  it("is the meter model's own title and agent, the family and the runs", () => {
    const work = SETS.find((set) => set.id === "work") as AgentProfileSet;
    const entry = planMeters(work, [], new Date(0)).entries.find(
      (each) => each.key === "plan:anthropic",
    );
    const choice = planChoice(SETS, "work/plan:anthropic");
    expect(choice).toEqual({
      key: "work/plan:anthropic",
      label: entry?.title,
      provider: entry?.provider,
      family: ["native/plan:anthropic", "work/plan:anthropic"],
      runs: "native\u0000claude\nwork\u0000claude",
    });
  });

  it("names an agent's row too, and of a key gone from the feed, nothing (no token, no filter)", () => {
    expect(planChoice(SETS, `work/agent:${KIMI_PERSONA}`)?.family).toEqual([
      `work/agent:${KIMI_PERSONA}`,
    ]);
    expect(planChoice(SETS, "work/plan:gone")).toBeUndefined();
    expect(planChoice(SETS, "gone/plan:anthropic")).toBeUndefined();
    expect(planChoice(SETS, `work/agent:${WORK_CLAUDE}`)).toBeUndefined();
  });
});

describe("what recedes (`runRecedes`, the live row's and the ended lane's one predicate)", () => {
  const runs = planRunSet("native\u0000claude\nwork\u0000claude");
  const self = (profileSet: string | undefined, provider: string | undefined) => ({
    self: true,
    profileSet,
    provider,
  });

  it("nothing chosen: nothing recedes", () => {
    expect(runRecedes({}, self("work", "claude"))).toBe(false);
    expect(runRecedes({}, { self: false, profileSet: undefined, provider: undefined })).toBe(false);
  });

  it("a lens keeps its own desktop's runs under it, and a terminal under it stays", () => {
    expect(runRecedes({ profile: "work" }, self("work", "claude"))).toBe(false);
    expect(runRecedes({ profile: "work" }, self("work", undefined))).toBe(false);
    expect(runRecedes({ profile: "work" }, self("native", "claude"))).toBe(true);
    expect(runRecedes({ profile: "work" }, self(undefined, undefined))).toBe(true);
    expect(runRecedes({ profile: "work" }, { ...self("work", "claude"), self: false })).toBe(true);
  });

  it("a plan keeps the runs on it and recedes the rest, a peer's and a terminal's too", () => {
    expect(runRecedes({ planRuns: runs }, self("work", "claude"))).toBe(false);
    expect(runRecedes({ planRuns: runs }, self("native", "claude"))).toBe(false);
    expect(runRecedes({ planRuns: runs }, self("work", "codex"))).toBe(true);
    expect(runRecedes({ planRuns: runs }, self("side", "claude"))).toBe(true);
    expect(runRecedes({ planRuns: runs }, self("work", undefined))).toBe(true);
    expect(runRecedes({ planRuns: runs }, { ...self("work", "claude"), self: false })).toBe(true);
  });

  it("both must keep it", () => {
    const both = { profile: "work", planRuns: runs };
    expect(runRecedes(both, self("work", "claude"))).toBe(false);
    expect(runRecedes(both, self("native", "claude"))).toBe(true);
    expect(runRecedes(both, self("work", "codex"))).toBe(true);
  });
});
