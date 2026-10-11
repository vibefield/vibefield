/**
 * The Peek's model (DESIGN.md §8 "Search — the Peek"; GV-D8, 2026-10-08):
 * what the popup decides without a DOM. Rows are SESSIONS — the hits grouped
 * by the root a reader lands in, in the index's order, their lines newest
 * first — each saying "folder · agent" from the root's facts `index.search`
 * now carries (the EL9 fixture `index-search-result.everything.json`, the same
 * bytes fieldd's test pins); a row opens at its newest line; a snippet is cut
 * for one line at a word, its first match among its first words; the foot says
 * what is listed in numbers and why an index did not answer; an open quote
 * asks nothing; and the popup clamps to its window, folding the peek below
 * 680 (K6).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IndexRecentResult, IndexSearchResult } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  folderName,
  hasOpenQuote,
  latestRows,
  NO_PEEK_FILTERS,
  peekAgents,
  peekFoot,
  peekLayout,
  peekNone,
  peekRows,
  rowSegments,
  UNTITLED,
} from "../src/frame/peek-model";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const EVERYTHING = IndexSearchResult.parse(fixture("index-search-result.everything.json"));
const NOW = 1_759_260_000_000;

describe("the rows: a session each, the matched lines its evidence", () => {
  it("groups the hits by root in the index's order, newest line first, and says folder · agent from the root's facts", () => {
    const rows = peekRows(EVERYTHING.hits, NO_PEEK_FILTERS, NOW);
    // two hits of one root are ONE row; the orphan stands as its own session
    expect(rows.map((row) => row.id)).toEqual(["ses-7c1e", "ses-c2d0", "ses-0f9a"]);
    const [first, second, orphan] = rows;
    expect(first?.title).toBe("Page the reader by day");
    expect(first?.folder).toBe("rosetta");
    expect(first?.agent).toBe("Codex");
    expect(first?.lines.map((line) => line.timelineId)).toEqual(["tl-44", "tl-41"]);
    expect(first?.lines.map((line) => line.who)).toEqual(["agent", "you"]);
    // a row opens at its newest matched line, by the hit's OWN session
    expect(first?.target).toEqual({ sessionId: "ses-7c1e", timelineId: "tl-44" });
    expect(second).toMatchObject({ folder: "scratch", agent: "Claude Code", projectId: null });
    // no root: no title, no folder, no agent — never a guess
    expect(orphan).toMatchObject({ title: UNTITLED, folder: null, agent: null });
    expect(orphan?.target).toEqual({ sessionId: "ses-0f9a", timelineId: "tl-2" });
  });

  it("a line inside a delegated thread rolls up to its root, and opens at the CHILD's own session", () => {
    const rows = peekRows(
      [
        {
          sessionId: "child-1",
          rootSessionId: "root-1",
          title: "The parent",
          timelineId: "t-9",
          kind: "agent",
          at: 9,
          snippet: "the [needle] in a thread",
        },
        {
          sessionId: "root-1",
          rootSessionId: "root-1",
          title: "The parent",
          timelineId: "t-1",
          kind: "user",
          at: 1,
          snippet: "find the [needle]",
        },
      ],
      NO_PEEK_FILTERS,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("root-1");
    expect(rows[0]?.target).toEqual({ sessionId: "child-1", timelineId: "t-9" });
  });

  it("the project and agent filters narrow the rows; the side is the index's to ask", () => {
    // PJ-4: a hit carries its root's PJ project (the join column), and the
    // project filter narrows by it — never by rosetta's own id
    const keyed = EVERYTHING.hits.map((hit) =>
      hit.projectId === "p-4f1c2a9e" ? { ...hit, projectKey: "p1:vibe" } : hit,
    );
    expect(
      peekRows(keyed, { ...NO_PEEK_FILTERS, project: "p1:vibe" }, NOW).map((row) => row.id),
    ).toEqual(["ses-7c1e"]);
    expect(peekRows(keyed, { ...NO_PEEK_FILTERS, project: "p-4f1c2a9e" }, NOW)).toEqual([]);
    expect(
      peekRows(EVERYTHING.hits, { ...NO_PEEK_FILTERS, agent: "claude" }, NOW).map((row) => row.id),
    ).toEqual(["ses-c2d0"]);
    // the side filter is asked of the index, never applied here
    expect(peekRows(EVERYTHING.hits, { ...NO_PEEK_FILTERS, kind: "user" }, NOW)).toHaveLength(3);
  });

  it("the latest sessions are rows with no lines, opening at the session's head", () => {
    const recent = IndexRecentResult.parse(fixture("index-recent.valid.json"));
    const rows = latestRows(recent.rows, NO_PEEK_FILTERS, NOW);
    expect(rows.length).toBe(recent.rows.length);
    expect(rows.every((row) => row.lines.length === 0)).toBe(true);
    expect(rows[0]?.target).toEqual({ sessionId: recent.rows[0]?.sessionId });
  });

  it("the agent dropdown offers every visible agent with a history, by the catalog's label", () => {
    const agents = peekAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.every((row) => row.offers.history)).toBe(true);
  });
});

describe("the words on a row", () => {
  const segments = (text: string) =>
    text.split(/(\[[^\]]+\])/u).flatMap((part) =>
      part === ""
        ? []
        : [
            {
              text: part.replace(/^\[|\]$/gu, ""),
              match: part.startsWith("[") && part.endsWith("]"),
            },
          ],
    );

  it("a match far into the line is brought to its first words, cut at a word behind an ellipsis", () => {
    const cut = rowSegments(
      segments("one two three four five six seven eight nine ten [needle] after it"),
    );
    const text = cut.map((segment) => segment.text).join("");
    expect(text.startsWith("…")).toBe(true);
    expect(text.indexOf("needle")).toBeLessThanOrEqual(26);
    // never inside a word: what follows the ellipsis starts a word
    expect(/^…[a-z]/u.test(text)).toBe(true);
    expect(text).toContain("ten needle");
  });

  it("a long line is cut at a word's edge past its reach, never inside one", () => {
    const long = `[start] ${"word ".repeat(40)}end`;
    const text = rowSegments(segments(long))
      .map((segment) => segment.text)
      .join("");
    expect(text.endsWith("word…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(97);
  });

  it("a short line is left as it is", () => {
    expect(rowSegments(segments("a [needle] here"))).toEqual(segments("a [needle] here"));
  });

  it("folder names are the folder's last name, either separator", () => {
    expect(folderName("/Users/a/Projects/rosetta/")).toBe("rosetta");
    expect(folderName("C:\\Users\\a\\work")).toBe("work");
    expect(folderName(undefined)).toBeNull();
  });
});

describe("the foot and the empty body say what is listed, in numbers and in words", () => {
  it("counts sessions and lines, and says a clipped answer is the first page only", () => {
    const rows = peekRows(EVERYTHING.hits, NO_PEEK_FILTERS, NOW);
    expect(peekFoot({ kind: "answer", result: EVERYTHING }, rows)).toBe(
      "3 sessions · 4 lines matched · the first page only — narrow the search",
    );
    expect(peekFoot({ kind: "answer", result: { ...EVERYTHING, clipped: false } }, rows)).toBe(
      "3 sessions · 4 lines matched",
    );
  });

  it("an index with no answer says why — never 'no matches'", () => {
    const building = IndexSearchResult.parse(fixture("index-search-result.building.json"));
    expect(peekFoot({ kind: "answer", result: building }, [])).toMatch(
      /^No answer yet — the index is being built · 21%$/u,
    );
    expect(peekFoot({ kind: "failed", reason: "fieldd is not answering" }, [])).toBe(
      "Search could not ask the index — fieldd is not answering",
    );
  });

  it("before a word, while a quote is open, and while searching", () => {
    expect(peekFoot({ kind: "latest", answered: true }, [])).toBe(
      "Your latest sessions · every word you type must match",
    );
    expect(peekFoot({ kind: "open-quote" }, [])).toBe("Close the quote to search for the phrase");
    expect(peekFoot({ kind: "searching" }, [])).toBe("Searching your past…");
  });

  it("nothing matching is said in the kit's words, naming the filters when they hid it", () => {
    expect(peekNone(" plus ", false)).toBe(
      "Nothing in your past holds every word of “plus”. Try fewer words, or a phrase in quotes.",
    );
    expect(peekNone("plus", true)).toMatch(/^Nothing the filters keep holds every word of “plus”/u);
  });

  it("an open quote asks nothing until it closes", () => {
    expect(hasOpenQuote('"cargo test')).toBe(true);
    expect(hasOpenQuote('"cargo test"')).toBe(false);
    expect(hasOpenQuote("plain words")).toBe(false);
  });
});

describe("the window it fits (K6)", () => {
  it("is 900 × 560 in the default window", () => {
    expect(peekLayout(1180, 780)).toEqual({ width: 900, height: 560, folded: false });
  });

  it("clamps 24 clear of each side and 96 clear of the top and the foot", () => {
    expect(peekLayout(800, 700)).toEqual({ width: 752, height: 508, folded: false });
  });

  it("folds the peek below a 680 popup — a window narrower than 728 — and the list fills", () => {
    expect(peekLayout(728, 780).folded).toBe(false);
    expect(peekLayout(727, 780)).toEqual({ width: 679, height: 560, folded: true });
  });
});
