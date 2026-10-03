import type { ThemeName } from "@vibefield/contracts";
import { useAppTheme } from "../theme";
import { type DeckAppearance, useDeckAppearance } from "./deck-appearance";
import type { GodviewTheme } from "./GodviewTuningPanel";

// GODVIEW'S LIGHT (One Frame FC-D7; DESIGN.md §1.1): the app's one theme. Until
// FR-4 Godview kept a mode of its own — its bar's ☼◐ switch, remembered per
// renderer under `vf-godview-color-theme-v1` — independent of the app's; both
// retired, and the key is read by nothing. What is left is the one override
// the ruling kept, in Settings → Terminal → Look (`DeckAppearance.modeOverride`):
// set, it wins; unset, Godview is whatever the app resolves to.

export function godviewThemeFor(
  app: ThemeName,
  appearance: Pick<DeckAppearance, "modeOverride">,
): GodviewTheme {
  return appearance.modeOverride ?? app;
}

/** The mode Godview draws in now — the app's, or the override's. */
export function useGodviewTheme(): GodviewTheme {
  const { resolved } = useAppTheme();
  return godviewThemeFor(resolved, useDeckAppearance());
}
