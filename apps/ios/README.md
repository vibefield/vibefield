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
| `VibeFieldKit/Sources/FieldDesign` | two token sets and one motion table: the **godview** monochrome tokens (`FieldPalette`, `FieldType` — palette light+dark, mono type ramp, grid/scanlines/vignette), scoped to the swarm field and the terminal surface by DESIGN.md §1.1, and the **chrome** tokens (`ChromeType`, `ChromePalette`, `ChromeMaterial`, `ChromeControls`) every other surface wears — SF type, the glass card recipe, the radii and the two pill buttons |
| `VibeFieldKit/Sources/SwarmPhysics` | Matter.js-parity solver — pure Swift, no UI imports, seedable, headless-tested |
| `VibeFieldKit/Sources/FieldAgents` | chopsticks-shaped agent model, the ported status classifier, FNV identity hue (cross-language goldens), the scripted mock fleet |
| `VibeFieldKit/Sources/FieldMesh` | the mesh leg (IOS-2): the in-process Truffle/Tailscale runtime via `ghosttea` (exact 0.9.3), login sheet, peer roster, the mesh chip — plus (IOS-3) remote-session discovery |
| `VibeFieldKit/Sources/FieldTerminal` | the terminal leg (IOS-3): appearance → presentation config, the attachment lifecycle over Truffle, the Metal surface — plus (IOS-3c) the per-host mirror-write key store |
| `VibeFieldKit/Sources/FieldInput` | the input card (IOS-5a…5e): a composer row over a rail of nine terminal keys in two modes — a local draft sent as one bracketed paste, or the terminal itself holding the keyboard — with one sticky Ctrl reaching through both, the long-press fans, the reply and paste chips, the closed row, a mic that dictates into the draft and never onto the wire, the `+` doors (scan, snippets, clipboard history) and the `⋯` keypad's three pages, every one of them sized for the reader's text size and spoken to a screen reader; its own target on purpose (K-D1) because a keyboard is state machines all the way down and the IOS-3 review found every serious bug living in the one module with no test target, and it takes `FieldTerminal` for the keystroke vocabulary only and names no Ghosttea product. Since IOS-5v it wears DESIGN.md's **chrome family** as the KeyboardLab canvas draws it — SF type in sentence case, a glass card with a hairline over the sheet's own glass, 44 pt keys at radius 9, round pills — while the swarm field and the terminal surface keep the godview instrument palette that §1.1 scopes to them |
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
| `-vf-demo-input-card` | mounts the input card over whatever card is open and prints every act it emits instead of sending one. The card's real gate is a live attachment this device may type into (K-D2), which no simulator has — so this forces the face for a look at our own pixels, never a claim that a terminal answered. Pair with `-vf-demo-remote -vf-auto-open-card`; every argument below rides on top of it |
| `-vf-demo-input-live` | the strip instead of the composer — the terminal holding the keyboard, the mode key lit. The word "Live" is this spec's name for the mode and never the screen's |
| `-vf-demo-input-draft` | a filled two-line draft under a LOCKED Ctrl: Send gone prominent, the dot on the lit `Ctrl` cap, the card grown by one line |
| `-vf-demo-input-closed` | the card with the keyboard down: one row, the chips (if any) beside a glass circle wearing the keyboard glyph. It is the resting state of a card nobody has typed into, and a screenshot cannot tap its way out of the keyboard to reach it |
| `-vf-demo-input-chips` | stamps one fixture Claude permission's reply chips onto the card — `1 Yes` · `2 Yes, don't ask` · `3 No` · `Esc`, as glass pills with the keystroke in its own circle — so the contextual row above the composer can be looked at. The chips and the acts they emit are the shipping code; the permission they answer is invented, because no bubble the phone can attach to carries an agent facet yet (see below) |
| `-vf-demo-input-fan` | opens the CTRL long-press fan three seconds in — the ten chords in two rows, anchored above the key. The only way to a fan without a finger, and the fan is the whole of IOS-5b that a screenshot can show |
| `-vf-demo-input-meta` | holds ESC in its armed META state by re-arming the burst once a second. The burst is a 3 s window BY DESIGN and a screenshot run is slower than that, so the fixture keeps re-arming rather than pretending the window is longer; the state in the picture is the real one |
| `-vf-demo-input-dictating` | forces the mic's listening look — the prominent circle, breathing unless Reduce Motion is on — and seeds the draft through the same `appendDictation` a real partial would use. Listening otherwise wants two permission alerts answered by a finger and a voice to speak into a simulator, so this is the only way to a picture of the state; it opens no audio session and asks Speech for nothing. Our own pixels, never a claim that anything was heard |
| `-vf-demo-input-keypad[=symbols\|=combos]` | brings the `⋯` keypad up three seconds in — on the **Keys** page, or on `=symbols` / `=combos`. The keypad REPLACES the system keyboard, so it is reachable only by tapping `⋯`, and a screenshot has no finger. It waits because the card has to be on screen first: a keypad needs a responder to rise under. Add `-vf-demo-input-live` to see the same keypad riding the hidden responder (K-D5) with the terminal holding the mode |
| `-vf-demo-input-plus` | opens the `+` menu — Scan text · Snippets · Clipboard history, with the glyph rotated 45° to `×` (and not rotated under Reduce Motion). The attach items the design also lists are ABSENT rather than greyed out (K-D6, below) |
| `-vf-demo-input-snippets` | opens the Snippets sheet holding ONE fixture snippet (`STATUS` · `git status --short`, sends Enter) in a scratch `UserDefaults` suite that is wiped at launch — a fixture must never write into, or read out of, what a real user saved |
| `-vf-demo-input-history` | opens the Clipboard History sheet on two fixture entries in the same scratch suite. The real ring is fed only by pastes made THROUGH this card; nothing in the app ever reads the pasteboard's contents on its own |
| `-vf-demo-input-scan` | opens the Scan Text cover. On every simulator this is the honest-missing face — `DataScannerViewController.isSupported` is false without a camera — which is precisely the state worth looking at, since it is the one a screenshot run can ever reach |
| `-vf-demo-paste-review` | opens the paste-review sheet on fixture text. The sheet is otherwise reachable only by tapping a SYSTEM paste control with five lines or more on the pasteboard, and a headless run can do neither — the same door `-vf-open-write-key` opens, for the same reason |
| `-vf-demo-landscape` | asks the window scene to turn on its side (IOS-5e). `xcrun simctl ui` sets appearance, contrast and text size and nothing that rotates a device, so a headless sweep of the card's landscape and iPad layout — where the width cap at 720 pt is the whole question — has no other door. The system may refuse the request, in which case the picture is portrait and says so |

The two accessibility settings the sweep also drives are the simulator's, not
ours: `xcrun simctl ui <id> content_size accessibility-extra-extra-extra-large`
takes the card to its 52 pt step, and `appearance dark|light` gives the review
ritual its two themes. Reduce Motion has **no** `simctl` switch — it is set in
the simulator's own Settings app, or read from the code paths that branch on it.

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
section that lists and revokes; and since IOS-5a…5e the input card, which is
finished: a composer row over a rail of nine terminal keys, in two modes that
nothing but a tap on `>_` ever changes. Draft holds a local draft — the kit's
own trait set on the field, so no autocorrect, no smart quotes and no
predictive bar — and Send
puts it through as one bracketed paste followed by Enter, an empty draft going
as Enter alone, because "run it" is a real act with nothing left to type. The
other mode hands the keyboard to the terminal itself (the Metal view IS the
`UITextInput`, so it is one `becomeFirstResponder` and the draft waits where it
was), and one sticky Ctrl serves both — tap to arm, again to lock, again to
release — because in that mode the attachment asks the card what the next key
carries and shapes the keyboard's own event with it, so `^C` means the same
thing whichever responder is holding the keys. Every rail key but the mode
toggle opens a fan under a 0.35 s press: ten chords under CTRL, each arrow's far
end, ⇧Tab under `Tab`, and the Meta burst under `Esc`, which says `Meta` on a lit
cap while it is armed. Above the composer is the one row of context — reply chips
derived from the agent feed's own pending permissions, and the paste chip built
on the system paste control so there is no "allow paste" alert, with five lines
or more held back for a review that says what SEND will do — and with the
keyboard down the whole card collapses to that row beside one glass circle. The
composer's other two controls are the mic, which dictates into the DRAFT and
never onto the wire (a misheard word would already be a command down there;
recognition stays on the device where the device supports it, the audio is
streamed and stored nowhere, no transcript is logged), and `+`, which opens
Scan Text, Snippets and Clipboard History; `⋯` at the end of the rail replaces
the system keyboard with our own keypad of three pages — Keys, Symbols, Combos —
and `abc` gives the letters back. All of it answers the reader as well as the
terminal: at accessibility text sizes the rail and the composer step from 44 pt
to 52 pt and every key label from 13 to 15 and no further (`InputCardMetrics`, a
pure function with its own tests — a key's face is a key's face, not prose); Reduce Motion stops the `+` glyph turning, the mic
breathing and the fan scaling out of its key, leaving the cross-fades that carry
no movement; VoiceOver hears "Control armed" / "Control locked" / "Control
released", "Meta armed for the next key", "Typing into terminal" / "Drafting"
and "Terminal keys" / "System keyboard" at the moment each happens, reads the
rail as one container named "Terminal keys" and the chips as "Replies for the
waiting agent", and is told by a hint what a three-phase Ctrl will do next;
eleven transitions carry a haptic each, the table written out at the top of
`Haptics.swift`; and on an iPad — or a phone on its side — the card caps at
720 pt and centres, because nine equal keys across a 1024 pt inset are buttons
in the middle of the screen rather than keys under a thumb. 331 headless tests.

Honest-missing (each says so on screen where it shows): **the keyboard track is
built and none of it has been witnessed on a device.** IOS-5v re-skinned every
surface of it into the chrome family and changed no behaviour, so every device
gate below is still open and still says the same thing; what the simulator
witnessed of the re-skin is our own pixels in both themes, which is all a
screenshot can ever witness. **The rest of the phone's chrome has not moved
yet** — the session card's header, the settings sheet and the mesh sheet still
speak godview, which is right for the terminal deck they sit on and a decision
nobody has made for the others. Typing is the gate that
proves the whole of it — type into a desktop's session and watch it land — and
it wants a phone, a tailnet and a serving desktop, so it is a device run that no
simulator can stand in for; the same run is what would prove IOS-5b's encodings
(`Ctrl-R` then text, `Ctrl-X Ctrl-S` through a lock, vim's `Esc :q!`, ⇧Tab, a
Meta-arrow tmux binding), IOS-5d's (`|` and `~` from Symbols reaching a shell,
`^B c` opening a tmux window, a snippet with Enter running and one without not),
and that a three-line draft arrives in zsh as one block. A phone holding no key
for a host says so before the tap as well as after, because the session being
shared read-write is a different fact from this device being granted writes, and
conflating them was a review finding; the card is therefore **not on screen at
all** on an attachment this device cannot type into (K-D2) — a rail that cannot
reach a terminal is the disabled affordance D-i6 forbids, and the honest
view-only line already says why. **No chip has been tapped against a real
agent**, for the reason the paragraph below gives. **Dictation has not been
heard**: a headless run has no voice to speak into a simulator and no finger for
the two permission alerts, so nothing about a real transcript, the grants, or
whether recognition stayed on the device is witnessed — what the simulator
witnessed is the face, forced by `-vf-demo-input-dictating`; a device with no
audio input at all reports a zero-channel format, which `installTap` traps on
rather than throws, and that case is guarded and equally unwitnessed. **The `+`
menu ships without Photo, Take Photo and Choose File (K-D6)** and without a
greyed row where they would go: moving a file from this phone to a desktop needs
a mesh verb VibeField does not have — EL2 keeps bytes off the control plane and
no ticketed socket has ever been minted for a phone-to-host file — so the three
text sources ship and the attach half arrives with the verb. **The keypad in
Live rides a hidden responder (K-D5)**: ghosttea's Metal view is `final` and
exposes no input view of its own, so a zero-size `UIKeyInput` takes the keyboard
off it and brings the keypad up in its place; the keys still reach the terminal
through the card's own sink, but while the keypad is up a paired hardware
keyboard types into nothing. The fix upstream is one line (`customInputView` on
the Metal view) and the petition is batched into the next planned pin bump, per
K-D5. The keypad's "Record" — the design's fourth combo entry, which would
capture a sequence off the rail into a new key — is not built. Two shapes of the
design are ours rather than its: a fan opens on the long press and its keys are
TAPPED (the design's slide-and-release wants the fan drawn inside the card's own
hierarchy, which wants the card out of the safe-area inset it lives in), and the
`+` glyph's rotation is decoration we drop rather than replace under Reduce
Motion. **Two of IOS-5e's three accessibility answers cannot be photographed.**
Dynamic Type can: `xcrun simctl ui <id> content_size` drives it and the 52 pt
rail is in the sweep. Reduce Motion has no `simctl` switch at all — it lives in
the simulator's own Settings app — so its branches are witnessed as code paths
and by their tests, and not by a picture. VoiceOver announcements are audible
and therefore photograph as nothing: the words are pinned by
`InputAnnouncementTests` and the posting sites are one line each, but that a
screen reader actually speaks them at the right moment is a device gate like the
rest. Landscape and iPad are witnessed on the simulator through
`-vf-demo-landscape`, because `xcrun simctl` cannot rotate a device and the
alternative was not to look.

Approvals render as facts, never as buttons, until the approvals track lands;
the agent feed is still the mock until fieldd's `agent.*` exists (IOS-4).

**The chips are witnessed on the fixture only, and that is a fact about the feed
rather than about the chips (IOS-5c).** A reply chip is derived from the card
bubble's own pending permissions (`AgentFacet.permissions`), and only an AGENT
bubble carries those. The bubbles this phone can attach to are remote TERMINALS
discovered over the mesh: they have no agent facet, so they derive no chips —
correctly. The mock fleet's agents do wait on permissions, and have no terminal to
type an answer into. The two halves meet when the agent feed reaches the phone
(IOS-4 / the AR plane); until then `-vf-demo-input-chips` is the only place the
row renders, and this paragraph is the disclaimer. Structured approvals — codex,
grok and acp, which resolve over a product API instead of by typing — are
**absent** rather than inert for as long as that API does not exist
(`thinking-ar-agent-plane.md` §7); the card's "approve at the desktop" line stands
in their place. The design's password-prompt chip is not buildable here at all: it
wants the last row's TEXT, and a frame reaches this phone as bytes only the Metal
renderer can read.

Vendor glyph geometry: LobeHub Lobe Icons v5.14.0 (MIT), the set the desktop
godview embeds.
