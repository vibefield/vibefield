// @vitest-environment node
// IK (2026-11-25; ink-agent A) — the three tools every written kind shares, driven on a fixture cell with no desk: an agent
// names words by quoting them, and each write moves the words, their hands and their marks as one cell.
import {
  INK_HIGHLIGHTER_NAMES,
  INK_NO_HIGHLIGHT,
  INK_PEN_NAMES,
  OBJECT_LIMITS,
  type ObjectContribution,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type AgentHalf,
  AgentToolRefusal,
  decodeMarks,
  encodeMarks,
  HIGHLIGHTERS,
  highlightOf,
  INK_TOOL_NAMES,
  INK_TOOLS,
  type InkToolsOptions,
  inkCells,
  inkOf,
  isAgentToolRefusal,
  mark,
  NO_HIGHLIGHT,
  PENS,
  penOf,
  strikeOf,
  underlineOf,
  withInkTools,
} from "../src/desk";
import { agentToolHarness } from "../src/testing";
import { discRow } from "./fixtures/disc-kind";

/** A written kind's cell, as ICE's ink adopters declare it. */
const PROPS = {
  text: { kind: "string", default: "", maxLength: 200 },
  seeds: { kind: "string", default: "", maxLength: 4000 },
  marks: { kind: "string", default: "", maxLength: 4000 },
  pen: { kind: "enum", options: [...PENS], default: "ball" },
  seed: { kind: "number", default: 0 },
} as const;

const AGENT = {
  summary: "A written sheet.",
  concurrency: "many",
  faces: [{ type: "ref" }],
  tools: [...INK_TOOLS],
} as const;

const row = (props: Record<string, unknown> = PROPS): ObjectContribution =>
  discRow({
    props: props as ObjectContribution["props"],
    groups: { ink: Object.keys(props).filter((p) => ["text", "seeds", "marks"].includes(p)) },
    agent: AGENT as unknown as ObjectContribution["agent"],
  });

const BASE: AgentHalf = { summary: (api) => ({ text: api.props()["text"] }) };

let next = 1_000;
const fresh = () => {
  next += 1;
  return next;
};

/** A sheet with `text`, its letters [from, to) highlighted yellow when asked. */
const sheet = (
  text: string,
  opts: InkToolsOptions & { marked?: readonly [number, number] } = {},
  props: Record<string, unknown> = PROPS,
) => {
  let ink = inkOf({ text }, 7);
  if (opts.marked !== undefined)
    ink = mark(ink, opts.marked[0], opts.marked[1], { highlight: "yellow" });
  const cells = inkCells(ink);
  const initial: Record<string, unknown> = { text: cells.text, seeds: cells.seeds, seed: 7 };
  if ("marks" in props) initial["marks"] = cells.marks;
  return agentToolHarness(withInkTools(BASE, { fresh, ...opts }), row(props), initial);
};

/** What a harness's act threw: the refusal's words. */
const refusalOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(isAgentToolRefusal(error)).toBe(true);
    return (error as Error).message;
  }
  throw new Error("it did not refuse");
};

const inkNow = (h: ReturnType<typeof sheet>) => {
  const p = h.props();
  return inkOf(
    { text: String(p["text"]), seeds: String(p["seeds"] ?? ""), marks: String(p["marks"] ?? "") },
    7,
  );
};

describe("the ink tools' declarations and handlers", () => {
  it("are the contracts' three, a read and two acts, and the SDK's handlers answer exactly them", () => {
    const half = withInkTools(BASE);
    expect(INK_TOOLS.map((t) => t.name)).toEqual(Object.values(INK_TOOL_NAMES));
    expect(Object.keys(half.read ?? {})).toEqual(
      INK_TOOLS.filter((t) => t.readOnly).map((t) => t.name),
    );
    expect(Object.keys(half.act ?? {})).toEqual(
      INK_TOOLS.filter((t) => !t.readOnly).map((t) => t.name),
    );
  });

  it("name the desk's pens and highlighters as ICE's kit names them, in its order", () => {
    expect([...INK_PEN_NAMES]).toEqual([...PENS]);
    expect([...INK_HIGHLIGHTER_NAMES]).toEqual([...HIGHLIGHTERS]);
    expect(INK_NO_HIGHLIGHT).toBe(NO_HIGHLIGHT);
  });

  it("keep the kind's own tools beside them, and refuse to shadow one it already has", () => {
    const half = withInkTools({
      ...BASE,
      read: { read_text: () => ({}) },
      act: { add: () => undefined },
    });
    expect(Object.keys(half.read ?? {})).toEqual(["read_text", "read_writing"]);
    expect(Object.keys(half.act ?? {})).toEqual(["add", "edit_text", "mark_text"]);
    expect(() => withInkTools({ ...BASE, act: { edit_text: () => undefined } })).toThrow(
      "already has a tool called edit_text",
    );
  });
});

describe("read_writing", () => {
  it("gives the words, the sheet's own pen and each marked run by its names", () => {
    const h = sheet("see you on Friday", { marked: [11, 17] });
    expect(h.read("read_writing")).toEqual({
      text: "see you on Friday",
      pen: "ball",
      runs: [{ from: 11, to: 17, text: "Friday", highlight: "yellow" }],
    });
  });

  it("is bounded to what one answer may carry, and says how many runs it left off", () => {
    // 8,000 words, every other one underlined: 4,000 runs, more than one answer may carry
    const words = Array.from({ length: 8_000 }, (_, i) => `w${i}`);
    const text = words.join(" ");
    const under = mark(inkOf({ text: "x" }, 0), 0, 1, { underline: true }).marks[0] ?? 0;
    const marks: number[] = [];
    for (const [i, word] of words.entries()) {
      for (const _ of word) marks.push(i % 2 === 0 ? under : 0);
      marks.push(0);
    }
    marks.pop();
    const h = agentToolHarness(withInkTools(BASE), row(), {
      text,
      seeds: "",
      marks: encodeMarks(marks),
      seed: 7,
    });
    const said = h.read("read_writing") as { runs: unknown[]; more?: number };
    expect(said.more).toBeGreaterThan(0);
    expect(said.runs.length + (said.more ?? 0)).toBe(4_000);
    expect(new TextEncoder().encode(JSON.stringify(said)).byteLength).toBeLessThanOrEqual(
      OBJECT_LIMITS.TOOL_BYTES,
    );
    // a few runs fit whole
    const few = sheet("one two", { marked: [0, 3] }).read("read_writing") as { more?: number };
    expect(few.more).toBeUndefined();
  });

  it("reads a cell written before marks existed as unmarked, and a kind with no marks prop the same", () => {
    const { marks: _, ...unmarked } = PROPS;
    const h = sheet("plain words", {}, unmarked);
    expect(h.read("read_writing")).toEqual({ text: "plain words", pen: "ball", runs: [] });
  });
});

describe("edit_text", () => {
  it("replaces quoted words, keeps the marks they all shared, and every other glyph's hand", () => {
    const h = sheet("see you on Friday", { marked: [11, 17] });
    const before = inkNow(h);
    const { value, changed, inverse } = h.act("edit_text", { quote: "Friday", with: "Monday" });
    expect(value).toEqual({ at: 11, chars: 17 });
    expect(changed).toBe('Changed "Friday" to "Monday"');
    const after = inkNow(h);
    expect(after.text).toBe("see you on Monday");
    expect(after.marks.slice(11).map(highlightOf)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(after.seeds.slice(0, 11)).toEqual(before.seeds.slice(0, 11));
    // ONE cell: the words, the hands and the marks in the act's one change
    expect(Object.keys(inverse?.after ?? {}).sort()).toEqual(["seeds", "text"].sort());
    expect(inverse && h.undo(inverse)).toBe(true);
    expect(h.props()["text"]).toBe("see you on Friday");
  });

  it("moves the marks with the words after the edit, so they stay on the words they were on", () => {
    const h = sheet("one two three", { marked: [8, 13] });
    h.act("edit_text", { quote: "one", with: "the first" });
    const after = inkNow(h);
    expect(after.text).toBe("the first two three");
    const lit = after.marks.flatMap((m, i) => (highlightOf(m) > 0 ? [i] : []));
    expect(after.text.slice(lit[0], (lit.at(-1) ?? 0) + 1)).toBe("three");
    expect(h.props()["marks"]).toBe(encodeMarks(after.marks));
  });

  it("removes the quoted words when `with` is empty", () => {
    const h = sheet("keep this not this");
    expect(h.act("edit_text", { quote: " not this", with: "" }).changed).toBe(
      'Removed " not this"',
    );
    expect(h.props()["text"]).toBe("keep this");
  });

  it("says when the quote is not there, and writes nothing", () => {
    const h = sheet("see you on Friday");
    expect(refusalOf(() => h.act("edit_text", { quote: "Sunday", with: "x" }))).toBe(
      'This sheet does not say "Sunday". Read it with `read_writing` and quote its words exactly.',
    );
    expect(h.props()["text"]).toBe("see you on Friday");
  });

  it("says how many times an ambiguous quote is written, and takes the one `occurrence` names", () => {
    const h = sheet("tea, then tea again");
    expect(refusalOf(() => h.act("edit_text", { quote: "tea", with: "coffee" }))).toBe(
      '"tea" is written 2 times on this sheet. Say which with `occurrence`, 1 to 2.',
    );
    expect(h.act("edit_text", { quote: "tea", with: "coffee", occurrence: 2 }).value).toEqual({
      at: 10,
      chars: 22,
    });
    expect(h.props()["text"]).toBe("tea, then coffee again");
    expect(refusalOf(() => h.act("edit_text", { quote: "tea", with: "x", occurrence: 2 }))).toBe(
      '"tea" is written on this sheet only once.',
    );
    expect(refusalOf(() => h.act("edit_text", { quote: "tea", with: "x", occurrence: 0 }))).toBe(
      "`occurrence` counts from 1, the first time the words are written.",
    );
  });

  it("refuses an edit past the kind's most, in its own noun, and writes nothing", () => {
    const h = sheet("short", { max: 10, noun: "note" });
    expect(refusalOf(() => h.act("edit_text", { quote: "short", with: "much too long" }))).toBe(
      "This note holds at most 10 characters, and that would make it 13.",
    );
    expect(h.props()["text"]).toBe("short");
  });

  it("changes nothing when the new words are the old ones", () => {
    const h = sheet("same");
    expect(h.act("edit_text", { quote: "same", with: "same" }).inverse).toBeUndefined();
  });

  it("on a kind with no marks prop, writes the words and their hands alone", () => {
    const { marks: _, ...unmarked } = PROPS;
    const h = sheet("old words", {}, unmarked);
    const { inverse } = h.act("edit_text", { quote: "old", with: "new" });
    expect(Object.keys(inverse?.after ?? {}).sort()).toEqual(["seeds", "text"]);
    expect(h.props()["text"]).toBe("new words");
  });

  it("reads a kind whose cell is named otherwise by the names it gives", () => {
    const props = {
      body: { kind: "string", default: "", maxLength: 200 },
      hands: { kind: "string", default: "", maxLength: 4000 },
      ticks: { kind: "string", default: "", maxLength: 4000 },
    };
    const h = agentToolHarness(
      withInkTools(BASE, { cell: { text: "body", seeds: "hands", marks: "ticks" }, fresh }),
      discRow({
        props: props as ObjectContribution["props"],
        groups: { ink: ["body", "hands", "ticks"] },
      }),
      { body: "a cat", hands: "", ticks: "" },
    );
    h.act("mark_text", { quote: "cat", underline: "red" });
    h.act("edit_text", { quote: "a ", with: "the " });
    const p = h.props();
    expect(p["body"]).toBe("the cat");
    const marks = decodeMarks(String(p["ticks"]), "the cat");
    expect(marks.map(underlineOf)).toEqual([0, 0, 0, 0, 5, 5, 5]);
  });
});

describe("mark_text", () => {
  it("writes the quoted words in each of the desk's pens, by name; the sheet's own pen lifts another", () => {
    for (const [i, pen] of PENS.entries()) {
      const h = sheet("one two");
      const { changed } = h.act("mark_text", { quote: "two", pen });
      const marks = inkNow(h).marks;
      if (pen === "ball") {
        // the sheet's own: no pen of the words' own
        expect(marks.map(penOf)).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(changed).toBe('Marked "two": in the sheet\'s own pen');
      } else {
        expect(marks.slice(4).map(penOf)).toEqual([i + 1, i + 1, i + 1]);
        expect(changed).toBe(`Marked "two": in the ${pen} pen`);
      }
    }
  });

  it("highlights with each of the desk's highlighters by name, and none lifts it", () => {
    for (const [i, highlight] of HIGHLIGHTERS.entries()) {
      const h = sheet("one two");
      h.act("mark_text", { quote: "one", highlight });
      expect(inkNow(h).marks.slice(0, 3).map(highlightOf)).toEqual([i + 1, i + 1, i + 1]);
      const { changed } = h.act("mark_text", { quote: "one", highlight: "none" });
      expect(changed).toBe('Marked "one": unhighlighted');
      expect(h.props()["marks"]).toBe("");
    }
  });

  it("strikes through and underlines, in the words' own pen or a named one, and false lifts each", () => {
    const h = sheet("one two");
    h.act("mark_text", { quote: "one", strike: true, underline: "red" });
    let marks = inkNow(h).marks;
    expect(marks.slice(0, 3).map(strikeOf)).toEqual([1, 1, 1]);
    expect(marks.slice(0, 3).map(underlineOf)).toEqual([5, 5, 5]);
    const { changed } = h.act("mark_text", { quote: "one", strike: false });
    expect(changed).toBe('Marked "one": not struck through');
    marks = inkNow(h).marks;
    expect(marks.slice(0, 3).map(strikeOf)).toEqual([0, 0, 0]);
    expect(marks.slice(0, 3).map(underlineOf)).toEqual([5, 5, 5]);
  });

  it("clears every mark first, then sets what it also names", () => {
    const h = sheet("one two", { marked: [0, 7] });
    h.act("mark_text", { quote: "one two", underline: true });
    const { changed } = h.act("mark_text", { quote: "two", clear: true, pen: "red" });
    expect(changed).toBe('Marked "two": its marks cleared, in the red pen');
    const marks = inkNow(h).marks;
    expect(marks.slice(4).map(highlightOf)).toEqual([0, 0, 0]);
    expect(marks.slice(4).map(underlineOf)).toEqual([0, 0, 0]);
    expect(marks.slice(4).map(penOf)).toEqual([4, 4, 4]);
    expect(marks.slice(0, 3).map(highlightOf)).toEqual([1, 1, 1]);
  });

  it("moves the marks alone: the words and their hands stay as they were", () => {
    const h = sheet("one two");
    const { inverse } = h.act("mark_text", { quote: "two", highlight: "pink" });
    expect(Object.keys(inverse?.after ?? {})).toEqual(["marks"]);
  });

  it("refuses a name the desk does not have, listing the names it does", () => {
    const h = sheet("one two");
    expect(refusalOf(() => h.act("mark_text", { quote: "one", pen: "purple" }))).toBe(
      "The desk has no pen called purple. Its pens: felt, ball, fountain, red.",
    );
    expect(refusalOf(() => h.act("mark_text", { quote: "one", highlight: "violet" }))).toBe(
      "The desk has no highlighter called violet. Its highlighters: yellow, green, pink, blue, orange, or none.",
    );
    expect(refusalOf(() => h.act("mark_text", { quote: "one", strike: "thick" }))).toBe(
      "`strike` is true, false or one of the pens: felt, ball, fountain, red.",
    );
    expect(refusalOf(() => h.act("mark_text", { quote: "one" }))).toBe(
      "Say how to mark the words: `pen`, `highlight`, `strike`, `underline` or `clear`.",
    );
    expect(h.props()["marks"]).toBe("");
  });

  it("finds its words as edit_text does: missing, ambiguous, or the occurrence named", () => {
    const h = sheet("tea, then tea");
    expect(refusalOf(() => h.act("mark_text", { quote: "milk", pen: "red" }))).toContain(
      'does not say "milk"',
    );
    expect(refusalOf(() => h.act("mark_text", { quote: "tea", pen: "red" }))).toContain(
      "is written 2 times",
    );
    h.act("mark_text", { quote: "tea", occurrence: 2, pen: "red" });
    expect(inkNow(h).marks.map(penOf)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4]);
  });

  it("refuses on a kind that keeps no marks, and writes nothing", () => {
    const { marks: _, ...unmarked } = PROPS;
    const h = sheet("one two", { noun: "note" }, unmarked);
    expect(refusalOf(() => h.act("mark_text", { quote: "one", pen: "red" }))).toBe(
      "This note keeps no marks: its words can be changed, not marked.",
    );
  });
});

describe("an honest no", () => {
  it("is an Error by its name, so a plugin's copy of the class reads as one too", () => {
    expect(isAgentToolRefusal(new AgentToolRefusal("no"))).toBe(true);
    const copy = new Error("no");
    copy.name = "AgentToolRefusal";
    expect(isAgentToolRefusal(copy)).toBe(true);
    expect(isAgentToolRefusal(new Error("no"))).toBe(false);
    expect(isAgentToolRefusal("no")).toBe(false);
  });
});
