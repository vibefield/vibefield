// @vitest-environment node
/**
 * SP-1d — @'s rows in Chat (DESIGN.md §8 "Chat's composer", @'s rows in Chat; CH-D5 A, EW-D4): the agents the
 * spark's `agents_available` answers and the sessions its `agent_send` takes, by fieldd's whole rule, read bottom-up,
 * nearest first. Agent ids are the catalog's (R23b), never a literal; an agent is said by the catalog's label, as
 * `agents_available` says it.
 */
import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type AgentPersona,
  type AgentProfileSet,
  type SparkSummary,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  AT_WORDS,
  type AtSources,
  atDefaultHot,
  atMove,
  atRow,
  atRowsOf,
  atStops,
  sessionWord,
} from "../src/chat/at-rows";
import { CANNOT_LIST_AGENTS } from "../src/chat/new-spark";

const [A, B, C] = [AGENT_CATALOG[0], AGENT_CATALOG[1], AGENT_CATALOG[2]];
const AT = "2026-10-31T05:00:00.000Z";
const minute = (m: number) => new Date(Date.parse(AT) + m * 60_000).toISOString();

const persona = (
  profileId: string,
  provider: string,
  set: string,
  loggedIn = true,
): AgentPersona => ({
  profileId,
  provider,
  label: "Default",
  kind: set === "native" ? "native-default" : "managed",
  createdAt: AT,
  set,
  identity: { loggedIn, verifiedAt: AT },
});

const profile = (
  id: string,
  label: string,
  personas: AgentPersona[],
  kind: "native" | "managed" = "managed",
): AgentProfileSet => ({ id, kind, label, default: kind === "native", createdAt: AT, personas });

const NATIVE = profile(
  "native",
  "This Mac",
  [
    persona(`${A.id}:native-default`, A.id, "native"),
    persona(`${B.id}:native-default`, B.id, "native"),
    persona(`${C.id}:native-default`, C.id, "native", false),
  ],
  "native",
);
const WORK = profile("work", "Work", [persona("work-a", A.id, "work")]);
const HOME = profile("home", "Home", [persona("home-b", B.id, "home")]);
const SETS = [NATIVE, WORK, HOME];

const VELA: SparkSummary = {
  id: "sp-vela0001",
  name: "Vela",
  face: { seed: 7 },
  agent: A.id,
  profiles: ["native", "work"],
  thinksUnder: "native",
  folder: "/f/vela",
  createdAt: AT,
  updatedAt: AT,
  session: { runtimeRunId: "run-vela", terminalSessionId: "pty-vela", live: true },
};

function row(over: Partial<AgentFieldRow> & Pick<AgentFieldRow, "runtimeRunId">): AgentFieldRow {
  return {
    revision: 1,
    kind: A.id,
    label: A.label,
    tier: "managed",
    device: "dev-1",
    status: "idle",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    ...over,
  };
}

const ROWS: AgentFieldRow[] = [
  // his own, in This Mac's own folder (no persona named): Working, the newest activity
  row({
    runtimeRunId: "run-his-1",
    status: "working",
    project: { name: "vibe-field" },
    createdAt: minute(1),
    lastActivityAt: minute(30),
  }),
  // his own, under Work, in a folder of the same name, started later: its ordinal
  row({
    runtimeRunId: "run-his-2",
    profileId: "work-a",
    origin: { by: "you" },
    project: { name: "vibe-field" },
    createdAt: minute(2),
    lastActivityAt: minute(10),
  }),
  // one this spark started, blocked on the person
  row({
    runtimeRunId: "run-mine",
    kind: B.id,
    label: B.label,
    profileId: `${B.id}:native-default`,
    origin: { by: "spark", spark: "sp-vela0001" },
    status: "blocked",
    blockers: [{ id: "q", kind: "question", since: AT }],
    project: { name: "rosetta" },
    lastActivityAt: minute(20),
  }),
  // never rows: its own session, another spark's own, another spark's agent, a flow's run, a profile it lacks, an
  // ended run, an origin word this build does not know
  row({ runtimeRunId: "run-vela", spark: "sp-vela0001", project: { name: "vela" } }),
  row({ runtimeRunId: "run-lyra", spark: "sp-lyra0001", project: { name: "lyra" } }),
  row({
    runtimeRunId: "run-lyra-agent",
    origin: { by: "spark", spark: "sp-lyra0001" },
    project: { name: "x" },
  }),
  row({ runtimeRunId: "run-flow", origin: { by: "flow" }, project: { name: "x" } }),
  row({ runtimeRunId: "run-home", profileId: "home-b", project: { name: "x" } }),
  row({ runtimeRunId: "run-ended", alive: false, project: { name: "x" } }),
  row({ runtimeRunId: "run-odd", origin: { by: "someone" }, project: { name: "x" } }),
];

const sources = (over: Partial<AtSources> = {}): AtSources => ({
  spark: VELA,
  query: "",
  sets: SETS,
  rows: ROWS,
  ...over,
});

describe("@'s rows in Chat (DESIGN.md §8 \"Chat's composer\")", () => {
  it("starts the agents signed in under the spark's profiles, a row for each agent and profile (EW-D4)", () => {
    const list = atRowsOf(sources());
    expect(list.agents.map((r) => [r.agent, r.profile.id, r.pill])).toEqual([
      [A.id, "native", "This Mac"],
      [B.id, "native", "This Mac"],
      [A.id, "work", "Work"],
    ]);
    expect(list.agents.map((r) => r.label)).toEqual([A.label, B.label, A.label]);
    // the third agent is not signed in; Home's agent is in a profile the spark lacks
    expect(list.agents.some((r) => r.agent === C.id)).toBe(false);
    expect(list.agents.some((r) => r.profile.id === "home")).toBe(false);
  });

  it("says each agent by the catalog's label, as its agents_available does, and an id the catalog lacks by itself", () => {
    const unknown = "an-agent-the-catalog-lacks";
    const list = atRowsOf(
      sources({
        spark: { ...VELA, profiles: ["native"] },
        sets: [
          profile(
            "native",
            "This Mac",
            [
              persona(`${A.id}:native-default`, A.id, "native"),
              persona(`${unknown}:native-default`, unknown, "native"),
            ],
            "native",
          ),
        ],
      }),
    );
    expect(list.agents.map((r) => [r.agent, r.label])).toEqual([
      [A.id, A.label],
      [unknown, unknown],
    ]);
  });

  it("says the profile as a pill only when the spark has more than one", () => {
    const one = atRowsOf(sources({ spark: { ...VELA, profiles: ["native"] } }));
    expect(one.agents.map((r) => r.pill)).toEqual([null, null]);
  });

  it("offers the sessions its agent_send takes: his own and its own agents, in its profiles, live, never a spark's", () => {
    const list = atRowsOf(sources());
    expect(list.sessions.map((r) => r.session)).toEqual(["run-his-2", "run-mine", "run-his-1"]);
  });

  it("names two sessions of one name by their start, the first unnumbered, before the query filters", () => {
    const list = atRowsOf(sources());
    const handle = (id: string) => list.sessions.find((r) => r.session === id)?.handle;
    expect(handle("run-his-1")).toBe("vibe-field");
    expect(handle("run-his-2")).toBe("vibe-field·2");
    expect(list.sessions.find((r) => r.session === "run-his-2")?.project).toBe("vibe-field");
    // filtered to the second, it keeps its ordinal
    const filtered = atRowsOf(sources({ query: "vibe" }));
    expect(filtered.sessions.map((r) => r.handle)).toEqual(["vibe-field·2", "vibe-field"]);
  });

  it("names a session whose run names no folder by its agent's label, numbered as any other", () => {
    const bare = [
      row({ runtimeRunId: "run-bare-1", createdAt: minute(1), lastActivityAt: minute(5) }),
      row({ runtimeRunId: "run-bare-2", createdAt: minute(2), lastActivityAt: minute(4) }),
    ];
    const list = atRowsOf(sources({ rows: bare }));
    expect(list.sessions.map((r) => [r.session, r.handle, r.project])).toEqual([
      ["run-bare-2", `${A.label}·2`, null],
      ["run-bare-1", A.label, null],
    ]);
  });

  it("says each session's word: Working, Idle, Needs you", () => {
    const list = atRowsOf(sources());
    expect(list.sessions.map((r) => r.word)).toEqual(["Idle", "Needs you", "Working"]);
    expect(sessionWord(row({ runtimeRunId: "r", status: "unknown" }))).toBeNull();
  });

  it("reads sessions nearest, the newest activity nearest, then the agents above", () => {
    const list = atRowsOf(sources());
    const stops = atStops(list);
    expect(stops.at(-1)?.id).toBe("session:run-his-1");
    expect(stops[0]?.kind).toBe("agent");
    expect(atDefaultHot(list)).toBe("session:run-his-1");
  });

  it("filters both groups by what follows the @, and says Nothing called when nothing matches", () => {
    const rosetta = atRowsOf(sources({ query: "ROS" }));
    expect(rosetta.sessions.map((r) => r.handle)).toEqual(["rosetta"]);
    expect(rosetta.agents).toEqual([]);
    const agent = atRowsOf(sources({ query: A.label.slice(0, 3) }));
    expect(agent.agents.every((r) => r.label === A.label)).toBe(true);
    const none = atRowsOf(sources({ query: "zzz" }));
    expect(none.quiet).toBe('Nothing called "zzz"');
    expect(AT_WORDS.none("cla")).toBe('Nothing called "cla"');
  });

  it("says there is nothing to add when its profiles offer nothing at all", () => {
    const bare = atRowsOf(sources({ spark: { ...VELA, profiles: ["home"] }, rows: [] }));
    expect(bare.agents.map((r) => r.agent)).toEqual([B.id]);
    const empty = atRowsOf(
      sources({ sets: [profile("native", "This Mac", [], "native")], rows: [] }),
    );
    expect(empty.quiet).toBe("Nothing to add from Vela's profiles");
  });

  it("says the New spark sheet's words, and offers no row, when its profiles can't be read", () => {
    expect(AT_WORDS.failed).toBe(CANNOT_LIST_AGENTS);
    expect(CANNOT_LIST_AGENTS).toBe("VibeField can't list its agents right now");
    // with the board read or not: without its profiles no agent and no session can be placed
    for (const over of [{}, { rows: null }, { query: "vib" }]) {
      expect(atRowsOf(sources({ sets: "failed", ...over }))).toEqual({
        agents: [],
        sessions: [],
        reading: false,
        quiet: CANNOT_LIST_AGENTS,
      });
    }
  });

  it("says the same words, and offers no row, when the window's board can't be read (final critique 12)", () => {
    // its sessions are read off the board: with it refused, @ offers neither group, as with its profiles refused
    for (const over of [{}, { sets: null }, { query: "vib" }]) {
      expect(atRowsOf(sources({ rows: "failed", ...over }))).toEqual({
        agents: [],
        sessions: [],
        reading: false,
        quiet: CANNOT_LIST_AGENTS,
      });
    }
  });

  it("is reading until its profiles and the board are read, and offers nothing meanwhile", () => {
    for (const over of [{ sets: null }, { rows: null }]) {
      const list = atRowsOf(sources(over));
      expect(list).toEqual({ agents: [], sessions: [], reading: true, quiet: null });
    }
    expect(AT_WORDS.reading).toBe("Reading its agents…");
  });

  it("walks the stops with ↑ ↓, stopping at the ends", () => {
    const list = atRowsOf(sources());
    const hot = atDefaultHot(list);
    const up = atMove(list, hot, "up");
    expect(up).toBe("session:run-mine");
    expect(atMove(list, hot, "down")).toBe(hot);
    expect(atMove(list, "nothing", "up")).toBe(hot);
    expect(atRow(list, up)?.kind).toBe("session");
    let top = hot;
    for (let i = 0; i < 10; i++) top = atMove(list, top, "up");
    expect(top).toBe(atStops(list)[0]?.id);
  });
});
