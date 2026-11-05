import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_FIELD } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type CorpusRecipe, recipeName } from "../src/godview/monitor/perf/corpus";
import { prepareMeshCorpus, streamPass } from "./lib/mesh-bench";
import { withVirtualTime } from "./lib/virtual-time";

// THE FOLD TICK'S FIDELITY (PG-9 S5a; VF-PM 11:15Z, S5's step 0 ruled (a)). A
// device run's corpora are minutes long, and at the product's fold tick
// (`AGENT_FIELD.FULL_TICK_MS`) every frame is every row whole, so S5 plays a
// coarser tick. This row measures what that costs on the phone's wire: S4a's
// mesh bench (`perf/lib/mesh-bench.ts`'s stream pass, at the phone's floor, in
// virtual time) on one recipe at the product's tick and at each coarser
// candidate. It keeps the COARSEST tick whose busy and idle B/s both stay
// within MARGIN of the product's; its verdict line names that tick and the
// margin, and the margin is its assertion. Outside `pnpm test` and
// `pnpm verify` (`vitest.perf.config.ts`).
//   ./node_modules/.bin/vitest run --config vitest.perf.config.ts perf/mesh-fidelity.perf.ts
//   [VF_GODVIEW_BENCH_OUT=<a lane directory>]   → mesh-fidelity.json there

export const FIDELITY_RECIPE: CorpusRecipe = { n: 20, durationMs: 8_000, seed: 1 };
export const FIDELITY_FOLDS_MS: readonly number[] = [250, 500];
export const MARGIN = 0.05;

interface FidelityRow {
  recipe: string;
  foldTickMs: number;
  busyBytesPerSecond: number;
  idleBytesPerSecond: number;
  busyFrames: number;
  /** |this − the product's tick| / the product's tick */
  busyDrift: number;
  idleDrift: number;
}

const drift = (value: number, reference: number): number =>
  reference === 0
    ? value === 0
      ? 0
      : Number.POSITIVE_INFINITY
    : Math.abs(value - reference) / reference;
const percent = (fraction: number): string => `${(fraction * 100).toFixed(2)}%`;

async function measure(foldTickMs: number): Promise<Omit<FidelityRow, "busyDrift" | "idleDrift">> {
  const prepared = prepareMeshCorpus({ ...FIDELITY_RECIPE, foldTickMs });
  const pass = await withVirtualTime(prepared.baseWall, (time) => streamPass(prepared, time));
  return {
    recipe: recipeName({ ...FIDELITY_RECIPE, foldTickMs }),
    foldTickMs,
    busyBytesPerSecond: pass.busy.bytesPerSecond,
    idleBytesPerSecond: pass.idle.bytesPerSecond,
    busyFrames: pass.busy.frames,
  };
}

describe("the corpus fold tick's fidelity on the phone's wire (PG-9 S5a)", () => {
  it("keeps the coarsest fold tick whose busy and idle B/s stay within the margin of the product's own", async () => {
    const product = await measure(AGENT_FIELD.FULL_TICK_MS);
    const rows: FidelityRow[] = [{ ...product, busyDrift: 0, idleDrift: 0 }];
    for (const fold of FIDELITY_FOLDS_MS) {
      const row = await measure(fold);
      rows.push({
        ...row,
        busyDrift: drift(row.busyBytesPerSecond, product.busyBytesPerSecond),
        idleDrift: drift(row.idleBytesPerSecond, product.idleBytesPerSecond),
      });
    }
    const kept = rows
      .filter((row) => row.busyDrift <= MARGIN && row.idleDrift <= MARGIN)
      .reduce((a, b) => (b.foldTickMs > a.foldTickMs ? b : a));

    const lines = rows.map(
      (row) =>
        `${row.recipe} (fold ${row.foldTickMs} ms): busy ${row.busyBytesPerSecond} B/s (${row.busyFrames} frames, ${percent(row.busyDrift)}), idle ${row.idleBytesPerSecond} B/s (${percent(row.idleDrift)})`,
    );
    lines.push(
      `fidelity: fold ${kept.foldTickMs} ms, the coarsest within ${percent(MARGIN)} of fold ${AGENT_FIELD.FULL_TICK_MS} ms's busy and idle B/s (busy ${percent(kept.busyDrift)}, idle ${percent(kept.idleDrift)})`,
    );
    const out = process.env["VF_GODVIEW_BENCH_OUT"];
    if (out !== undefined && out !== "") {
      const path = join(out, "mesh-fidelity.json");
      writeFileSync(
        path,
        `${JSON.stringify({ margin: MARGIN, kept: kept.foldTickMs, rows }, null, 2)}\n`,
      );
      lines.push(`→ ${path}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);

    expect(
      kept.busyDrift,
      `fold ${kept.foldTickMs} ms: busy within the margin`,
    ).toBeLessThanOrEqual(MARGIN);
    expect(
      kept.idleDrift,
      `fold ${kept.foldTickMs} ms: idle within the margin`,
    ).toBeLessThanOrEqual(MARGIN);
  });
});
