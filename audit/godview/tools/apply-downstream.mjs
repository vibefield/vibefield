/**
 * Join GV2 shared downstream map onto the 370 row envelopes.
 * Map commit 07e71c9bcb9532fc181e3f667f2d0ed2e7c9afaf. Pin 748d015 only.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SHA = '748d015a7e393112e0a91dad80111fdf5abe6583';
const VF = '433505fd0f224f4cda540d642661b13848c0ef82';
const MAP_COMMIT = '07e71c9bcb9532fc181e3f667f2d0ed2e7c9afaf';
const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const map = JSON.parse(readFileSync(process.env.DOWNSTREAM_MAP, 'utf8'));
const filled = JSON.parse(readFileSync(process.env.FILLED_JOIN, 'utf8'));
if (map.pins.puppeteer !== SHA || filled.pins.puppeteer !== SHA) throw new Error('pin mismatch');

const fields = new Map(map.fields.map((field) => [field.fieldId, field]));
const states = new Map(map.states.map((state) => [state.stateId, state]));

function src(file, start, end, symbol) {
  return { repo: 'puppeteer', sha: SHA, path: file, lineStart: start, lineEnd: end, symbol };
}

function fromEvidence(item, symbol) {
  if (!item || item.repo !== 'puppeteer' || item.commit !== SHA) return null;
  return src(item.file, item.line, item.endLine ?? item.line, symbol);
}

const pricing = src('packages/runtime/src/services/monitor-service.ts', 418, 425, 'priceUsageUpdates before reduce');
const pricingRules = src('packages/runtime/src/services/usage-pricing.ts', 19, 78, 'catalog and provider costUsd');
const reduceUsage = src('packages/core/src/monitor/reduce.ts', 1049, 1073, 'usage:tokens-used case');
const backendCost = src('packages/monitor/src/backend/backend.ts', 197, 205, 'costOf omits unpaid total');
const tokenChain = [
  src('packages/core/src/monitor/usage-index.ts', 110, 124, 'totalContribution'),
  src('packages/core/src/monitor/usage-index.ts', 345, 366, 'canonical sum to cumulativeTokens'),
  src('packages/core/src/monitor/usage-index.ts', 545, 550, 'queryUsageIndex cumulativeTokens'),
  src('packages/monitor/src/backend/derive.ts', 198, 207, 'agentTokens'),
];

function clean(text) {
  return text
    .replaceAll('PENDING DOWNSTREAM MAPPING: GV-AUDIT2 owns adapter output to row predicates, including cost, burn rate, history, timeline, and git branch. This audit does not give that verdict.', '')
    .replaceAll('PENDING DOWNSTREAM MAPPING into MonitorAgentRow. This is one of 74 canonical row fields. It is not an SDK contract leaf.', 'Row field. Shared continuation is joined from GV2 07e71c9. Not a live sample.')
    .replaceAll('PENDING DOWNSTREAM MAPPING.', '')
    .replaceAll('Those predicates stay downstream. PENDING DOWNSTREAM MAPPING.', 'Normal backend does not emit a present cost object with coverage unavailable.')
    .replace(/\s+/g, ' ')
    .trim();
}

function graph(record, joinRow, field) {
  const nodes = [];
  const push = (id, label) => nodes.push({ id, label: label.replaceAll('"', "'") });
  const first = record.sources[0];
  push('src', `${first.path}:${first.lineStart}-${first.lineEnd}`);
  if (record.fieldId.startsWith('field.cost')) {
    push('price', 'priceUsageUpdates BEFORE reduce monitor-service.ts:418-425');
    push('reduce', 'reduce usage copy reduce.ts:1049-1073');
    push('row', 'costOf omits unpaid total backend.ts:197-205');
  } else if (record.fieldId === 'field.tokens.total' && record.adapterId === 'adapter.claude') {
    push('sum', 'usage-index.ts:110-124 totalContribution');
    push('fold', 'usage-index.ts:345-366 cumulativeTokens');
    push('row', 'derive.ts:198-207 tokens.total');
    push('ui', 'no direct builtin reader');
  } else {
    const path = map.paths.find((item) => item.id === field?.pathId);
    const evidence = path?.evidence?.[0];
    if (evidence) push('path', `${evidence.file}:${evidence.line}-${evidence.endLine ?? evidence.line}`);
    const reader = field?.rendererConsumers?.[0]?.evidence?.[0];
    if (reader) push('ui', `${reader.file}:${reader.line}-${reader.endLine ?? reader.line}`);
    else if (joinRow.directRendererReachable === 'no' && joinRow.indirectUiReachable !== 'yes') push('ui', 'no direct builtin reader');
    else if (joinRow.indirectUiReachable === 'yes') push('ui', 'indirect reader only');
    else push('open', 'UNRESOLVED reader');
  }
  const lines = [
    `%% graph_ref: ${field?.pathId ?? 'shared.unproven'}`,
    `%% shared_map: 07e71c9bcb9532fc181e3f667f2d0ed2e7c9afaf`,
    `%% forensic: source-read ${SHA}; not a live sample`,
    'flowchart LR',
  ];
  nodes.forEach((node, index) => {
    lines.push(`  n${index}["${node.label}"]`);
    if (index) lines.push(`  n${index - 1} --> n${index}`);
  });
  return `${lines.join('\n')}\n`;
}

const byKey = new Map(filled.rowJoins.map((row) => [`${row.adapterId}|${row.fieldId}`, row]));
let touched = 0;
for (const row of filled.rowJoins) {
  if (row.fieldId.startsWith('field.contract.')) throw new Error('leaf in row join');
  const fieldPath = row.fieldId.slice('field.'.length);
  const adapter = row.adapterId.slice('adapter.'.length);
  const file = join(ROOT, 'audit/godview/evidence', adapter, `${fieldPath}.json`);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  if (record.fieldId !== row.fieldId || record.adapterId !== row.adapterId) throw new Error(`id ${file}`);
  if (record.pins.puppeteer !== SHA || record.pins.vibefield !== VF) throw new Error(`pins ${file}`);
  record.classification = row.classification;
  const field = fields.get(row.fieldId);
  const directViews = [...new Set((field?.rendererConsumers ?? []).map((item) => item.view))];
  if (directViews.length) {
    record.renderer.viewIds = directViews;
    record.renderer.component = 'direct reader';
    record.renderer.symbol = field.directRendererStatus;
    record.applicability.views = directViews;
  } else if (row.indirectUiReachable === 'yes') {
    record.renderer.viewIds = [];
    record.renderer.component = 'indirect only';
    record.renderer.symbol = 'no direct builtin reader';
    record.applicability.views = 'all-monitor-views';
  } else {
    record.renderer.viewIds = [];
    record.renderer.component = 'no direct reader';
    record.renderer.symbol = 'no direct builtin reader';
    record.applicability.views = 'all-monitor-views';
  }
  if (record.fieldId.startsWith('field.cost')) {
    const adapterSteps = record.transforms.filter((item) => !/PENDING|priceUsageUpdates|costOf omits/i.test(item.effect));
    const ordered = [
      ...adapterSteps,
      {
        order: 0,
        name: 'runtime-priceUsageUpdates-before-reduce',
        effect: 'Runtime priceUsageUpdates runs before reduceMonitorAccumulator. Reported nonnegative costUsd, including zero, wins. Otherwise exact catalog pricing. A failed estimate writes no costUsd.',
        source: pricing,
      },
      {
        order: 0,
        name: 'catalog-or-provider-cost',
        effect: map.common.pricing.effect,
        source: pricingRules,
      },
      {
        order: 0,
        name: 'core-reduce-copies-costUsd',
        effect: 'After pricing, reduce copies costUsd onto the monitor usage value. It does not price.',
        source: reduceUsage,
      },
      {
        order: 0,
        name: 'backend-costOf',
        effect: 'costOf returns no cost object when history.total is undefined. That is cost_missing, not a present coverage of unavailable.',
        source: backendCost,
      },
    ];
    record.transforms = ordered.map((item, order) => ({ ...item, order }));
    for (const extra of [pricing, pricingRules, reduceUsage, backendCost]) {
      if (!record.sources.some((item) => item.path === extra.path && item.lineStart === extra.lineStart)) record.sources.push(extra);
    }
  }
  if (record.adapterId === 'adapter.claude' && record.fieldId === 'field.tokens.total') {
    record.transforms.push({
      order: record.transforms.length,
      name: 'canonical-total-to-cumulative',
      effect: map.claudeTotalTokensJoin.explanation,
      source: tokenChain[1],
    });
    for (const extra of tokenChain) {
      if (!record.sources.some((item) => item.path === extra.path && item.lineStart === extra.lineStart)) record.sources.push(extra);
    }
  }
  const lead = `Shared continuation joined from Vibefield audit/godview-model ${MAP_COMMIT}, built on join 5195c56. Direct reader: ${row.directRendererReachable}. Indirect UI: ${row.indirectUiReachable}. Source-read only, not a live sample. Map counts are not proof.`;
  record.verification.notes = `${lead} ${clean(record.verification.notes)}`;
  record.applicability.notes = record.verification.notes;
  record.observation.synthetic = false;
  if (record.observation.presence === 'present') record.observation.presence = 'unknown';
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(file.replace(/\.json$/u, '.mmd'), graph(record, row, field));
  touched += 1;
}

filled.sharedMapCommit = MAP_COMMIT;
filled.spotCheck = {
  status: 'critical hops re-read at 748d015; map counts not treated as proof',
  hops: ['usage-index.ts:110-124', 'usage-index.ts:345-366', 'usage-index.ts:545-550', 'derive.ts:198-207', 'monitor-service.ts:418-425', 'usage-pricing.ts:19-78', 'reduce.ts:1049-1073', 'backend.ts:197-205'],
};
filled.unresolvedGaps = map.unresolvedGaps;
writeFileSync(join(ROOT, 'audit/godview/plan/gv-audit3-join.json'), `${JSON.stringify(filled, null, 2)}\n`);

const graphDir = join(ROOT, 'audit/godview/plan/graphs/states');
mkdirSync(graphDir, { recursive: true });
for (const state of map.states) {
  const evidence = state.source?.file ? `${state.source.file}:${state.source.line}` : state.pathId;
  writeFileSync(
    join(graphDir, `${state.stateId}.mmd`),
    `%% graph_ref: ${state.pathId}\n%% state: ${state.stateId}\n%% shared_map: ${MAP_COMMIT}\nflowchart LR\n  pred["${String(state.predicate).replaceAll('"', "'").slice(0, 180)}"]\n  src["${evidence}"]\n  verdict["${String(state.verdict).replaceAll('"', "'").slice(0, 180)}"]\n  src --> pred --> verdict\n`,
  );
}
console.log(JSON.stringify({ envelopes: touched, states: map.states.length }));
