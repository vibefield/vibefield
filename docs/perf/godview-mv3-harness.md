# Godview monitor — the MV-3 measurement harness (2026-10-04)

**Status:** built in lane `mv/mv3c` (build-mv M30, M31, M32, M33). Everything here is dormant in the
product: it runs only in the `--godview-perf-lab` mode, whose renderer is loaded with
`godviewPerf=1&godviewReplay=1`. It extends mv0-vf's paired harness
([godview-mv0-baselines.md](godview-mv0-baselines.md)) with the B-side source, the corpus clock, the
window mode, total-work metrics and a capture tool. Numbers stay **reference, never a bound** (L14).

## What A and B measure

- **A** is today's renderer seam: it is fed each corpus's fold frames through the replay door.
- **B** is the window after MV-3b: it is fed each corpus's **model stream**, which is what the
  window's one door (`agent.subscribe {projection: "model"}`) answers for that corpus. The stream
  is computed offline by B's own fieldd code (`perf:godview:model`) on a virtual clock.
  - The lab's player feeds it to the window adapter (`createGodviewMonitorFeed` →
    `instrumentModelClient`), so B measures the renderer only, as A does.
  - With no stream pushed, a start plays the fold source, byte for byte.
- **The corpus clock (M31)** is on by default for both arms while a replay plays: the page's
  `Date.now` reads the corpus's wall time.
  - Without it, today's seam classified every replayed row as stale against the machine's clock,
    while the backend computed recency at the corpus's time.
  - `godview-corpus-clock.test.ts` holds that the seam's recency and the backend's agree under
    the clock and disagree without it.

## The window (M31, M32), proven

- **One mode for every arm and both tools: offscreen.** It uses `webPreferences.offscreen` with its
  own `deviceScaleFactor`. The window is never shown, never focused and never on top, and the
  page's focus is emulated over CDP.
- **The swarm renders with WebGPU there:** `data-swarm-renderer="webgpu"` in every swarm cell of
  every run (the runner's summary prints it per arm).
- **One window per process:** Electron 43 dies when an offscreen window is destroyed and the next
  one opens.
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
  - Per-view rows (renders, commits, posts, latencies) are context.
- **Negative controls** (`VF_GODVIEW_PERF_SYNTHETIC`):
  - `view:<ms>` busy-waits inside every counted view render.
  - `root:<ms>` mounts a side React root of its own that commits once per frame with that much
    render work.
  - In single launches on this tree, both moved the totals by what they cost.
    - `root:2` showed up as its own root (`div.vf-perf-side-root`, 269 commits, 541.6 ms) and
      added +119 to +127 ms/s of task time.
    - So the totals see a separate root's renders, which is the case B will have.

## How to run

```sh
# the paired gate, A/B: B replays its model stream, A the fold corpus; R = 7; builds both first
pnpm perf:godview --a <A checkout> --b <B checkout> [--out <dir>]
# an A that already reads the model (any base after MV-3b) replays ITS model stream too; with
# the default `fold` source its stage would draw nothing (MV-3d's A/B, 2026-10-05)
pnpm perf:godview --a <A checkout> --b <B checkout> --source-a model [--out <dir>]
# A/A on one checkout (the null arm alone); a model-reading build: --source-a model
pnpm perf:godview [--a <checkout>]
# the gate's negative control: B = A's own build + a synthetic load, judged against A′
pnpm perf:godview --synthetic-b view:2
# before/after captures; one checkout = the A/A control (a model-reading A: --source-a model)
pnpm capture:godview [--a <A checkout>] [--b <B checkout>] [--source-a model] [--out <dir>]
```

**The runner** works as follows.

- It builds every distinct root with `VF_REACT_PROFILING=1` (`--no-build` skips that), and
  computes each model-reading root's streams in that root.
- It waits for load < 60 before the first launch (L17).
- Each round launches A, B and A′ in alternating order, one fresh Electron process per launch.
- Every view × n ∈ {10, 20, 60} gets an 8 s cell.
- It reads paired T, MAD and z with A′ − A as the null arm, read the same way.
- The gate verdict is one of: worse, noisy (the null moved), missing (a gate row unreadable) or
  pass. A/A reads `null-ok` or `null-moved`, and its rows read `moved`, never worse.
- Fewer than seven rounds read `unread` whatever the rows say (M24: with fewer, MAD collapses and
  z reads ∞ on a difference of nothing; a two-round smoke read `null-moved` that way).

**The capture tool** works as follows.

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
