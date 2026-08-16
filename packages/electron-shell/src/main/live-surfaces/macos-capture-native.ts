import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import {
  LiveSurfaceSourceRectV1,
  type LiveSurfaceSourceRectV1 as SourceRect,
} from "@vibefield/contracts";
import type {
  MacosCaptureNativeAdapter,
  MacosCaptureNativeAdapterStats,
  MacosCaptureNativeFrame,
  MacosCaptureSource,
} from "./macos-capture-helper";

export type MacosSimulatorViewportResult =
  | {
      readonly status: "resolved";
      readonly sourceRect: SourceRect;
      readonly windowTitle: string;
    }
  | {
      readonly status: "permission-denied" | "window-not-found" | "viewport-not-found";
    };

/** Purpose-specific low-rate geometry query; it exposes no generic Accessibility operation. */
export interface MacosSimulatorViewportQuery {
  resolveSimulatorViewport(
    ownerPid: number,
    outerFrame: MacosCaptureSource["frame"],
  ): MacosSimulatorViewportResult;
}

interface RawMacosCaptureAddon {
  start(serviceName: string, capabilityHex: string): void;
  setExpectedPeerPid(pid: number): void;
  drain(maximum: number): unknown;
  release(frameId: string): boolean;
  stats(): unknown;
  resolveSimulatorViewport(ownerPid: number, outerFrame: MacosCaptureSource["frame"]): unknown;
  stop(): void;
}

function hasMethods(value: unknown): value is RawMacosCaptureAddon {
  if (typeof value !== "object" || value === null) return false;
  const raw = value as Record<string, unknown>;
  return [
    "start",
    "setExpectedPeerPid",
    "drain",
    "release",
    "stats",
    "resolveSimulatorViewport",
    "stop",
  ].every((name) => typeof raw[name] === "function");
}

function stats(raw: unknown): MacosCaptureNativeAdapterStats {
  if (typeof raw !== "object" || raw === null) throw new Error("invalid native capture stats");
  const value = raw as Record<string, unknown>;
  const names = [
    "received",
    "accepted",
    "rejectedIdentity",
    "rejectedCapability",
    "rejectedProtocol",
    "outstanding",
  ] as const;
  const out = {} as Record<(typeof names)[number], number>;
  for (const name of names) {
    const field = value[name];
    if (!Number.isSafeInteger(field) || (field as number) < 0) {
      throw new Error("invalid native capture stats");
    }
    out[name] = field as number;
  }
  return out;
}

function simulatorViewport(raw: unknown): MacosSimulatorViewportResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("invalid native Simulator viewport result");
  }
  const value = raw as Record<string, unknown>;
  const status = value["status"];
  if (
    status === "permission-denied" ||
    status === "window-not-found" ||
    status === "viewport-not-found"
  ) {
    return { status };
  }
  if (status !== "resolved") throw new Error("invalid native Simulator viewport status");
  const parsedRect = LiveSurfaceSourceRectV1.safeParse(value["sourceRect"]);
  const windowTitle = value["windowTitle"];
  if (
    !parsedRect.success ||
    typeof windowTitle !== "string" ||
    windowTitle.length === 0 ||
    windowTitle.length > 512
  ) {
    throw new Error("invalid native Simulator viewport geometry");
  }
  return { status, sourceRect: parsedRect.data, windowTitle };
}

/** Loads the one narrow Node-API binary from an explicit, non-ASAR resource path. */
export function loadMacosCaptureNativeAdapter(
  path: string,
): MacosCaptureNativeAdapter & MacosSimulatorViewportQuery {
  if (process.platform !== "darwin") throw new Error("ScreenCaptureKit is available only on macOS");
  if (!isAbsolute(path)) throw new Error("native capture adapter path must be absolute");
  const require = createRequire(__filename);
  const addon: unknown = require(path);
  if (!hasMethods(addon)) throw new Error("native capture adapter has an invalid export surface");
  return {
    start: (serviceName, capabilityHex) => addon.start(serviceName, capabilityHex),
    setExpectedPeerPid: (pid) => addon.setExpectedPeerPid(pid),
    drain: (maximum) => {
      const frames = addon.drain(maximum);
      if (!Array.isArray(frames)) throw new Error("native capture adapter returned a non-array");
      return frames as MacosCaptureNativeFrame[];
    },
    release: (frameId) => addon.release(frameId),
    stats: () => stats(addon.stats()),
    resolveSimulatorViewport: (ownerPid, outerFrame) =>
      simulatorViewport(addon.resolveSimulatorViewport(ownerPid, outerFrame)),
    stop: () => addon.stop(),
  };
}
