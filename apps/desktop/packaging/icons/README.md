# VibeField icon assets

The shipping family is James's **vibefield-icon-collection-v2**, selected on 2026-11-03:
the plain light/dark living ribbon with the stronger colored edge glow and hairline.
This replaces the October app masters and July tray master previously documented here.

The reviewed export lives in `../icon-source/`, including its original `recipe.json`.
`manifest.json` records the original collection name and SHA-256 of every consumed file.
Only the desktop, iOS, and tray assets used by these apps are retained; the build has no
Downloads dependency. `../icon-collection.mjs` owns the source-to-packaging mapping.

```sh
pnpm --filter @vibefield/desktop icons:generate
pnpm --filter @vibefield/desktop icons:check
```

Generation copies the studio's approved Windows, Linux, iOS, and tray pixels without
redrawing or retuning them. On the pinned Xcode toolchain it also compiles `app.icon`
with Apple's `ictool` and `actool`. Check mode is read-only and never invokes Xcode.

| Surface | Shipping assets |
| --- | --- |
| macOS bundle | `app.icon` with light/dark/tinted mark specializations; electron-builder compiles it into `Assets.car` and an ICNS fallback |
| macOS development Dock | `app-macos-dock.png`, extracted from Apple's compiled ICNS `ic13` representation, preserving Apple's optical inset |
| Conventional macOS fallback | `app.icns` and `../icon.icns`; `app-macos-1024.png` and `app-macos-dark-1024.png` are full-canvas native reference renders |
| Windows | `app.ico`, ten representations from 16–256 px; `app-1024.png` is the studio master |
| Linux | `linux/{size}x{size}.png`, 16–1024 px, plus the scalable `app.svg` source |
| iOS/iPadOS | `apps/ios/App/Assets.xcassets/AppIcon.appiconset`, 1024 px default, dark and grayscale tinted RGB PNGs, without alpha |
| macOS menu bar | `../tray/field*Template.png` at 18 pt with paired 36 px `@2x` assets, black plus alpha |
| Windows/Linux tray | Light and dark surfaces, four states each; Windows ICOs contain 16/20/24/32/40/48/64 px; Linux uses 32 px PNGs |

The status meanings stay the same: ready has no badge, update a plain dot, attention a
cut-out exclamation, and offline a cut-out bar. Electron loads both macOS representations
and sets the image as a template, leaving tinting to AppKit. Windows selects the system
(taskbar) appearance independently of the app's appearance. Linux follows its reported
native appearance. Both conventional platforms retain a contrasting keyline and refresh
the current state when the native theme changes. The subscription ends with the tray controller.
See [Electron nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme).

`icons:check` verifies the source hashes, every expected output and size, all ICO frames,
black-plus-alpha templates, distinct state variants, iOS RGB/opacity/grayscale, the native
macOS silhouettes, and the development Dock's safe area. `apple-renditions.json` binds the
committed native renders to the exact reviewed `.icon` source and their own hashes. It
prevents a new source from silently reusing old compiled icons on a machine without Xcode.
The Xcode build pin lives in `generate-icons.mjs`; other machines validate the committed
native files because Apple's output is not byte-stable across rendering environments.

`pnpm dev` uses Electron's unsigned bundle, so the shell applies the development Dock PNG
after readiness. Packaged builds keep bundle-owned appearance selection and do not override
the Dock at runtime. `electron-builder.yml` points to the explicit macOS, Windows, and Linux
asset paths. The package stager copies the complete tray directory into `Resources/tray`.
It also stages `app.ico` and `app-1024.png` into `Resources/icons`; the shell supplies the
appropriate Windows/Linux icon to its main window in both development and packaged builds.

To adopt another reviewed studio collection, replace the files named by `COLLECTION_ASSETS`
and its recipe under `icon-source/`, refresh that directory's hash manifest, then run
`icons:generate` on the pinned Xcode host and `icons:check`. Review source and generated
changes together. Editing generated files alone fails the next check or is replaced on generation.
