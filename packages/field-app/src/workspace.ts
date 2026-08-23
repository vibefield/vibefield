// The workspace chunk (ESR slice 4; design-03 §4.3 v0.3): everything heavy —
// ICE, three, loro, plugins, HUD, panels — behind ONE dynamic seam. The splash
// bundle stays tiny; the boot machine eagerly imports this right after first
// paint and the reveal gates on it plus document warmth. Nothing outside the
// boot layer may import this module statically (that would drag the world back
// into the initial graph — the bundle assertion enforces it).
export { FielddProvider } from "@vibefield/fieldd-client/react";
export { DocManager } from "./doc-manager";
export { FieldView } from "./field";
// P8b-3: the staged loader lives behind this seam too — it imports the plugin
// host, which is workspace weight, and the boot machine reaches it the same way
// it reaches DocManager (through the module it already dynamically imported).
export { prepareFieldPlugins } from "./field-engine";
// TP-S3/G23: bootstrap config is applied only after this heavy chunk lands, so
// the splash bundle does not pull the terminal worker/runtime into first paint.
export { configureTerminalPool } from "./terminal/pool";
