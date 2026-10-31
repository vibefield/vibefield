// PT-S2 — A BOUND SIMULATOR AS THE DESK'S LIVE SERVICE SAYS IT (desk-live.ts's `openSimulator` lane; the PT-S design §3; the
// brief's R2, R4, R15), pure:
//  - THE MINT'S SOURCE is the phone's BINDING — a device type and a runtime, never a UDID (contracts' `ios-simulator-device`:
//    main resolves it on THIS Mac and keeps what it picked), its crop the auto one (the device's screen found in its window).
//  - ITS CONTINUITY KEY is the DEVICE's (`sim:<type>:<runtime>`, CoreSimulator's prefixes off): a reload re-binds the running
//    stream, and main's custody keeps one a device (R10: main dedupes the kind on its binding whatever the key says).
//  - ITS STILLS are filed under the BINDING (`simulatorAddress`): the shelf's still of a phone is laid only into a face bound to
//    the device it was taken of (R15) — another device's picture is never shown as this one's.
//  - MAIN'S FACTS (`summary.simulator.condition`) in the SDK's nine words (`LIVE_SIMULATOR_STATES` — declared once, there):
//    each condition its own state by name; `streaming` is `live` or `at-rest` by the RENDERER's own knowledge — its ask, the
//    cap, the frames it has shown (R2) — and `stopped` where its producer failed under it. Each state's ONE act is main's verb
//    (R4); `mint` is the renderer's own — a lane lost, minted again.

import type { LiveState } from "@vibecook/ice/desk/kit";
import {
  type LiveSurfaceDeviceVerbV1,
  LiveSurfaceIosSimulatorBindingV1,
  type LiveSurfaceIosSimulatorDeviceSourceV1,
  type LiveSurfaceSimulatorConditionV1,
  SurfaceReuseKeyV1,
} from "@vibefield/contracts";
import type { LiveSimulatorSpec, LiveSimulatorState } from "@vibefield/plugin-sdk/desk";

/** The device a phone is bound to, as its spec names it (the SDK's reader held only its shape as words). */
export type SimulatorBinding = Pick<LiveSimulatorSpec, "deviceType" | "runtime">;

/** CoreSimulator's prefixes — off a device type's and a runtime's id in the continuity key (it must fit `SurfaceReuseKeyV1`). */
const DEVICE_TYPE_PREFIX = "com.apple.CoreSimulator.SimDeviceType.";
const RUNTIME_PREFIX = "com.apple.CoreSimulator.SimRuntime.";

/**
 * The mint's source for a bound phone: its binding RE-VALIDATED against the contracts' (as every privileged spec is), its crop
 * the auto one — or undefined: not a device this desk can open (the face is refused, said).
 */
export function simulatorSource(
  binding: SimulatorBinding,
): LiveSurfaceIosSimulatorDeviceSourceV1 | undefined {
  const parsed = LiveSurfaceIosSimulatorBindingV1.safeParse({
    deviceType: binding.deviceType,
    runtime: binding.runtime,
  });
  if (!parsed.success) return undefined;
  return {
    kind: "ios-simulator-device",
    binding: { deviceType: parsed.data.deviceType, runtime: parsed.data.runtime },
    crop: { mode: "auto" },
  };
}

/** The device's continuity key (`sim:iPhone-17-Pro:iOS-26-1`) — undefined where it would not fit the wire's bound (the mint
 * goes without one: fresh each time, swept when its document dies). */
export function simulatorReuseKey(binding: SimulatorBinding): string | undefined {
  const type = binding.deviceType.startsWith(DEVICE_TYPE_PREFIX)
    ? binding.deviceType.slice(DEVICE_TYPE_PREFIX.length)
    : binding.deviceType;
  const runtime = binding.runtime.startsWith(RUNTIME_PREFIX)
    ? binding.runtime.slice(RUNTIME_PREFIX.length)
    : binding.runtime;
  const key = SurfaceReuseKeyV1.safeParse(`sim:${type}:${runtime}`);
  return key.success ? key.data : undefined;
}

/** R15 — what a phone's still is FILED under (the shelf's `address`): its binding, whole. */
export const simulatorAddress = (binding: SimulatorBinding): string =>
  `ios-simulator:${binding.deviceType}/${binding.runtime}`;

/** R2 — main's facts in the SDK's words: each condition its own state by name; `streaming` is the renderer's to say
 * (`simulatorState`: `live`, or `at-rest`) — `live` here is only its name. */
export const SIMULATOR_STATES: Readonly<
  Record<LiveSurfaceSimulatorConditionV1, LiveSimulatorState>
> = {
  "no-simulator": "no-simulator",
  "no-permission": "no-permission",
  "no-device": "no-device",
  off: "off",
  booting: "booting",
  "no-window": "no-window",
  streaming: "live",
  stopped: "stopped",
};

/**
 * The state a face SAYS — main's condition, and the renderer's own word where its device streams: a stream whose producer
 * FAILED under it stopped; one whose frames the renderer lets flow (its ask live, the cap's slot its own, no still standing
 * in a frame's place) is `live`; else it is at rest — off view, or the cap rested it: the last frame as a still.
 */
export function simulatorState(
  condition: LiveSurfaceSimulatorConditionV1,
  o: { readonly failed: boolean; readonly flowing: boolean },
): LiveSimulatorState {
  if (condition !== "streaming") return SIMULATOR_STATES[condition];
  return o.failed ? "stopped" : o.flowing ? "live" : "at-rest";
}

/** R4 — each state's ONE act, as main runs it (the SDK's: no act where it names none — and none while main runs one). */
export const SIMULATOR_ACTS: Readonly<Record<LiveSimulatorState, LiveSurfaceDeviceVerbV1 | null>> =
  {
    "no-simulator": null,
    "no-permission": "open-settings",
    "no-device": "create",
    off: "boot",
    booting: null,
    "no-window": "show",
    live: null,
    "at-rest": null,
    stopped: "retry",
  };

/** A face's act: a device verb main runs, or `mint` — its lane LOST, the pool mints it again (the browser's own retry). */
export type SimulatorAct = LiveSurfaceDeviceVerbV1 | "mint";

/**
 * The face's COARSE state by its words — for a kind that reads none (the phone reads `extra.simulator` first): frames
 * flowing, `live`; the last frame holding (at rest, off, no window), `paused`; a device on its way up, `starting`; a stream
 * that stopped, `failed` with its act as the retry (Try again); a device this Mac cannot show, `failed` with its word.
 */
export function simulatorLiveState(is: LiveSimulatorState, act?: () => void): LiveState {
  switch (is) {
    case "live":
      return { is: "live" };
    case "at-rest":
    case "off":
    case "no-window":
      return { is: "paused" };
    case "booting":
      return { is: "starting" };
    case "stopped":
      return act === undefined
        ? { is: "failed", reason: is }
        : { is: "failed", reason: is, retry: act };
    default:
      return { is: "failed", reason: is };
  }
}
