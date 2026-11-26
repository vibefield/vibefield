// @vitest-environment happy-dom
/**
 * Item 550 (2026-11-18) — THE AT-WORK MARK'S WORDS (DESIGN.md §9 "The desk's at-work words", §2.10 "Its status is the
 * one Chat reads", §8 "At work on the mat"). One row per sentence §9 sets: the board's names for each state, in a
 * project and in none, a crew run's "for ‹spark›", a spark's own line with its status's word; the chip's parts and
 * words for an agent ("Needs you", "Failed"), a crew run and a spark; "+N"; an unknown agent said by its id itself, as
 * the window names it elsewhere (`agentLabel`), and never by its run's handle. A spark's word is its status as Chat's
 * list holds it — never one mapped from its row — and while the list does not hold the spark its line has no word; its
 * chip stands at S-4's four and at Failed, and never says an agent's "Needs you". Agent ids come from the catalog by
 * place, never spelled. Red first: each row says what the words must say.
 */
import { AGENT_CATALOG, type AtWorkState } from "@vibefield/contracts";
import {
  SPARK_NEEDS_YOU,
  SPARK_STATUSES,
  type SparkStatus,
  sparkStatusWord,
} from "@vibefield/design-kit/spark-face";
import { describe, expect, it } from "vitest";
import type { AtWorkRow } from "../src/field/desk/at-work/at-work-rows";
import type { AtWorkBoard } from "../src/field/desk/at-work/at-work-store";
import {
  AT_WORK_CHIP_INKS,
  AT_WORK_WORDS,
  type AtWorkChipParts,
  type AtWorkChipState,
  type AtWorkWordSources,
  atWorkAgentName,
  atWorkChipOf,
  atWorkChipText,
  atWorkNamesOf,
  atWorkSentence,
  isAtWorkSparkUrgent,
  isAtWorkUrgent,
} from "../src/field/desk/at-work/at-work-words";
import { agentLabel } from "../src/frame/peek-model";

const FIRST = AGENT_CATALOG[0];
const SECOND = AGENT_CATALOG[1];
if (FIRST === undefined || SECOND === undefined) throw new Error("the catalog has two agents");
const VELA = "sp-vela0001";
const LYRA = "sp-lyra0002";
const UNKNOWN = "zephyr";

const row = (
  run: string,
  state: AtWorkState,
  extra: Partial<Pick<AtWorkRow, "agent" | "project" | "spark" | "startedBy">> = {},
): AtWorkRow => ({
  run,
  handle: `${run}-handle-in-vibe-field`,
  agent: FIRST.id,
  state,
  since: 1,
  ...extra,
});

const IN_VIBE_FIELD = { project: { name: "vibe-field", seq: 3 } } as const;

const boardOf = (rows: readonly AtWorkRow[]): AtWorkBoard => ({
  docId: "doc-1",
  objects: new Map([["k1", { ref: "vf:obj/k1000000", key: "k1", agents: rows }]]),
  landed: new Map(),
  epoch: 0,
});

/** Chat's list holding Vela at `status` (Lyra it holds by no name), or holding no spark at all. */
const holding = (status: SparkStatus | null): ReadonlyMap<string, SparkStatus> =>
  status === null ? new Map() : new Map([[VELA, status]]);

/** Sources that know Vela's name (not Lyra's), the object as "Q3 plan", and the statuses Chat's list holds. */
const sourcesOf = (statuses: ReadonlyMap<string, SparkStatus> = new Map()): AtWorkWordSources => ({
  sparkName: (spark) => (spark === VELA ? "Vela" : null),
  thingOf: (key) => (key === "k1" ? "Q3 plan" : null),
  sparkStatus: (spark) => statuses.get(spark) ?? null,
});

const said = (r: AtWorkRow, sources = sourcesOf()): string | undefined =>
  atWorkSentence(r, "k1", sources)?.text;

/** A chip the words stand: every row that reads one here expects it to stand. */
function chipOf(
  r: AtWorkRow,
  state: AtWorkChipState,
  sources: AtWorkWordSources = sourcesOf(),
): AtWorkChipParts {
  const chip = atWorkChipOf(r, state, sources);
  if (chip === null) throw new Error(`no chip for ${r.run}`);
  return chip;
}

describe("the board's names: one line for each agent at work (§9)", () => {
  const who = `${FIRST.label} in vibe-field`;
  it.each([
    ["open", `${who} has Q3 plan open`],
    ["reading", `${who} is reading Q3 plan`],
    ["acting", `${who} is changing Q3 plan`],
    ["needs-you", `${who} needs you on Q3 plan`],
    ["paused", `${who} is paused: you have Q3 plan`],
    ["failed", `${who}: an act on Q3 plan failed`],
  ] as const)("says %s as §9 sets it", (state, line) => {
    expect(said(row("r1", state, IN_VIBE_FIELD))).toBe(line);
  });

  it('leaves out "in ‹project›" for a run in no project, and for a project with no name', () => {
    expect(said(row("r1", "reading"))).toBe(`${FIRST.label} is reading Q3 plan`);
    expect(said(row("r1", "reading", { project: { seq: 4 } }))).toBe(
      `${FIRST.label} is reading Q3 plan`,
    );
  });

  it("ends a crew run's line with the spark it works for, in every state", () => {
    const crew = { agent: SECOND.id, startedBy: VELA, ...IN_VIBE_FIELD } as const;
    expect(said(row("r2", "reading", crew))).toBe(
      `${SECOND.label} in vibe-field is reading Q3 plan for Vela`,
    );
    expect(said(row("r2", "failed", crew))).toBe(
      `${SECOND.label} in vibe-field: an act on Q3 plan failed for Vela`,
    );
    // a spark not read yet: no name is made up
    expect(said(row("r2", "reading", { ...crew, startedBy: LYRA }))).toBe(
      `${SECOND.label} in vibe-field is reading Q3 plan`,
    );
  });

  it('names an object the desk does not hold as "an object"', () => {
    expect(atWorkSentence(row("r1", "open"), "elsewhere", sourcesOf())?.text).toBe(
      `${FIRST.label} has an object open`,
    );
  });

  it("says a leaving row nothing, and is urgent at needs you and failed alone", () => {
    expect(atWorkSentence(row("r1", "released"), "k1", sourcesOf())).toBeNull();
    const states: readonly AtWorkState[] = [
      "open",
      "reading",
      "acting",
      "needs-you",
      "paused",
      "failed",
      "released",
    ];
    expect(states.filter(isAtWorkUrgent)).toEqual(["needs-you", "failed"]);
    expect(atWorkSentence(row("r1", "needs-you"), "k1", sourcesOf())?.urgent).toBe(true);
    expect(atWorkSentence(row("r1", "acting"), "k1", sourcesOf())?.urgent).toBe(false);
  });

  it("lists every name on a board in the feed's order, a leaving one left out", () => {
    const board = boardOf([
      row("r1", "reading", IN_VIBE_FIELD),
      row("gone", "released"),
      row("r2", "open", { agent: SECOND.id }),
    ]);
    expect(atWorkNamesOf(board, sourcesOf()).map((name) => [name.run, name.key])).toEqual([
      ["r1", "k1"],
      ["r2", "k1"],
    ]);
  });
});

describe("a spark's own line: its status as Chat's list holds it (§9, §2.10)", () => {
  const own = (state: AtWorkState = "acting"): AtWorkRow => row("s1", state, { spark: VELA });

  it('says "‹spark› on ‹object›: ‹its status\'s word›" — Asking you, Needs your OK', () => {
    expect(said(own("needs-you"), sourcesOf(holding("asking")))).toBe(
      "Vela on Q3 plan: Asking you",
    );
    expect(said(own("needs-you"), sourcesOf(holding("approval")))).toBe(
      "Vela on Q3 plan: Needs your OK",
    );
  });

  it("says no word while Chat's list does not hold the spark", () => {
    expect(said(own("needs-you"), sourcesOf(holding(null)))).toBe("Vela on Q3 plan");
    // nor a name: the list holds neither
    expect(said(row("s2", "open", { spark: LYRA }), sourcesOf(holding("asking")))).toBe(
      "A spark on Q3 plan",
    );
  });

  it("reads the status, never the row: acting says Chat's word, and a row's needs you is not the spark's", () => {
    expect(said(own("acting"), sourcesOf(holding("reviewing")))).toBe("Vela on Q3 plan: Reading");
    expect(said(own("acting"), sourcesOf(holding("running")))).toBe("Vela on Q3 plan: Running");
    const asked = atWorkSentence(own("needs-you"), "k1", sourcesOf(holding("thinking")));
    expect(asked?.text).toBe("Vela on Q3 plan: Thinking");
    expect(asked?.urgent).toBe(false);
  });

  it("says every one of the nineteen by its own word", () => {
    for (const { id, word } of SPARK_STATUSES)
      expect(said(own(), sourcesOf(holding(id)))).toBe(`Vela on Q3 plan: ${word}`);
  });

  it("is urgent — said aloud — while Chat holds it at S-4's four or at Failed, never at Reading", () => {
    const urgent = SPARK_STATUSES.map(({ id }) => id).filter(isAtWorkSparkUrgent);
    expect(urgent).toEqual(["asking", "approval", "stuck", "limited", "failed"]);
    expect(urgent.filter((status) => status !== "failed")).toEqual([...SPARK_NEEDS_YOU]);
    expect(isAtWorkSparkUrgent(null)).toBe(false);
    for (const [status, urgentNow] of [
      ["stuck", true],
      ["limited", true],
      ["failed", true],
      ["reviewing", false],
    ] as const)
      expect(atWorkSentence(own(), "k1", sourcesOf(holding(status)))?.urgent).toBe(urgentNow);
  });
});

describe("an agent the catalog does not hold: its id itself, as the window names it, never its handle (§9: never on screen)", () => {
  it("says it in the names and on the chip", () => {
    const unknown = row("r9", "needs-you", { agent: UNKNOWN, ...IN_VIBE_FIELD });
    expect(atWorkAgentName(UNKNOWN)).toBe(UNKNOWN);
    // the window's own rule for an agent's name (the Peek's `agentLabel`), never a word of the mark's own
    expect(atWorkAgentName(UNKNOWN)).toBe(agentLabel(UNKNOWN));
    expect(Object.keys(AT_WORK_WORDS)).not.toContain("agent");
    const line = said(unknown) ?? "";
    expect(line).toBe("zephyr in vibe-field needs you on Q3 plan");
    const chip = atWorkChipText(chipOf(unknown, "needs-you"));
    expect(chip).toBe("zephyr · vibe-field · Needs you");
    expect(atWorkChipText(chipOf(row("r9", "needs-you", { agent: UNKNOWN }), "needs-you"))).toBe(
      "zephyr · Needs you",
    );
    for (const words of [line, chip]) {
      expect(words).not.toContain(unknown.handle);
      expect(words).not.toContain("handle");
      expect(words).not.toContain(unknown.run);
      expect(words).not.toContain("An agent");
    }
  });

  it("says every catalog agent by its label, looked up by its id", () => {
    for (const entry of AGENT_CATALOG) expect(atWorkAgentName(entry.id)).toBe(entry.label);
  });
});

describe("the chip on the line's glass (§9, §8)", () => {
  it("is ‹name› · ‹project› · Needs you, the agent's mark first, the project's deal for its folder", () => {
    const chip = chipOf(row("r1", "needs-you", IN_VIBE_FIELD), "needs-you");
    expect(chip).toEqual({
      mark: { agent: FIRST.id },
      face: null,
      name: FIRST.label,
      project: { name: "vibe-field", seq: 3 },
      role: null,
      word: "Needs you",
      state: "needs-you",
    });
    expect(atWorkChipText(chip)).toBe(`${FIRST.label} · vibe-field · Needs you`);
  });

  it('says a failure as "Failed", and leaves out a project it cannot name', () => {
    const chip = chipOf(row("r1", "failed"), "failed");
    expect(atWorkChipText(chip)).toBe(`${FIRST.label} · Failed`);
    expect(chip.project).toBeNull();
    const undealt = chipOf(row("r1", "failed", { project: { name: "garden" } }), "failed");
    expect(undealt.project).toEqual({ name: "garden", seq: null });
  });

  it("speaks the desk's one vocabulary: Needs you as the desk says it, Failed as a spark's status says it", () => {
    expect(AT_WORK_WORDS.chip).toEqual({ "needs-you": "Needs you", failed: "Failed" });
    expect(AT_WORK_WORDS.chip.failed).toBe(sparkStatusWord("failed"));
  });

  it("adds \"· ‹spark›'s crew\" before the word on a crew run's", () => {
    const crew = row("r2", "needs-you", { agent: SECOND.id, startedBy: VELA, ...IN_VIBE_FIELD });
    expect(atWorkChipText(chipOf(crew, "needs-you"))).toBe(
      `${SECOND.label} · vibe-field · Vela's crew · Needs you`,
    );
  });

  it("reads \"‹spark› · spark · ‹its status's word›\" on a spark's own, its face in that status", () => {
    const own = row("s1", "acting", { spark: VELA, ...IN_VIBE_FIELD });
    const asking = chipOf(own, "needs-you", sourcesOf(holding("asking")));
    expect(asking.mark).toEqual({ spark: VELA });
    expect(asking.face).toBe("asking");
    expect(asking.project).toBeNull();
    expect(atWorkChipText(asking)).toBe("Vela · spark · Asking you");
    for (const [status, word] of [
      ["approval", "Needs your OK"],
      ["stuck", "Stuck"],
      ["limited", "Rate limited"],
    ] as const)
      expect(atWorkChipText(chipOf(own, "needs-you", sourcesOf(holding(status))))).toBe(
        `Vela · spark · ${word}`,
      );
    const failed = chipOf(own, "failed", sourcesOf(holding("failed")));
    expect(atWorkChipText(failed)).toBe("Vela · spark · Failed");
    expect(failed.face).toBe("failed");
  });

  it("in the moment Chat has moved on and the layer has not stepped yet: Failed still stands its 2.4 s, a spark's needs-you chip none", () => {
    const own = row("s1", "acting", { spark: VELA });
    // Chat's publish lands before the next step: Failed stands 2.4 s from the turn whatever Chat reads after it
    expect(chipOf(own, "failed", sourcesOf(holding("ready"))).word).toBe("Failed");
    // a spark never says an agent's "Needs you": with its status none of the four, its chip stands no more
    expect(atWorkChipOf(own, "needs-you", sourcesOf(holding("reviewing")))).toBeNull();
    expect(atWorkChipOf(own, "needs-you", sourcesOf(holding(null)))).toBeNull();
    for (const status of SPARK_NEEDS_YOU)
      expect(atWorkChipOf(own, "needs-you", sourcesOf(holding(status)))?.state).toBe("needs-you");
  });

  it("keeps its words in the chrome's ink: the one switch stands off", () => {
    expect(AT_WORK_CHIP_INKS).toBe(false);
  });
});

describe('"+N": a count, never a word', () => {
  it("counts the agents past the first two", () => {
    expect(AT_WORK_WORDS.count(2)).toBe("+2");
    expect(AT_WORK_WORDS.count(12)).toBe("+12");
  });
});
