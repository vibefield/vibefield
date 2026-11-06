#!/usr/bin/env node
// IOS-12e (PC-D6 A, "the star in Metal"; DESIGN.md §2.10; VF-PM ruled the plan 2026-11-06 05:50Z, Q1 (a)) — the spark
// face's STILLS golden: the engine's own pixels for every still case of the rows golden (`stillCases`), drawn by the
// vendored engine's WebGL2 as `stills.ts` draws one, at the phone's @3x. The phone's `SparkStar.metal` draws the same
// rows offscreen, and the kit compares the two within the bound VF-PM rules on the first diff report (Q2).
//
// The rows golden (`spark-rows-golden.mjs`) is the source: each still here is built from the same data (the
// adapter's options and placement, `stillSetup`) and dealt the same seeded random. The renderer reads back the rows
// it drew, and this script holds them equal to that golden's still rows, row for row. So each PNG provably pictures
// the rows the kit's `SparkBuddy` must lay out, and the Metal comparison is about the shader alone.
//
// Host-bound, like `pnpm still`, and out of CI: Electron with a GPU (`spark-stills-render.cjs`, a hidden window of
// its own, under a profile of the run's own). The manifest names the host, Electron and the WebGL renderer; any
// re-bless names its host. A change to the engine changes every still, so these move only on purpose, after the rows
// golden:
//   node packages/design-kit/scripts/spark-rows-golden.mjs              writes the rows golden
//   node packages/design-kit/scripts/spark-stills-golden.mjs            draws the stills and writes their manifest
//   node packages/design-kit/scripts/spark-stills-golden.mjs --check    exits 1 when a PNG, the manifest, the cases,
//                                                                       the engine or the rows golden moved (no GPU)
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
import {
  f32,
  freeFaceRoom,
  loadEngine,
  mulberry32,
  stillCases,
  stillSetup,
} from "./spark-rows-golden.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const KIT = join(SCRIPTS, "..");
const ENGINE = join(KIT, "src/spark-face/vendor/sparks.js");
const ROWS = join(KIT, "fixtures/spark-rows.golden.json");
const STILLS = join(KIT, "fixtures/spark-stills");
const MANIFEST = join(KIT, "fixtures/spark-stills.manifest.json");
const RENDERER = join(SCRIPTS, "spark-stills-render.cjs");

/** The phone's pixels per point: every iPhone the app runs on is @3x. */
export const SPARK_STILLS_SCALE = 3;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileOf = (id) => `${id}.png`;

/** The cases' order and words, as the manifest keeps them (the rows and pixels are the goldens'). */
function caseEntry({ id, seed, status, size, framed, theme, cut }) {
  return { id, seed, status, size, framed, theme, cut };
}

/** Draws every still through the engine's WebGL2 and returns the manifest and the PNGs; throws, in words. */
function drawSparkStills(adapter, statuses) {
  if (!existsSync(ROWS))
    throw new Error(`${ROWS} is missing: write the rows golden first (spark-rows-golden.mjs)`);
  const rowsText = readFileSync(ROWS, "utf8");
  const rowsGolden = JSON.parse(rowsText);
  const engineSha = sha256(readFileSync(ENGINE));
  if (rowsGolden.engine.sha256 !== engineSha)
    throw new Error("the rows golden is not the vendored engine's: regenerate it first");

  const cases = stillCases(statuses);
  const kept = new Map(rowsGolden.stills.map((still) => [still.id, still.rows]));
  const unkept = cases.filter(({ id }) => !kept.has(id)).map(({ id }) => id);
  if (unkept.length > 0)
    throw new Error(`the rows golden holds no rows for ${unkept.join(", ")}: regenerate it first`);
  const stray = existsSync(STILLS)
    ? readdirSync(STILLS).filter((name) => !cases.some(({ id }) => fileOf(id) === name))
    : [];
  if (stray.length > 0)
    throw new Error(`${STILLS} holds ${stray.join(", ")}, which no case draws: move it out first`);

  const { engine } = loadEngine();
  const room = freeFaceRoom();
  const set = cases.map((still) => ({ still, ...stillSetup(engine, adapter, still, room) }));
  const electron = ensureElectronBinary();
  if (electron === null)
    throw new Error("no Electron resolves from apps/desktop: install the workspace first");

  const work = mkdtempSync(join(tmpdir(), "spark-stills-"));
  writeFileSync(
    join(work, "job.json"),
    JSON.stringify({
      engine: ENGINE,
      mulberry32: mulberry32.toString(),
      scale: SPARK_STILLS_SCALE,
      cases: set.map(({ still, options, place, box }) => ({
        id: still.id,
        seed: still.seed,
        options,
        place,
        box,
      })),
    }),
  );
  // Electron as itself: run as Node, it would have no window to draw in
  const env = { ...process.env, SPARK_STILLS_WORK: work };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electron.binary, [RENDERER], { env, stdio: "inherit" });
  if (run.status !== 0)
    throw new Error(`the renderer exited ${run.status ?? run.signal}; its work is kept at ${work}`);
  const drawn = JSON.parse(readFileSync(join(work, "drawn.json"), "utf8"));

  const wrong = [];
  if (drawn.devicePixelRatio !== SPARK_STILLS_SCALE)
    wrong.push(`the page drew at ${drawn.devicePixelRatio}x, not ${SPARK_STILLS_SCALE}x`);
  const pictures = set.map(({ still, box }, index) => {
    const picture = drawn.stills[index];
    if (picture?.id !== still.id) {
      wrong.push(`still ${index} came back as ${picture?.id}, not ${still.id}`);
      return null;
    }
    const side = Math.round(box * SPARK_STILLS_SCALE);
    if (picture.width !== side || picture.height !== side)
      wrong.push(`${still.id}: ${picture.width}×${picture.height}, not ${side}×${side}`);
    if (JSON.stringify(picture.rows.map(f32)) !== JSON.stringify(kept.get(still.id)))
      wrong.push(`${still.id}: the rows it drew are not the rows golden's`);
    const png = Buffer.from(picture.png.slice(picture.png.indexOf(",") + 1), "base64");
    return { still, width: picture.width, height: picture.height, png };
  });
  if (drawn.stills.length !== set.length)
    wrong.push(`${drawn.stills.length} stills came back for ${set.length} cases`);
  if (wrong.length > 0) {
    const said = wrong.join("\n  ");
    throw new Error(`the stills are not the rows golden's (work kept at ${work}):\n  ${said}`);
  }
  rmSync(work, { recursive: true, force: true });

  const manifest = {
    "//": "IOS-12e (PC-D6 A). The vendored spark engine's own pixels for the rows golden's still cases: WebGL2, render(0, { frozen: true }), toDataURL (straight-alpha RGBA PNGs), at the phone's @3x. Host-bound: redraw on purpose with node packages/design-kit/scripts/spark-stills-golden.mjs, after the rows golden; --check holds every byte.",
    engine: { file: "src/spark-face/vendor/sparks.js", sha256: engineSha },
    rows: { file: "fixtures/spark-rows.golden.json", sha256: sha256(rowsText) },
    scale: SPARK_STILLS_SCALE,
    host: {
      name: hostname(),
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? "unknown",
      electron: drawn.electron,
      chrome: drawn.chrome,
      renderer: drawn.renderer,
    },
    cases: pictures.map(({ still, width, height, png }) => ({
      ...caseEntry(still),
      file: `fixtures/spark-stills/${fileOf(still.id)}`,
      width,
      height,
      sha256: sha256(png),
    })),
  };
  return { manifest, pictures };
}

/** What has moved since the stills were drawn, in words; empty when every byte is the manifest's. No GPU. */
function checkSparkStills(statuses) {
  if (!existsSync(MANIFEST)) return [`${MANIFEST} is missing: draw the stills first`];
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const moved = [];
  if (manifest.engine?.sha256 !== sha256(readFileSync(ENGINE)))
    moved.push("the vendored engine moved since the stills were drawn");
  if (!existsSync(ROWS) || manifest.rows?.sha256 !== sha256(readFileSync(ROWS)))
    moved.push("the rows golden moved since the stills were drawn");
  const want = JSON.stringify(stillCases(statuses).map(caseEntry));
  const have = JSON.stringify((manifest.cases ?? []).map(caseEntry));
  if (want !== have) moved.push("the still cases are not stillCases()'s");
  for (const entry of manifest.cases ?? []) {
    const path = join(KIT, entry.file);
    if (!existsSync(path)) moved.push(`${entry.file} is missing`);
    else if (sha256(readFileSync(path)) !== entry.sha256)
      moved.push(`${entry.file} is not the drawn bytes`);
  }
  const named = new Set((manifest.cases ?? []).map(({ id }) => fileOf(id)));
  for (const name of existsSync(STILLS) ? readdirSync(STILLS) : [])
    if (!named.has(name)) moved.push(`fixtures/spark-stills/${name} is in no case`);
  return moved;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // engine.ts and statuses.ts import nothing at run time, so Node loads them with their types stripped
  const adapter = await import("../src/spark-face/engine.ts");
  const { SPARK_STATUSES } = await import("../src/spark-face/statuses.ts");
  const statuses = SPARK_STATUSES.map(({ id }) => id);
  if (process.argv.includes("--check")) {
    const moved = checkSparkStills(statuses);
    if (moved.length > 0) {
      console.error(`spark stills golden: redraw on purpose —\n  ${moved.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`spark stills golden: ${stillCases(statuses).length} stills, the manifest's bytes`);
  } else {
    const { manifest, pictures } = drawSparkStills(adapter, statuses);
    mkdirSync(STILLS, { recursive: true });
    for (const { still, png } of pictures) writeFileSync(join(STILLS, fileOf(still.id)), png);
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    const { renderer } = manifest.host;
    const drew = `${pictures.length} stills at @${SPARK_STILLS_SCALE}x`;
    console.log(`spark stills golden: drew ${drew} on ${renderer}`);
  }
}
