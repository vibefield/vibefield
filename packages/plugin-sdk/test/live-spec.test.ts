// PT-2 — THE PAGE A BROWSER FACE OPENS: the `spec` a browser kind hands the host's `LIVE` service, typed on the `/desk` door so
// the plugin and the host read one shape (ICE design-019 §3.2 — the host's contract, never the desk's). The host refuses what it
// cannot read rather than guessing at it.
import { describe, expect, it } from "vitest";
import {
  LIVE_BROWSER_FAILURES,
  LIVE_SIMULATOR_STATES,
  type LiveBrowserSpec,
  type LiveSimulatorSpec,
  liveBrowserFailure,
  liveBrowserFailureReason,
  liveBrowserSpec,
  liveSimulatorFace,
  liveSimulatorSpec,
} from "../src/desk";

const PAGE: LiveBrowserSpec = {
  source: "browser",
  url: "https://lumen.example/",
  viewport: [1280, 800],
  deviceScaleFactor: 2,
  scheme: "light",
  label: "Browser",
};

describe("liveBrowserSpec — the host reads a browser face's page", () => {
  it("reads the page a browser kind sends, whole", () => {
    expect(liveBrowserSpec({ ...PAGE })).toEqual(PAGE);
    expect(liveBrowserSpec({ ...PAGE, viewport: [402, 874], scheme: "dark" })).toEqual({
      ...PAGE,
      viewport: [402, 874],
      scheme: "dark",
    });
  });

  it("refuses a spec that is not a browser page, or a field it cannot read", () => {
    expect(liveBrowserSpec({ ...PAGE, source: "capture" })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, url: "" })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, url: 42 })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [1280] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [1280.5, 800] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [0, 800] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [1280, 40_000] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, deviceScaleFactor: 0 })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, deviceScaleFactor: 9 })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, deviceScaleFactor: "2" })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, deviceScaleFactor: undefined })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, scheme: "desk" })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, label: undefined })).toBeUndefined();
    expect(liveBrowserSpec({})).toBeUndefined();
  });

  it("reads only the fields it names — a spec's extra words never ride along", () => {
    expect(liveBrowserSpec({ ...PAGE, token: "a ticket" })).toEqual(PAGE);
  });

  it("PT-4: reads the DEVICE the page is seen as — a phone's agent with its hints, its fingers; the engine's own as null — and refuses half a device", () => {
    const phone = {
      mobile: true,
      touchPoints: 5,
      agent: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Mobile/15E148 Safari/604.1",
        navigatorPlatform: "iPhone",
        platform: "iOS",
        platformVersion: "26.0",
        model: "iPhone",
      },
    };
    expect(liveBrowserSpec({ ...PAGE, device: phone })).toEqual({ ...PAGE, device: phone });
    const laptop = { mobile: false, touchPoints: 0, agent: null };
    expect(liveBrowserSpec({ ...PAGE, device: laptop })).toEqual({ ...PAGE, device: laptop });
    // none named: none read (a host takes that as a pointer device of its engine's own)
    expect(liveBrowserSpec({ ...PAGE })).not.toHaveProperty("device");
    // its extra words never ride along
    expect(
      liveBrowserSpec({
        ...PAGE,
        device: { ...phone, agent: { ...phone.agent, secret: 1 }, note: 2 },
      }),
    ).toEqual({ ...PAGE, device: phone });
    for (const device of [
      null,
      "phone",
      { touchPoints: 5, agent: null },
      { mobile: "yes", touchPoints: 5, agent: null },
      { mobile: true, agent: null },
      { mobile: true, touchPoints: -1, agent: null },
      { mobile: true, touchPoints: 11, agent: null },
      { mobile: true, touchPoints: 2.5, agent: null },
      { mobile: true, touchPoints: 5 },
      { mobile: true, touchPoints: 5, agent: "Mozilla" },
      { ...phone, agent: { ...phone.agent, userAgent: "" } },
      { ...phone, agent: { ...phone.agent, userAgent: "a\nb" } },
      { ...phone, agent: { ...phone.agent, userAgent: "x".repeat(513) } },
      { ...phone, agent: { ...phone.agent, platform: undefined } },
      { ...phone, agent: { ...phone.agent, model: 17 } },
      { ...phone, agent: { ...phone.agent, navigatorPlatform: "p".repeat(33) } },
    ])
      expect(liveBrowserSpec({ ...PAGE, device }), JSON.stringify(device)).toBeUndefined();
  });
});

describe("PT-5a — why a browser face failed: the host's word, read by the kind", () => {
  it("the words are a closed set: a load's reasons, a page that stopped, a lane lost, a page the desk may not open, anything else", () => {
    expect(LIVE_BROWSER_FAILURES).toEqual([
      "name-not-resolved",
      "offline",
      "connection-refused",
      "connection-failed",
      "timed-out",
      "certificate",
      "blocked",
      "no-document",
      "load-stopped",
      "load-failed",
      "stopped",
      "unresponsive",
      "lost",
      "may-not",
      "failed",
    ]);
  });

  it("a reason is the word, then the host's own detail after a colon — and reads back as its word, whatever the detail says", () => {
    for (const word of LIVE_BROWSER_FAILURES) {
      expect(liveBrowserFailureReason(word)).toBe(word);
      expect(liveBrowserFailureReason(word, "")).toBe(word);
      expect(liveBrowserFailureReason(word, "net::ERR (-102)")).toBe(`${word}: net::ERR (-102)`);
      expect(liveBrowserFailure(word), word).toBe(word);
      expect(liveBrowserFailure(`${word}: net::ERR (-102)`), word).toBe(word);
      // a detail that itself names another word is still the first word's
      expect(liveBrowserFailure(`${word}: stopped: offline`), word).toBe(word);
    }
  });

  it("a reason that leads with none of them — a host older than PT-5a, an engine's own string — is `failed`", () => {
    for (const reason of [
      "",
      "the page failed",
      "FORBIDDEN_SCOPE: plugin acme.tools is not granted surface.browser",
      "stoppedish",
      "Stopped",
      "offline:no space after the colon",
      " offline",
    ])
      expect(liveBrowserFailure(reason), reason).toBe("failed");
  });
});

// PT-S1 — THE DEVICE A SIMULATOR FACE SHOWS: the `spec` a simulator kind hands the host's `LIVE` service (its binding's two
// CoreSimulator ids, never a UDID; the device's name; the desk's scheme), and the nine honest states the host says back on the
// face (`info.extra.simulator`) — typed on the door so the plugin and PT-S2's host read one shape.
const DEVICE: LiveSimulatorSpec = {
  source: "ios-simulator",
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
  label: "iPhone 17 Pro",
  scheme: "light",
};

describe("PT-S1 — liveSimulatorSpec: the host reads the device a simulator face shows", () => {
  it("reads the device a simulator kind sends, whole — and only the fields it names", () => {
    expect(liveSimulatorSpec({ ...DEVICE })).toEqual(DEVICE);
    expect(liveSimulatorSpec({ ...DEVICE, scheme: "dark" })).toEqual({ ...DEVICE, scheme: "dark" });
    expect(liveSimulatorSpec({ ...DEVICE, udid: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890" })).toEqual(
      DEVICE,
    );
    // an empty label is a label (the host names the surface itself)
    expect(liveSimulatorSpec({ ...DEVICE, label: "" })).toEqual({ ...DEVICE, label: "" });
  });

  it("refuses a spec that is not a simulator's device, or a field it cannot read", () => {
    for (const bad of [
      { ...DEVICE, source: "browser" },
      { ...DEVICE, source: "sck-window" },
      { ...DEVICE, deviceType: "" },
      { ...DEVICE, deviceType: 17 },
      { ...DEVICE, deviceType: "x".repeat(129) },
      { ...DEVICE, deviceType: "com.apple.CoreSimulator.SimDeviceType.\niPhone" },
      { ...DEVICE, runtime: "" },
      { ...DEVICE, runtime: undefined },
      { ...DEVICE, label: undefined },
      { ...DEVICE, label: "iPhone\u0007" },
      { ...DEVICE, scheme: "desk" },
      {},
    ])
      expect(liveSimulatorSpec(bad), JSON.stringify(bad)).toBeUndefined();
  });
});

describe("PT-S1 — liveSimulatorFace: the simulator's honest face, the host's word read by the kind", () => {
  it("the states are a closed set of nine — the PT-S design's §3, in its order", () => {
    expect(LIVE_SIMULATOR_STATES).toEqual([
      "no-simulator",
      "no-permission",
      "no-device",
      "off",
      "booting",
      "no-window",
      "live",
      "at-rest",
      "stopped",
    ]);
  });

  it("reads each state, the device's name the host says and the act it can run", () => {
    for (const is of LIVE_SIMULATOR_STATES)
      expect(liveSimulatorFace({ extra: { simulator: { is } } }), is).toEqual({ is });
    const act = (): void => {};
    const face = liveSimulatorFace({
      extra: { simulator: { is: "off", device: "My iPhone", act, later: 1 } },
    });
    expect(face).toEqual({ is: "off", device: "My iPhone", act });
    expect(face?.act).toBe(act);
  });

  it("says nothing where the host says nothing a kind can read — never a guess", () => {
    expect(liveSimulatorFace(undefined)).toBeUndefined();
    expect(liveSimulatorFace({})).toBeUndefined();
    for (const simulator of [
      null,
      "off",
      { is: "Off" },
      { is: "asleep" },
      { is: "live", device: "" },
      { is: "live", device: 17 },
      { is: "off", act: "boot" },
      { is: "off", act: {} },
    ])
      expect(
        liveSimulatorFace({ extra: { simulator } }),
        JSON.stringify(simulator),
      ).toBeUndefined();
  });
});
