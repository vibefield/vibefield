# VibeField icon assets

`app-master.svg` and `tray-master.svg` are the immutable vector masters imported from the
VibeField branding workspace on 2026-07-28:

- app SHA-256: `3fa2553196c40f5b55ef592bdd131863290740bba949803f19371b15875cfd31`
- tray SHA-256: `c2de6e79fcca0f3e966ea20a9acd53d755cf178deef3ef55d29cffb20eb64e70`

Run `pnpm --filter @vibefield/desktop icons:generate` after changing a master. The generator
creates the checked-in macOS ICNS, Windows ICO, Linux raster set, and all three platform tray
states. `icons:check` regenerates every representation in memory and compares exact bytes, so CI
also proves that committed outputs are current.

The attention and offline tray states are deterministic monochrome badge treatments derived from
the tray master. macOS receives black-plus-alpha template images. Windows and Linux receive a
dark glyph with a light keyline because those platforms do not reliably tint notification-area
images for the current theme.

The flat application master deliberately produces the conventional ICNS fallback. A layered
Apple `.icon` asset is not synthesized: that format needs independently authored foreground and
background layers, and wrapping the same flat bitmap would add no fidelity.

`pnpm dev` runs Electron's own unsigned application bundle, so electron-builder cannot embed the
VibeField bundle icon in that loop. After Electron is ready, the shell applies the checked
`app-1024.png` through the macOS Dock API and logs the resolved path and dimensions. Packaged
builds never take that runtime override: their Finder/Dock identity remains owned by the bundle,
with `app.icns` as the current fallback until real independently-authored Icon Composer layers
exist.
