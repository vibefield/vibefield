import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type AgentModelChoice,
  type AgentModelSelection,
  type AgentProviderSummary,
  type SparkSummary,
} from "@vibefield/contracts";
import { atDefaultHot, atRowsOf } from "../chat/at-rows";
import type { ChatComposerViewProps } from "../chat/ChatComposerView";
import type { AgentChip, CardChip, DraftPart, SessionChip } from "../chat/composer-draft";
import { agentMenuOf, effortOf, modelWords } from "../chat/new-spark";
import { sparkEntriesOf } from "../chat/spark-status";
import type { SparksReading } from "../chat/sparks-feed";
import type { ThreadLatches } from "../chat/thread-marks";
import type { SparkPanePlace } from "../chat/thread-pane-door";
import { paneTextOf } from "../frame/cards/card-text";
import type { Card } from "../frame/cards/cards-model";
import { FIXTURE_NATIVE, FIXTURE_WORK } from "./profiles-fixtures";
import { FIXTURE_HATCHED, FIXTURE_SPARKS } from "./spark-fixtures";

// Chat's fixture ADAPTER (SP-1b, SP-1d; docs/UI_SYSTEM.md): what fieldd would answer — the sparks it keeps, the field
// board's rows, the agents and Agent Profiles it offers, an agent's picker — run through the PRODUCT's own readings
// (`sparkEntriesOf`, @'s `atRowsOf`, the agent menu's `agentMenuOf` and `effortOf`), so the catalog draws what the
// window would, never a copy of its words. Fixed seeds (`spark-fixtures.ts`) and a fixed clock, so every plate deals
// the same faces and says the same times.

/** The catalog's clock: a Saturday morning, 9:41 local. */
export const FIXTURE_NOW = new Date(2026, 9, 31, 9, 41).getTime();

const minutesAgo = (minutes: number): string =>
  new Date(FIXTURE_NOW - minutes * 60_000).toISOString();

const seedOf = (name: string): number =>
  FIXTURE_SPARKS.find((spark) => spark.name === name)?.seed ?? 0;

/** The agent the fixture sparks think with: the catalog's first, never a literal id (R23b). */
const AGENT = AGENT_CATALOG[0];

/** The fixture sparks work in This Mac and Work, so @'s agents say their profile (the profiles' own fixtures). */
const PROFILES = [FIXTURE_NATIVE.id, FIXTURE_WORK.id];

function spark(id: string, name: string, session: SparkSummary["session"]): SparkSummary {
  return {
    id,
    name,
    face: { seed: seedOf(name) },
    agent: AGENT.id,
    profiles: PROFILES,
    thinksUnder: FIXTURE_NATIVE.id,
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

/** An awake spark's session: its run, and the floor terminal fieldd named for it (SP-1d: the thread's pane). */
const live = (name: string) => ({
  runtimeRunId: `run-${name}`,
  terminalSessionId: `pty-${name}`,
  live: true,
});

/** Four sparks, one in each of the words the board can say today. */
const SPARKS: readonly SparkSummary[] = [
  spark("sp-vela0001", "Vela", live("vela")),
  spark("sp-lyra0001", "Lyra", live("lyra")),
  spark("sp-juno0001", "Juno", live("juno")),
  spark("sp-kiwi0001", "Kiwi", { runtimeRunId: "run-kiwi", live: false }),
];

/** The spark the New spark sheet's plates hatch, just hatched: awake, its run up, no turn taken yet (the hello's). */
const HATCHED: SparkSummary = {
  ...spark("sp-polaris01", FIXTURE_HATCHED.name, live("polaris")),
  face: { seed: FIXTURE_HATCHED.seed },
  createdAt: minutesAgo(0),
  updatedAt: minutesAgo(0),
};

/** Work's sign-in for the fixture agent: a session run under it is filed under Work. */
const WORK_PERSONA = FIXTURE_WORK.personas.find((persona) => persona.provider === AGENT.id);

const ROWS: readonly AgentFieldRow[] = [
  // Vela asks you a question: Asking you, in the attention ink, its dot orange
  row({
    runtimeRunId: "run-vela",
    spark: "sp-vela0001",
    origin: { by: "you" },
    status: "blocked",
    lastActivityAt: minutesAgo(0),
    blockers: [{ id: "q-1", kind: "question", since: minutesAgo(0) }],
    usage: { cumulativeTokens: 48_200 },
  }),
  // Lyra is idle, but an agent it started is at work: Running (CH-D3)
  row({
    runtimeRunId: "run-lyra",
    spark: "sp-lyra0001",
    origin: { by: "you" },
    lastActivityAt: minutesAgo(12),
    usage: { cumulativeTokens: 126_900 },
  }),
  row({
    runtimeRunId: "run-lyra-agent",
    origin: { by: "spark", spark: "sp-lyra0001" },
    status: "working",
    lastActivityAt: minutesAgo(3),
  }),
  // Juno is awake with nothing running: Ready, a transcript behind it (so no hello: its pane alone)
  row({
    runtimeRunId: "run-juno",
    spark: "sp-juno0001",
    origin: { by: "you" },
    lastActivityAt: minutesAgo(60 * 26),
    usage: { cumulativeTokens: 18_400 },
  }),
  // the person's own sessions, which @ offers a spark of This Mac and Work (SP-1d): two folders of one name, so the
  // second started takes its ordinal, and one under Work
  row({
    runtimeRunId: "run-his-1",
    origin: { by: "you" },
    status: "working",
    project: { name: "vibe-field" },
    createdAt: minutesAgo(120),
    lastActivityAt: minutesAgo(1),
  }),
  row({
    runtimeRunId: "run-his-2",
    ...(WORK_PERSONA === undefined ? {} : { profileId: WORK_PERSONA.profileId }),
    project: { name: "vibe-field" },
    createdAt: minutesAgo(40),
    lastActivityAt: minutesAgo(8),
  }),
  row({
    runtimeRunId: "run-his-3",
    status: "blocked",
    blockers: [{ id: "p-1", kind: "permission", since: minutesAgo(2) }],
    project: { name: "rosetta" },
    lastActivityAt: minutesAgo(2),
  }),
];

/** The hatched spark's own run: up and idle, nothing spent — it has had no turn. */
const HATCHED_RUN = row({
  runtimeRunId: "run-polaris",
  spark: HATCHED.id,
  origin: { by: "you" },
  statusSince: minutesAgo(0),
  stateChangedAt: minutesAgo(0),
  createdAt: minutesAgo(0),
  lastActivityAt: minutesAgo(0),
});

/** The agents fieldd offers: the catalog's, by its labels. */
const PROVIDERS: readonly AgentProviderSummary[] = AGENT_CATALOG.map((entry) => ({
  id: entry.id,
  label: entry.label,
  available: true,
  resumable: true,
  personas: [],
}));

/** Chat's plates, one per honest state. */
export const CHAT_STATES = [
  "list",
  "hello",
  "typing",
  "at",
  "menu",
  "chips",
  "finding",
  "gone",
  "fault",
  "asleep",
  "empty",
  "opening",
  "unavailable",
] as const;
export type ChatState = (typeof CHAT_STATES)[number];

export const CHAT_STATE_LABEL: Record<ChatState, string> = {
  list: "Sparks",
  hello: "A new spark",
  typing: "Typing",
  at: "@",
  menu: "An agent's model",
  chips: "Chips",
  finding: "Finding",
  gone: "Off the floor",
  fault: "No answer",
  asleep: "Asleep",
  empty: "No sparks",
  opening: "Opening",
  unavailable: "Unavailable",
};

/** What the shown thread's pane says on a plate (SP-1d). A catalog holds no terminals, so the live pane is never
 * mounted here: absent, the panel says what a window with no terminals says; else the pane's own words for the place
 * the product's pane would be in — fieldd has not named the terminal yet, the floor holds no such terminal, or the
 * floor did not answer (the pool's own words for its lapse). */
export const CHAT_PANE: Partial<Record<ChatState, SparkPanePlace>> = {
  finding: { state: "finding" },
  gone: { state: "gone" },
  fault: { state: "fault", reason: "the floor did not answer in 10 s" },
};

export function chatReadingOf(state: ChatState): SparksReading {
  switch (state) {
    case "list":
    case "typing":
    case "at":
    case "menu":
    case "chips":
    case "finding":
    case "gone":
    case "fault":
    case "asleep":
      return { state: "ready", entries: sparkEntriesOf(SPARKS, ROWS) };
    case "hello":
      return {
        state: "ready",
        entries: sparkEntriesOf([HATCHED, ...SPARKS], [HATCHED_RUN, ...ROWS]),
      };
    case "empty":
      return { state: "ready", entries: [] };
    case "opening":
      return { state: "opening" };
    case "unavailable":
      return { state: "unavailable", reason: "fieldd is not answering (the daemon is restarting)" };
  }
}

/** What the plates' window saw while each thread was off screen (SP-1d): Lyra's own turn ended, so her thread is
 * unread, the cyan dot on her row. Vela's need is standing, so it needs no latch to wear the orange one. */
export const CHAT_LATCHES: ThreadLatches = { needs: new Set(), unread: new Set(["sp-lyra0001"]) };

/** The spark a plate opens on: the newest (Polaris, just hatched, on the hello's), Juno (awake and Ready) for the
 * pane's words and the composer, or Kiwi asleep. */
export const CHAT_CHOSEN: Record<ChatState, string | null> = {
  list: null,
  hello: HATCHED.id,
  typing: "sp-juno0001",
  at: "sp-juno0001",
  menu: "sp-juno0001",
  chips: "sp-juno0001",
  finding: "sp-juno0001",
  gone: "sp-juno0001",
  fault: "sp-juno0001",
  asleep: "sp-kiwi0001",
  empty: null,
  opening: null,
  unavailable: null,
};

// ── the composer's plates (SP-1d; DESIGN.md §8 "Chat's composer") ──

const JUNO = SPARKS[2] as SparkSummary;

/** The fixture agent's picker, as `agent.models` would answer it: two models, the first with Effort. */
const DEEP: AgentModelChoice = {
  id: "deep",
  label: "Deep",
  controls: [
    {
      id: "effort",
      label: "Effort",
      role: "effort",
      values: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
      defaultValue: "medium",
    },
  ],
};
const QUICK: AgentModelChoice = { id: "quick", label: "Quick", controls: [] };
const CHOSEN: AgentModelSelection = { modelId: DEEP.id, controls: { effort: "high" } };

/** The fixture agent taken from @, started under This Mac, at Deep and High once its menu chose them. */
const AGENT_CHIP: AgentChip = {
  id: "chip-agent",
  kind: "agent",
  agent: AGENT.id,
  label: AGENT.label,
  profile: { id: FIXTURE_NATIVE.id, name: FIXTURE_NATIVE.label },
  named: true,
  model: { selection: CHOSEN, words: modelWords(DEEP, CHOSEN) },
};

/** The second vibe-field session, taken from @ by its handle. */
const SESSION_CHIP: SessionChip = {
  id: "chip-session",
  kind: "session",
  session: "run-his-2",
  agent: AGENT.id,
  label: AGENT.label,
  handle: "vibe-field·2",
  project: "vibe-field",
};

/** A terminal selection copied in Godview, played from the hand onto the composer. */
const TERM_CARD: Card = {
  id: "card-term",
  kind: "term",
  origin: { view: "godview", place: "vibe-field", how: "copy" },
  at: FIXTURE_NOW - 60_000,
  first: "pnpm test --filter field-app",
  rest: "FAIL test/chat-view.test.tsx",
  paste: "pnpm test --filter field-app\nFAIL test/chat-view.test.tsx\n",
};
const CARD_CHIP: CardChip = {
  id: "chip-card",
  kind: "card",
  card: TERM_CARD,
  text: paneTextOf(TERM_CARD) ?? "",
};

const words = (text: string): DraftPart => ({ kind: "text", text });

/** @'s list on Juno's thread: both groups, read by the product's own `atRowsOf`. */
const AT_LIST = atRowsOf({
  spark: JUNO,
  query: "",
  providers: PROVIDERS,
  sets: [FIXTURE_NATIVE, FIXTURE_WORK],
  rows: ROWS,
});

/** The composer on each plate: the shipping view's props, made by the product's own readings of the fixtures. At rest
 * where a plate names none. */
export const CHAT_COMPOSER: Partial<Record<ChatState, Omit<ChatComposerViewProps, "name">>> = {
  typing: {
    seed: [words("Why does the composer test fail on main?")],
    blank: false,
    armed: true,
  },
  at: {
    seed: [words("Ask @")],
    blank: false,
    armed: false,
    at: { kind: "rows", left: 32, list: AT_LIST, hot: atDefaultHot(AT_LIST) },
  },
  menu: {
    seed: [words("Start "), { kind: "chip", chip: AGENT_CHIP }, words(" ")],
    blank: false,
    armed: true,
    at: {
      kind: "menu",
      left: 46,
      rows: agentMenuOf(
        [{ id: AGENT.id, label: AGENT.label, takes: true }],
        AGENT.id,
        {
          state: "read",
          answer: {
            provider: AGENT.id,
            profileSet: FIXTURE_NATIVE.id,
            catalog: {
              provider: AGENT.id,
              cwd: "/fixture",
              observedAt: minutesAgo(4),
              source: { kind: "native-protocol", freshness: "live" },
              completeness: "complete",
              customModels: false,
              models: [DEEP, QUICK],
            },
            refreshing: false,
          },
        },
        CHOSEN,
        FIXTURE_NATIVE.label,
      ),
      effort: effortOf(DEEP, CHOSEN),
      hot: DEEP.id,
    },
  },
  chips: {
    seed: [
      words("Have "),
      { kind: "chip", chip: AGENT_CHIP },
      words(" review "),
      { kind: "chip", chip: SESSION_CHIP },
      words(" against "),
      { kind: "chip", chip: CARD_CHIP },
      words(" "),
    ],
    blank: false,
    armed: true,
  },
};
