/**
 * THE PROOF AUDIT (MV-8b, M176 item 3) — `scripts/perf-godview-proof.mjs`: a
 * run's files say it measured what it says before a grade is read. A healthy
 * run passes; each row breaks one thing the audit owes and is refused in its
 * own words. Held against recorded runs too, where the lab exists
 * (`godview-perf-runs.ts` writes the synthetic ones).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { RECIPE, reportName, script, writeRun } from "./godview-perf-runs";

interface Launch {
  arm: string;
  round: number;
  startLoad: number | null;
  endLoad: number | null;
}
interface Loads {
  endLoadRange: [number, number] | null;
  endLoadUnread: number;
  endedOverQuiet: Launch[];
}
interface Account extends Loads {
  reports: number;
  cells: number;
  profiles: number;
  verdict: string;
  rounds: number;
  loadRange: [number, number] | null;
  quietLine: number;
  quietLineFrom: string;
}
interface Proof {
  auditProof(dir: string, options?: { quiet?: number }): Account;
  declaredMembership(recipe: string, viewId: string): Record<string, unknown>;
  quietLine(summary: unknown, asked?: number): { quietLine: number; quietLineFrom: string };
  launchLoads(
    summary: unknown,
    launches: { arm: string; round: number; loadavg?: unknown }[],
    quiet: number,
  ): Loads;
  overQuietLines(account: Pick<Account, "quietLine" | "endedOverQuiet">): string[];
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

describe("the proof audit's reading of the load at each launch's two ends", () => {
  it("reads both ranges off a quiet run, held to the run's own --load-max, and names nobody", async () => {
    const dir = await healthyRun();
    expect(proof.auditProof(dir)).toMatchObject({
      loadRange: [4, 4],
      endLoadRange: [5, 5],
      endLoadUnread: 0,
      quietLine: 60,
      quietLineFrom: "the run's --load-max",
      endedOverQuiet: [],
    });
  });

  it("names every launch that ended over the quiet line, in launch order, and still passes", async () => {
    const dir = await healthyRun();
    // round 1 ran A B A′, round 2 A′ B A: every launch started at 4
    const ended = (arm: string, round: number, load: number): void =>
      edit(dir, reportName(arm, round), (json) => {
        json["loadavg"] = [load, 39.1, 32.2];
      });
    ended("A", 2, 108.1572265625);
    ended("B", 1, 72.5);
    ended("A′", 1, 60); // AT the line is not over it
    const account = proof.auditProof(dir);
    expect(account.verdict).toBe("unread");
    expect(account.loadRange).toEqual([4, 4]);
    expect(account.endLoadRange).toEqual([5, 108.1572265625]);
    expect(account.endedOverQuiet).toEqual([
      { arm: "B", round: 1, startLoad: 4, endLoad: 72.5 },
      { arm: "A", round: 2, startLoad: 4, endLoad: 108.1572265625 },
    ]);
    expect(proof.overQuietLines(account)).toEqual([
      "B r1 ended over the quiet line (60): load 4.00 before the launch, 72.50 at its end",
      "A r2 ended over the quiet line (60): load 4.00 before the launch, 108.16 at its end",
    ]);
  });

  it("holds a run that recorded no --load-max to 15, and the caller's --quiet beats both", async () => {
    const dir = await healthyRun();
    edit(dir, reportName("A′", 2), (json) => {
      json["loadavg"] = [18.05, 11.4, 9.6];
    });
    expect(proof.auditProof(dir).endedOverQuiet).toEqual([]);
    expect(proof.auditProof(dir, { quiet: 15 })).toMatchObject({
      quietLine: 15,
      quietLineFrom: "--quiet",
      endedOverQuiet: [{ arm: "A′", round: 2, startLoad: 4, endLoad: 18.05 }],
    });
    // a run from before the runner recorded its ceiling
    edit(dir, "summary.json", (json) => {
      delete json["loadMax"];
    });
    expect(proof.auditProof(dir)).toMatchObject({
      quietLine: 15,
      quietLineFrom: "default",
      endedOverQuiet: [{ arm: "A′", round: 2 }],
    });
    expect(proof.auditProof(dir, { quiet: 20 }).endedOverQuiet).toEqual([]);
  });

  it("prints the account, one plain line per loud launch, then PROOF OK — and still exits 0", async () => {
    const dir = await healthyRun();
    edit(dir, reportName("A′", 2), (json) => {
      json["loadavg"] = [18.05, 11.4, 9.6];
    });
    const audit = join(import.meta.dirname, "..", "..", "..", "scripts", "perf-godview-proof.mjs");
    // execFileSync throws on any exit but 0
    const out = execFileSync(process.execPath, [audit, dir, "--quiet", "15"], { encoding: "utf8" });
    const [account, ...rest] = out.trimEnd().split("\n");
    expect(JSON.parse(account ?? "")).toMatchObject({
      verdict: "unread",
      quietLine: 15,
      endedOverQuiet: [{ arm: "A′", round: 2 }],
    });
    expect(rest).toEqual([
      "A′ r2 ended over the quiet line (15): load 4.00 before the launch, 18.05 at its end",
      "PROOF OK — instrument validation, not a performance grade",
    ]);
  });

  it("the quiet line is the caller's, else the run's, else 15", () => {
    expect(proof.quietLine({ loadMax: 8 }, 30)).toEqual({
      quietLine: 30,
      quietLineFrom: "--quiet",
    });
    expect(proof.quietLine({ loadMax: 8 })).toEqual({
      quietLine: 8,
      quietLineFrom: "the run's --load-max",
    });
    expect(proof.quietLine({})).toEqual({ quietLine: 15, quietLineFrom: "default" });
    expect(proof.quietLine({ loadMax: "60" }, Number.NaN)).toMatchObject({ quietLine: 15 });
  });

  it("reads what is there: a launch with no start on record, a report with no end", () => {
    const summary = {
      loads: [
        { round: 1, arm: "A", load: 3 },
        { round: 1, arm: "B", load: 14.8 },
      ],
    };
    const loads = proof.launchLoads(
      summary,
      [
        { arm: "A′", round: 1, loadavg: [40, 20, 10] }, // the runner recorded no start for it
        { arm: "B", round: 1, loadavg: [28.8, 14, 10] },
        { arm: "A", round: 1 }, // a report from a lab that wrote no loadavg
      ],
      15,
    );
    expect(loads.endLoadRange).toEqual([28.8, 40]);
    expect(loads.endLoadUnread).toBe(1);
    // launch order as the runner recorded it; a launch it did not record comes last
    expect(loads.endedOverQuiet).toEqual([
      { arm: "B", round: 1, startLoad: 14.8, endLoad: 28.8 },
      { arm: "A′", round: 1, startLoad: null, endLoad: 40 },
    ]);
    expect(proof.overQuietLines({ quietLine: 15, endedOverQuiet: loads.endedOverQuiet })[1]).toBe(
      "A′ r1 ended over the quiet line (15): load unread before the launch, 40.00 at its end",
    );
    expect(proof.launchLoads({}, [], 15)).toEqual({
      endLoadRange: null,
      endLoadUnread: 0,
      endedOverQuiet: [],
    });
  });
});
