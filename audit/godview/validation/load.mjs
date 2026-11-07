import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { boundaryNotice } from "./boundary.mjs";
import {
  AUDIT_PINS,
  AUDIT_TARGET_LABEL,
  COVERAGE_CLAIM,
  INDEX_CONTRACT,
  REQUIRED_COUNTS,
  SLICE,
  SOURCE_LAYOUT,
} from "./contract.mjs";
import { verifyOverlay } from "./fallback.mjs";
import { evaluateMatrix } from "./matrix.mjs";
import { normalizeModel, walkCitations } from "./schema-index.mjs";
import { run as runFoundationGate } from "./validate.mjs";

const MAX_BYTES = 2_000_000;

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
  const fixtures = (Array.isArray(index.fixtures) ? index.fixtures : []).map((entry) => {
    const screenshot = typeof entry.screenshot === "string" ? entry.screenshot : null;
    const fallbackShot = screenshot?.endsWith("environment-swarm.png") === true;
    const meaningfulOutput =
      entry.renderStatus === "rendered" &&
      (entry.paint === "dom" || entry.paint === "canvas") &&
      Boolean(screenshot) &&
      !fallbackShot;
    return {
      viewId: String(entry.viewId ?? ""),
      stateId: Array.isArray(entry.lifecycleStates) ? (entry.lifecycleStates[0] ?? "") : "",
      lifecycleStates: Array.isArray(entry.lifecycleStates) ? entry.lifecycleStates : [],
      fixtureKind: "synthetic",
      syntheticLabel: "Synthetic AgentView input. Not a captured adapter session.",
      fixturePath: typeof entry.file === "string" ? entry.file : null,
      screenshotPath: screenshot,
      paint: entry.paint ?? null,
      renderStatus: entry.renderStatus ?? null,
      mounted: true,
      meaningfulOutput,
      screenshotCoverageComplete: meaningfulOutput,
      sourceRevision,
      channel: "synthetic-fixture",
    };
  });
  const holes = (Array.isArray(index.holes) ? index.holes : []).map((hole) => {
    const reason = String(hole.reason ?? "");
    const webgpu = /WEBGPU UNAVAILABLE/i.test(reason);
    return {
      stateId: String(hole.stateId ?? ""),
      reason,
      viewId: webgpu ? "view.swarm" : null,
      mounted: webgpu,
      meaningfulOutput: false,
      screenshotCoverageComplete: false,
      fallbackOnly: webgpu,
      screenshotPath: webgpu ? "audit/godview/rendering/screenshots/environment-swarm.png" : null,
    };
  });
  return {
    sourceSha: sourceRevision.puppeteer,
    vibefieldSha: sourceRevision.vibefield,
    swarmBodyPaint: index.swarmBodyPaint ?? null,
    fixtureCount: fixtures.length,
    holeCount: holes.length,
    fixtures,
    holes,
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
      firstHalfAdapters: "pending",
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
    renderCount: renders.length,
    rendering: renderIndex
      ? {
          fixtureCount: renderIndex.fixtureCount,
          meaningfulFixtureCount: renderIndex.meaningfulFixtureCount,
          holeCount: renderIndex.holeCount,
          swarmBodyPaint: renderIndex.swarmBodyPaint,
          screenshotCoverageComplete: false,
          sourceSha: renderIndex.sourceSha,
          note: "Synthetic fixtures are not captured sessions. A mount is not meaningful paint. Swarm body paint is webgpu-unavailable: environment-swarm.png is the fallback message, not complete screenshot coverage. GV-AUDIT3 evidence is not loaded; that half is correcting a uiReachable mapping.",
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
  const uiUnchecked = rows.filter(
    (trace) => trace.envelope?.classification?.uiReachable === "unknown",
  ).length;
  const states = Array.isArray(join?.stateReachability) ? join.stateReachability : [];
  const stateUnchecked = states.filter((row) => row?.verdict === "unknown").length;
  return {
    uiUnchecked,
    stateUnchecked,
    provenanceComplete: join?.provenanceComplete === true,
    downstreamVerdict: typeof join?.downstreamVerdict === "string" ? join.downstreamVerdict : null,
    note: "First-half row mapping is partial. UI paths and state predicates still marked unknown are unchecked. SDK leaves are not row coverage. Envelope completion is still incoming.",
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
