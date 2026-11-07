/**
 * Structured source scopes for the first-half monitor audit.
 * uiReachable is derived from sourceScope plus a direct reader.
 * Field-domain predicates and the reachable subset are separate.
 * Pin 748d015. Vibefield consumer 433505fd. Account trace 08b5d849.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUP = '748d015a7e393112e0a91dad80111fdf5abe6583';
const VIB = '433505fd0f224f4cda540d642661b13848c0ef82';
const TRACE = '08b5d849177685662b43e0e3a4e6bd7d32ac2cdf';
const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const map = JSON.parse(readFileSync(process.env.DOWNSTREAM_MAP, 'utf8'));
const model = JSON.parse(readFileSync(process.env.MODEL_SCHEMA, 'utf8'));
const joinPath = join(ROOT, 'audit/godview/plan/gv-audit3-join.json');
const filled = JSON.parse(readFileSync(joinPath, 'utf8'));
const fields = new Map(map.fields.map((field) => [field.fieldId, field]));
const states = new Map(model['x-audit'].states.map((state) => [state.id, state]));
const verdictOf = new Map(filled.stateReachability.map((state) => [`${state.adapterId}\t${state.stateId}`, state.verdict]));

const pup = (path, lineStart, lineEnd, symbol) => ({ repo: 'puppeteer', sha: PUP, path, lineStart, lineEnd, symbol });
const vib = (path, lineStart, lineEnd, symbol) => ({ repo: 'vibefield', sha: VIB, path, lineStart, lineEnd, symbol });

const REF = {
  deriveRow: pup('packages/monitor/src/backend/derive.ts', 240, 286, 'deriveAgentRow'),
  deriveStatus: pup('packages/monitor/src/backend/derive.ts', 68, 72, 'agentStatus'),
  stale: pup('packages/monitor/src/backend/derive.ts', 215, 225, 'isStale'),
  fresh: pup('packages/core/src/monitor/freshness.ts', 32, 42, 'classifyMonitorRecency'),
  profile: pup('packages/monitor/src/backend/derive.ts', 62, 66, 'resolveProfileSet'),
  profileApply: pup('packages/monitor/src/backend/backend.ts', 433, 433, 'resolveProfileSet applied'),
  account: pup('packages/monitor/src/backend/derive.ts', 273, 273, 'host.account copy'),
  branch: pup('packages/monitor/src/backend/derive.ts', 101, 106, 'projectBranch'),
  observed: pup('packages/monitor/src/backend/derive.ts', 183, 186, 'agentObserved'),
  alive: pup('packages/monitor/src/backend/derive.ts', 78, 81, 'agentAlive'),
  seq: pup('packages/monitor/src/backend/backend.ts', 401, 403, 'project identity deal'),
  costOf: pup('packages/monitor/src/backend/backend.ts', 197, 205, 'costOf'),
  costCopy: pup('packages/monitor/src/backend/derive.ts', 277, 277, 'row cost copy'),
  projectUsage: pup('packages/core/src/monitor/project.ts', 407, 417, 'projectAgentMonitorState usage'),
  price: pup('packages/runtime/src/services/monitor-service.ts', 418, 425, 'priceUsageUpdates before reduce'),
  replica: pup('packages/monitor/src/replica/replica.ts', 337, 372, 'replica join'),
  replicaStatus: pup('packages/monitor/src/replica/replica.ts', 315, 321, 'agent status pass-through'),
  window: vib('packages/field-app/src/godview/monitor/window-rows.ts', 116, 134, 'window row patch'),
  swarmCost: pup('packages/views/src/views/swarm/bubble-model.ts', 469, 477, 'working body cost'),
  spend: pup('packages/views/src/views/spend/spend-series.ts', 34, 38, 'spendOf'),
  list: pup('packages/views/src/views/list/AgentList.tsx', 144, 199, 'AgentList'),
  monitorHost: pup('apps/godview/src/main/monitor-host.ts', 62, 79, 'Puppeteer host account'),
  acpProfiles: pup('packages/builtin-providers/src/providers.ts', 642, 659, 'ACP has no profiles service'),
};

const PRODUCER = {
  acp: {
    status: pup('packages/adapter-acp/src/services/prompt.ts', 50, 84, 'AcpPromptService'),
    context: pup('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'usage_update context only'),
    cost: pup('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'usage_update omits usage'),
    tokens: pup('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'no usage:tokens-used'),
    model: pup('packages/adapter-acp/src/normalization/monitor.ts', 62, 78, 'config model'),
    effort: pup('packages/adapter-acp/src/normalization/monitor.ts', 80, 98, 'thought_level'),
    wait: pup('packages/adapter-acp/src/services/approvals.ts', 135, 156, 'AcpApprovalService'),
    reply: pup('packages/adapter-acp/src/normalization/conversation.ts', 12, 26, 'assistant chunks'),
    branch: pup('packages/adapter-acp/src/driver.ts', 242, 244, 'cwd only'),
  },
  antigravity: {
    status: pup('packages/adapter-antigravity/src/normalization/pipeline.ts', 49, 97, 'synthesized turns'),
    context: pup('packages/adapter-antigravity/src/normalization/pipeline.ts', 86, 88, 'CHECKPOINT is not context'),
    cost: pup('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 107, 'no usage'),
    tokens: pup('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 107, 'no usage'),
    model: pup('packages/adapter-antigravity/src/driver.ts', 166, 170, 'launch model'),
    effort: pup('packages/adapter-antigravity/src/driver.ts', 171, 175, 'launch effort'),
    wait: pup('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 107, 'no interaction'),
    reply: pup('packages/adapter-antigravity/src/normalization/conversation.ts', 1, 3, 'planner message'),
    branch: pup('packages/adapter-antigravity/src/driver.ts', 162, 165, 'cwd only'),
  },
  claude: {
    status: pup('packages/adapter-claude/src/normalization/monitor.ts', 328, 367, 'childStatusBatch'),
    context: pup('packages/adapter-claude/src/normalization/monitor.ts', 269, 289, 'root context'),
    cost: pup('packages/adapter-claude/src/observation/otel/usage.ts', 37, 69, 'costUsd'),
    tokens: pup('packages/adapter-claude/src/observation/otel/usage.ts', 28, 79, 'totalTokens'),
    model: pup('packages/adapter-claude/src/normalization/monitor.ts', 239, 252, 'root model'),
    effort: pup('packages/adapter-claude/src/normalization/monitor.ts', 254, 267, 'root effort'),
    wait: pup('packages/adapter-claude/src/normalization/interaction.ts', 62, 83, 'permission and question'),
    reply: pup('packages/adapter-claude/src/normalization/conversation.ts', 1, 9, 'assistant message'),
    branch: pup('packages/adapter-claude/src/normalization/environment.ts', 5, 12, 'cwd only'),
  },
  codex: {
    status: pup('packages/adapter-codex/src/normalization/monitor.ts', 643, 670, 'child turn activity'),
    context: pup('packages/adapter-codex/src/normalization/monitor.ts', 530, 538, 'root context'),
    cost: pup('packages/adapter-codex/src/normalization/monitor.ts', 503, 527, 'pricing deltas, no costUsd'),
    tokens: pup('packages/adapter-codex/src/normalization/monitor.ts', 503, 527, 'cumulativeTokens'),
    model: pup('packages/adapter-codex/src/normalization/monitor.ts', 292, 331, 'thread model'),
    effort: pup('packages/adapter-codex/src/normalization/monitor.ts', 333, 343, 'thread effort'),
    wait: pup('packages/adapter-codex/src/services/approvals.ts', 198, 293, 'CodexApprovalService'),
    reply: pup('packages/adapter-codex/src/normalization/conversation.ts', 12, 42, 'agent message'),
    branch: pup('packages/adapter-codex/src/normalization/environment.ts', 10, 21, 'cwd only'),
  },
  copilot: {
    status: pup('packages/adapter-copilot/src/normalization/pipeline.ts', 100, 165, 'interaction turn'),
    context: pup('packages/adapter-copilot/src/normalization/compaction.ts', 4, 25, 'compaction context'),
    cost: pup('packages/adapter-copilot/src/normalization/compaction.ts', 4, 25, 'context tokens are not cost'),
    tokens: pup('packages/adapter-copilot/src/normalization/compaction.ts', 4, 25, 'no usage:tokens-used'),
    model: pup('packages/adapter-copilot/src/normalization/model.ts', 4, 14, 'normalizeCopilotModel'),
    effort: pup('packages/adapter-copilot/src/normalization/effort.ts', 4, 8, 'normalizeCopilotEffort'),
    wait: pup('packages/adapter-copilot/src/normalization/interaction.ts', 4, 43, 'permission'),
    reply: pup('packages/adapter-copilot/src/normalization/conversation.ts', 4, 19, 'assistant message'),
    branch: pup('packages/adapter-copilot/src/normalization/environment.ts', 4, 18, 'git.branch'),
  },
};

const HOST = {
  'field.id': pup('packages/monitor/src/backend/derive.ts', 253, 253, 'row id'),
  'field.createdAt': pup('packages/monitor/src/backend/derive.ts', 256, 256, 'host.createdAt'),
  'field.provider': pup('packages/monitor/src/backend/derive.ts', 270, 270, 'host.provider'),
  'field.provider.id': pup('packages/monitor/src/backend/derive.ts', 270, 270, 'host.provider.id'),
  'field.provider.label': pup('packages/monitor/src/backend/derive.ts', 270, 270, 'host.provider.label'),
  'field.pending': pup('packages/monitor/src/backend/derive.ts', 262, 262, 'host.pending'),
  'field.device': pup('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.id': pup('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.name': pup('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.os': pup('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.device.self': pup('packages/monitor/src/backend/derive.ts', 280, 280, 'input.device'),
  'field.attachable': pup('packages/monitor/src/backend/derive.ts', 251, 251, 'terminalSessionId'),
  'field.writable': pup('packages/monitor/src/backend/derive.ts', 285, 285, 'writable'),
  'field.tier': pup('packages/monitor/src/backend/derive.ts', 281, 281, 'host.tier'),
  'field.creationId': pup('packages/monitor/src/backend/derive.ts', 255, 255, 'host.creationId'),
  'field.unread': pup('packages/monitor/src/backend/derive.ts', 279, 279, 'input.unread'),
};
const RUNTIME = {
  'field.kind': pup('packages/monitor/src/backend/derive.ts', 254, 254, 'kind agent'),
  'field.stale': REF.stale,
  'field.alive': REF.alive,
  'field.observed': REF.observed,
  'field.profileSet': REF.profile,
  'field.project.seq': REF.seq,
  'field.project': pup('packages/monitor/src/backend/derive.ts', 91, 95, 'projectName'),
  'field.project.name': pup('packages/monitor/src/backend/derive.ts', 91, 95, 'projectName'),
};
const REPLICA = {
  'field.colour': pup('packages/monitor/src/replica/replica.ts', 245, 257, 'colourOf'),
  'field.active': pup('packages/monitor/src/replica/replica.ts', 340, 340, 'activeIds'),
  'field.receded': pup('packages/monitor/src/replica/replica.ts', 259, 268, 'recededOf'),
  'field.attachment': pup('packages/monitor/src/replica/replica.ts', 281, 288, 'attachmentOf'),
  'field.attachment.panes': pup('packages/monitor/src/replica/replica.ts', 281, 288, 'attachmentOf'),
  'field.attachment.colour': pup('packages/monitor/src/replica/replica.ts', 281, 288, 'attachmentOf'),
  'field.spawnHint': pup('packages/monitor/src/replica/replica.ts', 290, 295, 'spawnHintOf'),
  'field.spawnHint.x': pup('packages/monitor/src/replica/replica.ts', 290, 295, 'spawnHintOf'),
  'field.spawnHint.y': pup('packages/monitor/src/replica/replica.ts', 290, 295, 'spawnHintOf'),
  'field.visualId': pup('packages/monitor/src/replica/replica.ts', 346, 372, 'join visualId'),
};

function family(fieldId) {
  if (fieldId === 'field.status' || fieldId === 'field.detail' || fieldId === 'field.statusSince' || fieldId.startsWith('field.activity')) return 'status';
  if (fieldId.startsWith('field.wait')) return 'wait';
  if (fieldId.startsWith('field.context')) return 'context';
  if (fieldId === 'field.model') return 'model';
  if (fieldId.startsWith('field.effort')) return 'effort';
  if (fieldId.startsWith('field.tokens')) return 'tokens';
  if (fieldId.startsWith('field.cost')) return 'cost';
  if (fieldId === 'field.project.branch') return 'branch';
  if (fieldId.startsWith('field.reply')) return 'reply';
  if (fieldId === 'field.project' || fieldId === 'field.project.name') return 'project';
  return 'other';
}

function domainFor(fieldId) {
  const listed = fields.get(fieldId)?.stateIds ?? [];
  const path = fieldId.slice('field.'.length);
  const leaf = path.split('.')[0];
  if (path === 'project.branch') return listed.filter((id) => id.startsWith('state.branch_'));
  if (path === 'project' || path === 'project.name' || path === 'project.seq' || path === 'reply.at') return [];
  return listed.filter((id) => {
    const state = states.get(id);
    if (!state) return false;
    const fam = state.adapterFamily;
    if (leaf === 'effort') return fam === 'effort' || id.startsWith('state.effort_');
    if (leaf === 'cost' || leaf === 'tokens') return fam === 'usage';
    if (leaf === 'context') return fam === 'context';
    if (leaf === 'model') return fam === 'model';
    if (leaf === 'reply') return id.startsWith('state.reply_');
    if (['status', 'detail', 'activity', 'wait'].includes(leaf) || path === 'statusSince') {
      return fam === 'status' || fam === 'delegation' || fam === 'compaction' || id.startsWith('state.activity_') || id.startsWith('state.blocked') || id === 'state.idle' || id === 'state.working' || id === 'state.working_with_blockers';
    }
    if (leaf === 'stale') return id === 'state.stale' || id === 'state.fresh' || id === 'state.device_stale';
    if (leaf === 'observed') return id === 'state.starting_unobserved' || id === 'state.pending_unobserved';
    if (fam && fam !== leaf) return false;
    return (state.predicate ?? '').includes(leaf);
  });
}

function classify(adapter, fieldId) {
  const fam = family(fieldId);
  const priced = adapter === 'claude' || adapter === 'codex';
  if (fieldId === 'field.account') {
    return {
      sourceScope: 'host-supplied',
      sourceRef: REF.account,
      staticPresence: 'host-dependent',
      adapterEmittable: 'no',
      uiReachable: 'no',
    };
  }
  if (fieldId === 'field.inputUsed') {
    return {
      sourceScope: 'absent',
      sourceRef: REF.deriveRow,
      staticPresence: 'omitted',
      adapterEmittable: 'no',
      uiReachable: 'no',
    };
  }
  if (fieldId === 'field.project.branch' && adapter !== 'copilot') {
    return {
      sourceScope: 'host-supplied',
      sourceRef: REF.branch,
      staticPresence: 'host-dependent',
      adapterEmittable: 'no',
      uiReachable: 'yes',
    };
  }
  if (fam === 'cost' || fam === 'tokens') {
    if (!priced) {
      return {
        sourceScope: 'absent',
        sourceRef: PRODUCER[adapter][fam],
        staticPresence: 'omitted',
        adapterEmittable: 'no',
        uiReachable: 'no',
      };
    }
    if (fam === 'cost' && adapter === 'codex') {
      return {
        sourceScope: 'common-runtime',
        sourceRef: REF.price,
        staticPresence: 'emitted-when-condition',
        adapterEmittable: 'no',
        uiReachable: 'yes',
      };
    }
    return {
      sourceScope: 'adapter-provided',
      sourceRef: PRODUCER[adapter][fam],
      staticPresence: 'emitted-when-condition',
      adapterEmittable: 'yes',
      uiReachable: fam === 'tokens' ? 'no' : 'yes',
    };
  }
  if (fam === 'context' && adapter === 'antigravity') {
    return { sourceScope: 'absent', sourceRef: PRODUCER[adapter].context, staticPresence: 'omitted', adapterEmittable: 'no', uiReachable: 'no' };
  }
  if (fam === 'wait' && adapter === 'antigravity') {
    return { sourceScope: 'absent', sourceRef: PRODUCER[adapter].wait, staticPresence: 'omitted', adapterEmittable: 'no', uiReachable: 'no' };
  }
  if (HOST[fieldId]) {
    return { sourceScope: 'host-supplied', sourceRef: HOST[fieldId], staticPresence: fieldId === 'field.tier' || fieldId === 'field.creationId' || fieldId === 'field.pending' ? 'host-dependent' : 'always-on-row', adapterEmittable: 'no', uiReachable: 'pending-reader' };
  }
  if (RUNTIME[fieldId]) {
    return { sourceScope: 'common-runtime', sourceRef: RUNTIME[fieldId], staticPresence: 'always-on-row', adapterEmittable: 'no', uiReachable: 'pending-reader' };
  }
  if (REPLICA[fieldId]) {
    return { sourceScope: 'replica-derived', sourceRef: REPLICA[fieldId], staticPresence: fieldId.startsWith('field.attachment') || fieldId.startsWith('field.spawnHint') || fieldId === 'field.visualId' ? 'host-dependent' : 'always-on-row', adapterEmittable: 'no', uiReachable: 'pending-reader' };
  }
  const produced = PRODUCER[adapter][fam];
  if (produced && fam !== 'other' && fam !== 'project') {
    return { sourceScope: 'adapter-provided', sourceRef: produced, staticPresence: 'emitted-when-condition', adapterEmittable: 'yes', uiReachable: 'pending-reader' };
  }
  if (fam === 'project') {
    return { sourceScope: 'common-runtime', sourceRef: RUNTIME['field.project'], staticPresence: 'always-on-row', adapterEmittable: 'yes', uiReachable: 'pending-reader' };
  }
  return { sourceScope: 'absent', sourceRef: REF.deriveRow, staticPresence: 'omitted', adapterEmittable: 'no', uiReachable: 'no' };
}

function readOf(field) {
  if ((field?.rendererConsumers ?? []).length) return 'direct';
  if ((field?.indirectConsumers ?? []).length) return 'indirect';
  return 'none';
}

function uiOf(info, read) {
  if (info.uiReachable === 'yes' || info.uiReachable === 'no') return info.uiReachable;
  if (info.sourceScope === 'absent') return 'no';
  if (read !== 'direct') return 'no';
  return 'yes';
}

function belongsRuntime(scope) {
  return scope === 'common-runtime' || scope === 'host-supplied' || scope === 'replica-derived';
}

function reach(adapterId, fieldId, domain, scope) {
  return domain.map((stateId) => {
    const verdict = verdictOf.get(`${adapterId}\t${stateId}`) ?? 'unclassified';
    let applicable = String(verdict).startsWith('source-permitted');
    const runtimeVerdict = /^(runtime-supplied|runtime-or-view-supplied|runtime-default-permitted|board-supplied)$/u.test(verdict);
    if (!applicable && runtimeVerdict && (belongsRuntime(scope) || scope === 'adapter-provided')) applicable = true;
    if (!applicable && scope === 'absent' && /_(missing|absent|unpriced)$/u.test(stateId)) applicable = true;
    return { stateId, verdict, applicable };
  });
}

function step(order, name, effect, source) {
  return { order, name, effect, source };
}

function costTail() {
  return [
    step(4, 'project-usage', 'projectAgentMonitorState publishes usage from the priced index. This is the monitor usage object, not yet field.cost.', REF.projectUsage),
    step(5, 'ledger-counts', 'buildUsageCostLedger increments pricedCount for each finite nonnegative costUsd, including 0. A missing or invalid costUsd increments unpricedCount when canonical, pricing, or cost is present.', pup('packages/core/src/monitor/cost.ts', 21, 40, 'buildUsageCostLedger')),
    step(6, 'coverage-decision', 'projectUsageCost: pricedCount > 0 and unpricedCount = 0 is complete, and the USD total may be 0. pricedCount > 0 and unpricedCount > 0 is partial. pricedCount = 0 omits costUsd and sets coverage unavailable.', pup('packages/core/src/monitor/cost.ts', 59, 101, 'projectUsageCost')),
    step(7, 'history-aggregate', 'historyOf sums defined costUsd across runs before costOf. A pricedCount of 0 leaves history.total undefined.', pup('packages/monitor/src/backend/usage-ledger.ts', 62, 82, 'historyOf')),
    step(8, 'derive-cost', 'deriveAgentRow copies input.cost when costOf returned an object, including a USD total of 0. It omits cost when history.total is undefined.', REF.costCopy),
    step(9, 'replica-passthrough', 'The replica join spreads the agent row. It does not recompute cost.', REF.replica),
    step(10, 'window-passthrough', 'window-rows spreads the row. It rewrites peer stale and drops peer profileSet. It does not recompute cost.', REF.window),
    step(11, 'swarm-reader', 'A working observed body reads cost coverage and burn to choose a priced flame or the unpriced flame.', REF.swarmCost),
    step(12, 'spend-reader', 'spendOf reads cost.usd unless coverage is unavailable or the total is missing.', REF.spend),
  ];
}

function statusGraph(adapter, signal) {
  const extra = {
    acp: 'tool.ts:38-75 tool started, completed, or failed',
    claude: 'turn.ts:5-18 hook turns and tool.ts:46-52 tool requested',
    codex: 'turn.ts:22-36 root turn:started on userMessage',
  };
  return `%% field: field.status
%% adapter: ${adapter}
%% sourceScope: adapter-provided
%% forensic: source-read; liveObserved false
flowchart TD
  signal["${signal.path}:${signal.lineStart}-${signal.lineEnd}\\n${signal.symbol}"]
  ${extra[adapter] ? `also["${extra[adapter]}"] --> reduce` : ''}
  signal --> reduce["reduce.ts:864-912 turn and tool activity"]
  reduce --> choose["transitions.ts:370-371"]
  choose --> child["runnable child: working"]
  choose --> blocked["blockers and no child: blocked"]
  choose --> active["activity remains: working"]
  choose --> idle["otherwise: idle"]
  choose --> derive["derive.ts:68-72"]
  derive --> pending["host.pending: idle"]
  derive --> starting["no runtime state: working"]
  derive --> replica["replica.ts:315-321 agent status copied"]
  replica --> window["window-rows.ts:130-134 pass-through; status is not rewritten"]
  window --> readers["AgentList.tsx:144-199 RainView.tsx:217 bubble-model.ts:298-345 spend-words.ts:145 timeline-lanes.ts:94-97"]
`;
}

function costGraph(adapter, signal) {
  return `%% field: field.cost.usd
%% adapter: ${adapter}
%% forensic: source-read; liveObserved false
flowchart TD
  signal["${signal.path}:${signal.lineStart}-${signal.lineEnd}\\n${signal.symbol}"]
  signal --> price["monitor-service.ts:418-425 priceUsageUpdates before reduce"]
  price --> reduce["reduce.ts:1049-1073 copies the priced costUsd"]
  reduce --> project["project.ts:407-417 publishes usage"]
  project --> counts["cost.ts:21-40 buildUsageCostLedger: finite nonnegative costUsd, including 0, increments pricedCount; otherwise unpricedCount"]
  counts --> decide["cost.ts:59-101 projectUsageCost"]
  decide --> complete["pricedCount > 0 and unpricedCount = 0: costCoverage complete. USD total may be 0"]
  decide --> partial["pricedCount > 0 and unpricedCount > 0: costCoverage partial"]
  decide --> none["pricedCount = 0: costUsd omitted and costCoverage unavailable"]
  complete --> agg["usage-ledger.ts:62-82 historyOf sums defined costUsd before costOf"]
  partial --> agg
  none --> agg
  agg --> costOf["backend.ts:197-205 costOf after ledger.observe at backend.ts:410-435"]
  costOf --> missing["pricedCount = 0 leaves history.total undefined: omit field.cost, state.cost_missing"]
  costOf --> kept["pricedCount > 0: row keeps usd, which may be 0, and complete or partial coverage"]
  kept --> derive["derive.ts:277 copies cost or omits it"]
  derive --> replica["replica.ts:337-372 spreads the row; cost unchanged"]
  replica --> window["window-rows.ts:116-134 does not recompute cost"]
  window --> swarm["bubble-model.ts:469-477 priced flame or unpriced flame"]
  window --> spend["spend-series.ts:34-38 spendOf"]
  complete --> swarm
  partial --> swarm
  missing --> unpriced["working observed body: burn_unpriced"]
`;
}

function staleGraph(adapter) {
  return `%% field: field.stale
%% adapter: ${adapter}
%% sourceScope: common-runtime
%% forensic: source-read; liveObserved false
flowchart TD
  clock["freshness.ts:32-42 age against staleAfterMs"] --> fn["derive.ts:215-225 isStale"]
  fn --> fresh["false: state.fresh"]
  fn --> stale["true: state.stale"]
  fn --> row["deriveAgentRow always sets stale"]
  row --> self["window-rows.ts:116 self row keeps isStale"]
  row --> peer["window-rows.ts:116 other device: stale when standing is not live"]
  peer --> device["state.device_stale"]
  self --> list["AgentList and swarm read stale"]
`;
}

function accountGraph(adapter) {
  const puppeteer =
    adapter === 'acp'
      ? 'ACP has no profiles service, so monitor-host.ts:62 leaves account unset'
      : 'monitor-host.ts:62-79 sets account from the registered profile label';
  return `%% field: field.account
%% adapter: ${adapter}
%% sourceScope: host-supplied
%% envelope uiReachable is the Vibefield consumer, not every host
flowchart TD
  none["No adapter emits account"] --> copy["derive.ts:273 copies host.account or omits it"]
  vf["Vibefield hostRunFromSummary agent-monitor.ts:223-266 never sets account"] --> copy
  ph["Puppeteer Godview host"] --> copy
  ph --> pp["${puppeteer}"]
  copy --> vfRow["consumer 433505fd: account unreachable"]
  pp --> readers["AgentList.tsx:151,185 only when the string is present"]
  usage["accountUsage feeds the usage column only. It does not write field.account"]
`;
}

function profileGraph(adapter) {
  return `%% field: field.profileSet
%% adapter: ${adapter}
%% sourceScope: common-runtime
flowchart TD
  inputs["${adapter === 'acp' ? 'ACP has no profiles service' : 'host profileSet or profileId'}"] --> resolve["derive.ts:62-66 host value, else persona set, else native"]
  resolve --> apply["backend.ts:433"]
  apply --> row["derive.ts:282 always copies profileSet onto an agent row"]
  row --> self["self row keeps it"]
  row --> peer["window-rows.ts:130-134 drops other-device profileSet"]
  self --> tabs["profile-tabs.ts:26-28"]
  self --> bloom["swarm bloom model.ts:381"]
`;
}

function genericGraph(fieldId, info, read) {
  const ref = info.sourceRef;
  return `%% field: ${fieldId}
%% sourceScope: ${info.sourceScope}
%% staticPresence: ${info.staticPresence}
%% liveObserved: false
flowchart TD
  producer["${ref.path}:${ref.lineStart}-${ref.lineEnd}\\n${ref.symbol}"]
  producer --> row["row property from that producer"]
  row --> window["window-rows.ts:116-134 pass-through unless this field is stale or profileSet"]
  window --> reader["rendererRead ${read}"]
`;
}

function notes(adapter, fieldId, info, read, domain, reachable) {
  const ref = info.sourceRef;
  const lines = [
    `sourceScope=${info.sourceScope}.`,
    `sourceRef=${ref.path}:${ref.lineStart}-${ref.lineEnd} ${ref.symbol}.`,
    `staticPresence=${info.staticPresence}. liveObserved=false.`,
    'observation.presence=unknown because this audit did not live-sample the value. staticPresence is the source result and is independent of that.',
    `rendererRead=${read}. adapterEmittable=${info.adapterEmittable}. uiReachable=${info.uiReachable}.`,
    info.uiReachable === 'yes'
      ? `The value reaches a direct reader from this ${info.sourceScope} producer.`
      : 'A global reader does not make this value reachable.',
  ];
  if (fieldId === 'field.account') {
    lines.push(
      'HOST SCOPES. Envelope uiReachable=no is the Vibefield consumer 433505fd only: hostRunFromSummary never sets account. This is not a global absence.',
      adapter === 'acp'
        ? 'Puppeteer Godview host also omits account because ACP has no profiles service.'
        : 'Puppeteer Godview host can set account from accountLabel(profileId) at monitor-host.ts:62-79.',
      'accountUsage feeds the usage column only. It does not write field.account.',
      `GV2 trace ${TRACE}.`,
    );
  }
  if (fieldId === 'field.profileSet') {
    lines.push(
      'resolveProfileSet uses host.profileSet, else the persona set for profileId, else native.',
      adapter === 'acp' ? 'ACP has no profiles service, so the unbound result is native.' : 'A profiles service can bind profileId.',
      'window-rows keeps profileSet on this device and removes it for other-device rows. That is not a global absence.',
    );
  }
  if (domain.length === 0) {
    lines.push('Field domain is empty. applicability.states=model-axes is the envelope token for a field with no state predicates. It is not a reachable set and it does not claim any other field\'s states.');
  } else {
    lines.push(`Field domain: ${domain.join(', ')}.`);
    lines.push(reachable.length ? `Reachable subset: ${reachable.join(', ')}.` : 'Reachable subset is empty.');
    const excluded = domain.filter((id) => !reachable.includes(id));
    if (excluded.length) lines.push(`In the domain but not reachable on this path: ${excluded.join(', ')}.`);
  }
  return lines.join(' ');
}

let counts = { scopes: {}, modelAxes: 0, reachableRows: 0 };
for (const row of filled.rowJoins) {
  const adapter = row.adapterId.slice('adapter.'.length);
  const field = fields.get(row.fieldId);
  const read = readOf(field);
  const info = classify(adapter, row.fieldId);
  info.uiReachable = uiOf(info, read);
  const domain = domainFor(row.fieldId);
  const stateReachability = reach(row.adapterId, row.fieldId, domain, info.sourceScope);
  const reachable = stateReachability.filter((item) => item.applicable).map((item) => item.stateId);
  const file = join(ROOT, 'audit/godview/evidence', adapter, `${row.fieldId.slice('field.'.length)}.json`);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.classification = { modelSupported: 'yes', adapterEmittable: info.adapterEmittable, uiReachable: info.uiReachable };
  record.observation = { presence: 'unknown', synthetic: false };
  if (domain.length === 0) record.applicability.states = 'model-axes';
  else if (reachable.length === 0) throw new Error(`${row.adapterId} ${row.fieldId} has a domain and an empty reachable subset`);
  else record.applicability.states = reachable;
  record.applicability.notes = notes(adapter, row.fieldId, info, read, domain, reachable);
  record.verification.notes = record.applicability.notes;
  if (!record.sources.some((source) => source.path === info.sourceRef.path && source.lineStart === info.sourceRef.lineStart)) {
    record.sources.unshift(info.sourceRef);
  }
  const fam = family(row.fieldId);
  if ((adapter === 'claude' || adapter === 'codex') && fam === 'cost') {
    const tail = costTail();
    const have = new Set(record.transforms.map((item) => item.name));
    for (const item of tail) if (!have.has(item.name)) record.transforms.push(item);
    writeFileSync(file.replace(/\.json$/u, '.mmd'), costGraph(adapter, info.sourceScope === 'common-runtime' ? PRODUCER[adapter].cost : info.sourceRef));
  } else if (row.fieldId === 'field.status') {
    if (!record.transforms.some((item) => item.name === 'window-passthrough')) {
      record.transforms.push(step(record.transforms.length, 'window-passthrough', 'window-rows spreads the agent row and does not recompute status.', REF.window));
    }
    writeFileSync(file.replace(/\.json$/u, '.mmd'), statusGraph(adapter, PRODUCER[adapter].status));
  } else if (row.fieldId === 'field.stale') {
    record.transforms = [
      step(0, 'recency', 'classifyMonitorRecency returns fresh or stale from evidence age. No clock is not stale.', REF.fresh),
      step(1, 'is-stale', 'isStale is false for idle, for an open root tool, and when no clock exists. Otherwise it is the recency result. derive always writes the boolean.', REF.stale),
      step(2, 'peer-standing', 'For another device, window-rows replaces that boolean with standing !== live. A self row keeps isStale.', REF.window),
    ];
    writeFileSync(file.replace(/\.json$/u, '.mmd'), staleGraph(adapter));
  } else if (row.fieldId === 'field.account') {
    record.producer = { kind: 'core-reducer', name: 'host.account copy', ingestedFrom: 'derive.ts:273 only host.account' };
    record.transforms = [
      step(0, 'no-adapter', 'No adapter emits account.', adapter === 'acp' ? REF.acpProfiles : PRODUCER[adapter].model),
      step(1, 'copy', 'derive copies host.account and otherwise omits the property.', REF.account),
      step(2, 'vibefield-host', 'hostRunFromSummary copies profileId and profileSet and never sets account.', vib('packages/fieldd/src/agent-monitor.ts', 223, 266, 'hostRunFromSummary')),
      step(3, 'puppeteer-host', adapter === 'acp' ? 'ACP has no profiles service, so this host also omits account.' : 'This host sets account from the profile label when profileId is registered.', REF.monitorHost),
    ];
    record.merge = { strategy: 'none', defaults: [] };
    record.transport = {
      channel: 'in-process',
      name: adapter === 'acp' ? 'not-applicable' : 'host-scoped',
      contract: adapter === 'acp' ? 'Neither audited host sets account for ACP.' : 'Vibefield omits account. Puppeteer Godview host may set a profile label.',
    };
    record.absence = { ...record.absence, onMissing: 'omit-field' };
    writeFileSync(file.replace(/\.json$/u, '.mmd'), accountGraph(adapter));
  } else if (row.fieldId === 'field.profileSet') {
    record.producer = { kind: 'core-reducer', name: 'resolveProfileSet', ingestedFrom: 'derive.ts:62-66' };
    record.transforms = [
      step(0, 'resolve', 'host.profileSet, else the persona set for profileId, else native.', REF.profile),
      step(1, 'apply', 'The agent fold always passes that string.', REF.profileApply),
      step(2, 'peer-drop', 'window-rows keeps it on this device and drops it for other-device rows.', REF.window),
    ];
    record.merge = {
      strategy: 'defaulted',
      defaults: [
        { when: 'host.profileSet is set', presence: 'present', literal: 'host.profileSet', source: REF.profile },
        { when: 'neither host.profileSet nor host.profileId is set', presence: 'present', literal: 'native', source: REF.profile },
      ],
    };
    writeFileSync(file.replace(/\.json$/u, '.mmd'), profileGraph(adapter));
  } else if (info.sourceScope !== 'adapter-provided') {
    writeFileSync(file.replace(/\.json$/u, '.mmd'), genericGraph(row.fieldId, info, read));
  }
  if (info.sourceScope === 'absent') {
    record.merge = { strategy: 'none', defaults: record.merge.defaults ?? [] };
  }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  delete row.uiReachabilityScope;
  row.sourceScope = info.sourceScope;
  row.sourceRef = `${info.sourceRef.path}:${info.sourceRef.lineStart}-${info.sourceRef.lineEnd}`;
  row.staticPresence = info.staticPresence;
  row.liveObserved = false;
  row.rendererRead = read;
  row.adapterPathProvidesValue = info.adapterEmittable === 'yes' ? 'conditional' : 'no';
  row.classification = record.classification;
  row.uiPathVerdict = info.uiReachable;
  row.stateDomain = domain;
  row.stateReachability = stateReachability;
  row.alternateProducer = info.sourceScope === 'adapter-provided' ? null : row.sourceRef;
  if (fieldIdAccount(row) ) {
    row.hostScopes = {
      trace: TRACE,
      envelopeUiReachableMeans: 'vibefield-consumer',
      vibefield: { pin: VIB, account: 'unreachable', source: 'packages/fieldd/src/agent-monitor.ts:223-266' },
      puppeteerGodview: {
        pin: PUP,
        account: adapter === 'acp' ? 'unreachable' : 'profile-label-when-bound',
        source: 'apps/godview/src/main/monitor-host.ts:62-79',
      },
    };
    row.notApplicableReason = adapter === 'acp' ? 'Neither audited host sets account for ACP.' : null;
  }
  if (row.fieldId === 'field.profileSet') {
    row.hostScopes = {
      trace: TRACE,
      vibefield: { profileSet: adapter === 'acp' ? 'native-on-self-rows' : 'resolved-on-self-rows', peerProfileSet: 'removed' },
      puppeteerGodview: { profileSet: adapter === 'acp' ? 'native' : 'persona-or-native' },
    };
  }
  counts.scopes[info.sourceScope] = (counts.scopes[info.sourceScope] ?? 0) + 1;
  if (record.applicability.states === 'model-axes') counts.modelAxes += 1;
  if (reachable.length) counts.reachableRows += 1;
  if (domain.length && reachable.length === 0) counts.emptyReach = (counts.emptyReach ?? 0) + 1;
}

function fieldIdAccount(row) {
  return row.fieldId === 'field.account';
}

filled.accountHostTrace = {
  repo: 'vibefield',
  commit: TRACE,
  note: 'field.account uiReachable is the Vibefield consumer scope. The Puppeteer Godview host is a separate scope.',
};
writeFileSync(joinPath, `${JSON.stringify(filled, null, 2)}\n`);
console.log(JSON.stringify(counts));
