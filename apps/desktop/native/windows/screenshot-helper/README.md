# field-screenshot-helper (Windows)

VibeField's native screenshot helper for Windows: a hotkey freezes every display
**before** any overlay exists, the user snaps to a window or drags a rectangle,
marks it up, and Enter copies the PNG (plus `CF_DIB` / `CF_DIBV5`) to the clipboard
and prints ONE JSON line to stdout. Electron main starts it, reads that line, and
the process exits.

The macOS half (`apps/desktop/native/macos/screenshot-helper`, Swift) is the same
product against ScreenCaptureKit and speaks the same protocol. The host library is
`@vibefield/screenshot`; the wire truth is `packages/contracts/src/screenshot.ts`.

Ported from the `research/screenshot2` prototype. What the port changed, and why:

- **SNAP-D1** — a shell-plane tool: contract in `contracts`, mechanism in a
  Node-only library, composition in `electron-shell`. This crate is the mechanism's
  Windows half and knows nothing about any of them.
- **SNAP-D2** — the line protocol is versioned (`"v": 1`) and its errors are typed
  (`code` + `message`, where the prototype had free-text `error`). The
  classification lives where the knowledge is: `monitors::enumerate` knows an empty
  enumeration is `no-displays`, `capture` knows a refusal from
  `GraphicsCaptureAccess` is `permission-denied`, `main` knows a failed temp write
  is `write-failed`.
- **SNAP-D6** — the prototype's host-hiding flag is gone. It hid the host through
  AppleScript on the Mac side and was accepted-and-ignored here for symmetry;
  nothing hides anything now. If a consumer ever wants the shell out of the shot,
  Electron main hides its own windows.
- **SNAP-D7** — this crate is its OWN Cargo workspace root (the empty `[workspace]`
  in `Cargo.toml`; the repo root manifest `exclude`s the path). The repo's root
  workspace is the mac gate and cannot build Win32-only code.
- **SNAP-D9** — names: the binary is `field-screenshot-helper.exe`, the manifest
  identity `com.jamesyong.vibefield.screenshot-helper`, the overlay window class
  `VibeFieldScreenshotOverlay`, and stills are `vibefield-screenshot-<millis>.png`.

## Flags

| Flag | Behaviour |
|---|---|
| `--once` (default) | Capture-then-freeze overlay; `ready` on stdout, then `ok` / `cancel` |
| `--capture-test` | No overlay: a PNG per display under `%TEMP%`, `ok` names the first |
| `--standalone` | Stay running; `Alt+A` starts a capture (the dev loop) |
| `--overlay-smoke [cancel\|snap]` | Auto-confirm 200×120, cancel, or snap to the frontmost real window (CI) |
| `--help` | Usage |

Exit code is 0 after `ok`/`cancel` and 1 after `error`.

## The protocol (v1)

One JSON object per stdout line, `\n`-terminated, lowerCamel keys, `"v": 1` on
every line, `status` the discriminant. **Stdout carries ONLY these lines** — every
diagnostic, including the `--standalone` banner, goes to stderr, because a non-JSON
stdout line is a protocol violation the host kills the helper for.

```json
{"v":1,"status":"ready"}
{"v":1,"status":"ok","path":"/…/vibefield-screenshot-1757416234567.png","width":1840,"height":960,"scale":2,"displayId":1,"bounds":{"x":120,"y":80,"width":920,"height":480}}
{"v":1,"status":"cancel"}
{"v":1,"status":"error","code":"permission-denied","message":"Screen Recording permission is required"}
```

`ready` is printed once the overlays are on screen; it lifts the host's 20 s
pre-overlay timer. On Windows `width`/`height` are PNG pixels, `scale` is the
monitor's effective DPI ÷ 96, `displayId` is the number parsed out of
`\\.\DISPLAYN` (else 1-based enumeration order), and `bounds` is the monitor's
`rcMonitor` in virtual-screen **physical** pixels — an origin may be negative.
`bounds` is informational, never authority.

The four error codes and where they come from:

| Code | Emitted when |
|---|---|
| `permission-denied` | `GraphicsCaptureAccess` answered `DeniedBySystem`/`DeniedByUser` **and** no live still came back |
| `capture-failed` | WGC, DXGI and GDI all failed; the overlay could not run; no snapshots; `--standalone` could not register `Alt+A` |
| `no-displays` | `EnumDisplayMonitors` returned an empty list |
| `write-failed` | the still could not be encoded for, or written to, `%TEMP%` |

The fixtures under `packages/contracts/fixtures/screenshot-helper-event.*.json` are
the seam: zod parses them, the Swift harness parses them, and
`protocol::tests::contract_fixtures_decode` parses them. EL9 in three languages.

Unknown fields are ignored on decode and additive fields are free — the tolerant
reader. A missing `v` is NOT tolerated: a v0 line fails loudly.

## Capture and overlay

1. `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` plus the embedded
   `app.manifest` (PerMonitorV2). All geometry is physical pixels.
2. Snapshot the monitor list (`EnumDisplayMonitors` + `GetMonitorInfoW` +
   `GetDpiForMonitor`).
3. Per monitor: **Windows.Graphics.Capture** `CreateForMonitor` (one frame, cursor
   off, 3 s cap) → **DXGI Desktop Duplication**, but only if that output's
   `DesktopCoordinates` match this `rcMonitor` → **GDI `BitBlt`** from this
   monitor's device DC. Never blit the virtual-screen origin as a stand-in. The
   whole `capture_all_displays` budget is 12 s, so the host's 20 s pre-overlay
   timer still sees `ready`.
4. Encode packed BGRA → PNG. No overlay window exists yet.
5. If all three fail (a virtual `WinDisc` adapter, a locked session) a helper-owned
   synthetic still is used **only** for `--capture-test` / `--overlay-smoke`.
   `--once` and `--standalone` emit `error` and copy nothing.

WGC is the ScreenCaptureKit analog; GDI is the `CGDisplayCreateImage` analog; DXGI
is a same-monitor fallback, not a walk of every output.

The overlay is one borderless `WS_EX_TOPMOST` window per monitor, painted with the
frozen bitmap under a 40% dim. Hover highlights the frontmost real window (the
window list is snapped BEFORE any overlay exists); a drag makes a rectangle that can
be moved, nudged and handled; a 21× loupe reports POS / RGB / HEX with `1` / `2` /
`3` to copy them; after a selection the toolbar offers rectangle, ellipse, arrow,
pen, mosaic, undo (`Ctrl+Z`) and save (`Ctrl+S`). Marks apply only inside the
selection and are composited into the crop on confirm. Enter or double-click
confirms; Esc or a right-button **up** cancels. Window snap skips the helper's own
PID, cloaked windows, `WS_EX_TOOLWINDOW`, frames ≤ 8 px, and windows covering more
than 98% of a display; frames come from `DWMWA_EXTENDED_FRAME_BOUNDS`.

The helper is a **console-subsystem** exe so a terminal can see the JSON — every
spawn must therefore pass `windowsHide: true` or a console flashes.

It is **unpackaged, and stays that way**: Win11's "Screenshots and screen recording"
toggle is a packaged-app (MSIX) concept, and the capability this helper needs is the
one the responsible process already has.

## Build

```sh
cargo build --release   # here, on Windows → target/release/field-screenshot-helper.exe
pnpm --filter @vibefield/desktop run build:screenshot-helper   # builds AND stages it
```

`packaging/build-screenshot-helper.mjs` asks `cargo metadata` where this crate's
target directory is (it is its own workspace, so it need not be `./target`) and
copies the exe to `apps/desktop/build/native/windows/field-screenshot-helper.exe`,
which the stager and the `binaries:` inventory read. The helper is OPTIONAL (SNAP-D5): a
packaged app boots without it and the door answers `helper-missing`.

## Gates

On the Windows box (SNAP-4, owed):

```sh
cargo test
cargo clippy --all-targets -- -D warnings
cargo run --release -- --overlay-smoke cancel
cargo run --release -- --overlay-smoke snap
```

From ANY host — this is the witness that exists between box rounds:

```sh
cargo fmt --check
cargo check  --target x86_64-pc-windows-msvc
cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

The cross-target checks work because `build.rs` embeds the manifest only when the
HOST is Windows too — winres shells out to `rc.exe`, which a Mac does not have. A
cross-built binary would carry no manifest; only the box build produces a shippable
exe.

## Later

Mixed-DPI polish; text, highlight and numbered-callout marks; a signed nested
bundle (WP10). Never put a live transparent overlay up before the still exists.
