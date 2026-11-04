# VibeField Icon Studio

A local, single-page workspace for the VibeField icon family. It opens on the plain light/dark ribbon with colored edge lights; Wormhole Dust, Obsidian, Prism, and Deep Field remain starting looks.

```sh
pnpm icons:studio          # build and serve on http://127.0.0.1:8821
pnpm icons:studio:build    # rebuild the portable HTML
pnpm icons:studio:test     # binary formats, recipes, masks, asset-catalog contracts
```

Open `dist/VibeField Icon Studio.html` directly in a modern browser, or use the local server. The portable build embeds its scripts, shaders, styles, and original animated SVGs. It makes no external requests, needs no account, and generates downloads in the browser. Plain artwork and symbols work without WebGPU; procedural dust requires WebGPU. Node 22+ and the repository's installed esbuild are needed only to rebuild, not to use the HTML.

The page saves the current recipe in browser storage. **Save recipe** exports JSON; **Import look** accepts that JSON or a saved Wormhole Dust parameter object. **Save portable studio** downloads a clean copy of the application; save the recipe alongside it to retain edits. Export takes a snapshot, so later edits do not change a bundle already being built. Cancel stops after the current image.

## What it produces

| Set | Deliverables |
| --- | --- |
| macOS | Editable `.icon` package with light/dark assets, two `.icns` fallbacks, complete ten-representation `.iconset` folders |
| Windows | Multi-resolution ICO with 16/20/24/32/40/48/64/96/128/256 px entries and PNGs |
| Linux | hicolor PNG directories from 16–1024 px and scalable SVG |
| iOS / iPadOS | 1024 px light, dark and grayscale tinted RGB PNGs, with an Xcode `.appiconset` |
| visionOS | Two separate 1024 px layers in an Xcode `.solidimagestack`: opaque background and transparent foreground |
| Menu bar / tray | Monochrome macOS templates at 16/18/22 pt, 1× and 2×; light/dark Windows ICO and Linux PNGs; ready/update/attention/offline states |
| Website / PWA | Adaptive SVG favicon, ICO, 16/32/48 PNGs, 180 px touch icon, 192/512 regular and maskable icons, pinned-tab SVG, manifest and HTML snippet |
| Logo | Edited static SVG/PNG masters plus the original shipping animated light/dark SVGs |

Every collection includes `recipe.json`, integration instructions, and `export-manifest.json` describing its files. Dust is procedural raster artwork: its Linux SVG explicitly embeds a PNG. Static SVG mark layers remain true vectors. The original living animation is labelled separately and does not silently take on edited geometry.

## Artwork and masks

The studio keeps the flat ribbon identity. Appearance chooses white/black ink; platform output chooses the mask. The original lab's size tuning preserves the dust's light and increases the ribbon's optical weight at small sizes. The monochrome tray variant has a wider silhouette and minimum hairline, with actual alpha knockouts for status badges. At 16 px the favicon drops colored edge lights; larger favicons keep them.

Apple source layers and iOS PNGs are square and unmasked. Legacy macOS fallbacks use the lab's 824/1024 inset; that is this design's optical treatment, not a universal Apple requirement. Maskable artwork is fitted from the actual ribbon and glow bounds into the centered 80%-diameter safe circle. Menu-bar size variants are choices, not distinct system mandates.

Xcode and Icon Composer still compile modern Apple appearance effects and `Assets.car`; the studio exports their editable sources. Native target validation belongs in the app build. The generated bundle includes the commands and integration notes. Shipping product assets are not overwritten by this tool.

Validation on this Mac: 33 automated checks pass; browser downloads were decoded and checked; macOS ICNS/Windows ICO were opened by native utilities; Icon Composer rendered both plain and dust packages; Xcode compiled the macOS and iOS sources. The visionOS schema matches Xcode's installed template, but a native visionOS compile could not complete because this Mac has no visionOS simulator runtime installed.

## Sources and maintenance

`vendor/wormhole.mjs` contains the renderer, shaders, optical-size helpers, and palettes extracted from the user-supplied **Wormhole Dust(1).html**. `vendor/SOURCE.json` records the original SHA-256 and the one extension: the tuned small-image pass can render a background without the mark, so layered exports use the same field treatment. The active upstream lab lives in `../vf-splash`; do not edit the archived lab in this repository.

`build.mjs` copies the current design-kit living SVGs into `src/living-assets.mjs`, then uses the existing electron-shell esbuild installation to assemble one offline HTML file. Edit `src/`, `index.html`, and `src/studio.css`, then rebuild. The source template alone is not the runnable application.

The visionOS catalog schema follows the installed Xcode project template. Platform references used for the export contracts:

- [Apple app icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Icon Composer](https://developer.apple.com/icon-composer/)
- [Xcode asset catalogs](https://developer.apple.com/documentation/xcode/configuring-your-app-icon)
- [Template images](https://developer.apple.com/documentation/appkit/nsimage/istemplate)
- [Windows icon construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)
- [freedesktop icon theme layout](https://specifications.freedesktop.org/icon-theme/)
- [PWA and maskable icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons)
- [Safari pinned-tab masks](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/pinnedTabs/pinnedTabs.html)
