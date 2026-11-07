#!/usr/bin/env node
// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10's hatch, amended 2026-11-07 at f5a; VF-PM ruled the f5 plan 13:58:40Z, Q1 (a))
// — the hatch's ROWS golden: what New spark's sky lays out for the GPU, which the phone's transcription is held to as
// 12e's SparkBuddy is held to `spark-rows.golden.json`. Its twin, `spark-hatch-frames-golden.mjs`, holds the Metal
// shader to the engine's own pixels for moments of these deals.
//
// The sky is the vendored star engine (`src/spark-face/vendor/star-spark.js`), which draws every moment as a pure
// function of a star's row and the time. A star's rows are written once, at `add` (:612), by `_write` (:593): 32 vec4s,
// 128 float32s, made from `makeDNA(seed)` and the deal. They are taken here from the engine's own `add` and `_write`,
// on a stub with the engine's prototype, its rows and its slots, and no WebGL2: the constructor opens a WebGL2 context,
// and `add` reads nothing of it.
//
// The deal is the hatch's (`src/spark-face/hatch.tsx` :199–238), restated, because the hatch is a React component Node
// cannot load. Where the star falls from, how long it falls and when it dies are all its arithmetic. The golden pins
// hatch.tsx's sha256 beside the engine's, so a change to either file fails `--check` until it is read again. A deal's
// three `Math.random` calls (:219 twice, then the star's seed, :229) are this golden's `draws`, named for each case.
//
// The face born where the star lands is the face engine's (`sparks.js`), through 12e's helpers. The hatch's face takes
// the adapter's options (`sparkBuddyOptions`, at rest "ready", free, on the night), watches a pointer (`watch: true`:
// no pointer exists in this realm, and none on the phone), and is born at impact with hello for 2.4 s (`birth`, :975),
// then its rest. A reroll's face before leaves (`leave`, :981). Each face draws from its own mulberry32, seeded with
// its face's seed, as the phone's faces do (12e's Mulberry32 per face). The Mac's window shares one `Math.random`;
// its draws are arbitrary there, and what the transcription must hold is the engine's use of them.
//
// The clock is the hatch's (hatch.tsx :284–289), idealized at 60 frames a second:
// - a deal at t happens between frames, after the frame at t; frame n is at n / 60;
// - the face engine's first frame takes dt 0 (`Engine.render`, sparks.js :1170: its lastT is null), and every later
//   frame clamp(Δt, 0, 0.05) = 1/60;
// - a face that has died leaves the engine after that frame (:1175), and is drawn no more.
// Under reduced motion the hatch deals no star and the face is born at once (:214–216), with every motion still
// (`engine.ts`'s holdReducedMotion, which reaches the hatch's faces too: they share the engine's MOTION).
//
// A change to either engine or to the hatch changes what the sky draws, so this file moves only on purpose:
//   node packages/design-kit/scripts/spark-hatch-golden.mjs           writes the golden
//   node packages/design-kit/scripts/spark-hatch-golden.mjs --check   exits 1 when the golden is not the engines'
// `pnpm check:ios-fixtures` keeps the kit's copy byte-identical.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { f32, loadEngine, mulberry32, renderSparkRows } from "./spark-rows-golden.mjs";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAR_ENGINE = join(KIT, "src/spark-face/vendor/star-spark.js");
const FACE_ENGINE = join(KIT, "src/spark-face/vendor/sparks.js");
const HATCH_FILE = join(KIT, "src/spark-face/hatch.tsx");
const GOLDEN = join(KIT, "fixtures/spark-hatch.golden.json");

/** The phone's sky (DESIGN.md §8 "The phone's Chat"): 300 tall, inset 10 from the sheet's edges, on the iPhone 17's
 * 402-point width. */
export const SPARK_HATCH_SKY = Object.freeze({ width: 382, height: 300 });
/** The born face on the phone: 120, free (§2.10's phone table, "New spark's sky"). The Mac's sheet draws it at 104. */
export const SPARK_HATCH_SIZE = 120;
export const SPARK_HATCH_FPS = 60;

/** The hatch, restated (hatch.tsx, whose sha256 the golden pins). */
export const HATCH = Object.freeze({
  /** where the star lands, as a share of the sky's height (:48) */
  landAt: 0.5,
  /** the sky's engine (:191) and the faces' (:192) */
  sky: Object.freeze({ bloom: true, bloomStr: 0.45, max: 8, night: true }),
  faces: Object.freeze({ max: 6 }),
  /** what the face plays once it is born (:215, :224) */
  hello: Object.freeze([Object.freeze(["hello", 2.4])]),
  /** the star dies this long after it lands (:236) */
  deathAfter: 3.4,
});

/** The star engine's own defaults (star-spark.js :548), which the hatch's options sit over. */
export const STAR_DEFAULTS = Object.freeze({
  bloom: true,
  night: true,
  max: 64,
  dprCap: 2,
  bloomStr: 0.5,
  grain: 0.035,
});

/** The deals: a face's seed (the DNA golden's) and the deal's three draws. a falls from the left, b from the right, and
 * c on the side draw's edge (0.5 is not under 0.5, so it falls from the right) at the angle's far end. */
export const SPARK_HATCH_DEALS = Object.freeze([
  Object.freeze({ id: "a", seed: 4211, draws: Object.freeze([0.25, 0.5, 0.1234]) }),
  Object.freeze({ id: "b", seed: 7, draws: Object.freeze([0.75, 0, 0.9]) }),
  Object.freeze({ id: "c", seed: 1, draws: Object.freeze([0.5, 0.999, 0.5]) }),
]);

/** Each deal's face, sampled after these frames (seconds from the deal at 0): before its birth, just born, through
 * hello, and back at rest. */
export const SPARK_HATCH_TIMES = Object.freeze([0.5, 0.75, 1.2, 2, 3.2, 4]);

/** A reroll: deal a at open, then deal b at 2 s. a's face leaves as b's star begins to fall. */
export const SPARK_HATCH_REROLL = Object.freeze({
  open: "a",
  next: "b",
  at: 2,
  times: Object.freeze([2.2, 2.5, 3, 4]),
});

/** Reduced motion: deal a's face, born at once, with every motion still. */
export const SPARK_HATCH_REDUCED = Object.freeze({
  deal: "a",
  times: Object.freeze([1 / 60, 0.25, 1, 2.6]),
});

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** The star engine in a realm of its own, as the window loads it: one IIFE that sets `window.SparkEngine`. */
export function loadStarEngine() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(STAR_ENGINE, "utf8"), context, { filename: STAR_ENGINE });
  const engine = context.window.SparkEngine;
  if (!engine) throw new Error(`${STAR_ENGINE} ran but set no window.SparkEngine`);
  return engine;
}

/** The engine's own `add` and `_write` on a stub: its prototype, its rows and its slots, and no WebGL2. */
export function starStub(SparkEngine, max = HATCH.sky.max) {
  const stub = Object.create(SparkEngine.prototype);
  stub.o = { ...STAR_DEFAULTS, ...HATCH.sky };
  stub.data = new Float32Array(32 * 4 * max);
  stub.slots = new Array(max).fill(null);
  stub.dirty = false;
  stub.time = 0;
  return stub;
}

/** A star's rows as the GPU reads them: its slot's 128 float32s, each written to nine digits. */
export function starRows(stub, star) {
  const at = star.slot * 128;
  return Array.from(stub.data.subarray(at, at + 128), f32);
}

/** `#rrggbb` as the engine's `hex` reads it (star-spark.js :9), then a float32. */
const rgb = (hex) => [1, 3, 5].map((i) => f32(Number.parseInt(hex.slice(i, i + 2), 16) / 255));

/**
 * The hatch's deal (hatch.tsx :199–238), restated: the face placed on the sky's centre and, unless motion is reduced,
 * born where the star lands. Returns the face, the star's options as `add` takes them (null under reduced motion), and
 * the deal's geometry. The face is made with its own random handed to the realm (`handRandom`), as are its later calls.
 */
export function dealHatch(world, { seed, draws }, at, reduced = false) {
  const { face, adapter, starPaletteOf, LAYERS } = world;
  const centre = { x: SPARK_HATCH_SKY.width / 2, y: SPARK_HATCH_SKY.height * HATCH.landAt };
  const options = adapter.sparkBuddyOptions(
    face.engine,
    { seed, status: "ready", framed: false },
    [0, 0, 0],
  );
  const random = mulberry32(seed);
  face.handRandom(random);
  const buddy = new face.engine.Buddy({ ...options, watch: true });
  adapter.placeSparkBuddy(buddy, centre.x, centre.y, SPARK_HATCH_SIZE, false);
  if (reduced) {
    buddy.birth(
      at,
      HATCH.hello.map((step) => [...step]),
    );
    return { buddy, random, star: null, geometry: { centre, R: buddy.R } };
  }
  const [side, spread, starSeed] = draws;
  const angle = (side < 0.5 ? -1 : 1) * (0.3 + spread * 0.2);
  const direction = { x: Math.sin(angle), y: Math.cos(angle) };
  const distance = (centre.y + buddy.R * 3 + 30) / direction.y;
  const from = { x: centre.x - direction.x * distance, y: centre.y - direction.y * distance };
  const flight = clamp(0.42 + distance / 1500, 0.55, 1.05);
  buddy.birth(
    at + flight,
    HATCH.hello.map((step) => [...step]),
  );
  const star = {
    x: centre.x,
    y: centre.y,
    R: buddy.R * 0.9,
    seed: 1 + Math.floor(starSeed * 999_998),
    palette: starPaletteOf(face.engine.agentDNA(seed).palette),
    mask: LAYERS.BURST ?? 0,
    burstMode: 2,
    from,
    tStart: at,
    tImpact: at + flight,
    tDeath: at + flight + HATCH.deathAfter,
  };
  return {
    buddy,
    random,
    star,
    geometry: { centre, R: buddy.R, angle, direction, distance, from, flight },
  };
}

/** The hatch's clock over its faces (this file's head): `add` between frames, `run` to a frame, `rows` after it. */
export function hatchClock(face) {
  let frame = 0;
  let lastT = null;
  let faces = [];
  return {
    get t() {
      return frame / SPARK_HATCH_FPS;
    },
    add(dealt) {
      faces.push(dealt);
    },
    run(until) {
      const target = Math.round(until * SPARK_HATCH_FPS);
      while (frame < target) {
        frame += 1;
        const t = frame / SPARK_HATCH_FPS;
        const dt = lastT === null ? 0 : clamp(t - lastT, 0, 0.05);
        lastT = t;
        for (const { buddy, random } of faces) {
          face.handRandom(random);
          buddy.update(t, dt);
        }
        faces = faces.filter(({ buddy }) => !buddy.dead);
      }
    },
    /** A face's rows after the frame, as `write` lays them; null once it has left the engine. */
    rows(dealt) {
      if (!faces.includes(dealt)) return null;
      const rows = new Float32Array(128);
      dealt.buddy.write(rows, 0);
      return Array.from(rows, f32);
    },
  };
}

/** A face's samples at `times`, each after its frame: its rows, or `gone` once it has left. */
function sample(clock, dealt, times) {
  return times.map((t) => {
    clock.run(t);
    const rows = clock.rows(dealt);
    return rows === null ? { t, gone: true } : { t, rows };
  });
}

/** The deal's geometry and its star, as plain numbers (the star's DNA is in its rows). */
function said({ geometry, star }) {
  return { ...geometry, star };
}

/** The golden: the palettes, the deals with their stars' rows and their faces, a reroll, and reduced motion. */
export function dealSparkHatch(world) {
  const { SparkEngine } = world;
  const dealOf = (id) => SPARK_HATCH_DEALS.find((deal) => deal.id === id);

  const deals = SPARK_HATCH_DEALS.map((deal) => {
    const clock = hatchClock(world.face);
    const stub = starStub(SparkEngine);
    const dealt = dealHatch(world, deal, 0);
    clock.add(dealt);
    const added = stub.add(dealt.star);
    return {
      ...deal,
      ...said(dealt),
      rows: starRows(stub, added),
      face: sample(clock, dealt, SPARK_HATCH_TIMES),
    };
  });

  const reroll = (() => {
    const { open, next, at, times } = SPARK_HATCH_REROLL;
    const clock = hatchClock(world.face);
    const stub = starStub(SparkEngine);
    const one = dealHatch(world, dealOf(open), 0);
    clock.add(one);
    const oneStar = stub.add(one.star);
    clock.run(at);
    // the reroll: the face before leaves (hatch.tsx :203), and the next is dealt, between frames
    world.face.handRandom(one.random);
    one.buddy.leave(clock.t);
    const two = dealHatch(world, dealOf(next), clock.t);
    clock.add(two);
    const twoStar = stub.add(two.star);
    const samples = times.map((t) => {
      clock.run(t);
      const rowsOf = (dealt) => clock.rows(dealt);
      const leaving = rowsOf(one);
      const born = rowsOf(two);
      return {
        t,
        leaving: leaving === null ? { gone: true } : { rows: leaving },
        born: born === null ? { gone: true } : { rows: born },
      };
    });
    return {
      open,
      next,
      at,
      // the two stars share the sky's slots: a's in 0, b's in 1
      stars: [
        { deal: open, slot: oneStar.slot, ...said(one), rows: starRows(stub, oneStar) },
        { deal: next, slot: twoStar.slot, ...said(two), rows: starRows(stub, twoStar) },
      ],
      samples,
    };
  })();

  const reduced = (() => {
    const { deal, times } = SPARK_HATCH_REDUCED;
    const motions = { ...world.face.engine.MOTION };
    for (const name of Object.keys(motions)) world.face.engine.MOTION[name] = () => ({});
    try {
      const clock = hatchClock(world.face);
      const dealt = dealHatch(world, dealOf(deal), 0, true);
      clock.add(dealt);
      return { deal, star: null, face: sample(clock, dealt, times) };
    } finally {
      Object.assign(world.face.engine.MOTION, motions);
    }
  })();

  const layers = { ...SparkEngine.LAYERS };
  return {
    "//": "IOS-12f's f5 (PC-D8 A). New spark's sky as the vendored star engine lays it out: each deal's star (its 128 float32 rows, by the engine's own add and _write) and the face born where it lands (the face engine's rows), with a reroll and reduced motion. Regenerate on purpose: node packages/design-kit/scripts/spark-hatch-golden.mjs (then the kit's copy: pnpm check:ios-fixtures names it).",
    engines: {
      star: { file: "src/spark-face/vendor/star-spark.js", sha256: sha256(STAR_ENGINE) },
      face: { file: "src/spark-face/vendor/sparks.js", sha256: sha256(FACE_ENGINE) },
      hatch: { file: "src/spark-face/hatch.tsx", sha256: sha256(HATCH_FILE) },
    },
    random: [
      "each face draws from mulberry32(its face's seed), dealt as it is made",
      "a deal's three draws are its `draws`",
    ],
    clock: [
      "a deal at t happens after the frame at t; frame n is at n / 60",
      "the face engine's first frame takes dt 0, every later one clamp(dt, 0, 0.05)",
      "a dead face leaves the engine after its frame",
    ],
    fps: SPARK_HATCH_FPS,
    sky: { ...SPARK_HATCH_SKY, landAt: HATCH.landAt, size: SPARK_HATCH_SIZE },
    options: { ...STAR_DEFAULTS, ...HATCH.sky },
    faces: { ...HATCH.faces },
    hello: HATCH.hello.map((step) => [...step]),
    deathAfter: HATCH.deathAfter,
    layers,
    // the hatch draws its burst alone, on the night: the rest of the body's layers are never drawn
    mask: layers.BURST,
    night: HATCH.sky.night,
    burstMode: 2,
    palettes: SparkEngine.PALETTES.map(({ name, dark, c }) => ({ name, dark, c: c.map(rgb) })),
    confetti: SparkEngine.CONFETTI.map(rgb),
    deals,
    reroll,
    reduced,
  };
}

/** The engines and the adapter, as the hatch holds them. */
export async function loadHatchWorld() {
  // engine.ts and star.ts import nothing at run time, so Node loads them with their types stripped
  const adapter = await import("../src/spark-face/engine.ts");
  const { starPaletteOf } = await import("../src/spark-face/star.ts");
  const SparkEngine = loadStarEngine();
  return { SparkEngine, LAYERS: SparkEngine.LAYERS, face: loadEngine(), adapter, starPaletteOf };
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const text = renderSparkRows(dealSparkHatch(await loadHatchWorld()));
  if (process.argv.includes("--check")) {
    if (readFileSync(GOLDEN, "utf8") !== text) {
      console.error(
        `spark hatch golden: ${GOLDEN} is not what the engines lay out; regenerate on purpose`,
      );
      process.exit(1);
    }
    console.log(
      `spark hatch golden: ${SPARK_HATCH_DEALS.length} deals, a reroll and reduced motion, the engines'`,
    );
  } else {
    writeFileSync(GOLDEN, text);
    console.log(
      `spark hatch golden: wrote ${SPARK_HATCH_DEALS.length} deals, a reroll and reduced motion`,
    );
  }
}
