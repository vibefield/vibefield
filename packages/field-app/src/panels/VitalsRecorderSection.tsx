import { APP_PREFERENCE_KEYS, AppPreferences } from "@vibefield/contracts";
import { UiButton } from "@vibefield/design-kit";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import { type FieldVitalsHost, peekHost } from "../host";
import { labelCls, SettingsRow, SettingsSection, SettingsSwitch } from "./settings-ui";

// VT-2b (track VT, 2026-11-24; VT-D2's second half; DESIGN.md §8 "Vitals", the recorder's switch) — Settings →
// Diagnostics' Vitals section: one row, Record vitals. It is an app preference like the page's neighbours' (synced,
// undoable); fieldd follows it, and off stops the measuring on the floor as well as in fieldd.
// VT-2c (2026-11-24) — and the section's one door, Open Vitals, through the host to main; none where no main is.

export const VITALS_SECTION_TITLE = "Vitals";
export const VITALS_SECTION_LINE =
  "CPU and memory of VibeField's own processes, read once a second and kept for thirty minutes on this computer.";
export const RECORD_VITALS_TITLE = "Record vitals";
export const RECORD_VITALS_LINE =
  "Off stops the measuring and drops what was kept. The window is under Window → Vitals.";
/** VT-2c (2026-11-24) — the section's one door: the Window menu's action, from Settings. */
export const OPEN_VITALS = "Open Vitals";

export function VitalsRecorderSection({
  onSettingsChanged,
  door = peekHost()?.vitals,
}: {
  onSettingsChanged?: (undoable: boolean) => void;
  /** VT-2c — main's door to the Vitals window; absent (a browser harness) draws no button */
  door?: FieldVitalsHost | undefined;
}): ReactElement {
  const client = useFielddClient();
  const subscription = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const parsed = AppPreferences.safeParse(subscription.data);
  const preferences = parsed.success ? parsed.data : null;
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const setRecording = async (value: boolean): Promise<void> => {
    setPending(true);
    setWriteError(null);
    try {
      await client.request("storage.appPreferences.set", {
        key: APP_PREFERENCE_KEYS.RECORD_VITALS,
        value,
      });
      onSettingsChanged?.(true);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  const openVitals = async (): Promise<void> => {
    if (door === undefined) return;
    setOpenError(null);
    try {
      await door.open();
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  };

  const unavailable = subscription.status !== "live" || preferences === null;
  return (
    <SettingsSection title={VITALS_SECTION_TITLE} description={VITALS_SECTION_LINE}>
      <SettingsRow title={RECORD_VITALS_TITLE} description={RECORD_VITALS_LINE}>
        <SettingsSwitch
          label={RECORD_VITALS_TITLE}
          checked={preferences?.recordVitals ?? true}
          disabled={unavailable || pending}
          onChange={(checked) => {
            void setRecording(checked);
          }}
        />
      </SettingsRow>
      {door !== undefined && (
        <div className="flex justify-end pt-2">
          <UiButton
            onClick={() => {
              void openVitals();
            }}
          >
            {OPEN_VITALS}
          </UiButton>
        </div>
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
      {openError !== null && (
        <div className="py-2 text-[12px] text-amber-600 dark:text-amber-400">{openError}</div>
      )}
    </SettingsSection>
  );
}
