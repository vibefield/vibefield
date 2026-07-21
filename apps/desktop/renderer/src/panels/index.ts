/**
 * The panels barrel — the two v1-playground chrome panels ported to the v3
 * engine (Settings + Inspector). NavigationBreadcrumbs lives in hud/ and is
 * imported directly there; FieldView mounts all three as overlays and owns the
 * controlled state (gridConfig, theme, glow) they edit.
 */
export { InspectorPanel } from "./InspectorPanel";
export { SettingsPanel } from "./SettingsPanel";
export type { OverlapGlowConfig, OverlapGlowThemeColors, ThemeColors } from "./types";
