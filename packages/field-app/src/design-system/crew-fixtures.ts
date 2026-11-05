import type {
  AgentFieldRow,
  ComposeSparksCrewsFrame,
  CrewId,
  NeedsItem,
  SparkCrew,
  SparkCrewMember,
  SparkSummary,
} from "@vibefield/contracts";
import { sessionHandlesOf } from "../chat/at-rows";
import { type CrewCard, crewCardsOf, crewsOfFlow } from "../chat/crew-card";
import type { CrewsReading } from "../chat/crews-port";
import { type NeedsCard, needsCardOf } from "../chat/needs-card";
import { type SparkEntry, sparkEntriesOf } from "../chat/spark-status";
import type { BoardRows } from "../chat/sparks-feed";
import { transcriptItemsOf } from "../chat/transcript-items";
import { type TranscriptReading, transcriptReadingOf } from "../chat/transcript-port";
import {
  FIXTURE_AGENT,
  FIXTURE_HATCH,
  FIXTURE_NOW,
  FIXTURE_PROFILE_SETS,
  FIXTURE_VELA,
  fixtureLine,
  fixtureMinutesAgo,
  fixtureRow,
  fixtureRun,
} from "./chat-fixtures";

// Chat's crew card on fixtures (SP-1e2's renderer half; DESIGN.md §8 "Chat's crew card"; docs/UI_SYSTEM.md): what
// fieldd would answer — Vela's record lines (its crews' act lines among them), the crews it keeps, the field board's
// rows — run through the PRODUCT's own readings: the record by `transcriptReadingOf` and `transcriptItemsOf`, the
// crews it names by `crewsOfFlow`, each card by `crewCardsOf`, its names by @'s `sessionHandlesOf` over the board and
// the Agent Profiles, Vela by `sparkEntriesOf`, and a member's ask by the needs-you card's `needsCardOf`. Chat's own
// clock, board rows and Vela (`chat-fixtures.ts`), so every plate is dealt as Chat's are.

const ago = fixtureMinutesAgo;
const AGENT = FIXTURE_AGENT;
const VELA_RUN = "run-vela";

/** Vela's crews: the review's four, and, in the two-crew plate, the release notes' one. */
const CREW: CrewId = "cr-4f1c2a9e0b7d";
const LATER: CrewId = "cr-9b3e7d10c2a4";

/** The four members, in the order Vela started them. */
const MEMBERS = ["run-crew-1", "run-crew-2", "run-crew-3", "run-crew-4"] as const;
const OPUS = { model: "Opus 5.5", effort: "high" } as const;

/** A member as fieldd keeps it in the crew's record. */
function member(index: number, over: Partial<SparkCrewMember> = {}): SparkCrewMember {
  return {
    runtimeRunId: MEMBERS[index] ?? `run-crew-${index + 1}`,
    at: ago(12 - index),
    agent: AGENT.id,
    folder: "vibe-field",
    ...OPUS,
    ...over,
  };
}

const crewOf = (members: SparkCrewMember[], id: CrewId = CREW, at = ago(12)): SparkCrew => ({
  id,
  sparkRun: VELA_RUN,
  at,
  members,
});

/** What each member's board row says, by the card's words. */
type Doing = "starting" | "working" | "needs" | "done";

/** A member's row on the board: its crew on its origin, its folder's name, its model once named. */
function memberRow(
  index: number,
  doing: Doing,
  over: Partial<AgentFieldRow> = {},
  crew: CrewId = CREW,
): AgentFieldRow {
  const id = MEMBERS[index] ?? `run-crew-${index + 1}`;
  return fixtureRow({
    runtimeRunId: id,
    origin: { by: "spark", spark: FIXTURE_VELA.id, crew },
    project: { name: "vibe-field" },
    createdAt: ago(12 - index),
    lastActivityAt: ago(1),
    ...(doing === "starting"
      ? { turnedAt: null }
      : {
          turnedAt: ago(11 - index),
          model: { id: "opus-5-5", displayName: OPUS.model },
          effort: { value: OPUS.effort },
        }),
    ...(doing === "working" ? { status: "working" } : {}),
    ...(doing === "needs"
      ? {
          status: "blocked",
          blockers: [{ id: `q-${id}`, kind: "question", since: ago(1) }],
        }
      : {}),
    terminal: { hosted: "local", runtimeSessionId: `pty-${id}` },
    ...over,
  });
}

/** Vela's own run, awake and idle: it has started its crew and waits on it. */
const VELA_ROW = fixtureRow({
  runtimeRunId: VELA_RUN,
  spark: FIXTURE_VELA.id,
  origin: { by: "you" },
  lastActivityAt: ago(10),
  turnedAt: ago(60),
});

/** Vela asleep: its session stopped, its run off the board. */
const VELA_ASLEEP: SparkSummary = {
  ...FIXTURE_VELA,
  session: { runtimeRunId: VELA_RUN, live: false },
};

/** Vela's conversation: your ask, the crew's act line, its reply; the two-crew plate adds a later ask and its one. */
function linesOf(act: string, later?: string): unknown[] {
  const lines: unknown[] = [
    fixtureLine(1, "run", FIXTURE_HATCH, { runtimeRunId: VELA_RUN, fresh: true }),
    fixtureLine(2, "you", ago(13), {
      via: "chat",
      text: "Review ds/c in four parts: fieldd, field-app, contracts and the docs",
      input: "in-crew-1",
      state: "queued",
    }),
    fixtureLine(3, "outcome", ago(13), { of: "in-crew-1", state: "delivered" }),
    fixtureLine(4, "act", ago(12), { what: "crew", text: act, crew: CREW }),
    fixtureLine(5, "reply", ago(11), {
      messageId: "m-crew-1",
      text: "Four agents are on it, one part each. I'll tell you as each one finishes.",
    }),
  ];
  if (later !== undefined)
    lines.push(
      fixtureLine(6, "you", ago(4), {
        via: "chat",
        text: "And draft the release notes while they work",
        input: "in-crew-2",
        state: "queued",
      }),
      fixtureLine(7, "outcome", ago(4), { of: "in-crew-2", state: "delivered" }),
      fixtureLine(8, "act", ago(3), { what: "crew", text: later, crew: LATER }),
    );
  return lines;
}

const readingOf = (act: string, later?: string): TranscriptReading =>
  transcriptReadingOf(
    [fixtureRun(VELA_RUN, FIXTURE_HATCH, true)],
    new Map([[VELA_RUN, linesOf(act, later)]]),
  );

const STARTED = "Started 4 agents · Opus 5.5 · high";

const ready = (crews: SparkCrew[]): CrewsReading => ({
  state: "ready",
  frame: { spark: FIXTURE_VELA.id, crews, waiting: [] },
});

/** One plate: Vela's flow with its crews' cards, the item at its foot if one waits, named under it. */
export interface CrewPlate {
  readonly id: string;
  readonly label: string;
  readonly entry: SparkEntry;
  readonly reading: TranscriptReading;
  readonly cards: ReadonlyMap<string, CrewCard>;
  /** a member's ask, held at the foot (TH-Q26 (a)) */
  readonly foot: NeedsCard | null;
  /** a narrow thread */
  readonly narrow?: boolean;
}

interface PlateInputs {
  readonly act?: string;
  readonly later?: string;
  readonly crews: CrewsReading;
  readonly rows: BoardRows;
  readonly asleep?: boolean;
  readonly items?: readonly NeedsItem[];
  readonly seen?: readonly string[];
  readonly narrow?: boolean;
}

/** A plate, by the product's own readings of its fixtures. */
function plate(id: string, label: string, inputs: PlateInputs): CrewPlate {
  const spark = inputs.asleep === true ? VELA_ASLEEP : FIXTURE_VELA;
  const board = Array.isArray(inputs.rows) ? inputs.rows : [];
  const own = inputs.asleep === true ? [] : [VELA_ROW];
  const entry = sparkEntriesOf([spark], [...own, ...board], { items: inputs.items ?? [] })[0];
  if (entry === undefined) throw new Error("the fixture spark is not in its own reading");
  const reading = readingOf(inputs.act ?? STARTED, inputs.later);
  const flow = transcriptItemsOf({ entry, reading, now: FIXTURE_NOW });
  const rows: BoardRows = Array.isArray(inputs.rows) ? [...own, ...inputs.rows] : inputs.rows;
  const handles = sessionHandlesOf(spark, rows, FIXTURE_PROFILE_SETS);
  const cards = crewCardsOf({
    crews: crewsOfFlow(flow),
    reading: inputs.crews,
    rows,
    handles,
    name: spark.name,
    asleep: !entry.awake,
    seen: new Set(inputs.seen ?? []),
  });
  const item = inputs.items?.[0];
  return {
    id,
    label,
    entry,
    reading,
    cards,
    foot: item === undefined ? null : needsCardOf(entry, item, undefined, { handles }),
    ...(inputs.narrow === true ? { narrow: true } : {}),
  };
}

const FOUR = [member(0), member(1), member(2), member(3)];
/** The members before their rows name a model (SR-Q5 (ii)). */
const UNNAMED = FOUR.map((m) => ({ ...m, model: undefined, effort: undefined }));
const ALL_DOING = (doing: Doing) => MEMBERS.map((_, index) => memberRow(index, doing));
/** A member ended: the record keeps it, named as fieldd named it at its end (CO-Q4 (b), `sessionName`). */
const ENDED = { endedAt: ago(2), name: `${AGENT.label} in vibe-field` } as const;

/** The third member asks Vela's person a question: its ask, held at the foot under the card. */
const MEMBER_ASKS: NeedsItem = {
  id: "ny-crewask0001",
  kind: "agent-ask",
  state: "open",
  from: { name: `${AGENT.label} in vibe-field`, session: "run-crew-3" },
  spark: FIXTURE_VELA.id,
  asked: ago(1),
  ask: "question",
  count: 1,
};

const RUNNING = [
  memberRow(0, "done"),
  memberRow(1, "working"),
  memberRow(2, "needs"),
  memberRow(3, "working"),
];

/** Every still plate, in DESIGN.md's order and then SR-Q11's. */
export const CREW_PLATES: readonly CrewPlate[] = [
  plate("starting", "Starting: no model named yet", {
    act: "Started 4 agents",
    crews: ready([crewOf(UNNAMED)]),
    rows: ALL_DOING("starting"),
  }),
  plate("running", "1 of 4 done, a member's ask at the foot", {
    crews: ready([crewOf(FOUR)]),
    rows: RUNNING,
    items: [MEMBER_ASKS],
  }),
  plate("all-done", "All done", {
    crews: ready([crewOf(FOUR)]),
    rows: ALL_DOING("done"),
  }),
  plate("renumbered", "One ended, the others renumbered", {
    crews: ready([crewOf([member(0, ENDED), ...FOUR.slice(1)])]),
    rows: [memberRow(1, "working"), memberRow(2, "working"), memberRow(3, "done")],
    seen: [...MEMBERS],
  }),
  plate("reload", "After a reload: one done, three ended", {
    crews: ready([crewOf([member(0), member(1, ENDED), member(2, ENDED), member(3, ENDED)])]),
    rows: [memberRow(0, "done")],
  }),
  plate("crews-unreadable", "Its crews unreadable: the bound", {
    crews: { state: "unreadable" },
    rows: RUNNING,
  }),
  plate("board-unreadable", "The board unreadable", {
    crews: ready([crewOf(FOUR)]),
    rows: "failed",
  }),
  plate("asleep", "Vela asleep", {
    crews: ready([crewOf(FOUR)]),
    rows: [
      memberRow(0, "done"),
      memberRow(1, "working"),
      memberRow(2, "working"),
      memberRow(3, "done"),
    ],
    asleep: true,
  }),
  plate("two-crews", "Two crews at their times", {
    later: "Started 1 agent · Opus 5.5 · high",
    crews: ready([crewOf(FOUR), crewOf([member(4, { at: ago(3) })], LATER, ago(3))]),
    rows: [...RUNNING, memberRow(4, "working", { createdAt: ago(3) }, LATER)],
  }),
  // SR-Q11's
  plate("done-ended", "1 of 4 done · 1 ended", {
    crews: ready([crewOf([member(0), member(1, ENDED), member(2), member(3)])]),
    rows: [memberRow(0, "done"), memberRow(2, "working"), memberRow(3, "working")],
    seen: [...MEMBERS],
  }),
  plate("all-ended", "All ended", {
    crews: ready([crewOf(FOUR.map((m) => ({ ...m, ...ENDED })))]),
    rows: [],
  }),
  plate("differ", "Members that differ", {
    act: "Started 4 agents",
    crews: ready([
      crewOf([
        member(0),
        member(1, { model: "Sonnet 5.5", effort: "medium" }),
        member(2),
        member(3),
      ]),
    ]),
    rows: [
      memberRow(0, "working"),
      memberRow(1, "working", {
        model: { id: "sonnet-5-5", displayName: "Sonnet 5.5" },
        effort: { value: "medium" },
      }),
      memberRow(2, "done"),
      memberRow(3, "working"),
    ],
  }),
  plate("no-effort", "A shared model that names no effort", {
    act: "Started 4 agents · Opus 5.5",
    crews: ready([crewOf(FOUR.map((m) => ({ ...m, effort: undefined })))]),
    rows: MEMBERS.map((_, index) =>
      memberRow(index, index === 0 ? "done" : "working", { effort: undefined }),
    ),
  }),
  plate("blind", "Neither door readable", {
    crews: { state: "unreadable" },
    rows: "failed",
  }),
  plate("narrow", "A narrow thread", {
    crews: ready([crewOf(FOUR)]),
    rows: RUNNING,
    narrow: true,
  }),
];

// ── the live plate: a fixture door stepping a crew from starting to "All done" ──

/** One beat of the live crew: the crews door's frame, the board's rows, and the act line fieldd had written by then. */
export interface CrewLiveStep {
  readonly frame: ComposeSparksCrewsFrame;
  readonly rows: readonly AgentFieldRow[];
  readonly reading: TranscriptReading;
}

const step = (
  members: SparkCrewMember[],
  doing: readonly Doing[],
  act = STARTED,
): CrewLiveStep => ({
  frame: { spark: FIXTURE_VELA.id, crews: [crewOf(members)], waiting: [] },
  rows: [VELA_ROW, ...doing.map((each, index) => memberRow(index, each))],
  reading: readingOf(act),
});

/** The live crew's beats, oldest first: four starting, their models named, then done one by one. */
export const CREW_LIVE_STEPS: readonly CrewLiveStep[] = [
  step(UNNAMED, ["starting", "starting", "starting", "starting"], "Started 4 agents"),
  step(FOUR, ["working", "working", "working", "starting"]),
  step(FOUR, ["done", "working", "needs", "working"]),
  step(FOUR, ["done", "done", "working", "working"]),
  step(FOUR, ["done", "done", "done", "working"]),
  step(FOUR, ["done", "done", "done", "done"]),
];

/** The live plate's Vela, its @ handles on a step's board, and its crew's ids. */
export const CREW_LIVE_VELA = FIXTURE_VELA;
export const crewLiveEntryOf = (rows: readonly AgentFieldRow[]): SparkEntry => {
  const entry = sparkEntriesOf([FIXTURE_VELA], rows, { items: [] })[0];
  if (entry === undefined) throw new Error("the fixture spark is not in its own reading");
  return entry;
};
export const crewLiveHandlesOf = (rows: readonly AgentFieldRow[]): ReadonlyMap<string, string> =>
  sessionHandlesOf(FIXTURE_VELA, rows, FIXTURE_PROFILE_SETS);
