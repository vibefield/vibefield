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
  screenshotHotkey: true,
  // UA-D7: `automatic` IS today's behavior, and that is why it is the default —
  // UA-6 must be invisible to a field nobody has touched a switch in.
  syncPosture: "automatic",
  // AL-3 — a quit that would end sessions asks first, until the person says not to
  confirmQuit: true,
  // TS-4 (TS-D7) — after Not now, VibeField asks again where it helps, until the
  // person turns that off in Settings → Devices
  connectAsks: true,
  // AL-6 (AL-D2) — a quit quits, until the person asks it to keep running
  keepRunningOnQuit: false,
  // SD-2 (SD-D19) — the field's sounds play from the first run, until the person turns them off. No Quiet by
  // default: `soundsQuietUntil` is absent until someone quiets them.
  sounds: true,
};

export function effectiveAppPreferences(values: Readonly<Record<string, unknown>>): AppPreferences {
  const showTray = values[APP_PREFERENCE_KEYS.SHOW_TRAY];
  const backgroundShell = values[APP_PREFERENCE_KEYS.BACKGROUND_SHELL];
  const screenshotHotkey = values[APP_PREFERENCE_KEYS.SCREENSHOT_HOTKEY];
  const posture = MeshSyncPosture.safeParse(values[APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE]);
  const confirmQuit = values[APP_PREFERENCE_KEYS.CONFIRM_QUIT];
  const connectAsks = values[APP_PREFERENCE_KEYS.CONNECT_ASKS];
  const keepRunningOnQuit = values[APP_PREFERENCE_KEYS.KEEP_RUNNING_ON_QUIT];
  const sounds = values[APP_PREFERENCE_KEYS.SOUNDS];
  const quietUntil = values[APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL];
  return {
    showTray: typeof showTray === "boolean" ? showTray : DEFAULT_APP_PREFERENCES.showTray,
    backgroundShell:
      typeof backgroundShell === "boolean"
        ? backgroundShell
        : DEFAULT_APP_PREFERENCES.backgroundShell,
    syncPosture: posture.success ? posture.data : DEFAULT_APP_PREFERENCES.syncPosture,
    screenshotHotkey:
      typeof screenshotHotkey === "boolean"
        ? screenshotHotkey
        : DEFAULT_APP_PREFERENCES.screenshotHotkey,
    confirmQuit:
      typeof confirmQuit === "boolean" ? confirmQuit : DEFAULT_APP_PREFERENCES.confirmQuit,
    connectAsks:
      typeof connectAsks === "boolean" ? connectAsks : DEFAULT_APP_PREFERENCES.connectAsks,
    keepRunningOnQuit:
      typeof keepRunningOnQuit === "boolean"
        ? keepRunningOnQuit
        : DEFAULT_APP_PREFERENCES.keepRunningOnQuit,
    sounds: typeof sounds === "boolean" ? sounds : DEFAULT_APP_PREFERENCES.sounds,
    // SD-2 (SD-D22) — Turn sounds back on writes null; the doc keeps the key and the snapshot drops it. Anything that
    // is not a moment (a newer build's word, a corrupted value) is no Quiet: sounds are never held back by a guess.
    ...(isQuietMoment(quietUntil) ? { soundsQuietUntil: quietUntil } : {}),
  };
}

function isQuietMoment(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
