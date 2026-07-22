/**
 * Shared app-state prop shapes for the three ported v1 panels.
 *
 * In v1 these lived in the playground's `App.ts` (`ThemeColors`,
 * `OverlapGlowThemeColors`) or the engine package (`OverlapGlowConfig`). v3's
 * engine has NO GL overlap-glow pass, so `OverlapGlowConfig` has no `@ice/*`
 * counterpart — it is re-declared here (field-for-field with v1) as pure app
 * state. The App owns these values and pipes them wherever a v3 consumer
 * exists (grid → `<InfiniteCanvas grid>`; theme → CSS vars); the glow configs
 * currently have NO engine consumer (see SettingsPanel's "Overlap Glow"
 * section comment) and are carried for a future CSS-level adaptation.
 */

/** Dot + background colours, split per light/dark theme (v1 App.ThemeColors). */
export interface ThemeColors {
  dotLight: string;
  dotDark: string;
  bgLight: string;
  bgDark: string;
}

/**
 * v1's `OverlapGlowConfig` (from `@jamesyong42/infinite-canvas`), re-declared:
 * the [candidate, target] tuples drive a GL radial glow + edge rim in v1. v3
 * has no such pass — this is app state with no engine seam (reported).
 */
export interface OverlapGlowConfig {
  glowColor: [number, number, number];
  glowAlpha: [number, number];
  glowSize: [number, number];
  rimColor: [number, number, number];
  rimWidth: number;
  rimAlpha: [number, number];
  rimRadius: number;
}

/** Theme-split glow + rim colours (v1 App.OverlapGlowThemeColors). */
export interface OverlapGlowThemeColors {
  glowLight: string;
  glowDark: string;
  rimLight: string;
  rimDark: string;
}
