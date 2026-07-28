import { APP_PREFERENCE_KEYS, type AppPreferences } from "@vibefield/contracts";

/** Defaults are product behavior, not call-site guesses. Persisted values are
 * sparse so a future default migration remains possible without rewriting the
 * settings document. */
export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = {
  showTray: true,
  backgroundShell: true,
};

export function effectiveAppPreferences(values: Readonly<Record<string, unknown>>): AppPreferences {
  const showTray = values[APP_PREFERENCE_KEYS.SHOW_TRAY];
  const backgroundShell = values[APP_PREFERENCE_KEYS.BACKGROUND_SHELL];
  return {
    showTray: typeof showTray === "boolean" ? showTray : DEFAULT_APP_PREFERENCES.showTray,
    backgroundShell:
      typeof backgroundShell === "boolean"
        ? backgroundShell
        : DEFAULT_APP_PREFERENCES.backgroundShell,
  };
}
