# Validation

```sh
node audit/godview/validation/validate.mjs
node --test audit/godview/validation/validate.test.mjs
```

`gate.model-slice-ref` hashes `contracts/model.schema.json`, `model.md`, and `model.validation.json` against `contracts/model-slice-pin.json` (commit `49fc12da0fadc34e25c227fa2f03dcce2e09dbaa`). Those blobs are unchanged at `d53a0fa24ca7341fe5858329c9399eac6baf6b53`, which only adds `validation/package-pin-check.md`. Zero of the three files is foundation-only incompleteness, not a failure. One or two files, or any mismatched sha256, fails the gate. The package file is optional context and must match its pin when present.

The gate does not re-run the package comparison, and it rejects any manifest that sets `equivalentToAuditPin` to true.

The audit pin remains Puppeteer `748d015a7e393112e0a91dad80111fdf5abe6583`. **NOT SHIPPED 0.3.3.**
