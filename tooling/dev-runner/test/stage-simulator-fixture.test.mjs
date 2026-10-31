import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { Writable } from "node:stream";
import test, { after } from "node:test";

// PT-S3 (P3/P5/P6/P10) — the phone's stage (scripts/stage-simulator-fixture.mjs): its preflight, its arming, its fence, its
// own devices, its host door, its redactor, its HID record and its teardown, held without a Mac's Simulator. These units
// run in every `pnpm verify`, on any lane and on the mini's mint, so they SPAWN NOTHING: node:child_process is replaced
// by functions that throw BEFORE the stage is imported, and every unit drives the stage through a fake `exec`.

const spawned = [];
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[name] = (file) => {
    spawned.push(`${name} ${String(file)}`);
    throw new Error(`a unit spawned: ${name} ${String(file)}`);
  };
}
syncBuiltinESMExports();

const {
  armGate,
  canonicalPage,
  catalogIds,
  commandEnv,
  costRows,
  createRedactor,
  DEFAULT_DEADLINE_MS,
  defaultsChange,
  devicesWord,
  distFresh,
  doorAct,
  doorRow,
  endVerdict,
  enumVerdict,
  fenceAgain,
  fenceClear,
  guardedOutput,
  handleDoor,
  hidLine,
  hidLines,
  hidRecord,
  hidSummary,
  hostDeps,
  houseRules,
  isOwnName,
  launchChecks,
  launchExit,
  MAX_DEADLINE_MS,
  MODE_ROWS,
  nativeFresh,
  NONE_DEVELOPER_DIR,
  newestMtime,
  newRun,
  NOT_ARMED,
  othersCompare,
  parseArgs,
  parseIdle,
  parseList,
  parseLocked,
  parseLstart,
  parsePsRow,
  pickDeveloperDir,
  pickOwnTypes,
  preflightLines,
  probeHid,
  readOptions,
  realExec,
  redactStream,
  responsibleApp,
  restoreHost,
  restoredVerdict,
  rowsMark,
  rowsVerdict,
  rowVerdict,
  runCommand,
  runIdOk,
  simulatorExe,
  simulatorProof,
  simulatorSettled,
  startDoor,
  stopRun,
  sweep,
  teardownPlan,
  XCODE_DEVELOPER_DIR,
} = await import("../../../scripts/stage-simulator-fixture.mjs");

after(() => {
  assert.deepEqual(spawned, [], "no unit spawns a process");
});

const FIXTURES = join(import.meta.dirname, "fixtures/stage-simulator");
const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

// planted UDIDs: three of the run's own, two of the host's (one of them unavailable)
const OWN = [
  "5A1C0E7B-3D2F-4E6A-9B8C-1D2E3F4A5B6C",
  "6B2D1F8C-4E3A-4F7B-8C9D-2E3F4A5B6C7D",
  "7C3E2A9D-5F4B-4A8C-9DAE-3F4A5B6C7D8E",
];
const FOREIGN = "D4E5F6A7-B8C9-4DAE-8F01-23456789ABCD";
const FOREIGN_GONE = "E5F6A7B8-C9DA-4EBF-9012-3456789ABCDE";
const PLANTED = [...OWN, FOREIGN, FOREIGN_GONE];
const holdsUdid = (text) =>
  PLANTED.some((udid) => String(text).toUpperCase().includes(udid.toUpperCase()));

const RT26 = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
const RT27 = "com.apple.CoreSimulator.SimRuntime.iOS-27-1";
const T = (model) => `com.apple.CoreSimulator.SimDeviceType.${model}`;
const CATALOG = [
  "iPhone-11",
  "iPhone-12",
  "iPhone-13",
  "iPhone-14",
  "iPhone-15",
  "iPhone-16",
  "iPhone-17-Pro",
].map(T);

const runtime = (identifier, version, types, isAvailable = true) => ({
  identifier,
  version,
  isAvailable,
  name: `iOS ${version}`,
  supportedDeviceTypes: types.map((id) => ({ identifier: id, productFamily: "iPhone" })),
});

/** `simctl list --json` as this Mac prints it (devices by runtime, runtimes with their supported types). */
function simctlList({ devices = [], runtimes = [runtime(RT26, "26.5", CATALOG)] } = {}) {
  const byRuntime = {};
  for (const d of devices) {
    byRuntime[d.runtime ?? RT26] ??= [];
    byRuntime[d.runtime ?? RT26].push({
      dataPath: `/Users/runner/Library/Developer/CoreSimulator/Devices/${d.udid}/data`,
      udid: d.udid,
      isAvailable: d.available ?? true,
      deviceTypeIdentifier: d.type,
      state: d.state ?? "Shutdown",
      name: d.name,
    });
  }
  return JSON.stringify({ devices: byRuntime, runtimes });
}

const RUN = "l2-t1";
const ARMED = Date.UTC(2026, 9, 31, 4, 0, 0) + 500;
const SHOTS = "/lanes/pts3/logs/l2-t1/shots";
const SIM_EXE = simulatorExe(XCODE_DEVELOPER_DIR);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (v) => String(v).padStart(2, "0");
/** `ps -o lstart=` under LC_ALL=C: local time, the day space-padded. */
function lstartOf(ms) {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getFullYear()}`;
}

/** The host's list during a run: the run's three own devices (shut down) and the foreign ones as given. */
const hostList = (foreign = [{ udid: FOREIGN, state: "Shutdown" }]) =>
  simctlList({
    devices: [
      ...OWN.map((udid, i) => ({ udid, name: `pts3-${RUN}-${i + 1}`, type: CATALOG[i + 2] })),
      ...foreign.map((d) => ({ name: "iPhone 11", type: CATALOG[0], ...d })),
    ],
  });

const ok = (stdout = "") => ({ code: 0, signal: null, stdout, stderr: "" });

/** A host the stage drives through `exec` alone: simctl's list, pgrep and ps answer from `state`; every call is kept. */
function fakeHost(opts = {}) {
  const state = {
    list: opts.list ?? hostList(),
    pgrep: opts.pgrep ?? null,
    comm: opts.comm ?? SIM_EXE,
    lstart: opts.lstart ?? lstartOf(ARMED + 60_000),
  };
  const calls = [];
  const said = [];
  const hid = [];
  const killed = [];
  const samples = [...(opts.samples ?? [])];
  const deps = {
    env: { PATH: "/usr/bin:/bin", DEVELOPER_DIR: "/Library/Developer/CommandLineTools" },
    now: () => ARMED + 120_000,
    sleep: async () => {},
    alive: () => false,
    kill: (pid, signal) => killed.push({ pid, signal }),
    exists: (path) => (opts.files ?? []).includes(path),
    realpath: (path) => {
      if ((opts.dirs ?? [SHOTS]).includes(path)) return path;
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    },
    say: (line) => said.push(line),
    hid: (line) => hid.push(line),
    probe: async () => samples.shift(),
    exec: async (file, args, o = {}) => {
      calls.push({ file, args, env: o.env });
      if (file === "/usr/bin/xcrun" && args[1] === "list") return ok(state.list);
      if (file === "/usr/bin/pgrep")
        return state.pgrep === null
          ? { code: 1, signal: null, stdout: "", stderr: "" }
          : ok(`${state.pgrep}\n`);
      if (file === "/bin/ps" && args[1] === "comm=") return ok(`${state.comm}\n`);
      if (file === "/bin/ps" && args[1] === "lstart=") return ok(`${state.lstart}\n`);
      return ok("");
    },
  };
  return { deps, state, calls, said, hid, killed };
}

/** A run ARMED with its three own devices made, the door at :51234. */
function ownRun(mode = "devices") {
  const run = newRun(mode, { run: RUN, shotDir: SHOTS }, createRedactor());
  run.devDir = XCODE_DEVELOPER_DIR;
  run.armedAt = ARMED;
  run.port = 51234;
  run.origin = "http://127.0.0.1:51234";
  run.runtime = RT26;
  run.types = CATALOG.slice(2, 6);
  run.redactor.foreign(FOREIGN);
  run.redactor.foreign(FOREIGN_GONE);
  if (mode !== "none")
    for (const [i, udid] of OWN.entries()) {
      run.own.set(i + 1, { udid, name: `pts3-${RUN}-${i + 1}`, type: CATALOG[i + 2] });
      run.redactor.own(udid, i + 1);
    }
  return run;
}

// ─── the module: spawn-free ───────────────────────────────────────────────────────────────────────────────────────────

test("the import spawns nothing, and the stage's one exec seam is the throwing spawn the units installed", async () => {
  assert.deepEqual(spawned, []);
  const r = await realExec("/usr/bin/true", []);
  assert.equal(r.code, null);
  assert.match(r.error, /a unit spawned: spawn \/usr\/bin\/true/u);
  // that one call was this unit's own probe of the seam; it ran nothing
  assert.deepEqual(spawned.splice(0), ["spawn /usr/bin/true"]);
});

// ─── the command line and the env ─────────────────────────────────────────────────────────────────────────────────────

test("parseArgs: a launch takes its mode and a command after --; enum, --preflight-only and --sweep stand alone", () => {
  assert.deepEqual(parseArgs(["devices", "--", "node", "run-smoke.mjs", "--phone"]), {
    mode: "devices",
    command: ["node", "run-smoke.mjs", "--phone"],
  });
  assert.deepEqual(parseArgs(["none", "--", "node"]), { mode: "none", command: ["node"] });
  assert.deepEqual(parseArgs(["enum"]), { mode: "enum" });
  assert.deepEqual(parseArgs(["--preflight-only"]), { mode: "preflight" });
  assert.deepEqual(parseArgs(["--sweep", "l2-t1"]), { mode: "sweep", runId: "l2-t1" });
  for (const bad of [
    [],
    ["devices"],
    ["devices", "--"],
    ["devices", "node"],
    ["enum", "--", "node"],
    ["phone", "--", "node"],
    ["--preflight-only", "x"],
  ])
    assert.match(parseArgs(bad).error, /^usage:/u, JSON.stringify(bad));
  assert.match(parseArgs(["--sweep", "L2"]).error, /--sweep takes a run id/u);
  assert.match(parseArgs(["--sweep"]).error, /^usage:/u);
});

test("houseRules: this Mac's guard, lock and floors by default; another host's by env, each named; a wrong one said (S4)", () => {
  const mac = houseRules({});
  assert.deepEqual(mac.errors, []);
  assert.equal(mac.by, "this Mac's defaults");
  assert.equal(mac.guardAwk, "/Volumes/SamsungRed/lanes/guard/guard-stop.awk");
  assert.equal(mac.perfLock, "/Volumes/SamsungRed/lanes/PERF.lock");
  assert.deepEqual(mac.diskFloors, [
    { path: "/Volumes/SamsungRed", gib: 15 },
    { path: "/", gib: 10 },
  ]);
  const mini = houseRules({
    VF_PHONE_GUARD_AWK: "/Users/mini/lanes/guard-stop.awk",
    VF_PHONE_PERF_LOCK: "/Users/mini/lanes/PERF.lock",
    VF_PHONE_DISK_FLOORS: "/:20",
  });
  assert.deepEqual(mini.errors, []);
  assert.equal(mini.guardAwk, "/Users/mini/lanes/guard-stop.awk");
  assert.equal(mini.perfLock, "/Users/mini/lanes/PERF.lock");
  assert.deepEqual(mini.diskFloors, [{ path: "/", gib: 20 }]);
  assert.match(mini.by, /env \(VF_PHONE_GUARD_AWK, VF_PHONE_PERF_LOCK, VF_PHONE_DISK_FLOORS\)/u);
  // one taken by env, the rest this Mac's
  const one = houseRules({ VF_PHONE_DISK_FLOORS: "/:10,/Volumes/Other:5" });
  assert.equal(one.perfLock, mac.perfLock);
  assert.deepEqual(one.diskFloors.at(-1), { path: "/Volumes/Other", gib: 5 });
  assert.equal(one.by, "env (VF_PHONE_DISK_FLOORS)");
  const bad = houseRules({
    VF_PHONE_GUARD_AWK: "guard-stop.awk",
    VF_PHONE_PERF_LOCK: "PERF.lock",
    VF_PHONE_DISK_FLOORS: "/:ten",
  });
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors.join("\n"), /VF_PHONE_GUARD_AWK must be an absolute path/u);
  assert.match(bad.errors.join("\n"), /VF_PHONE_DISK_FLOORS is/u);
  assert.match(houseRules({ VF_PHONE_DISK_FLOORS: "/:0" }).errors[0], /VF_PHONE_DISK_FLOORS/u);
  // a launch takes them with its options; armGate names the set's own paths
  const opts = readOptions({
    VF_PHONE_RUN: "l3-t1",
    VF_PHONE_HID_LOG: "/lanes/pts3/logs/l3-t1/l3-t1-hid.log",
    VF_PHONE_PERF_LOCK: "/Users/mini/lanes/PERF.lock",
  });
  assert.deepEqual(opts.errors, []);
  assert.equal(opts.rules.perfLock, "/Users/mini/lanes/PERF.lock");
  assert.deepEqual(
    readOptions({ VF_PHONE_RUN: "l3-t1", VF_PHONE_HID_LOG: "/l/h.log", VF_PHONE_PERF_LOCK: "x" })
      .errors,
    ["VF_PHONE_PERF_LOCK must be an absolute path"],
  );
  assert.deepEqual(armGate({ ...CLEAR, rules: opts.rules, perfLock: true }).why, [
    "/Users/mini/lanes/PERF.lock is held",
  ]);
  assert.deepEqual(armGate({ ...CLEAR, rules: mini, guard: null }).why, [
    "the guard is unreadable (/Users/mini/lanes/guard-stop.awk)",
  ]);
});

test("readOptions: the run, the HID log, a 30-minute deadline by default, and KEEP unless the delete flag is 1", () => {
  const hidLog = "/lanes/pts3/logs/l2-t1/l2-t1-hid.log";
  const opts = readOptions({ VF_PHONE_RUN: "l2-t1", VF_PHONE_HID_LOG: hidLog });
  assert.deepEqual(opts.errors, []);
  assert.equal(opts.deadlineMs, DEFAULT_DEADLINE_MS);
  assert.equal(DEFAULT_DEADLINE_MS, 30 * 60_000);
  assert.equal(opts.deleteDevices, false);
  assert.equal(opts.shotDir, "/lanes/pts3/logs/l2-t1/shots");
  assert.equal(opts.enumRecord, "/lanes/pts3/logs/phone-enum.json");
  // S-2: the run's STOP, HOST_RESTORED and HID lines mirrored beside its HID log
  assert.equal(opts.stageLog, "/lanes/pts3/logs/l2-t1/l2-t1-stage.log");
  const del = readOptions({
    VF_PHONE_RUN: "l2-t1",
    VF_PHONE_HID_LOG: hidLog,
    VF_PHONE_DELETE_DEVICES: "1",
    VF_PHONE_DEADLINE_MS: "600000",
  });
  assert.equal(del.deleteDevices, true);
  assert.equal(del.deadlineMs, 600_000);
  const bad = readOptions({
    VF_PHONE_RUN: "L2",
    VF_PHONE_HID_LOG: "logs/hid.log",
    VF_PHONE_DELETE_DEVICES: "yes",
    VF_PHONE_DEADLINE_MS: "-5",
  });
  assert.equal(bad.errors.length, 4);
  assert.equal(bad.deleteDevices, false);
});

test("readOptions: the deadline is bounded at 6 h — a timer past 2^31-1 ms fires at once, and caffeinate's adds an hour (S-6)", () => {
  const at = (ms) =>
    readOptions({
      VF_PHONE_RUN: "l2-t1",
      VF_PHONE_HID_LOG: "/lanes/pts3/logs/l2-t1/l2-t1-hid.log",
      VF_PHONE_DEADLINE_MS: String(ms),
    });
  // Node clamps a setTimeout past 2^31-1 ms to 1 ms: the command would be stopped at its first millisecond
  for (const over of [2 ** 31, 2 ** 31 - 3_600_000, 6 * 3_600_000 + 1, 1e12])
    assert.match(at(over).errors.join("\n"), /VF_PHONE_DEADLINE_MS .*≤ 6 h/u, String(over));
  assert.equal(MAX_DEADLINE_MS, 6 * 3_600_000);
  assert.deepEqual(at(MAX_DEADLINE_MS).errors, []);
  assert.equal(at(MAX_DEADLINE_MS).deadlineMs, MAX_DEADLINE_MS);
  // the bound and caffeinate's extra hour both fit a 32-bit timer
  assert.ok(MAX_DEADLINE_MS + 3_600_000 <= 2 ** 31 - 1);
});

test("commandEnv: DEVELOPER_DIR never reaches the command; none points the product at /var/empty; types, never UDIDs", () => {
  const door = {
    origin: "http://127.0.0.1:51234",
    token: "t0k",
    runtime: RT27,
    types: CATALOG.slice(2, 6),
    shotDir: SHOTS,
    devDirBy: "fallback",
  };
  const env = {
    PATH: "/usr/bin",
    DEVELOPER_DIR: XCODE_DEVELOPER_DIR,
    VF_SMOKE_SIMCTL_DEVELOPER_DIR: "/somewhere",
  };
  const devices = commandEnv("devices", env, door);
  assert.equal(devices.DEVELOPER_DIR, undefined);
  assert.equal(devices.VF_SMOKE_SIMCTL_DEVELOPER_DIR, undefined);
  assert.equal(devices.PATH, "/usr/bin");
  assert.equal(devices.VF_PHONE_MODE, "devices");
  assert.equal(devices.VF_PHONE_RUNTIME, RT27);
  assert.equal(devices.VF_PHONE_HOST, "http://127.0.0.1:51234");
  assert.equal(devices.VF_PHONE_TOKEN, "t0k");
  assert.equal(devices.VF_SMOKE_SHOT_DIR, SHOTS);
  // the driver's xcode-select reading, a label: SIM-P1 VOIDs on it, never on main's own word (M1/R13)
  assert.equal(devices.VF_PHONE_DEVDIR_BY, "fallback");
  assert.equal(
    commandEnv("devices", env, { ...door, devDirBy: "xcode-select" }).VF_PHONE_DEVDIR_BY,
    "xcode-select",
  );
  assert.equal(
    devices.VF_PHONE_DEVICES,
    `1:${T("iPhone-13")},2:${T("iPhone-14")},3:${T("iPhone-15")},4:${T("iPhone-16")}`,
  );
  const none = commandEnv("none", env, door);
  assert.equal(none.DEVELOPER_DIR, undefined);
  assert.equal(none.VF_SMOKE_SIMCTL_DEVELOPER_DIR, NONE_DEVELOPER_DIR);
  assert.equal(NONE_DEVELOPER_DIR, "/var/empty");
  assert.equal(none.VF_PHONE_DEVICES, `1:${T("iPhone-13")}`);
  assert.equal(devicesWord("cost", ["a", "b", "c", "d"]), "1:a,2:b,3:c,4:d");
  assert.ok(!holdsUdid(JSON.stringify([devices, none])));
});

// ─── names ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("runIdOk: lower-case words joined by single hyphens, nothing else", () => {
  for (const good of ["l2", "l2-t1", "a1-b2-c3", "0"]) assert.equal(runIdOk(good), true, good);
  for (const bad of ["", "L2", "l2_", "-l2", "l2-", "l2--x", "l2.x", "l2 x", "l2\n", undefined, 12])
    assert.equal(runIdOk(bad), false, JSON.stringify(bad));
});

test("isOwnName: exactly pts3-<runId>-<digits>; another run's, a suffixed or a partial name is never the run's", () => {
  assert.equal(isOwnName("pts3-l2-t1-1", "l2-t1"), true);
  assert.equal(isOwnName("pts3-l2-t1-12", "l2-t1"), true);
  for (const [name, runId] of [
    ["pts3-other-1", "l2-t1"],
    ["pts3-l2-t1-1x", "l2-t1"],
    ["pts3-l2-t1-", "l2-t1"],
    ["pts3-l2-t1-1\n", "l2-t1"],
    ["xpts3-l2-t1-1", "l2-t1"],
    ["pts3-l2-t1-1", "l2"], // another run whose id the run's id prefixes
    ["pts3-l2-1", "l2-1"],
    ["pts3-l2-t1-1", "L2-T1"],
    ["pts3-l2.t1-1", "l2.t1"],
    [42, "l2-t1"],
  ])
    assert.equal(isOwnName(name, runId), false, `${JSON.stringify(name)} of ${runId}`);
});

// ─── the preflight ────────────────────────────────────────────────────────────────────────────────────────────────────

test("nativeFresh: the helper and the adapter, each missing or older than their sources, are named with the build", () => {
  assert.deepEqual(nativeFresh({ helper: 200, adapter: 200, sources: 100 }), []);
  const missing = nativeFresh({ helper: null, adapter: 200, sources: 100 });
  assert.equal(missing.length, 1);
  assert.match(missing[0].what, /live-surface-capture-helper/u);
  assert.equal(missing[0].why, "missing");
  assert.equal(missing[0].fix, "pnpm --filter @vibefield/desktop build:live-surfaces-native");
  const stale = nativeFresh({ helper: 50, adapter: 50, sources: 100 });
  assert.equal(stale.length, 2);
  assert.match(stale[1].what, /live-surface-adapter\.node/u);
  assert.match(stale[1].why, /older than/u);
});

const FRESH_DIST = {
  plugin: 300,
  pluginSources: 100,
  main: 300,
  smoke: 300,
  renderer: 300,
  shellSources: 200,
  smokeHasPhone: true,
};

test("distFresh: the plugin's dist and the shell's dist stale or missing, or a smoke bundle without --phone, each named", () => {
  assert.deepEqual(distFresh(FRESH_DIST), []);
  const stalePlugin = distFresh({ ...FRESH_DIST, plugin: 50 });
  assert.deepEqual(
    stalePlugin.map((f) => [f.what, f.fix]),
    [["plugins/simulator/dist", "pnpm --filter @vibefield/desktop build:all --skip-nx-cache"]],
  );
  // the light's find: `gen` rewrites a generated source byte-for-byte (its mtime moves, its content does not), and a
  // build:all nx serves from its local cache leaves the outputs' mtimes as they were, so a plain build:all never
  // clears an "older" — every build fix forces the build past the cache
  const everyFix = distFresh({ ...FRESH_DIST, plugin: null, main: 150, smoke: null, renderer: 10 });
  assert.ok(everyFix.length >= 4);
  for (const f of everyFix) assert.match(f.fix, / build:all --skip-nx-cache$/u);
  const staleShell = distFresh({ ...FRESH_DIST, main: 150, renderer: null });
  assert.deepEqual(
    staleShell.map((f) => [f.what, f.why.split(" ")[0]]),
    [
      ["electron-shell dist/main/index.cjs", "older"],
      ["electron-shell dist/renderer/", "missing"],
    ],
  );
  const noPhone = distFresh({ ...FRESH_DIST, smokeHasPhone: false });
  assert.equal(noPhone.length, 1);
  assert.match(noPhone[0].why, /lacks the literal --phone/u);
  // a missing smoke bundle is said once, as missing
  assert.equal(distFresh({ ...FRESH_DIST, smoke: null, smokeHasPhone: false }).length, 1);
});

test("launchChecks: in a launch, no shot dir or a helper ENUM never proved is refused", () => {
  assert.deepEqual(launchChecks({ shotDir: SHOTS, helperSha: "ab", enumSha: "ab" }), []);
  assert.match(
    launchChecks({ shotDir: "", helperSha: "ab", enumSha: "ab" })[0].what,
    /VF_SMOKE_SHOT_DIR/u,
  );
  assert.match(launchChecks({ shotDir: SHOTS, helperSha: "ab", enumSha: null })[0].why, /no ENUM/u);
  assert.match(
    launchChecks({ shotDir: SHOTS, helperSha: "ab", enumSha: "cd" })[0].why,
    /not the one ENUM recorded/u,
  );
});

test("launchChecks: right after the arm, the responsible app is the one ENUM proved — or refused, naming both (S5)", () => {
  const term = "/System/Applications/Utilities/Terminal.app";
  const code = "/Applications/Claude.app";
  const at = { shotDir: SHOTS, helperSha: "ab", enumSha: "ab" };
  // the arm's app is unknown before the arm: the first preflight never asks
  assert.deepEqual(launchChecks(at), []);
  assert.deepEqual(launchChecks({ ...at, app: term, enumApp: term }), []);
  const [other] = launchChecks({ ...at, app: code, enumApp: term });
  assert.equal(other.what, "the responsible app");
  assert.match(other.why, /Claude\.app.*not.*Terminal\.app/u);
  assert.match(other.fix, /ENUM/u);
  // an ENUM that recorded no app (none inferred, or a record before the field) proves none
  assert.match(
    launchChecks({ ...at, app: code, enumApp: null })[0].why,
    /recorded no responsible app/u,
  );
  assert.match(launchChecks({ ...at, app: null, enumApp: term })[0].why, /none inferred/u);
});

/** `launch()`'s own text, from its head to the next top-level function: it runs on the host's real deps, so no unit drives
 * it, and its ORDER is held from its source (RM6's P-1 way). */
const launchSource = () => {
  const source = readFileSync(
    join(import.meta.dirname, "../../../scripts/stage-simulator-fixture.mjs"),
    "utf8",
  );
  const head = source.indexOf("\nasync function launch(");
  assert.ok(head >= 0, "launch() is in the stage");
  const end = source.indexOf("\n}\n", head);
  return source.slice(head, end);
};

test("launch: the responsible app is checked right after the arm infers it — BEFORE the lock is held or a device made (S-5)", () => {
  const launch = launchSource();
  const armed = launch.indexOf("await arm(");
  const check = launch.indexOf("app: armed.app");
  const lock = launch.indexOf("holdPerfLock(run");
  const make = launch.indexOf("makeOwnDevices(run, deps)");
  assert.ok(armed > 0 && lock > armed && make > lock, "arm, then the lock, then the devices");
  // a refusal there leaves nothing behind: no `simctl create`, no lock — and the check is made once
  assert.ok(check > armed, "the app is checked after the arm infers it");
  assert.ok(check < lock, "and before the lock is held");
  assert.ok(check < make, "and before the run's devices are made");
  assert.equal(launch.indexOf("app: armed.app", check + 1), -1, "once");
});

/** RM7.2a: launch() keeps teardown's verdict WHOLE and hands launchExit its own side AND its foreign list — `.ok` would
 * judge another's change as the run's red (RM6 S-1), and a dropped `foreign` would read 0 over it (RM7.1). */
const teardownFed = (launch) => {
  assert.equal(launch.match(/await teardown\(/gu)?.length, 1, "teardown awaited once");
  const torn = launch.indexOf("hostVerdict = await teardown(");
  assert.ok(torn >= 0, "teardown's verdict kept whole, as hostVerdict");
  assert.equal(launch.match(/launchExit\(/gu)?.length, 1, "launchExit called once");
  const at = launch.indexOf("launchExit({");
  assert.ok(at > torn, "launchExit after the teardown");
  const call = launch.slice(at, launch.indexOf("});", at));
  assert.match(call, /\brestored: hostVerdict\.ownOk,/u, "restored: the verdict's OWN side");
  assert.match(call, /\bforeign: hostVerdict\.foreign,/u, "foreign: the verdict's foreign list");
  assert.doesNotMatch(launch, /hostVerdict\.ok\b|\)\.ok\b/u, "never the whole verdict's ok");
};

test("launch: teardown's verdict kept whole — launchExit takes its OWN side and its foreign list (RM7.2a)", () => {
  teardownFed(launchSource());
});

test("launch: an edit that hands launchExit `.ok`, or drops or empties `foreign`, is caught (RM7.2a)", () => {
  const launch = launchSource();
  const mutations = {
    ".ok handed": launch.replace("restored: hostVerdict.ownOk,", "restored: hostVerdict.ok,"),
    "foreign dropped": launch.replace(/\n\s*foreign: hostVerdict\.foreign,/u, ""),
    "foreign emptied": launch.replace("foreign: hostVerdict.foreign,", "foreign: [],"),
    "the verdict kept for its ownOk alone": launch.replace(
      "hostVerdict = await teardown(",
      "restored = (await teardown(",
    ),
    "the whole verdict's ok read": launch.replace(
      "restored: hostVerdict.ownOk,",
      "restored: hostVerdict.ok && hostVerdict.ownOk,",
    ),
  };
  for (const [what, mutated] of Object.entries(mutations)) {
    assert.ok(mutated !== launch, `${what}: the mutation applies`);
    assert.throws(() => teardownFed(mutated), assert.AssertionError, what);
  }
});

test("launchExit: a STOP reads 75 (relaunch later) only when the host is restored; unrestored, 1 and a line (S8)", () => {
  const ran = {
    signal: null,
    stopped: null,
    deadlineHit: false,
    code: 0,
    restored: true,
    foreign: [],
  };
  assert.deepEqual(launchExit(ran), { code: 0, lines: [] });
  assert.deepEqual(launchExit({ ...ran, code: 3 }), { code: 3, lines: [] });
  assert.deepEqual(launchExit({ ...ran, restored: false }), { code: 1, lines: [] });
  assert.deepEqual(launchExit({ ...ran, deadlineHit: true }), { code: 1, lines: [] });
  const hand = { why: "a hand at the Mac before SIM-LIVE", final: false };
  assert.deepEqual(launchExit({ ...ran, stopped: hand }), { code: NOT_ARMED, lines: [] });
  const unrestored = launchExit({ ...ran, stopped: hand, restored: false });
  assert.equal(unrestored.code, 1);
  assert.equal(unrestored.lines.length, 1);
  assert.match(
    unrestored.lines[0],
    /^PHONE_STOP_UNRESTORED .*PHONE_HOST_RESTORED.*before any relaunch/u,
  );
  assert.equal(launchExit({ ...ran, signal: 2, stopped: hand, restored: false }).code, 130);
});

test("launchExit: a run that did NOT stop is never 0 while HOST_RESTORED is red — another's change alone is 75 and one line (RM7.1)", () => {
  const ran = {
    signal: null,
    stopped: null,
    deadlineHit: false,
    code: 0,
    restored: true,
    foreign: [],
  };
  const change = ["another device changed"];
  // the four non-stopped combinations: 0, own side restored, no foreign — 0, HOST_RESTORED green
  assert.deepEqual(launchExit(ran), { code: 0, lines: [] });
  // 0, own side restored, another's change — HOST-RESTORED unprovable: 75, relaunch on a quiet host, the change named
  const theirs = launchExit({ ...ran, foreign: change });
  assert.equal(theirs.code, NOT_ARMED);
  assert.equal(theirs.lines.length, 1);
  assert.match(
    theirs.lines[0],
    /^PHONE_HOST_UNPROVEN .*another device changed.*HOST-RESTORED is unprovable.*relaunch on a quiet host/u,
  );
  // every change is named, in the one line
  const two = launchExit({ ...ran, foreign: [...change, "Simulator.app: refused: not the run's"] });
  assert.equal(two.lines.length, 1);
  assert.match(two.lines[0], /another device changed; Simulator\.app: refused: not the run's/u);
  // a PHONE_HOST_UNPROVEN line is mirrored into `<run>-stage.log`, as the stop's exit lines are (S-2)
  const mirrored = [];
  const stage = hostDeps(createRedactor(), { write: () => {}, mirror: (l) => mirrored.push(l) });
  stage.say(theirs.lines[0]);
  assert.deepEqual(mirrored, [`${theirs.lines[0]}\n`]);
  // 0 over an unrestored own side — 1, with or without another's change, and no line of it
  assert.deepEqual(launchExit({ ...ran, restored: false }), { code: 1, lines: [] });
  assert.deepEqual(launchExit({ ...ran, restored: false, foreign: change }), {
    code: 1,
    lines: [],
  });
  // the command's non-zero code is kept beside another's change: a red row is a red row
  assert.deepEqual(launchExit({ ...ran, code: 3, foreign: change }), { code: 3, lines: [] });
  assert.deepEqual(launchExit({ ...ran, code: 1, foreign: change }), { code: 1, lines: [] });
  // the precedence otherwise unchanged: past the deadline 1; a signal 128+n — each over another's change
  assert.deepEqual(launchExit({ ...ran, deadlineHit: true, foreign: change }), {
    code: 1,
    lines: [],
  });
  assert.deepEqual(launchExit({ ...ran, signal: 15, foreign: change }), { code: 143, lines: [] });
  // the STOP paths unchanged (RM6): a transient stop over a restored own side is 75 and says nothing more; a final one
  // is 1 and PHONE_STOP_FINAL; an unrestored one 1 and PHONE_STOP_UNRESTORED — another's change adds no line to any
  const hand = { why: "a hand at the Mac before SIM-LIVE", final: false };
  const reset = { why: "SIM-STAGED: HID moved by the run's own input — RM4.5", final: true };
  assert.deepEqual(launchExit({ ...ran, stopped: hand, foreign: change }), {
    code: NOT_ARMED,
    lines: [],
  });
  assert.deepEqual(launchExit({ ...ran, stopped: reset, foreign: change }), {
    code: 1,
    lines: [`PHONE_STOP_FINAL ${reset.why}`],
  });
  const unrestored = launchExit({ ...ran, stopped: hand, restored: false, foreign: change });
  assert.equal(unrestored.code, 1);
  assert.deepEqual(
    unrestored.lines.map((line) => line.split(" ")[0]),
    ["PHONE_STOP_UNRESTORED"],
  );
});

test("a run that never stopped while another booted a device: HOST_RESTORED red, the exit 75 and PHONE_HOST_UNPROVEN — never 0 (RM7.1)", async () => {
  const ctx = {
    deleteDevices: false,
    defaultsBefore: "",
    crashDir: join(FIXTURES, "no-crash-reports-here"),
    crashBefore: [],
  };
  // no press after the boot: the fence never read it mid-run, so the run did not stop — teardown finds it
  const run = ownRun();
  run.othersAtArm.set(FOREIGN, "Shutdown");
  const host = fakeHost({ list: hostList([{ udid: FOREIGN, state: "Booted" }]) });
  const verdict = await restoreHost(run, host.deps, ctx);
  assert.equal(run.stopped, null);
  assert.equal(verdict.ownOk, true);
  assert.deepEqual(verdict.foreign, ["another device changed"]);
  assert.match(
    host.said.find((line) => line.startsWith("PHONE_HOST_RESTORED ")),
    /"ok":false/u,
  );
  const exit = launchExit({
    signal: null,
    stopped: run.stopped,
    deadlineHit: false,
    code: 0,
    restored: verdict.ownOk,
    foreign: verdict.foreign,
  });
  assert.equal(exit.code, NOT_ARMED);
  assert.equal(exit.lines.length, 1);
  assert.match(exit.lines[0], /^PHONE_HOST_UNPROVEN .*another device changed/u);
  // the OBSERVATION is kept beside it, and neither line holds a UDID
  assert.equal(host.said.filter((line) => line.startsWith("PHONE_OBSERVATION ")).length, 1);
  assert.ok(!holdsUdid(host.said.join("\n")) && !holdsUdid(exit.lines[0]));
  // control: the same run over a quiet host is 0
  const quiet = ownRun();
  quiet.othersAtArm.set(FOREIGN, "Shutdown");
  const calm = await restoreHost(quiet, fakeHost().deps, ctx);
  assert.deepEqual(
    launchExit({
      signal: null,
      stopped: null,
      deadlineHit: false,
      code: 0,
      restored: calm.ownOk,
      foreign: calm.foreign,
    }),
    { code: 0, lines: [] },
  );
});

test("preflightLines: one line per failure, its fix named; ok alone when none", () => {
  assert.deepEqual(preflightLines([]), ["PHONE_PREFLIGHT ok"]);
  assert.deepEqual(preflightLines(nativeFresh({ helper: null, adapter: 9, sources: 1 })), [
    "PHONE_PREFLIGHT FAIL the capture helper (live-surface-capture-helper): missing → pnpm --filter @vibefield/desktop build:live-surfaces-native",
  ]);
});

test("newestMtime: a directory's newest file at any depth (.DS_Store aside); null when absent", () => {
  const tree = {
    "/d": { dir: true },
    "/d/a.js": { mtimeMs: 10 },
    "/d/sub": { dir: true },
    "/d/sub/b.js": { mtimeMs: 30 },
    "/d/.DS_Store": { mtimeMs: 99 },
  };
  const fs = {
    statSync: (path) => {
      const node = tree[path];
      if (node === undefined) throw new Error("ENOENT");
      return { isDirectory: () => node.dir === true, mtimeMs: node.mtimeMs };
    },
    readdirSync: () => [
      { name: "a.js", parentPath: "/d", isFile: () => true },
      { name: "sub", parentPath: "/d", isFile: () => false },
      { name: "b.js", parentPath: "/d/sub", isFile: () => true },
      { name: ".DS_Store", parentPath: "/d", isFile: () => true },
    ],
  };
  assert.equal(newestMtime("/d", fs), 30);
  assert.equal(newestMtime("/d/a.js", fs), 10);
  assert.equal(newestMtime("/nope", fs), null);
});

// ─── the HID record ───────────────────────────────────────────────────────────────────────────────────────────────────

test("parseLocked and parseIdle on ioreg's own output: locked Yes/No (absent is No), idle in whole seconds", () => {
  assert.equal(parseLocked(fixture("ioreg-root-unlocked.txt")), "No");
  assert.equal(parseLocked(fixture("ioreg-root-locked.txt")), "Yes");
  // the note's probe reads CGSSessionScreenIsLocked alone, never IOConsoleLocked
  assert.equal(parseLocked('"IOConsoleLocked" = Yes'), "No");
  assert.equal(parseIdle(fixture("ioreg-hidsystem.txt")), 187);
  // the first HIDIdleTime, as the note's awk (`exit` after the first)
  assert.equal(parseIdle('"HIDIdleTime" = 2999999999\n"HIDIdleTime" = 900000000000'), 2);
  assert.equal(parseIdle(fixture("ioreg-root-unlocked.txt")), null);
});

test("probeHid: the two ioreg probes, read through exec; a failed probe reads unknown, never armed", async () => {
  const at = Date.UTC(2026, 9, 31, 1, 1, 4);
  const deps = {
    now: () => at,
    exec: async (file, args) => {
      assert.equal(file, "/usr/sbin/ioreg");
      return ok(
        args[0] === "-n" ? fixture("ioreg-root-unlocked.txt") : fixture("ioreg-hidsystem.txt"),
      );
    },
  };
  assert.deepEqual(await probeHid(deps), { at, locked: "No", idle: 187 });
  const failed = await probeHid({
    now: () => at,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  });
  assert.deepEqual(failed, { at, locked: "?", idle: null });
});

test("hidLines: the note's two lines, byte for byte", () => {
  const lines = hidLines(
    { at: Date.UTC(2026, 9, 31, 1, 1, 4), locked: "Yes", idle: 1595 },
    { at: Date.UTC(2026, 9, 31, 1, 5, 39), locked: "Yes", idle: 1871 },
  );
  assert.deepEqual(lines, [
    "01:01:04Z console: locked Yes; HID idle 1595s",
    "01:05:39Z END console: locked Yes; HID idle 1871s",
  ]);
});

test("rowVerdict: a begin goes on an untouched unlocked console; input since the last sample is a hand and STOPS", () => {
  const last = { at: ARMED, locked: "No", idle: 300 };
  assert.deepEqual(
    rowVerdict({ name: "SIM-LIVE", sample: { at: ARMED + 40_000, locked: "No", idle: 340 }, last }),
    { go: true },
  );
  const hand = rowVerdict({
    name: "SIM-LIVE",
    sample: { at: ARMED + 40_000, locked: "No", idle: 12 },
    last,
  });
  assert.equal(hand.stop, true);
  assert.equal(hand.hand, true);
  assert.match(hand.why, /a hand at the Mac before SIM-LIVE: HID idle 12s < 40s/u);
  const locked = rowVerdict({
    name: "SIM-LIVE",
    sample: { at: ARMED + 40_000, locked: "Yes", idle: 340 },
    last,
  });
  assert.equal(locked.stop, true);
  assert.equal(locked.hand, undefined);
  assert.equal(
    rowVerdict({ name: "X", sample: { at: ARMED, locked: "?", idle: null }, last }).stop,
    true,
  );
});

test("endVerdict: VOID when END idle is under the row's seconds or END reads locked; at the first input row, RM4.5", () => {
  const began = { at: ARMED, locked: "No", idle: 300 };
  assert.deepEqual(
    endVerdict({ name: "SIM-USE", sample: { at: ARMED + 30_000, locked: "No", idle: 330 }, began }),
    { ok: true, secs: 30 },
  );
  const hand = endVerdict({
    name: "SIM-USE",
    sample: { at: ARMED + 30_000, locked: "No", idle: 4 },
    began,
  });
  assert.equal(hand.void, true);
  assert.equal(hand.hand, true);
  assert.match(hand.why, /a hand at the Mac mid-row: SIM-USE's END idle 4s < its 30s/u);
  const locked = endVerdict({
    name: "SIM-USE",
    sample: { at: ARMED + 30_000, locked: "Yes", idle: 330 },
    began,
  });
  assert.equal(locked.void, true);
  assert.match(locked.why, /END reads locked Yes/u);
  const own = endVerdict({
    name: "SIM-SHOW-FRESH",
    sample: { at: ARMED + 30_000, locked: "No", idle: 1 },
    began,
    firstInput: true,
  });
  assert.equal(own.stop, true);
  assert.equal(own.why, "HID moved by the run's own input — RM4.5");
});

test("hidSummary: ARMED and END idle, and whether a hand was at the Mac", () => {
  const armed = { at: ARMED, locked: "No", idle: 300 };
  assert.equal(
    hidSummary({ armed, end: { at: ARMED + 600_000, idle: 900 }, armedAt: ARMED, hands: 0 }),
    "HID: ARMED 300s; END 900s; a hand at the Mac: no",
  );
  assert.equal(
    hidSummary({ armed, end: { at: ARMED + 600_000, idle: 30 }, armedAt: ARMED, hands: 0 }),
    "HID: ARMED 300s; END 30s; a hand at the Mac: YES",
  );
  assert.equal(
    hidSummary({ armed, end: { at: ARMED + 600_000, idle: 900 }, armedAt: ARMED, hands: 1 }),
    "HID: ARMED 300s; END 900s; a hand at the Mac: YES",
  );
});

// ─── arming ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const CLEAR = {
  hidWaived: false,
  requireApp: false,
  hid: { locked: "No", idle: 300 },
  guard: 0,
  perfLock: false,
  disks: [
    { path: "/Volumes/SamsungRed", gib: 15, freeGiB: 200 },
    { path: "/", gib: 10, freeGiB: 48 },
  ],
  simulator: 0,
  xcodebuild: 0,
  simctl: 0,
  developerDir: { dir: XCODE_DEVELOPER_DIR, by: "fallback" },
  fence: { clear: true, busy: 0 },
  types: { runtime: RT26, types: CATALOG.slice(2, 6) },
  ownLeft: 0,
  app: "/System/Applications/Utilities/Terminal.app",
};

test("armGate: every gate clear arms; each one failing is named and NOT ARMED", () => {
  assert.deepEqual(armGate(CLEAR), { armed: true, why: [] });
  const cases = [
    [{ hid: { locked: "Yes", idle: 300 } }, /the console is locked \(Yes\)/u],
    [{ hid: { locked: "No", idle: 119 } }, /someone is at the Mac \(HID idle 119s < 120s\)/u],
    [{ hid: { locked: "?", idle: null } }, /HID unreadable/u],
    [{ guard: 1 }, /the guard stops on 1 process/u],
    [{ guard: null }, /the guard is unreadable/u],
    [{ perfLock: true }, /PERF\.lock is held/u],
    [{ disks: [{ path: "/", gib: 10, freeGiB: 9 }] }, /\/ has 9 GiB free \(< 10\)/u],
    [{ simulator: 1 }, /Simulator\.app is running/u],
    [{ xcodebuild: 2 }, /2 xcodebuild process/u],
    [{ simctl: 1 }, /1 simctl process/u],
    [{ developerDir: null }, /no developer dir holds simctl/u],
    [
      { fence: { clear: false, busy: 2 } },
      /the fence: 2 device\(s\) Booted, Booting or ShuttingDown/u,
    ],
    [{ types: null }, /fewer than 4 catalog iPhone types/u],
    [{ ownLeft: 2 }, /2 device\(s\) of this run's name exist/u],
    [{ requireApp: true, app: null }, /no \.app ancestor.*STOP before ENUM/u],
    [{ cpuIdle: 0.4 }, /the CPU is 40% idle/u],
  ];
  for (const [change, why] of cases) {
    const gate = armGate({ ...CLEAR, ...change });
    assert.equal(gate.armed, false, JSON.stringify(change));
    assert.equal(gate.why.length, 1, JSON.stringify(gate.why));
    assert.match(gate.why[0], why);
  }
});

test("armGate on ioreg's own output: a locked console never arms; ENUM waives the HID gate and needs a .app", () => {
  const read = (root) => ({
    locked: parseLocked(fixture(root)),
    idle: parseIdle(fixture("ioreg-hidsystem.txt")),
  });
  assert.equal(armGate({ ...CLEAR, hid: read("ioreg-root-unlocked.txt") }).armed, true);
  assert.deepEqual(armGate({ ...CLEAR, hid: read("ioreg-root-locked.txt") }).why, [
    "the console is locked (Yes)",
  ]);
  // ENUM: James is AT the screen (locked or touched is no bar), but no .app ancestor STOPS before it
  assert.equal(
    armGate({ ...CLEAR, hidWaived: true, requireApp: true, hid: { locked: "Yes", idle: 0 } }).armed,
    true,
  );
  assert.equal(armGate({ ...CLEAR, hidWaived: true, requireApp: true, app: null }).armed, false);
  // a launch prints the chain, and arms without a .app ancestor
  assert.equal(armGate({ ...CLEAR, app: null }).armed, true);
});

test("pickDeveloperDir: P1's rule — xcode-select's answer with simctl, else the default Xcode's; garbage is none", () => {
  const xcode = `${XCODE_DEVELOPER_DIR}/usr/bin/simctl`;
  const has =
    (...paths) =>
    (path) =>
      paths.includes(path);
  assert.deepEqual(pickDeveloperDir("/Library/Developer/CommandLineTools\n", has(xcode)), {
    dir: XCODE_DEVELOPER_DIR,
    by: "fallback",
  });
  assert.equal(pickDeveloperDir("/Library/Developer/CommandLineTools\n", has()), null);
  assert.deepEqual(pickDeveloperDir(`${XCODE_DEVELOPER_DIR}\n`, has(xcode)), {
    dir: XCODE_DEVELOPER_DIR,
    by: "xcode-select",
  });
  for (const garbage of ["", "\n", "Developer", `/a${"x".repeat(1_100)}`, "/Library/\u0007Dev"])
    assert.equal(pickDeveloperDir(garbage, has(xcode)), null, JSON.stringify(garbage).slice(0, 40));
});

// ─── simctl's list, the fence and the run's own types ─────────────────────────────────────────────────────────────────

test("parseList keeps every device, available or not; fenceClear counts Booted, Booting and ShuttingDown alike", () => {
  const list = parseList(
    simctlList({
      devices: [
        { udid: FOREIGN, name: "iPhone 11", type: CATALOG[0], state: "Booted" },
        {
          udid: FOREIGN_GONE,
          name: "Old",
          type: CATALOG[1],
          state: "Booted",
          available: false,
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-0",
        },
        { udid: OWN[0], name: "pts3-l2-t1-1", type: CATALOG[2], state: "Booting" },
        { udid: OWN[1], name: "pts3-l2-t1-2", type: CATALOG[3], state: "Shutdown" },
        { udid: OWN[2], name: "pts3-l2-t1-3", type: CATALOG[4], state: "ShuttingDown" },
      ],
    }),
  );
  assert.equal(list.devices.length, 5);
  assert.equal(list.devices.find((d) => d.udid === FOREIGN_GONE).available, false);
  assert.deepEqual(fenceClear(list), { clear: false, busy: 4 });
  // the run's own devices are its own; the unavailable foreign one still fences
  assert.deepEqual(fenceClear(list, new Set(OWN)), { clear: false, busy: 2 });
  const quiet = parseList(
    simctlList({
      devices: [
        { udid: FOREIGN, name: "iPhone 11", type: CATALOG[0], state: "Shutdown" },
        { udid: OWN[0], name: "pts3-l2-t1-1", type: CATALOG[2], state: "Booted" },
      ],
    }),
  );
  assert.deepEqual(fenceClear(quiet, new Set([OWN[0]])), { clear: true, busy: 0 });
  assert.throws(() => parseList('{"devices":[]}'), /not a device list/u);
});

test("catalogIds: the plugin's catalog read as text gives at least four distinct iPhone types", () => {
  assert.deepEqual(
    catalogIds(
      '  {\n    id: "com.apple.CoreSimulator.SimDeviceType.iPhone-6s",\n    name: "iPhone 6s",\n  },\n  { id: "x" }',
    ),
    [T("iPhone-6s")],
  );
  const ids = catalogIds(
    readFileSync(
      join(import.meta.dirname, "../../../plugins/simulator/src/catalog.gen.ts"),
      "utf8",
    ),
  );
  assert.ok(ids.length >= 4, `${ids.length} ids`);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-/u);
});

test("pickOwnTypes: zero-device catalog types only, the first four sorted, of the newest iOS runtime that has four", () => {
  const all = [...CATALOG, T("iPhone-Duo")];
  const list = parseList(
    simctlList({
      devices: [
        { udid: FOREIGN, name: "iPhone 11", type: CATALOG[0], state: "Shutdown" },
        // a device of an uninstalled runtime, unavailable: its type still has a device
        {
          udid: FOREIGN_GONE,
          name: "Old",
          type: CATALOG[1],
          available: false,
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-0",
        },
      ],
      runtimes: [
        runtime(RT26, "26.5", all),
        runtime(RT27, "27.1", all),
        runtime("com.apple.CoreSimulator.SimRuntime.iOS-28-0", "28.0", all, false),
        runtime("com.apple.CoreSimulator.SimRuntime.watchOS-12-0", "99.0", all),
      ],
    }),
  );
  const picked = pickOwnTypes(list, CATALOG);
  // RM4.1: the runtime is the newest INSTALLED iOS one — here 27.1, never a literal 26.5
  assert.equal(picked.runtime, RT27);
  assert.deepEqual(picked.types, [T("iPhone-13"), T("iPhone-14"), T("iPhone-15"), T("iPhone-16")]);
  // a type with any device, of any runtime, or outside the catalog, is never chosen
  assert.ok(!picked.types.includes(CATALOG[0]));
  assert.ok(!picked.types.includes(CATALOG[1]));
  assert.ok(!picked.types.includes(T("iPhone-Duo")));
  // the newest that supports four: 27.1 supports three, so 26.5
  const three = parseList(
    simctlList({
      runtimes: [runtime(RT26, "26.5", CATALOG), runtime(RT27, "27.1", CATALOG.slice(0, 3))],
    }),
  );
  assert.equal(pickOwnTypes(three, CATALOG).runtime, RT26);
  // fewer than four zero-device types anywhere: none
  const used = parseList(
    simctlList({
      devices: CATALOG.slice(0, 4).map((type, i) => ({ udid: `${i}`, name: `d${i}`, type })),
    }),
  );
  assert.equal(pickOwnTypes(used, CATALOG), null);
});

// ─── the redactor ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("redact: a planted own and a planted foreign UDID never survive, in either case, and each hit is counted by kind", () => {
  const r = createRedactor();
  r.own(OWN[0], 1);
  r.foreign(FOREIGN);
  r.foreign(FOREIGN_GONE);
  r.foreign(FOREIGN); // known once
  const line = r.line(`booted ${OWN[0]} beside ${FOREIGN.toLowerCase()} and ${FOREIGN_GONE}`);
  assert.equal(line, "booted <pts3-dev-1> beside <host-dev-1> and <host-dev-2>");
  assert.equal(r.line(`PHONE_STOP ${OWN[0]}`, "driver"), "PHONE_STOP <pts3-dev-1>");
  // a renderer word: known UDIDs by label, any other UUID shape swept
  const words = r.line(
    `PHONE_WORDS {"row":"${OWN[0].toLowerCase()}","x":"0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"}`,
  );
  assert.equal(words, 'PHONE_WORDS {"row":"<pts3-dev-1>","x":"<uuid>"}');
  assert.deepEqual(r.counts(), {
    words: { own: 1, foreign: 0, uuid: 1 },
    main: { own: 1, foreign: 2 },
    driver: { own: 1, foreign: 0 },
  });
  assert.ok(!holdsUdid(`${line}${words}`));
  // an own device made after a foreign read keeps its own label
  const late = createRedactor();
  late.foreign(OWN[1]);
  late.own(OWN[1], 2);
  assert.equal(late.line(OWN[1]), "<pts3-dev-2>");
});

test("redactStream: a UDID split across two chunks is whole before it is matched, and counted once", () => {
  const r = createRedactor();
  r.own(OWN[0], 1);
  r.foreign(FOREIGN);
  const out = [];
  const stream = redactStream(r, "main", (line) => out.push(line));
  stream.push(`one ${OWN[0].slice(0, 13)}`);
  stream.push(`${OWN[0].slice(13)} two\nthree ${FOREIGN.slice(0, 20)}`);
  assert.deepEqual(out, ["one <pts3-dev-1> two\n"]);
  stream.push(`${FOREIGN.slice(20)}\nPHONE_WORDS ${OWN[0].slice(0, 8)}`);
  stream.push(`${OWN[0].slice(8)}`);
  stream.end();
  assert.deepEqual(out, [
    "one <pts3-dev-1> two\n",
    "three <host-dev-1>\n",
    "PHONE_WORDS <pts3-dev-1>\n",
  ]);
  assert.ok(!holdsUdid(out.join("")));
  assert.ok(!out.join("").includes(OWN[0].slice(0, 8)));
  assert.deepEqual(r.counts(), {
    words: { own: 1, foreign: 0, uuid: 0 },
    main: { own: 1, foreign: 1 },
    driver: { own: 0, foreign: 0 },
  });
});

test("defaultsChange: Simulator's defaults compared raw; the changed lines said redacted, no UDID, never counted", () => {
  const r = createRedactor();
  r.own(OWN[0], 1);
  const before = `{\n    CurrentDeviceUDID = "${FOREIGN_GONE}";\n    ShowChrome = 1;\n}`;
  const after = `{\n    CurrentDeviceUDID = "${OWN[0]}";\n    ShowChrome = 1;\n}`;
  assert.deepEqual(defaultsChange(before, before, r.scrub), { changed: false, lines: [] });
  const change = defaultsChange(before, after, r.scrub);
  assert.equal(change.changed, true);
  assert.deepEqual(change.lines, [
    '-     CurrentDeviceUDID = "<uuid>";',
    '+     CurrentDeviceUDID = "<pts3-dev-1>";',
  ]);
  assert.ok(!holdsUdid(JSON.stringify(change)));
  assert.deepEqual(r.counts().driver, { own: 0, foreign: 0 });
  assert.equal(defaultsChange(null, after, r.scrub).changed, false);
});

// ─── the rows record ──────────────────────────────────────────────────────────────────────────────────────────────────

test("rowsMark and rowsVerdict: BEGIN and END said, the mode's, and END's count the rows the door saw", () => {
  assert.deepEqual(rowsMark("x PHONE_ROWS_BEGIN mode=devices"), { begin: "devices" });
  assert.deepEqual(rowsMark("PHONE_ROWS_END n=17"), { end: 17 });
  assert.equal(rowsMark("PHONE_ROWS n=17"), null);
  // the mode's count, exact (§2: "whose k is not the mode's count"); smoke-phone.test.ts holds PHONE_ROWS to it (R16)
  assert.deepEqual(MODE_ROWS, { none: 2, devices: 20, cost: 1 });
  assert.equal(rowsVerdict({ mode: "devices", begin: "devices", end: 20, served: 20 }).ok, true);
  assert.match(
    rowsVerdict({ mode: "devices", begin: "devices", end: 19, served: 19 }).why,
    /19 row\(s\): devices runs 20/u,
  );
  assert.equal(rowsVerdict({ mode: "devices", begin: "devices", end: 21, served: 21 }).ok, false);
  assert.match(
    rowsVerdict({ mode: "devices", begin: null, end: null, served: 0 }).why,
    /--phone is not in this build/u,
  );
  assert.match(rowsVerdict({ mode: "none", begin: "devices", end: 2, served: 2 }).why, /not none/u);
  assert.match(
    rowsVerdict({ mode: "none", begin: "none", end: null, served: 1 }).why,
    /never finished/u,
  );
  assert.match(rowsVerdict({ mode: "none", begin: "none", end: 2, served: 1 }).why, /door saw 1/u);
  assert.match(
    rowsVerdict({ mode: "devices", begin: "devices", end: 9, served: 9 }).why,
    /devices runs 20/u,
  );
});

// ─── Simulator.app: quit only when proven the run's ───────────────────────────────────────────────────────────────────

test("parseLstart reads ps's local start to the second", () => {
  assert.equal(parseLstart(lstartOf(ARMED)), Math.floor(ARMED / 1000) * 1000);
  assert.equal(parseLstart("yesterday"), null);
});

test("simulatorProof: one Simulator, the vetted Xcode's, started after ARMED and after the run's launch since its last quit — or not the run's", () => {
  const proof = {
    pids: [4242],
    comm: SIM_EXE,
    lstart: lstartOf(ARMED + 60_000),
    devDir: XCODE_DEVELOPER_DIR,
    armedAt: ARMED,
    launchedAt: ARMED + 30_000,
  };
  assert.deepEqual(simulatorProof(proof), { running: 1, own: true, pid: 4242 });
  assert.equal(simulatorProof({ ...proof, pids: [] }).running, 0);
  const why = (change) => simulatorProof({ ...proof, ...change }).why;
  assert.match(why({ pids: [4242, 4243] }), /2 Simulator processes run/u);
  assert.match(
    why({
      comm: "/Applications/Xcode-beta.app/Contents/Developer/Applications/Simulator.app/Contents/MacOS/Simulator",
    }),
    /not the vetted Xcode's/u,
  );
  assert.match(why({ lstart: lstartOf(ARMED - 60_000) }), /started before ARMED/u);
  // ARMED's own second, before ARMED: lstart's whole second is not after it
  assert.match(why({ lstart: lstartOf(ARMED - 400) }), /started before ARMED/u);
  assert.match(why({ lstart: "" }), /unreadable/u);
  assert.match(
    why({ launchedAt: null }),
    /the run launched no Simulator\.app since its last quit/u,
  );
  // S7: a Simulator.app started before the run's launch is another's, whatever the run launched before
  assert.match(why({ launchedAt: ARMED + 120_000 }), /started before the run's launch/u);
  // lstart keeps whole seconds: a start in the launch's own second is the run's
  assert.equal(simulatorProof({ ...proof, launchedAt: ARMED + 60_000 }).own, true);
  // the vetted executable by its real path is still the vetted one
  assert.equal(
    simulatorProof({
      ...proof,
      comm: "/Volumes/X/Xcode.app/Simulator",
      realExe: "/Volumes/X/Xcode.app/Simulator",
    }).own,
    true,
  );
});

// ─── the host door ────────────────────────────────────────────────────────────────────────────────────────────────────

test("doorAct: P6's verbs, state and quit-app only — anything else refused and counted", async () => {
  const run = ownRun();
  const { deps, calls } = fakeHost();
  for (const verb of [
    "create",
    "delete",
    "erase",
    "clone",
    "launch",
    "terminate",
    "spawn",
    "openURL",
    undefined,
  ]) {
    const r = await doorAct({ verb, device: 1 }, run, deps);
    assert.equal(r.status, 403, String(verb));
    assert.equal(r.body.state, "refused");
  }
  assert.equal(run.refused.verb, 9);
  assert.deepEqual(calls, []);
  assert.deepEqual(await doorAct({ verb: "state", device: 2 }, run, deps), {
    status: 200,
    type: "json",
    body: { n: 2, state: "Shutdown" },
  });
  assert.equal((await doorAct({ verb: "quit-app" }, run, deps)).body.state, "not-running");
});

test("doorAct: a device that is not the run's own is refused — the no-device type, a string, none", async () => {
  const run = ownRun();
  const { deps, calls } = fakeHost();
  for (const device of [0, 4, 5, "1", null, 1.5, undefined])
    assert.equal((await doorAct({ verb: "boot", device }, run, deps)).status, 403, String(device));
  assert.equal(run.refused.device, 7);
  assert.deepEqual(calls, []);
  // `none` mode makes no device: every device verb is refused
  const none = ownRun("none");
  assert.equal((await doorAct({ verb: "state", device: 1 }, none, deps)).status, 403);
});

test("doorAct: boot, shutdown and openurl run on the own UDID with DEVELOPER_DIR pinned to the vetted dir", async () => {
  const run = ownRun();
  const { deps, calls } = fakeHost();
  assert.equal((await doorAct({ verb: "boot", device: 1 }, run, deps)).status, 200);
  assert.deepEqual(calls[0].args, ["simctl", "boot", OWN[0]]);
  assert.equal(calls[0].file, "/usr/bin/xcrun");
  assert.equal(calls[0].env.DEVELOPER_DIR, XCODE_DEVELOPER_DIR);
  const url = `http://127.0.0.1:51234/motion?n=ff8800&t=${run.token}`;
  assert.deepEqual(
    (
      await doorAct(
        { verb: "openurl", device: 3, url: "http://127.0.0.1:51234/motion?n=ff8800" },
        run,
        deps,
      )
    ).body,
    {
      n: 3,
      state: "opened",
    },
  );
  const open = calls.find((c) => c.args[1] === "openurl");
  assert.deepEqual(open.args, ["simctl", "openurl", OWN[2], url]);
  assert.equal(open.env.DEVELOPER_DIR, XCODE_DEVELOPER_DIR);
});

test("doorAct openurl: only this door's own origin, /motion or /still, a nonce — another port, path or host refused", async () => {
  const run = ownRun();
  const { deps, calls } = fakeHost();
  for (const url of [
    "http://127.0.0.1:51235/motion?n=ff8800",
    "http://127.0.0.1:51234/act?n=ff8800",
    "http://127.0.0.1:51234/motion/../row?n=ff8800",
    "http://localhost:51234/motion?n=ff8800",
    "https://127.0.0.1:51234/motion?n=ff8800",
    "http://127.0.0.1:51234/motion?n=ff8800&next=https://example.com",
    "http://127.0.0.1:51234/motion?n=zzzzzz",
    "http://127.0.0.1:51234/motion?n=ff8800&t=not-the-token",
    "http://user@127.0.0.1:51234/motion?n=ff8800",
    "javascript:alert(1)",
    42,
  ]) {
    const r = await doorAct({ verb: "openurl", device: 1, url }, run, deps);
    assert.equal(r.status, 403, String(url));
  }
  assert.equal(run.refused.openurl, 11);
  assert.deepEqual(calls, []);
  assert.equal(
    canonicalPage("http://127.0.0.1:51234/still?n=00ff00", run),
    `${run.origin}/still?n=00ff00&t=${run.token}`,
  );
});

test("doorAct screenshot: a NEW .png inside the shot dir — outside, existing, `-` or another kind refused", async () => {
  const run = ownRun();
  const existing = `${SHOTS}/live-1.png`;
  const { deps, calls } = fakeHost({ files: [existing] });
  for (const file of [
    "../out.png",
    "/tmp/out.png",
    "-",
    "-.png",
    "out.jpg",
    "live-1.png",
    "nested/out.png",
    "",
    null,
  ])
    assert.equal(
      (await doorAct({ verb: "screenshot", device: 1, file }, run, deps)).status,
      403,
      String(file),
    );
  assert.equal(run.refused.screenshot, 9);
  assert.deepEqual(calls, []);
  assert.equal(
    (await doorAct({ verb: "screenshot", device: 1, file: "live-2.png" }, run, deps)).body.state,
    "written",
  );
  assert.deepEqual(calls[0].args, ["simctl", "io", OWN[0], "screenshot", `${SHOTS}/live-2.png`]);
});

test("doorAct show-app: the fence first; open -a the vetted Simulator.app on an own UDID; refused beside a foreign app", async () => {
  const run = ownRun();
  const host = fakeHost();
  assert.equal(
    (await doorAct({ verb: "show-app", device: 2 }, run, host.deps)).body.state,
    "shown",
  );
  const open = host.calls.find((c) => c.file === "/usr/bin/open");
  assert.deepEqual(open.args, [
    "-a",
    `${XCODE_DEVELOPER_DIR}/Applications/Simulator.app`,
    "--args",
    "-CurrentDeviceUDID",
    OWN[1],
  ]);
  assert.equal(open.env.DEVELOPER_DIR, XCODE_DEVELOPER_DIR);
  assert.equal(run.simulator.shown, 1);
  // the list was read (the fence) before the open
  assert.ok(host.calls.findIndex((c) => c.args[1] === "list") < host.calls.indexOf(open));
  // a Simulator.app running that the run never launched: refused, nothing opened
  const fresh = ownRun();
  const foreignApp = fakeHost({ pgrep: "777" });
  const r = await doorAct({ verb: "show-app", device: 1 }, fresh, foreignApp.deps);
  assert.equal(r.status, 409);
  assert.equal(foreignApp.calls.filter((c) => c.file === "/usr/bin/open").length, 0);
  // a foreign device booted mid-run: STOP, nothing opened
  const fenced = ownRun();
  const booted = fakeHost({ list: hostList([{ udid: FOREIGN, state: "Booted" }]) });
  assert.equal(
    (await doorAct({ verb: "show-app", device: 1 }, fenced, booted.deps)).body.state,
    "stop",
  );
  assert.match(fenced.stopped.why, /the fence: 1 foreign device\(s\) booted mid-run/u);
  assert.equal(booted.calls.filter((c) => c.file === "/usr/bin/open").length, 0);
});

test("doorAct quit-app: refused and STOPPED for a start before ARMED or a foreign path; SIGTERM only when proven", async () => {
  const early = ownRun();
  early.simulator.shown = 1;
  const before = fakeHost({ pgrep: "4242", lstart: lstartOf(ARMED - 60_000) });
  const r1 = await doorAct({ verb: "quit-app" }, early, before.deps);
  assert.equal(r1.status, 409);
  assert.equal(r1.body.state, "stop");
  assert.match(early.stopped.why, /started before ARMED/u);
  assert.deepEqual(before.killed, []);
  const elsewhere = ownRun();
  elsewhere.simulator.shown = 1;
  const foreign = fakeHost({
    pgrep: "4242",
    comm: "/Users/runner/Applications/Xcode-26.4.app/Contents/Developer/Applications/Simulator.app/Contents/MacOS/Simulator",
  });
  assert.equal((await doorAct({ verb: "quit-app" }, elsewhere, foreign.deps)).body.state, "stop");
  assert.match(elsewhere.stopped.why, /not the vetted Xcode's/u);
  assert.deepEqual(foreign.killed, []);
  const never = ownRun();
  const unlaunched = fakeHost({ pgrep: "4242" });
  assert.equal((await doorAct({ verb: "quit-app" }, never, unlaunched.deps)).body.state, "stop");
  assert.deepEqual(unlaunched.killed, []);
  const own = ownRun();
  own.simulator.pressed = 1;
  own.simulator.launchedAt = ARMED + 30_000;
  const proven = fakeHost({ pgrep: "4242" });
  assert.deepEqual((await doorAct({ verb: "quit-app" }, own, proven.deps)).body, {
    n: null,
    state: "quit",
  });
  assert.deepEqual(proven.killed, [{ pid: 4242, signal: "SIGTERM" }]);
  assert.equal(own.stopped, null);
  // its launch is spent with it
  assert.equal(own.simulator.launchedAt, null);
  // never osascript: every spawn was ps, pgrep or simctl's list
  assert.deepEqual([...new Set(proven.calls.map((c) => c.file))].sort(), [
    "/bin/ps",
    "/usr/bin/pgrep",
    "/usr/bin/xcrun",
  ]);
});

test("doorAct quit-app: after the run quit its own app, a Simulator.app another tool starts is never the run's (S7)", async () => {
  const run = ownRun();
  run.simulator.shown = 1;
  run.simulator.launchedAt = ARMED + 10_000;
  const first = fakeHost({ pgrep: "4242", lstart: lstartOf(ARMED + 20_000) });
  assert.equal((await doorAct({ verb: "quit-app" }, run, first.deps)).body.state, "quit");
  assert.equal(run.simulator.quits, 1);
  // 300 s after ARMED another launcher starts the vetted Simulator.app: the run launched nothing since its quit
  const later = fakeHost({ pgrep: "4243", lstart: lstartOf(ARMED + 300_000) });
  const r = await doorAct({ verb: "quit-app" }, run, later.deps);
  assert.equal(r.body.state, "stop");
  assert.match(run.stopped.why, /launched no Simulator\.app since its last quit/u);
  assert.deepEqual(later.killed, []);
  // a press through the gate after the quit is the run's launch again: an app started from it is the run's
  const again = ownRun();
  again.simulator.quits = 1;
  again.last = { at: ARMED, locked: "No", idle: 300 };
  const host = fakeHost({
    samples: [{ at: ARMED + 10_000, locked: "No", idle: 310 }],
    pgrep: null,
  });
  await doorRow({ name: "SIM-STOPPED", phase: "begin" }, again, host.deps);
  await doorRow(
    { name: "SIM-STOPPED", phase: "press", act: "retry", device: `pts3-${RUN}-1` },
    again,
    host.deps,
  );
  assert.equal(again.simulator.launchedAt, ARMED + 120_000);
  host.state.pgrep = "4244";
  host.state.lstart = lstartOf(ARMED + 125_000);
  assert.equal((await doorAct({ verb: "quit-app" }, again, host.deps)).body.state, "quit");
});

test("the door's responses never hold a UDID — own or foreign — whatever is asked", async () => {
  const run = ownRun();
  const { deps } = fakeHost({
    pgrep: "4242",
    list: hostList([{ udid: FOREIGN, state: "Shutdown" }]),
  });
  run.simulator.shown = 1;
  const bodies = [];
  for (const body of [
    { verb: "state", device: 1 },
    { verb: "boot", device: 2 },
    { verb: "shutdown", device: 3 },
    { verb: "openurl", device: 1, url: "http://127.0.0.1:51234/still?n=123456" },
    { verb: "openurl", device: 1, url: `http://127.0.0.1:51234/still?n=123456&x=${OWN[0]}` },
    { verb: "screenshot", device: 1, file: "a.png" },
    { verb: "screenshot", device: 1, file: `${OWN[0]}/a.png` },
    { verb: "show-app", device: 1 },
    { verb: "boot", device: OWN[0] },
    { verb: OWN[0], device: 1 },
    { verb: "quit-app" },
  ])
    bodies.push((await doorAct(body, run, deps)).body);
  for (const request of [
    { method: "GET", url: `/still?n=123456&t=${run.token}` },
    { method: "GET", url: `/loaded?n=123456&t=${run.token}` },
    {
      method: "POST",
      url: `/act?t=${run.token}`,
      body: JSON.stringify({ verb: "state", device: 3 }),
    },
    { method: "GET", url: `/${FOREIGN}?t=${run.token}` },
    { method: "GET", url: `/still?n=123456&t=${OWN[0]}` },
  ])
    bodies.push((await handleDoor(request, run, deps)).body);
  assert.ok(!holdsUdid(JSON.stringify(bodies)), JSON.stringify(bodies));
});

test("handleDoor: every request needs the token (401 without); the routes; another path or method refused and counted", async () => {
  const run = ownRun();
  const { deps } = fakeHost();
  assert.equal(
    (await handleDoor({ method: "GET", url: "/still?n=123456" }, run, deps)).status,
    401,
  );
  assert.equal(
    (await handleDoor({ method: "GET", url: "/still?n=123456&t=wrong" }, run, deps)).status,
    401,
  );
  assert.equal(
    (
      await handleDoor(
        { method: "POST", url: "/act", headers: { "x-phone-token": `${run.token}x` }, body: "{}" },
        run,
        deps,
      )
    ).status,
    401,
  );
  assert.equal(run.refused.token, 3);
  const page = await handleDoor(
    { method: "GET", url: `/motion?n=ff8800&t=${run.token}` },
    run,
    deps,
  );
  assert.equal(page.type, "html");
  assert.match(page.body, /#band\{[^}]*background:#ff8800/u);
  assert.match(page.body, /sendBeacon\("\/loaded"/u);
  assert.match(page.body, /"pointerdown", "touchstart", "keydown"/u);
  assert.match(page.body, /requestAnimationFrame/u);
  const still = await handleDoor(
    { method: "GET", url: `/still?n=00ff00&t=${run.token}` },
    run,
    deps,
  );
  assert.doesNotMatch(still.body, /requestAnimationFrame/u);
  const header = { "x-phone-token": run.token };
  assert.equal(
    (await handleDoor({ method: "POST", url: "/loaded?n=00ff00", headers: header }, run, deps))
      .status,
    204,
  );
  assert.deepEqual(
    (await handleDoor({ method: "GET", url: "/loaded?n=00ff00", headers: header }, run, deps)).body,
    {
      n: "00ff00",
      state: 1,
    },
  );
  assert.deepEqual(
    (await handleDoor({ method: "GET", url: "/input?n=00ff00", headers: header }, run, deps)).body,
    {
      n: "00ff00",
      state: 0,
    },
  );
  assert.equal(
    (await handleDoor({ method: "GET", url: "/elsewhere", headers: header }, run, deps)).status,
    404,
  );
  assert.equal(
    (await handleDoor({ method: "GET", url: "/act", headers: header }, run, deps)).status,
    405,
  );
  assert.equal(
    (await handleDoor({ method: "POST", url: "/act", headers: header, body: "{" }, run, deps))
      .status,
    400,
  );
  assert.equal(
    (await handleDoor({ method: "GET", url: "/motion?n=red", headers: header }, run, deps)).status,
    400,
  );
  assert.deepEqual(
    {
      path: run.refused.path,
      method: run.refused.method,
      body: run.refused.body,
      nonce: run.refused.nonce,
    },
    { path: 1, method: 1, body: 1, nonce: 1 },
  );
});

test("startDoor: a loopback server on a random port, answering 401 without the token", async () => {
  const run = ownRun();
  const { deps } = fakeHost();
  const door = await startDoor(run, deps);
  try {
    assert.ok(door.port > 0);
    const base = `http://127.0.0.1:${door.port}`;
    const refused = await fetch(`${base}/loaded?n=abcdef`);
    assert.equal(refused.status, 401);
    assert.deepEqual(await refused.json(), { n: null, state: "unauthorized" });
    const r = await fetch(`${base}/loaded?n=abcdef`, { headers: { "x-phone-token": run.token } });
    assert.deepEqual(await r.json(), { n: "abcdef", state: 0 });
  } finally {
    await door.close();
  }
});

test("startDoor: close waits for the act in flight; an act queued behind it is answered a stop and never runs (S2)", async () => {
  const run = ownRun();
  const host = fakeHost();
  let release;
  const booting = new Promise((done) => {
    release = done;
  });
  let bootAsked;
  const asked = new Promise((done) => {
    bootAsked = done;
  });
  const exec = host.deps.exec;
  host.deps.exec = async (file, args, o) => {
    if (file === "/usr/bin/xcrun" && args[1] === "boot") {
      bootAsked();
      await booting;
    }
    return exec(file, args, o);
  };
  const door = await startDoor(run, host.deps);
  const post = (body) =>
    fetch(`http://127.0.0.1:${door.port}/act`, {
      method: "POST",
      headers: { "x-phone-token": run.token, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  const boot = post({ verb: "boot", device: 1 });
  await asked;
  const queued = post({ verb: "shutdown", device: 2 });
  await new Promise((done) => setTimeout(done, 100));
  let closed = false;
  const closing = door.close().then(() => {
    closed = true;
  });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(closed, false, "close waits for the boot in flight");
  release();
  await closing;
  await Promise.all([boot, queued]);
  // the boot ran to its end; the shutdown queued behind it never ran
  const ran = host.calls
    .filter((c) => c.file === "/usr/bin/xcrun" && c.args[1] !== "list")
    .map((c) => c.args[1]);
  assert.deepEqual(ran, ["boot"]);
});

test("simulatorSettled: a run that launched Simulator.app and finds none looks again for its launch on the way (S2)", async () => {
  const run = ownRun();
  run.simulator.shown = 1;
  run.simulator.launchedAt = ARMED + 30_000;
  const host = fakeHost();
  let looks = 0;
  const exec = host.deps.exec;
  host.deps.exec = async (file, args, o) => {
    if (file === "/usr/bin/pgrep") {
      looks += 1;
      host.state.pgrep = looks >= 3 ? "4242" : null;
    }
    return exec(file, args, o);
  };
  assert.deepEqual(await simulatorSettled(run, host.deps), { running: 1, own: true, pid: 4242 });
  assert.equal(looks, 3);
  // a run with no launch since its last quit looks once
  const none = ownRun();
  const quiet = fakeHost();
  assert.equal((await simulatorSettled(none, quiet.deps)).running, 0);
  assert.equal(quiet.calls.filter((c) => c.file === "/usr/bin/pgrep").length, 1);
  // and gives up after its 2 s (eight looks past the first)
  const gone = ownRun();
  gone.simulator.pressed = 1;
  gone.simulator.launchedAt = ARMED + 30_000;
  const never = fakeHost();
  assert.equal((await simulatorSettled(gone, never.deps)).running, 0);
  assert.equal(never.calls.filter((c) => c.file === "/usr/bin/pgrep").length, 9);
});

// ─── /row: the HID pair and the press gate ────────────────────────────────────────────────────────────────────────────

const sample = (s, idle, locked = "No") => ({ at: ARMED + s * 1000, locked, idle });

test("doorRow: a row's begin and end write its two HID lines and say PHONE_ROW; the door counts it", async () => {
  const run = ownRun();
  run.last = sample(0, 300);
  const host = fakeHost({ samples: [sample(10, 310), sample(40, 340)] });
  assert.deepEqual((await doorRow({ name: "SIM-STAGED", phase: "begin" }, run, host.deps)).body, {
    go: true,
  });
  assert.deepEqual((await doorRow({ name: "SIM-STAGED", phase: "end" }, run, host.deps)).body, {
    go: true,
  });
  assert.deepEqual(host.hid, [
    `${new Date(ARMED + 10_000).toISOString().slice(11, 19)}Z console: locked No; HID idle 310s`,
    `${new Date(ARMED + 40_000).toISOString().slice(11, 19)}Z END console: locked No; HID idle 340s`,
  ]);
  assert.deepEqual(host.said, ["PHONE_ROW SIM-STAGED BEGIN", "PHONE_ROW SIM-STAGED END"]);
  assert.equal(run.served, 1);
  // an end with no row open is refused; so is a begin over a row still open
  assert.equal((await doorRow({ name: "SIM-STAGED", phase: "end" }, run, host.deps)).status, 409);
  const open = ownRun();
  open.last = sample(0, 300);
  const twice = fakeHost({ samples: [sample(10, 310)] });
  await doorRow({ name: "SIM-NONE", phase: "begin" }, open, twice.deps);
  const again = await doorRow({ name: "SIM-NO-UDID", phase: "begin" }, open, twice.deps);
  assert.equal(again.status, 409);
  assert.match(again.body.why, /SIM-NONE never ended/u);
});

test("doorRow: a hand at a begin STOPS the console acts, naming the row; every later act and row is a stop", async () => {
  const run = ownRun();
  run.last = sample(0, 300);
  const host = fakeHost({ samples: [sample(60, 5)] });
  const r = await doorRow({ name: "SIM-LIVE", phase: "begin" }, run, host.deps);
  assert.equal(r.status, 409);
  assert.match(r.body.why, /a hand at the Mac before SIM-LIVE/u);
  assert.equal(run.hands, 1);
  assert.match(host.said.at(-1), /^PHONE_STOP a hand at the Mac before SIM-LIVE/u);
  assert.equal((await doorAct({ verb: "boot", device: 1 }, run, host.deps)).body.state, "stop");
  assert.equal(
    (await doorRow({ name: "SIM-USE", phase: "begin" }, run, host.deps)).body.stop,
    true,
  );
});

test("doorRow press: the gate refuses create and a device not the run's (STOP, no press); the fence before a launch", async () => {
  const begun = async (samples) => {
    const run = ownRun();
    run.last = sample(0, 300);
    const host = fakeHost({ samples });
    await doorRow({ name: "SIM-SHOW-FRESH", phase: "begin" }, run, host.deps);
    return { run, host };
  };
  for (const [body, why] of [
    [{ act: "create", device: `pts3-${RUN}-1` }, /refuses act create/u],
    [{ act: "finish", device: `pts3-${RUN}-1` }, /refuses act finish/u],
    [{ act: "attach", device: "pts3-other-3" }, /not one of this run's/u],
    [{ act: "show", device: "pts3-other-1" }, /not one of this run's/u],
    [{ act: "show", device: "iPhone 17 Pro" }, /not one of this run's/u],
    [{ act: "show" }, /not one of this run's/u],
  ]) {
    const { run, host } = await begun([sample(10, 310)]);
    const r = await doorRow({ name: "SIM-SHOW-FRESH", phase: "press", ...body }, run, host.deps);
    assert.equal(r.body.stop, true, JSON.stringify(body));
    assert.match(r.body.why, why);
    assert.notEqual(run.stopped, null);
    assert.equal(run.simulator.pressed, 0);
  }
  // a foreign device booted mid-run: STOP before the press
  const fenced = await begun([sample(10, 310)]);
  fenced.host.state.list = hostList([{ udid: FOREIGN, state: "Booting" }]);
  const r = await doorRow(
    { name: "SIM-SHOW-FRESH", phase: "press", act: "show", device: `pts3-${RUN}-3` },
    fenced.run,
    fenced.host.deps,
  );
  assert.equal(r.body.stop, true);
  assert.match(fenced.run.stopped.why, /the fence/u);
  // through the gate: go, and the run may have launched Simulator.app from here on
  const { run, host } = await begun([sample(10, 310)]);
  const go = await doorRow(
    { name: "SIM-SHOW-FRESH", phase: "press", act: "show", device: `pts3-${RUN}-3` },
    run,
    host.deps,
  );
  assert.deepEqual(go.body, { go: true });
  assert.equal(run.simulator.pressed, 1);
  assert.equal(host.said.at(-1), `PHONE_ROW SIM-SHOW-FRESH PRESS show pts3-${RUN}-3`);
});

test("doorRow press attach: the fence (the host's booted set ⊆ the run's own) and its device Booted — or STOP; never a launch (S6)", async () => {
  const begun = async (list) => {
    const run = ownRun();
    run.last = sample(0, 300);
    const host = fakeHost({ samples: [sample(10, 310)], list });
    await doorRow({ name: "SIM-ATTACH", phase: "begin" }, run, host.deps);
    return { run, host };
  };
  const attach = { name: "SIM-ATTACH", phase: "press", act: "attach", device: `pts3-${RUN}-3` };
  const withOwn = (state, foreign = [{ udid: FOREIGN, state: "Shutdown" }]) =>
    simctlList({
      devices: [
        ...OWN.map((udid, i) => ({
          udid,
          name: `pts3-${RUN}-${i + 1}`,
          type: CATALOG[i + 2],
          state: i === 2 ? state : "Shutdown",
        })),
        ...foreign.map((d) => ({ name: "iPhone 11", type: CATALOG[0], ...d })),
      ],
    });
  // R booted, every other device off: go — and no Simulator.app launch counted
  const ok = await begun(withOwn("Booted"));
  assert.deepEqual((await doorRow(attach, ok.run, ok.host.deps)).body, { go: true });
  assert.equal(ok.run.simulator.pressed, 0);
  assert.equal(ok.run.simulator.launchedAt, null);
  assert.equal(ok.host.said.at(-1), `PHONE_ROW SIM-ATTACH PRESS attach pts3-${RUN}-3`);
  // a foreign device booted: Attach could bind it — STOP before the press
  const fenced = await begun(withOwn("Booted", [{ udid: FOREIGN, state: "Booted" }]));
  assert.equal((await doorRow(attach, fenced.run, fenced.host.deps)).body.stop, true);
  assert.match(fenced.run.stopped.why, /the fence/u);
  // R not booted: nothing of its model to bind — STOP
  const off = await begun(withOwn("Shutdown"));
  const r = await doorRow(attach, off.run, off.host.deps);
  assert.equal(r.body.stop, true);
  assert.match(r.body.why, /pts3-l2-t1-3 reads Shutdown, not Booted/u);
});

test("doorRow: a press with no input said before is the run's first input; END idle under its seconds there is RM4.5", async () => {
  const run = ownRun();
  run.last = sample(0, 300);
  const host = fakeHost({ samples: [sample(10, 310), sample(40, 1)] });
  await doorRow({ name: "SIM-SHOW-FRESH", phase: "begin" }, run, host.deps);
  await doorRow(
    { name: "SIM-SHOW-FRESH", phase: "press", act: "show", device: `pts3-${RUN}-3` },
    run,
    host.deps,
  );
  const r = await doorRow({ name: "SIM-SHOW-FRESH", phase: "end" }, run, host.deps);
  assert.equal(r.body.stop, true);
  assert.equal(r.body.why, "HID moved by the run's own input — RM4.5");
  assert.equal(run.ownInput, true);
  assert.equal(run.hands, 0);
  assert.equal(host.hid.length, 2);
});

test("doorRow end: a row ENDED on a stop is VOID in the run's record — RM4.5's own input, and a run stopped mid-row (R9)", async () => {
  // RM4.5: the first input row's reset STOPS the run, and the row's reads are not judged
  const own = ownRun();
  own.last = sample(0, 300);
  const host = fakeHost({ samples: [sample(10, 310), sample(40, 2)] });
  await doorRow({ name: "SIM-STAGED", phase: "begin" }, own, host.deps);
  await doorRow({ name: "SIM-STAGED", phase: "input" }, own, host.deps);
  const end = await doorRow({ name: "SIM-STAGED", phase: "end" }, own, host.deps);
  assert.equal(end.body.stop, true);
  assert.deepEqual(own.voids, [
    { name: "SIM-STAGED", why: "HID moved by the run's own input — RM4.5" },
  ]);
  // the run stopped mid-row (the press gate refused): its END still closes the row, and the row is VOID
  const mid = ownRun();
  mid.last = sample(0, 300);
  const gated = fakeHost({ samples: [sample(10, 310), sample(20, 320)] });
  await doorRow({ name: "SIM-LIVE", phase: "begin" }, mid, gated.deps);
  await doorRow(
    { name: "SIM-LIVE", phase: "press", act: "create", device: `pts3-${RUN}-1` },
    mid,
    gated.deps,
  );
  const closed = await doorRow({ name: "SIM-LIVE", phase: "end" }, mid, gated.deps);
  assert.equal(closed.body.stop, true);
  assert.equal(mid.voids.length, 1);
  assert.equal(mid.voids[0].name, "SIM-LIVE");
  assert.match(
    mid.voids[0].why,
    /^stopped mid-row: SIM-LIVE: the press gate: it refuses act create/u,
  );
  assert.ok(gated.said.includes(`PHONE_ROW SIM-LIVE VOID: ${mid.voids[0].why}`));
});

test("doorRow input: L2's FIRST input row is SIM-STAGED's lay (a drag, no press gate) — its reset is RM4.5, never a hand (S3)", async () => {
  const run = ownRun();
  run.last = sample(0, 300);
  const host = fakeHost({ samples: [sample(10, 310), sample(40, 2)] });
  await doorRow({ name: "SIM-STAGED", phase: "begin" }, run, host.deps);
  assert.deepEqual((await doorRow({ name: "SIM-STAGED", phase: "input" }, run, host.deps)).body, {
    go: true,
  });
  // said once: a second input is the same row's, and moves nothing
  await doorRow({ name: "SIM-STAGED", phase: "input" }, run, host.deps);
  assert.equal(run.firstInput, "SIM-STAGED");
  assert.deepEqual(host.said, [
    "PHONE_ROW SIM-STAGED BEGIN",
    "PHONE_ROW SIM-STAGED INPUT (the run's first)",
  ]);
  const r = await doorRow({ name: "SIM-STAGED", phase: "end" }, run, host.deps);
  assert.equal(r.body.stop, true);
  assert.equal(r.body.why, "HID moved by the run's own input — RM4.5");
  assert.equal(run.ownInput, true);
  assert.equal(run.hands, 0);
  // a later row's press is no longer the first input: its END reset is a hand, VOID
  const later = ownRun();
  later.last = sample(0, 300);
  later.firstInput = "SIM-STAGED";
  const touched = fakeHost({ samples: [sample(10, 310), sample(40, 2)] });
  await doorRow({ name: "SIM-SHOW-FRESH", phase: "begin" }, later, touched.deps);
  await doorRow(
    { name: "SIM-SHOW-FRESH", phase: "press", act: "show", device: `pts3-${RUN}-3` },
    later,
    touched.deps,
  );
  const v = await doorRow({ name: "SIM-SHOW-FRESH", phase: "end" }, later, touched.deps);
  assert.match(v.body.void, /a hand at the Mac mid-row/u);
  assert.equal(later.ownInput, false);
  // an input with no row open is refused
  assert.equal(
    (await doorRow({ name: "SIM-USE", phase: "input" }, later, touched.deps)).status,
    409,
  );
});

test("doorRow: a row stopped mid-way still takes its END (the record keeps two lines); a later row's END VOIDs on a hand", async () => {
  const run = ownRun();
  run.last = sample(0, 300);
  const host = fakeHost({ samples: [sample(10, 310), sample(20, 320)] });
  await doorRow({ name: "SIM-OFF-BOOT", phase: "begin" }, run, host.deps);
  await doorRow(
    { name: "SIM-OFF-BOOT", phase: "press", act: "create", device: `pts3-${RUN}-1` },
    run,
    host.deps,
  );
  const end = await doorRow({ name: "SIM-OFF-BOOT", phase: "end" }, run, host.deps);
  assert.equal(end.body.stop, true);
  assert.equal(host.hid.length, 2);
  assert.match(host.hid[1], / END console: locked No; HID idle 320s$/u);
  const later = ownRun();
  later.last = sample(0, 300);
  const touched = fakeHost({ samples: [sample(10, 310), sample(50, 3)] });
  await doorRow({ name: "SIM-USE", phase: "begin" }, later, touched.deps);
  const v = await doorRow({ name: "SIM-USE", phase: "end" }, later, touched.deps);
  assert.equal(v.status, 200);
  assert.match(v.body.void, /a hand at the Mac mid-row/u);
  assert.deepEqual(
    later.voids.map((x) => x.name),
    ["SIM-USE"],
  );
  assert.equal(later.hands, 1);
});

test("a DETERMINISTIC stop is FINAL — exit 1 and PHONE_STOP_FINAL, never 75; a transient one keeps 75 (S-3)", async () => {
  /** A run with its first row begun (or, with `begin: false`, none), the samples given, then `act` — its stop answered. */
  const stopOf = async (samples, act, { begin = true } = {}) => {
    const run = ownRun();
    run.last = sample(0, 300);
    const host = fakeHost({ samples });
    if (begin) await doorRow({ name: "SIM-STAGED", phase: "begin" }, run, host.deps);
    await act(run, host);
    assert.notEqual(run.stopped, null, "the act stopped the run");
    return run.stopped;
  };
  const press = (act, device) => (run, host) =>
    doorRow({ name: "SIM-STAGED", phase: "press", act, device }, run, host.deps);
  const final = {
    // RM4.5: the run's own input moved HIDIdleTime — a relaunch moves it again
    "own input": await stopOf([sample(10, 310), sample(40, 2)], async (run, host) => {
      await doorRow({ name: "SIM-STAGED", phase: "input" }, run, host.deps);
      await doorRow({ name: "SIM-STAGED", phase: "end" }, run, host.deps);
    }),
    // the press gate: an act outside the gated set, a device not the run's — the smoke's or the product's own binding
    "act create": await stopOf([sample(10, 310)], press("create", `pts3-${RUN}-1`)),
    "another's device": await stopOf([sample(10, 310)], press("show", "James's iPhone")),
  };
  const transient = {
    "a hand at a begin": await stopOf(
      [sample(60, 5)],
      (run, host) => doorRow({ name: "SIM-LIVE", phase: "begin" }, run, host.deps),
      { begin: false },
    ),
    "a locked console": await stopOf(
      [sample(10, 310, "Yes")],
      (run, host) => doorRow({ name: "SIM-LIVE", phase: "begin" }, run, host.deps),
      { begin: false },
    ),
    "the fence": await stopOf([sample(10, 310)], (run, host) => {
      host.state.list = hostList([{ udid: FOREIGN, state: "Booted" }]);
      return press("show", `pts3-${RUN}-3`)(run, host);
    }),
    "a Simulator.app not the run's": await stopOf([sample(10, 310)], (run, host) => {
      host.state.pgrep = "777";
      host.state.lstart = lstartOf(ARMED - 60_000);
      return press("show", `pts3-${RUN}-3`)(run, host);
    }),
  };
  const restored = { signal: null, deadlineHit: false, code: 0, restored: true, foreign: [] };
  for (const [what, stopped] of Object.entries(final)) {
    assert.equal(stopped.final, true, what);
    assert.deepEqual(
      launchExit({ ...restored, stopped }),
      { code: 1, lines: [`PHONE_STOP_FINAL ${stopped.why}`] },
      what,
    );
  }
  for (const [what, stopped] of Object.entries(transient)) {
    assert.equal(stopped.final, false, what);
    assert.deepEqual(launchExit({ ...restored, stopped }), { code: NOT_ARMED, lines: [] }, what);
  }
  // FINAL over an unrestored own side: both said — never relaunch as is, and restore first
  const both = launchExit({ ...restored, restored: false, stopped: final["own input"] });
  assert.equal(both.code, 1);
  assert.deepEqual(
    both.lines.map((line) => line.split(" ")[0]),
    ["PHONE_STOP_FINAL", "PHONE_STOP_UNRESTORED"],
  );
});

// ─── the command: settled on its exit ─────────────────────────────────────────────────────────────────────────────────

/** A command's child as `spawn` hands it, driven by the unit: it emits only what the unit says, and spawns nothing. */
function fakeChild(pid = 7001) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.killed = [];
  child.kill = (signal) => child.killed.push(signal);
  child.exit = (code, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  return child;
}

/** The command's deps: a `spawn` that hands the fake child (and keeps how it was asked), the group's signals kept. */
function commandDeps(child) {
  const asked = [];
  const groups = [];
  const said = [];
  return {
    asked,
    groups,
    said,
    deps: {
      spawn: (file, args, o) => {
        asked.push({ file, args, o });
        return child;
      },
      killGroup: (pid, signal) => groups.push({ pid, signal }),
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      say: (line) => said.push(line),
    },
  };
}

const lineSink = () => {
  const lines = [];
  let ended = 0;
  return {
    lines,
    ended: () => ended,
    stream: {
      push: (chunk) => lines.push(String(chunk)),
      end: () => {
        ended += 1;
      },
    },
  };
};

test("runCommand: settled on the command's EXIT — a process it started holding its pipes never holds teardown (S1)", async () => {
  const child = fakeChild();
  const { deps, asked, said } = commandDeps(child);
  const out = lineSink();
  const err = lineSink();
  const running = runCommand({
    command: ["node", "packaging/run-smoke.mjs", "--smoke-canvas", "--phone"],
    env: { VF_PHONE_MODE: "devices" },
    deadlineMs: 60_000,
    deps,
    out: out.stream,
    err: err.stream,
    drainMs: 20,
  });
  // the leader of its own group, its stdin never the terminal's
  assert.deepEqual(asked[0].args, ["packaging/run-smoke.mjs", "--smoke-canvas", "--phone"]);
  assert.equal(asked[0].o.detached, true);
  assert.deepEqual(asked[0].o.stdio, ["ignore", "pipe", "pipe"]);
  child.stdout.emit("data", "PHONE_ROWS_END n=20\n");
  // run-smoke exits; the Electron it orphaned still holds the pipes: `close` never comes
  child.exit(0);
  const settled = await Promise.race([
    running.done,
    new Promise((done) => setTimeout(() => done("held"), 1_000)),
  ]);
  assert.deepEqual(settled, { code: 0, deadlineHit: false });
  assert.deepEqual(out.lines, ["PHONE_ROWS_END n=20\n"]);
  assert.equal(out.ended(), 1);
  assert.equal(err.ended(), 1);
  assert.match(said.at(-1), /still holds its output past 20 ms — not waited for/u);
  // a signal's exit is 128+n; a stop after the exit signals nothing
  const killed = fakeChild();
  const k = commandDeps(killed);
  const r = runCommand({
    command: ["x"],
    env: {},
    deadlineMs: 60_000,
    deps: k.deps,
    out: lineSink().stream,
    err: lineSink().stream,
    drainMs: 5,
  });
  killed.exit(null, "SIGTERM");
  killed.emit("close", null, "SIGTERM");
  assert.deepEqual(await r.done, { code: 143, deadlineHit: false });
  r.stop("SIGINT");
  assert.deepEqual(killed.killed, []);
});

test("runCommand: past the deadline the command is SIGTERMed, then its whole GROUP SIGKILLed — never run-smoke alone (S1)", async () => {
  const child = fakeChild(7002);
  const { deps, groups, said } = commandDeps(child);
  const running = runCommand({
    command: ["x"],
    env: {},
    deadlineMs: 5,
    deps,
    out: lineSink().stream,
    err: lineSink().stream,
    drainMs: 5,
    killAfterMs: 10,
  });
  await new Promise((done) => setTimeout(done, 60));
  assert.deepEqual(child.killed, ["SIGTERM"]);
  assert.deepEqual(groups, [{ pid: 7002, signal: "SIGKILL" }]);
  assert.match(said[0], /past the deadline \(5 ms\)/u);
  child.exit(null, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  assert.deepEqual(await running.done, { code: 137, deadlineHit: true });
  // a command that never started is settled too (exit 2)
  const failed = fakeChild();
  const f = commandDeps(failed);
  const never = runCommand({
    command: ["x"],
    env: {},
    deadlineMs: 60_000,
    deps: f.deps,
    out: lineSink().stream,
    err: lineSink().stream,
  });
  failed.emit("error", new Error("ENOENT"));
  assert.deepEqual(await never.done, { code: 2, deadlineHit: false });
});

// ─── teardown ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A host whose `simctl list` answers each read with the next list given (the last one held). */
function scriptedLists(lists, opts = {}) {
  const host = fakeHost(opts);
  const exec = host.deps.exec;
  const queue = [...lists];
  host.reads = 0;
  host.deps.exec = async (file, args, o = {}) => {
    if (file === "/usr/bin/xcrun" && args[1] === "list") {
      host.reads += 1;
      host.state.list = queue.length > 1 ? queue.shift() : queue[0];
    }
    if (opts.extra !== undefined) {
      const r = opts.extra(file, args);
      if (r !== undefined) return r;
    }
    return exec(file, args, o);
  };
  /** the simctl acts run on own devices, as `<verb> <n>` (`?` for a UDID not the run's) */
  host.acts = () =>
    host.calls
      .filter((c) => c.file === "/usr/bin/xcrun" && ["shutdown", "delete"].includes(c.args[1]))
      .map((c) => `${c.args[1]} ${OWN.indexOf(c.args[2]) + 1 || "?"}`);
  return host;
}

const ownList = (states, renamed = {}) =>
  simctlList({
    devices: [
      ...OWN.map((udid, i) => ({
        udid,
        name: renamed[i + 1] ?? `pts3-${RUN}-${i + 1}`,
        type: CATALOG[i + 2],
        state: states[i],
      })),
      { udid: FOREIGN, name: "iPhone 11", type: CATALOG[0], state: "Shutdown" },
    ],
  });

test("restoreHost: each own device's name read again right before its step — renamed, refused; delete only under the flag (S9)", async () => {
  const restore = async (lists, deleteDevices) => {
    const run = ownRun();
    run.othersAtArm.set(FOREIGN, "Shutdown");
    const host = scriptedLists(lists);
    await restoreHost(run, host.deps, {
      deleteDevices,
      defaultsBefore: "",
      crashDir: join(FIXTURES, "no-crash-reports-here"),
      crashBefore: [],
    });
    return host;
  };
  const armed = ownList(["Booted", "Shutdown", "Booted"]);
  const renamed = ownList(["Shutdown", "Shutdown", "Booted"], { 3: "James's iPhone" });
  // KEEP: the plan shuts 1 and 3; 3 is renamed between the plan and its step — refused, never shut
  const kept = await restore([armed, armed, renamed, renamed], false);
  assert.deepEqual(kept.acts(), ["shutdown 1"]);
  const said = kept.said.find((line) => line.startsWith("PHONE_HOST_RESTORED "));
  assert.match(said, /shutdown of <pts3-dev-3> refused: its name is no longer pts3-l2-t1-3/u);
  assert.match(said, /"form":"kept"/u);
  // DELETE, under the flag: 1 shut then deleted, 2 deleted; 3 renamed before its steps — neither runs
  const gone = await restore([armed, armed, armed, armed, renamed, renamed, renamed], true);
  assert.deepEqual(gone.acts(), ["shutdown 1", "delete 1", "delete 2"]);
  assert.equal(
    gone.reads,
    7,
    "the list read once before the plan, once before each of its five steps, once after",
  );
  // no flag, no delete — whatever the list says
  assert.ok(!kept.acts().some((act) => act.startsWith("delete")));
});

test("sweep: exactly the run's own names, shut down; deleted only under the flag, each name read again right before (S9)", async () => {
  const rules = {
    guardAwk: "/lanes/guard/guard-stop.awk",
    perfLock: "/lanes/PERF.lock",
    diskFloors: [],
    by: "env (VF_PHONE_GUARD_AWK, VF_PHONE_PERF_LOCK)",
  };
  const simctlAt = join(XCODE_DEVELOPER_DIR, "usr/bin/simctl");
  const swept = async (
    lists,
    { env = {}, guard = "", files = [rules.guardAwk, simctlAt] } = {},
  ) => {
    const host = scriptedLists(lists, {
      files,
      extra: (file) =>
        file === "/usr/bin/awk"
          ? ok(guard)
          : file === "/usr/bin/xcode-select"
            ? ok(`${XCODE_DEVELOPER_DIR}\n`)
            : undefined,
    });
    const code = await sweep(RUN, env, rules, createRedactor(), host.deps);
    return { code, host, line: host.said.find((l) => l.startsWith("PHONE_SWEEP ")) };
  };
  // another run whose id begins like this one's, booted: never the sweep's
  const near = (states, renamed) =>
    JSON.stringify(
      (() => {
        const list = JSON.parse(ownList(states, renamed));
        list.devices[RT26].push({
          dataPath: "/x",
          udid: FOREIGN_GONE,
          isAvailable: true,
          deviceTypeIdentifier: CATALOG[2],
          state: "Booted",
          name: `pts3-${RUN}0-1`,
        });
        return list;
      })(),
    );
  const left = near(["Booted", "Shutdown", "Shutdown"]);
  const keep = await swept([left]);
  assert.equal(keep.code, 0);
  assert.deepEqual(keep.host.acts(), ["shutdown 1"]);
  assert.match(keep.line, /"found":3,"shutdown":1,"deleted":0,"kept":3/u);
  const renamed = near(["Shutdown", "Shutdown", "Shutdown"], { 3: "James's iPhone" });
  const del = await swept([left, left, left, renamed], { env: { VF_PHONE_DELETE_DEVICES: "1" } });
  assert.equal(del.code, 0);
  assert.deepEqual(del.host.acts(), ["shutdown 1", "delete 1", "delete 2"]);
  assert.match(del.line, /"deleted":2,"kept":1/u);
  // no UDID in anything it says
  for (const line of [...keep.host.said, ...del.host.said])
    assert.doesNotMatch(line, /[0-9a-f]{8}-[0-9a-f]{4}-/iu, line);
  // the guard not clear, or the lock held: NOT ARMED, and simctl never run
  for (const blocked of [
    await swept([left], { guard: "4242 Electron\n" }),
    await swept([left], { files: [rules.guardAwk, simctlAt, rules.perfLock] }),
    await swept([left], { files: [simctlAt] }),
  ]) {
    assert.equal(blocked.code, NOT_ARMED);
    assert.equal(blocked.host.reads, 0);
    assert.deepEqual(blocked.host.acts(), []);
  }
});

test("teardownPlan: no quit unless proven the run's (and never beside a foreign booted device); no delete without the flag", () => {
  const own = [
    { n: 1, state: "Booted" },
    { n: 2, state: "Shutdown" },
    { n: 3, state: "absent" },
  ];
  const clear = { clear: true, busy: 0 };
  const proven = { running: 1, own: true, pid: 4242 };
  assert.deepEqual(teardownPlan({ own, deleteDevices: false, simulator: proven, fence: clear }), [
    { do: "quit-app" },
    { do: "shutdown", n: 1 },
  ]);
  assert.deepEqual(teardownPlan({ own, deleteDevices: true, simulator: proven, fence: clear }), [
    { do: "quit-app" },
    { do: "shutdown", n: 1 },
    { do: "delete", n: 1 },
    { do: "delete", n: 2 },
  ]);
  const foreignApp = { running: 1, own: false, why: "it started before ARMED" };
  assert.deepEqual(
    teardownPlan({ own: [], deleteDevices: true, simulator: foreignApp, fence: clear }),
    [{ skip: "quit-app", why: "it started before ARMED" }],
  );
  assert.deepEqual(
    teardownPlan({
      own: [],
      deleteDevices: false,
      simulator: proven,
      fence: { clear: false, busy: 1 },
    }),
    [{ skip: "quit-app", why: "a foreign device is booted: a quit could take it down" }],
  );
  assert.deepEqual(
    teardownPlan({
      own: [],
      deleteDevices: false,
      simulator: { running: 0, own: false },
      fence: clear,
    }),
    [],
  );
});

test("othersCompare and restoredVerdict: the non-own set unchanged, own devices deleted (or kept shut), the app, the lock", () => {
  const before = new Map([
    [FOREIGN, "Shutdown"],
    [FOREIGN_GONE, "Shutdown"],
  ]);
  const same = parseList(hostList([{ udid: FOREIGN }, { udid: FOREIGN_GONE }]));
  assert.deepEqual(othersCompare(before, same, new Set(OWN)), {
    count: 2,
    unchanged: true,
    changed: 0,
    gone: 0,
    appeared: 0,
  });
  const moved = parseList(hostList([{ udid: FOREIGN, state: "Booted" }]));
  assert.deepEqual(othersCompare(before, moved, new Set(OWN)), {
    count: 2,
    unchanged: false,
    changed: 1,
    gone: 1,
    appeared: 0,
  });
  const good = {
    run: RUN,
    own: { form: "deleted", left: 0, shutdown: true },
    simulator: { launchedByRun: true, quit: "quit" },
    helperLeft: 0,
    others: { unchanged: true },
    perfLock: "removed",
    crash: { new: [] },
  };
  assert.deepEqual(restoredVerdict(good), { ok: true, why: [], ownOk: true, foreign: [] });
  const red = (change, why) => {
    const v = restoredVerdict({ ...good, ...change });
    assert.equal(v.ok, false);
    assert.match(v.why.join("; "), why);
  };
  red({ own: { form: "deleted", left: 1, shutdown: true } }, /1 pts3-l2-t1-\* device\(s\) left/u);
  red({ own: { form: "kept", left: 3, shutdown: false } }, /an own device is not shut down/u);
  red(
    { simulator: { launchedByRun: true, quit: "refused: it started before ARMED" } },
    /Simulator\.app: refused/u,
  );
  red({ helperLeft: 1 }, /live-surface-capture-helper/u);
  red({ others: { unchanged: false } }, /another device changed/u);
  red({ others: null }, /unreadable/u);
  red({ perfLock: "left" }, /PERF\.lock left held/u);
  red({ crash: { new: ["Simulator-2026-10-31-040501.ips"] } }, /a new crash report/u);
  // KEEP (a dev run without the flag): three own devices left, shut down, is restored
  assert.equal(
    restoredVerdict({ ...good, own: { form: "kept", left: 3, shutdown: true } }).ok,
    true,
  );
  // a Simulator.app the run never launched stays, and is no red of the run's
  assert.equal(
    restoredVerdict({ ...good, simulator: { launchedByRun: false, quit: "refused: x" } }).ok,
    true,
  );
});

test("restoredVerdict: restoration judged on the run's OWN side — another's change keeps HOST_RESTORED red, as an OBSERVATION (S-1)", () => {
  const good = {
    run: RUN,
    own: { form: "deleted", left: 0, shutdown: true },
    simulator: { launchedByRun: true, quit: "quit", foreign: false },
    helperLeft: 0,
    others: { unchanged: true },
    perfLock: "removed",
    crash: { new: [] },
  };
  assert.deepEqual(restoredVerdict(good), { ok: true, why: [], ownOk: true, foreign: [] });
  const judged = (change) => restoredVerdict({ ...good, ...change });
  // another's: the non-own set changed; an app proven another's; the run's own app kept from its quit beside another's
  // booted device — RM4.3 keeps the read red, and the run's own side is restored
  for (const change of [
    { others: { unchanged: false } },
    {
      simulator: {
        launchedByRun: true,
        quit: "refused: the run launched no Simulator.app since its last quit",
        foreign: true,
      },
    },
    {
      simulator: {
        launchedByRun: true,
        quit: "left running beside a foreign booted device (a quit could take it down, P5)",
        foreign: true,
      },
    },
  ]) {
    const v = judged(change);
    assert.equal(v.ok, false, JSON.stringify(change));
    assert.equal(v.ownOk, true, JSON.stringify(change));
    assert.equal(v.foreign.length, 1, JSON.stringify(change));
  }
  // the proof's own word: three cases PROVE the one Simulator running another's; two Simulators, another executable or
  // an unreadable start prove nothing — the run's may be among them
  const proof = {
    pids: [4242],
    comm: SIM_EXE,
    lstart: lstartOf(ARMED + 60_000),
    devDir: XCODE_DEVELOPER_DIR,
    armedAt: ARMED,
    launchedAt: ARMED + 30_000,
  };
  for (const change of [
    { lstart: lstartOf(ARMED - 60_000) },
    { launchedAt: null },
    { launchedAt: ARMED + 120_000 },
  ])
    assert.equal(simulatorProof({ ...proof, ...change }).foreign, true, JSON.stringify(change));
  for (const change of [{ pids: [4242, 4243] }, { comm: "/x/Simulator" }, { lstart: "" }, {}])
    assert.notEqual(simulatorProof({ ...proof, ...change }).foreign, true, JSON.stringify(change));
  // the run's own: each one unrestores its own side — an app the proof cannot place (two Simulators, an unreadable start)
  // may be the run's, so it stays the run's
  for (const change of [
    { own: { form: "deleted", left: 1, shutdown: true } },
    { own: { form: "kept", left: 3, shutdown: false } },
    {
      simulator: {
        launchedByRun: true,
        quit: "refused: 2 Simulator processes run",
        foreign: false,
      },
    },
    { simulator: { launchedByRun: true, quit: "outlived SIGTERM by 10 s", foreign: false } },
    { helperLeft: 1 },
    { others: null },
    { perfLock: "left" },
    { crash: { new: ["Simulator-2026-10-31-040501.ips"] } },
  ]) {
    const v = judged(change);
    assert.equal(v.ok, false, JSON.stringify(change));
    assert.equal(v.ownOk, false, JSON.stringify(change));
    assert.deepEqual(v.foreign, [], JSON.stringify(change));
  }
});

test("a foreign device booted mid-run: the fence STOPS, teardown touches the run's own only, the exit is 75 — said as an OBSERVATION (S-1)", async () => {
  const ctx = {
    deleteDevices: false,
    defaultsBefore: "",
    crashDir: join(FIXTURES, "no-crash-reports-here"),
    crashBefore: [],
  };
  const exitOf = (run, verdict) =>
    launchExit({
      signal: null,
      stopped: run.stopped,
      deadlineHit: false,
      code: 0,
      restored: verdict.ownOk,
      foreign: verdict.foreign,
    });
  const observed = (host) => host.said.filter((line) => line.startsWith("PHONE_OBSERVATION "));
  const booted = hostList([{ udid: FOREIGN, state: "Booted" }]);
  // the fence at a press: another's device booted since ARMED — the run STOPS, its own devices shut and kept
  const run = ownRun();
  run.othersAtArm.set(FOREIGN, "Shutdown");
  const host = fakeHost({ list: booted });
  assert.equal((await fenceAgain(run, host.deps)).stop, true);
  const verdict = await restoreHost(run, host.deps, ctx);
  assert.deepEqual(exitOf(run, verdict), { code: NOT_ARMED, lines: [] });
  const restored = host.said.find((line) => line.startsWith("PHONE_HOST_RESTORED "));
  assert.match(restored, /"ok":false/u);
  assert.match(restored, /another device changed/u);
  assert.equal(observed(host).length, 1);
  assert.match(observed(host)[0], /another device changed/u);
  // never a simctl act on another's device
  assert.ok(!host.calls.some((c) => c.args?.some((a) => String(a).includes(FOREIGN))));
  // the run's own Simulator.app, kept from its quit by that device: never SIGTERMed, named left running — and still 75
  const beside = ownRun();
  beside.othersAtArm.set(FOREIGN, "Shutdown");
  beside.simulator.shown = 1;
  beside.simulator.launchedAt = ARMED + 30_000;
  const next = fakeHost({ list: booted, pgrep: "4242" });
  await fenceAgain(beside, next.deps);
  const left = await restoreHost(beside, next.deps, ctx);
  assert.deepEqual(next.killed, []);
  assert.deepEqual(exitOf(beside, left), { code: NOT_ARMED, lines: [] });
  assert.match(observed(next)[0], /left running beside a foreign booted device/u);
  // S-1b: the run quit its own app; another's Simulator.app then halts the press gate — no red of the run's own side
  const after = ownRun();
  after.othersAtArm.set(FOREIGN, "Shutdown");
  after.simulator.shown = 1;
  after.simulator.quits = 1;
  after.last = sample(0, 300);
  const theirs = fakeHost({ samples: [sample(10, 310)], pgrep: "777" });
  await doorRow({ name: "SIM-SHOW-RUNNING", phase: "begin" }, after, theirs.deps);
  await doorRow(
    { name: "SIM-SHOW-RUNNING", phase: "press", act: "show", device: `pts3-${RUN}-3` },
    after,
    theirs.deps,
  );
  assert.match(after.stopped.why, /not proven the run's/u);
  const quiet = await restoreHost(after, theirs.deps, ctx);
  assert.deepEqual(theirs.killed, []);
  assert.deepEqual(exitOf(after, quiet), { code: NOT_ARMED, lines: [] });
  assert.match(observed(theirs)[0], /launched no Simulator\.app since its last quit/u);
});

test("teardown's quit reads the fence AGAIN after the settle, right before its SIGTERM — a device booted meanwhile keeps the app (S-4)", async () => {
  const ctx = {
    deleteDevices: false,
    defaultsBefore: "",
    crashDir: join(FIXTURES, "no-crash-reports-here"),
    crashBefore: [],
  };
  /** The run launched Simulator.app, and none is up yet: teardown settles; during its sleep the given happens. */
  const settling = (during) => {
    const run = ownRun();
    run.othersAtArm.set(FOREIGN, "Shutdown");
    run.simulator.shown = 1;
    run.simulator.launchedAt = ARMED + 30_000;
    const host = fakeHost();
    const order = [];
    const exec = host.deps.exec;
    host.deps.exec = async (file, args, o) => {
      if (file === "/usr/bin/xcrun" && args[1] === "list")
        order.push(host.state.list.includes('"Booted"') ? "list (foreign Booted)" : "list");
      return exec(file, args, o);
    };
    host.deps.kill = (pid, signal) => {
      order.push(`kill ${signal}`);
      host.killed.push({ pid, signal });
    };
    let slept = false;
    host.deps.sleep = async () => {
      if (slept) return;
      slept = true;
      during(host);
      order.push("— the settle's sleep —");
    };
    return { run, host, order };
  };
  // a foreign device boots, and the run's app appears, while teardown settles: never SIGTERMed beside it
  const late = settling((host) => {
    host.state.list = hostList([{ udid: FOREIGN, state: "Booted" }]);
    host.state.pgrep = "4242";
  });
  const verdict = await restoreHost(late.run, late.host.deps, ctx);
  assert.deepEqual(late.host.killed, [], late.order.join(" → "));
  // the fence read again after the settle, and nothing killed after it
  const settled = late.order.indexOf("— the settle's sleep —");
  assert.ok(late.order.indexOf("list (foreign Booted)", settled) > settled, late.order.join(" → "));
  const said = late.host.said.find((line) => line.startsWith("PHONE_HOST_RESTORED "));
  assert.match(said, /left running beside a foreign booted device/u);
  assert.match(said, /quit-app skipped: a foreign device booted during teardown/u);
  // another's device kept the run's app (S-1): the run's own side stands, and the observation names it
  assert.equal(verdict.ownOk, true);
  assert.equal(verdict.ok, false);
  // control: the app appears alone — the fence read again is clear, and the quit is SIGTERM
  const alone = settling((host) => {
    host.state.pgrep = "4242";
  });
  await restoreHost(alone.run, alone.host.deps, ctx);
  assert.deepEqual(alone.host.killed, [{ pid: 4242, signal: "SIGTERM" }]);
  const kill = alone.order.indexOf("kill SIGTERM");
  assert.equal(alone.order[kill - 1], "list", alone.order.join(" → "));
});

test("the stage's output, guarded: a reader gone never kills the run — later lines dropped, teardown runs, its STOP, HOST_RESTORED and HID lines mirrored (S-2)", async () => {
  // launch() guards stdout and stderr BEFORE the arm, and writes nothing raw (the command's lines among it)
  const launch = launchSource();
  assert.doesNotMatch(launch, /process\.(stdout|stderr)\.write/u);
  const armed = launch.indexOf("await arm(");
  for (const stream of ["process.stdout", "process.stderr"]) {
    const at = launch.indexOf(`guardedOutput(${stream}`);
    assert.ok(at >= 0 && at < armed, `${stream} guarded before the arm`);
  }
  // a pipe whose reader went away (a closed terminal's EIO alike): its first write errors EPIPE — and with no listener
  // that `error` would end the process before teardown
  const written = [];
  const pipe = new Writable({
    write(chunk, _encoding, done) {
      written.push(String(chunk));
      done(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    },
  });
  const lost = [];
  const out = guardedOutput(pipe, (why) => lost.push(why));
  const mirrored = [];
  const run = ownRun();
  run.othersAtArm.set(FOREIGN, "Shutdown");
  const stage = hostDeps(run.redactor, { write: out.write, mirror: (line) => mirrored.push(line) });
  stage.say("PHONE_ROW SIM-STAGED BEGIN");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(lost, ["EPIPE"]);
  assert.equal(out.gone(), "EPIPE");
  // the run goes on through its STOP and its whole teardown on that same say — nothing thrown, nothing written after
  stopRun(run, stage, "SIM-LIVE: a hand at the Mac before SIM-LIVE");
  stage.say(`PHONE_STOP_UNRESTORED planted ${OWN[0]}`);
  const host = fakeHost();
  const verdict = await restoreHost(
    run,
    { ...host.deps, say: stage.say },
    {
      deleteDevices: false,
      defaultsBefore: "",
      crashDir: join(FIXTURES, "no-crash-reports-here"),
      crashBefore: [],
    },
  );
  assert.equal(verdict.ownOk, true);
  stage.say(
    hidSummary({
      armed: sample(0, 300),
      end: sample(60, 360),
      armedAt: ARMED,
      hands: 1,
      ownInput: false,
    }),
  );
  stage.say("PHONE_REDACTED {}");
  assert.equal(written.length, 1, "the one write that found the reader gone");
  // the mirror: the STOP lines, HOST_RESTORED and the HID summary — redacted, and nothing else
  assert.deepEqual(
    mirrored.map((line) => line.split(" ")[0]),
    ["PHONE_STOP", "PHONE_STOP_UNRESTORED", "PHONE_HOST_RESTORED", "HID:"],
  );
  assert.ok(mirrored.every((line) => line.endsWith("\n")));
  assert.ok(!holdsUdid(mirrored.join("")));
  assert.match(mirrored[1], /planted <pts3-dev-1>/u);
  // a stream that throws on write (a tty's EIO, said at once) is gone too, never thrown
  const tty = guardedOutput(
    Object.assign(new EventEmitter(), {
      write() {
        throw Object.assign(new Error("write EIO"), { code: "EIO" });
      },
    }),
  );
  assert.doesNotThrow(() => tty.write("PHONE_ROWS {}\n"));
  assert.equal(tty.gone(), "EIO");
});

test("the HID record, guarded at its definition: a failed append is said ONCE as the record incomplete — the rows and the teardown complete, the exit unchanged (RM7.2 hid)", async () => {
  const ctx = {
    deleteDevices: false,
    defaultsBefore: "",
    crashDir: join(FIXTURES, "no-crash-reports-here"),
    crashBefore: [],
  };
  const HID_LOG = "/lanes/pts3/logs/l2-t1/l2-t1-hid.log";
  const run = ownRun();
  run.othersAtArm.set(FOREIGN, "Shutdown");
  run.last = sample(0, 300);
  const host = fakeHost({ samples: [sample(10, 310), sample(40, 340)] });
  const tried = [];
  // a full disk: every append throws
  host.deps.hid = hidRecord(HID_LOG, host.deps.say, (path, text) => {
    tried.push({ path, text });
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
  });
  // the arm's line, a row's begin and end, the teardown, then the END line launch's finally writes: nothing throws
  assert.doesNotThrow(() => host.deps.hid(hidLine(sample(0, 300))));
  assert.deepEqual((await doorRow({ name: "SIM-STAGED", phase: "begin" }, run, host.deps)).body, {
    go: true,
  });
  assert.deepEqual((await doorRow({ name: "SIM-STAGED", phase: "end" }, run, host.deps)).body, {
    go: true,
  });
  assert.equal(run.served, 1);
  const verdict = await restoreHost(run, host.deps, ctx);
  assert.doesNotThrow(() => host.deps.hid(hidLine(sample(60, 360), { end: true })));
  // every line was tried at the run's HID log — the record keeps trying — and said ONCE as the record incomplete
  assert.equal(tried.length, 4);
  assert.ok(tried.every((t) => t.path === HID_LOG && t.text.endsWith("\n")));
  const incomplete = host.said.filter((line) => line.startsWith("HID: the record is incomplete"));
  assert.equal(incomplete.length, 1, host.said.join("\n"));
  assert.match(incomplete[0], /l2-t1-hid\.log.*ENOSPC/u);
  // the row's pair and HOST_RESTORED said as ever
  for (const line of ["PHONE_ROW SIM-STAGED BEGIN", "PHONE_ROW SIM-STAGED END"])
    assert.ok(host.said.includes(line), line);
  assert.ok(host.said.some((line) => line.startsWith("PHONE_HOST_RESTORED ")));
  // the exit unchanged: no stop, no VOID, the host restored — 0
  assert.equal(run.stopped, null);
  assert.deepEqual(run.voids, []);
  assert.equal(verdict.ok, true);
  assert.deepEqual(
    launchExit({
      signal: null,
      stopped: run.stopped,
      deadlineHit: false,
      code: 0,
      restored: verdict.ownOk,
      foreign: verdict.foreign,
    }),
    { code: 0, lines: [] },
  );
  // through the stage's own say: mirrored into `<run>-stage.log` (a `HID: ` line), and redacted. The real append, at a
  // folder that is not there: ENOENT, said once, and no file made
  const mirrored = [];
  const stage = hostDeps(createRedactor(), { write: () => {}, mirror: (l) => mirrored.push(l) });
  const missing = join(FIXTURES, "no-such-folder");
  const real = hidRecord(join(missing, "l2-t1-hid.log"), stage.say);
  assert.doesNotThrow(() => {
    real(hidLine(sample(0, 300)));
    real(hidLine(sample(60, 360), { end: true }));
  });
  assert.equal(mirrored.length, 1);
  assert.match(mirrored[0], /^HID: the record is incomplete: .*ENOENT/u);
  assert.equal(existsSync(missing), false);
  // a say that throws never makes the record throw
  const mute = hidRecord(
    HID_LOG,
    () => {
      throw new Error("say failed");
    },
    () => {
      throw new Error("append failed");
    },
  );
  assert.doesNotThrow(() => mute("x"));
});

/** RM7.2 hid: launch() defines `deps.hid` as the guarded record, before the arm writes its first line — never a raw
 * append to the HID log (an append that throws would end the run before its teardown). */
const hidGuarded = (launch) => {
  assert.equal(launch.match(/deps\.hid = /gu)?.length, 1, "deps.hid defined once");
  const at = launch.indexOf("deps.hid = hidRecord(opts.hidLog, deps.say);");
  assert.ok(at >= 0, "deps.hid is the guarded record, said through the stage's own say");
  assert.ok(at < launch.indexOf("await arm("), "defined before the arm's first HID line");
  assert.doesNotMatch(launch, /appendFileSync\(opts\.hidLog/u, "never a raw append to the HID log");
};

test("launch: deps.hid is the guarded record, and an edit back to a raw append is caught (RM7.2 hid)", () => {
  const launch = launchSource();
  hidGuarded(launch);
  const mutations = {
    "a raw append": launch.replace(
      "deps.hid = hidRecord(opts.hidLog, deps.say);",
      'deps.hid = (line) => appendFileSync(opts.hidLog, line + "\\n");',
    ),
    "said nowhere": launch.replace(
      "deps.hid = hidRecord(opts.hidLog, deps.say);",
      "deps.hid = hidRecord(opts.hidLog, () => {});",
    ),
  };
  for (const [what, mutated] of Object.entries(mutations)) {
    assert.ok(mutated !== launch, `${what}: the mutation applies`);
    assert.throws(() => hidGuarded(mutated), assert.AssertionError, what);
  }
});

// ─── the responsible app, ENUM and the cost sampler ───────────────────────────────────────────────────────────────────

test("responsibleApp: the ancestor chain's first .app, or none; ps rows keep a comm with spaces", () => {
  const chain = [
    "  901   900 node",
    "  900   880 /bin/zsh",
    "  880   870 login",
    "  870     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
  ].map(parsePsRow);
  assert.deepEqual(chain[0], { pid: 901, ppid: 900, comm: "node" });
  assert.equal(responsibleApp(chain), "/System/Applications/Utilities/Terminal.app");
  assert.deepEqual(
    parsePsRow("  12  1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
    {
      pid: 12,
      ppid: 1,
      comm: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    },
  );
  assert.equal(responsibleApp(chain.slice(0, 3)), null);
  assert.equal(parsePsRow("not a row"), null);
});

test("enumVerdict: ok with a handshake and sources; permission-denied named; no sources is red", () => {
  assert.deepEqual(
    enumVerdict({ code: 0, stdout: '{"ok":true,"handshake":true,"sourceCount":7}\n', stderr: "" }),
    { ok: true, sourceCount: 7, permissionDenied: false },
  );
  const denied = enumVerdict({
    code: 1,
    stdout: "",
    stderr: '{"ok":false,"error":"permission-denied: Screen Recording is not granted"}\n',
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.permissionDenied, true);
  assert.equal(
    enumVerdict({ code: 0, stdout: '{"ok":true,"handshake":true,"sourceCount":0}', stderr: "" }).ok,
    false,
  );
  assert.equal(enumVerdict({ code: 1, stdout: "", stderr: "" }).why, "exit 1");
});

test("costRows: the helper, Simulator.app and each own device's launchd_sim tree, matched in memory — printed with no UDID", () => {
  const helperPath = "/lane/apps/desktop/build/native/macos/live-surface-capture-helper";
  const table = [
    `  500     1  12.5  40960 ${helperPath}`,
    `  600     1   8.0  81920 ${SIM_EXE}`,
    "  700     1   3.0  20480 launchd_sim",
    "  701   700   1.5  10240 SpringBoard",
    "  702   701   0.5   5120 MobileSafari",
    "  800     1   9.9  99999 launchd_sim",
  ].join("\n");
  const commands = [
    `  700 launchd_sim /Users/runner/Library/Developer/CoreSimulator/Devices/${OWN[0]}/data/var/run/launchd_bootstrap.plist`,
    `  800 launchd_sim /Users/runner/Library/Developer/CoreSimulator/Devices/${FOREIGN}/data/var/run/launchd_bootstrap.plist`,
  ].join("\n");
  const rows = costRows({
    table,
    commands,
    helperPath,
    simExe: SIM_EXE,
    own: [{ n: 1, udid: OWN[0] }],
  });
  assert.deepEqual(rows.helper, [{ pid: 500, cpu: 12.5, rss: 40960 }]);
  assert.deepEqual(rows.simulator, [{ pid: 600, cpu: 8, rss: 81920 }]);
  assert.deepEqual(rows.devices, { 1: { procs: 3, cpu: 5, rss: 35840 } });
  assert.ok(!holdsUdid(JSON.stringify(rows)));
});
