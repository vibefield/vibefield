import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type AgentModelChoice,
  type AgentModelSelection,
  type AgentProfileSet,
  type SparkSummary,
} from "@vibefield/contracts";
import { type AtSources, atDefaultHot, atRowsOf } from "../chat/at-rows";
import { type AtShown, type ChatComposerViewProps, menuRowId } from "../chat/ChatComposerView";
import {
  type AgentChip,
  type CardChip,
  type DraftPart,
  draftBlank,
  draftSendable,
  type SessionChip,
} from "../chat/composer-draft";
import { agentMenuOf, effortOf, type ModelsReading, modelWords } from "../chat/new-spark";
import { sparkEntriesOf } from "../chat/spark-status";
import type { SparksReading } from "../chat/sparks-feed";
import type { ThreadLatches } from "../chat/thread-marks";
import type { SparkPanePlace } from "../chat/thread-pane-door";
import { paneTextOf } from "../frame/cards/card-text";
import type { Card } from "../frame/cards/cards-model";
import { FIXTURE_NATIVE, FIXTURE_WORK } from "./profiles-fixtures";
import { FIXTURE_HATCHED, FIXTURE_SPARKS } from "./spark-fixtures";

// Chat's fixture ADAPTER (SP-1b, SP-1d; docs/UI_SYSTEM.md): what fieldd would answer — the sparks it keeps, the field
// board's rows, the agents and Agent Profiles it offers, an agent's picker, or that it is not answering — run through
// the PRODUCT's own readings (`sparkEntriesOf`, @'s `atRowsOf`, the agent menu's `agentMenuOf` and `effortOf`, the
// draft's `draftBlank` and `draftSendable`), so the catalog draws what the window would, never a copy of its words.
// Fixed seeds (`spark-fixtures.ts`) and a fixed clock, so every plate deals the same faces and says the same times.

/** The catalog's clock: a Saturday morning, 9:41 local. */
export const FIXTURE_NOW = new Date(2026, 9, 31, 9, 41).getTime();

const minutesAgo = (minutes: number): string =>
  new Date(FIXTURE_NOW - minutes * 60_000).toISOString();

const seedOf = (name: string): number =>
  FIXTURE_SPARKS.find((spark) => spark.name === name)?.seed ?? 0;

/** The agent the fixture sparks think with: the catalog's first, never a literal id (R23b). */
const AGENT = AGENT_CATALOG[0];

/** The fixture sparks work in This Mac and Work, so @'s agents say their profile (the profiles' own fixtures). */
const PROFILE_SETS: readonly AgentProfileSet[] = [FIXTURE_NATIVE, FIXTURE_WORK];
const PROFILES = PROFILE_SETS.map((set) => set.id);

/** What a read says when fieldd is not answering: Chat's list's, and an agent's picker's. */
const FIELDD_GONE = "fieldd is not answering (the daemon is restarting)";

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

/** Chat's plates, one per honest state. */
export const CHAT_STATES = [
  "list",
  "hello",
  "starting",
  "typing",
  "sending",
  "at",
  "at-reading",
  "at-none",
  "at-empty",
  "at-failed",
  "menu",
  "menu-reading",
  "menu-failed",
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
  starting: "A starter sending",
  typing: "Typing",
  sending: "Sending",
  at: "@",
  "at-reading": "@ reading",
  "at-none": "@ no match",
  "at-empty": "@ nothing to add",
  "at-failed": "@ can't read",
  menu: "An agent's model",
  "menu-reading": "Its picker reading",
  "menu-failed": "Its picker failed",
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
    case "sending":
    case "at":
    case "at-reading":
    case "at-none":
    case "at-empty":
    case "at-failed":
    case "menu":
    case "menu-reading":
    case "menu-failed":
    case "chips":
    case "finding":
    case "gone":
    case "fault":
    case "asleep":
      return { state: "ready", entries: sparkEntriesOf(SPARKS, ROWS) };
    case "hello":
    case "starting":
      return {
        state: "ready",
        entries: sparkEntriesOf([HATCHED, ...SPARKS], [HATCHED_RUN, ...ROWS]),
      };
    case "empty":
      return { state: "ready", entries: [] };
    case "opening":
      return { state: "opening" };
    case "unavailable":
      return { state: "unavailable", reason: FIELDD_GONE };
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
  starting: HATCHED.id,
  typing: "sp-juno0001",
  sending: "sp-juno0001",
  at: "sp-juno0001",
  "at-reading": "sp-juno0001",
  "at-none": "sp-juno0001",
  "at-empty": "sp-juno0001",
  "at-failed": "sp-juno0001",
  menu: "sp-juno0001",
  "menu-reading": "sp-juno0001",
  "menu-failed": "sp-juno0001",
  chips: "sp-juno0001",
  finding: "sp-juno0001",
  gone: "sp-juno0001",
  fault: "sp-juno0001",
  asleep: "sp-kiwi0001",
  empty: null,
  opening: null,
  unavailable: null,
};

/** The plates whose thread has a send under way (DESIGN.md §8 "Chat's thread"): Send's, over the draft it carries, or
 * a starter's, its hello's starters waiting. The thread takes one send at a time, so on both its send waits, busy. */
export const CHAT_SENDING: ReadonlySet<ChatState> = new Set(["starting", "sending"]);

// ── the composer's plates (SP-1d; DESIGN.md §8 "Chat's composer") ──

const JUNO = SPARKS[2] as SparkSummary;

/** The fixture agent's picker models: two, the first with Effort. */
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

/** The fixture agent's picker as `agent.models` answers it, read. */
const PICKER: ModelsReading = {
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
};

/** The fixture agent just taken from @, started under This Mac: untouched, at its own model and effort. */
const TAKEN_CHIP: AgentChip = {
  id: "chip-agent",
  kind: "agent",
  agent: AGENT.id,
  label: AGENT.label,
  profile: { id: FIXTURE_NATIVE.id, name: FIXTURE_NATIVE.label },
  named: true,
  model: null,
};

/** …and at Deep and High once its menu chose them. */
const AGENT_CHIP: AgentChip = {
  ...TAKEN_CHIP,
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

type ComposerPlate = Omit<ChatComposerViewProps, "name">;

/** A plate's draft as the composer's controller hands it to its view: blank and armed by the product's own
 * `draftBlank` and `draftSendable`, an open @'s query never what Send would carry; and @'s box over it, if open. */
function drafted(
  seed: readonly DraftPart[],
  at: AtShown | null = null,
  query: string | null = null,
): ComposerPlate {
  return {
    seed,
    blank: draftBlank(seed),
    armed: draftSendable(seed, query === null ? null : `@${query}`),
    at,
  };
}

/** @ open on Juno's thread after "Ask ", its list the product's own `atRowsOf` over `query`, what fieldd answers of
 * the spark's profiles (or null before it has, or "failed"), and the board's rows. */
function asked(
  query: string,
  sets: AtSources["sets"],
  rows: readonly AgentFieldRow[] = ROWS,
): ComposerPlate {
  const list = atRowsOf({ spark: JUNO, query, sets, rows });
  return drafted(
    [words(`Ask @${query}`)],
    { kind: "rows", left: 32, list, hot: atDefaultHot(list) },
    query,
  );
}

/** This Mac and Work before anyone signs in to either: no persona in them. */
const SIGNED_OUT: readonly AgentProfileSet[] = PROFILE_SETS.map((set) => ({
  ...set,
  personas: [],
}));

/** The board with none of your own sessions on it: the sparks' own runs and the agent Lyra started. */
const SPARKS_RUNS = ROWS.filter((row) => row.spark !== undefined || row.origin?.by === "spark");

/** "Start " and the agent's chip, its menu open in @'s box as the controller reads it for that chip: the New spark
 * sheet's `agentMenuOf` for the one agent, the profile on its head (Juno has two), and Effort under a chosen model
 * that has one. */
function started(chip: AgentChip, picker: ModelsReading): ComposerPlate {
  const selection = chip.model?.selection;
  const model =
    picker.state === "read"
      ? picker.answer.catalog?.models.find((choice) => choice.id === selection?.modelId)
      : undefined;
  return drafted([words("Start "), { kind: "chip", chip }, words(" ")], {
    kind: "menu",
    left: 46,
    rows: agentMenuOf(
      [{ id: chip.agent, label: chip.label, takes: true }],
      chip.agent,
      picker,
      selection,
      chip.named ? chip.profile.name : undefined,
    ),
    effort: effortOf(model, selection),
    hot: menuRowId(selection?.modelId ?? null),
  });
}

/** The question typed on Juno's thread, at rest and while its send runs. */
const ASKED: readonly DraftPart[] = [words("Why does the composer test fail on main?")];

/** The composer on each plate: the shipping view's props, made by the product's own readings of the fixtures. At rest
 * where a plate names none; its send busy where `CHAT_SENDING` says a send runs. */
export const CHAT_COMPOSER: Partial<Record<ChatState, ComposerPlate>> = {
  typing: drafted(ASKED),
  sending: drafted(ASKED),
  // @'s list: both groups; still being read; nothing called what follows the @; nothing to add (no sign-in, none of
  // your sessions); and the spark's profiles not read
  at: asked("", PROFILE_SETS),
  "at-reading": asked("", null),
  "at-none": asked("docs", PROFILE_SETS),
  "at-empty": asked("", SIGNED_OUT, SPARKS_RUNS),
  "at-failed": asked("", "failed"),
  // an agent's menu: its picker read and a model chosen; just taken, its picker being read; its picker not read
  menu: started(AGENT_CHIP, PICKER),
  "menu-reading": started(TAKEN_CHIP, { state: "reading" }),
  "menu-failed": started(TAKEN_CHIP, { state: "failed", words: FIELDD_GONE }),
  chips: drafted([
    words("Have "),
    { kind: "chip", chip: AGENT_CHIP },
    words(" review "),
    { kind: "chip", chip: SESSION_CHIP },
    words(" against "),
    { kind: "chip", chip: CARD_CHIP },
    words(" "),
  ]),
};
