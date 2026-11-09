// OB-2 — a plugin's agent half, witnessed: the comment pad's tools run over its declared states with no desk.
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
