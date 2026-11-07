# GV-AUDIT6 snapshot

Delivery: incomplete. This file is the review manifest for one integrated tree. It is not a certification.

## Integrated sources

| Slice | Commit | What this tree holds |
| --- | --- | --- |
| First half | `918932531febecf58acbef95a1bd11defb082ab2` | Supersedes `68dde825`. Claude raw translation is before pricing. Codex joins as a semantic batch at pricing. Both then use reduce.ts:672-686 and storage at reduce.ts:239-259. Copied as files. |
| Account trace | `08b5d849177685662b43e0e3a4e6bd7d32ac2cdf` | `contracts/account-trace.md`. Host-scoped. |
| Second half | `d29658187de7a765837d01c20b456b74c857185f` | Cost records from `4d86127a` plus the account verdict. Supersedes `69b4c9c8`. `uiReachable` no is the VibeField host only. |
| Render | `0a73bb598b5007619f28fd80d1578662cdcb9c0b` | Supersedes `b2146206`. Denominator 410 = 249 rendered + 21 same-view aliases + 0 ordinary coverage gaps + 73 not-applicable + 67 Swarm environment gaps. |
| Shared map | `07e71c9bcb9532fc181e3f667f2d0ed2e7c9afaf` | Static anchors. Not adapter UI resolution. |
| Foundation | `12c7b06ac17263b1f9125391e66242db7e085755` | Model trio matched. Render slice was authored against `b9397f8`. |

Candidate status: `static-not-live`. The owner semantic gate on the copied first-half tools reports 0 contradictions. That is the owner's check. It is not this page's sign-off.

## Counts from the files

- Row records 740. SDK leaves 430. Leaves are not the 74 row fields.
- First-half `uiReachable`: yes 247, no 123, unknown 0. All 370 say they were not live-sampled.
- Render: 249 rendered, 21 covered-by, 0 ordinary coverage gaps, 73 not-applicable, 67 environment gaps. Zero ordinary gaps is not a complete audit. Proved aliases are 21. The timeline span and ended cells are rendered fixtures, not aliases.
- Covered-by does not add body coverage.
- Prior 302 not-applicable claim: `validated` false. The 150 current not-applicable cells use an outside-view source note. Reader-absence boilerplate is rejected.
- Swarm body painted: no. Environment versus source cause is under investigation.

## Still open

- Claude and Codex cost graphs now carry those anchors. The old known-order defect hold is lifted only because the imported files put Claude's raw copy at reduce.ts:1049-1073 before pricing and Codex's semantic batch at pricing, then both use reduce.ts:672-686 and reduce.ts:239-259. Citation verification and independent semantic acceptance are still pending. This is not accepted provenance.
- ACP, Antigravity, and Copilot cost records stop where the handler omits usage.
- Second-half cost records from `4d86127a` are scoped and static. Grok and OpenCode increment unpriced. Hermes is skipped. Kimi and Pi never enter the ledger. No epoch has costUsd, so there is no retained total. The row is `cost_missing` and `burn_unpriced`. Independent signoff is pending.
- Second-half account `uiReachable` no is the VibeField host only (`sourceScope` host-supplied). The Puppeteer Godview host, `monitor-host.ts:62,79`, sets account only when `profileId` has a nonempty label. That no is not a global adapter impossibility. Lead review of this slice is separate.
- Shared-map `uiResolutionCounts.resolvedUnknown` 265 and `remainingUnknown` 0 are shared-anchor bookkeeping, not envelope UI resolution.
- Render is not finished. 73 not-applicable cells and the same-view aliases are under lead review. 67 Swarm cells are unrendered. Chrome 156 on this host exits its GPU process without VK_KHR_surface or VK_KHR_xcb_surface, headed and headless, so the adapter is null. An earlier device create/destroy log is inconclusive. No source defect is proven and the source is not exonerated.
- `state.timeline_span` is rendered by `fix.timeline.moment-span`. `timeline-span-evidence.json` records readout `30:00working`, tone `working`, branch `span`, and `headAtOrAfterSince` true.
- `state.timeline_ended` is rendered by `fix.timeline.moment-ended`. `timeline-ended-evidence.json` records readout `last active 30m ago`, tone `ended`, branch `ended`, and `headAtOrAfterEnded` true. The old `fix.timeline.past-bounds` alias checked `entry.history === "bounds"` for a run that ended an hour ago, outside the visible window. That alias is not a proof. Both timeline holds are lifted only because these two evidence files match.
- Swarm: `webgpu-doc-flags.json` records the Colab guide flags and the same flags with explicit SwiftShader (`VK_ICD_FILENAMES` on Chrome's bundled ICD). Both return `requestAdapter` null and `EGL_NOT_INITIALIZED`. This host has no hardware GPU and no system Vulkan ICD. No source defect is proven and the source is not exonerated. 67 Swarm cells stay unrendered.
- Review of `b9ea9cf` reports the Claude and Codex order citations source-correct and all 10 account host scopes fixed. This page still does not give a blanket semantic signoff. The lead is checking ledger, epoch, reader, and graph usability.
- The preview archive `godview-qa-preview.tgz` remains the `47e6e636` revision. It is not this render update.
- End-to-end proof stays false for synthetic fixtures and source-read traces. Non-cost sequences were not live-run.
