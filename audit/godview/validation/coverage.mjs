/**
 * Field envelopes are not state paths. A state the records never name stays
 * an open gap. An adapter that does not emit a field does not make the
 * runtime, host, history, or window unable to supply it.
 */

const PAST_OR_TIMELINE = /^state\.(past_|timeline_)/;

export function isRowTrace(trace) {
  return (
    trace?.recordKind !== "sdk-leaf" && !String(trace?.fieldId ?? "").startsWith("field.contract.")
  );
}

const PRICED = new Set(["adapter.claude", "adapter.codex"]);

export function namedStatesFor(traces, adapterId) {
  const named = new Set();
  for (const trace of traces) {
    if (!isRowTrace(trace) || trace.adapterId !== adapterId) continue;
    const states = trace.envelope?.applicability?.states;
    if (!Array.isArray(states)) continue;
    for (const id of states) named.add(id);
  }
  return named;
}

export function coverageReport(model, traces) {
  const adapters = [];
  for (const adapter of model.adapters ?? []) {
    const records = traces.filter((trace) => isRowTrace(trace) && trace.adapterId === adapter.id);
    const named = namedStatesFor(traces, adapter.id);
    const unnamed = (model.states ?? []).map((state) => state.id).filter((id) => !named.has(id));
    adapters.push({
      adapterId: adapter.id,
      records: records.length,
      namedCount: named.size,
      unnamed,
      pastAndTimeline: unnamed.filter((id) => PAST_OR_TIMELINE.test(id)),
      branchNone: unnamed.includes("state.branch_none"),
    });
  }
  return {
    fieldRecords: traces.filter(isRowTrace).length,
    sdkLeafRecords: traces.filter((trace) => trace.recordKind === "sdk-leaf").length,
    statePathsAreNotFieldRecords: true,
    provesRuntimeUnreachable: false,
    adapters,
  };
}

export function readField(envelope) {
  if (!envelope) {
    return {
      stateOnRecord: "pending",
      producerLimit: "pending",
      reader: "pending",
      mismatch: null,
      provesRuntimeUnreachable: false,
    };
  }
  const notes = `${envelope.applicability?.notes ?? ""} ${envelope.verification?.notes ?? ""}`;
  const pendingJoin = notes.includes("PENDING DOWNSTREAM");
  const effects = (envelope.transforms ?? []).map((item) => item.effect ?? "").join(" ");
  const text = `${notes} ${effects}`;
  const noConsumer =
    envelope.renderer?.component === "none-proven" ||
    (Array.isArray(envelope.renderer?.viewIds) && envelope.renderer.viewIds.length === 0) ||
    notes.includes("No builtin consumer was proven");
  let mismatch = null;
  if (/costUsd/i.test(text) && String(envelope.fieldId ?? "").startsWith("field.cost")) {
    mismatch = sharedCostNote(envelope.adapterId);
  } else if (/copies no questions array/i.test(text)) {
    mismatch =
      "This adapter can raise a question blocker and copy no questions array, so the question text can be omitted.";
  } else if (/no conversation family/i.test(text) && envelope.observation?.presence === "present") {
    mismatch =
      "The capability table declares no conversation family. This record still traces reply text. Declared support and traced behavior stay separate.";
  } else if (/explicit null branch was not found/i.test(text)) {
    mismatch =
      "state.branch_none is not established. These adapters were not seen emitting a null git branch. Runtime git remains unknown.";
  }
  const producerLimit = pendingJoin
    ? "mapping-pending"
    : envelope.classification?.adapterEmittable === "unknown" ||
        envelope.observation?.presence === "unknown"
      ? "unknown"
      : envelope.classification?.adapterEmittable === "no" ||
          envelope.observation?.presence === "absent" ||
          envelope.observation?.presence === "unsupported"
        ? "adapter-not-direct"
        : "adapter-emits";
  return {
    producerLimit,
    reader: pendingJoin
      ? "unknown"
      : noConsumer
        ? "unknown"
        : (envelope.classification?.uiReachable ?? "unknown"),
    readerNote: pendingJoin
      ? "Row mapping and UI reachability are unknown. SDK contract leaves are not this row field. The downstream graph is unresolved."
      : noConsumer
        ? "No builtin consumer was proven. This page keeps that unknown. It does not relabel the field unused."
        : envelope.classification?.uiReachable === "no"
          ? "The record claims the five shipping views do not read this field. That source was not re-opened here, and a TypeScript or view-list exclusion is not proof an untrusted input cannot carry the value."
          : "Listed views are the record's readers. An unlisted view stays unknown.",
    mismatch,
    provesRuntimeUnreachable: false,
  };
}

const TOKEN_RATE = new Set(["adapter.grok", "adapter.hermes", "adapter.opencode"]);
const COST_MISSING = new Set([
  "adapter.acp",
  "adapter.antigravity",
  "adapter.copilot",
  "adapter.grok",
  "adapter.hermes",
  "adapter.kimi",
  "adapter.opencode",
  "adapter.pi",
]);

function sharedCostNote(adapterId) {
  if (COST_MISSING.has(adapterId)) {
    const rate = TOKEN_RATE.has(adapterId)
      ? "Its tokens.perMinute record is present."
      : "Its tokens.perMinute record is unsupported: no live usage.";
    return `Field records for this adapter name state.cost_missing and state.burn_unpriced on the normal path. They cite cost-burn-trace.md: the catalog is anthropic and openai only, and pricing needs the upsert's own pricing or costUsd. This adapter does not set those, so the catalog does not price its tokens. The normal backend omits field.cost without a priced total, so state.cost_unavailable is not emitted here. Priced flames are not produced from this producer. ${rate} Token/min and USD flames stay independent. The shared downstream join is still open.`;
  }
  if (PRICED.has(adapterId)) {
    return "The shared cost trace says runtime usage-pricing.ts can price Codex before the reducer, and Claude has native costUsd plus a catalog fallback. First-half row mapping is still pending, so that source permission is not a finished join.";
  }
  return "Shared cost/burn trace: token-only usage normally becomes state.cost_missing because the projector omits field.cost without a priced total. No normal adapter emits unavailable. Missing costUsd alone does not close priced cost. This is static source analysis, not a live run.";
}

export function stateOnRecord(envelope, stateId, namedForAdapter, adapterId = "") {
  const states = envelope?.applicability?.states;
  if (!envelope) return { status: "pending", note: "No field record for this adapter." };
  if (states === "model-axes") {
    return {
      status: "model-axes",
      note: "This field record says model-axes. That is not a trace of each state.",
    };
  }
  if (Array.isArray(states) && states.includes(stateId)) {
    return { status: "named", note: "This field record names the selected state." };
  }
  if (/^state\.(cost_|burn_)/.test(stateId)) {
    return {
      status: "shared-cost-trace",
      scope: "runtime-pricing",
      note: sharedCostNote(adapterId),
    };
  }
  if (PAST_OR_TIMELINE.test(stateId)) {
    return {
      status: "host-claim",
      scope: "host-consumer",
      note: "Field records do not name this state and do not cite index-activity.ts. AUDIT4's summary claims fieldd index-activity to derivePast to timeline stateAt, and says no live rosettad session was run. That is a host-history claim, not direct adapter emission and not an executed trace.",
    };
  }
  if (stateId === "state.branch_none") {
    return {
      status: "host-claim",
      scope: "host-consumer",
      note: "project.branch records claim this host path never writes a null branch, while the runtime type allows one. A type exclusion is not proof an untrusted input cannot carry null. Direct adapter reach, this host-path claim, and a synthetic branch_none fixture are separate.",
    };
  }
  if (stateId === "state.blocked_unknown_kind") {
    return {
      status: "type-claim",
      scope: "core-type",
      note: "AUDIT4 claims core blockers are only permission, question, and failure. A TypeScript union does not by itself prove an untrusted input cannot carry another kind. The synthetic list fixture is a separate robustness paint.",
    };
  }
  if (!namedForAdapter.has(stateId)) {
    return {
      status: "not-named",
      note: "No field record for this adapter names this state. Missing state coverage is not a proof the runtime, host, history, or window cannot reach it.",
    };
  }
  return {
    status: "other-field",
    note: "Another field record for this adapter names the state. This field record does not.",
  };
}
