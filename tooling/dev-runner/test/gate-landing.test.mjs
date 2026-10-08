import assert from "node:assert/strict";
import test from "node:test";
import {
  LANDING,
  onlyAr7b,
  preflightSiblingsOnly,
  STAGES,
  said,
  secondCopiesOutside,
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

test("a verdict quotes the run's own words for its result", () => {
  const lines = said(
    'noise\n      Tests  1 failed | 1908 passed | 23 skipped (1932)\nSMOKE_DAEMONS {"left":[]}\nmore noise\n',
  );
  assert.deepEqual(lines, [
    "Tests  1 failed | 1908 passed | 23 skipped (1932)",
    'SMOKE_DAEMONS {"left":[]}',
  ]);
});
