# Matrix correction

`d21cde9a` reported 73 rendered, 302 not-applicable, and 35 environment-gap. That 302 is not a validated scope judgment. Fifty-nine cells used the sentence "No read of this predicate in packages/views/src/..." A view that does not draw a subtype still has the scenario in scope.

The denominator stays 82 states × 5 views = 410. Current counts are `matrixSummary` in `integration.json`. `priorClaim.validated` is false.

A cell is one of:

- `rendered` — a fixture for that view and state was mounted and screenshotted.
- `covered-by` — a rendered fixture of the same view mounts an input that exercises the scenario, and the source takes the same branch. The test resolves `mountRow` and checks the exercise.
- `coverage-gap` — the scenario can appear in the view, and it was not mounted.
- `not-applicable` — the scenario is outside that view's surface. The evidence starts with "Outside this view:".
- `environment-gap` — the swarm canvas paints it, and this host's GPU process does not create an adapter. That diagnosis stays in `webgpu-diagnostic.json`.

Rain's blocked permission, question, and failure columns are rendered. So are unread on the list and the rain. They are not aliases of the plain blocked or idle fixtures, because those fixtures do not mount the subtype.
