// Render inputs for the pinned Puppeteer views. Fixture JSON under
// audit/godview/fixtures/ is only the foundation envelope (fixture.schema.json
// allows no AgentView slot). This module is the input those envelopes name.

export const PINS = {
  vibefield: "433505fd0f224f4cda540d642661b13848c0ef82",
  puppeteer: "748d015a7e393112e0a91dad80111fdf5abe6583",
};

export const MODEL_COMMIT = "49fc12da0fadc34e25c227fa2f03dcce2e09dbaa";
export const PACKAGE_CONTEXT_COMMIT = "d53a0fa24ca7341fe5858329c9399eac6baf6b53";
export const FOUNDATION_COMMIT = "b9397f8dc93d5f784bb69f01f8b0778a14f02882";
export const SHIPPED_TAG_COMMIT = "52d09c8e84951b9a355a6700eac2dfc1290a9fa0";

export const ADAPTERS = [
  "adapter.acp",
  "adapter.antigravity",
  "adapter.claude",
  "adapter.codex",
  "adapter.copilot",
  "adapter.grok",
  "adapter.hermes",
  "adapter.kimi",
  "adapter.opencode",
  "adapter.pi",
];

export const EPOCH = Date.UTC(2026, 0, 1);
export const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

const SYNTHETIC =
  "Synthetic AgentView input for a view predicate. Not a captured adapter session.";

const COMPONENTS = {
  "view.list": {
    path: "packages/views/src/views/list/AgentList.tsx",
    symbol: "AgentList",
    lineStart: 37,
  },
  "view.rain": {
    path: "packages/views/src/views/rain/RainView.tsx",
    symbol: "RainView",
    lineStart: 64,
  },
  "view.swarm": {
    path: "packages/views/src/views/swarm/AgentSwarm.tsx",
    symbol: "AgentSwarm",
    lineStart: 250,
  },
  "view.spend": {
    path: "packages/views/src/views/spend/SpendView.tsx",
    symbol: "SpendView",
    lineStart: 255,
  },
  "view.timeline": {
    path: "packages/views/src/views/timeline/TimelineView.tsx",
    symbol: "TimelineView",
    lineStart: 263,
  },
};

const PROVIDER = { id: "fixture", label: "Fixture" };

const series = {
  stepMs: 30_000,
  steps: [0.4, 0.5, 0.6, 1],
  lastStepAt: NOW - 10_000,
};

function paint(id, viewId, stateId, row, extra = {}) {
  const component = COMPONENTS[viewId];
  return {
    fixtureId: `fix.${id}`,
    viewId,
    stateId,
    row,
    spawn: extra.spawn ?? null,
    history: extra.history ?? null,
    interact: extra.interact ?? null,
    requiresBodyPaint: extra.requiresBodyPaint === true,
    predicate: extra.predicate,
    envelope: {
      fixtureId: `fix.${id}`,
      origin: "synthetic",
      syntheticLabel: SYNTHETIC,
      pins: PINS,
      viewId,
      lifecycleStates: [stateId],
      adapterIds: ADAPTERS,
      component: {
        repo: "puppeteer",
        sha: PINS.puppeteer,
        path: component.path,
        symbol: component.symbol,
        lineStart: component.lineStart,
      },
      notes: [
        extra.predicate,
        "adapterIds list the ten audit adapters as classification context only.",
        "They are not a claim that any adapter emitted this row.",
        "Mounted from Puppeteer source 748d015 via MonitorViewHost. Not shipped package 0.3.3.",
        extra.requiresBodyPaint
          ? "Body paint is the swarm WebGPU canvas. A host without WebGPU does not show this predicate."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

const agent = (patch) => ({ kind: "agent", provider: PROVIDER, observed: true, ...patch });

const cost = (coverage, usd, burnPerHour) => ({
  usd,
  coverage,
  ...(burnPerHour === undefined ? {} : { burnPerHour }),
  series,
});

function menu(state) {
  return {
    devices: [
      {
        id: "desk",
        label: "Desk",
        self: true,
        state: "ready",
        word: "HERE",
        profiles: [
          { id: "native", label: "Native", kind: "native", isDefault: true },
          { id: "work", label: "Work", kind: "managed" },
        ],
      },
      {
        id: "other",
        label: "Other",
        state,
        word: state.toUpperCase(),
        ...(state === "reading" ? {} : { phrase: `is ${state}` }),
      },
    ],
  };
}

const ALL_ENTRIES = [
  paint("list.idle", "view.list", "state.idle", agent({ status: "idle" }), {
    predicate: "status === idle. List row class is-idle.",
  }),
  paint("list.working", "view.list", "state.working", agent({ status: "working" }), {
    predicate: "status === working. List row class is-working.",
  }),
  paint("list.blocked", "view.list", "state.blocked", agent({ status: "blocked" }), {
    predicate: "status === blocked and no wait object. detailLine says blocked.",
  }),
  paint(
    "list.blocked-permission",
    "view.list",
    "state.blocked_permission",
    agent({
      status: "blocked",
      wait: { kind: "permission", since: EPOCH, tool: "Bash", detail: "pnpm test" },
    }),
    { predicate: "blocked and wait.kind permission. List line is permission · Bash." },
  ),
  paint(
    "list.blocked-question",
    "view.list",
    "state.blocked_question",
    agent({
      status: "blocked",
      wait: { kind: "question", since: EPOCH, header: "Which branch?", question: "Keep the lane open?" },
    }),
    {
      predicate:
        "blocked and wait.kind question. List detailLine prints the kind, not the header. The header is a swarm body line.",
    },
  ),
  paint(
    "list.blocked-failure",
    "view.list",
    "state.blocked_failure",
    agent({
      status: "blocked",
      wait: { kind: "failure", since: EPOCH, code: "E_RATE_LIMIT", detail: "Rate limited" },
    }),
    {
      predicate:
        "blocked and wait.kind failure. List detailLine prints the kind, not the code. The code is a swarm body line.",
    },
  ),
  paint(
    "list.blocked-unknown-kind",
    "view.list",
    "state.blocked_unknown_kind",
    agent({ status: "blocked", wait: { kind: "quota", since: EPOCH } }),
    { predicate: "blocked and a wait kind outside permission/question/failure. The list prints the kind as itself." },
  ),
  paint(
    "list.starting-unobserved",
    "view.list",
    "state.starting_unobserved",
    agent({ status: "working", observed: false, pending: false }),
    { predicate: "agent, not observed, not pending. detailLine says starting." },
  ),
  paint(
    "list.pending-unobserved",
    "view.list",
    "state.pending_unobserved",
    agent({ status: "idle", observed: false, pending: true }),
    { predicate: "pending and not observed. detailLine says unobserved · resumes when idle." },
  ),
  paint("list.stale", "view.list", "state.stale", agent({ status: "idle", stale: true }), {
    predicate: "stale true. List row class is-stale. This is the row flag, not VibeField peer standing.",
  }),
  paint("list.fresh", "view.list", "state.fresh", agent({ status: "idle", stale: false }), {
    predicate: "stale false. List row has no is-stale class.",
  }),
  paint(
    "list.terminal-running",
    "view.list",
    "state.terminal_running",
    { kind: "terminal", status: "working", project: { name: "" }, detail: "running" },
    { predicate: "kind terminal and status working." },
  ),
  paint(
    "list.terminal-quiet",
    "view.list",
    "state.terminal_quiet",
    { kind: "terminal", status: "idle", project: { name: "" }, detail: "quiet" },
    { predicate: "kind terminal and status idle. List says quiet, not the swarm word empty." },
  ),
  paint(
    "list.remote",
    "view.list",
    "state.remote",
    agent({
      status: "working",
      device: { id: "studio", name: "Studio", os: "mac", self: false },
    }),
    { predicate: "device.self false. List row class is-remote and the detail leads with the desktop name." },
  ),
  paint("list.active", "view.list", "state.active", agent({ status: "working", active: true }), {
    predicate: "active true. List row class is-active.",
  }),
  paint("list.receded", "view.list", "state.receded", agent({ status: "idle", receded: true }), {
    predicate: "receded true. List row class is-receded.",
  }),
  paint(
    "list.attached",
    "view.list",
    "state.attached",
    agent({ status: "working", attachment: { panes: 1, colour: "#4c8dff" } }),
    { predicate: "attachment present. List row class is-linked." },
  ),
  paint("list.detached", "view.list", "state.detached", agent({ status: "working" }), {
    predicate: "attachment absent. List row has no is-linked class.",
  }),
  paint("list.context-missing", "view.list", "state.context_missing", agent({ status: "working" }), {
    predicate: "context absent. List percent cell is the missing mark.",
  }),
  paint(
    "list.branch-unknown",
    "view.list",
    "state.branch_unknown",
    agent({ status: "idle", project: { name: "billing-api", seq: 1 } }),
    { predicate: "project.branch absent. List prints no branch small." },
  ),
  paint(
    "list.branch-none",
    "view.list",
    "state.branch_none",
    agent({ status: "idle", project: { name: "billing-api", seq: 1, branch: null } }),
    { predicate: "project.branch null. List treats it as falsy and prints no branch small." },
  ),
  paint(
    "list.branch-named",
    "view.list",
    "state.branch_named",
    agent({ status: "idle", project: { name: "billing-api", seq: 1, branch: "main" } }),
    { predicate: "project.branch is a string. List prints it." },
  ),
  paint("list.reply-missing", "view.list", "state.reply_missing", agent({ status: "idle" }), {
    predicate: "reply absent. A non-blocked observed agent falls back to the status word.",
  }),
  paint("list.model-missing", "view.list", "state.model_missing", agent({ status: "working" }), {
    predicate: "model absent. modelWord falls back to the provider label.",
  }),
  paint("list.spawn-ready", "view.list", "state.spawn_ready", agent({ status: "idle" }), {
    spawn: menu("ready"),
    interact: "open-spawn",
    predicate: "spawn device state ready. The list menu opens on the real + TERMINAL control.",
  }),
  paint("list.spawn-asleep", "view.list", "state.spawn_asleep", agent({ status: "idle" }), {
    spawn: menu("asleep"),
    interact: "open-spawn",
    predicate: "spawn device state asleep.",
  }),
  paint("list.spawn-silent", "view.list", "state.spawn_silent", agent({ status: "idle" }), {
    spawn: menu("silent"),
    interact: "open-spawn",
    predicate: "spawn device state silent.",
  }),
  paint("list.spawn-incompatible", "view.list", "state.spawn_incompatible", agent({ status: "idle" }), {
    spawn: menu("incompatible"),
    interact: "open-spawn",
    predicate: "spawn device state incompatible.",
  }),
  paint("list.spawn-reading", "view.list", "state.spawn_reading", agent({ status: "idle" }), {
    spawn: menu("reading"),
    interact: "open-spawn",
    predicate: "spawn device state reading.",
  }),
  paint("rain.idle", "view.rain", "state.idle", agent({ status: "idle" }), {
    predicate: "RainView at 748d015 hides the column head when status is idle.",
  }),
  paint("rain.working", "view.rain", "state.working", agent({ status: "working" }), {
    predicate: "RainView draws the working head. This file differs from shipped 0.3.3.",
  }),
  paint("rain.blocked", "view.rain", "state.blocked", agent({ status: "blocked" }), {
    predicate: "RainView draws the blocked head at the blocked speed.",
  }),
  paint(
    "spend.cost-complete",
    "view.spend",
    "state.cost_complete",
    agent({ status: "working", cost: cost("complete", 2.5, 12) }),
    { predicate: "cost.coverage complete. Spend meters the total." },
  ),
  paint(
    "spend.cost-partial",
    "view.spend",
    "state.cost_partial",
    agent({ status: "working", cost: cost("partial", 1.25, 6) }),
    { predicate: "cost.coverage partial. Spend marks the total partial." },
  ),
  paint(
    "spend.cost-unavailable",
    "view.spend",
    "state.cost_unavailable",
    agent({ status: "working", cost: { usd: 1, coverage: "unavailable" } }),
    { predicate: "cost.coverage unavailable. Spend names the agent apart and does not meter it." },
  ),
  paint("spend.cost-missing", "view.spend", "state.cost_missing", agent({ status: "working" }), {
    predicate: "cost absent. Spend names the agent apart.",
  }),
  paint(
    "spend.before",
    "view.spend",
    "state.spend_before",
    agent({ status: "idle", createdAt: NOW + 3_600_000, statusSince: NOW + 3_600_000 }),
    { predicate: "createdAt is after the frozen now. spendStateAt at now is before." },
  ),
  paint("timeline.unread", "view.timeline", "state.unread", agent({ status: "idle", unread: true }), {
    predicate: "idle agent with unread. Timeline state word is reply unseen. The list has no unread class.",
  }),
  paint("timeline.past-worked", "view.timeline", "state.past_worked", agent({ status: "working" }), {
    history: "worked",
    predicate: "history span kind worked on the live lane.",
  }),
  paint("timeline.past-quiet", "view.timeline", "state.past_quiet", agent({ status: "idle" }), {
    history: "quiet",
    predicate: "history span kind quiet on the live lane.",
  }),
  paint(
    "timeline.past-unrecorded",
    "view.timeline",
    "state.past_unrecorded",
    agent({ status: "working" }),
    { history: "unrecorded", predicate: "history span kind unrecorded on the live lane." },
  ),
  paint("timeline.past-bounds", "view.timeline", "state.past_bounds", agent({ status: "idle" }), {
    history: "bounds",
    predicate: "ended lane span kind bounds.",
  }),
  paint(
    "swarm.context-hot",
    "view.swarm",
    "state.context_hot",
    agent({ status: "working", context: { usedPercent: 80 } }),
    {
      requiresBodyPaint: true,
      predicate: "swarm context ring is hot at floor(usedPercent) >= 80. bubble-model.ts.",
    },
  ),
  paint(
    "swarm.effort-configured",
    "view.swarm",
    "state.effort_configured",
    agent({ status: "working", model: "fixture-model", effort: { value: "high", intent: "configured" } }),
    { requiresBodyPaint: true, predicate: "effort.intent configured is the italic model line." },
  ),
  paint(
    "swarm.effort-observed",
    "view.swarm",
    "state.effort_observed",
    agent({ status: "working", model: "fixture-model", effort: { value: "high", intent: "observed" } }),
    { requiresBodyPaint: true, predicate: "effort.intent observed is the model line without italic intent." },
  ),
  paint(
    "swarm.effort-absent",
    "view.swarm",
    "state.effort_absent",
    agent({ status: "working", model: "fixture-model" }),
    { requiresBodyPaint: true, predicate: "effort absent. The model line has no effort suffix." },
  ),
  ...[0, 1, 2, 3, 4].map((lit) => {
    const perMinute = [0, 0.05, 0.15, 0.4, 1][lit];
    return paint(
      `swarm.burn-flames-${lit}`,
      "view.swarm",
      `state.burn_flames_${lit}`,
      agent({
        status: "working",
        cost: cost("complete", 2, perMinute * 60),
      }),
      {
        requiresBodyPaint: true,
        predicate: `burnFlames(${perMinute}/min) === ${lit}. burnPerHour is ${perMinute * 60}.`,
      },
    );
  }),
  paint(
    "swarm.burn-unpriced",
    "view.swarm",
    "state.burn_unpriced",
    agent({ status: "working", cost: { usd: 1, coverage: "unavailable" } }),
    { requiresBodyPaint: true, predicate: "coverage unavailable. The burn ladder is drawn unpriced." },
  ),
];

const BASE_HOLES = [
  {
    stateId: "state.wait_multiple",
    reason:
      "No view reads wait.count. The five views' field lists and a search of packages/views/src at 748d015 find no wait.count read.",
  },
  {
    stateId: "state.working_with_blockers",
    reason:
      "bubble-model.ts draws a wait only when appearance is blocked (line 536). detailLine uses the wait only when status is blocked. A working row with a wait paints as working.",
  },
  {
    stateId: "state.activity_starting",
    reason:
      "AgentSwarm.tsx reads activity.kind only to keep a terminal clock across kind unknown. It does not paint a distinct branch per activity kind.",
  },
  {
    stateId: "state.activity_responding",
    reason: "Same as state.activity_starting. No per-kind paint.",
  },
  {
    stateId: "state.activity_reasoning",
    reason: "Same as state.activity_starting. No per-kind paint.",
  },
  {
    stateId: "state.activity_tool",
    reason: "Same as state.activity_starting. No per-kind paint.",
  },
  {
    stateId: "state.activity_delegating",
    reason: "Same as state.activity_starting. No per-kind paint.",
  },
  {
    stateId: "state.activity_compacting",
    reason: "Same as state.activity_starting. No per-kind paint.",
  },
  {
    stateId: "state.activity_other",
    reason: "Same as state.activity_starting. No per-kind paint.",
  },
  {
    stateId: "state.failed_retained",
    reason:
      "alive is not read by the five views. Retention is VibeField keepsFailure in field-app, outside this Puppeteer view render. Passing the row paints as state.blocked_failure.",
  },
  {
    stateId: "state.dead_hidden",
    reason:
      "The row is omitted before the view. The views have no dead-hidden paint. Membership is VibeField useMonitorAgents, not a 748d015 view branch.",
  },
  {
    stateId: "state.terminal_empty",
    reason:
      "empty is a swarm body word for a quiet terminal with no opening, not a list status. List paints that row as state.terminal_quiet. Swarm body paint is the WebGPU canvas.",
  },
  {
    stateId: "state.terminal_opening",
    reason:
      "opening is swarm-local input, not an AgentView field. MonitorViewHost does not accept it.",
  },
  {
    stateId: "state.attachable",
    reason: "None of the five views read attachable. It is not in their contract field lists.",
  },
  {
    stateId: "state.reply_streaming",
    reason:
      "No view reads reply.final. detailLine uses reply.text and does not branch on final, so streaming and final are not separate paint.",
  },
  {
    stateId: "state.reply_final",
    reason: "Same as state.reply_streaming. reply.final is not read.",
  },
  {
    stateId: "state.timeline_unborn",
    reason: "timeline moment.kind is the scrub cursor inside TimelineView. There is no public prop to set it.",
  },
  {
    stateId: "state.timeline_unrecorded",
    reason: "Same as state.timeline_unborn. Cursor moment, not the live head.",
  },
  {
    stateId: "state.timeline_past",
    reason: "Same as state.timeline_unborn. Cursor moment, not the live head.",
  },
  {
    stateId: "state.timeline_ended",
    reason: "Same as state.timeline_unborn. Cursor moment, not the live head.",
  },
  {
    stateId: "state.timeline_span",
    reason: "Same as state.timeline_unborn. Cursor moment, not the live head.",
  },
  {
    stateId: "state.spend_unknown",
    reason:
      "spendStateAt returns unknown only for a scrubbed t before statusSince. The live head at now does not.",
  },
  {
    stateId: "state.feed_no_door",
    reason: "MonitorFeedState is VibeField door chrome, not a Puppeteer view input.",
  },
  {
    stateId: "state.feed_connecting",
    reason: "MonitorFeedState is VibeField door chrome, not a Puppeteer view input.",
  },
  {
    stateId: "state.feed_live",
    reason: "MonitorFeedState is VibeField door chrome, not a Puppeteer view input.",
  },
  {
    stateId: "state.feed_unavailable",
    reason: "MonitorFeedState is VibeField door chrome, not a Puppeteer view input.",
  },
  {
    stateId: "state.tier_managed",
    reason: "None of the five views read tier.",
  },
  {
    stateId: "state.tier_ingested",
    reason: "None of the five views read tier.",
  },
  {
    stateId: "state.tier_remote",
    reason: "None of the five views read tier.",
  },
  {
    stateId: "state.device_live",
    reason:
      "Desktop standing is VibeField window-rows at the consumer pin, which overwrites a peer's stale. It is not a field the 748d015 views read.",
  },
  {
    stateId: "state.device_stale",
    reason: "Same as state.device_live. Standing is not a view field.",
  },
  {
    stateId: "state.device_asleep",
    reason: "Same as state.device_live. Standing is not a view field.",
  },
  {
    stateId: "state.device_incompatible",
    reason: "Same as state.device_live. Standing is not a view field.",
  },
];

export const ENTRIES = ALL_ENTRIES.filter((entry) => !entry.requiresBodyPaint);
export const HOLES = [
  ...BASE_HOLES,
  ...ALL_ENTRIES.filter((entry) => entry.requiresBodyPaint).map((entry) => ({
    stateId: entry.stateId,
    reason: `${entry.predicate} AgentSwarm from Puppeteer 748d015 mounted in this host and reported WEBGPU UNAVAILABLE, so the body was not painted. See audit/godview/rendering/screenshots/environment-swarm.png.`,
  })),
];

export const MODEL_STATE_IDS = [
  "state.idle",
  "state.working",
  "state.blocked",
  "state.blocked_permission",
  "state.blocked_question",
  "state.blocked_failure",
  "state.working_with_blockers",
  "state.wait_multiple",
  "state.activity_starting",
  "state.activity_responding",
  "state.activity_reasoning",
  "state.activity_tool",
  "state.activity_delegating",
  "state.activity_compacting",
  "state.activity_other",
  "state.starting_unobserved",
  "state.pending_unobserved",
  "state.stale",
  "state.fresh",
  "state.unread",
  "state.failed_retained",
  "state.dead_hidden",
  "state.terminal_running",
  "state.terminal_quiet",
  "state.terminal_empty",
  "state.terminal_opening",
  "state.remote",
  "state.active",
  "state.receded",
  "state.attached",
  "state.attachable",
  "state.detached",
  "state.cost_complete",
  "state.cost_partial",
  "state.cost_unavailable",
  "state.cost_missing",
  "state.context_missing",
  "state.context_hot",
  "state.effort_configured",
  "state.effort_observed",
  "state.past_worked",
  "state.past_quiet",
  "state.past_unrecorded",
  "state.past_bounds",
  "state.timeline_unborn",
  "state.timeline_unrecorded",
  "state.timeline_past",
  "state.timeline_ended",
  "state.timeline_span",
  "state.spend_before",
  "state.spend_unknown",
  "state.spawn_ready",
  "state.spawn_asleep",
  "state.spawn_silent",
  "state.spawn_incompatible",
  "state.spawn_reading",
  "state.feed_no_door",
  "state.feed_connecting",
  "state.feed_live",
  "state.feed_unavailable",
  "state.burn_flames_0",
  "state.burn_flames_1",
  "state.burn_flames_2",
  "state.burn_flames_3",
  "state.burn_flames_4",
  "state.burn_unpriced",
  "state.branch_unknown",
  "state.branch_none",
  "state.branch_named",
  "state.reply_streaming",
  "state.reply_final",
  "state.reply_missing",
  "state.tier_managed",
  "state.tier_ingested",
  "state.tier_remote",
  "state.model_missing",
  "state.effort_absent",
  "state.blocked_unknown_kind",
  "state.device_live",
  "state.device_stale",
  "state.device_asleep",
  "state.device_incompatible",
];

export function assertCoverage() {
  const painted = new Set(ENTRIES.map((entry) => entry.stateId));
  const holed = new Set(HOLES.map((hole) => hole.stateId));
  const problems = [];
  for (const id of MODEL_STATE_IDS) {
    const inPaint = painted.has(id);
    const inHole = holed.has(id);
    if (inPaint === inHole) problems.push(`${id} paint=${inPaint} hole=${inHole}`);
  }
  for (const id of painted) if (!MODEL_STATE_IDS.includes(id)) problems.push(`extra paint ${id}`);
  for (const id of holed) if (!MODEL_STATE_IDS.includes(id)) problems.push(`extra hole ${id}`);
  if (MODEL_STATE_IDS.length !== 82) problems.push(`state count ${MODEL_STATE_IDS.length}`);
  if (problems.length) throw new Error(problems.join("\n"));
}

export const CONTRACT_MISMATCHES = [
  {
    contract: "audit/godview/contracts/fixture.schema.json",
    issue:
      "additionalProperties is false and there is no AgentView or input property. Row payloads live in audit/godview/rendering/inputs.mjs, keyed by fixtureId. The fixture JSON is only the envelope.",
  },
  {
    contract: "audit/godview/contracts/ids.md",
    issue:
      "The foundation lists views as list, rain, swarm, spend, timeline. MONITOR_VIEWS at 748d015 is swarm, list, rain, timeline, spend. This harness keys by view id.",
  },
  {
    contract: "audit/godview/contracts/ids.json doNotMint",
    issue:
      "doNotMint lists feed.no-door and siblings. The model state ids are state.feed_no_door and siblings. This slice does not mint the doNotMint ids. Those states are coverage holes because they are not Puppeteer view inputs.",
  },
];
