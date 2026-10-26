import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LANDING,
  onlyAr7b,
  perfLocks,
  preflightSiblingsOnly,
  projectCounts,
  runGate,
  STAGES,
  said,
  secondCopiesOutside,
  waitForPerfLocks,
} from "../../../scripts/gate-landing.mjs";

// DK-18 — the landing gate's list and its three readings of MAIN's known reds (scripts/gate-landing.mjs). A red that is main's
// is SAID main's, never passed: the reading must be exact, or a new red hides behind an old one.

test("the list: verify's chain stage by stage, then this host's GPU gates", () => {
  assert.deepEqual(
    STAGES.map((g) => g.name),
    [
      "preflight",
      "check:walls",
      "check:deps",
      "check:retired",
      "check:ios-fixtures",
      "icons:check",
      "typecheck",
      "lint",
      "fmt",
      "lint:rust",
      "bundle:assert",
      "test",
      "test:rust",
      "gen:check",
    ],
  );
  assert.deepEqual(
    LANDING.map((g) => g.name),
    [
      "still",
      "smoke",
      "smoke:canvas",
      "smoke:canvas:no-gpu",
      "smoke:canvas:no-webgpu",
      "smoke:kind-faults",
      "smoke:plugin-restart",
      "smoke:plugin",
      "smoke:godview",
      "smoke:terminal-door",
      "smoke:terminal-direct",
      "smoke:studio",
      "smoke:bundled",
    ],
  );
});

const SIBLING =
  "preflight FAIL: ghosttea is at 10d0b17bbc14 but siblings.lock.json pins 8a0930e86fc7 — sync the sibling to the pin, or accept the new revision deliberately: `pnpm siblings:pin` (EL8)";

test("preflight: red by a sibling off its pin alone is main's; any other FAIL is not", () => {
  assert.equal(
    preflightSiblingsOnly(`$ node scripts/preflight.mjs\n${SIBLING}\n`),
    "a sibling off its pin: ghosttea",
  );
  assert.equal(
    preflightSiblingsOnly(
      `${SIBLING}\npreflight FAIL: pnpm-workspace.yaml does not pin "@vibecook/ice": 0.15.0\n`,
    ),
    null,
  );
  assert.equal(preflightSiblingsOnly("preflight FAIL: import-boundary walls failed\n"), null);
});

const ROOT = "/repo/vf-desk";
const block = (name, hereVersion, there) =>
  `  2 distinct ${name} copies are resolvable:\n` +
  `      ${hereVersion}  ← packages/field-app, node_modules/.pnpm/x\n` +
  `        ${ROOT}/node_modules/.pnpm/${name}/package.json\n` +
  `      ${there}  ← /repo/vibe-field/node_modules/.pnpm/react@19.2.7/node_modules/react\n` +
  `        /repo/vibe-field/node_modules/.pnpm/${name}/package.json\n`;
const MILLE = `✗ EL8 single-copy law violated:\n\n${block("loro-crdt", "1.13.8", "1.13.8")}\n${block("@vibecook/ice", "0.15.0", "0.11.0")}\n`;

test("check:deps: every second copy outside this checkout is main's mille row; a second copy HERE is not", () => {
  assert.equal(
    secondCopiesOutside(MILLE, ROOT),
    "the second copies all outside this checkout (/repo/vibe-field)",
  );
  const here =
    `✗ EL8 single-copy law violated:\n\n  2 distinct loro-crdt copies are resolvable:\n` +
    `      1.13.8  ← packages/field-app\n      1.13.9  ← packages/fieldd\n`;
  assert.equal(secondCopiesOutside(here, ROOT), null);
  assert.equal(secondCopiesOutside(`${MILLE}${here.split("\n\n")[1]}`, ROOT), null);
  assert.equal(secondCopiesOutside("check-single-copy: ok — one copy each", ROOT), null);
});

const TASKS = (projects) =>
  ` NX   Running target test for 25 projects failed\n\nFailed tasks:\n\n${projects.map((p) => `- ${p}:test\n`).join("")}`;
const AR7B =
  " FAIL  test/agent-gateway.test.ts > a name typed in a pane — the REAL floor (AR-7b) > row 1 — type it: the pane's shell runs the launcher\n";

test("test: red by fieldd's agent-gateway AR-7b row alone is main's; another row or project is not", () => {
  assert.equal(
    onlyAr7b(`${AR7B}${TASKS(["@vibefield/fieldd"])}`),
    "fieldd's agent-gateway AR-7b row alone",
  );
  // ANSI colour, as vitest prints it in a terminal
  assert.equal(
    onlyAr7b(
      `\u001b[31m FAIL \u001b[39m test/agent-gateway.test.ts > a name typed in a pane — the REAL floor (AR-7b) > row 1\n${TASKS(["@vibefield/fieldd"])}`,
    ),
    "fieldd's agent-gateway AR-7b row alone",
  );
  assert.equal(
    onlyAr7b(
      `${AR7B} FAIL  test/index-timeline.test.ts > SP-6 > rosetta's barrier\n${TASKS(["@vibefield/fieldd"])}`,
    ),
    null,
  );
  assert.equal(onlyAr7b(`${AR7B}${TASKS(["@vibefield/fieldd", "@vibefield/field-app"])}`), null);
});

test("test: every project's count from its own section — one with none is SAID so, with its exit from Nx's list", () => {
  const out =
    "> nx run @vibefield/fieldd:test\n\n Test Files  1 failed | 155 passed | 1 skipped (157)\n" +
    "      Tests  1 failed | 1908 passed | 23 skipped (1932)\n" +
    "> nx run @vibefield/dev-runner:test\n\nℹ tests 129\nℹ pass 129\nℹ fail 0\n" +
    // what the final run printed of field-app: 64 KiB of its files, never its count
    '> nx run @vibefield/field-app:test\n\n ✓ test/history-doors.test.ts (18 tests) 36ms\nGODVIEW_DECK {"active\n' +
    "> nx run @vibefield/plugin-cli:test\n\n ✓ test/a.test.ts (3 tests)\n" +
    TASKS(["@vibefield/fieldd", "@vibefield/plugin-cli"]);
  assert.deepEqual(projectCounts(out), [
    "@vibefield/fieldd: Tests  1 failed | 1908 passed | 23 skipped (1932)",
    "@vibefield/dev-runner: pass 129 | fail 0 (node --test)",
    "@vibefield/field-app: NO COUNT in the log — its exit: 0 (not among the failed tasks)",
    "@vibefield/plugin-cli: NO COUNT in the log — its exit: FAILED",
  ]);
});

test("a verdict quotes the run's own words for its result", () => {
  const lines = said(
    'noise\n      Tests  1 failed | 1908 passed | 23 skipped (1932)\nSMOKE_DAEMONS {"left":[]}\nmore noise\n',
  );
  assert.deepEqual(lines, [
    "Tests  1 failed | 1908 passed | 23 skipped (1932)",
    'SMOKE_DAEMONS {"left":[]}',
  ]);
});

// DEBTS (s-debts-fieldd.md Appendix 3) — a perf measurement owns the host while its lock exists: the run waits before EACH
// gate while any lock `VF_PERF_LOCKS` names is there, and says so. The paths are the caller's (this script is public).

test("the perf locks are the caller's, colon-separated; none named is none", () => {
  assert.deepEqual(perfLocks({}), []);
  assert.deepEqual(perfLocks({ VF_PERF_LOCKS: "" }), []);
  assert.deepEqual(perfLocks({ VF_PERF_LOCKS: "/a/PERF.lock:/b/PERF.lock" }), [
    "/a/PERF.lock",
    "/b/PERF.lock",
  ]);
  assert.deepEqual(perfLocks({ VF_PERF_LOCKS: ":/a/PERF.lock::" }), ["/a/PERF.lock"]);
});

/** A host whose locks stand for `polls` looks each, the clock moving a minute a look. */
function host(present, polls) {
  let clock = 0;
  let looks = 0;
  const said = [];
  const sleeps = [];
  return {
    said,
    sleeps,
    looks: () => looks,
    opts: {
      exists: (path) => {
        looks += 1;
        return present.includes(path) && sleeps.length < polls;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += 60_000;
      },
      say: (line) => said.push(line),
      now: () => clock,
      pollMs: 60_000,
    },
  };
}

test("no lock named: today's run exactly — nothing is looked at, nothing said, no wait", async () => {
  const h = host(["/a/PERF.lock"], 5);
  assert.equal(await waitForPerfLocks([], "smoke", h.opts), 0);
  assert.equal(h.looks(), 0);
  assert.deepEqual(h.said, []);
  assert.deepEqual(h.sleeps, []);
});

test("a lock named but absent: the gate starts at once, and nothing is said", async () => {
  const h = host([], 5);
  assert.equal(await waitForPerfLocks(["/a/PERF.lock", "/b/PERF.lock"], "smoke", h.opts), 0);
  assert.deepEqual(h.said, []);
  assert.deepEqual(h.sleeps, []);
});

test("a lock present: the gate waits until it is gone, and the wait is said when it starts and when it ends", async () => {
  const h = host(["/b/PERF.lock"], 3);
  const waited = await waitForPerfLocks(["/a/PERF.lock", "/b/PERF.lock"], "smoke:godview", h.opts);
  assert.equal(waited, 180_000);
  assert.deepEqual(h.sleeps, [60_000, 60_000, 60_000]);
  assert.deepEqual(h.said, [
    "GATE_WAIT smoke:godview waits: a perf lock is held (/b/PERF.lock)",
    "GATE_WAIT smoke:godview waited 180s for the perf lock",
  ]);
});

// Tooling (5) — a gate's stdout and stderr ARE its log file. Nx prints at most 64 KiB of a task's section to a pipe; a
// file gets every byte. The stand-in gate says what its own descriptors are, then writes past 64 KiB on both (every
// tenth row on stderr).
const STAND_IN = [
  'const { fstatSync, writeSync } = require("node:fs");',
  'writeSync(1, "stdout is a file: " + fstatSync(1).isFile() + "\\n");',
  'writeSync(2, "stderr is a file: " + fstatSync(2).isFile() + "\\n");',
  'const x = "x".repeat(64);',
  "for (let i = 0; i < Number(process.argv[1]); i++)",
  '  writeSync(i % 10 === 9 ? 2 : 1, "row " + String(i).padStart(5, "0") + " " + x + "\\n");',
  'writeSync(1, "END\\n");',
].join("\n");

test("a gate's stdout and stderr are its log file: every byte, past 64 KiB, in the order written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-gate-landing-test-"));
  try {
    const rows = 3_000;
    const logPath = join(dir, "01-stand-in.log");
    const result = await runGate(
      { name: "stand-in", run: [process.execPath, "-e", STAND_IN, String(rows)] },
      logPath,
      120_000,
    );
    assert.deepEqual(
      { code: result.code, timedOut: result.timedOut },
      { code: 0, timedOut: false },
    );
    let expected = "stdout is a file: true\nstderr is a file: true\n";
    for (let i = 0; i < rows; i++)
      expected += `row ${String(i).padStart(5, "0")} ${"x".repeat(64)}\n`;
    expected += "END\n";
    const log = readFileSync(logPath, "utf8");
    assert.ok(Buffer.byteLength(log) > 3 * 64 * 1024, `${Buffer.byteLength(log)} bytes`);
    assert.equal(log, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a gate past its timeout: its group is stopped, and the stop is appended to the same log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-gate-landing-test-"));
  try {
    const logPath = join(dir, "01-sleeper.log");
    const timeoutMs = 500;
    const result = await runGate(
      { name: "sleeper", run: [process.execPath, "-e", "setTimeout(() => {}, 60_000);"] },
      logPath,
      timeoutMs,
    );
    assert.deepEqual(
      { code: result.code, signal: result.signal, timedOut: result.timedOut },
      { code: 128, signal: "SIGTERM", timedOut: true },
    );
    assert.equal(
      readFileSync(logPath, "utf8"),
      `\ngate-landing: sleeper ran past ${timeoutMs / 60_000} min and was stopped\n`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
