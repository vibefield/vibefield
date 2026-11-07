// State × view matrix for the five monitor views at Puppeteer 748d015.
//
// not-applicable means the scenario is outside that view's surface.
// A view that does not draw a subtype is still in scope: render it, alias it
// to a mounted fixture that exercises the same branch, or leave it unverified.
// The d21cde9a count of 302 not-applicable is not a validated scope judgment.

import { ENTRIES, MODEL_STATE_IDS, mountRow } from "./inputs.mjs";

export const VIEWS = ["view.list", "view.rain", "view.spend", "view.timeline", "view.swarm"];

export const PRIOR_CLAIM = {
  rendered: 73,
  notApplicable: 302,
  environmentGap: 35,
  validated: false,
  note: "d21cde9a reported 302 not-applicable cells. That figure is not a validated judgment that those scenarios are outside the views. Fifty-nine used a boilerplate 'no read' sentence. This matrix replaces that classification. The denominator stays 82 states × 5 views.",
};

const DIAGNOSTIC = "audit/godview/rendering/webgpu-diagnostic.json";

export const EXERCISES = {
  "stale-false": (row) => row.stale === false,
  "attachment-absent": (row) => row.attachment == null,
  "reply-absent": (row) => row.reply == null,
  "branch-absent": (row) => row.project?.branch === undefined,
  "model-absent": (row) => row.model == null || row.model === "",
  "context-absent": (row) => row.context == null,
  "attachable-true": (row) => row.attachable === true,
};

const rendered = (entry) => ({
  disposition: "rendered",
  fixtureId: entry.fixtureId,
  evidence: entry.predicate,
});

const alias = (fixtureId, exercise, evidence) => ({
  disposition: "covered-by",
  fixtureId,
  exercise,
  evidence: `Same branch as ${fixtureId}. ${evidence}`,
});

const unverified = (evidence) => ({
  disposition: "coverage-gap",
  evidence: `Unverified: ${evidence}`,
});

const outside = (evidence) => ({
  disposition: "not-applicable",
  evidence: `Outside this view: ${evidence}`,
});

const env = (evidence) => ({
  disposition: "environment-gap",
  evidence,
  diagnostic: DIAGNOSTIC,
});

const SWARM_BODY =
  "AgentSwarm / bubble-model.ts draws this on the WebGPU canvas. This host's GPU process exits before requestAdapter returns, so the body was not painted. See webgpu-diagnostic.json. The swarm diagnosis is separate from the matrix reclassification.";

function swarm() {
  return env(SWARM_BODY);
}

const byKey = new Map(ENTRIES.map((entry) => [`${entry.viewId}\0${entry.stateId}`, entry]));

function own(stateId, viewId) {
  return byKey.get(`${viewId}\0${stateId}`);
}

function decide(stateId, viewId) {
  const dom = viewId !== "view.swarm";
  if (stateId.startsWith("state.feed_")) {
    return outside(
      "MonitorFeedState is the host's door chrome. These five views take agent rows, not the feed door.",
    );
  }
  if (stateId.startsWith("state.device_")) {
    return outside(
      "Desktop standing is applied by the host's window-rows overlay before a view sees a row. This harness mounts the view directly. The row flag the views can paint is state.stale, which is a different cell.",
    );
  }
  if (stateId.startsWith("state.tier_")) {
    return outside("Tier is a host classification. It is not a field on the AgentView these views mount.");
  }
  if (stateId === "state.dead_hidden") {
    return outside(
      "A dead-hidden row is removed by VibeField useMonitorAgents before a view is given its model. The view has no dead-hidden paint because the row is not in the model.",
    );
  }
  if (stateId.startsWith("state.past_") && viewId !== "view.timeline") {
    return outside(
      "A past span is the timeline's history lane. List, rain, spend, and swarm paint the live row and have no history surface.",
    );
  }
  if (stateId.startsWith("state.timeline_") && viewId !== "view.timeline") {
    return outside(
      "unborn, unrecorded, past, ended, and span are TimelineView's scrub cursor. The other views have no scrub cursor.",
    );
  }
  if (stateId.startsWith("state.timeline_") && viewId === "view.timeline") {
    return unverified(
      "TimelineView can show this cursor moment while scrubbing. The harness has no control that sets moment.kind, so the cursor was not exercised.",
    );
  }
  if (stateId === "state.spend_unknown" && viewId !== "view.spend") {
    return outside(
      "spend_unknown is spendStateAt for a scrubbed time before statusSince. The other views have no spend scrub.",
    );
  }
  if (stateId === "state.spend_unknown") {
    return unverified(
      "SpendView can show unknown when the scrub is before statusSince. The harness does not drive that scrub, so the branch was not exercised.",
    );
  }
  if (stateId === "state.spend_before" && viewId !== "view.spend") {
    return outside(
      "spend_before is spendStateAt for a row whose birth is still in the future. The other views have no spend time cursor.",
    );
  }
  if (stateId.startsWith("state.spawn_") && (viewId === "view.rain" || viewId === "view.spend" || viewId === "view.timeline")) {
    return outside(
      "The spawn menu is ListSpawnMenu and the swarm bloom. Rain, spend, and timeline have no spawn surface.",
    );
  }
  if (stateId.startsWith("state.spawn_") && viewId === "view.swarm") return swarm();
  if ((stateId === "state.terminal_running" || stateId === "state.terminal_quiet") && viewId === "view.spend") {
    return outside(
      "spendMeters skips kind terminal (spend-series.ts). A terminal is not a spend row. Running and quiet terminals are outside the spend meter.",
    );
  }
  if (stateId === "state.terminal_opening" && viewId !== "view.swarm") {
    return outside(
      "opening is a swarm-local word. It is not an AgentView field, and MonitorViewHost cannot pass it to list, rain, spend, or timeline.",
    );
  }
  if (stateId === "state.terminal_opening") return swarm();
  if (stateId === "state.terminal_empty" && viewId === "view.spend") {
    return outside("spendMeters skips terminals, so an empty terminal is not a spend row.");
  }
  if (stateId === "state.terminal_empty" && viewId === "view.swarm") return swarm();
  if (stateId === "state.terminal_empty") {
    return unverified(
      "empty is a quiet terminal with nothing opening. The rendered quiet fixtures set detail to quiet, so they do not exercise an empty terminal. List, rain, and timeline would still show the row.",
    );
  }
  if (stateId.startsWith("state.burn_") && viewId !== "view.swarm") {
    return outside(
      "This state is one rung of the swarm flame ladder in bubble-model.ts burnFlames. List, rain, spend, and timeline have no flame ladder. Spend's own rate is state.cost_* and the working row, not this rung.",
    );
  }
  if (stateId.startsWith("state.burn_") && viewId === "view.swarm") return swarm();
  if (stateId.startsWith("state.effort_") && viewId === "view.swarm") return swarm();
  if (stateId.startsWith("state.effort_")) {
    return unverified(
      "An agent with this effort can sit in the view. Only bubble-model.ts effortLines paints effort. No list, rain, spend, or timeline fixture mounts an effort object, so the shared row branch is not exercised.",
    );
  }
  if (stateId.startsWith("state.activity_") && viewId === "view.swarm") return swarm();
  if (stateId.startsWith("state.activity_")) {
    return unverified(
      "The row can carry activity.kind. No mounted fixture sets it. List, rain, spend, and timeline do not draw a per-kind branch; that is not the same as the scenario being out of scope.",
    );
  }
  if (stateId.startsWith("state.cost_") && viewId === "view.swarm") return swarm();
  if (stateId.startsWith("state.cost_") && viewId !== "view.spend") {
    return unverified(
      "A row can carry this cost object in the view. No mounted list, rain, or timeline fixture includes that coverage. The list's contract test says the list does not print cost; the cost input itself was not exercised.",
    );
  }
  if (viewId === "view.swarm") return swarm();

  if (stateId === "state.fresh") {
    const fixtureId = { "view.rain": "fix.rain.idle", "view.spend": "fix.spend.idle", "view.timeline": "fix.timeline.idle" }[viewId];
    return alias(
      fixtureId,
      "stale-false",
      "agentViewFixture sets stale false unless the partial overrides it. This idle fixture does not. The view paints no separate fresh mark, so the idle screenshot is that branch.",
    );
  }
  if (stateId === "state.detached") {
    const fixtureId = { "view.rain": "fix.rain.working", "view.spend": "fix.spend.working", "view.timeline": "fix.timeline.working" }[viewId];
    return alias(
      fixtureId,
      "attachment-absent",
      "The mounted row has no attachment. Rain tints a column only when attachment is set, spend adds is-mounted only then, and the timeline pane mark is the attached fixture. This screenshot is the absent branch.",
    );
  }
  if (stateId === "state.reply_missing") {
    const fixtureId = { "view.rain": "fix.rain.idle", "view.spend": "fix.spend.idle", "view.timeline": "fix.timeline.idle" }[viewId];
    return alias(
      fixtureId,
      "reply-absent",
      "The mounted row has no reply. detailLine falls back to the status word. The idle screenshot is that branch.",
    );
  }
  if (stateId === "state.branch_unknown") {
    const fixtureId = { "view.rain": "fix.rain.working", "view.spend": "fix.spend.idle", "view.timeline": "fix.timeline.idle" }[viewId];
    return alias(
      fixtureId,
      "branch-absent",
      "The mounted project has no branch key. rainDataString, modelOf, and laneSubLine drop a falsy branch. This is the absent branch, not the null branch.",
    );
  }
  if (stateId === "state.model_missing") {
    const fixtureId = { "view.rain": "fix.rain.working", "view.spend": "fix.spend.idle", "view.timeline": "fix.timeline.idle" }[viewId];
    return alias(
      fixtureId,
      "model-absent",
      "The mounted row has no model. modelWord falls back to the provider label. The screenshot is that fallback.",
    );
  }
  if (stateId === "state.context_missing" && (viewId === "view.spend" || viewId === "view.timeline")) {
    const fixtureId = viewId === "view.spend" ? "fix.spend.idle" : "fix.timeline.idle";
    return alias(
      fixtureId,
      "context-absent",
      "The mounted row has no context. Spend and the timeline lane do not print a percent. The idle screenshot is that input.",
    );
  }
  if (stateId === "state.attachable") {
    const fixtureId = {
      "view.list": "fix.list.idle",
      "view.rain": "fix.rain.idle",
      "view.spend": "fix.spend.idle",
      "view.timeline": "fix.timeline.idle",
    }[viewId];
    return alias(
      fixtureId,
      "attachable-true",
      "agentViewFixture sets attachable true. The idle screenshot mounted that value. None of these views add a class from attachable, so the idle paint is the branch.",
    );
  }
  if (stateId === "state.wait_multiple" || stateId === "state.working_with_blockers") {
    return unverified(
      "The list fixture mounts this input. Rain, spend, and timeline can show the same row, and no fixture for this view mounts it.",
    );
  }
  if (stateId === "state.reply_streaming" || stateId === "state.reply_final") {
    return unverified(
      "The list fixtures mount reply.final false and true. detailLine prints the text and ignores final. Rain, spend, and timeline were not mounted with that reply.",
    );
  }
  if (stateId === "state.failed_retained") {
    return unverified(
      "Retention is the host's keepsFailure. A row that still reaches the view would paint as its status. No fixture mounts alive false.",
    );
  }
  if (!dom) return swarm();
  throw new Error(`unclassified ${stateId} ${viewId}`);
}

export function matrix() {
  const cells = [];
  for (const stateId of MODEL_STATE_IDS) {
    for (const viewId of VIEWS) {
      const entry = own(stateId, viewId);
      if (entry) {
        cells.push({ stateId, viewId, ...rendered(entry) });
        continue;
      }
      cells.push({ stateId, viewId, ...decide(stateId, viewId) });
    }
  }
  return cells;
}

export function matrixSummary(cells = matrix()) {
  const counts = {
    cells: cells.length,
    rendered: 0,
    coveredBy: 0,
    coverageGap: 0,
    notApplicable: 0,
    environmentGap: 0,
  };
  for (const cell of cells) {
    if (cell.disposition === "rendered") counts.rendered += 1;
    else if (cell.disposition === "covered-by") counts.coveredBy += 1;
    else if (cell.disposition === "coverage-gap") counts.coverageGap += 1;
    else if (cell.disposition === "not-applicable") counts.notApplicable += 1;
    else if (cell.disposition === "environment-gap") counts.environmentGap += 1;
  }
  return { priorClaim: PRIOR_CLAIM, ...counts };
}

const BOILERPLATE = /no read of this predicate|do not read|does not read|none of the five views read/i;

export function assertMatrix(cells) {
  const problems = [];
  const seen = new Set();
  const entries = new Map(ENTRIES.map((entry) => [entry.fixtureId, entry]));
  if (cells.length !== MODEL_STATE_IDS.length * VIEWS.length) {
    problems.push(`denominator ${cells.length}`);
  }
  for (const cell of cells) {
    const key = `${cell.stateId}\0${cell.viewId}`;
    if (seen.has(key)) problems.push(`duplicate ${key}`);
    seen.add(key);
    if (!["rendered", "covered-by", "coverage-gap", "not-applicable", "environment-gap"].includes(cell.disposition)) {
      problems.push(`bad disposition ${key}`);
    }
    if (!cell.evidence || cell.evidence.length < 12) problems.push(`evidence ${key}`);
    if (cell.disposition === "not-applicable" && BOILERPLATE.test(cell.evidence)) {
      problems.push(`boilerplate ${key}`);
    }
    if (cell.disposition === "rendered") {
      const entry = entries.get(cell.fixtureId);
      if (!entry || entry.viewId !== cell.viewId || entry.stateId !== cell.stateId) problems.push(`rendered ${key}`);
    }
    if (cell.disposition === "covered-by") {
      if (!cell.evidence.startsWith("Same branch as ")) problems.push(`alias wording ${key}`);
      const entry = entries.get(cell.fixtureId);
      if (!entry || entry.viewId !== cell.viewId) problems.push(`alias view ${key}`);
      const exercise = EXERCISES[cell.exercise];
      if (!exercise || !exercise(mountRow(entry))) problems.push(`alias exercise ${key}`);
    }
    if (cell.disposition === "not-applicable") {
      if (!cell.evidence.startsWith("Outside this view:")) problems.push(`scope wording ${key}`);
      if (cell.fixtureId) problems.push(`na fixture ${key}`);
    }
    if (cell.disposition === "coverage-gap" && !cell.evidence.startsWith("Unverified:")) {
      problems.push(`gap wording ${key}`);
    }
    if (cell.disposition === "environment-gap" && cell.diagnostic !== DIAGNOSTIC) {
      problems.push(`diagnostic ${key}`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 30).join("\n"));
  return cells;
}
