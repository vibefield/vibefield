import {
  APP_PREFERENCE_KEYS,
  type AppPreferences,
  type DocSyncIntent,
  MeshSyncPosture,
} from "@vibefield/contracts";

/** Defaults are product behavior, not call-site guesses. Persisted values are
 * sparse so a future default migration remains possible without rewriting the
 * settings document. */
export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = {
  showTray: true,
  backgroundShell: true,
  // UA-D7: `automatic` IS today's behavior, and that is why it is the default —
  // UA-6 must be invisible to a field nobody has touched a switch in.
  syncPosture: "automatic",
};

export function effectiveAppPreferences(values: Readonly<Record<string, unknown>>): AppPreferences {
  const showTray = values[APP_PREFERENCE_KEYS.SHOW_TRAY];
  const backgroundShell = values[APP_PREFERENCE_KEYS.BACKGROUND_SHELL];
  const posture = MeshSyncPosture.safeParse(values[APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE]);
  return {
    showTray: typeof showTray === "boolean" ? showTray : DEFAULT_APP_PREFERENCES.showTray,
    backgroundShell:
      typeof backgroundShell === "boolean"
        ? backgroundShell
        : DEFAULT_APP_PREFERENCES.backgroundShell,
    syncPosture: posture.success ? posture.data : DEFAULT_APP_PREFERENCES.syncPosture,
  };
}

/** UA-D7 — the whole intent question, in one place both planes can point at.
 *
 * A doc that has answered for itself is believed; silence defers to the user's
 * posture. The asymmetry is deliberate: `opt-in` means "ask me", so a doc that
 * has never been asked stays home. */
export function resolveSyncIntent(
  entryIntent: DocSyncIntent | undefined,
  posture: AppPreferences["syncPosture"],
): DocSyncIntent {
  if (entryIntent !== undefined) return entryIntent;
  return posture === "opt-in" ? "local" : "sync";
}
