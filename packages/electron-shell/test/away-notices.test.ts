/**
 * SD-3 (DESIGN.md §14 "Away"; James, the Heard While Away page, 2026-11-06: Q2 (a), Q3 (a)) — the notices the field's
 * voice raises while no VibeField window is in front: the agent as the window names it, then what happened; a Done
 * chord by its number; All quiet by the app; a shared request named once per agent; a click opens Godview.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentFieldRow } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { AWAY_WORDS, awayNameOf, awayNoticesOf } from "../src/main/away-notices";

const BASE = AgentFieldRow.parse(
  (
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../contracts/fixtures/agent-field-snapshot.valid.json"),
        "utf8",
      ),
    ) as { rows: unknown[] }
  ).rows[0],
);

const NAMES: Record<string, string> = { a: "Vela", b: "Claude Code in vibe-field" };
const nameOf = (id: string): string | undefined => NAMES[id];

describe("the words (Q2 (a))", () => {
  it("says each status sound as the agent, then what happened", () => {
    expect(awayNoticesOf({ cue: "done", ids: ["a"] }, nameOf)).toEqual([
      { title: "Vela", body: "Done", opens: "godview" },
    ]);
    expect(awayNoticesOf({ cue: "question", ids: ["a"] }, nameOf)[0]?.body).toBe("Has a question");
    expect(awayNoticesOf({ cue: "approval", ids: ["a"] }, nameOf)[0]?.body).toBe(
      "Needs your approval",
    );
    expect(awayNoticesOf({ cue: "failed", ids: ["a"] }, nameOf)[0]?.body).toBe(
      "Stopped: it failed",
    );
    expect(AWAY_WORDS).toEqual({
      done: "Done",
      question: "Has a question",
      approval: "Needs your approval",
      failed: "Stopped: it failed",
    });
  });
  it("titles a Done chord by its number", () => {
    expect(awayNoticesOf({ cue: "done", ids: ["a", "b", "c"] }, nameOf)).toEqual([
      { title: "3 agents", body: "Done", opens: "godview" },
    ]);
  });
  it("says All quiet as the app", () => {
    expect(awayNoticesOf({ cue: "settle", ids: ["a", "b"] }, nameOf)).toEqual([
      { title: "VibeField", body: "All quiet", opens: "godview" },
    ]);
  });
  it("names each agent of a request two agents share, inventing no plural", () => {
    expect(awayNoticesOf({ cue: "approval", ids: ["a", "b"] }, nameOf)).toEqual([
      { title: "Vela", body: "Needs your approval", opens: "godview" },
      { title: "Claude Code in vibe-field", body: "Needs your approval", opens: "godview" },
    ]);
  });
  it("says nothing for an agent that has gone", () => {
    expect(awayNoticesOf({ cue: "failed", ids: ["gone"] }, nameOf)).toEqual([]);
  });
});

describe("the name, as the window names a field row (contracts' sessionName)", () => {
  it("is its agent's label in its folder", () => {
    expect(awayNameOf(BASE)).toBe(`${BASE.label} in ${BASE.project?.name}`);
  });
  it("is the label alone without a folder, and the run's id without a label's words", () => {
    const { project: _project, ...bare } = BASE;
    expect(awayNameOf(bare)).toBe(BASE.label);
    expect(awayNameOf({ ...bare, label: " " })).toBe(BASE.runtimeRunId);
  });
});
