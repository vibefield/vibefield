#!/usr/bin/env node
// PT-S3 (P3/P5/P6/P10) — THE PHONE'S STAGE: the iOS Simulator staged for ONE `--phone` smoke, and the host given back as
// it was found. The product never shuts a device down, deletes one or quits Simulator.app (a device is the person's), and
// run-smoke's reap sees only processes carrying its mark — CoreSimulator carries none — so the stage fences, stages and
// restores CoreSimulator itself, and nothing the smoke sees ever holds a UDID.
//
// Usage (after `apps/desktop/packaging/stage-kind-fixtures.mjs`'s shape):
//   node scripts/stage-simulator-fixture.mjs <none|devices|cost> -- <command…>   one console launch (L1, L2, L3)
//   node scripts/stage-simulator-fixture.mjs enum                                 L0: may the launching app enumerate?
//   node scripts/stage-simulator-fixture.mjs --preflight-only                     the files alone (no simctl): exit 0/1
//   node scripts/stage-simulator-fixture.mjs --sweep <runId>                      the run's `pts3-<runId>-n` shut down
// Options come by ENV, since a pnpm script's trailing arguments reach Electron:
//   VF_PHONE_RUN               the run's id, `^[a-z0-9]+(-[a-z0-9]+)*$` (its devices are `pts3-<runId>-1..3`)
//   VF_PHONE_HID_LOG           `<logs>/<run>/<run>-hid.log`: the HID record; `shots/` is made beside it, and ENUM's
//                              record (`phone-enum.json`) lives in `<logs>`, where every launch reads it
//   VF_PHONE_DEADLINE_MS       past it the command is stopped and the host restored (default 30 min, at most 6 h)
//   VF_PHONE_DELETE_DEVICES=1  teardown (and --sweep) DELETES the run's own devices; unset, they are KEPT, shut down and
//                              named (P5's default; the console runs set it on James's word, brief §13 RM2)
//   VF_PHONE_GUARD_AWK, VF_PHONE_PERF_LOCK, VF_PHONE_DISK_FLOORS (`<path>:<GiB>[,…]`)
//                              another host's house rules (the mini's); unset, this Mac's. PHONE_HOUSE_RULES says which
// Exit: the command's own code; 1 for a red preflight, rows record or restore; 2 for a usage error; 75 NOT ARMED or
// STOPPED (a hand, a foreign device booted mid-run, a Simulator.app not proven the run's) over a restored host — a STOP
// whose teardown left the host unrestored is 1 and PHONE_STOP_UNRESTORED; 128+n on a signal.
//
// THE SMOKE'S SIDE (`es/testing/smoke-phone.ts`). The command's env carries `VF_PHONE_HOST` (`http://127.0.0.1:<port>`),
// `VF_PHONE_TOKEN`, `VF_PHONE_MODE`, `VF_PHONE_RUNTIME` (the ONE iOS runtime the stage picked: never a literal, RM4.1),
// `VF_PHONE_DEVICES` (`1:<TP>,2:<TQ>,3:<TR>,4:<TN>` — n 1..3 the run's devices `pts3-<runId>-n`, 4 the type that never
// gets one; in `none` mode `1:<TP>`, and no device exists) and `VF_SMOKE_SHOT_DIR`. `DEVELOPER_DIR` is never in it (the
// product's own P1 finds Xcode, SIM-P1); `none` mode points the product's probe at `/var/empty` (P2). The door:
//   every request carries the token, as `x-phone-token` or `?t=` (401 without); a refusal is counted;
//   GET  /motion?n=<rrggbb>, /still?n=<rrggbb>  the stimulus pages (a hue sweep / a flat page, each with a band of the
//                                                colour `#<n>`); each beacons POST /loaded, and POST /input on
//                                                pointerdown, touchstart and keydown
//   GET  /loaded?n=, /input?n=                   `{n, state: <count>}`
//   POST /act {verb, device: n, url?, file?}     verb: boot, shutdown, state, openurl (`url` on this door, /motion or
//                                                /still), screenshot (`file`: a new `.png` in the shot dir), show-app,
//                                                quit-app (no device) → `{n, state}`; 409 `{n, state: "stop", why}`
//                                                once the run is stopped
//   POST /row {name, phase: begin|press|end}     the HID record → `{go}` (at an end, `{go, void}` for a VOID row) or
//                                                `{stop, why}`; the smoke ends its rows on a stop
//   POST /row {name, phase: input}               said by the smoke right before its FIRST `sendInputEvent` of the run
//                                                (a press is input too): RM4.5's own-input reading is held to that row
//   POST /row {name, phase: press, act, device}  THE PRESS GATE, right before every press of a face's act: `act` one of
//                                                boot, show, retry, open-settings (never create), `device` the phone's
//                                                D4 name, one of this run's `pts3-<runId>-n`; then the fence and no
//                                                Simulator.app running unless proven the run's → `{go}`, else `{stop}`;
//                                                `act: attach` (the bar's Attach, SIM-ATTACH): the fence — the host's
//                                                booted set ⊆ the run's own — and `device` Booted; never a launch
// and it prints `PHONE_ROWS_BEGIN mode=<m>` first, `PHONE_ROWS_END n=<k>` last (k = the rows it opened and closed).
//
// Lines a reader greps: PHONE_PREFLIGHT, PHONE_HOUSE_RULES, NOT ARMED, ARMED, PHONE_STOP_UNRESTORED, PHONE_CRASH_BEFORE, PHONE_XCODE_SELECT, PHONE_DEVICE,
// PHONE_COMMAND_ENV, PHONE_ROW, PHONE_STOP, PHONE_ROWS, PHONE_COST_SAMPLE, PHONE_ENUM, RESPONSIBLE, HID:, PHONE_REDACTED,
// PHONE_OBSERVATION, PHONE_HOST_RESTORED, PHONE_SWEEP. Every line — the command's stdout and stderr, and the stage's own —
// passes the redactor LINE-BUFFERED: the run's UDIDs read `<pts3-dev-n>`, every other device's `<host-dev-k>`.
//
// Importing this module spawns nothing (its units import it with node:child_process throwing): `main()` runs only as the
// entry, and every spawn — the command's own among them — goes through the injected deps (`exec`, `spawn`).

import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { constants, cpus, homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

export const MODES = ["none", "devices", "cost"];
export const RUN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
export const DEFAULT_DEADLINE_MS = 30 * 60_000;
/** S-6: the deadline's bound. Node fires a timer set past 2^31-1 ms at once, and caffeinate's is the deadline plus an
 * hour: 6 h keeps both inside a 32-bit timer, far past any run's need. */
export const MAX_DEADLINE_MS = 6 * 3_600_000;
export const NOT_ARMED = 75;
/** P10: a windowed row arms only on an unlocked console nobody has touched for this long. */
export const HID_IDLE_FLOOR_S = 120;
/** The cost launch's idle gate (PT-6a's method, P13). */
export const COST_CPU_IDLE_FLOOR = 0.6;

const XCODE_SELECT = "/usr/bin/xcode-select";
/** P1 (R5′): the default Xcode's developer directory, the ONE place looked when xcode-select names one without simctl. */
export const XCODE_DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
/** P2: `none` mode's developer directory for the product — it exists, is empty and root-owned: nothing made or removed. */
export const NONE_DEVELOPER_DIR = "/var/empty";
const XCRUN = "/usr/bin/xcrun";
const OPEN = "/usr/bin/open";
const PGREP = "/usr/bin/pgrep";
const PS = "/bin/ps";
const IOREG = "/usr/sbin/ioreg";
const AWK = "/usr/bin/awk";
const CAFFEINATE = "/usr/bin/caffeinate";
const DEFAULTS = "/usr/bin/defaults";

// The lane's house rules (brief §1): this Mac's lock, guard and disk floors — the defaults `houseRules` reads over.
const LANES = "/Volumes/SamsungRed/lanes";
export const PERF_LOCK = `${LANES}/PERF.lock`;
export const GUARD_AWK = `${LANES}/guard/guard-stop.awk`;
export const DISK_FLOORS = [
  { path: "/Volumes/SamsungRed", gib: 15 },
  { path: "/", gib: 10 },
];
const RULE_KEYS = ["VF_PHONE_GUARD_AWK", "VF_PHONE_PERF_LOCK", "VF_PHONE_DISK_FLOORS"];

/** The host's house rules: this Mac's by default; another host's (the mini's, before ENUM there and L3 — RM1 Q10/Q12,
 * §6.8) by env — `VF_PHONE_GUARD_AWK`, `VF_PHONE_PERF_LOCK` (absolute paths), `VF_PHONE_DISK_FLOORS`
 * (`<absolute path>:<GiB>[,…]`). `by` says which set armed; each wrong one is said. */
export function houseRules(env) {
  const errors = [];
  const given = (key) => typeof env[key] === "string" && env[key] !== "";
  const path = (key, fallback) => {
    if (!given(key)) return fallback;
    if (isAbsolute(env[key])) return env[key];
    errors.push(`${key} must be an absolute path`);
    return fallback;
  };
  const guardAwk = path("VF_PHONE_GUARD_AWK", GUARD_AWK);
  const perfLock = path("VF_PHONE_PERF_LOCK", PERF_LOCK);
  let diskFloors = DISK_FLOORS;
  if (given("VF_PHONE_DISK_FLOORS")) {
    const floors = env.VF_PHONE_DISK_FLOORS.split(",").map((part) => {
      const m = /^(\/[^:]*):(\d+)$/u.exec(part.trim());
      return m === null || Number(m[2]) <= 0 ? null : { path: m[1], gib: Number(m[2]) };
    });
    if (floors.includes(null))
      errors.push("VF_PHONE_DISK_FLOORS is <absolute path>:<GiB, > 0>[,…] (e.g. /:10)");
    else diskFloors = floors;
  }
  const from = RULE_KEYS.filter(given);
  const by = from.length === 0 ? "this Mac's defaults" : `env (${from.join(", ")})`;
  return { guardAwk, perfLock, diskFloors, by, errors };
}

export const rulesLine = (rules) =>
  `PHONE_HOUSE_RULES ${JSON.stringify({ by: rules.by, guard: rules.guardAwk, perfLock: rules.perfLock, disks: rules.diskFloors.map((d) => `${d.path}:${d.gib}`) })}`;

export const PATHS = {
  helper: join(ROOT, "apps/desktop/build/native/macos/live-surface-capture-helper"),
  adapter: join(ROOT, "apps/desktop/build/native/macos/live-surface-adapter.node"),
  nativeRoot: join(ROOT, "apps/desktop/build/native/macos"),
  nativeSources: [
    join(ROOT, "apps/desktop/native/macos/live-surface-capture"),
    join(ROOT, "apps/desktop/packaging/build-live-surface-capture.mjs"),
  ],
  pluginDist: join(ROOT, "plugins/simulator/dist"),
  pluginSources: [join(ROOT, "plugins/simulator/src")],
  shellMain: join(ROOT, "packages/electron-shell/dist/main/index.cjs"),
  shellSmoke: join(ROOT, "packages/electron-shell/dist/testing/smoke.cjs"),
  shellRenderer: join(ROOT, "packages/electron-shell/dist/renderer"),
  shellSources: [
    join(ROOT, "packages/electron-shell/src"),
    join(ROOT, "packages/field-app/src"),
    join(ROOT, "plugins/simulator/src"),
  ],
  catalog: join(ROOT, "plugins/simulator/src/catalog.gen.ts"),
  verifyCapture: join(ROOT, "apps/desktop/packaging/verify-live-surface-capture.mjs"),
};

const USAGE =
  "usage: stage-simulator-fixture.mjs <none|devices|cost> -- <command…> | enum | --preflight-only | --sweep <runId>";

// ─── names ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const runIdOk = (id) => typeof id === "string" && RUN_ID.test(id);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
export const ownName = (runId, n) => `pts3-${runId}-${n}`;

/** P5: the run's record is the NAME — exactly `pts3-<runId>-<digits>`, the run id taken literally. */
export function isOwnName(name, runId) {
  return (
    runIdOk(runId) &&
    typeof name === "string" &&
    new RegExp(`^pts3-${escapeRe(runId)}-\\d+$`, "u").test(name)
  );
}

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/iu;

// ─── the command line and the env ─────────────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const [first, ...rest] = argv;
  if (first === "--preflight-only" && rest.length === 0) return { mode: "preflight" };
  if (first === "--sweep" && rest.length === 1)
    return runIdOk(rest[0])
      ? { mode: "sweep", runId: rest[0] }
      : { error: `--sweep takes a run id (${RUN_ID.source})` };
  if (first === "enum" && rest.length === 0) return { mode: "enum" };
  if (MODES.includes(first) && rest[0] === "--" && rest.length > 1)
    return { mode: first, command: rest.slice(1) };
  return { error: USAGE };
}

/** The options a launch takes by ENV; each one wrong is said. */
export function readOptions(env) {
  const errors = [];
  const run = env.VF_PHONE_RUN;
  if (!runIdOk(run)) errors.push(`VF_PHONE_RUN must name the run (${RUN_ID.source})`);
  const hidLog = env.VF_PHONE_HID_LOG;
  if (typeof hidLog !== "string" || !isAbsolute(hidLog))
    errors.push("VF_PHONE_HID_LOG must be an absolute path (<logs>/<run>/<run>-hid.log)");
  const rawDeadline = env.VF_PHONE_DEADLINE_MS;
  const deadlineMs =
    rawDeadline === undefined || rawDeadline === "" ? DEFAULT_DEADLINE_MS : Number(rawDeadline);
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_DEADLINE_MS)
    errors.push(
      `VF_PHONE_DEADLINE_MS must be a whole number of ms, > 0 and ≤ 6 h (${MAX_DEADLINE_MS})`,
    );
  const del = env.VF_PHONE_DELETE_DEVICES;
  if (del !== undefined && del !== "" && del !== "0" && del !== "1")
    errors.push("VF_PHONE_DELETE_DEVICES is 1 (delete the run's own devices) or unset (keep them)");
  const { errors: ruleErrors, ...rules } = houseRules(env);
  errors.push(...ruleErrors);
  const runDir = typeof hidLog === "string" && isAbsolute(hidLog) ? dirname(hidLog) : null;
  return {
    run,
    rules,
    hidLog,
    deadlineMs,
    deleteDevices: del === "1",
    shotDir: runDir === null ? null : join(runDir, "shots"),
    enumRecord: runDir === null ? null : join(dirname(runDir), "phone-enum.json"),
    errors,
  };
}

/** The type list the smoke is handed: `n:<type>` (n 1..3 the run's devices, 4 the no-device type); `none` mode's one
 * type has no device. Never a UDID. */
export function devicesWord(mode, types) {
  return mode === "none" ? `1:${types[0]}` : types.map((type, i) => `${i + 1}:${type}`).join(",");
}

/** The env with no developer-dir override — what the product's own xcode-select sees (Q6: L2 runs WITHOUT it), so the
 * stage reads xcode-select's answer as the product will, and the command's env starts from it. */
export function withoutDeveloperDir(env) {
  const { DEVELOPER_DIR: _developerDir, VF_SMOKE_SIMCTL_DEVELOPER_DIR: _override, ...rest } = env;
  return rest;
}

/** The command's env: `DEVELOPER_DIR` and any inherited smoke override STRIPPED (the product's own P1 finds Xcode, Q6);
 * `none` mode points the product's probe at an empty directory (P2); the door's words added — among them the driver's
 * own `xcode-select -p` reading as a label (`VF_PHONE_DEVDIR_BY`: xcode-select | fallback, never a path), so SIM-P1
 * VOIDs on the DRIVER's word, never on the product's (RM4.2). */
export function commandEnv(mode, env, door) {
  return {
    ...withoutDeveloperDir(env),
    ...(mode === "none" ? { VF_SMOKE_SIMCTL_DEVELOPER_DIR: NONE_DEVELOPER_DIR } : {}),
    VF_PHONE_HOST: door.origin,
    VF_PHONE_TOKEN: door.token,
    VF_PHONE_MODE: mode,
    VF_PHONE_RUNTIME: door.runtime,
    VF_PHONE_DEVICES: devicesWord(mode, door.types),
    VF_PHONE_DEVDIR_BY: door.devDirBy,
    VF_SMOKE_SHOT_DIR: door.shotDir,
  };
}

// ─── the preflight: FAILS LOUD ────────────────────────────────────────────────────────────────────────────────────────

const NATIVE_FIX = "pnpm --filter @vibefield/desktop build:live-surfaces-native";
// the root has no `build:all`; the desktop's is the one smoke:canvas runs
const BUILD_FIX = "pnpm --filter @vibefield/desktop build:all";

/** The newest mtime under `path` — a file's own, a directory's newest file at any depth (`.DS_Store` aside); null when
 * absent or empty. */
export function newestMtime(path, fs = { statSync, readdirSync }) {
  let stat;
  try {
    stat = fs.statSync(path);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = null;
  for (const entry of fs.readdirSync(path, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === ".DS_Store") continue;
    const mtime = fs.statSync(join(entry.parentPath, entry.name)).mtimeMs;
    if (newest === null || mtime > newest) newest = mtime;
  }
  return newest;
}

const newestOf = (paths, fs) =>
  paths.reduce((newest, path) => Math.max(newest, newestMtime(path, fs) ?? 0), 0);

/** P3: the SCK helper and its adapter, built and no older than their sources (mtimes in ms, null = missing). */
export function nativeFresh({ helper, adapter, sources }) {
  const fails = [];
  for (const [what, mtime] of [
    ["the capture helper (live-surface-capture-helper)", helper],
    ["the capture adapter (live-surface-adapter.node)", adapter],
  ]) {
    if (mtime === null) fails.push({ what, why: "missing", fix: NATIVE_FIX });
    else if (mtime < sources)
      fails.push({
        what,
        why: "older than native/macos/live-surface-capture or build-live-surface-capture.mjs",
        fix: NATIVE_FIX,
      });
  }
  return fails;
}

/** The phone's plugin and the shell's dist, built and no older than their sources, and the smoke bundle holding the
 * literal `--phone` (a build without the phone's rows would run smoke:canvas's whole default order). */
export function distFresh({
  plugin,
  pluginSources,
  main,
  smoke,
  renderer,
  shellSources,
  smokeHasPhone,
}) {
  const fails = [];
  if (plugin === null)
    fails.push({ what: "plugins/simulator/dist", why: "missing", fix: BUILD_FIX });
  else if (plugin < pluginSources)
    fails.push({ what: "plugins/simulator/dist", why: "older than its src/", fix: BUILD_FIX });
  for (const [what, mtime] of [
    ["electron-shell dist/main/index.cjs", main],
    ["electron-shell dist/testing/smoke.cjs", smoke],
    ["electron-shell dist/renderer/", renderer],
  ]) {
    if (mtime === null) fails.push({ what, why: "missing", fix: BUILD_FIX });
    else if (mtime < shellSources)
      fails.push({
        what,
        why: "older than the newest file under electron-shell, field-app or the simulator's src/",
        fix: BUILD_FIX,
      });
  }
  if (smoke !== null && !smokeHasPhone)
    fails.push({
      what: "electron-shell dist/testing/smoke.cjs",
      why: "lacks the literal --phone (a build without the phone's rows)",
      fix: BUILD_FIX,
    });
  return fails;
}

/** Inside a launch, right before the command: the shot dir set, the helper ENUM proved, and — once the arm has
 * inferred it (`app` given) — the responsible app ENUM proved (§6: "ENUM by the same app as L1 and L2"; TCC follows
 * the responsible process, so another app's first ScreenCaptureKit call could raise a prompt on an unattended screen). */
export function launchChecks({ shotDir, helperSha, enumSha, app, enumApp = null }) {
  const fails = [];
  if (typeof shotDir !== "string" || shotDir.length === 0)
    fails.push({ what: "VF_SMOKE_SHOT_DIR", why: "unset", fix: "set VF_PHONE_HID_LOG" });
  if (enumSha === null)
    fails.push({
      what: "the helper's ENUM",
      why: "no ENUM has recorded this helper",
      fix: "run ENUM first: node scripts/stage-simulator-fixture.mjs enum (L0, James at the screen)",
    });
  else if (helperSha !== enumSha)
    fails.push({
      what: "the helper's ENUM",
      why: "the helper's sha256 is not the one ENUM recorded (rebuilt since: a new cdhash may re-prompt)",
      fix: "run ENUM again: node scripts/stage-simulator-fixture.mjs enum",
    });
  if (app !== undefined && enumSha !== null && (app === null || app !== enumApp))
    fails.push({
      what: "the responsible app",
      why:
        app === null
          ? "none inferred for this launch (no .app ancestor)"
          : enumApp === null
            ? `this launch's is ${app}; ENUM recorded no responsible app`
            : `this launch's is ${app}, not ${enumApp}, the one ENUM proved`,
      fix: "launch from the app ENUM ran in, or run ENUM again from this one (L0, James at the screen)",
    });
  return fails;
}

export const preflightLines = (fails) =>
  fails.length === 0
    ? ["PHONE_PREFLIGHT ok"]
    : fails.map((f) => `PHONE_PREFLIGHT FAIL ${f.what}: ${f.why} → ${f.fix}`);

/** The files, read: what `nativeFresh` and `distFresh` judge. Reads only — never a simctl. */
export function readFiles(fs = { statSync, readdirSync, readFileSync }) {
  let smokeHasPhone = false;
  try {
    smokeHasPhone = fs.readFileSync(PATHS.shellSmoke, "utf8").includes("--phone");
  } catch {}
  return {
    native: {
      helper: newestMtime(PATHS.helper, fs),
      adapter: newestMtime(PATHS.adapter, fs),
      sources: newestOf(PATHS.nativeSources, fs),
    },
    dist: {
      plugin: newestMtime(PATHS.pluginDist, fs),
      pluginSources: newestOf(PATHS.pluginSources, fs),
      main: newestMtime(PATHS.shellMain, fs),
      smoke: newestMtime(PATHS.shellSmoke, fs),
      renderer: newestMtime(PATHS.shellRenderer, fs),
      shellSources: newestOf(PATHS.shellSources, fs),
      smokeHasPhone,
    },
  };
}

// ─── the HID record (P10, pts3-hid-note.md) ───────────────────────────────────────────────────────────────────────────

/** `ioreg -n Root -d1`'s `CGSSessionScreenIsLocked`: absent is No; any console session saying Yes is Yes. */
export function parseLocked(text) {
  const said = [...String(text).matchAll(/"CGSSessionScreenIsLocked"=([A-Za-z]*)/gu)].map(
    (m) => m[1],
  );
  return said.includes("Yes") ? "Yes" : "No";
}

/** `ioreg -c IOHIDSystem`'s first `HIDIdleTime`, in whole seconds (ns / 1e9, as the note's awk); null when absent. */
export function parseIdle(text) {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/u.exec(String(text));
  return m === null ? null : Math.floor(Number(m[1]) / 1e9);
}

export const clock = (ms) => `${new Date(ms).toISOString().slice(11, 19)}Z`;

/** One line of the record, the probe's values as read: `HH:MM:SSZ [END ]console: locked <v>; HID idle Ns`. */
export function hidLine(sample, { end = false } = {}) {
  return `${clock(sample.at)} ${end ? "END " : ""}console: locked ${sample.locked}; HID idle ${sample.idle ?? "?"}s`;
}

/** A console row's two lines. */
export const hidLines = (begin, end) => [hidLine(begin), hidLine(end, { end: true })];

/** A row's begin: a locked console, or input since the last sample (a hand), STOPS the console acts. */
export function rowVerdict({ name, sample, last }) {
  if (sample.idle === null) return { stop: true, why: `HID unreadable at ${name}'s begin` };
  if (sample.locked !== "No")
    return { stop: true, why: `the console is locked (${sample.locked}) at ${name}'s begin` };
  const since = Math.floor((sample.at - last.at) / 1000);
  if (sample.idle < since)
    return {
      stop: true,
      hand: true,
      why: `a hand at the Mac before ${name}: HID idle ${sample.idle}s < ${since}s since the last sample`,
    };
  return { go: true };
}

/** A row's end: VOID when its END idle is under its own seconds (input mid-row) or END reads locked. At the run's FIRST
 * INPUT row — the first the smoke presses, drags or keys in by `sendInputEvent` (L2's SIM-STAGED lays the phone by a
 * drag; a press-gate row comes later) — a reset with the console unlocked is the run's own input moving HIDIdleTime —
 * P10's assumption failed — and the run STOPS on it (RM4.5), never loops. */
export function endVerdict({ name, sample, began, firstInput = false }) {
  const secs = Math.floor((sample.at - began.at) / 1000);
  if (sample.idle === null) return { void: true, secs, why: `HID unreadable at ${name}'s END` };
  if (sample.locked !== "No")
    return { void: true, secs, why: `${name}'s END reads locked ${sample.locked}` };
  if (sample.idle < secs) {
    if (firstInput)
      return { stop: true, own: true, secs, why: "HID moved by the run's own input — RM4.5" };
    return {
      void: true,
      hand: true,
      secs,
      why: `a hand at the Mac mid-row: ${name}'s END idle ${sample.idle}s < its ${secs}s`,
    };
  }
  return { ok: true, secs };
}

/** The run log's HID summary. */
export function hidSummary({ armed, end, armedAt, hands, ownInput }) {
  const secs = Math.floor((end.at - armedAt) / 1000);
  const hand = hands > 0 || (!ownInput && end.idle !== null && end.idle < secs);
  return `HID: ARMED ${armed.idle ?? "?"}s; END ${end.idle ?? "?"}s; a hand at the Mac: ${hand ? "YES" : "no"}${
    ownInput ? "; HID moved by the run's own input — RM4.5" : ""
  }`;
}

// ─── simctl's list, read in memory only ───────────────────────────────────────────────────────────────────────────────

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** `simctl list --json`, EVERY device kept — available or not, of an installed runtime or not (the product's list drops
 * the unavailable ones; the fence must not). */
export function parseList(raw) {
  const doc = JSON.parse(raw);
  if (!isRecord(doc) || !isRecord(doc.devices) || !Array.isArray(doc.runtimes))
    throw new Error("simctl list --json is not a device list");
  const runtimes = doc.runtimes.filter(isRecord).map((r) => ({
    identifier: String(r.identifier ?? ""),
    version: String(r.version ?? "0"),
    available: r.isAvailable !== false,
    supported: new Set(
      (Array.isArray(r.supportedDeviceTypes) ? r.supportedDeviceTypes : [])
        .filter(isRecord)
        .map((t) => String(t.identifier ?? "")),
    ),
  }));
  const devices = [];
  for (const [runtime, rows] of Object.entries(doc.devices)) {
    if (!Array.isArray(rows)) continue;
    for (const d of rows)
      if (isRecord(d) && typeof d.udid === "string")
        devices.push({
          udid: d.udid,
          name: String(d.name ?? ""),
          state: String(d.state ?? ""),
          deviceType: String(d.deviceTypeIdentifier ?? ""),
          runtime,
          available: d.isAvailable === true,
        });
  }
  return { runtimes, devices };
}

export const BUSY_STATES = new Set(["Booted", "Booting", "ShuttingDown"]);

/** THE FENCE: no device on the host Booted, Booting or ShuttingDown — every one counted, available or not — but the
 * run's own (`own`: upper-case UDIDs). A foreign booted device gets a window from any fresh Simulator.app launch, and a
 * quit could take it down (P5: never another device). */
export function fenceClear(list, own = new Set()) {
  const busy = list.devices.filter(
    (d) => BUSY_STATES.has(d.state) && !own.has(d.udid.toUpperCase()),
  ).length;
  return { clear: busy === 0, busy };
}

/** The plugin's catalog ids, read as text (testing never imports the plugin). */
export const catalogIds = (text) =>
  [...String(text).matchAll(/^\s*id: "(com\.apple\.CoreSimulator\.SimDeviceType\.[^"]+)"/gmu)].map(
    (m) => m[1],
  );

const versionParts = (version) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);
function compareVersionsDescending(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (b[i] ?? 0) - (a[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** P5 + RM4.1: the catalog's iPhone types with ZERO devices of any runtime, and ONE iOS runtime — the newest installed
 * that supports at least four of them. Answers that runtime and the first four such types sorted: three for the run's
 * own devices (TP, TQ, TR), the fourth (TN) SIM-NO-DEVICE's, which never gets one. Null: not four. */
export function pickOwnTypes(list, catalog) {
  const used = new Set(list.devices.map((d) => d.deviceType));
  const zero = new Set(catalog.filter((id) => !used.has(id)));
  const ios = list.runtimes
    .filter(
      (r) => r.available && r.identifier.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-"),
    )
    .sort(
      (a, b) =>
        compareVersionsDescending(a.version, b.version) ||
        (a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0),
    );
  for (const runtime of ios) {
    const types = [...runtime.supported].filter((id) => zero.has(id)).sort();
    if (types.length >= 4) return { runtime: runtime.identifier, types: types.slice(0, 4) };
  }
  return null;
}

// ─── the developer dir (P1, for the stage's own spawns) ───────────────────────────────────────────────────────────────

function hasControlCharacters(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** P1's rule, as the product's probe: xcode-select's answer when it holds simctl; a well-formed answer without simctl
 * (the Command Line Tools) falls back to the default Xcode's when THAT holds simctl; a garbage answer is none. */
export function pickDeveloperDir(answer, exists) {
  const dir = typeof answer === "string" ? answer.trim() : "";
  if (dir.length === 0 || dir.length > 1_024 || !isAbsolute(dir) || hasControlCharacters(dir))
    return null;
  if (exists(join(dir, "usr/bin/simctl"))) return { dir, by: "xcode-select" };
  if (exists(join(XCODE_DEVELOPER_DIR, "usr/bin/simctl")))
    return { dir: XCODE_DEVELOPER_DIR, by: "fallback" };
  return null;
}

// ─── ARMING: checked ONCE, never waited for ───────────────────────────────────────────────────────────────────────────

/** Every gate a launch arms on, each failing one said. `hidWaived`: ENUM (James is AT the screen). `requireApp`: ENUM,
 * which STOPS with no `.app` ancestor (the grant it proves is the responsible app's; a launch prints the chain alone). */
export function armGate(r) {
  const why = [];
  if (!r.hidWaived) {
    if (r.hid === null || r.hid.idle === null) why.push("HID unreadable (ioreg)");
    else {
      if (r.hid.locked !== "No") why.push(`the console is locked (${r.hid.locked})`);
      if (r.hid.idle < HID_IDLE_FLOOR_S)
        why.push(`someone is at the Mac (HID idle ${r.hid.idle}s < ${HID_IDLE_FLOOR_S}s)`);
    }
  }
  if (r.guard === null) why.push(`the guard is unreadable (${r.rules?.guardAwk ?? GUARD_AWK})`);
  else if (r.guard > 0) why.push(`the guard stops on ${r.guard} process(es) (James's dev app?)`);
  if (r.perfLock) why.push(`${r.rules?.perfLock ?? PERF_LOCK} is held`);
  for (const disk of r.disks)
    if (disk.freeGiB === null || disk.freeGiB < disk.gib)
      why.push(`${disk.path} has ${disk.freeGiB ?? "?"} GiB free (< ${disk.gib})`);
  if (r.simulator === null || r.xcodebuild === null || r.simctl === null)
    why.push("pgrep unreadable");
  else {
    if (r.simulator > 0) why.push("Simulator.app is running");
    if (r.xcodebuild > 0) why.push(`${r.xcodebuild} xcodebuild process(es) run`);
    if (r.simctl > 0) why.push(`${r.simctl} simctl process(es) run`);
  }
  if (r.developerDir === null)
    why.push("no developer dir holds simctl (xcode-select's answer, then the default Xcode)");
  if (r.fence === null) why.push("simctl list unreadable");
  else if (!r.fence.clear)
    why.push(`the fence: ${r.fence.busy} device(s) Booted, Booting or ShuttingDown on this host`);
  if (r.fence !== null && r.types === null)
    why.push(
      "fewer than 4 catalog iPhone types with zero devices that one installed iOS runtime supports",
    );
  if (r.ownLeft > 0)
    why.push(
      `${r.ownLeft} device(s) of this run's name exist: --sweep the run, or name a new VF_PHONE_RUN`,
    );
  if (r.requireApp && r.app === null)
    why.push("no .app ancestor: the responsible app cannot be inferred (STOP before ENUM)");
  if (r.cpuIdle !== undefined && r.cpuIdle < COST_CPU_IDLE_FLOOR)
    why.push(`the CPU is ${Math.round(r.cpuIdle * 100)}% idle (< 60%: the cost launch's gate)`);
  return { armed: why.length === 0, why };
}

/** The idle share of every core between two `os.cpus()` reads. */
export function cpuIdleBetween(before, after) {
  let idle = 0;
  let total = 0;
  for (const [i, cpu] of after.entries()) {
    const was = before[i]?.times;
    if (was === undefined) continue;
    for (const key of Object.keys(cpu.times)) total += cpu.times[key] - (was[key] ?? 0);
    idle += cpu.times.idle - was.idle;
  }
  return total > 0 ? idle / total : 0;
}

// ─── the responsible app (INFERRED) ───────────────────────────────────────────────────────────────────────────────────

/** One `ps -o pid=,ppid=,comm=` row; comm may hold spaces. */
export function parsePsRow(line) {
  const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
  return m === null ? null : { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] };
}

/** The chain's first `.app` — the bundle the TCC grant would be asked of (its outermost, for a helper inside one). */
export function responsibleApp(chain) {
  for (const { comm } of chain) {
    const at = comm.indexOf(".app/");
    if (at >= 0) return comm.slice(0, at + 4);
    if (comm.endsWith(".app")) return comm;
  }
  return null;
}

export const chainWords = (chain) => chain.map((p) => `${p.pid} ${p.comm}`).join(" ← ");

// ─── the redactor ─────────────────────────────────────────────────────────────────────────────────────────────────────

const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;

/** Every UDID on the host, in memory only: the run's own read `<pts3-dev-n>`, every other `<host-dev-k>`. A line's kind
 * is `words` (a `PHONE_WORDS` line, swept for any UUID shape besides), `main` (the command's other lines) or `driver`
 * (the stage's own); hits are counted by kind. */
export function createRedactor() {
  const labels = new Map();
  let foreignCount = 0;
  let pattern = null;
  const counts = {
    words: { own: 0, foreign: 0, uuid: 0 },
    main: { own: 0, foreign: 0 },
    driver: { own: 0, foreign: 0 },
  };
  const rebuild = () => {
    pattern =
      labels.size === 0 ? null : new RegExp([...labels.keys()].map(escapeRe).join("|"), "giu");
  };
  const replace = (text, count) =>
    pattern === null
      ? text
      : text.replace(pattern, (hit) => {
          const label = labels.get(hit.toUpperCase());
          count?.(label.kind);
          return label.label;
        });
  return {
    own(udid, n) {
      labels.set(udid.toUpperCase(), { label: `<pts3-dev-${n}>`, kind: "own" });
      rebuild();
    },
    foreign(udid) {
      const key = udid.toUpperCase();
      if (labels.has(key)) return;
      foreignCount += 1;
      labels.set(key, { label: `<host-dev-${foreignCount}>`, kind: "foreign" });
      rebuild();
    },
    knows: (udid) => labels.has(udid.toUpperCase()),
    /** One whole line, redacted and counted. */
    line(text, source = "main") {
      const kind = source === "driver" ? "driver" : /PHONE_WORDS/u.test(text) ? "words" : "main";
      let out = replace(text, (which) => {
        counts[kind][which] += 1;
      });
      if (kind === "words")
        out = out.replace(UUID_SHAPE, () => {
          counts.words.uuid += 1;
          return "<uuid>";
        });
      return out;
    },
    /** Redacted, never counted, and every other UUID shape swept — a text printed once as an OBSERVATION (Simulator's
     * defaults may name a device no longer on the host). */
    scrub: (text) => replace(String(text)).replace(UUID_SHAPE, "<uuid>"),
    counts: () => structuredClone(counts),
  };
}

/** A stream through the redactor, LINE-BUFFERED: a UDID split across two chunks is whole before it is matched. */
export function redactStream(redactor, source, write) {
  let partial = "";
  return {
    push(chunk) {
      partial += String(chunk);
      for (;;) {
        const newline = partial.indexOf("\n");
        if (newline < 0) break;
        write(`${redactor.line(partial.slice(0, newline), source)}\n`);
        partial = partial.slice(newline + 1);
      }
    },
    end() {
      if (partial.length > 0) write(`${redactor.line(partial, source)}\n`);
      partial = "";
    },
  };
}

// ─── the rows record ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The rows each mode runs — its count, exact (§2: the driver reds a `k` that "is not the mode's count"), one `/row` pair
 * each: L1 SIM-NONE and SIM-NO-UDID; L2 twenty, the seventeen MUST from SIM-STAGED to SIM-NO-UDID (SIM-P1 its own row,
 * VOID on an Xcode-selected host) with SIM-RATE (OBSERVATION) and SIM-SHARE, SIM-REBIND (NICE); L3 SIM-COST. The smoke's
 * `PHONE_ROWS` is held to these by its unit; `PHONE_ROWS_END n=` must also equal the rows the door saw. */
export const MODE_ROWS = { none: 2, devices: 20, cost: 1 };

/** A `PHONE_ROWS_BEGIN`/`END` line, or null. */
export function rowsMark(line) {
  const begin = /\bPHONE_ROWS_BEGIN mode=([a-z]+)\b/u.exec(line);
  if (begin !== null) return { begin: begin[1] };
  const end = /\bPHONE_ROWS_END n=(\d+)\b/u.exec(line);
  return end === null ? null : { end: Number(end[1]) };
}

/** Red when the smoke never said BEGIN or END ("--phone not in this build"), said another mode, or its count is not the
 * rows the door saw open and close, or not the mode's count. */
export function rowsVerdict({ mode, begin, end, served }) {
  if (begin === null)
    return { ok: false, why: "no PHONE_ROWS_BEGIN: --phone is not in this build" };
  if (begin !== mode) return { ok: false, why: `PHONE_ROWS_BEGIN mode=${begin}, not ${mode}` };
  if (end === null) return { ok: false, why: "no PHONE_ROWS_END: the rows never finished" };
  if (end !== served)
    return { ok: false, why: `PHONE_ROWS_END n=${end}, but the door saw ${served} row(s)` };
  if (end !== MODE_ROWS[mode])
    return { ok: false, why: `${end} row(s): ${mode} runs ${MODE_ROWS[mode]}` };
  return { ok: true, why: `${end} row(s)` };
}

// ─── Simulator.app: quit only when PROVEN the run's ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `ps -o lstart=` under LC_ALL=C (`Fri Oct 31 03:30:12 2026`, local time) → ms; null when unreadable. */
export function parseLstart(text) {
  const m =
    /^\s*[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/u.exec(
      String(text),
    );
  const month = m === null ? -1 : MONTHS.indexOf(m[1]);
  if (m === null || month < 0) return null;
  return new Date(
    Number(m[6]),
    month,
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ).getTime();
}

export const simulatorExe = (devDir) =>
  join(devDir, "Applications/Simulator.app/Contents/MacOS/Simulator");

/** P5: a running Simulator.app is the run's only when `pgrep -x Simulator` finds exactly one, its executable is the vetted
 * Xcode's (`ps -o comm=`, as named or by its real path), it started after ARMED — `lstart` keeps whole seconds, so a
 * start in ARMED's own second is NOT after it — and it started no earlier than the run's FIRST launch since its own last
 * quit (`launchedAt`: the door's show-app, or a press of Show it, Boot or Try again through the gate; null — none since,
 * so whatever runs now was started by another), within `lstart`'s second. A count never proves it: after the run quits
 * its app, a Simulator.app another tool starts is not the run's. Never a stored pid. */
export function simulatorProof({
  pids,
  comm,
  lstart,
  devDir,
  realExe = null,
  armedAt,
  launchedAt,
}) {
  if (pids.length === 0) return { running: 0, own: false, why: "Simulator.app is not running" };
  if (pids.length !== 1)
    return { running: pids.length, own: false, why: `${pids.length} Simulator processes run` };
  const exe = String(comm).trim();
  if (exe !== simulatorExe(devDir) && (realExe === null || exe !== realExe))
    return {
      running: 1,
      own: false,
      why: "its executable is not the vetted Xcode's Simulator.app",
    };
  const started = parseLstart(lstart);
  if (started === null) return { running: 1, own: false, why: "its start is unreadable" };
  if (started < armedAt) return { running: 1, own: false, why: "it started before ARMED" };
  if (launchedAt === null || launchedAt === undefined)
    return { running: 1, own: false, why: "the run launched no Simulator.app since its last quit" };
  if (started < launchedAt - 1_000)
    return { running: 1, own: false, why: "it started before the run's launch" };
  return { running: 1, own: true, pid: pids[0] };
}

/** The Simulator.app launches the run may have made. */
export const launchesOf = (run) => run.simulator.shown + run.simulator.pressed;

/** A launch the run may make (show-app, a press through the gate): the FIRST since its last quit is the one its app's
 * start is held to. */
const launching = (run, deps) => {
  run.simulator.launchedAt ??= deps.now();
};
/** The run's app is gone (quit, or found not running when the run asked to quit it): its launch is spent. */
const launchSpent = (run) => {
  run.simulator.launchedAt = null;
};

// ─── the host door (P6) ───────────────────────────────────────────────────────────────────────────────────────────────

export const DOOR_VERBS = [
  "boot",
  "shutdown",
  "openurl",
  "screenshot",
  "show-app",
  "state",
  "quit-app",
];
/** The face's acts a press may run; `create` is never pressed (Q1/RM4.4: a product-made device is never the run's). */
export const PRESS_ACTS = ["boot", "show", "retry", "open-settings"];
/** The acts the press gate takes: the face's, and the selection bar's Attach — which binds whatever booted device of its
 * model the host answers, so it is gated by the fence (§4 SIM-ATTACH: "the driver's booted set ⊆ own devices") and its
 * own device Booted, and launches no Simulator.app. */
export const GATED_ACTS = [...PRESS_ACTS, "attach"];
export const NONCE = /^[0-9a-f]{6}$/u;
const DEVICE_STATES = new Set(["Booted", "Booting", "Shutdown", "ShuttingDown", "Creating"]);
const MAX_BODY_BYTES = 16 * 1024;
const ROW_NAME_CHARS = 80;

const digest = (text) => createHash("sha256").update(String(text)).digest();
/** The token, compared in constant time (both sides hashed to one length first). */
export const tokenOk = (given, token) =>
  typeof given === "string" && timingSafeEqual(digest(given), digest(token));

/** A stimulus page: `motion` a full-screen hue sweep, `still` a flat page — each with a band of `#<n>` — beaconing
 * `/loaded`, and `/input` on pointerdown, touchstart and keydown. */
export function stimulusPage(kind, n, token) {
  const query = `?n=${n}&t=${token}`;
  const motion = [
    "var h = 0;",
    "function step() {",
    "  h = (h + 4) % 360;",
    '  document.body.style.background = "linear-gradient(90deg, hsl(" + h + ",90%,55%), hsl(" + ((h + 120) % 360) + ",90%,55%), hsl(" + ((h + 240) % 360) + ",90%,55%))";',
    "  requestAnimationFrame(step);",
    "}",
    "requestAnimationFrame(step);",
  ];
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">',
    `<title>pts3 ${kind}</title>`,
    `<style>html,body{margin:0;height:100%;overflow:hidden;background:#808080}#band{position:fixed;left:0;right:0;top:40%;height:20%;background:#${n}}</style>`,
    '</head><body><div id="band"></div><script>',
    `var q = ${JSON.stringify(query)};`,
    'navigator.sendBeacon("/loaded" + q);',
    '["pointerdown", "touchstart", "keydown"].forEach(function (type) {',
    '  addEventListener(type, function () { navigator.sendBeacon("/input" + q); }, { capture: true, passive: true });',
    "});",
    ...(kind === "motion" ? motion : []),
    "</script></body></html>",
    "",
  ].join("\n");
}

/** An `openurl` target: THIS door's origin, /motion or /still, `n` a nonce (and `t`, if given, the token) — answered as
 * the canonical URL with the token; anything else null. */
export function canonicalPage(url, run) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.port !== String(run.port))
    return null;
  if (u.username !== "" || u.password !== "" || u.hash !== "") return null;
  if (u.pathname !== "/motion" && u.pathname !== "/still") return null;
  if ([...u.searchParams.keys()].some((key) => key !== "n" && key !== "t")) return null;
  const n = u.searchParams.get("n");
  if (n === null || !NONCE.test(n)) return null;
  const t = u.searchParams.get("t");
  if (t !== null && !tokenOk(t, run.token)) return null;
  return `${run.origin}${u.pathname}?n=${n}&t=${run.token}`;
}

/** A screenshot's file: a NEW `.png` whose real directory is the shot dir or inside it — never `-`, never an existing
 * file (nor a dangling link). Answers the real path, or null. */
export function shotPath(file, run, fs) {
  if (
    typeof file !== "string" ||
    file.length === 0 ||
    file.startsWith("-") ||
    !file.endsWith(".png")
  )
    return null;
  const full = resolve(run.shotDir, file);
  let root;
  let dir;
  try {
    root = fs.realpath(run.shotDir);
    dir = fs.realpath(dirname(full));
  } catch {
    return null;
  }
  if (dir !== root && !dir.startsWith(`${root}${sep}`)) return null;
  const target = join(dir, basename(full));
  return fs.exists(target) ? null : target;
}

const json = (status, body) => ({ status, type: "json", body });

function refuse(run, kind, status, body) {
  run.refused[kind] = (run.refused[kind] ?? 0) + 1;
  return json(status, body);
}

/** The pinned env of the stage's OWN simctl and open spawns. */
const pinned = (run, deps) => ({ ...deps.env, DEVELOPER_DIR: run.devDir });

const simctl = (run, deps, args, timeoutMs) =>
  deps.exec(XCRUN, ["simctl", ...args], { env: pinned(run, deps), timeoutMs });

/** The host's list, read in memory: every UDID not yet known joins the redactor as foreign. Null when it fails. */
export async function readList(run, deps) {
  const r = await simctl(run, deps, ["list", "--json"], 15_000);
  if (r.code !== 0) return null;
  let list;
  try {
    list = parseList(r.stdout);
  } catch {
    return null;
  }
  for (const d of list.devices) if (!run.redactor.knows(d.udid)) run.redactor.foreign(d.udid);
  return list;
}

const ownUdids = (run) => new Set([...run.own.values()].map((d) => d.udid.toUpperCase()));

/** STOP the console acts: every later act and row is answered `stop`; the command is given time to end its rows. */
export function stopRun(run, deps, why) {
  if (run.stopped !== null) return;
  run.stopped = { why };
  deps.say(`PHONE_STOP ${why}`);
  deps.onStop?.(why);
}

/** The fence, again — right before every Simulator.app launch and every quit. A foreign device booted mid-run STOPS. */
export async function fenceAgain(run, deps) {
  const list = await readList(run, deps);
  if (list === null) return { ok: false, why: "simctl list failed: the fence is unproven" };
  const fence = fenceClear(list, ownUdids(run));
  if (!fence.clear) {
    stopRun(run, deps, `the fence: ${fence.busy} foreign device(s) booted mid-run`);
    return { ok: false, stop: true, why: run.stopped.why };
  }
  return { ok: true, list };
}

/** Simulator.app now, judged by `simulatorProof`. */
export async function simulatorNow(run, deps) {
  const found = await deps.exec(PGREP, ["-x", "Simulator"], { timeoutMs: 10_000 });
  const pids =
    found.code === 0
      ? found.stdout.split(/\s+/u).filter(Boolean).map(Number)
      : found.code === 1
        ? []
        : null;
  if (pids === null) return { running: null, own: false, why: "pgrep failed" };
  const proof = {
    pids,
    devDir: run.devDir,
    armedAt: run.armedAt,
    launchedAt: run.simulator.launchedAt,
  };
  if (pids.length !== 1) return simulatorProof({ ...proof, comm: "", lstart: "" });
  const c = { env: { ...deps.env, LC_ALL: "C" }, timeoutMs: 10_000 };
  const comm = await deps.exec(PS, ["-o", "comm=", "-p", String(pids[0])], c);
  const lstart = await deps.exec(PS, ["-o", "lstart=", "-p", String(pids[0])], c);
  let realExe = null;
  try {
    realExe = deps.realpath(simulatorExe(run.devDir));
  } catch {}
  return simulatorProof({ ...proof, comm: comm.stdout, lstart: lstart.stdout, realExe });
}

/** Simulator.app at teardown: a launch the run asked for may still be on its way (LaunchServices answers `open -a` before
 * the app's process exists, and the door's last act may have just ended), so a run that launched one and finds none looks
 * again, every 250 ms for `ms`. */
export async function simulatorSettled(run, deps, ms = 2_000) {
  let app = await simulatorNow(run, deps);
  for (let i = 0; i < ms / 250 && app.running === 0 && run.simulator.launchedAt !== null; i += 1) {
    await deps.sleep(250);
    app = await simulatorNow(run, deps);
  }
  return app;
}

async function waitGone(pid, deps, ms) {
  const until = deps.now() + ms;
  while (deps.alive(pid)) {
    if (deps.now() >= until) return false;
    await deps.sleep(200);
  }
  return true;
}

/** `quit-app`: the fence, the proof, SIGTERM, waited ≤ 10 s. Never osascript; a Simulator.app not proven the run's is
 * refused, recorded, and the run STOPS. */
export async function quitApp(run, deps, n = null) {
  const fence = await fenceAgain(run, deps);
  if (!fence.ok)
    return fence.stop
      ? json(409, { n, state: "stop", why: fence.why })
      : refuse(run, "quit-app", 502, { n, state: "refused", why: fence.why });
  const proof = await simulatorNow(run, deps);
  if (proof.running === 0) {
    launchSpent(run);
    return json(200, { n, state: "not-running" });
  }
  if (!proof.own) {
    stopRun(run, deps, `quit-app refused: ${proof.why}`);
    return refuse(run, "quit-app", 409, { n, state: "stop", why: run.stopped.why });
  }
  deps.kill(proof.pid, "SIGTERM");
  run.simulator.quits += 1;
  if (await waitGone(proof.pid, deps, 10_000)) {
    launchSpent(run);
    return json(200, { n, state: "quit" });
  }
  deps.say("stage-simulator-fixture: Simulator.app outlived SIGTERM by 10 s");
  return json(502, { n, state: "failed", why: "Simulator.app outlived SIGTERM by 10 s" });
}

/** An own device's state, as a word from simctl's own set (never its JSON). */
async function stateOf(run, deps, own) {
  const list = await readList(run, deps);
  if (list === null) return "unknown";
  const device = list.devices.find((d) => d.udid.toUpperCase() === own.udid.toUpperCase());
  if (device === undefined) return "absent";
  return DEVICE_STATES.has(device.state) ? device.state : "unknown";
}

/** POST /act — P6's verbs (with `state` and `quit-app`, amended 03:00Z) on the run's OWN devices; anything else is
 * refused and counted. A response is `{n, state}`: fixed words, never simctl's output. */
export async function doorAct(body, run, deps) {
  const verb = isRecord(body) ? body.verb : undefined;
  const n = isRecord(body) && Number.isInteger(body.device) ? body.device : null;
  if (!DOOR_VERBS.includes(verb))
    return refuse(run, "verb", 403, { n, state: "refused", why: "not one of the door's verbs" });
  if (run.stopped !== null) return json(409, { n, state: "stop", why: run.stopped.why });
  if (verb === "quit-app") return quitApp(run, deps, n);
  const own = n === null ? undefined : run.own.get(n);
  if (own === undefined)
    return refuse(run, "device", 403, {
      n,
      state: "refused",
      why: "not one of this run's devices",
    });
  const failed = (what, r) => {
    deps.say(`stage-simulator-fixture: ${what} of <pts3-dev-${n}> failed (exit ${r.code})`);
    return json(502, { n, state: "failed" });
  };
  if (verb === "state") return json(200, { n, state: await stateOf(run, deps, own) });
  if (verb === "boot" || verb === "shutdown") {
    const r = await simctl(run, deps, [verb, own.udid], verb === "boot" ? 120_000 : 60_000);
    const state = await stateOf(run, deps, own);
    // simctl refuses a boot of a booted device (and a shutdown of a shut one): the state is the answer
    const reached = verb === "boot" ? state === "Booted" : state === "Shutdown";
    return r.code === 0 || reached ? json(200, { n, state }) : failed(verb, r);
  }
  if (verb === "openurl") {
    const url = canonicalPage(body.url, run);
    if (url === null)
      return refuse(run, "openurl", 403, {
        n,
        state: "refused",
        why: "openurl reaches only this door's /motion or /still",
      });
    const r = await simctl(run, deps, ["openurl", own.udid, url], 30_000);
    return r.code === 0 ? json(200, { n, state: "opened" }) : failed("openurl", r);
  }
  if (verb === "screenshot") {
    const file = shotPath(body.file, run, deps);
    if (file === null)
      return refuse(run, "screenshot", 403, {
        n,
        state: "refused",
        why: "a screenshot is a new .png in the shot dir",
      });
    const r = await simctl(run, deps, ["io", own.udid, "screenshot", file], 30_000);
    return r.code === 0 ? json(200, { n, state: "written" }) : failed("screenshot", r);
  }
  // show-app: the fence, and no Simulator.app running unless it is proven the run's
  const fence = await fenceAgain(run, deps);
  if (!fence.ok)
    return fence.stop
      ? json(409, { n, state: "stop", why: fence.why })
      : refuse(run, "show-app", 502, { n, state: "refused", why: fence.why });
  const app = await simulatorNow(run, deps);
  if (app.running === null || (app.running > 0 && !app.own))
    return refuse(run, "show-app", 409, {
      n,
      state: "refused",
      why: "a Simulator.app not proven the run's is running",
    });
  // counted before the spawn: an `open` that fails late may still have launched it
  run.simulator.shown += 1;
  launching(run, deps);
  const r = await deps.exec(
    OPEN,
    [
      "-a",
      join(run.devDir, "Applications/Simulator.app"),
      "--args",
      "-CurrentDeviceUDID",
      own.udid,
    ],
    { env: pinned(run, deps), timeoutMs: 10_000 },
  );
  if (r.code !== 0) return failed("show-app", r);
  return json(200, { n, state: "shown" });
}

const rowNameOk = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= ROW_NAME_CHARS &&
  !hasControlCharacters(name);

/** POST /row — a row's HID pair (`begin`, `end`), the run's first input (`input`) and the PRESS GATE (`press`, right
 * before every press of a face's act: the fence, and no Simulator.app running unless proven the run's). */
export async function doorRow(body, run, deps) {
  const name = isRecord(body) ? body.name : undefined;
  const phase = isRecord(body) ? body.phase : undefined;
  if (!rowNameOk(name) || !["begin", "press", "input", "end"].includes(phase))
    return refuse(run, "row", 400, {
      stop: true,
      why: "a row is {name, phase: begin|press|input|end}",
    });
  // a stopped run still takes the open row's END: the HID record keeps its two lines a row
  const endingOpen = phase === "end" && run.open !== null && run.open.name === name;
  if (run.stopped !== null && !endingOpen) return json(409, { stop: true, why: run.stopped.why });
  if (phase === "begin") {
    if (run.open !== null)
      return refuse(run, "row", 409, { stop: true, why: `${run.open.name} never ended` });
    const sample = await deps.probe();
    deps.hid(hidLine(sample));
    deps.say(`PHONE_ROW ${name} BEGIN`);
    const verdict = rowVerdict({ name, sample, last: run.last });
    run.last = sample;
    if (verdict.stop) {
      if (verdict.hand) run.hands += 1;
      stopRun(run, deps, verdict.why);
      return json(409, { stop: true, why: verdict.why });
    }
    run.open = { name, began: sample, pressed: false };
    return json(200, { go: true });
  }
  if (run.open === null || run.open.name !== name)
    return refuse(run, "row", 409, { stop: true, why: `${name} is not the open row` });
  if (phase === "input") {
    // the row the run first injects input in: its END reads RM4.5's own-input case, never a hand
    if (run.firstInput === null) {
      run.firstInput = name;
      deps.say(`PHONE_ROW ${name} INPUT (the run's first)`);
    }
    return json(200, { go: true });
  }
  if (phase === "press") {
    // every refusal here STOPS the console acts: the smoke presses nothing on a stop
    const halt = (status, why) => {
      stopRun(run, deps, `${name}: the press gate: ${why}`);
      return refuse(run, "press", status, { stop: true, why: run.stopped.why });
    };
    const act = body.act;
    if (!GATED_ACTS.includes(act)) return halt(403, `it refuses act ${act}`);
    const own = [...run.own.values()].find((d) => d.name === body.device);
    if (own === undefined) return halt(403, "the phone's device is not one of this run's");
    const fence = await fenceAgain(run, deps);
    if (!fence.ok)
      return run.stopped === null
        ? halt(409, fence.why)
        : json(409, { stop: true, why: fence.why });
    if (act === "attach") {
      // every other device is off (the fence); the one Attach must find is the run's own, Booted
      const now = fence.list.devices.find((d) => d.udid.toUpperCase() === own.udid.toUpperCase());
      if (now?.state !== "Booted")
        return halt(409, `${body.device} reads ${now?.state ?? "absent"}, not Booted`);
      run.open.pressed = true;
      run.firstInput ??= name;
      deps.say(`PHONE_ROW ${name} PRESS attach ${body.device}`);
      return json(200, { go: true });
    }
    const app = await simulatorNow(run, deps);
    if (app.running === null) return halt(409, "pgrep failed");
    if (app.running > 0 && !app.own)
      return halt(409, `a Simulator.app not proven the run's is running (${app.why})`);
    // Show it, Boot and Try again each may launch Simulator.app (the product's `open -a`); Open Settings never does
    if (act !== "open-settings") {
      run.simulator.pressed += 1;
      launching(run, deps);
    }
    run.open.pressed = true;
    run.firstInput ??= name;
    deps.say(`PHONE_ROW ${name} PRESS ${act} ${body.device}`);
    return json(200, { go: true });
  }
  const sample = await deps.probe();
  deps.hid(hidLine(sample, { end: true }));
  deps.say(`PHONE_ROW ${name} END`);
  const verdict = endVerdict({
    name,
    sample,
    began: run.open.began,
    firstInput: run.firstInput === name,
  });
  run.last = sample;
  run.open = null;
  run.served += 1;
  // a row ENDED on a stop is VOID in the run's record: its reads are not judged
  const voided = (why) => {
    run.voids.push({ name, why });
    deps.say(`PHONE_ROW ${name} VOID: ${why}`);
  };
  if (verdict.stop) {
    run.ownInput = true;
    stopRun(run, deps, `${name}: ${verdict.why}`);
    voided(verdict.why);
    return json(409, { stop: true, why: verdict.why });
  }
  if (verdict.void) {
    if (verdict.hand) run.hands += 1;
    voided(verdict.why);
  }
  if (run.stopped !== null) {
    if (!verdict.void) voided(`stopped mid-row: ${run.stopped.why}`);
    return json(409, { stop: true, why: run.stopped.why });
  }
  return json(200, verdict.void ? { go: true, void: verdict.why } : { go: true });
}

/** Every request the door answers. The token first (401 without); then the routes; anything else refused and counted. */
export async function handleDoor(request, run, deps) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const header = request.headers?.["x-phone-token"];
  const given = typeof header === "string" ? header : url.searchParams.get("t");
  if (!tokenOk(given, run.token))
    return refuse(run, "token", 401, { n: null, state: "unauthorized" });
  const method = request.method ?? "GET";
  const route = url.pathname;
  const n = url.searchParams.get("n");
  if (route === "/motion" || route === "/still") {
    if (method !== "GET") return refuse(run, "method", 405, { n: null, state: "refused" });
    if (n === null || !NONCE.test(n))
      return refuse(run, "nonce", 400, { n: null, state: "refused" });
    return { status: 200, type: "html", body: stimulusPage(route.slice(1), n, run.token) };
  }
  if (route === "/loaded" || route === "/input") {
    if (n === null || !NONCE.test(n))
      return refuse(run, "nonce", 400, { n: null, state: "refused" });
    const seen = route === "/loaded" ? run.loaded : run.inputs;
    if (method === "POST") {
      seen.set(n, (seen.get(n) ?? 0) + 1);
      return { status: 204, type: "none", body: null };
    }
    if (method === "GET") return json(200, { n, state: seen.get(n) ?? 0 });
    return refuse(run, "method", 405, { n: null, state: "refused" });
  }
  if (route === "/act" || route === "/row") {
    if (method !== "POST") return refuse(run, "method", 405, { n: null, state: "refused" });
    let body;
    try {
      body = JSON.parse(request.body ?? "");
    } catch {
      return refuse(run, "body", 400, { n: null, state: "refused" });
    }
    return route === "/act" ? doorAct(body, run, deps) : doorRow(body, run, deps);
  }
  return refuse(run, "path", 404, { n: null, state: "refused" });
}

/** What a queued `/act` or `/row` is answered once the door is closing: a stop (both readers end their rows on it). */
const CLOSING = json(409, {
  n: null,
  state: "stop",
  stop: true,
  why: "the door is closing: the run is ending",
});

/** The door's server on loopback, a random port. `/act` and `/row` are answered one at a time, in order. Its `close`
 * resolves only once the act in flight has ENDED (an in-flight `simctl boot`, or show-app's `open -a`, never lands beside
 * teardown), and an act queued behind it is answered a stop, never run. */
export function startDoor(run, deps) {
  let chain = Promise.resolve();
  let closing = false;
  const server = createServer((req, res) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const request = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      const serial = /^\/(act|row)(\?|$)/u.test(req.url ?? "");
      let answer;
      if (over) answer = Promise.resolve(refuse(run, "body", 413, { n: null, state: "refused" }));
      else if (serial) {
        // one at a time, in order — and a request that fails never holds the next one back
        answer = chain.then(() => (closing ? CLOSING : handleDoor(request, run, deps)));
        chain = answer.catch(() => {});
      } else answer = handleDoor(request, run, deps);
      answer.then(
        (a) => {
          res.writeHead(a.status, {
            "cache-control": "no-store",
            ...(a.type === "html"
              ? { "content-type": "text/html; charset=utf-8" }
              : a.type === "json"
                ? { "content-type": "application/json" }
                : {}),
          });
          res.end(a.type === "json" ? JSON.stringify(a.body) : (a.body ?? undefined));
        },
        (error) => {
          deps.say(
            `stage-simulator-fixture: the door failed a request: ${error?.message ?? error}`,
          );
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ n: null, state: "failed" }));
        },
      );
    });
  });
  return new Promise((ready, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      // closed with its sockets (a keep-alive one left by the smoke's fetch never holds teardown), and the act in flight
      // ended — each of its spawns has its own timeout, so the wait is bounded
      const close = async () => {
        closing = true;
        const closed = new Promise((done) => server.close(() => done()));
        server.closeAllConnections();
        await Promise.all([closed, chain]);
      };
      ready({ port, close });
    });
  });
}

// ─── teardown ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What teardown does: Simulator.app quit FIRST, and only when proven the run's with no foreign device booted; each own
 * device shut down; deleted only under the flag (each name checked again right before, by the runner). */
export function teardownPlan({ own, deleteDevices, simulator, fence }) {
  const steps = [];
  if (simulator.running > 0) {
    if (!fence.clear)
      steps.push({
        skip: "quit-app",
        why: "a foreign device is booted: a quit could take it down",
      });
    else if (simulator.own) steps.push({ do: "quit-app" });
    else steps.push({ skip: "quit-app", why: simulator.why });
  }
  for (const device of own) {
    if (device.state === "absent") continue;
    if (device.state !== "Shutdown") steps.push({ do: "shutdown", n: device.n });
    if (deleteDevices) steps.push({ do: "delete", n: device.n });
  }
  return steps;
}

/** The non-own set at ARMED against now: the same UDIDs, each in the same state (counts only, never a UDID). */
export function othersCompare(before, list, own) {
  const now = new Map(
    list.devices
      .filter((d) => !own.has(d.udid.toUpperCase()))
      .map((d) => [d.udid.toUpperCase(), d.state]),
  );
  let changed = 0;
  let gone = 0;
  for (const [udid, state] of before) {
    if (!now.has(udid)) gone += 1;
    else if (now.get(udid) !== state) changed += 1;
  }
  const appeared = [...now.keys()].filter((udid) => !before.has(udid)).length;
  return {
    count: before.size,
    unchanged: changed === 0 && gone === 0 && appeared === 0,
    changed,
    gone,
    appeared,
  };
}

/** Simulator's defaults (`defaults read com.apple.iphonesimulator`) before ARMED against after: compared RAW in memory;
 * the lines that differ said only through `scrub` (redacted, UUID shapes swept) — an OBSERVATION for James, never
 * written back. */
export function defaultsChange(before, after, scrub) {
  if (before === null || after === null || before === after) return { changed: false, lines: [] };
  const was = new Set(String(before).split("\n"));
  const now = new Set(String(after).split("\n"));
  const lines = [
    ...[...was].filter((line) => !now.has(line)).map((line) => `- ${scrub(line)}`),
    ...[...now].filter((line) => !was.has(line)).map((line) => `+ ${scrub(line)}`),
  ];
  return { changed: true, lines: lines.slice(0, 20) };
}

/** HOST-RESTORED, judged: own devices gone (under the flag) or kept shut down; Simulator.app quit where the run launched
 * it; no helper of this lane; others unchanged; the lock given back; no new crash report. */
export function restoredVerdict(r) {
  const why = [];
  if (r.own.form === "deleted" && r.own.left > 0)
    why.push(`${r.own.left} pts3-${r.run}-* device(s) left`);
  if (r.own.form === "kept" && !r.own.shutdown) why.push("an own device is not shut down");
  if (r.simulator.launchedByRun && !["quit", "not-running"].includes(r.simulator.quit))
    why.push(`Simulator.app: ${r.simulator.quit}`);
  if (r.helperLeft !== 0)
    why.push(`${r.helperLeft} live-surface-capture-helper(s) of this lane left`);
  if (r.others !== null && !r.others.unchanged) why.push("another device changed");
  if (r.others === null) why.push("the host's list unreadable at teardown");
  if (r.perfLock === "left") why.push("PERF.lock left held");
  if (r.crash.new.length > 0) why.push(`a new crash report: ${r.crash.new.join(", ")}`);
  return { ok: why.length === 0, why };
}

/** The newest report names in macOS's DiagnosticReports; the names only. */
export function crashReports(dir, fs = { readdirSync, statSync }) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ips") || name.endsWith(".crash"))
      .map((name) => ({ name, at: fs.statSync(join(dir, name)).mtimeMs }));
  } catch {
    return [];
  }
}

/** The pids, cpu and rss of the processes `getAppMetrics` cannot see: the helper, Simulator.app, and each own device's
 * launchd_sim tree — that matched by its device-set path in `commands` (read in memory, never printed). */
export function costRows({ table, commands, helperPath, simExe, own }) {
  const rows = [];
  for (const line of String(table).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
    if (m !== null)
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        cpu: Number(m[3]),
        rss: Number(m[4]),
        comm: m[5],
      });
  }
  const pick = (comm) =>
    rows.filter((r) => r.comm === comm).map(({ pid, cpu, rss }) => ({ pid, cpu, rss }));
  const devices = {};
  for (const { n, udid } of own) {
    const marker = `/devices/${udid.toLowerCase()}/`;
    const roots = new Set();
    for (const line of String(commands).split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/u.exec(line);
      if (m?.[2].toLowerCase().includes(marker)) roots.add(Number(m[1]));
    }
    const tree = new Set(roots);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rows)
        if (!tree.has(r.pid) && tree.has(r.ppid)) {
          tree.add(r.pid);
          grew = true;
        }
    }
    const procs = rows.filter((r) => tree.has(r.pid));
    devices[n] = {
      procs: procs.length,
      cpu: Math.round(procs.reduce((sum, r) => sum + r.cpu, 0) * 10) / 10,
      rss: procs.reduce((sum, r) => sum + r.rss, 0),
    };
  }
  return { helper: pick(helperPath), simulator: pick(simExe), devices };
}

// ─── the impure shell ─────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_OUTPUT_CHARS = 64 * 1024 * 1024;

/** THE exec seam: one fixed binary, never a shell; answers `{code, signal, stdout, stderr, error?}` and never throws. */
export function realExec(file, args, { env = process.env, input, timeoutMs = 30_000 } = {}) {
  return new Promise((done) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    let child;
    try {
      child = spawn(file, args, {
        env,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      settle({ code: null, signal: null, stdout: "", stderr: "", error: String(error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk;
    });
    let kill = null;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(kill);
      settle({ code: null, signal: null, stdout, stderr, error: error.message });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(kill);
      settle({ code, signal, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** How long the command's output is drained after its exit, and how long past the deadline's SIGTERM its group is let be. */
export const DRAIN_MS = 5_000;
export const KILL_AFTER_MS = 60_000;

/**
 * The command, run (the smoke's own `run-smoke.mjs`): its stdout and stderr through `out` and `err` (the redactor's
 * streams). It is SETTLED ON ITS EXIT, never on its pipes' close: a process it started that outlives it keeps its pipes
 * open (an Electron orphaned by a SIGKILL of run-smoke), and that never holds the stage's teardown — the drain after the
 * exit is bounded. It is spawned the leader of its own process group, so past the deadline the SIGKILL reaches every
 * process it started, not run-smoke alone (stdin is not the terminal's: a group of its own never reads it). Answers
 * `{stop(signal), done}`: `done` resolves `{code, deadlineHit}` and never rejects.
 */
export function runCommand({
  command,
  env,
  deadlineMs,
  deps,
  out,
  err,
  drainMs = DRAIN_MS,
  killAfterMs = KILL_AFTER_MS,
}) {
  const child = deps.spawn(command[0], command.slice(1), {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let deadlineHit = false;
  let backstop = null;
  const stop = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => err.push(chunk));
  const closed = new Promise((done) => child.once("close", () => done(true)));
  const deadline = setTimeout(() => {
    deadlineHit = true;
    deps.say(
      `stage-simulator-fixture: past the deadline (${deadlineMs} ms): the command is stopped`,
    );
    stop("SIGTERM");
    backstop = setTimeout(() => {
      if (child.pid !== undefined) deps.killGroup(child.pid, "SIGKILL");
    }, killAfterMs);
    backstop.unref?.();
  }, deadlineMs);
  deadline.unref?.();
  const done = new Promise((settle) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(backstop);
      settle({ code, deadlineHit });
    };
    child.once("error", (error) => {
      deps.say(`stage-simulator-fixture: the command did not start: ${error.message}`);
      finish(2);
    });
    child.once("exit", async (exit, signal) => {
      const code = exit ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0));
      const drained = await Promise.race([closed, deps.sleep(drainMs).then(() => false)]);
      if (!drained)
        deps.say(
          `stage-simulator-fixture: the command exited, but a process it started still holds its output past ${drainMs} ms — not waited for`,
        );
      out.end();
      err.end();
      finish(code);
    });
  });
  return { stop, done };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

const existsLink = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const freeGiB = (path) => {
  try {
    const s = statfsSync(path);
    return Math.floor((s.bavail * s.bsize) / 1024 ** 3);
  } catch {
    return null;
  }
};

const sha256File = (path) => {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
};

/** The host's own deps: the real exec (and the command's own spawn), the clock, the files. `say` writes through the
 * redactor. */
function hostDeps(redactor) {
  const out = redactStream(redactor, "driver", (line) => process.stdout.write(line));
  return {
    exec: realExec,
    spawn,
    env: process.env,
    now: Date.now,
    sleep,
    alive,
    kill: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch {}
    },
    /** a signal to a process group: its leader's pid, negated */
    killGroup: (pid, signal) => {
      try {
        process.kill(-pid, signal);
      } catch {}
    },
    exists: existsLink,
    realpath: (path) => realpathSync(path),
    say: (line) => out.push(`${line}\n`),
    hid: () => {},
    probe: async () => ({ at: Date.now(), locked: "?", idle: null }),
  };
}

/** The two probes of the HID note, read at once: `ioreg -n Root -d1`'s lock, `ioreg -c IOHIDSystem`'s idle. */
export async function probeHid(deps) {
  const at = deps.now();
  const root = await deps.exec(IOREG, ["-n", "Root", "-d1"], { timeoutMs: 10_000 });
  const hid = await deps.exec(IOREG, ["-c", "IOHIDSystem"], { timeoutMs: 10_000 });
  return {
    at,
    locked: root.code === 0 ? parseLocked(root.stdout) : "?",
    idle: hid.code === 0 ? parseIdle(hid.stdout) : null,
  };
}

async function pgrep(deps, name) {
  const r = await deps.exec(PGREP, ["-x", name], { timeoutMs: 10_000 });
  if (r.code === 1) return [];
  if (r.code !== 0) return null;
  return r.stdout.split(/\s+/u).filter(Boolean).map(Number);
}

/** The guard by its intent (§1): `ps -axo pid=,command=` through guard-stop.awk — its count only, the table never said. */
async function guardHits(deps, guardAwk) {
  if (!deps.exists(guardAwk)) return null;
  const table = await deps.exec(PS, ["-axo", "pid=,command="], { timeoutMs: 15_000 });
  if (table.code !== 0) return null;
  const hits = await deps.exec(AWK, ["-f", guardAwk], { input: table.stdout, timeoutMs: 15_000 });
  if (hits.code !== 0) return null;
  return hits.stdout.split("\n").filter((line) => line.trim().length > 0).length;
}

async function ancestry(deps, pid) {
  const chain = [];
  for (let at = pid, i = 0; at > 1 && i < 64; i += 1) {
    const r = await deps.exec(PS, ["-o", "pid=,ppid=,comm=", "-p", String(at)], {
      env: { ...deps.env, LC_ALL: "C" },
      timeoutMs: 5_000,
    });
    const row = r.code === 0 ? parsePsRow(r.stdout.trim()) : null;
    if (row === null) break;
    chain.push(row);
    at = row.ppid;
  }
  return chain;
}

async function readDefaults(deps) {
  const r = await deps.exec(DEFAULTS, ["read", "com.apple.iphonesimulator"], { timeoutMs: 10_000 });
  return r.code === 0 ? r.stdout : `(no defaults: exit ${r.code})`;
}

/** A run's state, held in memory only (its UDIDs among it). */
export function newRun(mode, opts, redactor) {
  return {
    mode,
    runId: opts.run,
    token: randomBytes(32).toString("hex"),
    port: 0,
    origin: "",
    shotDir: opts.shotDir,
    devDir: null,
    runtime: null,
    types: [],
    armedAt: 0,
    own: new Map(),
    othersAtArm: new Map(),
    redactor,
    stopped: null,
    last: null,
    open: null,
    served: 0,
    firstInput: null,
    voids: [],
    hands: 0,
    ownInput: false,
    simulator: { shown: 0, pressed: 0, quits: 0, launchedAt: null },
    refused: {},
    loaded: new Map(),
    inputs: new Map(),
    perfLock: null,
    perfLockPath: null,
  };
}

/** ARM: every gate read, then judged once. Answers the reads the run keeps. */
async function arm(run, deps, { hidWaived, cpuGate, rules }) {
  const hid = await probeHid(deps);
  deps.hid(hidLine(hid));
  deps.say(rulesLine(rules));
  const guard = await guardHits(deps, rules.guardAwk);
  const perfLock = existsLink(rules.perfLock);
  const disks = rules.diskFloors.map((d) => ({ ...d, freeGiB: freeGiB(d.path) }));
  const simulator = await pgrep(deps, "Simulator");
  const xcodebuild = await pgrep(deps, "xcodebuild");
  const simctlPids = await pgrep(deps, "simctl");
  const select = await deps.exec(XCODE_SELECT, ["-p"], {
    env: withoutDeveloperDir(deps.env),
    timeoutMs: 5_000,
  });
  const answer = select.code === 0 ? select.stdout.trim() : `(exit ${select.code})`;
  deps.say(`PHONE_XCODE_SELECT ${answer}`);
  const developerDir = select.code === 0 ? pickDeveloperDir(select.stdout, existsSync) : null;
  let list = null;
  let fence = null;
  let types = null;
  if (developerDir !== null) {
    run.devDir = developerDir.dir;
    list = await readList(run, deps);
    if (list !== null) {
      fence = fenceClear(list);
      let catalog = [];
      try {
        catalog = catalogIds(readFileSync(PATHS.catalog, "utf8"));
      } catch {}
      types = pickOwnTypes(list, catalog);
    }
  }
  const ownLeft =
    list === null ? 0 : list.devices.filter((d) => isOwnName(d.name, run.runId)).length;
  const chain = await ancestry(deps, process.pid);
  const app = responsibleApp(chain);
  deps.say(`RESPONSIBLE (inferred): ${app ?? "none"}; chain ${chainWords(chain)}`);
  let cpuIdle;
  if (cpuGate) {
    const before = cpus();
    await deps.sleep(1_000);
    cpuIdle = cpuIdleBetween(before, cpus());
  }
  const gate = armGate({
    rules,
    hidWaived,
    requireApp: hidWaived,
    hid,
    guard,
    perfLock,
    disks,
    simulator: simulator?.length ?? null,
    xcodebuild: xcodebuild?.length ?? null,
    simctl: simctlPids?.length ?? null,
    developerDir,
    fence,
    types,
    ownLeft,
    app,
    cpuIdle,
  });
  return { gate, hid, developerDir, list, types, app };
}

/** The PERF lock, held as a file naming pts3 (RM1 Q13) — created exclusively; removed only while it is still ours. */
function holdPerfLock(run, deps, path) {
  const text = `pts3 ${run.runId} ${run.mode} ${new Date(deps.now()).toISOString()} pid ${process.pid}\n`;
  try {
    writeFileSync(path, text, { flag: "wx" });
    run.perfLock = text;
    run.perfLockPath = path;
    return true;
  } catch {
    return false;
  }
}

function releasePerfLock(run) {
  if (run.perfLock === null) return "not-held";
  try {
    if (readFileSync(run.perfLockPath, "utf8") !== run.perfLock) return "left";
    unlinkSync(run.perfLockPath);
    return "removed";
  } catch (error) {
    return error?.code === "ENOENT" ? "removed" : "left";
  }
}

async function makeOwnDevices(run, deps) {
  for (const [i, type] of run.types.slice(0, 3).entries()) {
    const n = i + 1;
    const name = ownName(run.runId, n);
    const r = await simctl(run, deps, ["create", name, type, run.runtime], 60_000);
    const udid = r.stdout.trim();
    if (r.code !== 0 || !UDID.test(udid))
      throw new Error(`simctl create ${name} failed (exit ${r.code})`);
    run.redactor.own(udid, n);
    run.own.set(n, { udid, name, type });
    deps.say(`PHONE_DEVICE ${n} ${name} ${type}`);
  }
}

/** TEARDOWN: the plan run, then HOST-RESTORED read and said. Never throws: a throw is said, and the host is not restored. */
async function teardown(run, deps, ctx) {
  try {
    return await restoreHost(run, deps, ctx);
  } catch (error) {
    deps.say(
      `PHONE_HOST_RESTORED ${JSON.stringify({ run: run.runId, mode: run.mode, ok: false, why: [`teardown threw: ${error instanceof Error ? error.message : String(error)}`] })}`,
    );
    return false;
  }
}

/** The plan run against the host now: each own device's name read again right before its step (RM2); HOST-RESTORED
 * said; true when restored. Exported for its units (deps-injected, as `doorAct` is). */
export async function restoreHost(run, deps, ctx) {
  const findings = [];
  let list = run.devDir === null ? null : await readList(run, deps);
  const own = [...run.own.entries()].map(([n, d]) => {
    const device = list?.devices.find((x) => x.udid.toUpperCase() === d.udid.toUpperCase());
    return {
      n,
      state: device === undefined ? (list === null ? "unknown" : "absent") : device.state,
    };
  });
  const app = run.devDir === null ? { running: 0, own: false } : await simulatorSettled(run, deps);
  const fence = list === null ? { clear: false, busy: -1 } : fenceClear(list, ownUdids(run));
  let quit = app.running === 0 ? "not-running" : "stayed";
  for (const step of teardownPlan({
    own,
    deleteDevices: ctx.deleteDevices,
    simulator: app,
    fence,
  })) {
    if (step.skip !== undefined) {
      quit = `refused: ${step.why}`;
      findings.push(`quit-app skipped: ${step.why}`);
      continue;
    }
    if (step.do === "quit-app") {
      const r = await quitAppNow(run, deps);
      quit = r;
      continue;
    }
    const device = run.own.get(step.n);
    // the name checked again, right before (RM2): the UDID held must still be the run's own device
    list = await readList(run, deps);
    const now = list?.devices.find((x) => x.udid.toUpperCase() === device.udid.toUpperCase());
    if (now === undefined) continue;
    if (now.name !== device.name || !isOwnName(now.name, run.runId)) {
      findings.push(
        `${step.do} of <pts3-dev-${step.n}> refused: its name is no longer ${device.name}`,
      );
      continue;
    }
    const r = await simctl(run, deps, [step.do, device.udid], 60_000);
    if (r.code !== 0) findings.push(`${step.do} of ${device.name} failed (exit ${r.code})`);
  }
  list = run.devDir === null ? null : await readList(run, deps);
  const left = list === null ? -1 : list.devices.filter((d) => isOwnName(d.name, run.runId)).length;
  const ownStates = list === null ? [] : list.devices.filter((d) => isOwnName(d.name, run.runId));
  const helpers = await deps.exec(PS, ["-axo", "pid=,comm="], {
    env: { ...deps.env, LC_ALL: "C" },
    timeoutMs: 15_000,
  });
  const helperLeft =
    helpers.code === 0
      ? helpers.stdout
          .split("\n")
          .filter((line) => line.trim().replace(/^\d+\s+/u, "") === PATHS.helper).length
      : -1;
  const defaultsAfter = run.devDir === null ? null : await readDefaults(deps);
  const defaults = defaultsChange(ctx.defaultsBefore, defaultsAfter, run.redactor.scrub);
  if (defaults.changed)
    deps.say(
      `PHONE_OBSERVATION Simulator's defaults changed during the run (never written back): ${JSON.stringify(defaults.lines)}`,
    );
  const reportsAfter = crashReports(ctx.crashDir);
  const known = new Set(ctx.crashBefore.map((r) => r.name));
  const restored = {
    run: run.runId,
    mode: run.mode,
    own: {
      made: run.own.size,
      form: ctx.deleteDevices ? "deleted" : "kept",
      left,
      shutdown: ownStates.every((d) => d.state === "Shutdown"),
    },
    simulator: { launchedByRun: launchesOf(run) > 0, quit },
    helperLeft,
    others: list === null ? null : othersCompare(run.othersAtArm, list, ownUdids(run)),
    defaults: { changed: defaults.changed },
    perfLock: releasePerfLock(run),
    crash: {
      new: reportsAfter.filter((r) => !known.has(r.name) && r.at >= run.armedAt).map((r) => r.name),
    },
    refused: run.refused,
    findings,
  };
  const verdict = restoredVerdict(restored);
  deps.say(
    `PHONE_HOST_RESTORED ${JSON.stringify({ ...restored, ok: verdict.ok, why: verdict.why })}`,
  );
  return verdict.ok;
}

/** Teardown's quit: proven, SIGTERM, ≤ 10 s; the word it ends on. */
async function quitAppNow(run, deps) {
  const proof = await simulatorNow(run, deps);
  if (proof.running === 0) return "not-running";
  if (!proof.own) return `refused: ${proof.why}`;
  deps.kill(proof.pid, "SIGTERM");
  run.simulator.quits += 1;
  if (!(await waitGone(proof.pid, deps, 10_000))) return "outlived SIGTERM by 10 s";
  launchSpent(run);
  return "quit";
}

function say(line) {
  process.stdout.write(`${line}\n`);
}

async function preflightOnly() {
  const files = readFiles();
  const fails = [...nativeFresh(files.native), ...distFresh(files.dist)];
  for (const line of preflightLines(fails)) say(line);
  return fails.length === 0 ? 0 : 1;
}

/** `--sweep <runId>`: exactly `pts3-<runId>-n`, shut down; deleted only under the flag, each name checked right before.
 * The host's deps by default; a unit's injected. */
export async function sweep(
  runId,
  env,
  rules,
  redactor = createRedactor(),
  deps = hostDeps(redactor),
) {
  deps.say(rulesLine(rules));
  const guard = await guardHits(deps, rules.guardAwk);
  if (guard !== 0 || deps.exists(rules.perfLock)) {
    deps.say(`NOT ARMED: ${guard === 0 ? `${rules.perfLock} is held` : "the guard is not clear"}`);
    return NOT_ARMED;
  }
  const select = await deps.exec(XCODE_SELECT, ["-p"], {
    env: withoutDeveloperDir(deps.env),
    timeoutMs: 5_000,
  });
  const dev = select.code === 0 ? pickDeveloperDir(select.stdout, deps.exists) : null;
  if (dev === null) {
    deps.say("PHONE_SWEEP no developer dir holds simctl");
    return 1;
  }
  const run = newRun("sweep", { run: runId, shotDir: null }, redactor);
  run.devDir = dev.dir;
  let list = await readList(run, deps);
  if (list === null) {
    deps.say("PHONE_SWEEP simctl list failed");
    return 1;
  }
  const found = list.devices.filter((d) => isOwnName(d.name, runId));
  for (const d of found) redactor.own(d.udid, d.name.slice(d.name.lastIndexOf("-") + 1));
  const deleteDevices = env.VF_PHONE_DELETE_DEVICES === "1";
  let shut = 0;
  let deleted = 0;
  const failed = [];
  for (const d of found) {
    if (BUSY_STATES.has(d.state)) {
      const r = await simctl(run, deps, ["shutdown", d.udid], 60_000);
      if (r.code === 0) shut += 1;
      else failed.push(`shutdown ${d.name}`);
    }
    if (!deleteDevices) continue;
    list = await readList(run, deps);
    const now = list?.devices.find((x) => x.udid === d.udid);
    if (now === undefined || now.name !== d.name || !isOwnName(now.name, runId)) continue;
    const r = await simctl(run, deps, ["delete", d.udid], 60_000);
    if (r.code === 0) deleted += 1;
    else failed.push(`delete ${d.name}`);
  }
  deps.say(
    `PHONE_SWEEP ${JSON.stringify({ run: runId, found: found.length, shutdown: shut, deleted, kept: deleteDevices ? found.length - deleted : found.length, names: found.map((d) => d.name), failed })}`,
  );
  return failed.length === 0 ? 0 : 1;
}

/** One launch — enum, none, devices or cost. */
async function launch(mode, command, opts) {
  const redactor = createRedactor();
  const deps = hostDeps(redactor);
  const run = newRun(mode, opts, redactor);
  mkdirSync(dirname(opts.hidLog), { recursive: true });
  deps.hid = (line) => appendFileSync(opts.hidLog, `${line}\n`);
  deps.probe = () => probeHid(deps);

  let running = null;
  let signalled = null;
  let deadlineHit = false;
  let stopTimer = null;
  // the stage's own stops (the deadline, a stopped run) end the command without posing as a signal the stage was sent
  const stopChild = (signal) => running?.stop(signal);
  // a signal is forwarded (as run-smoke does); the stage awaits the command, tears down, and exits 128+n
  const forward = (signal) => {
    signalled ??= signal;
    stopChild(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => forward(signal));
  deps.onStop = () => {
    // the smoke ends its rows on a stop; past two minutes it is stopped
    stopTimer = setTimeout(() => stopChild("SIGTERM"), 120_000);
    stopTimer.unref();
  };

  // the preflight, first: the files (no simctl) — ENUM needs the native pair alone
  const files = readFiles();
  const fails =
    mode === "enum"
      ? nativeFresh(files.native)
      : [...nativeFresh(files.native), ...distFresh(files.dist)];
  let record = null;
  try {
    record = JSON.parse(readFileSync(opts.enumRecord, "utf8"));
  } catch {}
  const helperSha = sha256File(PATHS.helper);
  if (mode !== "enum")
    fails.push(
      ...launchChecks({
        shotDir: opts.shotDir,
        helperSha,
        enumSha: typeof record?.sha256 === "string" ? record.sha256 : null,
      }),
    );
  if (fails.length > 0) {
    for (const line of preflightLines(fails)) deps.say(line);
    return 1;
  }

  const crashDir = join(homedir(), "Library/Logs/DiagnosticReports");
  const crashBefore = crashReports(crashDir);
  const armed = await arm(run, deps, {
    hidWaived: mode === "enum",
    cpuGate: mode === "cost",
    rules: opts.rules,
  });
  const holdsLock = mode === "devices" || mode === "cost";
  if (armed.gate.armed && holdsLock && !holdPerfLock(run, deps, opts.rules.perfLock))
    armed.gate.why.push(`${opts.rules.perfLock} could not be held`);
  if (!armed.gate.armed || armed.gate.why.length > 0 || signalled !== null) {
    deps.say(
      `NOT ARMED: ${[...armed.gate.why, ...(signalled ? [`a ${signalled}`] : [])].join("; ")}`,
    );
    releasePerfLock(run);
    return signalled === null ? NOT_ARMED : 128 + constants.signals[signalled];
  }
  const defaultsBefore = await readDefaults(deps);
  run.armedAt = deps.now();
  run.last = armed.hid;
  run.devDir = armed.developerDir.dir;
  run.runtime = armed.types.runtime;
  run.types = armed.types.types;
  for (const d of armed.list.devices) run.othersAtArm.set(d.udid.toUpperCase(), d.state);
  const newestCrash = crashBefore.reduce((a, b) => (a === null || b.at > a.at ? b : a), null);
  deps.say(`PHONE_CRASH_BEFORE ${newestCrash === null ? "none" : newestCrash.name}`);
  deps.say(
    `ARMED ${new Date(run.armedAt).toISOString()}: ${mode} run ${run.runId}; HID idle ${armed.hid.idle}s, locked ${armed.hid.locked}${mode === "enum" ? " (the gate waived: James is at the screen)" : ""}; developer dir ${run.devDir} (${armed.developerDir.by}); runtime ${run.runtime}; types ${run.types.slice(0, 3).join(" ")} | ${run.types[3]}${holdsLock ? `; holds ${opts.rules.perfLock}` : ""}`,
  );
  deps.exec(CAFFEINATE, ["-d", "-i", "-w", String(process.pid)], {
    timeoutMs: opts.deadlineMs + 3_600_000,
  });

  let code = 0;
  let restored = true;
  let door = null;
  try {
    if (mode === "enum") code = await enumerate(deps, opts, helperSha, armed.app);
    else {
      if (mode !== "none") await makeOwnDevices(run, deps);
      door = await startDoor(run, deps);
      run.port = door.port;
      run.origin = `http://127.0.0.1:${door.port}`;
      mkdirSync(opts.shotDir, { recursive: true });
      const env = commandEnv(mode, deps.env, {
        origin: run.origin,
        token: run.token,
        runtime: run.runtime,
        types: run.types,
        shotDir: opts.shotDir,
        devDirBy: armed.developerDir.by,
      });
      deps.say(
        `PHONE_COMMAND_ENV ${JSON.stringify({ DEVELOPER_DIR: env.DEVELOPER_DIR === undefined ? "absent" : "SET", VF_SMOKE_SIMCTL_DEVELOPER_DIR: env.VF_SMOKE_SIMCTL_DEVELOPER_DIR ?? "absent", VF_PHONE_MODE: mode, VF_PHONE_RUNTIME: run.runtime, VF_PHONE_DEVICES: env.VF_PHONE_DEVICES, VF_PHONE_DEVDIR_BY: env.VF_PHONE_DEVDIR_BY, VF_SMOKE_SHOT_DIR: env.VF_SMOKE_SHOT_DIR })}`,
      );
      // the preflight again, right before the command
      const again = readFiles();
      const late = [
        ...nativeFresh(again.native),
        ...distFresh(again.dist),
        ...launchChecks({
          shotDir: env.VF_SMOKE_SHOT_DIR,
          helperSha: sha256File(PATHS.helper),
          enumSha: record.sha256,
          app: armed.app,
          enumApp: typeof record.responsible === "string" ? record.responsible : null,
        }),
      ];
      if (late.length > 0) {
        for (const line of preflightLines(late)) deps.say(line);
        code = 1;
      } else if (signalled === null) {
        const marks = { begin: null, end: null };
        const watch = (line) => {
          const mark = rowsMark(line);
          if (mark?.begin !== undefined) marks.begin = mark.begin;
          if (mark?.end !== undefined) marks.end = mark.end;
        };
        const out = redactStream(redactor, "main", (line) => {
          watch(line);
          process.stdout.write(line);
        });
        const err = redactStream(redactor, "main", (line) => process.stderr.write(line));
        running = runCommand({ command, env, deadlineMs: opts.deadlineMs, deps, out, err });
        let sampler = null;
        if (mode === "cost") sampler = startCostSampler(run, deps);
        const exited = await running.done;
        if (sampler !== null) clearInterval(sampler);
        code = exited.code;
        deadlineHit = exited.deadlineHit;
        const rows = rowsVerdict({ mode, begin: marks.begin, end: marks.end, served: run.served });
        deps.say(`PHONE_ROWS ${JSON.stringify({ ...rows, voids: run.voids })}`);
        if (code === 0 && !rows.ok) code = 1;
      }
    }
  } catch (error) {
    deps.say(`stage-simulator-fixture: ${error instanceof Error ? error.message : String(error)}`);
    code = code === 0 ? 1 : code;
  } finally {
    clearTimeout(stopTimer);
    if (door !== null) await door.close();
    restored = await teardown(run, deps, {
      deleteDevices: opts.deleteDevices,
      defaultsBefore,
      crashDir,
      crashBefore,
    });
    const end = await probeHid(deps);
    deps.hid(hidLine(end, { end: true }));
    deps.say(
      hidSummary({
        armed: armed.hid,
        end,
        armedAt: run.armedAt,
        hands: run.hands,
        ownInput: run.ownInput,
      }),
    );
    deps.say(`PHONE_REDACTED ${JSON.stringify(redactor.counts())}`);
  }
  const exit = launchExit({
    signal: signalled === null ? null : constants.signals[signalled],
    stopped: run.stopped !== null,
    deadlineHit,
    code,
    restored,
  });
  if (exit.line !== null) deps.say(exit.line);
  return exit.code;
}

/** A launch's exit: 128+n on a signal; a STOP is 75 — "NOT ARMED: relaunch later" (§6.3) — only over a restored host;
 * a STOP that left it unrestored (an own device booted, Simulator.app refused) is 1 and PHONE_STOP_UNRESTORED, so no
 * caller relaunches over it; past the deadline 1; else the command's code, 1 for its 0 over an unrestored host. */
export function launchExit({ signal, stopped, deadlineHit, code, restored }) {
  if (signal !== null) return { code: 128 + signal, line: null };
  if (stopped)
    return restored
      ? { code: NOT_ARMED, line: null }
      : {
          code: 1,
          line: "PHONE_STOP_UNRESTORED the run stopped and its teardown left the host unrestored (PHONE_HOST_RESTORED): restore it by hand before any relaunch",
        };
  if (deadlineHit) return { code: 1, line: null };
  return { code: code === 0 && !restored ? 1 : code, line: null };
}

function startCostSampler(run, deps) {
  let busy = false;
  const helperPath = PATHS.helper;
  const simExe = simulatorExe(run.devDir);
  const own = [...run.own.entries()].map(([n, d]) => ({ n, udid: d.udid }));
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const c = { env: { ...deps.env, LC_ALL: "C" }, timeoutMs: 15_000 };
      const table = await deps.exec(PS, ["-axo", "pid=,ppid=,%cpu=,rss=,comm="], c);
      // the device-set path is matched in memory; the print is pid, ppid, %cpu, rss and comm alone
      const commands = await deps.exec(PS, ["-axo", "pid=,command="], c);
      deps.say(
        `PHONE_COST_SAMPLE ${JSON.stringify({ at: new Date(deps.now()).toISOString(), ...costRows({ table: table.stdout, commands: commands.stdout, helperPath, simExe, own }) })}`,
      );
    } finally {
      busy = false;
    }
  }, 4_000);
}

/** ENUM (L0): may the launching app enumerate? `verify-live-surface-capture.mjs --enumerate-only`, the chain and the
 * helper's sha256 recorded for the launches. */
async function enumerate(deps, opts, helperSha, app) {
  const r = await deps.exec(
    process.execPath,
    [PATHS.verifyCapture, "--enumerate-only", "--native-root", PATHS.nativeRoot],
    { timeoutMs: 120_000 },
  );
  for (const line of `${r.stdout}${r.stderr}`.split("\n"))
    if (line.trim().length > 0) deps.say(line);
  const verdict = enumVerdict(r);
  deps.say(
    `PHONE_ENUM ${JSON.stringify({ ...verdict, helperSha256: helperSha, responsible: app })}`,
  );
  if (verdict.permissionDenied)
    deps.say(
      `stage-simulator-fixture: Screen Recording is denied — grant ${app} under System Settings › Privacy & Security › Screen Recording (quit and reopen it), then run ENUM again`,
    );
  if (!verdict.ok) return 1;
  writeFileSync(
    opts.enumRecord,
    `${JSON.stringify({ sha256: helperSha, sourceCount: verdict.sourceCount, responsible: app, at: new Date(deps.now()).toISOString() }, null, 2)}\n`,
  );
  return 0;
}

/** ENUM's verdict from the probe's own words: `{"ok":true,"handshake":true,"sourceCount":N}`, N > 0. */
export function enumVerdict({ code, stdout, stderr }) {
  const lines = `${stdout ?? ""}\n${stderr ?? ""}`
    .split("\n")
    .filter((l) => l.trim().startsWith("{"));
  let said = null;
  for (const line of lines) {
    try {
      said = JSON.parse(line);
    } catch {}
  }
  if (code === 0 && said?.ok === true && said.handshake === true && said.sourceCount > 0)
    return { ok: true, sourceCount: said.sourceCount, permissionDenied: false };
  const error = typeof said?.error === "string" ? said.error : `exit ${code}`;
  return { ok: false, why: error, permissionDenied: /permission-denied/u.test(error) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error !== undefined) {
    process.stderr.write(`${args.error}\n`);
    return 2;
  }
  if (args.mode === "preflight") return preflightOnly();
  if (args.mode === "sweep") {
    // the sweep takes its run id as its argument; of the ENV options only the delete flag and the house rules
    const rules = houseRules(process.env);
    const flag = readOptions(process.env).errors.filter((e) =>
      e.startsWith("VF_PHONE_DELETE_DEVICES"),
    );
    const wrong = [...flag, ...rules.errors];
    if (wrong.length > 0) {
      process.stderr.write(`${wrong.join("\n")}\n`);
      return 2;
    }
    return sweep(args.runId, process.env, rules);
  }
  const opts = readOptions(process.env);
  if (opts.errors.length > 0) {
    process.stderr.write(`${opts.errors.join("\n")}\n`);
    return 2;
  }
  return launch(args.mode, args.command ?? [], opts);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(
        `stage-simulator-fixture: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(2);
    },
  );
