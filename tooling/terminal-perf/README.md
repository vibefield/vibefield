# Terminal performance measurements

Run benchmarks serially on the same machine. Keep raw results, failed runs, host load, source
identity and the unchanged control beside any claim. The governing methodology is
`draft/specs/terminal-pipeline-v3-performance.md` §§18–19; results belong under
`draft/terminal-perf/results/`. Small samples provide descriptive tails, not a tail guarantee.

## Command–D to usable shell (macOS)

```sh
VF_PERF_STARTUP_SAMPLES=20 pnpm perf:terminal startup \
  --duration 4 --rotations 1 --probe-keys 0 \
  --out draft/terminal-perf/results/20260928-startup-example
```

The driver builds the shipping renderer and Electron lab, then creates an isolated daemon pair,
profile and shell. It uses a window-local Command–D chord and the real terminal paste/key handlers.
Each new pane must execute one `printf` command and write an unpredictable acknowledgment file.
There is one input attempt; a lost command or timeout fails the run. No OS input or clipboard is
changed. Owner dotfiles and native agents are excluded from this shell benchmark.

`startup.json` separates pane DOM visibility, the routed transport's `inputAllowed` state, and shell
execution acknowledgment. Ready-pane commands bracket every split as host/instrument controls.
The directory watcher is registered once, outside all timed rounds; a 10 ms polling fallback and
main/renderer IPC remain part of the measurement. These are neither physical key-to-photon times
nor the startup time of a user's shell configuration. `GODVIEW_COLD_OPEN` is a separate first-frame
trace and must not be called input readiness.

The first acknowledged anchor command is setup, outside the samples. Every measured split is closed
before the next one. The command endpoint includes any remaining shell initialization after transport
attachment. `source.json` fingerprints the actual built bundles, renderer files, native executables,
sibling lock, HEAD and tracked diff, including when `--no-build` is used. `host.json`, `lab.jsonl`,
`report.json` and nonce files retain the rest of the evidence. Existing nonempty output directories
are refused; default names include a UTC time so runs do not overwrite each other.

## Input and renderer path

The pane lifecycle/geometry regression uses the same isolated Electron host:

```sh
pnpm perf:terminal pane-regression --duration 2 --rotations 1 --probe-keys 0 \
  --out draft/terminal-perf/results/20260928-pane-example
```

It waits for the startup overlay to retire, replaces the initial untouched shell, then creates
three panes and closes an unused shell. Each checks monitor removal and eventual native exit. It checks equal surviving widths,
fullscreen on an empty shell, retention of a used session, and eight monitor attachment switches.
Finally it replaces an untouched split by selecting an unlinked bubble, checking immediate
monitor cleanup and eventual native exit while the pane remains.
`pane-regression.json` records each animation frame's canvas identity and bitmap/display sizes,
plus ResizeObserver deliveries. Fullscreen must keep the content fixed during motion and resize
once at settlement; each attachment must reach input readiness. PNGs capture moving and settled
states. These are layout and lifecycle witnesses, not physical display latency measurements.

```sh
pnpm perf:terminal echo-probe --duration 24 --rotations 3 --probe-keys 30 \
  --ab metrics,off --out draft/terminal-perf/results/20260928-echo-example
```

Fixture setup waits for the terminal transport to accept input, then pastes the fixture command
through the shipping handler. Probe injection is window-local unless explicitly selecting the
separately gated native-control mode. Read the endpoint qualification in `RESULTS.md`; a renderer
frame callback is not a physical presentation timestamp. For output load, use the existing deck
scenarios and generator fixtures. The production build excludes this lab instrumentation.

## Native agent startup

Puppeteer owns provider-specific startup and exports shared cache prewarming to its Godview and
VibeField. Its native benchmark and interpretation rules live in
[`spawn-through-hosts.md`](../../../puppeteer/docs/guides/spawn-through-hosts.md) §9, “Measuring startup”
(in the sibling checkout). Run it from that repository. It interleaves baseline/current/unchanged
control, records protocol spans and source hashes, and archives the empty native threads it creates.
That benchmark measures adapter preparation, not typing a command through VibeField or first TUI paint.

A clean-shell result cannot explain away slow owner dotfiles; an adapter result cannot stand in for
the whole gateway/TUI path. Compare these stages separately before choosing what to optimize.

## Cleanup

The lab records PID **and process start time** while its owned parents are alive. Teardown stops its
daemon pair, checks those recorded identities and counts PTYs. Existing apps from the same checkout
are host context, never cleanup targets. The fallback reaper also checks executable location and
revalidates identity before signaling:

```sh
pnpm perf:terminal --reap --owned /absolute/path/to/run/owned-processes.json
```

Without an ownership snapshot cleanup is unverified; the driver does not kill unrecorded processes.
A snapshot cannot identify a descendant created after the last capture if all its parents then crash.
Keep the cleanup outcome in any published result instead of inferring ownership from a system-wide
PTY count. Never run multiple labs concurrently in one checkout: they share build outputs and would
also contaminate one another's load measurements.
