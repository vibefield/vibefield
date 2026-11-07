# Godview audit foundation (GV-AUDIT1)

Single audit baseline: Puppeteer source `748d015a7e393112e0a91dad80111fdf5abe6583`, with Vibefield consumer pin `433505fd0f224f4cda540d642661b13848c0ef82`.

**NOT SHIPPED 0.3.3.** That npm line (tag `v0.3.3`, commit `52d09c8e84951b9a355a6700eac2dfc1290a9fa0`) is the package Vibefield ships. It is context, not the audit pin. Do not mix evidence across the two.

| Slice | Owns |
| --- | --- |
| GV-AUDIT1 | This foundation: pins, envelope, matrix seed, gate. Branch `cursor/godview-audit-foundation-a7cd`. |
| GV-AUDIT2 | Model contract at `49fc12da0fadc34e25c227fa2f03dcce2e09dbaa` on `audit/godview-model`: `contracts/model.schema.json`, `model.md`, `model.validation.json`. Package comparison context at `d53a0fa24ca7341fe5858329c9399eac6baf6b53`: `validation/package-pin-check.md`. |
| GV-AUDIT3 | Adapter suffixes `acp` through `copilot`. |
| GV-AUDIT4 | Adapter suffixes `grok` through `pi`. |
| GV-AUDIT05 | Real monitor views and labeled fixtures. |
| GV-AUDIT6 | Flowcharts, the QA page, and the independent combine of slice commits. |

Stable state, field, view, and adapter ids are the model slice's. This branch does not copy those files.

```sh
node audit/godview/validation/validate.mjs
node --test audit/godview/validation/validate.test.mjs
```
