// EY-1 (F2, 2026-11-24) — A RUN'S PAGE AND THE DESK'S FIRST WORD OF ITS DEVICE. Main makes a run's page on contracts'
// PAGES_MADE_EMULATION. When a window adopts the page, the desk tells its pane's device as the lane first goes live:
// `emulationOf` of the pane's spec. That word reloads nothing and makes no window anew only while it differs from the
// page's own emulation by the colour scheme alone (a scheme is told live; an agent, a layout, fingers or a density is
// a device switch). Three rows hold the chain:
// - the browser pane's own (plugins/browser-pane, made-viewport.test.ts): the constant is its default device;
// - this one: what the desk SAYS of a pane on that device is the constant and the scheme, nothing else;
// - main's (electron-shell, browser-live-surface-runtime.test.ts): a made page told the constant and a scheme is not
//   switched.
// A field `emulationOf` gains (anything but the scheme) fails here until the constant has it too.
import { PAGES_MADE_EMULATION } from "@vibefield/contracts";
import type { LiveBrowserSpec } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { emulationOf } from "../src/surfaces/live/desk-live";

describe("a run's page and the desk's first word of its device (EY-1 F2)", () => {
  /** A made pane as the desk reads it: on the made page's device, which names no agent of its own. */
  const pane = (scheme: LiveBrowserSpec["scheme"]): LiveBrowserSpec => ({
    source: "browser",
    url: "https://example.test/",
    viewport: [1280, 800],
    deviceScaleFactor: PAGES_MADE_EMULATION.deviceScaleFactor,
    scheme,
    label: "Browser",
    device: {
      mobile: PAGES_MADE_EMULATION.mobile,
      touchPoints: PAGES_MADE_EMULATION.touchPoints,
      agent: null,
    },
  });

  it("is the made page's own emulation and the desk's scheme, nothing else, in either scheme", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(emulationOf(pane(scheme))).toEqual({ ...PAGES_MADE_EMULATION, colorScheme: scheme });
    }
  });

  it("and the same for a pane that names no device at all: none named is a pointer device of the engine's own agent", () => {
    const { device: _none, ...bare } = pane("light");
    expect(emulationOf(bare)).toEqual({ ...PAGES_MADE_EMULATION, colorScheme: "light" });
  });
});
