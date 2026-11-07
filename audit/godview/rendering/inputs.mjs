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
    rows: extra.rows ?? null,
    spawn: extra.spawn ?? null,
    history: extra.history ?? null,
    interact: extra.interact ?? null,
    requiresBodyPaint: extra.requiresBodyPaint === true,
    adapterIds: extra.adapterIds,
    predicate: extra.predicate,
    envelope: {
      fixtureId: `fix.${id}`,
      origin: "synthetic",
      syntheticLabel: SYNTHETIC,
      pins: PINS,
      viewId,
      lifecycleStates: [stateId],
      adapterIds: extra.adapterIds ?? ADAPTERS,
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
        extra.label ?? "",
        extra.requiresBodyPaint
          ? "Body paint is the swarm WebGPU canvas."
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
    {
      predicate: "blocked and a wait kind outside permission/question/failure. The list prints the kind as itself.",
      label:
        "Synthetic defensive fixture. Typed core blocker producers emit permission, question, or failure, not an open kind. The list still prints an unknown kind as itself.",
    },
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
    rows: [
      agent({ id: "shown", status: "working", project: { name: "shown", seq: 1 } }),
      agent({ id: "back", status: "idle", receded: true, project: { name: "back", seq: 2 } }),
    ],
    predicate: "One row receded beside one shown row, so the list uses the 0.22 weight rather than the all-receded weight.",
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
    {
      predicate: "project.branch null. List treats it as falsy and prints no branch small.",
      label:
        "Synthetic defensive fixture. The Vibefield overlay reaches unknown or named branches, not a null branch. The list's small label uses truthiness, so null and absent draw the same.",
    },
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
    {
      predicate: "cost.coverage complete. Spend meters the total.",
      adapterIds: ["adapter.claude", "adapter.codex"],
      label:
        "Source permits Claude and Codex to reach a priced total after runtime pricing. Not a live session. Token-only adapters do not produce this row. USD burn is not the token per-minute meter.",
    },
  ),
  paint(
    "spend.cost-partial",
    "view.spend",
    "state.cost_partial",
    agent({ status: "working", cost: cost("partial", 1.25, 6) }),
    {
      predicate: "cost.coverage partial. Spend marks the total partial.",
      adapterIds: ["adapter.claude", "adapter.codex"],
      label:
        "Source permits Claude and Codex to mix priced and unpriced observations. Not a live session. Not a normal emission of the token-only adapters.",
    },
  ),
  paint(
    "spend.cost-unavailable",
    "view.spend",
    "state.cost_unavailable",
    agent({ status: "working", cost: { usd: 1, coverage: "unavailable" } }),
    {
      predicate: "cost.coverage unavailable. Spend names the agent apart and does not meter it.",
      label:
        "Synthetic view of an explicit unavailable cost object. The normal backend omits field.cost instead, which is state.cost_missing. Not a normal adapter emission.",
    },
  ),
  paint("spend.cost-missing", "view.spend", "state.cost_missing", agent({ status: "working" }), {
    predicate: "cost absent. Spend names the agent apart.",
    label:
      "Normal row when no priced total exists, including token-only adapters. Claude and Codex can also be missing before a price lands. Not state.cost_unavailable.",
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
  paint("spend.idle", "view.spend", "state.idle", agent({ status: "idle" }), {
    predicate: "Spend state word idle. Terminals are omitted; this is an agent with no price.",
  }),
  paint("spend.working", "view.spend", "state.working", agent({ status: "working" }), {
    predicate: "Spend state word working.",
  }),
  paint("spend.blocked", "view.spend", "state.blocked", agent({ status: "blocked" }), {
    predicate: "Spend state word blocked, with no wait object.",
  }),
  paint(
    "spend.blocked-permission",
    "view.spend",
    "state.blocked_permission",
    agent({ status: "blocked", wait: { kind: "permission", since: EPOCH, tool: "Bash" } }),
    { predicate: "Spend blocked glyph and the permission word." },
  ),
  paint(
    "spend.blocked-question",
    "view.spend",
    "state.blocked_question",
    agent({ status: "blocked", wait: { kind: "question", since: EPOCH, header: "Which branch?" } }),
    { predicate: "Spend blocked glyph. spend-words names a question." },
  ),
  paint(
    "spend.blocked-failure",
    "view.spend",
    "state.blocked_failure",
    agent({ status: "blocked", wait: { kind: "failure", since: EPOCH, code: "E_RATE_LIMIT" } }),
    { predicate: "Spend blocked glyph. spend-words names a failure." },
  ),
  paint("spend.unread", "view.spend", "state.unread", agent({ status: "idle", unread: true }), {
    predicate: "Idle and unread. Spend calls the state unseen.",
  }),
  paint(
    "spend.remote",
    "view.spend",
    "state.remote",
    agent({
      status: "working",
      device: { id: "studio", name: "Studio", os: "mac", self: false },
      cost: { usd: 1.5, coverage: "complete" },
    }),
    {
      predicate: "Peer mark beside the name. A peer's series is not drawn; the total still is.",
      adapterIds: ["adapter.claude", "adapter.codex"],
      label: "The priced total is supporting data so the row is metered. The branch under test is device.self false.",
    },
  ),
  paint(
    "spend.branch-named",
    "view.spend",
    "state.branch_named",
    agent({ status: "idle", project: { name: "billing-api", seq: 1, branch: "main" } }),
    { predicate: "No task line, so the model line keeps the branch." },
  ),
  paint(
    "spend.attached",
    "view.spend",
    "state.attached",
    agent({ status: "working", attachment: { panes: 1, colour: "#4c8dff" } }),
    { predicate: "Attachment is named in the row's accessible label." },
  ),
  paint("timeline.idle", "view.timeline", "state.idle", agent({ status: "idle" }), {
    predicate: "Timeline lane for an idle agent.",
  }),
  paint("timeline.working", "view.timeline", "state.working", agent({ status: "working" }), {
    predicate: "Timeline lane painted as working.",
  }),
  paint("timeline.blocked", "view.timeline", "state.blocked", agent({ status: "blocked" }), {
    predicate: "Timeline lane painted blocked.",
  }),
  paint(
    "timeline.blocked-permission",
    "view.timeline",
    "state.blocked_permission",
    agent({ status: "blocked", wait: { kind: "permission", since: EPOCH, tool: "Bash" } }),
    { predicate: "Blocked lane whose wait words name the permission." },
  ),
  paint(
    "timeline.blocked-question",
    "view.timeline",
    "state.blocked_question",
    agent({ status: "blocked", wait: { kind: "question", since: EPOCH, question: "Keep the lane open?" } }),
    { predicate: "Blocked lane whose wait words name the question." },
  ),
  paint(
    "timeline.blocked-failure",
    "view.timeline",
    "state.blocked_failure",
    agent({ status: "blocked", wait: { kind: "failure", since: EPOCH, code: "E_RATE_LIMIT" } }),
    { predicate: "Blocked lane whose wait words name the failure." },
  ),
  paint(
    "timeline.remote",
    "view.timeline",
    "state.remote",
    agent({ status: "working", device: { id: "studio", name: "Studio", os: "mac", self: false } }),
    { predicate: "Peer mark on the timeline name." },
  ),
  paint("timeline.receded", "view.timeline", "state.receded", agent({ status: "working", receded: true }), {
    rows: [
      agent({ id: "shown", status: "working", project: { name: "shown", seq: 1 } }),
      agent({ id: "back", status: "working", receded: true, project: { name: "back", seq: 2 } }),
    ],
    predicate: "Timeline name and head take is-receded beside a shown lane.",
  }),
  paint("timeline.active", "view.timeline", "state.active", agent({ status: "working", active: true }), {
    predicate: "Timeline name takes is-active.",
  }),
  paint(
    "timeline.attached",
    "view.timeline",
    "state.attached",
    agent({ status: "working", attachment: { panes: 1, colour: "#4c8dff" } }),
    { predicate: "Timeline name shows the pane mark." },
  ),
  paint(
    "timeline.terminal-running",
    "view.timeline",
    "state.terminal_running",
    { kind: "terminal", status: "working", project: { name: "" }, detail: "running" },
    { predicate: "Terminal lane, running." },
  ),
  paint(
    "timeline.terminal-quiet",
    "view.timeline",
    "state.terminal_quiet",
    { kind: "terminal", status: "idle", project: { name: "" }, detail: "quiet" },
    { predicate: "Terminal lane, quiet." },
  ),
  paint(
    "timeline.branch-named",
    "view.timeline",
    "state.branch_named",
    agent({ status: "working", model: "fixture-model", project: { name: "billing-api", seq: 1, branch: "main" } }),
    { predicate: "Name line joins the model and the branch." },
  ),
  paint(
    "rain.remote",
    "view.rain",
    "state.remote",
    { kind: "terminal", status: "working", project: { name: "notes" }, detail: "running", device: { id: "studio", name: "Studio", os: "mac", self: false } },
    { predicate: "A remote terminal's column leads with the desktop name." },
  ),
  paint("rain.receded", "view.rain", "state.receded", agent({ status: "working", receded: true }), {
    rows: [
      agent({ id: "shown", status: "working", project: { name: "shown", seq: 1 } }),
      agent({ id: "back", status: "working", receded: true, project: { name: "back", seq: 2 } }),
    ],
    predicate: "Receded column beside a shown column, at the 0.22 weight.",
  }),
  paint("rain.active", "view.rain", "state.active", agent({ status: "working", active: true }), {
    predicate: "Active column uses the active head colour.",
  }),
  paint(
    "rain.attached",
    "view.rain",
    "state.attached",
    agent({ status: "working", attachment: { panes: 2, colour: "#4c8dff" } }),
    { predicate: "Attachment paints the column tint and a mirror." },
  ),
  paint(
    "rain.terminal-running",
    "view.rain",
    "state.terminal_running",
    { kind: "terminal", status: "working", project: { name: "shell" }, detail: "running" },
    { predicate: "Local terminal column spells terminal, working head on." },
  ),
  paint(
    "rain.terminal-quiet",
    "view.rain",
    "state.terminal_quiet",
    { kind: "terminal", status: "idle", project: { name: "shell" }, detail: "quiet" },
    { predicate: "Local terminal column, idle, head hidden." },
  ),
  paint("rain.context-missing", "view.rain", "state.context_missing", agent({ status: "working" }), {
    predicate: "No context percent. rainTailLength uses the mid-scale default instead of a measured share.",
  }),
  paint(
    "rain.branch-named",
    "view.rain",
    "state.branch_named",
    agent({ status: "working", project: { name: "billing-api", seq: 1, branch: "main" } }),
    { predicate: "The falling glyphs include the branch." },
  ),
  paint("list.unread", "view.list", "state.unread", agent({
    status: "idle",
    unread: true,
    reply: { text: "Tests pass.", at: EPOCH, final: true },
  }), {
    predicate:
      "Idle agent with unread true and a reply. AgentList has no unread class. detailLine prints the reply text. The input is mounted; unread is not inferred from a row whose default unread is false.",
  }),
  paint("list.context-hot", "view.list", "state.context_hot", agent({
    status: "working",
    context: { usedPercent: 80 },
  }), {
    predicate: "context.usedPercent 80. The list percent cell prints 80. Hot is not a list threshold.",
  }),
  paint("list.reply-streaming", "view.list", "state.reply_streaming", agent({
    status: "idle",
    reply: { text: "Suite is green.", at: EPOCH, final: false },
  }), {
    predicate: "reply.final false. detailLine prints the text and does not branch on final.",
  }),
  paint("list.reply-final", "view.list", "state.reply_final", agent({
    status: "idle",
    reply: { text: "Suite is green.", at: EPOCH, final: true },
  }), {
    predicate: "reply.final true. detailLine prints the text and does not branch on final.",
  }),
  paint("list.working-with-blockers", "view.list", "state.working_with_blockers", agent({
    status: "working",
    wait: { kind: "permission", since: EPOCH, tool: "Bash" },
  }), {
    predicate: "status working with a wait object. detailLine uses the wait only when status is blocked, so the line is the status word.",
  }),
  paint("list.wait-multiple", "view.list", "state.wait_multiple", agent({
    status: "blocked",
    wait: { kind: "question", since: EPOCH, count: 3, header: "Which branch?" },
  }), {
    predicate: "wait.count is 3. The list wait line prints the kind and does not print the count.",
  }),
  paint("rain.unread", "view.rain", "state.unread", agent({
    status: "idle",
    unread: true,
    reply: { text: "Tests pass.", at: EPOCH, final: true },
  }), {
    predicate: "Idle column with unread true. statusPresentation keys status only. The tooltip's detailLine prints the reply.",
  }),
  paint("rain.blocked-permission", "view.rain", "state.blocked_permission", agent({
    status: "blocked",
    wait: { kind: "permission", since: EPOCH, tool: "Bash", detail: "pnpm test" },
  }), {
    predicate: "Blocked column. The aria label and tooltip use detailLine, which prints permission · Bash. The head speed is the blocked speed.",
  }),
  paint("rain.blocked-question", "view.rain", "state.blocked_question", agent({
    status: "blocked",
    wait: { kind: "question", since: EPOCH, header: "Which branch?", question: "Keep the lane open?" },
  }), {
    predicate: "Blocked column. detailLine prints the question kind. The head speed is the blocked speed.",
  }),
  paint("rain.blocked-failure", "view.rain", "state.blocked_failure", agent({
    status: "blocked",
    wait: { kind: "failure", since: EPOCH, code: "E_RATE_LIMIT", detail: "Rate limited" },
  }), {
    predicate: "Blocked column. detailLine prints the failure kind. The head speed is the blocked speed.",
  }),
  paint("rain.blocked-unknown-kind", "view.rain", "state.blocked_unknown_kind", agent({
    status: "blocked",
    wait: { kind: "quota", since: EPOCH },
  }), {
    predicate: "Blocked column whose wait.kind is quota. detailLine prints quota. The head speed is the blocked speed.",
    label:
      "Synthetic defensive fixture. Typed core blocker producers emit permission, question, or failure. Rain's detail line still prints another kind.",
  }),
  paint("rain.stale", "view.rain", "state.stale", agent({ status: "idle", stale: true }), {
    predicate: "stale true on an idle column. RainView does not read stale. The mounted input is stale, not the fresh default.",
  }),
  paint("rain.starting-unobserved", "view.rain", "state.starting_unobserved", agent({
    status: "working",
    observed: false,
    pending: false,
  }), {
    predicate: "Working column, not observed. detailLine says starting. The head is the working head.",
  }),
  paint("rain.pending-unobserved", "view.rain", "state.pending_unobserved", agent({
    status: "idle",
    observed: false,
    pending: true,
  }), {
    predicate: "Idle column, pending. detailLine says unobserved · resumes when idle. The idle head stays hidden.",
  }),
  paint("rain.branch-none", "view.rain", "state.branch_none", agent({
    status: "working",
    project: { name: "billing-api", seq: 1, branch: null },
  }), {
    predicate: "project.branch null. rainDataString drops a falsy branch.",
    label:
      "Synthetic defensive fixture. The Vibefield overlay reaches unknown or named branches, not a null branch. The glyph string uses truthiness, so null and absent drop alike.",
  }),
  paint("rain.context-hot", "view.rain", "state.context_hot", agent({
    status: "working",
    context: { usedPercent: 80 },
  }), {
    predicate: "usedPercent 80. rainTailLength grows with the percent. Rain has no hot threshold.",
  }),
  paint("spend.active", "view.spend", "state.active", agent({ status: "working", active: true }), {
    predicate: "active true. SpendView adds is-active on the row.",
  }),
  paint("spend.stale", "view.spend", "state.stale", agent({ status: "idle", stale: true }), {
    predicate: "stale true. SpendView does not read stale. The mounted row is stale rather than the fixture default.",
  }),
  paint("spend.blocked-unknown-kind", "view.spend", "state.blocked_unknown_kind", agent({
    status: "blocked",
    wait: { kind: "quota", since: EPOCH },
  }), {
    predicate: "Wait kind quota. spend glyphOf maps any other kind to the permission glyph.",
    label:
      "Synthetic defensive fixture. Typed core blocker producers emit permission, question, or failure. Spend still maps another kind onto the permission glyph.",
  }),
  paint("spend.starting-unobserved", "view.spend", "state.starting_unobserved", agent({
    status: "working",
    observed: false,
    pending: false,
  }), {
    predicate: "Not observed. detailLine says starting, and taskOf keeps that line.",
  }),
  paint("spend.pending-unobserved", "view.spend", "state.pending_unobserved", agent({
    status: "idle",
    observed: false,
    pending: true,
  }), {
    predicate: "Pending. detailLine says unobserved · resumes when idle.",
  }),
  paint("spend.branch-none", "view.spend", "state.branch_none", agent({
    status: "idle",
    project: { name: "billing-api", seq: 1, branch: null },
  }), {
    predicate: "project.branch null. modelOf drops a falsy branch.",
    label:
      "Synthetic defensive fixture. The Vibefield overlay reaches unknown or named branches, not a null branch.",
  }),
  paint("spend.receded", "view.spend", "state.receded", agent({ status: "idle", receded: true }), {
    rows: [
      agent({ id: "shown", status: "working", project: { name: "shown", seq: 1 } }),
      agent({ id: "back", status: "idle", receded: true, project: { name: "back", seq: 2 } }),
    ],
    predicate: "One receded agent beside a shown agent. SpendView does not read receded; both rows are still named.",
  }),
  paint("spend.context-hot", "view.spend", "state.context_hot", agent({
    status: "working",
    context: { usedPercent: 80 },
  }), {
    predicate: "usedPercent 80. SpendView does not read context. The row is the working row with that input mounted.",
  }),
  paint("timeline.stale", "view.timeline", "state.stale", agent({ status: "idle", stale: true }), {
    predicate: "stale true. TimelineView does not add an is-stale class. The mounted lane is the stale row.",
  }),
  paint("timeline.starting-unobserved", "view.timeline", "state.starting_unobserved", agent({
    status: "working",
    observed: false,
    pending: false,
  }), {
    predicate: "Not observed. laneStatus follows status, so the lane is working. detail words are not the list's starting line.",
  }),
  paint("timeline.pending-unobserved", "view.timeline", "state.pending_unobserved", agent({
    status: "idle",
    observed: false,
    pending: true,
  }), {
    predicate: "Pending and idle. laneStatus is idle. The pending line is not a timeline status.",
  }),
  paint("timeline.branch-none", "view.timeline", "state.branch_none", agent({
    status: "working",
    model: "fixture-model",
    project: { name: "billing-api", seq: 1, branch: null },
  }), {
    predicate: "project.branch null. laneSubLine drops a falsy branch and keeps the model.",
    label:
      "Synthetic defensive fixture. The Vibefield overlay reaches unknown or named branches, not a null branch.",
  }),
  paint("timeline.blocked-unknown-kind", "view.timeline", "state.blocked_unknown_kind", agent({
    status: "blocked",
    wait: { kind: "quota", since: EPOCH },
  }), {
    predicate: "Blocked lane whose wait.kind is quota. laneFor copies that kind. It is not limited to permission, question, and failure.",
    label:
      "Synthetic defensive fixture. Typed core blocker producers emit permission, question, or failure. The lane still carries another kind.",
  }),
  paint("timeline.context-hot", "view.timeline", "state.context_hot", agent({
    status: "working",
    context: { usedPercent: 80 },
  }), {
    predicate: "usedPercent 80. The timeline lane does not read context. The working lane is that input.",
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
  ...mountGaps(),
];

function mountGaps() {
  const out = [];
  const put = (view, slug, stateId, row, extra = {}) => {
    out.push(paint(`${view}.${slug}`, `view.${view}`, stateId, row, extra));
  };
  const dom = ["list", "rain", "spend", "timeline"];
  const except = (views, slug, stateId, row, extra) => {
    for (const view of views) put(view, slug, stateId, row, extra);
  };
  const hour = 3_600_000;
  const reply = (final) => ({ text: "Suite is green.", at: EPOCH, final });
  const wait = { kind: "permission", since: EPOCH, tool: "Bash", detail: "pnpm test" };
  const many = { kind: "question", since: EPOCH, count: 3, header: "Which branch?" };

  except(["rain", "spend", "timeline"], "working-with-blockers", "state.working_with_blockers", agent({
    status: "working",
    wait,
  }), {
    predicate:
      "status working and a permission wait. detailLine and spendStateAt use the wait only when status is blocked, so this row takes the working branch. The wait is on the mounted input.",
  });
  except(["rain", "spend", "timeline"], "wait-multiple", "state.wait_multiple", agent({
    status: "blocked",
    wait: many,
  }), {
    predicate:
      "wait.count is 3. The mounted line prints the kind. No view paints the count. The count is on the input.",
  });
  for (const kind of ["starting", "responding", "reasoning", "tool", "delegating", "compacting", "other"]) {
    except(dom, `activity-${kind}`, `state.activity_${kind}`, agent({
      status: "working",
      activity: { kind, line: kind, since: EPOCH },
    }), {
      predicate: `activity.kind ${kind} on a working row. List, rain, spend, and timeline do not paint a per-kind branch. AgentSwarm.tsx:1031 reads kind only to keep a terminal clock across unknown. The kind is mounted here.`,
    });
  }
  except(dom, "failed-retained", "state.failed_retained", agent({
    status: "blocked",
    alive: false,
    wait: { kind: "failure", since: EPOCH, code: "E_RATE_LIMIT", detail: "Rate limited" },
  }), {
    predicate:
      "alive false with a failure wait. The five views do not read alive. The mounted row takes the blocked failure branch. Retention itself is the host's keepsFailure and is not a view paint.",
  });
  except(["list", "rain", "timeline", "spend"], "terminal-empty", "state.terminal_empty", {
    kind: "terminal",
    status: "idle",
    project: { name: "" },
    detail: "",
  }, {
    predicate:
      "Idle terminal with an empty detail. List and timeline word an idle terminal quiet. spendMeters skips terminals, so the spend mount shows no terminal row. Rain spells the local terminal column.",
  });
  except(["spend"], "terminal-running", "state.terminal_running", {
    kind: "terminal",
    status: "working",
    project: { name: "" },
    detail: "running",
  }, {
    predicate: "Working terminal passed to SpendView. spendMeters skips kind terminal, so the row is not in the meter.",
  });
  except(["spend"], "terminal-quiet", "state.terminal_quiet", {
    kind: "terminal",
    status: "idle",
    project: { name: "" },
    detail: "quiet",
  }, {
    predicate: "Idle terminal passed to SpendView. spendMeters skips kind terminal, so the row is not in the meter.",
  });
  const priced = {
    predicate:
      "cost.coverage complete on this view. Spend meters it. List, rain, and timeline mount the object and do not print USD. Claude and Codex only. Not a live session.",
    adapterIds: ["adapter.claude", "adapter.codex"],
    label: "Source permits Claude and Codex to price. Not a live session. Token-only adapters do not produce this row.",
  };
  const partial = {
    predicate:
      "cost.coverage partial on this view. Spend marks the total partial. List, rain, and timeline mount the object and do not print USD.",
    adapterIds: ["adapter.claude", "adapter.codex"],
    label: "Source permits Claude and Codex to mix priced and unpriced observations. Not a live session.",
  };
  except(["list", "rain", "timeline"], "cost-complete", "state.cost_complete", agent({
    status: "working",
    cost: cost("complete", 2.5, 12),
  }), priced);
  except(["list", "rain", "timeline"], "cost-partial", "state.cost_partial", agent({
    status: "working",
    cost: cost("partial", 1.25, 6),
  }), partial);
  except(["list", "rain", "timeline"], "cost-unavailable", "state.cost_unavailable", agent({
    status: "working",
    cost: { usd: 1, coverage: "unavailable" },
  }), {
    predicate:
      "Explicit unavailable cost mounted on this view. The normal backend omits field.cost. List, rain, and timeline do not print the coverage.",
    label: "Synthetic view of an explicit unavailable cost object. Not a normal adapter emission.",
  });
  except(["list", "rain", "timeline"], "cost-missing", "state.cost_missing", agent({ status: "working" }), {
    predicate: "cost absent. This is the normal missing total, including token-only adapters. The mounted row has no cost object.",
  });
  except(dom, "effort-configured", "state.effort_configured", agent({
    status: "working",
    model: "fixture-model",
    effort: { value: "high", intent: "configured" },
  }), {
    predicate:
      "effort.intent configured. bubble-model.ts effortLines is the italic swarm line. List, rain, spend, and timeline mount the object and do not paint effort.",
  });
  except(dom, "effort-observed", "state.effort_observed", agent({
    status: "working",
    model: "fixture-model",
    effort: { value: "high", intent: "observed" },
  }), {
    predicate:
      "effort.intent observed. The swarm model line is not italic. List, rain, spend, and timeline mount the object and do not paint effort.",
  });
  except(dom, "effort-absent", "state.effort_absent", agent({ status: "working", model: "fixture-model" }), {
    predicate: "effort absent. The mounted row has no effort object. These views do not paint an effort suffix.",
  });
  except(["rain", "spend", "timeline"], "reply-streaming", "state.reply_streaming", agent({
    status: "idle",
    reply: reply(false),
  }), {
    predicate: "reply.final false. detailLine prints the text and does not branch on final. The final flag is mounted.",
  });
  except(["rain", "spend", "timeline"], "reply-final", "state.reply_final", agent({
    status: "idle",
    reply: reply(true),
  }), {
    predicate: "reply.final true. detailLine prints the text and does not branch on final. The final flag is mounted.",
  });
  for (const [lit, perMinute] of [[0, 0], [1, 0.05], [2, 0.15], [3, 0.4], [4, 1]]) {
    except(dom, `burn-flames-${lit}`, `state.burn_flames_${lit}`, agent({
      status: "working",
      cost: cost("complete", 2, perMinute * 60),
    }), {
      predicate: `burnPerHour ${perMinute * 60}, the swarm rung burnFlames === ${lit}. List, rain, and timeline mount that cost and have no flame ladder. Spend may print its own rate. The rung input is mounted.`,
      adapterIds: ["adapter.claude", "adapter.codex"],
      label: "The flame rung is the swarm ladder. This mount is the same priced cost on a view without that ladder. Not a live session.",
    });
  }
  except(dom, "burn-unpriced", "state.burn_unpriced", agent({
    status: "working",
    cost: { usd: 1, coverage: "unavailable" },
  }), {
    predicate:
      "coverage unavailable, the swarm unpriced ladder. These views mount that cost object. Spend does not meter it. Not a normal adapter emission.",
    label: "Synthetic unavailable cost, the input of the unpriced swarm rung, mounted on a view without the flame ladder.",
  });
  for (const tier of ["managed", "ingested", "remote"]) {
    except(dom, `tier-${tier}`, `state.tier_${tier}`, agent({ status: "working", tier }), {
      predicate: `tier ${tier} on the AgentView. None of the five views paint tier. The field is mounted; the row takes the working branch.`,
    });
  }
  for (const kind of ["worked", "quiet", "unrecorded", "bounds"]) {
    except(["list", "rain", "spend"], `past-${kind}`, `state.past_${kind}`, agent({
      status: kind === "quiet" || kind === "bounds" ? "idle" : "working",
    }), {
      history: kind,
      predicate: `capabilities.history span ${kind} is passed with the row. Only TimelineView reads history. This view paints the live row. The history input is mounted.`,
    });
  }
  except(["list", "rain", "timeline"], "before", "state.spend_before", agent({
    status: "idle",
    createdAt: NOW + hour,
    statusSince: NOW + hour,
  }), {
    predicate:
      "createdAt is after the frozen now. spendStateAt would say before. List, rain, and timeline have no spend cursor; they mount the future-born row.",
  });
  for (const spawnState of ["ready", "asleep", "silent", "incompatible", "reading"]) {
    except(["rain", "spend", "timeline"], `spawn-${spawnState}`, `state.spawn_${spawnState}`, agent({ status: "idle" }), {
      spawn: menu(spawnState),
      predicate: `spawn device state ${spawnState} is on the view capabilities. Rain, spend, and timeline have no spawn menu, so the menu is not opened. The capability is mounted.`,
    });
  }
  put("timeline", "moment-unborn", "state.timeline_unborn", agent({
    id: "late",
    status: "idle",
    createdAt: NOW - 10 * 60_000,
    statusSince: NOW - 10 * 60_000,
    project: { name: "late", seq: 2 },
  }), {
    rows: [
      agent({
        id: "early",
        status: "working",
        createdAt: NOW - 6 * hour,
        statusSince: NOW - 6 * hour,
        project: { name: "early", seq: 1 },
      }),
      agent({
        id: "late",
        status: "idle",
        createdAt: NOW - 10 * 60_000,
        statusSince: NOW - 10 * 60_000,
        project: { name: "late", seq: 2 },
      }),
    ],
    interact: "timeline-unborn",
    predicate:
      "Two lanes. The head is scrubbed to about an hour after the early birth, which is before the late birth. readoutAt for unborn says not started yet.",
  });
  put("timeline", "moment-unrecorded", "state.timeline_unrecorded", agent({
    status: "working",
    createdAt: NOW - 6 * hour,
    statusSince: NOW - 30 * 60_000,
  }), {
    interact: "timeline-unrecorded",
    predicate:
      "No history. The head is scrubbed to after birth and before statusSince. stateAt returns unrecorded. readoutAt says not recorded.",
  });
  put("timeline", "moment-past", "state.timeline_past", agent({
    status: "working",
    createdAt: NOW - 6 * hour,
    statusSince: NOW,
  }), {
    history: "worked",
    interact: "timeline-past",
    predicate:
      "A worked span from one hour ago until a minute ago. The head is scrubbed into that span, before statusSince. stateAt returns past.",
  });
  put("spend", "unknown", "state.spend_unknown", agent({
    status: "working",
    createdAt: NOW - 10 * 60_000,
    statusSince: NOW,
  }), {
    interact: "spend-unknown",
    predicate:
      "statusSince is the frozen now and birth is ten minutes earlier. A chart click before now sets spendStateAt to unknown.",
  });
  return out;
}

const BASE_HOLES = [
  {
    stateId: "state.dead_hidden",
    reason:
      "The row is omitted before the view. The views have no dead-hidden paint. Membership is VibeField useMonitorAgents, not a 748d015 view branch.",
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
    stateId: "state.timeline_ended",
    reason:
      "No fixture is keyed state.timeline_ended. The live head of fix.timeline.past-bounds is that moment for the ended lane. See the matrix covered-by cell.",
  },
  {
    stateId: "state.timeline_span",
    reason:
      "No fixture is keyed state.timeline_span. The live head of fix.timeline.working is that moment. See the matrix covered-by cell.",
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
const DOM_STATES = new Set(ENTRIES.map((entry) => entry.stateId));
export const HOLES = [
  ...BASE_HOLES,
  ...ALL_ENTRIES.filter((entry) => entry.requiresBodyPaint && !DOM_STATES.has(entry.stateId)).map((entry) => ({
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

/** The row the harness mounts: agentViewFixture defaults, then the fixture partial. */
export function mountRow(entry) {
  const partial = (entry.rows ?? [entry.row])[0];
  const project = { name: "project", seq: 0, ...(partial.project ?? {}) };
  return {
    stale: false,
    unread: false,
    observed: true,
    alive: true,
    active: false,
    receded: false,
    attachable: true,
    kind: "agent",
    ...partial,
    project,
  };
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
