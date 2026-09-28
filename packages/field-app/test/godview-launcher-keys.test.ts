// @vitest-environment node
/**
 * QL-D2 — the one fact the launcher and the profile tab strip share: who owns
 * ⌥0–⌥9 and ⌥↵. The launcher's side (it sets the flag while the focused pane
 * shows a launcher) and the monitor's (its ⌥-digit listener yields while the
 * flag is set) are both tested where they live; this is the flag itself.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  launcherOwnsKeys,
  monitorHoldsKeys,
  resetLauncherKeys,
  setLauncherOwnsKeys,
  setMonitorHoldsKeys,
  subscribeMonitorHoldsKeys,
} from "../src/godview/monitor/launcher-keys";

afterEach(() => resetLauncherKeys());

describe("launcher-keys", () => {
  it("is unset until a launcher takes the keys, and unset again when it gives them back", () => {
    expect(launcherOwnsKeys()).toBe(false);
    setLauncherOwnsKeys(true);
    expect(launcherOwnsKeys()).toBe(true);
    setLauncherOwnsKeys(false);
    expect(launcherOwnsKeys()).toBe(false);
  });

  it("counts owners, so a remount's take is not erased by its predecessor's late give-back", () => {
    setLauncherOwnsKeys(true); // the old deck
    setLauncherOwnsKeys(true); // the new deck, before the old one's cleanup
    setLauncherOwnsKeys(false); // the old deck's cleanup
    expect(launcherOwnsKeys()).toBe(true);
    setLauncherOwnsKeys(false);
    expect(launcherOwnsKeys()).toBe(false);
  });

  it("never goes below none", () => {
    setLauncherOwnsKeys(false);
    setLauncherOwnsKeys(true);
    expect(launcherOwnsKeys()).toBe(true);
  });

  it("tells the deck when a monitor sheet takes or gives back the keyboard, once per flip", () => {
    const heard: boolean[] = [];
    const stop = subscribeMonitorHoldsKeys(() => heard.push(monitorHoldsKeys()));
    setMonitorHoldsKeys(true);
    setMonitorHoldsKeys(true); // a second holder: no flip
    setMonitorHoldsKeys(false);
    setMonitorHoldsKeys(false);
    stop();
    setMonitorHoldsKeys(true); // unsubscribed
    expect(heard).toEqual([true, false]);
    expect(monitorHoldsKeys()).toBe(true);
  });
});
