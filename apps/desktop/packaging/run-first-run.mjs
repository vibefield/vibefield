#!/usr/bin/env node
// `node packaging/run-first-run.mjs [walk…]` — `pnpm smoke:first-run` (track FG, desk-gates row 32): the Setup
// Assistant walked by its own controls (packages/electron-shell/src/testing/smoke-first-run.ts), once a walk, each walk
// its own Electron launch on a FRESH profile (DK-5) — by DAY and by NIGHT on the live field, with NO WEBGPU over the
// field's still, and the CATALOG (the catalog judged, smoke-catalog.ts): the design catalog's Setup Assistant frames,
// every face by day and by night, judged by the row's own measure, on the design build `build:design` writes
// (`.vibefield/studio/catalog-renderer`, handed to that walk alone as `VF_CATALOG_RENDERER`; a missing build is red).
// Named walks run alone (`run-first-run.mjs night`); none named runs all four, in order.
//
// A walk's theme is the app's own store, written into its profile BEFORE the boot (main/theme.ts's
// `vibefield-theme.json`), never a call into main: light by day and over the still, dark by night, each explicit.
// Each launch is marked (`VF_SMOKE_RUN`) and taken as run-smoke.mjs takes one: once Electron has exited no process of
// it may live (`smoke-daemons.mjs`, `SMOKE_DAEMONS`; one left is reaped and makes the walk red), then its profile goes.
// A walk not done within its time (WALK_TIMEOUT_MS, the catalog's CATALOG_TIMEOUT_MS) is stopped and red.
//
// The stills go to ONE folder outside every smoke's own (`VF_SMOKE_SHOT_DIR` when it names one, else a fresh one under
// the OS temp, said as `FIRST_RUN_SHOTS`), a sub-folder a walk: a green walk's teardown removes its HOME and its
// profile, and neither can hold them. The keeper's copier brings that folder home with the row's logs.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { constants, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leftByRun, leftNames, SMOKE_RUN_ENV } from "./smoke-daemons.mjs";
import { mintSmokeProfile } from "./smoke-profile.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Where `pnpm --filter @vibefield/electron-shell build:design` writes the design catalog (its vite.config.ts). */
const CATALOG_RENDERER = resolve(desktopRoot, "../../.vibefield/studio/catalog-renderer");

/** A walk measured at about 90 s; one not done in this long is stopped whole and red. */
const WALK_TIMEOUT_MS = 240_000;
/** The catalog's walk: 120 faces, each captured and measured, in one launch. */
const CATALOG_TIMEOUT_MS = 480_000;

/** The walks, in their order; what each expects of the page is smoke-first-run.ts's `FIRST_RUN_WALKS`. */
const WALKS = [
  { walk: "day", preference: "light", flags: [], env: {}, timeoutMs: WALK_TIMEOUT_MS },
  { walk: "night", preference: "dark", flags: [], env: {}, timeoutMs: WALK_TIMEOUT_MS },
  {
    walk: "no-webgpu",
    preference: "light",
    flags: ["--smoke-no-webgpu"],
    env: {},
    timeoutMs: WALK_TIMEOUT_MS,
  },
  {
    walk: "catalog",
    preference: "light",
    flags: [],
    env: { VF_CATALOG_RENDERER: CATALOG_RENDERER },
    timeoutMs: CATALOG_TIMEOUT_MS,
  },
];
/** main/theme.ts `THEME_FILE`: where the app keeps the preference, in its profile. */
const THEME_FILE = "vibefield-theme.json";
const electronPath = createRequire(import.meta.url)("electron");

const asked = process.argv.slice(2);
const unknown = asked.filter((name) => !WALKS.some((w) => w.walk === name));
if (unknown.length > 0) {
  process.stderr.write(
    `run-first-run: no walk named ${unknown.join(", ")} (the walks: ${WALKS.map((w) => w.walk).join(", ")})\n`,
  );
  process.exit(2);
}
const walks = asked.length === 0 ? WALKS : WALKS.filter((w) => asked.includes(w.walk));

const shots = process.env.VF_SMOKE_SHOT_DIR || mkdtempSync(join(tmpdir(), "vf-first-run-shots-"));
mkdirSync(shots, { recursive: true });
process.stdout.write(`FIRST_RUN_SHOTS ${shots}\n`);

let current = null;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopping = true;
    current?.kill(signal);
  });
}

/** One walk: its profile minted with the walk's theme in it, Electron on that profile, then the run's census and the
 * profile's removal. Resolves the walk's verdict. */
function walkOnce({ walk, preference, flags, env, timeoutMs }) {
  const profile = mintSmokeProfile();
  const mark = basename(profile.dir);
  writeFileSync(join(profile.dir, THEME_FILE), `${JSON.stringify({ preference })}\n`);
  const shotDir = join(shots, walk);
  process.stdout.write(
    `FIRST_RUN_WALK ${JSON.stringify({ walk, preference, flags, userData: profile.dir, shotDir })}\n`,
  );
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(electronPath, [desktopRoot, profile.arg, "--smoke-first-run", ...flags], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        [SMOKE_RUN_ENV]: mark,
        VF_FIRST_RUN_WALK: walk,
        VF_SMOKE_SHOT_DIR: shotDir,
        ...env,
      },
      stdio: "inherit",
    });
    current = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.stderr.write(
        `run-first-run: the ${walk} walk ran past ${timeoutMs} ms; stopping it\n`,
      );
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutMs);
    let settled = false;
    const settle = async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      current = null;
      const daemons = await leftByRun(mark);
      process.stdout.write(`SMOKE_DAEMONS ${JSON.stringify(daemons)}\n`);
      if (daemons.left.length > 0) {
        process.stderr.write(
          `run-first-run: ${daemons.left.length} process(es) of the ${walk} walk outlived it (reaped): ${leftNames(daemons)}\n`,
        );
      }
      const removed = profile.remove();
      process.stdout.write(
        `SMOKE_PROFILE_REMOVED ${JSON.stringify({ userData: profile.dir, removed })}\n`,
      );
      const ok = code === 0 && !timedOut && removed && daemons.left.length === 0;
      const verdict = {
        walk,
        ok,
        code,
        timedOut,
        left: daemons.left.length,
        removed,
        seconds: Math.round((Date.now() - started) / 1000),
      };
      process.stdout.write(`FIRST_RUN_VERDICT ${JSON.stringify(verdict)}\n`);
      done(verdict);
    };
    child.once("error", (error) => {
      process.stderr.write(`run-first-run: Electron did not start: ${error.message}\n`);
      void settle(2);
    });
    child.once("exit", (code, signal) => {
      void settle(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)));
    });
  });
}

const verdicts = [];
for (const walk of walks) {
  if (stopping) break;
  verdicts.push(await walkOnce(walk));
}
const green = verdicts.length === walks.length && verdicts.every((v) => v.ok);
process.stdout.write(
  `FIRST_RUN ${JSON.stringify({
    green,
    walks: verdicts.map((v) => `${v.walk} ${v.ok ? "green" : "red"} ${v.seconds}s`),
    shots,
  })}\n`,
);
process.exit(green ? 0 : 1);
