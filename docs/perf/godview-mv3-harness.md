# Godview monitor — the MV-3 measurement harness (2026-10-04)

**Status:** built in lane `mv/mv3c` (build-mv M30, M31, M32, M33). Everything here is dormant in the
product: it runs only in the `--godview-perf-lab` mode, whose renderer is loaded with
`godviewPerf=1&godviewReplay=1`. It extends mv0-vf's paired harness
([godview-mv0-baselines.md](godview-mv0-baselines.md)) with the B-side source, the corpus clock, the
window mode, total-work metrics and a capture tool. Numbers stay **reference, never a bound** (L14).

**MV-8 update:** current players accept model streams only, and both runners default every arm to
`model`. Pre-MV comparisons use `--source-a fold` against the old checkout. The live recorder,
fold replay door, differential oracle test and legacy view counters have retired. Offline corpus
inputs and model generation, the model player, all-root/CDP/frame/DOM/canvas probes, and paired
and capture readers remain. The dated results below remain evidence of their original SHAs.

**Measurement erratum (2026-10-06, build-mv M137–M139):** two historical control targets had
`field-native` but lacked `field-terminal-host`. Their monitors could replay while the terminal
deck stayed empty, omitting real host work from whole-window measurements. Building the missing
cell at the MV-4 control's exact source revision restored a healthy deck without changing its
existing `field-native` bytes. Both runners now require complete native artifacts and healthy
one-pane proof from every arm. Historical measurements remain archived; they do not establish
this workload qualification. New comparisons must use the same readiness instrumentation in
historical testing bundles and record those adaptations; old reports without proof are refused.

**Replay-input erratum (2026-10-06, build-mv M147):** restoring the real deck exposed
another mismatch: the historical fold monitor added its live bare shell, while the model
stream contained only corpus sessions. A capture reported 26 versus 25 sessions despite
passing the pixel tolerance. Numerical passes under that protocol do not qualify the final
comparison. The replay player now publishes the corpus pane header to the monitor at the
overlay boundary, including managed PTY joins and the active session. The physical deck
keeps its own healthy terminal. Outside explicit replay, the live pane object passes through
unchanged. Chunked corpus loads retain pane facts until another header or clear.

Every cell and capture records bounded monitor membership (total, shown, local agents,
local terminals, remote sessions and remote hosts, plus the selected view). Both runners
reject absent or malformed proof, different counts and missing/reordered scenarios before
grading. Readout remains outside measured intervals. Historical arms need the same lab
fixture and readout adaptation, with source patches and generated artifacts archived and
restored; product views and backend logic stay at their pins. Corrected and old-input runs
are separate protocols and must not be pooled.

**Chromium-profile erratum (2026-10-06, build-mv M155):** fresh Electron processes
previously shared Chromium's `userData` and `sessionData`, including persistent caches.
Isolated daemon roots and clearing localStorage did not isolate these paths. Each launcher
now owns a fresh temporary `--user-data-dir`, verifies the effective app and window-session
paths, and removes only its own profile after the process and output pipes close, including
failed launches. Reports carry `profile: {kind: "isolated-chromium-v1", id}`; the ID is an
opaque hash of the canonical path. Runners reject missing/mismatched proof and reused IDs
before grading. Historical testing bundles need the same proof instrumentation. The worker
lifecycle probe uses one profile per process, shared by its intentionally concurrent windows.

**Lab-debts update (2026-10-11, lane `mv/lab-debts`):** debts of the instrument itself, each a
change of METHOD. An A/B pair must run the same lab in both arms, so a pair takes its A arm
from main after these, and a cohort measured before them is not pooled with one measured after
(the pooled reader compares the summaries' `instruments`, which now carry what each arm's lab
did around its cells).

- **The warm-up replays through every measured view.** Until here one short corpus replayed
  through the default view only, so every other view first mounted — its chunk, its root, its
  canvas — inside its own first measured cell. The warm corpus now replays once through each
  view of the run, in the run's order, each entered as a cell enters it (selected, settled,
  replayed), and ends as a recipe's last cell ends: stopped on the last view, settled. It costs
  ~15 s a launch with the four views where the one-view warm-up took ~3 s.
  `VF_GODVIEW_PERF_WARMUP=0` still skips it. Each report carries `warmedViews`; the `warmed`
  line, the summary's `instruments` and its header name them per arm, and the header says so
  when the arms did not warm the same views.
- **The wait for the deck says what it saw.** A launch whose deck never came ready failed with a
  bare "timed out after 60000ms waiting for the terminal deck…" (one was lost so on 2026-10-10).
  The error now carries the last `GODVIEW_DECK` state read — JSON, the readiness facts first,
  at most 600 characters — and the readiness conditions that state still lacked, or that no
  marker came at all. The runners echo a `failed` line up to 1,200 characters (other lab lines
  stay clipped at 160), so the reason reaches the run's own log. Perf and capture share the wait.
- **The proof audit reads the load at each launch's end.** It printed only `loadRange`, the
  runner's reading BEFORE each launch, and a launch that starts under the ceiling can end far
  over it (0e020306's A r5: 12 before, 108 as it ended). Its account now also carries
  `endLoadRange` (each report's own `loadavg[0]` as its launch ended), the `quietLine` and whose
  it is, and `endedOverQuiet` — every launch that ended over the line, with arm, round, start and
  end load — and it prints one plain line per such launch. The quiet line is `--quiet <n>` when
  given, else the run's own `--load-max` (the runner now records it as `summary.loadMax`), else
  15. It names; it does not refuse: the exit code and the verdict are as they were.
- **The heap row is read after a collection.** `js heap MB` was the probe's
  `performance.memory.usedJSHeapSize` at whatever phase the collector was in: on 2026-10-11 one
  read `worse` while the same build against itself ran from −26 to +20 MB. The lab now forces a
  full collection (CDP `HeapProfiler.collectGarbage`) once the cell's window has closed — the CDP
  totals and the probe's report are read first, so the pause is in no task, script, frame or LoAF
  row — and reads the page's heap again. Each cell carries `heap: {collected, usedJSHeapSize,
  totalJSHeapSize}`; `report.memory` stays the probe's own uncollected reading. A collection that
  cannot be forced never fails a launch: the cell keeps the probe's reading with `collected:
  false`. The summary counts collected cells per arm (`heapCollected`) and its header says so.
  The warm-up ends on a collection too, so every measured cell starts from a collected heap:
  that changes what the cells' own collector does inside their windows, in every arm alike.
The ordinary `pnpm smoke:godview` and `pnpm smoke:terminal-direct` runners also own fresh
profiles and verify the app and window paths before navigation. After building, use
`node scripts/smoke-godview.mjs` for the same smoke without rebuilding; direct Electron
invocations must supply an isolated `--user-data-dir`. The runner removes its directory
only after the Electron child and its output pipes close.
Direct lab invocations must supply their own fresh absolute directory and clean it up after
Electron closes; prefer the launchers, which own that lifecycle.

A shared profile is a confirmed isolation gap, **not a demonstrated cause** of the recorded
control offset. Earlier cohorts remain archived with their original verdicts. Fresh-profile
measurements form a separate protocol; do not pool them with shared-profile runs or change
the workload, warm-up, ordering, estimator or acceptance thresholds.

## What A and B measure

- **A and B** each receive their checkout's model stream: the answer to the window's one
  `agent.subscribe {projection: "model"}` door. Each checkout's own fieldd backend computes that
  stream offline (`perf:godview:model`), so the measurement covers the renderer only.
- **A pre-MV-3b arm** receives fold frames through that checkout's own player when explicitly
  selected. Current players refuse a missing/mismatched model stream or a start with no model
  listener; they cannot silently measure the retired fold path.
- **The corpus clock (M31)** defaults on for both arms: the page's `Date.now` reads the corpus's
  wall time. Old A seams classify recency at that time; current model streams already contain
  the backend's recency. `godview-corpus-clock.test.ts` proves timed model delivery, fixed-frame
  capture cuts and restoring the real clock after playback.

## The window (M31, M32), proven

- **One mode for every arm and both tools: offscreen.** It uses `webPreferences.offscreen` with its
  own `deviceScaleFactor`. The window is never shown, never focused and never on top, and the
  page's focus is emulated over CDP.
- **The swarm renderer is reported by the view** through SDK commands; the host mirrors that
  report on its own slot. The runner prints `webgpu` for each swarm cell.
- **The real terminal deck is ready before replay starts.** The lab waits for an active deck,
  an open pool, an observed roster and a WebGPU terminal renderer before installing the corpus
  clock. Every measured cell records exactly one pane and one session at both boundaries;
  every capture records the same proof. Missing, faulted or unequal workloads fail the run.
  Readiness checks and proof reads sit outside the measured interval. This workload contract
  applies to performance and capture; the separate worker lifecycle probe checks worker
  readiness across multiple window realms.
- **One window per process in measurements:** MV-0 observed an Electron 43 crash after destroying
  an offscreen window and opening another. The dedicated worker-window probe now exercises that
  lifecycle separately; each slice's logs carry its result.
- **Offscreen draws at 60 fps.** Asked for 120, `getFrameRate()` answered 120 and frames still
  landed every 16.7 ms, so 60 is the default.
  - Frame p50 is therefore pinned. Read rAF work, delivery work, LoAF and, above all, the totals.

## Total work (M33)

MV-2's run was blind to a view in its own React root (`/host`'s legacy bridge) and to work the
frame scheduler moved into rAF. Every cell now carries two totals.

- **Every React root's commits and render time.** A minimal React DevTools global hook is evaluated
  before any page script (`Page.enable`, then `Page.addScriptToEvaluateOnNewDocument`).
  - React calls it on every commit of every root. It keeps the summed `actualDuration` of each
    committed root, labelled by the root's container.
  - `actualDuration` exists only in React's profiling build. `VF_REACT_PROFILING=1` at build time
    aliases `react-dom/client` → `react-dom/profiling`, and nx.json hashes the variable.
  - The runner builds every arm that way. An untimed run says so (`missing`), never `pass`.
- **Chromium's main-thread totals per second.** These are CDP `Performance.getMetrics` (task,
  script, layout, recalc style), sampled at the cell's start and end.
- **The gate reads these totals (M40's rule).**
  - The decisive rows are main-thread task ms/s, every root's render ms/s, frame p50 and the LoAF
    rows.
  - A component of the task total (script, layout, recalc style) gates only when it is material:
    B − A of at least 1 ms/s, besides z > 4 and T > 2 %.
  - A component that rises while its cell's task total falls reads `shifted`. It is named, never
    a failure.
  - Per-view rows in historical reports are context. Retired counters are unknown when absent,
    never fabricated zeroes; all-root and CDP totals remain the gate.
  - A z on a mark→ row is no evidence. Each launch gives such a row ONE sample (the cell's one
    status flip), and its latency is a phase lottery: at rain it falls anywhere in one draw
    period (0–33 ms) in every arm. Half the paired differences can sit near one period, so the
    median lands there and the MAD stays small. mv8b-vf's R7 read rain n60 mark→draw2d +19.6 ms
    at z 7.5, its repeat −7.5 ms, and its own rain n10 B earlier (M185). Read the per-launch
    values before reading anything into a mark→ row.
- **Negative control** (`VF_GODVIEW_PERF_SYNTHETIC=root:<ms>`): a separate React root commits
  once per frame with that much render work. The totals include it. The retired `view:<ms>`
  control now rejects clearly, as do invalid or zero loads.
  - In the original single-launch proof, `root:2` appeared as `div.vf-perf-side-root`
    (269 commits, 541.6 ms) and added +119 to +127 ms/s of task time.

## How to run

```sh
# paired model gate, R = 7; builds both arms first
pnpm perf:godview --a <A checkout> --b <B checkout> [--out <dir>]
# historical A before MV-3b, using its own fold player
pnpm perf:godview --a <pre-MV checkout> --b <B checkout> --source-a fold [--out <dir>]
# A/A on a current checkout (the null arm alone)
pnpm perf:godview [--a <checkout>]
# B = A's own build plus a separate root's work, judged against A′
pnpm perf:godview --synthetic-b root:2
# captures: one current checkout = A/A; choose --source-a fold only for an old A
pnpm capture:godview [--a <A checkout>] [--b <B checkout>] [--out <dir>]
# the proof audit: a run measured what it says, read off its files before any grade (MV-8b)
node scripts/perf-godview-proof.mjs <run dir> [--quiet <n>]
# a NOISY R7's one repeat: the fresh R7 AND every sample pooled (R14) must pass (M155)
node scripts/perf-godview-pool.mjs <first run dir> <repeat run dir> [--out <file>]
```

**The runner** works as follows.

- It builds both `field-native` and `field-terminal-host` from every distinct root with
  `cargo build --locked -p field-native --bins`, placing them in that root's `target/debug`,
  then builds the desktop with `VF_REACT_PROFILING=1`. Each launch explicitly selects that
  root's fieldd and native executables. It computes each model-reading root's streams there.
- `--no-build` skips building, but still checks the readable JS hosts and both executable
  native files. Neither a JS-only desktop build nor a lone `field-native` is a complete arm.
- It waits below the configured load ceiling before every arm launch (`--load-max`, default
  60; the final quiet qualification uses 8) and records launch load (L17, M107).
- It rejects any arm report lacking healthy one-pane proof at either end of any cell. This
  includes historical testing bundles that have not received equivalent readiness checks.
- Each round launches A, B and A′ in alternating order, one fresh Electron process and
  Chromium profile per launch, with effective-path proof and no profile reuse.
- Every view × n ∈ {10, 20, 60} gets an 8 s cell.
- It reads paired T, MAD and z with A′ − A as the null arm, read the same way.
- A row reads `worse` or `better` by M40's text: z > 4 and T past 2 % of A for the totals and
  the components, the components also ≥ 1 ms/s; the frame and LoAF rows keep their instrument
  floors. There is no null envelope (MV-8b, M177, 2026-10-07): the null arm makes a row `noisy`
  only when it clears that same rule itself. Until then a row also had to clear |T₀| + 2·MAD₀,
  and M107's two M40-literal reds passed inside it.
- The gate verdict is one of: worse, noisy (the null moved), missing (a gate row unreadable) or
  pass. A/A reads `null-ok` or `null-moved`, and its rows read `moved`, never worse.
- Fewer than seven rounds read `unread` whatever the rows say (M24: with fewer, MAD collapses and
  z reads ∞ on a difference of nothing; a two-round smoke read `null-moved` that way).

**The proof audit** (`scripts/perf-godview-proof.mjs`) refuses a run, in every problem's own
words, unless: the summary completed and judged; every declared arm × round has its report,
ended, metered, hooked, from its own Chromium profile; every report holds every view × recipe
once, the summary's cells in order; each cell's replay ended having delivered something through
its arm's source (model: model frames and one model listener, no fold or mesh; fold: one fold
and one mesh listener); React timed and the view's own root committing (`mv-<view>`, or the host
root for a fold arm); WebGPU under the swarm; the deck's one healthy pane at both ends; and the
monitor's membership equal to the corpus the recipe declares (field-app's corpus test holds that
copy). It is instrument validation, never a grade.

**The pooled reader** (`scripts/perf-godview-pool.mjs`) takes a NOISY cohort and its one
complete repeat. It reproduces each cohort's summary row for row from its reports with today's
estimator, refuses unlike cohorts (arms, window, clock, warm-up, instruments, recipes, views,
cells, membership) and any profile reused across both, then judges all fourteen paired rounds.
It exits 0 only when the repeat passes fresh AND the pool passes.

**The capture tool** works as follows.

- It uses the same complete builds, arm-specific executables and deck readiness checks.
  Every capture must report healthy one-pane proof before its pixels can be compared.
- **What it captures:** each theme × view × fixed frame of a replayed corpus.
  - The page's `Date.now` is frozen at that frame's corpus wall.
  - The timezone is UTC and the locale en-US (over CDP).
  - Ambient animations are off and reduced motion is emulated.
- **How:** it uses the compositor (`capturePage`, which draws the WebGPU swarm). The capture is
  the monitor's region: the instrument bar, the stage and the view.
- **The A/A control** is A captured twice.
  - A pixel differs past 24/255 on any channel.
  - A capture differs past 0.1 % of its pixels.
  - A capture whose own A/A already exceeds that differs only past twice its A/A share
    (`same-within-aa`).
- **Sanity row:** each view's dark and light captures must differ.
- **Exit 1** on a blank, missing or mis-sized capture, or a blind sanity row.

## Proven on this tree (A = vf `mv/land` 83db0728 + this lane)

### The gate's negative control, with its A/A arm

Command: `pnpm perf:godview --synthetic-b view:2`, R = 7, 21 launches, offscreen, the profiling build.
The load average at launches ran from 9 to 343. Raw files are in
[godview-mv3/](godview-mv3/negative-control-view2-2026-10-04.md).

- **The gate read WORSE in all 12 cells**, on task, script and React render time.
- **The null arm A′ − A** read z₀ ≤ 2.0 on task, script and React render in every cell.
  - Layout and style reached z₀ 4.5 on values around 1 ms/s, below their 2 ms/s floor.
- **Each cell's renders were identical across arms.** A 2 ms wait in each of ~65 renders/s
  predicts +130 ms/s.

| cell | task ms/s A → B | T | z | T₀ (z₀) | React render ms/s A → B | T | T₀ (z₀) | renders |
|---|---|---|---|---|---|---|---|---|
| swarm × n10 | 183 → 312 | +128 | 30.9 | −1.3 (0.4) | 35 → 167 | +132 | −0.0 (0.0) | 571 |
| list × n10 | 118 → 246 | +124 | 66.6 | −0.1 (0.0) | 36 → 166 | +130 | +0.5 (0.4) | 570 |
| rain × n10 | 150 → 278 | +129 | 139.3 | −2.2 (0.3) | 31 → 163 | +132 | −0.8 (0.7) | 570 |
| timeline × n10 | 152 → 281 | +128 | 40.6 | +3.6 (1.1) | 38 → 170 | +132 | +0.4 (0.5) | 570 |
| swarm × n20 | 236 → 370 | +133 | 27.1 | +0.7 (0.1) | 40 → 178 | +139 | +0.1 (0.0) | 599 |
| list × n20 | 147 → 282 | +128 | 31.9 | −7.5 (1.4) | 46 → 183 | +136 | −2.5 (1.2) | 600 |
| rain × n20 | 186 → 330 | +144 | 33.5 | +4.8 (1.4) | 37 → 178 | +140 | +0.8 (0.5) | 599 |
| timeline × n20 | 183 → 329 | +140 | 19.3 | −4.0 (0.4) | 50 → 191 | +139 | −0.6 (0.3) | 599 |
| swarm × n60 | 456 → 616 | +144 | 28.9 | +8.9 (0.9) | 65 → 209 | +140 | +1.6 (0.6) | 599 |
| list × n60 | 256 → 414 | +158 | 100.1 | −2.5 (1.0) | 82 → 226 | +144 | −0.9 (0.5) | 599 |
| rain × n60 | 280 → 430 | +149 | 35.6 | +1.3 (0.4) | 63 → 204 | +141 | −0.4 (0.3) | 599 |
| timeline × n60 | 302 → 452 | +147 | 7.8 | −8.3 (1.4) | 94 → 237 | +141 | −3.8 (2.0) | 599 |

### The capture tool's A/A control

The results are in [godview-mv3/captures-aa-2026-10-04.md](godview-mv3/captures-aa-2026-10-04.md).

- **List and timeline are pixel-identical** across two launches, in both themes and at both
  frames (0.000 %).
- **The swarm and the rain do not draw the same pixels twice**, and the tool says so (`unstable`).
  - The swarm's physics runs in a worker with unseeded randomness.
  - The rain animates on its own clock.
  - Their A/B is judged only past twice their A/A share.
- **Sanity:** every view's theme flip is seen.
- **The A/B path, exercised:** B was this same build reached through another path (`--b <alias>
  --source-b fold`). List and timeline read `same` (0.000 %), and the swarm and the rain read
  `same-within-aa`. The swarm's A/A of 30–40 % means its pixels can flag only a gross change;
  MV-5's goldens are its witness.
- **The first trial** captured the whole window. Its list and timeline A/A differed by 0.1 %: the
  deck's blinking terminal cursor and the composer's animated avatar. Hence the monitor region.

## Findings

- **The Page domain must be on before the hook is registered.** A script registered over CDP
  without `Page.enable` never ran in the product's document. The trial read the hook as
  registered and absent from the page.
- **Offscreen draws at 60 fps here** whatever `setFrameRate` says.
- **`capturePage` returns the display's scale.** At offscreen scale 1 the page reported
  `devicePixelRatio` 1 and the capture came back 2×. The capture tool therefore defaults to
  scale 2, as the perf runner does.
- **The swarm cannot get pixel goldens in the real app** until its physics randomness is seeded.
  mv0-pu's SwarmFrame goldens (puppeteer labs, inline physics) remain the swarm's exact witness
  (MV-5).
