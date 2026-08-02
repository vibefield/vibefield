import {
  APP_PREFERENCE_KEYS,
  type AppPreferenceKey,
  AppPreferences,
  type DesktopShellState,
  type ShellPlatform,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { useState } from "react";
import { labelCls, SettingsRow, SettingsSection, SettingsSwitch } from "./settings-ui";

export function DesktopSection({
  platform,
  desktopState = null,
  onSettingsChanged,
}: {
  platform: ShellPlatform;
  desktopState?: DesktopShellState | null;
  onSettingsChanged?: (undoable: boolean) => void;
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
      onSettingsChanged?.(true);
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
  const trayIssue = showTray ? desktopState?.tray.issue : null;
  const effectiveBackgroundShell = desktopState?.tray.backgroundShellEffective ?? backgroundShell;

  return (
    <SettingsSection
      title="Desktop behavior"
      description="Choose how VibeField stays available outside this window. These preferences live with your synced user settings."
    >
      <SettingsRow
        title="Show status item"
        description="Keep VibeField within reach from the system menu bar or tray."
      >
        <SettingsSwitch
          label="Show status item"
          checked={showTray}
          disabled={unavailable || pending !== null}
          onChange={(checked) => {
            void setPreference(APP_PREFERENCE_KEYS.SHOW_TRAY, checked);
          }}
        />
      </SettingsRow>
      {trayIssue !== null && trayIssue !== undefined && (
        <div className="py-2 text-[12px] text-amber-600 dark:text-amber-400">
          {trayIssue.message} <span className={labelCls}>({trayIssue.code})</span>
        </div>
      )}
      {(platform === "win32" || platform === "linux") && (
        <>
          <SettingsRow
            title="Keep running after window closes"
            description="Continue syncing and remain available from the status item after closing the last window."
          >
            <SettingsSwitch
              label="Keep running after window closes"
              checked={effectiveBackgroundShell}
              disabled={unavailable || pending !== null || !showTray || trayUnavailable}
              onChange={(checked) => {
                void setPreference(APP_PREFERENCE_KEYS.BACKGROUND_SHELL, checked);
              }}
            />
          </SettingsRow>
          {!showTray && (
            <div className={`py-2 ${labelCls}`}>
              Background mode requires the status item so the app cannot become unreachable.
            </div>
          )}
        </>
      )}
      {subscription.status === "loading" && (
        <div className={`py-2 ${labelCls}`}>Loading preferences…</div>
      )}
      {subscription.status === "error" && (
        <div className="py-2 text-[12px] text-amber-600 dark:text-amber-400">
          Preferences unavailable.
        </div>
      )}
      {writeError !== null && (
        <div className="py-2 text-[12px] text-amber-600 dark:text-amber-400">{writeError}</div>
      )}
    </SettingsSection>
  );
}
