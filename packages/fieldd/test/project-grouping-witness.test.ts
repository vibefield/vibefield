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
// The `?`-labelled sets are judgment calls (J1–J11 on the Files & History
// Docket): they stay out of every score until the person rules on them.

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

  it("groups the Mac's places into 132 rows: Home holds 2 places, Temporary 26", () => {
    expect(witness.mac).toMatchObject({
      rows: 132,
      buckets: { home: 2, temp: 26 },
      multiPlace: 2,
      crossDevice: 0,
      suggestions: { "related-history": 1, "same-name": 2 },
    });
  });

  it("groups the three desktops into 143 rows, 8 of them across desktops", () => {
    expect(witness.mesh).toMatchObject({
      rows: 143,
      buckets: { home: 4, temp: 30 },
      multiPlace: 9,
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

  it("takes the person's one link as a join: 142 rows (§4.4's G3)", () => {
    expect(witness.meshLinked).toMatchObject({ rows: 142, multiPlace: 10, crossDevice: 9 });
  });

  it("holds the invariants: keys unique and opaque, a deleted clone keeps key and ink, records bind and the oldest names", () => {
    expect(witness.invariants).toEqual([]);
  });

  it("leaves the judgment calls unscored, awaiting the person", () => {
    const open = Object.keys(corpus.truth).filter((label) => label.startsWith("?"));
    expect(open).toHaveLength(8);
  });

  it("names no one: no commit SHA, no home path", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(text).not.toMatch(/[0-9a-f]{40}/);
    expect(text).not.toMatch(/\/Users\/|-Users-/);
  });
});
