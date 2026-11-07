# Evidence traces

Canonical file: `audit/godview/evidence/<adapterSuffix>/<fieldPath>.json`.

Example: `field.status` for `adapter.claude` is `evidence/claude/status.json`. The envelope's `adapterId` is `adapter.claude` and its `fieldId` is `field.status`.

GV-AUDIT3 writes `acp`, `antigravity`, `claude`, `codex`, and `copilot`. GV-AUDIT4 writes the other five. Each record uses `contracts/provenance.schema.json` and the pins in the manifest. Cite Puppeteer sources at `748d015a7e393112e0a91dad80111fdf5abe6583` only. Shipped package `0.3.3` is not this baseline.

No traces are in the foundation commit.
