// THE FIXTURE'S MAC (PT-S1 — authoring-time only, as states.ts is: this directory never enters a `.vfplugin`): which honest
// face (the PT-S design §3) the plugin's fixture answers each bound phone with, so the playground's stills stage all nine from
// props alone. A still's faces are the fixture's (live.ts), and a fixture answers by the device a phone is BOUND to: each row
// is a device type in one of the nine states. The two Mac-wide states — no Simulator, no permission — answer every device of a
// real Mac alike; here each is given a device of its own, as if that row's device were on such a Mac. The runtime is the one
// this Mac had when PT-S1 was written (`xcrun simctl list --json runtimes`: iOS 26.1, 26.5); the iPhone 8's, an iOS it runs.
import type { LiveSimulatorState } from "@vibefield/plugin-sdk/desk";

const TYPE = "com.apple.CoreSimulator.SimDeviceType.";
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const IOS_16_4 = "com.apple.CoreSimulator.SimRuntime.iOS-16-4";

/** One staged face: the device it is answered for (its type is also the phone's model), its runtime, and the state. */
export interface FixtureDevice {
  readonly deviceType: string;
  readonly runtime: string;
  readonly is: LiveSimulatorState;
}

/** The nine faces, one device each — the playground's state names are the states'. */
export const FIXTURE_MAC: readonly FixtureDevice[] = [
  { deviceType: `${TYPE}iPhone-13`, runtime: IOS_26_1, is: "no-simulator" },
  { deviceType: `${TYPE}iPhone-14-Pro`, runtime: IOS_26_1, is: "no-permission" },
  { deviceType: `${TYPE}iPhone-8`, runtime: IOS_16_4, is: "no-device" },
  { deviceType: `${TYPE}iPhone-16-Pro`, runtime: IOS_26_1, is: "off" },
  { deviceType: `${TYPE}iPhone-15-Pro`, runtime: IOS_26_1, is: "booting" },
  { deviceType: `${TYPE}iPhone-Air`, runtime: IOS_26_1, is: "no-window" },
  { deviceType: `${TYPE}iPhone-17-Pro`, runtime: IOS_26_1, is: "live" },
  { deviceType: `${TYPE}iPhone-17`, runtime: IOS_26_1, is: "at-rest" },
  { deviceType: `${TYPE}iPhone-16e`, runtime: IOS_26_1, is: "stopped" },
];

/** The device the fixture answers for a bound device type, or undefined: a device the fixture's Mac does not hold. */
export const fixtureDevice = (deviceType: string): FixtureDevice | undefined =>
  FIXTURE_MAC.find((d) => d.deviceType === deviceType);

/** The clock a still's screens show: 2026-10-18 10:08 UTC (the fixture's clock reads UTC — a still never reads a host's zone). */
export const FIXTURE_TIME = Date.UTC(2026, 9, 18, 10, 8);
