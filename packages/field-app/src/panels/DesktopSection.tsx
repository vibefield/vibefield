import {
  APP_PREFERENCE_KEYS,
  type AppPreferenceKey,
  AppPreferences,
  type DesktopShellState,
  type ShellPlatform,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { useState } from "react";
import { borderCls, labelCls, sectionCls } from "./SettingsPanel";

export function DesktopSection({
  platform,
  desktopState = null,
}: {
  platform: ShellPlatform;
  desktopState?: DesktopShellState | null;
}) {
  const client = useFielddClient();
  const subscription = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const parsed = AppPreferences.safeParse(subscription.data);
  const preferences = parsed.success ? parsed.data : null;
  const [pending, setPending] = useState<AppPreferenceKey | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const setPreference = async (key: AppPreferenceKey, value: boolean): Promise<void> => {
    setPending(key);
    setWriteError(null);
    try {
      await client.request("storage.appPreferences.set", { key, value });
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  };

  const unavailable = subscription.status !== "live" || preferences === null;
  const showTray = preferences?.showTray ?? true;
  const backgroundShell = preferences?.backgroundShell ?? true;
  const trayUnavailable = desktopState?.tray.availability === "unavailable";
  const effectiveBackgroundShell = desktopState?.tray.backgroundShellEffective ?? backgroundShell;

  return (
    <div className={borderCls}>
      <div className={sectionCls}>Desktop</div>
      <label className="flex items-center justify-between gap-3 py-0.5">
        <span className={labelCls}>Show status item</span>
        <input
          type="checkbox"
          checked={showTray}
          disabled={unavailable || pending !== null}
          onChange={(event) => {
            void setPreference(APP_PREFERENCE_KEYS.SHOW_TRAY, event.currentTarget.checked);
          }}
        />
      </label>
      {(platform === "win32" || platform === "linux") && (
        <>
          <label className="flex items-center justify-between gap-3 py-0.5">
            <span className={labelCls}>Keep running after window closes</span>
            <input
              type="checkbox"
              checked={effectiveBackgroundShell}
              disabled={unavailable || pending !== null || !showTray || trayUnavailable}
              onChange={(event) => {
                void setPreference(
                  APP_PREFERENCE_KEYS.BACKGROUND_SHELL,
                  event.currentTarget.checked,
                );
              }}
            />
          </label>
          {!showTray && (
            <div className={labelCls}>Requires the status item so the app cannot be trapped.</div>
          )}
          {trayUnavailable && desktopState?.tray.issue !== null && (
            <div className="text-amber-600 dark:text-amber-400">
              Status item unavailable for this session. Closing this window quits VibeField.{" "}
              <span className={labelCls}>({desktopState.tray.issue.code})</span>
            </div>
          )}
        </>
      )}
      {subscription.status === "loading" && <div className={labelCls}>Loading preferences…</div>}
      {subscription.status === "error" && (
        <div className="text-amber-600 dark:text-amber-400">Preferences unavailable.</div>
      )}
      {writeError !== null && (
        <div className="text-amber-600 dark:text-amber-400">{writeError}</div>
      )}
    </div>
  );
}
