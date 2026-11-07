# Godview monitor QA

GV-AUDIT6 page. Audit target: pinned Puppeteer source `748d015a7e393112e0a91dad80111fdf5abe6583`, newer than the 0.3.3 package Vibefield ships. Vibefield overlay context stays `433505fd0f224f4cda540d642661b13848c0ef82`.

```sh
node audit/godview/web/serve.mjs
node --test audit/godview/validation/audit6.test.mjs
node audit/godview/validation/validate.mjs
node --test audit/godview/validation/validate.test.mjs
```

`node audit/godview/validation/validate.mjs` on this integration reports `modelIntegration.status` `matched` and `packageCheck` `matched`. The trio bytes are the `49fc12da` blobs, which are unchanged at `d53a0fa`. `manifest.modelSlice.cherryPickedHere` remains false because that field describes the foundation commit. The files are present here.

Traces and recorded fixtures are loaded. This page is a static recorded-fixture preview, not a live monitor. Independent semantic acceptance is pending. The lead is still checking ledger, epoch, reader, and graph usability. Render `08429e06`: 247 rendered, 23 same-view aliases, 0 ordinary coverage gaps, 73 not-applicable, 67 Swarm environment gaps. Zero ordinary gaps is not a complete audit. `state.timeline_span` covered by `fix.timeline.working` is unverified: that exercise checks no history and never calls `stateAt(t >= lane.sinceMs)`, so the page does not count it as proved.

> Original foundation sentence, no longer the status of this tree: "Traces and view fixtures are pending until GV-AUDIT3, GV-AUDIT4, and GV-AUDIT05 land. The foundation matrix is a scaffold, not a completeness proof."
