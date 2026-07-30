# VibeField icon assets

`app-master.svg` and `tray-master.svg` are the immutable vector masters imported from the
VibeField branding workspace on 2026-07-28:

- app SHA-256: `3fa2553196c40f5b55ef592bdd131863290740bba949803f19371b15875cfd31`
- tray SHA-256: `c2de6e79fcca0f3e966ea20a9acd53d755cf178deef3ef55d29cffb20eb64e70`

Run `pnpm --filter @vibefield/desktop icons:generate` after changing a master. The generator
creates the checked-in conventional macOS ICNS fallback, Windows ICO, Linux raster set, and all
three platform tray states. On macOS it also uses Xcode's official Icon Composer `ictool` to
render `app-macos-1024.png` from `app.icon`. `icons:check` regenerates every representation in
memory and compares exact bytes, so macOS CI proves that committed outputs are current. On a
non-macOS host, it still validates the committed Apple rendition's structure and pixels but
cannot re-render Apple materials.

The attention and offline tray states are deterministic monochrome badge treatments derived from
the tray master. macOS receives black-plus-alpha template images. Windows and Linux receive a
dark glyph with a light keyline because those platforms do not reliably tint notification-area
images for the current theme.

`app.icon` is the editable Apple source authored with Icon Composer. Its `Mark` and `Background`
are independent vector layers mirrored under `layers/`; the generator rejects a flattened layer,
an unrounded macOS rendition, or drift between those vectors and the Icon Composer package.
Apple's Default rendition uses the shared iOS/macOS square-platform material, an automatic fill,
and the reviewed VibeField group treatment. Group translucency is deliberately off: Apple keeps
the specular depth and rounded silhouette without recoloring the supplied black-and-white brand.
The flat application master continues to produce the conventional ICNS fallback and the
Windows/Linux assets.

`pnpm dev` runs Electron's own unsigned application bundle, so electron-builder cannot embed the
VibeField bundle icon in that loop. After Electron is ready, the shell applies the checked
`app-macos-1024.png` through the macOS Dock API and logs the resolved path and dimensions.
Packaged builds never take that runtime override: electron-builder compiles `app.icon` with
Xcode 26 `actool`, writes `Assets.car`, sets `CFBundleIconName`, and installs an ICNS fallback in
the application bundle.
