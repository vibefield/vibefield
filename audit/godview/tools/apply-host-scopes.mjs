/**
 * Superseded by apply-semantics.mjs, which records the same account host
 * scopes together with sourceScope, staticPresence, and field domains.
 * Do not run this after apply-semantics.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUP = '748d015a7e393112e0a91dad80111fdf5abe6583';
const VIB = '433505fd0f224f4cda540d642661b13848c0ef82';
const TRACE = '08b5d849177685662b43e0e3a4e6bd7d32ac2cdf';
const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const ADAPTERS = ['acp', 'antigravity', 'claude', 'codex', 'copilot'];
const USAGE = { claude: 404, codex: 551, antigravity: 921 };
const PROFILES = { claude: 401, codex: 548, antigravity: 918, copilot: 1014 };

const pup = (path, lineStart, lineEnd, symbol) => ({
  repo: 'puppeteer',
  sha: PUP,
  path,
  lineStart,
  lineEnd,
  symbol,
});
const vib = (path, lineStart, lineEnd, symbol) => ({
  repo: 'vibefield',
  sha: VIB,
  path,
  lineStart,
  lineEnd,
  symbol,
});

const deriveAccount = pup('packages/monitor/src/backend/derive.ts', 273, 273, 'host.account copy');
const deriveProfile = pup('packages/monitor/src/backend/derive.ts', 62, 66, 'resolveProfileSet');
const applyProfile = pup('packages/monitor/src/backend/backend.ts', 433, 433, 'resolveProfileSet applied');
const rowProfile = pup('packages/monitor/src/backend/derive.ts', 282, 282, 'row profileSet');
const monitorHost = pup('apps/godview/src/main/monitor-host.ts', 62, 79, 'accountLabel to host.account');
const registry = pup('apps/godview/src/main/main.ts', 735, 766, 'monitorAccountLabels');
const usageView = pup('packages/views/src/usage/account-usage.ts', 63, 82, 'usage column accountLabel');
const listAccount = pup('packages/views/src/views/list/AgentList.tsx', 151, 185, 'list account');
const fielddHost = vib('packages/fieldd/src/agent-monitor.ts', 223, 266, 'hostRunFromSummary');
const peerStrip = vib('packages/field-app/src/godview/monitor/window-rows.ts', 119, 134, 'peer profileSet dropped');
const profileTabs = vib('packages/field-app/src/godview/monitor/profile-tabs.ts', 26, 28, 'agentProfileSet');
const acpBinding = pup('packages/builtin-providers/src/providers.ts', 642, 659, 'ACP has no profiles service');

function step(order, name, effect, source) {
  return { order, name, effect, source };
}

function usageStep(adapter) {
  if (USAGE[adapter]) {
    return step(
      4,
      'account-usage-separate',
      'accountUsage feeds the usage column only. It does not write field.account.',
      pup('packages/builtin-providers/src/providers.ts', USAGE[adapter], USAGE[adapter], 'accountUsage service'),
    );
  }
  const source = adapter === 'acp' ? acpBinding : pup('packages/builtin-providers/src/providers.ts', 1011, 1015, 'copilot profiles, no accountUsage');
  return step(
    4,
    'account-usage-separate',
    'This provider entry has no accountUsage service. Where another provider has one, that service feeds the usage column only. It does not write field.account.',
    source,
  );
}

function accountSteps(adapter) {
  const profiles = adapter === 'acp' ? acpBinding : pup('packages/builtin-providers/src/providers.ts', PROFILES[adapter], PROFILES[adapter], 'profiles service');
  return [
    step(0, 'adapter-emits-nothing', 'No adapter emits field.account. Profile services bind a host profile. They do not write the row.', profiles),
    step(1, 'derive-copies-host-account', 'derive copies host.account when it is set and otherwise omits the property. It has no other source.', deriveAccount),
    step(2, 'vibefield-host-omits', 'Vibefield hostRunFromSummary copies profileId and profileSet and never sets account. Under consumer 433505fd the row omits account for every adapter.', fielddHost),
    step(
      3,
      'puppeteer-host-label',
      adapter === 'acp'
        ? 'Puppeteer Godview sets account from accountLabel(profileId). ACP has no profiles service, so no profileId is bound and this host also omits account.'
        : 'Puppeteer Godview sets account from accountLabel(profileId) when the run is bound to a registered profile. The label map is monitorAccountLabels.',
      monitorHost,
    ),
    usageStep(adapter),
    step(5, 'readers-when-present', 'List, find, and the Vibefield filter read account only when the string is on the row. They do not invent one.', listAccount),
  ];
}

function profileSteps(adapter) {
  const binding = adapter === 'acp' ? acpBinding : pup('packages/builtin-providers/src/providers.ts', PROFILES[adapter], PROFILES[adapter], 'profiles service');
  return [
    step(
      0,
      'host-profile-inputs',
      adapter === 'acp'
        ? 'ACP has no profiles service. The Puppeteer host sets neither profileSet nor profileId. Vibefield copies summary.profileSet and profileId only when the summary already has them.'
        : 'A profiles service can bind profileId. Vibefield copies summary.profileSet and profileId. The Puppeteer Godview host copies profileId and does not set profileSet.',
      binding,
    ),
    step(1, 'resolve-profile-set', 'resolveProfileSet uses host.profileSet, else the persona set for profileId, else native.', deriveProfile),
    step(2, 'backend-applies', 'The agent fold passes that resolved string into the row. It is always set for an agent row.', applyProfile),
    step(3, 'row-copy', 'deriveAgentRow copies input.profileSet. Terminal rows copy only host.profileSet.', rowProfile),
    step(4, 'peer-rows-drop-it', 'Vibefield window-rows keeps profileSet on this device and drops it for other-device rows. Account is left unchanged.', peerStrip),
    step(5, 'self-row-readers', 'profile-tabs reads profileSet only for a self row. Swarm bloom compares agent.profileSet with the chosen profile.', profileTabs),
  ];
}

function accountGraph(adapter, steps) {
  const lines = [
    '%% field: field.account',
    `%% adapter: ${adapter}`,
    '%% host scopes: vibefield consumer vs Puppeteer Godview host',
    '%% forensic: source-read; not a live sample',
    'flowchart TD',
    `  n0["${steps[0].effect.replaceAll('"', "'")}"]`,
    '  n0 --> copy["derive.ts:273 copies only host.account"]',
    '  vf["Vibefield hostRunFromSummary agent-monitor.ts:223-266 never sets account"] --> copy',
    '  reg["Puppeteer main.ts:735-766 profile label map"] --> ph["Puppeteer monitor-host.ts:62-79"]',
    '  ph --> copy',
    '  copy --> vfRow["Vibefield consumer 433505fd: row omits account"]',
  ];
  if (adapter === 'acp') {
    lines.push('  ph --> acpNo["ACP has no profiles service: profileId unset, account omitted"]');
    lines.push('  acpNo --> vfRow');
  } else {
    lines.push('  ph --> ppRow["Puppeteer host: account is the profile label when profileId is registered"]');
    lines.push('  ppRow --> readers["AgentList.tsx:151,185 shows the string when present"]');
  }
  lines.push('  vfRow --> readersQuiet["readers show nothing when the property is omitted"]');
  lines.push('  usage["accountUsage is the usage column. It does not write field.account"]');
  return `${lines.join('\n')}\n`;
}

function profileGraph(adapter) {
  return `%% field: field.profileSet
%% adapter: ${adapter}
%% host scopes: backend always resolves; Vibefield drops peer rows
%% forensic: source-read; not a live sample
flowchart TD
  inputs["${adapter === 'acp' ? 'ACP has no profiles service' : 'profiles service can bind profileId'}"] --> resolve["resolveProfileSet derive.ts:62-66"]
  resolve --> hostSet["host.profileSet wins"]
  resolve --> persona["else personas of profileId, or native"]
  resolve --> native["else native"]
  hostSet --> row["backend.ts:433 then derive.ts:282"]
  persona --> row
  native --> row
  row --> self["self row keeps profileSet"]
  row --> peer["window-rows.ts:130-134 drops other-device profileSet"]
  self --> tabs["profile-tabs.ts:26-28"]
  self --> bloom["swarm bloom model.ts:381"]
${adapter === 'acp' ? '  native --> acpNative["ACP unbound result is native"]' : ''}
`;
}

function notesForAccount(adapter) {
  const puppeteer =
    adapter === 'acp'
      ? 'Puppeteer Godview host also omits account: monitor-host.ts:62 sets it only from profileId, and ACP has no profiles service (providers.ts:642-659).'
      : 'Puppeteer Godview host can show it: monitor-host.ts:62,79 sets account from accountLabel(profileId) when that id is registered (main.ts:735-766).';
  return [
    'HOST SCOPES. No adapter produces field.account.',
    'Envelope uiReachable=no is the Vibefield consumer 433505fd only, not a global absence and not a global false for every host.',
    'derive.ts:273 copies host.account and otherwise omits the property.',
    'Vibefield hostRunFromSummary (agent-monitor.ts:223-266) copies profileId and profileSet and never sets account, so the value is unreachable for this adapter under that consumer.',
    puppeteer,
    'accountUsage feeds the usage column only. It does not write field.account.',
    `GV2 account/profile trace ${TRACE}. Not a live sample.`,
  ].join(' ');
}

function notesForProfile(adapter) {
  const acp =
    adapter === 'acp'
      ? 'ACP has no profiles service, so the Puppeteer host supplies neither profileSet nor profileId and resolveProfileSet returns native. Vibefield still copies a summary profileSet when one is already present; GV2 records the unbound ACP row as native on self rows.'
      : 'The same resolver applies. Vibefield can supply summary.profileSet. The Puppeteer host supplies profileId and not profileSet, so the persona set or native is used.';
  return [
    'HOST SCOPES. No adapter emits field.profileSet. The backend always resolves one for an agent row.',
    'resolveProfileSet (derive.ts:62-66) uses host.profileSet, else the persona set for profileId, else native. backend.ts:433 applies it and derive.ts:282 copies it.',
    acp,
    'Vibefield window-rows.ts:119-134 keeps profileSet on this device and removes it for other-device rows. That strip is not a global absence. profile-tabs.ts:26-28 then reads only a self row.',
    `GV2 account/profile trace ${TRACE}. Not a live sample.`,
  ].join(' ');
}

const joinPath = join(ROOT, 'audit/godview/plan/gv-audit3-join.json');
const filled = JSON.parse(readFileSync(joinPath, 'utf8'));
filled.accountHostTrace = {
  repo: 'vibefield',
  commit: TRACE,
  path: 'audit/godview-model',
  consumer: VIB,
  source: PUP,
  note: 'field.account envelope uiReachable is the Vibefield consumer scope. Puppeteer Godview host is a separate scope. Neither scope is a global absence.',
};

for (const adapter of ADAPTERS) {
  for (const field of ['account', 'profileSet']) {
    const file = join(ROOT, 'audit/godview/evidence', adapter, `${field}.json`);
    const record = JSON.parse(readFileSync(file, 'utf8'));
    const steps = field === 'account' ? accountSteps(adapter) : profileSteps(adapter);
    const text = field === 'account' ? notesForAccount(adapter) : notesForProfile(adapter);
    record.sources = [];
    for (const item of steps) {
      if (!record.sources.some((source) => source.path === item.source.path && source.lineStart === item.source.lineStart && source.repo === item.source.repo)) {
        record.sources.push(item.source);
      }
    }
    if (field === 'account') record.sources.push(registry, usageView);
    else record.sources.push(pup('packages/views/src/views/swarm/bloom/model.ts', 372, 382, 'litFor profileSet'));
    record.producer = {
      kind: 'core-reducer',
      name: field === 'account' ? 'host.account copy' : 'resolveProfileSet',
      ingestedFrom: field === 'account' ? 'derive.ts:273 host.account only' : 'derive.ts:62-66 then backend.ts:433',
    };
    record.transforms = steps;
    if (field === 'account') {
      record.merge = { strategy: adapter === 'acp' ? 'none' : 'replace', defaults: [] };
      record.transport =
        adapter === 'acp'
          ? {
              channel: 'in-process',
              name: 'not-applicable',
              contract: 'Neither audited host sets account for ACP.',
            }
          : {
              channel: 'in-process',
              name: 'host-scoped',
              contract: 'Vibefield host omits account. Puppeteer Godview host may set it from a profile label.',
            };
      record.absence = { ...record.absence, onMissing: 'omit-field' };
      record.observation = { presence: 'unknown', synthetic: false };
      record.classification = { modelSupported: 'yes', adapterEmittable: 'no', uiReachable: 'no' };
      record.renderer = { viewIds: ['view.list'], component: 'direct reader', symbol: 'direct' };
    } else {
      record.merge = {
        strategy: 'defaulted',
        defaults: [
          { when: 'host.profileSet is set', presence: 'present', literal: 'host.profileSet', source: deriveProfile },
          {
            when: 'host.profileId is set and host.profileSet is not',
            presence: 'present',
            literal: 'native',
            source: deriveProfile,
          },
          {
            when: 'neither host.profileSet nor host.profileId is set',
            presence: 'present',
            literal: 'native',
            source: deriveProfile,
          },
        ],
      };
      record.transport = {
        channel: 'in-process',
        name: 'resolveProfileSet',
        contract: 'host.profileSet, else persona set, else native; peer rows lose it in the Vibefield overlay',
      };
      record.observation = { presence: 'unknown', synthetic: false };
      record.classification = { modelSupported: 'yes', adapterEmittable: 'no', uiReachable: 'yes' };
      record.renderer = { viewIds: ['view.swarm'], component: 'direct reader', symbol: 'direct' };
    }
    record.verification.notes = text;
    record.applicability.notes = text;
    if (field === 'profileSet') record.applicability.views = ['view.swarm'];
    if (field === 'account') record.applicability.views = ['view.list'];
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(
      file.replace(/\.json$/u, '.mmd'),
      field === 'account' ? accountGraph(adapter, steps) : profileGraph(adapter),
    );
    const row = filled.rowJoins.find((item) => item.adapterId === `adapter.${adapter}` && item.fieldId === `field.${field}`);
    row.classification = record.classification;
    row.rendererRead = 'direct';
    row.adapterPathProvidesValue = 'no';
    row.missingStateVisible = 'no';
    row.alternateProducer = field === 'account' ? 'packages/monitor/src/backend/derive.ts:273-273' : 'packages/monitor/src/backend/derive.ts:62-66';
    row.notApplicableReason = field === 'account' && adapter === 'acp' ? record.transport.contract : null;
    row.hostScopes = {
      trace: TRACE,
      envelopeUiReachableMeans: field === 'account' ? 'vibefield-consumer' : 'backend-row-and-self-readers',
      vibefield: {
        pin: VIB,
        account: 'unreachable',
        profileSet: adapter === 'acp' ? 'native-on-self-rows' : 'resolved-on-self-rows',
        peerProfileSet: 'removed',
        source: field === 'account' ? 'packages/fieldd/src/agent-monitor.ts:223-266' : 'packages/field-app/src/godview/monitor/window-rows.ts:119-134',
      },
      puppeteerGodview: {
        pin: PUP,
        account: adapter === 'acp' ? 'unreachable' : 'profile-label-when-bound',
        profileSet: adapter === 'acp' ? 'native' : 'persona-or-native',
        source: field === 'account' ? 'apps/godview/src/main/monitor-host.ts:62-79' : 'packages/monitor/src/backend/derive.ts:62-66',
      },
    };
    if (field === 'account') {
      row.continuation = [
        { stage: 'omission', note: 'No adapter emits account.' },
        { stage: 'vibefield-host', note: 'hostRunFromSummary never sets account.' },
        { stage: 'puppeteer-host', note: row.hostScopes.puppeteerGodview.account },
        { stage: 'derive', note: 'derive.ts:273 copies host.account or omits it.' },
      ];
      row.downstreamMapping = 'host-scoped';
    }
  }
}

writeFileSync(join(ROOT, 'audit/godview/plan/graphs/account-hosts.mmd'), accountGraph('claude', accountSteps('claude')));
writeFileSync(join(ROOT, 'audit/godview/plan/graphs/profile-set.mmd'), profileGraph('claude'));
writeFileSync(joinPath, `${JSON.stringify(filled, null, 2)}\n`);
console.log('host scopes applied', ADAPTERS.length * 2);
