// @vitest-environment happy-dom
/**
 * QL-D2 — the one fact the launcher and the profile tab strip share: who owns
 * ⌥0–⌥9 and ⌥↵. The launcher's side (it claims the keys, naming its pane,
 * while the focused pane shows a launcher) and the monitor's (its ⌥-digit
 * listener yields the keys routed into that pane) are both tested where they
 * live; this is the claim itself.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  launcherOwnsKeyEvent,
  launcherOwnsKeys,
  monitorHoldsKeys,
  resetLauncherKeys,
  setMonitorHoldsKeys,
  subscribeMonitorHoldsKeys,
  takeLauncherKeys,
} from "../src/godview/monitor/launcher-keys";

afterEach(() => {
  resetLauncherKeys();
  document.body.replaceChildren();
});

/** A pane holding a terminal's textarea, and an input outside every pane. */
function scene(): { pane: HTMLElement; textarea: HTMLElement; outside: HTMLElement } {
  const pane = document.createElement("div");
  const textarea = document.createElement("textarea");
  pane.append(textarea);
  const outside = document.createElement("input");
  document.body.append(pane, outside);
  return { pane, textarea, outside };
}

describe("launcher-keys", () => {
  it("owns nothing until a launcher claims the keys, and nothing again once it gives them back", () => {
    const { pane, textarea } = scene();
    expect(launcherOwnsKeys()).toBe(false);
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(false);
    const giveBack = takeLauncherKeys(() => pane);
    expect(launcherOwnsKeys()).toBe(true);
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(true);
    giveBack();
    giveBack(); // idempotent
    expect(launcherOwnsKeys()).toBe(false);
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(false);
  });

  it("owns only the keys routed into the claiming pane — never the monitor's, never another input's", () => {
    const { pane, textarea, outside } = scene();
    takeLauncherKeys(() => pane);
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(true);
    expect(launcherOwnsKeyEvent({ target: pane })).toBe(true);
    expect(launcherOwnsKeyEvent({ target: outside })).toBe(false);
    expect(launcherOwnsKeyEvent({ target: document.body })).toBe(false);
    expect(launcherOwnsKeyEvent({ target: window })).toBe(false);
    expect(launcherOwnsKeyEvent({ target: null })).toBe(false);
  });

  it("asks where the pane is at event time, so a pane that went owns nothing", () => {
    const { pane, textarea } = scene();
    let where: HTMLElement | null = pane;
    takeLauncherKeys(() => where);
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(true);
    where = null;
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(false);
  });

  it("keeps each claim its own, so a remount's take is not erased by its predecessor's late give-back", () => {
    const { pane, textarea } = scene();
    const oldDeck = takeLauncherKeys(() => pane);
    const newDeck = takeLauncherKeys(() => pane);
    oldDeck();
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(true);
    newDeck();
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(false);
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
