// `@vibefield/plugin-comment-pad` — VibeField's comment pad as a plugin: the MANIFEST (host-read, authoring-
// emitted), the renderer MODULE, and the kind's own surface for tests. The host builds the object from the
// manifest (§12.2) and the kind from the export the manifest names — never from anything else exported here.
export * from "./body";
export * from "./ids";
export * from "./kind";
export * from "./law";
export * from "./layout";
export { commentPadManifest } from "./manifest";
export { commentPad, padDriver } from "./object";
export { INK_LAYER, type InkBitmap, PadInk, PadPass } from "./pass";
export { default as commentPadRenderer } from "./renderer";
export * from "./shaders";
export * from "./theme";
export * from "./typing";
export * from "./writing";
