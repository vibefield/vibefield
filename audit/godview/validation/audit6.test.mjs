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
import { readField } from "./coverage.mjs";
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
  assert.equal(index.partial.uiUnchecked, 0);
  assert.equal(index.partial.staticNotLive, 370);
  assert.equal(index.partial.stateUnchecked, 0);
  assert.equal(index.partial.liveUnobserved, 410);
  assert.equal(index.partial.accountUnknown, 0);
  assert.equal(index.partial.evidenceKind, "source-read");
  assert.equal(index.partial.independentSemanticReview, "pending");
  assert.equal(index.partial.provenanceComplete, false);
  assert.equal(index.partial.firstHalfCommit, "68dde825266e63ba63a1b07f7fcfd1e85f868b1f");
  assert.equal(index.partial.candidateStatus, "static-not-live");
  assert.equal(index.partial.secondHalfCommit, "d29658187de7a765837d01c20b456b74c857185f");
  assert.equal(index.partial.accountTraceCommit, "08b5d849177685662b43e0e3a4e6bd7d32ac2cdf");
  assert.equal(index.partial.delivery, "incomplete");
  assert.equal(index.partial.blockers.first.directNoYes, 0);
  assert.equal(index.partial.blockers.first.modelAxes, 0);
  assert.equal(index.partial.blockers.first.costStops, 24);
  assert.equal(index.partial.blockers.first.ui.yes, 247);
  assert.equal(index.partial.blockers.first.ui.no, 123);
  assert.equal(index.partial.blockers.first.ui.unknown, 0);
  assert.deepEqual(index.partial.blockers.costReview.first.precisionPending.sort(), [
    "adapter.claude",
    "adapter.codex",
  ]);
  assert.deepEqual(index.partial.blockers.costReview.first.ownerStated, []);
  assert.deepEqual(index.partial.blockers.costReview.second.pendingCorrection, []);
  assert.deepEqual(index.partial.blockers.costReview.second.branches, {
    "adapter.grok": "unpriced-increment",
    "adapter.hermes": "noncanonical-skip",
    "adapter.kimi": "never-ledger",
    "adapter.opencode": "unpriced-increment",
    "adapter.pi": "never-ledger",
  });
  assert.equal(index.partial.blockers.costReview.independentSignoff, "pending");
  assert.deepEqual(index.partial.blockers.accountHostPending, []);
  assert.deepEqual(index.partial.blockers.accountVibefieldOnly.sort(), [
    "adapter.grok",
    "adapter.hermes",
    "adapter.kimi",
    "adapter.opencode",
    "adapter.pi",
  ]);
  assert.equal(index.sharedMap.adapterSpecificUiResolved, false);
  assert.equal(index.sharedMap.uiResolutionMeaning, "shared-anchor-bookkeeping");
  assert.equal(index.sharedMap.uiResolutionCounts.resolvedUnknown, 265);
  assert.equal(index.sharedMap.uiResolutionCounts.remainingUnknown, 0);
  assert.equal(index.partial.provenanceComplete, false);
  assert.equal(index.sharedMap.kind, "static-code-trace");
  assert.equal(index.sharedMap.liveRuns, false);
  assert.equal(index.sharedMap.envelopesComplete, false);
  assert.equal(index.sharedMap.counts.normalizedEvents, 37);
  assert.equal(index.sharedMap.counts.rowFieldContinuations, 74);
  assert.equal(index.sharedMap.counts.statePredicates, 82);
  assert.equal(index.sharedMap.counts.rowJoinAnchorsResolved, 370);
  assert.equal(index.sources.rendering, "partial");
  assert.equal(index.rendering.fixtureCount, 247);
  assert.equal(index.rendering.countsMatch, true);
  assert.equal(index.rendering.bodyRendered, 247);
  assert.equal(index.rendering.coveredBy, 23);
  assert.equal(index.rendering.coverageGap, 0);
  assert.equal(index.rendering.ordinaryGapsAreNotComplete, true);
  assert.equal(index.rendering.counts.rendered, 247);
  assert.equal(index.rendering.counts["covered-by"], 23);
  assert.equal(index.rendering.counts["coverage-gap"], 0);
  assert.equal(index.rendering.counts["not-applicable"], 73);
  assert.equal(index.rendering.counts["environment-gap"], 67);
  assert.equal(index.rendering.renderSliceCommit, "08429e06ed86cd9f5617c61fa769793a563e8446");
  assert.equal(index.rendering.priorClaimValidated, false);
  assert.equal(index.rendering.priorClaim.notApplicable, 302);
  assert.equal(index.rendering.priorClaim.validated, false);
  assert.equal(index.rendering.notApplicableProof, "outside-view");
  assert.equal(index.rendering.naUnproven, 0);
  assert.equal(index.rendering.bodyCoverageIncludesCoveredBy, false);
  assert.equal(index.rendering.swarmBodyPaint, "not-painted");
  assert.equal(index.rendering.swarmCause, "under-investigation");
  assert.equal(index.partial.conditionalStatic, 0);
  assert.equal(index.rendering.screenshotCoverageComplete, false);
  const renderer = index.checks.find((item) => item.id === "renderer-coverage");
  assert.equal(renderer.status, "fail");
  assert.ok(renderer.findings.some((item) => item.code === "swarm-fallback"));
  const gaps = index.checks.find((item) => item.id === "gaps");
  assert.equal(gaps.status, "fail");
  assert.match(gaps.summary, /not the 74 row fields/);
  assert.ok(gaps.findings.some((item) => item.code === "history-states-not-traced"));
  assert.ok(gaps.findings.some((item) => item.code === "branch-none-unknown"));
  assert.ok(gaps.findings.some((item) => item.code === "first-half-static"));
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
  assert.equal(cell.reading.producerLimit, "absent");
  assert.equal(cell.reading.success, false);
  assert.equal(cell.reading.falseFullSuccess, true);
  assert.match(cell.reading.mismatch, /cost_missing/);
  assert.match(cell.reading.mismatch, /anthropic and openai only/);
  assert.equal(/unreachable/i.test(cell.reading.mismatch), false);
  assert.equal(cell.graphOrder.status, "scoped-static");
  assert.equal(cell.graphOrder.branch, "unpriced-increment");
  assert.match(cell.graphOrder.note, /cost_missing/);
  assert.match(cell.graphOrder.note, /burn_unpriced/);
  const claudeCost = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.cost_missing",
      viewId: "view.spend",
      adapterId: "adapter.claude",
      fieldId: "field.cost.usd",
    },
  });
  const codexCost = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.cost_missing",
      viewId: "view.spend",
      adapterId: "adapter.codex",
      fieldId: "field.cost.usd",
    },
  });
  assert.equal(claudeCost.graphOrder.status, "precision-pending");
  assert.equal(codexCost.graphOrder.status, "precision-pending");
  assert.match(claudeCost.graphOrder.note, /reduce\.ts:1049-1073/);
  assert.match(claudeCost.graphOrder.note, /672-686/);
  assert.match(claudeCost.reading.mismatch, /before pricing/);
  assert.equal(/mapping is still pending/i.test(claudeCost.reading.mismatch ?? ""), false);
  assert.equal(/row mapping/i.test(claudeCost.reading.mismatch ?? ""), false);
  assert.match(codexCost.reading.mismatch, /672-686/);
  assert.equal(/mapping is still pending/i.test(codexCost.reading.mismatch ?? ""), false);
  assert.match(codexCost.graphOrder.note, /not rewritten/);
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
  assert.match(html, /Selected fixture rendered: yes/);
  assert.match(html, /Overall screenshot coverage complete: no/);
  assert.match(html, /End-to-end proven: no/);
  assert.match(html, /field\.stale/);
  assert.equal(html.includes("produces a shipped 0.3.3 inventory"), false);
  const svg = renderFlowSvg(cell);
  assert.match(svg, /<title>/);
  assert.match(svg, /is-stale/);
  assert.match(svg, /not an execution log/);
  assert.match(svg, /748d015/);
  assert.match(html, /rendererRead/);
  assert.match(html, /Independent semantic review: pending/);
  assert.match(html, /not adapter-specific UI resolution/);
  assert.match(html, /Delivery: incomplete/);
  assert.match(html, /Prior 302 not-applicable claim validated: no/);
  assert.match(html, /Coverage gaps: 0/);
  assert.match(html, /Environment gaps: 67/);
  assert.match(html, /not a complete audit/);
  assert.match(html, /under lead review/);
  assert.equal(/stay at 35/.test(html), false);
  assert.match(html, /does not add body coverage/);
  assert.equal(cell.reading.success, false);
  assert.equal(cell.reading.channels.rendererRead, "direct");
  assert.equal(cell.reading.channels.sourceScope, "common-runtime");
  assert.equal(cell.reading.channels.uiReachable, "yes");
  assert.equal(cell.reading.channels.adapterPathReader, "not-adapter-emission");
  assert.equal(cell.reading.success, false);
});

test("ACP cost stops at omission and status names the decision path", () => {
  const audit = loadAudit(ROOT);
  const cost = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.cost_missing",
      viewId: "view.spend",
      adapterId: "adapter.acp",
      fieldId: "field.cost.usd",
    },
  });
  assert.equal(cost.reading.channels.uiReachable, "no");
  assert.equal(cost.reading.channels.rendererRead, "direct");
  assert.equal(cost.reading.channels.sourceScope, "absent");
  assert.equal(cost.reading.channels.staticPresence, "omitted");
  assert.equal(cost.reading.channels.evidenceKind, "source-read");
  assert.equal(cost.reading.channels.liveTested, false);
  assert.equal(cost.reading.success, false);
  assert.equal(cost.reading.falseFullSuccess, false);
  assert.equal(cost.graphOrder.status, "stops-at-omission");
  const status = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.acp",
      fieldId: "field.status",
    },
  });
  const names = status.runtime.transforms.map((step) => step.name);
  assert.deepEqual(names, [
    "normalized-status-signal",
    "reduce-activity",
    "project-status",
    "derive-status-default",
    "replica-passthrough",
    "readers",
    "window-passthrough",
  ]);
  const statusSvg = renderFlowSvg(status);
  assert.match(statusSvg, /normalized-status-signal/);
  assert.match(statusSvg, /derive-status-default/);
  assert.match(statusSvg, /replica-passthrough/);
  assert.equal(/priceUsageUpdates|usage-pricing/.test(statusSvg), false);
  assert.equal(status.reading.channels.liveTested, false);
  const accounts = [
    "adapter.acp",
    "adapter.antigravity",
    "adapter.claude",
    "adapter.codex",
    "adapter.copilot",
  ].map((adapterId) =>
    buildCell({
      model: audit.model,
      traces: audit.traces,
      renders: audit.renders,
      fallback: audit.overlay,
      selection: {
        stateId: "state.idle",
        viewId: "view.list",
        adapterId,
        fieldId: "field.account",
      },
    }),
  );
  assert.equal(accounts.length, 5);
  for (const account of accounts) {
    assert.equal(account.reading.channels.uiReachable, "no");
    assert.equal(account.reading.channels.runtimeFallback, "host-scoped");
    assert.equal(account.reading.success, false);
    assert.equal(account.reading.provesRuntimeUnreachable, false);
    assert.match(account.reading.readerNote, /not a global impossibility/);
    assert.match(account.reading.readerNote, /usage column/);
  }
  const grokAccount = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.grok",
      fieldId: "field.account",
    },
  });
  assert.equal(grokAccount.reading.channels.runtimeFallback, "host-scoped");
  assert.equal(grokAccount.reading.channels.accountUsage, "usage-column-not-account");
  assert.equal(grokAccount.reading.success, false);
  assert.equal(grokAccount.reading.falseFullSuccess, false);
  assert.equal(grokAccount.reading.provesRuntimeUnreachable, false);
  assert.equal(grokAccount.reading.channels.uiReachable, "no");
  assert.equal(grokAccount.reading.channels.sourceScope, "host-supplied");
  assert.match(grokAccount.reading.readerNote, /VibeField host only/);
  assert.match(grokAccount.reading.readerNote, /not a global adapter impossibility/);
  assert.match(grokAccount.reading.readerNote, /non-empty/);
  assert.match(grokAccount.reading.readerNote, /monitor-host.ts:62,79/);
  const profile = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    selection: {
      stateId: "state.idle",
      viewId: "view.list",
      adapterId: "adapter.grok",
      fieldId: "field.profileSet",
    },
  });
  assert.match(profile.reading.readerNote, /window-rows.ts:119-134/);
  assert.match(profile.reading.readerNote, /native/);
});

test("a generic cost reader is not ACP producer-to-UI success", () => {
  const reading = readField({
    adapterId: "adapter.acp",
    fieldId: "field.cost.usd",
    observation: { presence: "absent", synthetic: false },
    classification: { modelSupported: "yes", adapterEmittable: "no", uiReachable: "yes" },
    applicability: { notes: "" },
    verification: { notes: "A shared spend view can read cost from another adapter." },
    transforms: [],
  });
  assert.equal(reading.channels.genericReader, "present");
  assert.equal(reading.channels.adapterEmission, "absent");
  assert.equal(reading.channels.adapterPathReader, "not-applicable");
  assert.equal(reading.channels.runtimeFallback, "not-established");
  assert.equal(reading.success, false);
  assert.equal(reading.falseFullSuccess, true);
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
  assert.match(cell.paint.note, /not an unreachable state/);
  assert.match(cell.paint.note, /under investigation/);
  assert.match(cell.paint.note, /VK_KHR_surface/);
  assert.match(cell.paint.note, /no source defect is proven/i);
  assert.match(cell.paint.note, /not exonerated/);
  assert.equal(cell.paint.meaningfulOutput, false);
  const listActivity = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    renderIndex: audit.renderIndex,
    selection: {
      stateId: "state.activity_starting",
      viewId: "view.list",
      adapterId: "adapter.acp",
      fieldId: "field.activity.kind",
    },
  });
  assert.equal(listActivity.paint.disposition, "rendered");
  assert.equal(listActivity.paint.meaningfulOutput, true);
  const rainBlock = buildCell({
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    renderIndex: audit.renderIndex,
    selection: {
      stateId: "state.blocked_permission",
      viewId: "view.rain",
      adapterId: "adapter.acp",
      fieldId: "field.status",
    },
  });
  assert.equal(rainBlock.paint.disposition, "rendered");
  assert.equal(rainBlock.paint.meaningfulOutput, true);
  assert.equal(listActivity.paint.fallbackOnly, false);
  assert.ok(listActivity.paint.evidence.length > 12);
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
  assert.equal(list.paint.screenshotCoverageComplete, false);
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
