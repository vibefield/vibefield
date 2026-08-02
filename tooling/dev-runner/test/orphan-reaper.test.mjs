import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyOrphans,
  findDevRunSockets,
  parseProcessList,
  parseUnixSocketOwners,
  reapDevOrphans,
} from "../src/orphan-reaper.mjs";

const RUNTIME_ROOT = "/repo/.vibefield/dev/runtime";
const DATA_ROOT = "/repo/.vibefield/dev/data";
const CURRENT = "dev-111111111111111111111111";
const STALE = "dev-222222222222222222222222";

const nativeIn = (snapshot) => `${RUNTIME_ROOT}/${snapshot}/native/field-native`;
const fielddIn = (snapshot) => `${RUNTIME_ROOT}/${snapshot}/fieldd/bin.cjs`;
const mgmtSocket = `${DATA_ROOT}/native/run/mgmt.sock`;

function classify(overrides) {
  return classifyOrphans({
    runtimeRoot: RUNTIME_ROOT,
    dataRoot: DATA_ROOT,
    keepSnapshots: [CURRENT],
    selfPid: 999,
    ...overrides,
  });
}

test("a previous session's native under a dead snapshot is a stale-snapshot orphan", () => {
  const orphans = classify({
    processes: [
      { pid: 501, exePath: nativeIn(STALE) },
      { pid: 502, exePath: nativeIn(CURRENT) },
    ],
  });

  assert.equal(orphans.length, 1);
  assert.deepEqual(orphans[0], {
    pid: 501,
    exePath: nativeIn(STALE),
    reason: "stale-snapshot",
    snapshot: STALE,
  });
});

test("the adoptable pair is spared even though its snapshot is no longer current", () => {
  // A shell-only edit moves the combined snapshot id while the daemon identity
  // stands still, so the pair the new shell will adopt runs out of the OLD
  // directory. Killing it here would delete the adoption feature.
  const orphans = classify({
    processes: [
      { pid: 501, exePath: fielddIn(STALE) },
      { pid: 502, exePath: nativeIn(STALE) },
      { pid: 503, exePath: nativeIn(STALE) },
    ],
    socketOwners: [{ pid: 502, socketPath: mgmtSocket }],
    keepPids: [501, 502],
  });

  assert.deepEqual(
    orphans.map((o) => o.pid),
    [503],
  );
});

test("a current-snapshot native holding the socket survives being in nobody's product.json", () => {
  // fieldd records `nativePid` only when it SPAWNED the native, so a native it
  // ADOPTED is named by no product.json and reaches us with an empty keepPids.
  // It is running this session's exact bytes and holding the socket is its job;
  // reaping it would kill every live session for no reason at all.
  const orphans = classify({
    processes: [{ pid: 502, exePath: nativeIn(CURRENT) }],
    socketOwners: [{ pid: 502, socketPath: mgmtSocket }],
    keepPids: [],
  });

  assert.deepEqual(orphans, []);
});

test("the runner never reaps itself", () => {
  const orphans = classify({
    processes: [{ pid: 999, exePath: nativeIn(STALE) }],
    socketOwners: [{ pid: 999, socketPath: mgmtSocket }],
  });

  assert.deepEqual(orphans, []);
});

test("anything holding a dev socket is a squatter, whatever its executable is", () => {
  const orphans = classify({
    processes: [
      { pid: 601, exePath: "/Applications/VibeField.app/Contents/MacOS/field-native" },
      { pid: 602, exePath: "/repo/target/debug/field-native" },
    ],
    socketOwners: [
      { pid: 601, socketPath: mgmtSocket },
      { pid: 602, socketPath: `${DATA_ROOT}/native/run/terminal-control.sock` },
    ],
  });

  assert.deepEqual(
    orphans.map((o) => ({ pid: o.pid, reason: o.reason })),
    [
      { pid: 601, reason: "socket-squatter" },
      { pid: 602, reason: "socket-squatter" },
    ],
  );
  assert.equal(orphans[0].exePath, "/Applications/VibeField.app/Contents/MacOS/field-native");
});

test("a packaged pair on its own data root is left alone", () => {
  // Precision, not pattern-matching: same binary name, no evidence it is ours.
  const orphans = classify({
    processes: [{ pid: 701, exePath: "/Applications/VibeField.app/Contents/MacOS/field-native" }],
    socketOwners: [
      { pid: 701, socketPath: "/Users/someone/Library/Application Support/VibeField/run/x.sock" },
    ],
  });

  assert.deepEqual(orphans, []);
});

test("a socket outside a run directory does not convict its owner", () => {
  const orphans = classify({
    processes: [{ pid: 801, exePath: "/usr/local/bin/something" }],
    socketOwners: [
      { pid: 801, socketPath: `${DATA_ROOT}/native/mgmt.sock` },
      { pid: 801, socketPath: `${DATA_ROOT}/native/run/notes.txt` },
    ],
  });

  assert.deepEqual(orphans, []);
});

test("a process convicted by both classes is reported once, as stale-snapshot", () => {
  const orphans = classify({
    processes: [{ pid: 901, exePath: nativeIn(STALE) }],
    socketOwners: [{ pid: 901, socketPath: mgmtSocket }],
  });

  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].reason, "stale-snapshot");
});

test("an orphan whose snapshot was already pruned away is still convicted", () => {
  // The runner prunes old snapshots on every start, so the executable path is
  // usually a ghost by the time we look — provenance is a string fact.
  const orphans = classify({
    processes: [{ pid: 1001, exePath: `${nativeIn(STALE)} (deleted)` }],
  });

  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].exePath, nativeIn(STALE));
});

test("a runtime-root lookalike outside the namespace is not ours", () => {
  const orphans = classify({
    processes: [
      { pid: 1101, exePath: `${RUNTIME_ROOT}-backup/${STALE}/native/field-native` },
      { pid: 1102, exePath: "/repo/.vibefield/dev/runtime" },
      { pid: 1103, exePath: null },
    ],
  });

  assert.deepEqual(orphans, []);
});

test("the ladder escalates to SIGKILL only for a process that outlives SIGTERM", async () => {
  const signals = [];
  const stubborn = new Set([502]);
  const summary = await reapDevOrphans({
    paths: { runtimeRoot: RUNTIME_ROOT, dataRoot: DATA_ROOT },
    log: { warn: () => {} },
    keepSnapshots: [CURRENT],
    findSockets: async () => [mgmtSocket],
    listProcesses: async () => [
      { pid: 501, exePath: nativeIn(STALE) },
      { pid: 502, exePath: nativeIn(STALE) },
    ],
    listSocketOwners: async () => [],
    kill: (pid, signal) => signals.push([pid, signal]),
    isAlive: () => true,
    waitForExit: async (pid) => !stubborn.has(pid),
  });

  assert.deepEqual(signals, [
    [501, "SIGTERM"],
    [502, "SIGTERM"],
    [502, "SIGKILL"],
  ]);
  assert.equal(
    summary,
    "reaped 2 development orphans (2 stale-snapshot, 0 socket-squatter, 1 force-killed)",
  );
});

test("a clean tree reaps nothing and says so", async () => {
  const killed = [];
  const summary = await reapDevOrphans({
    paths: { runtimeRoot: RUNTIME_ROOT, dataRoot: DATA_ROOT },
    log: { warn: () => {} },
    keepSnapshots: [CURRENT],
    findSockets: async () => [],
    listProcesses: async () => [{ pid: 502, exePath: nativeIn(CURRENT) }],
    listSocketOwners: async () => [],
    kill: (pid, signal) => killed.push([pid, signal]),
    isAlive: () => true,
    waitForExit: async () => true,
  });

  assert.deepEqual(killed, []);
  assert.equal(summary, "no development orphans were holding the dev tree");
});

test("a process that dies between the listing and the signal is not an error", async () => {
  const summary = await reapDevOrphans({
    paths: { runtimeRoot: RUNTIME_ROOT, dataRoot: DATA_ROOT },
    log: { warn: () => {} },
    keepSnapshots: [CURRENT],
    findSockets: async () => [],
    listProcesses: async () => [{ pid: 501, exePath: nativeIn(STALE) }],
    listSocketOwners: async () => [],
    kill: () => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    },
    isAlive: () => true,
    waitForExit: async () => true,
  });

  assert.equal(summary, "reaped 1 development orphan (1 stale-snapshot, 0 socket-squatter)");
});

test("lsof records attribute every name to the pid that opened the record", () => {
  // Real `lsof -U -Fpn` output: `f<fd>` lines ride along uninvited, peer
  // addresses appear as `->0x…`, and one process can hold the socket twice.
  const stdout = [
    "p400",
    "f6",
    "n->0x50cbe09e4899729a",
    "f13",
    `n${DATA_ROOT}/native/run/terminal-control.sock`,
    "p502",
    "f9",
    `n${mgmtSocket}`,
    "f11",
    `n${mgmtSocket}`,
    "p600",
    "f3",
    "n/private/var/run/mDNSResponder",
    "",
  ].join("\n");

  assert.deepEqual(parseUnixSocketOwners(stdout, [mgmtSocket]), [
    { pid: 502, socketPath: mgmtSocket },
    { pid: 502, socketPath: mgmtSocket },
  ]);
});

test("ps lines keep executable paths that contain spaces", () => {
  const stdout = [
    "    1 /sbin/launchd",
    " 8321 /Applications/My App.app/Contents/MacOS/field-native",
    "  PID COMM",
    "",
  ].join("\n");

  assert.deepEqual(parseProcessList(stdout), [
    { pid: 1, exePath: "/sbin/launchd" },
    { pid: 8321, exePath: "/Applications/My App.app/Contents/MacOS/field-native" },
  ]);
});

test("the socket walk finds run/*.sock and nothing else", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vf-orphan-reaper-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "native", "run"), { recursive: true });
  await mkdir(join(root, "fieldd", "run"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "native", "run", "mgmt.sock"), ""),
    writeFile(join(root, "native", "run", "product.json"), "{}"),
    writeFile(join(root, "native", "stray.sock"), ""),
    writeFile(join(root, "fieldd", "run", "lane.sock"), ""),
  ]);

  const found = (await findDevRunSockets(root)).sort();

  assert.deepEqual(found, [
    join(root, "fieldd", "run", "lane.sock"),
    join(root, "native", "run", "mgmt.sock"),
  ]);
});

test("an absent data root yields no sockets rather than an error", async () => {
  assert.deepEqual(await findDevRunSockets(join(tmpdir(), "vf-orphan-reaper-missing")), []);
});
