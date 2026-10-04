# Godview monitor — MV-0 baselines (2026-10-03)

**Status:** recorded on today's code (main `9d72a75d` + the MV-0 instruments, lane `mv/mv0-vf`).
**Reference, never a bound** (build-mv L14): a slice is judged by a PAIRED run against its base, not
against these numbers. They say what today's seam and views cost, so the direction of a later
delta can be read.

Everything here is reproducible from the repo: the corpora are deterministic (`generateCorpus`),
the oracle and the seam bench are `pnpm --filter @vibefield/field-app perf:godview:{oracle,seam}`,
the paired harness is `pnpm perf:godview` (outside `pnpm verify`). Raw records beside this file in
`godview-mv0/`: `aa-baseline-2026-10-03.{json,md}` (the paired run), `seam-cost-2026-10-03.json`,
`oracle-2026-10-03.json`.

Machine: James's M1 Max, a 120 Hz display (8.3 ms frames), Electron 43, loaded host (memory
`loaded-host-measurement-discipline`: medians are the estimator, tails are weather; the load
average at every launch is recorded in the JSON). Corpora: `n=10/20/60, duration=8000, seed=1` —
fold frames at the 16 ms tick (465 per corpus), one peer desktop on the mesh board at the 100 ms
floor, usage ticking on every working agent every tick, a status flip every second, a reply every
1.5 s, a wait every 2.5 s, one marker (`run-1` idle → blocked) inside a 600 ms quiet window.

## 1. The seam, per fold frame (Node, medians of per-frame medians over 3 rounds)

What one `agent.subscribe {}` frame costs between the socket and the view's props: `JSON.parse`,
`AgentListResult.safeParse`, the damage gate (`rowsKey`), and the `agents` memo's body
(`reconcileUsage`, `assembleMonitorAgents`, `reconcileUnread`, `observeStatuses`, the save
effect's `exportUsage`). Load 29–40.

| n | wire / frame | parse | zod | gate | usage | assemble | unread | status | export | **frame p50** | p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 47.8 KB | 0.109 | 0.091 | 0.009 | 0.013 | 0.029 | 0.003 | 0.005 | 0.001 | **0.261 ms** | 0.364 |
| 20 | 81.7 KB | 0.193 | 0.181 | 0.021 | 0.018 | 0.043 | 0.006 | 0.009 | 0.003 | **0.478 ms** | 1.846 |
| 60 | 217 KB | 0.515 | 0.532 | 0.061 | 0.047 | 0.124 | 0.018 | 0.025 | 0.005 | **1.346 ms** | 2.171 |

- The damage gate passed on **465 of 465** fold frames at every n: a working agent's usage tick
  bumps `monitor.revision`, and the gate's key includes it.
- Parse + zod are ~78 % of the seam at n=60 (1.05 of 1.35 ms); the ledgers and the projection
  together are 0.21 ms. The whole-board wire is the cost: 217 KB × 62.5 frames/s ≈ 13.6 MB/s of
  JSON at n=60, ~8 % of a 16 ms frame before React or any view has run.
- A mesh frame (parse · zod · `meshFieldAfterFrame` · `meshRecords`): 0.041 / 0.077 / 0.200 ms.

## 2. The oracle — the seam's work per input frame (happy-dom, fake clock)

`GodviewAgentsProvider` + `useMonitorAgents` with the real ledgers, projection and localStorage
cache, every frame delivered, each output `MonitorAgent[]` written (the differential's ground
truth for MV-3, under the lane at `perf/oracle/oracle-<corpus>[-seeded].jsonl.gz`).

| n | frames (fold + mesh) | `agents` rebuilt | renders | assemblies | each ledger | `exportUsage` | usage writes, fresh cache | usage writes, seeded cache |
|---|---|---|---|---|---|---|---|---|
| 10 | 572 (465 + 106) | 465 / 465 fold | 575 | 573 | 573 | 465 | **0** | **464 / 465** (58 /s) |
| 20 | 601 (465 + 135) | 465 / 465 | 604 | 602 | 602 | 465 | 0 | 464 / 465 (58 /s) |
| 60 | 601 (465 + 135) | 465 / 465 | 604 | 602 | 602 | 465 | 0 | 464 / 465 (58 /s) |

- Every fold frame rebuilds every agent object (identity changes 465/465), and the three ledgers
  run on every assembly (one per fold frame, one per mesh frame).
- The usage cache: the save effect fires on every fold frame (`exportUsage` 465), and once a record
  exists it writes localStorage on 464 of 465 frames (plus a `getItem` read per save). On a fresh
  install it writes **nothing**: VibeField's readings pass `{id, usage}` with no `session`, so
  `exportUsage` never matches a key — puppeteer's own Godview passes `session` and `runId`
  (`apps/godview/src/renderer/monitor/useMonitorAgents.ts:306-310`; build-mv M15 records the same
  gap for the run id). A product finding, not fixed by MV-0.

## 3. The views under replay — real Electron, A/A paired, 3 rounds (medians of arm A)

The product with Godview open, the replay door in place of the live subscriptions, each view
selected on the instrument bar, a discarded warm-up replay first, then 8 s per cell. Counted from
inside the renderer by the probe. Loads at the six launches: 45 · 44 · 48 · 75 · 72 · 42.

> **Note (MV-3c, 2026-10-04; build-mv M31):** these numbers were taken with EVERY replayed row drawn
> stale. Today's seam classifies recency against `Date.now()`, and the corpus is dated
> 2026-10-03T12:00Z, so under the lab every row's evidence was older than the stale bound. The
> MV-3 harness replays under a corpus clock (the page's `Date.now` reads the corpus's wall time
> while a replay plays, both arms), so its numbers draw the rows the backend draws. These stay
> reference, never a bound (L14).

| view × n | fps | frame p50 / p95 | LoAF | renders / 8 s | worker posts (`updateAgents`) | GPU submits | 2D calls | DOM mutations | JS heap | renderer WS |
|---|---|---|---|---|---|---|---|---|---|---|
| swarm × 10 | 119.9 | 8.3 / 10.0 | 0 | 571 | 825 (570) | 1018 | 0 | 159 | 126 MB | 466 MB |
| swarm × 20 | 120.0 | 8.3 / 10.0 | 0 | 599 | 854 (599) | 1015 | 0 | 201 | 230 MB | 595 MB |
| swarm × 60 | 120.0 | 8.3 / 10.0 | 0 | 599 | 855 (599) | 1022 | 0 | 378 | 359 MB | 846 MB |
| list × 10 | 120.0 | 8.3 / 9.9 | 0 | 570 | – | – | 0 | 234 | 107 MB | 468 MB |
| list × 20 | 120.0 | 8.3 / 10.0 | 0 | 600 | – | – | 0 | 435 | 276 MB | 639 MB |
| list × 60 | 119.9 | 8.3 / 9.9 | 0 | 599 | – | – | 0 | 1 139 | 467 MB | 916 MB |
| rain × 10 | 120.0 | 8.3 / 9.9 | 0 | 570 | – | – | 95 897 | 1 172 | 115 MB | 471 MB |
| rain × 20 | 120.0 | 8.3 / 10.0 | 0 | 599 | – | – | 176 223 | 1 238 | 210 MB | 681 MB |
| rain × 60 | 120.0 | 8.3 / 10.0 | 0 | 599 | – | – | 283 822 | 1 242 | 624 MB | 1 142 MB |
| timeline × 10 | 120.0 | 8.3 / 9.9 | 0 | 570 | – | – | 2 252 | 2 850 | 116 MB | 471 MB |
| timeline × 20 | 120.0 | 8.3 / 9.9 | 0 | 599 | – | – | 3 045 | 3 703 | 176 MB | 627 MB |
| timeline × 60 | **102.4** | 8.3 / 10.2 | **20** | 599 | – | – | 6 210 | 7 380 | 751 MB | 1 344 MB |

Change-to-pixel latency, from the corpus mark (the fold frame that flips `run-1` to blocked, inside
the quiet window) to the first event at or after it, medians of arm A, ms:

| view × n | → view render | → commit | → DOM mutation | → 2D draw | → GPU submit | → next rAF |
|---|---|---|---|---|---|---|
| swarm × 10 / 20 / 60 | 5.9 / 6.2 / 6.2 | 6.0 / 6.4 / 6.5 | 305 / 306 / 310 | – | 4.9 / 8.2 / 0.9 | 4.5 / 7.4 / 3.1 |
| list × 10 / 20 / 60 | 5.3 / 5.7 / 7.4 | 5.5 / 6.0 / 8.4 | 5.6 / 6.0 / 8.4 | – | – | 4.2 / 3.2 / 5.3 |
| rain × 10 / 20 / 60 | 6.4 / 6.1 / 6.9 | 6.6 / 6.3 / 7.1 | 6.6 / 6.3 / 7.2 | 26.5 / 23.1 / 26.5 | – | 6.1 / 3.2 / 8.6 |
| timeline × 10 / 20 / 60 | 5.8 / 6.0 / 7.0 | 6.2 / 6.5 / 7.7 | 6.2 / 5.6 / 7.6 | 133 / 309 / 106 | – | 7.3 / 5.1 / 6.3 |

Reading:
- Every view re-renders once per delivered frame (570–600 per 8 s), at every n.
- The swarm posts `updateAgents` to its worker once per render (570 / 599 / 599) and submits to the
  GPU every display frame (~1020 per 8 s, 120 Hz) regardless of n.
- The rain's canvas draws 12 k / 22 k / 35 k 2D calls per second, scaling with n; the timeline's DOM
  takes 350 / 460 / 920 mutations per second and its canvas 280–780 calls per second.
- At n=60 the timeline is the one view that drops frames: 102 fps and 20 long animation frames over
  8 s; every other cell held 120 fps with p95 ≤ 10.2 ms.
- A status change reaches the view's render in ~6 ms (the next frame) and its pixels within one
  more frame for the swarm (GPU) and the list (DOM). The rain's canvas follows in ~25 ms and the
  timeline's in 100–300 ms (its canvas repaint cadence), while both update their DOM in ~6 ms.
  The swarm's DOM (its `aria` list) follows ~300 ms behind its pixels.
- Memory grows with n and ACROSS the session: cells run in order n10 → n20 → n60 inside one
  process, so the heap and working-set columns carry the earlier cells' garbage. Read them as an
  upper envelope; a per-cell fresh process would be the clean instrument.

### The A/A null arm, read paired (memory `aa-control-read-paired`)

Both arms were this same build. Per-frame counters (renders, posts, GPU submits) read identical
between arms; fps and frame p50 identical; frame p95 within 0.3 ms. The latency metrics differ by
up to one display frame between arms (|T| ≤ 5.6 ms) — that is the instrument's floor: a mark lands
at an arbitrary phase of the 8.3 ms frame. With R = 3 the MAD is three differences wide, so the
z statistic (|T| / (1.858·MAD/√R)) is unstable and flagged twelve cell × metric pairs at z > 4 that
are inside one frame; **R ≥ 7 rounds before z is read as a verdict**, and a latency effect smaller
than a frame is not resolvable by this instrument. The rain's 2D-call count differed by ~2 % between
arms (animation phase at the mark).

## 4. design-mv §2, confirmed or refuted

| claim | verdict | by |
|---|---|---|
| the renderer redoes `JSON.parse` + zod on every frame | CONFIRMED | §1: 465/465, 1.05 ms of 1.35 at n=60 |
| the damage gate rarely closes | CONFIRMED — it never closed | §1: 465/465 passes at every n |
| every agent object is rebuilt; the ledgers allocate per frame | CONFIRMED | §2: identity changes 465/465; ledgers 573–602 runs |
| the mounted view re-renders on every host render | CONFIRMED | §3: 570–600 renders per 8 s, every view, every n |
| the swarm re-posts every agent to the worker on each `agents` | CONFIRMED | §3: `updateAgents` = renders |
| the usage cache likely writes on almost every frame | CONFIRMED as mechanism, REFUTED on a fresh install | §2: 464/465 seeded, 0 fresh (no `session` in VibeField's readings) |
| the mesh board includes this desktop's own board, built then discarded | CONFIRMED in shape, cheap | §1: mesh frame 0.04–0.20 ms incl. `meshRecords` |
| a full row ≈ 2.5 KB | synthetic rows are 4.8 / 4.1 / 3.6 KB at n=10/20/60 (64-sample rings) | §1 wire / n |
