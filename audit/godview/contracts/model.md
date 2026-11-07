# Godview unified model/API audit

Pins: vibefield `433505fd0f224f4cda540d642661b13848c0ef82`; puppeteer `748d015a7e393112e0a91dad80111fdf5abe6583`.

## Accuracy boundary
Complete declared MonitorAgentRow/AgentView property tree and SDK model interface property inventory. Orthogonal state axes enumerated, not infinite Cartesian combinations. Per-view consumption is evidence-backed reviewed set; absence of a consumer is unknown unless explicitly ruled. Per-adapter raw ingestion is delegated; capability declarations are not empirical live-session proof.

**Key finding:** VibeField aliases `MonitorAgent = AgentView`; canonical business model and all five built-in desktop monitor views are imported from Puppeteer, not duplicated in VibeField. (`vibefield:packages/field-app/src/godview/monitor/types.ts:1-13`).

**Important dependency caveat:** VibeField lockfile selects published `0.3.3`; supplied Puppeteer source pin is audited separately. Matching version labels do not prove published-artifact byte equivalence.

## Counts
```json
{
  "statusEnumValues": 3,
  "stateEntries": 82,
  "rowTopLevelFields": 29,
  "windowOverlayTopLevelFields": 6,
  "fieldEntries": 74,
  "contractFieldEntries": 86,
  "schemaDefinitions": 31,
  "apiEntries": 19,
  "views": 5,
  "adapters": 10,
  "declaredCapabilityCells": 90,
  "adapterRestrictionEntries": 12
}
```

## Architecture
```text
native adapter -> pipeline.ts AgentEvents / monitor.ts semantic batches
 -> runtime translate/reduce/project -> AgentMonitorState
 -> desktop backend + host facts -> MonitorAgentRow
 -> audience cut -> agent.subscribe model mesh board
 -> ModelBoardFold -> replica + window facts -> AgentView
 -> VibeField window-rows display patch (standing / profiles / continuity)
 -> MonitorModel view input -> swarm | list | rain | timeline | spend
```

monitor.ts/pipeline.ts are confirmed upstream normalization seams, NOT direct row mapping. The actual model mapping is `puppeteer:packages/monitor/src/backend/derive.ts:240-286`; VibeField host wiring `packages/fieldd/src/agent-monitor.ts:461-493`.

## State inventory (orthogonal axes, not Cartesian synthetic states)
### `state.idle` — status (item)
Predicate: `status === 'idle'`. Recomputed after accepted evidence: no runnable child, no blocker, no activity; host pending forces idle; quiet terminal idle.
Evidence: puppeteer:packages/core/src/monitor/transitions.ts:361-371; puppeteer:packages/monitor/src/backend/derive.ts:68-76

### `state.working` — status (item)
Predicate: `status === 'working'`. Runnable child wins over blockers; else activity means working; absent initial state working; terminal foreground job working.
Evidence: puppeteer:packages/core/src/monitor/transitions.ts:361-371; puppeteer:packages/monitor/src/backend/derive.ts:68-76; puppeteer:packages/monitor/src/terminal-status.ts:8-12

### `state.blocked` — status (item)
Predicate: `status === 'blocked'`. No runnable child AND >=1 blocker. Removing last blocker recomputes working/idle; dead failures remain blocked until acknowledged. Core statusSince retained until status changes.
Evidence: puppeteer:packages/core/src/monitor/transitions.ts:361-371; puppeteer:packages/monitor/src/backend/derive.ts:68-76; puppeteer:packages/core/src/monitor/project.ts:398-404

### `state.blocked_permission` — wait (item)
Predicate: `status === 'blocked' && wait.kind === 'permission'`. First blocker sorted failure > question > permission, then time/id. Other blockers count retained; answering/clearing/retracting evidence recomputes status.
Evidence: puppeteer:packages/core/src/monitor/transitions.ts:93-170; puppeteer:packages/monitor/src/backend/derive.ts:130-161

### `state.blocked_question` — wait (item)
Predicate: `status === 'blocked' && wait.kind === 'question'`. First blocker sorted failure > question > permission, then time/id. Other blockers count retained; answering/clearing/retracting evidence recomputes status.
Evidence: puppeteer:packages/core/src/monitor/transitions.ts:93-170; puppeteer:packages/monitor/src/backend/derive.ts:130-161

### `state.blocked_failure` — wait (item)
Predicate: `status === 'blocked' && wait.kind === 'failure'`. First blocker sorted failure > question > permission, then time/id. Other blockers count retained; answering/clearing/retracting evidence recomputes status.
Evidence: puppeteer:packages/core/src/monitor/transitions.ts:93-170; puppeteer:packages/monitor/src/backend/derive.ts:130-161

### `state.working_with_blockers` — composite (item)
Predicate: `status === 'working' && wait !== undefined`. A runnable child can keep run working while another actor waits. Do not equate wait-present with status blocked.
Evidence: puppeteer:packages/core/src/monitor/transitions.ts:369-371; puppeteer:packages/monitor/src/backend/derive.ts:248

### `state.wait_multiple` — wait (item)
Predicate: `wait.count > 1`. Count combines bounded blockers + omitted count, disappears at one.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:141-159

### `state.activity_starting` — activity (item)
Predicate: `activity.kind === 'starting'`. Activity priority compacting > tool > reasoning > responding > delegating > starting > other; newest at equal priority. Pending/blocked can coexist with retained activity; activity is not another status.
Evidence: puppeteer:packages/core/src/monitor/types.ts:88-95; puppeteer:packages/core/src/monitor/transitions.ts:178-191; puppeteer:packages/core/src/monitor/transitions.ts:212-260

### `state.activity_responding` — activity (item)
Predicate: `activity.kind === 'responding'`. Activity priority compacting > tool > reasoning > responding > delegating > starting > other; newest at equal priority. Pending/blocked can coexist with retained activity; activity is not another status.
Evidence: puppeteer:packages/core/src/monitor/types.ts:88-95; puppeteer:packages/core/src/monitor/transitions.ts:178-191; puppeteer:packages/core/src/monitor/transitions.ts:212-260

### `state.activity_reasoning` — activity (item)
Predicate: `activity.kind === 'reasoning'`. Activity priority compacting > tool > reasoning > responding > delegating > starting > other; newest at equal priority. Pending/blocked can coexist with retained activity; activity is not another status.
Evidence: puppeteer:packages/core/src/monitor/types.ts:88-95; puppeteer:packages/core/src/monitor/transitions.ts:178-191; puppeteer:packages/core/src/monitor/transitions.ts:212-260

### `state.activity_tool` — activity (item)
Predicate: `activity.kind === 'tool'`. Activity priority compacting > tool > reasoning > responding > delegating > starting > other; newest at equal priority. Pending/blocked can coexist with retained activity; activity is not another status.
Evidence: puppeteer:packages/core/src/monitor/types.ts:88-95; puppeteer:packages/core/src/monitor/transitions.ts:178-191; puppeteer:packages/core/src/monitor/transitions.ts:212-260

### `state.activity_delegating` — activity (item)
Predicate: `activity.kind === 'delegating'`. Activity priority compacting > tool > reasoning > responding > delegating > starting > other; newest at equal priority. Pending/blocked can coexist with retained activity; activity is not another status.
Evidence: puppeteer:packages/core/src/monitor/types.ts:88-95; puppeteer:packages/core/src/monitor/transitions.ts:178-191; puppeteer:packages/core/src/monitor/transitions.ts:212-260

### `state.activity_compacting` — activity (item)
Predicate: `activity.kind === 'compacting'`. Activity priority compacting > tool > reasoning > responding > delegating > starting > other; newest at equal priority. Pending/blocked can coexist with retained activity; activity is not another status.
Evidence: puppeteer:packages/core/src/monitor/types.ts:88-95; puppeteer:packages/core/src/monitor/transitions.ts:178-191; puppeteer:packages/core/src/monitor/transitions.ts:212-260

### `state.activity_other` — activity (item)
Predicate: `activity.kind === 'other'`. Activity priority compacting > tool > reasoning > responding > delegating > starting > other; newest at equal priority. Pending/blocked can coexist with retained activity; activity is not another status.
Evidence: puppeteer:packages/core/src/monitor/types.ts:88-95; puppeteer:packages/core/src/monitor/transitions.ts:178-191; puppeteer:packages/core/src/monitor/transitions.ts:212-260

### `state.starting_unobserved` — observation (item)
Predicate: `kind=agent && !observed && !pending`. Host run with no runtime state -> working, detail starting. First runtime state ends this phase.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:68-88; puppeteer:packages/monitor/src/backend/derive.ts:183-186

### `state.pending_unobserved` — observation (item)
Predicate: `kind=agent && pending=true && observed=false`. Host pending -> idle and unobserved. Backend detail distinguishes resume-when-idle vs other; row boolean loses pending subtype.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:68-88; puppeteer:packages/monitor/src/backend/derive.ts:183-186; puppeteer:packages/monitor/src/backend/derive.ts:262

### `state.stale` — freshness (item)
Predicate: `stale=true`. Owner backend: strict evidence-age threshold, only working/blocked without open root tool; no timestamp/idle/tool -> false. VibeField peer display overrides stale whenever desktop standing != live, even for idle. Not a fourth status.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:210-225; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:116

### `state.fresh` — freshness (item)
Predicate: `stale=false`. Complement of stale includes idle/tool/no evidence, not a guarantee of recent evidence.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:210-225; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:116

### `state.unread` — attention (item)
Predicate: `kind=agent && status=idle && unread`. Idle began after last seen; reportShown clears daemon mark; never terminals. Toolkit calls reply unseen, timeline/spend call unseen.
Evidence: puppeteer:packages/monitor/src/backend/unread.ts:38-56; puppeteer:packages/view-sdk/src/toolkit/state-words.ts:75-97

### `state.failed_retained` — liveness (item)
Predicate: `kind=agent && !alive && wait.kind=failure`. Kept on monitor only with local pane join. Acknowledging screen must show pane; runtime acknowledgement removes model row across screens.
Evidence: vibefield:packages/field-app/src/godview/monitor/failed-bodies.ts:20-35; vibefield:packages/fieldd/src/agent-monitor.ts:509-558

### `state.dead_hidden` — liveness (item)
Predicate: `!alive and no keepFailure/handoff predicate`. Model may hold row while VibeField visible predicate excludes it. Not new status; clean completed attachment handoff is exception.
Evidence: vibefield:packages/field-app/src/godview/monitor/useMonitorAgents.ts:517-548

### `state.terminal_running` — kind (item)
Predicate: `kind=terminal && status=working`. Bare terminal only working/idle. foreground-job works; renderer window activity may override host.
Evidence: puppeteer:packages/monitor/src/terminal-status.ts:8-12; puppeteer:packages/monitor/src/replica/replica.ts:297-333

### `state.terminal_quiet` — kind (item)
Predicate: `kind=terminal && status=idle`. Bare terminal only working/idle. foreground-job works; renderer window activity may override host.
Evidence: puppeteer:packages/monitor/src/terminal-status.ts:8-12; puppeteer:packages/monitor/src/replica/replica.ts:297-333

### `state.terminal_empty` — presentation (item)
Predicate: `swarm terminal with no running job and no opening`. Swarm empty body; timeline/list call idle terminal quiet; empty is not model status.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:368-442

### `state.terminal_opening` — presentation (item)
Predicate: `swarm input.opening exists`. Host/view birth overlay; initially empty word, after OPENING_QUIET_MS says opening. Not a backend row field.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:368-442

### `state.remote` — device (item)
Predicate: `!device.self`. Independent orthogonal predicate; window/roster/host changes update it without necessarily changing status.
Evidence: puppeteer:packages/view-sdk/src/model.ts:34-40

### `state.active` — window (item)
Predicate: `active=true`. Independent orthogonal predicate; window/roster/host changes update it without necessarily changing status.
Evidence: puppeteer:packages/monitor/src/replica/replica.ts:337-372

### `state.receded` — window (item)
Predicate: `receded=true`. Independent orthogonal predicate; window/roster/host changes update it without necessarily changing status.
Evidence: vibefield:packages/field-app/src/godview/monitor/useMonitorAgents.ts:550-555

### `state.attached` — window (item)
Predicate: `attachment exists`. Independent orthogonal predicate; window/roster/host changes update it without necessarily changing status.
Evidence: puppeteer:packages/monitor/src/replica/replica.ts:281-288

### `state.attachable` — capability (item)
Predicate: `attachable=true`. Independent orthogonal predicate; window/roster/host changes update it without necessarily changing status.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:251-285

### `state.detached` — window (item)
Predicate: `attachment absent`. Independent orthogonal predicate; window/roster/host changes update it without necessarily changing status.
Evidence: puppeteer:packages/monitor/src/replica/replica.ts:281-288

### `state.cost_complete` — metric (item)
Predicate: `cost.coverage=complete`. Coverage is price-evidence completeness, never zero-fill unavailable. Backend emits no cost object without total; unavailable present is schema-supported but normal backend emission not established.
Evidence: puppeteer:packages/view-sdk/src/model.ts:84-95; puppeteer:packages/monitor/src/backend/backend.ts:197-205

### `state.cost_partial` — metric (item)
Predicate: `cost.coverage=partial`. Coverage is price-evidence completeness, never zero-fill unavailable. Backend emits no cost object without total; unavailable present is schema-supported but normal backend emission not established.
Evidence: puppeteer:packages/view-sdk/src/model.ts:84-95; puppeteer:packages/monitor/src/backend/backend.ts:197-205

### `state.cost_unavailable` — metric (item)
Predicate: `cost.coverage=unavailable`. Coverage is price-evidence completeness, never zero-fill unavailable. Backend emits no cost object without total; unavailable present is schema-supported but normal backend emission not established.
Evidence: puppeteer:packages/view-sdk/src/model.ts:84-95; puppeteer:packages/monitor/src/backend/backend.ts:197-205

### `state.cost_missing` — metric (item)
Predicate: `cost absent`. No priced ledger total -> missing; zero is distinct.
Evidence: puppeteer:packages/monitor/src/backend/backend.ts:197-205

### `state.context_missing` — metric (item)
Predicate: `context absent`. Missing/nonfinite runtime percent -> absent; not zero.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:247; puppeteer:packages/monitor/src/backend/derive.ts:274

### `state.context_hot` — presentation (item)
Predicate: `swarm floor(context.usedPercent)>=80`. Ring clamp 0..100; hot at 80; renderer rule, not runtime state.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:328-330; puppeteer:packages/views/src/views/swarm/bubble-model.ts:450

### `state.effort_configured` — intent (item)
Predicate: `effort.intent=configured`. Configured intent rendered italic; omitted intent treated observed; values are open strings.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:320-325

### `state.effort_observed` — intent (item)
Predicate: `effort.intent=observed`. Configured intent rendered italic; omitted intent treated observed; values are open strings.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:320-325

### `state.past_worked` — history (history)
Predicate: `past.span.kind=worked`. History is separate read-through, not synced item status. Recorded work/quiet cannot reconstruct blocked or unread.
Evidence: puppeteer:packages/view-sdk/src/model.ts:254-267

### `state.past_quiet` — history (history)
Predicate: `past.span.kind=quiet`. History is separate read-through, not synced item status. Recorded work/quiet cannot reconstruct blocked or unread.
Evidence: puppeteer:packages/view-sdk/src/model.ts:254-267

### `state.past_unrecorded` — history (history)
Predicate: `past.span.kind=unrecorded`. History is separate read-through, not synced item status. Recorded work/quiet cannot reconstruct blocked or unread.
Evidence: puppeteer:packages/view-sdk/src/model.ts:254-267

### `state.past_bounds` — history (history)
Predicate: `past.span.kind=bounds`. History is separate read-through, not synced item status. Recorded work/quiet cannot reconstruct blocked or unread.
Evidence: puppeteer:packages/view-sdk/src/model.ts:254-267

### `state.timeline_unborn` — presentation (history)
Predicate: `timeline moment.kind=unborn`. Cursor time relative to birth, record and current seam selects moment. Not live status.
Evidence: puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:84-89; puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:248-263

### `state.timeline_unrecorded` — presentation (history)
Predicate: `timeline moment.kind=unrecorded`. Cursor time relative to birth, record and current seam selects moment. Not live status.
Evidence: puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:84-89; puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:248-263

### `state.timeline_past` — presentation (history)
Predicate: `timeline moment.kind=past`. Cursor time relative to birth, record and current seam selects moment. Not live status.
Evidence: puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:84-89; puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:248-263

### `state.timeline_ended` — presentation (history)
Predicate: `timeline moment.kind=ended`. Cursor time relative to birth, record and current seam selects moment. Not live status.
Evidence: puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:84-89; puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:248-263

### `state.timeline_span` — presentation (history)
Predicate: `timeline moment.kind=span`. Cursor time relative to birth, record and current seam selects moment. Not live status.
Evidence: puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:84-89; puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:248-263

### `state.spend_before` — presentation (item)
Predicate: `spendStateAt key=before`. Before birth -> before; before current statusSince and >1s before now -> unknown. View keeps no full history of state.
Evidence: puppeteer:packages/views/src/views/spend/spend-words.ts:133-151

### `state.spend_unknown` — presentation (item)
Predicate: `spendStateAt key=unknown`. Before birth -> before; before current statusSince and >1s before now -> unknown. View keeps no full history of state.
Evidence: puppeteer:packages/views/src/views/spend/spend-words.ts:133-151

### `state.spawn_ready` — spawn (spawn)
Predicate: `spawn.devices[].state=ready`. Only ready may spawn; menu/device status, not agent run status.
Evidence: puppeteer:packages/view-sdk/src/model.ts:193-208

### `state.spawn_asleep` — spawn (spawn)
Predicate: `spawn.devices[].state=asleep`. Only ready may spawn; menu/device status, not agent run status.
Evidence: puppeteer:packages/view-sdk/src/model.ts:193-208

### `state.spawn_silent` — spawn (spawn)
Predicate: `spawn.devices[].state=silent`. Only ready may spawn; menu/device status, not agent run status.
Evidence: puppeteer:packages/view-sdk/src/model.ts:193-208

### `state.spawn_incompatible` — spawn (spawn)
Predicate: `spawn.devices[].state=incompatible`. Only ready may spawn; menu/device status, not agent run status.
Evidence: puppeteer:packages/view-sdk/src/model.ts:193-208

### `state.spawn_reading` — spawn (spawn)
Predicate: `spawn.devices[].state=reading`. Only ready may spawn; menu/device status, not agent run status.
Evidence: puppeteer:packages/view-sdk/src/model.ts:193-208

### `state.feed_no_door` — feed (feed)
Predicate: `feed.state=no-door`. Door state/replay failures and retry backoff govern feed; invalid snapshot nonretryable; gaps reopen. Never agent idle fallback.
Evidence: vibefield:packages/field-app/src/godview/monitor/model-replica.ts:49-53; vibefield:packages/field-app/src/godview/monitor/model-replica.ts:176-253

### `state.feed_connecting` — feed (feed)
Predicate: `feed.state=connecting`. Door state/replay failures and retry backoff govern feed; invalid snapshot nonretryable; gaps reopen. Never agent idle fallback.
Evidence: vibefield:packages/field-app/src/godview/monitor/model-replica.ts:49-53; vibefield:packages/field-app/src/godview/monitor/model-replica.ts:176-253

### `state.feed_live` — feed (feed)
Predicate: `feed.state=live`. Door state/replay failures and retry backoff govern feed; invalid snapshot nonretryable; gaps reopen. Never agent idle fallback.
Evidence: vibefield:packages/field-app/src/godview/monitor/model-replica.ts:49-53; vibefield:packages/field-app/src/godview/monitor/model-replica.ts:176-253

### `state.feed_unavailable` — feed (feed)
Predicate: `feed.state=unavailable`. Door state/replay failures and retry backoff govern feed; invalid snapshot nonretryable; gaps reopen. Never agent idle fallback.
Evidence: vibefield:packages/field-app/src/godview/monitor/model-replica.ts:49-53; vibefield:packages/field-app/src/godview/monitor/model-replica.ts:176-253

### `state.burn_flames_0` — presentation (item)
Predicate: `priced working swarm cost rate USD/min in [0, 0.05)`. Four inclusive thresholds 0.05, 0.15, 0.4, 1 USD/min. Convert backend burnPerHour / 60 with 15-significant-digit normalization; missing priced rate falls back zero; unpriced ladder is unread, not calm.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:53-75; puppeteer:packages/views/src/views/swarm/bubble-model.ts:283-290; puppeteer:packages/views/src/views/swarm/bubble-model.ts:469-523

### `state.burn_flames_1` — presentation (item)
Predicate: `priced working swarm cost rate USD/min in [0.05, 0.15)`. Four inclusive thresholds 0.05, 0.15, 0.4, 1 USD/min. Convert backend burnPerHour / 60 with 15-significant-digit normalization; missing priced rate falls back zero; unpriced ladder is unread, not calm.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:53-75; puppeteer:packages/views/src/views/swarm/bubble-model.ts:283-290; puppeteer:packages/views/src/views/swarm/bubble-model.ts:469-523

### `state.burn_flames_2` — presentation (item)
Predicate: `priced working swarm cost rate USD/min in [0.15, 0.4)`. Four inclusive thresholds 0.05, 0.15, 0.4, 1 USD/min. Convert backend burnPerHour / 60 with 15-significant-digit normalization; missing priced rate falls back zero; unpriced ladder is unread, not calm.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:53-75; puppeteer:packages/views/src/views/swarm/bubble-model.ts:283-290; puppeteer:packages/views/src/views/swarm/bubble-model.ts:469-523

### `state.burn_flames_3` — presentation (item)
Predicate: `priced working swarm cost rate USD/min in [0.4, 1)`. Four inclusive thresholds 0.05, 0.15, 0.4, 1 USD/min. Convert backend burnPerHour / 60 with 15-significant-digit normalization; missing priced rate falls back zero; unpriced ladder is unread, not calm.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:53-75; puppeteer:packages/views/src/views/swarm/bubble-model.ts:283-290; puppeteer:packages/views/src/views/swarm/bubble-model.ts:469-523

### `state.burn_flames_4` — presentation (item)
Predicate: `priced working swarm cost rate USD/min in [1, infinity)`. Four inclusive thresholds 0.05, 0.15, 0.4, 1 USD/min. Convert backend burnPerHour / 60 with 15-significant-digit normalization; missing priced rate falls back zero; unpriced ladder is unread, not calm.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:53-75; puppeteer:packages/views/src/views/swarm/bubble-model.ts:283-290; puppeteer:packages/views/src/views/swarm/bubble-model.ts:469-523

### `state.burn_unpriced` — presentation (item)
Predicate: `working swarm with no complete/partial cost coverage`. No price: no meaningful burn rate, flames unlit and priced=false; never claim $0. Range of supported cost completeness is separate.
Evidence: puppeteer:packages/views/src/views/swarm/bubble-model.ts:474-477; puppeteer:packages/views/src/views/swarm/bubble-model.ts:523

### `state.branch_unknown` — metadata (item)
Predicate: `project.branch absent`. Observed nonempty branch > host fallback > observed null > workspace branch. Empty string may remain if supplied by workspace, but view small labels use truthiness.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:97-107

### `state.branch_none` — metadata (item)
Predicate: `project.branch === null`. Observed nonempty branch > host fallback > observed null > workspace branch. Empty string may remain if supplied by workspace, but view small labels use truthiness.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:97-107

### `state.branch_named` — metadata (item)
Predicate: `typeof project.branch === string`. Observed nonempty branch > host fallback > observed null > workspace branch. Empty string may remain if supplied by workspace, but view small labels use truthiness.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:97-107

### `state.reply_streaming` — metadata (item)
Predicate: `reply.final === false`. Latest bounded root reply replaces previous; blank reply omitted. final is carried but no builtin consumer is proven for this flag.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:188-196; puppeteer:packages/view-sdk/src/model.ts:76-82

### `state.reply_final` — metadata (item)
Predicate: `reply.final === true`. Latest bounded root reply replaces previous; blank reply omitted. final is carried but no builtin consumer is proven for this flag.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:188-196; puppeteer:packages/view-sdk/src/model.ts:76-82

### `state.reply_missing` — metadata (item)
Predicate: `reply absent`. Latest bounded root reply replaces previous; blank reply omitted. final is carried but no builtin consumer is proven for this flag.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:188-196; puppeteer:packages/view-sdk/src/model.ts:76-82

### `state.tier_managed` — metadata (item)
Predicate: `tier=managed`. Host tier copied. Does not determine reader-relative remote identity; device.self is separate.
Evidence: puppeteer:packages/view-sdk/src/model.ts:19-20; puppeteer:packages/monitor/src/backend/derive.ts:281

### `state.tier_ingested` — metadata (item)
Predicate: `tier=ingested`. Host tier copied. Does not determine reader-relative remote identity; device.self is separate.
Evidence: puppeteer:packages/view-sdk/src/model.ts:19-20; puppeteer:packages/monitor/src/backend/derive.ts:281

### `state.tier_remote` — metadata (item)
Predicate: `tier=remote`. Host tier copied. Does not determine reader-relative remote identity; device.self is separate.
Evidence: puppeteer:packages/view-sdk/src/model.ts:19-20; puppeteer:packages/monitor/src/backend/derive.ts:281

### `state.model_missing` — metadata (item)
Predicate: `model absent`. No runtime model -> modelWord falls back provider label. Provider identity is host metadata, not inferred model evidence.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:244; puppeteer:packages/view-sdk/src/toolkit/words.ts:47-50

### `state.effort_absent` — metadata (item)
Predicate: `effort absent`. No runtime effort evidence -> no effort line; no default effort name is fabricated.
Evidence: puppeteer:packages/monitor/src/backend/derive.ts:176-181; puppeteer:packages/views/src/views/swarm/bubble-model.ts:320-325

### `state.blocked_unknown_kind` — compatibility (item)
Predicate: `status=blocked && wait.kind not permission/question/failure`. Wire/SDK wait.kind is open, but current core MonitorBlocker union cannot emit other kinds. Fixture/future-reader supported only: toolkit says raw word, swarm treats unknown wait as no drawnWait and failure fallback.
Evidence: puppeteer:packages/view-sdk/src/model.ts:46-61; puppeteer:packages/core/src/monitor/types.ts:74-86; puppeteer:packages/view-sdk/src/toolkit/state-words.ts:46-55; puppeteer:packages/views/src/views/swarm/bubble-model.ts:260-274

### `state.device_live` — device-standing (device)
Predicate: `board device state=live`. Standing is per-desktop board data, not agent status. Rows retained when device stops being live; VibeField remote display stale is state != live.
Evidence: vibefield:packages/contracts/src/rows.ts:138-139; vibefield:packages/field-app/src/godview/monitor/model-board.ts:216-229; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:116

### `state.device_stale` — device-standing (device)
Predicate: `board device state=stale`. Standing is per-desktop board data, not agent status. Rows retained when device stops being live; VibeField remote display stale is state != live.
Evidence: vibefield:packages/contracts/src/rows.ts:138-139; vibefield:packages/field-app/src/godview/monitor/model-board.ts:216-229; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:116

### `state.device_asleep` — device-standing (device)
Predicate: `board device state=asleep`. Standing is per-desktop board data, not agent status. Rows retained when device stops being live; VibeField remote display stale is state != live.
Evidence: vibefield:packages/contracts/src/rows.ts:138-139; vibefield:packages/field-app/src/godview/monitor/model-board.ts:216-229; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:116

### `state.device_incompatible` — device-standing (device)
Predicate: `board device state=incompatible`. Standing is per-desktop board data, not agent status. Rows retained when device stops being live; VibeField remote display stale is state != live.
Evidence: vibefield:packages/contracts/src/rows.ts:138-139; vibefield:packages/field-app/src/godview/monitor/model-board.ts:216-229; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:116

## Fields
Optional means omitted in JSON, not null. Nested fields can be required inside an optional parent. Only project.branch is explicitly nullable in the row tree. Backend defaults below are derivation defaults, not generic JSON Schema defaults.
### `field.inputUsed`
Type: `boolean | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent
Derivation: Host interactive shell lifetime input evidence; omitted on agent rows, conditionally copied for bare interactive non-exited terminals. VibeField window transition membership and visual identity also consume inputUsed.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "indirect host/replica control path; Display membership and handoff visual identity."}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:124; puppeteer:packages/monitor/src/backend/derive.ts:298-305; vibefield:packages/fieldd/src/agent-monitor.ts:280-285; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:99-136

### `field.creationId`
Type: `string | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent
Derivation: Host birth correlation copied when present; never runtime/action identity. VibeField window transition correlation consumes creationId to decide visual continuity and prior-id fallback.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "indirect host/replica control path; Display handoff identity."}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:126; puppeteer:packages/monitor/src/backend/derive.ts:253-255; puppeteer:packages/monitor/src/backend/derive.ts:302-305; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:99-136

### `field.id`
Type: `string`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: required; assigned by backend
Derivation: Backend stable id; terminal promotion preserves shell id; run resume preserves row identity, never assume runtimeRunId.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:129; puppeteer:packages/monitor/src/backend/backend.ts:154-160; vibefield:packages/fieldd/src/agent-monitor.ts:216-221

### `field.kind`
Type: `AgentRowKind`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: agent or terminal by source
Derivation: Agent derivation emits agent; bare terminal emits terminal.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:130; puppeteer:packages/monitor/src/backend/derive.ts:254; puppeteer:packages/monitor/src/backend/derive.ts:303

### `field.createdAt`
Type: `number`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: 0 when host does not know
Derivation: Host birth copied; VibeField converts summary ISO time to epoch milliseconds, invalid/missing -> 0; terminal birth missing -> 0.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:132; puppeteer:packages/monitor/src/backend/derive.ts:256; puppeteer:packages/monitor/src/backend/derive.ts:306; vibefield:packages/fieldd/src/agent-monitor.ts:240; vibefield:packages/fieldd/src/agent-monitor.ts:287

### `field.status`
Type: `AgentStatus`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: working before first agent state; idle for pending/bare quiet terminal
Derivation: Pending host run -> idle; otherwise runtime state status; absent state -> working. Bare terminal foreground-job -> working, otherwise idle. Replica can override terminal status using window activity with same rule.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:133; puppeteer:packages/monitor/src/backend/derive.ts:68-72; puppeteer:packages/monitor/src/terminal-status.ts:8-12; puppeteer:packages/monitor/src/replica/replica.ts:310-333

### `field.statusSince`
Type: `number`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: host.createdAt for agent without valid clock
Derivation: Parsed runtime statusSince, fallback host.createdAt; terminal backend tracks status flip; window activity override keeps separate status clock. Core preserves statusSince while status unchanged.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:135; puppeteer:packages/monitor/src/backend/derive.ts:74-76; puppeteer:packages/monitor/src/replica/replica.ts:310-333; puppeteer:packages/core/src/monitor/project.ts:398-404

### `field.stale`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: false for terminal
Derivation: Presentation evidence recency, not status: no state or idle -> false; root tool activity/toolOpen -> false; otherwise lastEvidenceAt age strictly > staleAfterMs (default 30000 ms); no clock -> not stale. Backend recency tick default 10000 ms. VibeField DISPLAY override for peers: stale = standing.get(device.id) !== live, not owner evidence recency.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:137; puppeteer:packages/monitor/src/backend/derive.ts:210-225; puppeteer:packages/core/src/monitor/freshness.ts:9-42; puppeteer:packages/monitor/src/backend/backend.ts:39; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:99-136

### `field.alive`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: true absent runtime/host exit
Derivation: Host alive=false overrides runtime; else state.alive ?? true. Terminal live rows emit true; exited husks are excluded from assembly.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "indirect host/replica control path; VibeField visible predicate; affects whether views receive a row."}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:139; puppeteer:packages/monitor/src/backend/derive.ts:78-82; puppeteer:packages/monitor/src/backend/derive.ts:310; vibefield:packages/fieldd/src/agent-monitor.ts:227-245

### `field.observed`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: false before first state or pending
Derivation: State exists AND no host.pending. Bare terminal always true.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:142; puppeteer:packages/monitor/src/backend/derive.ts:183-186; puppeteer:packages/monitor/src/backend/derive.ts:311

### `field.pending`
Type: `boolean | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent; not false
Derivation: Boolean true iff host.pending exists (host string not forwarded). AR-4 pending means no driver; detail distinguishes resume-when-idle.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:144; puppeteer:packages/monitor/src/backend/derive.ts:84-88; puppeteer:packages/monitor/src/backend/derive.ts:262

### `field.detail`
Type: `string`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: starting for new agent; Unassigned terminal for terminal without cwd
Derivation: Pending resume -> unobserved · resumes when idle; other pending -> unobserved; absent state -> starting; else core headline detail. Terminal cwd path or Unassigned terminal. Peer cut replaces terminal path with folder and bounds text. Toolkit detailLine is a distinct presentation rule, not a rewrite of this field.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:146; puppeteer:packages/monitor/src/backend/derive.ts:84-89; puppeteer:packages/monitor/src/backend/derive.ts:312; vibefield:packages/fieldd/src/agent-field.ts:664-700; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84

### `field.activity`
Type: `MonitorActivity | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent without evidence
Derivation: Runtime activity kind copied, line trimmed/codepoint-bounded and omitted if empty, since ISO parsed and omitted if invalid. Terminal host activity kind only; replica may join terminal window activity.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:151; puppeteer:packages/monitor/src/backend/derive.ts:163-174; puppeteer:packages/monitor/src/backend/derive.ts:313; puppeteer:packages/monitor/src/replica/replica.ts:297-307

### `field.activity.kind`
Type: `string`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits activity derivation (optional means omitted, not null).
Derivation: Runtime activity kind copied, line trimmed/codepoint-bounded and omitted if empty, since ISO parsed and omitted if invalid. Terminal host activity kind only; replica may join terminal window activity.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:65; puppeteer:packages/monitor/src/backend/derive.ts:163-174; puppeteer:packages/monitor/src/backend/derive.ts:313; puppeteer:packages/monitor/src/replica/replica.ts:297-307

### `field.activity.line`
Type: `string | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits activity derivation (optional means omitted, not null).
Derivation: Runtime activity kind copied, line trimmed/codepoint-bounded and omitted if empty, since ISO parsed and omitted if invalid. Terminal host activity kind only; replica may join terminal window activity.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:66; puppeteer:packages/monitor/src/backend/derive.ts:163-174; puppeteer:packages/monitor/src/backend/derive.ts:313; puppeteer:packages/monitor/src/replica/replica.ts:297-307

### `field.activity.since`
Type: `number | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits activity derivation (optional means omitted, not null).
Derivation: Runtime activity kind copied, line trimmed/codepoint-bounded and omitted if empty, since ISO parsed and omitted if invalid. Terminal host activity kind only; replica may join terminal window activity.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:67; puppeteer:packages/monitor/src/backend/derive.ts:163-174; puppeteer:packages/monitor/src/backend/derive.ts:313; puppeteer:packages/monitor/src/replica/replica.ts:297-307

### `field.project`
Type: `MonitorProject`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: required object; branch/seq absent if unknown
Derivation: Folder basename of observed cwd || workspace.sourcePath || workspace.root || host.cwd; fallback provider label.trim() || id. Branch: nonempty observed branch > host.fallbackBranch > observed git answer (including null) > workspace.branch. seq dealt by backend project identity. Peer cut removes seq. Terminal basename cwd, else title || terminal; implementation may have nonempty terminal project name despite older type prose.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:152; puppeteer:packages/monitor/src/backend/derive.ts:91-113; puppeteer:packages/monitor/src/backend/derive.ts:265-269; puppeteer:packages/monitor/src/backend/derive.ts:314; vibefield:packages/fieldd/src/agent-field.ts:668-680

### `field.project.name`
Type: `string`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: No independent default; inherits project derivation (optional means omitted, not null).
Derivation: Folder basename of observed cwd || workspace.sourcePath || workspace.root || host.cwd; fallback provider label.trim() || id. Branch: nonempty observed branch > host.fallbackBranch > observed git answer (including null) > workspace.branch. seq dealt by backend project identity. Peer cut removes seq. Terminal basename cwd, else title || terminal; implementation may have nonempty terminal project name despite older type prose.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:104; puppeteer:packages/monitor/src/backend/derive.ts:91-113; puppeteer:packages/monitor/src/backend/derive.ts:265-269; puppeteer:packages/monitor/src/backend/derive.ts:314; vibefield:packages/fieldd/src/agent-field.ts:668-680

### `field.project.branch`
Type: `string | null | undefined`; required in parent: False; parent may be absent: False; nullable: True; layer: backend.
Default: absent = not observed/no fallback; null = looked and no repository/branch; nonempty runtime branch > host fallback > observed null > workspace branch
Derivation: Folder basename of observed cwd || workspace.sourcePath || workspace.root || host.cwd; fallback provider label.trim() || id. Branch: nonempty observed branch > host.fallbackBranch > observed git answer (including null) > workspace.branch. seq dealt by backend project identity. Peer cut removes seq. Terminal basename cwd, else title || terminal; implementation may have nonempty terminal project name despite older type prose.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:106; puppeteer:packages/monitor/src/backend/derive.ts:91-113; puppeteer:packages/monitor/src/backend/derive.ts:265-269; puppeteer:packages/monitor/src/backend/derive.ts:314; vibefield:packages/fieldd/src/agent-field.ts:668-680

### `field.project.seq`
Type: `number | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: No independent default; inherits project derivation (optional means omitted, not null).
Derivation: Folder basename of observed cwd || workspace.sourcePath || workspace.root || host.cwd; fallback provider label.trim() || id. Branch: nonempty observed branch > host.fallbackBranch > observed git answer (including null) > workspace.branch. seq dealt by backend project identity. Peer cut removes seq. Terminal basename cwd, else title || terminal; implementation may have nonempty terminal project name despite older type prose.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "indirect host/replica control path; Theme colour input, indirectly drawn by every view using colour."}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:110; puppeteer:packages/monitor/src/backend/derive.ts:91-113; puppeteer:packages/monitor/src/backend/derive.ts:265-269; puppeteer:packages/monitor/src/backend/derive.ts:314; vibefield:packages/fieldd/src/agent-field.ts:668-680

### `field.provider`
Type: `{ readonly id: string; readonly label: string } | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent for bare terminal
Derivation: Host provider id and label, not model evidence. VibeField host uses summary.kind and summary.label (blank -> kind).
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:153; puppeteer:packages/monitor/src/backend/derive.ts:270; vibefield:packages/fieldd/src/agent-monitor.ts:240-244

### `field.provider.id`
Type: `string`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits provider derivation (optional means omitted, not null).
Derivation: Host provider id and label, not model evidence. VibeField host uses summary.kind and summary.label (blank -> kind).
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:153; puppeteer:packages/monitor/src/backend/derive.ts:270; vibefield:packages/fieldd/src/agent-monitor.ts:240-244

### `field.provider.label`
Type: `string`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits provider derivation (optional means omitted, not null).
Derivation: Host provider id and label, not model evidence. VibeField host uses summary.kind and summary.label (blank -> kind).
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:153; puppeteer:packages/monitor/src/backend/derive.ts:270; vibefield:packages/fieldd/src/agent-monitor.ts:240-244

### `field.model`
Type: `string | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent without runtime model
Derivation: Runtime model.displayName || model.id when model exists; model intent/asOf/configured are NOT carried by row.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:154; puppeteer:packages/monitor/src/backend/derive.ts:244; puppeteer:packages/monitor/src/backend/derive.ts:271

### `field.effort`
Type: `MonitorEffort | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent without runtime effort; toolkit treats omitted intent as observed
Derivation: Runtime effort value and optional intent copied; no fixed effort enum. Configured and observed intent remain distinct; configured/asOf detail stripped.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:155; puppeteer:packages/monitor/src/backend/derive.ts:176-181; puppeteer:packages/views/src/views/swarm/bubble-model.ts:320-325

### `field.effort.value`
Type: `string`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits effort derivation (optional means omitted, not null).
Derivation: Runtime effort value and optional intent copied; no fixed effort enum. Configured and observed intent remain distinct; configured/asOf detail stripped.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:72; puppeteer:packages/monitor/src/backend/derive.ts:176-181; puppeteer:packages/views/src/views/swarm/bubble-model.ts:320-325

### `field.effort.intent`
Type: `'configured' | 'observed' | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: absent treated as observed by swarm renderer, not rewritten on model
Derivation: Runtime effort value and optional intent copied; no fixed effort enum. Configured and observed intent remain distinct; configured/asOf detail stripped.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:73; puppeteer:packages/monitor/src/backend/derive.ts:176-181; puppeteer:packages/views/src/views/swarm/bubble-model.ts:320-325

### `field.account`
Type: `string | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent
Derivation: Copied only from host.account. VibeField hostRunFromSummary does not populate account at this pin; therefore type-supported but local producer not proven.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "unknown for real VibeField producer; host does not supply at this pin; fixture-renderable in list"}
Confirmed view consumers: view.list.
Evidence: puppeteer:packages/view-sdk/src/model.ts:156; puppeteer:packages/monitor/src/backend/derive.ts:273; vibefield:packages/fieldd/src/agent-monitor.ts:223-266

### `field.context`
Type: `{ readonly usedPercent: number } | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent for missing/nonfinite percent
Derivation: Only finite numeric runtime context.usedPercent carried; no backend clamp to 0..100; absence is not zero. Swarm floors and clamps ring, rain rounds text and clamps length.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:157; puppeteer:packages/monitor/src/backend/derive.ts:247; puppeteer:packages/monitor/src/backend/derive.ts:274; puppeteer:packages/views/src/views/swarm/bubble-model.ts:328-330; puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117

### `field.context.usedPercent`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits context derivation (optional means omitted, not null).
Derivation: Only finite numeric runtime context.usedPercent carried; no backend clamp to 0..100; absence is not zero. Swarm floors and clamps ring, rain rounds text and clamps length.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:157; puppeteer:packages/monitor/src/backend/derive.ts:247; puppeteer:packages/monitor/src/backend/derive.ts:274; puppeteer:packages/views/src/views/swarm/bubble-model.ts:328-330; puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117

### `field.wait`
Type: `MonitorWait | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent without blockers; count absent means 1
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:158; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.kind`
Type: `string`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits wait derivation (optional means omitted, not null).
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:48; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.since`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits wait derivation (optional means omitted, not null).
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:49; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.count`
Type: `number | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: omitted when exactly one; includes core omitted.blockers when >1
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:51; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.tool`
Type: `string | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits wait derivation (optional means omitted, not null).
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:53; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.code`
Type: `string | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits wait derivation (optional means omitted, not null).
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:55; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.header`
Type: `string | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits wait derivation (optional means omitted, not null).
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:57; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.question`
Type: `string | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits wait derivation (optional means omitted, not null).
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:59; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.wait.detail`
Type: `string | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits wait derivation (optional means omitted, not null).
Derivation: First core blocker; count = blockers.length + omitted.blockers, emitted only >1; question first header/prompt; permission.tool; failure.code; detail bounded, blank omitted; since parsed else statusSince. Core priority failure > question > permission then earliest since/id; wait may coexist with working while other children run.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:61; puppeteer:packages/monitor/src/backend/derive.ts:130-161; puppeteer:packages/core/src/monitor/transitions.ts:71; puppeteer:packages/core/src/monitor/transitions.ts:159-170; puppeteer:packages/core/src/monitor/transitions.ts:369-371

### `field.reply`
Type: `MonitorReply | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent without nonblank message
Derivation: Latest runtime lastAssistantMessage; text trimmed/codepoint-bounded, absent if blank; at parsed if valid; final copied. Peer cut further bounds text with ellipsis.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:159; puppeteer:packages/monitor/src/backend/derive.ts:188-196; vibefield:packages/fieldd/src/agent-field.ts:699

### `field.reply.text`
Type: `string`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits reply derivation (optional means omitted, not null).
Derivation: Latest runtime lastAssistantMessage; text trimmed/codepoint-bounded, absent if blank; at parsed if valid; final copied. Peer cut further bounds text with ellipsis.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:78; puppeteer:packages/monitor/src/backend/derive.ts:188-196; vibefield:packages/fieldd/src/agent-field.ts:699

### `field.reply.at`
Type: `number | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits reply derivation (optional means omitted, not null).
Derivation: Latest runtime lastAssistantMessage; text trimmed/codepoint-bounded, absent if blank; at parsed if valid; final copied. Peer cut further bounds text with ellipsis.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:79; puppeteer:packages/monitor/src/backend/derive.ts:188-196; vibefield:packages/fieldd/src/agent-field.ts:699

### `field.reply.final`
Type: `boolean | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits reply derivation (optional means omitted, not null).
Derivation: Latest runtime lastAssistantMessage; text trimmed/codepoint-bounded, absent if blank; at parsed if valid; final copied. Peer cut further bounds text with ellipsis.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:81; puppeteer:packages/monitor/src/backend/derive.ts:188-196; vibefield:packages/fieldd/src/agent-field.ts:699

### `field.cost`
Type: `MonitorCost | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent without ledger.total; rate optional; emitted cost includes series
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:160; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.cost.usd`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits cost derivation (optional means omitted, not null).
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:89; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.cost.coverage`
Type: `CostCoverage`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits cost derivation (optional means omitted, not null).
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm, view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:90; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.cost.burnPerHour`
Type: `number | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits cost derivation (optional means omitted, not null).
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:92; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.cost.series`
Type: `MonitorSeries | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits cost derivation (optional means omitted, not null).
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:94; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.cost.series.stepMs`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits cost derivation (optional means omitted, not null).
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:27; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.cost.series.steps`
Type: `readonly number[]`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits cost derivation (optional means omitted, not null).
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:29; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.cost.series.lastStepAt`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits cost derivation (optional means omitted, not null).
Derivation: Estimated API-equivalent USD, not invoice. Ledger corrected observed totals and fixed 20 x 30000ms buckets; absent if no priced total; coverage complete/partial/unavailable. burnPerHour = core usage.costRatePerMin * 60, never snapshot differences. VibeField explicitly uses current epoch rather than backend default accumulate.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.spend.
Evidence: puppeteer:packages/view-sdk/src/model.ts:31; puppeteer:packages/monitor/src/backend/backend.ts:189-207; puppeteer:packages/monitor/src/backend/usage-ledger.ts:62-82; vibefield:packages/fieldd/src/agent-monitor.ts:478-480

### `field.tokens`
Type: `MonitorTokens | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent if neither metric
Derivation: usage.cumulativeTokens -> total; usage.burnRatePerMin -> perMinute. If both absent, no object. Token burn distinct from USD/hour and context occupancy.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:161; puppeteer:packages/monitor/src/backend/derive.ts:198-208

### `field.tokens.total`
Type: `number | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits tokens derivation (optional means omitted, not null).
Derivation: usage.cumulativeTokens -> total; usage.burnRatePerMin -> perMinute. If both absent, no object. Token burn distinct from USD/hour and context occupancy.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:98; puppeteer:packages/monitor/src/backend/derive.ts:198-208

### `field.tokens.perMinute`
Type: `number | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: backend.
Default: No independent default; inherits tokens derivation (optional means omitted, not null).
Derivation: usage.cumulativeTokens -> total; usage.burnRatePerMin -> perMinute. If both absent, no object. Token burn distinct from USD/hour and context occupancy.
Tags: {"model-supported": true, "adapter-emittable": "conditional: normalized evidence feeds a runtime projection; see per-adapter capability matrix, not a direct row emission", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:99; puppeteer:packages/monitor/src/backend/derive.ts:198-208

### `field.unread`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: false for first sight, terminals, shown/nonidle rows
Derivation: Backend union of screen shown reports. Agent idle whose statusSince exceeds previous last seen is unread; first sight/report shown clears; nonagent and nonidle never unread. Daemon lifetime ledger survives window close/reopen, not claimed disk persistent.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:163; puppeteer:packages/monitor/src/backend/unread.ts:38-56; vibefield:packages/fieldd/src/agent-monitor.ts:144-162

### `field.device`
Type: `MonitorDeviceRef`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: required id/name/self; os absent when unknown
Derivation: Host roster id/name/os; unknown name -> id, unknown platform -> omit os. Wire drops self; reader rejoins self = device.id === answering desktop id.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:164; vibefield:packages/fieldd/src/agent-monitor.ts:174-190; vibefield:packages/fieldd/src/agent-monitor.ts:316-328; vibefield:packages/fieldd/src/agent-field.ts:585-591; vibefield:packages/field-app/src/godview/monitor/model-board.ts:112-123

### `field.device.id`
Type: `string`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: No independent default; inherits device derivation (optional means omitted, not null).
Derivation: Host roster id/name/os; unknown name -> id, unknown platform -> omit os. Wire drops self; reader rejoins self = device.id === answering desktop id.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "indirect host/replica control path; Remote standing -> display staleness and host membership."}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:35; vibefield:packages/fieldd/src/agent-monitor.ts:174-190; vibefield:packages/fieldd/src/agent-monitor.ts:316-328; vibefield:packages/fieldd/src/agent-field.ts:585-591; vibefield:packages/field-app/src/godview/monitor/model-board.ts:112-123

### `field.device.name`
Type: `string`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: No independent default; inherits device derivation (optional means omitted, not null).
Derivation: Host roster id/name/os; unknown name -> id, unknown platform -> omit os. Wire drops self; reader rejoins self = device.id === answering desktop id.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:36; vibefield:packages/fieldd/src/agent-monitor.ts:174-190; vibefield:packages/fieldd/src/agent-monitor.ts:316-328; vibefield:packages/fieldd/src/agent-field.ts:585-591; vibefield:packages/field-app/src/godview/monitor/model-board.ts:112-123

### `field.device.os`
Type: `DeviceOs | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: No independent default; inherits device derivation (optional means omitted, not null).
Derivation: Host roster id/name/os; unknown name -> id, unknown platform -> omit os. Wire drops self; reader rejoins self = device.id === answering desktop id.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:37; vibefield:packages/fieldd/src/agent-monitor.ts:174-190; vibefield:packages/fieldd/src/agent-monitor.ts:316-328; vibefield:packages/fieldd/src/agent-field.ts:585-591; vibefield:packages/field-app/src/godview/monitor/model-board.ts:112-123

### `field.device.self`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: No independent default; inherits device derivation (optional means omitted, not null).
Derivation: Host roster id/name/os; unknown name -> id, unknown platform -> omit os. Wire drops self; reader rejoins self = device.id === answering desktop id.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:39; vibefield:packages/fieldd/src/agent-monitor.ts:174-190; vibefield:packages/fieldd/src/agent-monitor.ts:316-328; vibefield:packages/fieldd/src/agent-field.ts:585-591; vibefield:packages/field-app/src/godview/monitor/model-board.ts:112-123

### `field.tier`
Type: `AgentTier | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: absent if no tier
Derivation: Host managed/ingested/remote copied if supplied, not same as reader-relative device.self.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "unknown"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:165; puppeteer:packages/monitor/src/backend/derive.ts:281; vibefield:packages/fieldd/src/agent-monitor.ts:259

### `field.profileSet`
Type: `string | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: backend.
Default: native for agent without mapping; terminal optional
Derivation: Host explicit set > persona profileId map > native. Bare terminal host birth profile set copied if present. VibeField DISPLAY removes peer profileSet; only this desktop profiles may light local spawn/filter affordances.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:167; puppeteer:packages/monitor/src/backend/derive.ts:58-66; puppeteer:packages/monitor/src/backend/derive.ts:282; puppeteer:packages/monitor/src/backend/derive.ts:317; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:99-136

### `field.attachable`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: false absent agent terminal id
Derivation: Agent true iff host terminalSessionId exists; bare terminal true. Owner door readiness cut can revoke attachable/writable for remote readers.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "indirect host/replica control path; Host selection/attach action decision; not builtin text or mark."}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:169; puppeteer:packages/monitor/src/backend/derive.ts:251; puppeteer:packages/monitor/src/backend/derive.ts:283-285; puppeteer:packages/monitor/src/backend/derive.ts:318-319; vibefield:packages/fieldd/src/agent-field.ts:988-1008

### `field.writable`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: backend.
Default: wire absence -> attachable
Derivation: Backend policy currently equals attachable; optional on wire for old peers; modelRowFrom fills absent from attachable. No builtin view draws write policy at this pin.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "not-drawn by builtin monitor views; host policy/attach semantics only"}
Confirmed view consumers: none proven; unknown unless explicitly noted.
Evidence: puppeteer:packages/view-sdk/src/model.ts:176; puppeteer:packages/monitor/src/backend/derive.ts:283-285; puppeteer:packages/view-sdk/src/model.ts:170-176; vibefield:packages/field-app/src/godview/monitor/model-board.ts:108-123

### `field.colour`
Type: `string`; required in parent: True; parent may be absent: False; nullable: False; layer: window.
Default: currentColor
Derivation: Window theme colourFor(project.seq), cached by sequence; default currentColor without theme; not adapter data/wire data.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:363; puppeteer:packages/monitor/src/replica/replica.ts:137-138; puppeteer:packages/monitor/src/replica/replica.ts:245-256; puppeteer:packages/monitor/src/replica/replica.ts:337-372

### `field.active`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: window.
Default: false
Derivation: Window activeIds membership.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:365; puppeteer:packages/monitor/src/replica/replica.ts:337-372

### `field.receded`
Type: `boolean`; required in parent: True; parent may be absent: False; nullable: False; layer: window.
Default: false with no predicate
Derivation: Window predicate; VibeField recedes rows not (device.self && profileSet===chosenProfile), absent selected filter -> no predicate.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:367; puppeteer:packages/monitor/src/replica/replica.ts:259-268; vibefield:packages/field-app/src/godview/monitor/useMonitorAgents.ts:550-555

### `field.attachment`
Type: `{ readonly panes: number; readonly colour?: string | undefined } | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: window.
Default: absent
Derivation: Window attachment map: panes count and optional pane colour, absent if not mounted.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.list, view.rain, view.swarm, view.spend, view.timeline.
Evidence: puppeteer:packages/view-sdk/src/model.ts:369; puppeteer:packages/monitor/src/replica/replica.ts:281-288

### `field.attachment.panes`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: window.
Default: No independent default; inherits attachment derivation (optional means omitted, not null).
Derivation: Window attachment map: panes count and optional pane colour, absent if not mounted.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.rain.
Evidence: puppeteer:packages/view-sdk/src/model.ts:369; puppeteer:packages/monitor/src/replica/replica.ts:281-288

### `field.attachment.colour`
Type: `string | undefined`; required in parent: False; parent may be absent: True; nullable: False; layer: window.
Default: No independent default; inherits attachment derivation (optional means omitted, not null).
Derivation: Window attachment map: panes count and optional pane colour, absent if not mounted.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.rain, view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:369; puppeteer:packages/monitor/src/replica/replica.ts:281-288

### `field.spawnHint`
Type: `{ readonly x: number; readonly y: number } | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: window.
Default: absent
Derivation: Window spawnHints map copied coordinates, used for spatial birth.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:371; puppeteer:packages/monitor/src/replica/replica.ts:290-295

### `field.spawnHint.x`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: window.
Default: No independent default; inherits spawnHint derivation (optional means omitted, not null).
Derivation: Window spawnHints map copied coordinates, used for spatial birth.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:371; puppeteer:packages/monitor/src/replica/replica.ts:290-295

### `field.spawnHint.y`
Type: `number`; required in parent: True; parent may be absent: True; nullable: False; layer: window.
Default: No independent default; inherits spawnHint derivation (optional means omitted, not null).
Derivation: Window spawnHints map copied coordinates, used for spatial birth.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:371; puppeteer:packages/monitor/src/replica/replica.ts:290-295

### `field.visualId`
Type: `string | undefined`; required in parent: False; parent may be absent: False; nullable: False; layer: window.
Default: absent -> id in spatial view
Derivation: Window visualIds map continuity id; spatial views use visualId ?? id across launcher/shell handoff. VibeField DISPLAY: transition visualId(session??id, creationId, inputUsed) > deck visualIds by session > previous visual when no creationId > session > row.id; dedupe one body per visual id, earlier row wins.
Tags: {"model-supported": true, "adapter-emittable": "not-applicable: host/backend/window-derived", "UI-reachable": "code-proven consumer; concrete adapter/state reachability conditional"}
Confirmed view consumers: view.swarm.
Evidence: puppeteer:packages/view-sdk/src/model.ts:377; puppeteer:packages/monitor/src/replica/replica.ts:346; puppeteer:packages/views/src/views/swarm/body-id.ts:12; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:99-136

## API surface
### `api.agent_subscribe` — `agent.subscribe {projection:"model",scope:"mesh"}`
Window one model door: initial mesh open and per-device snapshot/delta/state frames; owner revision chains folded to one replica chain.
Types: AgentModelMeshOpen, AgentModelMeshFrame, MonitorModelSnapshot, MonitorModelChange
Evidence: vibefield:packages/contracts/src/methods.ts:3033; vibefield:packages/field-app/src/godview/monitor/doors.ts:468-480; vibefield:packages/contracts/src/agent-field.ts:888-915

### `api.agent_reportShown` — `agent.reportShown {ids}`
Screen active-pane seen report clears unread and may acknowledge retained local failure.
Types: AgentReportShownParams
Evidence: vibefield:packages/contracts/src/methods.ts:2945; vibefield:packages/field-app/src/godview/monitor/doors.ts:480; vibefield:packages/fieldd/src/agent-monitor.ts:605-610

### `api.agent_recordedLanes` — `agent.recordedLanes`
Read-through history at requested window; only mounted history-capability view asks; not model row history.
Types: MonitorPastSnapshot
Evidence: vibefield:packages/contracts/src/methods.ts:2982; vibefield:packages/field-app/src/godview/monitor/doors.ts:484-510; vibefield:packages/fieldd/src/agent-monitor.ts:163-166

### `api.service` — `createAgentMonitorService`
Daemon host joins fold/terminals/roster/profile facts and owns backend lifecycle, snapshot/subscribe/rowForRun/readPast.
Types: MonitorAgentRow, MonitorModelSnapshot, MonitorModelChange
Evidence: vibefield:packages/fieldd/src/agent-monitor.ts:123-171; vibefield:packages/fieldd/src/agent-monitor.ts:398-493

### `api.backend` — `createMonitorBackend`
One backend per desktop; immutable row derivation, shared snapshots and coalesced changes.
Types: MonitorBackend
Evidence: puppeteer:packages/monitor/src/backend/backend.ts:118-134; puppeteer:packages/monitor/src/backend/ports.ts:311-348

### `api.runtime_source` — `runtimeRunSource / MonitorRuntimeSource`
Subscribe-before-list runtime monitorStates/onMonitorState/onMonitorNotification/onMonitorRemoved plus acknowledgeFailureBlocker.
Types: AgentMonitorState, MonitorNotification
Evidence: puppeteer:packages/monitor/src/backend/runtime-source.ts:11-57

### `api.runtime_monitor` — `Runtime monitor service acceptAgentEvent/acceptSemantic/acceptWorkspace`
Validated adapter semantic batch gets runtime identity; runtime normalized events translated separately; host process evidence controls liveness.
Types: AdapterMonitorObservationBatch, RuntimeMonitorObservationBatch, AgentMonitorState
Evidence: puppeteer:packages/runtime/src/services/monitor-service.ts:227-282

### `api.store` — `createAgentMonitorStore`
Per-run epoch/revision store for runtime states/removals and notifications; not visual row model.
Types: AgentMonitorState
Evidence: puppeteer:packages/monitor/src/store.ts:19-34; puppeteer:packages/monitor/src/store.ts:78

### `api.replica` — `createMonitorReplica`
apply(snapshot|change), onGap, setLocal, setTheme, getSnapshot, subscribe. Gap holds up to default 256 changes; heal via snapshot.
Types: MonitorReplica, MonitorModel, AgentView
Evidence: puppeteer:packages/monitor/src/replica/replica.ts:118-138; puppeteer:packages/monitor/src/replica/replica.ts:190-224

### `api.board_fold` — `ModelBoardFold`
Owner board snapshot/delta fold, reader self and wire writable fallback, per-owner gap check and model id mapping.
Types: AgentModelMeshRow, MonitorAgentRow
Evidence: vibefield:packages/field-app/src/godview/monitor/model-board.ts:104-123; vibefield:packages/field-app/src/godview/monitor/model-board.ts:141-179; vibefield:packages/field-app/src/godview/monitor/model-board.ts:216-253

### `api.feed` — `createGodviewMonitorFeed / useMonitorReplica`
Owns model board subscription, fold, replica, reportShown resend and retry; chrome kept beside rows, not merged into business model.
Types: GodviewMonitorFeed, MonitorFeedState
Evidence: vibefield:packages/field-app/src/godview/monitor/model-replica.ts:55-83; vibefield:packages/field-app/src/godview/monitor/model-replica.ts:95-105; vibefield:packages/field-app/src/godview/monitor/model-replica.ts:302

### `api.provider` — `GodviewAgentsProvider / useMonitorFeed / useDeckAgentFacts`
Window React contexts: provider owns feed and separate chrome facts; override exists for replay/test.
Types: GodviewMonitorFeed, DeckAgentFacts
Evidence: vibefield:packages/field-app/src/godview/monitor/GodviewAgentsProvider.tsx:110; vibefield:packages/field-app/src/godview/monitor/GodviewAgentsProvider.tsx:151-180

### `api.hook` — `useMonitorAgents`
Joins local pane/spawn/active/receded/visible facts into replica; returns view model plus chrome actions.
Types: MonitorAgentsResult, MonitorModel
Evidence: vibefield:packages/field-app/src/godview/monitor/useMonitorAgents.ts:157-205; vibefield:packages/field-app/src/godview/monitor/useMonitorAgents.ts:321; vibefield:packages/field-app/src/godview/monitor/useMonitorAgents.ts:541-583

### `api.host` — `MonitorViewHost / MonitorView contract`
SDK view lifecycle draws model with ModelChanges and host capabilities; host owns rendering, not state derivation.
Types: MonitorView, MonitorModel, ModelChanges
Evidence: puppeteer:packages/view-sdk/src/view.ts:176-188; puppeteer:packages/view-sdk/src/view.ts:253-265; puppeteer:packages/view-sdk/src/host/MonitorViewHost.ts:31-50

### `api.local_board` — `AgentModelBoard`
Daemon local model projection joins backend row and local chrome; remote board is separate cut.
Types: AgentModelDeskRow, AgentDeskTerminalRow
Evidence: vibefield:packages/fieldd/src/agent-model-board.ts:1-45; vibefield:packages/fieldd/src/agent-model-board.ts:144-177

### `api.window_rows` — `createWindowRows / rowsFor`
VibeField display patch after replica: membership/order, peer standing staleness, remove peer profileSet, continuity visualId and dedupe. The SDK model alone does not capture these host rules.
Types: AgentView, MonitorModel, WindowRowFacts
Evidence: vibefield:packages/field-app/src/godview/monitor/window-rows.ts:7-37; vibefield:packages/field-app/src/godview/monitor/window-rows.ts:99-136; vibefield:packages/field-app/src/godview/monitor/useMonitorAgents.ts:380-402

### `api.last_run` — `agent.lastRun`
Read previous daemon-run monitor picture for cold-open restore; separate from current live replica.
Types: AgentLastRunResult, AgentModelMeshOpen
Evidence: vibefield:packages/contracts/src/methods.ts:2950-2961; vibefield:packages/field-app/src/godview/last-run.ts:184

### `api.last_run_forget` — `agent.lastRunForget`
State-changing companion to discard held previous-run picture; not invoked by this audit.
Types: AgentLastRunResult
Evidence: vibefield:packages/contracts/src/methods.ts:2962-2972

### `api.runtime_notifications` — `MonitorNotification stream`
Independent runtime notifications: blocked.entered, compaction:started/completed, cwd.changed, worktree.created/removed, session.ended. Notifications are not model snapshot changes.
Types: MonitorNotification, AgentMonitorHandle
Evidence: puppeteer:packages/core/src/monitor/types.ts:309-333

## Monitor view consumers
### `view.list`
Account is rendered if present, despite absent VibeField producer.
Reviewed row reads and shared toolkit helpers; field list is code-consumption, not proof every field is drawn in every state. Negative/unlisted usage remains unknown; history/spawn contracts separate.
- `field.account` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.active` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.attachment` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.colour` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.context` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.context.usedPercent` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.detail` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.name` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.self` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.id` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.kind` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.model` — puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.observed` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.pending` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.project` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.project.branch` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.project.name` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.provider` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.provider.id` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.provider.label` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.receded` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.reply` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.reply.text` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.stale` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199
- `field.status` — puppeteer:packages/views/src/views/list/AgentList.tsx:144-199; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.kind` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.question` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.tool` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84

### `view.rain`
Context scales tail; unavailable context uses 0.5 occupancy for length, not a model value.
Reviewed row reads and shared toolkit helpers; field list is code-consumption, not proof every field is drawn in every state. Negative/unlisted usage remains unknown; history/spawn contracts separate.
- `field.active` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260
- `field.attachment` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260; puppeteer:packages/views/src/views/rain/RainView.tsx:135-260; puppeteer:packages/views/src/views/rain/RainView.tsx:135-260
- `field.attachment.colour` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260
- `field.attachment.panes` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260
- `field.colour` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260
- `field.context` — puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117
- `field.context.usedPercent` — puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117
- `field.detail` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device` — puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.name` — puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.self` — puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.id` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260
- `field.kind` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260; puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.model` — puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.observed` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.pending` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.project` — puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.project.branch` — puppeteer:packages/views/src/views/rain/rain-streams.ts:89-117
- `field.project.name` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.provider` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.provider.label` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.receded` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260
- `field.reply` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.reply.text` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.status` — puppeteer:packages/views/src/views/rain/RainView.tsx:135-260; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.kind` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.question` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.tool` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84

### `view.swarm`
Observed gates wait/reply/effort/cost; working body uses USD burn and relative USD-based size.
Reviewed row reads and shared toolkit helpers; field list is code-consumption, not proof every field is drawn in every state. Negative/unlisted usage remains unknown; history/spawn contracts separate.
- `field.active` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.activity` — puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:1031-1031
- `field.activity.kind` — puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:1031-1031
- `field.attachment` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.attachment.colour` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.colour` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.context` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330
- `field.context.usedPercent` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330
- `field.cost` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.cost.burnPerHour` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.cost.coverage` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330
- `field.cost.usd` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330
- `field.detail` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:236-276; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.name` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.self` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:236-276; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.effort` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330
- `field.effort.intent` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330
- `field.effort.value` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330
- `field.id` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/views/src/views/swarm/body-id.ts:12-12
- `field.kind` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:236-276; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.model` — puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.observed` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.pending` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.profileSet` — puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:236-276
- `field.project` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.project.branch` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.project.name` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.provider` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.provider.id` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.provider.label` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.receded` — puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:423-423
- `field.reply` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.reply.text` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.spawnHint` — puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:615-615; puppeteer:packages/views/src/views/swarm/bloom/birth.ts:104-108; puppeteer:packages/views/src/views/swarm/bloom/birth.ts:104-108
- `field.spawnHint.x` — puppeteer:packages/views/src/views/swarm/bloom/birth.ts:104-108
- `field.spawnHint.y` — puppeteer:packages/views/src/views/swarm/bloom/birth.ts:104-108
- `field.stale` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610
- `field.status` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.unread` — puppeteer:packages/views/src/views/swarm/AgentSwarm.tsx:236-276
- `field.visualId` — puppeteer:packages/views/src/views/swarm/body-id.ts:12-12
- `field.wait` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104; puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104
- `field.wait.code` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104
- `field.wait.detail` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104
- `field.wait.header` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104
- `field.wait.kind` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:268-330; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104
- `field.wait.question` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104
- `field.wait.tool` — puppeteer:packages/views/src/views/swarm/bubble-model.ts:350-610; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:94-104

### `view.spend`
Excludes bare terminals; per-device local series only.
Reviewed row reads and shared toolkit helpers; field list is code-consumption, not proof every field is drawn in every state. Negative/unlisted usage remains unknown; history/spawn contracts separate.
- `field.active` — puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815
- `field.attachment` — puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815
- `field.colour` — puppeteer:packages/views/src/views/spend/SpendView.tsx:290-294
- `field.cost` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.cost.coverage` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.cost.series` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.cost.series.lastStepAt` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.cost.series.stepMs` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.cost.series.steps` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.cost.usd` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.createdAt` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150
- `field.detail` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.name` — puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.device.self` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.id` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/views/src/views/spend/spend-words.ts:54-95
- `field.kind` — puppeteer:packages/views/src/views/spend/spend-series.ts:35-150; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.model` — puppeteer:packages/views/src/views/spend/spend-words.ts:54-95; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.observed` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.pending` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.project` — puppeteer:packages/views/src/views/spend/spend-words.ts:54-95; puppeteer:packages/views/src/views/spend/SpendView.tsx:290-294; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.project.branch` — puppeteer:packages/views/src/views/spend/spend-words.ts:54-95
- `field.project.name` — puppeteer:packages/views/src/views/spend/SpendView.tsx:290-294; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.provider` — puppeteer:packages/views/src/views/spend/spend-words.ts:54-95; puppeteer:packages/views/src/views/spend/spend-words.ts:54-95; puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.provider.id` — puppeteer:packages/views/src/views/spend/spend-words.ts:54-95
- `field.provider.label` — puppeteer:packages/views/src/views/spend/spend-words.ts:54-95; puppeteer:packages/views/src/views/spend/SpendView.tsx:746-815; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.reply` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.reply.text` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.status` — puppeteer:packages/views/src/views/spend/spend-words.ts:54-95; puppeteer:packages/views/src/views/spend/spend-words.ts:140-151; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.statusSince` — puppeteer:packages/views/src/views/spend/spend-words.ts:140-151
- `field.unread` — puppeteer:packages/views/src/views/spend/spend-words.ts:140-151
- `field.wait` — puppeteer:packages/views/src/views/spend/spend-words.ts:140-151; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/views/src/views/spend/spend-words.ts:140-151; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.detail` — puppeteer:packages/views/src/views/spend/spend-words.ts:140-151
- `field.wait.kind` — puppeteer:packages/views/src/views/spend/spend-words.ts:140-151; puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.question` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84
- `field.wait.tool` — puppeteer:packages/view-sdk/src/toolkit/words.ts:64-84

### `view.timeline`
Also consumes history snapshot/ended lanes; historical spans cannot prove blocked or unread.
Reviewed row reads and shared toolkit helpers; field list is code-consumption, not proof every field is drawn in every state. Negative/unlisted usage remains unknown; history/spawn contracts separate.
- `field.active` — puppeteer:packages/views/src/views/timeline/TimelineView.tsx:186-188
- `field.attachment` — puppeteer:packages/views/src/views/timeline/TimelineView.tsx:186-188
- `field.colour` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.createdAt` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.device` — puppeteer:packages/views/src/views/timeline/TimelineView.tsx:186-188; puppeteer:packages/views/src/views/timeline/timeline-words.ts:126-167; puppeteer:packages/views/src/views/timeline/timeline-words.ts:126-167
- `field.device.name` — puppeteer:packages/views/src/views/timeline/timeline-words.ts:126-167
- `field.device.self` — puppeteer:packages/views/src/views/timeline/timeline-words.ts:126-167
- `field.id` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.kind` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.model` — puppeteer:packages/views/src/views/timeline/timeline-words.ts:126-167; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.project` — puppeteer:packages/views/src/views/timeline/timeline-words.ts:126-167; puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.project.branch` — puppeteer:packages/views/src/views/timeline/timeline-words.ts:126-167
- `field.project.name` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45
- `field.provider` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.provider.label` — puppeteer:packages/view-sdk/src/toolkit/words.ts:42-45; puppeteer:packages/view-sdk/src/toolkit/words.ts:48-50
- `field.receded` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.status` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.statusSince` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.unread` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.wait` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137; puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137; puppeteer:packages/view-sdk/src/toolkit/lane-words.ts:22-26; puppeteer:packages/view-sdk/src/toolkit/lane-words.ts:22-26
- `field.wait.detail` — puppeteer:packages/view-sdk/src/toolkit/lane-words.ts:22-26
- `field.wait.kind` — puppeteer:packages/views/src/views/timeline/timeline-lanes.ts:94-137
- `field.wait.question` — puppeteer:packages/view-sdk/src/toolkit/lane-words.ts:22-26

## Adapter × family capability declarations
S=supported, D=degraded, U=unsupported, ?=undeclared/unknown. Declared support never guarantees availability. Degraded is not unreachable. Host/runtime facts can still exist when an adapter family is unsupported. Claude usage becomes degraded without enabled+verified OTLP; retain all limitations in JSON.

| Adapter | status | usage/burn | context | model | effort | mode | delegation | compaction | environment | conversation |
|---|---|---|---|---|---|---|---|---|---|---|
| adapter.acp | S | U | S | S | S | S | U | U | S | ? |
| adapter.antigravity | D | U | U | D | D | D | U | U | D | ? |
| adapter.claude | S | S | D | D | D | S | D | S | S | ? |
| adapter.codex | S | S | S | S | D | D | D | D | S | ? |
| adapter.copilot | S | U | D | S | S | S | D | D | S | ? |
| adapter.grok | S | D | S | S | D | D | D | D | S | ? |
| adapter.hermes | S | D | D | S | D | S | D | D | S | ? |
| adapter.kimi | S | U | D | S | S | D | D | D | S | ? |
| adapter.opencode | S | S | D | S | D | S | D | S | S | ? |
| adapter.pi | S | U | D | S | S | U | U | D | S | ? |

### `adapter.acp` capability evidence
- status: **supported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:11-23; ACP exposes root-session activity and structured permissions.; Structured form and URL elicitations are experimental and require client capability negotiation.; A transport close degrades observation; it never proves that the host process exited.
- usage: **unsupported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:24-35; usage_update.used is current context occupancy, not cumulative or per-response token consumption.; ACP 1.2.1 exposes cumulative monetary cost but no token-burn ledger or per-actor usage.
- context: **supported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:36-44; Context is available when the agent emits the optional usage_update notification.
- model: **supported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:45-56; The model is available when the agent supplies a config option with the standard model category.; ACP reports current session configuration, not a separate per-request routing boundary.
- effort: **supported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:57-68; Effort is the current thought_level config value when supplied by the agent.; ACP does not expose a separate per-request applied-effort boundary.
- mode: **supported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:69-80; Provider session mode IDs remain open strings and are not conflated with Puppeteer execution mode.; Permission posture is visible through concrete permission requests, not a standardized ACP permission mode.
- delegation: **unsupported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:81-89; ACP 1.2.1 defines no subagent identity, parentage, or child activity stream.
- compaction: **unsupported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:90-98; ACP 1.2.1 defines no context-compaction lifecycle notification.
- environment: **supported** — puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:99-107; ACP session setup proves cwd; Git and worktree topology remain runtime-owned.

### `adapter.antigravity` capability evidence
- status: **degraded** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:4-14; Planner content is the strongest observed turn-completion boundary; the transcript has no explicit turn-end record.
- usage: **unsupported** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:15-23; No token or cost record was observed in the durable transcript.
- context: **unsupported** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:24-32; The transcript exposes neither capacity nor occupancy; CHECKPOINT is not evidence of compaction.
- model: **degraded** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:33-41; Configured model is known; the durable transcript does not report the effective model.
- effort: **degraded** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:42-50; Configured effort is known; the durable transcript does not report changes.
- mode: **degraded** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:51-59; Configured execution and permission modes are known; durable transitions are absent.
- delegation: **unsupported** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:60-68; No stable child-agent lifecycle identity is present.
- compaction: **unsupported** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:69-77; CHECKPOINT follows ordinary turns and does not establish context compaction semantics.
- environment: **degraded** — puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:78-86; Cwd is configured at launch; Git topology remains runtime-owned.

### `adapter.claude` capability evidence
- status: **supported** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:4-11; Child lifecycle depends on hook attribution and visible task evidence.
- usage: **supported** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:12-25; Settled requests are exact; Claude exposes no sanctioned intra-response token delta.; Request totals cover observed API completions; historical transcript usage is not imported.; Per-child attribution is present only when Claude emits a native agent id.; Child context occupancy and untimed status samples are not token consumption; usage comes only from OTLP requests.
- context: **degraded** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:26-33; Root context is provider-calculated; child context stays in native evidence.
- model: **degraded** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:34-44; Models depend on session hooks, visible status tasks or observed API requests; historical models are not imported.; Per-child models require native actor identity; otherwise OTLP retains a derived actor group.
- effort: **degraded** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:45-52; Child status exposes configured effort, not necessarily the applied value.
- mode: **supported** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:53-60; Provider permission/session modes remain separate open strings.
- delegation: **degraded** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:61-68; Task-row IDs are not merged with hook agent IDs without verified equality.
- compaction: **supported** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:69-76; PreCompact is provisional until PostCompact.
- environment: **supported** — puppeteer:packages/adapter-claude/src/normalization/monitor-capabilities.ts:77-84; Git/worktree topology remains runtime-owned.

### `adapter.codex` capability evidence
- status: **supported** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:12-22; Approvals and prompts reach the controller as server requests. Beside the native Codex TUI, which is sent the same requests, the controller leaves the answer to the person there and holds the wait pending until Codex reports it resolved, which names no decision.
- usage: **supported** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:23-35; Pinned captures prove total is cumulative and last is per-response context pressure.; USD uses observed counter deltas and actual model metadata; resumed baselines, unknown prices, and ambiguous intervals remain unpriced.; Per-child usage requires the app-server connection to receive that child thread's notifications.
- context: **supported** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:36-44; Only root context is projected; child occupancy stays in native evidence.
- model: **supported** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:45-53; Per-child model requires child-thread settings or a collaboration spawn item.
- effort: **degraded** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:54-62; Mid-session settings shape is vendor-schema-backed but not present in the pinned runtime census.
- mode: **degraded** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:63-74; Plan/default collaboration mode requires thread/settings/updated or a thread/resume result from 0.164.0 or newer.; Approval and sandbox values are preserved together as provider permission state.
- delegation: **degraded** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:75-83; Child thread/item shapes are vendor-schema-backed but not present in the pinned runtime census.
- compaction: **degraded** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:84-92; The item lifecycle is vendor-schema-backed but absent from the pinned runtime census.
- environment: **supported** — puppeteer:packages/adapter-codex/src/normalization/monitor-capabilities.ts:93-101; Git/worktree topology remains runtime-owned.

### `adapter.copilot` capability evidence
- status: **supported** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:4-14; The durable log separates model response cycles from user interactions; the adapter correlates them by interactionId.
- usage: **unsupported** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:15-23; Durable transcript usage is excluded. No independent live usage rail is integrated.
- context: **degraded** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:24-32; Exact used/capacity values are available around compaction, not continuously.
- model: **supported** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:33-41; 
- effort: **supported** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:42-50; 
- mode: **supported** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:51-59; 
- delegation: **degraded** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:60-68; The writer schema proves lifecycle fields; the pinned runtime fixtures did not exercise subagents.
- compaction: **degraded** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:69-77; The writer schema is exact; the pinned runtime fixtures did not exercise compaction.
- environment: **supported** — puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:78-86; 

### `adapter.grok` capability evidence
- status: **supported** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:12-24; Root turn activity is captured; structured ACP permissions require the control rail.; A subagent child turn (its queue/changed runningPromptId until its turn_completed, forwarded under the child sessionId) is the subagent actor’s activity; other child-session status, such as a child permission request, is not projected.; Without a host approval handler the request is left to the native viewer (presentation native-tui). Grok reports no outcome for a viewer answer, so it is settled from the tool call that follows (in_progress/completed allowed; toolNotRun rejected denied, cancelled dismissed) or the turn cancellation; a request no evidence settles ends unknown at turn end, transport close, or disposal.
- usage: **degraded** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:25-41; Usage requires direct ACP response/turn notifications. Journal records are excluded.; signals.json and subagent progress are context occupancy, never billed burn.; A subagent child’s response and turn usage, forwarded under the child sessionId, is attributed to the actor subagent_spawned names for that child_session_id. Frames a child sends before its subagent_spawned are not projected; its later turn_completed still reconciles the turn total.; Captured live response_completed carries no signature or eventId; a response is identified by its session, the running native prompt (queue/changed runningPromptId or the turn’s _meta.promptId), and its ordinal within that prompt, and turn_completed reconciles the turn total.; A response whose native prompt is unknown, signed or not (the 1.0.0 live shape), is not counted on its own; its turn_completed carries the whole turn total.; A turn total Grok flags usageIsIncomplete is not reconciled; its response contributions stand.; Turns cancelled mid-turn (session/cancel) carry no turn_completed usage; only responses completed before the cancel count.
- context: **supported** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:42-53; Before signals.json exists, context capacity requires the selected model in the native model cache (models_cache.json is unverified on the pinned artifact).; signals.json is written asynchronously after the prompt result, so a context sample can trail turn completion.
- model: **supported** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:54-62; Live model_changed carries model_id only; subagent model fields are verified on the spawn record.
- effort: **degraded** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:63-73; reasoning_effort exists in mirror source but not in the pinned 1.0.70 census; model_changed carried model_id only.
- mode: **degraded** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:74-84; Configured permission/sandbox posture is intent; current ACP mode updates were not captured at 1.0.70.
- delegation: **degraded** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:85-96; Subagent spawn/finish are runtime-verified; subagent_progress remains mirror-source only.; Child tool calls were not observed on the parent connection.
- compaction: **degraded** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:97-107; auto_compact_completed and compaction_checkpoint are runtime-verified; started/failed/cancelled phases remain mirror-source only.
- environment: **supported** — puppeteer:packages/adapter-grok/src/normalization/monitor-capabilities.ts:108-116; Git/worktree topology remains runtime-owned.

### `adapter.hermes` capability evidence
- status: **supported** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:11-25; Root turn and tool activity, and the frame shape of the server→client approval request, are runtime verified; the approval shape was captured by a census client that advertises server_requests.; Delivery of approval, clarify, and request.cancel to this non-advertising observer beside the attached native TUI is exact-release-source-backed (server.write_json → FanoutTransport.write; session_transports._session_client_answers_requests) but not runtime captured.; Structured clarify choices and subagent activity are exact-release-contract-backed but not pinned-runtime captured.; The native TUI answers approvals and clarifications and the answer never reaches this observer; an approval settles on its tool's or turn's completion, or on a request.cancel withdrawal.; Loss of the gateway rail degrades observation and never proves that the attached native TUI exited.
- usage: **degraded** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:26-38; Root burn rate is derived from cumulative gateway samples at response/session-info boundaries, not token streaming.; Subagent totals arrive only on subagent.complete, so a live per-subagent burn rate is usually unavailable.; Root samples are session aggregates; per-child samples are kept out of the root aggregate timeline.
- context: **degraded** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:39-51; Current occupancy and capacity are emitted only after the context engine has a real prompt measurement.; The pinned 0.21.5 fake-provider census carried them only on session.info and message.complete usage.; Hermes refreshes the gateway gauge at response boundaries rather than continuously during a turn.
- model: **supported** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:52-63; Root model changes are reported by session.info; subagent models are exact-release-source-backed.; A model switch queued during a turn is the next-turn selection until Hermes applies it.
- effort: **degraded** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:64-76; The current reasoning_effort field and its update events are exact-release-source-backed but not retained in sanitized runtime captures.; An empty native value means provider default rather than a concrete reasoning level.; No per-subagent effort field is exposed.
- mode: **supported** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:77-88; Hermes exposes effective manual/off/YOLO approval posture, not Claude-style Plan or Accept Edit modes.; YOLO and approvals.mode=off normalize to auto while the provider-native value remains visible.
- delegation: **degraded** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:89-100; Stable subagent and child-session identity, parentage, activity, model, and completion totals exist in the exact release source.; The subagent event family was not exercised by the pinned runtime census.
- compaction: **degraded** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:101-112; Exact release source emits compacting status and a cumulative compression count, but the pinned runtime census did not exercise it.; A missed start cannot be reconstructed as an exact lifecycle from the later counter alone.
- environment: **supported** — puppeteer:packages/adapter-hermes/src/normalization/monitor-capabilities.ts:113-121; The gateway proves cwd; Git/worktree topology remains runtime-owned.

### `adapter.kimi` capability evidence
- status: **supported** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:7-15; Structured question choices are exact-source-backed but not pinned-runtime verified.
- usage: **unsupported** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:16-24; Wire journal usage is excluded. No independent live usage rail is integrated.
- context: **degraded** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:25-38; Request input occupancy is exact, but the durable wire exposes no context capacity.; llm.request.maxTokens, when persisted, is a completion limit and is never treated as context capacity.; Real-time context-window percentage is unavailable.
- model: **supported** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:39-47; profile.bind is configured alias evidence; llm.request is the applied provider model.
- effort: **supported** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:48-56; Applied changes become visible at the next llm.request boundary.
- mode: **degraded** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:57-69; auto is runtime verified by the print-mode census; manual and yolo are exact-source-backed.; Plan-mode transitions are exact-source-backed but not pinned-runtime verified.; Kimi has no verified Accept Edit mode equivalent.
- delegation: **degraded** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:70-82; Child journal presence, activity, model, effort, and usage are observable.; Parent-journal subagent.spawned/started/completed are runtime verified for a foreground child.; subagent.failed and subagent.cancelled stop records are exact-source-backed but not pinned-runtime verified.
- compaction: **degraded** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:83-91; Compaction lifecycle is exact-source-backed but not pinned-runtime verified.
- environment: **supported** — puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:92-100; Git and worktree topology remain runtime-owned.

### `adapter.opencode` capability evidence
- status: **supported** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:11-22; The workspace SSE stream and durable REST reconciliation cover the root and known child sessions.; A disconnected SSE rail degrades observation; it never proves that the attached TUI process exited.
- usage: **supported** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:23-34; Canonical burn is emitted at native step/assistant response boundaries, not estimated from context occupancy.; Child usage is available after native parent/child identity is established.
- context: **degraded** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:35-46; Current request token pressure is exact, but percentage requires a separately verified positive model capacity.; The adapter does not apply the root capacity to child models that may differ.
- model: **supported** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:47-55; Applied model changes are observed per native message; configured intent remains a separate claim.
- effort: **degraded** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:56-67; OpenCode variants commonly select reasoning effort or thinking budgets, but custom variants may contain unrelated request overlays.; The raw applied variant is reported without pretending its name is a provider-neutral effort scale.
- mode: **supported** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:68-79; Provider modes such as build, plan, explore, and compaction remain provider-native strings.; Configured permission policy is not collapsed into a misleading Auto/Manual label.
- delegation: **degraded** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:80-88; Stable child session IDs, parentage, state, model, and response usage are observable.
- compaction: **supported** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:89-99; Manual, threshold, and overflow triggers are visible; completed compaction invalidates prior context pressure.
- environment: **supported** — puppeteer:packages/adapter-opencode/src/normalization/monitor-capabilities.ts:100-108; The provider proves cwd; Git and worktree topology remain runtime-owned.

### `adapter.pi` capability evidence
- status: **supported** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:5-15; A user prompt is durable once Pi appends it (1.5.0 creates the journal at the first user or assistant message), which can lag terminal submission.
- usage: **unsupported** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:16-24; Session JSONL usage is excluded. No independent live usage rail is integrated.
- context: **degraded** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:25-35; Pi records response usage and compaction pressure but no authoritative live context capacity sample.
- model: **supported** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:36-44; 
- effort: **supported** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:45-53; 
- mode: **unsupported** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:54-62; No durable provider-session or permission-mode transition is recorded.
- delegation: **unsupported** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:63-71; Forks are conversation branches, not delegated child-agent runs.
- compaction: **degraded** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:72-82; The pinned writer contract proves the completed entry shape, but the controlled runtime corpus did not exercise native compaction; an observed entry still proves only completion, not a live start duration.
- environment: **supported** — puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:83-91; Git topology remains runtime-owned.

## Reachability restrictions
These are constraints on native adapter evidence, not blanket claims that a whole run cannot enter idle/working/blocked. `mode` and dedicated `delegation` fields are not in MonitorAgentRow; they exist upstream and can affect activity/status.
- **adapter.acp / usage**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: field.cost, field.cost.usd, field.cost.coverage, field.cost.burnPerHour, field.cost.series, field.cost.series.stepMs, field.cost.series.steps, field.cost.series.lastStepAt, field.tokens, field.tokens.total, field.tokens.perMinute. States: state.cost_complete, state.cost_partial, state.burn_flames_0, state.burn_flames_1, state.burn_flames_2, state.burn_flames_3, state.burn_flames_4. puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:24-35
- **adapter.acp / delegation**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: (upstream only). States: state.working_with_blockers, state.activity_delegating. puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:81-89
- **adapter.acp / compaction**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: (upstream only). States: state.activity_compacting. puppeteer:packages/adapter-acp/src/normalization/monitor-capabilities.ts:90-98
- **adapter.antigravity / usage**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: field.cost, field.cost.usd, field.cost.coverage, field.cost.burnPerHour, field.cost.series, field.cost.series.stepMs, field.cost.series.steps, field.cost.series.lastStepAt, field.tokens, field.tokens.total, field.tokens.perMinute. States: state.cost_complete, state.cost_partial, state.burn_flames_0, state.burn_flames_1, state.burn_flames_2, state.burn_flames_3, state.burn_flames_4. puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:15-23
- **adapter.antigravity / context**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: field.context, field.context.usedPercent. States: state.context_hot. puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:24-32
- **adapter.antigravity / delegation**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: (upstream only). States: state.working_with_blockers, state.activity_delegating. puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:60-68
- **adapter.antigravity / compaction**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: (upstream only). States: state.activity_compacting. puppeteer:packages/adapter-antigravity/src/normalization/monitor-capabilities.ts:69-77
- **adapter.copilot / usage**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: field.cost, field.cost.usd, field.cost.coverage, field.cost.burnPerHour, field.cost.series, field.cost.series.stepMs, field.cost.series.steps, field.cost.series.lastStepAt, field.tokens, field.tokens.total, field.tokens.perMinute. States: state.cost_complete, state.cost_partial, state.burn_flames_0, state.burn_flames_1, state.burn_flames_2, state.burn_flames_3, state.burn_flames_4. puppeteer:packages/adapter-copilot/src/normalization/monitor-capabilities.ts:15-23
- **adapter.kimi / usage**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: field.cost, field.cost.usd, field.cost.coverage, field.cost.burnPerHour, field.cost.series, field.cost.series.stepMs, field.cost.series.steps, field.cost.series.lastStepAt, field.tokens, field.tokens.total, field.tokens.perMinute. States: state.cost_complete, state.cost_partial, state.burn_flames_0, state.burn_flames_1, state.burn_flames_2, state.burn_flames_3, state.burn_flames_4. puppeteer:packages/adapter-kimi/src/normalization/monitor-capabilities.ts:16-24
- **adapter.pi / usage**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: field.cost, field.cost.usd, field.cost.coverage, field.cost.burnPerHour, field.cost.series, field.cost.series.stepMs, field.cost.series.steps, field.cost.series.lastStepAt, field.tokens, field.tokens.total, field.tokens.perMinute. States: state.cost_complete, state.cost_partial, state.burn_flames_0, state.burn_flames_1, state.burn_flames_2, state.burn_flames_3, state.burn_flames_4. puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:16-24
- **adapter.pi / mode**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: (upstream only). States: (none mapped). puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:54-62
- **adapter.pi / delegation**: unreachable from this declared adapter evidence family (not a ban on host/runtime evidence, migration data, or synthetic fixtures). Fields: (upstream only). States: state.working_with_blockers, state.activity_delegating. puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:63-71

## Schema-valid versus emitted combinations
- `constraint.terminal_blocked`: `kind=terminal && status=blocked` — **unreachable in shipped derivation**. puppeteer:packages/monitor/src/terminal-status.ts:8-12
- `constraint.terminal_unread`: `kind=terminal && unread=true` — **unreachable in shipped derivation**. puppeteer:packages/monitor/src/backend/derive.ts:315; puppeteer:packages/monitor/src/backend/unread.ts:52
- `constraint.pending_working`: `pending=true && status!=idle` — **unreachable in backend deriveAgentRow**. puppeteer:packages/monitor/src/backend/derive.ts:69-72; puppeteer:packages/monitor/src/backend/derive.ts:262
- `constraint.pending_observed`: `pending=true && observed=true` — **unreachable in backend deriveAgentRow**. puppeteer:packages/monitor/src/backend/derive.ts:183-186
- `constraint.writable_not_attachable`: `writable != attachable` — **unreachable in fresh backend before audience/legacy transforms**. puppeteer:packages/monitor/src/backend/derive.ts:283-285; puppeteer:packages/monitor/src/backend/derive.ts:318-319
- `constraint.wait_not_always_blocked`: `status=working && wait exists` — **reachable composite; do not reject**. puppeteer:packages/core/src/monitor/transitions.ts:369-371
- `constraint.unavailable_cost_object`: `cost.coverage=unavailable && cost exists` — **model-supported; normal backend producer not established**. puppeteer:packages/view-sdk/src/model.ts:85; puppeteer:packages/monitor/src/backend/backend.ts:197-205; puppeteer:packages/monitor/src/backend/usage-ledger.ts:76-82
- `constraint.account`: `account present` — **type/renderer-supported; actual VibeField producer unknown/absent in reviewed host mapper**. vibefield:packages/fieldd/src/agent-monitor.ts:223-266; puppeteer:packages/monitor/src/backend/derive.ts:273; puppeteer:packages/views/src/views/list/AgentList.tsx:185
- `constraint.pi_compacting`: `adapter.pi -> activity.compacting` — **not evidenced live start; completion only in current Pi source**. puppeteer:packages/adapter-pi/src/normalization/monitor-capabilities.ts:73-81

## Adapter output boundaries
### `adapter.acp`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-acp/src/normalization/monitor.ts:6; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:125; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:148; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:149; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:150; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:152; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:157; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:184; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:193; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:211; puppeteer:packages/adapter-acp/src/normalization/monitor.ts:260
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-acp/src/normalization/pipeline.ts:14; puppeteer:packages/adapter-acp/src/normalization/pipeline.ts:19; puppeteer:packages/adapter-acp/src/normalization/pipeline.ts:24; puppeteer:packages/adapter-acp/src/normalization/pipeline.ts:26; puppeteer:packages/adapter-acp/src/normalization/pipeline.ts:29
### `adapter.antigravity`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-antigravity/src/normalization/monitor.ts:2; puppeteer:packages/adapter-antigravity/src/normalization/monitor.ts:4; puppeteer:packages/adapter-antigravity/src/normalization/monitor.ts:8; puppeteer:packages/adapter-antigravity/src/normalization/monitor.ts:32; puppeteer:packages/adapter-antigravity/src/normalization/monitor.ts:36
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-antigravity/src/normalization/pipeline.ts:21; puppeteer:packages/adapter-antigravity/src/normalization/pipeline.ts:24
### `adapter.claude`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-claude/src/normalization/monitor.ts:5; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:86; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:111; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:113; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:142; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:214; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:218; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:302; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:304; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:328; puppeteer:packages/adapter-claude/src/normalization/monitor.ts:393
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-claude/src/normalization/pipeline.ts:94; puppeteer:packages/adapter-claude/src/normalization/pipeline.ts:372
### `adapter.codex`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-codex/src/normalization/monitor.ts:11; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:119; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:200; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:201; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:202; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:203; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:208; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:246; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:264; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:279; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:396; puppeteer:packages/adapter-codex/src/normalization/monitor.ts:421
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:32; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:49; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:62; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:63; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:64; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:65; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:66; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:67; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:68; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:69; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:70; puppeteer:packages/adapter-codex/src/normalization/pipeline.ts:71
### `adapter.copilot`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-copilot/src/normalization/monitor.ts:2; puppeteer:packages/adapter-copilot/src/normalization/monitor.ts:4; puppeteer:packages/adapter-copilot/src/normalization/monitor.ts:8; puppeteer:packages/adapter-copilot/src/normalization/monitor.ts:32; puppeteer:packages/adapter-copilot/src/normalization/monitor.ts:36
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-copilot/src/normalization/pipeline.ts:32; puppeteer:packages/adapter-copilot/src/normalization/pipeline.ts:54
### `adapter.grok`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-grok/src/normalization/monitor.ts:6; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:85; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:125; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:126; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:127; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:129; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:134; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:160; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:168; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:204; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:214; puppeteer:packages/adapter-grok/src/normalization/monitor.ts:280
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-grok/src/normalization/pipeline.ts:20; puppeteer:packages/adapter-grok/src/normalization/pipeline.ts:26; puppeteer:packages/adapter-grok/src/normalization/pipeline.ts:97
### `adapter.hermes`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:6; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:123; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:216; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:217; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:218; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:220; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:226; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:255; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:264; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:296; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:303; puppeteer:packages/adapter-hermes/src/normalization/monitor.ts:731
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-hermes/src/normalization/pipeline.ts:20; puppeteer:packages/adapter-hermes/src/normalization/pipeline.ts:39
### `adapter.kimi`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:6; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:103; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:153; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:155; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:156; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:158; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:165; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:206; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:213; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:254; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:261; puppeteer:packages/adapter-kimi/src/normalization/monitor.ts:262
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-kimi/src/normalization/pipeline.ts:27; puppeteer:packages/adapter-kimi/src/normalization/pipeline.ts:36
### `adapter.opencode`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:6; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:189; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:221; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:284; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:286; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:287; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:289; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:295; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:327; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:336; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:375; puppeteer:packages/adapter-opencode/src/normalization/monitor.ts:510
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-opencode/src/normalization/pipeline.ts:104; puppeteer:packages/adapter-opencode/src/normalization/pipeline.ts:160; puppeteer:packages/adapter-opencode/src/normalization/pipeline.ts:365; puppeteer:packages/adapter-opencode/src/normalization/pipeline.ts:634; puppeteer:packages/adapter-opencode/src/normalization/pipeline.ts:667
### `adapter.pi`
Neither monitor.ts nor pipeline.ts emits MonitorAgentRow directly; runtime projects AgentMonitorState, backend derives MonitorAgentRow, replica joins AgentView.
- semantic capability/evidence batches: puppeteer:packages/adapter-pi/src/normalization/monitor.ts:2; puppeteer:packages/adapter-pi/src/normalization/monitor.ts:5; puppeteer:packages/adapter-pi/src/normalization/monitor.ts:9; puppeteer:packages/adapter-pi/src/normalization/monitor.ts:28; puppeteer:packages/adapter-pi/src/normalization/monitor.ts:32
- native input -> normalized AgentEvent stream (additional runtime plane): puppeteer:packages/adapter-pi/src/normalization/pipeline.ts:15; puppeteer:packages/adapter-pi/src/normalization/pipeline.ts:19

## Auxiliary contracts
The JSON contains all 31 source SDK model definitions and a separate property inventory under `x-audit.contractFields` (stable `field.contract.<Type>.<property>` IDs). This includes spawn, history, snapshot/change and window publication contracts. `MonitorModel.byId` is an in-process ReadonlyMap, marked non-JSON. Backend snapshots, not this Map, cross the transport.

## Unknowns / not certified
- Capability support is not an enforcement gate; unsupported marks native family evidence, not impossible host/runtime states. Generic ACP reports monetary cost exists in protocol, but current usage_update monitor mapper only carries context; do not fabricate burn from occupancy.
- No conversation family declaration in the ten matrices: conversation support remains unknown here despite code-proven reply mapping.
- No live provider sessions or adapter raw captures executed by this slice. Runtime reachability versus synthetic fixtures must be supplied by adapter provenance slices.
- iOS has native list/rain/timeline/spend implementations; this contract inventories shared SDK desktop registry, not a renderer parity certification.
- Per-view field sets are confirmed consumers, not a complete negative proof for unlisted fields.
- Project title is not a live model field: project.name is folder basename/fallback. Ended history row title exists separately. Provider-session modes, subagent arrays and raw compaction state exist in AgentMonitorState but are not exposed as dedicated MonitorAgentRow fields.
- Published dependency 0.3.3 vs supplied source SHA equality not independently proven.
