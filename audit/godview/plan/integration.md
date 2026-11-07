# Integration

Slices branch independently. GV-AUDIT6 combines them. Do not merge this foundation into `main` as part of that combine unless the owner asks.

## Commits to combine

| Slice | Commit | What |
| --- | --- | --- |
| Consumer pin | `433505fd0f224f4cda540d642661b13848c0ef82` | Vibefield `main` at the audit consumer pin. Base of the model slice and of this foundation. |
| Foundation | this branch `cursor/godview-audit-foundation-a7cd` | Plan, envelope, matrix, gate. No model files. |
| Model | `49fc12da0fadc34e25c227fa2f03dcce2e09dbaa` on `audit/godview-model` | `contracts/model.schema.json`, `model.md`, `model.validation.json`. Parent is `433505fd`. |
| Package context | `d53a0fa24ca7341fe5858329c9399eac6baf6b53` | `validation/package-pin-check.md`. Context only. Parent is the model commit. |

Audit Puppeteer sources at `748d015a7e393112e0a91dad80111fdf5abe6583`. **NOT SHIPPED 0.3.3.**

## Owned paths

- GV-AUDIT1: `audit/godview/**` except the model trio, `validation/package-pin-check.md`, `evidence/<suffix>/**`, `fixtures/**` JSON, `flows/**` JSON, and `plan/matrix-fragments/<other role>.json`.
- GV-AUDIT2: the three model files, `validation/package-pin-check.md`, and `plan/matrix-fragments/GV-AUDIT2.json`.
- GV-AUDIT3: `evidence/{acp,antigravity,claude,codex,copilot}/**` and `plan/matrix-fragments/GV-AUDIT3.json`.
- GV-AUDIT4: `evidence/{grok,hermes,kimi,opencode,pi}/**` and `plan/matrix-fragments/GV-AUDIT4.json`.
- GV-AUDIT05: fixture JSON under `audit/godview/fixtures/` and `plan/matrix-fragments/GV-AUDIT05.json`.
- GV-AUDIT6: `audit/godview/flows/**` JSON, the QA page on GV-AUDIT6's branch, and `plan/matrix-fragments/GV-AUDIT6.json`.

Read ids from the model commit. Do not add a parallel `model.schema.json` on a foundation branch. Do not retarget the Puppeteer pin to `52d09c8e` or to npm `0.3.3`.

## Check

```sh
node --test audit/godview/validation/validate.test.mjs
```
