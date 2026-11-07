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

export function envelopeNotes(envelope) {
  return `${envelope?.applicability?.notes ?? ""} ${envelope?.verification?.notes ?? ""}`;
}

/** Same predicate the field panel uses: pending notes override a yes/no label. */
export function uiUnresolved(envelope) {
  if (!envelope) return false;
  const notes = envelopeNotes(envelope);
  const ui = envelope.classification?.uiReachable;
  if (notes.includes("PENDING DOWNSTREAM") || notes.includes("uiReachable stay unknown"))
    return true;
  return ui === "unknown" || ui == null;
}

/** States a record explicitly says it does not emit. Applicability lists are not this set. */
export function explicitlyNotEmitted(envelope) {
  const notes = envelopeNotes(envelope);
  const chunk = notes.split("does not emit").slice(1).join(" ");
  return new Set([...chunk.matchAll(/state\.[a-z][a-z0-9_]*/g)].map((match) => match[0]));
}

/** Applicability lists are mentions. They are not emitted or reachable states. */
export function namedStatesFor() {
  return new Set();
}

export function coverageReport(model, traces) {
  const adapters = [];
  for (const adapter of model.adapters ?? []) {
    const records = traces.filter((trace) => isRowTrace(trace) && trace.adapterId === adapter.id);
    const nonEmittingRecords = records.filter(
      (trace) => explicitlyNotEmitted(trace.envelope).size > 0,
    ).length;
    adapters.push({
      adapterId: adapter.id,
      records: records.length,
      nonEmittingRecords,
      applicabilityIsNotEmission: true,
      pastAndTimeline: (model.states ?? [])
        .map((state) => state.id)
        .filter((id) => PAST_OR_TIMELINE.test(id)),
      branchNone: true,
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
  const presence = envelope.observation?.presence ?? "unknown";
  const emit = envelope.classification?.adapterEmittable ?? "unknown";
  const ui = envelope.classification?.uiReachable ?? "unknown";
  const rendererRead = labelOf(notes, "rendererRead");
  const adapterPathProvidesValue = labelOf(notes, "adapterPathProvidesValue");
  const missingStateVisible = labelOf(notes, "missingStateVisible");
  const sourceScope = labelOf(notes, "sourceScope");
  const staticPresence = labelOf(notes, "staticPresence");
  const notLiveSample =
    notes.includes("did not live-sample") || notes.includes("liveObserved=false");
  const alternate = notes.match(/Alternate producer: ([^.]+)\./u);
  const hostAccountUnproven = notes.includes("host.account") && notes.includes("unproven");
  const producerLimit = pendingJoin
    ? "mapping-pending"
    : staticPresence === "omitted"
      ? "omitted"
      : staticPresence === "host-dependent"
        ? "host-dependent"
        : staticPresence === "emitted-when-condition"
          ? "conditional"
          : staticPresence === "always-on-row"
            ? "static-always"
            : presence === "absent"
              ? "absent"
              : presence === "unsupported"
                ? "unsupported"
                : presence === "unknown" || emit === "unknown"
                  ? "unknown"
                  : emit === "no"
                    ? "present-not-from-adapter"
                    : "adapter-emits";
  const genericReader =
    rendererRead === "direct" || rendererRead === "indirect"
      ? rendererRead
      : rendererRead === "none"
        ? "absent"
        : ui === "yes"
          ? "present"
          : ui === "no"
            ? "absent"
            : "unknown";
  const adapterOmission = emit === "no" && (presence === "absent" || presence === "unsupported");
  const accountField = envelope.fieldId === "field.account";
  const profileField = envelope.fieldId === "field.profileSet";
  const falseFullSuccess = !accountField && ui === "yes" && adapterOmission && !alternate;
  const labeled = Boolean(rendererRead);
  let adapterPathReader = ui;
  let readerNote =
    "Reader presence, adapter emission, runtime fallback, and the selected state's painted value stay separate.";
  if (accountField) {
    adapterPathReader = "host-scoped";
    readerNote =
      "No adapter emits account. derive copies host.account. The VibeField host omits it for all 10 adapters. The Puppeteer Godview host can set a profile label for adapters with a profiles service, and omits it for ACP. Envelope uiReachable follows the VibeField consumer and is not a global impossibility. accountUsage feeds the usage column, not field.account. Static source-read, not a live sample.";
  } else if (profileField) {
    adapterPathReader = "host-then-native";
    readerNote =
      "Claim: profileSet resolves host value, then the set that lists profileId, then native. ACP and any unbound run are native. VibeField window-rows.ts:119-134 drops profileSet on peer rows and leaves account unchanged. The adapter does not emit profileSet.";
  } else if (falseFullSuccess) {
    adapterPathReader = "not-applicable";
    readerNote =
      "A generic view can read this field when some other producer supplies it. This adapter does not emit it, and the observation is not present. That is not producer-to-UI reachability for this adapter. Removing pending wording would not close it.";
  } else if (!labeled && (pendingJoin || noConsumer)) {
    adapterPathReader = "unknown";
    readerNote = pendingJoin
      ? "Row mapping is still pending. A label of yes or no does not close UI reachability while the note still says the mapping is unknown."
      : "No builtin consumer was proven. This page keeps that unknown. It does not relabel the field unused.";
  } else if (!labeled && adapterOmission) {
    adapterPathReader = "not-applicable";
  } else if (hostAccountUnproven) {
    adapterPathReader = "unknown";
    readerNote =
      "Claim: uiReachable stays unknown because derive can copy host.account and the Vibefield host fill is unproven. Review: this unknown stays open. A direct reader does not turn it into yes.";
  } else if (rendererRead && ui === "no") {
    adapterPathReader = "no";
    readerNote = `Claim: rendererRead=${rendererRead}, adapter path provides ${adapterPathProvidesValue ?? "unlabeled"}, missing-state visible=${missingStateVisible ?? "unlabeled"}, uiReachable=no. Review: the reader and the missing-state flag are not this adapter's value path.`;
  } else if (adapterPathProvidesValue === "no" && ui === "yes") {
    adapterPathReader = "alternate-producer";
    readerNote =
      "Claim: uiReachable is yes because an alternate producer is cited, while this adapter path provides no value. Review: that is not this adapter emitting the field. The record is source-read, not a live session, and it is not full success.";
  } else if (notLiveSample) {
    if (
      sourceScope === "common-runtime" ||
      sourceScope === "host-supplied" ||
      sourceScope === "replica-supplied"
    ) {
      adapterPathReader = "not-adapter-emission";
    }
    readerNote = `Claim: sourceScope=${sourceScope ?? "unlabeled"}, staticPresence=${staticPresence ?? "unlabeled"}, uiReachable=${ui}. Review: static source-read. This audit did not live-sample the value, so the path is not closed.`;
  } else if (
    adapterPathProvidesValue === "conditional" ||
    notes.includes("not observed in a live session")
  ) {
    readerNote =
      "Claim: the value is conditional on this adapter path. Review: the sequence is a static source read. It was not live-tested, so the path is not closed.";
  }
  return {
    producerLimit,
    reader: adapterPathReader,
    readerNote,
    channels: {
      uiReachable: ui,
      rendererRead: rendererRead ?? "unlabeled",
      missingStateVisible: missingStateVisible ?? "unlabeled",
      adapterPathProvidesValue: adapterPathProvidesValue ?? "unlabeled",
      genericReader,
      adapterEmission: producerLimit,
      adapterPathReader,
      alternateProducer: alternate ? alternate[1] : "none-cited",
      sourceScope: sourceScope ?? "unlabeled",
      staticPresence: staticPresence ?? "unlabeled",
      runtimeFallback: accountField
        ? "host-scoped"
        : hostAccountUnproven
          ? "host-account-unproven"
          : "not-established",
      accountUsage: accountField ? "usage-column-not-account" : "not-this-field",
      selectedStateUi: "separate",
      evidenceKind: envelope.verification?.status ?? "unknown",
      liveTested: false,
    },
    mismatch,
    provesRuntimeUnreachable: false,
    success: false,
    falseFullSuccess,
  };
}

function labelOf(notes, key) {
  const match = String(notes).match(new RegExp(`${key}=([^\\s.]+)`));
  return match ? match[1] : null;
}

const FIRST_HALF = new Set([
  "adapter.acp",
  "adapter.antigravity",
  "adapter.claude",
  "adapter.codex",
  "adapter.copilot",
]);
const SECOND_HALF = new Set([
  "adapter.grok",
  "adapter.hermes",
  "adapter.kimi",
  "adapter.opencode",
  "adapter.pi",
]);

function tallyRows(list) {
  const ui = { yes: 0, no: 0, unknown: 0 };
  let directNoYes = 0;
  let modelAxes = 0;
  let costStops = 0;
  for (const trace of list) {
    const env = trace.envelope;
    if (!env) continue;
    const uiValue = env.classification?.uiReachable ?? "unknown";
    ui[uiValue] = (ui[uiValue] ?? 0) + 1;
    const notes = envelopeNotes(env);
    const scope = labelOf(notes, "sourceScope");
    const presence = labelOf(notes, "staticPresence");
    if (
      labelOf(notes, "rendererRead") === "direct" &&
      uiValue === "yes" &&
      (labelOf(notes, "adapterPathProvidesValue") === "no" ||
        scope === "absent" ||
        presence === "omitted")
    ) {
      directNoYes += 1;
    }
    if (
      env.applicability?.states === "model-axes" &&
      /Applicable states:|No source-permitted field-domain state|Excluded from applicability/u.test(
        notes,
      ) &&
      !notes.includes("is not a reachable set")
    ) {
      modelAxes += 1;
    }
    const names = (env.transforms ?? []).map((step) => step.name ?? "");
    if (
      String(env.fieldId ?? "").startsWith("field.cost") &&
      !names.some((name) => /reader|overlay|window/i.test(name))
    ) {
      costStops += 1;
    }
  }
  return { rows: list.length, ui, directNoYes, modelAxes, costStops };
}

/** Envelope counts and the 5bc7 blockers. These are not the shared map's anchor totals. */
export function semanticBlockers(traces) {
  const rows = traces.filter(isRowTrace);
  return {
    first: tallyRows(rows.filter((trace) => FIRST_HALF.has(trace.adapterId))),
    second: tallyRows(rows.filter((trace) => SECOND_HALF.has(trace.adapterId))),
    delivery: "incomplete",
    candidateStatus: "static-not-live",
    openGraphReview: [
      { id: "unpriced-guard", status: "lead-reviewing" },
      { id: "ledger-project-ordering", status: "lead-reviewing" },
      { id: "retained-epochs", status: "lead-reviewing" },
    ],
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
      ? "Its tokens.perMinute observation is present."
      : adapterId === "adapter.kimi" || adapterId === "adapter.pi"
        ? "Its tokens.perMinute observation is unsupported: no live usage."
        : "Its tokens.perMinute observation is absent, not unsupported.";
    return `Field records for this adapter name state.cost_missing and state.burn_unpriced on the normal path. They cite cost-burn-trace.md: the catalog is anthropic and openai only, and pricing needs the upsert's own pricing or costUsd. This adapter does not set those, so the catalog does not price its tokens. The normal backend omits field.cost without a priced total, so state.cost_unavailable is not emitted here. Priced flames are not produced from this producer. ${rate} Token/min and USD flames stay independent. The shared downstream join is still open.`;
  }
  if (PRICED.has(adapterId)) {
    return "The shared cost trace says runtime usage-pricing.ts can price Codex before the reducer, and Claude has native costUsd plus a catalog fallback. First-half row mapping is still pending, so that source permission is not a finished join.";
  }
  return "Shared cost/burn trace: token-only usage normally becomes state.cost_missing because the projector omits field.cost without a priced total. No normal adapter emits unavailable. Missing costUsd alone does not close priced cost. This is static source analysis, not a live run.";
}

export function stateOnRecord(envelope, stateId, namedForAdapter, adapterId = "") {
  const denied = explicitlyNotEmitted(envelope);
  if (denied.has(stateId)) {
    return {
      status: "listed-not-emitted",
      note: "This record lists the state and says it does not emit it. An applicability list is not an emitted or reachable state.",
    };
  }
  const states = envelope?.applicability?.states;
  if (!envelope) return { status: "pending", note: "No field record for this adapter." };
  if (states === "model-axes") {
    return {
      status: "model-axes",
      note: "This field record says model-axes. That is not a trace of each state.",
    };
  }
  if (Array.isArray(states) && states.includes(stateId)) {
    return {
      status: "mentioned-not-emitted",
      note: "This state is only in applicability.states. That list is not counted as an emitted or reachable state.",
    };
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
