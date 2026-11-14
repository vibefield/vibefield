// Item 398 — `project.figures` asked by id (`sessions`, a listed page's
// `{device, sessionId}` pairs, at most INDEX_TAILNET_LIMITS.MAX_ROWS) and its
// `totals` over every row gathered; `index.project`'s `sessionIds`, the same
// ask handed down to a peer. Optional additions on an existing door
// (design-01 P3, §8): the goldens of the build before them still parse.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INDEX_TAILNET_LIMITS,
  IndexProjectParams,
  ProjectFiguresParams,
  ProjectFiguresResult,
} from "../src/index";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

const KEY = "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8";
const pairs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ device: "dev-a", sessionId: `ses-${i}` }));

describe("item 398 — project.figures asked by id", () => {
  it("takes a page's pairs, one to MAX_ROWS of them, each a desktop and a canonical id", () => {
    const asked = ProjectFiguresParams.parse(fixture("project-figures-params.sessions.json"));
    expect(asked.sessions).toHaveLength(2);
    expect(
      ProjectFiguresParams.safeParse({ key: KEY, sessions: pairs(INDEX_TAILNET_LIMITS.MAX_ROWS) })
        .success,
    ).toBe(true);
  });

  it("refuses an empty ask, one past a page, and a pair missing its desktop or its id", () => {
    expect(ProjectFiguresParams.safeParse({ key: KEY, sessions: [] }).success).toBe(false);
    expect(
      ProjectFiguresParams.safeParse({
        key: KEY,
        sessions: pairs(INDEX_TAILNET_LIMITS.MAX_ROWS + 1),
      }).success,
    ).toBe(false);
    expect(
      ProjectFiguresParams.safeParse({ key: KEY, sessions: [{ sessionId: "ses-1" }] }).success,
    ).toBe(false);
    expect(
      ProjectFiguresParams.safeParse({ key: KEY, sessions: [{ device: "dev-a", sessionId: "" }] })
        .success,
    ).toBe(false);
  });

  it("an answer carries totals over every row gathered, and an earlier build's answer without them still parses", () => {
    const withTotals = ProjectFiguresResult.parse(fixture("project-figures.totals.json"));
    expect(withTotals.totals).toEqual({
      conversations: 142,
      messages: 6210,
      tokens: 9184000,
      costMicroUsd: 61530000,
    });
    // the page is cut, the totals are not
    expect(withTotals.clipped).toBe(true);
    expect(withTotals.totals!.conversations).toBeGreaterThan(withTotals.contribution.length);
    const before = ProjectFiguresResult.parse(fixture("project-figures.valid.json"));
    expect(before.totals).toBeUndefined();
  });

  it("refuses totals that are not counts and sums", () => {
    const base = fixture("project-figures.valid.json");
    const totals = { conversations: 3, messages: 9, tokens: 100, costMicroUsd: null };
    expect(ProjectFiguresResult.safeParse({ ...base, totals }).success).toBe(true);
    expect(
      ProjectFiguresResult.safeParse({ ...base, totals: { ...totals, conversations: -1 } }).success,
    ).toBe(false);
    expect(
      ProjectFiguresResult.safeParse({ ...base, totals: { ...totals, conversations: 1.5 } })
        .success,
    ).toBe(false);
    expect(
      ProjectFiguresResult.safeParse({ ...base, totals: { ...totals, tokens: "100" } }).success,
    ).toBe(false);
  });
});

describe("item 398 — index.project's sessionIds, the ask by id handed down", () => {
  it("takes one to MAX_ROWS canonical ids and refuses an empty list or one past a page", () => {
    const asked = IndexProjectParams.parse(fixture("index-project-params.sessions.json"));
    expect(asked.sessionIds).toEqual(["ses-9b2f0c7d", "ses-31c0de55"]);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `ses-${i}`);
    expect(IndexProjectParams.safeParse({ projectId: "p1", sessionIds: [] }).success).toBe(false);
    expect(
      IndexProjectParams.safeParse({
        projectId: "p1",
        sessionIds: ids(INDEX_TAILNET_LIMITS.MAX_ROWS + 1),
      }).success,
    ).toBe(false);
    expect(IndexProjectParams.safeParse({ projectId: "p1", sessionIds: [""] }).success).toBe(false);
    // an ask without it is the ask of before
    expect(IndexProjectParams.parse(fixture("index-project-params.valid.json")).sessionIds).toBe(
      undefined,
    );
  });
});
