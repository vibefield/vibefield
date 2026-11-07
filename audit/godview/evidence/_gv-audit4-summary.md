# GV-AUDIT4 evidence summary

Pins: vibefield `433505fd0f224f4cda540d642661b13848c0ef82`, puppeteer `748d015a7e393112e0a91dad80111fdf5abe6583`.

This source is newer than the puppeteer 0.3.3 package vibefield ships (tag `v0.3.3`, commit `52d09c8e84951b9a355a6700eac2dfc1290a9fa0`). The audit does not compare 0.3.3 behavior. The provenance schema has no `sourceVersion` property, so a transform whose puppeteer path differs from `52d09c8e` ends its effect with `[post-0.3.3]`.

Traces: `audit/godview/evidence/<suffix>/<fieldPath>.json` for grok, hermes, kimi, opencode, and pi. `fieldPath` is the model field id without the `field.` prefix.

## Presence counts

| adapter | present | absent | unsupported | unknown |
| --- | --- | --- | --- | --- |
| adapter.grok | 62 | 12 | 0 | 0 |
| adapter.hermes | 64 | 10 | 0 | 0 |
| adapter.kimi | 59 | 12 | 3 | 0 |
| adapter.opencode | 64 | 10 | 0 | 0 |
| adapter.pi | 55 | 12 | 7 | 0 |

## Mismatches

None.

## History and timeline

Same path for all five. None of these adapters emit past spans. The record is fieldd's history port over rosettad (`packages/fieldd/src/index-activity.ts:17-36` and `230-280`), joined by provider id plus native session id. grok, hermes, kimi, opencode, and pi are catalog ids (`packages/contracts/src/agent-catalog.ts`). `derivePast` (`packages/monitor/src/backend/past.ts:204-242`) turns that record into spans. The timeline reads them in `stateAt` (`packages/views/src/views/timeline/timeline-lanes.ts:247-252`). This slice did not execute a live rosettad session.

- `state.past_worked`, `state.past_quiet`, `state.past_unrecorded`: reachable when `index.activity` answers `fidelity: "turns"` and the session has turns. `spansFromTurns` (`past.ts:120-144`) marks the inside of a turn worked, a silence longer than `PAST_SILENCE_MS` (15 minutes, `past.ts:39`) unrecorded, and the gap between turns quiet.
- `state.past_bounds`: reachable on an ended lane when fidelity is `bounds`, or when a session's turns were not read (`past.ts:166-170`). A live row is skipped in that case (`past.ts:226-227`), so bounds is not that live row's past.
- `state.timeline_unborn`: cursor before `lane.bornMs`.
- `state.timeline_unrecorded`: no joined past, or a span whose kind is unrecorded (`timeline-lanes.ts:240-251`).
- `state.timeline_past`: a worked, quiet, or bounds span covers the cursor.
- `state.timeline_ended`: an ended lane at or after `endedAt`.
- `state.timeline_span`: a live lane at or after `sinceMs`, which is the row's current status.

The runtime can produce these without the adapter emitting them. Whether a particular stored session already has turns is not re-checked here.

## state.branch_none

Unreachable on the full VibeField path for all five, not only because the adapter omits git.

`projectBranch` (`packages/monitor/src/backend/derive.ts:101-107`) returns null only when `environment.git` is defined and neither `git.branch` nor `host.fallbackBranch` is set. These adapters write cwd and never git. `recordWorkspaceEvidence` publishes cwd and worktrees with no git (`packages/runtime/src/runtime.ts:1325-1340`). Provenance git stays off the public environment (`packages/core/src/monitor/reduce.ts:625-631`). `hostRunFromSummary` copies `summary.workspace.branch` when present and does not set `fallbackBranch` (`packages/fieldd/src/agent-monitor.ts:248-256`; `packages/monitor/src/backend/ports.ts:53-58` says VibeField supplies none). A missing observation stays absent (`state.branch_unknown`) or becomes that host string (`state.branch_named`).

## Cost and burn

Shared path, not re-derived here: `audit/godview/contracts/cost-burn-trace.md` at `25c215a2a53f363e1076210b3f6fce2155dfdc0b` on `audit/godview-model`.

Token counts without `costUsd` normally end in `state.cost_missing`, not `state.cost_unavailable`. Core coverage can be unavailable while the backend omits `field.cost` entirely. An observed working swarm body with no complete or partial cost is `state.burn_unpriced`. Priced flames (`state.burn_flames_0` through `state.burn_flames_4`) are reachable only for claude and codex. `field.tokens.perMinute` and those USD flames are independent.

Checked `packages/runtime/src/services/usage-pricing.ts:19-36` and `:69-78`, and `packages/runtime/src/services/usage-prices.ts:39`. The catalog has 60 keys and only the providers `anthropic` and `openai`. Pricing reads the usage upsert's own `pricing` object. It does not use the row model. Grok (`usage.ts:41-54`, canonical, no pricing or costUsd), Hermes (`monitor.ts:311-321` and `:700-711`, noncanonical, no pricing or costUsd), and OpenCode (`monitor.ts:145-153`, canonical, no pricing or costUsd) never attach that object, so the catalog cannot price them. Kimi (`monitor.ts:372-396`) stores journal usage as context, not a usage upsert. Pi emits no live usage. Ingress still selects Grok and OpenCode because they are canonical, then records an unavailable estimate and no `costUsd`. That raises the unpriced count and still leaves no priced total, so the row stays `state.cost_missing`.


## States

Adapter-silent means this adapter never emits the evidence, while the runtime, host, or window still can. Full-path means a run of this adapter still cannot reach the state after those other layers.

### adapter.grok

Reachable for a run of this adapter, including host and window layers:

- `state.active`
- `state.activity_compacting`
- `state.activity_delegating`
- `state.activity_other`
- `state.activity_reasoning`
- `state.activity_responding`
- `state.activity_tool`
- `state.attachable`
- `state.attached`
- `state.blocked`
- `state.blocked_failure`
- `state.blocked_permission`
- `state.blocked_question`
- `state.branch_named`
- `state.branch_unknown`
- `state.burn_unpriced`
- `state.context_hot`
- `state.context_missing`
- `state.cost_missing`
- `state.dead_hidden`
- `state.detached`
- `state.effort_absent`
- `state.effort_observed`
- `state.failed_retained`
- `state.fresh`
- `state.idle`
- `state.model_missing`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.pending_unobserved`
- `state.receded`
- `state.remote`
- `state.reply_final`
- `state.reply_missing`
- `state.reply_streaming`
- `state.spend_before`
- `state.spend_unknown`
- `state.stale`
- `state.starting_unobserved`
- `state.tier_ingested`
- `state.tier_managed`
- `state.tier_remote`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Adapter does not emit it; the runtime, host, or window still can:

- `state.feed_no_door` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_connecting` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_live` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_unavailable` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.spawn_ready` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_asleep` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_silent` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_incompatible` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_reading` — Spawn menu device state, not this adapter and not window-rows.
- `state.device_live` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_stale` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_asleep` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_incompatible` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.terminal_running` — Bare terminal row. deriveAgentRow always sets kind agent. window-rows does not retarget these adapters into terminals.
- `state.terminal_quiet` — Bare terminal row. Same split as terminal_running.
- `state.terminal_empty` — Swarm presentation of a quiet terminal with nothing opening. Not this agent row.
- `state.terminal_opening` — Swarm opening overlay. Not a field these adapters set.
- `state.activity_starting` — Runtime initial run is lifecycle allocated (reduce.ts initialRunEntry, 298-312), which projectActivity renders as starting. The adapter does not emit it.

Full path for a run of this adapter cannot produce it:

- `state.blocked_unknown_kind` — core blockers are only permission, question, and failure (`packages/core/src/monitor/transitions.ts:93-170`).
- `state.branch_none` — see the branch section. The runtime type allows a null git answer; this host path never writes one.
- `state.cost_complete`, `state.cost_partial`, `state.cost_unavailable` — no priced total from these producers. `state.cost_unavailable` would require a present cost object; the normal backend omits it. See the cost section and cost-burn-trace.md at 25c215a.
- `state.burn_flames_0`, `state.burn_flames_1`, `state.burn_flames_2`, `state.burn_flames_3`, `state.burn_flames_4` — priced USD flames. The shared trace finds them only for claude and codex. The pinned catalog cannot price these five.
- `state.effort_configured` — this adapter never emits the evidence, and no host or window-rows path invents it.

### adapter.hermes

Reachable for a run of this adapter, including host and window layers:

- `state.active`
- `state.activity_compacting`
- `state.activity_delegating`
- `state.activity_other`
- `state.activity_responding`
- `state.activity_tool`
- `state.attachable`
- `state.attached`
- `state.blocked`
- `state.blocked_failure`
- `state.blocked_permission`
- `state.blocked_question`
- `state.branch_named`
- `state.branch_unknown`
- `state.burn_unpriced`
- `state.context_hot`
- `state.context_missing`
- `state.cost_missing`
- `state.dead_hidden`
- `state.detached`
- `state.effort_absent`
- `state.effort_configured`
- `state.effort_observed`
- `state.failed_retained`
- `state.fresh`
- `state.idle`
- `state.model_missing`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.pending_unobserved`
- `state.receded`
- `state.remote`
- `state.reply_final`
- `state.reply_missing`
- `state.reply_streaming`
- `state.spend_before`
- `state.spend_unknown`
- `state.stale`
- `state.starting_unobserved`
- `state.tier_ingested`
- `state.tier_managed`
- `state.tier_remote`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Adapter does not emit it; the runtime, host, or window still can:

- `state.feed_no_door` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_connecting` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_live` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_unavailable` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.spawn_ready` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_asleep` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_silent` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_incompatible` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_reading` — Spawn menu device state, not this adapter and not window-rows.
- `state.device_live` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_stale` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_asleep` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_incompatible` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.terminal_running` — Bare terminal row. deriveAgentRow always sets kind agent. window-rows does not retarget these adapters into terminals.
- `state.terminal_quiet` — Bare terminal row. Same split as terminal_running.
- `state.terminal_empty` — Swarm presentation of a quiet terminal with nothing opening. Not this agent row.
- `state.terminal_opening` — Swarm opening overlay. Not a field these adapters set.
- `state.activity_starting` — Runtime initial run is lifecycle allocated (reduce.ts initialRunEntry, 298-312), which projectActivity renders as starting. The adapter does not emit it.

Full path for a run of this adapter cannot produce it:

- `state.blocked_unknown_kind` — core blockers are only permission, question, and failure (`packages/core/src/monitor/transitions.ts:93-170`).
- `state.branch_none` — see the branch section. The runtime type allows a null git answer; this host path never writes one.
- `state.cost_complete`, `state.cost_partial`, `state.cost_unavailable` — no priced total from these producers. `state.cost_unavailable` would require a present cost object; the normal backend omits it. See the cost section and cost-burn-trace.md at 25c215a.
- `state.burn_flames_0`, `state.burn_flames_1`, `state.burn_flames_2`, `state.burn_flames_3`, `state.burn_flames_4` — priced USD flames. The shared trace finds them only for claude and codex. The pinned catalog cannot price these five.
- `state.activity_reasoning` — this adapter never emits the evidence, and no host or window-rows path invents it.

### adapter.kimi

Reachable for a run of this adapter, including host and window layers:

- `state.active`
- `state.activity_compacting`
- `state.activity_delegating`
- `state.activity_other`
- `state.activity_reasoning`
- `state.activity_responding`
- `state.activity_tool`
- `state.attachable`
- `state.attached`
- `state.blocked`
- `state.blocked_failure`
- `state.blocked_permission`
- `state.blocked_question`
- `state.branch_named`
- `state.branch_unknown`
- `state.burn_unpriced`
- `state.context_missing`
- `state.cost_missing`
- `state.dead_hidden`
- `state.detached`
- `state.effort_absent`
- `state.effort_configured`
- `state.effort_observed`
- `state.failed_retained`
- `state.fresh`
- `state.idle`
- `state.model_missing`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.pending_unobserved`
- `state.receded`
- `state.remote`
- `state.reply_final`
- `state.reply_missing`
- `state.reply_streaming`
- `state.spend_before`
- `state.spend_unknown`
- `state.stale`
- `state.starting_unobserved`
- `state.tier_ingested`
- `state.tier_managed`
- `state.tier_remote`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Adapter does not emit it; the runtime, host, or window still can:

- `state.feed_no_door` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_connecting` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_live` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_unavailable` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.spawn_ready` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_asleep` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_silent` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_incompatible` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_reading` — Spawn menu device state, not this adapter and not window-rows.
- `state.device_live` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_stale` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_asleep` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_incompatible` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.terminal_running` — Bare terminal row. deriveAgentRow always sets kind agent. window-rows does not retarget these adapters into terminals.
- `state.terminal_quiet` — Bare terminal row. Same split as terminal_running.
- `state.terminal_empty` — Swarm presentation of a quiet terminal with nothing opening. Not this agent row.
- `state.terminal_opening` — Swarm opening overlay. Not a field these adapters set.
- `state.activity_starting` — Runtime initial run is lifecycle allocated (reduce.ts initialRunEntry, 298-312), which projectActivity renders as starting. The adapter does not emit it.

Full path for a run of this adapter cannot produce it:

- `state.blocked_unknown_kind` — core blockers are only permission, question, and failure (`packages/core/src/monitor/transitions.ts:93-170`).
- `state.branch_none` — see the branch section. The runtime type allows a null git answer; this host path never writes one.
- `state.cost_complete`, `state.cost_partial`, `state.cost_unavailable` — no priced total from these producers. `state.cost_unavailable` would require a present cost object; the normal backend omits it. See the cost section and cost-burn-trace.md at 25c215a.
- `state.burn_flames_0`, `state.burn_flames_1`, `state.burn_flames_2`, `state.burn_flames_3`, `state.burn_flames_4` — priced USD flames. The shared trace finds them only for claude and codex. The pinned catalog cannot price these five.
- `state.context_hot` — this adapter never emits the evidence, and no host or window-rows path invents it.

### adapter.opencode

Reachable for a run of this adapter, including host and window layers:

- `state.active`
- `state.activity_compacting`
- `state.activity_delegating`
- `state.activity_other`
- `state.activity_reasoning`
- `state.activity_responding`
- `state.activity_tool`
- `state.attachable`
- `state.attached`
- `state.blocked`
- `state.blocked_failure`
- `state.blocked_permission`
- `state.blocked_question`
- `state.branch_named`
- `state.branch_unknown`
- `state.burn_unpriced`
- `state.context_hot`
- `state.context_missing`
- `state.cost_missing`
- `state.dead_hidden`
- `state.detached`
- `state.effort_absent`
- `state.effort_configured`
- `state.effort_observed`
- `state.failed_retained`
- `state.fresh`
- `state.idle`
- `state.model_missing`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.pending_unobserved`
- `state.receded`
- `state.remote`
- `state.reply_final`
- `state.reply_missing`
- `state.reply_streaming`
- `state.spend_before`
- `state.spend_unknown`
- `state.stale`
- `state.starting_unobserved`
- `state.tier_ingested`
- `state.tier_managed`
- `state.tier_remote`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Adapter does not emit it; the runtime, host, or window still can:

- `state.feed_no_door` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_connecting` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_live` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_unavailable` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.spawn_ready` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_asleep` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_silent` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_incompatible` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_reading` — Spawn menu device state, not this adapter and not window-rows.
- `state.device_live` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_stale` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_asleep` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_incompatible` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.terminal_running` — Bare terminal row. deriveAgentRow always sets kind agent. window-rows does not retarget these adapters into terminals.
- `state.terminal_quiet` — Bare terminal row. Same split as terminal_running.
- `state.terminal_empty` — Swarm presentation of a quiet terminal with nothing opening. Not this agent row.
- `state.terminal_opening` — Swarm opening overlay. Not a field these adapters set.
- `state.activity_starting` — Runtime initial run is lifecycle allocated (reduce.ts initialRunEntry, 298-312), which projectActivity renders as starting. The adapter does not emit it.

Full path for a run of this adapter cannot produce it:

- `state.blocked_unknown_kind` — core blockers are only permission, question, and failure (`packages/core/src/monitor/transitions.ts:93-170`).
- `state.branch_none` — see the branch section. The runtime type allows a null git answer; this host path never writes one.
- `state.cost_complete`, `state.cost_partial`, `state.cost_unavailable` — no priced total from these producers. `state.cost_unavailable` would require a present cost object; the normal backend omits it. See the cost section and cost-burn-trace.md at 25c215a.
- `state.burn_flames_0`, `state.burn_flames_1`, `state.burn_flames_2`, `state.burn_flames_3`, `state.burn_flames_4` — priced USD flames. The shared trace finds them only for claude and codex. The pinned catalog cannot price these five.

### adapter.pi

Reachable for a run of this adapter, including host and window layers:

- `state.active`
- `state.activity_other`
- `state.activity_tool`
- `state.attachable`
- `state.attached`
- `state.blocked`
- `state.blocked_failure`
- `state.branch_named`
- `state.branch_unknown`
- `state.burn_unpriced`
- `state.context_missing`
- `state.cost_missing`
- `state.dead_hidden`
- `state.detached`
- `state.effort_absent`
- `state.effort_observed`
- `state.failed_retained`
- `state.fresh`
- `state.idle`
- `state.model_missing`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.pending_unobserved`
- `state.receded`
- `state.remote`
- `state.reply_final`
- `state.reply_missing`
- `state.spend_before`
- `state.spend_unknown`
- `state.stale`
- `state.starting_unobserved`
- `state.tier_ingested`
- `state.tier_managed`
- `state.tier_remote`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`
- `state.unread`
- `state.working`

Adapter does not emit it; the runtime, host, or window still can:

- `state.feed_no_door` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_connecting` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_live` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.feed_unavailable` — Feed door state in model-replica, not an adapter row and not window-rows.
- `state.spawn_ready` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_asleep` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_silent` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_incompatible` — Spawn menu device state, not this adapter and not window-rows.
- `state.spawn_reading` — Spawn menu device state, not this adapter and not window-rows.
- `state.device_live` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_stale` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_asleep` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.device_incompatible` — Board standing. window-rows only reads it to override a peer's field.stale.
- `state.terminal_running` — Bare terminal row. deriveAgentRow always sets kind agent. window-rows does not retarget these adapters into terminals.
- `state.terminal_quiet` — Bare terminal row. Same split as terminal_running.
- `state.terminal_empty` — Swarm presentation of a quiet terminal with nothing opening. Not this agent row.
- `state.terminal_opening` — Swarm opening overlay. Not a field these adapters set.
- `state.activity_starting` — Runtime initial run is lifecycle allocated (reduce.ts initialRunEntry, 298-312), which projectActivity renders as starting. The adapter does not emit it.

Full path for a run of this adapter cannot produce it:

- `state.blocked_unknown_kind` — core blockers are only permission, question, and failure (`packages/core/src/monitor/transitions.ts:93-170`).
- `state.branch_none` — see the branch section. The runtime type allows a null git answer; this host path never writes one.
- `state.cost_complete`, `state.cost_partial`, `state.cost_unavailable` — no priced total from these producers. `state.cost_unavailable` would require a present cost object; the normal backend omits it. See the cost section and cost-burn-trace.md at 25c215a.
- `state.burn_flames_0`, `state.burn_flames_1`, `state.burn_flames_2`, `state.burn_flames_3`, `state.burn_flames_4` — priced USD flames. The shared trace finds them only for claude and codex. The pinned catalog cannot price these five.
- `state.activity_compacting` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.activity_delegating` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.activity_reasoning` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.activity_responding` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.blocked_permission` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.blocked_question` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.context_hot` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.effort_configured` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.reply_streaming` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.wait_multiple` — this adapter never emits the evidence, and no host or window-rows path invents it.
- `state.working_with_blockers` — this adapter never emits the evidence, and no host or window-rows path invents it.

No classified state in this inventory remains unknown, and no cost or burn state remains pending.
