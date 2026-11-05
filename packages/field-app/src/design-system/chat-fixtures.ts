import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type AgentModelChoice,
  type AgentModelSelection,
  type AgentProfileSet,
  NEEDS_CHOICE_WORDS,
  type NeedsAnswer,
  type NeedsItem,
  needsKindOf,
  type SparkId,
  type SparkSummary,
} from "@vibefield/contracts";
import { agentChipMenuOf } from "../chat/agent-chip-menu";
import { type AtSources, atDefaultHot, atRowsOf, sessionHandlesOf } from "../chat/at-rows";
import type { AtShown, ChatComposerViewProps } from "../chat/ChatComposerView";
import type { ChatAct } from "../chat/ChatPanelView";
import {
  type AgentChip,
  type CardChip,
  type DraftPart,
  draftBlank,
  draftSendable,
  type SessionChip,
} from "../chat/composer-draft";
import { type NeedsAct, type NeedsCard, needsCardOf } from "../chat/needs-card";
import { type ModelsReading, modelWords } from "../chat/new-spark";
import { type SparkEntry, sparkEntriesOf } from "../chat/spark-status";
import type { SparksReading } from "../chat/sparks-feed";
import { ThreadLedger, type ThreadMark, threadMarksOf } from "../chat/thread-marks";
import type { SparkPanePlace } from "../chat/thread-pane-door";
import type { PendingSay } from "../chat/transcript-items";
import { type TranscriptReading, transcriptReadingOf } from "../chat/transcript-port";
import { paneTextOf } from "../frame/cards/card-text";
import type { Card } from "../frame/cards/cards-model";
import { FIXTURE_NATIVE, FIXTURE_WORK } from "./profiles-fixtures";
import { FIXTURE_HATCHED, FIXTURE_SPARKS } from "./spark-fixtures";

// Chat's fixture ADAPTER (SP-1b, SP-1d, CP-3; docs/UI_SYSTEM.md): what fieldd would answer — the sparks it keeps, the
// field board's rows, the needs-you queue's items, the agents and Agent Profiles it offers, an agent's picker, or that
// it is not answering — run through the PRODUCT's own readings (`sparkEntriesOf`, the thread marks' `ThreadLedger` and
// `threadMarksOf`, @'s `atRowsOf`, an agent chip's menu `agentChipMenuOf`, the draft's `draftBlank` and
// `draftSendable`, the needs-you card's `needsCardOf`, its sessions named by @'s `sessionHandlesOf`), so the catalog
// draws what the window would, never a copy of its words.
// Fixed seeds (`spark-fixtures.ts`) and a fixed clock, so every plate deals the same faces and says the same times.

/** The catalog's clock: a Saturday morning, 9:41 local. */
export const FIXTURE_NOW = new Date(2026, 9, 31, 9, 41).getTime();

const minutesAgo = (minutes: number): string =>
  new Date(FIXTURE_NOW - minutes * 60_000).toISOString();

/** When fieldd saw the plate's sparks first work (`turnedAt`): minutes after their hatch, three days ago. */
const WORKED_AT = minutesAgo(60 * 24 * 3 - 5);

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
    turnedAt: WORKED_AT,
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

/** The spark the New spark sheet's plates hatch, as fieldd keeps it before its session is born — and keeps it, for a
 * hatch whose session did not start: no session yet (Hello, "hasn't started yet"). */
const UNSTARTED: SparkSummary = {
  ...spark("sp-polaris01", FIXTURE_HATCHED.name, undefined),
  face: { seed: FIXTURE_HATCHED.seed },
  createdAt: minutesAgo(0),
  updatedAt: minutesAgo(0),
  turnedAt: null,
};

/** …just hatched: awake, its run up, no turn taken yet (the hello's). */
const HATCHED: SparkSummary = { ...UNSTARTED, session: live("polaris") };

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
    turnedAt: WORKED_AT,
  }),
  // Lyra is idle, but an agent it started is at work: Running (CH-D3)
  row({
    runtimeRunId: "run-lyra",
    spark: "sp-lyra0001",
    origin: { by: "you" },
    lastActivityAt: minutesAgo(12),
    turnedAt: WORKED_AT,
  }),
  row({
    runtimeRunId: "run-lyra-agent",
    origin: { by: "spark", spark: "sp-lyra0001" },
    status: "working",
    lastActivityAt: minutesAgo(3),
  }),
  // Juno is awake with nothing running: Ready, a spark that has worked (so no hello: its pane alone)
  row({
    runtimeRunId: "run-juno",
    spark: "sp-juno0001",
    origin: { by: "you" },
    lastActivityAt: minutesAgo(60 * 26),
    turnedAt: WORKED_AT,
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
    ...(WORK_PERSONA === undefined
      ? {}
      : { profileId: WORK_PERSONA.profileId, profileSet: FIXTURE_WORK.id }),
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

/** How a spark's thread names the person's sessions (track CO, the handle): @'s handles, by the product's own
 * `sessionHandlesOf` over the fixture board and Agent Profiles, so a card says what that thread's @ would. Every
 * plate that draws a card stands on this board; a hatched spark's own run is never one @ offers. */
export const chatHandlesOf = (spark: SparkSummary): ReadonlyMap<string, string> =>
  sessionHandlesOf(spark, ROWS, PROFILE_SETS);

/** The hatched spark's own run: up and idle — it has had no turn. */
const HATCHED_RUN = row({
  runtimeRunId: "run-polaris",
  spark: HATCHED.id,
  origin: { by: "you" },
  turnedAt: null,
  statusSince: minutesAgo(0),
  stateChangedAt: minutesAgo(0),
  createdAt: minutesAgo(0),
  lastActivityAt: minutesAgo(0),
});

/** The needs-you queue's open items, oldest first, as needs.subscribe would say them (CP-3): the ask of Vela's own run,
 * which her row's blocker already says (read once, there), and Kiwi's held send to the first vibe-field — Kiwi asked,
 * then slept, and an answer would wake it (CP3-D7). Names as fieldd's `runLabel` gives them (a session's title, else
 * its agent's label); the card names a session @ offers by its handle instead (`chatHandlesOf`). */
const ITEMS: readonly NeedsItem[] = [
  {
    id: "ny-velaown0001",
    kind: "agent-ask",
    state: "open",
    from: { name: AGENT.label, session: "run-vela" },
    spark: "sp-vela0001",
    asked: minutesAgo(0),
    ask: "question",
    count: 1,
  },
  {
    id: "ny-kiwisend001",
    kind: "held-send",
    state: "open",
    from: { name: "Kiwi", session: "run-kiwi", spark: "sp-kiwi0001" },
    spark: "sp-kiwi0001",
    asked: minutesAgo(30),
    words: "run the tests in packages/fieldd and tell me what fails",
    choices: [NEEDS_CHOICE_WORDS.allow, NEEDS_CHOICE_WORDS.notNow],
    to: { session: "run-his-1", name: AGENT.label },
  },
];

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
  "at-board-failed",
  "menu",
  "menu-reading",
  "menu-failed",
  "chips",
  "finding",
  "gone",
  "fault",
  "asleep",
  "waking",
  "wake-refused",
  "not-started",
  "waiting",
  "thread",
  "thread-tools",
  "thread-long",
  "thread-asleep",
  "thread-earlier",
  "thread-receipts",
  "thread-thinking",
  "thread-honest",
  "thread-reading",
  "thread-unreadable",
  "thread-hello",
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
  "at-board-failed": "@ can't read sessions",
  menu: "An agent's model",
  "menu-reading": "Its picker reading",
  "menu-failed": "Its picker failed",
  chips: "Chips",
  finding: "Finding",
  gone: "Off the floor",
  fault: "No answer",
  asleep: "Asleep",
  waking: "Waking",
  "wake-refused": "Wake refused",
  "not-started": "Not started",
  waiting: "Waiting on you",
  thread: "A thread, two runs joined",
  "thread-tools": "Its tools opened",
  "thread-long": "A long reply",
  "thread-asleep": "Asleep, drawn",
  "thread-earlier": "Every conversation",
  "thread-receipts": "Receipts",
  "thread-thinking": "Thinking",
  "thread-honest": "Honest lines",
  "thread-reading": "Reading",
  "thread-unreadable": "Can't read",
  "thread-hello": "Hello, drawn",
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
    case "at-board-failed":
    case "menu":
    case "menu-reading":
    case "menu-failed":
    case "chips":
    case "finding":
    case "gone":
    case "fault":
    case "asleep":
    case "waking":
    case "wake-refused":
    case "thread":
    case "thread-tools":
    case "thread-long":
    case "thread-asleep":
    case "thread-earlier":
    case "thread-receipts":
    case "thread-honest":
    case "thread-reading":
    case "thread-unreadable":
      return { state: "ready", entries: sparkEntriesOf(SPARKS, ROWS) };
    case "thread-thinking":
      return {
        state: "ready",
        entries: sparkEntriesOf(
          SPARKS,
          ROWS.map((each) =>
            each.runtimeRunId === "run-juno" ? { ...each, status: "working" as const } : each,
          ),
        ),
      };
    case "not-started":
      return { state: "ready", entries: sparkEntriesOf([UNSTARTED, ...SPARKS], ROWS) };
    case "hello":
    case "starting":
    case "thread-hello":
      return {
        state: "ready",
        entries: sparkEntriesOf([HATCHED, ...SPARKS], [HATCHED_RUN, ...ROWS]),
      };
    case "waiting":
      return { state: "ready", entries: sparkEntriesOf(SPARKS, ROWS, { items: ITEMS }) };
    case "empty":
      return { state: "ready", entries: [] };
    case "opening":
      return { state: "opening" };
    case "unavailable":
      return { state: "unavailable", reason: FIELDD_GONE };
  }
}

const KIWI = SPARKS[3] as SparkSummary;

/** What the plates' window read before each plate's own reading (SP-1d): Kiwi awake and asking you a question, and
 * Lyra's own turn under way. */
const EARLIER: readonly SparkEntry[] = sparkEntriesOf(
  SPARKS.map((each) => (each.id === KIWI.id ? { ...each, session: live("kiwi") } : each)),
  [
    ...ROWS.map((each) =>
      each.runtimeRunId === "run-lyra" ? { ...each, status: "working" as const } : each,
    ),
    row({
      runtimeRunId: "run-kiwi",
      spark: KIWI.id,
      origin: { by: "you" },
      status: "blocked",
      lastActivityAt: minutesAgo(40),
      blockers: [{ id: "q-2", kind: "question", since: minutesAgo(40) }],
    }),
  ],
);

/** Each thread's mark on a plate (SP-1d), as the product's own ledger latches it over what the plates' window read
 * with the plate's thread on screen: the earlier reading, then the plate's own. Kiwi has fallen asleep since it asked,
 * so its dot outlasts the need ("needed you"); Lyra's own turn has ended, so her thread is unread; Vela's need stands.
 * A thread on screen latches nothing, as opening it reads it. */
export function chatMarksOf(
  entries: readonly SparkEntry[],
  shown: SparkId | null,
): ReadonlyMap<SparkId, ThreadMark> {
  const ledger = new ThreadLedger();
  ledger.show(shown, []);
  ledger.read(EARLIER);
  ledger.read(entries);
  return threadMarksOf(entries, ledger);
}

/** The spark a plate opens on: the newest (Polaris, just hatched, on the hello's), Juno (awake and Ready) for the
 * pane's words and the composer, Kiwi asleep (on the waiting plate with its held send in the queue, so its word is
 * Needs your OK while its line still says it sleeps: CP-3), or Polaris not started. */
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
  "at-board-failed": "sp-juno0001",
  menu: "sp-juno0001",
  "menu-reading": "sp-juno0001",
  "menu-failed": "sp-juno0001",
  chips: "sp-juno0001",
  finding: "sp-juno0001",
  gone: "sp-juno0001",
  fault: "sp-juno0001",
  asleep: "sp-kiwi0001",
  waking: "sp-kiwi0001",
  "wake-refused": "sp-kiwi0001",
  "not-started": UNSTARTED.id,
  waiting: "sp-kiwi0001",
  thread: "sp-juno0001",
  "thread-tools": "sp-juno0001",
  "thread-long": "sp-juno0001",
  "thread-asleep": "sp-kiwi0001",
  "thread-earlier": "sp-juno0001",
  "thread-receipts": "sp-juno0001",
  "thread-thinking": "sp-juno0001",
  "thread-honest": "sp-juno0001",
  "thread-reading": "sp-juno0001",
  "thread-unreadable": "sp-juno0001",
  "thread-hello": HATCHED.id,
  empty: null,
  opening: null,
  unavailable: null,
};

/** The plates whose thread an act holds (DESIGN.md §8 "Chat's thread"): Send's, over the draft it carries; a
 * starter's, its hello's starters waiting; or Wake's. The thread takes one act at a time, so on each its send waits,
 * busy. */
export const CHAT_SENDING: ReadonlySet<ChatState> = new Set(["starting", "sending", "waking"]);

/** The shown spark's act on a plate (DESIGN.md §8 "Chat's list", the thread's column): Kiwi's Wake under way, or
 * refused in fieldd's words. At rest where a plate names none. */
export const CHAT_ACT: Partial<Record<ChatState, ChatAct>> = {
  waking: { state: "busy" },
  "wake-refused": { state: "refused", reason: FIELDD_GONE },
};

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
 * the spark's profiles (or null before it has, or "failed"), and the board's rows (or "failed", its subscription
 * refused). */
function asked(
  query: string,
  sets: AtSources["sets"],
  rows: AtSources["rows"] = ROWS,
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

/** "Start " and the agent's chip, its menu open in @'s box as the controller reads it for that chip
 * (`agentChipMenuOf`, nothing pointed at yet): the profile on its head (Juno has two), and Effort under a chosen model
 * that has one. */
function started(chip: AgentChip, picker: ModelsReading): ComposerPlate {
  const menu = agentChipMenuOf(chip, picker, null);
  return drafted([words("Start "), { kind: "chip", chip }, words(" ")], {
    kind: "menu",
    left: 46,
    rows: menu.rows,
    effort: menu.effort,
    hot: menu.hot,
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
  // your sessions); the spark's profiles not read; and the board not read, the agents to start standing
  at: asked("", PROFILE_SETS),
  "at-reading": asked("", null),
  "at-none": asked("docs", PROFILE_SETS),
  "at-empty": asked("", SIGNED_OUT, SPARKS_RUNS),
  "at-failed": asked("", "failed"),
  "at-board-failed": asked("", PROFILE_SETS, "failed"),
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

// ── the thread's flow (TH-1; DESIGN.md §8 "Chat's thread") ──

/** A record line as fieldd writes one: the format, its place, a MAC the reader never checks (the worker does), its
 * kind and time, and its fields. */
function said(
  seq: number,
  kind: string,
  at: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return { v: 1, seq, mac: "0".repeat(64), kind, at, ...fields };
}

/** When the plates' sparks hatched, and their record began: no plate but the honest lines' says it began late. */
const HATCH = minutesAgo(60 * 24 * 3);

const run = (runtimeRunId: string, startedAt: string, fresh: boolean) => ({
  runtimeRunId,
  startedAt,
  fresh,
});

/** Juno's conversation: an earlier one three days ago (a fresh start), and the latest, begun yesterday and resumed
 * this morning (two runs joined). */
const JUNO_RUNS = [
  run("run-juno-1", minutesAgo(60 * 24 * 3), true),
  run("run-juno-2", minutesAgo(60 * 22), true),
  run("run-juno", minutesAgo(30), false),
];

const ASKED_WORDS = "Why does the composer test fail on main?";
const REVIEW_WORDS = "Have Claude Code in vibe-field (session run-his-1) review the fix";
const REVIEW_CHIP = {
  start: 5,
  length: "Claude Code in vibe-field (session run-his-1)".length,
  kind: "session",
};

const JUNO_EARLIER = [
  said(1, "run", minutesAgo(60 * 24 * 3), { runtimeRunId: "run-juno-1", fresh: true }),
  said(2, "you", minutesAgo(60 * 24 * 3 - 1), {
    via: "chat",
    text: "Keep track of my agents in vibe-field",
    input: "in-juno-01",
    requestId: "say-juno-0001",
    state: "queued",
  }),
  said(3, "outcome", minutesAgo(60 * 24 * 3 - 1), { of: "in-juno-01", state: "delivered" }),
  said(4, "reply", minutesAgo(60 * 24 * 3 - 2), {
    messageId: "m-juno-01",
    text: "I'll watch the agents you start in vibe-field and tell you when one needs you.",
  }),
];

const JUNO_YESTERDAY = [
  said(1, "run", minutesAgo(60 * 22), { runtimeRunId: "run-juno-2", fresh: true }),
  said(2, "you", minutesAgo(60 * 22 - 1), {
    via: "chat",
    text: ASKED_WORDS,
    input: "in-juno-02",
    requestId: "say-juno-0002",
    state: "queued",
  }),
  said(3, "outcome", minutesAgo(60 * 22 - 1), { of: "in-juno-02", state: "delivered" }),
  said(4, "turn", minutesAgo(60 * 22 - 1), { edge: "start", turn: "t-1" }),
  said(5, "tool", minutesAgo(60 * 22 - 2), {
    toolCallId: "tc-1",
    turn: "t-1",
    toolKind: "file-read",
    detail: "packages/field-app/test/chat-composer.test.tsx",
  }),
  said(6, "tool", minutesAgo(60 * 22 - 2), {
    toolCallId: "tc-2",
    turn: "t-1",
    toolKind: "command",
    detail: "pnpm --filter @vibefield/field-app test chat-composer",
  }),
  said(7, "tool", minutesAgo(60 * 22 - 3), {
    toolCallId: "tc-3",
    turn: "t-1",
    toolKind: "mcp",
    ours: true,
  }),
  said(8, "tool", minutesAgo(60 * 22 - 3), {
    toolCallId: "tc-4",
    turn: "t-1",
    toolKind: "file-edit",
    detail: "packages/field-app/src/chat/ChatComposer.tsx",
  }),
  said(9, "reply", minutesAgo(60 * 22 - 4), {
    messageId: "m-juno-02",
    turn: "t-1",
    text: "It fails because **the draft's caret** is read before the editor mounts. I moved the read into the editor's first frame, and the suite is green.",
  }),
  said(10, "turn", minutesAgo(60 * 22 - 4), { edge: "end", turn: "t-1" }),
  said(11, "act", minutesAgo(60 * 22 - 5), { what: "notify", text: "the composer suite is green" }),
];

const JUNO_TODAY = [
  said(1, "run", minutesAgo(30), { runtimeRunId: "run-juno", fresh: false }),
  said(2, "act", minutesAgo(30), {
    what: "wake",
    text: 'you answered Lyra\'s question "Push the fix?": Yes',
  }),
  said(3, "you", minutesAgo(20), {
    via: "chat",
    text: REVIEW_WORDS,
    input: "in-juno-03",
    requestId: "say-juno-0003",
    state: "queued",
    chips: [REVIEW_CHIP],
  }),
  said(4, "outcome", minutesAgo(19), { of: "in-juno-03", state: "delivered" }),
  said(5, "reply", minutesAgo(18), {
    messageId: "m-juno-03",
    text: "Sent it to vibe-field. I'll tell you what it finds.",
  }),
];

const JUNO_LINES = new Map<string, readonly unknown[]>([
  ["run-juno-1", JUNO_EARLIER],
  ["run-juno-2", JUNO_YESTERDAY],
  ["run-juno", JUNO_TODAY],
]);

/** A reply in every part of the named subset: a heading, a list, inline and fenced code, a quote, and a link, which
 * is drawn as its words. */
const LONG_REPLY = [
  "## What changed",
  "",
  "The draft now reads its caret in the editor's **first frame**, not before it mounts:",
  "",
  "- `ChatComposer.tsx` waits for the editor",
  "- `chat-composer.test.tsx` checks the *first* keystroke",
  "",
  "```ts",
  "useLayoutEffect(() => editor.current?.focus(), []);",
  "```",
  "",
  "> The other suites were already green.",
  "",
  "The run is in [the CI log](https://example.invalid/run/41943622431).",
].join("\n");

/** Every receipt a bubble of yours says, oldest first: delivered (said under the last bubble alone), its session
 * ended, lost and never resent, then two this window has just sent — one woken for, one queued. */
const RECEIPT_LINES = [
  said(1, "run", minutesAgo(40), { runtimeRunId: "run-juno", fresh: true }),
  ...[
    ["in-r1", "Run the review loop on ds/c", "delivered"],
    ["in-r2", "and keep it going until it's clean", "dropped"],
    ["in-r3", "then push it", "uncertain"],
  ].flatMap(([input, text, state], index) => [
    said(2 + index * 2, "you", minutesAgo(39 - index), {
      via: "chat",
      text,
      input,
      requestId: `say-receipt-${index}`,
      state: "queued",
    }),
    said(3 + index * 2, "outcome", minutesAgo(38 - index), { of: input, state }),
  ]),
  said(8, "you", minutesAgo(30), { via: "terminal", text: "/compact" }),
];

/** What a plate's flow reads: the record as the reader holds it, this window's sends it does not show yet, whether
 * the earlier conversations are asked for, and the tool lines opened. */
export interface FlowPlate {
  readonly reading: TranscriptReading;
  readonly pending?: readonly PendingSay[];
  readonly earlier?: boolean;
  readonly opened?: readonly string[];
}

const READ_JUNO = transcriptReadingOf(JUNO_RUNS, JUNO_LINES);
const READ_JUNO_WHOLE = transcriptReadingOf(JUNO_RUNS, JUNO_LINES, { whole: true });

/** The plates whose thread is drawn (TH-1), each through the product's own reading of fixture lines. */
export const CHAT_FLOW: Partial<Record<ChatState, FlowPlate>> = {
  thread: { reading: READ_JUNO },
  "thread-tools": { reading: READ_JUNO, opened: ["tools:run-juno-2:5"], earlier: false },
  "thread-long": {
    reading: transcriptReadingOf(
      [run("run-juno", HATCH, true)],
      new Map([
        [
          "run-juno",
          [
            said(1, "run", minutesAgo(30), { runtimeRunId: "run-juno", fresh: true }),
            said(2, "you", minutesAgo(12), {
              via: "chat",
              text: "What changed?",
              input: "in-l",
              state: "queued",
            }),
            said(3, "outcome", minutesAgo(12), { of: "in-l", state: "delivered" }),
            said(4, "reply", minutesAgo(11), { messageId: "m-long", text: LONG_REPLY }),
          ],
        ],
      ]),
    ),
  },
  "thread-asleep": {
    reading: transcriptReadingOf(
      [run("run-kiwi", HATCH, true)],
      new Map([
        [
          "run-kiwi",
          [
            said(1, "run", minutesAgo(60 * 5), { runtimeRunId: "run-kiwi", fresh: true }),
            said(2, "reply", minutesAgo(60 * 5 - 2), {
              messageId: "m-kiwi",
              text: "The tests in packages/fieldd are done: two fail, both in the kill matrix.",
            }),
          ],
        ],
      ]),
    ),
  },
  "thread-earlier": { reading: READ_JUNO_WHOLE, earlier: true },
  "thread-receipts": {
    reading: transcriptReadingOf(
      [run("run-juno", HATCH, true)],
      new Map([["run-juno", RECEIPT_LINES]]),
    ),
    pending: [
      {
        requestId: "say-pending-1",
        text: "and tell me when it's done",
        chips: [],
        at: minutesAgo(1),
        state: "queued",
      },
    ],
  },
  "thread-thinking": {
    reading: transcriptReadingOf(
      [run("run-juno", HATCH, true)],
      new Map([
        [
          "run-juno",
          [
            said(1, "run", minutesAgo(30), { runtimeRunId: "run-juno", fresh: true }),
            said(2, "you", minutesAgo(2), {
              via: "chat",
              text: ASKED_WORDS,
              input: "in-t",
              state: "queued",
            }),
            said(3, "outcome", minutesAgo(2), { of: "in-t", state: "delivered" }),
          ],
        ],
      ]),
    ),
    pending: [
      {
        requestId: "say-thinking-1",
        text: "and the phone's too",
        chips: [],
        at: minutesAgo(0),
        state: "queued",
      },
    ],
  },
  "thread-honest": {
    reading: transcriptReadingOf(
      [run("run-juno", minutesAgo(30), false)],
      new Map([
        [
          "run-juno",
          [
            said(1, "run", minutesAgo(30), { runtimeRunId: "run-juno", fresh: false }),
            said(2, "reply", minutesAgo(25), {
              messageId: "m-h1",
              text: "Started the review loop.",
            }),
            said(3, "gap", minutesAgo(10), { since: minutesAgo(20) }),
            said(4, "reply", minutesAgo(9), { messageId: "m-h2", text: "The loop is clean." }),
          ],
        ],
      ]),
      { dropped: 1 },
    ),
  },
  "thread-reading": { reading: { state: "reading" } },
  "thread-unreadable": { reading: { state: "unreadable", reason: FIELDD_GONE } },
  "thread-hello": {
    reading: transcriptReadingOf(
      [run("run-polaris", minutesAgo(0), true)],
      new Map([
        [
          "run-polaris",
          [said(1, "run", minutesAgo(0), { runtimeRunId: "run-polaris", fresh: true })],
        ],
      ]),
    ),
  },
};

// ── the needs-you card's plates (CP-3; DESIGN.md §8 "Chat's thread", the needs-you card) ──

/** Vela, awake, with a transcript behind her: the spark whose thread every card plate stands in. */
const VELA = SPARKS[0] as SparkSummary;

/** A session's name as fieldd's `runLabel` gives it (its title, else its row's catalog label, else its id): an untitled
 * run of the catalog's first agent, so its label (DESIGN.md's "Claude Code"). The card says it only for a session
 * Vela's @ does not offer (the agent she started, off the board); fieldd's own reasons say it too. */
const SESSION_NAME = AGENT.label;

/** How Vela's thread names the person's sessions: "vibe-field", "vibe-field·2" and "rosetta", as her @ does. */
export const NEEDS_HANDLES = chatHandlesOf(VELA);

/** One of Vela's open items, as needs.subscribe would say it. */
function velaItem(over: Partial<NeedsItem> & Pick<NeedsItem, "id" | "kind">): NeedsItem {
  return {
    state: "open",
    from: { name: VELA.name, session: "run-vela", spark: VELA.id },
    spark: VELA.id,
    asked: minutesAgo(2),
    ...over,
  };
}

const QUESTION = velaItem({
  id: "ny-platequestion",
  kind: "question",
  words: "Push the fix to main now, or hold it for the review?",
  choices: ["Push", "Hold", NEEDS_CHOICE_WORDS.notNow],
});
const HELD_SEND = velaItem({
  id: "ny-plateheldsend",
  kind: "held-send",
  words: "run the tests in packages/fieldd and tell me what fails",
  count: 3,
  choices: [NEEDS_CHOICE_WORDS.allow, NEEDS_CHOICE_WORDS.notNow],
  to: { session: "run-his-1", name: SESSION_NAME },
});
/** …and one to the second session in a folder of that name, started after the first: "vibe-field·2", as @ says. */
const HELD_SEND_SECOND = velaItem({
  id: "ny-plateheldsend2",
  kind: "held-send",
  words: "review the input queue's restore and say what you'd change",
  choices: [NEEDS_CHOICE_WORDS.allow, NEEDS_CHOICE_WORDS.notNow],
  to: { session: "run-his-2", name: SESSION_NAME },
});
const HELD_SPAWN = velaItem({
  id: "ny-plateheldspawn",
  kind: "held-spawn",
  words: "review the input queue's restore for a forged file",
  choices: [NEEDS_CHOICE_WORDS.allowOneMore, NEEDS_CHOICE_WORDS.notNow],
  agent: AGENT.id,
  folder: "vibe-field",
  live: 8,
});
const AGENT_ASK: NeedsItem = {
  id: "ny-plateagentask",
  kind: "agent-ask",
  state: "open",
  // an agent Vela started, asking in its own pane
  from: { name: SESSION_NAME, session: "run-vela-agent" },
  spark: VELA.id,
  asked: minutesAgo(1),
  ask: "permission",
  tool: "Bash",
  count: 1,
};
/** A kind this build never heard of (a flow's gate, say): drawn, never dropped. */
const UNKNOWN = velaItem({
  id: "ny-plateunknown",
  kind: "gate",
  state: "waiting",
  words: "Push 0.7.25?",
  choices: ["Push", "Hold"],
});

/** Vela as Chat reads her with `items` in the queue (the product's own reading). */
function velaWith(items: readonly NeedsItem[]): SparkEntry {
  const entry = sparkEntriesOf([VELA], ROWS, { items }).find((each) => each.spark.id === VELA.id);
  if (entry === undefined) throw new Error("the fixture spark is not in its own reading");
  return entry;
}

/** The item fieldd hands back once answered: as it was, with its answer. */
function answeredOf(item: NeedsItem, choice: number, over: Partial<NeedsAnswer> = {}): NeedsItem {
  return {
    ...item,
    state: "answered",
    answer: { choice, at: minutesAgo(0), outcome: "done", told: true, ...over },
  };
}

/** One plate: a card as the thread would stand it, by the product's own `needsCardOf`, under Vela's handles. */
export interface NeedsPlate {
  readonly id: string;
  readonly label: string;
  readonly card: NeedsCard;
  /** a thread too narrow for its acts on one row */
  readonly narrow?: boolean;
}

const plate = (
  id: string,
  label: string,
  waiting: readonly NeedsItem[],
  item: NeedsItem,
  act?: NeedsAct,
): NeedsPlate => ({
  id,
  label,
  card: needsCardOf(velaWith(waiting), item, act, { handles: NEEDS_HANDLES }),
});

/** Each kind of item as it waits on you. */
export const NEEDS_KIND_PLATES: readonly NeedsPlate[] = [
  plate("question", "A spark's question, 1 of 3", [QUESTION, HELD_SEND, HELD_SPAWN], QUESTION),
  plate("held-send", "A held send, two more behind it", [HELD_SEND], HELD_SEND),
  plate(
    "held-send-second",
    "A held send to the second vibe-field",
    [HELD_SEND_SECOND],
    HELD_SEND_SECOND,
  ),
  plate("held-spawn", "A held spawn, past the cap", [HELD_SPAWN], HELD_SPAWN),
  plate("agent-ask", "An agent's own ask: Show", [AGENT_ASK], AGENT_ASK),
  plate("unknown", "A kind this build does not know", [UNKNOWN], UNKNOWN),
];

/** What an answer does to it: running, refused while it waits and once it no longer does, and answered here three
 * ways. */
export const NEEDS_ANSWER_PLATES: readonly NeedsPlate[] = [
  plate("busy", "Answering", [HELD_SEND], HELD_SEND, { state: "busy", choice: 0 }),
  plate("refused", "Refused", [QUESTION], QUESTION, {
    state: "refused",
    reason: "fieldd is not answering (the daemon is restarting)",
  }),
  plate("refused-gone", "Refused, answered in another window", [], QUESTION, {
    state: "refused",
    reason: "already answered: Hold",
  }),
  plate("done", "Answered", [], answeredOf(QUESTION, 0), { state: "said", choice: 0 }),
  plate(
    "failed",
    "Answered, the act not done",
    [],
    answeredOf(HELD_SPAWN, 0, { outcome: "failed", reason: "the agent's sign-in has expired" }),
    { state: "said", choice: 0 },
  ),
  plate(
    "unheard",
    "Answered, not heard yet",
    [],
    answeredOf(QUESTION, 0, { told: false, waits: "Vela's session is not running yet" }),
    { state: "said", choice: 0 },
  ),
  { ...plate("narrow", "A narrow thread", [HELD_SPAWN], HELD_SPAWN), narrow: true },
];

/** The live plate's queue: three of Vela's items, answered by a fixture door after a beat. */
export const NEEDS_LIVE_ITEMS: readonly NeedsItem[] = [QUESTION, HELD_SEND, HELD_SPAWN];

/** Vela's reading with what is left of the live plate's queue. */
export const needsLiveEntryOf = (items: readonly NeedsItem[]): SparkEntry => velaWith(items);

/** What the fixture door hands back for each live item: the question done; the send's Allow not done (its session
 * ended); the spawn's Allow one more done while Vela sleeps, so she has not heard it. Not now is done for each. */
export function needsLiveAnswerOf(item: NeedsItem, choice: number): NeedsItem {
  const kind = needsKindOf(item);
  if (kind === "held-send" && choice === 0)
    return answeredOf(item, choice, { outcome: "failed", reason: `${SESSION_NAME} ended` });
  if (kind === "held-spawn" && choice === 0)
    return answeredOf(item, choice, { told: false, waits: "Vela's session is not running yet" });
  return answeredOf(item, choice);
}
