# Godview audit plan

## Baseline

Owner decision, confirmed: audit Puppeteer source `748d015a7e393112e0a91dad80111fdf5abe6583`, clearly labeled as newer than the package Vibefield ships. Vibefield consumer pin `433505fd0f224f4cda540d642661b13848c0ef82`. One baseline. No second exhaustive audit of the published package.

**NOT SHIPPED 0.3.3.** `pnpm-workspace.yaml` and `pnpm-lock.yaml` select `@vibefield/puppeteer-*` `0.3.3`. `siblings.lock.json` records checkout coordinate `52d09c8e84951b9a355a6700eac2dfc1290a9fa0` for release `0.3.3`. Those identifiers are the shipped line. They are not the audit pin.

Package comparison stays context. GV-AUDIT2 committed it at `d53a0fa24ca7341fe5858329c9399eac6baf6b53` in `audit/godview/validation/package-pin-check.md`. Teammate summary, not re-verified in this slice: seventeen `0.3.3` packages, compiled JS byte-identical to tag `v0.3.3` commit `52d09c8e` (691 files); source pin `748d015a` is four commits later, with 88 changed compiled files. `equivalentToAuditPin` stays false.

## Model ids

GV-AUDIT2's model contract is commit `49fc12da0fadc34e25c227fa2f03dcce2e09dbaa` on branch `audit/godview-model` (parent `433505fd`). Paths:

- `audit/godview/contracts/model.schema.json`
- `audit/godview/contracts/model.md`
- `audit/godview/contracts/model.validation.json`

This foundation commit does not contain them. A combined tree is valid when the three files match that commit byte for byte (`contracts/model-slice-pin.json`). `d53a0fa24ca7341fe5858329c9399eac6baf6b53` has the same model blobs and adds `validation/package-pin-check.md`. GV-AUDIT6 combines slice commits. See `integration.md`. State and field ids in later traces must be ids from that contract (`state.idle`, `state.feed_no_door`, `field.status`, `field.stale`, `field.profileSet`, `view.swarm`, `adapter.claude`). Orthogonal axes are not a cartesian product of every metadata value. Unbounded values (model ids, paths, token counts, prompts) are not finite enums.

VibeField consumes `AgentView` from the Puppeteer SDK. `packages/field-app/src/godview/monitor/window-rows.ts` is a display patch: peer `field.stale` follows desktop standing, and peer `field.profileSet` is dropped. The model slice already records that. Do not open a second field catalog for it.

## Provenance envelope

`contracts/provenance.schema.json` is the record each adapter trace must satisfy. It carries the audit pins, repo path line and symbol, producer and ingestion, transforms, merge and defaults, transport, renderer, applicability (`model-axes` or an explicit list of model state ids), missing and stale handling, classification (`modelSupported`, `adapterEmittable`, `uiReachable` as `yes` / `no` / `unknown`), and verification status.

Unknown, unsupported, and absent observations must not store a literal. A real numeric zero is `presence: present` plus `zeroIsObserved: true`. Synthetic observations and fixtures carry `syntheticLabel`.

## Work split

- GV-AUDIT3 and GV-AUDIT4: one trace per adapter field they can emit or must record as unsupported or absent, under `evidence/<suffix>/`.
- GV-AUDIT05: fixtures that render the five shipping views. Synthetic fixtures are labeled.
- GV-AUDIT6: flows down to ingestion, the QA page, and coverage against the model catalog. Independent branch. Do not treat this foundation branch as the page.

## Gate

`node --test audit/godview/validation/validate.test.mjs` must pass before a slice lands. The matrix seed lists adapters, views, the baseline warning, and the gates. Status moves through `matrix-fragments/`, not by rewriting another role's files.
