# VibeField iOS

The iPhone/iPad companion. The home screen is the **agent field**: every
session a physical body — the swarm of puppeteer's Godview (RFC 005, design
locked 2026-09-09), drawn on one Metal surface by a transcription of its
WebGPU renderer, ranked by what it is doing. Tapping a body raises its session
card; the card's terminal area is the seam where the Ghosttea Metal surface
draws frames a desktop's terminal CELL rendered — reached since TM-5 by the
routed T1 client, two WebSocket legs to that cell's doors on the tailnet, with a
ticket fieldd minted for this device and this session.

Design record: `draft/thinking-ios-app.md` (v1 shape, physics decision,
aesthetic mapping, Ghosttea/Truffle integration plan, slice plan) and, for the
field's port of the reference, `draft/thinking-ios-swarm.md` (IOS-6, D-i11…D-i17).
The corpus laws that bind this surface: design-00 §3.1 (observe / approve /
attach / artifacts — canvas editing is desktop-only), design-04 §8.6 (one fieldd
connection, whole mesh through it), EL3/EL7 as ever.

## Layout

| Path | What |
|---|---|
| `VibeField.xcodeproj` | thin composition shell — hand-authored pbxproj (synthetic IDs, the GhostteaApp convention; objectVersion 60 since Xcode touched it); no product code |
| `App/` | `@main`, bundle configuration, assets, and privacy manifest |
| `VibeFieldKit/` | the real code, one SPM package, with source targets separated by owner |
| `VibeFieldKit/Sources/FieldDesign` | the FACE (IOS-8a, DESIGN.md §2.8: `FaceDeck` — the contracts' 48 and the same FNV-1a deal; `StickerRenderer` — the die-cut through Core Image, `CIMorphologyMaximum` as §2.8 prescribes; `UserFaceView` — the sticker and the coin) beside two token sets and one motion table: the **godview** monochrome tokens (`FieldPalette`, `FieldType` — palette light+dark, mono type ramp, grid/scanlines/vignette), scoped to the swarm field and the terminal surface by DESIGN.md §1.1, and the **chrome** tokens (`ChromeType`, `ChromePalette`, `ChromeMaterial`, `ChromeControls`) every other surface wears — SF type, the glass card recipe, the radii and the two pill buttons |
| `VibeFieldKit/Sources/SwarmPhysics` | Matter.js-parity solver — pure Swift, no UI imports, seedable, headless-tested; since IOS-6b it steps on the reference's fixed schedule (`advance(now:)`: 30 Hz behind an accumulator, the 15 Hz floor and the 0.2 air-friction ceiling clamped at every entry, a stall cap, every body's last two solved positions for the renderer's blend) |
| `VibeFieldKit/Sources/FieldAgents` | the agent model — since IOS-6a a SUBSET of puppeteer's monitor mirror, field names kept (usage samples, effort with its intent, the latest reply, the blockers, the clocks) — the status classifier (`idle · working · blocked`, core's word), the body model (`SwarmBodyModel`: the reference's `bubble-model.ts` transcribed — the five drawn states, the copy lines with the folder in the project's colour and the state line in the name's place, the figures, the ring, the burn ladder, the state's light), `SwarmWeight` (one ink at eight weights), the ledgers the field folds every projection (`UsageLedger` — since IOS-7a RFC 008's run-keyed USD display history, `UnreadLedger`, `ProjectLedger` + `ProjectTint` — record §02's colours, goldens generated from the TypeScript), `FieldAssembly` (the fold), and the scripted mock fleet, which burns tokens along the reference lab's four shapes and prices them the way RFC 008 does (claude · codex priced, the rest unavailable) |
| `VibeFieldKit/Sources/FieldMesh` | the mesh leg (IOS-2): the in-process Truffle/Tailscale runtime, login sheet, peer roster, the mesh chip — plus (IOS-4b) the synced stores and the product-door join. Since IOS-4i the runtime is `FieldTruffleRuntime`, so the node joins the namespace `FieldMeshContract.appID` names — the contracts' `APP_ID`, the one every desktop floor joins — rather than ghosttea's `ghosttea-terminal`, which is what a node's app id decides and nothing downstream can. Since **TM-5** it names NO Ghosttea product: the peer directory and the TSP1 dialer left with the protocol, and `truffle` is a direct package dependency (the same exact `0.7.12` pin it always resolved to) rather than one inherited through `GhostteaTruffle`. The per-host `list-sessions` discovery went with them — a session is named by the fold's `terminal.runtimeSessionId` now, and `terminal.v1.hosts` retired at TM-1. Since **TM-5a** a desktop row also carries `DeviceCapabilities.terminalMesh` from `device.list`, so a card can say a missing attach's reason BEFORE the tap rather than only after the mint refuses |
| `VibeFieldKit/Sources/FieldTerminal` | the terminal leg (IOS-3, re-footed at TM-5): appearance → presentation config, the attachment over the ROUTED T1 client, the frame sink that hands a cell's own TRF1 to the Metal surface (and enforces the frame-identity rule on the way), the Metal surface. The per-host mirror-write key store IOS-3c added was DELETED at TM-3 (2026-09-14) |
| `VibeFieldKit/Sources/FieldRoutedTerminal` | the ROUTED T1 client (TM-4): the phone's half of the terminal pipeline, and the first target that speaks a desktop CELL rather than the mesh. Two `URLSessionWebSocketTask` legs to one cell's `/control` and `/frames` doors over `MeshNode.urlSession(configuration:)`, a `ConnectionHello` carrying the transport grant VERBATIM (the MAC covers what the cell receives, unknown fields included, so a typed re-serialization would break one this device cannot compute), per-session activation on both legs under an id this client mints, receiver-advertised BYTE credits with the spec's seven laws, the `PresentationEnvelope` decoded to a TRF1 payload the renderer's own frame path takes, seed and catch-up transfers, the two-dimensional lease as values (`PresentationReady` ≠ `InputAllowed`), input and the explicit geometry lease. It takes `FieldProduct` for the tolerant-reader vocabulary and names NO Ghosttea product and no design kit — the manifest enforcing TM-D4, because this code is written to move upstream into GhostteaKit as the third routed-client core (petition G27). `TerminalAttachment` has mounted it since **TM-5** — this row said "nothing mounts it yet" until TM-r10 (2026-09-14), and there were TWO rows for this target saying it at different lengths; one row, and the mount is real |
| `VibeFieldKit/Sources/FieldProduct` | the product door's vocabulary: `JSONValue`, the TOLERANT `WireObject` reader (unknown fields named, never fatal), the JSON-RPC codec and transport, `FieldProductClient`, and the wire shapes the field and the terminal both read. Depended on by every target that parses a daemon's answer, and it names no UI |
| `VibeFieldKit/Sources/FieldInput` | the input card (IOS-5a…5e): a composer row over a rail of nine terminal keys in two modes — a local draft sent as one bracketed paste, or the terminal itself holding the keyboard — with one sticky Ctrl reaching through both, the long-press fans, the reply and paste chips, the closed row, a mic that dictates into the draft and never onto the wire, the `+` doors (scan, snippets, clipboard history) and the `⋯` keypad's three pages, every one of them sized for the reader's text size and spoken to a screen reader; its own target on purpose (K-D1) because a keyboard is state machines all the way down and the IOS-3 review found every serious bug living in the one module with no test target, and it takes `FieldTerminal` for the keystroke vocabulary only and names no Ghosttea product. Since IOS-5v it wears DESIGN.md's **chrome family** as the KeyboardLab canvas draws it — SF type in sentence case, a glass card with a hairline over the sheet's own glass, 44 pt keys at radius 9, round pills — while the swarm field and the terminal surface keep the godview instrument palette that §1.1 scopes to them |
| `VibeFieldKit/Sources/FieldSwarm` | the swarm on Metal (IOS-6c, D-i11): the six shaders transcribed from the reference's WGSL (they ride as resources and compile at first use, D-i14), `SwarmRenderer` (the same five pipelines in painter's order, the same buffer layouts, one upload a frame), the glyph atlas (CoreText at the screen's scale into an `r8` shelf-packed texture; the folder outlined and solid, the state marks, the dot and the two flames drawn from paths into it), the mark atlas (the reference's `marks.png` byte for byte), `SwarmTheme` (one surface and one ink resolved from `FieldPalette` per scheme, the state hues fit to be read, lit and grounded — the reference's `readable` · `vivid` · `stateGlow` · `stateGround`, tuned by the STATE GLOW parameters), `SwarmStage` (the loop: the blend, the radius spring, the arrival curve, draw order, hit testing, drag / tap / hold, VoiceOver focus), `SwarmMetalView`, the SwiftUI `SwarmField` with its chrome slot and `.swarmObstacle()`, and the design lab behind `-vf-swarm-lab` (D-i15) |
| `VibeFieldKit/Sources/FieldHistory` | the HISTORY tab (IOS-9b, H-D4): the ledger (`HistoryLedgerView` — large title, the scope line in the record's three states, Live now, projects by spend or recency with the tint wash and the sparkline), a project (`HistoryProjectView` — the four figures, the 53-week ribbon, sessions under their days), a session's document (`HistorySessionView` — the prompt as the one filled panel, response heads, runs folded to a sentence of nouns with the failed count red, the day pill, the live line), search (`HistorySearchView` — the system's search role, recent searches, hits grouped under session heads with the terms marked, the quiet states) and the match stepper that rides the bar; `FieldHistoryModel` is every decision as a pure function, `HistoryRouter` the shared stack a hit lands into, `HistoryCorpus` the VALUES all of it reads — today filled only by the mock (`-vf-mock`); the index reads (H-1) fill the same values. Chrome family only, never the godview ink |
| `VibeFieldKit/Sources/FieldWorkspace` | FS-2's folder picker and launch sheet: Recent places, home and volumes on a selected desktop; confined list/search rows with exact absolute Copy path, paging and honest offline/partial states; `agent.spawn {cwd}` through that desktop's existing product door using its catalog and default profile. Hold empty ground to create; the folder chooser opens above a single-height launch sheet. No file bodies and no additional phone connection budget. |
| `VibeFieldKit/Sources/FieldHome` | the home composition: the field mounted over the dressed rows, the session card, the BAR (IOS-9e, `AppBar.swift`: the account circle at the LEFT, Field · History in a capsule at the centre, search at the RIGHT — one 62 pt row of the system's Liquid Glass (`GlassEffectContainer`, `glassEffect`, `glassEffectID` morphs; the chrome family's recipe below iOS 26), every number measured off iOS 26's own tab bar and pinned by `AppBarTests`. It is ours rather than `TabView`'s because the system bar pins its capsule to the left once search is a tab and seats nothing before the tabs; the three pages are stacked under it and kept alive the way a TabView keeps its tabs. History's scroll folds the capsule to its glyph at the left, the match stepper rides above the bar or inline when folded, and the search circle morphs into the field above the keyboard), and since IOS-8 the ACCOUNT CORNER (`AccountCorner.swift`: the owner's face in the bar's left corner, a glass circle the search circle's size, and the menu grown up and to the right of it — you · your desktops · Settings… · Sign in (only while the tailnet asks) · Sign out — and `FieldHomeModel.accountFace`, the decision behind every word; the mesh chip, its line and the mesh sheet retired into it) — hold-to-create — plus `FieldHomeModel`, the screen's decisions as pure functions (discovery lifecycle, the card's face, the write claims) so the integrator is testable without a simulator |

**Write keys (IOS-3c) — DELETED at TM-3, 2026-09-14.** This phone held one
Keychain item per host carrying that desktop's mirror-write capability, and a
sheet, an ENTER KEY affordance and a WRITE KEYS settings section around it. All
of it is gone, along with the desktop's mint, its key file, its env var, the
`terminal.mirrorWriteGrant` door and the mgmt verb behind it (TM-D3).

**The right to type is a claim in the ATTACH GRANT** fieldd mints per client per
session — expiring, revocable by generation, and downgraded by the cell if the
cell says so. A WhoIs-verified self peer is minted `[input, read]`; anything else
is minted `[read]` and the attachment says so in its own words ("view only — this
desktop granted read without input"). Nothing durable is stored on this device.

> **Corrected 2026-09-30 (DS-4, DS-D5's note):** a WhoIs-verified self peer is
> minted `[geometry, input, read]` now — the pane focused last takes the geometry
> seat on any device. The kit does not yet speak the lease verbs that would take
> it (DS-4b), so the phone's pane still never resizes the session; the right is
> in the grant, the verb is not in the kit.

**A phone upgrading from an older build** has its Keychain items REMOVED at the
first launch on this build: a one-time delete by service, which never reads a
value (`RetiredWriteKeyCleanup`). Nothing replaces them.

Swift 6 (`SWIFT_STRICT_CONCURRENCY = complete`) · iOS **18.1** floor (the pinned
TailscaleKit binary's floor — GhostteaApp's own) · simulator is arm64-only
(matching the Ghosttea native core, which ships no x86_64 slice) · bundle id
`com.jamesyong.vibefield.ios` under the frozen desktop root (`PKG-ID`).

## Build · test · run

`App/Info.plist` supplies the ATS exception for `ts.net` and its subdomains;
Xcode merges it with the generated bundle metadata in both configurations.
The product and terminal endpoints use HTTP/WebSockets inside Truffle's
authenticated Tailscale transport. ATS cannot observe that transport's
encryption and otherwise rejects the first desktop probe with
`NSURLErrorDomain -1022`. The exception covers MagicDNS hosts only. Requests
still use `MeshNode.urlSession`, the peer endpoint checks, and the account gate;
other domains keep their default ATS requirements. The same reasoning is the
exception's justification for App Store review. See
[Apple's ATS exception guidance](https://developer.apple.com/documentation/security/preventing-insecure-network-connections).

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
| `-vf-mock` | the WHOLE PHONE over invented facts and no tailnet (IOS-9d): the account signed in as `me@jamesyong42.com` with 🦊, `studio` answering and `mini` asleep, the scripted fleet on the field, the History records' corpus under the History tab and search over it. Every act in the corner works and moves the mock's own standing — Sign out empties it to the `Sign in` circle, Sign in fills it again with no login page (there is no tailnet to sign in to). There is no Connect or Disconnect (the phone stays connected by itself while signed in, 2026-10-18); `-vf-mock-reconnecting` stamps a lost mesh (History says `studio is asleep · read 11:42`, search says `Search needs studio`). The pixels come from the shipping decisions over these inputs, never a second drawing; nothing here claims a mesh answered. The shared scheme **VibeField-Mock** launches with it, so a device run from Xcode needs no argument typed |
| `-vf-mock-tab=history\|search` · `-vf-mock-open` · `-vf-mock-signed-out` · `-vf-mock-reconnecting` · `-vf-mock-search=<q>` · `-vf-mock-landed` · `-vf-mock-folded` | ride on `-vf-mock`: open a page (search opens with the keyboard up), grow the corner's menu, start signed out or with the mesh lost and re-dialling, fill the search field with a query, land its second hit in the session document with the stepper up, fold the bar as a scroll down would — the states a headless run cannot tap, type or scroll its way into |
| `-vf-auto-connect` | opens the account menu and drives SIGN IN — TailscaleKit start → control dial → the honest sign-in state |
| `-vf-demo-account=<state>` | stamps the ACCOUNT CORNER's inputs (IOS-8e) so its states can be photographed with no tailnet: `signedin` (the face, the login line, `studio` quiet and `mini` asleep) · `asleep` (the mesh re-dialling, both desktops asleep) · `attention` (sign in again: the dot, the notice) · `noface` (signed in, no desktop has named you: the plain circle) · `guests` (one other account's desktop on the tailnet, as a sentence) · `refused` (a desktop's door refused: the dot and the row word) · `firstrun` (not signed in: the `Sign in` pill). The pixels come from the shipping decision over invented inputs — never a second drawing — and nothing here claims a mesh answered |
| `-vf-demo-account-open` | grows the corner's menu on launch, which a headless run could not tap |
| `-vf-demo-fleet` | runs the SCRIPTED FLEET (`MockAgentField`). Since IOS-4b the mock is no longer the live path — the field's agents come from the daemon through `FieldLink` — so a screenshot that wants invented agents must ask for them. Implied by every `-vf-swarm-lab` page, which draws its own fixtures anyway |
| `-vf-demo-field-slice` | mounts the field over the contracts' GOLDEN MESH BOARD (`agent-mesh-open.valid.json`, byte for byte from `packages/contracts/fixtures/`) through the **real** home path (DS-8, 2026-10-01): four desktops on a fixture tailnet, the phone homing to the first whose door answers and reading the field through its `agent.subscribe {projection: "field", scope: "mesh"}` — the home's board, a live laptop's, a sleeping desktop's kept board drawn GREYED, and a stale one listed with none. The network is an in-process door answering the contracts' own bytes, so the swarm and the corner can be photographed over real-shaped data in both themes with no desktop and no tailnet. It is not a demo path: nothing downstream of the door knows the difference, which is the whole point. *Until DS-D14 (2026-10-01) this mounted the golden `field.agents.v1` slice through the store reader, which is retired.* |
| `-vf-demo-remote` | stands a FAKE peer up so remote-bubble rendering can be eyeballed without a desktop serving. A fixture for looking at our own pixels, never a claim that a mesh answered; the real source replaces it the moment the mesh is up |
| `-vf-auto-open-card` | opens a session card, preferring one whose join names a terminal (then the DEBUG fixture's remote row, then whatever is working) |
| `-vf-auto-attach` | carries the run through ATTACH — on a phone whose mesh is up against a serving desktop this is the whole path with no finger on the glass: hear the fold, choose, mint a ticket at the product door, dial the cell's two legs. Gated on the CARD's own face, so it fires exactly when a tap would have worked; without a mesh it proves the honest-failure path instead |
| `-vf-open-settings` | opens the terminal appearance sheet |
| `-vf-swarm-lab[=section[:page]]` | covers the field with the **swarm design lab** (IOS-6c, D-i15): the reference's fixture stages — the 26 drawn states, the burn ladder's six readings, the three weights of the pane light, the settled cluster, the mark contact sheet — on the production renderer, the pixels the field will paint. Bare, the whole lab scrolls; `=states:3`, `=burn`, `=light`, `=field` or `=marks` shows one page, because a screenshot run cannot scroll and every page is a gate. Six stages a surface: one surface for the whole grid crossed the 8192-pixel texture limit at 3× |
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
| `-vf-demo-paste-review` | opens the paste-review sheet on fixture text. The sheet is otherwise reachable only by tapping a SYSTEM paste control with five lines or more on the pasteboard, and a headless run can do neither |
| `-vf-demo-landscape` | asks the window scene to turn on its side (IOS-5e). `xcrun simctl ui` sets appearance, contrast and text size and nothing that rotates a device, so a headless sweep of the card's landscape and iPad layout — where the width cap at 720 pt is the whole question — has no other door. The system may refuse the request, in which case the picture is portrait and says so |

The two accessibility settings the sweep also drives are the simulator's, not
ours: `xcrun simctl ui <id> content_size accessibility-extra-extra-extra-large`
takes the card to its 52 pt step, and `appearance dark|light` gives the review
ritual its two themes. Reduce Motion has **no** `simctl` switch — it is set in
the simulator's own Settings app, or read from the code paths that branch on it.

Device runs: open the project in Xcode — automatic signing with the committed
team (`DEVELOPMENT_TEAM` landed in IOS-1a, the desktop's frozen-identity
precedent; a Team ID is public material).

**Reading an attach on a device** (fix8, 2026-10-15). Every phase of a
terminal attach writes one line: the tap, the mint asked and answered, the leg
slot, each leg dialing, the mesh's session asked for and made (with its
milliseconds), the hello sent, accepted or refused, control and frames
acknowledged, the first frame, a step's deadline (`stopped waiting at dial
after 20 s`), a run's end. They go to the unified log as subsystem
`com.jamesyong.vibefield.kit`, category `attach` — Console.app with the phone
selected, filtered `subsystem:com.jamesyong.vibefield.kit category:attach` —
and a Debug build also prints each as `[attach] …` on stdout, which is what a
`devicectl … --console` capture carries (it does not carry the unified log). A
Debug build also watches its main thread: one that has not answered for 2 s
writes `main thread stalled N s, last attach phase: …` through the same path,
and `main thread answered again after N s` when it does. No line carries a
grant, a MAC, a nonce, a URL or a login — a door's cell boot id, a session id,
a refusal's code and an error's domain and number are the most it says.

For installation and updates on an iPhone away from the Mac, follow
[the TestFlight setup](TESTFLIGHT.md). The release helper builds a signed
device archive and uploads it using Xcode's existing Apple account:

```sh
# From the repository root. N = the next unused build number (TESTFLIGHT.md names the last).
bash apps/ios/scripts/testflight.sh archive N
bash apps/ios/scripts/testflight.sh upload N
```

This app is deliberately **outside `pnpm verify`** (the gate must not require
Xcode); the commands above are its gate until an iOS lane exists in CI.
No Swift formatter is configured — neither Ghosttea nor Truffle carries one;
the de facto style is 2-space / ~100 col (swift-format defaults). Introducing a
checked tool is a deliberate future event, not an inheritance.

## What is real vs honest-missing (v0)

Real: the full-screen field on Metal (IOS-6 and the IOS-7 catch-up with the
reference's one-ink revision: RFC 005's five drawn states at the locked sizes
— one surface and one ink at the weights of `SwarmWeight`'s ladder in both
themes; the hollow with its dashed rim and comet; the idle body with its
context gauge climbing in weight as it fills; a reply that arrived unseen or
a blocker's own evidence (the tool, the question as asked, the adapter's line)
in the NAME's place behind its mark, the name above it, the body lit blue or
orange from inside in waves; the working body grown by its share of estimated
USD, the burn ladder of up to four flames on RFC 008's absolute scale — one
hollow flame where nothing prices the work, which today's wire is (D-i18) —
the figures and the breathing mark; the project's colour worn by the folder
before the name and nowhere else, dealt by record §02; the open card's body
wearing the phone's one pane as a band and a light, the
physics at 30 Hz blended to the display's rate, drag, tap-and-nudge,
hold-to-create, the arrival curve, VoiceOver elements per body), both themes,
the session card with live status, the mock fleet driving the **same**
snapshot shape and classifier the daemon feed will drive; since IOS-2 the mesh leg: `ghosttea` pinned
`exact: "0.10.1"` (truffle 0.7.12, lockstep with field-native), the in-process
Tailscale runtime, kept up by itself while signed in (2026-10-18; a deliberate CONNECT act until then) — since IOS-4i in VibeField's
own truffle namespace, the only one a desktop is visible in — in-app login
(Safari sheet), the online-peer roster, and the mesh chip the bubbles
physically flow around
(`.swarmObstacle()` — the desktop obstacle pattern); and since IOS-3 the
terminal leg — re-footed at **TM-5**: ATTACH is a routed T1 client dialing a
desktop CELL's two doors with a ticket fieldd minted, the cell's own TRF1 into
the Ghosttea Metal surface (no replica, no on-device encode), 602 themes + 4
shader ports in the settings sheet, and our own banner. What went with TSP1: the
per-host discovery that put every peer's session on the field as a bubble (the
field's rows are the FOLD's agent runs now), and upstream's reconnect banner
with the connection it described;
IOS-3c gave the write key a home — a per-host Keychain store, ENTER KEY on the
card's invitation, the sheet that took it, the WRITE KEYS settings section — and
TM-3 DELETED all of it on 2026-09-14, TM-5 having already left it unread by any
attach (the right to type is the attach grant's); and since IOS-5a…5e the input card, which is
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

Honest-missing (each says so on screen where it shows): **the swarm on Metal
has been witnessed on the simulator only** — the lab's every page in both
themes and the live field over the mock — and three numbers are a device's to
give: the five shaders' compile at first use (1,073 ms on the iPhone 17 Pro
simulator, whose compiler is not a phone's; the `.metal`-in-target route is
the move if a device shows it), the feel of 30 Hz physics under a 120 Hz blend
(James's thumb; `physicsHz` is a parameter), and the type at 7 pt on a real
panel. Two of the design's facts have no phone analogue and are recorded as
deltas, not gaps: there are no panes beyond the open card (D-i12), and there
is no hover, so the body's title is its VoiceOver label and the card's
header. The project colour is dealt on this device (D-i13); the same project
can wear a different hue here and on the desktop until a fieldd door carries
the sequence. **The keyboard track is built and none of it has been witnessed
on a device.** IOS-5v re-skinned every
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

Approvals render as facts, never as buttons, until the approvals track lands.

**The agent feed is the daemon's since IOS-4b.** `FieldLink` (in `FieldMesh`)
is the join: the mesh node → `field.devices.v1`, which names every desktop and
carries its `productEndpoint.url` → one `FieldProductClient` per desktop that
has one, `system.hello` with no token (WhoIs is the grant) → the board, from
`field.agents.v1` where the floor publishes it and over
`agent.subscribe {projection: "field", minIntervalMs: 250}` where it does not.
The two legs are §5's hybrid and the store wins where it has a live slice: it
needs no connection, and a desktop that publishes it tells every phone at once.
Rows past their slice's `expiresAt` stop drawing. `MockAgentField` has retired
from the live path and runs only behind `-vf-demo-fleet` and the lab, because a
preview that cannot be told from a daemon is the demo path the corpus forbids —
so **a phone with no mesh now shows an empty field**, which is a real answer
rather than a missing feature, and the mesh chip is what says why.

**The chips are witnessed on the fixture only, and that is a fact about the feed
rather than about the chips (IOS-5c).** A reply chip is derived from the card
bubble's own pending permissions (`AgentFacet.permissions`), and only an AGENT
bubble carries those. This was written when the bubbles this phone could attach
to were remote TERMINALS discovered over the mesh, which carry no agent facet
and so derive no chips. **TM-5 moved the ground:** the field's rows are the
fold's AGENT runs and an attach goes through the join, so the two halves now
meet on the same bubble — a live agent with permissions pending and a terminal
to answer in. What is still unwitnessed is that pairing on a real desktop, which
is Phase 0's; `-vf-demo-input-chips` remains the only place the row renders
here, and this paragraph is the disclaimer until a live run replaces it. Structured approvals — codex,
grok and acp, which resolve over a product API instead of by typing — are
**absent** rather than inert for as long as that API does not exist
(`thinking-ar-agent-plane.md` §7); the card's "approve at the desktop" line stands
in their place. The design's password-prompt chip is not buildable here at all: it
wants the last row's TEXT, and a frame reaches this phone as bytes only the Metal
renderer can read.

Vendor glyph geometry: LobeHub Lobe Icons v5.14.0 (MIT), the set the desktop
godview embeds.

### Files picker witness (FS-2)

The DEBUG flags `-vf-demo-workspace=roots`, `folder`, `new`, `launch`, `refused`, `spawning`, and `offline`
mount the shipping sheets over mirrored contract fixtures. They do not launch
an agent. Run them through `simctl launch` for headless screenshots.

For the optional real worker test, start
`node --import ./packages/contracts/node_modules/tsx/dist/loader.mjs packages/fieldd/test/fixtures/ios-workspace.ts`
from the repository root, then run the package tests above. The fixture writes
its ephemeral loopback endpoints to `/private/tmp/vibefield-fs2-loopback.json`
(mode 0600). `WorkspaceLoopbackTests` walks a temporary tree, copies the exact
answered path and spawns `/bin/cat` through real fieldd and the native PTY.
Its authentication bridge supplies a minted renderer participant; this is
not a tailnet or on-device witness. Stop the fixture afterward (SIGTERM cleans
its daemons, temporary files and endpoint file). Without that file the row is
explicitly disabled; fixture-only tests always run.
