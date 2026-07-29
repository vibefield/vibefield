# VibeField iOS

The iPhone/iPad companion. The home screen is the **agent field**: every running
agent a physical bubble (the Beats-Music-lineage swarm, ported from the desktop
godview at `p008/chopsticks/apps/godview`), ranked by how much it needs you.
Tapping a bubble raises its session card; the card's terminal area is the seam
where the Ghosttea Metal surface attaches over Truffle.

Design record: `draft/thinking-ios-app.md` (v1 shape, physics decision,
aesthetic mapping, Ghosttea/Truffle integration plan, slice plan).
The corpus laws that bind this surface: design-00 §3.1 (observe / approve /
attach / artifacts — canvas editing is desktop-only), design-04 §8.6 (one fieldd
connection, whole mesh through it), EL3/EL7 as ever.

## Layout

| Path | What |
|---|---|
| `VibeField.xcodeproj` | thin composition shell — hand-authored pbxproj (objectVersion 56, synthetic IDs, the GhostteaApp convention); no product code |
| `App/` | `@main` + assets + privacy manifest, nothing else |
| `VibeFieldKit/` | the real code, one SPM package, four targets |
| `VibeFieldKit/Sources/FieldDesign` | godview monochrome tokens (palette light+dark, mono type ramp, motion constants, grid/scanlines/vignette) |
| `VibeFieldKit/Sources/SwarmPhysics` | Matter.js-parity solver — pure Swift, no UI imports, seedable, headless-tested |
| `VibeFieldKit/Sources/FieldAgents` | chopsticks-shaped agent model, the ported status classifier, FNV identity hue (cross-language goldens), the scripted mock fleet |
| `VibeFieldKit/Sources/FieldMesh` | the mesh leg (IOS-2): the in-process Truffle/Tailscale runtime via `ghosttea` (exact 0.6.1), login sheet, peer roster, the mesh chip |
| `VibeFieldKit/Sources/FieldHome` | the field: bubbles, ignition, hold-to-create, session card, chrome-slot obstacles, home composition |

Swift 6 (`SWIFT_STRICT_CONCURRENCY = complete`) · iOS **18.1** floor (the pinned
TailscaleKit binary's floor — GhostteaApp's own) · simulator is arm64-only
(matching the Ghosttea native core, which ships no x86_64 slice) · bundle id
`com.jamesyong.vibefield.ios` under the frozen desktop root (`PKG-ID`).

## Build · test · run

This machine's `xcode-select` points at CommandLineTools; every invocation
passes `DEVELOPER_DIR` (the Ghosttea convention):

```sh
cd apps/ios

# build (unsigned, simulator)
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project VibeField.xcodeproj -scheme VibeField \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build

# tests (the package's own scheme; the app scheme builds/launches only)
cd VibeFieldKit && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild test -scheme VibeFieldKit-Package \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'

# run in a simulator
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer sh -c '
  xcrun simctl boot "iPhone 17 Pro" 2>/dev/null;
  xcodebuild -project VibeField.xcodeproj -scheme VibeField \
    -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
    CODE_SIGNING_ALLOWED=NO build &&
  xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/VibeField-*/Build/Products/Debug-iphonesimulator/VibeField.app &&
  xcrun simctl launch booted com.jamesyong.vibefield.ios'
```

Device runs: open the project in Xcode and let automatic signing pick the team
(`DEVELOPMENT_TEAM` is deliberately empty in the pbxproj — inject it at the
command line, the Ghosttea runner pattern).

This app is deliberately **outside `pnpm verify`** (the gate must not require
Xcode); the commands above are its gate until an iOS lane exists in CI.
No Swift formatter is configured — neither Ghosttea nor Truffle carries one;
the de facto style is 2-space / ~100 col (swift-format defaults). Introducing a
checked tool is a deliberate future event, not an inheritance.

## What is real vs honest-missing (v0)

Real: the full-screen bubble field (physics, tiers, ignition, drag, tap-nudge,
hold-to-create, spawn pop, empty state), both themes, the session card with
live status, the mock fleet driving the **same** snapshot shape and classifier
the daemon feed will drive, and — since IOS-2 — the mesh leg: `ghosttea`
pinned `exact: "0.6.1"` (truffle 0.7.11, lockstep with field-native), the
in-process Tailscale runtime behind a deliberate CONNECT act, in-app login
(Safari sheet), the online-peer roster, and the mesh chip the bubbles
physically flow around (`.swarmObstacle()` — the desktop obstacle pattern).
23 headless tests.

Honest-missing (each says so on screen where it shows): the card's terminal is
a placeholder — live attach is IOS-3 (session browse + TSP1 + Metal surface;
also gated desktop-side on the NF-remote leg — field-native's embedded
TerminalService has no mesh coupling yet); approvals render as facts, never
as buttons, until the approvals track lands; the agent feed is still the mock
until fieldd's `agent.*` exists (IOS-4).

Vendor glyph geometry: LobeHub Lobe Icons v5.14.0 (MIT), the set the desktop
godview embeds.
