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
| `VibeField.xcodeproj` | thin composition shell — hand-authored pbxproj (synthetic IDs, the GhostteaApp convention; objectVersion 60 since Xcode touched it); no product code |
| `App/` | `@main` + assets + privacy manifest, nothing else |
| `VibeFieldKit/` | the real code, one SPM package, four targets |
| `VibeFieldKit/Sources/FieldDesign` | godview monochrome tokens (palette light+dark, mono type ramp, motion constants, grid/scanlines/vignette) |
| `VibeFieldKit/Sources/SwarmPhysics` | Matter.js-parity solver — pure Swift, no UI imports, seedable, headless-tested |
| `VibeFieldKit/Sources/FieldAgents` | chopsticks-shaped agent model, the ported status classifier, FNV identity hue (cross-language goldens), the scripted mock fleet |
| `VibeFieldKit/Sources/FieldMesh` | the mesh leg (IOS-2): the in-process Truffle/Tailscale runtime via `ghosttea` (exact 0.9.3), login sheet, peer roster, the mesh chip — plus (IOS-3) remote-session discovery |
| `VibeFieldKit/Sources/FieldTerminal` | the terminal leg (IOS-3): appearance → presentation config, the attachment lifecycle over Truffle, the Metal surface — plus (IOS-3c) the per-host mirror-write key store |
| `VibeFieldKit/Sources/FieldInput` | the input card (IOS-5a): the composer field, the rail, the sticky-Ctrl latch, and the acts they emit — plus (IOS-5b) the long-press fans, the Meta burst and the haptic table. Its own target on purpose (K-D1) — a keyboard is state machines all the way down, and the IOS-3 review found every serious bug living in the one module that had no test target. It takes `FieldTerminal` for the keystroke vocabulary only and names no Ghosttea product |
| `VibeFieldKit/Sources/FieldHome` | the field: bubbles, ignition, hold-to-create, session card, chrome-slot obstacles, home composition — plus `FieldHomeModel`, the screen's decisions as pure functions (discovery lifecycle, the card's face, the write claims) so the integrator is testable without a simulator |

**Write keys (IOS-3c).** The mirror-write capability a desktop grants this
phone is the value of its `FIELD_NATIVE_TERMINAL_MIRROR_WRITE`, kept in the
Keychain as one generic-password item per host (service
`com.jamesyong.vibefield.ios.mirror-write`, account = the host's device id,
`AfterFirstUnlockThisDeviceOnly`, `kSecAttrSynchronizable = false` — a grant to
one device must not ride iCloud to the others). It leaves the store exactly
once, as the attachment's access token, and is never displayed, exported, or
logged: the settings sheet lists the HOSTS and offers only REMOVE.

Swift 6 (`SWIFT_STRICT_CONCURRENCY = complete`) · iOS **18.1** floor (the pinned
TailscaleKit binary's floor — GhostteaApp's own) · simulator is arm64-only
(matching the Ghosttea native core, which ships no x86_64 slice) · bundle id
`com.jamesyong.vibefield.ios` under the frozen desktop root (`PKG-ID`).

## Build · test · run

This machine's `xcode-select` points at CommandLineTools, so every invocation
passes `DEVELOPER_DIR` (the Ghosttea convention). Since IOS-3 the tree also
links `GhostteaTerminal`, which ships a Metal build-tool plugin — SwiftPM asks
for trust before running one, and on the command line that ask is
`-skipPackagePluginValidation` (in Xcode it is a one-time prompt). Both flags
belong on every command here:

```sh
cd apps/ios

# build (unsigned, simulator)
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project VibeField.xcodeproj -scheme VibeField \
  -destination 'generic/platform=iOS Simulator' \
  -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO build

# tests (the package's own scheme; the app scheme builds/launches only)
cd VibeFieldKit && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild test -scheme VibeFieldKit-Package \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation

# one module at a time (each target has its own scheme — the fast inner loop)
DEVELOPER_DIR=… xcodebuild -scheme FieldTerminal \
  -destination 'generic/platform=iOS Simulator' -skipPackagePluginValidation build

# run in a simulator
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer sh -c '
  xcrun simctl boot "iPhone 17 Pro" 2>/dev/null;
  xcodebuild -project VibeField.xcodeproj -scheme VibeField \
    -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
    CODE_SIGNING_ALLOWED=NO build &&
  xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/VibeField-*/Build/Products/Debug-iphonesimulator/VibeField.app &&
  xcrun simctl launch booted com.jamesyong.vibefield.ios'
```

Debug builds accept launch arguments (the GhostteaApp opt-in-automation
pattern — none of them compile into Release), so a headless simulator run can
reach states no `simctl` touch can:

| Argument | What it drives |
|---|---|
| `-vf-auto-connect` | opens the mesh sheet and drives CONNECT — TailscaleKit start → control dial → the honest sign-in state |
| `-vf-demo-remote` | stands a FAKE peer up so remote-bubble rendering can be eyeballed without a desktop serving. A fixture for looking at our own pixels, never a claim that a mesh answered; the real source replaces it the moment the mesh is up |
| `-vf-auto-open-card` | opens a session card, preferring an attachable remote one |
| `-vf-auto-attach` | carries the run through ATTACH — on a phone whose mesh is up against a serving desktop this is the whole IOS-3 path with no finger on the glass; without a mesh it proves the honest-failure path instead |
| `-vf-open-settings` | opens the terminal appearance sheet |
| `-vf-open-write-key` | opens the WRITE KEY sheet on the demo host, the one surface a tap is otherwise the only way to reach |
| `-vf-write-key=<secret>` | swaps the Keychain for an in-memory write-key store whose **wildcard** answers for any host, so `-vf-auto-attach` can type against a serving desktop with no finger on the glass; it also seeds one explicit demo host (`studio`) so the settings sheet's WRITE KEYS section has a row to render. A launch argument is visible to `ps` — a DEBUG smoke aid, never a way to carry a real secret onto a phone |
| `-vf-demo-input-card` | mounts the input card over whatever card is open and prints every act it emits instead of sending one. The card's real gate is a live attachment this device may type into (K-D2), which no simulator has — so this forces the face for a look at our own pixels, never a claim that a terminal answered. Pair with `-vf-demo-remote -vf-auto-open-card`; add `-vf-demo-input-live` for the strip instead of the composer, or `-vf-demo-input-draft` for a filled draft under a locked CTRL |
| `-vf-demo-input-fan` | opens the CTRL long-press fan three seconds in — the ten chords in two rows, anchored above the key. The only way to a fan without a finger, and the fan is the whole of IOS-5b that a screenshot can show |
| `-vf-demo-input-meta` | holds ESC in its armed META state by re-arming the burst once a second. The burst is a 3 s window BY DESIGN and a screenshot run is slower than that, so the fixture keeps re-arming rather than pretending the window is longer; the state in the picture is the real one |

Device runs: open the project in Xcode — automatic signing with the committed
team (`DEVELOPMENT_TEAM` landed in IOS-1a, the desktop's frozen-identity
precedent; a Team ID is public material).

This app is deliberately **outside `pnpm verify`** (the gate must not require
Xcode); the commands above are its gate until an iOS lane exists in CI.
No Swift formatter is configured — neither Ghosttea nor Truffle carries one;
the de facto style is 2-space / ~100 col (swift-format defaults). Introducing a
checked tool is a deliberate future event, not an inheritance.

## What is real vs honest-missing (v0)

Real: the full-screen bubble field (physics, tiers, ignition, drag, tap-nudge,
hold-to-create, spawn pop, empty state), both themes, the session card with
live status, the mock fleet driving the **same** snapshot shape and classifier
the daemon feed will drive; since IOS-2 the mesh leg: `ghosttea` pinned
`exact: "0.9.3"` (truffle 0.7.12, lockstep with field-native), the in-process
Tailscale runtime behind a deliberate CONNECT act, in-app login (Safari sheet),
the online-peer roster, and the mesh chip the bubbles physically flow around
(`.swarmObstacle()` — the desktop obstacle pattern); and since IOS-3 the
terminal leg: remote-session discovery putting every peer's session on the
field as its own bubble, ATTACH over Truffle, the Ghosttea Metal surface, 602
themes + 4 shader ports in the settings sheet, and upstream's reconnect banner;
and since IOS-3c the write key has a home: the per-host Keychain store above,
ENTER KEY on the card's invitation (and on the status row of a live attachment
that is view-only for want of one), the sheet that takes it, and the WRITE KEYS
section that lists and revokes; and since IOS-5a the input card — a composer
field carrying the kit's own trait set (no autocorrect, no smart quotes, no
predictive bar), Send as a bracketed paste followed by Enter, and a rail of
eight terminal keys with a sticky Ctrl, over a keystroke vocabulary that encodes
to HID usages; and since IOS-5b that card has its other mode and its long press:
`>_` hands the keyboard to the terminal itself (the Metal view IS the
`UITextInput`, so Live mode is one `becomeFirstResponder` and the draft waits
where it was), the sticky Ctrl reaches THROUGH that handoff — the attachment
asks the card what the next key carries and shapes the keyboard's own event
with it, so `^C` means the same thing whichever responder is holding the keys —
and every rail key but the mode toggle holds a fan under a 0.35 s press: ten
chords under CTRL, each arrow's far end, ⇧Tab under TAB, and the Meta burst
under ESC (`.option` on exactly the next keystroke, with ESC wearing an inverted
META while it is armed). Haptics say which transition just happened: light to
arm, medium to lock, soft to release, rigid for a chord. 208 headless tests.

Honest-missing (each says so on screen where it shows): **typing has not been
witnessed on a device** — the key now rides every attach as its access token
and the card sends through the same attachment, but the gate that proves either
(type into a desktop's session and watch it land) wants a phone, a tailnet, and
a serving desktop, so it is a device run and no simulator can stand in for it.
A phone holding no key for a host still says so before the tap as well as
after, because the session being shared read-write is a different fact from
this device being granted writes, and conflating them was a review finding; the
input card is therefore **not on screen** on any attachment this device cannot
type into (K-D2) — a rail of keys that cannot reach a terminal is the disabled
affordance D-i6 forbids, and the honest view-only line already says why. The
card's remaining pieces are absent rather than inert: the `+` menu and the `⋯`
keypad are IOS-5d, the mic is a slice of its own, and the reply/paste chips are
IOS-5c. IOS-5b's own gate is a device too: the latch reaching the terminal
(`Ctrl-R` then text, `Ctrl-X Ctrl-S` through a lock), vim's `Esc :q!`, ⇧Tab, and
a Meta-arrow tmux binding all want a shell on the far end of a real mesh, so the
simulator witnessed the fans and the META state and nothing about what they
encode to. Two shapes of the design are ours rather than its: a fan opens on the
long press and its keys are TAPPED (the design's slide-and-release wants the fan
drawn inside the card's own hierarchy, which wants the card out of the
safe-area inset it lives in), and Reduce Motion, Dynamic Type and the VoiceOver
announcements for latch states are still IOS-5e — the labels are here, the
announcements are not.
Approvals render as facts, never as buttons, until the approvals track lands;
the agent feed is still the mock until fieldd's `agent.*` exists (IOS-4).

Vendor glyph geometry: LobeHub Lobe Icons v5.14.0 (MIT), the set the desktop
godview embeds.
