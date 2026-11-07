// IOS-12f's f5 (VF-PM ruled the f5 plan 2026-11-07 13:58:40Z, Q1 (a) and Q2) — spark-hatch-frames-golden.mjs's
// renderer, the Electron main it runs. It draws each frame as the hatch's sky draws one: ONE WebGL2 canvas at the
// phone's sky and ONE star engine, opened with the hatch's options (hatch.tsx :191) and `preserve`, so `toDataURL`
// reads what `render(t)` drew. For each frame the sky is cleared, the deal's star is added as the hatch adds it (the
// rows golden's `star`), and `render(t)` draws it.
//
// What differs from the sheet is said:
// - the pixel ratio: the window's, set for the run to the engine's own cap of 2, which the phone keeps (Q3);
// - the grain: the engine's option, set on `o` for each frame (`render` reads it each frame, star-spark.js :689),
//   0 for the motion frames and the engine's 0.035 for the grain's frame (Q2);
// - the rows the engine wrote are read back after `add`, and the driver holds them equal to the rows golden's.
//
// The job (written by the driver, never by hand): `$SPARK_HATCH_FRAMES_WORK/job.json` = { engine: star-spark.js's
// path, scale, options, cases: [{ id, t, grain, width, height, star }] }. The answer: `drawn.json` = { electron,
// chrome, renderer, hdr, devicePixelRatio, frames: [{ id, width, height, rows, png }] }. Run alone it does nothing
// useful: `node packages/design-kit/scripts/spark-hatch-frames-golden.mjs` runs it.
"use strict";

const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

const work = process.env.SPARK_HATCH_FRAMES_WORK;
if (!work) {
  console.error(
    "spark hatch frames: SPARK_HATCH_FRAMES_WORK names no job; run spark-hatch-frames-golden.mjs",
  );
  process.exit(2);
}
const job = JSON.parse(readFileSync(join(work, "job.json"), "utf8"));

// a profile of the run's own, under its work directory: never the app's, never Electron's default
app.setPath("userData", join(work, "profile"));
app.dock?.hide();

/** Runs in the page, serialized: every frame, in order, through one engine on one canvas. */
function drawFrames({ scale, options, cases }) {
  // the pixel ratio, said to the engine as the window's (Engine.resize reads it, capped at dprCap)
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => scale });
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position: fixed; inset-block-start: 0; inset-inline-start: 0;";
  document.body.append(canvas);
  const engine = new window.SparkEngine(canvas, { ...options, preserve: true });
  const gl = engine.gl;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info
    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  const frames = [];
  for (const { id, t, grain, width, height, star } of cases) {
    canvas.style.inlineSize = `${width}px`;
    canvas.style.blockSize = `${height}px`;
    engine.o.grain = grain;
    engine.clear();
    const added = star === null ? null : engine.add(star);
    const rows =
      added === null
        ? null
        : Array.from(engine.data.subarray(added.slot * 128, added.slot * 128 + 128));
    engine.render(t);
    frames.push({
      id,
      width: canvas.width,
      height: canvas.height,
      rows,
      png: canvas.toDataURL("image/png"),
    });
  }
  engine.clear();
  return { renderer, hdr: engine.hdr, devicePixelRatio: window.devicePixelRatio, frames };
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
  // the vendored engine, as the window loads it: one IIFE that sets window.SparkEngine
  await page.webContents.executeJavaScript(readFileSync(job.engine, "utf8"));
  const drawn = await page.webContents.executeJavaScript(
    `(${drawFrames})(${JSON.stringify({ scale: job.scale, options: job.options, cases: job.cases })})`,
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
    console.error(`spark hatch frames: ${error?.stack ?? error}`);
    app.exit(1);
  },
);
