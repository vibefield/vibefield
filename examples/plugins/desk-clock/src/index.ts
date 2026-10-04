// `@vibefield/plugin-example-desk-clock` — ICE's analogue desk clock as a VibeField plugin: the
// MANIFEST (host-read, authoring-emitted), the renderer MODULE, and the kind's own surface for tests
// and the docs. The host builds the prefab from the manifest (§12.2) and the kind from the export the
// manifest names — never from anything else exported here.
export * from "./broken";
export * from "./glyphs";
export * from "./ids";
export * from "./kind";
export * from "./law";
export * from "./layout";
export * from "./local";
export { deskClockManifest } from "./manifest";
export { clock } from "./object";
export { ClockPass } from "./pass";
export { default as deskClockRenderer } from "./renderer";
export * from "./shaders";
export * from "./theme";
