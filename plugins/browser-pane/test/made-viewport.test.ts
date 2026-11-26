// EY-1 (7b, 2026-11-19): a run's pane made with no page to open it from is a person's new pane:
// the pages plane's size and density (contracts) are this pane's default device, a laptop's page at
// its density.
import {
  PAGES_MADE_DEVICE_SCALE,
  PAGES_MADE_EMULATION,
  PAGES_MADE_VIEWPORT,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE, deviceIdentity } from "../src/devices";

describe("an agent's first pane (EY-1 7b)", () => {
  it("is a person's new pane: the default device's page, at its density", () => {
    expect(PAGES_MADE_VIEWPORT).toEqual({
      width: DEFAULT_DEVICE.width,
      height: DEFAULT_DEVICE.height,
    });
    expect(PAGES_MADE_DEVICE_SCALE).toBe(DEFAULT_DEVICE.dpr);
  });

  // EY-1 (F2, 2026-11-24): main makes a run's page on the device its pane is placed as, this pane's default. The
  // desk tells an adopted pane that device as its lane first goes live (its density, its layout, its fingers, its
  // agent; the scheme is the desk's own and is told live), and a page born on the same one is neither reloaded nor
  // made anew by that word. A default device that moves here moves the constant with it, or this row fails.
  it("is born on the default device: what the desk tells its pane first is no device switch", () => {
    const identity = deviceIdentity(DEFAULT_DEVICE);
    expect(PAGES_MADE_EMULATION).toEqual({
      deviceScaleFactor: DEFAULT_DEVICE.dpr,
      mobile: identity.mobile,
      touchPoints: identity.touchPoints,
    });
    // the constant names no agent because the default device has none of its own (the engine's)
    expect(identity.agent).toBeNull();
    expect("agent" in PAGES_MADE_EMULATION).toBe(false);
  });
});
