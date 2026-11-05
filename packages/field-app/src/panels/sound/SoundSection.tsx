import {
  APP_PREFERENCE_KEYS,
  type AppPreferenceSetParams,
  AppPreferences,
  type SoundPlayerState,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { isQuiet, quietEnd } from "@vibefield/sound";
import { type ReactElement, useEffect, useState } from "react";
import { peekHost } from "../../host";
import { type SoundSettingsModel, SoundSettingsView } from "./SoundSettings";

/** "8:00 AM", in this Mac's own format (§8: "the time in this Mac's own format"). */
const timeOf = (epochMs: number): string =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(epochMs),
  );

function say(event: string, message: string, error: unknown): void {
  try {
    peekHost()?.logger.warn(event, message, {
      error: (error instanceof Error ? error.message : String(error)).slice(0, 512),
    });
  } catch {
    // a logging fault never escapes a settings page
  }
}

/** Settings → Sound, live: Play sounds and Quiet on the person's synced preferences (fieldd's
 * `storage.appPreferences`, as every preference on the General page), the player's state and a Play through main's
 * sound door. A host with no sound door (a browser harness) has no player: it says so as any Mac without one does. */
export function SoundSection(): ReactElement | null {
  const client = useFielddClient();
  const subscription = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const parsed = AppPreferences.safeParse(subscription.data);
  const preferences = parsed.success ? parsed.data : null;
  const sound = peekHost()?.sound;
  const [player, setPlayer] = useState<SoundPlayerState | null>(
    sound === undefined ? "missing" : null,
  );
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sound === undefined) return;
    let live = true;
    void sound.state().then(
      (state) => live && setPlayer(state),
      () => live && setPlayer("failed"),
    );
    return () => {
      live = false;
    };
  }, [sound]);

  // Quiet ends by itself: the page reads on again at its moment
  const until = preferences?.soundsQuietUntil;
  useEffect(() => {
    if (until === undefined || !isQuiet(until, Date.now())) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(until - Date.now() + 50, 2 ** 31 - 1),
    );
    return () => clearTimeout(timer);
  }, [until]);

  const set = async (params: AppPreferenceSetParams): Promise<void> => {
    setPending(true);
    try {
      await client.request("storage.appPreferences.set", params);
    } catch (error) {
      // the switch stays where fieldd says it is: the snapshot is the truth, and the fault is said in the log
      say("renderer.sound.preference_failed", "A sound preference could not be set", error);
    } finally {
      setPending(false);
      setNow(Date.now());
    }
  };

  if (player === null) return null;
  const model: SoundSettingsModel = {
    on: preferences?.sounds ?? true,
    player,
    writable: preferences !== null && subscription.status === "live" && !pending,
    ...(until !== undefined && isQuiet(until, now) ? { quietUntilText: timeOf(until) } : {}),
  };
  return (
    <SoundSettingsView
      model={model}
      onSounds={(on) => void set({ key: APP_PREFERENCE_KEYS.SOUNDS, value: on })}
      onPlay={(cue) =>
        void sound
          ?.preview(cue)
          .catch((error: unknown) =>
            say("renderer.sound.preview_failed", "A Play could not reach main", error),
          )
      }
      onQuiet={(quiet) =>
        void set({
          key: APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL,
          value: quiet === null ? null : quietEnd(quiet, new Date()),
        })
      }
    />
  );
}
