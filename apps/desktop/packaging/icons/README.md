# VibeField icon assets

`app.icon` is the one source of every application icon, on every platform: an Apple Icon
Composer package holding the plain icons James chose on 2026-10-09 ("2 icons with pure white and
pure black background with no patterns"): the VibeField Identity's living mark at rest (flat
band, the twist's hairline, its three lights) in black ink on a pure white ground, and in white
ink on a pure black ground. Keep the package serialization and its referenced vectors exact:

- `icon.json` SHA-256: `d0bbe6720b67584729c94e6a8b5ad465a1e0230573c8116fee55595c4a48d7c6`
- `Assets/mark-light.svg` SHA-256:
  `4650a058c5102010e7ff0777ef9455e13e35e08390bd5ddd927996ce05c4e901`
- `Assets/mark-dark.svg` SHA-256:
  `0c2051f06515df8c873e1570e003fd102c5830e01c81db5a04df1d3cb34621cb`

The two SVGs are the wormhole lab's own vector export of its Plain White and Plain Black icons.
The lab lives in its own project since 2026-10-25, `vf-splash` (github.com/vibefield/vibefield-splash,
private; a checkout beside this one): from there, `node test/export-icon.mjs
<this repo>/apps/desktop/packaging/icons/app.icon/Assets` writes them, a saved look applied with
`--look=`. *(Corrected 2026-10-28, the housekeeping pass: this named `draft/wormhole` and its
`test/export-icon.mjs`; that copy is the record of how the lab was built here, archived at
`draft/archive/superseded/wormhole/` on `dev-local`, and is no longer updated.)*
Each is the mark alone on a 1024 canvas: its band in two halves (far, near) filled and outlined
in the ink, its lights as stroked pieces. The ground is the icon's fill, never a shape in the
layer. `icon.json` gives the default appearance a solid white fill and the dark appearance a
solid black one, and swaps the mark's image per appearance through `image-name-specializations`
(default `mark-light.svg`; dark and tinted `mark-dark.svg`). The default image sits inside the
specializations rather than in `image-name`: Icon Composer draws `image-name` over its
specializations, so a dark image beside it never shows (measured with `ictool`, Xcode 17F113).
The layer has glass off, the group no shadow and no translucency: the grounds stay pure.

`tray-master.svg` is the immutable tray master imported from the VibeField branding workspace on
2026-07-28 (SHA-256 `c2de6e79fcca0f3e966ea20a9acd53d755cf178deef3ef55d29cffb20eb64e70`).

Run `pnpm --filter @vibefield/desktop icons:generate` after changing `app.icon` or the tray
master. On macOS it uses Xcode's official Icon Composer `ictool` to render the full-canvas
`app-macos-1024.png` (Default) and `app-macos-dark-1024.png` (Dark) compositions and `actool` to
compile the ICNS fallback directly from `app.icon`; it also extracts `app-macos-dock.png` from the
ICNS `ic13` representation (Apple's padded rendition for the development Dock, not a second icon
design). From the same two layers it draws, with resvg:

- **Windows and Linux** (`app.ico`, `linux/`, `app-1024.png`): the default appearance — the
  black mark on a white tile, the lab's icon mask (a superellipse, n = 5, at full bleed). Drawn
  from the vector, the band thins under a pixel at the small sizes, so they draw it heavier: one
  output pixel at 32 px and under, easing by log size to none at 128.
- **iOS** (`apps/ios/App/Assets.xcassets/AppIcon.appiconset`): full-bleed opaque squares, one
  per appearance — `AppIcon.png` (white ground), `AppIcon-Dark.png` (black ground, white mark)
  and `AppIcon-Tinted.png` (the dark art in grey, which the system tints). They are 8-bit RGB
  with no alpha channel, as App Store icons must be, and are checked by their decoded pixels
  rather than their bytes, since zlib's compressed bytes are not promised across Node releases.

`icons:check` regenerates every representation in memory and compares it with the committed
files, verifies that every Icon Composer layer is a local square vector and that the package
contains no unreferenced assets. Icon Composer's renders are not byte-stable across machines, so
check mode never invokes the Apple toolchain: it validates the committed macOS PNGs and ICNS as
they are.

The generator rejects what would lose the reviewed design: a ground that is not solid white
(default) or solid black (dark), a mark layer without its dark image or with a ground of its
own, a band not in its appearance's ink, a mark that lost one of its three lights (rose, green,
blue), an unrounded macOS rendition or one without its plain ground, and an iOS icon with
transparency. It also enforces a development-Dock safe-area inset, preventing a full-canvas Icon
Composer export from being wired into the Dock again.

The attention and offline tray states are deterministic monochrome badge treatments derived from
the tray master. macOS receives black-plus-alpha template images. Windows and Linux receive a
dark glyph with a light keyline because those platforms do not reliably tint notification-area
images for the current theme.

`pnpm dev` runs Electron's own unsigned application bundle, so electron-builder cannot embed the
VibeField bundle icon in that loop. After Electron is ready, the shell applies
`app-macos-dock.png`, extracted from Apple's compiled ICNS and therefore carrying the same optical
safe area as the packaged icon, through the macOS Dock API. It is the default appearance only:
the development Dock does not follow the system's dark appearance. The full-canvas renditions
remain checked Icon Composer renditions but are not suitable as a raw Dock override. Packaged
builds never take that runtime override: electron-builder compiles `app.icon` with Xcode 26
`actool`, writes `Assets.car` (the icon in its light, dark and tinted appearances), sets
`CFBundleIconName`, and installs an ICNS fallback (the default appearance) in the application
bundle.
