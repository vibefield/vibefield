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
//   VF_PHONE_HID_LOG           `<logs>/<run>/<run>-hid.log`: the HID record; `shots/` is made beside it, and
//                              `<run>-stage.log` (the run's STOP, HOST_RESTORED, HOST_UNPROVEN and HID lines,
//                              mirrored: they outlive an output whose reader went away); ENUM's record
//                              (`phone-enum.json`) lives in `<logs>`, where every launch reads it
//   VF_PHONE_DEADLINE_MS       past it the command is stopped and the host restored (default 30 min, at most 6 h)
//   VF_PHONE_DELETE_DEVICES=1  teardown (and --sweep) DELETES the run's own devices; unset, they are KEPT, shut down and
//                              named (P5's default; the console runs set it on James's word, brief §13 RM2)
//   VF_PHONE_GUARD_AWK, VF_PHONE_PERF_LOCK, VF_PHONE_DISK_FLOORS (`<path>:<GiB>[,…]`)
//                              another host's house rules (the mini's); unset, this Mac's. PHONE_HOUSE_RULES says which
// Exit: the command's own code; 1 for a red preflight, rows record or restore; 2 for a usage error (a reused run id among
// them: `<logs>/<run>/` already holding a file, T7); 75 NOT ARMED or
// STOPPED (a hand, a locked console, a foreign device booted mid-run, a Simulator.app not proven the run's) over a
// restored host — a DETERMINISTIC stop (RM4.5's own-input reset; the press gate refusing an act or a device not the
// run's) is 1 and PHONE_STOP_FINAL, and a STOP whose teardown left the host unrestored is 1 and PHONE_STOP_UNRESTORED;
// 128+n on a signal. "Restored" is the run's OWN side: another's change (a device booted, an app it started) keeps
// PHONE_HOST_RESTORED red and is said as a PHONE_OBSERVATION, never judged as the run's — and no exit is 0 while
// HOST_RESTORED is red: a run that did not stop, whose command said 0 over a restored own side, is 75 and
// PHONE_HOST_UNPROVEN on another's change (RM7.1: relaunch on a quiet host).
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
//                                                once the run is stopped. T1: a device simctl lists Booted reads
//                                                `Booting` until `simctl bootstatus` proves iOS ready (BOOT_READY_MS);
//                                                boot, openurl and screenshot wait for it, bounded; a `failed` carries
//                                                `why` (H3: simctl's stderr, redacted, 300 chars)
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
// Lines a reader greps: PHONE_PREFLIGHT, PHONE_HOUSE_RULES, NOT ARMED, ARMED, PHONE_STOP_FINAL, PHONE_STOP_UNRESTORED, PHONE_CRASH_BEFORE, PHONE_XCODE_SELECT, PHONE_DEVICE,
// PHONE_COMMAND_ENV, PHONE_ROW, PHONE_STOP, PHONE_ROWS, PHONE_COST_SAMPLE, PHONE_ENUM, RESPONSIBLE, HID:, PHONE_REDACTED,
// PHONE_OBSERVATION, PHONE_HOST_RESTORED, PHONE_HOST_UNPROVEN, PHONE_SWEEP. Every line — the command's stdout and stderr, and the stage's own —
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
  fieldNativeSources: [
    join(ROOT, "packages/field-native/src"),
    join(ROOT, "packages/field-native/Cargo.toml"),
    join(ROOT, "Cargo.toml"),
    join(ROOT, "Cargo.lock"),
  ],
  catalog: join(ROOT, "plugins/simulator/src/catalog.gen.ts"),
  verifyCapture: join(ROOT, "apps/desktop/packaging/verify-live-surface-capture.mjs"),
};

/** The field-native the smoke's shell launches, as the shell resolves it (electron-shell main/fieldd.ts, resources.ts):
 * FIELDD_NATIVE_BIN when set, else this checkout's cargo debug build. */
export const fieldNativePath = (env) =>
  env.FIELDD_NATIVE_BIN ?? join(ROOT, "target/debug/field-native");

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
    // S-2: the run's STOP, HOST_RESTORED, HOST_UNPROVEN and HID lines, mirrored (`MIRRORED`) — kept if the output goes away
    stageLog: runDir === null || !runIdOk(run) ? null : join(runDir, `${run}-stage.log`),
    errors,
  };
}

/** T7: a run id is ONE launch's. Its folder (`dirname(VF_PHONE_HID_LOG)`, `<logs>/<run>/`) already there and holding
 * anything is a reused id: two launches as one run append into one HID and stage log and one `tee` loses the first's
 * stdout. Answers the refusal's line, or null for a new run (the folder absent, or empty). Read before ANYTHING is
 * written; `--sweep` and `--preflight-only` never ask. */
export function reusedRun(opts, fs = { readdirSync }) {
  const dir = dirname(opts.hidLog);
  // G9: the folder must BE the run's — another run's folder (or none) would mix two runs' logs whatever it holds
  if (basename(dir) !== opts.run)
    return `stage-simulator-fixture: run ${opts.run}: ${dir} is not the run's folder (<logs>/${opts.run}/) — choose a new VF_PHONE_RUN and its VF_PHONE_HID_LOG (<logs>/<run>/<run>-hid.log)`;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    entries = null;
  }
  if (entries !== null && entries.length === 0) return null;
  return `stage-simulator-fixture: run ${opts.run} was launched before — ${dir} ${entries === null ? "is not a readable folder" : `already holds ${entries.length} file(s)`}: choose a new VF_PHONE_RUN (and its VF_PHONE_HID_LOG)`;
}

/** The type list the smoke is handed:`n:<type>` (n 1..3 the run's devices, 4 the no-device type); `none` mode's one
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
// the root has no `build:all`; the desktop's is the one smoke:canvas runs. Past nx's cache: a build nx serves from its
// local cache leaves the outputs' mtimes as they were, and `gen` (or a checkout) moves a source's mtime with its bytes
// unchanged — a plain build:all would never clear an "older than"
const BUILD_FIX = "pnpm --filter @vibefield/desktop build:all --skip-nx-cache";

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

// item 133: a smoke has no dev runner to build or start field-native, and the desktop's build:all never builds it (its
// project has no targets) — a code-only lane launched without one to a certain fatal. Cargo builds into
// CARGO_TARGET_DIR, which the shell reads only through this checkout's target/ (or FIELDD_NATIVE_BIN), and a target
// dir shared between checkouts holds whichever checkout built last: an mtime proves only this checkout's sources
const FIELD_NATIVE_FIX =
  "cargo build -p field-native from this checkout (it lands in CARGO_TARGET_DIR: this checkout's target/ must link " +
  "there, or FIELDD_NATIVE_BIN name the binary; a target dir shared between checkouts holds whichever built last)";

/** Item 133: the field-native the smoke's shell will launch, there and no older than this checkout's crate sources. */
export function fieldNativeFresh({ path, bin, sources }) {
  const what = `field-native (${path})`;
  if (bin === null) return [{ what, why: "missing", fix: FIELD_NATIVE_FIX }];
  if (bin < sources)
    return [
      {
        what,
        why: "older than packages/field-native's src/ or Cargo.toml, or the workspace's Cargo.toml or Cargo.lock",
        fix: FIELD_NATIVE_FIX,
      },
    ];
  return [];
}

/** Inside a launch, before the arm and again right before the command: the shot dir set, the helper ENUM proved; and
 * right after the arm has inferred it (`app` given), before any lock or device (RM6 S-5) — the responsible app ENUM
 * proved (§6: "ENUM by the same app as L1 and L2"; TCC follows the responsible process, so another app's first
 * ScreenCaptureKit call could raise a prompt on an unattended screen). */
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

/** The files, read: what `nativeFresh`, `distFresh` and `fieldNativeFresh` judge. Reads only — never a simctl. */
export function readFiles(fs = { statSync, readdirSync, readFileSync }, env = process.env) {
  const fieldNative = fieldNativePath(env);
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
    fieldNative: {
      path: fieldNative,
      bin: newestMtime(fieldNative, fs),
      sources: newestOf(PATHS.fieldNativeSources, fs),
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

/** The HID record's writer, GUARDED AT ITS DEFINITION (RM7.2): each line appended to the run's HID log (`path`). An
 * append that fails (a full disk, its folder gone) never throws — at a row's begin or end that throw failed the door's
 * request mid-row (the row never opened, or never closed), and in launch's finally it skipped the HID summary and the
 * exit — and is said ONCE through `say` (the stage's own: redacted, and, as a `HID: ` line, mirrored into
 * `<run>-stage.log`) as the record incomplete. Later lines are still tried; the run's rows and exit are unchanged. */
export function hidRecord(path, say, append = appendFileSync) {
  let said = false;
  return (line) => {
    try {
      append(path, `${line}\n`);
    } catch (error) {
      if (said) return;
      said = true;
      const why = error?.code ?? (error instanceof Error ? error.message : String(error));
      try {
        say(
          `HID: the record is incomplete: ${path} could not take a line (${why}) — the run goes on and its exit is unchanged; later lines are still tried, and this is said once`,
        );
      } catch {}
    }
  };
}

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
          // the device's boot (T1): a new one is a new readiness to prove
          lastBootedAt: typeof d.lastBootedAt === "string" ? d.lastBootedAt : null,
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

/** A `SMOKE_HOME {…}` line's home (the data root a red smoke keeps and names, DK-18), or null. */
export function smokeHomeOf(line) {
  const at = line.indexOf("SMOKE_HOME {");
  if (at === -1) return null;
  try {
    const { home } = JSON.parse(line.slice(at + "SMOKE_HOME ".length));
    return typeof home === "string" && home.length > 0 ? home : null;
  } catch {
    return null;
  }
}

const oneLine = (text) =>
  String(text)
    .replace(/\s*\n\s*/gu, " ")
    .trim()
    .slice(0, 400);

/** The last record of `event` in an NDJSON log, as its error's words (or its msg), or null. */
function lastWords(path, event, fs) {
  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let words = null;
  for (const line of text.split("\n")) {
    try {
      const record = JSON.parse(line);
      if (record?.event === event) words = oneLine(record.err?.message ?? record.msg ?? event);
    } catch {}
  }
  return words;
}

/** Item 134: why a smoke that never said BEGIN stopped, from the HOME it kept — the desktop's
 * `desktop.lifecycle.fatal`, and each user's fieldd `fieldd.lifecycle.bootstrap_failed` when it says more — or null. */
export function fatalWords(home, fs = { readFileSync, readdirSync }) {
  const said = [];
  const desktop = lastWords(
    join(home, "logs/system/desktop.ndjson"),
    "desktop.lifecycle.fatal",
    fs,
  );
  if (desktop !== null) said.push(`desktop.lifecycle.fatal: ${desktop}`);
  let users = [];
  try {
    users = fs.readdirSync(join(home, "logs/users"));
  } catch {}
  for (const user of users) {
    const fieldd = lastWords(
      join(home, "logs/users", user, "system/fieldd.ndjson"),
      "fieldd.lifecycle.bootstrap_failed",
      fs,
    );
    if (fieldd !== null && !(desktop ?? "").includes(fieldd))
      said.push(`fieldd.lifecycle.bootstrap_failed: ${fieldd}`);
  }
  return said.length === 0 ? null : said.join(" · ");
}

/** Red when the smoke never said BEGIN or END, said another mode, or its count is not the rows the door saw open and
 * close, or not the mode's count. No BEGIN says why from the smoke's kept HOME when it named one (`fatal`, item 134),
 * else that it never reached the rows — never "not in this build": the preflight proved the bundle carries --phone. */
export function rowsVerdict({ mode, begin, end, served, fatal = null }) {
  if (begin === null)
    return {
      ok: false,
      why:
        fatal === null
          ? "no PHONE_ROWS_BEGIN: the smoke never reached the rows"
          : `no PHONE_ROWS_BEGIN: the smoke stopped before the rows — ${fatal}`,
    };
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
  // the three below PROVE it another's (`foreign`): the one Simulator running, and not the run's — so the run's own is
  // not running. Two Simulators, another executable or an unreadable start prove nothing: the run's may be among them
  if (started < armedAt)
    return { running: 1, own: false, foreign: true, why: "it started before ARMED" };
  if (launchedAt === null || launchedAt === undefined)
    return {
      running: 1,
      own: false,
      foreign: true,
      why: "the run launched no Simulator.app since its last quit",
    };
  if (started < launchedAt - 1_000)
    return { running: 1, own: false, foreign: true, why: "it started before the run's launch" };
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

/** STOP the console acts: every later act and row is answered `stop`; the command is given time to end its rows. `final`
 * marks a DETERMINISTIC stop — one a relaunch would only repeat (RM4.5's own-input reset; the press gate refusing an act
 * outside the gated set or a device not the run's): it exits 1 with PHONE_STOP_FINAL, never 75 (RM6 S-3). */
export function stopRun(run, deps, why, { final = false } = {}) {
  if (run.stopped !== null) return;
  run.stopped = { why, final };
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

/** An own device now: its state, as a word from simctl's own set (never its JSON), and its boot (`lastBootedAt`). */
async function deviceNow(run, deps, own) {
  const list = await readList(run, deps);
  if (list === null) return { state: "unknown", boot: null };
  const device = list.devices.find((d) => d.udid.toUpperCase() === own.udid.toUpperCase());
  if (device === undefined) return { state: "absent", boot: null };
  return {
    state: DEVICE_STATES.has(device.state) ? device.state : "unknown",
    boot: device.lastBootedAt ?? null,
  };
}

/** H3: what a failed simctl (or open) said — its stderr (and a spawn error), REDACTED FIRST (no UDID is cut into a
 * fragment the redactor cannot see), one line, its first 300 chars. */
export const STDERR_CHARS = 300;
export function stderrOf(run, r) {
  return run.redactor
    .scrub(`${r?.stderr ?? ""} ${r?.error ?? ""}`)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, STDERR_CHARS);
}

/** T1: "Booted" is simctl's list word, not iOS ready — a fresh device answers `openurl` and `io screenshot` with exit 60
 * and 1 for minutes after it (out:46-86). Readiness is `simctl bootstatus <udid>` (never `-b`: the stage never boots by
 * this path), bounded by BOOT_READY_MS and asked ONCE per device per boot: cached against the UDID and its
 * `lastBootedAt`, dropped when the device is seen not Booted. It holds whoever booted it (the stage, or the product's
 * Boot in SIM-OFF-BOOT). */
export const BOOT_READY_MS = 180_000;
/** G5: no door verb outlives the smoke's door timeouts (150 s for `boot`, 60 s else). `boot` — its list reads, simctl
 * boot and the readiness wait — ends inside BOOT_BUDGET_MS; `openurl` and `screenshot` inside VERB_BUDGET_MS, their
 * simctl given `min(VERB_RUN_MS, what is left)` and never run on under MIN_VERB_MS (answered `failed`, not ready). */
export const BOOT_BUDGET_MS = 145_000;
export const VERB_BUDGET_MS = 55_000;
export const VERB_RUN_MS = 30_000;
export const MIN_VERB_MS = 5_000;
/** The longest a device verb waits for readiness (inside its budget, MIN_VERB_MS kept for the verb). */
export const READY_VERB_WAIT_MS = 45_000;

/** An own device's readiness, now (`waitMs` 0) or waited for up to `waitMs`: `{state}` — `Booted` (iOS ready), `Booting`
 * (not yet), simctl's word for a device neither Booted nor Booting (nothing to prove), or `failed` with `why` (past
 * BOOT_READY_MS, or bootstatus said no). */
async function readiness(run, deps, own, now, waitMs) {
  const key = own.udid.toUpperCase();
  if (now.state !== "Booted" && now.state !== "Booting") {
    run.ready.delete(key);
    return { state: now.state };
  }
  let ask = run.ready.get(key);
  if (ask === undefined || ask.boot !== now.boot) {
    const n = [...run.own.entries()].find(([, d]) => d === own)?.[0];
    const asked = { boot: now.boot, at: deps.now(), done: null, said: false, n };
    asked.promise = simctl(run, deps, ["bootstatus", own.udid], BOOT_READY_MS).then(
      (r) => {
        asked.done = { ok: r.code === 0, r, ms: deps.now() - asked.at };
      },
      (error) => {
        asked.done = {
          ok: false,
          r: { code: null, error: String(error) },
          ms: deps.now() - asked.at,
        };
      },
    );
    run.ready.set(key, asked);
    ask = asked;
  }
  if (ask.done === null && waitMs > 0) {
    const left = Math.min(waitMs, BOOT_READY_MS - (deps.now() - ask.at));
    if (left > 0) await Promise.race([ask.promise, deps.sleep(left)]);
  }
  if (ask.done?.ok === true) return { state: "Booted" };
  const ms = ask.done?.ms ?? deps.now() - ask.at;
  if (ask.done === null && ms < BOOT_READY_MS) return { state: "Booting", ms };
  const detail = ask.done === null ? "" : stderrOf(run, ask.done.r);
  const exit =
    ask.done === null
      ? ""
      : ` (bootstatus exit ${ask.done.r.code}${detail === "" ? "" : `: ${detail}`})`;
  const why = `not ready after ${ms} ms${exit}`;
  if (!ask.said) {
    ask.said = true;
    deps.say(`stage-simulator-fixture: <pts3-dev-${ask.n}> ${why}`);
  }
  return { state: "failed", why };
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
  // H3: a failure says what simctl (or open) said — redacted, one line, 300 chars — in the line and the response
  const failed = (what, r) => {
    const said = stderrOf(run, r);
    deps.say(
      `stage-simulator-fixture: ${what} of <pts3-dev-${n}> failed (exit ${r.code})${said === "" ? "" : `: ${said}`}`,
    );
    return json(502, {
      n,
      state: "failed",
      why: `${what} exit ${r.code}${said === "" ? "" : `: ${said}`}`,
    });
  };
  // T1: a device iOS has not finished booting is Booting at the door, and its verbs wait (bounded) or run nothing
  const notReady = (gate) =>
    json(502, {
      n,
      state: "failed",
      why:
        gate.state === "failed"
          ? gate.why
          : `not ready yet (${gate.ms} ms of BOOT_READY_MS ${BOOT_READY_MS}): its verb not run`,
    });
  const readyFor = async (waitMs) =>
    readiness(run, deps, own, await deviceNow(run, deps, own), waitMs);
  // G5: the request's own clock — every wait and every verb's timeout inside its budget
  const t0 = deps.now();
  const left = (budget) => budget - (deps.now() - t0);
  const short = (budget) =>
    json(502, {
      n,
      state: "failed",
      why: `not ready: ${Math.max(0, left(budget))} ms of the door's ${budget} ms left, under ${MIN_VERB_MS}: its verb not run`,
    });
  /** openurl and screenshot: readiness, then simctl on what is left of VERB_BUDGET_MS. */
  const deviceVerb = async (what, args, word) => {
    const gate = await readyFor(
      Math.max(0, Math.min(READY_VERB_WAIT_MS, left(VERB_BUDGET_MS) - MIN_VERB_MS)),
    );
    if (gate.state === "Booting" || gate.state === "failed") return notReady(gate);
    const runFor = Math.min(VERB_RUN_MS, left(VERB_BUDGET_MS));
    if (runFor < MIN_VERB_MS) return short(VERB_BUDGET_MS);
    const r = await simctl(run, deps, args, runFor);
    return r.code === 0 ? json(200, { n, state: word }) : failed(what, r);
  };
  if (verb === "state") {
    const gate = await readyFor(0);
    return gate.state === "failed" ? notReady(gate) : json(200, { n, state: gate.state });
  }
  if (verb === "boot" || verb === "shutdown") {
    if (verb === "shutdown") run.ready.delete(own.udid.toUpperCase());
    const up = (state) => state === "Booted" || state === "Booting";
    // R2-A: a device simctl already lists Booted (the product's face booted it) or Booting is never booted again — boot
    // only waits for its readiness
    const was = verb === "boot" ? await deviceNow(run, deps, own) : null;
    if (was !== null && !up(was.state) && left(BOOT_BUDGET_MS) < MIN_VERB_MS)
      return short(BOOT_BUDGET_MS);
    const r =
      was !== null && up(was.state)
        ? null
        : await simctl(
            run,
            deps,
            [verb, own.udid],
            verb === "boot" ? Math.min(120_000, left(BOOT_BUDGET_MS)) : 60_000,
          );
    const now = r === null ? was : await deviceNow(run, deps, own);
    // simctl refuses a boot of a booted device (and a shutdown of a shut one): the state is the answer
    if (verb === "boot" && up(now.state)) {
      // boot's answer is taken ONCE (the smoke's ensure()): readiness waited for inside its door timeout
      const gate = await readiness(run, deps, own, now, Math.max(0, left(BOOT_BUDGET_MS)));
      return gate.state === "failed" ? notReady(gate) : json(200, { n, state: gate.state });
    }
    const reached = verb === "boot" ? now.state === "Booted" : now.state === "Shutdown";
    return r.code === 0 || reached ? json(200, { n, state: now.state }) : failed(verb, r);
  }
  if (verb === "openurl") {
    const url = canonicalPage(body.url, run);
    if (url === null)
      return refuse(run, "openurl", 403, {
        n,
        state: "refused",
        why: "openurl reaches only this door's /motion or /still",
      });
    return deviceVerb("openurl", ["openurl", own.udid, url], "opened");
  }
  if (verb === "screenshot") {
    const file = shotPath(body.file, run, deps);
    if (file === null)
      return refuse(run, "screenshot", 403, {
        n,
        state: "refused",
        why: "a screenshot is a new .png in the shot dir",
      });
    return deviceVerb("screenshot", ["io", own.udid, "screenshot", file], "written");
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
    // every refusal here STOPS the console acts: the smoke presses nothing on a stop. The act and the device are the
    // smoke's and the product's own: their refusals are FINAL (a relaunch asks the same); the host's are transient
    const halt = (status, why, final = false) => {
      stopRun(run, deps, `${name}: the press gate: ${why}`, { final });
      return refuse(run, "press", status, { stop: true, why: run.stopped.why });
    };
    const act = body.act;
    if (!GATED_ACTS.includes(act)) return halt(403, `it refuses act ${act}`, true);
    const own = [...run.own.values()].find((d) => d.name === body.device);
    if (own === undefined) return halt(403, "the phone's device is not one of this run's", true);
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
    // RM4.5: P10's assumption failed — the run never loops on it
    stopRun(run, deps, `${name}: ${verdict.why}`, { final: true });
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

// ─── Simulator's defaults (H1) ────────────────────────────────────────────────────────────────────────────────────────
//
// Simulator.app keeps per-device entries keyed by UDID (`DevicePreferences`, and possibly elsewhere) and may move
// `CurrentDeviceUDID` to the device it shows: a run that shows its own devices leaves them behind (out:117). Teardown
// gives back EXACTLY the run's own — the entries keyed by its own UDIDs (held in memory), and `CurrentDeviceUDID` its
// before value where it now names one — only with Simulator.app NOT running, and only through cfprefsd: `defaults export
// … -` (an XML plist), the keys edited in memory, `defaults import … -`; never `defaults write`/`delete`, never the plist
// file. Then it reads again. Every other change is another's: an OBSERVATION, never touched.

const SIM_DOMAIN = "com.apple.iphonesimulator";
const EMPTY_PLIST =
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict/>\n</plist>\n';
const PLIST_TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)\b[^>]*?(\/?)>/gu;
const PLIST_LEAVES = new Set(["string", "integer", "real", "date", "data", "true", "false"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, name) => {
    if (name[0] === "#")
      return String.fromCodePoint(
        name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1)),
      );
    return ENTITIES[name] ?? whole;
  });

/** An XML plist (`defaults export … -`), read in memory: `{xml, root}` — `dict` `{entries: [{key, s, value}]}`, `array`
 * `{items}`, `leaf` `{tag, text}`, each with its span `s..e` in `xml` — or null for anything that is not one (never
 * guessed). */
export function parsePlist(xml) {
  if (typeof xml !== "string") return null;
  const tags = [...xml.matchAll(PLIST_TAG)].map((m) => ({
    close: m[1] === "/",
    name: m[2],
    empty: m[3] === "/",
    s: m.index,
    e: m.index + m[0].length,
  }));
  let i = tags.findIndex((t) => t.name === "plist" && !t.close);
  if (i < 0) return null;
  i += 1;
  const fail = () => {
    throw new Error("not a plist");
  };
  const node = () => {
    const t = tags[i] ?? fail();
    if (t.close) fail();
    i += 1;
    if (t.name === "dict" || t.name === "array") {
      const kids = [];
      if (!t.empty)
        for (;;) {
          const k = tags[i] ?? fail();
          if (k.close && k.name === t.name) {
            i += 1;
            return t.name === "dict"
              ? { type: "dict", s: t.s, e: k.e, entries: kids }
              : { type: "array", s: t.s, e: k.e, items: kids };
          }
          if (t.name === "array") {
            kids.push(node());
            continue;
          }
          if (k.name !== "key" || k.close) fail();
          let key = "";
          if (k.empty) i += 1;
          else {
            const end = tags[i + 1] ?? fail();
            if (!end.close || end.name !== "key") fail();
            key = decodeXml(xml.slice(k.e, end.s));
            i += 2;
          }
          kids.push({ key, s: k.s, value: node() });
        }
      return t.name === "dict"
        ? { type: "dict", s: t.s, e: t.e, entries: [] }
        : { type: "array", s: t.s, e: t.e, items: [] };
    }
    if (!PLIST_LEAVES.has(t.name)) fail();
    if (t.empty) return { type: "leaf", tag: t.name, s: t.s, e: t.e, text: "" };
    const end = tags[i] ?? fail();
    if (!end.close || end.name !== t.name) fail();
    i += 1;
    return { type: "leaf", tag: t.name, s: t.s, e: end.e, text: decodeXml(xml.slice(t.e, end.s)) };
  };
  try {
    const root = node();
    const close = tags[i];
    if (root.type !== "dict" || close === undefined || !close.close || close.name !== "plist")
      return null;
    return { xml, root };
  } catch {
    return null;
  }
}

/** A plist flattened: each leaf (and each empty dict or array) by its path — compared by its tag and text. */
function flatPlist(root) {
  const out = new Map();
  const walk = (node, path) => {
    if (node.type === "dict") {
      if (node.entries.length === 0) out.set(JSON.stringify(path), { cmp: "{}", text: "{}" });
      for (const entry of node.entries) walk(entry.value, [...path, entry.key]);
    } else if (node.type === "array") {
      if (node.items.length === 0) out.set(JSON.stringify(path), { cmp: "[]", text: "[]" });
      for (const [k, item] of node.items.entries()) walk(item, [...path, `[${k}]`]);
    } else {
      const text = node.tag === "data" ? node.text.replace(/\s+/gu, "") : node.text;
      const shown = text !== "" ? text : node.tag === "string" ? '""' : node.tag;
      out.set(JSON.stringify(path), { cmp: `${node.tag}:${text}`, text: shown });
    }
  };
  walk(root, []);
  return out;
}

/** Back over the whitespace before `s`: an entry removed takes its own line with it. */
const lineStart = (text, s) => {
  let at = s;
  while (at > 0 && /\s/u.test(text[at - 1])) at -= 1;
  return at;
};

/** The cleanup, in memory: `after` (an XML plist) with every entry keyed by an own UDID (`own`: upper-case UDIDs) removed
 * at any depth, and `CurrentDeviceUDID`, where it names an own UDID, given its value in `before` (`restored`; removed
 * where `before` had none; left — `unknown` — where `before` is unreadable). Answers `{xml, removed, current}`, or null
 * when `after` is not a plist. Nothing else in it is touched: another's entries, a display's UUID, every other key. */
export function defaultsCleanup(after, own, before) {
  const plist = parsePlist(after);
  if (plist === null) return null;
  const was = parsePlist(before);
  const cuts = [];
  let removed = 0;
  const walk = (node) => {
    if (node.type === "dict")
      for (const entry of node.entries) {
        if (own.has(entry.key.toUpperCase())) {
          cuts.push({ s: lineStart(after, entry.s), e: entry.value.e, text: "" });
          removed += 1;
        } else walk(entry.value);
      }
    else if (node.type === "array") for (const item of node.items) walk(item);
  };
  walk(plist.root);
  let current = null;
  const now = plist.root.entries.find((entry) => entry.key === "CurrentDeviceUDID");
  if (now?.value.type === "leaf" && own.has(now.value.text.trim().toUpperCase())) {
    const then = was?.root.entries.find((entry) => entry.key === "CurrentDeviceUDID");
    if (was === null) current = "unknown";
    else if (then === undefined) {
      cuts.push({ s: lineStart(after, now.s), e: now.value.e, text: "" });
      current = "removed";
    } else {
      cuts.push({ s: now.value.s, e: now.value.e, text: before.slice(then.value.s, then.value.e) });
      current = "restored";
    }
  }
  let xml = after;
  for (const cut of cuts.sort((a, b) => b.s - a.s))
    xml = `${xml.slice(0, cut.s)}${cut.text}${xml.slice(cut.e)}`;
  return { xml, removed, current };
}

/** Simulator's defaults before ARMED against after, compared in memory leaf by leaf: `restored` when after == before
 * (null when before is unreadable); each change the run's OWN (its path or its value names an own UDID — the run made
 * them, nobody else knows them) or ANOTHER's (every other), as lines said only through `scrub` (redacted, UUID shapes
 * swept, never counted). `read` false: after unreadable, nothing judged. */
export function defaultsJudge(before, after, own, scrub) {
  const now = parsePlist(after);
  if (now === null)
    return { read: false, changed: null, restored: null, own: [], foreign: [], lines: [] };
  const then = parsePlist(before);
  const was = then === null ? null : flatPlist(then.root);
  const is = flatPlist(now.root);
  const owns = (path, ...values) =>
    path.some((seg) => own.has(seg.toUpperCase())) ||
    values.some((v) => v !== undefined && [...own].some((u) => v.toUpperCase().includes(u)));
  const name = (key) => JSON.parse(key).join(" › ");
  const ownLines = [];
  const foreignLines = [];
  const put = (path, line, ...values) =>
    (owns(path, ...values) ? ownLines : foreignLines).push(scrub(line));
  for (const [key, v] of is) {
    const path = JSON.parse(key);
    const prior = was?.get(key);
    if (was === null) {
      if (owns(path, v.text)) ownLines.push(scrub(`+ ${name(key)} = ${v.text}`));
    } else if (prior === undefined) put(path, `+ ${name(key)} = ${v.text}`, v.text);
    else if (prior.cmp !== v.cmp) put(path, `~ ${name(key)}: ${prior.text} → ${v.text}`, v.text);
  }
  if (was !== null)
    for (const [key, v] of was)
      if (!is.has(key)) put(JSON.parse(key), `- ${name(key)} = ${v.text}`, v.text);
  const changed = was === null ? null : ownLines.length + foreignLines.length > 0;
  return {
    read: true,
    changed,
    restored: changed === null ? null : !changed,
    own: ownLines,
    foreign: foreignLines,
  };
}

/** H1, run at teardown after the quit: the cleanup (when anything of the run's is there), through cfprefsd, only with
 * Simulator.app NOT running — running, it is skipped, said, and counted as another's; pgrep unreadable, skipped and the
 * run's own (nothing proves it) — then the defaults read again and judged. */
export async function restoreDefaults(run, deps, ctx) {
  const own = ownUdids(run);
  let after = await readDefaults(deps);
  let cleanup = "none needed";
  let removed = 0;
  let current = null;
  let appRunning = false;
  const plan = own.size === 0 ? null : defaultsCleanup(after, own, ctx.defaultsBefore);
  if (
    plan !== null &&
    (plan.removed > 0 || plan.current === "restored" || plan.current === "removed")
  ) {
    const app = await simulatorNow(run, deps);
    if (app.running === null) cleanup = "skipped: pgrep failed — Simulator.app unproven";
    else if (app.running > 0) {
      appRunning = true;
      cleanup = "skipped: Simulator.app is running (it would write them back)";
    } else {
      const r = await deps.exec(DEFAULTS, ["import", SIM_DOMAIN, "-"], {
        input: plan.xml,
        timeoutMs: 10_000,
      });
      if (r.code === 0) {
        cleanup = "done";
        removed = plan.removed;
        current = plan.current;
      } else {
        const said = stderrOf(run, r);
        cleanup = `failed: defaults import exit ${r.code}${said === "" ? "" : `: ${said}`}`;
      }
      after = await readDefaults(deps);
    }
  } else if (plan?.current === "unknown") current = "unknown";
  const judged = defaultsJudge(ctx.defaultsBefore, after, own, run.redactor.scrub);
  return { ...judged, cleanup, removed, current, appRunning };
}

/** HOST-RESTORED, judged: own devices gone (under the flag) or kept shut down; Simulator.app quit where the run launched
 * it; no helper of this lane; others unchanged; the lock given back; no new crash report. `ok` is RM4.3's read, every
 * reason counted. RESTORATION — what the exit judges — is the run's OWN side alone (`ownOk`, RM6 S-1): `foreign` holds
 * what another did (the non-own set changed; a Simulator.app proven another's, or the run's own kept from its quit beside
 * another's booted device, P5), said as an OBSERVATION. A list unreadable, or an app the proof cannot place, stays the
 * run's own: nothing proves it restored. */
export function restoredVerdict(r) {
  const own = [];
  const foreign = [];
  if (r.own.form === "deleted" && r.own.left > 0)
    own.push(`${r.own.left} pts3-${r.run}-* device(s) left`);
  if (r.own.form === "kept" && !r.own.shutdown) own.push("an own device is not shut down");
  if (r.simulator.launchedByRun && !["quit", "not-running"].includes(r.simulator.quit))
    (r.simulator.foreign === true ? foreign : own).push(`Simulator.app: ${r.simulator.quit}`);
  if (r.helperLeft !== 0)
    own.push(`${r.helperLeft} live-surface-capture-helper(s) of this lane left`);
  if (r.others !== null && !r.others.unchanged) foreign.push("another device changed");
  if (r.others === null) own.push("the host's list unreadable at teardown");
  if (r.perfLock === "left") own.push("PERF.lock left held");
  if (r.crash.new.length > 0) own.push(`a new crash report: ${r.crash.new.join(", ")}`);
  // H1: the run's own UDID-keyed defaults left after the cleanup are its own — unless another's Simulator.app kept the
  // cleanup from running; a change keyed by anything else is another's
  const d = r.defaults;
  if (d !== undefined && d.own > 0)
    (d.appRunning === true ? foreign : own).push(
      `Simulator's defaults: ${d.own} change(s) keyed by the run's own devices left (cleanup ${d.cleanup})`,
    );
  // R3: beside the run's OWN Simulator.app (launched by it, none proven another's), a change keyed by no own UDID is the
  // app's housekeeping (window frames, screen sets) — said as a PHONE_OBSERVATION by teardown, never judged
  const housekeeping = r.simulator.launchedByRun === true && r.simulator.foreign !== true;
  if (d !== undefined && d.foreign > 0 && !housekeeping)
    foreign.push(
      `Simulator's defaults: ${d.foreign} change(s) not keyed by the run's devices (another's, never touched)`,
    );
  const why = [...own, ...foreign];
  return { ok: why.length === 0, why, ownOk: own.length === 0, foreign };
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

/** THE STAGE'S OUTPUT, GUARDED (RM6 S-2). Every line the stage writes, its own and the command's, goes to a stream
 * whose reader may go away: a closed terminal's EIO, a dropped ssh, a dead `| tee`'s EPIPE, a full disk. Unguarded,
 * that write's `error` has no listener and kills the stage before or during its teardown: own devices left booted,
 * Simulator.app up, PERF.lock held, the HID END never written. Guarded, the first error marks the stream gone (`onGone`
 * once, with its code), later writes are dropped, and nothing throws. */
export function guardedOutput(stream, onGone = () => {}) {
  let gone = null;
  const lose = (error) => {
    if (gone !== null) return;
    gone = String(error?.code ?? error?.message ?? error);
    try {
      onGone(gone);
    } catch {}
  };
  stream.on("error", lose);
  return {
    write(text) {
      if (gone !== null) return false;
      try {
        stream.write(text);
        return true;
      } catch (error) {
        lose(error);
        return false;
      }
    },
    gone: () => gone,
  };
}

/** The stage's lines mirrored into the run's log folder (`<run>-stage.log`, RM6 S-2), so the run's end outlives an output
 * gone: its STOP (`PHONE_STOP`, `_FINAL`, `_UNRESTORED`), PHONE_HOST_RESTORED, the exit's PHONE_HOST_UNPROVEN (RM7.1)
 * and the HID lines. */
export const MIRRORED = /^(PHONE_STOP|PHONE_HOST_RESTORED |PHONE_HOST_UNPROVEN |HID: )/u;

/** The host's own deps: the real exec (and the command's own spawn), the clock, the files. `say` writes through the
 * redactor to `write` (the guarded stdout unless given), and each MIRRORED line, as redacted, to `mirror` too. Exported
 * for its unit: building it spawns nothing. */
export function hostDeps(
  redactor,
  { write = guardedOutput(process.stdout).write, mirror = () => {} } = {},
) {
  const out = redactStream(redactor, "driver", (line) => {
    if (MIRRORED.test(line)) mirror(line);
    write(line);
  });
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

/** Simulator's defaults as cfprefsd holds them: `defaults export … -`, an XML plist (a domain not there is an empty one);
 * null when unreadable. Read-only. */
async function readDefaults(deps) {
  const r = await deps.exec(DEFAULTS, ["export", SIM_DOMAIN, "-"], { timeoutMs: 10_000 });
  if (r.code === 0) return r.stdout;
  return /does not exist/u.test(String(r.stderr)) ? EMPTY_PLIST : null;
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
    /** T1: each own device's readiness asked, by UDID — its boot, and bootstatus's answer once it returns */
    ready: new Map(),
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

/** TEARDOWN: the plan run, then HOST-RESTORED read and said. Never throws: a throw is said, and neither the host nor the
 * run's own side is restored. Answers `restoredVerdict`'s verdict. */
async function teardown(run, deps, ctx) {
  try {
    return await restoreHost(run, deps, ctx);
  } catch (error) {
    const why = [`teardown threw: ${error instanceof Error ? error.message : String(error)}`];
    deps.say(
      `PHONE_HOST_RESTORED ${JSON.stringify({ run: run.runId, mode: run.mode, ok: false, why })}`,
    );
    return { ok: false, why, ownOk: false, foreign: [] };
  }
}

/** Teardown's word for the run's OWN Simulator.app kept from its quit by another's booted device (P5): left running. */
const BESIDE_FOREIGN =
  "left running beside a foreign booted device (a quit could take it down, P5)";

/** The plan run against the host now: each own device's name read again right before its step (RM2); HOST-RESTORED
 * said, and another's change said as an OBSERVATION (RM6 S-1); answers `restoredVerdict`'s verdict — its `ownOk` is
 * what the exit judges. Exported for its units (deps-injected, as `doorAct` is). */
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
  // another's doing: the run's own app kept from its quit by another's booted device, or an app proven another's
  let quitForeign = false;
  for (const step of teardownPlan({
    own,
    deleteDevices: ctx.deleteDevices,
    simulator: app,
    fence,
  })) {
    if (step.skip !== undefined) {
      const beside = fence.busy > 0 && app.own;
      quit = beside ? BESIDE_FOREIGN : `refused: ${step.why}`;
      quitForeign = beside || app.foreign === true;
      findings.push(`quit-app skipped: ${step.why}`);
      continue;
    }
    if (step.do === "quit-app") {
      const r = await quitAppNow(run, deps);
      quit = r.word;
      quitForeign = r.foreign;
      if (r.finding !== undefined) findings.push(r.finding);
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
    if (r.code !== 0) {
      // H3: what simctl said, redacted (run A's "shutdown … failed (exit 149)" said nothing of why)
      const said = stderrOf(run, r);
      findings.push(
        `${step.do} of ${device.name} failed (exit ${r.code})${said === "" ? "" : `: ${said}`}`,
      );
    }
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
  // H1: the run's own UDID-keyed defaults given back (Simulator.app quit above), then judged against ARMED's
  const defaults =
    run.devDir === null
      ? { read: false, own: [], foreign: [], cleanup: "none needed", removed: 0, appRunning: false }
      : await restoreDefaults(run, deps, ctx);
  if (defaults.cleanup === "done")
    deps.say(
      `stage-simulator-fixture: Simulator's defaults: ${defaults.removed} entr(ies) keyed by the run's own devices removed${defaults.current === null ? "" : `, CurrentDeviceUDID ${defaults.current}`} (through cfprefsd: defaults import)`,
    );
  else if (defaults.cleanup !== "none needed")
    findings.push(`Simulator's defaults: cleanup ${defaults.cleanup}`);
  if (defaults.appRunning)
    deps.say(
      `PHONE_OBSERVATION Simulator's defaults: the cleanup ${defaults.cleanup} — its entries keyed by the run's own devices left (another's app, never touched): ${JSON.stringify(defaults.own.slice(0, 20))}`,
    );
  if (defaults.foreign.length > 0)
    deps.say(
      launchesOf(run) > 0 && !quitForeign
        ? `PHONE_OBSERVATION Simulator's defaults changed beside the run's own Simulator.app (its housekeeping: never judged, never touched): ${JSON.stringify(defaults.foreign.slice(0, 20))}`
        : `PHONE_OBSERVATION Simulator's defaults changed by another during the run (never touched): ${JSON.stringify(defaults.foreign.slice(0, 20))}`,
    );
  if (defaults.own.length > 0 && !defaults.appRunning)
    deps.say(
      `stage-simulator-fixture: Simulator's defaults still hold the run's own entries after the cleanup: ${JSON.stringify(defaults.own.slice(0, 20))}`,
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
    simulator: { launchedByRun: launchesOf(run) > 0, quit, foreign: quitForeign },
    helperLeft,
    others: list === null ? null : othersCompare(run.othersAtArm, list, ownUdids(run)),
    defaults: {
      read: defaults.read,
      changed: defaults.changed ?? null,
      restored: defaults.restored ?? null,
      cleanup: defaults.cleanup,
      removed: defaults.removed,
      current: defaults.current ?? null,
      own: defaults.own.length,
      foreign: defaults.foreign.length,
      appRunning: defaults.appRunning,
    },
    perfLock: releasePerfLock(run),
    crash: {
      new: reportsAfter.filter((r) => !known.has(r.name) && r.at >= run.armedAt).map((r) => r.name),
    },
    refused: run.refused,
    findings,
  };
  const verdict = restoredVerdict(restored);
  deps.say(
    `PHONE_HOST_RESTORED ${JSON.stringify({ ...restored, ok: verdict.ok, ownOk: verdict.ownOk, why: verdict.why })}`,
  );
  // RM4.3 keeps the read above red; the run never touched what another did, and its exit judges its own side alone
  if (verdict.foreign.length > 0)
    deps.say(
      `PHONE_OBSERVATION the host changed by another during the run, never touched by it: ${verdict.foreign.join("; ")} — the run's own side is ${verdict.ownOk ? "restored" : "NOT restored"}`,
    );
  return verdict;
}

/** Teardown's quit: proven, then THE FENCE AGAIN — read after the settle and the proof, right before the SIGTERM (RM6
 * S-4; teardown's first read may be seconds old: a device booted since gets no look else, as the door's `quitApp` reads
 * it) — SIGTERM, ≤ 10 s. Answers the word it ends on, whether another's doing kept it (an app proven another's, a
 * foreign device booted), and a finding for HOST-RESTORED. */
async function quitAppNow(run, deps) {
  const proof = await simulatorNow(run, deps);
  if (proof.running === 0) return { word: "not-running", foreign: false };
  if (!proof.own) return { word: `refused: ${proof.why}`, foreign: proof.foreign === true };
  const list = await readList(run, deps);
  if (list === null)
    return {
      word: "refused: simctl list failed: the fence is unproven",
      foreign: false,
      finding: "quit-app skipped: simctl list failed right before it (the fence unproven)",
    };
  if (!fenceClear(list, ownUdids(run)).clear)
    return {
      word: BESIDE_FOREIGN,
      foreign: true,
      finding:
        "quit-app skipped: a foreign device booted during teardown: a quit could take it down",
    };
  deps.kill(proof.pid, "SIGTERM");
  run.simulator.quits += 1;
  if (!(await waitGone(proof.pid, deps, 10_000)))
    return { word: "outlived SIGTERM by 10 s", foreign: false };
  launchSpent(run);
  return { word: "quit", foreign: false };
}

function say(line) {
  process.stdout.write(`${line}\n`);
}

async function preflightOnly() {
  const files = readFiles();
  const fails = [
    ...nativeFresh(files.native),
    ...distFresh(files.dist),
    ...fieldNativeFresh(files.fieldNative),
  ];
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
  // S-2: the output guarded before a line is said — a reader gone never kills the run before or during its teardown —
  // and the run's STOP, HOST_RESTORED, HOST_UNPROVEN and HID lines mirrored beside its HID log, where they outlive it
  const mirror = (line) => {
    try {
      appendFileSync(opts.stageLog, line);
    } catch {}
  };
  const gone = (which) => (why) =>
    mirror(
      `stage-simulator-fixture: ${which} went away (${why}): its later lines are dropped; this file keeps the run's STOP, HOST_RESTORED, HOST_UNPROVEN and HID lines\n`,
    );
  const stdout = guardedOutput(process.stdout, gone("stdout"));
  const stderr = guardedOutput(process.stderr, gone("stderr"));
  const redactor = createRedactor();
  const deps = hostDeps(redactor, { write: stdout.write, mirror });
  const run = newRun(mode, opts, redactor);
  mkdirSync(dirname(opts.hidLog), { recursive: true });
  // the HID record guarded at its definition (RM7.2): a failed append is said once, never thrown
  deps.hid = hidRecord(opts.hidLog, deps.say);
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

  // the preflight, first: the files (no simctl) — ENUM needs the native pair alone; a launch's shell, the field-native
  // its environment names too
  const files = readFiles(undefined, deps.env);
  const fails =
    mode === "enum"
      ? nativeFresh(files.native)
      : [
          ...nativeFresh(files.native),
          ...distFresh(files.dist),
          ...fieldNativeFresh(files.fieldNative),
        ];
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
  // the responsible app (S5), the moment the arm has inferred it — BEFORE the lock is held or any device made (RM6
  // S-5): a launch from an app ENUM never proved refuses with nothing to undo (no `simctl create`, no lock)
  if (mode !== "enum" && armed.gate.armed && signalled === null) {
    const wrongApp = launchChecks({
      shotDir: opts.shotDir,
      helperSha,
      enumSha: record.sha256,
      app: armed.app,
      enumApp: typeof record.responsible === "string" ? record.responsible : null,
    });
    if (wrongApp.length > 0) {
      for (const line of preflightLines(wrongApp)) deps.say(line);
      return 1;
    }
  }
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
  let hostVerdict = null;
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
      // the preflight again, right before the command: the files and the helper's sha (the app was checked at the arm)
      const again = readFiles(undefined, env);
      const late = [
        ...nativeFresh(again.native),
        ...distFresh(again.dist),
        ...fieldNativeFresh(again.fieldNative),
        ...launchChecks({
          shotDir: env.VF_SMOKE_SHOT_DIR,
          helperSha: sha256File(PATHS.helper),
          enumSha: record.sha256,
        }),
      ];
      if (late.length > 0) {
        for (const line of preflightLines(late)) deps.say(line);
        code = 1;
      } else if (signalled === null) {
        const marks = { begin: null, end: null, home: null };
        const watch = (line) => {
          const mark = rowsMark(line);
          if (mark?.begin !== undefined) marks.begin = mark.begin;
          if (mark?.end !== undefined) marks.end = mark.end;
          marks.home = smokeHomeOf(line) ?? marks.home;
        };
        const out = redactStream(redactor, "main", (line) => {
          watch(line);
          stdout.write(line);
        });
        const err = redactStream(redactor, "main", (line) => stderr.write(line));
        running = runCommand({ command, env, deadlineMs: opts.deadlineMs, deps, out, err });
        let sampler = null;
        if (mode === "cost") sampler = startCostSampler(run, deps);
        const exited = await running.done;
        if (sampler !== null) clearInterval(sampler);
        code = exited.code;
        deadlineHit = exited.deadlineHit;
        const rows = rowsVerdict({
          mode,
          begin: marks.begin,
          end: marks.end,
          served: run.served,
          fatal: marks.begin === null && marks.home !== null ? fatalWords(marks.home) : null,
        });
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
    // the teardown's verdict kept WHOLE (RM7.2a): the exit judges restoration on the run's OWN side (RM6 S-1), and
    // another's change — said as an OBSERVATION — keeps a run that did not stop from 0 (RM7.1)
    hostVerdict = await teardown(run, deps, {
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
    stopped: run.stopped,
    deadlineHit,
    code,
    restored: hostVerdict.ownOk,
    foreign: hostVerdict.foreign,
  });
  for (const line of exit.lines) deps.say(line);
  return exit.code;
}

/** A launch's exit, and the lines it says: 128+n on a signal. `restored` is the run's OWN side (`restoredVerdict`'s
 * `ownOk`, RM6 S-1) and `foreign` its list of another's changes (`restoredVerdict`'s `foreign`): launch() hands both
 * from ONE teardown verdict (RM7.2a). A STOP (`stopped`: the run's `{why, final}`, or null) is 75 — "NOT ARMED:
 * relaunch later" (§6.3) — only when it is TRANSIENT (a hand at a begin, a locked console, the fence, a Simulator.app
 * not proven the run's) over a restored own side. A DETERMINISTIC stop (`final`: RM4.5's own-input reset, the press gate
 * refusing an act or a device) would repeat on a relaunch: 1 and PHONE_STOP_FINAL <why> (RM6 S-3). A STOP that left the
 * run's own side unrestored (an own device booted, its app not quit, its lock left) is 1 and PHONE_STOP_UNRESTORED, so
 * no caller relaunches over it. Past the deadline 1; a non-zero command code is kept (a red row is a red row); 0 over
 * an unrestored own side is 1. NO EXIT IS 0 WHILE HOST_RESTORED IS RED (RM7.1): a run that did not stop, whose command
 * said 0 over a restored own side while another changed the host, is 75 and PHONE_HOST_UNPROVEN — HOST-RESTORED (RM4.3:
 * the non-own set unchanged) cannot be proven over another's hand, so the run is relaunched on a quiet host. */
export function launchExit({ signal, stopped, deadlineHit, code, restored, foreign }) {
  if (signal !== null) return { code: 128 + signal, lines: [] };
  if (stopped) {
    const lines = [];
    if (stopped.final) lines.push(`PHONE_STOP_FINAL ${stopped.why}`);
    if (!restored)
      lines.push(
        "PHONE_STOP_UNRESTORED the run stopped and its teardown left the run's OWN side unrestored (PHONE_HOST_RESTORED's why): restore its own devices, app or lock by hand before any relaunch — never another's device",
      );
    return { code: lines.length === 0 ? NOT_ARMED : 1, lines };
  }
  if (deadlineHit) return { code: 1, lines: [] };
  if (code !== 0) return { code, lines: [] };
  if (!restored) return { code: 1, lines: [] };
  if (foreign.length > 0)
    return {
      code: NOT_ARMED,
      lines: [
        `PHONE_HOST_UNPROVEN another's hand changed the host during the run (${foreign.join("; ")}): HOST-RESTORED is unprovable, though the run's OWN side is restored (PHONE_OBSERVATION's change, never touched by it) — relaunch on a quiet host`,
      ],
    };
  return { code: 0, lines: [] };
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
  // T7: a reused run id refused before anything is written (launch's folder, its stage log, its HID record)
  const reused = reusedRun(opts);
  if (reused !== null) {
    process.stderr.write(`${reused}\n`);
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
