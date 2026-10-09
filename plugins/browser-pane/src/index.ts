// `@vibefield/plugin-browser-pane` — VibeField's browser pane as a plugin: the MANIFEST (host-read, authoring-emitted),
// the renderer MODULE, and the kind's own surface for tests. The host builds the object from the manifest (§12.2) and the
// kind from the export the manifest names — never from anything else exported here.
export * from "./address";
export * from "./device";
export * from "./devices";
export * from "./head";
export { drawHead, type HeadContext, headBitmap, headRaster } from "./head-canvas";
export { packRuns, type StillHead, stillHead, stillSplit, unpackHead } from "./head-still";
export * from "./ids";
export * from "./kind";
export * from "./law";
export * from "./layout";
export { createPaneLocal, type PaneLocal } from "./local";
export { browserPaneManifest } from "./manifest";
export { browserPane } from "./object";
export { PageTexture } from "./page";
export { PAGE_REMAKE_MS, PanePass, type PaneStats, PaneSurface } from "./pass";
export { default as browserPaneRenderer } from "./renderer";
export { PAGE_TEXELS_MAX, pageTexels, sampleFavicon, samplePage } from "./sample-page";
export * from "./shaders";
export * from "./theme";
