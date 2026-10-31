import {
  AGENT_CATALOG,
  type AgentModelChoice,
  type AgentModelsResult,
  type AgentProfileSet,
  type AgentProviderSummary,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  agentLine,
  agentMenuOf,
  CANNOT_TAKE_TOOLS,
  dealSeed,
  defaultProfileOf,
  effortOf,
  listWords,
  profileChipsOf,
  reachOf,
  refusalOf,
  STAR_NAMES,
  sessionsSeenOf,
  sparkAgentsOf,
  startsOf,
  suggestName,
} from "../src/chat/new-spark";
import { FIXTURE_NATIVE, FIXTURE_WORK } from "../src/design-system/profiles-fixtures";

// The New spark sheet's model (SP-1c; DESIGN.md §8 "The New spark sheet"): what it suggests, which agents can be a
// spark, the agent menu and its Effort, the profiles row and its reach, and where a refusal is said. Agent ids are the
// catalog's (R23b), never a literal.

const [FIRST, SECOND, THIRD] = [AGENT_CATALOG[0], AGENT_CATALOG[1], AGENT_CATALOG[2]];

const provider = (
  entry: { readonly id: string; readonly label: string },
  briefing?: AgentProviderSummary["briefing"],
): AgentProviderSummary => ({
  id: entry.id,
  label: entry.label,
  available: true,
  resumable: true,
  personas: [],
  ...(briefing === undefined ? {} : { briefing }),
});

const BRIEFED = { mcpServers: true, allowTools: true, instructions: true } as const;

const EFFORT_MODEL: AgentModelChoice = {
  id: "deep",
  label: "Deep",
  controls: [
    {
      id: "effort",
      label: "Effort",
      role: "effort",
      values: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
      defaultValue: "low",
    },
  ],
};

const answer = (models: AgentModelChoice[]): AgentModelsResult => ({
  provider: FIRST.id,
  profileSet: "native",
  catalog: {
    provider: FIRST.id,
    cwd: "/fixture",
    observedAt: "2026-10-31T09:00:00.000Z",
    source: { kind: "native-protocol", freshness: "live" },
    completeness: "complete",
    customModels: false,
    models,
  },
  refreshing: false,
});

describe("the name it suggests", () => {
  it("is the first star name no spark holds, without regard to case, then a numbered spark", () => {
    expect(suggestName([])).toBe(STAR_NAMES[0]);
    expect(suggestName(["polaris", "Capella"])).toBe("Altair");
    expect(suggestName([...STAR_NAMES])).toBe(`Spark ${STAR_NAMES.length + 1}`);
  });

  it("deals a face in the engine's 32-bit range", () => {
    expect(dealSeed(() => 0)).toBe(0);
    expect(dealSeed(() => 0.999_999_999_9)).toBe(0xffff_ffff);
    expect(Number.isInteger(dealSeed())).toBe(true);
  });
});

describe("the agents a spark can think with", () => {
  it("are the agents that declare all three briefing fields and a process the door can name", () => {
    const agents = sparkAgentsOf([
      provider(FIRST, { ...BRIEFED, mcpServerProcess: "terminal" }),
      provider(SECOND, { ...BRIEFED, mcpServerProcess: "app-server" }),
      provider(THIRD),
    ]);
    expect(agents).toEqual([
      { id: FIRST.id, label: FIRST.label, takes: true },
      { id: SECOND.id, label: SECOND.label, takes: false, why: CANNOT_TAKE_TOOLS },
      { id: THIRD.id, label: THIRD.label, takes: false, why: CANNOT_TAKE_TOOLS },
    ]);
    // a field missing claims no support
    expect(
      sparkAgentsOf([
        provider(FIRST, { mcpServers: true, allowTools: true, mcpServerProcess: "terminal" }),
      ])[0]?.takes,
    ).toBe(false);
  });

  it("says the agent alone until a model is chosen, then the model and its effort", () => {
    const [agent] = sparkAgentsOf([provider(FIRST, { ...BRIEFED, mcpServerProcess: "terminal" })]);
    expect(agentLine(agent, undefined, undefined)).toBe(FIRST.label);
    expect(agentLine(agent, EFFORT_MODEL, { modelId: "deep" })).toBe(`${FIRST.label} · Deep`);
    expect(agentLine(agent, EFFORT_MODEL, { modelId: "deep", controls: { effort: "high" } })).toBe(
      `${FIRST.label} · Deep · High`,
    );
    expect(agentLine(undefined, undefined, undefined)).toBe("No agent can be a spark yet");
  });
});

describe("the agent menu", () => {
  const agents = sparkAgentsOf([
    provider(FIRST, { ...BRIEFED, mcpServerProcess: "terminal" }),
    provider(THIRD),
  ]);

  it("heads every agent, and under the chosen one lists its own model first, then its picker's", () => {
    const menu = agentMenuOf(
      agents,
      FIRST.id,
      { state: "read", answer: answer([EFFORT_MODEL]) },
      undefined,
    );
    expect(menu).toEqual([
      { kind: "agent", agent: agents[0] },
      { kind: "model", id: null, label: "Its own model", on: true },
      { kind: "model", id: "deep", label: "Deep", on: false },
      { kind: "agent", agent: agents[1] },
    ]);
    const chosen = agentMenuOf(
      agents,
      FIRST.id,
      { state: "read", answer: answer([EFFORT_MODEL]) },
      { modelId: "deep" },
      "Work",
    );
    expect(chosen[0]).toEqual({ kind: "agent", agent: agents[0], under: "Work" });
    expect(chosen.filter((row) => row.kind === "model").map((row) => row.on)).toEqual([
      false,
      true,
    ]);
  });

  it("says a word in the picker's place while it is read, when it failed, and when it found none", () => {
    const note = (picker: Parameters<typeof agentMenuOf>[2]) =>
      agentMenuOf(agents, FIRST.id, picker, undefined).find((row) => row.kind === "note");
    expect(note({ state: "reading" })).toEqual({
      kind: "note",
      words: `Reading ${FIRST.label}'s models…`,
    });
    expect(note(undefined)).toEqual({ kind: "note", words: `Reading ${FIRST.label}'s models…` });
    expect(note({ state: "failed", words: "fieldd is restarting" })).toEqual({
      kind: "note",
      words: "fieldd is restarting",
    });
    const none: AgentModelsResult = {
      provider: FIRST.id,
      failure: {
        status: "auth-required",
        code: "auth-required",
        message: "Sign in to discover models.",
        at: "x",
      },
      refreshing: false,
    };
    expect(note({ state: "read", answer: none })).toEqual({
      kind: "note",
      words: "Sign in to discover models.",
    });
  });

  it("offers a chosen model's Effort, its default marked until one is chosen; none while it thinks at its own", () => {
    expect(effortOf(EFFORT_MODEL, undefined)).toBeUndefined();
    expect(effortOf(undefined, { modelId: "deep" })).toBeUndefined();
    expect(effortOf(EFFORT_MODEL, { modelId: "deep" })).toEqual({
      label: "Effort",
      values: [
        { id: "low", label: "Low", on: true },
        { id: "high", label: "High", on: false },
      ],
    });
    expect(
      effortOf(EFFORT_MODEL, { modelId: "deep", controls: { effort: "high" } })?.values.map(
        (v) => v.on,
      ),
    ).toEqual([false, true]);
  });
});

describe("its profiles (NS-D5)", () => {
  const sets: AgentProfileSet[] = [FIXTURE_NATIVE, FIXTURE_WORK];

  it("defaults to the profile marked default, else the first", () => {
    expect(defaultProfileOf(sets)?.id).toBe(FIXTURE_NATIVE.id);
    expect(defaultProfileOf([{ ...FIXTURE_WORK, default: false }])?.id).toBe(FIXTURE_WORK.id);
    expect(defaultProfileOf([])).toBeUndefined();
  });

  it("keeps the one it thinks under checked and locked", () => {
    expect(profileChipsOf(sets, [], FIXTURE_NATIVE.id)).toEqual([
      { id: FIXTURE_NATIVE.id, label: FIXTURE_NATIVE.label, checked: true, home: true },
      { id: FIXTURE_WORK.id, label: FIXTURE_WORK.label, checked: false, home: false },
    ]);
  });

  it("starts the agents signed in under its profiles, each once, by the agent's label", () => {
    const agents = sparkAgentsOf(AGENT_CATALOG.map((entry) => provider(entry)));
    const starts = startsOf(sets, [FIXTURE_WORK.id], FIXTURE_NATIVE.id, agents);
    const signedIn = [
      ...new Set(
        sets.flatMap((set) =>
          set.personas.filter((p) => p.identity?.loggedIn === true).map((p) => p.provider),
        ),
      ),
    ];
    expect(starts).toHaveLength(signedIn.length);
    expect(new Set(starts).size).toBe(starts.length);
    expect(startsOf([], [], undefined, agents)).toEqual([]);
  });

  it("sees its profiles' personas' sessions, and a native profile's agents' own folders too; nothing before the board", () => {
    const nativeFirst = FIXTURE_NATIVE.personas[0]?.profileId ?? "";
    const workFirst = FIXTURE_WORK.personas[0]?.profileId ?? "";
    const tally = new Map<string | null, number>([
      [null, 2],
      [nativeFirst, 1],
      [workFirst, 3],
      ["a-profile-of-no-chosen-set", 5],
    ]);
    expect(sessionsSeenOf(null, sets, [FIXTURE_NATIVE.id])).toBeNull();
    expect(sessionsSeenOf(tally, sets, [FIXTURE_NATIVE.id])).toBe(3);
    expect(sessionsSeenOf(tally, sets, [FIXTURE_WORK.id])).toBe(3);
    expect(sessionsSeenOf(tally, sets, [FIXTURE_NATIVE.id, FIXTURE_WORK.id])).toBe(6);
    expect(sessionsSeenOf(tally, sets, [])).toBe(0);
  });

  it("says how many sessions it sees and what it starts, and only what it starts before the board is read", () => {
    expect(reachOf(3, ["Claude Code", "Codex"])).toBe(
      "Sees 3 sessions · starts Claude Code and Codex",
    );
    expect(reachOf(1, ["Claude Code"])).toBe("Sees 1 session · starts Claude Code");
    expect(reachOf(null, ["Claude Code"])).toBe("Starts Claude Code");
    expect(reachOf(0, [])).toBe(
      "Sees 0 sessions · starts no agent yet: none of these profiles holds a sign-in",
    );
    expect(listWords(["A", "B", "C"])).toBe("A, B and C");
    expect(listWords([])).toBe("");
  });
});

describe("a refusal (DESIGN.md §8)", () => {
  const refused = (reason: string) =>
    Object.assign(new Error(`fieldd: ${reason}`), { details: { reason } });

  it("is said where the sheet asked: the name, the agent, the profiles, else the foot in fieldd's words", () => {
    expect(refusalOf(refused("name-taken"), { name: "Vela" })).toEqual({
      at: "name",
      words: "Vela is taken",
    });
    expect(
      refusalOf(refused("no-sign-in"), { name: "Vela", agent: FIRST.label, profile: "Work" }),
    ).toEqual({ at: "agent", words: `Work has no ${FIRST.label} sign-in` });
    expect(refusalOf(refused("unknown-profile"), { name: "Vela" })).toEqual({
      at: "profiles",
      words: "That profile is gone",
    });
    expect(refusalOf(new Error("the door is closed"), { name: "Vela" })).toEqual({
      at: "foot",
      words: "the door is closed",
    });
  });
});
