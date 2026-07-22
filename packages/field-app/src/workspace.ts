// The workspace chunk (ESR slice 4; design-03 §4.3 v0.3): everything heavy —
// ICE, three, loro, plugins, HUD, panels — behind ONE dynamic seam. The splash
// bundle stays tiny; the boot machine eagerly imports this right after first
// paint and the reveal gates on it plus document warmth. Nothing outside the
// boot layer may import this module statically (that would drag the world back
// into the initial graph — the bundle assertion enforces it).
export { FielddProvider } from "@vibefield/fieldd-client/react";
export { DocManager } from "./doc-manager";
export { FieldView } from "./field";
