# GV-AUDIT6 snapshot

Delivery: incomplete. This file is the review manifest for one integrated tree. It is not a certification.

## Integrated sources

| Slice | Commit | What this tree holds |
| --- | --- | --- |
| First half | `355e720327b4aa047336a1823e9b43c84e836220` | Evidence for acp, antigravity, claude, codex, copilot, plus plan, tools, and graphs. Supersedes `5bc7fbc`. Copied as files. No puppeteer history. |
| Account trace | `08b5d849177685662b43e0e3a4e6bd7d32ac2cdf` | `contracts/account-trace.md`. Host-scoped. |
| Second half | `69b4c9c8b078571f42302c920f3c5e8e279e37c9` | grok, hermes, kimi, opencode, pi, including account and profileSet flows. |
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

- Lead is still reviewing graph precision: unpriced guard, ledger versus project ordering, retained epochs.
- 24 first-half cost graphs still stop before a reader or overlay. Those are the adapters whose handlers omit usage. Claude and Codex graphs now name ledger counts, a coverage decision, and spend and swarm readers. Zero USD can be complete when pricedCount is positive and unpricedCount is 0. That is the candidate's static claim.
- Account is not an adapter field. The VibeField host omits it. The Puppeteer Godview host can set a profile label except for ACP. `accountUsage` feeds the usage column, not `field.account`.
- Shared-map `uiResolutionCounts.resolvedUnknown` 265 and `remainingUnknown` 0 are shared-anchor bookkeeping, not envelope UI resolution.
- 77 coverage gaps and 59 environment gaps remain. More render updates may arrive.
- End-to-end proof stays false for synthetic fixtures and source-read traces.
