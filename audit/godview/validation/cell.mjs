import { existsSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_PINS, AUDIT_TARGET_LABEL, PROVENANCE_STAGES } from "./contract.mjs";
import {
  costSemantics,
  coverageReport,
  isRowTrace,
  namedStatesFor,
  readField,
  stateOnRecord,
} from "./coverage.mjs";
import { validateProvenance } from "./graph.mjs";
import { revisionGate } from "./revision.mjs";

/**
 * One selected state × view × adapter × field.
 * Channels stay separate: declaration, vibefield overlay, schema default,
 * runtime trace, synthetic render. A declaration of unsupported does not
 * close other sources. End-to-end proof requires an admitted trace whose
 * provenance validates, at the pinned revisions only.
 */

function stateScope(envelope, stateId) {
  const states = envelope?.applicability?.states;
  if (!envelope) return "pending";
  if (states === "model-axes") {
    return "model-axes";
  }
  if (Array.isArray(states) && states.includes(stateId)) return "listed";
  return "not-listed";
}

function findById(list, id) {
  return list.find((item) => item.id === id) ?? null;
}

export function consumerStatus(view, field) {
  if (!view || !field) return { status: "pending", note: "Select a view and a field." };
  if (view.fieldIds.includes(field.id)) {
    return {
      status: "consumed",
      note:
        view.consumerCompleteness ||
        "Listed as a code consumer. That is not proof it is drawn in every state.",
    };
  }
  if (field.classification.uiReachable.startsWith("not-drawn")) {
    return { status: "explicit-not-drawn", note: field.classification.uiReachable };
  }
  return {
    status: "unknown",
    note: "This view's reviewed consumer list does not name the field. Absence of a consumer is unknown unless the contract explicitly rules it out.",
  };
}

export function declarationFor(model, adapter, field) {
  if (!adapter || !field) return { status: "pending", provesUnreachable: false };
  if (!field.adapterFamily) {
    return {
      status: "not-adapter-owned",
      support: null,
      provesUnreachable: false,
      note: "The contract does not assign this field to an adapter family. Host and window derivations stay a separate channel.",
    };
  }
  const cell = model.capabilityCells.find(
    (entry) => entry.adapterId === adapter.id && entry.family === field.adapterFamily,
  );
  if (!cell) {
    return {
      status: "unknown",
      support: "unknown",
      provesUnreachable: false,
      note: "No capability declaration for this adapter and family. That is unresolved, not a negative proof.",
    };
  }
  const support = cell.support;
  const note =
    support === "unsupported"
      ? "Declared unsupported for this adapter's native family. Host, runtime, migration, and other sources stay open. Unsupported is not proof that no source can emit a value."
      : support === "unknown"
        ? "The capability declaration is unknown. Unknown is not a negative proof."
        : "Capability support is a declaration. It is not a traced live session and it does not prove an unreachable state.";
  return {
    status: "declared",
    support,
    provesUnreachable: false,
    limitations: cell.limitations,
    evidence: cell.evidence,
    source: cell.source,
    note,
    sourceRevision: cell.sourceRevision,
  };
}

function overlayFor(field, fallback) {
  if (!field || !fallback) return { applies: false };
  const hit = fallback.fields.find((entry) => entry.fieldId === field.id);
  if (!hit) {
    return {
      applies: false,
      note: "This slice verified the window-rows overlay only for peer staleness and peer profileSet. Other fields are not claimed to lack a fallback.",
    };
  }
  return {
    applies: true,
    verified: fallback.verified,
    fieldId: field.id,
    summary: hit.summary,
    sourceRevision: { vibefield: AUDIT_PINS.vibefield },
    note: "Vibefield overlay at the original vibefield pin. It patches Puppeteer's AgentView for display. It is not a puppeteer adapter trace.",
  };
}

function paintFor(matrixCell, render) {
  if (!matrixCell) {
    return {
      disposition: "unknown",
      mounted: false,
      meaningfulOutput: false,
      selectedFixtureRendered: false,
      screenshotCoverageComplete: false,
      fallbackOnly: false,
      screenshotPath: null,
      evidence: "",
      note: "No matrix cell for this view and state.",
    };
  }
  if (matrixCell.disposition === "rendered") {
    const painted = render?.meaningfulOutput === true;
    return {
      disposition: "rendered",
      mounted: true,
      meaningfulOutput: painted,
      selectedFixtureRendered: painted,
      screenshotCoverageComplete: false,
      fallbackOnly: false,
      evidence: matrixCell.evidence ?? "",
      screenshotPath: painted ? (render.screenshotPath ?? null) : null,
      note: painted
        ? "Selected fixture rendered. Synthetic paint of this view and state only. Overall screenshot coverage is not complete."
        : "The matrix marks this cell rendered, but the screenshot file is not in the tree.",
    };
  }
  if (matrixCell.disposition === "covered-by") {
    return {
      disposition: "covered-by",
      mounted: false,
      meaningfulOutput: false,
      selectedFixtureRendered: false,
      exercisedEquivalent: true,
      screenshotCoverageComplete: false,
      fallbackOnly: false,
      evidence: matrixCell.evidence ?? "",
      fixtureId: matrixCell.fixtureId ?? null,
      screenshotPath: null,
      note: `Exercised equivalent of ${matrixCell.fixtureId ?? "another fixture"} on the same view. This is not a dedicated render of ${matrixCell.stateId} and it does not add body coverage. ${matrixCell.evidence ?? ""}`,
    };
  }
  if (matrixCell.disposition === "coverage-gap") {
    return {
      disposition: "coverage-gap",
      mounted: false,
      meaningfulOutput: false,
      selectedFixtureRendered: false,
      screenshotCoverageComplete: false,
      fallbackOnly: false,
      validatedExclusion: false,
      evidence: matrixCell.evidence ?? "",
      screenshotPath: null,
      note: `Coverage gap, not a render and not an outside-view exclusion. ${matrixCell.evidence ?? ""}`,
    };
  }
  if (matrixCell.disposition === "environment-gap") {
    return {
      disposition: "environment-gap",
      mounted: true,
      meaningfulOutput: false,
      selectedFixtureRendered: false,
      screenshotCoverageComplete: false,
      fallbackOnly: true,
      evidence: matrixCell.evidence ?? "",
      diagnostic: matrixCell.diagnostic ?? "audit/godview/rendering/webgpu-diagnostic.json",
      screenshotPath: null,
      note: "No swarm body was painted. WEBGPU UNAVAILABLE. This host's Chrome 156 GPU process exits without VK_KHR_surface or VK_KHR_xcb_surface, headed and headless, so the adapter is null. An earlier device create/destroy log is inconclusive. No source defect is proven and the source is not exonerated. The cause stays under investigation. This is not an unreachable state and not body coverage.",
    };
  }
  const outside = String(matrixCell.evidence ?? "").startsWith("Outside this view:");
  return {
    disposition: "not-applicable",
    mounted: false,
    meaningfulOutput: false,
    selectedFixtureRendered: false,
    screenshotCoverageComplete: false,
    fallbackOnly: false,
    evidence: matrixCell.evidence ?? "",
    screenshotPath: null,
    applicabilityStatus: outside ? "outside-view" : "unproven",
    validatedExclusion: false,
    priorClaimValidated: false,
    note: outside
      ? `Outside this view, with a source note. The prior 302 not-applicable count is not a validated exclusion. ${matrixCell.evidence}`
      : `Not-applicable without an outside-view proof. Not a validated exclusion. ${matrixCell.evidence ?? ""}`,
  };
}

function costGraphOrder(envelope) {
  const review = costSemantics(envelope);
  if (!review) return null;
  if (review.verification === "stops-at-omission") {
    return {
      status: "stops-at-omission",
      note: "This cost path stops where the adapter omits usage. It does not invent a pricing hop. The record is source-read, not a live sample.",
    };
  }
  if (review.verification === "anchors-checked") {
    return {
      status: "anchors-checked",
      defects: review.defects,
      note: review.note,
    };
  }
  if (review.verification === "precision-pending") {
    return {
      status: "precision-pending",
      defects: review.defects,
      note: review.note,
    };
  }
  if (review.verification === "pending-correction") {
    return {
      status: "pending-correction",
      defects: review.defects,
      note: `Not semantically verified. Pending correction: ${review.defects.join(", ")}. Other fields on this adapter stay usable.`,
    };
  }
  const branch =
    review.branch === "unpriced-increment"
      ? "Canonical usage with cost source unavailable increments unpriced. priced stays 0."
      : review.branch === "noncanonical-skip"
        ? "Noncanonical sample with no pricing, cost, or costUsd is skipped. unpriced does not increment."
        : review.branch === "never-ledger"
          ? "No usage upsert enters the ledger. priced and unpriced stay 0."
          : "Ledger counts precede the project copy.";
  return {
    status: "scoped-static",
    branch: review.branch,
    note: `${branch} No epoch writes costUsd, so there is no retained total. The row is cost_missing and a working body is burn_unpriced. Independent signoff is pending. This is not a live run.`,
  };
}

export function buildCell({ model, traces, renders, fallback, selection, renderIndex = null }) {
  const state = findById(model.states, selection.stateId);
  const view = findById(model.views, selection.viewId);
  const adapter = findById(model.adapters, selection.adapterId);
  const field = findById(model.fields, selection.fieldId);
  const trace =
    traces.find(
      (entry) =>
        isRowTrace(entry) &&
        entry.adapterId === selection.adapterId &&
        entry.fieldId === selection.fieldId,
    ) ?? null;
  const traceGate = trace ? revisionGate(trace) : null;
  const render =
    renders.find((entry) => {
      if (entry.viewId !== selection.viewId) return false;
      if (Array.isArray(entry.lifecycleStates) && entry.lifecycleStates.length > 0) {
        return entry.lifecycleStates.includes(selection.stateId);
      }
      return entry.stateId === selection.stateId;
    }) ?? null;
  const renderGate = render ? revisionGate(render) : null;
  const envelope = trace?.envelope ?? null;
  const provenanceResult = envelope
    ? {
        status: traceGate?.admit ? "stated" : "mixed-input",
        findings: [],
        sections: ["producer", "transforms", "merge", "transport", "renderer"].map((key) => ({
          key,
          present: envelope[key] != null,
        })),
      }
    : trace?.provenance
      ? validateProvenance(trace.provenance)
      : { status: "missing", findings: [] };
  const syntheticRender = render?.fixtureKind === "synthetic";
  const verifiedRender = Boolean(
    render && renderGate?.admit && !syntheticRender && render.fixtureKind !== "unknown",
  );
  const endToEnd = {
    proven: false,
    reason: !trace
      ? "No runtime trace is loaded for this adapter and field. evidence/<suffix>/<fieldPath>.json is pending."
      : !traceGate?.admit
        ? "The trace pins are not vibefield 433505fd and puppeteer 748d015, so the revision gate rejects the join."
        : !render
          ? "The trace is at the audit pin. No view fixture is loaded, so the path is not end-to-end through a renderer."
          : !renderGate?.admit
            ? "The view fixture cites a different source revision, so it is not joined to the trace."
            : syntheticRender
              ? "The view fixture is synthetic. It stays on the synthetic channel and is not joined to the runtime trace."
              : envelope?.verification?.status !== "fixture-rendered"
                ? "The trace verification status is not fixture-rendered, so the page does not call the path end-to-end proven."
                : verifiedRender
                  ? "Trace and non-synthetic fixture both cite 748d015, and the trace is marked fixture-rendered."
                  : "The loaded parts do not yet form an end-to-end proof.",
  };
  if (
    trace &&
    traceGate?.admit &&
    verifiedRender &&
    envelope?.verification?.status === "fixture-rendered"
  ) {
    endToEnd.proven = true;
  }

  const matrixCell =
    (renderIndex?.cells ?? []).find(
      (item) => item.stateId === selection.stateId && item.viewId === selection.viewId,
    ) ?? null;
  const suffix = String(selection.adapterId ?? "").replace(/^adapter\./, "");
  const fieldPath = String(selection.fieldId ?? "").replace(/^field\./, "");
  const mmdRel = suffix && fieldPath ? `audit/godview/evidence/${suffix}/${fieldPath}.mmd` : "";
  const paint = paintFor(matrixCell, render);
  const graphOrder = costGraphOrder(envelope);
  const reading = readField(envelope);
  if (
    reading &&
    selection.fieldId === "field.tokens.total" &&
    selection.adapterId === "adapter.claude"
  ) {
    if (reading.channels?.rendererRead === "none") {
      reading.readerNote = `${reading.readerNote} Review: no built-in view directly reads tokens.total. A derive hop is not a view read, and this record was not live-tested.`;
    } else {
      reading.reader = "no-direct-reader";
      reading.readerNote =
        "Shared static map: Claude totalTokens can reach tokens.total through usage-index and derive. No built-in view directly reads tokens.total. USD flames read cost, not this total. This is not a live run.";
    }
  }
  const named = namedStatesFor(traces, selection.adapterId);
  const stateReading = stateOnRecord(envelope, selection.stateId, named, selection.adapterId);
  const coverage = coverageReport(model, traces);
  const restrictions = model.restrictions.filter(
    (entry) =>
      entry.adapter === selection.adapterId &&
      (entry.fieldIds.includes(selection.fieldId) || entry.stateIds.includes(selection.stateId)),
  );

  return {
    auditTarget: AUDIT_TARGET_LABEL,
    sourceRevision: {
      vibefield: AUDIT_PINS.vibefield,
      puppeteer: AUDIT_PINS.puppeteer,
    },
    selection,
    state,
    view,
    adapter,
    field,
    declaration: declarationFor(model, adapter, field),
    restrictions,
    overlay: overlayFor(field, fallback),
    schemaDefault: field ? field.defaultValue : null,
    consumer: consumerStatus(view, field),
    runtime: trace
      ? {
          status: traceGate?.admit ? "loaded" : "mixed-input",
          gate: traceGate,
          path: trace.path,
          observation: envelope?.observation ?? null,
          classification: envelope?.classification ?? trace.classification ?? "unknown",
          applicability: envelope?.applicability ?? null,
          absence: envelope?.absence ?? null,
          verification: envelope?.verification ?? null,
          sources: envelope?.sources ?? trace.evidence ?? [],
          producer: envelope?.producer ?? null,
          transforms: envelope?.transforms ?? [],
          merge: envelope?.merge ?? null,
          transport: envelope?.transport ?? null,
          renderer: envelope?.renderer ?? null,
          stateScope: stateScope(envelope, selection.stateId),
          provenance: provenanceResult,
          raw: trace.raw ?? null,
          valuePresent: envelope?.observation?.presence === "present",
          value: envelope?.observation?.literal ?? null,
        }
      : { status: "pending", gate: null, provenance: { status: "missing", findings: [] } },
    synthetic: render
      ? {
          status: renderGate?.admit ? "loaded" : "mixed-input",
          gate: renderGate,
          fixtureKind: render.fixtureKind ?? "unknown",
          syntheticLabel: render.syntheticLabel ?? "",
          fixture: render.fixturePath ?? null,
          screenshot: render.screenshotPath ?? null,
          harness: render.harnessPath ?? null,
          component: render.component ?? null,
        }
      : { status: "pending", fixtureKind: null },
    endToEnd,
    paint,
    graphOrder,
    mmdPath: mmdRel && existsSync(join(process.cwd(), mmdRel)) ? mmdRel : null,
    reading,
    stateReading,
    coverage,
    stages: PROVENANCE_STAGES,
  };
}
