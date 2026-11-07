import { AUDIT_TARGET_LABEL } from "../validation/contract.mjs";

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
    <p class="posture" role="status">${escapeHtml(index.coverageClaim.reason)} Foundation scaffold is not proof of completeness. Renderer and adapter slices are still incoming.</p>
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
        <p>The five monitor views live in Puppeteer. VibeField consumes <code>AgentView</code>. This page mounts GV-AUDIT05's harness and does not draw a replacement monitor.</p>
        <p class="stage-pending" role="status">${cell.view ? escapeHtml(`${cell.view.id} · ${cell.view.name}`) : "No view loaded."} Mounted: ${cell.paint?.mounted ? "yes" : "no"}. Meaningful paint: ${cell.paint?.meaningfulOutput ? "yes" : "no"}. Screenshot coverage complete: ${cell.paint?.screenshotCoverageComplete ? "yes" : "no"}.</p>
        <p>${escapeHtml(cell.paint?.note ?? "")}</p>
        ${
          cell.paint?.screenshotPath
            ? `<figure><img src="/shots/${escapeHtml(cell.paint.screenshotPath.split("/").pop())}" alt="${escapeHtml(cell.paint.fallbackOnly ? "Swarm fallback: WebGPU unavailable. Not a painted body." : "Synthetic view screenshot")}" /><figcaption>${escapeHtml(cell.paint.fallbackOnly ? "Fallback message only." : "Synthetic paint.")}</figcaption></figure>`
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
          <dt>Producer limit</dt><dd>${escapeHtml(cell.reading?.producerLimit)}. An adapter that does not emit the field does not prove the runtime, host, history, or window cannot supply it.</dd>
          <dt>Reader</dt><dd>${escapeHtml(cell.reading?.reader)} — ${escapeHtml(cell.reading?.readerNote ?? "")}</dd>
          <dt>Record mismatch</dt><dd>${escapeHtml(cell.reading?.mismatch ?? "None on this field record.")}</dd>
          <dt>Runtime trace</dt><dd>${escapeHtml(cell.runtime?.status)} ${escapeHtml(cell.runtime?.path ?? "")} ${escapeHtml(cell.endToEnd?.reason ?? "")}</dd>
          <dt>Synthetic fixture</dt><dd>${escapeHtml(cell.synthetic?.status)} ${escapeHtml(cell.synthetic?.fixtureKind ?? "")} ${escapeHtml(cell.synthetic?.syntheticLabel ?? "")}</dd>
          <dt>Consumer</dt><dd>${escapeHtml(cell.consumer?.status)} — ${escapeHtml(cell.consumer?.note ?? "")}</dd>
        </dl>
        <h3>Evidence</h3>
        <ul>${evidence || "<li>No model evidence links on this field.</li>"}</ul>
        <h3>Shape</h3>
        <pre>${escapeHtml(shape)}</pre>
        <h3>Raw trace</h3>
        <pre>${escapeHtml(raw)}</pre>
      </aside>
    </div>
    <section aria-labelledby="gaps-heading">
      <h2 id="gaps-heading">State coverage</h2>
      <p>${escapeHtml(String(cell.coverage?.fieldRecords ?? 0))} canonical row records are loaded. ${escapeHtml(String(cell.coverage?.sdkLeafRecords ?? 0))} SDK leaf records are separate. The envelopes still have ${escapeHtml(String(index.partial?.uiUnchecked ?? 0))} unknown UI classifications and the unfilled join still has ${escapeHtml(String(index.partial?.stateUnchecked ?? 0))} unknown state verdicts.</p>
      <p>The shared downstream map is a static code trace: ${escapeHtml(String(index.sharedMap?.counts?.normalizedEvents ?? "—"))} events, ${escapeHtml(String(index.sharedMap?.counts?.rowFieldContinuations ?? "—"))} fields, ${escapeHtml(String(index.sharedMap?.counts?.statePredicates ?? "—"))} states, ${escapeHtml(String(index.sharedMap?.counts?.rowJoinAnchorsResolved ?? "—"))} anchors filled. It reports the earlier 265 UI unknowns and 35 state unknowns resolved on that map, with direct and indirect readers distinguished. The map does not make the current envelopes complete, and it is not a live run.</p>
      ${(index.sharedMap?.openEnvelopeIssues ?? []).map((issue) => `<p>${escapeHtml(issue)}</p>`).join("")}
      ${cell.graphOrder ? `<p>${escapeHtml(cell.graphOrder.note)}</p>` : ""}
      <ul>
        ${(cell.coverage?.adapters ?? [])
          .filter((adapter) => adapter.records > 0)
          .map(
            (adapter) =>
              `<li><strong>${escapeHtml(adapter.adapterId)}</strong> names ${adapter.namedCount} states across ${adapter.records} fields. Not named: ${escapeHtml(adapter.unnamed.join(", "))}.</li>`,
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
