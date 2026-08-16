import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import type {
  MacosCaptureNativeAdapter,
  MacosCaptureNativeAdapterStats,
  MacosCaptureNativeFrame,
} from "./macos-capture-helper";

interface RawMacosCaptureAddon {
  start(serviceName: string, capabilityHex: string): void;
  setExpectedPeerPid(pid: number): void;
  drain(maximum: number): unknown;
  release(frameId: string): boolean;
  stats(): unknown;
  stop(): void;
}

function hasMethods(value: unknown): value is RawMacosCaptureAddon {
  if (typeof value !== "object" || value === null) return false;
  const raw = value as Record<string, unknown>;
  return ["start", "setExpectedPeerPid", "drain", "release", "stats", "stop"].every(
    (name) => typeof raw[name] === "function",
  );
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

/** Loads the one narrow Node-API binary from an explicit, non-ASAR resource path. */
export function loadMacosCaptureNativeAdapter(path: string): MacosCaptureNativeAdapter {
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
    stop: () => addon.stop(),
  };
}
