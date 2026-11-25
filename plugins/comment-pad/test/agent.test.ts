// OB-2 — a plugin's agent half, witnessed: the comment pad's tools run over its declared states with no desk.
import type { ObjectContribution } from "@vibefield/contracts";
import { decodeMarks, highlightOf, inkCells, inkOf, mark } from "@vibefield/plugin-sdk/desk";
import {
  agentToolHarness,
  productPalette,
  runKindConformance,
} from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import states from "../playground/states";
import { commentPadManifest } from "../src/manifest";
import { commentPad, commentPadAgent } from "../src/object";

const row = commentPadManifest.contributes?.objects?.[0];
if (row === undefined) throw new Error("no object row");
const pads = (states as Record<string, Record<string, Record<string, unknown>>>)[row.type];

describe("the comment pad's agent half", () => {
  it("passes conformance over every playground state", async () => {
    const report = await runKindConformance({
      binding: commentPad,
      row,
      states: pads,
      palette: productPalette,
    });
    expect(report.verdicts.filter((v) => v.status === "refused")).toEqual([]);
    expect(report.verdicts.filter((v) => v.detail.includes("agent half"))).toHaveLength(
      Object.keys(pads ?? {}).length,
    );
  });

  it("adds a comment on its own line, and undoes it", () => {
    const pad = agentToolHarness(commentPadAgent, row, { text: "first" });
    const { value, changed, inverse } = pad.act("add_comment", { text: "second" });
    expect(value).toEqual({ comments: 2 });
    expect(changed).toBe("Added a comment");
    expect(pad.read("read_text")).toEqual({ text: "first\nsecond" });
    expect(inverse && pad.undo(inverse)).toBe(true);
    expect(pad.read("read_text")).toEqual({ text: "first" });
  });

  it("keeps a comment to one line and leaves the seeds of the lines already there", () => {
    const pad = agentToolHarness(commentPadAgent, row, { text: "first", seeds: "kept" });
    pad.act("add_comment", { text: "two\nlines" });
    expect(pad.props()).toMatchObject({ text: "first\ntwo lines", seeds: "kept" });
  });

  it("says when the pad is full, and writes nothing", () => {
    const pad = agentToolHarness(commentPadAgent, row, { text: "x".repeat(19_999) });
    expect(() => pad.act("add_comment", { text: "more" })).toThrow("this pad is full");
    expect(pad.props()["text"]).toHaveLength(19_999);
  });
});

// IK (2026-11-25): the shipped row carries the pad's marks (its adoption of the ink: `marks` beside `text` and `seeds` in its
// one `ink` group). A row without them — the pad as declared before the adoption — keeps the honest no witnessed.
const { marks: _marks, ...unmarkedProps } = row.props;
const unmarked: ObjectContribution = {
  ...row,
  props: unmarkedProps,
  groups: { ink: ["text", "seeds"] },
};

describe("the comment pad's ink tools (IK)", () => {
  it("lists the three every written kind shares beside its own two, and answers each", () => {
    expect(row.agent?.tools.map((tool) => tool.name)).toEqual([
      "read_text",
      "add_comment",
      "read_writing",
      "edit_text",
      "mark_text",
    ]);
    expect(Object.keys(commentPadAgent.read ?? {}).sort()).toEqual(["read_text", "read_writing"]);
    expect(Object.keys(commentPadAgent.act ?? {}).sort()).toEqual([
      "add_comment",
      "edit_text",
      "mark_text",
    ]);
  });

  it("marks a comment's words and changes them by quote, on a pad that keeps marks", () => {
    const pad = agentToolHarness(commentPadAgent, row, { text: "ship it\nnot yet" });
    pad.act("mark_text", { quote: "not yet", highlight: "pink", strike: true });
    expect(pad.read("read_writing")).toEqual({
      text: "ship it\nnot yet",
      pen: "ball",
      runs: [{ from: 8, to: 15, text: "not yet", highlight: "pink", strike: true }],
    });
    const { changed } = pad.act("edit_text", { quote: "ship it", with: "ship it today" });
    expect(changed).toBe('Changed "ship it" to "ship it today"');
    expect((pad.read("read_writing") as { runs: unknown[] }).runs).toEqual([
      { from: 14, to: 21, text: "not yet", highlight: "pink", strike: true },
    ]);
  });

  it("says a pad that keeps no marks cannot be marked (the row as declared before the pad adopted the ink)", () => {
    const pad = agentToolHarness(commentPadAgent, unmarked, { text: "one" });
    expect(() => pad.act("mark_text", { quote: "one", pen: "red" })).toThrow(
      "This pad keeps no marks: its words can be changed, not marked.",
    );
  });

  it("adds a comment whose marks stay with the words they were on, the new line unmarked", () => {
    // a highlighted last line, and a stale cell whose marks run past its words
    const ink = mark(inkOf({ text: "first\nsecond" }, 0), 6, 12, { highlight: "yellow" });
    const cells = inkCells(ink);
    const pad = agentToolHarness(commentPadAgent, row, {
      text: "first\nsec",
      seeds: "",
      marks: cells.marks,
    });
    pad.act("add_comment", { text: "third" });
    const p = pad.props();
    expect(p["text"]).toBe("first\nsec\nthird");
    const marks = decodeMarks(String(p["marks"]), String(p["text"]));
    expect(marks.map(highlightOf)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
  });
});
