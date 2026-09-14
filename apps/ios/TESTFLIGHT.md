# VibeField on your iPhone with TestFlight

TestFlight delivers the signed app and future builds over the internet. The
iPhone does not need a cable connection to this Mac. Use **internal testing**
for your own Apple account; this is separate from publishing to the App Store.

Build **0.1 (1)** was uploaded and processed on September 13, 2026. Its test
notes are saved, export compliance is complete, and App Store Connect marks
the build **Testing** in **Personal iPhone**. The group has one internal tester
and uses manual distribution. App Store Connect shows the tester as **Invited**;
open the TestFlight invitation email on the iPhone to accept and install.

Build **0.1 (2)** was archived on September 13, 2026 from main `09c526ab`: the first
build carrying the keyboard track (IOS-3c…5v — the write key's Keychain home and the
input card) and the swarm on Metal (IOS-6). **Its upload is still owed.** Two runs of
`testflight.sh upload 2` that afternoon stopped at the account step with
**Failed to Use Accounts** — xcodebuild found no Apple account with App Store Connect
access for team `9F79X9D26S`, two hours after build 1 uploaded with the same helper
(the archive, signing and network were all fine). Sign in again in Xcode > Settings >
Apple Accounts, then run the upload command below for build 2: the archive at
`apps/ios/build/testflight/VibeField-2.xcarchive` persists and the helper never
rebuilds an existing one. After Apple's processing, answer the export-compliance
questionnaire for build 2 (the same answers as build 1) and add it to Personal iPhone.

## App identity and prerequisites

| Setting | Value |
| --- | --- |
| Xcode project / shared scheme | `VibeField.xcodeproj` / `VibeField` |
| Bundle ID | `com.jamesyong.vibefield.ios` |
| App Store Connect app ID | `6811651318` |
| Apple Developer team | `9F79X9D26S` (Shikang Yong) |
| Marketing version | `0.1` |
| Minimum iPhone / iPad OS | `18.1` |
| Swift dependencies | Ghosttea `0.10.1`, Truffle `0.7.12` (exact pins) |
| Distribution | App Store Connect, internal TestFlight only |

The team must have an active Apple Developer Program membership. In Xcode >
Settings > Apple Accounts, sign in to an account with access to that team and
Certificates, Identifiers & Profiles. Automatic signing creates or downloads
the necessary provisioning profiles. Distribution uses an Apple Distribution
certificate, including Xcode's managed cloud signing when available; a macOS
Developer ID certificate is not an iOS distribution certificate.

Use full Xcode with the iOS 26 SDK or later. Apple's upload minimum changed on
April 28, 2026; this Mac has Xcode 26.6 and the iOS 26.5 SDK.
[Apple's SDK requirements](https://developer.apple.com/news/?id=ueeok6yw).

## One-time App Store Connect setup

1. Open [VibeField in App Store Connect](https://appstoreconnect.apple.com/apps/6811651318)
   under the Shikang Yong team. The app record and explicit bundle ID were
   registered on September 13, 2026.
2. If needed, choose **+ > New App**: platform **iOS**, name **VibeField**, primary
   language **English (U.S.)**, bundle ID **com.jamesyong.vibefield.ios**, and SKU
   **vibefield-ios**. If the bundle ID is missing, register that explicit ID in
   Certificates, Identifiers & Profiles, or let the first signed archive
   register it via automatic provisioning. Do not invent a replacement ID.
3. Under **TestFlight > Internal Testing**, open **Personal iPhone**. This group
   uses **manual distribution**. Add your existing App Store Connect user as the
   tester. There is no need to add anyone else to your developer team.
4. Upload a build with the commands below. Wait for Apple's processing, resolve
   any export-compliance prompt, then choose **Add Builds** in Personal iPhone
   and select the new build.

Internal testers must be App Store Connect users with access to this app.
Each subsequent upload must be added to Personal iPhone manually. Apple fixes
the automatic-distribution choice when a group is created; a new group is needed
if that policy is changed later.
Each build is available for up to **90 days**.
[Apple's internal testing instructions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).

## Build and upload

Run from the repository root:

```sh
# Builds 1 and 2 are archived (build 2's upload is owed — see above). Use 3, 4, ... for new builds.
bash apps/ios/scripts/testflight.sh archive 3

# Upload that exact archive using the Apple account already in Xcode.
bash apps/ios/scripts/testflight.sh upload 3
```

For build N, the archive is `apps/ios/build/testflight/VibeField-N.xcarchive`. Logs and
upload output are beside it, under the gitignored `build/` directory. A
completed archive is never overwritten. Xcode may increase the uploaded build
number to avoid conflicts; App Store Connect displays the final number.

`ExportOptions.plist` explicitly uploads to internal TestFlight with automatic
signing and dSYMs for crash symbolication. It does not publish an App Store
release. Builds produced with `testFlightInternalTestingOnly=true` cannot later
be used for external testing or the App Store: create a new archive with that
setting changed deliberately when you want broader distribution.

The helper selects `/Applications/Xcode.app/Contents/Developer` without changing
the machine's global `xcode-select`. Override `DEVELOPER_DIR` if necessary. It
requires the committed app lockfile, preserves its exact versions while allowing
Git cache refreshes, and uses the same Metal-plugin validation flag as the existing
iOS build commands. Credentials
remain in Xcode/Keychain. Never commit signing keys, passwords, or `.p8` files.

On Xcode 26.6 build `17F113`, the helper supplies
`-Xfrontend -disable-large-loadable-types-reg2mem`. Without it, Swift 6.3.3 crashes
in its `LoadableByAddress` pass while compiling GhostteaTruffle for Release. This
disables the problematic transform while retaining `-O` and whole-module
optimization. It does not change the Swift language mode or dependency pins.
The workaround is scoped to that Xcode build; reassess it after upgrading Xcode.
The Swift project documents the same transform's
[ABI-neutral workaround](https://github.com/swiftlang/swift/issues/91283), although
that report's reproducer is a different failure from this app's archive crash.
Use the helper for archives on this toolchain instead of plain Product > Archive.

The package tests were verified on an iPhone 17 Pro simulator with iOS 26.5:
135 tests for build 1, 424 for build 2 (the README's gate, run verbatim on
`09c526ab`, seven suites). To repeat that gate on this Xcode build:

```sh
cd apps/ios/VibeFieldKit
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild test -scheme VibeFieldKit-Package \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -parallel-testing-enabled NO -onlyUsePackageVersionsFromResolvedFile \
  -skipPackagePluginValidation \
  'OTHER_SWIFT_FLAGS=$(inherited) -Xfrontend -disable-large-loadable-types-reg2mem'
```

Upload success is followed by Apple's processing; it does not by itself mean
the build is ready to install.
[Apple's build upload instructions](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds).

The first upload (September 13, 2026) succeeded with a non-blocking symbol
warning: the pinned TailscaleKit framework does not include its matching dSYM
(`B86FE46F-7E62-37D3-825F-A1653E1BB64F`). VibeField's own dSYM is present and its
UUID matches the executable. Crash frames inside TailscaleKit may remain
unsymbolicated until its upstream binary distribution supplies those symbols.
Do not disable symbol uploads to hide this warning.

## Export compliance and privacy

This app embeds Tailscale/WireGuard through Truffle, so its networking is not
limited to Apple's built-in HTTPS implementation. The previous unconditional
`ITSAppUsesNonExemptEncryption=NO` has been removed. In TestFlight, use **Manage**
beside **Missing Compliance** and answer Apple's questionnaire for the bundled
cryptography and intended distribution. Complete any documentation Apple asks
for. Only restore a fixed exemption value or add an export-compliance code
after that determination is established for this app.
[Apple's encryption documentation workflow](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation).

For build **0.1 (1)**, the account owner authorized **standard encryption
implemented outside or alongside Apple's operating system** and **no
distribution in France**. These answers were submitted and accepted on
September 13, 2026. The questionnaire remains explicit for future builds;
revisit the answers if the bundled cryptography or intended distribution changes.
WireGuard's documented algorithms support this classification, including
ChaCha20-Poly1305, Curve25519, BLAKE2s, and HKDF.
[WireGuard protocol documentation](https://www.wireguard.com/protocol/).

The app's privacy manifest declares app-local preference storage (`CA92.1`),
app-container file metadata used by the native stack (`C617.1`), and elapsed-time
measurement for rendering (`35F9.1`). TailscaleKit also carries its own bundled
privacy manifest. Revisit these declarations when data collection or SDK usage
changes. The 1024×1024 opaque RGB app icon is an export of the existing
`apps/desktop/packaging/icons/app-master.svg`; it has no alpha channel or baked-in
rounded corners.

## Install and test away from your Mac

1. Install Apple's [TestFlight](https://testflight.apple.com/) on the iPhone.
   Accept your internal tester invitation on that device, then install VibeField.
   Enable Automatic Updates for VibeField in TestFlight.
2. Launch the app and check the field (the swarm on Metal since build 2), the
   session card and its input card, WRITE KEYS in settings, and the terminal
   appearance settings. The local agent fleet is still the labeled mock; real
   remote terminal discovery is a separate source.
3. For a live remote terminal, leave the desktop awake, online, running VibeField,
   joined to your tailnet, and serving a terminal session. On the iPhone, tap the
   mesh control, choose **CONNECT**, and sign in to the same tailnet. Approve the
   new device in your tailnet admin console if your tailnet requires approval.
4. Confirm the desktop appears as an online peer. Open a real remote session
   bubble and choose **ATTACH**. The app embeds its own Tailscale runtime; a
   separate Tailscale iPhone app is not required by this connection path.
5. Turn off Wi-Fi and repeat over cellular. Background and reopen VibeField,
   check reconnection, and confirm the desktop terminal session is still alive.

**Current product limits (build 2):** the write key landed with IOS-3c — entered on
the card (ENTER KEY) from the desktop's `FIELD_NATIVE_TERMINAL_MIRROR_WRITE` value,
kept in the Keychain per host, managed under WRITE KEYS in settings — so a host
whose key this phone holds accepts typing from the input card (Draft and Live
modes), and a host without one stays view-only and the card says so. Build 1 had
none of this. Still not implemented: the agent fleet on the field is the mock (the
fieldd binding has not landed), project colours are dealt per device, and the
History tab (D-i10) is not built. TestFlight does not enable anything the app has
not implemented.

If no peers appear, check the tailnet login, device approval, desktop sleep,
and network access. If peers appear but there are no sessions, check that the
desktop is actually serving a compatible terminal. If App Store Connect says
the build is ready but TestFlight does not show it, check group/build membership
and whether the tester invitation was accepted.
