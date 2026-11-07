#!/usr/bin/env node
// IOS-12e (PC-D6 A, "the star in Metal"; DESIGN.md §2.10; VF-PM ruled the plan 2026-11-06 05:50Z, Q1 (a)) — the spark
// face's ROWS golden: what the vendored engine's `Buddy` lays out for the GPU. Each frame, `write(f, o)` puts one face
// into 32 vec4 rows, 128 float32s (`src/spark-face/vendor/sparks.js` :1091), and the fragment shader reads nothing
// else about it. The phone transcribes `Buddy` into Swift (`SparkBuddy`), and this golden holds that transcription
// float for float. Its twin, `spark-stills-golden.mjs`, holds the Metal shader to the engine's own pixels for the
// still cases below.
//
// Host-free: the engine runs in `node:vm` with a stub window, as `spark-dna-golden.mjs` loads it, and no WebGL is
// needed. `write()` does not touch the GL; it fills a Float32Array, so the values here are float32s, as the GPU reads
// them. A face is built as the product builds it: the adapter's own `sparkBuddyOptions` and `placeSparkBuddy`
// (`src/spark-face/engine.ts`, which imports nothing, so Node loads it with its types stripped).
//
// The engine draws its phases, blinks and saccades from `Math.random` (:11, :920, :931–932, :1063). So for each case,
// the vm realm's `Math.random` is mulberry32 seeded with the face's seed. That is the engine's own generator
// (sparks.js :7) and the kit's `Mulberry32`. The vendored file is never edited (its SHA test stands), and the Swift
// side replays the same sequence call for call.
//
// The live path steps as `Engine.render` does (:1170): t = n / 60, dt = clamp(t − the previous t, 0, 0.05) (0 at the
// first frame), then `update(t, dt)` and `write`. A still is `render(0, { frozen: true })`: no update, `write` right
// after the face is placed (`stills.ts`).
//
// Beside the rows, each status's recipe as the engine resolves it for a mouthless face (`recipe(e, false)`: the
// status's `r`, then its `b`, then no mouth), so a slip in the phone's recipes is named field by field.
//
// A change to the engine changes every spark's face, so this file moves only on purpose:
//   node packages/design-kit/scripts/spark-rows-golden.mjs           writes the golden
//   node packages/design-kit/scripts/spark-rows-golden.mjs --check   exits 1 when the golden is not the engine's
// `pnpm check:ios-fixtures` keeps the kit's copy byte-identical.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(KIT, "src/spark-face/vendor/sparks.js");
const STILLS = join(KIT, "src/spark-face/stills.ts");
const GOLDEN = join(KIT, "fixtures/spark-rows.golden.json");

/** Three seeds of the DNA golden: 5, 6 and 7 points, palettes 7, 9 and 1 (`spark-dna.golden.json`). */
export const SPARK_ROWS_SEEDS = [7, 4211, 1];

/** The live samples, in seconds from the face's first frame, stepped at the stage's 60 frames a second. */
export const SPARK_ROWS_TIMES = [0.5, 1.7, 4];
export const SPARK_ROWS_FPS = 60;

/** The phone's paper behind a framed face, for its cut ring: FieldDesign's `ChromePalette.paper`, light and dark. */
export const SPARK_ROWS_PAPER = Object.freeze({
  light: [1, 1, 1],
  dark: [28 / 255, 28 / 255, 30 / 255],
});

/** A free face draws no cut ring (sparks.js :834 rings a framed face alone). Its ground is said, and is not drawn. */
const NIGHT = [0, 0, 0];

/** Chat's list row (§2.10, the phone): 48, framed, on the paper, live while it works. */
export const SPARK_ROWS_LIVE = Object.freeze({ size: 48, framed: true, theme: "light" });

/** The statuses whose motion reduced motion sets aside, held at 1.7 s with every motion still (`engine.ts`'s
 * `holdReducedMotion`): a hop, an anticipation, a ponder and a doze. */
export const SPARK_ROWS_REDUCED = ["success", "running", "thinking", "sleeping"];

/** A live status change: `buddy.rest = status; buddy.feel(status)`, as the stage does (`stage.tsx` :122). */
export const SPARK_ROWS_CHANGE = Object.freeze({
  seed: 4211,
  from: "asking",
  to: "success",
  at: 1,
  times: [1.2, 1.7, 4],
});

/** The six statuses the smaller stills draw, light and dark. */
const SMALL_STATUSES = ["ready", "thinking", "asking", "success", "sleeping", "offline"];
/** The born face's statuses at New spark's 120. */
const BORN_STATUSES = ["hello", "ready", "success"];

/** A still's id: its size, its form, its theme, its status and its seed. */
export function stillId({ size, framed, theme, status, seed }) {
  return `${size}-${framed ? "framed" : "free"}-${theme}-${status}-${seed}`;
}

/** The still cases, which `spark-stills-golden.mjs` renders through the engine's own WebGL2, in this order (§2.10's
 * phone table):
 * - every status at 48, framed on the light paper (Chat's row), on seed 4211;
 * - six statuses at 30 (a thread's head), 28 (a message's lead) and 22 (the note, a Needs-you card), framed, light and
 *   dark, the seeds in turn;
 * - three at 120, free (New spark's born face). */
export function stillCases(statuses) {
  const cases = [];
  for (const status of statuses)
    cases.push({ size: 48, framed: true, theme: "light", status, seed: 4211 });
  SMALL_STATUSES.forEach((status, index) => {
    const seed = SPARK_ROWS_SEEDS[index % SPARK_ROWS_SEEDS.length];
    for (const size of [30, 28, 22])
      for (const theme of ["light", "dark"])
        cases.push({ size, framed: true, theme, status, seed });
  });
  BORN_STATUSES.forEach((status, index) => {
    cases.push({ size: 120, framed: false, theme: "night", status, seed: SPARK_ROWS_SEEDS[index] });
  });
  return cases.map((face) => ({ id: stillId(face), ...face, cut: groundOf(face) }));
}

function groundOf({ framed, theme }) {
  if (!framed) return NIGHT;
  return theme === "dark" ? SPARK_ROWS_PAPER.dark : SPARK_ROWS_PAPER.light;
}

/** mulberry32, as the engine (sparks.js :7) and the kit's `Mulberry32` deal it: a float in [0, 1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The engine in a realm of its own, as the window loads it: one IIFE that sets `window.Sparklings`. Its realm's
 * `Math.random` is the case's dealer: `deal` deals a fresh one, and `handRandom` hands it one that is already dealing
 * (IOS-12f: the hatch's two faces, each with its own, as the phone's are). */
export function loadEngine() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(ENGINE, "utf8"), context, { filename: ENGINE });
  const realmMath = vm.runInContext("Math", context);
  return {
    engine: context.window.Sparklings,
    deal(seed) {
      realmMath.random = mulberry32(seed);
    },
    handRandom(random) {
      realmMath.random = random;
    },
  };
}

/** A free face's picture is half again its box (`stills.ts`'s FREE_FACE_ROOM), read from the source so the two never
 * drift: `stills.ts` imports `./engine` by value, which Node cannot resolve without its extension. */
export function freeFaceRoom() {
  const found = /export const FREE_FACE_ROOM = ([\d.]+);/.exec(readFileSync(STILLS, "utf8"));
  if (!found)
    throw new Error(`${STILLS}: FREE_FACE_ROOM not found; the golden reads it from there`);
  return Number(found[1]);
}

/** A face's setup as plain data: the adapter's options (`sparkBuddyOptions`) and its placement on its box
 * (`placeSparkBuddy`'s R, x, y and faceScale). spark-stills-golden.mjs hands the same data to its renderer. */
export function stillSetup(
  engine,
  adapter,
  { seed, status, size, framed, cut },
  room = freeFaceRoom(),
) {
  const options = JSON.parse(
    JSON.stringify(adapter.sparkBuddyOptions(engine, { seed, status, framed }, cut)),
  );
  const box = framed ? size : size * room;
  const place = {};
  adapter.placeSparkBuddy(place, box / 2, box / 2, size, framed);
  return { options, place, box };
}

/** A float32, written to nine significant digits, which always read back to the same float32. The stills'
 * renderer reads its rows back through it too, so the two goldens compare as text. */
export const f32 = (value) => Number(Math.fround(value).toPrecision(9));

/** The deal: the live cases, the reduced ones, the status change, and the stills, each as `write()` lays them. */
export function dealSparkRows(sparklings, adapter, statuses) {
  const { engine, deal } = sparklings;
  const room = freeFaceRoom();
  const rows = new Float32Array(128);
  const written = (buddy) => {
    rows.fill(0);
    buddy.write(rows, 0);
    return Array.from(rows, f32);
  };
  // a face as the product builds one: the adapter's options, placed at the centre of its box. The options come
  // first and the dealer after, so the Buddy alone draws from `Math.random`, as spark-stills-golden's renderer does.
  const face = (still) => {
    const { options, place } = stillSetup(engine, adapter, still, room);
    deal(still.seed);
    return Object.assign(new engine.Buddy(options), place);
  };
  // the stage's clock: t = n / 60, dt as Engine.render takes it
  const clock = (buddy) => {
    let frame = 0;
    let last = null;
    const step = (t) => {
      const dt = last === null ? 0 : Math.min(Math.max(t - last, 0), 0.05);
      last = t;
      buddy.update(t, dt);
    };
    step(0);
    return (until) => {
      const target = Math.round(until * SPARK_ROWS_FPS);
      while (frame < target) {
        frame += 1;
        step(frame / SPARK_ROWS_FPS);
      }
    };
  };
  const cut = SPARK_ROWS_PAPER.light;
  const { size, framed, theme } = SPARK_ROWS_LIVE;

  const live = [];
  for (const seed of SPARK_ROWS_SEEDS)
    for (const status of statuses) {
      const buddy = face({ seed, status, size, framed, cut });
      const advance = clock(buddy);
      const samples = SPARK_ROWS_TIMES.map((t) => {
        advance(t);
        return { t, rows: written(buddy) };
      });
      live.push({ seed, status, size, framed, theme, cut, samples });
    }

  // reduced motion: every motion still while the case runs (engine.ts's holdReducedMotion), then the engine's again
  const reduced = [];
  const motions = { ...engine.MOTION };
  for (const name of Object.keys(motions)) engine.MOTION[name] = () => ({});
  try {
    for (const seed of SPARK_ROWS_SEEDS)
      for (const status of SPARK_ROWS_REDUCED) {
        const buddy = face({ seed, status, size, framed, cut });
        clock(buddy)(1.7);
        reduced.push({ seed, status, size, framed, theme, cut, t: 1.7, rows: written(buddy) });
      }
  } finally {
    Object.assign(engine.MOTION, motions);
  }

  // a live status change, as the stage makes it
  const change = (() => {
    const { seed, from, to, at, times } = SPARK_ROWS_CHANGE;
    const buddy = face({ seed, status: from, size, framed, cut });
    const advance = clock(buddy);
    advance(at);
    buddy.rest = to;
    buddy.feel(to);
    const samples = times.map((t) => {
      advance(t);
      return { t, rows: written(buddy) };
    });
    return { seed, from, to, at, size, framed, theme, cut, samples };
  })();

  // the stills: placed and written, never updated (render(0, { frozen: true }))
  const stills = stillCases(statuses).map((still) => ({ ...still, rows: written(face(still)) }));

  // each status's recipe as a face holds it (`rec`): the engine's own `recipe(e, mouthSet)`, mouthless, which the
  // phone's SparkRecipes must equal field by field. The engine keeps `recipe` to itself, so a face is asked.
  const recipes = Object.fromEntries(
    statuses.map((status) => [status, face({ seed: 4211, status, size, framed, cut }).rec]),
  );

  return {
    "//": "IOS-12e (PC-D6 A). The vendored spark engine's rows: what Buddy.write lays out for the GPU (32 vec4s, 128 float32s a face), live, under reduced motion, across a status change, and as stills. Regenerate on purpose: node packages/design-kit/scripts/spark-rows-golden.mjs (then the kit's copy: pnpm check:ios-fixtures names it).",
    engine: {
      file: "src/spark-face/vendor/sparks.js",
      sha256: createHash("sha256").update(readFileSync(ENGINE)).digest("hex"),
    },
    random: "Math.random is mulberry32(the face's seed), dealt anew for each case",
    clock:
      "t = n / 60; dt = clamp(t - the previous t, 0, 0.05), 0 at the first frame; update(t, dt), then write",
    fps: SPARK_ROWS_FPS,
    seeds: SPARK_ROWS_SEEDS,
    times: SPARK_ROWS_TIMES,
    statuses,
    recipes,
    live,
    reduced,
    change,
    stills,
  };
}

/** The golden as text: two-space JSON with every row of numbers on one line, so a diff names the face that moved. */
export function renderSparkRows(golden) {
  const text = JSON.stringify(JSON.parse(JSON.stringify(golden)), null, 2);
  const numbers = /\[\n(\s+-?[\d.e+-]+(?:,\n\s+-?[\d.e+-]+)*)\n\s+\]/g;
  return `${text.replace(
    numbers,
    (_, body) =>
      `[${body
        .trim()
        .split(/,\n\s+/)
        .join(", ")}]`,
  )}\n`;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // engine.ts and statuses.ts import nothing at run time, so Node loads them with their types stripped
  const adapter = await import("../src/spark-face/engine.ts");
  const { SPARK_STATUSES } = await import("../src/spark-face/statuses.ts");
  const statuses = SPARK_STATUSES.map(({ id }) => id);
  const text = renderSparkRows(dealSparkRows(loadEngine(), adapter, statuses));
  if (process.argv.includes("--check")) {
    if (readFileSync(GOLDEN, "utf8") !== text) {
      const said = `${GOLDEN} is not what the vendored engine lays out; regenerate on purpose`;
      console.error(`spark rows golden: ${said}`);
      process.exit(1);
    }
    console.log(`spark rows golden: ${statuses.length} statuses, the engine's`);
  } else {
    writeFileSync(GOLDEN, text);
    const wrote = `${statuses.length} statuses × ${SPARK_ROWS_SEEDS.length} seeds`;
    console.log(`spark rows golden: wrote ${wrote}`);
  }
}
