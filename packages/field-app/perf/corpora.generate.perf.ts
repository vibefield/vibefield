import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCorpus, recipeName } from "../src/godview/monitor/perf/corpus";
import { corpusGzBytes, writeCorpusGz } from "./lib/corpus-io";
import { IN_REPO_RECIPES, LANE_RECIPES, parseRecipeList } from "./lib/recipes";

// WRITE THE CORPORA (MV-0, step 3). The small ones go in-repo under
// `test/fixtures/godview-corpora/` (pinned by `godview-corpus.test.ts`: the
// generator must reproduce them byte for byte); the large ones go wherever
// `VF_GODVIEW_CORPORA_OUT` points (a lane directory, never committed), over
// `LANE_RECIPES` unless `VF_GODVIEW_CORPORA_RECIPES` names its own (PG-9 S5a:
// a device run's corpora, minutes long on a coarser fold tick, for fieldd's
// `FIELDD_DEBUG_SWARM_CORPUS`).
//
//   pnpm --filter @vibefield/field-app perf:godview:corpora
//   VF_GODVIEW_CORPORA_OUT=/Volumes/SamsungRed/lanes/mv/mv0-vf/perf/corpora \
//     [VF_GODVIEW_CORPORA_RECIPES="n=5,duration=300000,seed=1,fold=500;…"] \
//     pnpm --filter @vibefield/field-app perf:godview:corpora

export const FIXTURES_DIR = join(import.meta.dirname, "..", "test", "fixtures", "godview-corpora");

describe("the corpora", () => {
  it("writes the in-repo fixtures (small, a few hundred KB gzipped at most)", () => {
    const written: string[] = [];
    for (const recipe of IN_REPO_RECIPES) {
      const corpus = generateCorpus(recipe);
      const path = join(FIXTURES_DIR, `${recipeName(recipe)}.jsonl.gz`);
      const bytes = writeCorpusGz(path, corpus);
      written.push(`${recipeName(recipe)}: ${corpus.frames.length} frames, ${bytes} B gz`);
      expect(bytes).toBeLessThan(1_500_000);
    }
    process.stdout.write(`${written.join("\n")}\n`);
  });

  it("writes the lane corpora when asked", () => {
    const out = process.env["VF_GODVIEW_CORPORA_OUT"];
    if (out === undefined || out === "") {
      process.stdout.write("VF_GODVIEW_CORPORA_OUT unset: the lane corpora were not written\n");
      return;
    }
    const asked = process.env["VF_GODVIEW_CORPORA_RECIPES"];
    const recipes = asked ? parseRecipeList(asked) : LANE_RECIPES;
    const written: string[] = [];
    for (const recipe of recipes) {
      const corpus = generateCorpus(recipe);
      const path = join(out, `${recipeName(recipe)}.jsonl.gz`);
      writeCorpusGz(path, corpus);
      written.push(
        `${recipeName(recipe)}: ${corpus.frames.length} frames, ${statSync(path).size} B gz (${corpusGzBytes(corpus)} B)`,
      );
    }
    process.stdout.write(`${written.join("\n")}\n`);
  });
});
