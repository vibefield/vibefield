/**
 * Field envelopes are not state paths. A state the records never name stays
 * an open gap. An adapter that does not emit a field does not make the
 * runtime, host, history, or window unable to supply it.
 */

const PAST_OR_TIMELINE = /^state\.(past_|timeline_)/;

export function namedStatesFor(traces, adapterId) {
  const named = new Set();
  for (const trace of traces) {
    if (trace.adapterId !== adapterId) continue;
    const states = trace.envelope?.applicability?.states;
    if (!Array.isArray(states)) continue;
    for (const id of states) named.add(id);
  }
  return named;
}

export function coverageReport(model, traces) {
  const adapters = [];
  for (const adapter of model.adapters ?? []) {
    const records = traces.filter((trace) => trace.adapterId === adapter.id);
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
    fieldRecords: traces.length,
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
  const effects = (envelope.transforms ?? []).map((item) => item.effect ?? "").join(" ");
  const text = `${notes} ${effects}`;
  const noConsumer =
    envelope.renderer?.component === "none-proven" ||
    (Array.isArray(envelope.renderer?.viewIds) && envelope.renderer.viewIds.length === 0) ||
    notes.includes("No builtin consumer was proven");
  let mismatch = null;
  if (/no costUsd|without it, so the row cost object stays absent/i.test(text)) {
    mismatch =
      "Usage can carry token counts while costUsd is unset. Priced cost and burn stay absent for this adapter trace. That is not a proof no other source can price the row.";
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
  return {
    producerLimit:
      envelope.classification?.adapterEmittable === "no" ||
      envelope.observation?.presence === "absent" ||
      envelope.observation?.presence === "unsupported"
        ? "adapter-not-direct"
        : "adapter-emits",
    reader: noConsumer ? "unknown" : (envelope.classification?.uiReachable ?? "unknown"),
    readerNote: noConsumer
      ? "No builtin consumer was proven. This page keeps that unknown. It does not relabel the field unused."
      : "Listed views are confirmed consumers. A view that is not listed stays unknown.",
    mismatch,
    provesRuntimeUnreachable: false,
  };
}

export function stateOnRecord(envelope, stateId, namedForAdapter) {
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
  if (PAST_OR_TIMELINE.test(stateId)) {
    return {
      status: "not-traced",
      note: "state.past_* and state.timeline_* are not named on these field records. Recorded-lanes history was not traced.",
    };
  }
  if (stateId === "state.branch_none") {
    return {
      status: "unknown",
      note: "state.branch_none is unknown. An explicit null git branch was not found in these adapter records.",
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
