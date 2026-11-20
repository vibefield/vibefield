/**
 * SP-1e2's renderer half — Chat's crew card, as data (`chat/crew-card.ts`; DESIGN.md §8 "Chat's crew card", §9 its
 * words): the spark's crews as the window read them, the board's rows and @'s handles, in; each crew's card out. The
 * frame is the contracts' own shape (EL9, the window's side); every word is DESIGN.md's.
 * SP-1e4 (2026-11-19) — the crew's acts: a paused member, the words a row passes through, the members Pause all and
 * Stop all take, and a press's refusal on the foot's line.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFieldRow, CrewId, SparkCrew, SparkCrewMember } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  CREW_STATE_WORDS,
  CREW_WORDS,
  type CrewActRefusal,
  type CrewCard,
  type CrewCardInputs,
  crewCardsOf,
} from "../src/chat/crew-card";
import type { CrewsReading } from "../src/chat/crews-port";

const AT = "2026-11-05T11:00:00.000Z";
const VELA = "sp-vela00000000";
const CREW = "cr-000001" as CrewId;
const LATER = "cr-000002" as CrewId;

const member = (runtimeRunId: string, over: Partial<SparkCrewMember> = {}): SparkCrewMember => ({
  runtimeRunId,
  at: AT,
  agent: "claude",
  folder: "vibe-field",
  model: "Opus 5.5",
  effort: "high",
  ...over,
});

const crewOf = (members: SparkCrewMember[], id: CrewId = CREW): SparkCrew => ({
  id,
  sparkRun: "run-vela",
  at: AT,
  members,
});

function row(runtimeRunId: string, over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  return {
    runtimeRunId,
    revision: 1,
    kind: "claude",
    label: "Claude Code",
    tier: "managed",
    device: "dev-1",
    status: "idle",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    turnedAt: AT,
    origin: { by: "spark", spark: VELA, crew: CREW },
    project: { name: "vibe-field" },
    model: { id: "claude-opus-5-5", displayName: "Opus 5.5" },
    effort: { value: "high" },
    ...over,
  };
}

const FOUR = [member("run-21"), member("run-22"), member("run-23"), member("run-24")];
/** Done, Working, Needs you, Starting */
const ROWS = [
  row("run-21"),
  row("run-22", { status: "working" }),
  row("run-23", { status: "blocked", blockers: [{ id: "q-1", kind: "question", since: AT }] }),
  row("run-24", { turnedAt: null }),
];
const HANDLES = new Map([
  ["run-21", "vibe-field"],
  ["run-22", "vibe-field·2"],
  ["run-23", "vibe-field·3"],
  ["run-24", "vibe-field·4"],
]);

const ready = (crews: SparkCrew[], waiting: { runtimeRunId: string; tasks: number }[] = []) =>
  ({ state: "ready", frame: { spark: VELA, crews, waiting } }) as CrewsReading;

function cardOf(over: Partial<CrewCardInputs> = {}, id: CrewId = CREW): CrewCard {
  const cards = crewCardsOf({
    crews: [CREW],
    reading: ready([crewOf(FOUR)]),
    rows: ROWS,
    handles: HANDLES,
    name: "Vela",
    asleep: false,
    ...over,
  });
  const card = cards.get(id);
  expect(card, `a card for ${id}`).toBeDefined();
  if (card === undefined) throw new Error("no card");
  return card;
}

const states = (card: CrewCard) => card.rows.map((r) => r.state);

describe('the crew card (SP-1e2; DESIGN.md §8 "Chat\'s crew card")', () => {
  it("K1 · its head, its count and ring, and one row per member by start, each with its state, @'s name and its model", () => {
    const card = cardOf();
    expect([card.title, card.dim]).toEqual(["4 agents", " · Opus 5.5 · high"]);
    expect(card.count).toEqual({ words: "1 of 4 done", ring: 0.25, check: false });
    expect(states(card)).toEqual(["done", "working", "needs", "starting"]);
    expect(card.rows.map((r) => r.name)).toEqual([
      "vibe-field",
      "vibe-field·2",
      "vibe-field·3",
      "vibe-field·4",
    ]);
    expect(card.rows.map((r) => r.model)).toEqual(Array(4).fill("Opus 5.5 · high"));
    expect(card.rows.every((r) => r.pressable && r.agent === "claude")).toBe(true);
    expect(card.rows[1]?.label).toBe("vibe-field·2, Opus 5.5, high, Working");
    expect(card.label).toBe("4 agents · Opus 5.5 · high, 1 of 4 done");
    expect(card.line).toBeNull();
    expect(Object.values(CREW_STATE_WORDS)).toEqual([
      "Starting",
      "Working",
      "Needs you",
      "Done",
      "Paused",
      "Ended",
    ]);
  });

  it("K2 · an agent idle between two tasks it was given stays Working, so the count never goes backwards (SPE-Q32 (a))", () => {
    const card = cardOf({ reading: ready([crewOf(FOUR)], [{ runtimeRunId: "run-21", tasks: 1 }]) });
    expect(card.rows[0]?.state).toBe("working");
    expect(card.count.words).toBe("0 of 4 done");
  });

  it("K3 · a member that ended stays, named as fieldd named it, takes no press, and is never counted done (SPE-Q14 (a), SPE-Q31 (a))", () => {
    const ended = [
      member("run-21", { endedAt: AT, name: "Claude Code in vibe-field" }),
      ...FOUR.slice(1),
    ];
    const card = cardOf({ reading: ready([crewOf(ended)]), rows: ROWS.slice(1) });
    expect(card.rows[0]).toMatchObject({
      state: "ended",
      name: "Claude Code in vibe-field",
      pressable: false,
    });
    expect(card.count).toEqual({ words: "0 of 4 done · 1 ended", ring: 0.25, check: false });
    // a member the board, read, no longer holds is Ended before fieldd's end reaches the record (SR-Q5 (i)); one it
    // has not held yet is Starting, since its start can reach the record before its row reaches the board
    expect(cardOf({ rows: ROWS.slice(1), seen: new Set(["run-21"]) }).rows[0]?.state).toBe("ended");
    expect(cardOf({ rows: ROWS.slice(1) }).rows[0]?.state).toBe("starting");
  });

  it("K4 · All done wears its check and no ring; All ended stands alone, no ring and no glyph (J1 at its lean)", () => {
    const idle = FOUR.map((m) => row(m.runtimeRunId));
    expect(cardOf({ rows: idle }).count).toEqual({
      words: CREW_WORDS.allDone,
      ring: null,
      check: true,
    });
    const someEnded = [member("run-21", { endedAt: AT }), ...FOUR.slice(1)];
    expect(cardOf({ reading: ready([crewOf(someEnded)]), rows: idle.slice(1) }).count.words).toBe(
      "All done",
    );
    const allEnded = FOUR.map((m) => ({ ...m, endedAt: AT, name: "Claude Code in vibe-field" }));
    expect(cardOf({ reading: ready([crewOf(allEnded)]), rows: [] }).count).toEqual({
      words: CREW_WORDS.allEnded,
      ring: null,
      check: false,
    });
  });

  it("K5 · names follow @ live; a member @ does not offer is named as VibeField names a session (CO-Q3 (a), SR-Q4 (a))", () => {
    const renumbered = new Map([
      ["run-22", "vibe-field"],
      ["run-23", "vibe-field·2"],
    ]);
    const card = cardOf({ handles: renumbered });
    expect(card.rows.map((r) => r.name)).toEqual([
      "Claude Code in vibe-field",
      "vibe-field",
      "vibe-field·2",
      "Claude Code in vibe-field",
    ]);
  });

  it("K6 · the head says the model they share, the model alone when none names an effort, and the count alone when they differ or one is not named yet (J2 at its lean)", () => {
    const differ = [member("run-21"), member("run-22", { model: "Sonnet 5.5" })];
    const sonnet = { id: "claude-sonnet-5-5", displayName: "Sonnet 5.5" };
    expect(
      cardOf({
        reading: ready([crewOf(differ)]),
        rows: [row("run-21"), row("run-22", { model: sonnet })],
      }).dim,
    ).toBe("");
    const unnamed = [member("run-21"), member("run-22", { model: undefined, effort: undefined })];
    const card = cardOf({
      reading: ready([crewOf(unnamed)]),
      rows: [row("run-21"), row("run-22", { model: undefined, effort: undefined })],
    });
    expect([card.title, card.dim]).toEqual(["2 agents", ""]);
    expect(card.rows[1]?.model).toBeNull();
    const grok = [
      member("run-21", { agent: "grok", model: "Grok 4", effort: undefined }),
      member("run-22", { agent: "grok", model: "Grok 4", effort: undefined }),
    ];
    const grokCard = cardOf({ reading: ready([crewOf(grok)]), rows: [] });
    expect([grokCard.title, grokCard.dim]).toEqual(["2 agents", " · Grok 4"]);
    expect(grokCard.rows[0]?.model).toBe("Grok 4");
  });

  it("K7 · the record's members first, then a board row of this crew the record lacks (R4)", () => {
    const card = cardOf({ rows: [...ROWS, row("run-25", { status: "working" })] });
    expect(card.rows.map((r) => r.runtimeRunId)).toEqual([
      "run-21",
      "run-22",
      "run-23",
      "run-24",
      "run-25",
    ]);
    expect(card.title).toBe("5 agents");
  });
});

describe("when the card cannot know (never a blank)", () => {
  it("U1 · the board unreadable: the rows keep their names and lose their states, and @'s sentence is the line", () => {
    // @ offers no handle while the board cannot be read (`sessionHandlesOf` answers none)
    const card = cardOf({ rows: "failed", handles: new Map() });
    expect(states(card)).toEqual([null, null, null, null]);
    expect(card.rows[0]?.name).toBe("Claude Code in vibe-field");
    expect(card.line).toBe("VibeField can't read what's running right now");
  });

  it("U2 · the crews unreadable: the card stands on the board's rows alone, its count the bound, and says why", () => {
    const card = cardOf({ reading: { state: "unreadable" } });
    expect(card.rows.map((r) => r.runtimeRunId)).toEqual(["run-21", "run-22", "run-23", "run-24"]);
    expect(card.count).toEqual({ words: "4 still running", ring: null, check: false });
    expect(card.line).toBe("VibeField can't read Vela's crews right now");
    // a fieldd without the door: the same card, with no line
    expect(cardOf({ reading: { state: "none" } }).line).toBeNull();
    // neither door readable: the card in its chrome, no rows, its head "Agents" (SR-Q6)
    const blind = cardOf({ reading: { state: "unreadable" }, rows: "failed" });
    expect([blind.title, blind.dim, blind.rows]).toEqual([CREW_WORDS.unnamed, "", []]);
    expect(blind.line).toBe("VibeField can't read Vela's crews right now");
  });

  it("U3 · Vela asleep says its wakes wait, while a member has not ended", () => {
    expect(cardOf({ asleep: true }).line).toBe("Vela is asleep — it hears these when it wakes");
    const allEnded = FOUR.map((m) => ({ ...m, endedAt: AT }));
    expect(cardOf({ asleep: true, reading: ready([crewOf(allEnded)]), rows: [] }).line).toBeNull();
  });

  it("U4 · a crew the reading does not name has no card, so its line stands alone (SPE-Q28 (b), SR-Q3); nothing while reading", () => {
    const cards = crewCardsOf({
      crews: [CREW, LATER],
      reading: ready([crewOf(FOUR)]),
      rows: ROWS,
      handles: HANDLES,
      name: "Vela",
      asleep: false,
    });
    expect([...cards.keys()]).toEqual([CREW]);
    const reading = crewCardsOf({
      crews: [CREW],
      reading: { state: "reading" },
      rows: ROWS,
      handles: HANDLES,
      name: "Vela",
      asleep: false,
    });
    expect(reading.size).toBe(0);
  });
});

describe("the crew's acts (SP-1e4; DESIGN.md §8 'Chat's crew card', 'The crew's acts')", () => {
  /** fieldd's durable stop for a member's turn (`AgentStopState`, ST-D5): sent, heard, or one it takes no further */
  const SENT = { sentAt: AT, stage: "sent" };
  const HEARD = { sentAt: AT, stage: "heard", heardBy: "status" };
  const UNHEARD = { sentAt: AT, stage: "resent", unheardAt: AT };
  /** what the controller holds: the members a Stop all press sent to end, and the last press's refusal */
  const held = (stopping: readonly string[] = [], refusal: CrewActRefusal | null = null) => ({
    stopping: new Set(stopping),
    refusal,
  });
  const NONE = { stop: [], pause: [] };

  it("A1 · a member whose turn Pause all paused reads Paused, done not yet and at work no longer (S5)", () => {
    const rows = [
      row("run-21"),
      row("run-22", { stop: HEARD }),
      row("run-23"),
      row("run-24", { status: "working" }),
    ];
    const card = cardOf({ rows });
    expect(states(card)).toEqual(["done", "paused", "done", "working"]);
    expect(card.rows[1]?.label).toBe("vibe-field·2, Opus 5.5, high, Paused");
    expect(card.count).toEqual({ words: "2 of 4 done · 1 paused", ring: 0.75, check: false });
    expect(card.label).toBe("4 agents · Opus 5.5 · high, 2 of 4 done · 1 paused");
    // read before the waiting-tasks rule: a paused member with a task left in its input is Paused, never Working
    const waiting = ready([crewOf(FOUR)], [{ runtimeRunId: "run-22", tasks: 1 }]);
    expect(cardOf({ rows, reading: waiting }).rows[1]?.state).toBe("paused");
    // a paused member is never done: the ring is full, and the count is no All done
    const rest = [row("run-21"), row("run-22", { stop: HEARD }), row("run-23"), row("run-24")];
    expect(cardOf({ rows: rest }).count).toEqual({
      words: "3 of 4 done · 1 paused",
      ring: 1,
      check: false,
    });
  });

  it("A2 · with a member ended too, the count's words come in their order, the ended before the paused", () => {
    const ended = [
      member("run-21", { endedAt: AT, name: "Claude Code in vibe-field" }),
      ...FOUR.slice(1),
    ];
    const card = cardOf({
      reading: ready([crewOf(ended)]),
      rows: [row("run-22", { stop: HEARD }), row("run-23"), row("run-24", { status: "working" })],
    });
    expect(states(card)).toEqual(["ended", "paused", "done", "working"]);
    expect(card.count).toEqual({
      words: "1 of 4 done · 1 ended · 1 paused",
      ring: 0.75,
      check: false,
    });
  });

  it("A3 · a turn whose stop fieldd sent and has not heard reads Pausing current turn… in its state's place, from fieldd's record, so a reload keeps it (S2)", () => {
    const pausing = row("run-22", { status: "working", stop: SENT });
    const card = cardOf({ rows: [row("run-21"), pausing, ...ROWS.slice(2)] });
    expect(card.rows[1]).toMatchObject({
      state: "working",
      passing: "pausing",
      label: "vibe-field·2, Opus 5.5, high, Pausing current turn…",
    });
    // fieldd's stages are open words: sent again, terminating, or one this build never heard, each still pausing
    for (const stage of ["resent", "terminating", "queued"]) {
      const again = { ...pausing, stop: { sentAt: AT, stage } };
      expect(cardOf({ rows: [row("run-21"), again, ...ROWS.slice(2)] }).rows[1]?.passing).toBe(
        "pausing",
      );
    }
    // a stop on a member whose turn is not at work says nothing in its state's place
    const idle = row("run-22", { stop: SENT });
    expect(cardOf({ rows: [row("run-21"), idle, ...ROWS.slice(2)] }).rows[1]?.passing).toBeNull();
  });

  it("A4 · a stop fieldd takes no further reads Still running in its state's place (S6)", () => {
    const still = row("run-22", { status: "working", stop: UNHEARD });
    const card = cardOf({ rows: [row("run-21"), still, ...ROWS.slice(2)] });
    expect(card.rows[1]).toMatchObject({
      state: "working",
      passing: "still",
      label: "vibe-field·2, Opus 5.5, high, Still running",
    });
  });

  it("A5 · a member a Stop all press sent to end reads Stopping agent… until it reads Ended (S1)", () => {
    const stopping = held(["run-22", "run-24"]);
    const still = row("run-22", { status: "working", stop: UNHEARD });
    const card = cardOf({ acts: stopping, rows: [row("run-21"), still, ...ROWS.slice(2)] });
    // the newer act's words win over a pause's, and a Starting member passes through them too
    expect(card.rows.map((r) => r.passing)).toEqual([null, "stopping", null, "stopping"]);
    expect(card.rows[1]?.label).toBe("vibe-field·2, Opus 5.5, high, Stopping agent…");
    // ended: the state's own word again, under the name fieldd gave it at its end
    const ended = [
      member("run-21"),
      member("run-22", { endedAt: AT, name: "Claude Code in vibe-field" }),
      ...FOUR.slice(2),
    ];
    const after = cardOf({
      acts: stopping,
      reading: ready([crewOf(ended)]),
      rows: [row("run-21"), ...ROWS.slice(2)],
    });
    expect(after.rows[1]).toMatchObject({
      state: "ended",
      passing: null,
      label: "Claude Code in vibe-field, Opus 5.5, high, Ended",
    });
  });

  it("A6 · Stop all takes each member Working or Starting, Pause all each Working member's turn; both pass over Needs you, Done, Paused and Ended, and never take the spark's own run", () => {
    const own = row("run-vela", { status: "working", spark: VELA, origin: { by: "you" } });
    const card = cardOf({ rows: [...ROWS, own] });
    expect(card.acts).toEqual({ stop: ["run-22", "run-24"], pause: ["run-22"] });
    // a member already passing: Stop all passes over one stopping, Pause all over one pausing, stopping or still
    const passing = [
      row("run-21", { status: "working", stop: SENT }),
      row("run-22", { status: "working" }),
      row("run-23", { stop: HEARD }),
      row("run-24", { status: "working", stop: UNHEARD }),
    ];
    expect(cardOf({ rows: passing, acts: held(["run-22"]) }).acts).toEqual({
      stop: ["run-21", "run-24"],
      pause: [],
    });
    // idle between two tasks it was given: Working (SPE-Q32 (a)), so Stop all takes it, with no turn to pause
    const between = cardOf({
      reading: ready([crewOf(FOUR)], [{ runtimeRunId: "run-21", tasks: 1 }]),
    });
    expect(between.acts).toEqual({ stop: ["run-21", "run-22", "run-24"], pause: ["run-22"] });
  });

  it("A7 · the acts stand while a member is at work, and leave once none is (S7)", () => {
    expect(cardOf().atWork).toBe(true);
    const idle = FOUR.map((m) => row(m.runtimeRunId));
    expect(cardOf({ rows: idle })).toMatchObject({ atWork: false, acts: NONE });
    const paused = [row("run-21"), row("run-22", { stop: HEARD }), row("run-23"), row("run-24")];
    expect(cardOf({ rows: paused })).toMatchObject({ atWork: false, acts: NONE });
    // one that waits on you is at work, though both acts pass it over
    const asks = row("run-23", {
      status: "blocked",
      blockers: [{ id: "q-1", kind: "question", since: AT }],
    });
    const waits = cardOf({ rows: [row("run-21"), row("run-22"), asks, row("run-24")] });
    expect([waits.atWork, waits.acts]).toEqual([true, NONE]);
    // the board unreadable: no state, so no act
    expect(cardOf({ rows: "failed", handles: new Map() })).toMatchObject({
      atWork: false,
      acts: NONE,
    });
  });

  it("A8 · a press's refusal is the foot's line, the first one alone, before every other line (S8)", () => {
    const words = CREW_WORDS.couldntStop("vibe-field·2", CREW_WORDS.noTerminal);
    expect(words).toBe("Couldn't stop vibe-field·2: it has no terminal on this desktop");
    const stop = held([], { crew: CREW, words });
    expect(cardOf({ asleep: true, acts: stop }).line).toBe(words);
    expect(cardOf({ reading: { state: "unreadable" }, acts: stop }).line).toBe(words);
    const pause = CREW_WORDS.couldntPause("vibe-field·2", "not-working");
    expect(pause).toBe("Couldn't pause vibe-field·2's turn: not-working");
    const failed = cardOf({
      rows: "failed",
      handles: new Map(),
      acts: held([], { crew: CREW, words: pause }),
    });
    expect(failed.line).toBe(pause);
    // another crew's refusal is that card's line, never this one's
    const other = held([], { crew: LATER, words });
    expect(cardOf({ asleep: true, acts: other }).line).toBe(
      "Vela is asleep — it hears these when it wakes",
    );
  });

  it("A9 · says, of the acts, exactly the words the canon records (§9 'Chat's words'; a guard, green before the acts)", () => {
    // the doc wraps its lines; a sentence is the same sentence across a wrap
    const here = dirname(fileURLToPath(import.meta.url));
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    for (const said of [
      `"${CREW_WORDS.pauseAll}" · "${CREW_WORDS.stopAll}"`,
      `"${CREW_WORDS.pausing}" · "${CREW_WORDS.stopping}" · "${CREW_WORDS.stillRunning}"`,
      `the state "${CREW_STATE_WORDS.paused}"`,
      `the count "${CREW_WORDS.donePaused(2, 4, 0, 1)}"`,
      `"${CREW_WORDS.couldntStop("vibe-field·2", "…")}"`,
      `"${CREW_WORDS.couldntPause("vibe-field·2", "…")}"`,
    ]) {
      expect(design, said).toContain(said);
    }
  });
});
