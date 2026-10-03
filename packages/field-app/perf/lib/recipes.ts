import type { CorpusRecipe } from "../../src/godview/monitor/perf/corpus";

// THE RECIPES every MV-0 instrument shares (the fixtures, the oracle, the seam
// bench, the Electron lab): n = 10 / 20 / 60 at the fixed change rates
// `resolveRecipe` defaults. The in-repo set is short — it is a pin, not a
// workload; the lane set is the workload (8 s = 500 fold frames) and lives
// outside the repo.

export const IN_REPO_RECIPES: readonly CorpusRecipe[] = [
  { n: 10, durationMs: 2_000, seed: 1 },
  { n: 20, durationMs: 2_000, seed: 1 },
  { n: 60, durationMs: 1_000, seed: 1 },
];

export const LANE_RECIPES: readonly CorpusRecipe[] = [
  { n: 10, durationMs: 8_000, seed: 1 },
  { n: 20, durationMs: 8_000, seed: 1 },
  { n: 60, durationMs: 8_000, seed: 1 },
];

/** The lab's recipe spelling for the lane set: `n=10,duration=8000,seed=1`. */
export function recipeText(recipe: CorpusRecipe): string {
  return [`n=${recipe.n}`, `duration=${recipe.durationMs}`, `seed=${recipe.seed ?? 1}`].join(",");
}
