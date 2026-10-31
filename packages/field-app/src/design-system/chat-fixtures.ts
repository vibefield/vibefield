import { AGENT_CATALOG, type AgentFieldRow, type SparkSummary } from "@vibefield/contracts";
import { sparkEntriesOf } from "../chat/spark-status";
import type { SparksReading } from "../chat/sparks-feed";
import { FIXTURE_SPARKS } from "./spark-fixtures";

// Chat's fixture ADAPTER (SP-1b; docs/UI_SYSTEM.md): what fieldd would answer — the sparks it keeps and the field
// board's rows — run through the PRODUCT's own reading (`sparkEntriesOf`), so the catalog draws what the window
// would, never a copy of its words. Fixed seeds (`spark-fixtures.ts`) and a fixed clock, so every plate deals the
// same faces and says the same times.

/** The catalog's clock: a Saturday morning, 9:41 local. */
export const FIXTURE_NOW = new Date(2026, 9, 31, 9, 41).getTime();

const minutesAgo = (minutes: number): string =>
  new Date(FIXTURE_NOW - minutes * 60_000).toISOString();

const seedOf = (name: string): number =>
  FIXTURE_SPARKS.find((spark) => spark.name === name)?.seed ?? 0;

/** The agent the fixture sparks think with: the catalog's first, never a literal id (R23b). */
const AGENT = AGENT_CATALOG[0];

function spark(id: string, name: string, session: SparkSummary["session"]): SparkSummary {
  return {
    id,
    name,
    face: { seed: seedOf(name) },
    agent: AGENT.id,
    profiles: ["this-mac"],
    thinksUnder: "this-mac",
    folder: `/fixture/sparks/${name.toLowerCase()}`,
    createdAt: minutesAgo(60 * 24 * 3),
    updatedAt: minutesAgo(60 * 24 * 3),
    ...(session === undefined ? {} : { session }),
  };
}

function row(over: Partial<AgentFieldRow> & Pick<AgentFieldRow, "runtimeRunId">): AgentFieldRow {
  return {
    revision: 1,
    kind: AGENT.id,
    label: AGENT.label,
    tier: "managed",
    device: "dev-fixture",
    status: "idle",
    statusSince: minutesAgo(5),
    stateChangedAt: minutesAgo(5),
    createdAt: minutesAgo(90),
    alive: true,
    blockers: [],
    ...over,
  };
}

const live = (runtimeRunId: string) => ({ runtimeRunId, live: true });

/** Four sparks, one in each of the words the board can say today. */
const SPARKS: readonly SparkSummary[] = [
  spark("sp-vela0001", "Vela", live("run-vela")),
  spark("sp-lyra0001", "Lyra", live("run-lyra")),
  spark("sp-juno0001", "Juno", live("run-juno")),
  spark("sp-kiwi0001", "Kiwi", { runtimeRunId: "run-kiwi", live: false }),
];

const ROWS: readonly AgentFieldRow[] = [
  // Vela asks you a question: Asking you, in the attention ink, its dot orange
  row({
    runtimeRunId: "run-vela",
    spark: "sp-vela0001",
    origin: { by: "you" },
    status: "blocked",
    lastActivityAt: minutesAgo(0),
    blockers: [{ id: "q-1", kind: "question", since: minutesAgo(0) }],
  }),
  // Lyra is idle, but an agent it started is at work: Running (CH-D3)
  row({
    runtimeRunId: "run-lyra",
    spark: "sp-lyra0001",
    origin: { by: "you" },
    lastActivityAt: minutesAgo(12),
  }),
  row({
    runtimeRunId: "run-lyra-agent",
    origin: { by: "spark", spark: "sp-lyra0001" },
    status: "working",
    lastActivityAt: minutesAgo(3),
  }),
  // Juno is awake with nothing running: Ready
  row({
    runtimeRunId: "run-juno",
    spark: "sp-juno0001",
    origin: { by: "you" },
    lastActivityAt: minutesAgo(60 * 26),
  }),
];

/** Chat's plates, one per honest state. */
export const CHAT_STATES = ["list", "asleep", "empty", "opening", "unavailable"] as const;
export type ChatState = (typeof CHAT_STATES)[number];

export const CHAT_STATE_LABEL: Record<ChatState, string> = {
  list: "Sparks",
  asleep: "Asleep",
  empty: "No sparks",
  opening: "Opening",
  unavailable: "Unavailable",
};

export function chatReadingOf(state: ChatState): SparksReading {
  switch (state) {
    case "list":
    case "asleep":
      return { state: "ready", entries: sparkEntriesOf(SPARKS, ROWS) };
    case "empty":
      return { state: "ready", entries: [] };
    case "opening":
      return { state: "opening" };
    case "unavailable":
      return { state: "unavailable", reason: "fieldd is not answering (the daemon is restarting)" };
  }
}

/** The spark a plate opens on: the newest, or Kiwi asleep. */
export const CHAT_CHOSEN: Record<ChatState, string | null> = {
  list: null,
  asleep: "sp-kiwi0001",
  empty: null,
  opening: null,
  unavailable: null,
};
