/**
 * GV1 ruling: a view reader is not this adapter's uiReachable.
 * Rewrites the 370 row envelopes and their flowcharts. Pin 748d015.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHA = '748d015a7e393112e0a91dad80111fdf5abe6583';
const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const map = JSON.parse(readFileSync(process.env.DOWNSTREAM_MAP, 'utf8'));
const joinPath = join(ROOT, 'audit/godview/plan/gv-audit3-join.json');
const filled = JSON.parse(readFileSync(joinPath, 'utf8'));
const fields = new Map(map.fields.map((field) => [field.fieldId, field]));
const P = new Set(['claude', 'codex']);
const NOUSD = new Set(['acp', 'antigravity', 'copilot']);

const STATUS_EFFECT = {
  acp: 'AcpPromptService publishes turn:started, turn:completed, and turn:failed. That is not yet row status.',
  antigravity: 'USER_INPUT, PLANNER_RESPONSE, and ERROR_MESSAGE become synthesized turn events. Confidence is derived.',
  claude: 'childStatusBatch upserts delegating activity for each task. This is not yet row status.',
  codex: 'A child turn/started upserts responding activity. This monitor status upsert is not the root turn.',
  copilot: 'user.message starts a turn keyed by interactionId. assistant.turn_end completes it when that internal turn is terminal.',
};

const src = (path, lineStart, lineEnd, symbol) => ({
  repo: 'puppeteer',
  sha: SHA,
  path,
  lineStart,
  lineEnd,
  symbol,
});

const HOPS = {
  consume: src('packages/runtime/src/services/monitor-service.ts', 176, 187, 'MonitorService.consume'),
  price: src('packages/runtime/src/services/monitor-service.ts', 418, 425, 'accept prices before reduce'),
  priceRules: src('packages/runtime/src/services/usage-pricing.ts', 19, 78, 'priceUsageUpdates'),
  reduceUsage: src('packages/core/src/monitor/reduce.ts', 1049, 1073, 'usage:tokens-used'),
  reduceTurn: src('packages/core/src/monitor/reduce.ts', 864, 912, 'turn activity and failure'),
  reduceTool: src('packages/core/src/monitor/reduce.ts', 957, 973, 'tool activity'),
  reduceWait: src('packages/core/src/monitor/reduce.ts', 974, 1025, 'permission and question blockers'),
  reduceContext: src('packages/core/src/monitor/reduce.ts', 1075, 1104, 'context upsert or retract'),
  reduceModel: src('packages/core/src/monitor/reduce.ts', 1120, 1125, 'model and effort upsert'),
  reduceEnv: src('packages/core/src/monitor/reduce.ts', 1117, 1119, 'environment upsert'),
  reduceReply: src('packages/core/src/monitor/reduce.ts', 913, 938, 'assistant message and responding'),
  transitions: src('packages/core/src/monitor/transitions.ts', 361, 371, 'status from child, blocker, activity'),
  project: src('packages/core/src/monitor/project.ts', 347, 351, 'projectAgentMonitorState usage query'),
  deriveStatus: src('packages/monitor/src/backend/derive.ts', 68, 72, 'agentStatus defaults'),
  deriveWait: src('packages/monitor/src/backend/derive.ts', 136, 161, 'agentWait'),
  replicaPass: src('packages/monitor/src/replica/replica.ts', 315, 321, 'agent status passes through'),
  timeline: src('packages/views/src/views/timeline/timeline-lanes.ts', 94, 97, 'laneStatus'),
  deriveRow: src('packages/monitor/src/backend/derive.ts', 240, 286, 'deriveAgentRow'),
  deriveTokens: src('packages/monitor/src/backend/derive.ts', 198, 207, 'agentTokens'),
  deriveBranch: src('packages/monitor/src/backend/derive.ts', 101, 106, 'projectBranch'),
  deriveReply: src('packages/monitor/src/backend/derive.ts', 188, 195, 'agentReply'),
  costOf: src('packages/monitor/src/backend/backend.ts', 197, 205, 'costOf'),
  totalContribution: src('packages/core/src/monitor/usage-index.ts', 110, 124, 'totalContribution'),
  canonicalSum: src('packages/core/src/monitor/usage-index.ts', 345, 366, 'canonical cumulativeTokens'),
  publishUsage: src('packages/core/src/monitor/usage-index.ts', 545, 550, 'queryUsageIndex usage'),
  list: src('packages/views/src/views/list/AgentList.tsx', 144, 199, 'AgentList status context branch'),
  swarm: src('packages/views/src/views/swarm/bubble-model.ts', 268, 330, 'bubble status context cost'),
  flames: src('packages/views/src/views/swarm/bubble-model.ts', 469, 477, 'working body priced or unpriced'),
  spend: src('packages/views/src/views/spend/spend-series.ts', 35, 107, 'SpendView cost series'),
};

const PRODUCER = {
  acp: {
    status: src('packages/adapter-acp/src/services/prompt.ts', 50, 84, 'AcpPromptService turn events'),
    wait: src('packages/adapter-acp/src/services/approvals.ts', 135, 156, 'AcpApprovalService.handle'),
    model: src('packages/adapter-acp/src/normalization/monitor.ts', 62, 78, 'configUpdates model'),
    effort: src('packages/adapter-acp/src/normalization/monitor.ts', 80, 98, 'thought_level effort'),
    context: src('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'usage_update context only'),
    cost: src('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'usage_update does not emit usage'),
    tokens: src('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'no usage:tokens-used'),
    branch: src('packages/adapter-acp/src/driver.ts', 242, 244, 'cwd only, no git'),
    reply: src('packages/adapter-acp/src/normalization/conversation.ts', 12, 26, 'assistant message chunks'),
  },
  antigravity: {
    status: src('packages/adapter-antigravity/src/normalization/pipeline.ts', 49, 97, 'USER_INPUT PLANNER_RESPONSE ERROR_MESSAGE'),
    wait: src('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 107, 'transcript normalizer builds no interaction event'),
    model: src('packages/adapter-antigravity/src/driver.ts', 166, 170, 'launch model:updated'),
    effort: src('packages/adapter-antigravity/src/driver.ts', 171, 175, 'launch effort:updated'),
    context: src('packages/adapter-antigravity/src/normalization/pipeline.ts', 86, 88, 'CHECKPOINT is not context'),
    cost: src('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 107, 'no usage or costUsd'),
    tokens: src('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 107, 'no usage:tokens-used'),
    branch: src('packages/adapter-antigravity/src/driver.ts', 162, 165, 'cwd only, no git'),
    reply: src('packages/adapter-antigravity/src/normalization/conversation.ts', 1, 3, 'planner assistant message'),
  },
  claude: {
    status: src('packages/adapter-claude/src/normalization/monitor.ts', 328, 367, 'child status activity'),
    wait: src('packages/adapter-claude/src/normalization/interaction.ts', 62, 83, 'permission and question events'),
    model: src('packages/adapter-claude/src/normalization/monitor.ts', 239, 252, 'root status model replace'),
    effort: src('packages/adapter-claude/src/normalization/monitor.ts', 254, 267, 'root status effort replace'),
    context: src('packages/adapter-claude/src/normalization/monitor.ts', 269, 289, 'root context replace'),
    cost: src('packages/adapter-claude/src/observation/otel/usage.ts', 37, 69, 'costUsd on usage:tokens-used'),
    tokens: src('packages/adapter-claude/src/observation/otel/usage.ts', 28, 79, 'totalTokens and meterTokens'),
    branch: src('packages/adapter-claude/src/normalization/environment.ts', 5, 12, 'cwd only, no git'),
    reply: src('packages/adapter-claude/src/normalization/conversation.ts', 1, 9, 'assistant message displayOnly'),
  },
  codex: {
    status: src('packages/adapter-codex/src/normalization/monitor.ts', 643, 670, 'child turn activity'),
    wait: src('packages/adapter-codex/src/services/approvals.ts', 198, 293, 'CodexApprovalService'),
    model: src('packages/adapter-codex/src/normalization/monitor.ts', 292, 331, 'thread model upsert'),
    effort: src('packages/adapter-codex/src/normalization/monitor.ts', 333, 343, 'thread effort upsert'),
    context: src('packages/adapter-codex/src/normalization/monitor.ts', 530, 538, 'root context from last tokens'),
    cost: src('packages/adapter-codex/src/normalization/monitor.ts', 503, 527, 'usage upsert writes pricing, never costUsd'),
    tokens: src('packages/adapter-codex/src/normalization/monitor.ts', 503, 527, 'cumulativeTokens usage upsert'),
    branch: src('packages/adapter-codex/src/normalization/environment.ts', 10, 21, 'cwd only, no git'),
    reply: src('packages/adapter-codex/src/normalization/conversation.ts', 12, 42, 'agentMessage delta and final'),
  },
  copilot: {
    status: src('packages/adapter-copilot/src/normalization/pipeline.ts', 100, 165, 'interactionId turn correlation'),
    wait: src('packages/adapter-copilot/src/normalization/interaction.ts', 4, 43, 'permission requested and completed'),
    model: src('packages/adapter-copilot/src/normalization/model.ts', 4, 14, 'normalizeCopilotModel'),
    effort: src('packages/adapter-copilot/src/normalization/effort.ts', 4, 8, 'normalizeCopilotEffort'),
    context: src('packages/adapter-copilot/src/normalization/compaction.ts', 4, 25, 'compaction context percentage'),
    cost: src('packages/adapter-copilot/src/normalization/compaction.ts', 4, 25, 'token counts are context, not cost'),
    tokens: src('packages/adapter-copilot/src/normalization/compaction.ts', 4, 25, 'no usage:tokens-used'),
    branch: src('packages/adapter-copilot/src/normalization/environment.ts', 4, 18, 'git.branch string or null'),
    reply: src('packages/adapter-copilot/src/normalization/conversation.ts', 4, 19, 'assistant message final'),
  },
};

const ALT = {
  'field.id': src('packages/monitor/src/backend/derive.ts', 251, 253, 'row id from host'),
  'field.kind': src('packages/monitor/src/backend/derive.ts', 254, 254, 'kind agent'),
  'field.createdAt': src('packages/monitor/src/backend/derive.ts', 256, 256, 'host.createdAt'),
  'field.provider': src('packages/monitor/src/backend/derive.ts', 270, 270, 'host.provider'),
  'field.provider.id': src('packages/monitor/src/backend/derive.ts', 270, 270, 'host.provider.id'),
  'field.provider.label': src('packages/monitor/src/backend/derive.ts', 270, 270, 'host.provider.label'),
  'field.profileSet': src('packages/monitor/src/backend/derive.ts', 62, 65, 'resolveProfileSet'),
  'field.attachable': src('packages/monitor/src/backend/derive.ts', 251, 251, 'terminalSessionId'),
  'field.writable': src('packages/monitor/src/backend/derive.ts', 283, 285, 'writable equals attachable'),
  'field.project.branch': src('packages/monitor/src/backend/derive.ts', 101, 106, 'host fallback or workspace branch'),
  'field.active': src('packages/monitor/src/replica/replica.ts', 337, 372, 'join active'),
  'field.receded': src('packages/monitor/src/replica/replica.ts', 259, 268, 'recededOf'),
  'field.colour': src('packages/monitor/src/replica/replica.ts', 245, 257, 'colourOf'),
  'field.attachment': src('packages/monitor/src/replica/replica.ts', 281, 288, 'attachmentOf'),
  'field.attachment.panes': src('packages/monitor/src/replica/replica.ts', 281, 288, 'attachmentOf'),
  'field.attachment.colour': src('packages/monitor/src/replica/replica.ts', 281, 288, 'attachmentOf'),
  'field.spawnHint': src('packages/monitor/src/replica/replica.ts', 290, 295, 'spawnHintOf'),
  'field.spawnHint.x': src('packages/monitor/src/replica/replica.ts', 290, 295, 'spawnHintOf'),
  'field.spawnHint.y': src('packages/monitor/src/replica/replica.ts', 290, 295, 'spawnHintOf'),
  'field.visualId': src('packages/monitor/src/replica/replica.ts', 346, 372, 'join visualId'),
  'field.alive': src('packages/monitor/src/backend/derive.ts', 78, 81, 'agentAlive'),
  'field.observed': src('packages/monitor/src/backend/derive.ts', 183, 186, 'agentObserved'),
  'field.pending': src('packages/monitor/src/backend/derive.ts', 262, 262, 'host.pending'),
  'field.account': src('packages/monitor/src/backend/derive.ts', 273, 273, 'host.account copy'),
  'field.creationId': src('packages/monitor/src/backend/derive.ts', 255, 255, 'host.creationId copy'),
  'field.tier': src('packages/monitor/src/backend/derive.ts', 281, 281, 'host.tier copy'),
  'field.project.seq': src('packages/monitor/src/backend/backend.ts', 401, 403, 'project identity deal'),
  'field.stale': src('packages/monitor/src/backend/derive.ts', 215, 224, 'isStale'),
  'field.unread': src('packages/monitor/src/backend/derive.ts', 279, 279, 'input.unread'),
  'field.device': src('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.id': src('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.name': src('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.os': src('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.self': src('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
};

function family(fieldId) {
  if (fieldId === 'field.status' || fieldId === 'field.detail' || fieldId === 'field.statusSince' || fieldId.startsWith('field.activity')) return 'status';
  if (fieldId.startsWith('field.wait')) return 'wait';
  if (fieldId === 'field.context' || fieldId === 'field.context.usedPercent') return 'context';
  if (fieldId === 'field.model') return 'model';
  if (fieldId.startsWith('field.effort')) return 'effort';
  if (fieldId.startsWith('field.tokens')) return 'tokens';
  if (fieldId.startsWith('field.cost')) return 'cost';
  if (fieldId === 'field.project.branch') return 'branch';
  if (fieldId === 'field.project' || fieldId === 'field.project.name') return 'project';
  if (fieldId.startsWith('field.reply')) return 'reply';
  return 'other';
}

function provides(adapter, fieldId) {
  const fam = family(fieldId);
  if (fam === 'cost' || fam === 'tokens') return P.has(adapter) ? 'conditional' : 'no';
  if (fam === 'context') return adapter === 'antigravity' ? 'no' : 'conditional';
  if (fam === 'wait') return adapter === 'antigravity' ? 'no' : 'conditional';
  if (fam === 'branch') return adapter === 'copilot' ? 'conditional' : 'no';
  if (fam === 'status' || fam === 'project' || fam === 'model' || fam === 'effort' || fam === 'reply') return 'conditional';
  if (fieldId === 'field.inputUsed') return 'no';
  if (ALT[fieldId]) return 'no';
  return 'unknown';
}

function rendererRead(field) {
  if ((field?.rendererConsumers ?? []).length) return 'direct';
  if ((field?.indirectConsumers ?? []).length) return 'indirect';
  return 'none';
}

function missingVisible(adapter, fieldId, valueReachable) {
  if (!fieldId.startsWith('field.cost')) return 'no';
  if (NOUSD.has(adapter)) return 'yes';
  return valueReachable === 'yes' ? 'yes' : 'unknown';
}

function step(order, name, effect, source) {
  return { order, name, effect, source };
}

function stepsFor(adapter, fieldId) {
  const p = PRODUCER[adapter];
  const fam = family(fieldId);
  if (fieldId === 'field.inputUsed') {
    return [step(0, 'omitted-on-agent-row', 'deriveAgentRow does not copy inputUsed. The terminal copier is a different row and is not this adapter value path.', HOPS.deriveRow)];
  }
  if (fieldId === 'field.account') {
    return [step(0, 'host-copy-unproven-fill', 'derive copies host.account when the host set it. The Vibefield host fill at 433505fd is unproven, so the rendered value stays unknown.', ALT['field.account'])];
  }
  if (fieldId.startsWith('field.activity')) {
    return [
      step(0, 'normalized-activity', `${adapter} turn, tool, or child activity is stored as a status-family activity claim.`, p.status),
      step(1, 'reduce-activity', 'The reducer upserts or retracts the activity claim. Completion clears it.', HOPS.reduceTurn),
      step(2, 'derive-activity', 'agentActivity copies kind, a bounded line, and since when the timestamp parses. No activity object means the row omits it.', src('packages/monitor/src/backend/derive.ts', 163, 174, 'agentActivity')),
    ];
  }
  if (fieldId === 'field.detail') {
    return [
      step(0, 'normalized-status-signal', `${adapter} activity and blockers feed the headline. Detail is not a separate adapter field.`, p.status),
      step(1, 'headline', 'presentAgentMonitorHeadline words blocked, working, or idle. derive agentDetail overrides that while the host is pending, and uses starting when no runtime state exists.', src('packages/core/src/monitor/presentation.ts', 26, 43, 'presentAgentMonitorHeadline')),
    ];
  }
  if (fieldId === 'field.statusSince') {
    return [
      step(0, 'normalized-status-signal', `${adapter} status changes are projected with statusSince retained by the runtime.`, p.status),
      step(1, 'derive-since', 'agentStatusSince uses the projected statusSince, else host.createdAt.', src('packages/monitor/src/backend/derive.ts', 74, 76, 'agentStatusSince')),
    ];
  }
  if (fam === 'status') {
    return [
      step(0, 'normalized-status-signal', STATUS_EFFECT[adapter], p.status),
      step(1, 'reduce-activity', 'turn:started upserts activity kind other; completion retracts it; tool events upsert or retract tool activity.', HOPS.reduceTurn),
      step(2, 'project-status', 'transitions.ts chooses working if a child is runnable, blocked if blockers remain, working if activity remains, otherwise idle.', HOPS.transitions),
      step(3, 'derive-status-default', 'host.pending forces idle. A missing runtime state becomes working. Otherwise the projected status is kept.', HOPS.deriveStatus),
      step(4, 'replica-passthrough', 'For an agent row the replica copies status. It recomputes status only for a terminal whose window activity is joined.', HOPS.replicaPass),
      step(5, 'readers', 'List reads status at AgentList.tsx:144-199. Rain reads agent.status at RainView.tsx:217. Swarm uses status at bubble-model.ts:298-345. Spend reads it at spend-words.ts:145. Timeline laneStatus is timeline-lanes.ts:94-97. This path has no catalog pricing step.', HOPS.list),
    ];
  }
  if (fam === 'wait') {
    if (adapter === 'antigravity') {
      return [step(0, 'no-interaction', 'The transcript normalizer emits no permission or question event. The trace stops here. No blocker is invented.', p.wait)];
    }
    return [
      step(0, 'normalized-interaction', 'Permission or question events are published from the adapter handler.', p.wait),
      step(1, 'reduce-blocker', 'A pending interaction becomes a blocker. Resolution removes it. Outcome text is not a row wait by itself.', HOPS.reduceWait),
      step(2, 'derive-wait', 'agentWait copies the first blocker kind, since, and optional tool, question, or detail.', HOPS.deriveWait),
    ];
  }
  if (fam === 'model' || fam === 'effort') {
    return [
      step(0, 'normalized-card', `${fam} is emitted as an event or monitor upsert. Antigravity does this only from launch options.`, fam === 'model' ? p.model : p.effort),
      step(1, 'reduce-card', 'model:updated and effort:updated upsert or retract. Null retracts. Configured and observed stay distinct.', HOPS.reduceModel),
      step(2, 'derive-card', 'derive copies model displayName or id, and effort value plus intent when present.', HOPS.deriveRow),
    ];
  }
  if (fam === 'context') {
    if (adapter === 'antigravity') {
      return [step(0, 'no-context', 'CHECKPOINT is retained native and is not a context-window event. No occupancy sample is emitted.', p.context)];
    }
    return [
      step(0, 'normalized-context', 'The adapter writes used and capacity tokens, and a percentage only when it actually has one.', p.context),
      step(1, 'reduce-percent', 'A positive capacity stores context. A missing provider percentage becomes a clamped ratio. Invalidation retracts that claim.', HOPS.reduceContext),
      step(2, 'derive-percent', 'A finite usedPercent is copied. Otherwise field.context is omitted.', HOPS.deriveRow),
    ];
  }
  if (fam === 'tokens') {
    if (!P.has(adapter)) {
      return [step(0, 'no-usage', 'This adapter does not emit usage:tokens-used or a usage-family sample. The trace stops. field.tokens is omitted.', p.tokens)];
    }
    if (adapter === 'claude') {
      return [
        step(0, 'request-total', 'With at least one token bucket, totalTokens is the sum and meterTokens is fresh input plus output. Cost-only events omit the token total.', p.tokens),
        step(1, 'price-does-not-replace-tokens', 'priceUsageUpdates may add costUsd and does not replace totalTokens. It runs before reduce.', HOPS.price),
        step(2, 'reduce-copy', 'The reducer copies totalTokens onto the usage observation.', HOPS.reduceUsage),
        step(3, 'sum-canonical', 'totalContribution prefers totalTokens. Canonical contributions fold into cumulativeTokens, including a real zero.', HOPS.canonicalSum),
        step(4, 'row-total', 'derive agentTokens copies cumulativeTokens to tokens.total. No builtin view reads it.', HOPS.deriveTokens),
      ];
    }
    return [
      step(0, 'cumulative-sample', 'Live non-duplicate samples carry cumulativeTokens. Bootstrap samples are not usage upserts.', p.tokens),
      step(1, 'reduce-copy', 'The reducer copies cumulativeTokens. Pricing may add costUsd and does not erase the counter.', HOPS.reduceUsage),
      step(2, 'row-tokens', 'derive maps cumulativeTokens to tokens.total and burnRatePerMin to tokens.perMinute when the index produces a rate.', HOPS.deriveTokens),
    ];
  }
  if (fam === 'cost') {
    if (NOUSD.has(adapter)) {
      return [
        step(0, 'handler-omits-usage', 'The executing handler does not emit usage or costUsd. Capability text is not this step. The trace stops.', p.cost),
        step(1, 'omission-consequence', 'With no priced sample, costOf returns undefined and the row omits field.cost. A working observed body can still show the unpriced flame.', HOPS.costOf),
      ];
    }
    if (adapter === 'claude') {
      return [
        step(0, 'provider-costUsd', 'Valid nonnegative cost_usd, including zero, is copied. Missing cost leaves costUsd unset.', p.cost),
        step(1, 'price-before-reduce', 'Reported costUsd wins. Otherwise complete Anthropic buckets can be catalog-priced. This runs before reduce.', HOPS.price),
        step(2, 'reduce-after-price', 'The reducer copies the already priced costUsd. It does not consult the catalog.', HOPS.reduceUsage),
        step(3, 'row-cost', 'A priced total becomes field.cost complete or partial. No priced total omits the object: cost_missing, not a present unavailable coverage.', HOPS.costOf),
      ];
    }
    return [
        step(0, 'pricing-deltas-not-usd', 'The usage upsert carries cumulativeTokens and a pricing object from codexUsagePricing. It never writes costUsd.', p.cost),
      step(1, 'price-before-reduce', 'priceUsageUpdates catalog-prices a complete same-model delta and rejects gaps. This runs before reduce.', HOPS.priceRules),
      step(2, 'reduce-after-price', 'The reducer stores the priced costUsd or the unpriced metadata. It does not price.', HOPS.reduceUsage),
      step(3, 'row-cost', 'Zero baseline then a priced delta can be complete. A gap plus a later price can be partial. No priced total omits field.cost.', HOPS.costOf),
    ];
  }
  if (fam === 'branch') {
    if (adapter === 'copilot') {
      return [
        step(0, 'observed-git', 'context_changed with a git root sets branch to a string or null, and detached when a head exists without a branch.', p.branch),
        step(1, 'reduce-env', 'environment:updated upserts cwd and git. Partial merge keeps an omitted git when cwd alone changes.', HOPS.reduceEnv),
        step(2, 'derive-branch', 'A nonempty observed branch wins, else host fallback, else observed null, else workspace branch.', HOPS.deriveBranch),
      ];
    }
    return [
      step(0, 'no-git', 'This adapter publishes cwd and does not publish git. The trace of the adapter signal stops here.', p.branch),
      step(1, 'host-branch', 'derive can still show host.fallbackBranch or workspace.branch. That is not this adapter emitting git.', HOPS.deriveBranch),
    ];
  }
  if (fam === 'project') {
    return [
      step(0, 'cwd', 'The adapter publishes a cwd string.', PRODUCER[adapter].branch),
      step(1, 'derive-name', 'projectName uses the observed directory, else a host workspace path, else the provider label.', HOPS.deriveRow),
    ];
  }
  if (fam === 'reply') {
    return [
      step(0, 'assistant-text', 'An assistant message event carries text and a final flag.', p.reply),
      step(1, 'reduce-message', 'Nonblank text replaces the actor reply. final false also marks responding.', HOPS.reduceReply),
      step(2, 'derive-reply', 'Blank text is omitted. Otherwise text, optional at, and final are copied.', HOPS.deriveReply),
    ];
  }
  const alt = ALT[fieldId];
  if (alt) {
    return [step(0, 'not-an-adapter-signal', 'This row property is not an adapter emission. The cited host or replica function supplies it.', alt)];
  }
  return [step(0, 'unproven', 'No adapter handler and no alternate producer was closed for this field.', HOPS.deriveRow)];
}

function mermaid(adapter, fieldId, list) {
  const lines = [
    `%% field: ${fieldId}`,
    `%% adapter: ${adapter}`,
    '%% forensic: source-read 748d015a7e393112e0a91dad80111fdf5abe6583; not a live sample',
    'flowchart TD',
  ];
  list.forEach((item, index) => {
    const label = `${item.name}\\n${item.source.path}:${item.source.lineStart}-${item.source.lineEnd}\\n${item.effect.replaceAll('"', "'")}`;
    lines.push(`  n${index}["${label}"]`);
    if (index) lines.push(`  n${index - 1} --> n${index}`);
  });
  const fam = family(fieldId);
  if (fieldId === 'field.status') {
    const siblings = {
      acp: ['toolIn["tool.ts:38-75 tool started, completed, or failed"]'],
      claude: [
        'turnIn["turn.ts:5-18 hook turn started, completed, or failed"]',
        'toolIn["tool.ts:46-52 hook tool requested"]',
      ],
      codex: ['rootTurn["turn.ts:22-36 root turn:started on userMessage"]'],
    };
    for (const node of siblings[adapter] ?? []) lines.push(`  ${node} --> n1`);
    lines.push('  n2 --> child["runnable child: working"]');
    lines.push('  n2 --> blocked["blockers and no child: blocked"]');
    lines.push('  n2 --> active["activity remains: working"]');
    lines.push('  n2 --> idle["otherwise: idle"]');
    lines.push('  n3 --> pending["host.pending: idle"]');
    lines.push('  n3 --> starting["no runtime state: working"]');
    lines.push('  n4 --> agentCopy["agent row: copy status"]');
    lines.push('  n4 --> terminal["terminal with window activity: recompute"]');
  }
  if (fam === 'cost' && P.has(adapter)) {
    lines.push('  n3 --> complete["pricedCount > 0 and unpricedCount = 0: costCoverage complete. USD total may be 0"]');
    lines.push('  n3 --> partial["pricedCount > 0 and unpricedCount > 0: costCoverage partial"]');
    lines.push('  n3 --> missing["pricedCount = 0: omit field.cost, state.cost_missing"]');
    lines.push('  complete --> flames["working observed body: flame tiers are conditional"]');
    lines.push('  partial --> flames');
    lines.push('  missing --> unpriced["working observed body: burn_unpriced"]');
  }
  if (fam === 'cost' && NOUSD.has(adapter)) {
    lines.push('  n1 --> visible["missing state can be visible while the USD value is not"]');
  }
  if (fam === 'context' && adapter !== 'antigravity') {
    lines.push('  n1 --> copied["provider percent present: copy it"]');
    lines.push('  n1 --> derived["percent absent and capacity positive: clamped ratio"]');
    lines.push('  n1 --> retracted["invalidation: retract the claim"]');
  }
  if (fam === 'tokens' && adapter === 'claude') {
    lines.push('  n0 --> withBuckets["at least one bucket: totalTokens"]');
    lines.push('  n0 --> costOnly["cost only: omit the token total"]');
    lines.push('  n4 --> noReader["row can hold tokens.total; no builtin direct reader"]');
  }
  if (fam === 'branch' && adapter !== 'copilot') {
    lines.push('  n1 --> fallback["host.fallbackBranch"]');
    lines.push('  n1 --> looked["observed git present: its branch or null"]');
    lines.push('  n1 --> workspace["nothing looked: workspace.branch"]');
  }
  return `${lines.join('\n')}\n`;
}

let checked = { status: 0, wait: 0, model: 0, effort: 0, context: 0, tokens: 0, cost: 0, branch: 0, reply: 0 };
for (const row of filled.rowJoins) {
  // field.account and field.profileSet are host-scoped in apply-host-scopes.mjs.
  if (row.fieldId === 'field.account' || row.fieldId === 'field.profileSet') continue;
  const adapter = row.adapterId.slice('adapter.'.length);
  const field = fields.get(row.fieldId);
  const fam = family(row.fieldId);
  const value = provides(adapter, row.fieldId);
  const read = rendererRead(field);
  const alternate = value === 'no' ? ALT[row.fieldId] ?? (fam === 'branch' ? ALT['field.project.branch'] : null) : null;
  let ui = 'unknown';
  if (value === 'conditional') ui = read === 'direct' ? 'yes' : 'no';
  else if (value === 'no' && alternate && read === 'direct') ui = 'yes';
  else if (value === 'no') ui = 'no';
  const visible = missingVisible(adapter, row.fieldId, ui);
  const list = stepsFor(adapter, row.fieldId);
  const file = join(ROOT, 'audit/godview/evidence', adapter, `${row.fieldId.slice('field.'.length)}.json`);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.classification = {
    modelSupported: 'yes',
    adapterEmittable: value === 'conditional' ? 'yes' : value === 'no' ? 'no' : 'unknown',
    uiReachable: ui,
  };
  record.transforms = list;
  record.sources = [];
  for (const item of list) {
    if (!record.sources.some((source) => source.path === item.source.path && source.lineStart === item.source.lineStart)) {
      record.sources.push(item.source);
    }
  }
  if (fam === 'cost' && P.has(adapter)) {
    record.merge = { strategy: 'fold', defaults: [] };
    record.transport = { channel: 'in-process', name: 'AgentMonitorService.accept', contract: 'priceUsageUpdates then reduceMonitorAccumulator' };
    row.notApplicableReason = null;
  } else if (fam === 'cost' && NOUSD.has(adapter)) {
    record.merge = { strategy: 'none', defaults: [] };
    record.transport = {
      channel: 'in-process',
      name: 'not-applicable',
      contract: 'No usage event is emitted. priceUsageUpdates is not on this path.',
    };
    row.notApplicableReason = record.transport.contract;
  } else if (fam === 'status') {
    record.merge = {
      strategy: 'defaulted',
      defaults: [
        { when: 'host.pending is set', presence: 'present', literal: 'idle', source: HOPS.deriveStatus },
        { when: 'runtime state is absent and the host run is not pending', presence: 'present', literal: 'working', source: HOPS.deriveStatus },
      ],
    };
    record.transport = { channel: 'in-process', name: 'AgentMonitorService.consume', contract: 'turn, tool, or monitor activity to deriveAgentRow' };
    row.notApplicableReason = null;
  } else if (value === 'no' && !alternate) {
    record.merge = { strategy: 'none', defaults: [] };
    record.transport = { channel: 'in-process', name: 'not-applicable', contract: list[0].effect };
    row.notApplicableReason = list[0].effect;
  } else if (alternate) {
    record.merge = { strategy: 'defaulted', defaults: [] };
    record.transport = { channel: 'in-process', name: alternate.symbol, contract: 'host or replica supplies the row property' };
    row.notApplicableReason = null;
  } else if (value === 'unknown') {
    record.merge = { strategy: 'unknown', defaults: [] };
    record.transport = { channel: 'unknown', name: 'unproven', contract: 'No handler or alternate producer was closed.' };
    row.notApplicableReason = null;
  } else {
    record.merge = { strategy: fam === 'project' || fam === 'branch' ? 'defaulted' : 'replace', defaults: [] };
    record.transport = { channel: 'in-process', name: 'AgentMonitorService.consume', contract: 'normalized event or monitor batch' };
    row.notApplicableReason = null;
  }
  record.producer = {
    kind: value === 'no' && alternate ? 'core-reducer' : value === 'unknown' ? 'unknown' : 'adapter',
    name: alternate ? alternate.symbol : PRODUCER[adapter][fam]?.symbol ?? fam,
    ingestedFrom: alternate ? `alternate producer ${alternate.path}:${alternate.lineStart}` : (PRODUCER[adapter][fam]?.symbol ?? 'unproven'),
  };
  const direct = [...new Set((fields.get(row.fieldId)?.rendererConsumers ?? []).map((item) => item.view))];
  record.renderer = {
    viewIds: direct,
    component: read === 'direct' ? 'direct reader' : read === 'indirect' ? 'indirect only' : 'no reader',
    symbol: read,
  };
  record.applicability.views = direct.length ? direct : 'all-monitor-views';
  const reachable = (row.stateReachability ?? []).filter((item) => item.applicable).map((item) => item.stateId);
  const negated = (row.stateReachability ?? []).filter((item) => !item.applicable).map((item) => item.stateId);
  record.applicability.states = reachable.length ? reachable : 'model-axes';
  const text = [
    `rendererRead=${rendererRead(fields.get(row.fieldId))}. adapterPathProvidesValue=${value}. missingStateVisible=${visible}.`,
    `uiReachable=${ui} is this adapter's value path, not the existence of a global reader.`,
    alternate ? `Alternate producer: ${alternate.symbol} at ${alternate.path}:${alternate.lineStart}-${alternate.lineEnd}.` : '',
    value === 'conditional' ? 'The value is conditional and was not observed in a live session.' : '',
    value === 'no' && !alternate ? 'The adapter path does not provide the value. The trace stops at the omission.' : '',
    row.fieldId === 'field.account' ? 'uiReachable stays unknown: derive can copy host.account, and the Vibefield host fill at pin 433505fd is unproven.' : '',
    visible === 'yes' ? 'A missing-state presentation can be visible while field-value uiReachable is no.' : '',
    reachable.length ? `Applicable states: ${reachable.join(', ')}.` : 'No source-permitted field-domain state is claimed.',
    negated.length ? `Excluded from applicability: ${negated.join(', ')}.` : '',
    `Shared map 07e71c9bcb9532fc181e3f667f2d0ed2e7c9afaf is attribution for the common continuation, not a substitute for these handler citations.`,
  ].filter(Boolean).join(' ');
  record.verification.notes = text;
  record.applicability.notes = text;
  record.observation.synthetic = false;
  record.observation.presence = value === 'no' && !alternate ? 'absent' : 'unknown';
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(file.replace(/\.json$/u, '.mmd'), mermaid(adapter, row.fieldId, list));
  row.rendererRead = rendererRead(fields.get(row.fieldId));
  row.adapterPathProvidesValue = value;
  row.missingStateVisible = visible;
  row.alternateProducer = alternate ? `${alternate.path}:${alternate.lineStart}-${alternate.lineEnd}` : null;
  row.classification = record.classification;
  if (record.transport.name === 'not-applicable') {
    row.continuation = [{ stage: 'omission', note: record.transport.contract }];
    row.downstreamMapping = 'terminated-at-omission';
  }
  if (checked[fam] !== undefined) checked[fam] += 1;
}

writeFileSync(join(ROOT, 'audit/godview/plan/graphs/status.mmd'), mermaid('claude', 'field.status', stepsFor('claude', 'field.status')));
writeFileSync(join(ROOT, 'audit/godview/plan/graphs/cost-priced.mmd'), mermaid('claude', 'field.cost.usd', stepsFor('claude', 'field.cost.usd')));
writeFileSync(join(ROOT, 'audit/godview/plan/graphs/cost-missing.mmd'), mermaid('acp', 'field.cost.usd', stepsFor('acp', 'field.cost.usd')));
writeFileSync(joinPath, `${JSON.stringify(filled, null, 2)}\n`);
console.log(JSON.stringify({ rows: filled.rowJoins.length, families: checked }));
