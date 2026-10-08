import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IndexCatalogProject } from "../src/agent-index";
import { PlaceFacts } from "../src/project-places";
import { GROUPING_VERSION, PROJECT_GROUPING } from "../src/registries";

// PJ-1 — place facts ride the catalog's project rows (build-pj.md L1). A row
// carries a desktop's session history, so a place a reader cannot read must
// cost the row nothing: the place is dropped, the row is kept.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describe("PJ-1 — place facts on the catalog row", () => {
  it("keeps the row and drops only the place it cannot read", () => {
    const row = fixture("index-catalog-project.places.json");
    const places = row["places"] as Array<Record<string, unknown>>;
    const hostile = { ...places[0], placeId: "pl-bad", root: "HEAD; rm -rf /" };
    const parsed = IndexCatalogProject.parse({ ...row, places: [hostile, ...places] });
    expect(parsed.places?.map((place) => place.placeId)).toEqual(["pl-4c1e9a0b", "pl-6b20e8d5"]);
    expect(parsed.sessionCount).toBe(12);
  });

  it("keeps the row when its `places` is not a list at all (a newer peer's reshape)", () => {
    const row = fixture("index-catalog-project.places.json");
    for (const places of ["not a list", 42, { placeId: "p" }, null]) {
      const parsed = IndexCatalogProject.safeParse({ ...row, places });
      expect(parsed.success, JSON.stringify(places)).toBe(true);
      expect(parsed.data?.places ?? []).toEqual([]);
    }
  });

  it("reads an older peer's row, which has no places, as it always did", () => {
    const row = fixture("index-catalog-project.valid.json");
    expect(IndexCatalogProject.parse(row).places).toBeUndefined();
  });

  it("hex-checks every SHA a reader could hand to git", () => {
    const place = fixture("place-facts.valid.json");
    expect(PlaceFacts.safeParse({ ...place, root: "A0".repeat(20) }).success).toBe(false);
    expect(
      PlaceFacts.safeParse({ ...place, samples: [{ sha: "--upload-pack=x", depth: 0 }] }).success,
    ).toBe(false);
    expect(
      PlaceFacts.safeParse({ ...place, hits: [{ placeId: "p", sha: "1".repeat(39), depth: 0 }] })
        .success,
    ).toBe(false);
    expect(PlaceFacts.safeParse({ ...place, root: "b".repeat(64) }).success).toBe(true);
  });

  it("reads a kind it does not know as an ordinary place, which joins only by evidence", () => {
    const place = fixture("place-facts.valid.json");
    expect(PlaceFacts.parse({ ...place, kind: "mount" }).kind).toBe("project");
  });

  it("names version 1 and the sample depths RECENT reads", () => {
    expect(GROUPING_VERSION).toBe(1);
    expect(PROJECT_GROUPING.SAMPLE_DEPTHS).toContain(PROJECT_GROUPING.RECENT_DEPTH);
  });
});
