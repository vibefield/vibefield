import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PlacesCorpus, witnessOf } from "./project-places-corpus";

// PJ-1's witness (thinking-project-places.md §4.4, §9 Slices; build-pj.md
// L8): the Mac's 161 real places group into the rows §4.4 predicts, the three
// desktops into 143, the review's seven traps join nothing they should not,
// and the runner's invariants hold — on the REDACTED corpus
// (fixtures/projects/places-corpus.json, scripts/redact-places-corpus.mjs).
// The same witness over the unredacted corpus, run outside the repo, gave
// identical numbers and identical partitions; so did the prototype's own
// group() (draft/project-places/grouping.js) on the same input.
//
// PJ-2 (2026-10-08): the person's judgments are SCORED truth now — J1–J10 as
// the engine already grouped them, and J11 ("your home folder is a project
// like the others", one per desktop; PJ-D3 amended for Home), which moved the
// engine: each desktop's Home is its own project, no longer one bucket across
// desktops. So the three desktops give 145 rows (143 under PJ-1: the one Home
// bucket became the Mac's, the Studio's and the Windows box's own), the Mac
// still 132. The two `?` sets left were never asked about; they stay out of
// every score. The same witness over the unredacted corpus (outside the repo)
// gave identical numbers and partitions again.

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "projects",
  "places-corpus.json",
);
const corpus = JSON.parse(readFileSync(FIXTURE, "utf8")) as PlacesCorpus;
const witness = witnessOf(corpus);

describe("PJ-1 — the witness on the redacted corpus", () => {
  it("holds the corpus it claims: 161 Mac places, 31 on two synthetic desktops", () => {
    expect(witness.places).toEqual({ mac: 161, mesh: 192 });
  });

  it("groups the Mac's places into 132 rows: its Home is a project of 2 places, Temporary holds 26", () => {
    expect(witness.mac).toMatchObject({
      rows: 132,
      buckets: { temp: 26 },
      multiPlace: 3,
      crossDevice: 0,
      suggestions: { "related-history": 1, "same-name": 2 },
    });
  });

  it("groups the three desktops into 145 rows, 8 of them across desktops, a Home on each", () => {
    expect(witness.mesh).toMatchObject({
      rows: 145,
      buckets: { temp: 30 },
      multiPlace: 10,
      crossDevice: 8,
      suggestions: { "related-history": 9, "same-folder": 1, "same-name": 4 },
    });
  });

  it("joins nothing across the seven traps (C8a, C8b, C10, C11, C13, C15, C19)", () => {
    expect(witness.trapPairs).toEqual({ falseMerges: 0, falseSplits: 0 });
  });

  it("rebuilds all 11 clear groups with no wrong join and no miss", () => {
    expect(witness.exactGroups).toBe("11/11");
    expect(witness.projectPairs).toMatchObject({ falseMerges: 0, falseSplits: 0 });
  });

  it("takes the person's one link as a join: 144 rows (§4.4's G3, with J11's Homes)", () => {
    expect(witness.meshLinked).toMatchObject({ rows: 144, multiPlace: 11, crossDevice: 9 });
  });

  it("holds the invariants: keys unique and opaque, a deleted clone keeps key and ink, records bind and the oldest names", () => {
    expect(witness.invariants).toEqual([]);
  });

  it("holds every one of the person's judgments, J1–J11", () => {
    expect(Object.keys(corpus.judgments ?? {})).toEqual(
      Array.from({ length: 11 }, (_, i) => `J${i + 1}`),
    );
    expect(Object.values(witness.judgments).every((verdict) => verdict === "holds")).toBe(true);
    expect(Object.keys(witness.judgments)).toHaveLength(11);
    // and scores them: every pair, no wrong join, no miss
    expect(witness.projectPairs).toEqual({ truePairs: 47, falseMerges: 0, falseSplits: 0 });
  });

  it("leaves unscored only the two sets no judgment asked about", () => {
    const open = Object.keys(corpus.truth).filter((label) => label.startsWith("?"));
    expect(open).toHaveLength(2);
  });

  it("names no one: no commit SHA, no home path", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(text).not.toMatch(/[0-9a-f]{40}/);
    expect(text).not.toMatch(/\/Users\/|-Users-/);
  });
});
