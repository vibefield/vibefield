// The GL-card surface, deliberately OUTSIDE the root barrel: GlLiftGroup's
// runtime `@vibecook/ice/r3f` import is the door to three + R3F, and one
// class-name import from a boot-reachable module must never open it — the
// 2026-08-10 splash-bundle incident's class (docs/UI_SYSTEM.md §Rules).
// DOM-only consumers import the root or a deep entry; GL cards import this.
// DK-2 (desk/landing, ICE 0.14.0): `/r3f` is gone and the SDK's `/ui` door stopped
// re-exporting this entry, so nothing imports it; it retires at DK-17.
export { makeGlCardChrome } from "./GlCardChrome";
export { GlLiftGroup } from "./GlLiftGroup";
