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
  const costReview = String(envelope.fieldId ?? "").startsWith("field.cost")
    ? costSemantics(envelope)
    : null;
  let mismatch = null;
  if (costReview?.verification === "precision-pending") {
    mismatch = costReview.note;
  } else if (costReview && /costUsd/i.test(text)) {
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
    const vibefieldOnly = /VibeField host only/i.test(notes);
    const hostYes = accountHostConflict(envelope);
    readerNote = vibefieldOnly
      ? "uiReachable no is the VibeField host only. sourceScope is host-supplied. hostRunFromSummary never sets account, so that host does not supply the value. This is not a global adapter impossibility. The audit target is Puppeteer source. Under the Puppeteer Godview host, monitor-host.ts:62,79 sets account from accountLabel(profileId) only when profileId is set and the label is non-empty. accountUsage feeds the usage column, not field.account."
      : hostYes
        ? "Envelope uiReachable is yes while the note says a VibeField row never fills account. Host scope is pending the owner's correction. This yes is not accepted. No adapter emits account. The VibeField host omits it. The Puppeteer Godview host can set a profile label when a profiles service exists, and omits it for ACP. accountUsage feeds the usage column, not field.account."
        : "No adapter emits account. derive copies host.account. The VibeField host omits it for all 10 adapters. The Puppeteer Godview host can set a profile label for adapters with a profiles service, and omits it for ACP. Envelope uiReachable follows the VibeField consumer and is not a global impossibility. accountUsage feeds the usage column, not field.account. Static source-read, not a live sample.";
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

export function accountHostConflict(envelope) {
  if (envelope?.fieldId !== "field.account") return false;
  const notes = envelopeNotes(envelope);
  return (
    envelope.classification?.uiReachable === "yes" &&
    /never fills|unreachable and always absent/i.test(notes)
  );
}

const ORDER_HOLD =
  "Held from acceptance. Confirmed order: translateAgentEventEnvelope at reduce.ts:1049-1073 copies event costUsd before pricing. Pricing is monitor-service.ts:418-425. The reducer after pricing is reduceMonitorAccumulator at reduce.ts:672-686. This graph cites 1049-1073 as the post-price copy. The evidence file is not rewritten. Owner correction is incoming. This is not absent runtime mapping, and it is not accepted provenance.";

/** Derived from transform names and effects. Not a sign-off. */
export function costSemantics(envelope) {
  if (!envelope || !String(envelope.fieldId ?? "").startsWith("field.cost")) return null;
  const steps = envelope.transforms ?? [];
  const names = steps.map((step) => step.name ?? "");
  const effects = steps.map((step) => step.effect ?? "").join("\n");
  const at = (name) => names.indexOf(name);
  const base = { independentSignoff: "pending", liveRun: false };
  if (
    names.includes("handler-omits-usage") &&
    at("ledger-counts") === -1 &&
    at("ledger.observe") === -1
  ) {
    return {
      ...base,
      kind: "omission",
      verification: "stops-at-omission",
      defects: [],
      branch: null,
    };
  }
  const reduceStep = steps.find((step) => step.name === "reduce-after-price");
  const reducePath = String(reduceStep?.source?.path ?? "");
  const heldForOrder =
    (envelope.adapterId === "adapter.claude" || envelope.adapterId === "adapter.codex") &&
    /reduce\.ts$/.test(reducePath) &&
    reduceStep?.source?.lineStart === 1049;
  if (heldForOrder) {
    return {
      ...base,
      kind: "priced-path",
      verification: "precision-pending",
      defects: ["source-order"],
      branch: null,
      note: ORDER_HOLD,
    };
  }
  const projectAt = at("project-copy") !== -1 ? at("project-copy") : at("project-usage");
  const ledgerAt = at("ledger-counts");
  const ledgerBeforeProject = ledgerAt !== -1 && projectAt !== -1 && ledgerAt < projectAt;
  const oldProject = at("projectAgentMonitorState");
  const oldLedger = at("ledger.observe");
  const ledgerAfterProject =
    at("ledger-counts") === -1 && oldProject !== -1 && oldLedger !== -1 && oldProject < oldLedger;
  const pricingGuard = /canonical, pricing, or cost/i.test(effects);
  const epochsNamed = at("vibefield-current-epoch") !== -1 || at("epoch-retention") !== -1;
  const noRetainedTotal = /never write costUsd|never writes costUsd|no retained total/i.test(
    effects,
  );
  const defects = [];
  if (ledgerAfterProject) defects.push("ledger-after-project");
  if (ledgerAt !== -1 && !pricingGuard) defects.push("pricing-guard");
  if (ledgerAt !== -1 && !epochsNamed) defects.push("retained-epochs");
  let branch = null;
  if (/reaches neither arm|loop does not run/i.test(effects)) branch = "never-ledger";
  else if (/takes the skip branch/i.test(effects)) branch = "noncanonical-skip";
  else if (/takes the guarded increment/i.test(effects)) branch = "unpriced-increment";
  const verification =
    defects.length === 0 && ledgerBeforeProject ? "scoped-static" : "pending-correction";
  return {
    ...base,
    kind: "priced-path",
    verification,
    defects,
    branch,
    ledgerBeforeProject,
    epochsNamed,
    noRetainedTotal,
    row: /state\.cost_missing/.test(effects) ? "cost_missing" : null,
  };
}

function costReviewFor(rows) {
  const ownerStated = [];
  const precisionPending = [];
  const scoped = [];
  const pendingCorrection = [];
  const omission = [];
  const defects = {};
  const branches = {};
  for (const trace of rows) {
    if (trace.fieldId !== "field.cost.usd") continue;
    const review = costSemantics(trace.envelope);
    if (!review) continue;
    if (review.verification === "owner-stated") ownerStated.push(trace.adapterId);
    else if (review.verification === "precision-pending") {
      precisionPending.push(trace.adapterId);
      defects[trace.adapterId] = review.defects;
    } else if (review.verification === "scoped-static") {
      scoped.push(trace.adapterId);
      if (review.branch) branches[trace.adapterId] = review.branch;
    } else if (review.verification === "pending-correction") {
      pendingCorrection.push(trace.adapterId);
      defects[trace.adapterId] = review.defects;
    } else omission.push(trace.adapterId);
  }
  return { ownerStated, precisionPending, scoped, pendingCorrection, omission, defects, branches };
}

/** Envelope counts and cost-graph checks read from the files. */
export function semanticBlockers(traces) {
  const rows = traces.filter(isRowTrace);
  const first = rows.filter((trace) => FIRST_HALF.has(trace.adapterId));
  const second = rows.filter((trace) => SECOND_HALF.has(trace.adapterId));
  return {
    first: tallyRows(first),
    second: tallyRows(second),
    costReview: {
      first: costReviewFor(first),
      second: costReviewFor(second),
      independentSignoff: "pending",
    },
    accountHostPending: rows
      .filter((trace) => accountHostConflict(trace.envelope))
      .map((trace) => trace.adapterId),
    accountVibefieldOnly: rows
      .filter(
        (trace) =>
          trace.fieldId === "field.account" &&
          trace.envelope?.classification?.uiReachable === "no" &&
          /VibeField host only/i.test(envelopeNotes(trace.envelope)),
      )
      .map((trace) => trace.adapterId),
    delivery: "incomplete",
    candidateStatus: "static-not-live",
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
    return `Field records for this adapter name state.cost_missing and state.burn_unpriced on the normal path. They cite cost-burn-trace.md: the catalog is anthropic and openai only, and pricing needs the upsert's own pricing or costUsd. This adapter does not set those, so the catalog does not price its tokens. The normal backend omits field.cost without a priced total, so state.cost_unavailable is not emitted here. Priced flames are not produced from this producer. ${rate} Token/min and USD flames stay independent.`;
  }
  if (PRICED.has(adapterId)) {
    return "Claude and Codex have a priced path in the shared cost trace. Mentioning costUsd does not mean runtime mapping is absent. Their cost-graph order is a separate hold and is not accepted provenance.";
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
