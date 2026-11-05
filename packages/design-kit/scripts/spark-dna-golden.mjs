#!/usr/bin/env node
// IOS-12a (PC-D6 A, the design page Chat in a Pocket, ruled 2026-11-04) — the spark face's DNA golden: what the
// vendored engine (`src/spark-face/vendor/sparks.js`, James's `agent-sparks/sparks.js` byte for byte; DESIGN.md §2.10)
// deals for a fixed set of seeds, so the phone's transcription of `agentDNA` into Swift (IOS-12b) is held to it, as
// `FaceDeckTests` holds the user face. Per seed: `agentDNA(seed)` (its palette and the body's and eyes' traits), and
// what the engine builds from them, `makeBody(seed, dna.body)` (the star's points) and `makeEyes(seed, dna.eyes)`; then
// the twelve palettes a spark draws from, as a face draws them (its name, its colours, its backdrop). No stills: they
// are WebGL2 renders, and IOS-12e holds its Metal star to the engine's own.
//
// IOS-12b (VF-PM's Q3, 2026-11-05): beside it, the flat star's golden (`spark-flat-star.golden.json`): what design-kit's
// `flat-star.ts` draws for the same seeds from the engine's body and eyes — the outline as its SVG path, and the two
// pill eyes at each face scale the phone draws (1, 1.12 and 1.25; `sparkFaceScale`). It records only what a seed's
// outline and eyes ARE. The phone's flat star (IOS-12b) is held to it, and field-app's spark-face test holds it to
// flat-star.ts.
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
const FLAT_GOLDEN = join(KIT, "fixtures/spark-flat-star.golden.json");

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

/** The face scales the phone draws a flat star at (`sparkFaceScale`: 1 above 48, 1.12 to 48, 1.25 to 32). */
export const SPARK_FACE_SCALES = [1, 1.12, 1.25];

/** The flat star's golden: for each seed, the outline and the eyes `flatStar` draws from the engine's body and eyes. */
export function dealSparkFlatStar(engine, flatStar) {
  return {
    "//": "IOS-12b (PC-D6 A; VF-PM Q3). design-kit's flat star for each seed of the DNA golden: the outline (its SVG path) and the two pill eyes at each face scale. Regenerate on purpose: node packages/design-kit/scripts/spark-dna-golden.mjs (then the kit's copy: pnpm check:ios-fixtures names it).",
    faceScales: SPARK_FACE_SCALES,
    seeds: SPARK_DNA_SEEDS.map((seed) => {
      const dna = engine.agentDNA(seed);
      const body = engine.makeBody(seed, dna.body);
      const eyes = engine.makeEyes(seed, dna.eyes);
      return {
        seed,
        outline: flatStar(body, eyes, 1).outline,
        eyes: SPARK_FACE_SCALES.map((faceScale) => ({
          faceScale,
          pair: flatStar(body, eyes, faceScale).eyes,
        })),
      };
    }),
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
  const engine = loadEngine();
  // flat-star.ts imports only types, so Node loads it as it stands (type stripping)
  const { flatStar } = await import("../src/spark-face/flat-star.ts");
  // through JSON once, so the vm realm's arrays and objects are plain ones
  const render = (golden) => `${JSON.stringify(JSON.parse(JSON.stringify(golden)), null, 2)}\n`;
  const goldens = [
    ["spark-dna", GOLDEN, render(dealSparkDna(engine))],
    ["spark-flat-star", FLAT_GOLDEN, render(dealSparkFlatStar(engine, flatStar))],
  ];
  if (process.argv.includes("--check")) {
    let stale = false;
    for (const [name, path, text] of goldens) {
      if (readFileSync(path, "utf8") !== text) {
        console.error(
          `${name} golden: ${path} is not what the vendored engine deals; regenerate on purpose`,
        );
        stale = true;
      }
    }
    if (stale) process.exit(1);
    console.log(`spark goldens: ${SPARK_DNA_SEEDS.length} seeds each, the engine's`);
  } else {
    for (const [, path, text] of goldens) writeFileSync(path, text);
    console.log(`spark goldens: wrote ${goldens.length}, ${SPARK_DNA_SEEDS.length} seeds each`);
  }
}
