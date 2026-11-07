/** Adapter-side resolutions at Puppeteer 748d015. Cost rows cite GV2 25c215a. Not a live sample. */

const PRICED = new Set(['claude', 'codex']);
const NO_COST = new Set(['acp', 'antigravity', 'copilot']);
const CONTEXT = new Set(['acp', 'claude', 'codex', 'copilot']);
const GV2 = '25c215a2a53f363e1076210b3f6fce2155dfdc0b';

const READ = {
  status: ['view.list', 'view.rain', 'view.swarm', 'view.spend'],
  context: ['view.list', 'view.rain', 'view.swarm'],
  cost: ['view.swarm', 'view.spend'],
  project: ['view.list', 'view.swarm', 'view.spend'],
  branch: ['view.list', 'view.rain', 'view.swarm'],
  model: ['view.swarm', 'view.spend'],
  effort: ['view.swarm'],
};

function pricedCost(adapter) {
  const how =
    adapter === 'claude'
      ? 'Provider-reported costUsd wins, including zero. Missing cost can still be catalog-priced when pricing buckets and the model key are complete.'
      : 'Codex does not write costUsd. Runtime priceUsageUpdates can catalog-price a complete same-model delta. A zero first counter is not an unpriced sample. A positive baseline or a gap leaves coverage partial once a later delta is priced.';
  return {
    adapterEmittable: 'yes',
    uiReachable: 'yes',
    presence: 'unknown',
    views: READ.cost,
    component: 'bubble-model / SpendView',
    symbol: 'priced working body and spend series',
    graphRef: 'shared.cost.priced',
    verdict: `Source-permitted, conditional, not live-observed. ${how} Normal backend emits field.cost only for complete or partial. state.cost_unavailable is not produced by that mapping. state.cost_missing remains possible before any priced total. Priced flames 0-4 are possible on an observed working body; the tier is not chosen here. Attribution: Vibefield audit/godview-model ${GV2} contracts/cost-burn-trace.md, re-read at Puppeteer 748d015.`,
  };
}

function missingCost(fieldId) {
  return {
    adapterEmittable: 'no',
    uiReachable: fieldId === 'field.cost' ? 'yes' : 'no',
    presence: 'absent',
    views: READ.cost,
    component: 'bubble-model',
    symbol: 'burn_unpriced',
    graphRef: 'shared.cost.missing',
    verdict:
      'Current producers supply no priced total, so the normal backend omits field.cost. The row state is state.cost_missing, and an observed working Swarm body is state.burn_unpriced. This is not state.cost_unavailable, and it is not an impossibility if another producer later supplies costUsd. Not live-observed. Attribution: Vibefield audit/godview-model ' +
      GV2 +
      '.',
  };
}

export function resolveField(adapter, fieldId, meta) {
  const cost = fieldId === 'field.cost' || fieldId.startsWith('field.cost.');
  if (cost && PRICED.has(adapter)) return pricedCost(adapter);
  if (cost && NO_COST.has(adapter)) return missingCost(fieldId);
  if (fieldId === 'field.status' || fieldId === 'field.detail' || fieldId.startsWith('field.activity') || fieldId.startsWith('field.wait') || fieldId === 'field.statusSince') {
    return {
      adapterEmittable: 'yes',
      uiReachable: fieldId.startsWith('field.wait') || fieldId.startsWith('field.activity') ? 'unknown' : 'yes',
      presence: 'unknown',
      views: READ.status,
      component: 'AgentList / RainView / bubble-model',
      symbol: 'agent.status',
      graphRef: 'shared.status',
      verdict:
        'Turn, tool, and permission events reduce through core transitions.ts:370-371 into idle, working, or blocked. derive.ts:68-71 then applies host pending as idle and a missing runtime state as working. Source-permitted. Not a live sample. Which blocker wins is not re-derived here.',
    };
  }
  if (fieldId === 'field.context' || fieldId === 'field.context.usedPercent') {
    if (!CONTEXT.has(adapter)) {
      return {
        adapterEmittable: 'no',
        uiReachable: 'yes',
        presence: 'absent',
        views: READ.context,
        component: 'bubble-model / AgentList / rain-streams',
        symbol: 'usedPercent',
        graphRef: 'shared.context.absent',
        verdict: 'No context occupancy producer in the current antigravity sources. The row omits field.context. Readers exist. Not impossible if a later producer appears. Not live-observed.',
      };
    }
    return {
      adapterEmittable: 'yes',
      uiReachable: 'yes',
      presence: 'unknown',
      views: READ.context,
      component: 'bubble-model / AgentList / rain-streams',
      symbol: 'usedPercent',
      graphRef: 'shared.context.percent',
      verdict:
        'Context tokens reach reduce.ts:1075-1100, which can derive a percentage, then derive.ts:247-274 copies a finite usedPercent. Conditional on a positive capacity. Source-permitted. Not live-observed. The hot-at-80 swarm ring is a renderer rule, not an adapter state.',
    };
  }
  if (fieldId === 'field.model') {
    return {
      adapterEmittable: adapter === 'antigravity' ? 'unknown' : 'yes',
      uiReachable: 'yes',
      presence: 'unknown',
      views: READ.model,
      component: 'bubble-model / spend-words',
      symbol: 'model displayName or id',
      graphRef: 'shared.model',
      verdict:
        adapter === 'antigravity'
          ? 'Launch can emit model:updated intent configured. The transcript does not. derive.ts:244 copies displayName or id when a runtime model exists. Conditional on the launch option. Not live-observed.'
          : 'Model events or monitor model upserts are projected by project.ts and copied by derive.ts:244. Conditional on a model actually being present. Not live-observed. Timeline consumption was not verified.',
    };
  }
  if (fieldId === 'field.effort' || fieldId.startsWith('field.effort.')) {
    return {
      adapterEmittable: 'yes',
      uiReachable: 'yes',
      presence: 'unknown',
      views: READ.effort,
      component: 'bubble-model',
      symbol: 'agent.effort',
      graphRef: 'shared.effort',
      verdict: 'Effort events or monitor effort upserts reach derive.ts:176-180. Conditional. Swarm italics a configured intent. Other views were not verified. Not live-observed.',
    };
  }
  if (fieldId === 'field.tokens' || fieldId === 'field.tokens.total' || fieldId === 'field.tokens.perMinute') {
    if (NO_COST.has(adapter)) {
      return {
        adapterEmittable: 'no',
        uiReachable: 'unknown',
        presence: 'absent',
        views: [],
        component: 'not-established',
        symbol: 'field.tokens',
        graphRef: 'shared.tokens.absent',
        verdict: 'No live usage producer in the current sources, so derive.ts:198-207 omits field.tokens. Not impossible if a later usage sample appears. Not live-observed.',
      };
    }
    return {
      adapterEmittable: fieldId === 'field.tokens.total' && adapter === 'claude' ? 'unknown' : 'yes',
      uiReachable: 'unknown',
      presence: 'unknown',
      views: [],
      component: 'not-established',
      symbol: 'agentTokens',
      graphRef: 'shared.tokens',
      verdict:
        adapter === 'codex'
          ? 'Codex writes cumulativeTokens. derive.ts:198-207 maps that to field.tokens.total and burnRatePerMin to field.tokens.perMinute. The per-minute value is conditional on the usage index. Not live-observed. A shipping reader of field.tokens was not verified in the five views.'
          : 'Claude writes request totalTokens and meterTokens, not cumulativeTokens. field.tokens.perMinute can follow the meter path in the usage index. Whether totalTokens becomes field.tokens.total was not re-derived here, so that id stays unknown. Not live-observed.',
    };
  }
  if (fieldId === 'field.project' || fieldId === 'field.project.name') {
    return {
      adapterEmittable: 'yes',
      uiReachable: 'yes',
      presence: 'unknown',
      views: READ.project,
      component: 'AgentList / bubble-model / SpendView',
      symbol: 'projectName',
      graphRef: 'shared.project',
      verdict: 'Session cwd is copied to environment and derive.ts:91-94 uses its folder name, else a host path, else the provider label. Source-permitted. Not live-observed.',
    };
  }
  if (fieldId === 'field.project.branch') {
    return {
      adapterEmittable: adapter === 'copilot' ? 'yes' : 'unknown',
      uiReachable: 'yes',
      presence: 'unknown',
      views: READ.branch,
      component: 'AgentList / rain-streams / bubble-model',
      symbol: 'project.branch',
      graphRef: 'shared.branch',
      verdict:
        adapter === 'copilot'
          ? 'session.context_changed can set git.branch to a string or null. derive.ts:101-106 returns that branch, including null when git was observed without one. state.branch_none is source-permitted for that case, not a live sample. A named branch is also source-permitted.'
          : 'This adapter does not write git. derive.ts:101-106 can still show a host fallbackBranch or workspace.branch. That is runtime-supplied, not an unreachable branch. state.branch_none is not claimed from this adapter.',
    };
  }
  if (fieldId.startsWith('field.reply')) {
    return {
      adapterEmittable: 'yes',
      uiReachable: 'unknown',
      presence: 'unknown',
      views: ['view.swarm'],
      component: 'bubble-model',
      symbol: 'latestMessage',
      graphRef: 'shared.reply',
      verdict: 'Assistant messages reduce to lastAssistantMessage and derive.ts:188-195 copies non-blank text. Conditional. Swarm reads a message. List and rain were not verified for field.reply. Not live-observed.',
    };
  }
  if (['field.id', 'field.kind', 'field.createdAt', 'field.provider', 'field.provider.id', 'field.provider.label', 'field.profileSet', 'field.attachable', 'field.writable'].includes(fieldId)) {
    return {
      adapterEmittable: 'no',
      uiReachable: 'unknown',
      presence: 'unknown',
      views: [],
      component: 'deriveAgentRow',
      symbol: 'host row identity',
      graphRef: 'shared.host-row',
      verdict: 'derive.ts:251-285 fills these from the host run, not from the adapter event. A row still has them. Adapter omission is not unreachability. Not live-observed.',
    };
  }
  if (fieldId.startsWith('field.device') || fieldId === 'field.active' || fieldId === 'field.colour' || fieldId.startsWith('field.attachment') || fieldId.startsWith('field.spawnHint') || fieldId === 'field.visualId' || fieldId === 'field.receded' || fieldId === 'field.tier' || fieldId === 'field.account' || fieldId === 'field.unread' || fieldId === 'field.pending' || fieldId === 'field.observed' || fieldId === 'field.alive' || fieldId === 'field.stale' || fieldId === 'field.project.seq' || fieldId === 'field.creationId' || fieldId === 'field.inputUsed') {
    return {
      adapterEmittable: 'no',
      uiReachable: fieldId === 'field.active' ? 'yes' : 'unknown',
      presence: 'unknown',
      views: fieldId === 'field.active' ? ['view.list'] : [],
      component: fieldId === 'field.active' ? 'AgentList' : 'host or replica',
      symbol: fieldId === 'field.active' ? 'agent.active' : 'not an adapter field',
      graphRef: 'shared.runtime-supplied',
      verdict: 'Filled by the host, replica, or window fold, not by this adapter. List reads field.active. The other window and device fields were not each re-verified as drawn. Not unreachable, and not live-observed.',
    };
  }
  if (!meta.rowField) {
    return {
      adapterEmittable: 'unknown',
      uiReachable: 'unknown',
      presence: 'unknown',
      views: [],
      component: 'not-established',
      symbol: 'sdk-leaf',
      graphRef: 'shared.sdk-leaf',
      verdict: 'SDK contract leaf, not a row field and not a live or synthetic observation.',
    };
  }
  return {
    adapterEmittable: meta.rawPresent ? 'unknown' : 'no',
    uiReachable: 'unknown',
    presence: 'unknown',
    views: [],
    component: 'not-established',
    symbol: 'unproven',
    graphRef: 'shared.unproven',
    verdict: meta.rawPresent
      ? 'A raw adapter signal exists. The row mapping was not closed here. Not live-observed.'
      : 'No raw adapter signal was found. Downstream can still supply the row. Not live-observed.',
  };
}

const COST_STATES = ['state.cost_complete', 'state.cost_partial', 'state.cost_unavailable', 'state.cost_missing', 'state.burn_unpriced', 'state.burn_flames_0', 'state.burn_flames_1', 'state.burn_flames_2', 'state.burn_flames_3', 'state.burn_flames_4'];
const STATUS_STATES = ['state.idle', 'state.working', 'state.blocked', 'state.starting_unobserved', 'state.pending_unobserved', 'state.working_with_blockers', 'state.blocked_permission', 'state.blocked_question', 'state.blocked_failure', 'state.wait_multiple'];
const ACTIVITY_STATES = ['state.activity_starting', 'state.activity_responding', 'state.activity_reasoning', 'state.activity_tool', 'state.activity_delegating', 'state.activity_compacting', 'state.activity_other'];
const HISTORY_PREFIX = ['state.past_', 'state.timeline_', 'state.spend_'];

export function resolveState(adapter, stateId) {
  const priced = PRICED.has(adapter);
  if (COST_STATES.includes(stateId)) {
    if (stateId === 'state.cost_unavailable') {
      return { verdict: 'absent-from-normal-backend', impossible: false, graphRef: 'shared.cost.row', note: 'Schema can represent a cost object with coverage unavailable. backend.ts:197-205 omits field.cost when there is no priced total, so the normal row is cost_missing instead. Not a live sample.' };
    }
    if (stateId === 'state.cost_missing' || stateId === 'state.burn_unpriced') {
      return { verdict: 'source-permitted', impossible: false, graphRef: priced ? 'shared.cost.priced' : 'shared.cost.missing', note: priced ? 'Possible before any priced total, and burn_unpriced applies to an observed working body without complete or partial cost.' : 'Current producers leave the row without a priced total. Working Swarm body is burn_unpriced. Not live-observed.' };
    }
    if (stateId === 'state.cost_complete' || stateId === 'state.cost_partial' || stateId.startsWith('state.burn_flames_')) {
      return priced
        ? { verdict: 'source-permitted-conditional', impossible: false, graphRef: 'shared.cost.priced', note: 'GV2 25c215a: catalog or provider cost can reach complete or partial, and any priced flame tier. Conditional on prices, rate window, and an observed working body. Not live-observed.' }
        : { verdict: 'absent-from-current-producers', impossible: false, graphRef: 'shared.cost.missing', note: 'No current priced producer. Not impossible if costUsd arrives later. Not live-observed.' };
    }
  }
  if (STATUS_STATES.includes(stateId) || ACTIVITY_STATES.includes(stateId)) {
    return { verdict: 'source-permitted', impossible: false, graphRef: 'shared.status', note: 'Fed by turn, tool, permission, or host lifecycle through transitions.ts:370-371 and derive.ts:68-88. Activity kind is whatever the reducer projects. Not a claim a given session entered the state. Not live-observed.' };
  }
  if (stateId === 'state.context_missing') {
    return { verdict: adapter === 'antigravity' ? 'absent-from-current-producers' : 'source-permitted', impossible: false, graphRef: 'shared.context.percent', note: 'field.context is omitted when usedPercent is not finite. Antigravity has no occupancy producer. The others can omit it until a context sample arrives. Not live-observed.' };
  }
  if (stateId === 'state.context_hot') {
    return { verdict: adapter === 'antigravity' ? 'absent-from-current-producers' : 'source-permitted-conditional', impossible: false, graphRef: 'shared.context.percent', note: 'Swarm floors usedPercent and marks hot at 80. Conditional on a percentage of at least 80. Not live-observed.' };
  }
  if (stateId === 'state.branch_none' || stateId === 'state.branch_named' || stateId === 'state.branch_unknown') {
    return {
      verdict: adapter === 'copilot' && stateId !== 'state.branch_unknown' ? 'source-permitted-conditional' : 'runtime-supplied',
      impossible: false,
      graphRef: 'shared.branch',
      note: 'Not unreachable merely because an adapter omits git. derive.ts:101-106 also reads host fallback and workspace branch. Copilot can observe a named branch or a null branch. branch_unknown was not given a separate adapter predicate here.',
    };
  }
  if (HISTORY_PREFIX.some((prefix) => stateId.startsWith(prefix)) || stateId.startsWith('state.feed_') || stateId.startsWith('state.spawn_') || stateId.startsWith('state.tier_') || stateId === 'state.remote' || stateId === 'state.active' || stateId === 'state.receded' || stateId === 'state.attached' || stateId === 'state.detached' || stateId === 'state.attachable' || stateId === 'state.stale' || stateId === 'state.fresh' || stateId === 'state.unread' || stateId === 'state.failed_retained' || stateId === 'state.dead_hidden' || stateId.startsWith('state.terminal_') || stateId.startsWith('state.reply_') || stateId === 'state.effort_configured' || stateId === 'state.effort_observed') {
    return { verdict: 'runtime-or-view-supplied', impossible: false, graphRef: 'shared.runtime-supplied', note: 'This predicate is host, replica, history, or view state. The adapter not emitting it is expected and is not an unreachable conclusion. Not live-observed.' };
  }
  return { verdict: 'unknown', impossible: false, graphRef: 'shared.unproven', note: 'No adapter-specific predicate was closed. Not declared impossible.' };
}
