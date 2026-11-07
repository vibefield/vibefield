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
  "ended-lane": (_row, entry) => entry?.history === "bounds",
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
  "The swarm view would mount this row. This host's GPU process exits before requestAdapter returns, so no body was painted. See webgpu-diagnostic.json. That diagnosis is separate from whether a DOM view draws the field.";

function swarm() {
  return env(SWARM_BODY);
}

const byKey = new Map(ENTRIES.map((entry) => [`${entry.viewId}\0${entry.stateId}`, entry]));

function own(stateId, viewId) {
  return byKey.get(`${viewId}\0${stateId}`);
}

function decide(stateId, viewId) {
  if (stateId.startsWith("state.feed_")) {
    return outside(
      "There is no AgentView field or view capability for the feed door. Nothing can be mounted on these five views for that scenario.",
    );
  }
  if (stateId.startsWith("state.device_")) {
    return outside(
      "Asleep, incompatible, and live standing are not AgentView fields. The host's window-rows overlay may later copy standing onto the stale boolean, which is state.stale. There is no standing value to mount.",
    );
  }
  if (stateId === "state.dead_hidden") {
    return outside(
      "The scenario is that useMonitorAgents omits the row before the view's model is built. Mounting the row would be a different scenario, a visible agent.",
    );
  }
  if (stateId.startsWith("state.timeline_") && viewId !== "view.timeline") {
    return outside(
      "This is the timeline scrub head's moment. List, rain, spend, and swarm have no scrub head, so the moment cannot be mounted there.",
    );
  }
  if (stateId === "state.timeline_ended" && viewId === "view.timeline") {
    return alias(
      "fix.timeline.past-bounds",
      "ended-lane",
      "history bounds includes an ended run whose endedAt is before the frozen now. At the live head, stateAt for that lane is ended (timeline-lanes.ts). The screenshot contains that lane.",
    );
  }
  if (stateId === "state.spend_unknown" && viewId !== "view.spend") {
    return outside(
      "unknown is spendStateAt for a scrubbed time before statusSince. List, rain, timeline, and swarm have no spend scrub.",
    );
  }
  if (stateId === "state.terminal_opening" && viewId !== "view.swarm") {
    return outside(
      "opening is not an AgentView field. MonitorViewHost cannot be given it, so list, rain, spend, and timeline have nothing to mount.",
    );
  }
  if (stateId === "state.terminal_opening") return swarm();
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
      if (!exercise || !exercise(mountRow(entry), entry)) problems.push(`alias exercise ${key}`);
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
