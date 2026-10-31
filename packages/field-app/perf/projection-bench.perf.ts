import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCH_CUTS,
  type BenchCounts,
  type BenchCut,
  boardAtOpen,
  countCut,
  median,
  type PreparedCorpus,
  perSecond,
  prepareCorpus,
  timeCut,
} from "./lib/projection-bench";
import { IN_REPO_RECIPES, parseRecipeList } from "./lib/recipes";
import { withVirtualTime } from "./lib/virtual-time";

// THE PROJECTION BENCH (PG-1e0, `perf/lib/projection-bench.ts`): what each of
// a desktop's three cuts projects per corpus-second, and how much of it moved.
// Outside `pnpm test` and `pnpm verify` (`vitest.perf.config.ts`), and it
// asserts no budget: it records the numbers 1e1 and 1e2 are decided by.
//
//   pnpm --filter @vibefield/field-app perf:godview:projection
//   VF_GODVIEW_BENCH_OUT=/Volumes/SamsungRed/lanes/ios/pg1e0 \
//     [VF_GODVIEW_BENCH_RECIPES="n=20,duration=8000,seed=1;…"] \
//     [VF_GODVIEW_BENCH_CPU=5] \
//     pnpm --filter @vibefield/field-app perf:godview:projection
//
// The counts run always, over the in-repo recipes unless the lane names its
// own. The CPU passes run only when `VF_GODVIEW_BENCH_CPU` names a number of
// rounds, on a quiet host: each round is the baseline (no cut) before every
// cut, so a cut's figure is its pass less the baseline beside it.

const out = process.env["VF_GODVIEW_BENCH_OUT"];
const asked = process.env["VF_GODVIEW_BENCH_RECIPES"];
const recipes = asked ? parseRecipeList(asked) : IN_REPO_RECIPES;

const counted = (prepared: PreparedCorpus, cut: BenchCut) =>
  withVirtualTime(prepared.baseWall, (time) => countCut(prepared, cut, time));
const timed = (prepared: PreparedCorpus, cut: BenchCut | null) =>
  withVirtualTime(prepared.baseWall, (time) => timeCut(prepared, cut, time));

function written(name: string, value: unknown): string {
  if (out === undefined || out === "") return "";
  const path = join(out, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return ` → ${path}`;
}

describe("the projection bench (PG-1e0)", () => {
  it("counts every cut's projections per corpus-second", async () => {
    const results: BenchCounts[] = [];
    const lines: string[] = [];
    for (const recipe of recipes) {
      const prepared = prepareCorpus(recipe);
      const open = await withVirtualTime(prepared.baseWall, (time) => boardAtOpen(prepared, time));
      const cuts = [];
      for (const cut of BENCH_CUTS) cuts.push(await counted(prepared, cut));
      results.push({
        recipe: prepared.name,
        n: recipe.n,
        durationMs: prepared.durationMs,
        ...open,
        cuts,
      });
      lines.push(
        `${prepared.name}: ${open.agents} agents, ${open.terminals} bare terminals, ${prepared.durationMs} ms`,
      );
      for (const c of cuts) {
        const s = (count: number) => perSecond(count, prepared.durationMs);
        const share = c.projected === 0 ? 0 : Math.round((c.moved / c.projected) * 1_000) / 10;
        lines.push(
          `  ${c.cut.padEnd(5)} ${String(c.floorMs).padStart(3)} ms: ${s(c.applies)} applies/s · ${s(c.projected)} rows projected/s · ${s(c.stampChars)} stamp chars/s · ${s(c.moved)} moved/s (${share}% of projected) · ${s(c.frames)} frames/s (${s(c.emptyFrames)} empty) · ${s(c.upserts)} upserts/s · ${s(c.frameChars)} frame chars/s`,
        );
        // what a counted apply must satisfy, or the bench miscounts
        expect(c.applies, `${prepared.name} ${c.cut}: listed`).toBeGreaterThan(0);
        expect(c.projected, `${prepared.name} ${c.cut}: projected`).toBeGreaterThan(0);
        expect(c.moved, `${prepared.name} ${c.cut}: moved ≤ projected`).toBeLessThanOrEqual(
          c.projected,
        );
        // every upsert a frame carries is a row an apply found moved; the open's
        // own rows moved too, and went out in the open, not a frame
        expect(c.upserts, `${prepared.name} ${c.cut}: upserts ≤ moved`).toBeLessThanOrEqual(
          c.moved,
        );
        // and exactly so while no row leaves and no snapshot replaces the board:
        // each moved row past the open is one upsert, so the bench's stamps found
        // what the projection's own did, row for row
        if (c.removed === 0 && c.snapshots === 0) {
          const atOpen = open.agents + (c.cut === "model" ? open.terminals : 0);
          expect(c.upserts, `${prepared.name} ${c.cut}: upserts = moved − the open`).toBe(
            c.moved - atOpen,
          );
        }
      }
      const all = cuts.reduce((sum, c) => sum + c.projected, 0);
      const moved = cuts.reduce((sum, c) => sum + c.moved, 0);
      lines.push(
        `  all three: ${perSecond(all, prepared.durationMs)} rows projected/s, ${perSecond(moved, prepared.durationMs)} moved/s; ${BENCH_CUTS.length} cuts project the same fold rows`,
      );
    }
    process.stdout.write(`${lines.join("\n")}${written("projection-counts.json", results)}\n`);
  });

  it("times every cut against no cut, interleaved (VF_GODVIEW_BENCH_CPU=rounds)", async () => {
    const rounds = Number(process.env["VF_GODVIEW_BENCH_CPU"] ?? "0");
    if (!Number.isInteger(rounds) || rounds < 1) {
      process.stdout.write("VF_GODVIEW_BENCH_CPU unset: the CPU passes did not run\n");
      return;
    }
    const results = [];
    const lines: string[] = [];
    for (const recipe of recipes) {
      const prepared = prepareCorpus(recipe);
      // one pass of each first, unmeasured: the module and JIT warm-up is no cut's
      await timed(prepared, null);
      for (const cut of BENCH_CUTS) await timed(prepared, cut);
      const baselines: number[] = [];
      const added: Record<BenchCut, number[]> = { model: [], desk: [], field: [] };
      for (let round = 0; round < rounds; round += 1) {
        for (const cut of BENCH_CUTS) {
          const base = await timed(prepared, null);
          const pass = await timed(prepared, cut);
          baselines.push(base);
          added[cut].push(pass - base);
        }
      }
      const ms = (micros: number) => Math.round(micros / 100) / 10;
      const floor = {
        median: median(baselines),
        min: Math.min(...baselines),
        max: Math.max(...baselines),
      };
      results.push({
        recipe: prepared.name,
        durationMs: prepared.durationMs,
        rounds,
        baselineMicros: baselines,
        addedMicros: added,
      });
      lines.push(
        `${prepared.name}, ${rounds} rounds: the baseline ${ms(floor.median)} ms CPU (${ms(floor.min)}–${ms(floor.max)}, the noise floor)`,
      );
      for (const cut of BENCH_CUTS) {
        const each = added[cut];
        lines.push(
          `  ${cut.padEnd(5)} adds ${ms(median(each))} ms CPU over ${prepared.durationMs} ms (${ms(Math.min(...each))}–${ms(Math.max(...each))}); ${ms(median(each) / (prepared.durationMs / 1_000))} ms per corpus-second`,
        );
      }
    }
    process.stdout.write(`${lines.join("\n")}${written("projection-cpu.json", results)}\n`);
  });
});
