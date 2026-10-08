import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recipeName, resolveRecipe } from "../src/godview/monitor/perf/corpus";
import { modelStreamFileName } from "../src/godview/monitor/perf/model-stream";
import { writeModelStreamGz } from "./lib/corpus-io";
import { computeModelStream } from "./lib/model-stream";
import { IN_REPO_RECIPES, LANE_RECIPES, parseRecipeList } from "./lib/recipes";
import { withVirtualTime } from "./lib/virtual-time";

// WRITE THE MODEL STREAMS (MV-3c, step 2): for every corpus recipe, what the
// window's one door would have answered (`perf/lib/model-stream.ts`). The
// small ones go in-repo beside the corpora, under
// `test/fixtures/godview-model-streams/` (pinned by `godview-model-stream.test.ts`:
// the computation must reproduce them byte for byte); the large ones go
// wherever `VF_GODVIEW_MODEL_OUT` points (a lane directory, never committed),
// for the paired harness's B arm (`pnpm perf:godview`, which runs this itself
// in B's checkout — the stream is B's fieldd's answer, so B computes it).
//
//   pnpm --filter @vibefield/field-app perf:godview:model
//   VF_GODVIEW_MODEL_OUT=/Volumes/SamsungRed/lanes/mv/mv3c/perf/model-streams \
//     [VF_GODVIEW_MODEL_RECIPES="n=10,duration=8000,seed=1;…"] \
//     pnpm --filter @vibefield/field-app perf:godview:model

export const MODEL_FIXTURES_DIR = join(
  import.meta.dirname,
  "..",
  "test",
  "fixtures",
  "godview-model-streams",
);

describe("the model streams", () => {
  it("writes the in-repo fixtures", async () => {
    if (process.env["VF_GODVIEW_MODEL_OUT"]) {
      process.stdout.write("VF_GODVIEW_MODEL_OUT set: the in-repo fixtures are left as they are\n");
      return;
    }
    const written: string[] = [];
    for (const recipe of IN_REPO_RECIPES) {
      const { stream } = await withVirtualTime(resolveRecipe(recipe).baseWall, (time) =>
        computeModelStream(recipe, time),
      );
      const path = join(MODEL_FIXTURES_DIR, modelStreamFileName(recipeName(recipe)));
      const bytes = writeModelStreamGz(path, stream);
      written.push(
        `${recipeName(recipe)}: ${stream.frames.length} frames (${stream.meta.counts.frames} model, ${stream.meta.counts.upserts} upserts), ${bytes} B gz`,
      );
      expect(bytes).toBeLessThan(1_500_000);
    }
    process.stdout.write(`${written.join("\n")}\n`);
  });

  it("writes the lane streams when asked", async () => {
    const out = process.env["VF_GODVIEW_MODEL_OUT"];
    if (out === undefined || out === "") {
      process.stdout.write("VF_GODVIEW_MODEL_OUT unset: the lane streams were not written\n");
      return;
    }
    const asked = process.env["VF_GODVIEW_MODEL_RECIPES"];
    const recipes = asked ? parseRecipeList(asked) : LANE_RECIPES;
    const written: string[] = [];
    for (const recipe of recipes) {
      const { stream } = await withVirtualTime(resolveRecipe(recipe).baseWall, (time) =>
        computeModelStream(recipe, time),
      );
      const path = join(out, modelStreamFileName(recipeName(recipe)));
      const bytes = writeModelStreamGz(path, stream);
      written.push(
        `${recipeName(recipe)}: ${stream.frames.length} frames (${stream.meta.counts.frames} model, ${stream.meta.counts.upserts} upserts, ${stream.meta.counts.bytes} B JSON), ${bytes} B gz → ${path}`,
      );
    }
    process.stdout.write(`${written.join("\n")}\n`);
  });
});
