import { flowAnchors, renderFlowSvg } from "../flows/render.mjs";
import { buildCell } from "../validation/cell.mjs";
import { AUDIT_TARGET_LABEL } from "../validation/contract.mjs";
import { swarmRuntimeMount } from "./swarm-mount.mjs";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function inlineSvg(svg) {
  return String(svg).replace(/^\s*<\?xml[^>]*>\s*/u, "");
}

function coverageBlock(index) {
  const fieldRecords = index.traceCount ?? 0;
  const sdkLeaves = index.sdkLeafCount ?? 0;
  return `<section id="coverage" aria-labelledby="gaps-heading">
      <h2 id="gaps-heading">State coverage</h2>
      <p>Delivery: incomplete. ${escapeHtml(String(fieldRecords))} canonical row records are loaded. ${escapeHtml(String(sdkLeaves))} SDK leaf records are separate. This is not an actual provider session.</p>
      <p>Shared anchors resolved: ${escapeHtml(String(index.sharedMap?.counts?.rowJoinAnchorsResolved ?? "—"))}. The map's uiResolutionCounts resolvedUnknown ${escapeHtml(String(index.sharedMap?.uiResolutionCounts?.resolvedUnknown ?? "—"))} and remainingUnknown ${escapeHtml(String(index.sharedMap?.uiResolutionCounts?.remainingUnknown ?? "—"))} are shared-anchor bookkeeping, not adapter-specific UI resolution. The map admits sequences are not reproven.</p>
      <p>First-half envelopes, counted from the files: uiReachable yes ${escapeHtml(String(index.partial?.blockers?.first?.ui?.yes ?? "—"))}, no ${escapeHtml(String(index.partial?.blockers?.first?.ui?.no ?? "—"))}, unknown ${escapeHtml(String(index.partial?.blockers?.first?.ui?.unknown ?? "—"))}. Candidate status: ${escapeHtml(String(index.partial?.candidateStatus ?? "static-not-live"))}. Independent signoff: ${escapeHtml(String(index.partial?.blockers?.costReview?.independentSignoff ?? "pending"))}.</p>
      <p>Claude and Codex cost-order anchors checked: ${escapeHtml((index.partial?.blockers?.costReview?.first?.anchorsChecked ?? []).join(", ") || "none")}. Known-order defect still held: ${escapeHtml((index.partial?.blockers?.costReview?.first?.precisionPending ?? []).join(", ") || "none")}. Citation verification and independent semantic acceptance are pending. This is not accepted provenance. Second-half cost branches: ${escapeHtml(
        Object.entries(index.partial?.blockers?.costReview?.second?.branches ?? {})
          .map(([id, branch]) => `${id} ${branch}`)
          .join("; ") || "none",
      )}. Account uiReachable no scoped to the VibeField host: ${escapeHtml((index.partial?.blockers?.accountVibefieldOnly ?? []).join(", ") || "none")}. That no is not a global impossibility. The Puppeteer Godview host can still set account when profileId has a nonempty label. Independent signoff is pending.</p>
      <p>Render denominator ${escapeHtml(String(index.rendering?.counts ? Object.values(index.rendering.counts).reduce((sum, value) => sum + value, 0) : "—"))}. Actual renders: ${escapeHtml(String(index.rendering?.bodyRendered ?? "—"))}. Matrix same-view aliases: ${escapeHtml(String(index.rendering?.coveredBy ?? "—"))}. Proved aliases: ${escapeHtml(String(index.rendering?.provedCoveredBy ?? "—"))}. Unverified aliases: ${escapeHtml((index.rendering?.unverifiedSpanAliases ?? []).join(", ") || "none")}. ${timelineProof(index)} Covered-by does not add body coverage. Coverage gaps: ${escapeHtml(String(index.rendering?.coverageGap ?? "—"))}. Zero ordinary coverage gaps is not a complete audit. Not-applicable: ${escapeHtml(String(index.rendering?.counts?.["not-applicable"] ?? "—"))}, proof ${escapeHtml(String(index.rendering?.notApplicableProof ?? "—"))}. The not-applicable cells and the same-view aliases are under lead review. Prior 302 not-applicable claim validated: no. Environment gaps: ${escapeHtml(String(index.rendering?.counts?.["environment-gap"] ?? "—"))}. Swarm body painted: no. Documented Colab guide flags and explicit SwiftShader both leave requestAdapter null, GPU EGL_NOT_INITIALIZED. This host has no hardware GPU and no system Vulkan ICD. webgpu-doc-flags.json is the record. No source defect is proven and the source is not exonerated. 67 Swarm cells stay unrendered. Overall screenshot coverage complete: no. The harness and swarm runtime in this package are not the separate swarm fix.</p>
      ${(index.sharedMap?.openEnvelopeIssues ?? []).map((issue) => `<p>${escapeHtml(issue)}</p>`).join("")}
    </section>`;
}

function matrixArticle(cell, shot, bundle) {
  const rendered = cell.disposition === "rendered" && shot?.meaningfulOutput === true;
  const fixtureId = rendered
    ? shot.fixturePath
        ?.split("/")
        .pop()
        ?.replace(/\.json$/u, "") || cell.fixtureId
    : cell.fixtureId;
  const swarm =
    cell.disposition === "environment-gap"
      ? swarmRuntimeMount({
          selection: { viewId: cell.viewId, stateId: cell.stateId },
          paint: { disposition: "environment-gap" },
        })
      : null;
  const src = (id) => `/harness/index.html?fixture=${encodeURIComponent(id)}&embed=1`;
  const live =
    rendered && fixtureId && bundle
      ? `<div class="live-slot" data-live-slot data-kind="fixture" data-slot="fixture-${escapeHtml(cell.viewId)}-${escapeHtml(cell.stateId)}" data-fixture="${escapeHtml(fixtureId)}" data-src="${src(fixtureId)}" data-mount="${src(fixtureId)}"><p>Live synthetic fixture. It mounts when this entry is near the viewport and unmounts when it leaves. Not shipped package 0.3.3. Not an actual provider session.</p></div>`
      : swarm?.attempt && bundle
        ? `<div class="live-slot" data-live-slot data-kind="swarm" data-swarm-mount="${escapeHtml(swarm.fixtureId)}" data-slot="swarm-${escapeHtml(cell.stateId)}" data-fixture="${escapeHtml(swarm.fixtureId)}" data-src="${src(swarm.fixtureId)}"><p>${escapeHtml(swarm.reason)}</p></div>`
        : swarm
          ? `<p>${escapeHtml(swarm.reason)}</p>`
          : cell.disposition === "environment-gap"
            ? `<p>Environment gap. No live mount and no painted swarm body.</p>`
            : "";
  const figure =
    rendered && shot?.screenshotPath
      ? `<figure><img loading="lazy" src="/shots/${escapeHtml(shot.screenshotPath.split("/").pop())}" alt="Recorded fixture screenshot" /><figcaption>Recorded fixture screenshot. Not the live component mount.</figcaption></figure>`
      : "";
  return `<article class="entry" data-matrix-cell="1" id="cell-${escapeHtml(cell.viewId)}-${escapeHtml(cell.stateId)}">
      <h3>${escapeHtml(cell.viewId)} · ${escapeHtml(cell.stateId)}</h3>
      <p>${escapeHtml(cell.disposition)}. Meaningful paint: ${rendered ? "yes" : "no"}. Selected fixture rendered: ${rendered ? "yes" : "no"}. Overall screenshot coverage complete: no.</p>
      <p>${escapeHtml(cell.evidence ?? "")}</p>
      <div class="preview">${figure}${live}</div>
    </article>`;
}

function recordArticle(trace, cell) {
  const leaf = trace.recordKind === "sdk-leaf";
  const svg = inlineSvg(renderFlowSvg(cell));
  const anchors = flowAnchors(cell)
    .map(
      (link) =>
        `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a> ${escapeHtml(link.path)}${link.line ? `:${escapeHtml(link.line)}` : ""}</li>`,
    )
    .join("");
  const mmd = cell.mmdPath
    ? `<p><a href="/traces/${escapeHtml(cell.mmdPath.split("/").slice(-2).join("/"))}">Sibling .mmd, alternate reference</a>. It is not this diagram.</p>`
    : "<p>No sibling .mmd for this adapter and field.</p>";
  return `<article class="entry" data-record="${leaf ? "sdk-leaf" : "row"}" id="record-${escapeHtml(trace.adapterId)}-${escapeHtml(trace.fieldId)}">
      <h3>${escapeHtml(trace.adapterId)} · ${escapeHtml(trace.fieldId)}</h3>
      <p>${leaf ? "SDK leaf. Not one of the 74 row fields." : "Row record. Not an SDK leaf."} uiReachable ${escapeHtml(cell.reading?.channels?.uiReachable ?? "unknown")}. rendererRead ${escapeHtml(cell.reading?.channels?.rendererRead ?? "unlabeled")}. Full path success: ${cell.reading?.success ? "yes" : "no"}. End-to-end proven: ${cell.endToEnd?.proven === true ? "yes" : "no"}. Independent semantic review: pending. Not an actual provider session.</p>
      <div class="flow-diagram">${svg}</div>
      ${mmd}
      <ul>${anchors}</ul>
    </article>`;
}

/** One scrollable audit. Nothing here is behind a selector, tab, or collapse. */
export function renderScroll(audit) {
  const index = audit.index;
  const shots = new Map(
    (audit.renderIndex?.fixtures ?? []).map((fixture) => [
      `${fixture.viewId}:${fixture.stateId}`,
      fixture,
    ]),
  );
  const bundle = index.rendering?.componentBundle === true;
  const byView = new Map();
  for (const cell of audit.renderIndex?.cells ?? []) {
    if (!byView.has(cell.viewId)) byView.set(cell.viewId, []);
    byView.get(cell.viewId).push(cell);
  }
  const stateSections = [...byView.entries()]
    .map(([viewId, cells]) => {
      const articles = cells
        .map((cell) => matrixArticle(cell, shots.get(`${cell.viewId}:${cell.stateId}`), bundle))
        .join("");
      return `<section><h2 id="view-${escapeHtml(viewId)}">${escapeHtml(viewId)}</h2>${articles}</section>`;
    })
    .join("");
  const base = {
    model: audit.model,
    traces: audit.traces,
    renders: audit.renders,
    fallback: audit.overlay,
    renderIndex: audit.renderIndex,
  };
  const groups = new Map();
  for (const trace of audit.traces ?? []) {
    const kind = trace.recordKind === "sdk-leaf" ? "leaf" : "row";
    if (!groups.has(trace.adapterId)) groups.set(trace.adapterId, { row: [], leaf: [] });
    groups.get(trace.adapterId)[kind].push(trace);
  }
  const sectionFor = (kind) =>
    [...groups.entries()]
      .map(([adapterId, bucket]) => {
        const articles = bucket[kind]
          .map((trace) =>
            recordArticle(
              trace,
              buildCell({
                ...base,
                selection: {
                  stateId: "state.idle",
                  viewId: "view.list",
                  adapterId: trace.adapterId,
                  fieldId: trace.fieldId,
                },
              }),
            ),
          )
          .join("");
        return articles
          ? `<section><h2 id="${kind}-${escapeHtml(adapterId)}">${escapeHtml(adapterId)}</h2>${articles}</section>`
          : "";
      })
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
  return `<section class="banner" role="note" aria-label="Audit target">
      <p class="eyebrow">GV-AUDIT6</p>
      <h1>${escapeHtml(AUDIT_TARGET_LABEL)}</h1>
      <p>Puppeteer pin <code>${escapeHtml(index.auditTarget.sourceRevision.puppeteer)}</code>. Vibefield overlay pin <code>${escapeHtml(index.auditTarget.sourceRevision.vibefield)}</code>.</p>
      <p>${escapeHtml(index.boundary?.summary ?? "")}</p>
    </section>
    <p class="posture" role="status">${escapeHtml(index.coverageClaim.reason)} ${escapeHtml(index.partial?.note ?? "")}</p>
    <p class="gate" role="status">${escapeHtml(index.foundationGate?.note ?? "")}</p>
    <nav aria-label="Page sections">
      <a href="#states">State and view entries</a>
      <a href="#records">Adapter field records</a>
      <a href="#leaves">SDK leaves</a>
      <a href="#coverage">Coverage</a>
    </nav>
    ${coverageBlock(index)}
    <section id="states" aria-labelledby="states-heading">
      <h2 id="states-heading">State and view entries</h2>
      <p>All ${escapeHtml(String((audit.renderIndex?.cells ?? []).length))} state and view entries are on this page. A rendered entry's live mount is a synthetic fixture. The image is the recorded fixture. Neither is an actual provider session. Environment gaps are not mounts.</p>
      ${stateSections}
    </section>
    <section id="records" aria-labelledby="records-heading">
      <h2 id="records-heading">Adapter field records</h2>
      <p>The ${escapeHtml(String(index.traceCount ?? 0))} row records are listed here. Each diagram is the envelope for that adapter and field. Dashed boxes are not a runtime chain.</p>
      ${sectionFor("row")}
    </section>
    <section id="leaves" aria-labelledby="leaves-heading">
      <h2 id="leaves-heading">SDK leaves</h2>
      <p>These ${escapeHtml(String(index.sdkLeafCount ?? 0))} SDK leaves are not the 74 row fields.</p>
      ${sectionFor("leaf")}
    </section>
    <section id="checks" aria-labelledby="checks-heading">
      <h2 id="checks-heading">Checks</h2>
      <ul>${checks}</ul>
      <h3>Foundation gate</h3>
      <ul>${gate || "<li>No foundation failures.</li>"}</ul>
    </section>`;
}

export function renderShell(index, cell) {
  void cell;
  return renderScroll({
    index,
    traces: [],
    model: {},
    renders: [],
    overlay: {},
    renderIndex: { cells: [], fixtures: [] },
  });
}
