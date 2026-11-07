# Matrix correction

The denominator is 82 states × 5 views = 410.

`d21cde9a` reported 73 rendered, 302 not-applicable, and 35 environment-gap. That 302 is not a validated scope judgment. `priorClaim.validated` is false.

Current counts are `matrixSummary` in `integration.json`:

| Cell | Count |
| --- | --- |
| rendered | 249 |
| covered-by | 21 |
| coverage gap | 0 |
| not-applicable | 73 |
| environment gap | 67 |

`state.timeline_span` is `fix.timeline.moment-span`. The shot records the pinned TimelineView's live head time and the readout that view writes from `stateAt`. The head is at or after `sinceMs`, the readout says working, and it is not the unborn, unrecorded, or past wording. A check that the working fixture merely has no history is not accepted.

`state.timeline_ended` is `fix.timeline.moment-ended`. The pinned TimelineView's ended lane, at the live head, reads `last active` with tone `ended`, and the head time is after that run's `endedAt`. The old alias to `fix.timeline.past-bounds` only checked that the history kind was bounds.

Not-applicable is only a scenario that cannot be mounted: the feed door, desktop standing, a row omitted before the view, `opening` (not an AgentView field), the timeline scrub head on a view that has none, and the spend scrub on a view that has none.

The swarm canvas remains an environment gap. Its conclusion is `swarm-conclusion.md`.
