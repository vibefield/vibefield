// @vitest-environment node
/**
 * PJ-4 — THE DATA FOR H5 (`history/sections.ts`; James 2026-10-09: "Home is a
 * row, and Temporary is one folded row at the foot ('Temporary · 6'), with
 * sessions older than 14 days behind 'Show older'"; J11, PJ-L4). Over the
 * contract's own project and session shapes: each Home this desktop holds, the
 * Temporary bucket's sessions split at 14 days (newest first), an undated
 * session never shown as recent on a guess, another desktop's never counted.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type IndexSession, ProjectListResult, type ProjectSummary } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { historySectionsOf, TEMPORARY_RECENT_MS } from "../src/history/sections";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const PROJECTS = ProjectListResult.parse(
  JSON.parse(readFileSync(join(FIXTURES, "project-list.valid.json"), "utf8")),
).rows;
const STUDIO = "01J9ZK3M5Q8XR2V7N4B6C1D0EF";
const LAPTOP = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9";
const HOME = PROJECTS.find((project) => project.kind === "home")!;
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

/** Temporary: one bucket across desktops, a place on each */
const TEMPORARY: ProjectSummary = {
  ...HOME,
  key: "p1:t3mp0r4ry",
  name: "Temporary",
  nameFrom: "bucket",
  kind: "temp",
  bucket: "temp",
  devices: [STUDIO, LAPTOP],
  places: [
    {
      ...HOME.places[0]!,
      ref: { device: STUDIO, placeId: "pl_tmp_a" },
      path: "/tmp/x",
      class: "temp",
    },
    {
      ...HOME.places[0]!,
      ref: { device: LAPTOP, placeId: "pl_tmp_b" },
      path: "/tmp/y",
      class: "temp",
    },
  ],
};

const session = (id: string, over: Partial<IndexSession> = {}): IndexSession => ({
  sessionId: id,
  nativeSessionId: `n-${id}`,
  rootSessionId: id,
  activity: null,
  streamState: "indexed",
  device: STUDIO,
  projectKey: TEMPORARY.key,
  ...over,
});
const at = (lastAt: number) => ({ activity: { firstAt: lastAt - 1_000, lastAt } });

describe("PJ-4 (H5) — Home and Temporary, as History's list will draw them", () => {
  it("names each Home this desktop holds — J11's one per desktop — and no other desktop's", () => {
    const laptopHome: ProjectSummary = {
      ...HOME,
      key: "p1:l4pt0ph0m3",
      devices: [LAPTOP],
      places: [{ ...HOME.places[0]!, ref: { device: LAPTOP, placeId: "pl_home_b" } }],
    };
    expect(historySectionsOf([...PROJECTS, laptopHome], [], STUDIO, NOW).home).toEqual([
      { key: HOME.key, device: STUDIO },
    ]);
  });

  it("folds Temporary at 14 days: the recent ones newest first, the older ones (and the undated) behind 'Show older'", () => {
    const sessions = [
      session("fresh", at(NOW - 1 * DAY)),
      session("edge", at(NOW - TEMPORARY_RECENT_MS)),
      session("newest", at(NOW - 60_000)),
      session("stale", at(NOW - 15 * DAY)),
      // no activity: its source's freshness is its time
      session("by-update", { updatedAt: NOW - 30 * DAY }),
      // no time at all: never shown as recent on a guess
      session("undated"),
      // another project's, and another desktop's: neither is Temporary's here
      session("elsewhere", { ...at(NOW), projectKey: HOME.key }),
      session("on-the-laptop", { ...at(NOW), device: LAPTOP }),
    ];
    expect(historySectionsOf([...PROJECTS, TEMPORARY], sessions, STUDIO, NOW).temporary).toEqual({
      key: TEMPORARY.key,
      recent: ["newest", "fresh", "edge"],
      older: ["stale", "by-update", "undated"],
    });
  });

  it("says nothing it cannot: no Temporary place here is no row, and an unknown desktop is no section at all", () => {
    expect(historySectionsOf(PROJECTS, [], STUDIO, NOW).temporary).toBeNull();
    const onlyTheLaptops: ProjectSummary = {
      ...TEMPORARY,
      places: [TEMPORARY.places[1]!],
      devices: [LAPTOP],
    };
    expect(historySectionsOf([onlyTheLaptops], [], STUDIO, NOW).temporary).toBeNull();
    expect(historySectionsOf([...PROJECTS, TEMPORARY], [session("x", at(NOW))], null, NOW)).toEqual(
      { home: [], temporary: null },
    );
  });
});
