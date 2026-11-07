import { REQUIRED_COUNTS } from "./contract.mjs";
import { coverageReport } from "./coverage.mjs";
import { validateProvenance } from "./graph.mjs";
import { revisionGate } from "./revision.mjs";

function finding(code, message, ids = {}) {
  return { code, message, ...ids };
}

function duplicates(items, idOf) {
  const seen = new Set();
  const dupes = [];
  for (const item of items) {
    const id = idOf(item);
    if (id === "") continue;
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  return [...new Set(dupes)].sort();
}

function check(id, title, status, summary, findings = []) {
  return {
    id,
    title,
    status,
    summary,
    findings: [...findings].sort((a, b) =>
      `${a.code}\0${a.message}`.localeCompare(`${b.code}\0${b.message}`),
    ),
  };
}

export function evaluateMatrix({
  model,
  traces,
  renders,
  validation,
  lexical,
  overlay,
  renderIndex,
}) {
  const checks = [
    countCheck(model),
    stableIdCheck(model),
    pinCheck(model),
    revisionGateCheck(traces, renders),
    rendererCheck(renders, renderIndex),
    gapCheck(model, traces),
    duplicateCheck(model, traces, renders),
    graphCheck(traces),
    lexicalCheck(validation, lexical),
    overlayCheck(overlay),
  ];
  return checks;
}

function countCheck(model) {
  const findings = [];
  for (const [key, expected] of Object.entries(REQUIRED_COUNTS)) {
    const observed = model.observed[key];
    const reported = model.reportedCounts[key];
    if (observed !== expected) {
      findings.push(
        finding(
          "count-mismatch",
          `${key} observed ${observed}, contract report expected ${expected}`,
        ),
      );
    }
    if (reported !== expected) {
      findings.push(
        finding(
          "reported-count-mismatch",
          `${key} schema counts object says ${reported}, expected ${expected}`,
        ),
      );
    }
  }
  const statusEnum = model.observed.statusEnum.join(",");
  if (statusEnum !== "idle,working,blocked") {
    findings.push(finding("status-enum", `AgentStatus enum is ${statusEnum || "absent"}`));
  }
  const summary =
    findings.length === 0
      ? "Contract counts match: 3 statuses, 82 state branches, 74 fields, 19 API entries, 5 views, 10 adapters, 90 declared capability cells. Unknown capability cells are excluded from the 90 and are not a Cartesian product."
      : "Contract counts do not match the required model-slice figures.";
  return check(
    "counts",
    "Contract counts",
    findings.length === 0 ? "pass" : "fail",
    summary,
    findings,
  );
}

function stableIdCheck(model) {
  const findings = [];
  const fieldIds = new Set(model.fields.map((field) => field.id));
  const stateIds = new Set(model.states.map((state) => state.id));
  const adapterIds = new Set(model.adapters.map((adapter) => adapter.id));
  for (const id of duplicates(model.fields, (field) => field.id)) {
    findings.push(finding("duplicate-field", id));
  }
  for (const id of duplicates(model.states, (state) => state.id)) {
    findings.push(finding("duplicate-state", id));
  }
  for (const id of duplicates(model.views, (view) => view.id)) {
    findings.push(finding("duplicate-view", id));
  }
  for (const id of duplicates(model.adapters, (adapter) => adapter.id)) {
    findings.push(finding("duplicate-adapter", id));
  }
  for (const id of duplicates(model.api, (entry) => entry.id)) {
    findings.push(finding("duplicate-api", id));
  }
  for (const id of duplicates(model.contractFieldIds, (entry) => entry)) {
    findings.push(finding("duplicate-contract-field", id));
  }
  for (const view of model.views) {
    for (const fieldId of view.fieldIds) {
      if (!fieldIds.has(fieldId))
        findings.push(finding("orphan-view-field", `${view.id} ${fieldId}`));
    }
  }
  for (const restriction of model.restrictions) {
    if (!adapterIds.has(restriction.adapter)) {
      findings.push(finding("orphan-restriction-adapter", restriction.adapter));
    }
    for (const fieldId of restriction.fieldIds) {
      if (!fieldIds.has(fieldId)) findings.push(finding("orphan-restriction-field", fieldId));
    }
    for (const stateId of restriction.stateIds) {
      if (!stateIds.has(stateId)) findings.push(finding("orphan-restriction-state", stateId));
    }
  }
  for (const cell of model.capabilityCells) {
    if (!adapterIds.has(cell.adapterId)) {
      findings.push(finding("orphan-capability-adapter", cell.adapterId));
    }
  }
  for (const field of model.fields) {
    if (!field.id.startsWith("field.")) findings.push(finding("field-id-shape", field.id));
    if (field.shape && field.shape.found === false) {
      findings.push(finding("shape-unresolved", `${field.id} ${field.path}`));
    }
  }
  return check(
    "stable-id-joins",
    "Stable id joins",
    findings.length === 0 ? "pass" : "fail",
    findings.length === 0
      ? "Field, state, view, adapter, and API ids join. Unresolved shapes and orphan references would fail this check."
      : "Stable ids do not join.",
    findings,
  );
}

function pinCheck(model) {
  const findings = model.problems.map((code) =>
    finding(code, "Schema pins differ from the audit target."),
  );
  for (const problem of model.citationProblems) {
    findings.push(finding(problem.code, `${problem.repo} ${problem.sha} ${problem.path}`));
  }
  return check(
    "pin-consistency",
    "Source pin consistency",
    findings.length === 0 ? "pass" : "fail",
    findings.length === 0
      ? "Schema pins and contract citations use vibefield 433505fd and puppeteer 748d015."
      : "A contract citation or the schema pin is not the audit target.",
    findings,
  );
}

function revisionGateCheck(traces, renders) {
  const findings = [];
  for (const trace of traces) {
    const gate = revisionGate(trace);
    if (!gate.admit) {
      findings.push(
        finding(
          gate.code,
          `trace ${trace.adapterId ?? "?"} ${trace.fieldId ?? "?"} ${trace.stateId ?? "?"}`,
        ),
      );
    }
  }
  for (const render of renders) {
    const gate = revisionGate(render);
    if (!gate.admit) {
      findings.push(finding(gate.code, `render ${render.viewId ?? "?"} ${render.stateId ?? "?"}`));
    }
  }
  const loaded = traces.length + renders.length;
  const status = findings.length > 0 ? "fail" : "pass";
  const summary =
    loaded === 0
      ? "Revision gate is armed. No trace or render is loaded. A fixture that cites any puppeteer revision other than 748d015 is mixed input and will not be joined."
      : findings.length === 0
        ? "Every loaded trace and render cites puppeteer 748d015 and vibefield 433505fd."
        : "Mixed input was caught and is excluded from end-to-end proof.";
  return check("revision-gate", "Source revision gate", status, summary, findings);
}

function rendererCheck(renders, renderIndex) {
  if (!renderIndex && renders.length === 0) {
    return check(
      "renderer-coverage",
      "Renderer coverage",
      "blocked",
      "Five views are declared on pinned source. The render harness and its fixtures are absent, so renderer coverage is not computed and is not claimed.",
    );
  }
  const findings = [];
  for (const render of renders) {
    const gate = revisionGate(render);
    if (!gate.admit) findings.push(finding(gate.code, `${render.viewId} ${render.stateId}`));
  }
  if (renderIndex) {
    findings.push(
      finding(
        "synthetic-fixtures",
        `${renderIndex.meaningfulFixtureCount} synthetic fixtures have DOM or canvas screenshots. They are not captured adapter sessions.`,
      ),
    );
    findings.push(
      finding(
        "render-holes",
        `${renderIndex.coverageGap ?? 0} coverage gaps are unverified and ${renderIndex.counts?.["environment-gap"] ?? 0} environment gaps have no swarm body. Covered-by cells are exercised equivalents, not additional body renders.`,
      ),
    );
    if (
      renderIndex.swarmBodyPaint === "webgpu-unavailable" ||
      renderIndex.swarmBodyPaint === "environment-blocked" ||
      renderIndex.swarmBodyPaint === "not-painted"
    ) {
      findings.push(
        finding(
          "swarm-fallback",
          "No swarm body was painted. 59 environment gaps stay open. WEBGPU UNAVAILABLE is host text. Environment versus source cause is under investigation, and this is not body coverage.",
        ),
      );
    }
  }
  return check(
    "renderer-coverage",
    "Renderer coverage",
    "fail",
    "Mount and meaningful paint are separate. Synthetic screenshots and the swarm fallback do not close the view.",
    findings,
  );
}

function gapCheck(model, traces) {
  if (traces.length === 0) {
    return check(
      "gaps",
      "Evidence gaps",
      "blocked",
      "Runtime traces are absent. Gap counts are not computed, and absent evidence is not treated as unsupported or as a complete miss list.",
    );
  }
  const report = coverageReport(model, traces);
  const findings = [];
  for (const adapter of report.adapters) {
    if (adapter.records === 0) {
      findings.push(finding("adapter-half-pending", `${adapter.adapterId} has no field records`));
      continue;
    }
    const partial = traces.some(
      (trace) =>
        trace.recordKind !== "sdk-leaf" &&
        trace.adapterId === adapter.adapterId &&
        String(trace.envelope?.verification?.notes ?? "").includes("PENDING DOWNSTREAM"),
    );
    if (partial) {
      findings.push(
        finding(
          "row-join-pending",
          `${adapter.adapterId} row envelopes keep mapping and UI reachability unknown. SDK contract leaves are not the 74 row fields, and the join is not complete.`,
        ),
      );
    }
    if (
      [
        "adapter.acp",
        "adapter.antigravity",
        "adapter.claude",
        "adapter.codex",
        "adapter.copilot",
      ].includes(adapter.adapterId)
    ) {
      findings.push(
        finding(
          "first-half-static",
          `${adapter.adapterId} records are source-read. Conditional non-cost sequences were not live-tested. field.account stays unknown where host.account supply is unproven. The owner semantic gate's zero is a claim. Independent review is pending. This is not complete.`,
        ),
      );
    }
    if (adapter.records > 0 && adapter.pastAndTimeline.length > 0) {
      findings.push(
        finding(
          "history-states-not-traced",
          `${adapter.adapterId} past and timeline states are a host claim, not an adapter emission. An applicability list is not emission.`,
        ),
      );
    }
    if (adapter.records > 0 && adapter.branchNone) {
      findings.push(
        finding(
          "branch-none-unknown",
          `${adapter.adapterId} does not prove state.branch_none unreachable. Runtime git for a null branch stays unknown.`,
        ),
      );
    }
    if (adapter.nonEmittingRecords > 0) {
      findings.push(
        finding(
          "listed-not-emitted",
          `${adapter.adapterId} has ${adapter.nonEmittingRecords} records that say they do not emit listed states. That list is not a reachable set.`,
        ),
      );
    }
  }
  return check(
    "gaps",
    "Evidence gaps",
    findings.length === 0 ? "pass" : "fail",
    `${report.fieldRecords} canonical row records are loaded. ${report.sdkLeafRecords} SDK leaf records are separate and are not the 74 row fields. Unnamed states stay open. A finished join is not claimed.`,
    findings,
  );
}

function duplicateCheck(model, traces, renders) {
  const findings = [];
  const traceKey = (trace) =>
    trace.path ?? `${trace.adapterId}\0${trace.fieldId}\0${trace.stateId ?? ""}`;
  const renderKey = (render) => `${render.viewId}\0${render.stateId}\0${render.fixtureKind ?? ""}`;
  for (const id of duplicates(traces, traceKey)) {
    findings.push(finding("duplicate-trace", id.replaceAll("\0", " ")));
  }
  for (const id of duplicates(renders, renderKey)) {
    findings.push(finding("duplicate-render", id.replaceAll("\0", " ")));
  }
  for (const id of duplicates(model.states, (state) => state.id)) {
    findings.push(finding("duplicate-state", id));
  }
  return check(
    "duplicates",
    "Duplicates",
    findings.length === 0 ? "pass" : "fail",
    findings.length === 0
      ? "No duplicate state ids, traces, or renders in the loaded set."
      : "Duplicates are present.",
    findings,
  );
}

function graphCheck(traces) {
  const admitted = traces.filter((trace) => revisionGate(trace).admit);
  if (admitted.length === 0) {
    return check(
      "graph-paths",
      "Provenance paths",
      "blocked",
      "No admitted runtime trace is loaded, so no per-field path is claimed valid. A foundation envelope states producer, transforms, merge, transport, and renderer when a trace file arrives. Until then those stages stay pending.",
    );
  }
  const findings = [];
  for (const trace of admitted) {
    if (trace.envelope) {
      for (const key of ["producer", "transforms", "merge", "transport", "renderer"]) {
        if (trace.envelope[key] == null) {
          findings.push(finding("envelope-section-missing", `${trace.path} ${key}`));
        }
      }
      continue;
    }
    const result = validateProvenance(trace.provenance);
    if (result.status !== "valid") {
      findings.push(
        finding(
          `path-${result.status}`,
          `${trace.adapterId} ${trace.fieldId} ${trace.stateId ?? ""} ${result.findings.map((item) => item.code).join(",")}`,
        ),
      );
    }
  }
  return check(
    "graph-paths",
    "Provenance paths",
    findings.length === 0 ? "pass" : "fail",
    findings.length === 0
      ? "Every admitted trace states a valid path at the pinned revisions. Cells without a trace stay out of this result."
      : "An admitted trace does not state a valid path.",
    findings,
  );
}

function lexicalCheck(validation, lexical) {
  const findings = [];
  if (!validation) {
    findings.push(finding("validation-report-missing", "model.validation.json is absent"));
  } else if (typeof validation.limitations !== "string" || validation.limitations === "") {
    findings.push(
      finding("validation-limitations-missing", "The lexical report has no limitations string."),
    );
  }
  for (const miss of lexical?.missing ?? []) {
    findings.push(finding("vibefield-path-missing", `${miss.path}:${miss.line}`));
  }
  const summary = validation
    ? `Model validation reported lexical evidence existence (${validation.evidence ?? "unspecified"}) across ${validation.evidenceReferencesChecked ?? "?"} references. ${validation.limitations ?? ""} Puppeteer paths were not reopened in this checkout. This check is not semantic proof.`
    : "The lexical validation report is missing.";
  return check(
    "lexical-evidence",
    "Lexical evidence report",
    findings.length === 0 ? "pass" : "fail",
    summary,
    findings,
  );
}

function overlayCheck(overlay) {
  return check(
    "vibefield-overlay",
    "Vibefield window-rows overlay",
    overlay?.verified ? "pass" : "fail",
    overlay?.verified
      ? "This checkout aliases MonitorAgent to AgentView, overrides peer staleness from desktop standing, and drops peer profileSet. That is vibefield pin context, not a puppeteer package comparison."
      : `Overlay patterns were not confirmed (${(overlay?.problems ?? []).join(", ")}).`,
    (overlay?.problems ?? []).map((code) => finding(code, code)),
  );
}
