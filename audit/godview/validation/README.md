# Validation

```sh
node audit/godview/validation/validate.mjs
node --test audit/godview/validation/validate.test.mjs
```

`package-pin-check.md` is GV-AUDIT2's file at commit `d53a0fa24ca7341fe5858329c9399eac6baf6b53`. It is context for the shipped `0.3.3` package. This gate does not re-run that comparison, and it rejects any manifest that sets `equivalentToAuditPin` to true.

The audit pin remains Puppeteer `748d015a7e393112e0a91dad80111fdf5abe6583`. **NOT SHIPPED 0.3.3.**
