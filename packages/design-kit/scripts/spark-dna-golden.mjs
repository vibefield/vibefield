#!/usr/bin/env node
// IOS-12a (PC-D6 A, the design page Chat in a Pocket, ruled 2026-11-04) — the spark face's DNA golden: what the
// vendored engine (`src/spark-face/vendor/sparks.js`, James's `agent-sparks/sparks.js` byte for byte; DESIGN.md §2.10)
// deals for a fixed set of seeds, so the phone's transcription of `agentDNA` into Swift (IOS-12b) is held to it, as
// `FaceDeckTests` holds the user face. Per seed: `agentDNA(seed)` (its palette and the body's and eyes' traits), and
// what the engine builds from them, `makeBody(seed, dna.body)` (the star's points) and `makeEyes(seed, dna.eyes)`; then
// the twelve palettes a spark draws from, as a face draws them (its name, its colours, its backdrop). No stills: they
// are WebGL2 renders, and IOS-12e holds its Metal star to the engine's own.
//
// A change to the engine changes every spark's face, so this file moves only on purpose:
//   node packages/design-kit/scripts/spark-dna-golden.mjs           writes the golden
//   node packages/design-kit/scripts/spark-dna-golden.mjs --check   exits 1 when the golden is not the engine's
// field-app's spark-face test reads the golden against the engine as the window loads it, and
// `pnpm check:ios-fixtures` keeps the kit's copy byte-identical.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(KIT, "src/spark-face/vendor/sparks.js");
const GOLDEN = join(KIT, "fixtures/spark-dna.golden.json");

/** The seeds the golden deals: the ends of the range, the seeds the contracts' fixtures and the kit's tests wear, and
 * an even spread across the 32 bits. */
export const SPARK_DNA_SEEDS = [
  0,
  1,
  2,
  7,
  4211,
  1048573,
  90210417,
  2846113027,
  0x7fffffff,
  0x80000000,
  0xffffffff,
  ...Array.from({ length: 13 }, (_, i) => i * 330382100 + 13),
];

/** How many of the engine's palettes a spark draws from (`agentDNA`'s `palette` is below it). */
export const SPARK_PALETTES = 12;

/** The golden, dealt by an engine (`window.Sparklings`, however it was loaded). */
export function dealSparkDna(engine) {
  return {
    "//": "IOS-12a (PC-D6 A). The vendored spark engine's DNA for each seed, and its twelve palettes. Regenerate on purpose: node packages/design-kit/scripts/spark-dna-golden.mjs (then the kit's copy: pnpm check:ios-fixtures names it).",
    seeds: SPARK_DNA_SEEDS.map((seed) => {
      const dna = engine.agentDNA(seed);
      return {
        seed,
        dna,
        body: engine.makeBody(seed, dna.body),
        eyes: engine.makeEyes(seed, dna.eyes),
      };
    }),
    // what a face is drawn with (`SparkPalette`): the engine's `sky` is data it never draws, so the golden omits it
    palettes: engine.PALETTES.slice(0, SPARK_PALETTES).map(({ name, c, deep }) => ({
      name,
      c,
      deep,
    })),
  };
}

/** The engine, loaded as the window loads it: one IIFE that sets `window.Sparklings`. */
function loadEngine() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(ENGINE, "utf8"), context, { filename: ENGINE });
  return context.window.Sparklings;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // through JSON once, so the vm realm's arrays and objects are plain ones
  const text = `${JSON.stringify(JSON.parse(JSON.stringify(dealSparkDna(loadEngine()))), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const kept = readFileSync(GOLDEN, "utf8");
    if (kept !== text) {
      console.error(
        `spark-dna golden: ${GOLDEN} is not what the vendored engine deals; regenerate on purpose`,
      );
      process.exit(1);
    }
    console.log(`spark-dna golden: ${SPARK_DNA_SEEDS.length} seeds, the engine's`);
  } else {
    writeFileSync(GOLDEN, text);
    console.log(`spark-dna golden: wrote ${SPARK_DNA_SEEDS.length} seeds`);
  }
}
