import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderFlowSvg } from "../flows/render.mjs";
import { renderShell } from "../web/markup.mjs";
import { createAuditServer } from "../web/serve.mjs";
import { buildCell } from "./cell.mjs";
import { AUDIT_PINS, REQUIRED_COUNTS } from "./contract.mjs";
import { loadAudit } from "./load.mjs";
import { revisionGate } from "./revision.mjs";
import { run } from "./validate.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");

test("pinned source inventory matches the model contract counts", () => {
  const { index, overlay } = loadAudit(ROOT);
  assert.equal(index.coverageClaim.cartesianComplete, false);
  assert.equal(index.coverageClaim.producesShippedCoverage, false);
  assert.equal(index.coverageClaim.semanticValidation, false);
  assert.equal(index.auditTarget.sourceRevision.puppeteer, AUDIT_PINS.puppeteer);
  assert.equal(index.auditTarget.label.includes("newer than the 0.3.3 package"), true);
  for (const [key, expected] of Object.entries(REQUIRED_COUNTS)) {
    assert.equal(index.counts.observed[key], expected, key);
  }
  assert.equal(overlay.verified, true);
  assert.equal(index.sources.evidence, "loaded");
  assert.equal(index.traceCount, 740);
  assert.equal(index.sdkLeafCount, 430);
  assert.equal(index.partial.uiUnchecked, 265);
  assert.equal(index.partial.stateUnchecked, 35);
  assert.equal(index.partial.provenanceComplete, false);
  assert.equal(index.sources.rendering, "partial");
  assert.equal(index.rendering.fixtureCount, 42);
  assert.equal(index.rendering.holeCount, 43);
  assert.equal(index.rendering.screenshotCoverageComplete, false);
  assert.equal(index.rendering.swarmBodyPaint, "webgpu-unavailable");
  const renderer = index.checks.find((item) => item.id === "renderer-coverage");
  assert.equal(renderer.status, "fail");
  assert.ok(renderer.findings.some((item) => item.code === "swarm-fallback"));
  const gaps = index.checks.find((item) => item.id === "gaps");
  assert.equal(gaps.status, "fail");
  assert.match(gaps.summary, /not the 74 row fields/);
  assert.ok(gaps.findings.some((item) => item.code === "history-states-not-traced"));
  assert.ok(gaps.findings.some((item) => item.code === "branch-none-unknown"));
  assert.ok(gaps.findings.some((item) => item.code === "row-join-pending"));
  const joins = index.checks.find((item) => item.id === "stable-id-joins");
  assert.equal(joins.status, "pass");
});

test("integrated model trio and package context match the pin", () => {
  const report = run(ROOT);
  assert.equal(report.ok, true, JSON.stringify(report.failures, null, 2));
  assert.equal(report.modelIntegration.status, "matched");
  assert.equal(report.modelIntegration.packageCheck, "matched");
  assert.equal(report.modelIntegration.modelBytesIdenticalAtPackageCheckCommit, true);
  assert.deepEqual(report.modelIntegration.missing, []);
  assert.equal(report.packageCheckVerifiedByThisSlice, false);
});

test("a shipped-package pin is mixed input and is not end-to-end", () => {
  const gate = revisionGate({
    pins: {
      vibefield: AUDIT_PINS.vibefield,
      puppeteer: "52d09c8e84951b9a355a6700eac2dfc1290a9fa0",
    },
  });
  assert.equal(gate.admit, false);
  assert.equal(gate.code, "mixed-input");
  const audit = loadAudit(ROOT);
  const cell = buildCell({
    model: audit.model,
    traces: [
      {
        adapterId: "adapter.claude",
        fieldId: "field.status",
        path: "audit/godview/evidence/claude/status.json",
        pins: {
          vibefield: AUDIT_PINS.vibefield,
          puppeteer: "52d09c8e84951b9a355a6700eac2dfc1290a9fa0",
        },
        sourceRevision: {
          vibefield: AUDIT_PINS.vibefield,
          puppeteer: "52d09c8e84951b9a355a6700eac2dfc1290a9fa0",
        },
        envelope: { producer: { name: "status" } },
      },
    ],
    renders: [],
    fallback: audit.overlay,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.claude",
      fieldId: "field.status",
    },
  });
  assert.equal(cell.endToEnd.proven, false);
  assert.equal(cell.runtime.status, "mixed-input");
  assert.equal(cell.declaration.provesUnreachable, false);
});

test("trace paths use the adapter suffix and the field path", () => {
  const dir = mkdtempSync(join(tmpdir(), "gv-audit6-"));
  mkdirSync(join(dir, "audit/godview/evidence/claude"), { recursive: true });
  writeFileSync(
    join(dir, "audit/godview/evidence/claude/cost.coverage.json"),
    JSON.stringify({
      adapterId: "adapter.claude",
      fieldId: "field.cost.coverage",
      pins: { ...AUDIT_PINS },
    }),
  );
  const loaded = loadAudit(dir);
  assert.equal(loaded.traces.length, 1);
  assert.equal(loaded.traces[0].adapterId, "adapter.claude");
  assert.equal(loaded.traces[0].fieldId, "field.cost.coverage");
  assert.equal(
    loaded.problems.some((problem) => problem.code === "trace-path-id-mismatch"),
    false,
  );
});

test("a priced-cost absence is not a runtime impossibility", () => {
  const audit = loadAudit(ROOT);
  const cell = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.past_worked",
      viewId: "view.timeline",
      adapterId: "adapter.grok",
      fieldId: "field.cost.usd",
    },
  });
  assert.equal(cell.endToEnd.proven, false);
  assert.equal(cell.reading.provesRuntimeUnreachable, false);
  assert.equal(cell.reading.producerLimit, "adapter-not-direct");
  assert.match(cell.reading.mismatch, /cost_missing/);
  assert.match(cell.reading.mismatch, /anthropic and openai only/);
  assert.equal(/unreachable/i.test(cell.reading.mismatch), false);
  assert.equal(cell.stateReading.status, "host-claim");
  const reply = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.pi",
      fieldId: "field.reply.text",
    },
  });
  assert.match(reply.reading.mismatch, /conversation family/);
  const question = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.blocked_question",
      viewId: "view.list",
      adapterId: "adapter.grok",
      fieldId: "field.wait.question",
    },
  });
  assert.match(question.reading.mismatch, /questions array/);
  const writable = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.grok",
      fieldId: "field.writable",
    },
  });
  assert.equal(writable.reading.reader, "unknown");
  assert.match(writable.reading.readerNote, /unknown/);
});

test("the page names the audit target and leaves the harness pending", () => {
  const audit = loadAudit(ROOT);
  const cell = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    renderIndex: audit.renderIndex,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.acp",
      fieldId: "field.stale",
    },
  });
  const html = renderShell(audit.index, cell);
  assert.match(html, /newer than the 0\.3\.3 package/);
  assert.match(html, /Meaningful paint: yes/);
  assert.match(html, /Screenshot coverage complete: yes/);
  assert.match(html, /End-to-end proven: no/);
  assert.match(html, /field\.stale/);
  assert.equal(html.includes("produces a shipped 0.3.3 inventory"), false);
  const svg = renderFlowSvg(cell);
  assert.match(svg, /<title>/);
  assert.match(svg, /catalog-consumer-unproven/);
  assert.match(svg, /not an execution log/);
  assert.match(svg, /748d015/);
});

test("swarm fallback is a mount, not painted coverage", () => {
  const audit = loadAudit(ROOT);
  const cell = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    renderIndex: audit.renderIndex,
    selection: {
      stateId: "state.context_hot",
      viewId: "view.swarm",
      adapterId: "adapter.grok",
      fieldId: "field.context.usedPercent",
    },
  });
  assert.equal(cell.paint.mounted, true);
  assert.equal(cell.paint.meaningfulOutput, false);
  assert.equal(cell.paint.screenshotCoverageComplete, false);
  assert.equal(cell.paint.fallbackOnly, true);
  assert.match(cell.paint.note, /WEBGPU UNAVAILABLE/);
  const list = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    renderIndex: audit.renderIndex,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.acp",
      fieldId: "field.status",
    },
  });
  assert.equal(list.paint.meaningfulOutput, true);
  assert.equal(list.paint.screenshotCoverageComplete, true);
  assert.equal(list.synthetic.fixtureKind, "synthetic");
  assert.equal(list.endToEnd.proven, false);
});

test("the QA server answers the page and the flow", async () => {
  const server = createAuditServer(ROOT);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const body = await page.text();
  assert.equal(page.status, 200);
  assert.match(body, /Skip to audit/);
  assert.match(body, /748d015/);
  const fragment = await fetch(
    `http://127.0.0.1:${port}/api/page?state=state.working&view=view.swarm&adapter=adapter.pi&field=field.status`,
  );
  const html = await fragment.text();
  assert.match(html, /state\.working/);
  assert.match(html, /view\.swarm/);
  const svg = await fetch(`http://127.0.0.1:${port}/api/flow.svg`);
  assert.match(await svg.text(), /<svg/);
  const missing = await fetch(`http://127.0.0.1:${port}/api/raw?path=../package.json`);
  assert.equal(missing.status, 404);
  await new Promise((resolve) => server.close(resolve));
});
