/**
 * THE PROOF AUDIT (MV-8b, M176 item 3) — `scripts/perf-godview-proof.mjs`: a
 * run's files say it measured what it says before a grade is read. A healthy
 * run passes; each row breaks one thing the audit owes and is refused in its
 * own words. Held against recorded runs too, where the lab exists
 * (`godview-perf-runs.ts` writes the synthetic ones).
 */
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { RECIPE, reportName, script, writeRun } from "./godview-perf-runs";

interface Proof {
  auditProof(dir: string): {
    reports: number;
    cells: number;
    profiles: number;
    verdict: string;
    rounds: number;
  };
  declaredMembership(recipe: string, viewId: string): Record<string, unknown>;
}

let proof: Proof;
beforeAll(async () => {
  proof = await script<Proof>("perf-godview-proof.mjs");
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function healthyRun(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "vf-perf-proof-"));
  dirs.push(dir);
  await writeRun(dir, { rounds: 2 });
  return dir;
}

type Json = Record<string, unknown> & { cells: Record<string, unknown>[] };
/** Rewrite one report (or the summary) through `change`. */
function edit(dir: string, name: string, change: (json: Json) => void): void {
  const path = join(dir, name);
  const json = JSON.parse(readFileSync(path, "utf8")) as Json;
  change(json);
  writeFileSync(path, JSON.stringify(json));
}
const cell = (json: Json, index = 0) =>
  json.cells[index] as Record<string, Record<string, unknown>>;

describe("the proof audit", () => {
  it("passes a complete, healthy run and accounts for it", async () => {
    const dir = await healthyRun();
    expect(proof.auditProof(dir)).toMatchObject({
      reports: 6,
      cells: 12,
      profiles: 6,
      rounds: 2,
      verdict: "unread",
    });
  });

  it("declares the recipe's corpus as field-app's resolveRecipe does", () => {
    expect(proof.declaredMembership(RECIPE, "list")).toEqual({
      viewId: "list",
      agents: 13,
      localAgents: 10,
      terminals: 0,
      remoteSessions: 3,
      remoteHosts: 1,
      shownAgents: 13,
    });
    // the defaults: two bare terminals, a quarter of n (at least one) on the peer
    expect(proof.declaredMembership("n=60,duration=8000", "swarm")).toMatchObject({
      agents: 77,
      terminals: 2,
      remoteSessions: 15,
    });
    expect(proof.declaredMembership("n=2,duration=8000,peers=0", "rain")).toMatchObject({
      remoteSessions: 0,
      remoteHosts: 0,
    });
  });

  const refusals: Array<[string, (dir: string) => void, RegExp]> = [
    [
      "a launch that never wrote its report",
      (dir) => unlinkSync(join(dir, reportName("B", 2))),
      /B-r2\.json: missing/,
    ],
    [
      "a launch the summary never declared",
      (dir) => writeFileSync(join(dir, "B-r3.json"), readFileSync(join(dir, "B-r1.json"))),
      /B-r3\.json: not a declared launch/,
    ],
    [
      "a launch record that never ended",
      (dir) =>
        edit(dir, reportName("A", 1), (json) => {
          json["endedAt"] = 0;
        }),
      /never ended/,
    ],
    [
      "a cell the run asked for and never measured",
      (dir) =>
        edit(dir, reportName("A′", 2), (json) => {
          json.cells.pop();
        }),
      /not every view × recipe/,
    ],
    [
      "a replay that delivered nothing",
      (dir) =>
        edit(dir, reportName("B", 1), (json) => {
          cell(json)["replay"]!["delivered"] = 0;
        }),
      /delivered nothing/,
    ],
    [
      "two model listeners",
      (dir) =>
        edit(dir, reportName("B", 1), (json) => {
          cell(json)["replay"]!["listeners"] = { fold: 0, mesh: 0, model: 2 };
        }),
      /2 model listeners, not one/,
    ],
    [
      "a model arm that still read the fold",
      (dir) =>
        edit(dir, reportName("A", 2), (json) => {
          cell(json)["replay"]!["listeners"] = { fold: 1, mesh: 0, model: 1 };
        }),
      /retired fold\/mesh/,
    ],
    [
      "a view whose own root never committed",
      (dir) =>
        edit(dir, reportName("A", 1), (json) => {
          (cell(json)["report"]!["react"] as Record<string, unknown>)["roots"] = [
            { label: "div#root", commits: 9 },
          ];
        }),
      /own root \(mv-swarm\)/,
    ],
    [
      "a swarm that drew without WebGPU",
      (dir) =>
        edit(dir, reportName("B", 2), (json) => {
          (cell(json) as Record<string, unknown>)["swarmRenderer"] = "canvas2d";
        }),
      /not WebGPU/,
    ],
    [
      "a deck that was not one healthy pane",
      (dir) =>
        edit(dir, reportName("A", 1), (json) => {
          (cell(json)["deck"] as Record<string, unknown>)["end"] = { active: true, panes: 0 };
        }),
      /deck proof/,
    ],
    [
      "a monitor that drew another corpus",
      (dir) =>
        edit(dir, reportName("B", 1), (json) => {
          cell(json)["monitor"]!["remoteSessions"] = 4;
          cell(json)["monitor"]!["agents"] = 14;
          cell(json)["monitor"]!["shownAgents"] = 14;
        }),
      /not the declared corpus/,
    ],
    [
      "a Chromium profile two launches shared",
      (dir) =>
        edit(dir, reportName("A′", 1), (json) => {
          json["profile"] = JSON.parse(readFileSync(join(dir, reportName("A", 1)), "utf8")).profile;
        }),
      /profile reused/,
    ],
    [
      "a summary that never judged",
      (dir) =>
        edit(dir, "summary.json", (json) => {
          delete json["gate"];
        }),
      /no gate verdict/,
    ],
  ];
  it.each(refusals)("refuses %s", async (_what, breakIt, said) => {
    const dir = await healthyRun();
    breakIt(dir);
    expect(() => proof.auditProof(dir)).toThrow(said);
  });

  it("refuses a run with no summary: it did not complete", async () => {
    const dir = await healthyRun();
    unlinkSync(join(dir, "summary.json"));
    expect(() => proof.auditProof(dir)).toThrow(/did not complete/);
  });
});
