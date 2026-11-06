// IOS-12e (PC-D6 A; VF-PM ruled the plan 2026-11-06 05:50Z, Q1 (a)) — spark-stills-golden.mjs's renderer, the
// Electron main it runs. It draws each still as `stills.ts` draws one (`drawStill`): ONE small WebGL2 canvas and ONE
// engine (`{ max: 1, preserve: true }`), the face added and placed, `render(0, { frozen: true })`, `toDataURL`. What
// differs is said: the phone's pixel ratio (the window's, set for the run, so `Engine.resize` sizes the canvas at it,
// with `dprCap` raised to match), the rows zeroed before each face (the rows golden's `written()` does the same), and
// `Math.random` dealt by mulberry32 on the face's seed, the rows golden's own function, so its rows are the rows
// golden's still rows. The driver holds them so, row for row.
//
// The job (written by the driver, never by hand): `$SPARK_STILLS_WORK/job.json` = { engine: sparks.js's path,
// mulberry32: the dealer's source, scale, cases: [{ id, seed, options, place, box }] }. The answer:
// `$SPARK_STILLS_WORK/drawn.json` = { electron, chrome, renderer, devicePixelRatio, stills: [{ id, width, height, rows,
// png }] }. Run alone it does nothing useful: `node packages/design-kit/scripts/spark-stills-golden.mjs` runs it.
"use strict";

const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

const work = process.env.SPARK_STILLS_WORK;
if (!work) {
  console.error("spark stills: SPARK_STILLS_WORK names no job; run spark-stills-golden.mjs");
  process.exit(2);
}
const job = JSON.parse(readFileSync(join(work, "job.json"), "utf8"));

// a profile of the run's own, under its work directory: never the app's, never Electron's default
app.setPath("userData", join(work, "profile"));
app.dock?.hide();

/** Runs in the page, serialized: every still, in order, through one engine on one canvas. */
function drawStills(mulberry32, { scale, cases }) {
  // the phone's @3x, said to the engine as the window's pixel ratio (Engine.resize reads it, capped at dprCap)
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => scale });
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position: fixed; inset-block-start: 0; inset-inline-start: 0;";
  document.body.append(canvas);
  const { Engine, Buddy } = window.Sparklings;
  const engine = new Engine(canvas, { max: 1, preserve: true, dprCap: scale });
  const gl = engine.gl;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info
    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  const random = Math.random;
  const stills = [];
  try {
    for (const { id, seed, options, place, box } of cases) {
      canvas.style.inlineSize = `${box}px`;
      canvas.style.blockSize = `${box}px`;
      engine.resize();
      engine.clear();
      engine.data.fill(0);
      Math.random = mulberry32(seed);
      const buddy = engine.add(new Buddy(options));
      Object.assign(buddy, place);
      engine.render(0, { frozen: true });
      stills.push({
        id,
        width: canvas.width,
        height: canvas.height,
        rows: Array.from(engine.data.subarray(0, 128)),
        png: canvas.toDataURL("image/png"),
      });
      engine.clear();
    }
  } finally {
    Math.random = random;
  }
  return { renderer, devicePixelRatio: window.devicePixelRatio, stills };
}

async function main() {
  await app.whenReady();
  const page = new BrowserWindow({
    show: false,
    width: 640,
    height: 640,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const blank = "<!doctype html><meta charset=utf-8><body style=margin:0></body>";
  await page.loadURL(`data:text/html,${encodeURIComponent(blank)}`);
  // the vendored engine, as the window loads it: one IIFE that sets window.Sparklings
  await page.webContents.executeJavaScript(readFileSync(job.engine, "utf8"));
  const drawn = await page.webContents.executeJavaScript(
    `(${drawStills})(${job.mulberry32}, ${JSON.stringify({ scale: job.scale, cases: job.cases })})`,
  );
  writeFileSync(
    join(work, "drawn.json"),
    JSON.stringify({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      ...drawn,
    }),
  );
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(`spark stills: ${error?.stack ?? error}`);
    app.exit(1);
  },
);
