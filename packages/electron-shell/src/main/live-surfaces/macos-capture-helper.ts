import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { LiveSurfaceErrorV1 } from "@vibefield/contracts";
import {
  type SckCaptureClient,
  SckCaptureClientError,
  type SckCaptureClientStartRequest,
  type SckCaptureFrame,
  type SckCaptureSession,
  type SckHelperLeaseDisposition,
} from "./sck-producer";

const PROTOCOL_VERSION = 1;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_SOURCES = 2_048;
const MAX_SOURCE_ALIASES = MAX_SOURCES * 2;
const MAX_SESSIONS = 16;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

type JsonRecord = Record<string, unknown>;

export interface MacosCaptureSource {
  readonly sourceRef: string;
  readonly applicationName: string;
  readonly bundleIdentifier: string;
  readonly title: string;
  readonly windowId: number;
  readonly ownerPid: number;
  readonly frame: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly onScreen: boolean;
}

export interface MacosCaptureNativeFrame {
  readonly frameId: string;
  readonly sessionKey: string;
  readonly producerEpoch: number;
  readonly sequence: string;
  readonly slot: number;
  readonly width: number;
  readonly height: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly timestampUs?: string;
  readonly ioSurface: Buffer;
}

export interface MacosCaptureNativeAdapterStats {
  readonly received: number;
  readonly accepted: number;
  readonly rejectedIdentity: number;
  readonly rejectedCapability: number;
  readonly rejectedProtocol: number;
  readonly outstanding: number;
}

/** Purpose-built native surface-right receiver. It intentionally exposes no general FFI. */
export interface MacosCaptureNativeAdapter {
  start(serviceName: string, capabilityHex: string): void;
  setExpectedPeerPid(pid: number): void;
  drain(maximum: number): readonly MacosCaptureNativeFrame[];
  release(frameId: string): boolean;
  stats(): MacosCaptureNativeAdapterStats;
  stop(): void;
}

export interface MacosCaptureHelperSupervisorOptions {
  readonly helperPath: string;
  readonly adapter: MacosCaptureNativeAdapter;
  readonly spawnHelper?: (
    helperPath: string,
    args: readonly string[],
  ) => ChildProcessWithoutNullStreams;
  readonly randomHex?: (bytes: number) => string;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly onDiagnostic?: (message: string) => void;
}

export interface MacosCaptureHelperSupervisorStats {
  readonly helperGeneration: number;
  readonly activeSessions: number;
  readonly helperStarts: number;
  readonly helperExits: number;
  readonly framesReceived: number;
  readonly framesRejected: number;
  readonly releaseCommands: number;
  readonly nativeOutstandingPeak: number;
  readonly native: MacosCaptureNativeAdapterStats | null;
}

interface PendingRequest {
  readonly expectedEvent: string;
  readonly resolve: (message: JsonRecord) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface RunningHelper {
  readonly child: ChildProcessWithoutNullStreams;
  readonly capabilityHex: string;
  readonly serviceName: string;
  readonly generation: number;
  stdoutBuffer: Buffer;
  stopping: boolean;
}

interface SourceAlias {
  readonly generation: number;
  readonly descriptor: MacosCaptureSource;
}

interface ActiveSession {
  readonly sessionKey: string;
  readonly producerEpoch: number;
  readonly request: SckCaptureClientStartRequest;
  readonly generation: number;
  disposed: boolean;
  lastActuationRevision: number;
  actuationTail: Promise<void>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function safeInteger(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function finitePositive(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum;
}

function hex(value: unknown, bytes: number): value is string {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${bytes * 2}}$`, "u").test(value);
}

function decimalU64(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value)) return false;
  return BigInt(value) <= U64_MAX;
}

function surfaceError(raw: unknown, fallback: string): LiveSurfaceErrorV1 {
  if (!isRecord(raw)) {
    return { code: "producer-crashed", message: fallback, recovery: "automatic" };
  }
  const allowedCodes = new Set<LiveSurfaceErrorV1["code"]>([
    "unsupported",
    "permission-denied",
    "source-not-found",
    "source-closed",
    "producer-crashed",
    "frame-stalled",
    "lease-timeout",
    "protocol-violation",
    "security-rejected",
  ]);
  const allowedRecovery = new Set<LiveSurfaceErrorV1["recovery"]>([
    "automatic",
    "user-action",
    "permanent",
  ]);
  const code = raw["code"];
  const message = raw["message"];
  const recovery = raw["recovery"];
  if (
    typeof code !== "string" ||
    !allowedCodes.has(code as LiveSurfaceErrorV1["code"]) ||
    !boundedString(message) ||
    typeof recovery !== "string" ||
    !allowedRecovery.has(recovery as LiveSurfaceErrorV1["recovery"])
  ) {
    return { code: "protocol-violation", message: fallback, recovery: "permanent" };
  }
  return {
    code: code as LiveSurfaceErrorV1["code"],
    message,
    recovery: recovery as LiveSurfaceErrorV1["recovery"],
  };
}

function parseSource(raw: unknown): MacosCaptureSource | null {
  if (!isRecord(raw)) return null;
  const frame = raw["frame"];
  if (
    !hex(raw["sourceRef"], 16) ||
    !boundedString(raw["applicationName"]) ||
    !boundedString(raw["bundleIdentifier"]) ||
    !boundedString(raw["title"]) ||
    !safeInteger(raw["windowId"], 1, 0xffff_ffff) ||
    !safeInteger(raw["ownerPid"], 1, 0x7fff_ffff) ||
    !isRecord(frame) ||
    typeof frame["x"] !== "number" ||
    !Number.isFinite(frame["x"]) ||
    typeof frame["y"] !== "number" ||
    !Number.isFinite(frame["y"]) ||
    !finitePositive(frame["width"], 32_768) ||
    !finitePositive(frame["height"], 32_768) ||
    typeof raw["onScreen"] !== "boolean"
  ) {
    return null;
  }
  return {
    sourceRef: raw["sourceRef"],
    applicationName: raw["applicationName"],
    bundleIdentifier: raw["bundleIdentifier"],
    title: raw["title"],
    windowId: raw["windowId"],
    ownerPid: raw["ownerPid"],
    frame: {
      x: frame["x"],
      y: frame["y"],
      width: frame["width"],
      height: frame["height"],
    },
    onScreen: raw["onScreen"],
  };
}

function validateNativeFrame(raw: MacosCaptureNativeFrame): MacosCaptureNativeFrame | null {
  if (
    !decimalU64(raw.frameId) ||
    !hex(raw.sessionKey, 16) ||
    !safeInteger(raw.producerEpoch) ||
    !decimalU64(raw.sequence) ||
    !safeInteger(raw.slot, 0, 1) ||
    !safeInteger(raw.width, 1, 16_384) ||
    !safeInteger(raw.height, 1, 16_384) ||
    raw.width * raw.height > 67_108_864 ||
    !finitePositive(raw.logicalWidth, 32_768) ||
    !finitePositive(raw.logicalHeight, 32_768) ||
    (raw.timestampUs !== undefined && !decimalU64(raw.timestampUs)) ||
    !Buffer.isBuffer(raw.ioSurface) ||
    raw.ioSurface.byteLength !== 8
  ) {
    return null;
  }
  return raw;
}

function defaultSpawn(helperPath: string, args: readonly string[]): ChildProcessWithoutNullStreams {
  return spawn(helperPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });
}

/**
 * Owns the one authenticated helper process and multiplexes independent SCK sessions.
 * Renderer/plugin code never receives the pipe, token, service name, PID, or native addon.
 */
export class MacosCaptureHelperSupervisor implements SckCaptureClient {
  readonly #helperPath: string;
  readonly #adapter: MacosCaptureNativeAdapter;
  readonly #spawnHelper: NonNullable<MacosCaptureHelperSupervisorOptions["spawnHelper"]>;
  readonly #randomHex: NonNullable<MacosCaptureHelperSupervisorOptions["randomHex"]>;
  readonly #requestTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #onDiagnostic: ((message: string) => void) | undefined;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #sourceAliases = new Map<string, SourceAlias>();
  #running: RunningHelper | null = null;
  #starting: Promise<RunningHelper> | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #requestSequence = 0;
  #helperGeneration = 0;
  #helperStarts = 0;
  #helperExits = 0;
  #framesReceived = 0;
  #framesRejected = 0;
  #releaseCommands = 0;
  #nativeOutstandingPeak = 0;
  #disposed = false;

  constructor(options: MacosCaptureHelperSupervisorOptions) {
    this.#helperPath = options.helperPath;
    this.#adapter = options.adapter;
    this.#spawnHelper = options.spawnHelper ?? defaultSpawn;
    this.#randomHex = options.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"));
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 4;
    this.#onDiagnostic = options.onDiagnostic;
    if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new RangeError("SCK helper request timeout must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#pollIntervalMs) || this.#pollIntervalMs <= 0) {
      throw new RangeError("SCK helper poll interval must be a positive safe integer");
    }
  }

  get stats(): MacosCaptureHelperSupervisorStats {
    let native: MacosCaptureNativeAdapterStats | null = null;
    try {
      if (this.#running !== null) native = this.observeNativeStats();
    } catch {
      native = null;
    }
    return {
      helperGeneration: this.#helperGeneration,
      activeSessions: this.#sessions.size,
      helperStarts: this.#helperStarts,
      helperExits: this.#helperExits,
      framesReceived: this.#framesReceived,
      framesRejected: this.#framesRejected,
      releaseCommands: this.#releaseCommands,
      nativeOutstandingPeak: this.#nativeOutstandingPeak,
      native,
    };
  }

  async enumerateWindows(allSpaces = true): Promise<readonly MacosCaptureSource[]> {
    const helper = await this.ensureRunning();
    const response = await this.request(helper, "enumerate", "sources", { allSpaces });
    const rawSources = response["sources"];
    if (!Array.isArray(rawSources) || rawSources.length > MAX_SOURCES) {
      throw this.protocolFailure(helper, "capture helper returned an invalid source list");
    }
    const sources: MacosCaptureSource[] = [];
    for (const raw of rawSources) {
      const source = parseSource(raw);
      if (source === null) {
        throw this.protocolFailure(helper, "capture helper returned invalid source metadata");
      }
      sources.push(source);
      this.rememberSourceAlias(source.sourceRef, {
        generation: helper.generation,
        descriptor: source,
      });
    }
    return sources;
  }

  async requestPermission(): Promise<boolean> {
    const helper = await this.ensureRunning();
    const response = await this.request(helper, "request-permission", "permission", {});
    if (typeof response["granted"] !== "boolean") {
      throw this.protocolFailure(helper, "capture helper returned invalid permission state");
    }
    return response["granted"];
  }

  async startSession(request: SckCaptureClientStartRequest): Promise<SckCaptureSession> {
    const helper = await this.ensureRunning();
    const sessionKey = this.uniqueSessionKey();
    const sourceRef = await this.currentSourceRef(helper, request.source.sourceRef);
    // Capacity is checked after every asynchronous source/helper operation and
    // immediately before reservation. Concurrent starts therefore cannot all
    // pass a stale pre-await size check and overrun the native fixed bound.
    if (this.#sessions.size >= MAX_SESSIONS) {
      throw new SckCaptureClientError({
        code: "unsupported",
        message: "Screen capture session capacity is exhausted",
        recovery: "automatic",
      });
    }
    const active: ActiveSession = {
      sessionKey,
      producerEpoch: request.producerEpoch,
      request,
      generation: helper.generation,
      disposed: false,
      lastActuationRevision: request.demand.revision,
      actuationTail: Promise.resolve(),
    };
    this.#sessions.set(sessionKey, active);
    try {
      await this.request(helper, "start", "started", {
        sessionKey,
        producerEpoch: request.producerEpoch,
        sourceRef,
        crop: request.source.crop ?? { mode: "none" },
        captureCursor: request.source.captureCursor,
        demand: request.demand,
      });
    } catch (error) {
      this.#sessions.delete(sessionKey);
      if (error instanceof SckCaptureClientError) throw error;
      throw new SckCaptureClientError({
        code: "producer-crashed",
        message: "Screen capture helper could not create the session",
        recovery: "automatic",
      });
    }
    let disposed = false;
    return {
      setDemand: async (demand) => {
        if (disposed || active.disposed) return;
        if (demand.revision <= active.lastActuationRevision) {
          throw new Error("SCK helper demand revision must increase");
        }
        active.lastActuationRevision = demand.revision;
        const operation = active.actuationTail.then(async () => {
          if (disposed || active.disposed) return;
          const current = this.#running;
          if (current === null || current.generation !== active.generation) {
            throw new Error("SCK helper generation ended");
          }
          await this.request(current, "demand", "demand-applied", {
            sessionKey,
            producerEpoch: request.producerEpoch,
            demand,
          });
        });
        active.actuationTail = operation.catch(() => undefined);
        await operation;
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        active.disposed = true;
        this.#sessions.delete(sessionKey);
        await active.actuationTail.catch(() => undefined);
        const current = this.#running;
        if (current === null || current.generation !== active.generation) return;
        try {
          await this.request(current, "stop", "stopped", {
            sessionKey,
            producerEpoch: request.producerEpoch,
          });
        } catch {
          // Helper/process teardown is already the stronger cleanup boundary.
        }
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stopPolling();
    const helper = this.#running;
    this.#running = null;
    this.#starting = null;
    for (const session of this.#sessions.values()) session.disposed = true;
    this.#sessions.clear();
    this.rejectPending(new Error("Screen capture helper supervisor closed"));
    if (helper !== null) {
      helper.stopping = true;
      try {
        this.writeCommand(helper, { v: 1, type: "shutdown", token: helper.capabilityHex });
      } catch {
        // The private pipe is already gone.
      }
      helper.child.stdin.end();
      helper.child.kill("SIGTERM");
    }
    try {
      this.#adapter.stop();
    } catch {
      // Idempotent native teardown is best-effort during app exit.
    }
  }

  private async ensureRunning(): Promise<RunningHelper> {
    if (this.#disposed) throw new Error("Screen capture helper supervisor is closed");
    if (this.#running !== null) return this.#running;
    if (this.#starting !== null) return this.#starting;
    const starting = this.launchHelper();
    this.#starting = starting;
    try {
      return await starting;
    } finally {
      if (this.#starting === starting) this.#starting = null;
    }
  }

  private async launchHelper(): Promise<RunningHelper> {
    const capabilityHex = this.#randomHex(32);
    const serviceName = `com.jamesyong.vibefield.capture.${process.pid}.${this.#randomHex(16)}`;
    if (
      !hex(capabilityHex, 32) ||
      !/^com\.jamesyong\.vibefield\.capture\.[0-9]+\.[a-f0-9]{32}$/u.test(serviceName)
    ) {
      throw new Error("capture helper capability generator returned invalid material");
    }
    this.#adapter.start(serviceName, capabilityHex);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.#spawnHelper(this.#helperPath, ["--mach-service", serviceName]);
    } catch (error) {
      this.#adapter.stop();
      throw error;
    }
    if (!safeInteger(child.pid, 1, 0x7fff_ffff)) {
      child.kill("SIGKILL");
      this.#adapter.stop();
      throw new Error("capture helper did not receive a process identity");
    }
    this.#helperGeneration = increment(this.#helperGeneration, "capture helper generation");
    const helper: RunningHelper = {
      child,
      capabilityHex,
      serviceName,
      generation: this.#helperGeneration,
      stdoutBuffer: Buffer.alloc(0),
      stopping: false,
    };
    this.#running = helper;
    this.#helperStarts += 1;
    child.stdout.on("data", (chunk: Buffer | string) => this.onStdout(helper, chunk));
    child.stderr.on("data", (chunk: Buffer | string) => {
      const message = Buffer.from(chunk).subarray(0, 4_096).toString("utf8").trim();
      if (message.length > 0) this.#onDiagnostic?.(message);
    });
    child.once("error", (error) => this.onHelperExit(helper, error));
    child.once("exit", (code, signal) =>
      this.onHelperExit(
        helper,
        new Error(`capture helper exited (${code ?? signal ?? "unknown"})`),
      ),
    );
    try {
      this.#adapter.setExpectedPeerPid(child.pid);
      const response = await this.request(helper, "hello", "ready", {
        expectedParentPid: process.pid,
      });
      if (response["protocolVersion"] !== PROTOCOL_VERSION || response["pid"] !== child.pid) {
        throw this.protocolFailure(helper, "capture helper identity handshake did not match");
      }
      this.startPolling();
      return helper;
    } catch (error) {
      this.onHelperExit(helper, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async currentSourceRef(helper: RunningHelper, sourceRef: string): Promise<string> {
    const alias = this.#sourceAliases.get(sourceRef);
    if (alias === undefined || alias.generation === helper.generation) return sourceRef;
    const sources = await this.enumerateWindows(true);
    const rebound = sources.find(
      (source) =>
        source.windowId === alias.descriptor.windowId &&
        source.ownerPid === alias.descriptor.ownerPid,
    );
    if (rebound === undefined) {
      throw new SckCaptureClientError({
        code: "source-not-found",
        message: "The selected capture window is no longer available",
        recovery: "user-action",
      });
    }
    this.rememberSourceAlias(sourceRef, {
      generation: helper.generation,
      descriptor: rebound,
    });
    return rebound.sourceRef;
  }

  private request(
    helper: RunningHelper,
    type: string,
    expectedEvent: string,
    fields: JsonRecord,
  ): Promise<JsonRecord> {
    if (this.#running !== helper || helper.stopping) {
      return Promise.reject(new Error("capture helper generation is not running"));
    }
    this.#requestSequence = increment(this.#requestSequence, "capture helper request sequence");
    const requestId = `request_${this.#requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(this.protocolFailure(helper, `capture helper ${type} request timed out`));
      }, this.#requestTimeoutMs);
      this.#pending.set(requestId, { expectedEvent, resolve, reject, timer });
      try {
        this.writeCommand(helper, {
          v: PROTOCOL_VERSION,
          type,
          requestId,
          token: helper.capabilityHex,
          ...fields,
        });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private writeCommand(helper: RunningHelper, command: JsonRecord): void {
    const line = `${JSON.stringify(command)}\n`;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES)
      throw new Error("capture helper command is too large");
    helper.child.stdin.write(line);
  }

  private onStdout(helper: RunningHelper, chunk: Buffer | string): void {
    if (this.#running !== helper) return;
    helper.stdoutBuffer = Buffer.concat([helper.stdoutBuffer, Buffer.from(chunk)]);
    if (helper.stdoutBuffer.byteLength > MAX_LINE_BYTES) {
      this.protocolFailure(helper, "capture helper output exceeded its bound");
      return;
    }
    for (;;) {
      const newline = helper.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = helper.stdoutBuffer.subarray(0, newline);
      helper.stdoutBuffer = helper.stdoutBuffer.subarray(newline + 1);
      if (line.byteLength === 0) continue;
      let message: unknown;
      try {
        message = JSON.parse(line.toString("utf8"));
      } catch {
        this.protocolFailure(helper, "capture helper emitted malformed JSON");
        return;
      }
      if (
        !isRecord(message) ||
        message["v"] !== PROTOCOL_VERSION ||
        !boundedString(message["event"])
      ) {
        this.protocolFailure(helper, "capture helper emitted an invalid event");
        return;
      }
      this.onMessage(helper, message);
    }
  }

  private onMessage(helper: RunningHelper, message: JsonRecord): void {
    const requestId = message["requestId"];
    if (typeof requestId === "string") {
      const pending = this.#pending.get(requestId);
      if (pending === undefined) {
        this.protocolFailure(helper, "capture helper replied to an unknown request");
        return;
      }
      this.#pending.delete(requestId);
      clearTimeout(pending.timer);
      if (message["event"] === "error") {
        pending.reject(
          new SckCaptureClientError(
            surfaceError(message["error"], "Capture helper rejected a request"),
          ),
        );
        return;
      }
      if (message["event"] !== pending.expectedEvent) {
        pending.reject(this.protocolFailure(helper, "capture helper replied with the wrong event"));
        return;
      }
      pending.resolve(message);
      return;
    }
    if (message["event"] === "session-fault" && hex(message["sessionKey"], 16)) {
      const session = this.#sessions.get(message["sessionKey"]);
      if (session === undefined || session.generation !== helper.generation) return;
      try {
        session.request.onFault(surfaceError(message["error"], "Screen capture session failed"));
      } catch (error) {
        this.#onDiagnostic?.(
          `Screen capture fault observer failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    if (message["event"] === "helper-fault") {
      this.onHelperExit(helper, new Error("capture helper reported a terminal fault"));
      return;
    }
    this.protocolFailure(helper, "capture helper emitted an unknown unsolicited event");
  }

  private startPolling(): void {
    if (this.#pollTimer !== null) return;
    this.#pollTimer = setInterval(() => this.drainFrames(), this.#pollIntervalMs);
    this.#pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  private drainFrames(): void {
    const helper = this.#running;
    if (helper === null || helper.stopping) return;
    let rawFrames: readonly MacosCaptureNativeFrame[];
    try {
      this.observeNativeStats();
      rawFrames = this.#adapter.drain(MAX_SESSIONS * 2);
      this.observeNativeStats();
    } catch (error) {
      this.onHelperExit(helper, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (rawFrames.length > MAX_SESSIONS * 2) {
      this.protocolFailure(helper, "native capture adapter exceeded its drain bound");
      return;
    }
    for (const raw of rawFrames) {
      this.#framesReceived += 1;
      const frame = validateNativeFrame(raw);
      if (frame === null) {
        this.#framesRejected += 1;
        if (decimalU64(raw.frameId)) this.releaseNative(helper, raw.frameId);
        this.protocolFailure(helper, "native capture adapter returned invalid frame metadata");
        return;
      }
      const session = this.#sessions.get(frame.sessionKey);
      if (
        session === undefined ||
        session.disposed ||
        session.generation !== helper.generation ||
        session.producerEpoch !== frame.producerEpoch
      ) {
        this.#framesRejected += 1;
        this.releaseNative(helper, frame.frameId);
        this.sendRelease(helper, frame, "dropped");
        continue;
      }
      let localReleased = false;
      let leaseReleased = false;
      const captureFrame: SckCaptureFrame = {
        producerEpoch: frame.producerEpoch,
        sequence: BigInt(frame.sequence),
        codedSize: { width: frame.width, height: frame.height },
        logicalSize: session.request.geometry?.logicalSize ?? {
          width: frame.logicalWidth,
          height: frame.logicalHeight,
        },
        ...(session.request.geometry === undefined
          ? {}
          : {
              orientation: session.request.geometry.orientation,
              cropState: session.request.geometry.cropState,
            }),
        ...(frame.timestampUs === undefined ? {} : { timestampUs: BigInt(frame.timestampUs) }),
        textureInfo: {
          codedSize: { width: frame.width, height: frame.height },
          visibleRect: { x: 0, y: 0, width: frame.width, height: frame.height },
          pixelFormat: "bgra",
          handle: { ioSurface: frame.ioSurface },
        },
        releaseLocal: () => {
          if (localReleased) return;
          localReleased = true;
          this.releaseNative(helper, frame.frameId);
        },
        releaseLease: (disposition) => {
          if (leaseReleased) return;
          leaseReleased = true;
          const current = this.#running;
          if (current !== null && current.generation === session.generation) {
            this.sendRelease(current, frame, disposition);
          }
        },
      };
      try {
        session.request.onFrame(captureFrame);
      } catch {
        captureFrame.releaseLocal();
        captureFrame.releaseLease("dropped");
      }
    }
  }

  private observeNativeStats(): MacosCaptureNativeAdapterStats {
    const stats = this.#adapter.stats();
    this.#nativeOutstandingPeak = Math.max(this.#nativeOutstandingPeak, stats.outstanding);
    return stats;
  }

  private sendRelease(
    helper: RunningHelper,
    frame: Pick<MacosCaptureNativeFrame, "sessionKey" | "producerEpoch" | "sequence" | "slot">,
    disposition: SckHelperLeaseDisposition,
  ): void {
    this.#releaseCommands += 1;
    try {
      this.writeCommand(helper, {
        v: PROTOCOL_VERSION,
        type: "release",
        token: helper.capabilityHex,
        sessionKey: frame.sessionKey,
        producerEpoch: frame.producerEpoch,
        sequence: frame.sequence,
        slot: frame.slot,
        disposition,
      });
    } catch {
      this.onHelperExit(helper, new Error("capture helper release pipe failed"));
    }
  }

  private releaseNative(helper: RunningHelper, frameId: string): void {
    try {
      if (!this.#adapter.release(frameId)) {
        this.onHelperExit(
          helper,
          new Error("native capture adapter rejected a live frame release"),
        );
      }
    } catch (error) {
      this.onHelperExit(helper, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private onHelperExit(helper: RunningHelper, error: Error): void {
    if (this.#running !== helper) return;
    const wasStopping = helper.stopping;
    this.#running = null;
    helper.stopping = true;
    this.stopPolling();
    this.#helperExits += 1;
    this.rejectPending(error);
    try {
      this.#adapter.stop();
    } catch {
      // Native receiver already observed process teardown.
    }
    for (const [sessionKey, session] of this.#sessions) {
      if (session.generation !== helper.generation) continue;
      this.#sessions.delete(sessionKey);
      session.disposed = true;
      try {
        session.request.onFault({
          code: "producer-crashed",
          message: "Screen capture helper exited",
          recovery: "automatic",
        });
      } catch (callbackError) {
        this.#onDiagnostic?.(
          `Screen capture exit observer failed: ${
            callbackError instanceof Error ? callbackError.message : String(callbackError)
          }`,
        );
      }
    }
    if (!wasStopping && helper.child.exitCode === null) helper.child.kill("SIGTERM");
  }

  private protocolFailure(helper: RunningHelper, message: string): SckCaptureClientError {
    const error = new SckCaptureClientError({
      code: "protocol-violation",
      message,
      recovery: "permanent",
    });
    this.onHelperExit(helper, error);
    return error;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  private uniqueSessionKey(): string {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = this.#randomHex(16);
      if (hex(candidate, 16) && !this.#sessions.has(candidate)) return candidate;
    }
    throw new Error("could not mint a unique capture session identity");
  }

  private rememberSourceAlias(sourceRef: string, alias: SourceAlias): void {
    if (!this.#sourceAliases.has(sourceRef) && this.#sourceAliases.size >= MAX_SOURCE_ALIASES) {
      const oldest = this.#sourceAliases.keys().next().value as string | undefined;
      if (oldest !== undefined) this.#sourceAliases.delete(oldest);
    }
    this.#sourceAliases.set(sourceRef, alias);
  }
}

function increment(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} exhausted its safe integer range`);
  }
  return value + 1;
}
