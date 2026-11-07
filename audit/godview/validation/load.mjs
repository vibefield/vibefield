import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { matrixSummary, matrix as renderMatrix } from "../rendering/matrix.mjs";
import { boundaryNotice } from "./boundary.mjs";
import { spanAliasProved } from "./cell.mjs";
import {
  AUDIT_PINS,
  AUDIT_TARGET_LABEL,
  COVERAGE_CLAIM,
  INDEX_CONTRACT,
  REQUIRED_COUNTS,
  SLICE,
  SOURCE_LAYOUT,
} from "./contract.mjs";
import { semanticBlockers, uiUnresolved } from "./coverage.mjs";
import { verifyOverlay } from "./fallback.mjs";
import { evaluateMatrix } from "./matrix.mjs";
import { normalizeModel, walkCitations } from "./schema-index.mjs";
import { run as runFoundationGate } from "./validate.mjs";

const MAX_BYTES = 8_000_000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readJson(root, rel) {
  const abs = safe(root, rel);
  if (!existsSync(abs)) return { present: false, rel };
  const size = statSync(abs).size;
  if (size > MAX_BYTES) return { present: true, rel, error: "too-large" };
  try {
    const text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return { present: true, rel, json: JSON.parse(text), text };
  } catch (error) {
    return { present: true, rel, error: error instanceof Error ? error.message : String(error) };
  }
}

export function safe(root, rel) {
  if (
    typeof rel !== "string" ||
    rel === "" ||
    rel.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("path refused");
  }
  const abs = join(root, ...rel.split("/"));
  const back = relative(root, abs);
  if (back.startsWith("..") || back.split(sep).includes("..")) throw new Error("path refused");
  return abs;
}

function observeHead(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function loadTraces(root, problems) {
  const dir = join(root, SOURCE_LAYOUT.evidenceDirectory);
  if (!existsSync(dir)) return [];
  const traces = [];
  for (const adapterDir of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relDir = `${SOURCE_LAYOUT.evidenceDirectory}/${adapterDir.name}`;
    if (!adapterDir.isDirectory()) {
      if (adapterDir.name === "README.md") continue;
      problems.push({ code: "unexpected-evidence-file", path: relDir });
      continue;
    }
    for (const entry of readdirSync(join(dir, adapterDir.name), { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const rel = `${relDir}/${entry.name}`;
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        if (entry.name !== "README.md")
          problems.push({ code: "unexpected-evidence-entry", path: rel });
        continue;
      }
      const fieldPath = entry.name.replace(/\.json$/u, "");
      const file = readJson(root, rel);
      if (file.error || !isObject(file.json)) {
        problems.push({
          code: "evidence-unreadable",
          path: rel,
          message: file.error ?? "not-object",
        });
        continue;
      }
      const expectedAdapter = `adapter.${adapterDir.name}`;
      const expectedField = `field.${fieldPath}`;
      if (file.json.adapterId !== expectedAdapter || file.json.fieldId !== expectedField) {
        problems.push({
          code: "trace-path-id-mismatch",
          path: rel,
          message: `path implies ${expectedAdapter} ${expectedField}`,
        });
      }
      const fieldId = typeof file.json.fieldId === "string" ? file.json.fieldId : expectedField;
      traces.push({
        adapterId: typeof file.json.adapterId === "string" ? file.json.adapterId : expectedAdapter,
        fieldId,
        recordKind: fieldId.startsWith("field.contract.") ? "sdk-leaf" : "row",
        path: rel,
        pins: isObject(file.json.pins) ? file.json.pins : null,
        sourceRevision: isObject(file.json.pins) ? file.json.pins : null,
        envelope: file.json,
        raw: file.json,
      });
    }
  }
  return traces;
}

function loadRenderIndex(root) {
  const file = readJson(root, "audit/godview/rendering/integration.json");
  if (!file.present || file.error || !isObject(file.json)) return null;
  const index = file.json;
  const sourceRevision = {
    vibefield: typeof index.vibefieldSha === "string" ? index.vibefieldSha : "",
    puppeteer: typeof index.sourceSha === "string" ? index.sourceSha : "",
  };
  const cells = renderMatrix().map((cell) => ({
    ...cell,
    evidence: cell.evidence ?? "",
    diagnostic: cell.diagnostic ?? null,
  }));
  const counts = {
    rendered: 0,
    "covered-by": 0,
    "coverage-gap": 0,
    "not-applicable": 0,
    "environment-gap": 0,
  };
  for (const cell of cells) counts[cell.disposition] = (counts[cell.disposition] ?? 0) + 1;
  const summary = matrixSummary(cells);
  const boilerplate =
    /no read of this predicate|do not read|does not read|none of the five views read/i;
  const naUnproven = cells.filter(
    (cell) =>
      cell.disposition === "not-applicable" &&
      (!String(cell.evidence ?? "").startsWith("Outside this view:") ||
        boilerplate.test(cell.evidence ?? "")),
  ).length;
  const fixtures = cells
    .filter((cell) => cell.disposition === "rendered")
    .map((cell) => {
      const screenshot = `audit/godview/rendering/screenshots/${cell.fixtureId}.png`;
      const exists = existsSync(join(root, screenshot));
      return {
        viewId: cell.viewId,
        stateId: cell.stateId,
        lifecycleStates: [cell.stateId],
        fixtureKind: "synthetic",
        syntheticLabel: "Synthetic AgentView input. Not a captured adapter session.",
        fixturePath: `audit/godview/fixtures/${cell.fixtureId}.json`,
        screenshotPath: exists ? screenshot : null,
        evidence: cell.evidence,
        renderStatus: "rendered",
        mounted: true,
        meaningfulOutput: exists,
        selectedFixtureRendered: exists,
        sourceRevision,
        channel: "synthetic-fixture",
      };
    });
  return {
    sourceSha: sourceRevision.puppeteer,
    vibefieldSha: sourceRevision.vibefield,
    foundationCommit: index.foundationCommit ?? null,
    integratedFoundationCommit: "12c7b06ac17263b1f9125391e66242db7e085755",
    cells,
    counts,
    countsMatch:
      cells.length === 410 &&
      counts.rendered === 247 &&
      counts["covered-by"] === 23 &&
      counts["coverage-gap"] === 0 &&
      counts["not-applicable"] === 73 &&
      counts["environment-gap"] === 67 &&
      summary.priorClaim.validated === false &&
      summary.priorClaim.notApplicable === 302 &&
      naUnproven === 0,
    priorClaim: summary.priorClaim,
    priorClaimValidated: false,
    notApplicableProof: naUnproven === 0 ? "outside-view" : "missing",
    naUnproven,
    coveredBy: counts["covered-by"],
    coverageGap: counts["coverage-gap"],
    bodyRendered: counts.rendered,
    bodyCoverageIncludesCoveredBy: false,
    unverifiedSpanAliases: cells
      .filter((cell) => spanAliasProved(cell) === false)
      .map((cell) => `${cell.viewId}:${cell.stateId}`),
    provedCoveredBy:
      counts["covered-by"] - cells.filter((cell) => spanAliasProved(cell) === false).length,
    swarmBodyPaint: "not-painted",
    swarmCause: "under-investigation",
    diagnostic: "audit/godview/rendering/webgpu-diagnostic.json",
    renderSliceCommit: index.renderSliceCommit ?? "08429e06ed86cd9f5617c61fa769793a563e8446",
    ordinaryGapsAreNotComplete: true,
    notApplicableUnderLeadReview: true,
    aliasesUnderLeadReview: true,
    fixtureCount: fixtures.length,
    holeCount: counts["coverage-gap"] + counts["environment-gap"],
    fixtures,
    screenshotCoverageComplete: false,
    meaningfulFixtureCount: fixtures.filter((entry) => entry.meaningfulOutput).length,
  };
}

function loadFixtures(root, problems) {
  const dir = join(root, "audit/godview/fixtures");
  if (!existsSync(dir)) return [];
  const renders = [];
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(join(abs, entry.name), childRel);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      const file = readJson(root, childRel);
      if (file.error || !isObject(file.json)) {
        problems.push({
          code: "fixture-unreadable",
          path: childRel,
          message: file.error ?? "not-object",
        });
        continue;
      }
      const json = file.json;
      renders.push({
        viewId: typeof json.viewId === "string" ? json.viewId : "",
        stateId: Array.isArray(json.lifecycleStates) ? (json.lifecycleStates[0] ?? "") : "",
        lifecycleStates: Array.isArray(json.lifecycleStates) ? json.lifecycleStates : [],
        fixtureKind: json.origin === "synthetic" ? "synthetic" : (json.origin ?? "unknown"),
        syntheticLabel: typeof json.syntheticLabel === "string" ? json.syntheticLabel : "",
        fixturePath: childRel,
        component: json.component ?? null,
        pins: isObject(json.pins) ? json.pins : null,
        sourceRevision: isObject(json.pins) ? json.pins : null,
        channel: "fixture",
      });
    }
  };
  visit(dir, "audit/godview/fixtures");
  return renders;
}

function loadRenders(root, problems) {
  const fixtures = loadFixtures(root, problems);
  const file = readJson(root, SOURCE_LAYOUT.renderingManifest);
  if (!file.present) return fixtures;
  if (file.error) {
    problems.push({
      code: "rendering-unreadable",
      path: SOURCE_LAYOUT.renderingManifest,
      message: file.error,
    });
    return fixtures;
  }
  const json = file.json;
  if (!isObject(json) || !Array.isArray(json.views)) {
    problems.push({ code: "rendering-unrecognized", path: SOURCE_LAYOUT.renderingManifest });
    return fixtures;
  }
  const sourceRevision = isObject(json.sourceRevision)
    ? json.sourceRevision
    : isObject(json.pins)
      ? json.pins
      : null;
  const renders = [];
  for (const view of json.views) {
    if (!isObject(view)) continue;
    const entries = Array.isArray(view.entries) ? view.entries : [];
    for (const entry of entries) {
      if (!isObject(entry)) continue;
      renders.push({
        viewId: String(view.id ?? ""),
        stateId: String(entry.stateId ?? ""),
        fixtureKind: typeof entry.fixtureKind === "string" ? entry.fixtureKind : "unknown",
        fixturePath: typeof entry.fixture === "string" ? entry.fixture : null,
        screenshotPath: typeof entry.screenshot === "string" ? entry.screenshot : null,
        harnessPath: typeof json.harness === "string" ? json.harness : null,
        sourceRevision: isObject(entry.sourceRevision) ? entry.sourceRevision : sourceRevision,
        channel: "synthetic-or-render",
      });
    }
  }
  return [...fixtures, ...renders];
}

function lexicalVibefield(root, model) {
  const links = walkCitations({
    states: model.states,
    fields: model.fields,
    views: model.views,
  }).filter((link) => link.repo === "vibefield");
  const missing = [];
  const seen = new Set();
  let checked = 0;
  for (const link of links) {
    const key = `${link.path}:${link.line ?? ""}:${link.endLine ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checked += 1;
    const abs = join(root, link.path);
    if (!existsSync(abs)) {
      missing.push({ path: link.path, line: link.line ?? null });
      continue;
    }
    const text = readFileSync(abs, "utf8");
    const lines = text.split("\n").length;
    const need = link.endLine ?? link.line;
    if (typeof need === "number" && need > lines) missing.push({ path: link.path, line: need });
  }
  const puppeteer = walkCitations({
    states: model.states,
    fields: model.fields,
    architecture: model.architecture,
  }).filter((link) => link.repo === "puppeteer").length;
  return {
    checked,
    missing,
    puppeteerLinksNotRechecked: puppeteer,
    note: "Vibefield paths were checked for file existence and line extent in this checkout. Puppeteer paths were not reopened. Existence is not semantic proof.",
  };
}

export function loadAudit(root) {
  const problems = [];
  const schemaFile = readJson(root, SOURCE_LAYOUT.schema);
  const validationFile = readJson(root, SOURCE_LAYOUT.validationReport);
  const reportAbs = join(root, SOURCE_LAYOUT.packagePinReport);
  const reportText = existsSync(reportAbs) ? readFileSync(reportAbs, "utf8") : "";
  const notice = reportText
    ? boundaryNotice(reportText)
    : {
        status: "report-unreadable",
        missing: ["file"],
        producesShippedCoverage: false,
        auditedHere: false,
        summary:
          "package-pin-check.md is absent, so the shipped-package context notice has no evidence file.",
      };
  if (!schemaFile.present || schemaFile.error) {
    problems.push({ code: "schema-unreadable", message: schemaFile.error ?? "missing" });
  }
  const model = schemaFile.json
    ? normalizeModel(schemaFile.json)
    : { status: "missing", problems: ["schema-missing"] };
  const traces = loadTraces(root, problems);
  const renderIndex = loadRenderIndex(root);
  const renders = renderIndex?.fixtures ?? loadRenders(root, problems);
  const overlay = verifyOverlay(root);
  const lexical = model.states
    ? lexicalVibefield(root, model)
    : { checked: 0, missing: [], puppeteerLinksNotRechecked: 0 };
  const validation = validationFile.json
    ? {
        evidence: validationFile.json.evidence ?? null,
        evidenceReferencesChecked: validationFile.json.evidenceReferencesChecked ?? null,
        limitations: validationFile.json.limitations ?? "",
        schema: validationFile.json.schema ?? null,
      }
    : null;
  const checks = model.states
    ? evaluateMatrix({ model, traces, renders, validation, lexical, overlay, renderIndex })
    : [];
  let foundationGate = null;
  try {
    foundationGate = runFoundationGate(root);
  } catch (error) {
    foundationGate = {
      ok: false,
      failures: [
        {
          gate: "gate.unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      modelIntegration: null,
    };
  }
  const index = publicIndex({
    model,
    traces,
    renders,
    notice,
    overlay,
    validation,
    lexical,
    checks,
    problems,
    root,
    foundationGate,
    renderIndex,
  });
  return {
    index,
    model,
    traces,
    renders,
    renderIndex,
    overlay,
    notice,
    problems,
  };
}

function publicIndex({
  model,
  traces,
  renders,
  notice,
  overlay,
  validation,
  lexical,
  checks,
  problems,
  root,
  foundationGate,
  renderIndex,
}) {
  return {
    contract: INDEX_CONTRACT,
    slice: SLICE,
    auditTarget: {
      label: AUDIT_TARGET_LABEL,
      sourceRevision: { vibefield: AUDIT_PINS.vibefield, puppeteer: AUDIT_PINS.puppeteer },
      producesShippedCoverage: false,
    },
    observedHead: observeHead(root),
    coverageClaim: COVERAGE_CLAIM,
    boundary: notice,
    sources: {
      schema: model.status ?? "missing",
      evidence: traces.length === 0 ? "pending" : "loaded",
      rendering: renderIndex ? "partial" : renders.length === 0 ? "pending" : "loaded",
      firstHalfAdapters: "partial",
      packagePinReport: notice.status,
      foundationCatalog: "pending",
    },
    counts: {
      required: REQUIRED_COUNTS,
      observed: model.observed ?? null,
      reported: model.reportedCounts ?? null,
    },
    states: (model.states ?? []).map((state) => ({
      id: state.id,
      axis: state.axis,
      scope: state.scope,
      predicate: state.predicate,
      proof: state.proof,
      sourceRevision: state.sourceRevision,
    })),
    views: (model.views ?? []).map((view) => ({
      id: view.id,
      name: view.name,
      fieldCount: view.fieldIds.length,
      consumerCompleteness: view.consumerCompleteness,
      notes: view.notes,
      sourceRevision: view.sourceRevision,
    })),
    adapters: (model.adapters ?? []).map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      sourceRevision: adapter.sourceRevision,
    })),
    fields: (model.fields ?? []).map((field) => ({
      id: field.id,
      path: field.path,
      layer: field.layer,
      adapterFamily: field.adapterFamily,
      typescriptType: field.typescriptType,
      uiReachable: field.classification.uiReachable,
      sourceRevision: field.sourceRevision,
    })),
    api: (model.api ?? []).map((entry) => ({ id: entry.id, name: entry.name, role: entry.role })),
    unknowns: model.unknowns ?? [],
    architecture: (model.architecture ?? []).map((stage) => ({
      stage: stage.stage,
      type: stage.type,
      evidence: stage.evidence,
    })),
    capabilitySummary: {
      declared: model.observed?.declaredCapabilityCells ?? null,
      unknown: model.observed?.unknownCapabilityCells ?? null,
      matrixEntries: model.observed?.capabilityMatrixEntries ?? null,
      provesUnreachable: false,
    },
    overlay: {
      verified: overlay.verified,
      problems: overlay.problems,
      fields: overlay.fields,
      files: overlay.files,
    },
    validation,
    lexical,
    checks,
    problems,
    completeness: model.completeness ?? "",
    traceCount: traces.filter((trace) => trace.recordKind !== "sdk-leaf").length,
    sdkLeafCount: traces.filter((trace) => trace.recordKind === "sdk-leaf").length,
    partial: partialCensus(traces, readJson(root, "audit/godview/plan/gv-audit3-join.json").json),
    sharedMap: sharedMapSummary(root),
    renderCount: renders.length,
    rendering: renderIndex
      ? {
          fixtureCount: renderIndex.fixtureCount,
          meaningfulFixtureCount: renderIndex.meaningfulFixtureCount,
          holeCount: renderIndex.holeCount,
          counts: renderIndex.counts,
          countsMatch: renderIndex.countsMatch,
          priorClaim: renderIndex.priorClaim,
          priorClaimValidated: false,
          notApplicableProof: renderIndex.notApplicableProof,
          naUnproven: renderIndex.naUnproven,
          ordinaryGapsAreNotComplete: true,
          notApplicableUnderLeadReview: true,
          aliasesUnderLeadReview: true,
          coveredBy: renderIndex.coveredBy,
          coverageGap: renderIndex.coverageGap,
          bodyRendered: renderIndex.bodyRendered,
          bodyCoverageIncludesCoveredBy: false,
          provedCoveredBy: renderIndex.provedCoveredBy,
          unverifiedSpanAliases: renderIndex.unverifiedSpanAliases,
          swarmBodyPaint: renderIndex.swarmBodyPaint,
          swarmCause: renderIndex.swarmCause,
          renderSliceCommit: renderIndex.renderSliceCommit,
          screenshotCoverageComplete: false,
          sourceSha: renderIndex.sourceSha,
          note: "Matrix counts are live. Zero ordinary coverage gaps is not a complete audit. Not-applicable cells and same-view aliases are under lead review. Covered-by is not body coverage. The prior 302 not-applicable claim is not validated. Swarm cells stay environment gaps: this host's Chrome 156 GPU process exits without VK_KHR_surface or VK_KHR_xcb_surface, so the adapter is null. No source defect is proven and the source is not exonerated. Delivery is incomplete.",
        }
      : null,
    foundationGate: {
      ok: foundationGate?.ok === true,
      modelIntegration: foundationGate?.modelIntegration ?? null,
      note:
        foundationGate?.modelIntegration?.status === "matched"
          ? "The model trio matches 49fc12da. Those bytes are also the bytes at d53a0fa, and package-pin-check.md matches that context commit. manifest.modelSlice.cherryPickedHere stays false: that flag describes the foundation commit, not this integration's files."
          : "The foundation model-slice gate did not report a matched trio.",
      failures: foundationGate?.failures ?? [],
    },
    idPatterns: {
      state: "state.<snake>",
      field: "field.<Name>",
      view: "view.list | view.rain | view.swarm | view.spend | view.timeline",
      adapter: "adapter.<suffix>",
      trace: "audit/godview/evidence/<suffix>/<fieldPath>.json",
    },
  };
}

function sharedMapSummary(root) {
  const map = readJson(root, "audit/godview/contracts/shared-downstream-map.json").json;
  const filled = readJson(root, "audit/godview/contracts/gv-audit3-join-filled.json").json;
  return {
    kind: "static-code-trace",
    liveRuns: false,
    counts: map?.counts ?? null,
    unresolvedGaps: Array.isArray(map?.unresolvedGaps) ? map.unresolvedGaps : [],
    envelopesComplete: false,
    filledJoinVerdict:
      typeof filled?.downstreamVerdict === "string" ? filled.downstreamVerdict : null,
    filledProvenanceComplete: filled?.provenanceComplete === true,
    uiResolutionCounts: map?.uiResolutionCounts ?? null,
    uiResolutionMeaning: "shared-anchor-bookkeeping",
    adapterSpecificUiResolved: false,
    openEnvelopeIssues: [
      "Shared-map uiResolutionCounts.resolvedUnknown 265 and remainingUnknown 0 are shared-anchor bookkeeping. They are not adapter-specific UI resolution. Envelope uiReachable counts are computed from the files.",
      "The map says non-cost sequences are not reproven. That admission stays open.",
      "First-half 68dde825 states the pricing guard, ledger-before-project chronology, and current versus retained epochs on the priced cost records. Independent signoff is pending. Those records are static, not live.",
      "Second-half d2965818 supersedes 4d86127a. Cost branches stay: grok and opencode increment unpriced, hermes is skipped, kimi and pi never enter the ledger, no epoch has costUsd. Account uiReachable no is the VibeField host only. sourceScope is host-supplied. The Puppeteer Godview host can set account when profileId has a nonempty label. That no is not a global impossibility. Lead review of this slice is separate. Independent signoff is pending.",
      "First-half 9189325 replaces 68dde825. Imported Claude and Codex cost graphs put raw translation before pricing for Claude and the semantic batch at pricing for Codex, then reduce.ts:672-686 and storage at reduce.ts:239-259. The old known-order defect hold is lifted only because those anchors are in the files. Citation verification and independent semantic acceptance are still pending.",
      "Delivery stays incomplete.",
    ],
  };
}

function partialCensus(traces, join) {
  const first = new Set([
    "adapter.acp",
    "adapter.antigravity",
    "adapter.claude",
    "adapter.codex",
    "adapter.copilot",
  ]);
  const rows = traces.filter(
    (trace) => trace.recordKind !== "sdk-leaf" && first.has(trace.adapterId),
  );
  const uiUnchecked = rows.filter((trace) => uiUnresolved(trace.envelope)).length;
  const states = Array.isArray(join?.stateReachability) ? join.stateReachability : [];
  const stateUnchecked = states.filter((row) => row?.verdict === "unknown").length;
  const notesOf = (trace) => String(trace.envelope?.verification?.notes ?? "");
  return {
    uiUnchecked,
    stateUnchecked,
    liveUnobserved: states.filter((row) => row?.liveObserved === false).length,
    accountUnknown: rows.filter(
      (trace) =>
        trace.fieldId === "field.account" &&
        trace.envelope?.classification?.uiReachable === "unknown",
    ).length,
    conditionalStatic: rows.filter((trace) =>
      notesOf(trace).includes("not observed in a live session"),
    ).length,
    staticNotLive: rows.filter((trace) => {
      const notes = notesOf(trace);
      return (
        notes.includes("did not live-sample") || notes.includes("not observed in a live session")
      );
    }).length,
    evidenceKind: "source-read",
    firstHalfCommit: "918932531febecf58acbef95a1bd11defb082ab2",
    candidateStatus: "static-not-live",
    secondHalfCommit: "d29658187de7a765837d01c20b456b74c857185f",
    accountTraceCommit: "08b5d849177685662b43e0e3a4e6bd7d32ac2cdf",
    independentSemanticReview: "pending",
    blockers: semanticBlockers(traces),
    delivery: "incomplete",
    provenanceComplete: join?.provenanceComplete === true,
    downstreamVerdict: typeof join?.downstreamVerdict === "string" ? join.downstreamVerdict : null,
    note: "Delivery is incomplete. Independent semantic acceptance is pending. First-half 9189325 cost-order anchors are in the imported graphs and the old defect hold is lifted only for that check. Second-half d2965818 account uiReachable no is the VibeField host only, not a global impossibility. Render 08429e06 still has 67 Swarm environment gaps. Zero ordinary coverage gaps is not a complete audit.",
  };
}

export function emptySelection(index) {
  return {
    stateId: index.states[0]?.id ?? "",
    viewId: index.views.find((view) => view.id === "view.list")?.id ?? index.views[0]?.id ?? "",
    adapterId: index.adapters[0]?.id ?? "",
    fieldId:
      index.fields.find((field) => field.id === "field.status")?.id ?? index.fields[0]?.id ?? "",
  };
}
