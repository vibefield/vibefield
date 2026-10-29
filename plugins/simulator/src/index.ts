// `@vibefield/plugin-simulator` — VibeField's iOS Simulator as a plugin: the MANIFEST (host-read, authoring-emitted), the
// renderer MODULE, and the kind's own surface for tests and the playground. The host builds the object from the manifest
// (§12.2) and the kind from the export the manifest names — never from anything else exported here.
export * from "./binding";
export { PHONES } from "./catalog.gen";
export * from "./face";
export * from "./fixture";
export * from "./ids";
export * from "./kind";
export * from "./law";
export * from "./layout";
export * from "./live";
export { createSimulatorLocal, noticeBudgetKey, type SimulatorLocal } from "./local";
export { PHONE_SIZE, simulatorManifest } from "./manifest";
export type * from "./model";
export * from "./morph";
export * from "./notice";
export {
  drawWords,
  type WordsCanvas,
  type WordsContext,
  wordsBytes,
  wordsRaster,
  wrapLines,
} from "./notice-canvas";
export { simulator } from "./object";
export { PhonePass, type PhoneStats, PhoneSurface } from "./pass";
export { default as simulatorRenderer } from "./renderer";
export * from "./shaders";
export * from "./theme";
