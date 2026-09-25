import type { GodviewTheme } from "./GodviewTuningPanel";

/** Godview's own light/dark mode, remembered per renderer — independent of
 * the app theme (the bar's switch sets it). */
export const GODVIEW_THEME_STORAGE_KEY = "vf-godview-color-theme-v1";

/** The mode Godview opens in: the one last chosen, else light. */
export function storedGodviewTheme(): GodviewTheme {
  try {
    return localStorage.getItem(GODVIEW_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
