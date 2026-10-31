import type {
  AgentModelsResult,
  AgentProfileSet,
  AgentSessionSummary,
  IndexSearchResult,
  IndexTimelineResult,
  SparkRecord,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { createComposeVerbs, type VerbDeps } from "../src/tool-plane/rooms/compose/verbs";

// CP-1b — the six read verbs, held to a spark's Agent Profiles (TL-D5, NS-D5). The v2 page's CP-1 witness, at the
// verbs' level: a session from another profile never shows, and nothing outside the profiles can be read or searched.

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
