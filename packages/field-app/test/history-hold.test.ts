import type { ImportSign } from "@vibefield/rosetta-room";
import { describe, expect, it } from "vitest";
import {
  HISTORY_PLACING_BOUND_MS,
  type HistoryHoldFacts,
  historyHoldArms,
  historyHolds,
  historyHoldWords,
} from "../src/history/history-hold";

// History QA (2026-11-24; DESIGN.md §8 "History" — before its past, "The first reading holds behind the glass"): the
// room's cold start ended at its first "project", its own bucket for sessions no place holds yet, so a first import
// stood as one project of everything, "Unassigned sessions", until fieldd had read the places. The view holds from
// Bring in history until fieldd's first projects are listed.

const facts = (over: Partial<HistoryHoldFacts>): HistoryHoldFacts => ({
  phase: "backfilling",
  projects: 0,
  sessions: 0,
  armed: true,
  liveForMs: null,
  ...over,
});

describe("the first reading's hold: when it holds", () => {
  it("holds through the reading and the grant's restart, once this view saw the reading begin", () => {
    for (const phase of [
      "discovering",
      "backfilling",
      "metadata_ready",
      "restoring",
      "finalizing",
      "publishing",
      "starting",
      "restarting",
      "rebuilding",
    ] as const)
      expect(historyHolds(facts({ phase })), phase).toBe(true);
    // the listing has not answered yet, right after the grant: the card's wait armed it
    expect(historyHolds(facts({ phase: "restarting", projects: null, sessions: null }))).toBe(true);
  });

  it("never holds once a project is listed, whatever the index is doing", () => {
    for (const phase of ["backfilling", "restarting", "publishing", "live"] as const)
      expect(historyHolds(facts({ phase, projects: 1, sessions: 40, liveForMs: 10 })), phase).toBe(
        false,
      );
  });

  it("after the index is live, holds while sessions are listed and no project is, for the bound and no longer", () => {
    const live = (over: Partial<HistoryHoldFacts>) =>
      historyHolds(facts({ phase: "live", sessions: 437, liveForMs: 2_000, ...over }));
    expect(live({})).toBe(true);
    expect(live({ liveForMs: HISTORY_PLACING_BOUND_MS - 1 })).toBe(true);
    expect(live({ liveForMs: HISTORY_PLACING_BOUND_MS })).toBe(false);
    // nothing to place: a reading that found no session, or a person who brought nothing in
    expect(live({ sessions: 0 })).toBe(false);
    expect(live({ sessions: null })).toBe(false);
    // a view that never saw the reading begin (an index long live whose sessions no place holds) is not held
    expect(live({ armed: false })).toBe(false);
  });

  it("leaves the card's wait and the index's own faults to what says them", () => {
    for (const phase of [
      "awaiting_consent",
      "failed",
      "stopped",
      "unconfigured",
      "unknown",
    ] as const)
      expect(historyHolds(facts({ phase })), phase).toBe(false);
    expect(historyHolds(facts({ phase: null }))).toBe(false);
  });

  it("an index that reads at an ordinary start, its listing not answered yet, is not held", () => {
    // unarmed: the room was never before its past in this view, and nothing says there is no project
    expect(historyHolds(facts({ armed: false, projects: null, sessions: null }))).toBe(false);
    expect(historyHolds(facts({ phase: "restarting", armed: false }))).toBe(false);
  });
});

describe("the first reading's hold: what arms it", () => {
  it("the index waiting for consent, or reading with a listing that says no project", () => {
    expect(historyHoldArms("awaiting_consent", null)).toBe(true);
    expect(historyHoldArms("backfilling", 0)).toBe(true);
    expect(historyHoldArms("backfilling", null)).toBe(false);
    expect(historyHoldArms("backfilling", 12)).toBe(false);
    expect(historyHoldArms("live", 0)).toBe(false);
    expect(historyHoldArms("restarting", 0)).toBe(false);
    expect(historyHoldArms(null, 0)).toBe(false);
  });
});

describe("the first reading's hold: its words are the import's own", () => {
  const sign = (over: Partial<ImportSign>): ImportSign =>
    ({
      tone: "working",
      step: 1,
      title: "Discovering conversations",
      count: "1,333 files checked",
      ...over,
    }) as ImportSign;

  it("the step's title with its ellipsis over its count", () => {
    expect(historyHoldWords("backfilling", sign({}))).toEqual({
      key: "step-1",
      line: "Discovering conversations…",
      detail: "1,333 files checked",
    });
    expect(
      historyHoldWords(
        "backfilling",
        sign({ step: 2, title: "Importing your newest conversations first", count: null }),
      ),
    ).toEqual({ key: "step-2", line: "Importing your newest conversations first…", detail: null });
  });

  it("the first step's title alone, and the same before the room has read anything", () => {
    const finding = { key: "finding", line: "Finding your history…", detail: null };
    expect(
      historyHoldWords(
        "discovering",
        sign({ title: "Finding your history", count: "Looking for conversations…" }),
      ),
    ).toEqual(finding);
    expect(historyHoldWords("restarting", null)).toEqual(finding);
    // a sign at rest or paused is no reading's word
    expect(historyHoldWords("restarting", sign({ tone: "rest" }))).toEqual(finding);
  });

  it("once the reading is done and only the places are being read: Gathering your projects…", () => {
    expect(historyHoldWords("live", sign({ step: 4, title: "Preparing search" }))).toEqual({
      key: "placing",
      line: "Gathering your projects…",
      detail: null,
    });
  });
});
