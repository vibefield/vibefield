import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, it } from "vitest";
import { USAGE_BANDS_GOLDEN, usageBandsFile } from "./lib/usage-bands-golden";

// WRITE THE USAGE BANDS GOLDEN (UM-1, PLAN §4 v0.2): the meter model and the Bands geometry over the contracts'
// profile sets and usage batches (`perf/lib/usage-bands-golden.ts`, computed by `src/usage/golden.ts`), into
// `test/fixtures/usage/`, pinned byte for byte by `test/usage-bands.test.ts`. Its ONE writer (biome is told to leave
// it), so a diff reads one row per line. Every regeneration is a re-bless, said in its commit, with the phone's copy
// to refresh (`pnpm check:ios-fixtures` names it once U3 mirrors it).
//
//   ./node_modules/.bin/vitest run --config vitest.perf.config.ts perf/usage-bands.generate.perf.ts
//   (from packages/field-app)

describe("the usage bands golden", () => {
  it("writes the meters and the Bands circles over the contracts' profiles and usage", () => {
    const bytes = usageBandsFile();
    let before: string | null = null;
    try {
      before = readFileSync(USAGE_BANDS_GOLDEN, "utf8");
    } catch {
      before = null;
    }
    mkdirSync(dirname(USAGE_BANDS_GOLDEN), { recursive: true });
    writeFileSync(USAGE_BANDS_GOLDEN, bytes);
    const verdict = before === null ? "WRITTEN" : before === bytes ? "unchanged" : "RE-BLESSED";
    process.stdout.write(
      `usage-bands.golden.json: ${verdict} (${Buffer.byteLength(bytes)} bytes, ${bytes.split("\n").length - 1} lines)\n`,
    );
  });
});
