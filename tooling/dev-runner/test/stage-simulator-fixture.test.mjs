import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
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
  fenceClear,
  handleDoor,
  hidLines,
  hidSummary,
  isOwnName,
  launchChecks,
  MODE_ROWS_FLOOR,
  nativeFresh,
  NONE_DEVELOPER_DIR,
  newestMtime,
  newRun,
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

test("readOptions: the run, the HID log, a 30-minute deadline by default, and KEEP unless the delete flag is 1", () => {
  const hidLog = "/lanes/pts3/logs/l2-t1/l2-t1-hid.log";
  const opts = readOptions({ VF_PHONE_RUN: "l2-t1", VF_PHONE_HID_LOG: hidLog });
  assert.deepEqual(opts.errors, []);
  assert.equal(opts.deadlineMs, DEFAULT_DEADLINE_MS);
  assert.equal(DEFAULT_DEADLINE_MS, 30 * 60_000);
  assert.equal(opts.deleteDevices, false);
  assert.equal(opts.shotDir, "/lanes/pts3/logs/l2-t1/shots");
  assert.equal(opts.enumRecord, "/lanes/pts3/logs/phone-enum.json");
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

test("commandEnv: DEVELOPER_DIR never reaches the command; none points the product at /var/empty; types, never UDIDs", () => {
  const door = {
    origin: "http://127.0.0.1:51234",
    token: "t0k",
    runtime: RT27,
    types: CATALOG.slice(2, 6),
    shotDir: SHOTS,
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
    [["plugins/simulator/dist", "pnpm --filter @vibefield/desktop build:all"]],
  );
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

test("launchChecks: right before the command, the responsible app is the one ENUM proved — or refused, naming both (S5)", () => {
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
  assert.deepEqual(MODE_ROWS_FLOOR, { none: 2, devices: 17, cost: 1 });
  assert.equal(rowsVerdict({ mode: "devices", begin: "devices", end: 19, served: 19 }).ok, true);
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
    /at least 17/u,
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
  assert.deepEqual(restoredVerdict(good), { ok: true, why: [] });
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
