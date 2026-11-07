# GV-AUDIT6 snapshot

Delivery: incomplete. This file is the review manifest for one integrated tree. It is not a certification.

## Integrated sources

| Slice | Commit | What this tree holds |
| --- | --- | --- |
| First half | `68dde825266e63ba63a1b07f7fcfd1e85f868b1f` | Evidence for acp, antigravity, claude, codex, copilot, plus plan, tools, and graphs. Supersedes `355e720`. Copied as files. No puppeteer history. |
| Account trace | `08b5d849177685662b43e0e3a4e6bd7d32ac2cdf` | `contracts/account-trace.md`. Host-scoped. |
| Second half | `d29658187de7a765837d01c20b456b74c857185f` | Cost records from `4d86127a` plus the account verdict. Supersedes `69b4c9c8`. `uiReachable` no is the VibeField host only. |
| Render | `863f44ac1fe2b91bddc5306070761e43636d25c6` | Matrix denominator 410. |
| Shared map | `07e71c9bcb9532fc181e3f667f2d0ed2e7c9afaf` | Static anchors. Not adapter UI resolution. |
| Foundation | `12c7b06ac17263b1f9125391e66242db7e085755` | Model trio matched. Render slice was authored against `b9397f8`. |

Candidate status: `static-not-live`. The owner semantic gate on the copied first-half tools reports 0 contradictions. That is the owner's check. It is not this page's sign-off.

## Counts from the files

- Row records 740. SDK leaves 430. Leaves are not the 74 row fields.
- First-half `uiReachable`: yes 247, no 123, unknown 0. All 370 say they were not live-sampled.
- Render: 103 rendered, 21 covered-by, 77 coverage gaps, 150 not-applicable, 59 environment gaps.
- Covered-by does not add body coverage.
- Prior 302 not-applicable claim: `validated` false. The 150 current not-applicable cells use an outside-view source note. Reader-absence boilerplate is rejected.
- Swarm body painted: no. Environment versus source cause is under investigation.

## Still open

- Claude and Codex cost graphs are held. Confirmed order: `reduce.ts:1049-1073` copies event costUsd before pricing (`monitor-service.ts:233-253`), pricing is `monitor-service.ts:418-425`, and the reducer after pricing is `reduce.ts:672-686`. The files still cite 1049-1073 as the post-price copy. They are not rewritten here and are not accepted provenance.
- ACP, Antigravity, and Copilot cost records stop where the handler omits usage.
- Second-half cost records from `4d86127a` are scoped and static. Grok and OpenCode increment unpriced. Hermes is skipped. Kimi and Pi never enter the ledger. No epoch has costUsd, so there is no retained total. The row is `cost_missing` and `burn_unpriced`. Independent signoff is pending.
- Second-half account `uiReachable` no is the VibeField host only (`sourceScope` host-supplied). The Puppeteer Godview host, `monitor-host.ts:62,79`, sets account only when `profileId` has a nonempty label. That no is not a global adapter impossibility. Lead review of this slice is separate.
- Shared-map `uiResolutionCounts.resolvedUnknown` 265 and `remainingUnknown` 0 are shared-anchor bookkeeping, not envelope UI resolution.
- Render gaps unfinished: 77 coverage gaps and 59 environment gaps. Swarm body was not painted.
- End-to-end proof stays false for synthetic fixtures and source-read traces. Non-cost sequences were not live-run.
