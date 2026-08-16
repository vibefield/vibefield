import { execFile } from "node:child_process";
import {
  type LiveSurfaceIosSimulatorSourceV1 as IosSimulatorSource,
  type LiveSurfaceErrorV1,
  LiveSurfaceIosSimulatorSourceV1,
  LiveSurfaceLogicalSizeV1,
  type LiveSurfaceRuntimeSummaryV1,
  LiveSurfaceSckWindowSourceV1,
} from "@vibefield/contracts";
import type { MacosCaptureSource } from "./macos-capture-helper";
import type {
  MacosSimulatorViewportQuery,
  MacosSimulatorViewportResult,
} from "./macos-capture-native";
import type {
  LiveSurfaceRuntimeAttachContext,
  LiveSurfaceRuntimeAttachment,
  LiveSurfaceRuntimeAuthority,
} from "./runtime";
import type { LiveSurfaceRuntimeSupportSnapshot } from "./runtime-support";
import {
  type SckCaptureClient,
  SckCaptureClientError,
  type SckCaptureClientStartRequest,
  type SckCaptureGeometryOverride,
  type SckCaptureSession,
  SckLiveSurfaceRuntime,
  type SckLiveSurfaceRuntimeStats,
} from "./sck-producer";

const SIMULATOR_BUNDLE_IDENTIFIER = "com.apple.iphonesimulator";
const DEFAULT_REVALIDATE_INTERVAL_MS = 1_000;
const DEFAULT_SIMCTL_TIMEOUT_MS = 8_000;
const MAX_SIMCTL_BYTES = 4 * 1024 * 1024;
const MAX_SIMULATOR_DEVICES = 4_096;

type JsonRecord = Record<string, unknown>;

export interface BootedSimulatorDevice {
  readonly udid: string;
  readonly name: string;
  readonly runtimeIdentifier: string;
  readonly runtimeName: string;
  readonly deviceTypeIdentifier: string;
}

export interface SimulatorDeviceCatalog {
  enumerateBootedDevices(): Promise<readonly BootedSimulatorDevice[]>;
}

export interface SimulatorWindowCatalog {
  enumerateWindows(allSpaces?: boolean): Promise<readonly MacosCaptureSource[]>;
}

export interface SimctlDeviceCatalogOptions {
  readonly developerDir?: string;
  readonly xcrunPath?: string;
  readonly timeoutMs?: number;
  /** Test seam; production executes `xcrun simctl list --json`. */
  readonly readListJson?: () => Promise<string>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function defaultReadListJson(options: SimctlDeviceCatalogOptions): () => Promise<string> {
  const xcrunPath = options.xcrunPath ?? "/usr/bin/xcrun";
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIMCTL_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("simctl timeout must be a positive safe integer");
  }
  return () =>
    new Promise<string>((resolve, reject) => {
      execFile(
        xcrunPath,
        ["simctl", "list", "--json"],
        {
          encoding: "utf8",
          maxBuffer: MAX_SIMCTL_BYTES,
          timeout: timeoutMs,
          env:
            options.developerDir === undefined
              ? process.env
              : { ...process.env, DEVELOPER_DIR: options.developerDir },
        },
        (error, stdout) => {
          if (error !== null) reject(error);
          else resolve(stdout);
        },
      );
    });
}

export function parseBootedSimulatorDevices(rawJson: string): readonly BootedSimulatorDevice[] {
  if (Buffer.byteLength(rawJson) > MAX_SIMCTL_BYTES) {
    throw new Error("simctl metadata exceeded its fixed bound");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("simctl returned malformed JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["runtimes"]) || !isRecord(parsed["devices"])) {
    throw new Error("simctl returned an unsupported metadata shape");
  }
  const runtimes = new Map<string, string>();
  for (const rawRuntime of parsed["runtimes"]) {
    if (!isRecord(rawRuntime)) throw new Error("simctl returned invalid runtime metadata");
    const identifier = rawRuntime["identifier"];
    const name = rawRuntime["name"];
    if (!boundedString(identifier) || !boundedString(name)) {
      throw new Error("simctl returned invalid runtime identity");
    }
    if (rawRuntime["isAvailable"] === false) continue;
    if (runtimes.has(identifier)) throw new Error("simctl returned duplicate runtime identity");
    runtimes.set(identifier, name);
  }

  const output: BootedSimulatorDevice[] = [];
  const udids = new Set<string>();
  let observed = 0;
  for (const [runtimeIdentifier, rawDevices] of Object.entries(parsed["devices"])) {
    if (!Array.isArray(rawDevices)) throw new Error("simctl returned invalid device metadata");
    const runtimeName = runtimes.get(runtimeIdentifier);
    if (runtimeName === undefined) continue;
    for (const rawDevice of rawDevices) {
      observed += 1;
      if (observed > MAX_SIMULATOR_DEVICES) {
        throw new Error("simctl device metadata exceeded its fixed bound");
      }
      if (!isRecord(rawDevice)) throw new Error("simctl returned invalid device metadata");
      if (rawDevice["state"] !== "Booted" || rawDevice["isAvailable"] !== true) continue;
      const udid = rawDevice["udid"];
      const name = rawDevice["name"];
      const deviceTypeIdentifier = rawDevice["deviceTypeIdentifier"];
      if (
        !boundedString(udid, 128) ||
        !/^[A-Za-z0-9-]+$/u.test(udid) ||
        !boundedString(name) ||
        !boundedString(deviceTypeIdentifier)
      ) {
        throw new Error("simctl returned invalid booted-device identity");
      }
      const normalizedUdid = udid.toUpperCase();
      if (udids.has(normalizedUdid)) throw new Error("simctl returned duplicate device identity");
      udids.add(normalizedUdid);
      output.push({ udid, name, runtimeIdentifier, runtimeName, deviceTypeIdentifier });
    }
  }
  return output;
}

export class SimctlDeviceCatalog implements SimulatorDeviceCatalog {
  readonly #readListJson: () => Promise<string>;

  constructor(options: SimctlDeviceCatalogOptions = {}) {
    this.#readListJson = options.readListJson ?? defaultReadListJson(options);
  }

  async enumerateBootedDevices(): Promise<readonly BootedSimulatorDevice[]> {
    return parseBootedSimulatorDevices(await this.#readListJson());
  }
}

export interface ResolvedIosSimulatorCapture {
  readonly device: BootedSimulatorDevice;
  readonly window: MacosCaptureSource;
  readonly source: ReturnType<typeof LiveSurfaceSckWindowSourceV1.parse>;
  readonly geometry: SckCaptureGeometryOverride;
  readonly fingerprint: string;
}

export interface IosSimulatorResolutionProvider {
  resolve(source: IosSimulatorSource): Promise<ResolvedIosSimulatorCapture>;
}

export interface IosSimulatorSourceResolverOptions {
  readonly devices: SimulatorDeviceCatalog;
  readonly windows: SimulatorWindowCatalog;
  readonly viewport: MacosSimulatorViewportQuery;
}

function captureError(
  code: LiveSurfaceErrorV1["code"],
  message: string,
  recovery: LiveSurfaceErrorV1["recovery"] = "automatic",
): SckCaptureClientError {
  return new SckCaptureClientError({ code, message, recovery });
}

function titleMatchesDevice(windowTitle: string, device: BootedSimulatorDevice): boolean {
  if (windowTitle === device.name) return true;
  return (
    windowTitle.startsWith(`${device.name} `) &&
    windowTitle.endsWith(device.runtimeName) &&
    windowTitle.length <= device.name.length + device.runtimeName.length + 8
  );
}

function contained(
  rect: { x: number; y: number; width: number; height: number },
  frame: MacosCaptureSource["frame"],
): boolean {
  const tolerance = 0.01;
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= frame.width + tolerance &&
    rect.y + rect.height <= frame.height + tolerance
  );
}

function logicalSize(width: number, height: number) {
  return LiveSurfaceLogicalSizeV1.parse({ width, height });
}

function fingerprint(
  device: BootedSimulatorDevice,
  window: MacosCaptureSource,
  crop: ReturnType<typeof LiveSurfaceSckWindowSourceV1.parse>["crop"],
  geometry: SckCaptureGeometryOverride,
): string {
  return JSON.stringify([
    device.udid.toUpperCase(),
    device.runtimeIdentifier,
    window.sourceRef,
    window.ownerPid,
    window.windowId,
    window.title,
    window.frame.x,
    window.frame.y,
    window.frame.width,
    window.frame.height,
    crop,
    geometry,
  ]);
}

export class IosSimulatorSourceResolver implements IosSimulatorResolutionProvider {
  readonly #devices: SimulatorDeviceCatalog;
  readonly #windows: SimulatorWindowCatalog;
  readonly #viewport: MacosSimulatorViewportQuery;

  constructor(options: IosSimulatorSourceResolverOptions) {
    this.#devices = options.devices;
    this.#windows = options.windows;
    this.#viewport = options.viewport;
  }

  async resolve(rawSource: IosSimulatorSource): Promise<ResolvedIosSimulatorCapture> {
    const source = LiveSurfaceIosSimulatorSourceV1.parse(rawSource);
    let devices: readonly BootedSimulatorDevice[];
    let windows: readonly MacosCaptureSource[];
    try {
      [devices, windows] = await Promise.all([
        this.#devices.enumerateBootedDevices(),
        this.#windows.enumerateWindows(true),
      ]);
    } catch (error) {
      if (error instanceof SckCaptureClientError) throw error;
      throw captureError("producer-crashed", "Simulator sources could not be resolved");
    }
    const matches = devices.filter(
      (device) => device.udid.toUpperCase() === source.udid.toUpperCase(),
    );
    if (matches.length !== 1) {
      throw captureError("source-not-found", "The selected Simulator device is not booted");
    }
    const device = matches[0]!;
    const candidates = windows.filter(
      (window) =>
        window.bundleIdentifier === SIMULATOR_BUNDLE_IDENTIFIER && window.title === device.name,
    );
    if (candidates.length === 0) {
      throw captureError("source-not-found", "The booted Simulator device has no capture window");
    }

    let selected: MacosCaptureSource | undefined;
    let selectedViewport: MacosSimulatorViewportResult | undefined;
    if (source.windowRef !== undefined) {
      selected = candidates.find((candidate) => candidate.sourceRef === source.windowRef);
      if (selected === undefined) {
        throw captureError("source-not-found", "The selected Simulator window reference is stale");
      }
    } else if (candidates.length === 1) {
      selected = candidates[0];
    } else {
      const proven = candidates
        .map((candidate) => ({
          candidate,
          viewport: this.#viewport.resolveSimulatorViewport(candidate.ownerPid, candidate.frame),
        }))
        .filter(
          (item) =>
            item.viewport.status === "resolved" &&
            titleMatchesDevice(item.viewport.windowTitle, device),
        );
      if (proven.length === 1) {
        selected = proven[0]!.candidate;
        selectedViewport = proven[0]!.viewport;
      }
    }
    if (selected === undefined) {
      throw captureError("source-not-found", "The Simulator window identity is ambiguous");
    }

    let sckCrop: ReturnType<typeof LiveSurfaceSckWindowSourceV1.parse>["crop"];
    let geometry: SckCaptureGeometryOverride;
    if (source.crop.mode === "explicit") {
      if (!contained(source.crop.sourceRect, selected.frame)) {
        throw captureError(
          "source-not-found",
          "The explicit Simulator viewport exceeds the selected window",
          "user-action",
        );
      }
      sckCrop = source.crop;
      geometry = {
        logicalSize: logicalSize(source.crop.sourceRect.width, source.crop.sourceRect.height),
        orientation: 0,
        cropState: "applied",
      };
    } else if (source.crop.mode === "none") {
      sckCrop = { mode: "none" };
      geometry = {
        logicalSize: logicalSize(selected.frame.width, selected.frame.height),
        orientation: 0,
        cropState: "none",
      };
    } else {
      const viewport =
        selectedViewport ??
        this.#viewport.resolveSimulatorViewport(selected.ownerPid, selected.frame);
      if (viewport.status === "resolved") {
        if (
          !titleMatchesDevice(viewport.windowTitle, device) ||
          !contained(viewport.sourceRect, selected.frame)
        ) {
          throw captureError("source-not-found", "The Simulator viewport identity changed");
        }
        sckCrop = { mode: "explicit", sourceRect: viewport.sourceRect };
        geometry = {
          logicalSize: logicalSize(viewport.sourceRect.width, viewport.sourceRect.height),
          orientation: 0,
          cropState: "applied",
        };
      } else {
        // No guessed offsets: keep the complete window visible and mark geometry degraded.
        sckCrop = { mode: "none" };
        geometry = {
          logicalSize: logicalSize(selected.frame.width, selected.frame.height),
          orientation: 0,
          cropState: "degraded",
        };
      }
    }
    const sckSource = LiveSurfaceSckWindowSourceV1.parse({
      kind: "sck-window",
      sourceRef: selected.sourceRef,
      crop: sckCrop,
      captureCursor: false,
    });
    return {
      device,
      window: selected,
      source: sckSource,
      geometry,
      fingerprint: fingerprint(device, selected, sckSource.crop, geometry),
    };
  }
}

export interface IosSimulatorCaptureClientOptions {
  readonly source: IosSimulatorSource;
  readonly resolver: IosSimulatorResolutionProvider;
  readonly delegate: SckCaptureClient;
  readonly revalidateIntervalMs?: number;
}

/** Re-resolves durable Simulator identity at low rate; frame transport remains the common SCK path. */
export class IosSimulatorCaptureClient implements SckCaptureClient {
  readonly #source: IosSimulatorSource;
  readonly #resolver: IosSimulatorResolutionProvider;
  readonly #delegate: SckCaptureClient;
  readonly #revalidateIntervalMs: number;

  constructor(options: IosSimulatorCaptureClientOptions) {
    this.#source = LiveSurfaceIosSimulatorSourceV1.parse(options.source);
    this.#resolver = options.resolver;
    this.#delegate = options.delegate;
    this.#revalidateIntervalMs = options.revalidateIntervalMs ?? DEFAULT_REVALIDATE_INTERVAL_MS;
    if (!Number.isSafeInteger(this.#revalidateIntervalMs) || this.#revalidateIntervalMs <= 0) {
      throw new RangeError("Simulator revalidation interval must be a positive safe integer");
    }
  }

  async startSession(request: SckCaptureClientStartRequest): Promise<SckCaptureSession> {
    const resolved = await this.#resolver.resolve(this.#source);
    const session = await this.#delegate.startSession({
      ...request,
      source: resolved.source,
      geometry: resolved.geometry,
    });
    let disposed = false;
    let faulted = false;
    let live = request.demand.mode === "live";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;
    let pendingFingerprint: string | null = null;
    const clearTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const fault = (error: LiveSurfaceErrorV1): void => {
      if (disposed || faulted) return;
      faulted = true;
      clearTimer();
      try {
        request.onFault(error);
      } catch {
        // Runtime observers cannot retain this control loop.
      }
    };
    const schedule = (): void => {
      if (disposed || faulted || !live || timer !== null || checking) return;
      timer = setTimeout(() => {
        timer = null;
        if (disposed || faulted || !live || checking) return;
        checking = true;
        void this.#resolver
          .resolve(this.#source)
          .then((current) => {
            if (current.fingerprint === resolved.fingerprint) {
              pendingFingerprint = null;
            } else if (pendingFingerprint !== current.fingerprint) {
              // Simulator animates its outer window during rotation. Rebinding
              // on the first transient frame can capture an intermediate crop.
              pendingFingerprint = current.fingerprint;
            } else {
              fault({
                code: "source-closed",
                message: "Simulator window geometry changed and will be rebound",
                recovery: "automatic",
              });
            }
          })
          .catch((error: unknown) => {
            fault(
              error instanceof SckCaptureClientError
                ? error.surfaceError
                : {
                    code: "producer-crashed",
                    message: "Simulator source revalidation failed",
                    recovery: "automatic",
                  },
            );
          })
          .finally(() => {
            checking = false;
            schedule();
          });
      }, this.#revalidateIntervalMs);
      timer.unref?.();
    };
    schedule();
    return {
      setDemand: async (demand) => {
        if (disposed || faulted) return;
        live = demand.mode === "live";
        if (!live) clearTimer();
        await session.setDemand(demand);
        if (live) schedule();
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        clearTimer();
        await session.dispose();
      },
    };
  }
}

export interface IosSimulatorLiveSurfaceRuntimeOptions extends IosSimulatorCaptureClientOptions {
  readonly surfaceId: string;
  readonly monotonicNowUs?: () => bigint;
  readonly startupTimeoutMs?: number;
  readonly restartLimit?: number;
  readonly onFrameCallbackDurationUs?: (durationUs: bigint) => void;
}

/** Thin specialization: durable Simulator resolution outside, ordinary SCK pixels inside. */
export class IosSimulatorLiveSurfaceRuntime implements LiveSurfaceRuntimeAuthority {
  readonly surfaceId: string;
  readonly source: IosSimulatorSource;
  readonly #runtime: SckLiveSurfaceRuntime;

  constructor(options: IosSimulatorLiveSurfaceRuntimeOptions) {
    this.source = LiveSurfaceIosSimulatorSourceV1.parse(options.source);
    const client = new IosSimulatorCaptureClient(options);
    this.#runtime = new SckLiveSurfaceRuntime({
      surfaceId: options.surfaceId,
      source: {
        kind: "sck-window",
        sourceRef: `ios-simulator-${this.source.udid}`,
        crop: { mode: "none" },
        captureCursor: false,
      },
      client,
      ...(options.monotonicNowUs === undefined ? {} : { monotonicNowUs: options.monotonicNowUs }),
      ...(options.onFrameCallbackDurationUs === undefined
        ? {}
        : { onFrameCallbackDurationUs: options.onFrameCallbackDurationUs }),
      ...(options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: options.startupTimeoutMs }),
      ...(options.restartLimit === undefined ? {} : { restartLimit: options.restartLimit }),
    });
    this.surfaceId = this.#runtime.surfaceId;
  }

  get summary(): LiveSurfaceRuntimeSummaryV1 {
    return this.#runtime.summary;
  }

  get stats(): SckLiveSurfaceRuntimeStats {
    return this.#runtime.stats;
  }

  supportSnapshot(): LiveSurfaceRuntimeSupportSnapshot {
    return this.#runtime.supportSnapshot("ios-simulator");
  }

  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment {
    return this.#runtime.attach(context);
  }

  dispose(): void {
    this.#runtime.dispose();
  }
}
