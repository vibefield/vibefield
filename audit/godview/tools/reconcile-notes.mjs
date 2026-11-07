/**
 * Replace row notes and applicability.states so they match the joined verdicts.
 * Does not append onto the old contradictory text.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const map = JSON.parse(readFileSync(process.env.DOWNSTREAM_MAP, 'utf8'));
const joinPath = join(ROOT, 'audit/godview/plan/gv-audit3-join.json');
const filled = JSON.parse(readFileSync(joinPath, 'utf8'));
const fields = new Map(map.fields.map((field) => [field.fieldId, field]));
const SHA = '748d015a7e393112e0a91dad80111fdf5abe6583';

function views(field) {
  return [...new Set((field?.rendererConsumers ?? []).map((item) => item.view))];
}

function prose(record, row, field, reachable, negated) {
  const direct = views(field);
  const ui =
    row.directRendererReachable === 'yes'
      ? `Direct readers: ${direct.join(', ') || 'listed in the shared map'}.`
      : row.indirectUiReachable === 'yes'
        ? 'No direct builtin reader. An indirect visual or control effect is recorded in the shared map.'
        : 'No direct or indirect builtin reader was found for this row field.';
  const emit =
    record.classification.adapterEmittable === 'yes'
      ? 'The traced source path can produce this row field. That is conditional and is not a live sample.'
      : record.classification.adapterEmittable === 'no'
        ? 'Current producers do not produce this row field. A later or host producer is not ruled out.'
        : 'Whether this adapter path produces the row field was not closed.';
  const reach = reachable.length
    ? `Reachable predicates for this adapter path: ${reachable.join(', ')}.`
    : 'No source-permitted predicate from this field domain is claimed for this adapter.';
  const omit = negated.length
    ? `Not claimed, and not listed as applicable: ${negated.join(', ')}.`
    : '';
  const cost =
    record.fieldId.startsWith('field.cost')
      ? 'Runtime priceUsageUpdates runs before reduce. The normal backend omits field.cost when there is no priced total, so a present coverage of unavailable is not the row result.'
      : '';
  const tokens =
    record.adapterId === 'adapter.claude' && record.fieldId === 'field.tokens.total'
      ? 'Claude totalTokens is summed into cumulativeTokens at usage-index.ts:110-124 and 345-366, published at 545-550, and copied by derive.ts:198-207. No builtin view reads tokens.total.'
      : '';
  return [
    `Shared continuation ${row.downstreamMapping} from Vibefield audit/godview-model 07e71c9bcb9532fc181e3f667f2d0ed2e7c9afaf, input join 5195c56.`,
    'Source-read at Puppeteer 748d015a7e393112e0a91dad80111fdf5abe6583. Not a live session. Map counts are not proof; the cited hops were re-read.',
    emit,
    ui,
    cost,
    tokens,
    reach,
    omit,
  ]
    .filter(Boolean)
    .join(' ');
}

let rows = 0;
for (const row of filled.rowJoins) {
  const field = fields.get(row.fieldId);
  const adapter = row.adapterId;
  const domain = (field?.stateIds ?? []).filter((id) =>
    filled.stateReachability.some((state) => state.adapterId === adapter && state.stateId === id),
  );
  const verdictOf = (stateId) =>
    filled.stateReachability.find((state) => state.adapterId === adapter && state.stateId === stateId);
  const reachable = domain.filter((id) => String(verdictOf(id)?.verdict ?? '').startsWith('source-permitted'));
  const negated = domain.filter((id) => String(verdictOf(id)?.verdict ?? '').startsWith('absent'));
  const file = join(ROOT, 'audit/godview/evidence', adapter.slice('adapter.'.length), `${row.fieldId.slice('field.'.length)}.json`);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.classification = row.classification;
  const text = prose(record, row, field, reachable, negated);
  const finalText = reachable.length
    ? text
    : `${text} No field-domain predicate is claimed as source-permitted here.`;
  record.verification.notes = finalText;
  record.applicability.notes = finalText;
  record.applicability.states = reachable.length ? reachable : 'model-axes';
  record.observation.synthetic = false;
  if (record.classification.adapterEmittable === 'no' && record.fieldId.startsWith('field.cost')) {
    record.observation.presence = 'absent';
  } else if (record.observation.presence === 'present') {
    record.observation.presence = 'unknown';
  }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  row.stateDomain = domain;
  row.stateReachability = domain.map((id) => ({
    stateId: id,
    verdict: verdictOf(id)?.verdict ?? 'unknown',
    applicable: reachable.includes(id),
  }));
  rows += 1;
}
writeFileSync(joinPath, `${JSON.stringify(filled, null, 2)}\n`);
console.log(JSON.stringify({ rows, sha: SHA }));
