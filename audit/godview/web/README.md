# Godview monitor QA

GV-AUDIT6 page. Audit target: pinned Puppeteer source `748d015a7e393112e0a91dad80111fdf5abe6583`, newer than the 0.3.3 package Vibefield ships. Vibefield overlay context stays `433505fd0f224f4cda540d642661b13848c0ef82`.

```sh
node audit/godview/web/serve.mjs
node --test audit/godview/validation/audit6.test.mjs
node audit/godview/validation/validate.mjs
node --test audit/godview/validation/validate.test.mjs
```

`node audit/godview/validation/validate.mjs` on this integration reports `modelIntegration.status` `matched` and `packageCheck` `matched`. The trio bytes are the `49fc12da` blobs, which are unchanged at `d53a0fa`. `manifest.modelSlice.cherryPickedHere` remains false because that field describes the foundation commit. The files are present here.

Traces and recorded fixtures are loaded. The page lists every state/view entry and every row record on one scroll. Diagrams are in the page, not behind a selector. A live synthetic fixture mounts only when its entry is near the viewport, at most two at a time. That mount is not an actual provider session, and it is separate from the recorded screenshot. Swarm environment gaps are not mounts. The swarm runtime fix is not in this package. Independent semantic acceptance is pending. The lead is still checking ledger, epoch, reader, and graph usability. Render `0a73bb59`: 249 rendered, 21 same-view aliases, 0 ordinary coverage gaps, 73 not-applicable, 67 Swarm environment gaps. Zero ordinary gaps is not a complete audit. `state.timeline_span` is `fix.timeline.moment-span` (readout `30:00working`, tone working, head at or after sinceMs). `state.timeline_ended` is `fix.timeline.moment-ended` (readout `last active 30m ago`, tone ended, head at or after endedAt). The old past-bounds alias is not a proof. Both holds are lifted only because those evidence files match. Documented Colab flags and explicit SwiftShader both leave the adapter null (`EGL_NOT_INITIALIZED`). This host has no hardware GPU and no system Vulkan ICD. 67 Swarm cells stay unrendered. The pinned component bundle, when present, is served at `/harness/index.html?fixture=` and is not package 0.3.3. The screenshot is the recorded fixture, separate from that mount.

> Original foundation sentence, no longer the status of this tree: "Traces and view fixtures are pending until GV-AUDIT3, GV-AUDIT4, and GV-AUDIT05 land. The foundation matrix is a scaffold, not a completeness proof."
