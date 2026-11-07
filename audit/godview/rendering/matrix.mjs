// State × view coverage for the five monitor views at Puppeteer 748d015.
// not-applicable is only used with a source path. environment-gap means the
// view does paint the predicate and this host could not run that paint.

import { ENTRIES, HOLES } from "./inputs.mjs";

export const VIEWS = ["view.list", "view.rain", "view.spend", "view.timeline", "view.swarm"];

const na = (evidence) => ({ disposition: "not-applicable", evidence });
const gap = (evidence) => ({
  disposition: "environment-gap",
  evidence,
  diagnostic: "audit/godview/rendering/webgpu-diagnostic.json",
});

const LIST_ONLY = na(
  "packages/views/src/views/list/AgentList.tsx reads this predicate. The other views do not.",
);
const NO_VIEW = na(
  "No read of this predicate in packages/views/src/views/{list,rain,spend,timeline,swarm} at 748d015.",
);

// Swarm body predicates. The component paints them on the WebGPU canvas.
const SWARM = new Set([
  "state.idle",
  "state.working",
  "state.blocked",
  "state.blocked_permission",
  "state.blocked_question",
  "state.blocked_failure",
  "state.unread",
  "state.stale",
  "state.fresh",
  "state.remote",
  "state.receded",
  "state.context_missing",
  "state.context_hot",
  "state.effort_configured",
  "state.effort_observed",
  "state.effort_absent",
  "state.burn_flames_0",
  "state.burn_flames_1",
  "state.burn_flames_2",
  "state.burn_flames_3",
  "state.burn_flames_4",
  "state.burn_unpriced",
  "state.terminal_running",
  "state.terminal_quiet",
  "state.terminal_empty",
  "state.terminal_opening",
  "state.branch_named",
  "state.branch_unknown",
  "state.starting_unobserved",
  "state.pending_unobserved",
  "state.spawn_ready",
  "state.spawn_asleep",
  "state.spawn_silent",
  "state.spawn_incompatible",
  "state.spawn_reading",
]);

const EVIDENCE = {
  "state.idle": {
    "view.list": "AgentList.tsx status class is-idle",
    "view.rain": "RainView.tsx statusPresentation idle hides the head",
    "view.spend": "spend-words.ts spendStateAt key idle",
    "view.timeline": "timeline-paint.ts idle lane",
    "view.swarm": "bubble-model.ts appearance is the row status",
  },
  "state.working": {
    "view.list": "AgentList.tsx status class is-working",
    "view.rain": "RainView.tsx showHead for working",
    "view.spend": "spend-words.ts spendStateAt key working",
    "view.timeline": "timeline-paint.ts working lane",
    "view.swarm": "bubble-model.ts working body, flames and radius",
  },
  "state.blocked": {
    "view.list": "AgentList.tsx status class is-blocked",
    "view.rain": "RainView.tsx blocked head speed",
    "view.spend": "spend-words.ts blocked state and glyph",
    "view.timeline": "timeline-paint.ts blocked orange",
    "view.swarm": "bubble-model.ts blocked light orange",
  },
};

function renderedCell(entry) {
  return {
    disposition: "rendered",
    fixtureId: entry.fixtureId,
    evidence: entry.predicate,
  };
}

export function matrix() {
  const byKey = new Map(ENTRIES.map((entry) => [`${entry.viewId}\0${entry.stateId}`, entry]));
  const holeByState = new Map(HOLES.map((hole) => [hole.stateId, hole]));
  const states = [...new Set([...ENTRIES.map((entry) => entry.stateId), ...HOLES.map((hole) => hole.stateId)])];
  const cells = [];
  for (const stateId of states) {
    for (const viewId of VIEWS) {
      const entry = byKey.get(`${viewId}\0${stateId}`);
      if (entry && !entry.requiresBodyPaint) {
        cells.push({ stateId, viewId, ...renderedCell(entry) });
        continue;
      }
      if (SWARM.has(stateId) && viewId === "view.swarm") {
        cells.push({
          stateId,
          viewId,
          ...gap(
            EVIDENCE[stateId]?.[viewId] ??
              "bubble-model.ts or AgentSwarm.tsx paints this predicate on the WebGPU canvas or the spawn bloom.",
          ),
        });
        continue;
      }
      const hole = holeByState.get(stateId);
      cells.push({
        stateId,
        viewId,
        disposition: "not-applicable",
        evidence: specificEvidence(stateId, viewId, hole),
      });
    }
  }
  return cells;
}

function specificEvidence(stateId, viewId, hole) {
  if (stateId.startsWith("state.activity_")) {
    return "AgentSwarm.tsx:1031 reads activity.kind only to keep a terminal clock across kind unknown. No view paints a distinct branch per kind. The host can still supply activity.kind; adapter absence is not why this cell is blank.";
  }
  if (stateId.startsWith("state.feed_")) {
    return "None of the five views read MonitorFeedState. The host's Godview monitor chrome does. Adapter absence is not the reason.";
  }
  if (stateId.startsWith("state.device_")) {
    return "window-rows.ts overwrites a peer's stale from desktop standing. AgentList.tsx reads only the boolean stale class, not asleep versus incompatible.";
  }
  if (stateId === "state.reply_streaming" || stateId === "state.reply_final") {
    return "No view reads reply.final. detailLine uses reply.text. Streaming and final are not separate paint.";
  }
  if (stateId === "state.branch_none") {
    return "List, rain glyphs, and spend modelOf drop a falsy branch. null and absent take the same branch. Kept as a synthetic list fixture because the Vibefield overlay does not produce null.";
  }
  if (stateId === "state.blocked_unknown_kind" && viewId !== "view.list") {
    return "bubble-model.ts DRAWN_WAITS is permission, question, or failure. Other views' wait words may echo the kind, but the typed producers do not emit it. The list fixture is the synthetic defensive paint.";
  }
  if (stateId === "state.wait_multiple") {
    return "No view reads wait.count.";
  }
  if (stateId === "state.working_with_blockers") {
    return "bubble-model.ts draws a wait only when appearance is blocked. detailLine and spendStateAt do the same.";
  }
  if (stateId.startsWith("state.timeline_")) {
    return "TimelineView moment.kind is the internal scrub cursor. No input sets it.";
  }
  if (stateId === "state.spend_unknown") {
    return "spendStateAt returns unknown only for a scrubbed time before statusSince.";
  }
  if (stateId.startsWith("state.past_") && viewId !== "view.timeline") {
    return "Only TimelineView reads capabilities.history.";
  }
  if (stateId.startsWith("state.cost_") && viewId !== "view.spend") {
    return "AgentList.test.tsx says the list never prints cost. Rain and timeline do not read cost. Swarm burn is the flame ladder, a different predicate.";
  }
  if (stateId.startsWith("state.burn_") && viewId !== "view.swarm") {
    return "USD flames are bubble-model.ts burnFlames on a working body. Token per-minute is field.tokens, not this ladder. Spend prints its own series rate.";
  }
  if (stateId.startsWith("state.effort_") && viewId !== "view.swarm") {
    return "Only bubble-model.ts effortLines paints effort, italic when intent is configured.";
  }
  if (stateId === "state.context_hot" && viewId !== "view.swarm") {
    return "Hot is the swarm ring at floor(percent) >= 80. Rain changes tail length with percent and has no hot threshold.";
  }
  if (stateId === "state.terminal_empty" || stateId === "state.terminal_opening") {
    return "empty and opening are swarm body words. List and timeline call an idle terminal quiet.";
  }
  if (hole) return hole.reason;
  return NO_VIEW.evidence;
}

export function assertMatrix(cells) {
  const problems = [];
  const seen = new Set();
  for (const cell of cells) {
    const key = `${cell.stateId}\0${cell.viewId}`;
    if (seen.has(key)) problems.push(`duplicate ${key}`);
    seen.add(key);
    if (!["rendered", "not-applicable", "environment-gap"].includes(cell.disposition)) {
      problems.push(`bad disposition ${key}`);
    }
    if (!cell.evidence || cell.evidence.length < 12) problems.push(`evidence ${key}`);
    if (cell.disposition === "rendered" && !cell.fixtureId) problems.push(`fixture ${key}`);
    if (cell.disposition === "not-applicable" && cell.fixtureId) problems.push(`na has fixture ${key}`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return cells;
}
