# Contracts

GV-AUDIT1 owns every file in this directory except the three model files, which are not on this branch.

Model authority, not vendored here:

- commit `49fc12da0fadc34e25c227fa2f03dcce2e09dbaa`
- branch `audit/godview-model`, base `433505fd0f224f4cda540d642661b13848c0ef82`
- `model.schema.json`, `model.md`, `model.validation.json`

Provenance records use that slice's ids:

- state `state.<snake>` (`state.idle`, `state.feed_no_door`)
- field `field.<Name>` with dotted segments (`field.status`, `field.activity.kind`, `field.profileSet`)
- view `view.list`, `view.rain`, `view.swarm`, `view.spend`, `view.timeline`
- adapter `adapter.<suffix>`

Do not mint `state.unknown` or `feed.*`. Observation presence (`present`, `absent`, `unsupported`, `unknown`, `stale`) is an envelope mark, not a model state. Unknown, unsupported, and absent are not the number 0.

Trace path: `audit/godview/evidence/<adapterSuffix>/<fieldPath>.json`, where `fieldPath` is the field id with the `field.` prefix removed.
