/** Semantic consistency gate for GV-AUDIT3 row envelopes. Not a regex-only PENDING scan. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const filled = JSON.parse(readFileSync(join(root, 'audit/godview/plan/gv-audit3-join.json'), 'utf8'));
const stateIds = [...new Set(filled.stateReachability.map((state) => state.stateId))].sort((a, b) => b.length - a.length);
const stale = /PENDING DOWNSTREAM|uiReachable stay unknown|mapping is pending|stay unknown/iu;
const failures = [];

function negated(text) {
  const found = new Set();
  const listed = text.match(/Not claimed, and not listed as applicable: ([^.]+)\./u);
  if (listed) {
    for (const part of listed[1].split(',')) {
      const id = part.trim();
      if (id.startsWith('state.')) found.add(id);
    }
  }
  for (const id of stateIds) {
    if (new RegExp(String.raw`(?<![\w.])not ${id}(?![\w.])`, 'u').test(text)) found.add(id);
  }
  return found;
}

if (filled.rowJoins.length !== 370) failures.push(`row joins ${filled.rowJoins.length}`);
if (filled.stateReachability.length !== 410) failures.push(`states ${filled.stateReachability.length}`);
const rowIds = new Set(filled.rowJoins.map((row) => row.fieldId));
if (rowIds.size !== 74 || [...rowIds].some((id) => id.startsWith('field.contract.'))) {
  failures.push('row id set is not the 74 canonical fields');
}

for (const row of filled.rowJoins) {
  const adapter = row.adapterId.slice('adapter.'.length);
  const record = JSON.parse(
    readFileSync(join(root, 'audit/godview/evidence', adapter, `${row.fieldId.slice('field.'.length)}.json`), 'utf8'),
  );
  const notes = record.verification.notes;
  if (notes !== record.applicability.notes) failures.push(`${record.recordId} notes diverge`);
  if (record.classification.uiReachable === 'yes' && stale.test(notes)) {
    failures.push(`${record.recordId} uiReachable yes contradicts stale unknown or pending text`);
  }
  if (
    record.classification.adapterEmittable === 'yes' &&
    notes.includes('Current producers do not produce this row field')
  ) {
    failures.push(`${record.recordId} emittable yes but notes deny production`);
  }
  if (
    record.classification.adapterEmittable === 'no' &&
    notes.includes('The traced source path can produce this row field')
  ) {
    failures.push(`${record.recordId} emittable no but notes claim production`);
  }
  const claimed = Array.isArray(record.applicability.states) ? new Set(record.applicability.states) : new Set();
  for (const id of negated(notes)) {
    if (claimed.has(id)) failures.push(`${record.recordId} lists negated ${id}`);
  }
  const applicable = new Set((row.stateReachability ?? []).filter((item) => item.applicable).map((item) => item.stateId));
  if (Array.isArray(record.applicability.states) && [...claimed].sort().join() !== [...applicable].sort().join()) {
    failures.push(`${record.recordId} applicability does not match stateReachability`);
  }
  if (record.pins.puppeteer !== '748d015a7e393112e0a91dad80111fdf5abe6583') {
    failures.push(`${record.recordId} pin`);
  }
  if (record.classification.uiReachable === 'yes' && row.rendererRead !== 'direct') {
    failures.push(`${record.recordId} uiReachable yes without a direct reader`);
  }
  if (
    record.classification.uiReachable === 'yes' &&
    record.classification.adapterEmittable === 'no' &&
    !row.alternateProducer
  ) {
    failures.push(`${record.recordId} uiReachable yes from a reader with no alternate producer`);
  }
  if (record.classification.uiReachable === 'yes' && row.adapterPathProvidesValue === 'no' && !row.alternateProducer) {
    failures.push(`${record.recordId} uiReachable yes although the adapter path provides no value`);
  }
  const graph = readFileSync(
    join(root, 'audit/godview/evidence', adapter, `${row.fieldId.slice('field.'.length)}.mmd`),
    'utf8',
  );
  if (row.fieldId === 'field.status' && /priceUsageUpdates|usage-pricing/.test(graph)) {
    failures.push(`${record.recordId} status graph includes a cost pricing step`);
  }
  if (
    ['acp', 'antigravity', 'copilot'].includes(adapter) &&
    row.fieldId.startsWith('field.cost') &&
    record.transforms.some((item) => item.name === 'price-before-reduce' || item.source.path.endsWith('usage-pricing.ts'))
  ) {
    failures.push(`${record.recordId} invents a pricing hop through an omitted usage signal`);
  }
  for (const item of record.transforms) {
    if (/monitor-capabilities\.ts$/.test(item.source.path) && /handler|reads used and size|does not emit/.test(item.effect)) {
      failures.push(`${record.recordId} transform effect is paired with a capability declaration`);
    }
  }
  if (record.transport.name === 'not-applicable' && !(row.notApplicableReason && row.notApplicableReason.length > 12)) {
    failures.push(`${record.recordId} not-applicable transport lacks notApplicableReason`);
  }
  const scopes = ['adapter-provided', 'common-runtime', 'host-supplied', 'replica-derived', 'absent'];
  if (!scopes.includes(row.sourceScope)) failures.push(`${record.recordId} missing sourceScope`);
  if (!row.sourceRef || !row.staticPresence || row.liveObserved !== false) {
    failures.push(`${record.recordId} staticPresence or liveObserved is missing`);
  }
  if (row.uiPathVerdict !== record.classification.uiReachable) {
    failures.push(`${record.recordId} uiPathVerdict disagrees with classification`);
  }
  if (row.uiReachabilityScope) failures.push(`${record.recordId} still has a global uiReachabilityScope`);
  if (record.classification.uiReachable === 'yes' && record.classification.adapterEmittable === 'no') {
    if (!['host-supplied', 'common-runtime', 'replica-derived'].includes(row.sourceScope) || !row.sourceRef) {
      failures.push(`${record.recordId} uiReachable yes without a cited non-adapter producer`);
    }
  }
  if (row.sourceScope === 'absent' && record.classification.uiReachable !== 'no') {
    failures.push(`${record.recordId} absent source is uiReachable ${record.classification.uiReachable}`);
  }
  const domain = row.stateDomain ?? [];
  const reachIds = (row.stateReachability ?? []).map((item) => item.stateId);
  if (reachIds.join() !== [...domain].join()) failures.push(`${record.recordId} stateReachability is not the field domain`);
  if (domain.includes('state.effort_observed') && row.fieldId === 'field.observed') {
    failures.push(`${record.recordId} effort_observed is in the observed domain`);
  }
  if (domain.some((id) => id.startsWith('state.branch_')) && row.fieldId !== 'field.project.branch') {
    failures.push(`${record.recordId} branch predicate is outside field.project.branch`);
  }
  const reachableIds = (row.stateReachability ?? []).filter((item) => item.applicable).map((item) => item.stateId);
  if (domain.length === 0) {
    if (record.applicability.states !== 'model-axes') failures.push(`${record.recordId} empty domain is not model-axes`);
    if (!notes.includes('not a reachable set')) failures.push(`${record.recordId} model-axes is not distinguished from a reachable set`);
  } else if (!Array.isArray(record.applicability.states) || record.applicability.states.join() !== reachableIds.join()) {
    failures.push(`${record.recordId} applicability is not the reachable subset`);
  }
  if (!notes.includes(`sourceScope=${row.sourceScope}`) || !notes.includes(`staticPresence=${row.staticPresence}`) || !notes.includes('liveObserved=false')) {
    failures.push(`${record.recordId} notes omit structured scope`);
  }
  if (row.fieldId === 'field.stale' && reachableIds.join() !== 'state.stale,state.fresh,state.device_stale') {
    failures.push(`${record.recordId} stale domain is not the three freshness predicates`);
  }
  if (row.fieldId === 'field.account') {
    if (record.classification.uiReachable !== 'no' || row.staticPresence !== 'host-dependent') {
      failures.push(`${record.recordId} account is not the Vibefield-consumer host scope`);
    }
    if (row.hostScopes?.vibefield?.account !== 'unreachable') failures.push(`${record.recordId} vibefield account scope`);
    const expected = row.adapterId === 'adapter.acp' ? 'unreachable' : 'profile-label-when-bound';
    if (row.hostScopes?.puppeteerGodview?.account !== expected) failures.push(`${record.recordId} puppeteer account scope`);
  }
  if (row.fieldId === 'field.status' && !graph.includes('window-rows.ts')) {
    failures.push(`${record.recordId} status graph omits window-rows`);
  }
  if (row.fieldId.startsWith('field.cost') && ['adapter.claude', 'adapter.codex'].includes(row.adapterId)) {
    assertPricedCostGraph(record.recordId, graph);
    const counts = record.transforms.find((item) => item.name === 'ledger-counts');
    const decision = record.transforms.find((item) => item.name === 'coverage-decision');
    const history = record.transforms.find((item) => item.name === 'history-aggregate');
    const names = record.transforms.map((item) => item.name);
    const at = (name) => names.indexOf(name);
    if (!counts || !/only when canonical or pricing or cost is truthy/.test(counts.effect) || !/does not increment unpricedCount/.test(counts.effect)) {
      failures.push(`${record.recordId} ledger transform lacks the guarded unpriced branch`);
    }
    if (!decision || !/pricedCount > 0 and unpricedCount = 0/.test(decision.effect) || !/pricedCount > 0 and unpricedCount > 0/.test(decision.effect)) {
      failures.push(`${record.recordId} coverage transform lacks the count predicate`);
    }
    if (!history || !/no retained run has costUsd/.test(history.effect)) {
      failures.push(`${record.recordId} history transform omits the retained-total rule`);
    }
    const order = ['reduce-after-price', 'usage-index-stream', 'ledger-counts', 'coverage-decision', 'project-usage', 'history-aggregate', 'row-cost', 'derive-cost'];
    let previous = -1;
    for (const name of order) {
      const index = at(name);
      if (index < 0 || index < previous) failures.push(`${record.recordId} transform order breaks at ${name}`);
      previous = index;
    }
  }
  if (row.fieldId.startsWith('field.cost') && ['adapter.acp', 'adapter.antigravity', 'adapter.copilot'].includes(row.adapterId)) {
    if (graph.includes('priceUsageUpdates')) failures.push(`${record.recordId} omission graph still runs pricing`);
  }
}

function assertPricedCostGraph(label, graph) {
  const order = [
    'reduce.ts:1049-1073',
    'usage-index.ts:210-223',
    'cost.ts:21-40',
    'cost.ts:59-101',
    'project.ts:417',
    'usage-ledger.ts:62-82',
    'backend.ts:197-205',
    'derive.ts:277',
    'replica.ts',
    'window-rows.ts',
  ];
  let at = -1;
  for (const needle of order) {
    const next = graph.indexOf(needle);
    if (next < 0 || next < at) failures.push(`${label} chronological order missing or early: ${needle}`);
    at = Math.max(at, next);
  }
  if (!graph.includes('only when canonical or pricing or cost is truthy')) failures.push(`${label} lacks the guarded unpriced branch`);
  if (!graph.includes('does not increment unpricedCount')) failures.push(`${label} lacks the skipped noncanonical sample`);
  if (!graph.includes('no retained run has costUsd')) failures.push(`${label} omits the retained-total rule`);
  if (!graph.includes('costRatePerMin') || !graph.includes('acrossEpochs accumulate') || !graph.includes('acrossEpochs current')) {
    failures.push(`${label} does not separate current costRate from the acrossEpochs sum`);
  }
  if (/otherwise unpricedCount|unpriced zero|both positive|no priced total/u.test(graph)) {
    failures.push(`${label} still uses an unconditional unpriced or zero-total predicate`);
  }
}

assertPricedCostGraph('cost-priced.mmd', readFileSync(join(root, 'audit/godview/plan/graphs/cost-priced.mmd'), 'utf8'));
console.log(JSON.stringify({ contradictions: failures.length, failures: failures.slice(0, 20) }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
