# VibeField icon assets

`app-master.svg` and `tray-master.svg` are the immutable conventional application and tray
masters imported from the VibeField branding workspace on 2026-07-28:

- conventional app SHA-256:
  `3fa2553196c40f5b55ef592bdd131863290740bba949803f19371b15875cfd31`
- tray SHA-256: `c2de6e79fcca0f3e966ea20a9acd53d755cf178deef3ef55d29cffb20eb64e70`

`app.icon` is the canonical macOS application-icon source authored with Apple Icon Composer and
imported on 2026-07-30. Keep the package serialization and its referenced vector exact:

- `icon.json` SHA-256: `69440dd10d67cc0a71d8ec7ea021bffd1c158f2617dada42fbcbeee6903cf206`
- `Assets/vibefield-appicon2.svg` SHA-256:
  `85b663f854d34df2055eec9f5bfd34076280447a72d9abd1b7152ecac7bf3728`

Run `pnpm --filter @vibefield/desktop icons:generate` after changing a master or `app.icon`. The
generator creates the checked-in Icon Composer-derived macOS ICNS fallbacks, Windows ICO, Linux
raster set, and all three platform tray states. On macOS it uses Xcode's official Icon Composer
`ictool` to render `app-macos-1024.png` and `actool` to compile the ICNS fallback directly from
`app.icon`. `icons:check` regenerates every representation in memory and compares exact bytes,
verifies that every Icon Composer layer is a local square vector and that the package contains no
unreferenced assets, so macOS CI proves that committed outputs are current. On a non-macOS host,
it still validates the committed Apple PNG and ICNS outputs but cannot recompile Apple materials.

The attention and offline tray states are deterministic monochrome badge treatments derived from
the tray master. macOS receives black-plus-alpha template images. Windows and Linux receive a
dark glyph with a light keyline because those platforms do not reliably tint notification-area
images for the current theme.

The reviewed Icon Composer composition uses a shared square-platform white material, translucent
dot field, black infinity mark, and RGB offset accents. The generator rejects missing or external
layers, a non-square vector canvas, an unrounded macOS rendition, or loss of those principal
visual treatments. The flat application master continues to produce only the Windows/Linux
assets; it is intentionally independent of Apple's material composition. No macOS representation
is allowed to fall back to that legacy artwork.

`pnpm dev` runs Electron's own unsigned application bundle, so electron-builder cannot embed the
VibeField bundle icon in that loop. After Electron is ready, the shell applies the checked
`app-macos-1024.png` through the macOS Dock API and logs the resolved path and dimensions.
Packaged builds never take that runtime override: electron-builder compiles `app.icon` with
Xcode 26 `actool`, writes `Assets.car`, sets `CFBundleIconName`, and installs an ICNS fallback in
the application bundle.
