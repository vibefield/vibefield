import { flowAnchors } from "../flows/render.mjs";
import { AUDIT_TARGET_LABEL } from "../validation/contract.mjs";
import { swarmRuntimeMount } from "./swarm-mount.mjs";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function options(items, selected, labelOf) {
  if (items.length === 0) return `<option value="">Nothing loaded</option>`;
  return items
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}"${item.id === selected ? " selected" : ""}>${escapeHtml(labelOf(item))}</option>`,
    )
    .join("");
}

function timelineProof(index) {
  const span = index.rendering?.timelineSpanEvidence;
  const ended = index.rendering?.timelineEndedEvidence;
  const spanOk =
    span?.fixtureId === "fix.timeline.moment-span" &&
    span?.branch === "span" &&
    span?.tone === "working" &&
    span?.readout === "30:00working" &&
    span?.headAtOrAfterSince === true;
  const endedOk =
    ended?.fixtureId === "fix.timeline.moment-ended" &&
    ended?.branch === "ended" &&
    ended?.tone === "ended" &&
    ended?.readout === "last active 30m ago" &&
    ended?.headAtOrAfterEnded === true;
  const holds = [
    ...(index.rendering?.unverifiedSpanAliases ?? []),
    ...(index.rendering?.weakerEndedAliases ?? []),
  ];
  if (spanOk && endedOk && holds.length === 0) {
    return "state.timeline_span is fix.timeline.moment-span: readout 30:00working, tone working, head at or after sinceMs. state.timeline_ended is fix.timeline.moment-ended: readout last active 30m ago, tone ended, head at or after endedAt. The past-bounds alias is not a proof. Both timeline holds are lifted only because those evidence files match.";
  }
  return `Timeline holds stay. Span evidence ${spanOk ? "matches" : "does not match"}. Ended evidence ${endedOk ? "matches" : "does not match"}. Remaining holds: ${holds.join(", ") || "none"}.`;
}

function bundleMissing(fixtureId) {
  return `<p>Pinned component bundle is absent. Build contract, from the repo root: <code>cd audit/godview/rendering &amp;&amp; npm install &amp;&amp; node ensure-pin.mjs &amp;&amp; node emit-fixtures.mjs &amp;&amp; node check.mjs &amp;&amp; npm run build</code>. The served page then loads <code>/harness/index.html?fixture=${escapeHtml(fixtureId)}</code> from that bundle. It does not use installed package 0.3.3.</p>`;
}

function componentFrame(index, cell) {
  const runtime = swarmRuntimeMount(cell);
  if (runtime?.attempt) {
    if (index.rendering?.componentBundle !== true) return bundleMissing(runtime.fixtureId);
    const src = `/harness/index.html?fixture=${encodeURIComponent(runtime.fixtureId)}`;
    return `<div class="swarm-mount" data-swarm-mount data-fixture="${escapeHtml(runtime.fixtureId)}"><p>${escapeHtml(runtime.reason)} If this browser has no WebGPU adapter, the pinned view reports WEBGPU UNAVAILABLE. That sentence is the diagnostic, not a painted body and not screenshot success. WebGPU needs a secure context; this page serves one on 127.0.0.1.</p><iframe class="component" data-swarm-frame title="Pinned swarm attempt ${escapeHtml(runtime.fixtureId)}" data-src="${escapeHtml(src)}" allow="webgpu"></iframe></div>`;
  }
  if (runtime && !runtime.attempt) return `<p>${escapeHtml(runtime.reason)}</p>`;
  const fixtureId = cell.paint?.fixtureId;
  if (cell.paint?.disposition !== "rendered" || !fixtureId) return "";
  if (index.rendering?.componentBundle !== true) return bundleMissing(fixtureId);
  const src = `/harness/index.html?fixture=${encodeURIComponent(fixtureId)}`;
  return `<iframe class="component" title="Pinned component ${escapeHtml(fixtureId)}" src="${src}"></iframe><p>Pinned component. Production bundle of Puppeteer source 748d015, mounted with <code>?fixture=${escapeHtml(fixtureId)}</code> from integration.json. Not shipped package 0.3.3. The figure below is the recorded fixture screenshot.</p>`;
}

function linkLine(link) {
  const sha = link.sha ?? link.commit ?? "";
  const path = link.path ?? link.file ?? "";
  const line = link.line ?? link.lineStart;
  const end = link.endLine ?? link.lineEnd;
  const span = line ? (end && end !== line ? `:${line}-${end}` : `:${line}`) : "";
  const href = link.url ?? "";
  const text = `${link.repo ?? ""} ${sha.slice(0, 12)} ${path}${span}`;
  return href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
    : `<span>${escapeHtml(text)}</span>`;
}

export function renderShell(index, cell) {
  const states = index.states ?? [];
  const grouped = new Map();
  for (const state of states) {
    const axis = state.axis || "unspecified";
    if (!grouped.has(axis)) grouped.set(axis, []);
    grouped.get(axis).push(state);
  }
  const stateOptions = [...grouped.entries()]
    .map(
      ([axis, rows]) =>
        `<optgroup label="${escapeHtml(axis)}">${options(rows, cell.selection.stateId, (state) => state.id)}</optgroup>`,
    )
    .join("");
  const catalog = states
    .map(
      (state) =>
        `<li><button type="button" data-state="${escapeHtml(state.id)}" aria-pressed="${state.id === cell.selection.stateId ? "true" : "false"}">${escapeHtml(state.id)} <span class="quiet">${escapeHtml(state.axis)}</span></button></li>`,
    )
    .join("");
  const checks = (index.checks ?? [])
    .map(
      (item) =>
        `<li><span class="chip">${escapeHtml(item.status)}</span> <strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.summary)}</li>`,
    )
    .join("");
  const gate = (index.foundationGate?.failures ?? [])
    .map((failure) => `<li>${escapeHtml(failure.gate)}: ${escapeHtml(failure.message)}</li>`)
    .join("");
  const field = cell.field;
  const evidence = (field?.evidence ?? []).map((link) => `<li>${linkLine(link)}</li>`).join("");
  const shape = field?.shape
    ? JSON.stringify(
        {
          found: field.shape.found,
          ref: field.shape.ref,
          type: field.shape.type,
          enum: field.shape.enumValues,
          xTsType: field.shape.xTsType,
          description: field.shape.description,
        },
        null,
        2,
      )
    : "pending";
  const raw = cell.runtime?.raw ? JSON.stringify(cell.runtime.raw, null, 2) : "pending";
  return `<section class="banner" role="note" aria-label="Audit target">
      <p class="eyebrow">GV-AUDIT6</p>
      <h1>${escapeHtml(AUDIT_TARGET_LABEL)}</h1>
      <p>Puppeteer pin <code>${escapeHtml(index.auditTarget.sourceRevision.puppeteer)}</code>. Vibefield overlay pin <code>${escapeHtml(index.auditTarget.sourceRevision.vibefield)}</code>.</p>
      <p>${escapeHtml(index.boundary?.summary ?? "")}</p>
    </section>
    <p class="posture" role="status">${escapeHtml(index.coverageClaim.reason)} ${escapeHtml(index.partial?.note ?? "")}</p>
    <p class="gate" role="status">${escapeHtml(index.foundationGate?.note ?? "")}</p>
    <nav aria-label="Audit selectors">
      <div class="control"><label for="state">State</label><select id="state">${stateOptions}</select></div>
      <div class="control"><label for="view">View</label><select id="view">${options(index.views, cell.selection.viewId, (view) => `${view.id} ${view.name}`)}</select></div>
      <div class="control"><label for="adapter">Adapter</label><select id="adapter">${options(index.adapters, cell.selection.adapterId, (adapter) => adapter.id)}</select></div>
      <div class="control"><label for="field">Field</label><select id="field">${options(index.fields, cell.selection.fieldId, (item) => `${item.id} ${item.path}`)}</select></div>
    </nav>
    <div class="layout">
      <section aria-labelledby="catalog-heading">
        <h2 id="catalog-heading">States</h2>
        <ul class="catalog">${catalog || "<li>Model states are pending.</li>"}</ul>
      </section>
      <section id="stage" aria-labelledby="stage-heading">
        <h2 id="stage-heading">View</h2>
        <p>The five monitor views live in Puppeteer. VibeField consumes <code>AgentView</code>. This page does not draw a replacement monitor. A rendered cell mounts the production bundle of the pinned 748d015 checkout at <code>?fixture=</code>. The screenshot under it is the recorded fixture, separate from that mount. Swarm cards still attempt pinned AgentSwarm when they are in view. The 67 capture-host environment gaps stay unpainted.</p>
        ${componentFrame(index, cell)}
        <p class="stage-pending" role="status">${cell.view ? escapeHtml(`${cell.view.id} · ${cell.view.name}`) : "No view loaded."} ${escapeHtml(cell.paint?.disposition ?? "unknown")}. Meaningful paint: ${cell.paint?.meaningfulOutput ? "yes" : "no"}. Selected fixture rendered: ${cell.paint?.selectedFixtureRendered ? "yes" : "no"}. Overall screenshot coverage complete: no.</p>
        <p>${escapeHtml(cell.paint?.note ?? "")}</p>
        ${
          cell.paint?.screenshotPath
            ? `<figure><img src="/shots/${escapeHtml(cell.paint.screenshotPath.split("/").pop())}" alt="${escapeHtml(cell.paint.fallbackOnly ? "Swarm fallback: WebGPU unavailable. Not a painted body." : "Recorded fixture screenshot")}" /><figcaption>Recorded fixture screenshot. Not the live component mount.</figcaption></figure>`
            : ""
        }
        <p>${escapeHtml(cell.view?.consumerCompleteness ?? cell.consumer?.note ?? "")}</p>
      </section>
      <aside aria-labelledby="detail-heading">
        <h2 id="detail-heading">Field</h2>
        <dl>
          <dt>Declaration</dt><dd>${escapeHtml(cell.declaration?.support ?? cell.declaration?.status)} — ${escapeHtml(cell.declaration?.note ?? "")}</dd>
          <dt>Overlay</dt><dd>${escapeHtml(cell.overlay?.applies ? cell.overlay.summary : cell.overlay?.note)}</dd>
          <dt>Schema default</dt><dd>${escapeHtml(cell.schemaDefault ?? "none recorded")}</dd>
          <dt>State on this record</dt><dd>${escapeHtml(cell.stateReading?.status)} — ${escapeHtml(cell.stateReading?.note ?? "")}</dd>
          <dt>uiReachable</dt><dd>${escapeHtml(cell.reading?.channels?.uiReachable ?? "unknown")}. This is the adapter-specific value path. Full path success: ${cell.reading?.success ? "yes" : "no"}.</dd>
          <dt>rendererRead</dt><dd>${escapeHtml(cell.reading?.channels?.rendererRead ?? "unlabeled")}. A reader is not the value path.</dd>
          <dt>Adapter path provides value</dt><dd>${escapeHtml(cell.reading?.channels?.adapterPathProvidesValue ?? "unlabeled")}</dd>
          <dt>Missing-state visible</dt><dd>${escapeHtml(cell.reading?.channels?.missingStateVisible ?? "unlabeled")}. This is not the selected state's painted value.</dd>
          <dt>Adapter emission</dt><dd>${escapeHtml(cell.reading?.channels?.adapterEmission ?? cell.reading?.producerLimit)}</dd>
          <dt>Alternate producer</dt><dd>${escapeHtml(cell.reading?.channels?.alternateProducer ?? "none-cited")}</dd>
          <dt>Evidence kind</dt><dd>${escapeHtml(cell.reading?.channels?.evidenceKind ?? "unknown")}. Live tested: ${cell.reading?.channels?.liveTested ? "yes" : "no"}. Independent semantic review: pending.</dd>
          <dt>Review</dt><dd>${escapeHtml(cell.reading?.readerNote ?? "")}</dd>
          <dt>Runtime fallback</dt><dd>${escapeHtml(cell.reading?.channels?.runtimeFallback ?? "not-established")}</dd>
          <dt>Selected-state UI value</dt><dd>${escapeHtml(cell.reading?.channels?.selectedStateUi ?? "separate")}</dd>
          <dt>Record mismatch</dt><dd>${escapeHtml(cell.reading?.mismatch ?? "None on this field record.")}</dd>
          <dt>Runtime trace</dt><dd>${escapeHtml(cell.runtime?.status)} ${escapeHtml(cell.runtime?.path ?? "")} ${escapeHtml(cell.endToEnd?.reason ?? "")}</dd>
          <dt>Synthetic fixture</dt><dd>${escapeHtml(cell.synthetic?.status)} ${escapeHtml(cell.synthetic?.fixtureKind ?? "")} ${escapeHtml(cell.synthetic?.syntheticLabel ?? "")}</dd>
          <dt>Consumer</dt><dd>${escapeHtml(cell.consumer?.status)} — ${escapeHtml(cell.consumer?.note ?? "")}</dd>
        </dl>
        <h3>Adapter trace sources</h3>
        <ul>${
          flowAnchors(cell)
            .map(
              (link) =>
                `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a> ${escapeHtml(link.path)}${link.line ? `:${escapeHtml(link.line)}` : ""}</li>`,
            )
            .join("") || "<li>No adapter trace is loaded for this field.</li>"
        }</ul>
        ${cell.mmdPath ? `<p><a href="/traces/${escapeHtml(cell.mmdPath.split("/").slice(-2).join("/"))}">Adapter graph file</a></p>` : "<p>No sibling .mmd for this adapter and field.</p>"}
        <h3>Model contract citations</h3>
        <ul>${evidence || "<li>No model evidence links on this field.</li>"}</ul>
        <h3>Shape</h3>
        <pre>${escapeHtml(shape)}</pre>
        <h3>Raw trace</h3>
        <pre>${escapeHtml(raw)}</pre>
      </aside>
    </div>
    <section aria-labelledby="gaps-heading">
      <h2 id="gaps-heading">State coverage</h2>
      <p>Delivery: incomplete. ${escapeHtml(String(cell.coverage?.fieldRecords ?? 0))} canonical row records are loaded. ${escapeHtml(String(cell.coverage?.sdkLeafRecords ?? 0))} SDK leaf records are separate.</p>
      <p>Shared anchors resolved: ${escapeHtml(String(index.sharedMap?.counts?.rowJoinAnchorsResolved ?? "—"))}. The map's uiResolutionCounts resolvedUnknown ${escapeHtml(String(index.sharedMap?.uiResolutionCounts?.resolvedUnknown ?? "—"))} and remainingUnknown ${escapeHtml(String(index.sharedMap?.uiResolutionCounts?.remainingUnknown ?? "—"))} are shared-anchor bookkeeping, not adapter-specific UI resolution. The map admits sequences are not reproven.</p>
      <p>First-half envelopes, counted from the files: uiReachable yes ${escapeHtml(String(index.partial?.blockers?.first?.ui?.yes ?? "—"))}, no ${escapeHtml(String(index.partial?.blockers?.first?.ui?.no ?? "—"))}, unknown ${escapeHtml(String(index.partial?.blockers?.first?.ui?.unknown ?? "—"))}. Candidate status: ${escapeHtml(String(index.partial?.candidateStatus ?? "static-not-live"))}. Independent signoff: ${escapeHtml(String(index.partial?.blockers?.costReview?.independentSignoff ?? "pending"))}.</p>
      <p>Claude and Codex cost-order anchors checked: ${escapeHtml((index.partial?.blockers?.costReview?.first?.anchorsChecked ?? []).join(", ") || "none")}. Known-order defect still held: ${escapeHtml((index.partial?.blockers?.costReview?.first?.precisionPending ?? []).join(", ") || "none")}. Citation verification and independent semantic acceptance are pending. This is not accepted provenance. Second-half cost branches: ${escapeHtml(
        Object.entries(index.partial?.blockers?.costReview?.second?.branches ?? {})
          .map(([id, branch]) => `${id} ${branch}`)
          .join("; ") || "none",
      )}. Account uiReachable no scoped to the VibeField host: ${escapeHtml((index.partial?.blockers?.accountVibefieldOnly ?? []).join(", ") || "none")}. That no is not a global impossibility. The Puppeteer Godview host can still set account when profileId has a nonempty label. Independent signoff is pending.</p>
      <p>Render denominator ${escapeHtml(String(index.rendering?.counts ? Object.values(index.rendering.counts).reduce((sum, value) => sum + value, 0) : "—"))}. Actual renders: ${escapeHtml(String(index.rendering?.bodyRendered ?? "—"))}. Matrix same-view aliases: ${escapeHtml(String(index.rendering?.coveredBy ?? "—"))}. Proved aliases: ${escapeHtml(String(index.rendering?.provedCoveredBy ?? "—"))}. Unverified aliases: ${escapeHtml((index.rendering?.unverifiedSpanAliases ?? []).join(", ") || "none")}. ${timelineProof(index)} Covered-by does not add body coverage. Coverage gaps: ${escapeHtml(String(index.rendering?.coverageGap ?? "—"))}. Zero ordinary coverage gaps is not a complete audit. Not-applicable: ${escapeHtml(String(index.rendering?.counts?.["not-applicable"] ?? "—"))}, proof ${escapeHtml(String(index.rendering?.notApplicableProof ?? "—"))}. The not-applicable cells and the same-view aliases are under lead review. Prior 302 not-applicable claim validated: no. Environment gaps: ${escapeHtml(String(index.rendering?.counts?.["environment-gap"] ?? "—"))}. Swarm body painted: no. Documented Colab guide flags and explicit SwiftShader both leave requestAdapter null, GPU EGL_NOT_INITIALIZED. This host has no hardware GPU and no system Vulkan ICD. webgpu-doc-flags.json is the record. No source defect is proven and the source is not exonerated. 67 Swarm cells stay unrendered.</p>
      ${(index.sharedMap?.openEnvelopeIssues ?? []).map((issue) => `<p>${escapeHtml(issue)}</p>`).join("")}
      ${cell.graphOrder ? `<p>${escapeHtml(cell.graphOrder.note)}</p>` : ""}
      <ul>
        ${(cell.coverage?.adapters ?? [])
          .filter((adapter) => adapter.records > 0)
          .map(
            (adapter) =>
              `<li><strong>${escapeHtml(adapter.adapterId)}</strong> ${adapter.records} row records. Explicit non-emission notes: ${adapter.nonEmittingRecords ?? 0}. Applicability lists are not emission.</li>`,
          )
          .join("")}
      </ul>
    </section>
    <section aria-labelledby="flow-heading">
      <h2 id="flow-heading">Provenance</h2>
      <p>End-to-end proven: ${cell.endToEnd?.proven === true ? "yes" : "no"}. ${escapeHtml(cell.endToEnd?.reason ?? "")}</p>
      <div id="flow"></div>
    </section>
    <section aria-labelledby="checks-heading">
      <h2 id="checks-heading">Checks</h2>
      <ul>${checks}</ul>
      <h3>Foundation gate</h3>
      <ul>${gate || "<li>No foundation failures.</li>"}</ul>
    </section>`;
}
