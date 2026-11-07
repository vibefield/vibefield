#!/usr/bin/env node
// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10's hatch, amended 2026-11-07 at f5a; VF-PM ruled the f5 plan 13:58:40Z, Q1 (a)
// and Q2) — the hatch's FRAMES golden: the star engine's own pixels for moments of the rows golden's falls, drawn by
// the vendored engine's WebGL2 as the sheet's sky draws them, at the engine's own @2x cap. The phone's
// `SparkHatch.metal` draws the same rows at the same times offscreen, and the kit compares the two within 12e's bound,
// which VF-PM rules for good on the first report.
//
// The rows golden (`spark-hatch-golden.mjs`) is the source. Each frame's star is that golden's deal's `star`, added as
// the hatch adds it. The renderer reads back the rows the engine wrote, and this script holds them equal to the
// golden's, row for row, so each PNG provably pictures the rows the phone's StarSpark must lay out. The Metal
// comparison is then about the shader alone.
//
// The frames (`hatchFrameCases`): for falls a and b, nine moments each on the 60 fps grid, from the deal's own times:
// - the first frame after the deal (the star still above the sky);
// - four fifths of the flight: the trail's `fallEase` eases in, so the head enters the sky only at about 0.62 of it;
// - the last frame before impact (the head), and the first after it (the flash);
// - 0.2 s on (the ring and the rays), 0.45 s (the debris), 1.2 s (the glitter), and 2.2 s (the last glitter);
// - 2 s after the star's death, the ground alone.
// A star that draws its burst alone shows nothing at its death: the body's burst ends 1.3 s after impact, and every
// particle is cut 0.3 s after the death (star-spark.js :189, :252, :383). Its last sight is the glitter, at most 3.48 s
// after impact, so no frame is drawn at the death itself.
// They are drawn with `grain: 0`, an engine option, since the grain's per-pixel noise every 1/24 s barely compresses.
// One small frame of the ground at rest has the engine's own grain (Q2). Each frame is opaque (the engine's canvas has
// no alpha).
//
// Host-bound, like 12e's stills, and out of CI: Electron with a GPU (`spark-hatch-frames-render.cjs`, a hidden window
// of its own, under a profile of the run's own). The manifest names the host, Electron, the WebGL renderer and
// whether the engine drew in half floats. Any re-bless names its host. The frames move only on purpose, after the
// rows golden:
//   node packages/design-kit/scripts/spark-hatch-golden.mjs                 writes the rows golden
//   node packages/design-kit/scripts/spark-hatch-frames-golden.mjs          draws the frames and writes the manifest
//   node packages/design-kit/scripts/spark-hatch-frames-golden.mjs --check  exits 1 when a PNG, the manifest, the
//                                                                           cases, the engine or the rows golden moved
//   node packages/design-kit/scripts/spark-hatch-frames-golden.mjs --cases  prints the cases (no GPU, no Electron)
// `pnpm check:ios-fixtures` keeps the kit's copies byte-identical.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, hostname, platform, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureElectronBinary } from "../../../scripts/electron-binary.mjs";
import { HATCH, SPARK_HATCH_FPS, SPARK_HATCH_SKY, STAR_DEFAULTS } from "./spark-hatch-golden.mjs";
import { f32 } from "./spark-rows-golden.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const KIT = join(SCRIPTS, "..");
const STAR_ENGINE = join(KIT, "src/spark-face/vendor/star-spark.js");
const HATCH_FILE = join(KIT, "src/spark-face/hatch.tsx");
const ROWS = join(KIT, "fixtures/spark-hatch.golden.json");
const FRAMES = join(KIT, "fixtures/spark-hatch-frames");
const MANIFEST = join(KIT, "fixtures/spark-hatch-frames.manifest.json");
const RENDERER = join(SCRIPTS, "spark-hatch-frames-render.cjs");

/** The engine's own pixel cap (star-spark.js :548, `dprCap: 2`), which the phone keeps (VF-PM's Q3 ruling). */
export const SPARK_HATCH_FRAMES_SCALE = STAR_DEFAULTS.dprCap;

/** The falls drawn: the rows golden's deals a (from the left) and b (from the right). */
export const SPARK_HATCH_FRAME_DEALS = Object.freeze(["a", "b"]);

/** The grain's frame: the ground at rest, small, with the engine's own grain. */
export const SPARK_HATCH_GRAIN = Object.freeze({ width: 120, height: 90, t: 6 });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileOf = (id) => `${id}.png`;
/** A time on the 60 fps grid: frame n at n / 60. */
const onGrid = (seconds) => Math.round(seconds * SPARK_HATCH_FPS) / SPARK_HATCH_FPS;

/** A fall's nine moments, from its star's own times (the head of this file). */
export function momentsOf(star) {
  const impact = star.tImpact * SPARK_HATCH_FPS;
  return [
    ["deal", star.tStart + 1 / SPARK_HATCH_FPS],
    ["falling", onGrid(star.tStart + (star.tImpact - star.tStart) * 0.8)],
    ["landing", (Math.ceil(impact) - 1) / SPARK_HATCH_FPS],
    ["flash", (Math.floor(impact) + 1) / SPARK_HATCH_FPS],
    ["burst", onGrid(star.tImpact + 0.2)],
    ["debris", onGrid(star.tImpact + 0.45)],
    ["glitter", onGrid(star.tImpact + 1.2)],
    ["late", onGrid(star.tImpact + 2.2)],
    ["ground", onGrid(star.tDeath + 2)],
  ];
}

/** The frame cases, in order, from the rows golden: each fall's moments, then the grain's frame. */
export function hatchFrameCases(rowsGolden) {
  const cases = [];
  for (const id of SPARK_HATCH_FRAME_DEALS) {
    const deal = rowsGolden.deals.find((each) => each.id === id);
    if (!deal) throw new Error(`the rows golden holds no deal ${id}: regenerate it first`);
    for (const [moment, t] of momentsOf(deal.star))
      cases.push({
        id: `${id}-${moment}`,
        deal: id,
        moment,
        t,
        grain: 0,
        ...SPARK_HATCH_SKY,
        star: deal.star,
      });
  }
  cases.push({
    id: "ground-grain",
    deal: null,
    moment: "ground",
    t: SPARK_HATCH_GRAIN.t,
    grain: STAR_DEFAULTS.grain,
    width: SPARK_HATCH_GRAIN.width,
    height: SPARK_HATCH_GRAIN.height,
    star: null,
  });
  return cases;
}

/** A case as the manifest keeps it: its words and its numbers, never its star (the rows golden's). */
function caseEntry({ id, deal, moment, t, grain, width, height }) {
  return { id, deal, moment, t, grain, width, height };
}

function readRows() {
  if (!existsSync(ROWS))
    throw new Error(`${ROWS} is missing: write the rows golden first (spark-hatch-golden.mjs)`);
  const text = readFileSync(ROWS, "utf8");
  return { text, golden: JSON.parse(text) };
}

/** Draws every frame through the engine's WebGL2 and returns the manifest and the PNGs; throws, in words. */
function drawHatchFrames() {
  const { text: rowsText, golden } = readRows();
  if (golden.engines.star.sha256 !== sha256(readFileSync(STAR_ENGINE)))
    throw new Error("the rows golden is not the vendored star engine's: regenerate it first");
  if (golden.engines.hatch.sha256 !== sha256(readFileSync(HATCH_FILE)))
    throw new Error("the rows golden is not hatch.tsx's: regenerate it first");
  const cases = hatchFrameCases(golden);
  const stray = existsSync(FRAMES)
    ? readdirSync(FRAMES).filter((name) => !cases.some(({ id }) => fileOf(id) === name))
    : [];
  if (stray.length > 0)
    throw new Error(`${FRAMES} holds ${stray.join(", ")}, which no case draws: move it out first`);
  const electron = ensureElectronBinary();
  if (electron === null)
    throw new Error("no Electron resolves from apps/desktop: install the workspace first");

  const options = { ...STAR_DEFAULTS, ...HATCH.sky };
  const work = mkdtempSync(join(tmpdir(), "spark-hatch-frames-"));
  writeFileSync(
    join(work, "job.json"),
    JSON.stringify({
      engine: STAR_ENGINE,
      scale: SPARK_HATCH_FRAMES_SCALE,
      options,
      cases: cases.map(({ id, t, grain, width, height, star }) => ({
        id,
        t,
        grain,
        width,
        height,
        star,
      })),
    }),
  );
  // Electron as itself: run as Node, it would have no window to draw in
  const env = { ...process.env, SPARK_HATCH_FRAMES_WORK: work };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electron.binary, [RENDERER], { env, stdio: "inherit" });
  if (run.status !== 0)
    throw new Error(`the renderer exited ${run.status ?? run.signal}; its work is kept at ${work}`);
  const drawn = JSON.parse(readFileSync(join(work, "drawn.json"), "utf8"));

  const wrong = [];
  if (drawn.devicePixelRatio !== SPARK_HATCH_FRAMES_SCALE)
    wrong.push(`the page drew at ${drawn.devicePixelRatio}x, not ${SPARK_HATCH_FRAMES_SCALE}x`);
  const rowsOf = new Map(golden.deals.map((deal) => [deal.id, deal.rows]));
  const pictures = cases.map((frame, index) => {
    const picture = drawn.frames[index];
    if (picture?.id !== frame.id) {
      wrong.push(`frame ${index} came back as ${picture?.id}, not ${frame.id}`);
      return null;
    }
    const width = Math.round(frame.width * SPARK_HATCH_FRAMES_SCALE);
    const height = Math.round(frame.height * SPARK_HATCH_FRAMES_SCALE);
    if (picture.width !== width || picture.height !== height)
      wrong.push(`${frame.id}: ${picture.width}×${picture.height}, not ${width}×${height}`);
    const want = frame.deal === null ? null : rowsOf.get(frame.deal);
    const got = picture.rows === null ? null : picture.rows.map(f32);
    if (JSON.stringify(got) !== JSON.stringify(want))
      wrong.push(`${frame.id}: the rows it drew are not the rows golden's`);
    const png = Buffer.from(picture.png.slice(picture.png.indexOf(",") + 1), "base64");
    return { frame, width: picture.width, height: picture.height, png };
  });
  if (drawn.frames.length !== cases.length)
    wrong.push(`${drawn.frames.length} frames came back for ${cases.length} cases`);
  if (wrong.length > 0) {
    const said = wrong.join("\n  ");
    throw new Error(`the frames are not the rows golden's (work kept at ${work}):\n  ${said}`);
  }
  rmSync(work, { recursive: true, force: true });

  const bytes = pictures.reduce((sum, { png }) => sum + png.length, 0);
  const manifest = {
    "//": "IOS-12f's f5 (PC-D8 A). The vendored star engine's own pixels for moments of the hatch's rows golden: WebGL2, the hatch's options with preserve, render(t), toDataURL (opaque RGBA PNGs), at the engine's own @2x cap; the motion frames with grain 0 and one frame with the engine's grain. Host-bound: redraw on purpose with node packages/design-kit/scripts/spark-hatch-frames-golden.mjs, after the rows golden; --check holds every byte.",
    engine: {
      file: "src/spark-face/vendor/star-spark.js",
      sha256: sha256(readFileSync(STAR_ENGINE)),
    },
    rows: { file: "fixtures/spark-hatch.golden.json", sha256: sha256(rowsText) },
    scale: SPARK_HATCH_FRAMES_SCALE,
    options,
    host: {
      name: hostname(),
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? "unknown",
      electron: drawn.electron,
      chrome: drawn.chrome,
      renderer: drawn.renderer,
      halfFloat: drawn.hdr,
    },
    bytes,
    cases: pictures.map(({ frame, width, height, png }) => ({
      ...caseEntry(frame),
      file: `fixtures/spark-hatch-frames/${fileOf(frame.id)}`,
      pixels: { width, height },
      bytes: png.length,
      sha256: sha256(png),
    })),
  };
  return { manifest, pictures };
}

/** What has moved since the frames were drawn, in words; empty when every byte is the manifest's. No GPU. */
function checkHatchFrames() {
  if (!existsSync(MANIFEST)) return [`${MANIFEST} is missing: draw the frames first`];
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const moved = [];
  if (manifest.engine?.sha256 !== sha256(readFileSync(STAR_ENGINE)))
    moved.push("the vendored star engine moved since the frames were drawn");
  if (!existsSync(ROWS) || manifest.rows?.sha256 !== sha256(readFileSync(ROWS)))
    moved.push("the rows golden moved since the frames were drawn");
  else {
    const want = JSON.stringify(hatchFrameCases(readRows().golden).map(caseEntry));
    const have = JSON.stringify((manifest.cases ?? []).map(caseEntry));
    if (want !== have) moved.push("the frame cases are not hatchFrameCases()'s");
  }
  for (const entry of manifest.cases ?? []) {
    const path = join(KIT, entry.file);
    if (!existsSync(path)) moved.push(`${entry.file} is missing`);
    else if (sha256(readFileSync(path)) !== entry.sha256)
      moved.push(`${entry.file} is not the drawn bytes`);
  }
  const named = new Set((manifest.cases ?? []).map(({ id }) => fileOf(id)));
  for (const name of existsSync(FRAMES) ? readdirSync(FRAMES) : [])
    if (!named.has(name)) moved.push(`fixtures/spark-hatch-frames/${name} is in no case`);
  return moved;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes("--cases")) {
    for (const frame of hatchFrameCases(readRows().golden)) {
      const px = `${frame.width * SPARK_HATCH_FRAMES_SCALE}×${frame.height * SPARK_HATCH_FRAMES_SCALE}`;
      console.log(`${frame.id}\tt=${frame.t}\tgrain=${frame.grain}\t${px}`);
    }
  } else if (process.argv.includes("--check")) {
    const moved = checkHatchFrames();
    if (moved.length > 0) {
      console.error(`spark hatch frames golden: redraw on purpose —\n  ${moved.join("\n  ")}`);
      process.exit(1);
    }
    const count = hatchFrameCases(readRows().golden).length;
    console.log(`spark hatch frames golden: ${count} frames, the manifest's bytes`);
  } else {
    const { manifest, pictures } = drawHatchFrames();
    mkdirSync(FRAMES, { recursive: true });
    for (const { frame, png } of pictures) writeFileSync(join(FRAMES, fileOf(frame.id)), png);
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    const { renderer, halfFloat } = manifest.host;
    const drew = `${pictures.length} frames at @${SPARK_HATCH_FRAMES_SCALE}x, ${manifest.bytes} bytes`;
    console.log(
      `spark hatch frames golden: drew ${drew} on ${renderer} (half floats: ${halfFloat})`,
    );
  }
}
