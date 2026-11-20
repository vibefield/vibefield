import {
  APP_PREFERENCE_KEYS,
  AppPreferences,
  type DeskLightValues,
  deskLightToSet,
  deskLightValues,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../field/desk/bar/bar-motion";
import { deskShadeCss } from "../../field/desk/desk-light";
import { holdDeskLight, storeDeskLight } from "../../field/desk/desk-light-live";
import { peekHost } from "../../host";
import { useAppTheme } from "../../theme";
import { LightSettingsView, type PlantSilhouettes } from "./LightSettings";

function say(event: string, message: string, error: unknown): void {
  try {
    peekHost()?.logger.warn(event, message, {
      error: (error instanceof Error ? error.message : String(error)).slice(0, 512),
    });
  } catch {
    // a logging fault never escapes a settings page
  }
}

const same = (a: DeskLightValues, b: DeskLightValues): boolean =>
  JSON.stringify(deskLightToSet(a)) === JSON.stringify(deskLightToSet(b));

/** Settings → Canvas's Light, live: the person's synced preference (fieldd's `storage.appPreferences`, the one key
 * `desk.light`). A row in hand moves the desk at once (`holdDeskLight`) and is written when it is let go: one write,
 * one undo step. The page's own state is only what is in hand; the snapshot is the truth. */
export function LightSection(): ReactElement {
  const client = useFielddClient();
  const subscription = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const parsed = AppPreferences.safeParse(subscription.data);
  const preferences = parsed.success ? parsed.data : null;
  const stored = deskLightValues(preferences?.deskLight);
  const theme = useAppTheme().resolved;
  const reducedMotion = useReducedMotion();
  // the rows in hand: a slider being dragged, or a choice on its way to fieldd
  const [inHand, setInHand] = useState<DeskLightValues | null>(null);
  const [pending, setPending] = useState(false);
  const [silhouettes, setSilhouettes] = useState<PlantSilhouettes>();
  const values = inHand ?? stored;
  const latest = useRef(values);
  latest.current = values;
  // one write at a time: a slider's pointer-up and its blur are one letting go, never two writes
  const writing = useRef(false);
  // a write went out and its snapshot is awaited
  const wrote = useRef(false);

  // the plants' shadows are a chunk of their own: the page draws the bare mat until they arrive
  useEffect(() => {
    let live = true;
    void import("./plant-silhouettes").then(
      (m) => live && setSilhouettes(m.PLANT_SILHOUETTES),
      (error: unknown) =>
        say("renderer.light.silhouettes_failed", "The plants' shadows did not load", error),
    );
    return () => {
      live = false;
    };
  }, []);

  // the desk lets go of the rows in hand when the page does
  useEffect(() => () => holdDeskLight(null), []);

  const hold = (next: DeskLightValues | null): void => {
    setInHand(next);
    holdDeskLight(next);
  };

  const write = async (next: DeskLightValues): Promise<void> => {
    if (writing.current) return;
    if (same(next, stored)) {
      hold(null);
      return;
    }
    writing.current = true;
    hold(next);
    setPending(true);
    try {
      await client.request("storage.appPreferences.set", {
        key: APP_PREFERENCE_KEYS.DESK_LIGHT,
        value: deskLightToSet(next),
      });
      // written: the rows stay in hand until the snapshot says them (the effect below), so nothing flickers back
      wrote.current = true;
    } catch (error) {
      // the rows go back to what fieldd says: the snapshot is the truth, and the fault is said in the log
      say("renderer.light.preference_failed", "The desk's light could not be set", error);
      hold(null);
    } finally {
      writing.current = false;
      setPending(false);
    }
  };

  // the snapshot caught up with what was written: let go. A snapshot that never says it (a write another desktop
  // overtook) is believed after a moment all the same.
  const settled = inHand !== null && !pending && same(inHand, stored);
  useEffect(() => {
    if (inHand === null || pending) return;
    if (settled) {
      // the rows in hand ARE the preference now: hand them to the window's store before letting go, so the desk
      // does not wear the older light for the moment before the field's own read of the same snapshot lands
      storeDeskLight(inHand);
      setInHand(null);
      holdDeskLight(null);
      return;
    }
    if (!wrote.current) return;
    const timer = setTimeout(() => {
      wrote.current = false;
      setInHand(null);
      holdDeskLight(null);
    }, 1500);
    return () => clearTimeout(timer);
  }, [inHand, pending, settled]);

  return (
    <LightSettingsView
      model={{
        values,
        theme,
        shade: deskShadeCss(values, theme),
        reducedMotion,
        writable: preferences !== null && subscription.status === "live",
        busy: pending,
        ...(silhouettes === undefined ? {} : { silhouettes }),
      }}
      onPlant={(plant) => void write({ ...latest.current, plant })}
      onMirror={(mirror) => void write({ ...latest.current, mirror })}
      onSlide={(row, value) => {
        wrote.current = false;
        hold({ ...latest.current, [row]: value });
      }}
      onLetGo={() => {
        if (inHand !== null && !pending && !wrote.current) void write(latest.current);
      }}
      onReset={() => void write(deskLightValues(undefined))}
    />
  );
}
