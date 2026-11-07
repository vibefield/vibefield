# GV-AUDIT4 evidence summary

Pins: vibefield `433505fd0f224f4cda540d642661b13848c0ef82`, puppeteer `748d015a7e393112e0a91dad80111fdf5abe6583`.

This source is newer than the puppeteer 0.3.3 package vibefield ships (tag `v0.3.3`, commit `52d09c8e84951b9a355a6700eac2dfc1290a9fa0`). The audit does not compare 0.3.3 behavior. The provenance schema has no `sourceVersion` property, so a transform whose puppeteer path differs from `52d09c8e` ends its effect with `[post-0.3.3]`.

Traces: `audit/godview/evidence/<suffix>/<fieldPath>.json` for grok, hermes, kimi, opencode, and pi. `fieldPath` is the model field id without the `field.` prefix.

## Presence counts

| adapter | present | absent | unsupported | unknown |
| --- | --- | --- | --- | --- |
| adapter.grok | 62 | 12 | 0 | 0 |
| adapter.hermes | 64 | 10 | 0 | 0 |
| adapter.kimi | 59 | 4 | 11 | 0 |
| adapter.opencode | 64 | 10 | 0 | 0 |
| adapter.pi | 55 | 4 | 15 | 0 |

## Mismatches

- `adapter.grok` `field.cost` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.grok` `field.cost.usd` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.grok` `field.cost.coverage` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.grok` `field.cost.burnPerHour` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.grok` `field.cost.series` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.grok` `field.cost.series.stepMs` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.grok` `field.cost.series.steps` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.grok` `field.cost.series.lastStepAt` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost.usd` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost.coverage` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost.burnPerHour` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost.series` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost.series.stepMs` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost.series.steps` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.hermes` `field.cost.series.lastStepAt` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost.usd` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost.coverage` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost.burnPerHour` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost.series` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost.series.stepMs` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost.series.steps` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.
- `adapter.opencode` `field.cost.series.lastStepAt` observation `absent`: the usage family is not unsupported, but usage claims set token counts only. buildUsageCostLedger sums costUsd and skips observations without it, so the row cost object stays absent.

## States

### adapter.grok

Can produce, from this adapter's events or from the host and window path that applies to its run:

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
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Cannot produce from this adapter:

- `state.activity_starting`
- `state.blocked_unknown_kind`
- `state.burn_flames_0`
- `state.burn_flames_1`
- `state.burn_flames_2`
- `state.burn_flames_3`
- `state.burn_flames_4`
- `state.cost_complete`
- `state.cost_partial`
- `state.cost_unavailable`
- `state.device_asleep`
- `state.device_incompatible`
- `state.device_live`
- `state.device_stale`
- `state.effort_configured`
- `state.feed_connecting`
- `state.feed_live`
- `state.feed_no_door`
- `state.feed_unavailable`
- `state.spawn_asleep`
- `state.spawn_incompatible`
- `state.spawn_reading`
- `state.spawn_ready`
- `state.spawn_silent`
- `state.terminal_empty`
- `state.terminal_opening`
- `state.terminal_quiet`
- `state.terminal_running`

Unknown in this slice:

- `state.branch_none`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`

### adapter.hermes

Can produce, from this adapter's events or from the host and window path that applies to its run:

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
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Cannot produce from this adapter:

- `state.activity_reasoning`
- `state.activity_starting`
- `state.blocked_unknown_kind`
- `state.burn_flames_0`
- `state.burn_flames_1`
- `state.burn_flames_2`
- `state.burn_flames_3`
- `state.burn_flames_4`
- `state.cost_complete`
- `state.cost_partial`
- `state.cost_unavailable`
- `state.device_asleep`
- `state.device_incompatible`
- `state.device_live`
- `state.device_stale`
- `state.feed_connecting`
- `state.feed_live`
- `state.feed_no_door`
- `state.feed_unavailable`
- `state.spawn_asleep`
- `state.spawn_incompatible`
- `state.spawn_reading`
- `state.spawn_ready`
- `state.spawn_silent`
- `state.terminal_empty`
- `state.terminal_opening`
- `state.terminal_quiet`
- `state.terminal_running`

Unknown in this slice:

- `state.branch_none`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`

### adapter.kimi

Can produce, from this adapter's events or from the host and window path that applies to its run:

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
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Cannot produce from this adapter:

- `state.activity_starting`
- `state.blocked_unknown_kind`
- `state.burn_flames_0`
- `state.burn_flames_1`
- `state.burn_flames_2`
- `state.burn_flames_3`
- `state.burn_flames_4`
- `state.context_hot`
- `state.cost_complete`
- `state.cost_partial`
- `state.cost_unavailable`
- `state.device_asleep`
- `state.device_incompatible`
- `state.device_live`
- `state.device_stale`
- `state.feed_connecting`
- `state.feed_live`
- `state.feed_no_door`
- `state.feed_unavailable`
- `state.spawn_asleep`
- `state.spawn_incompatible`
- `state.spawn_reading`
- `state.spawn_ready`
- `state.spawn_silent`
- `state.terminal_empty`
- `state.terminal_opening`
- `state.terminal_quiet`
- `state.terminal_running`

Unknown in this slice:

- `state.branch_none`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`

### adapter.opencode

Can produce, from this adapter's events or from the host and window path that applies to its run:

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
- `state.unread`
- `state.wait_multiple`
- `state.working`
- `state.working_with_blockers`

Cannot produce from this adapter:

- `state.activity_starting`
- `state.blocked_unknown_kind`
- `state.burn_flames_0`
- `state.burn_flames_1`
- `state.burn_flames_2`
- `state.burn_flames_3`
- `state.burn_flames_4`
- `state.cost_complete`
- `state.cost_partial`
- `state.cost_unavailable`
- `state.device_asleep`
- `state.device_incompatible`
- `state.device_live`
- `state.device_stale`
- `state.feed_connecting`
- `state.feed_live`
- `state.feed_no_door`
- `state.feed_unavailable`
- `state.spawn_asleep`
- `state.spawn_incompatible`
- `state.spawn_reading`
- `state.spawn_ready`
- `state.spawn_silent`
- `state.terminal_empty`
- `state.terminal_opening`
- `state.terminal_quiet`
- `state.terminal_running`

Unknown in this slice:

- `state.branch_none`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`

### adapter.pi

Can produce, from this adapter's events or from the host and window path that applies to its run:

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
- `state.unread`
- `state.working`

Cannot produce from this adapter:

- `state.activity_compacting`
- `state.activity_delegating`
- `state.activity_reasoning`
- `state.activity_responding`
- `state.activity_starting`
- `state.blocked_permission`
- `state.blocked_question`
- `state.blocked_unknown_kind`
- `state.burn_flames_0`
- `state.burn_flames_1`
- `state.burn_flames_2`
- `state.burn_flames_3`
- `state.burn_flames_4`
- `state.context_hot`
- `state.cost_complete`
- `state.cost_partial`
- `state.cost_unavailable`
- `state.device_asleep`
- `state.device_incompatible`
- `state.device_live`
- `state.device_stale`
- `state.effort_configured`
- `state.feed_connecting`
- `state.feed_live`
- `state.feed_no_door`
- `state.feed_unavailable`
- `state.reply_streaming`
- `state.spawn_asleep`
- `state.spawn_incompatible`
- `state.spawn_reading`
- `state.spawn_ready`
- `state.spawn_silent`
- `state.terminal_empty`
- `state.terminal_opening`
- `state.terminal_quiet`
- `state.terminal_running`
- `state.wait_multiple`
- `state.working_with_blockers`

Unknown in this slice:

- `state.branch_none`
- `state.past_bounds`
- `state.past_quiet`
- `state.past_unrecorded`
- `state.past_worked`
- `state.timeline_ended`
- `state.timeline_past`
- `state.timeline_span`
- `state.timeline_unborn`
- `state.timeline_unrecorded`

History and timeline states are unknown because the recorded-lanes writer was not traced. `state.branch_none` is unknown because these adapters do not emit a git answer. Device standing, spawn menu, feed door, and bare-terminal states are outside the adapter. `state.blocked_unknown_kind` cannot be emitted by the core blocker union. Cost complete, partial, unavailable, and priced burn flames cannot, because none of these five adapters set `costUsd`.
