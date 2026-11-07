import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ENTRIES, HOLES, MODEL_STATE_IDS, PINS, assertCoverage } from "./inputs.mjs";
import { VIEWS, assertMatrix, matrix, matrixSummary } from "./matrix.mjs";

const fixtureDir = join(import.meta.dirname, "..", "fixtures");

test("every model state is painted or explicitly holed", () => {
  assertCoverage();
  assert.equal(MODEL_STATE_IDS.length, 82);
  assert.equal(new Set(MODEL_STATE_IDS).size, 82);
});

test("state by view matrix covers every contract pair", () => {
  const cells = assertMatrix(matrix());
  assert.equal(cells.length, 82 * VIEWS.length);
  const states = new Set(cells.map((cell) => cell.stateId));
  assert.deepEqual([...states].sort(), [...MODEL_STATE_IDS].sort());
  for (const cell of cells) {
    if (cell.disposition === "rendered") {
      const file = join(fixtureDir, `${cell.fixtureId}.json`);
      const envelope = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(envelope.viewId, cell.viewId);
      assert.ok(envelope.lifecycleStates.includes(cell.stateId));
      assert.equal(envelope.component.sha, PINS.puppeteer);
      assert.equal(envelope.origin, "synthetic");
      assert.ok(envelope.syntheticLabel.length >= 12);
    }
    if (cell.disposition === "not-applicable") {
      assert.equal(cell.fixtureId, undefined);
      assert.match(cell.evidence, /^Outside this view:/);
    }
    if (cell.disposition === "covered-by") {
      assert.match(cell.evidence, /^Same branch as /);
    }
    if (cell.disposition === "coverage-gap") {
      assert.match(cell.evidence, /^Unverified:/);
    }
  }
});

test("priced cost fixtures name claude and codex only", () => {
  for (const id of ["fix.spend.cost-complete", "fix.spend.cost-partial"]) {
    const envelope = JSON.parse(readFileSync(join(fixtureDir, `${id}.json`), "utf8"));
    assert.deepEqual(envelope.adapterIds, ["adapter.claude", "adapter.codex"]);
    assert.match(envelope.notes, /Not a live session/);
  }
});

test("unavailable cost is labeled synthetic and not a normal emission", () => {
  const envelope = JSON.parse(readFileSync(join(fixtureDir, "fix.spend.cost-unavailable.json"), "utf8"));
  assert.match(envelope.notes, /Not a normal adapter emission/);
  assert.match(envelope.notes, /state.cost_missing/);
});

test("defensive branch and unknown-kind fixtures stay synthetic", () => {
  const branch = JSON.parse(readFileSync(join(fixtureDir, "fix.list.branch-none.json"), "utf8"));
  const kind = JSON.parse(readFileSync(join(fixtureDir, "fix.list.blocked-unknown-kind.json"), "utf8"));
  assert.match(branch.notes, /Synthetic defensive fixture/);
  assert.match(branch.notes, /null and absent/);
  assert.match(kind.notes, /Synthetic defensive fixture/);
  assert.match(kind.notes, /permission, question, or failure/);
});

test("statuses are rendered on every view that paints them without WebGPU", () => {
  const cells = matrix();
  for (const stateId of ["state.idle", "state.working", "state.blocked"]) {
    for (const viewId of ["view.list", "view.rain", "view.spend", "view.timeline"]) {
      const cell = cells.find((item) => item.stateId === stateId && item.viewId === viewId);
      assert.equal(cell.disposition, "rendered", `${stateId} ${viewId}`);
    }
    const swarm = cells.find((item) => item.stateId === stateId && item.viewId === "view.swarm");
    assert.equal(swarm.disposition, "environment-gap");
  }
});

test("subtype cells are not dismissed as not-applicable", () => {
  const cells = matrix();
  for (const stateId of ["state.blocked_permission", "state.blocked_question", "state.blocked_failure", "state.unread"]) {
    for (const viewId of ["view.list", "view.rain"]) {
      const cell = cells.find((item) => item.stateId === stateId && item.viewId === viewId);
      assert.notEqual(cell.disposition, "not-applicable", `${stateId} ${viewId}`);
      assert.equal(cell.disposition, "rendered", `${stateId} ${viewId}`);
    }
  }
});

test("the previous 302 not-applicable count is not treated as validated", () => {
  const summary = matrixSummary(matrix());
  assert.equal(summary.cells, 82 * 5);
  assert.equal(summary.priorClaim.notApplicable, 302);
  assert.equal(summary.priorClaim.validated, false);
  assert.ok(summary.notApplicable < 302);
  const total =
    summary.rendered + summary.coveredBy + summary.coverageGap + summary.notApplicable + summary.environmentGap;
  assert.equal(total, 410);
});

test("hole reasons stay source-backed and swarm gaps point at the diagnostic", () => {
  assert.ok(HOLES.length > 0);
  for (const hole of HOLES) assert.ok(hole.reason.length >= 12, hole.stateId);
  const gaps = matrix().filter((cell) => cell.disposition === "environment-gap");
  assert.ok(gaps.length > 0);
  for (const gap of gaps) assert.match(gap.diagnostic, /webgpu-diagnostic.json/);
});

test("fixture directory matches the rendered catalog", () => {
  const files = readdirSync(fixtureDir).filter((name) => name.endsWith(".json"));
  assert.deepEqual(files.sort(), ENTRIES.map((entry) => `${entry.fixtureId}.json`).sort());
});
