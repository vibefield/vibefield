import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ENTRIES, HOLES, MODEL_STATE_IDS, PINS, SWARM_RUNTIME_ENTRIES, assertCoverage } from "./inputs.mjs";
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

test("swarm runtime rows stay out of the rendered catalog", () => {
  const cells = matrix();
  const gaps = cells.filter((cell) => cell.disposition === "environment-gap");
  assert.equal(gaps.length, 67);
  assert.equal(new Set(gaps.map((cell) => cell.viewId)).size, 1);
  const runtimeStates = new Set(SWARM_RUNTIME_ENTRIES.map((entry) => entry.stateId));
  const unmountable = gaps.filter((cell) => !runtimeStates.has(cell.stateId)).map((cell) => cell.stateId).sort();
  assert.deepEqual(unmountable, ["state.attachable", "state.terminal_opening"]);
  for (const entry of SWARM_RUNTIME_ENTRIES) {
    assert.equal(entry.viewId, "view.swarm");
    assert.equal(ENTRIES.some((item) => item.fixtureId === entry.fixtureId), false);
    const cell = gaps.find((item) => item.stateId === entry.stateId);
    assert.equal(cell.disposition, "environment-gap");
    assert.equal(cell.fixtureId, undefined);
  }
  assert.equal(SWARM_RUNTIME_ENTRIES.find((entry) => entry.stateId === "state.context_hot").fixtureId, "fix.swarm.context-hot");
  assert.equal(SWARM_RUNTIME_ENTRIES.find((entry) => entry.stateId === "state.working").fixtureId, "fix.swarm.runtime.working");
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
  assert.equal(summary.coverageGap, 0);
  assert.equal(summary.rendered, 249);
  assert.equal(summary.coveredBy, 21);
  assert.equal(summary.notApplicable, 73);
  assert.equal(summary.environmentGap, 67);
  const total =
    summary.rendered + summary.coveredBy + summary.coverageGap + summary.notApplicable + summary.environmentGap;
  assert.equal(total, 410);
});

test("not-applicable is only a scenario that cannot be mounted", () => {
  const allowed = new Set([
    "state.feed_no_door",
    "state.feed_connecting",
    "state.feed_live",
    "state.feed_unavailable",
    "state.device_live",
    "state.device_stale",
    "state.device_asleep",
    "state.device_incompatible",
    "state.dead_hidden",
    "state.terminal_opening",
    "state.timeline_unborn",
    "state.timeline_unrecorded",
    "state.timeline_past",
    "state.timeline_ended",
    "state.timeline_span",
    "state.spend_unknown",
  ]);
  for (const cell of matrix()) {
    if (cell.disposition !== "not-applicable") continue;
    assert.ok(allowed.has(cell.stateId), cell.stateId);
    if (cell.stateId.startsWith("state.timeline_")) assert.notEqual(cell.viewId, "view.timeline");
    if (cell.stateId === "state.spend_unknown") assert.notEqual(cell.viewId, "view.spend");
    if (cell.stateId === "state.terminal_opening") assert.notEqual(cell.viewId, "view.swarm");
  }
});

test("timeline span is a measured live head, not a history check", () => {
  const source = readFileSync(new URL("./matrix.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /live-head-span/);
  assert.doesNotMatch(source, /ended-lane/);
  assert.doesNotMatch(source, /history == null && entry\?\.stateId === "state\.working"/);
  assert.doesNotMatch(source, /entry\?\.history === "bounds"/);
  const span = matrix().find((cell) => cell.stateId === "state.timeline_span" && cell.viewId === "view.timeline");
  assert.equal(span.disposition, "rendered");
  assert.equal(span.fixtureId, "fix.timeline.moment-span");
  assert.equal(span.exercise, undefined);
  const evidence = JSON.parse(readFileSync(join(import.meta.dirname, "timeline-span-evidence.json"), "utf8"));
  assert.equal(evidence.branch, "span");
  assert.equal(evidence.fixtureId, "fix.timeline.moment-span");
  assert.equal(evidence.tone, "working");
  assert.equal(evidence.recorded, null);
  assert.ok(evidence.headMs >= evidence.sinceMs);
  assert.match(evidence.valueText, /^Now/);
  assert.match(evidence.readout, /working/);
  assert.doesNotMatch(evidence.readout, /not recorded|not started/);
  const integration = JSON.parse(readFileSync(join(import.meta.dirname, "integration.json"), "utf8"));
  assert.deepEqual(integration.timelineSpanEvidence, evidence);
});

test("timeline ended is a measured live head, not a history check", () => {
  const ended = matrix().find((cell) => cell.stateId === "state.timeline_ended" && cell.viewId === "view.timeline");
  assert.equal(ended.disposition, "rendered");
  assert.equal(ended.fixtureId, "fix.timeline.moment-ended");
  assert.equal(ended.exercise, undefined);
  const evidence = JSON.parse(readFileSync(join(import.meta.dirname, "timeline-ended-evidence.json"), "utf8"));
  assert.equal(evidence.branch, "ended");
  assert.equal(evidence.tone, "ended");
  assert.ok(evidence.headMs >= evidence.endedAt);
  assert.match(evidence.valueText, /^Now/);
  assert.match(evidence.readout, /last active/);
  const integration = JSON.parse(readFileSync(join(import.meta.dirname, "integration.json"), "utf8"));
  assert.deepEqual(integration.timelineEndedEvidence, evidence);
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
