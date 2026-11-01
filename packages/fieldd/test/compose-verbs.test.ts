import {
  type AgentModelsResult,
  type AgentProfileSet,
  type AgentSessionSummary,
  type IndexSearchResult,
  type IndexTimelineResult,
  personaSetsOf,
  type SparkRecord,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { createComposeVerbs, type VerbDeps } from "../src/tool-plane/rooms/compose/verbs";

// CP-1b — the six read verbs, held to a spark's Agent Profiles (TL-D5, NS-D5). The v2 page's CP-1 witness, at the
// verbs' level: a session from another profile never shows, and nothing outside the profiles can be read or searched.
// TU-1 (Q3) places every session, live or in History, by the one rule (`profileSetOfRun`).

const SPARK: SparkRecord = {
  format: 1,
  id: "sp-7k2m9q4x",
  name: "Vela",
  face: { seed: 7 },
  agent: "claude",
  profiles: ["work", "native"],
  thinksUnder: "work",
  folder: "/f/sparks/vela",
  createdAt: "2026-10-29T11:00:00.000Z",
  updatedAt: "2026-10-29T11:00:00.000Z",
};

const persona = (
  provider: string,
  profileId: string,
  runtimeId: string | undefined,
  loggedIn = true,
) => ({
  profileId,
  provider,
  label: provider,
  kind: "managed" as const,
  createdAt: "2026-10-01T00:00:00.000Z",
  identity: { loggedIn, verifiedAt: "2026-10-01T00:00:00.000Z" },
  ...(runtimeId ? { runtimeId } : {}),
});
const set = (
  id: string,
  label: string,
  personas: ReturnType<typeof persona>[],
): AgentProfileSet => ({
  id,
  kind: id === "native" ? "native" : "managed",
  label,
  default: id === "native",
  createdAt: "2026-10-01T00:00:00.000Z",
  personas,
});
const SETS = [
  set("native", "This Mac", [persona("claude", "claude:native-default", "rt-native-claude")]),
  set("work", "Work", [
    persona("claude", "claude:work", "rt-work-claude"),
    persona("grok", "grok:work", "rt-work-grok"),
    persona("codex", "codex:work", undefined, false),
  ]),
  set("home", "Home", [persona("claude", "claude:home", "rt-home-claude")]),
];

const row = (
  id: string,
  profileSet: string | undefined,
  extra: Partial<AgentSessionSummary> = {},
) =>
  ({
    sessionId: `native-${id}`,
    kind: "claude",
    label: "Claude Code",
    device: "dev-1",
    tier: "managed",
    runtimeRunId: id,
    runtimeEpoch: 1,
    ...(profileSet ? { profileSet } : {}),
    status: "working",
    observationLevel: "native-hooks",
    createdAt: "2026-10-29T10:00:00.000Z",
    stateChangedAt: "2026-10-29T10:00:00.000Z",
    workspace: { mode: "direct", root: `/code/${id}` },
    ...extra,
  }) as AgentSessionSummary;

const RUNS = [
  row("run-work", "work", { origin: { by: "spark", spark: "sp-7k2m9q4x" } }),
  row("run-native", undefined, {
    status: "blocked",
    monitor: { blockers: [{ id: "b", kind: "permission", since: "x" }] } as never,
  }),
  row("run-home", "home"),
  row("run-remote", "work", { tier: "remote" }),
  row("run-ended", "work", { continuation: { persisted: true, resumable: true, exited: true } }),
];

function deps(over: Partial<VerbDeps> = {}) {
  const searched: string[] = [];
  const d: VerbDeps = {
    profileSets: async () => SETS,
    personaSets: () => personaSetsOf(SETS),
    agentLabel: (p) => ({ claude: "Claude Code", grok: "Grok", codex: "Codex" })[p],
    models: async (provider) => {
      if (provider === "grok") throw new Error("grok could not list");
      return {
        provider,
        refreshing: false,
        catalog: {
          provider,
          cwd: "/",
          observedAt: "x",
          source: { kind: "native", freshness: "fresh" },
          completeness: "complete",
          customModels: false,
          models: [
            {
              id: "claude-opus-5-5",
              label: "Opus 5.5",
              controls: [
                {
                  id: "effort",
                  label: "Effort",
                  role: "effort",
                  values: [{ id: "high", label: "High" }],
                },
              ],
            },
          ],
        },
      } as AgentModelsResult;
    },
    runs: () => RUNS,
    runFacts: (id) => (id === "run-work" ? { usd: 0.31, effort: "high" } : undefined),
    projects: () => [{ key: "pk-1", name: "vibe-field", folders: ["/code/vibe-field"] }],
    indexSessionFor: async (nativeId) => `ix-${nativeId}`,
    indexSessionProfile: async (sessionId) => ({
      profileId: sessionId.includes("home") ? "claude:home" : "claude:work",
    }),
    timeline: async (sessionId): Promise<IndexTimelineResult> => ({
      sessionId,
      nextCursor: "older-1",
      clipped: false,
      watermark: "w",
      entries: [
        {
          timelineId: "t3",
          sessionId,
          ordinal: 3,
          kind: "agent",
          text: "y".repeat(5000),
          group: { id: "g", kind: "turn" },
        },
        {
          timelineId: "t1",
          sessionId,
          ordinal: 1,
          kind: "user",
          text: "Research ACP.",
          at: 10,
          group: { id: "g", kind: "turn" },
        },
        {
          timelineId: "t2",
          sessionId,
          ordinal: 2,
          kind: "tool_use",
          text: "ls",
          group: { id: "g", kind: "turn" },
        },
      ],
    }),
    search: async (_q, runtimeId): Promise<IndexSearchResult> => {
      searched.push(runtimeId);
      return {
        answered: true,
        state: { readiness: "ready" },
        hits: [
          {
            sessionId: `s-${runtimeId}`,
            timelineId: "t",
            kind: "user",
            snippet: `[acp] from ${runtimeId}`,
            at: runtimeId === "rt-work-claude" ? 300 : 200,
            provider: "claude",
          },
        ],
      } as IndexSearchResult;
    },
    ...over,
  };
  return { verbs: createComposeVerbs(d), searched };
}

describe("the read verbs, held to a spark's profiles (CP-1b; TL-D5)", () => {
  it("agents_list: never a session from another profile, never another desktop's, ended ones only when asked", async () => {
    const { verbs } = deps();
    const live = await verbs.agents_list(SPARK, {});
    expect(live.sessions.map((s) => s.id)).toEqual(["run-work", "run-native"]);
    expect(live.sessions[0]).toMatchObject({
      state: "working",
      profile: "work",
      usd: 0.31,
      effort: "high",
      origin: { by: "spark" },
    });
    expect(live.sessions[1]).toMatchObject({
      state: "asking",
      asking: "permission",
      profile: "native",
    });
    const all = await verbs.agents_list(SPARK, { ended: true });
    expect(all.sessions.map((s) => s.id)).toEqual(["run-work", "run-native", "run-ended"]);
    expect(all.sessions[2]?.state).toBe("ended");
  });

  it("agent_read: the latest turns, oldest first, each bounded; refuses a session outside the profiles", async () => {
    const { verbs } = deps();
    const read = await verbs.agent_read(SPARK, { session: "run-work" });
    expect(read.session).toBe("run-work");
    expect(read.turns.map((t) => t.who)).toEqual(["user", "agent"]);
    expect(read.turns[1]).toMatchObject({ cut: true });
    expect(read.turns[1]?.text).toHaveLength(4000);
    expect(read.before).toBe("older-1");
    await expect(verbs.agent_read(SPARK, { session: "run-home" })).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
    });
    await expect(verbs.agent_read(SPARK, { session: "run-nope" })).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
  });

  it("history_search: one search per runtime under the profiles, merged by time, nothing from another profile", async () => {
    const { verbs, searched } = deps();
    const out = await verbs.history_search(SPARK, { query: "acp" });
    expect(searched.sort()).toEqual(["rt-native-claude", "rt-work-claude", "rt-work-grok"]);
    expect(out.answered).toBe(true);
    expect(out.hits[0]).toMatchObject({ session: "s-rt-work-claude", profile: "work" });
    expect(out.hits.some((h) => h.session.includes("home"))).toBe(false);
    const grok = deps();
    await grok.verbs.history_search(SPARK, { query: "acp", agent: "grok" });
    expect(grok.searched).toEqual(["rt-work-grok"]);
  });

  it("history_read: a session filed under another profile is refused", async () => {
    const { verbs } = deps();
    await expect(verbs.history_read(SPARK, { session: "ix-home-1" })).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
    });
    expect((await verbs.history_read(SPARK, { session: "ix-work-1" })).turns).toHaveLength(2);
  });

  it("agents_available: the agents signed in under its profiles, with their models and efforts", async () => {
    const { verbs } = deps();
    const out = await verbs.agents_available(SPARK, {});
    expect(out.agents.map((a) => `${a.profile}:${a.agent}`)).toEqual([
      "native:claude",
      "work:claude",
      "work:grok",
    ]);
    expect(out.agents[0]?.models[0]).toEqual({
      id: "claude-opus-5-5",
      label: "Opus 5.5",
      efforts: ["high"],
    });
    expect(out.agents[2]).toMatchObject({
      models: [],
      modelsNote: "Grok could not list its models just now.",
    });
  });

  it("projects_list: the projects and their folders here", async () => {
    const { verbs } = deps();
    expect(await verbs.projects_list(SPARK, {})).toEqual({
      projects: [{ key: "pk-1", name: "vibe-field", folders: ["/code/vibe-field"] }],
    });
  });
});

describe("the read verbs place a session by the one rule (TU-1, Q3)", () => {
  const MINE: SparkRecord = { ...SPARK, profiles: ["native"], thinksUnder: "native" };
  const WORK: SparkRecord = { ...SPARK, profiles: ["work"], thinksUnder: "work" };
  // filed under none: its persona listed by Work; a persona no profile lists
  const PERSONA_RUNS = [
    ...RUNS,
    row("run-persona", undefined, { profileId: "claude:work" }),
    row("run-orphan", undefined, { profileId: "claude:gone" }),
  ];
  const listed = async (verbs: ReturnType<typeof deps>["verbs"], spark: SparkRecord) =>
    (await verbs.agents_list(spark, {})).sessions.map((s) => `${s.id}:${s.profile}`);

  it("lists a session filed under none under the profile listing its persona, and a persona no profile lists under none", async () => {
    const { verbs } = deps({ runs: () => PERSONA_RUNS });
    expect(await listed(verbs, MINE)).toEqual(["run-native:native"]);
    expect(await listed(verbs, WORK)).toEqual(["run-work:work", "run-persona:work"]);
    await expect(verbs.agent_read(MINE, { session: "run-orphan" })).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
    });
    await expect(verbs.agent_read(MINE, { session: "run-persona" })).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
    });
    expect((await verbs.agent_read(WORK, { session: "run-persona" })).session).toBe("run-persona");
  });

  it("fails closed until the profiles are read (§12 Q1 (a′)): a persona's session filed under none is listed nowhere, and read is refused retryably", async () => {
    const { verbs } = deps({ runs: () => PERSONA_RUNS, personaSets: () => null });
    expect(await listed(verbs, MINE)).toEqual(["run-native:native"]);
    expect(await listed(verbs, WORK)).toEqual(["run-work:work"]);
    for (const caller of [MINE, WORK])
      await expect(verbs.agent_read(caller, { session: "run-persona" })).rejects.toMatchObject({
        kind: "UNAVAILABLE",
        retryable: true,
      });
  });

  it("history_read places a History session by its persona, as before: no persona is This Mac's, a persona no profile lists is in none", async () => {
    const { verbs } = deps({
      indexSessionProfile: async (sessionId) =>
        sessionId === "ix-mine" ? {} : { profileId: "claude:gone" },
    });
    expect((await verbs.history_read(MINE, { session: "ix-mine" })).turns).toHaveLength(2);
    await expect(verbs.history_read(SPARK, { session: "ix-gone" })).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
    });
  });
});
