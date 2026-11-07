/**
 * First-half Godview monitor evidence at Puppeteer 748d015 only.
 * Row and contract fields the adapter does not write are recorded as not adapter-produced.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveField, resolveState } from './resolve.mjs';

const SHA = '748d015a7e393112e0a91dad80111fdf5abe6583';
const VIBEFIELD = '433505fd0f224f4cda540d642661b13848c0ef82';
const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const SCHEMA_PATH = process.env.MODEL_SCHEMA ?? '/tmp/model.schema.json';
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const audit = schema['x-audit'];
if (audit.pins.puppeteer !== SHA) throw new Error('schema pin is not 748d015');

const OWNED = ['acp', 'antigravity', 'claude', 'codex', 'copilot'];
const SECOND = ['grok', 'hermes', 'kimi', 'opencode', 'pi'];

const blob = (file, start, end) =>
  `https://github.com/vibefield/puppeteer/blob/${SHA}/${file}#L${start}-L${end}`;

function span(file, start, end, symbol) {
  const lines = start === end ? `${start}` : `${start}-${end}`;
  return {
    file,
    lines,
    symbol,
    citation: `${file}:${lines}`,
    permalink: blob(file, start, end),
    commit: SHA,
  };
}

const CONSUME = span('packages/runtime/src/services/monitor-service.ts', 176, 187, 'MonitorService.consume');
const DERIVE = span('packages/monitor/src/backend/derive.ts', 240, 286, 'deriveAgentRow');
const REDUCE_TURN = span('packages/core/src/monitor/reduce.ts', 864, 938, 'turn and conversation cases');
const REDUCE_USAGE = span('packages/core/src/monitor/reduce.ts', 1049, 1073, 'usage:tokens-used case');
const REDUCE_CONTEXT = span('packages/core/src/monitor/reduce.ts', 1075, 1103, 'context-window cases');
const REDUCE_MODEL = span('packages/core/src/monitor/reduce.ts', 1117, 1127, 'environment model effort mode cases');
const BURN = span('packages/core/src/monitor/rate.ts', 7, 20, 'projectMonitorUsageLedger');
const PROJECT_BURN = span('packages/core/src/monitor/project.ts', 232, 232, 'burnRatePerMin on projected subagents');

function diverges(file) {
  return (
    file.includes('packages/adapter-codex/src/normalization/monitor') ||
    file.includes('packages/adapter-copilot/src/normalization/monitor') ||
    file.includes('packages/adapter-claude/src/normalization/') ||
    file.includes('packages/core/src/monitor/') ||
    file.includes('packages/runtime/src/services/monitor-service.ts')
  );
}

function flow(steps) {
  const lines = ['flowchart LR'];
  steps.forEach((step, index) => {
    lines.push(`  n${index}["${String(step).replaceAll('"', "'")}"]`);
    if (index) lines.push(`  n${index - 1} --> n${index}`);
  });
  lines.push(`  n${steps.length - 1} --> pending["row mapping pending; GV2"]`);
  return lines.join('\n');
}

const VERSION = {
  implementation: 'post-0.3.3 pinned source',
  source_sha: SHA,
  runtime_parity: false,
  runtime_parity_status: 'unverified-shipped',
  represents_installed_vibefield: false,
  package_comparison: 'context-only-not-audited',
  scope_note:
    'Every trace in this record is Puppeteer source 748d015a7e393112e0a91dad80111fdf5abe6583. That pin is newer than the Vibefield-shipped @vibefield/puppeteer-* 0.3.3 packages. This audit does not trace 0.3.3 and does not describe the installed Vibefield runtime. External context only: GV2 package-pin-check (vibefield audit/godview-model d53a0fa, audit/godview/validation/package-pin-check.md).',
};

function declaration(adapter, family) {
  if (!family) return null;
  const cell = audit.capabilityMatrix?.[`adapter.${adapter}`]?.[family];
  if (!cell) return { family, declared_support: 'undeclared', meaning: 'conversation is not in the ten-adapter capability matrix' };
  return {
    family: cell.family,
    declared_support: cell.support,
    declared_source: cell.source,
    declared_latency: cell.latency,
    limitations: cell.limitations,
    meaning: cell.meaning,
    citation: cell.evidence?.url,
  };
}

function schemaAnchors(field) {
  const raw = field.evidence ? (Array.isArray(field.evidence) ? field.evidence : [field.evidence]) : [];
  const puppeteer = [];
  let skippedVibefield = 0;
  for (const item of raw) {
    if (item.repo !== 'puppeteer' || item.commit !== SHA || !item.file || !item.line) {
      if (item.repo === 'vibefield') skippedVibefield += 1;
      continue;
    }
    const end = item.endLine ?? item.line;
    puppeteer.push({
      ...span(item.file, item.line, end, item.file.split('/').pop()),
      role: 'downstream-anchor-from-gv2-contract',
      semantics_owner: 'GV-AUDIT2',
    });
  }
  return { puppeteer, skippedVibefield };
}

const N = {};

function put(adapter, group, value) {
  N[adapter] ??= {};
  N[adapter][group] = value;
}

function up(spans, extra) {
  return { evidence_spans: spans, ...extra };
}

put('acp', 'activity', up([
  span('packages/adapter-acp/src/normalization/monitor-capabilities.ts', 11, 23, 'status capability'),
  span('packages/adapter-acp/src/normalization/monitor.ts', 207, 256, 'AcpMonitorEvidence.sessionUpdateBatch'),
  span('packages/adapter-acp/src/services/prompt.ts', 50, 84, 'AcpPromptService.submit'),
  span('packages/adapter-acp/src/normalization/tool.ts', 39, 75, 'normalizeAcpTool'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'monitor.ts writes context, model, effort, and mode only. It never writes a status family update.',
    'AcpPromptService mints turn id acp-turn-N and emits turn:started, turn:completed copying stopReason, outcome interrupted only when stopReason is cancelled, or turn:failed with the error string.',
    'normalizeAcpTool emits tool:started for tool_call, plus completed or failed when that status is set. tool_call_update emits only completed or failed. in_progress emits no tool event.',
  ],
  emitted_as: {
    channel: 'agent-event',
    row_property: 'not written',
    events: ['turn:started', 'turn:completed', 'turn:failed', 'tool:started', 'tool:completed', 'tool:failed'],
  },
  states_present: [
    { id: 'adapter.acp.upstream.turn.started', value: 'turn:started', when: 'prompt submit' },
    { id: 'adapter.acp.upstream.turn.completed', value: 'turn:completed', when: 'session/prompt resolves' },
    { id: 'adapter.acp.upstream.turn.interrupted', value: 'interrupted', when: "stopReason === 'cancelled'" },
    { id: 'adapter.acp.upstream.turn.failed', value: 'turn:failed', when: 'session/prompt rejects' },
    { id: 'adapter.acp.upstream.tool.started', value: 'tool:started', when: 'tool_call' },
    { id: 'adapter.acp.upstream.tool.completed', value: 'tool:completed', when: "status completed" },
    { id: 'adapter.acp.upstream.tool.failed', value: 'tool:failed', when: "status failed" },
    { id: 'adapter.acp.upstream.tool.in_progress', value: 'no event', when: 'tool_call_update status in_progress' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['ACP prompt and tool_call', 'turn and tool events', 'no monitor status upsert'],
  notes:
    'Status is declared supported, but the monitor batch never carries a status update. Turn and tool events are the live signals. field.status, field.activity, and field.detail are still backend rows. Mapping is pending. Declared unsupported families do not make idle, working, or blocked impossible.',
}));

put('acp', 'wait', up([
  span('packages/adapter-acp/src/services/approvals.ts', 135, 257, 'AcpApprovalService'),
  span('packages/adapter-acp/src/services/elicitation.ts', 24, 83, 'AcpElicitationService'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'requestPermission publishes interaction:permission-requested. presentation is native-tui only when there is no decide handler and unhandled is defer; otherwise host-ui.',
    'Host approved becomes allowed and denied becomes denied. No handler and not defer resolves denied immediately.',
    'tool_call_update in_progress or completed settles that call as allowed. Prompt end, transport close, dispose, and a repeated request settle unknown.',
    'Elicitation publishes question-requested. Accept on a non-url form publishes answered. URL accept waits for complete. decline and cancel publish cancelled. Missing responder defaults to decline. Other actions and throws publish failed. Prompt success settles pending URL elicitations as superseded; prompt failure settles failed.',
  ],
  emitted_as: {
    channel: 'agent-event',
    row_property: 'not written',
    events: ['interaction:permission-requested', 'interaction:permission-resolved', 'interaction:question-requested', 'interaction:question-resolved'],
  },
  states_present: [
    { id: 'adapter.acp.upstream.permission.allowed', value: 'allowed', when: 'approved decision or tool progress' },
    { id: 'adapter.acp.upstream.permission.denied', value: 'denied', when: 'denied decision or default unhandled deny' },
    { id: 'adapter.acp.upstream.permission.unknown', value: 'unknown', when: 'supersede, prompt end, transport close, dispose' },
    { id: 'adapter.acp.upstream.permission.host-ui', value: 'host-ui', when: 'decide handler present or unhandled is not defer' },
    { id: 'adapter.acp.upstream.permission.native-tui', value: 'native-tui', when: 'no decide handler and unhandled defer' },
    { id: 'adapter.acp.upstream.question.answered', value: 'answered', when: 'form accept or URL complete' },
    { id: 'adapter.acp.upstream.question.cancelled', value: 'cancelled', when: 'decline, cancel, or missing responder' },
    { id: 'adapter.acp.upstream.question.failed', value: 'failed', when: 'other action, throw, or prompt failure' },
    { id: 'adapter.acp.upstream.question.superseded', value: 'superseded', when: 'prompt success settles pending URL elicitations' },
  ],
  anchors: [CONSUME, span('packages/core/src/monitor/reduce.ts', 974, 1024, 'permission and question cases')],
  steps: ['ACP permission or elicitation', 'interaction events', 'row wait not written here'],
  notes:
    'The permission schema also allows dismissed. This package does not hardcode dismissed; a composing adapter can pass it through deferredEvidence. field.wait is not written by the adapter. Which blocker becomes field.wait.kind is pending.',
}));

put('acp', 'model', up([
  span('packages/adapter-acp/src/normalization/model.ts', 8, 25, 'acpModelIdentity / normalizeAcpModel'),
  span('packages/adapter-acp/src/normalization/monitor.ts', 62, 78, 'configUpdates model'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'Identity is the select config option with category model. providerModelId is currentValue. displayName is the matching choice name when present.',
    'A config_option_update with no model selector retracts monitor key observed. The pipeline instead emits adapter:native-event and does not retract.',
    'Monitor intent is always the literal observed. The pipeline model:updated omits intent.',
  ],
  emitted_as: {
    channel: 'both',
    row_property: 'not written',
    monitor: "upsert model key observed, or retract observed",
    event: 'model:updated.model.id',
  },
  states_present: [
    { id: 'adapter.acp.upstream.model.present', value: 'currentValue', when: 'model select has currentValue' },
    { id: 'adapter.acp.upstream.model.retract', value: 'retract observed', when: 'full config set has no model selector' },
    { id: 'adapter.acp.upstream.model.intent', value: 'observed', when: 'monitor upsert only' },
    { id: 'adapter.acp.upstream.model.display.omitted', value: 'displayName omitted', when: 'no matching choice name' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['ACP model config option', 'monitor upsert or retract and model:updated', 'row model string pending'],
  notes:
    'field.model is a single string chosen downstream. This adapter emits id and an optional display name on two channels that do not agree about retract or intent. The row choice is pending.',
}));

put('acp', 'effort', up([
  span('packages/adapter-acp/src/normalization/monitor.ts', 57, 98, 'currentConfigValue thought_level'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'thought_level select uses trimmed currentValue. Boolean options use String(currentValue). Other types are ignored.',
    'If no thought_level value is kept, the monitor batch retracts effort key observed.',
    'The pipeline config path calls normalizeAcpModel only and does not emit effort:updated.',
    'intent on the upsert is the literal observed. No closed effort enum is applied.',
  ],
  emitted_as: { channel: 'monitor:batch', row_property: 'not written', property: 'effort value, intent observed, or retract' },
  states_present: [
    { id: 'adapter.acp.upstream.effort.value', value: 'open string', when: 'thought_level current value' },
    { id: 'adapter.acp.upstream.effort.intent', value: 'observed', when: 'upsert' },
    { id: 'adapter.acp.upstream.effort.retract', value: 'retract observed', when: 'no thought_level in the config set' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['thought_level config', 'monitor effort upsert or retract', 'no effort:updated event'],
  notes: 'field.effort.value and field.effort.intent are row fields. Only the monitor batch carries effort. Last matching thought_level wins because each match upserts the same key.',
}));

put('acp', 'context', up([
  span('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'usage_update context upsert'),
  span('packages/adapter-acp/src/normalization/context-window.ts', 6, 19, 'normalizeAcpContextWindow'),
], {
  support: 'supported',
  classifications: ['supported', 'zero'],
  declaration_mismatch: false,
  transforms: [
    'usage_update.used and size are context occupancy, not usage-family tokens.',
    'finiteNonNegative keeps 0 and drops NaN and negatives. capacityTokens is kept only when size > 0.',
    'The monitor upsert is emitted when either used or positive size is present. percentageSource is derived only when both are present, otherwise unavailable.',
    'The pipeline emits context-window:updated only when both used >= 0 and size > 0. Otherwise it emits adapter:native-event.',
  ],
  emitted_as: {
    channel: 'both',
    row_property: 'not written',
    monitor: 'context.usedTokens and context.capacityTokens, key root',
    event: 'context-window:updated usedTokens and capacityTokens',
  },
  states_present: [
    { id: 'adapter.acp.upstream.context.used', value: 'non-negative number including 0', when: 'used parses' },
    { id: 'adapter.acp.upstream.context.used.omitted', value: 'usedTokens omitted', when: 'used missing or invalid while size > 0 still emits on the monitor path' },
    { id: 'adapter.acp.upstream.context.capacity', value: 'positive number', when: 'size > 0' },
    { id: 'adapter.acp.upstream.context.percentageSource.derived', value: 'derived', when: 'both sides present' },
    { id: 'adapter.acp.upstream.context.percentageSource.unavailable', value: 'unavailable', when: 'only one side present' },
  ],
  anchors: [CONSUME, REDUCE_CONTEXT],
  steps: ['ACP usage_update', 'context tokens', 'percentage number not set'],
  notes: 'The two producers disagree when only one of used or size is valid. Units are tokens. There is no adapter poll; each usage_update is pushed.',
}));

put('acp', 'context-percent', up([
  span('packages/adapter-acp/src/normalization/monitor.ts', 222, 227, 'percentageSource without usedPercentage'),
  span('packages/adapter-acp/src/normalization/context-window.ts', 17, 17, 'context-window event fields'),
], {
  support: 'absent',
  classifications: ['absent', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['Neither producer assigns usedPercentage. percentageSource derived does not mean a percent was calculated here.'],
  emitted_as: { channel: 'none', row_property: 'not written', property: 'usedPercentage' },
  states_present: [{ id: 'adapter.acp.upstream.usedPercentage.absent', value: 'absent', when: 'usage_update handlers' }],
  anchors: [REDUCE_CONTEXT, DERIVE],
  steps: ['usage_update', 'no usedPercentage', 'row usedPercent pending'],
  notes:
    'Context is declared supported. The percentage number is not an adapter emission. A shared reducer case can derive one from tokens; that formula is not restated here and is not field.context.usedPercent until GV2 maps it.',
}));

put('acp', 'tokens', up([
  span('packages/adapter-acp/src/normalization/monitor-capabilities.ts', 24, 35, 'usage capability'),
  span('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'usage_update routed to context'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent'],
  declaration_mismatch: false,
  transforms: ['No usage family update and no usage:tokens-used event. used is context occupancy.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.acp.upstream.tokens.absent', value: 'absent', when: 'usage family' }],
  anchors: [CONSUME],
  steps: ['declared usage unsupported', 'no token ledger'],
  notes: 'Aligned with the unsupported declaration. That does not forbid field.tokens from another host or runtime source.',
}));

put('acp', 'burn', up([
  span('packages/adapter-acp/src/normalization/monitor-capabilities.ts', 31, 34, 'no token-burn ledger'),
  BURN,
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent', 'pending'],
  declaration_mismatch: false,
  transforms: ['No delta, cumulative usage counter, or per-minute rate is written.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.acp.upstream.burn.absent', value: 'absent', when: 'adapter emission' }],
  anchors: [BURN, PROJECT_BURN],
  steps: ['no usage samples', 'no adapter burn rate'],
  notes: 'field.tokens.perMinute is a downstream ledger rate. This adapter does not feed it.',
}));

put('acp', 'cost', up([
  span('packages/adapter-acp/src/normalization/monitor-capabilities.ts', 31, 34, 'cost mentioned, not parsed'),
  span('packages/adapter-acp/src/normalization/monitor.ts', 216, 228, 'usage_update reads used and size only'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['The usage_update handler reads used and size only. No cost property is copied.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.acp.upstream.cost.absent', value: 'absent', when: 'parser' }],
  anchors: [DERIVE],
  steps: ['limitation mentions monetary cost', 'parser ignores it'],
  notes:
    'The capability limitation says ACP 1.2.1 exposes cumulative monetary cost, but this package never reads a cost field. No SDK typings were installed in this checkout, so the wire name stays unverified. Absence here is not a ban on field.cost from elsewhere.',
}));

put('acp', 'project', up([
  span('packages/adapter-acp/src/driver.ts', 242, 244, 'environment:updated currentCwd'),
  span('packages/adapter-acp/src/normalization/monitor.ts', 193, 196, 'bootstrap environment cwd'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: ['Session setup cwd is copied to environment:updated.currentCwd and to a monitor environment upsert. Git and a project name are not set.'],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'cwd string' },
  states_present: [{ id: 'adapter.acp.upstream.cwd', value: 'options.cwd', when: 'session/new or session/load bootstrap' }],
  anchors: [CONSUME, REDUCE_MODEL, DERIVE],
  steps: ['session cwd', 'environment event and monitor cwd', 'project name pending'],
  notes: 'field.project.name is not the cwd string. Basename and fallback rules live in the backend. This record does not restate them.',
}));

put('acp', 'reply', up([
  span('packages/adapter-acp/src/normalization/conversation.ts', 12, 26, 'AcpConversationNormalizer.normalize'),
  span('packages/adapter-acp/src/services/prompt.ts', 35, 47, 'sealReplayedAssistant'),
], {
  support: 'derived',
  classifications: ['derived', 'history-retained', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'Only text content blocks are accumulated per messageId. Non-text blocks add an empty string.',
    'Each agent_message_chunk emits conversation:assistant-message with final false and displayOnly false. user_message_chunk emits nothing because the prompt path already started the turn.',
    'After session/load, sealReplayedAssistant republishes the accumulated text with final true and confidence derived.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'conversation:assistant-message' },
  states_present: [
    { id: 'adapter.acp.upstream.reply.chunk', value: 'final false', when: 'live agent_message_chunk' },
    { id: 'adapter.acp.upstream.reply.sealed', value: 'final true, confidence derived', when: 'session/load seal' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['agent_message_chunk', 'accumulated assistant text', 'row reply pending'],
  notes: 'conversation is not a declared monitor family. The load seal is retained history, not a new live model signal. field.reply.at is not set on these events.',
}));

put('antigravity', 'activity', up([
  span('packages/adapter-antigravity/src/normalization/monitor.ts', 25, 66, 'empty monitor updates'),
  span('packages/adapter-antigravity/src/normalization/pipeline.ts', 49, 96, 'USER_INPUT PLANNER_RESPONSE ERROR_MESSAGE'),
  span('packages/adapter-antigravity/src/normalization/turn.ts', 1, 15, 'turn helpers'),
  span('packages/adapter-antigravity/src/observation/session-observer.ts', 180, 180, 'default poll 100ms'),
], {
  support: 'derived',
  classifications: ['derived', 'history-retained', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'Monitor batches always leave updates empty. They publish capabilities or a degraded coverage notice.',
    'USER_INPUT starts turn id turn:<step>. PLANNER_RESPONSE with string content completes it with stopReason planner-response. ERROR_MESSAGE fails the current or step turn.',
    'The transcript record confidence is derived because the turn join is synthesized. CHECKPOINT does not end a turn.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', events: ['turn:started', 'turn:completed', 'turn:failed'] },
  states_present: [
    { id: 'adapter.antigravity.upstream.turn.started', value: 'turn:started', when: 'USER_INPUT' },
    { id: 'adapter.antigravity.upstream.turn.completed', value: 'turn:completed', when: 'PLANNER_RESPONSE content is a string' },
    { id: 'adapter.antigravity.upstream.turn.stop', value: 'planner-response', when: 'completed stopReason' },
    { id: 'adapter.antigravity.upstream.turn.failed', value: 'turn:failed', when: 'ERROR_MESSAGE' },
    { id: 'adapter.antigravity.upstream.confidence', value: 'derived', when: 'every transcript record' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['transcript jsonl', 'synthesized turn', 'empty monitor updates'],
  notes: 'Declared status is degraded and file-flush. The code matches the missing explicit turn-end, and still does not emit a monitor status value. Poll default is 100ms when pollIntervalMs is omitted. Replay of the journal is history.',
}));

put('antigravity', 'model', up([
  span('packages/adapter-antigravity/src/driver.ts', 166, 170, 'model:updated configured'),
  span('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 36, 'transcript has no model read'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['If options.model is set, adopt publishes model:updated intent configured. The transcript normalizer does not read a model. The monitor batch does not upsert model.'],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'model:updated intent configured' },
  states_present: [
    { id: 'adapter.antigravity.upstream.model.configured', value: 'configured', when: 'options.model is truthy' },
    { id: 'adapter.antigravity.upstream.model.absent', value: 'no event', when: 'options.model omitted' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['launch options.model', 'configured model event', 'no transcript model'],
  notes: 'The declaration says the configured model is known and the transcript does not report the effective model. That matches. There is no display name and no observed intent. Refresh is once at adopt.',
}));

put('antigravity', 'effort', up([
  span('packages/adapter-antigravity/src/driver.ts', 21, 21, 'effort option union'),
  span('packages/adapter-antigravity/src/driver.ts', 171, 175, 'effort:updated configured'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['Publish only when options.effort is set. The value is passed through. The transcript does not parse effort. The publish site does not revalidate the union.'],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'effort:updated intent configured' },
  states_present: [
    { id: 'adapter.antigravity.upstream.effort.low', value: 'low', when: 'option union' },
    { id: 'adapter.antigravity.upstream.effort.medium', value: 'medium', when: 'option union' },
    { id: 'adapter.antigravity.upstream.effort.high', value: 'high', when: 'option union' },
    { id: 'adapter.antigravity.upstream.effort.absent', value: 'no event', when: 'option omitted' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['options.effort', 'configured effort event'],
  notes: 'Declared degraded because the transcript does not report changes. The option type lists low, medium, and high. No later effort event was found.',
}));

put('antigravity', 'context', up([
  span('packages/adapter-antigravity/src/normalization/monitor-capabilities.ts', 24, 32, 'context capability'),
  span('packages/adapter-antigravity/src/normalization/pipeline.ts', 86, 88, 'CHECKPOINT retained'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent'],
  declaration_mismatch: false,
  transforms: ['No context-window event. CHECKPOINT is retained-native and is not context evidence.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.antigravity.upstream.context.absent', value: 'absent', when: 'transcript normalizer' }],
  anchors: [DERIVE],
  steps: ['transcript', 'no occupancy'],
  notes: 'Declared unsupported. That does not forbid field.context from another producer.',
}));

put('antigravity', 'context-percent', N.antigravity.context);
put('antigravity', 'tokens', up([
  span('packages/adapter-antigravity/src/normalization/monitor-capabilities.ts', 15, 23, 'usage capability'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent'],
  declaration_mismatch: false,
  transforms: ['No usage:tokens-used event and no token field read.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.antigravity.upstream.tokens.absent', value: 'absent', when: 'driver and transcript' }],
  anchors: [DERIVE],
  steps: ['no token record'],
  notes: 'Declared unsupported. Not a ban on field.tokens from host or runtime evidence.',
}));
put('antigravity', 'burn', up([
  span('packages/adapter-antigravity/src/normalization/monitor-capabilities.ts', 15, 23, 'usage capability'),
  BURN,
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent', 'pending'],
  declaration_mismatch: false,
  transforms: ['No usage samples, so this adapter supplies no burn input.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.antigravity.upstream.burn.absent', value: 'absent', when: 'adapter emission' }],
  anchors: [BURN],
  steps: ['no samples', 'no rate'],
  notes: 'field.tokens.perMinute is not computed here.',
}));
put('antigravity', 'cost', up([
  span('packages/adapter-antigravity/src/normalization/monitor-capabilities.ts', 15, 23, 'usage capability'),
  span('packages/adapter-antigravity/src/normalization/pipeline.ts', 21, 36, 'transcript normalizer'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent'],
  declaration_mismatch: false,
  transforms: ['No costUsd, cost_usd, or cost property is read or written. A repository search of this adapter finds no such symbol.'],
  emitted_as: { channel: 'none', row_property: 'not written', property: 'costUsd' },
  states_present: [{ id: 'adapter.antigravity.upstream.costUsd.absent', value: 'absent', when: 'adapter sources' }],
  anchors: [DERIVE],
  steps: ['no costUsd symbol', 'no cost event'],
  notes: 'costUsd is absent. No burn rate is written either. Declared usage unsupported matches the search. That does not create state.cost_missing and does not forbid a later ledger.',
}));
put('antigravity', 'project', up([
  span('packages/adapter-antigravity/src/driver.ts', 162, 165, 'environment:updated currentCwd'),
  span('packages/adapter-antigravity/src/driver.ts', 55, 55, '--project argv'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: true,
  transforms: ['options.cwd is published once as environment:updated. options.project is argv only and is not an event. No git object is published.'],
  emitted_as: { channel: 'agent-event', row_property: 'not written', property: 'currentCwd' },
  states_present: [
    { id: 'adapter.antigravity.upstream.cwd', value: 'options.cwd', when: 'adopt' },
    { id: 'adapter.antigravity.upstream.project.argv', value: 'argv only', when: 'options.project' },
  ],
  anchors: [CONSUME, DERIVE],
  steps: ['launch cwd', 'environment event', 'project name pending'],
  notes: 'The monitor batch does not upsert environment. --project never becomes field.project.',
}));
put('antigravity', 'reply', up([
  span('packages/adapter-antigravity/src/normalization/conversation.ts', 1, 3, 'antigravityAssistantMessage'),
  span('packages/adapter-antigravity/src/normalization/pipeline.ts', 77, 81, 'PLANNER_RESPONSE content'),
], {
  support: 'derived',
  classifications: ['derived', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['String planner content becomes conversation:assistant-message with messageId planner:<step>, final true. The record confidence is derived.'],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'conversation:assistant-message final true' },
  states_present: [
    { id: 'adapter.antigravity.upstream.reply.final', value: true, when: 'planner content is a string' },
    { id: 'adapter.antigravity.upstream.reply.absent', value: 'no message', when: 'planner content is not a string' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['PLANNER_RESPONSE content', 'assistant message', 'row reply pending'],
  notes: 'conversation is undeclared. final true is set by the helper, not by a provider final flag. No reply timestamp is copied onto the event.',
}));

put('claude', 'activity', up([
  span('packages/adapter-claude/src/normalization/monitor.ts', 328, 367, 'childStatusBatch activity'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 48, 52, 'TERMINAL_CHILD_STATUSES and childActivityLine'),
  span('packages/adapter-claude/src/normalization/pipeline.ts', 401, 751, 'ClaudeHookNormalizer hook switch'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'Child status rows emit monitor status activityKind delegating. active is false when a hook has stopped that agent id, when status is idle, or when status is in cancelled, completed, done, failed, stopped. Otherwise active is true, including when status is missing.',
    'The activity line is label, else description, else status, else name, else type, else the literal Subagent active.',
    'Root status is not a monitor status upsert. Hook pipeline emits turn, tool, permission, and question events. Those are a separate channel.',
    'field.activity.since is not set on the child monitor activity. observedAt is the batch timestamp.',
  ],
  emitted_as: {
    channel: 'both',
    row_property: 'not written',
    monitor: 'status activity kind delegating for child tasks',
    events: 'hook turn, tool, and interaction events',
  },
  states_present: [
    { id: 'adapter.claude.upstream.child.activityKind', value: 'delegating', when: 'every child status row' },
    { id: 'adapter.claude.upstream.child.active', value: true, when: 'not hook-stopped, not idle, and not a terminal status' },
    { id: 'adapter.claude.upstream.child.inactive', value: false, when: 'hook stopped, status idle, or terminal status' },
    { id: 'adapter.claude.upstream.child.terminal', value: 'cancelled|completed|done|failed|stopped', when: 'status string compared lowercase' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['status line tasks or hooks', 'child activity or turn events', 'row status pending'],
  notes: 'Declared status is supported via hooks. The monitor writer only emits child activity, not a root status value. Root hook events can still reach the shared reducer. Unified status labels are pending.',
}));

put('claude', 'wait', up([
  span('packages/adapter-claude/src/normalization/interaction.ts', 51, 83, 'question and permission event builders'),
  span('packages/adapter-claude/src/normalization/pipeline.ts', 248, 270, 'question and compaction close outcomes'),
  span('packages/adapter-claude/src/observation/otel/decision.ts', 15, 30, 'normalizeClaudeOtelToolDecision'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: [
    'Permission requests from hooks use presentation native-tui.',
    'Question outcomes this pipeline passes include answered, failed, cancelled, and superseded. claudeQuestionOutcome itself returns answered or cancelled from a cancelled flag.',
    'Permission outcomes the builders accept are allowed, denied, dismissed, and unknown. OTLP tool_decision maps reject plus source user_abort to dismissed, and other rejects to denied.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', events: ['interaction:permission-*', 'interaction:question-*'] },
  states_present: [
    { id: 'adapter.claude.upstream.permission.outcomes', value: 'allowed|denied|dismissed|unknown', when: 'permission resolved builder' },
    { id: 'adapter.claude.upstream.question.outcomes', value: 'answered|failed|cancelled|superseded', when: 'question resolved builder and pipeline closes' },
    { id: 'adapter.claude.upstream.permission.presentation', value: 'native-tui', when: 'hook permission request' },
  ],
  anchors: [CONSUME, span('packages/core/src/monitor/reduce.ts', 974, 1024, 'interaction cases')],
  steps: ['hook or OTLP decision', 'interaction events', 'row wait pending'],
  notes: 'field.wait.tool can be fed by the permission tool string. The row object, count, and since are not written here. OTLP is live only when the usage policy leaves the log endpoint enabled; a decision record is parsed in that same callback.',
}));

put('claude', 'model', up([
  span('packages/adapter-claude/src/observation/status-channel.ts', 124, 148, 'claudeEnvironmentEvents'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 239, 252, 'rootStatusBatch model replace'),
  span('packages/adapter-claude/src/normalization/model.ts', 5, 55, 'hook model and ClaudeRootModelGate'),
  span('packages/adapter-claude/src/observation/otel/model.ts', 11, 16, 'normalizeClaudeOtelModel'),
  span('packages/adapter-claude/src/driver.ts', 634, 638, 'launch configured model'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 368, 378, 'child task model'),
], {
  support: 'degraded',
  classifications: ['supported', 'derived', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'Status line model.id becomes a monitor replace of key observed, intent observed, plus display name when present. That monitor write is not passed through ClaudeRootModelGate.',
    'The parallel model:updated event is published only when admitStatusLine says the card changed. admitHook drops a root hook model whose id is unchanged, and drops PostModelSwitch when from_model is not the card currently reported.',
    'SessionStart model omits intent. PostModelSwitch to_model sets intent observed. OTLP api_request model sets intent observed and is fingerprinted per actor key.',
    'Launch options.model emits intent configured with provider anthropic.',
    'Child tasks copy task.model with intent observed. The child batch replaces the whole model family, so a task that omits model drops the previous child row.',
    'Transcript onBatch listeners are registered and never invoked. No transcript model:updated was found.',
  ],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'model id and optional display name' },
  states_present: [
    { id: 'adapter.claude.upstream.model.observed', value: 'observed', when: 'status line, PostModelSwitch, OTLP, child task' },
    { id: 'adapter.claude.upstream.model.configured', value: 'configured', when: 'launch options.model' },
    { id: 'adapter.claude.upstream.model.hook-omits-intent', value: 'intent omitted', when: 'normalizeClaudeSessionModel' },
    { id: 'adapter.claude.upstream.model.display', value: 'display_name or omitted', when: 'status line' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['status line, hook, OTLP, or launch', 'model event and/or monitor replace', 'row string pending'],
  notes: 'Declared model support is degraded. Historical transcript models are not imported, matching the limitation. The gate applies to agent events, not to the monitor replace. Child models without a joined hook agent id still emit on an unverified status-task actor.',
}));

put('claude', 'effort', up([
  span('packages/adapter-claude/src/observation/status-channel.ts', 131, 147, 'effort snapshot'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 254, 267, 'root effort replace'),
  span('packages/adapter-claude/src/normalization/effort.ts', 4, 16, 'ClaudeEffortNormalizer'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 379, 388, 'child effort intent configured'),
  span('packages/adapter-claude/src/driver.ts', 640, 642, 'launch configured effort'),
  span('packages/adapter-claude/src/normalization/wire.ts', 79, 81, 'claudeEffortLevel'),
], {
  support: 'degraded',
  classifications: ['supported', 'defaulted'],
  declaration_mismatch: false,
  transforms: [
    'Status line effort.level accepts a non-empty string or a non-negative finite number rendered with String. If a model id is present and effort is omitted, the snapshot is null and the monitor replace clears effort. The agent event is effort:updated with effort null.',
    'Hook effort is a string or record.level, deduped, intent observed.',
    'Child task.effort is emitted with intent configured, which matches the capability limitation that child status is configured effort.',
    'Launch options.effort is intent configured. Omitted launch effort emits nothing.',
  ],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'effort string and intent' },
  states_present: [
    { id: 'adapter.claude.upstream.effort.observed', value: 'observed', when: 'status line and hooks' },
    { id: 'adapter.claude.upstream.effort.configured', value: 'configured', when: 'launch option and child task' },
    { id: 'adapter.claude.upstream.effort.cleared', value: 'replace empty or effort null', when: 'model present and status line omits effort' },
    { id: 'adapter.claude.upstream.effort.open', value: 'open string', when: 'no closed enum' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['status line, hook, child task, or launch', 'effort value', 'row effort pending'],
  notes: 'Values are open strings, including a numeric budget rendered as text. field.effort.intent downstream must not assume one intent: this adapter emits both observed and configured.',
}));

put('claude', 'context', up([
  span('packages/adapter-claude/src/observation/status-channel.ts', 151, 212, 'claudeContextWindowEvent'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 269, 289, 'rootStatusBatch context replace'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 214, 216, 'rootContextInvalidationBatch'),
  span('packages/adapter-claude/src/observation/status-channel.ts', 216, 249, 'child token fields parsed'),
], {
  support: 'degraded',
  classifications: ['supported', 'derived', 'zero', 'parsed-not-emitted'],
  declaration_mismatch: false,
  transforms: [
    'usedTokens prefers input + cache_creation + cache_read when all three are present, else total_input_tokens. If those are missing and a provider percentage is in 0..100, usedTokens is capacity times that percentage over 100.',
    'capacity must be > 0 or the event is dropped, except the empty-window case.',
    'current_usage null with total_input_tokens 0 and positive capacity emits usedTokens 0 and no percentage. Other null current_usage emits context-window:invalidated reason provider-reset, and the monitor replace clears context.',
    'A hook context-window:invalidated also clears the monitor context family.',
    'Child tokenCount, contextWindowSize, and tokenSamples are parsed and are not copied into monitor context or usage.',
  ],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'context usedTokens and capacityTokens' },
  states_present: [
    { id: 'adapter.claude.upstream.context.tokens', value: 'non-negative used and positive capacity', when: 'components or total_input_tokens' },
    { id: 'adapter.claude.upstream.context.zero', value: 0, when: 'empty window before the first response' },
    { id: 'adapter.claude.upstream.context.invalidated', value: 'provider-reset or hook invalidation', when: 'null usage that is not the empty window, or context-window:invalidated' },
    { id: 'adapter.claude.upstream.context.child', value: 'parsed not emitted', when: 'subagent tokenCount and contextWindowSize' },
  ],
  anchors: [CONSUME, REDUCE_CONTEXT],
  units: 'tokens',
  steps: ['status line context_window', 'context event and monitor replace', 'child tokens dropped'],
  notes: 'Declared degraded: root context is provider-calculated and child context stays in native evidence. The child parse confirms the tokens are dropped before emission. Status line refreshInterval is preserved on the installed forwarder command and is not an adapter timer.',
}));

put('claude', 'context-percent', up([
  span('packages/adapter-claude/src/observation/status-channel.ts', 188, 210, 'provider percentage'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 281, 284, 'monitor percentageSource'),
], {
  support: 'degraded',
  classifications: ['supported', 'derived', 'absent'],
  declaration_mismatch: false,
  transforms: [
    'A provider used_percentage in 0..100 is copied. Else a remaining_percentage in 0..100 becomes 100 minus that value, source provider.',
    'Without a valid provider percentage, the event sets percentageSource derived and omits usedPercentage. The monitor batch then also omits usedPercentage and sets percentageSource derived.',
    'The empty-window event omits both, and the monitor batch still sets percentageSource derived because usedPercentage is undefined.',
    'The adapter does not clamp or floor a row percent.',
  ],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'usedPercentage only when the provider percentage is valid' },
  states_present: [
    { id: 'adapter.claude.upstream.percent.provider', value: 'provider', when: 'used_percentage or complement of remaining_percentage is inside 0..100' },
    { id: 'adapter.claude.upstream.percent.omitted', value: 'usedPercentage omitted', when: 'no valid provider percentage' },
    { id: 'adapter.claude.upstream.percent.derived-label', value: 'derived', when: 'monitor percentageSource without a number' },
  ],
  anchors: [REDUCE_CONTEXT, DERIVE],
  units: 'percent 0-100 when the provider value is copied; otherwise no unit is emitted',
  steps: ['provider percent or not', 'copy or omit', 'row usedPercent pending'],
  notes: 'percentageSource derived here means the provider did not supply a percentage. It is not a computed field.context.usedPercent.',
}));

put('claude', 'tokens', up([
  span('packages/adapter-claude/src/observation/otel/usage.ts', 28, 87, 'normalizeClaudeOtelUsage'),
  span('packages/adapter-claude/src/driver.ts', 407, 425, 'otelUsagePolicy'),
  span('packages/adapter-claude/src/driver.ts', 678, 756, 'onOtelLogs usage publish'),
  span('packages/adapter-claude/src/normalization/monitor-capabilities.ts', 87, 125, 'claudeMonitorCapabilities'),
], {
  support: 'supported',
  classifications: ['supported', 'defaulted', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'A record counts only when event.name is api_request or body is claude_code.api_request, session.id is present, and at least one token bucket or cost_usd parses.',
    'totalTokens sums the present buckets, treating a missing bucket as 0, and is omitted when the only metric is cost. meterTokens is input plus output with the same zero fill, and only when some token bucket exists.',
    'freshInputTokens is a copy of inputTokens, not a separate measurement. pricing.contextTokens is set only when input, cache read, and cache creation are all present.',
    'The driver drops a repeated fingerprint and drops records whose session.id is not the native session. It emits usage:tokens-used when otelUsageEnabled is true, including when the version is unverified.',
    'Capabilities mark usage degraded unless OTLP is both enabled and version-verified. Events can therefore flow while the declaration says degraded.',
    'Transcript batch listeners are never called. Historical transcript usage is not imported.',
  ],
  emitted_as: {
    channel: 'agent-event',
    row_property: 'not written',
    event: 'usage:tokens-used',
    properties: ['totalTokens', 'meterTokens', 'breakdown.inputTokens', 'freshInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'],
  },
  states_present: [
    { id: 'adapter.claude.upstream.tokens.present', value: 'non-negative integers', when: 'at least one bucket parses' },
    { id: 'adapter.claude.upstream.tokens.absent', value: 'token properties omitted', when: 'cost only' },
    { id: 'adapter.claude.upstream.tokens.zero-fill', value: 0, when: 'a missing bucket inside a present set is added as 0' },
    { id: 'adapter.claude.upstream.usage.origin', value: 'telemetry', when: 'event origin' },
    { id: 'adapter.claude.upstream.usage.boundary', value: 'response', when: 'canonical true' },
  ],
  anchors: [CONSUME, REDUCE_USAGE],
  units: 'tokens per settled API request, not a session cumulative counter and not an intra-response delta',
  steps: ['OTLP api_request', 'usage:tokens-used', 'monitor usage family not written'],
  notes: 'Reduce keeps the event only for a live usage origin and drops replay. That gate is shared pipeline, not an adapter branch. Child status token samples are not this event.',
}));

put('claude', 'burn', up([
  span('packages/adapter-claude/src/observation/otel/usage.ts', 42, 68, 'no per-minute field'),
  span('packages/adapter-claude/src/normalization/monitor-capabilities.ts', 19, 20, 'no intra-response delta'),
  BURN,
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent', 'pending'],
  declaration_mismatch: false,
  transforms: ['The usage event has no burn rate, delta window, or per-minute property.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.claude.upstream.burn.absent', value: 'absent', when: 'OTLP usage event' }],
  anchors: [BURN, PROJECT_BURN],
  steps: ['request totals', 'no rate', 'ledger pending'],
  notes: 'field.tokens.perMinute would be a downstream projection of usage samples. This adapter does not emit it. The capability text says there is no sanctioned intra-response token delta.',
}));

put('claude', 'cost', up([
  span('packages/adapter-claude/src/observation/otel/usage.ts', 37, 69, 'costUsd'),
], {
  support: 'supported',
  classifications: ['supported', 'zero', 'nullable'],
  declaration_mismatch: false,
  transforms: [
    'cost_usd is copied when it is a non-negative finite number, including 0. A missing or negative value omits costUsd.',
    'The event does not set cost coverage, burnPerHour, or a series.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', property: 'usage:tokens-used.costUsd' },
  states_present: [
    { id: 'adapter.claude.upstream.cost.present', value: 'non-negative number', when: 'cost_usd parses' },
    { id: 'adapter.claude.upstream.cost.zero', value: 0, when: 'provider reports 0' },
    { id: 'adapter.claude.upstream.cost.omitted', value: 'property omitted', when: 'attribute missing or invalid' },
  ],
  anchors: [CONSUME, REDUCE_USAGE, DERIVE],
  units: 'USD on the request event, not an invoice and not field.cost.coverage',
  steps: ['OTLP cost_usd', 'costUsd on the usage event', 'row cost object pending'],
  notes: 'field.cost.usd, coverage, burnPerHour, and series are backend ledger fields. Only a request cost number is emitted, and only when the attribute parses. Mapping onto coverage is pending.',
}));

put('claude', 'project', up([
  span('packages/adapter-claude/src/observation/status-channel.ts', 128, 138, 'status line cwd'),
  span('packages/adapter-claude/src/normalization/environment.ts', 5, 12, 'normalizeClaudeSessionEnvironment and normalizeClaudeCwd'),
  span('packages/adapter-claude/src/normalization/monitor.ts', 231, 237, 'monitor environment cwd'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: ['Status line uses workspace.current_dir, else cwd. Hook session environment uses cwd. CwdChanged uses new_cwd, else cwd. No git branch is set on these events.'],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'currentCwd' },
  states_present: [{ id: 'adapter.claude.upstream.cwd', value: 'non-empty cwd string', when: 'status line or hook cwd' }],
  anchors: [CONSUME, DERIVE],
  steps: ['cwd string', 'environment event', 'project name pending'],
  notes: 'field.project.branch and field.project.seq are not written. field.project.name is a downstream basename, not this cwd.',
}));

put('claude', 'reply', up([
  span('packages/adapter-claude/src/normalization/conversation.ts', 1, 9, 'normalizeClaudeAssistantMessage'),
  span('packages/adapter-claude/src/normalization/pipeline.ts', 5, 9, 'MessageDisplay streaming note'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['MessageDisplay deltas become conversation:assistant-message. The helper always sets displayOnly true. final is the caller flag.'],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'conversation:assistant-message displayOnly true' },
  states_present: [
    { id: 'adapter.claude.upstream.reply.displayOnly', value: true, when: 'every assistant message from this helper' },
    { id: 'adapter.claude.upstream.reply.final', value: 'caller boolean', when: 'final argument' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['MessageDisplay', 'assistant message displayOnly true', 'row reply pending'],
  notes: 'conversation is undeclared. displayOnly true is an adapter constant on this helper. Whether the row keeps display-only text is pending.',
}));

put('claude', 'account', up([
  span('packages/adapter-claude/src/driver.ts', 996, 998, 'status line account comment'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced'],
  declaration_mismatch: false,
  transforms: ['The status-line callback calls observeClaudeStatusLineAccountUsage and the comment says account usage is process-global subscription quota, not session state.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.claude.upstream.account.not-session', value: 'not session monitor state', when: 'status line callback' }],
  anchors: [DERIVE],
  steps: ['status line', 'separate account listener', 'not field.account'],
  notes: 'field.account is not filled from this session monitor path. GV2 already marks the row account producer as not established. This audit does not add one.',
}));

function codexModel() {
  return up([
    span('packages/adapter-codex/src/normalization/monitor.ts', 292, 331, 'bootstrap model'),
    span('packages/adapter-codex/src/normalization/monitor.ts', 546, 640, 'settings and reroute model'),
    span('packages/adapter-codex/src/normalization/monitor.ts', 715, 727, 'spawnAgent model'),
    span('packages/adapter-codex/src/normalization/monitor.ts', 246, 261, 'modelCatalogBatch'),
  ], {
    support: 'supported',
    classifications: ['supported'],
    declaration_mismatch: false,
    transforms: [
      'Root launch model is intent configured when configured.model is set. Response, settings, and reroute model ids are intent observed.',
      'displayName is added only when the optional modelDisplayName callback returns a name. modelCatalogBatch later corrects display names and does not replay other families.',
      'A spawnAgent collaboration item with a model id emits intent configured on the child actor.',
      'model/rerouted also retracts context for that actor.',
    ],
    emitted_as: { channel: 'monitor:batch', row_property: 'not written', property: 'model providerModelId, optional displayName, intent' },
    states_present: [
      { id: 'adapter.codex.upstream.model.configured', value: 'configured', when: 'root launch model and spawnAgent model' },
      { id: 'adapter.codex.upstream.model.observed', value: 'observed', when: 'thread response, settings, reroute' },
      { id: 'adapter.codex.upstream.model.display.omitted', value: 'displayName omitted', when: 'callback missing or returns nothing' },
    ],
    anchors: [CONSUME, REDUCE_MODEL],
    steps: ['app-server model fields', 'monitor model upsert', 'row string pending'],
    notes: 'The pipeline also has a model normalizer. This record traces the monitor batch, which is the semantic monitor write. Per-child model requires a child thread or a spawn item, matching the declaration. These monitor files are in the set GV2 reported as different from shipped 0.3.3; the trace is still 748d015 only.',
  });
}
put('codex', 'model', codexModel());

put('codex', 'effort', up([
  span('packages/adapter-codex/src/normalization/monitor.ts', 304, 343, 'bootstrap effort'),
  span('packages/adapter-codex/src/normalization/monitor.ts', 576, 589, 'settings effort retract'),
  span('packages/adapter-codex/src/normalization/monitor.ts', 729, 738, 'spawnAgent effort'),
], {
  support: 'degraded',
  classifications: ['supported', 'degraded'],
  declaration_mismatch: false,
  transforms: [
    'Bootstrap reads reasoningEffort, else effort, and upserts intent observed. Root configured.effort upserts intent configured.',
    'thread/settings/updated retracts effort when the key is present and the value is not a non-empty string.',
    'spawnAgent reasoningEffort is intent configured.',
  ],
  emitted_as: { channel: 'monitor:batch', row_property: 'not written', property: 'effort value and intent, or retract' },
  states_present: [
    { id: 'adapter.codex.upstream.effort.observed', value: 'observed', when: 'response or settings string' },
    { id: 'adapter.codex.upstream.effort.configured', value: 'configured', when: 'launch effort or spawnAgent' },
    { id: 'adapter.codex.upstream.effort.retract', value: 'retract', when: 'settings contain effort but it is empty' },
    { id: 'adapter.codex.upstream.effort.open', value: 'open string', when: 'no enum' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['effort or reasoningEffort', 'upsert or retract', 'row pending'],
  notes: 'Declared degraded because mid-session settings were not in the pinned runtime census. The source still contains the settings branch. Degraded is not unreachable.',
}));

put('codex', 'context', up([
  span('packages/adapter-codex/src/normalization/monitor.ts', 477, 542, 'thread/tokenUsage/updated context'),
  span('packages/adapter-codex/src/normalization/monitor.ts', 391, 414, 'contextBootstrapBatch'),
  span('packages/adapter-codex/src/observation/rollout-context.ts', 14, 51, 'readLastCodexContextWindow'),
  span('packages/adapter-codex/src/observation/observer.ts', 381, 385, 'rollout context publish'),
  span('packages/adapter-codex/src/normalization/context-window.ts', 19, 46, 'CodexContextWindowNormalizer'),
], {
  support: 'supported',
  classifications: ['supported', 'history-retained'],
  declaration_mismatch: false,
  transforms: [
    'Live and bootstrap notifications upsert root context from last.totalTokens and modelContextWindow. percentageSource is the literal derived. usedPercentage is not set.',
    'modelContextWindow null retracts root context. Child occupancy is not upserted.',
    'The rollout tail reads the same two counts from the last token_count record and does not set a percentage. contextBootstrapBatch would copy usedPercentage if the event had one. The only caller does not set it, so that branch is unreachable from the wired producer.',
    'Usage samples are separate and are not emitted for bootstrap phase.',
  ],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'context usedTokens and capacityTokens' },
  states_present: [
    { id: 'adapter.codex.upstream.context.live', value: 'last total and positive window', when: 'thread/tokenUsage/updated for the root' },
    { id: 'adapter.codex.upstream.context.retract', value: 'retract root', when: 'modelContextWindow is null, compaction completes, or model reroute' },
    { id: 'adapter.codex.upstream.context.rollout', value: 'history tail', when: 'readLastCodexContextWindow' },
    { id: 'adapter.codex.upstream.context.child', value: 'not projected', when: 'child thread tokenUsage' },
    { id: 'adapter.codex.upstream.context.percentageSource', value: 'derived', when: 'live monitor context upsert' },
  ],
  anchors: [CONSUME, REDUCE_CONTEXT],
  units: 'tokens',
  steps: ['tokenUsage last or rollout tail', 'context tokens', 'no usedPercentage on the wired path'],
  notes: 'Only root context is projected, matching the declaration. Rollout context is history. It is not billed as burn.',
}));

put('codex', 'context-percent', up([
  span('packages/adapter-codex/src/normalization/monitor.ts', 530, 538, 'live context omits usedPercentage'),
  span('packages/adapter-codex/src/observation/rollout-context.ts', 38, 41, 'rollout event has no percentage'),
], {
  support: 'absent',
  classifications: ['absent'],
  declaration_mismatch: false,
  transforms: ['The wired producers do not set usedPercentage. percentageSource derived is a label, not a number.'],
  emitted_as: { channel: 'none', row_property: 'not written', property: 'usedPercentage' },
  states_present: [{ id: 'adapter.codex.upstream.usedPercentage.absent', value: 'absent', when: 'live tokenUsage and rollout tail' }],
  anchors: [REDUCE_CONTEXT, DERIVE],
  steps: ['context tokens', 'no percentage number'],
  notes: 'field.context.usedPercent is not emitted. A later reducer may derive it. That derivation is pending and is not copied here.',
}));

put('codex', 'tokens', up([
  span('packages/adapter-codex/src/normalization/monitor.ts', 477, 528, 'usage upsert'),
  span('packages/adapter-codex/src/normalization/usage.ts', 11, 64, 'codexUsageCounter and codexUsagePricing'),
], {
  support: 'supported',
  classifications: ['supported', 'defaulted', 'zero'],
  declaration_mismatch: false,
  transforms: [
    'cumulativeTokens is total.totalTokens when it is a non-negative safe integer. The usage upsert is live phase only, and a duplicate counter is not upserted again.',
    'Bootstrap phase stores a counter when usageStartsAtZero but does not emit the usage update. The monitor test shows bootstrap history is not burned.',
    'pricing is attached when the counter total is > 0 or a previous counter exists. The first sample is gap baseline. A decreasing total is gap counter-reset. A model change is gap model-change. Incomplete or inconsistent buckets are gap incomplete-buckets.',
    'A complete interval sets inputTokens to input minus cached, cacheReadTokens to cached, cacheCreationTokens to the literal 0, and outputTokens to the output delta. contextTokens is the input delta only when it equals the last request.',
    'The usage value sets boundary sample and canonical false. It does not set totalTokens, deltaTokens, or costUsd.',
  ],
  emitted_as: { channel: 'monitor:batch', row_property: 'not written', property: 'usage.cumulativeTokens and usage.pricing' },
  states_present: [
    { id: 'adapter.codex.upstream.usage.cumulative', value: 'non-negative totalTokens', when: 'live non-duplicate sample' },
    { id: 'adapter.codex.upstream.usage.gap.baseline', value: 'baseline', when: 'no previous counter' },
    { id: 'adapter.codex.upstream.usage.gap.reset', value: 'counter-reset', when: 'total decreased' },
    { id: 'adapter.codex.upstream.usage.gap.model', value: 'model-change', when: 'model key changed' },
    { id: 'adapter.codex.upstream.usage.gap.incomplete', value: 'incomplete-buckets', when: 'bucket delta is missing or inconsistent' },
    { id: 'adapter.codex.upstream.usage.cacheCreation.zero', value: 0, when: 'complete bucket interval only' },
    { id: 'adapter.codex.upstream.usage.bootstrap', value: 'not emitted', when: 'phase bootstrap' },
  ],
  anchors: [CONSUME, REDUCE_USAGE],
  units: 'cumulative tokens on the app-server counter; pricing deltas are tokens',
  steps: ['thread/tokenUsage/updated total', 'live usage upsert', 'no row tokens object'],
  notes: 'field.tokens.total would need the downstream cumulative mapping. This record stops at cumulativeTokens. Child threads emit their own usage samples. Duplicate live counters update memory and do not emit another usage row.',
}));

put('codex', 'burn', up([
  span('packages/adapter-codex/src/normalization/monitor.ts', 391, 391, 'rollout is never billed burn'),
  span('packages/adapter-codex/src/normalization/monitor.test.ts', 184, 196, 'projected burnRatePerMin stays undefined in one fixture'),
  BURN,
  PROJECT_BURN,
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent', 'pending'],
  declaration_mismatch: false,
  transforms: ['The usage upsert has no per-minute field. Rollout context is explicitly not burn.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [
    { id: 'adapter.codex.upstream.burn.absent', value: 'absent', when: 'adapter usage value' },
    { id: 'adapter.codex.upstream.burn.test-projection', value: 'not an emission', when: 'monitor.test.ts reads project().usage.burnRatePerMin' },
  ],
  anchors: [BURN, PROJECT_BURN],
  steps: ['cumulative samples', 'no rate field', 'ledger pending'],
  notes: 'An adapter unit test observes a projected burnRatePerMin, including 0 after a downward child correction. That number is the shared projector, not an adapter field. field.tokens.perMinute stays pending.',
}));

put('codex', 'cost', up([
  span('packages/adapter-codex/src/normalization/monitor-capabilities.ts', 30, 34, 'USD limitation'),
  span('packages/adapter-codex/src/normalization/usage.ts', 28, 64, 'codexUsagePricing returns tokens and gap'),
  span('packages/adapter-codex/src/normalization/monitor.ts', 503, 527, 'usage value fields'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['The pricing helper returns token deltas or a gap. The usage upsert does not set costUsd or cost.'],
  emitted_as: { channel: 'none', row_property: 'not written', property: 'costUsd' },
  states_present: [{ id: 'adapter.codex.upstream.cost.absent', value: 'absent', when: 'usage upsert' }],
  anchors: [DERIVE],
  units: 'USD not emitted',
  steps: ['capability mentions USD', 'pricing object has no USD', 'row cost pending'],
  notes: 'The declaration says USD uses counter deltas and model metadata, but the producer never writes a USD field. Token pricing is emitted and is recorded on field.tokens. Do not treat a gap as a zero cost. Absence of cost here does not forbid field.cost from a catalog step this adapter does not perform.',
}));

put('codex', 'activity', up([
  span('packages/adapter-codex/src/normalization/monitor.ts', 74, 101, 'actorState and childActivity'),
  span('packages/adapter-codex/src/normalization/monitor.ts', 643, 783, 'child turn and item status'),
  span('packages/adapter-codex/src/normalization/pipeline.ts', 60, 64, 'CodexTurnNormalizer in the pipeline'),
], {
  support: 'supported',
  classifications: ['supported', 'derived'],
  declaration_mismatch: true,
  transforms: [
    'Monitor status activity is written for child threads only. turn/started sets activityKind responding, active true, line Subagent turn running. turn/completed sets active false and omits the line.',
    'Child items use reasoning for reasoning, responding for agentMessage or userMessage, and tool for every other item type. Lines are fixed strings.',
    'Root turn status is not a monitor status upsert. The pipeline turn normalizer emits turn events on the agent-event channel.',
    'actorState maps pendingInit, running, active, and inProgress to active; idle to idle; interrupted, completed, errored, shutdown, notFound, and closed to stopped; anything else to unknown.',
  ],
  emitted_as: { channel: 'both', row_property: 'not written', monitor: 'child status activity', events: 'pipeline turn events for the root' },
  states_present: [
    { id: 'adapter.codex.upstream.activity.responding', value: 'responding', when: 'child turn, or agentMessage or userMessage item' },
    { id: 'adapter.codex.upstream.activity.reasoning', value: 'reasoning', when: 'child reasoning item' },
    { id: 'adapter.codex.upstream.activity.tool', value: 'tool', when: 'any other child item type' },
    { id: 'adapter.codex.upstream.actor.active', value: 'active', when: 'pendingInit, running, active, inProgress' },
    { id: 'adapter.codex.upstream.actor.idle', value: 'idle', when: 'idle' },
    { id: 'adapter.codex.upstream.actor.stopped', value: 'stopped', when: 'interrupted, completed, errored, shutdown, notFound, closed, thread/closed' },
    { id: 'adapter.codex.upstream.actor.unknown', value: 'unknown', when: 'any other status string, and bootstrap collab active is forced unknown' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['child turn or item, or pipeline turn', 'activity or turn event', 'row status pending'],
  notes: 'Root monitor status is absent even though status is declared supported. Child activity lines are fixed English strings, not the provider item text. Bootstrap collaboration does not keep an active child as active.',
}));

put('codex', 'wait', up([
  span('packages/adapter-codex/src/services/approvals.ts', 198, 293, 'CodexApprovalService'),
  span('packages/adapter-codex/src/observation/observer.ts', 469, 469, 'transport close settleAll unknown'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: [
    'Server approval requests publish interaction:permission-requested. tool is a method table name or the method string. presentation is native-tui when there is no decide handler and the method is shared; otherwise host-ui.',
    'A host decision publishes allowed or denied. serverRequest/resolved settles unknown and does not carry the decision. Transport close and dispose also settle unknown.',
    'A non-shared request with no decide handler resolves denied.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', events: ['interaction:permission-requested', 'interaction:permission-resolved'] },
  states_present: [
    { id: 'adapter.codex.upstream.permission.allowed', value: 'allowed', when: 'approved host decision' },
    { id: 'adapter.codex.upstream.permission.denied', value: 'denied', when: 'denied decision, or non-shared request with no handler' },
    { id: 'adapter.codex.upstream.permission.unknown', value: 'unknown', when: 'serverRequest/resolved, transport close, dispose' },
    { id: 'adapter.codex.upstream.permission.native-tui', value: 'native-tui', when: 'shared and no decide handler' },
    { id: 'adapter.codex.upstream.permission.host-ui', value: 'host-ui', when: 'a decide handler will answer' },
  ],
  anchors: [CONSUME, span('packages/core/src/monitor/reduce.ts', 974, 995, 'permission cases')],
  steps: ['app-server approval request', 'permission events', 'row wait pending'],
  notes: 'The capability text matches the unknown settlement: Codex names the request and not the decision. field.wait is still not written here.',
}));

put('codex', 'project', up([
  span('packages/adapter-codex/src/normalization/monitor.ts', 289, 290, 'bootstrap cwd'),
  span('packages/adapter-codex/src/normalization/environment.ts', 10, 21, 'CodexEnvironmentNormalizer'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: ['Root cwd from the thread response, thread/started, or settings is copied. No git branch is set.'],
  emitted_as: { channel: 'both', row_property: 'not written', property: 'cwd' },
  states_present: [{ id: 'adapter.codex.upstream.cwd', value: 'non-empty cwd', when: 'root thread cwd' }],
  anchors: [CONSUME, DERIVE],
  steps: ['thread cwd', 'environment event and monitor cwd', 'project name pending'],
  notes: 'Child threads do not update the root environment cwd in the monitor bootstrap branch that requires root. field.project.branch is not emitted.',
}));

put('codex', 'reply', up([
  span('packages/adapter-codex/src/normalization/conversation.ts', 12, 42, 'CodexConversationNormalizer'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'item/agentMessage/delta appends the delta and emits final false, displayOnly false.',
    'item/completed for agentMessage emits the item text with final true and displayOnly false, and clears the buffer.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'conversation:assistant-message' },
  states_present: [
    { id: 'adapter.codex.upstream.reply.delta', value: 'final false', when: 'item/agentMessage/delta' },
    { id: 'adapter.codex.upstream.reply.final', value: 'final true', when: 'agentMessage item/completed' },
    { id: 'adapter.codex.upstream.reply.displayOnly', value: false, when: 'both events' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['agentMessage delta or completed', 'assistant message', 'row reply pending'],
  notes: 'conversation is undeclared. Empty deltas still append an empty string because a missing delta becomes an empty string.',
}));

put('copilot', 'activity', up([
  span('packages/adapter-copilot/src/normalization/monitor.ts', 25, 66, 'empty monitor updates'),
  span('packages/adapter-copilot/src/normalization/pipeline.ts', 100, 228, 'turn correlation'),
  span('packages/adapter-copilot/src/observation/session-observer.ts', 118, 118, 'default poll 100ms'),
], {
  support: 'derived',
  classifications: ['derived', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: [
    'Monitor updates stay empty. Status is declared supported, but no status family update is written.',
    'user.message starts a turn at interactionId. assistant.turn_start only records an internal id and emits no event.',
    'assistant.turn_end completes the interaction only when that internal turn was marked terminal, which happens when an assistant message had no tool requests. Otherwise the end emits nothing.',
    'abort and session.error fail the current interaction when one exists, and emit no turn event when none exists.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', events: ['turn:started', 'turn:completed', 'turn:failed'] },
  states_present: [
    { id: 'adapter.copilot.upstream.turn.started', value: 'turn:started', when: 'user.message' },
    { id: 'adapter.copilot.upstream.turn.completed', value: 'turn:completed', when: 'terminal assistant.turn_end' },
    { id: 'adapter.copilot.upstream.turn.failed', value: 'turn:failed', when: 'abort or session.error with a current interaction' },
    { id: 'adapter.copilot.upstream.turn.ignored-end', value: 'no event', when: 'turn_end that is not the terminal internal turn' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['events jsonl', 'interaction correlation', 'turn events'],
  notes: 'The correlation is stateful and the record confidence is authoritative. The declaration says the log separates response cycles from user interactions and the adapter joins them by interactionId. That join is derived even though the record confidence is authoritative. Poll default is 100ms. Durable history is replayed by the observer; this audit does not call replay a second live signal.',
}));

put('copilot', 'wait', up([
  span('packages/adapter-copilot/src/normalization/interaction.ts', 4, 45, 'normalizeCopilotInteraction'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: [
    'permission.requested emits interaction:permission-requested with presentation native-tui. tool is permissionRequest.kind or promptRequest.kind.',
    'permission.completed lowercases result.kind, else approval.kind. den or reject becomes denied. allow or approv becomes allowed. dismiss or cancel becomes dismissed. Any other non-empty or empty string becomes unknown.',
    'A completed record with no requestId emits nothing.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', events: ['interaction:permission-requested', 'interaction:permission-resolved'] },
  states_present: [
    { id: 'adapter.copilot.upstream.permission.allowed', value: 'allowed', when: 'kind contains allow or approv' },
    { id: 'adapter.copilot.upstream.permission.denied', value: 'denied', when: 'kind contains den or reject' },
    { id: 'adapter.copilot.upstream.permission.dismissed', value: 'dismissed', when: 'kind contains dismiss or cancel' },
    { id: 'adapter.copilot.upstream.permission.unknown', value: 'unknown', when: 'any other kind text' },
    { id: 'adapter.copilot.upstream.permission.presentation', value: 'native-tui', when: 'requested' },
  ],
  anchors: [CONSUME, span('packages/core/src/monitor/reduce.ts', 974, 995, 'permission cases')],
  steps: ['permission.requested or completed', 'substring outcome', 'row wait pending'],
  notes: 'The outcome is inferred from substrings, so an unforeseen kind is unknown rather than dropped. field.wait is not written.',
}));

put('copilot', 'model', up([
  span('packages/adapter-copilot/src/normalization/model.ts', 4, 14, 'normalizeCopilotModel'),
  span('packages/adapter-copilot/src/driver.ts', 138, 142, 'launch configured model'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: [
    'session.start and session.resume read selectedModel. session.model_change reads newModel. session.auto_mode_resolved reads chosenModel. Empty strings are dropped.',
    'The event is model:updated intent observed with id only. There is no display name and no retract when the field is missing.',
    'Launch options.model is a separate intent configured event.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'model:updated' },
  states_present: [
    { id: 'adapter.copilot.upstream.model.observed', value: 'observed', when: 'session header, model_change, or auto_mode_resolved' },
    { id: 'adapter.copilot.upstream.model.configured', value: 'configured', when: 'launch options.model' },
    { id: 'adapter.copilot.upstream.model.absent', value: 'no event', when: 'id missing' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['session event or launch option', 'model:updated', 'row string pending'],
  notes: 'The monitor batch does not upsert model, so the declaration source copilot-model-change is the pipeline, not monitor.ts. Both configured and observed can be published. Precedence between them is pending.',
}));

put('copilot', 'effort', up([
  span('packages/adapter-copilot/src/normalization/effort.ts', 4, 8, 'normalizeCopilotEffort'),
  span('packages/adapter-copilot/src/driver.ts', 143, 147, 'launch configured effort'),
], {
  support: 'supported',
  classifications: ['supported'],
  declaration_mismatch: false,
  transforms: [
    'reasoningEffort is read on session.start, session.resume, and session.model_change. auto_mode_resolved does not update effort.',
    'A non-empty string emits effort:updated intent observed. A missing value emits nothing and does not retract.',
    'Launch options.effort is intent configured.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'effort:updated' },
  states_present: [
    { id: 'adapter.copilot.upstream.effort.observed', value: 'observed', when: 'reasoningEffort string' },
    { id: 'adapter.copilot.upstream.effort.configured', value: 'configured', when: 'launch option' },
    { id: 'adapter.copilot.upstream.effort.open', value: 'open string', when: 'no enum' },
  ],
  anchors: [CONSUME, REDUCE_MODEL],
  steps: ['reasoningEffort or launch option', 'effort event', 'row pending'],
  notes: 'No retract means an older effort can remain downstream if this event is absent. That stale possibility is pending in the reducer, not an emitted stale flag.',
}));

put('copilot', 'context', up([
  span('packages/adapter-copilot/src/normalization/compaction.ts', 4, 39, 'normalizeCopilotCompaction'),
  span('packages/adapter-copilot/src/normalization/types.ts', 29, 30, 'copilotNumber'),
], {
  support: 'degraded',
  classifications: ['supported', 'derived', 'zero'],
  declaration_mismatch: false,
  transforms: [
    'session.compaction_start emits context-window:updated only when currentTokens and tokenLimit are finite and >= 0 and tokenLimit > 0.',
    'There is no other continuous context sample. That matches the degraded declaration.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'context-window:updated' },
  states_present: [
    { id: 'adapter.copilot.upstream.context.present', value: 'used and capacity tokens', when: 'compaction_start with both counts and capacity > 0' },
    { id: 'adapter.copilot.upstream.context.zero-used', value: 0, when: 'currentTokens is 0 and capacity > 0' },
    { id: 'adapter.copilot.upstream.context.absent', value: 'no context event', when: 'counts missing or capacity is 0' },
  ],
  anchors: [CONSUME, REDUCE_CONTEXT],
  units: 'tokens',
  steps: ['compaction_start counts', 'context event', 'not continuous'],
  notes: 'Declared degraded because values exist around compaction, not continuously. The source contains that producer. Degraded is not the same as unreachable.',
}));

put('copilot', 'context-percent', up([
  span('packages/adapter-copilot/src/normalization/compaction.ts', 13, 22, 'derived usedPercentage'),
], {
  support: 'derived',
  classifications: ['derived', 'zero'],
  declaration_mismatch: false,
  transforms: ['usedPercentage is Math.min(100, usedTokens / capacityTokens * 100). percentageSource is the literal derived. Both inputs are >= 0 and capacity is > 0, so the ratio is >= 0 before the cap.'],
  emitted_as: { channel: 'agent-event', row_property: 'not written', property: 'context-window:updated.usedPercentage' },
  states_present: [
    { id: 'adapter.copilot.upstream.percent.derived', value: 'derived', when: 'compaction_start context event' },
    { id: 'adapter.copilot.upstream.percent.capped', value: 100, when: 'ratio above 100' },
    { id: 'adapter.copilot.upstream.percent.zero', value: 0, when: 'used tokens are 0' },
  ],
  anchors: [REDUCE_CONTEXT, DERIVE],
  units: 'percent, capped at 100 by this adapter',
  steps: ['used divided by capacity', 'cap at 100', 'row usedPercent pending'],
  notes: 'This is an adapter-computed percentage on the agent event. It is not field.context.usedPercent. The row copy is pending. No other event sets a percentage.',
}));

put('copilot', 'tokens', up([
  span('packages/adapter-copilot/src/normalization/monitor-capabilities.ts', 15, 23, 'usage capability'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent'],
  declaration_mismatch: false,
  transforms: ['No usage:tokens-used event was found. Compaction token counts are context occupancy, not a burn ledger.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.copilot.upstream.tokens.absent', value: 'absent', when: 'usage family' }],
  anchors: [DERIVE],
  steps: ['declared usage unsupported', 'no usage event'],
  notes: 'The declaration says durable transcript usage is excluded and no live usage rail is integrated. The searched producers match that. It does not make field.tokens impossible from another source.',
}));
put('copilot', 'burn', up([
  span('packages/adapter-copilot/src/normalization/monitor-capabilities.ts', 15, 23, 'usage capability'),
  BURN,
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent', 'pending'],
  declaration_mismatch: false,
  transforms: ['No burn rate is written.'],
  emitted_as: { channel: 'none', row_property: 'not written' },
  states_present: [{ id: 'adapter.copilot.upstream.burn.absent', value: 'absent', when: 'adapter emission' }],
  anchors: [BURN],
  steps: ['no usage samples', 'no rate'],
  notes: 'field.tokens.perMinute is not an adapter field.',
}));
put('copilot', 'cost', up([
  span('packages/adapter-copilot/src/normalization/monitor-capabilities.ts', 15, 23, 'usage capability'),
  span('packages/adapter-copilot/src/normalization/compaction.ts', 4, 25, 'compaction tokens are context, not cost'),
], {
  support: 'not-adapter-produced',
  classifications: ['not-adapter-produced', 'absent'],
  declaration_mismatch: false,
  transforms: ['No costUsd or cost_usd symbol exists in this adapter. Compaction currentTokens and tokenLimit are context occupancy.'],
  emitted_as: { channel: 'none', row_property: 'not written', property: 'costUsd' },
  states_present: [{ id: 'adapter.copilot.upstream.costUsd.absent', value: 'absent', when: 'adapter sources' }],
  anchors: [DERIVE],
  steps: ['no costUsd symbol', 'context tokens are not cost'],
  notes: 'costUsd is absent. No burn rate is written. Declared usage unsupported matches the search. That does not create state.cost_missing and does not forbid a later ledger.',
}));

put('copilot', 'project', up([
  span('packages/adapter-copilot/src/normalization/environment.ts', 4, 18, 'normalizeCopilotEnvironment'),
  span('packages/adapter-copilot/src/normalization/session.ts', 4, 13, 'session cwd'),
  span('packages/adapter-copilot/src/driver.ts', 134, 137, 'launch cwd'),
  span('packages/adapter-copilot/src/driver.ts', 43, 54, 'title argv'),
], {
  support: 'supported',
  classifications: ['supported', 'nullable'],
  declaration_mismatch: false,
  transforms: [
    'Launch publishes options.cwd. session.start and session.resume publish context.cwd when it is a non-empty string.',
    'session.context_changed publishes cwd when present and, when gitRoot is present, git.root, git.branch (string or null), git.headSha (string or null), and detached when a head exists and branch does not.',
    'options.title is passed as --name and is not an event. It is not field.project.name.',
  ],
  emitted_as: { channel: 'agent-event', row_property: 'not written', property: 'currentCwd and optional git.branch' },
  states_present: [
    { id: 'adapter.copilot.upstream.cwd', value: 'non-empty cwd', when: 'launch, session context, or context_changed' },
    { id: 'adapter.copilot.upstream.branch.named', value: 'non-empty branch string', when: 'context_changed branch' },
    { id: 'adapter.copilot.upstream.branch.null', value: null, when: 'gitRoot present and branch missing' },
  ],
  anchors: [CONSUME, DERIVE],
  steps: ['cwd and optional git', 'environment event', 'project row pending'],
  notes: 'field.project.branch can be fed by git.branch, including null. The row merge is pending. A null branch is nullable evidence, not the row state.branch_none, until that mapping exists. --name is not a project title.',
}));

put('copilot', 'reply', up([
  span('packages/adapter-copilot/src/normalization/conversation.ts', 4, 19, 'normalizeCopilotAssistantMessage'),
  span('packages/adapter-copilot/src/normalization/pipeline.ts', 127, 152, 'assistant.message'),
], {
  support: 'supported',
  classifications: ['supported', 'declaration-mismatch'],
  declaration_mismatch: true,
  transforms: ['assistant.message with a non-empty string content emits conversation:assistant-message final true. Empty content emits nothing. messageId falls back to the log entry id.'],
  emitted_as: { channel: 'agent-event', row_property: 'not written', event: 'conversation:assistant-message final true' },
  states_present: [
    { id: 'adapter.copilot.upstream.reply.final', value: true, when: 'non-empty assistant content' },
    { id: 'adapter.copilot.upstream.reply.absent', value: 'no event', when: 'content missing or empty' },
  ],
  anchors: [CONSUME, REDUCE_TURN],
  steps: ['assistant.message content', 'final assistant text', 'row reply pending'],
  notes: 'conversation is undeclared. final is always true on this helper. No reply.at is set. The log timestamp stays on the normalized record, not inside the event.',
}));

function groupFor(id) {
  if (id === 'field.model') return 'model';
  if (id === 'field.effort' || id === 'field.effort.value' || id === 'field.effort.intent') return 'effort';
  if (id === 'field.context') return 'context';
  if (id === 'field.context.usedPercent') return 'context-percent';
  if (id === 'field.tokens' || id === 'field.tokens.total') return 'tokens';
  if (id === 'field.tokens.perMinute') return 'burn';
  if (id.startsWith('field.cost')) return 'cost';
  if (id === 'field.project' || id === 'field.project.name') return 'project';
  if (id === 'field.project.branch') return 'branch';
  if (id.startsWith('field.reply')) return 'reply';
  if (id === 'field.activity.since' || id === 'field.statusSince') return null;
  if (id === 'field.status' || id === 'field.detail' || id.startsWith('field.activity')) return 'activity';
  if (id.startsWith('field.wait')) return 'wait';
  if (id === 'field.account') return 'account';
  return null;
}

put('acp', 'branch', null);
put('antigravity', 'branch', null);
put('claude', 'branch', null);
put('codex', 'branch', null);
put('copilot', 'branch', N.copilot.project);


const PINS = { vibefield: VIBEFIELD, puppeteer: SHA };
const lineCache = new Map();

function lineCount(file) {
  if (!lineCache.has(file)) {
    const absolute = join(ROOT, file);
    const text = readFileSync(absolute, 'utf8');
    lineCache.set(file, text.split('\n').length);
  }
  return lineCache.get(file);
}

function asSource(item) {
  const start = Number(String(item.lines).split('-')[0]);
  const end = Number(String(item.lines).split('-').pop());
  if (!item.file?.startsWith('packages/')) throw new Error(`bad path ${item.file}`);
  const count = lineCount(item.file);
  if (end < start || end > count) {
    throw new Error(`${item.file} ${start}-${end} exceeds ${count} lines (${item.symbol})`);
  }
  return { repo: 'puppeteer', sha: SHA, path: item.file, lineStart: start, lineEnd: end, symbol: item.symbol };
}

function viewsOf(field) {
  const ids = [];
  for (const consumer of field.consumers ?? []) {
    if (typeof consumer.view === 'string' && /^view\.(list|rain|swarm|spend|timeline)$/.test(consumer.view)) {
      ids.push(consumer.view);
    }
  }
  return [...new Set(ids)];
}

function puppeteerSources(field) {
  const raw = field.evidence ? (Array.isArray(field.evidence) ? field.evidence : [field.evidence]) : [];
  const out = [];
  for (const item of raw) {
    if (item.repo !== 'puppeteer' || item.commit !== SHA || !item.file || !item.line) continue;
    const end = item.endLine ?? item.line;
    const symbol = item.file.split('/').pop();
    try {
      lineCount(item.file);
    } catch {
      continue;
    }
    const count = lineCount(item.file);
    if (end < item.line || end > count) continue;
    out.push({ repo: 'puppeteer', sha: SHA, path: item.file, lineStart: item.line, lineEnd: end, symbol });
  }
  return out;
}

function relatedStates(field) {
  if (!field.adapterFamily) return [];
  return audit.states.filter((state) => state.adapterFamily === field.adapterFamily).map((state) => state.id);
}

function envelope(adapter, field) {
  const group = groupFor(field.id);
  const upstream = group ? N[adapter]?.[group] : null;
  const produced = Boolean(upstream) && upstream.support !== 'not-adapter-produced' && upstream.support !== 'absent';
  const searchedAbsent = Boolean(upstream) && (upstream.support === 'absent' || upstream.support === 'not-adapter-produced');
  const declared = declaration(adapter, field.adapterFamily);
  const unsupported = declared?.declared_support === 'unsupported' && !produced;
  const sources = [];
  if (upstream) {
    for (const item of upstream.evidence_spans) sources.push(asSource(item));
    for (const item of upstream.anchors ?? []) {
      if (item.file) sources.push(asSource(item));
    }
  }
  for (const item of puppeteerSources(field)) {
    if (!sources.some((source) => source.path === item.path && source.lineStart === item.lineStart)) sources.push(item);
  }
  if (sources.length === 0) {
    sources.push({
      repo: 'external',
      name: 'GV-AUDIT2',
      path: 'audit/godview/contracts/model.schema.json',
      symbol: field.id,
      unavailable: true,
      reason: 'No Puppeteer 748d015 line for this field was opened, and this adapter does not write it.',
    });
  }
  const fieldPath = field.id.slice('field.'.length);
  const rowField = audit.fields.some((item) => item.id === field.id);
  const states = relatedStates(field);
  const views = viewsOf(field);
  const sinceNote =
    field.id === 'field.activity.since' || field.id === 'field.statusSince'
      ? 'No adapter code writes activity.since or statusSince. Batch observedAt and event envelope timestamps are different clocks.'
      : '';
  const classNote = rowField
    ? `ROW FIELD ${field.id}. PENDING DOWNSTREAM MAPPING into MonitorAgentRow. This is one of 74 canonical row fields. It is not an SDK contract leaf.`
    : `SDK CONTRACT LEAF ${field.id}. NOT A ROW FIELD. Do not join this id to a MonitorAgentRow property such as field.cost or field.tokens. Canonical row ids do not use the field.contract prefix.`;
  const costNote =
    field.id.startsWith('field.cost') ||
    field.id === 'field.tokens.perMinute' ||
    field.id.startsWith('field.contract.MonitorCost') ||
    field.id === 'field.contract.MonitorTokens.perMinute'
      ? 'This record does not emit state.cost_complete, state.cost_partial, state.cost_unavailable, state.cost_missing, state.burn_flames_0, state.burn_flames_1, state.burn_flames_2, state.burn_flames_3, state.burn_flames_4, or state.burn_unpriced. Those predicates stay downstream. PENDING DOWNSTREAM MAPPING.'
      : '';
  const rawProperty =
    upstream?.emitted_as?.property ??
    upstream?.emitted_as?.event ??
    upstream?.emitted_as?.monitor ??
    (produced ? 'adapter signal, see transforms' : null);
  const trace = [
    classNote,
    'PENDING DOWNSTREAM MAPPING: GV-AUDIT2 owns adapter output to row predicates, including cost, burn rate, history, timeline, and git branch. This audit does not give that verdict.',
    'Schema acceptance is not complete provenance. verification.status source-read is a static reading. observation.presence unknown means no live sample was taken. It does not mean the row value is missing.',
    'classification.adapterEmittable and uiReachable stay unknown. A raw adapter property is not the row field, and a catalog consumer is not a proven UI path.',
    sinceNote,
    costNote,
    upstream?.notes ?? `${field.id} has no raw adapter write in the producers reviewed for ${adapter}.`,
    rowField
      ? 'The adapter does not write this MonitorAgentRow property. That is the architecture, not a conclusion that the row predicate is unreachable.'
      : 'This SDK leaf is not a live observation and is not synthetic fixture data.',
    'This trace is Puppeteer 748d015a7e393112e0a91dad80111fdf5abe6583 only. It is newer than shipped Vibefield 0.3.3 and does not describe that install. Package comparison was not re-run.',
    declared
      ? `Declaration ${declared.declared_support ?? 'undeclared'} from ${declared.declared_source ?? 'no capability cell'}. ${declared.meaning ?? ''}`
      : 'No capability cell for this field.',
    upstream?.declaration_mismatch
      ? 'Declared support does not match the producer channel. That mismatch is not a runtime impossibility.'
      : 'No raw adapter signal does not rule out the row value from host, runtime, history, or another producer.',
    upstream
      ? `Raw source literals, not live samples: ${upstream.states_present.map((state) => `${state.id}=${JSON.stringify(state.value)} (${state.when})`).join('; ')}`
      : 'No raw adapter literal was found for this field.',
    `Graph: evidence/${adapter}/${fieldPath}.mmd. Continuation anchors, not a reachability verdict: MonitorService.consume, core reduce and project, deriveAgentRow. Vibefield AgentView and window-rows are not traced.`,
  ].join(' ');
  const presence = 'unknown';
  const transforms = (upstream?.transforms ?? [
    'No adapter write of this contract property was found in the reviewed producers.',
  ]).map((effect, order) => ({
    order,
    name: produced ? `adapter-step-${order}` : `no-adapter-producer-${order}`,
    effect,
    source: sources[Math.min(order, sources.length - 1)],
  }));
  const record = {
    recordId: `prov.${adapter}.${fieldPath}`,
    pins: PINS,
    adapterId: `adapter.${adapter}`,
    fieldId: field.id,
    sources,
    producer: produced
      ? {
          kind: 'adapter',
          name: `${adapter} normalization`,
          ingestedFrom: upstream.emitted_as?.event ?? upstream.emitted_as?.monitor ?? upstream.emitted_as?.property ?? 'adapter event or monitor batch',
        }
      : field.id.startsWith('field.contract.')
        ? {
            kind: 'contract',
            name: field.contract ?? 'model contract leaf',
            ingestedFrom: 'SDK contract leaf, not a row field; PENDING DOWNSTREAM MAPPING does not apply to a MonitorAgentRow property',
          }
        : {
            kind: 'unknown',
            name: 'not-adapter-produced',
            ingestedFrom: 'not adapter-produced; PENDING DOWNSTREAM MAPPING into the row',
          },
    transforms,
    merge: {
      strategy: rowField ? 'unknown' : 'none',
      defaults: [],
    },
    transport: produced
      ? { channel: 'in-process', name: 'MonitorService.consume', contract: 'AgentEvent or monitor:batch' }
      : { channel: 'unknown', name: 'not-adapter-produced' },
    renderer: {
      viewIds: views,
      component: views.length ? 'catalog-consumer-unproven' : 'not-established',
      symbol: views.length ? views.join(',') : 'no-consumer-recorded',
    },
    applicability: {
      states: states.length ? states : 'model-axes',
      views: views.length ? views : 'all-monitor-views',
      notes: trace,
    },
    absence: {
      onMissing: 'record-unknown',
      onStale: 'unknown',
      zeroPolicy: 'unknown-unsupported-and-absent-are-not-zero',
    },
    observation: {
      presence,
      synthetic: false,
    },
    classification: {
      modelSupported: 'yes',
      adapterEmittable: 'unknown',
      uiReachable: 'unknown',
    },
    verification: {
      status: upstream || sources[0].repo !== 'external' ? 'source-read' : 'unverified',
      owner: 'GV-AUDIT3',
      notes: trace,
    },
  };
  return {
    record,
    meta: {
      rowField,
      rawPresent: Boolean(produced && rawProperty),
      rawProperty,
      declarationMismatch: Boolean(upstream?.declaration_mismatch),
      source: sources[0],
      steps: upstream?.steps ?? ['no raw adapter write found'],
      states,
    },
  };
}

function mermaid(adapter, field, meta, resolved) {
  const raw = meta.rawPresent ? meta.rawProperty : 'no raw adapter write found';
  const cite = meta.source.lineStart
    ? `${meta.source.path}:${meta.source.lineStart}-${meta.source.lineEnd}`
    : meta.source.path;
  const lines = [
    `%% graph_ref: ${resolved.graphRef}`,
    `%% adapter: ${adapter}`,
    `%% field: ${field.id}`,
    '%% forensic: source-read at 748d015; not a live sample',
    'flowchart LR',
    `  src["${cite}"]`,
    `  raw["${String(raw).replaceAll('"', "'")}"]`,
    `  shared["${resolved.graphRef}"]`,
    `  row["${field.id} ${resolved.adapterEmittable}"]`,
    `  ui["UI ${resolved.uiReachable}"]`,
    '  src --> raw --> shared --> row --> ui',
  ];
  if (resolved.adapterEmittable === 'unknown' || resolved.uiReachable === 'unknown') {
    lines.push('  open["UNRESOLVED where this verdict is unknown"]');
    lines.push('  row --> open');
  }
  return `${lines.join('\n')}\n`;
}

const evidenceRoot = join(ROOT, 'audit/godview/evidence');
rmSync(evidenceRoot, { recursive: true, force: true });
rmSync(join(ROOT, 'audit/godview/contracts'), { recursive: true, force: true });
const index = [];
const joins = [];
for (const adapter of OWNED) {
  for (const field of [...audit.fields, ...audit.contractFields]) {
    const { record, meta } = envelope(adapter, field);
    const resolved = resolveField(adapter, field.id, meta);
    record.classification.adapterEmittable = resolved.adapterEmittable;
    record.classification.uiReachable = resolved.uiReachable;
    record.observation.presence = resolved.presence;
    record.verification.notes = `${resolved.verdict} ${record.verification.notes}`;
    record.applicability.notes = record.verification.notes;
    if (resolved.views.length) {
      record.renderer.viewIds = resolved.views;
      record.renderer.component = resolved.component;
      record.renderer.symbol = resolved.symbol;
      record.applicability.views = resolved.views;
    }
    const fieldPath = field.id.slice('field.'.length);
    const relativePath = join('audit/godview/evidence', adapter, `${fieldPath}.json`);
    const absolute = join(ROOT, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(absolute.replace(/\.json$/u, '.mmd'), mermaid(adapter, field, meta, resolved));
    index.push({
      id: record.recordId,
      adapterId: record.adapterId,
      fieldId: record.fieldId,
      path: relativePath,
      rowField: meta.rowField,
      rawPresent: meta.rawPresent,
      mismatch: meta.declarationMismatch,
    });
    if (meta.rowField) {
      joins.push({
        adapterId: record.adapterId,
        fieldId: record.fieldId,
        record: `evidence/${adapter}/${fieldPath}.json`,
        graph: `evidence/${adapter}/${fieldPath}.mmd`,
        rawProperty: meta.rawProperty,
        rawSignalInSource: meta.rawPresent,
        rowFieldWrittenByAdapter: false,
        downstreamMapping: 'pending',
        downstreamOwner: 'GV-AUDIT2',
        continuation: meta.rawPresent
          ? ['MonitorService.consume', 'core reduce and project', 'deriveAgentRow']
          : ['no raw adapter input found', 'row mapping still pending'],
      });
    }
  }
}

const byAdapter = Object.fromEntries(OWNED.map((adapter) => [adapter, index.filter((item) => item.adapterId === `adapter.${adapter}`)]));
const fragment = {
  owner: 'GV-AUDIT3',
  rows: [],
  updates: OWNED.map((adapter) => {
    const rows = byAdapter[adapter];
    const mismatches = rows.filter((item) => item.mismatch).map((item) => item.fieldId);
    return {
      id: `adapter.${adapter}`,
      status: 'in-progress',
      evidence: [`evidence/${adapter}/`],
      notes: `74 row-field envelopes plus 86 SDK leaves. Row classifications stay unknown for adapterEmittable and uiReachability. Raw signals are in plan/gv-audit3-join.json. Graphs are sibling .mmd files with unresolved row, UI, and state nodes. Puppeteer 748d015 only. Schema acceptance is not complete provenance. PENDING DOWNSTREAM MAPPING. Declaration mismatches: ${mismatches.join(', ') || 'none'}.`,
    };
  }),
};
const fragmentPath = join(ROOT, 'audit/godview/plan/matrix-fragments/GV-AUDIT3.json');
mkdirSync(dirname(fragmentPath), { recursive: true });
writeFileSync(fragmentPath, `${JSON.stringify(fragment, null, 2)}\n`);
const stateReachability = OWNED.flatMap((adapter) =>
  audit.states.map((state) => {
    const resolved = resolveState(adapter, state.id);
    return {
      adapterId: `adapter.${adapter}`,
      stateId: state.id,
      verdict: resolved.verdict,
      impossible: resolved.impossible,
      graphRef: resolved.graphRef,
      forensic: 'source-read',
      liveObserved: false,
      note: resolved.note,
    };
  }),
);
const handoff = {
  pins: PINS,
  sourceSha: SHA,
  representsInstalledVibefield: false,
  provenanceComplete: false,
  schemaAcceptanceIsNotProvenance: true,
  downstreamOwner: 'GV-AUDIT2',
  costTraceCommit: '25c215a2a53f363e1076210b3f6fce2155dfdc0b',
  downstreamVerdict: 'partial: cost row predicates integrated from that trace; other shared anchors remain for GV2 to fill',
  counts: {
    rowFields: audit.fields.length,
    rowRecords: joins.length,
    sdkContractLeaves: audit.contractFields.length,
    sdkLeafRecords: index.filter((item) => !item.rowField).length,
    statesPerAdapter: audit.states.length,
  },
  costHandoff: {
    'adapter.claude': {
      rawProperty: 'usage:tokens-used.costUsd',
      source: 'packages/adapter-claude/src/observation/otel/usage.ts:37-69',
      writesFieldCostUsd: false,
      burnRateWritten: false,
      continuation: 'reduce.ts:1049-1073 copies event.costUsd. usage-pricing.ts can also catalog-price complete buckets. GV2 25c215a2a53f363e1076210b3f6fce2155dfdc0b: normal backend emits complete or partial, not a present cost_unavailable object. cost_missing remains possible before a priced total. Not live-observed.',
    },
    'adapter.codex': {
      rawProperty: null,
      source: 'packages/adapter-codex/src/normalization/monitor.ts:503-527',
      writesFieldCostUsd: false,
      burnRateWritten: false,
      continuation: 'No adapter costUsd. pricing deltas can be catalog-priced by usage-pricing.ts. GV2 25c215a: complete after a zero baseline and a valid delta; partial when a gap or positive baseline mixes with a priced delta. Flames are conditional. Not live-observed.',
    },
    'adapter.acp': {
      rawProperty: null,
      source: 'packages/adapter-acp/src/normalization/monitor.ts:216-228',
      writesFieldCostUsd: false,
      burnRateWritten: false,
      continuation: 'No costUsd. GV2 25c215a: row is cost_missing and an observed working body is burn_unpriced, not cost_unavailable. Not impossible if a later producer adds cost.',
    },
    'adapter.antigravity': {
      rawProperty: null,
      source: 'packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:15-23',
      writesFieldCostUsd: false,
      burnRateWritten: false,
      continuation: 'No costUsd symbol. Same row result as ACP: cost_missing and burn_unpriced, not normal cost_unavailable. GV2 25c215a.',
    },
    'adapter.copilot': {
      rawProperty: null,
      source: 'packages/adapter-copilot/src/normalization/monitor-capabilities.ts:15-23',
      writesFieldCostUsd: false,
      burnRateWritten: false,
      continuation: 'No costUsd. Compaction tokens are context. Same row result as ACP: cost_missing and burn_unpriced. GV2 25c215a.',
    },
  },
  rowJoins: joins,
  stateReachability,
};
writeFileSync(join(ROOT, 'audit/godview/plan/gv-audit3-join.json'), `${JSON.stringify(handoff, null, 2)}\n`);
const graphs = join(ROOT, 'audit/godview/plan/graphs');
mkdirSync(graphs, { recursive: true });
const shared = {
  'cost-priced.mmd': `flowchart TD
  raw[Adapter usage or pricing] --> price[usage-pricing.ts priceUsageUpdates]
  price --> ledger[cost.ts buildUsageCostLedger]
  ledger --> row[backend.ts costOf complete or partial]
  row --> flames[bubble-model.ts flame ladder conditional]
  note[GV2 25c215a not a live sample] --> row`,
  'cost-missing.mmd': `flowchart TD
  raw[No priced costUsd] --> core[Core coverage unavailable]
  core --> omit[backend.ts omits field.cost]
  omit --> missing[state.cost_missing]
  omit --> hollow[state.burn_unpriced on observed working body]
  not[state.cost_unavailable is not this row] --> omit`,
  'status.mmd': `flowchart LR
  events[turn tool permission events] --> transitions[transitions.ts status]
  transitions --> derive[derive.ts agentStatus]
  derive --> views[list rain swarm spend]`,
  'context-percent.mmd': `flowchart LR
  tokens[context tokens] --> reduce[reduce.ts derived percent]
  reduce --> row[derive.ts usedPercent]
  row --> views[list rain swarm]`,
  'branch.mmd': `flowchart LR
  git[adapter git or host branch] --> derive[derive.ts projectBranch]
  derive --> views[list rain swarm]`,
};
for (const [name, body] of Object.entries(shared)) writeFileSync(join(graphs, name), `${body}\n`);
console.log(JSON.stringify({
  records: index.length,
  rowJoins: joins.length,
  graphs: index.length,
  mismatches: index.filter((item) => item.mismatch).length,
  states: stateReachability.length,
}, null, 2));
