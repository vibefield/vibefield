# field-screenshot-helper (macOS)

The native half of VibeField's screenshot tool: a `swiftc`-built, ad-hoc signed `.app` that
freezes every display **before** any overlay exists, lets you snap to a window or drag a
rectangle, mark it up (rect · ellipse · arrow · pen · mosaic · undo), and on confirm copies
the still to the clipboard as PNG and TIFF, writes the PNG to the temporary directory, and
prints a result JSON line to stdout. It is a **shell-plane tool** (SNAP-D1): Electron main
prewarms one host-owned process and requests one capture at a time — it is not product truth
and exits when the host closes its command pipe. While idle it has no capture images or
overlay windows and does not request Screen Recording permission. The wire
is versioned and its errors are typed (SNAP-D2), the prototype's host-hiding flag and its
two AppleScript calls are gone (SNAP-D6), and macOS 26's glass chrome is resolved by name at
runtime so the helper compiles against any macOS ≥ 14 SDK (SNAP-D8).

Ported from `research/screenshot2` at SNAP-0. The design record is
`draft/thinking-screenshot-tool.md`; the contract is `packages/contracts/src/screenshot.ts`.

## Flags

| Flag | What it does |
|---|---|
| `--once` | Capture now: overlay, one result line, exit. The CLI default and older-shell fallback. |
| `--service` | Load AppKit, emit `idle`, then wait for a host capture command on stdin. Exit on EOF. |
| `--capture-test` | No overlay. One PNG per display under the temporary directory; `ok` names the first. |
| `--standalone` | Stay running; `Control+Command+A` captures. The developer loop (below). |
| `--help` | The usage text. |

Read the terminal JSON status to determine success. AppKit termination can return 0 even
after an `error` event; the host does not infer capture success from the exit code.

The staged `Info.plist` advertises `VFScreenshotServiceVersion = 1`. The shell checks this
before opting into `--service`: an older helper treated unknown flags as an immediate
capture, so source-code version alone is insufficient. Current helpers refuse unknown flags.

In service mode the host sends `{"v":1,"action":"capture"}` followed by a newline. The
helper captures fresh pixels, shows the overlays, emits `ready` and one terminal result,
tears down all windows/images, then emits `{"v":1,"status":"idle"}` again. A second request
must wait for that acknowledgement. Invalid/oversized commands terminate the helper;
closing stdin also terminates it, including during a capture. No background capture loop
or cached screen images are used. `--standalone` remains the independent developer mode.

## The line protocol (v1)

One JSON object per line, `\n`-terminated, `"v": 1` on every line, `status` the discriminant.
**Stdout carries only these lines** — diagnostics go to stderr, including the standalone
banner. `bounds` is the selection in the display's native screen coordinates (points,
bottom-left origin, display-relative); it is informational, never authority.

```json
{"v":1,"status":"ready"}
{"v":1,"status":"ok","path":"/…/vibefield-screenshot-1757416234567.png","width":1840,"height":960,"scale":2,"displayId":1,"bounds":{"x":120,"y":80,"width":920,"height":480}}
{"v":1,"status":"cancel"}
{"v":1,"status":"error","code":"permission-denied","message":"Screen Recording permission is required"}
```

`ready` is printed once the overlays are on screen; it lifts the host's pre-overlay timer.
It also carries `timings` (`permissionMs`, `windowListMs`, `captureMs`, `overlayMs`, `totalMs`),
measured with the monotonic clock. Electron logs these alongside the time from a capture
request to `ready` and whether the process was already booted, separating capture cost from
process startup.
The error `code` is one of `permission-denied` · `capture-failed` · `no-displays` ·
`write-failed` — typed here, where the knowledge is, rather than guessed from prose by the
host. Unknown fields pass through on the way in (tolerant reader), and the fixtures under
`packages/contracts/fixtures/screenshot-helper-event.*.json` are parsed by zod AND by this
helper's test harness, so the two readers cannot drift (EL9).

## Build, test, verify

From `apps/desktop` (or with `pnpm --filter @vibefield/desktop run <script>` from the root):

```sh
pnpm run build:screenshot-helper    # → apps/desktop/build/native/macos/field-screenshot-helper.app
pnpm run test:screenshot-helper     # the Swift harness, incl. the contract fixtures
pnpm run verify:screenshot-helper   # builds, then a real --capture-test on this machine
```

`test:screenshot-helper` compiles every source but the two entry points, plus
`Tests/ScreenshotHelperTests.swift`, and runs it with `VF_CONTRACT_FIXTURES` pointing at
`packages/contracts/fixtures`. An unset variable or a short fixture directory FAILS the
harness: a silent skip is not a test.

The harness also checks the service command/idle/timing fixtures and reads a short command
from a still-open pipe. The latter is essential: a buffered `FileHandle.read(upToCount:)`
can wait for more bytes or EOF. The command reader uses one bounded POSIX `read` instead.

## The developer loop

`--standalone` keeps the helper alive with a local hotkey, which is the fast way to iterate
on the overlay without a host:

```sh
node packaging/build-screenshot-helper.mjs
./build/native/macos/field-screenshot-helper.app/Contents/MacOS/field-screenshot-helper --standalone
# Control+Command+A captures; Esc cancels; run the inner binary, not `open`, so stdout is visible.
```

## Screen Recording

The capture needs the Screen Recording grant, and consent attributes to the **responsible**
process: when Electron main spawns the helper the grant belongs to the shell (VibeField), not
to this bundle — the same gravity as the ScreenCaptureKit live-surface helper. The bundle
still carries `NSScreenCaptureUsageDescription` for the standalone loop, where the helper IS
the responsible process. Two consequences worth knowing before you debug a re-prompt:

- An ad-hoc signature changes the cdhash on every rebuild, so a development helper may ask
  again after `build:screenshot-helper`. Release identity (WP10) ends that.
- The alert names no row in System Settings. Which app appears there depends on who spawned
  the helper, and claiming otherwise would be a guess.

## DESIGN.md tokens

`Theme.swift` holds exactly the values the overlay READS — every one a token from
`DESIGN.md`, named in its comment so a reviewer can check the number against its source.
What the overlay wears from the design doc, honestly stated:

| `Theme` | Token | Where it is drawn |
|---|---|---|
| `select` | `--vf-select` `#4A90D9` (§2.5) | the selection ring, the window-snap ring, the loupe's center box — never status |
| `mark` | `--vf-red` `#FF453A` (§2.5) | every mark (rect · ellipse · arrow · pen); markup is content, not chrome |
| `dim` | §5 backdrop dim, dark (`black/40`) | the freeze under the overlay — a covered stage |
| `handleFill` | opaque white | the eight resize handles on the dimmed freeze |
| `ringWidth` | §2.3 `1.5px` | weight as meaning: the ring and the rim, nothing else |

The chrome — the toolbar island, the loupe card, the size badge — takes NO color from
`Theme`: it is the Liquid Glass / visual-effect material (SNAP-D8) with AppKit's semantic
colors (`labelColor`, `separatorColor`, `systemRed` on the cancel button), which is what keeps
it legible over any freeze in either appearance. The prototype carried eight further
`Theme` members (card surface, text ramp, hairline, radii) that nothing read; they were
removed at SNAP-0 rather than left as a claim the overlay did not keep.

New visual constants go into `DESIGN.md` first, then into this file — never the other way
around, and never without a reader.
