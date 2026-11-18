# Live pane benchmarks

Build the desktop, its plugins, and the macOS capture helper before running the canvas measurements.

```sh
pnpm --filter @vibefield/desktop build:all
pnpm --filter @vibefield/desktop build:live-surfaces-native
node scripts/benchmark-browser-pane.mjs --mode canvas --panes 1
node scripts/benchmark-browser-pane.mjs --mode native
node scripts/benchmark-browser-pane.mjs --mode canvas --panes 4
node scripts/benchmark-browser-pane.mjs --ui
```

Each run serves the same local WebGL page on a fresh loopback port. The UI check also plays a generated two-second VP9/Opus test pattern in a loop to exercise mute, unmute, and in-pane fullscreen. Browser reports and screenshots go under `.vibefield/browser-perf/`. The summary script reads a run’s report.

The mixed interaction benchmark uses a disposable canvas, two independently created simulator devices, and two local GPU pages. Choose an installed iOS runtime compatible with iPhone 11. The runner installs its UIKit input probe, records per-pane frame rates and tap latency, then shuts down and deletes the devices it created.

```sh
python3 docs/perf/live-panes/interaction/run.py --runtime com.apple.CoreSimulator.SimRuntime.iOS-26-5
```

The media clip can be regenerated from FFmpeg’s built-in pattern and tone generators.

```sh
ffmpeg -f lavfi -i testsrc2=size=128x72:rate=24 -f lavfi -i sine=frequency=220:sample_rate=48000 -t 2 -c:v libvpx-vp9 -b:v 48k -c:a libopus -b:a 12k -filter:a volume=0.1 -map_metadata -1 fixtures/live-panes/clip.webm
```
