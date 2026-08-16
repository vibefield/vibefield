import {
  type LiveSurfaceDemandV1,
  type LiveSurfaceErrorV1,
  type LiveSurfaceFrameMetadataV1,
  LiveSurfaceGeometryV1,
  LiveSurfaceIdV1,
  type LiveSurfaceLogicalSizeV1,
  type LiveSurfacePixelSizeV1,
  type LiveSurfaceRuntimeSummaryV1,
  LiveSurfaceSckWindowSourceV1,
  type LiveSurfaceSckWindowSourceV1 as SckWindowSource,
} from "@vibefield/contracts";
import { LiveSurfaceDemandTracker, LiveSurfaceLifecycle } from "@vibefield/live-surfaces";
import type {
  LiveSurfaceRuntimeAttachContext,
  LiveSurfaceRuntimeAttachment,
  LiveSurfaceRuntimeAuthority,
} from "./runtime";
import type {
  LiveSurfaceMainFrameDropReason,
  LiveSurfaceProducerTextureFrame,
} from "./texture-forwarder";

const DEFAULT_STARTUP_TIMEOUT_MS = 8_000;
const DEFAULT_RESTART_LIMIT = 2;

const SCK_CAPABILITIES = {
  pointer: false,
  wheel: false,
  keyboard: false,
  textInput: false,
  touch: false,
  rotateDevice: false,
  resizeLogicalViewport: false,
  resizeBackingRaster: true,
  crop: true,
} as const;

export type SckHelperLeaseDisposition = "released" | "dropped" | "quarantined";

/** One already-authenticated, process-local IOSurface reference from the macOS adapter. */
export interface SckCaptureFrame {
  readonly producerEpoch: number;
  readonly sequence: bigint;
  readonly codedSize: LiveSurfacePixelSizeV1;
  readonly logicalSize: LiveSurfaceLogicalSizeV1;
  readonly timestampUs?: bigint;
  readonly textureInfo: Electron.SharedTextureImportTextureInfo;
  /** Releases only Electron main's IOSurfaceRef, after every synchronous import/drop. */
  releaseLocal(): void;
  /** Completes or quarantines the helper's retained sample-buffer slot. */
  releaseLease(disposition: SckHelperLeaseDisposition): void;
}

export interface SckCaptureSessionDemand {
  readonly revision: number;
  readonly mode: LiveSurfaceDemandV1["mode"];
  readonly targetFps: LiveSurfaceDemandV1["targetFps"];
  readonly targetRasterSize?: LiveSurfacePixelSizeV1;
}

export interface SckCaptureSession {
  setDemand(demand: SckCaptureSessionDemand): Promise<void>;
  dispose(): Promise<void>;
}

export interface SckCaptureClientStartRequest {
  readonly producerEpoch: number;
  readonly source: SckWindowSource;
  readonly demand: SckCaptureSessionDemand;
  readonly onFrame: (frame: SckCaptureFrame) => void;
  readonly onFault: (error: LiveSurfaceErrorV1) => void;
}

/** Injectable supervisor boundary. Production owns one helper; tests own no native process. */
export interface SckCaptureClient {
  startSession(request: SckCaptureClientStartRequest): Promise<SckCaptureSession>;
}

export class SckCaptureClientError extends Error {
  constructor(readonly surfaceError: LiveSurfaceErrorV1) {
    super(surfaceError.message);
    this.name = "SckCaptureClientError";
  }
}

export interface SckLiveSurfaceRuntimeOptions {
  readonly surfaceId: string;
  readonly source: SckWindowSource;
  readonly client: SckCaptureClient;
  readonly monotonicNowUs?: () => bigint;
  readonly startupTimeoutMs?: number;
  readonly restartLimit?: number;
}

export interface SckLiveSurfaceRuntimeStats {
  readonly attachmentsCreated: number;
  readonly activeAttachments: number;
  readonly sessionsStarted: number;
  readonly sessionRestarts: number;
  readonly framesReceived: number;
  readonly framesOffered: number;
  readonly framesAccepted: number;
  readonly framesDropped: number;
  readonly localReferencesReleased: number;
  readonly helperLeasesReleased: number;
  readonly helperLeasesQuarantined: number;
  readonly effectiveDemand: LiveSurfaceDemandV1 | null;
}

interface AttachmentRecord {
  readonly context: LiveSurfaceRuntimeAttachContext;
  readonly demand: LiveSurfaceDemandTracker;
  active: boolean;
}

interface ProducerRun {
  readonly epoch: number;
  canceled: boolean;
  session: SckCaptureSession | null;
}

function increment(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} exhausted its safe integer range`);
  }
  return value + 1;
}

function copyDemand(demand: LiveSurfaceDemandV1): LiveSurfaceDemandV1 {
  return {
    revision: demand.revision,
    mode: demand.mode,
    targetFps: demand.targetFps,
    ...(demand.targetRasterSize === undefined
      ? {}
      : {
          targetRasterSize: {
            width: demand.targetRasterSize.width,
            height: demand.targetRasterSize.height,
          },
        }),
    priority: demand.priority,
    interactive: demand.interactive,
  };
}

function aggregateDemand(attachments: Iterable<AttachmentRecord>): LiveSurfaceDemandV1 | null {
  const demands = [...attachments]
    .filter((attachment) => attachment.active)
    .map((attachment) => attachment.demand.current)
    .filter((demand): demand is LiveSurfaceDemandV1 => demand !== null);
  if (demands.length === 0) return null;
  const live = demands.filter((demand) => demand.mode === "live");
  const selected = live.length > 0 ? live : demands;
  const mode =
    live.length > 0
      ? "live"
      : demands.some((demand) => demand.mode === "paused")
        ? "paused"
        : "hibernated";
  let width = 0;
  let height = 0;
  for (const demand of selected) {
    if (demand.targetRasterSize === undefined) continue;
    width = Math.max(width, demand.targetRasterSize.width);
    height = Math.max(height, demand.targetRasterSize.height);
  }
  return {
    revision: Math.max(...selected.map((demand) => demand.revision)),
    mode,
    targetFps:
      mode === "live"
        ? (Math.max(...live.map((demand) => demand.targetFps)) as LiveSurfaceDemandV1["targetFps"])
        : 0,
    ...(width > 0 && height > 0 ? { targetRasterSize: { width, height } } : {}),
    priority: Math.max(...selected.map((demand) => demand.priority)),
    interactive: selected.some((demand) => demand.interactive),
  };
}

function demandShape(demand: LiveSurfaceDemandV1): string {
  return JSON.stringify({
    mode: demand.mode,
    targetFps: demand.targetFps,
    targetRasterSize: demand.targetRasterSize,
  });
}

function sourceError(
  code: LiveSurfaceErrorV1["code"],
  message: string,
  recovery: LiveSurfaceErrorV1["recovery"],
): LiveSurfaceErrorV1 {
  return { code, message, recovery };
}

function safeU64(value: bigint): string {
  if (value < 0n) return "0";
  return (value > 0xffff_ffff_ffff_ffffn ? 0xffff_ffff_ffff_ffffn : value).toString();
}

/** Demand-driven ScreenCaptureKit authority; helper transport details remain below this seam. */
export class SckLiveSurfaceRuntime implements LiveSurfaceRuntimeAuthority {
  readonly surfaceId: string;
  readonly source: SckWindowSource;
  readonly #client: SckCaptureClient;
  readonly #monotonicNowUs: () => bigint;
  readonly #startupTimeoutMs: number;
  readonly #restartLimit: number;
  readonly #lifecycle = new LiveSurfaceLifecycle();
  readonly #attachments = new Map<string, AttachmentRecord>();
  #run: ProducerRun | null = null;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #effectiveDemand: LiveSurfaceDemandV1 | null = null;
  #lastDemandShape = "";
  #actuationRevision = 0;
  #geometry: LiveSurfaceGeometryV1 | undefined;
  #geometryKey = "";
  #geometryRevision = 0;
  #transport: "shared-texture" | undefined;
  #lastSequence = -1n;
  #error: LiveSurfaceErrorV1 | undefined;
  #lastPublishedSummary = "";
  #restartAttempts = 0;
  #closed = false;
  #attachmentsCreated = 0;
  #sessionsStarted = 0;
  #sessionRestarts = 0;
  #framesReceived = 0;
  #framesOffered = 0;
  #framesAccepted = 0;
  #framesDropped = 0;
  #localReferencesReleased = 0;
  #helperLeasesReleased = 0;
  #helperLeasesQuarantined = 0;

  constructor(options: SckLiveSurfaceRuntimeOptions) {
    this.surfaceId = LiveSurfaceIdV1.parse(options.surfaceId);
    this.source = LiveSurfaceSckWindowSourceV1.parse(options.source);
    this.#client = options.client;
    this.#monotonicNowUs = options.monotonicNowUs ?? (() => process.hrtime.bigint() / 1_000n);
    this.#startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.#restartLimit = options.restartLimit ?? DEFAULT_RESTART_LIMIT;
    if (!Number.isSafeInteger(this.#startupTimeoutMs) || this.#startupTimeoutMs <= 0) {
      throw new RangeError("SCK startup timeout must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#restartLimit) || this.#restartLimit < 0) {
      throw new RangeError("SCK restart limit must be a non-negative safe integer");
    }
  }

  get summary(): LiveSurfaceRuntimeSummaryV1 {
    const lifecycle = this.#lifecycle.snapshot;
    return {
      v: 1,
      surfaceId: this.surfaceId,
      state: lifecycle.state,
      producerEpoch: lifecycle.producerEpoch,
      stateRevision: lifecycle.stateRevision,
      capabilities: SCK_CAPABILITIES,
      ...(this.#transport === undefined ? {} : { transport: this.#transport }),
      ...(this.#geometry === undefined ? {} : { geometry: this.#geometry }),
      ...(this.#error === undefined ? {} : { error: this.#error }),
    };
  }

  get stats(): SckLiveSurfaceRuntimeStats {
    return {
      attachmentsCreated: this.#attachmentsCreated,
      activeAttachments: this.#attachments.size,
      sessionsStarted: this.#sessionsStarted,
      sessionRestarts: this.#sessionRestarts,
      framesReceived: this.#framesReceived,
      framesOffered: this.#framesOffered,
      framesAccepted: this.#framesAccepted,
      framesDropped: this.#framesDropped,
      localReferencesReleased: this.#localReferencesReleased,
      helperLeasesReleased: this.#helperLeasesReleased,
      helperLeasesQuarantined: this.#helperLeasesQuarantined,
      effectiveDemand: this.#effectiveDemand === null ? null : copyDemand(this.#effectiveDemand),
    };
  }

  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment {
    if (this.#closed) throw new Error("cannot attach a closed SCK Live Surface");
    if (!context.operations.includes("view")) throw new Error("SCK attachment lacks view grant");
    if (this.#attachments.has(context.attachmentId)) {
      throw new Error("duplicate SCK Live Surface attachment identity");
    }
    const record: AttachmentRecord = {
      context,
      demand: new LiveSurfaceDemandTracker(),
      active: true,
    };
    this.#attachments.set(context.attachmentId, record);
    this.#attachmentsCreated += 1;
    let disposed = false;
    const runtime = this;
    return {
      get summary() {
        return runtime.summary;
      },
      setDemand(demand) {
        if (disposed || !record.active) return;
        const result = record.demand.update(demand);
        if (result.kind === "accepted") runtime.reconcileDemand();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        record.active = false;
        runtime.#attachments.delete(context.attachmentId);
        runtime.reconcileDemand();
      },
    };
  }

  /** Explicit source-owner teardown. A renderer detach only hibernates this reusable authority. */
  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.clearTimers();
    this.cancelRun();
    this.#attachments.clear();
    if (this.#lifecycle.snapshot.state !== "closed") this.#lifecycle.transition("closed");
  }

  private reconcileDemand(): void {
    this.#effectiveDemand = aggregateDemand(this.#attachments.values());
    const demand = this.#effectiveDemand;
    const state = this.#lifecycle.snapshot.state;
    if (demand === null || demand.mode === "hibernated") {
      if (state === "live") this.pauseProducer();
      if (this.#lifecycle.snapshot.state === "paused") this.hibernateProducer();
      return;
    }
    if (demand.mode === "paused") {
      if (state === "live") this.pauseProducer();
      return;
    }
    if (state === "created" || state === "hibernated" || state === "failed") {
      this.startProducer(false);
      return;
    }
    if (state === "reconnecting" && this.#run === null) {
      this.scheduleRestart(true);
      return;
    }
    if (state === "paused") {
      this.#lifecycle.transition("live");
      this.applyDemand();
      this.publishSummary();
      return;
    }
    this.applyDemand();
  }

  private startProducer(reconnecting: boolean): void {
    if (this.#closed || this.#effectiveDemand?.mode !== "live") return;
    this.clearStartupTimer();
    this.cancelRun();
    if (!reconnecting) this.#lifecycle.transition("starting");
    const epoch = this.#lifecycle.snapshot.producerEpoch;
    const run: ProducerRun = { epoch, canceled: false, session: null };
    this.#run = run;
    this.resetProducerObservations();
    this.#error = undefined;
    this.#lastDemandShape = "";
    const demand = this.nextSessionDemand();
    this.#startupTimer = setTimeout(() => this.handleStartupTimeout(run), this.#startupTimeoutMs);
    this.publishSummary();
    void this.#client
      .startSession({
        producerEpoch: epoch,
        source: this.source,
        demand,
        onFrame: (frame) => this.acceptFrame(run, frame),
        onFault: (error) => this.handleSessionFault(run, error),
      })
      .then((session) => {
        if (!this.isCurrentRun(run)) {
          void session.dispose().catch(() => undefined);
          return;
        }
        run.session = session;
        this.#sessionsStarted += 1;
        this.#lastDemandShape = demandShape(this.#effectiveDemand!);
        this.reconcileDemand();
      })
      .catch((error: unknown) => {
        if (!this.isCurrentRun(run)) return;
        this.handleSessionFault(
          run,
          error instanceof SckCaptureClientError
            ? error.surfaceError
            : sourceError("producer-crashed", "Screen capture helper could not start", "automatic"),
        );
      });
  }

  private acceptFrame(run: ProducerRun, frame: SckCaptureFrame): void {
    this.#framesReceived += 1;
    if (
      !this.isCurrentRun(run) ||
      !this.#lifecycle.acceptsFrames ||
      frame.producerEpoch !== run.epoch
    ) {
      this.releaseFrame(frame, "dropped");
      return;
    }
    if (frame.sequence <= this.#lastSequence) {
      this.releaseFrame(frame, "dropped");
      this.failProtocol(run, "Screen capture helper reused or regressed a frame sequence");
      return;
    }
    const geometry = this.updateGeometry(frame.codedSize, frame.logicalSize);
    if (geometry === null || frame.textureInfo.pixelFormat !== "bgra") {
      this.releaseFrame(frame, "dropped");
      this.failProtocol(run, "Screen capture helper supplied invalid frame metadata");
      return;
    }
    this.#lastSequence = frame.sequence;
    this.#transport = "shared-texture";
    this.#error = undefined;
    this.observeFirstFrame();
    const metadata: LiveSurfaceFrameMetadataV1 = {
      v: 1,
      surfaceId: this.surfaceId,
      producerEpoch: run.epoch,
      sequence: safeU64(frame.sequence),
      geometry,
      hostReceivedAtUs: safeU64(this.#monotonicNowUs()),
      ...(frame.timestampUs === undefined
        ? {}
        : {
            producerTimestamp: {
              clockDomain: "sck-presentation",
              timestampUs: safeU64(frame.timestampUs),
            },
          }),
      pixelFormat: "bgra",
      colorSpace: "srgb",
      alphaMode: "premultiplied",
      transport: "shared-texture",
    };
    this.publishSummary();
    const targets = this.liveAttachments();
    if (targets.length === 0) {
      this.releaseFrame(frame, "dropped");
      this.reconcileDemand();
      return;
    }
    let sourceRemaining = targets.length;
    let referenceRemaining = targets.length;
    let offersRemaining = targets.length;
    let acceptedSeen = false;
    let localReleased = false;
    let helperCompleted = false;
    const releaseLocal = (): void => {
      sourceRemaining -= 1;
      if (sourceRemaining !== 0 || localReleased) return;
      localReleased = true;
      frame.releaseLocal();
      this.#localReferencesReleased += 1;
    };
    const completeHelper = (disposition: SckHelperLeaseDisposition): void => {
      if (helperCompleted) return;
      helperCompleted = true;
      frame.releaseLease(disposition);
      if (disposition === "quarantined") this.#helperLeasesQuarantined += 1;
      else this.#helperLeasesReleased += 1;
    };
    const maybeCompleteHelper = (): void => {
      if (offersRemaining === 0 && referenceRemaining === 0) {
        completeHelper(acceptedSeen ? "released" : "dropped");
      }
    };
    for (const target of targets) {
      let sourceCallbackUsed = false;
      let referenceCallbackUsed = false;
      const producerFrame: LiveSurfaceProducerTextureFrame = {
        metadata,
        textureInfo: frame.textureInfo,
        releaseSource: () => {
          if (sourceCallbackUsed) return;
          sourceCallbackUsed = true;
          releaseLocal();
        },
        allReferencesReleased: (reason) => {
          if (referenceCallbackUsed) return;
          referenceCallbackUsed = true;
          referenceRemaining -= 1;
          if (reason === "lease-timeout") completeHelper("quarantined");
          else maybeCompleteHelper();
        },
      };
      this.#framesOffered += 1;
      try {
        const result = target.context.offerTextureFrame(producerFrame);
        if (result.kind === "accepted") {
          acceptedSeen = true;
          this.#framesAccepted += 1;
        } else {
          this.#framesDropped += 1;
        }
      } catch {
        producerFrame.releaseSource("protocol-violation");
        producerFrame.allReferencesReleased("protocol-violation");
        this.#framesDropped += 1;
      } finally {
        offersRemaining -= 1;
        maybeCompleteHelper();
      }
    }
    this.reconcileDemand();
  }

  private observeFirstFrame(): void {
    this.clearStartupTimer();
    const state = this.#lifecycle.snapshot.state;
    if (state === "starting" || state === "reconnecting") {
      this.#lifecycle.transition("live");
      this.#restartAttempts = 0;
    }
  }

  private updateGeometry(
    codedSize: LiveSurfacePixelSizeV1,
    logicalSize: LiveSurfaceLogicalSizeV1,
  ): LiveSurfaceGeometryV1 | null {
    const key = `${codedSize.width}:${codedSize.height}:${logicalSize.width}:${logicalSize.height}`;
    const revision =
      key === this.#geometryKey ? this.#geometryRevision : this.#geometryRevision + 1;
    const parsed = LiveSurfaceGeometryV1.safeParse({
      revision,
      codedSize,
      visibleRect: { x: 0, y: 0, width: codedSize.width, height: codedSize.height },
      logicalSize,
      orientation: 0,
    });
    if (!parsed.success) return null;
    if (key !== this.#geometryKey) {
      this.#geometryRevision = increment(this.#geometryRevision, "SCK geometry revision");
      this.#geometryKey = key;
    }
    this.#geometry = parsed.data;
    return this.#geometry;
  }

  private pauseProducer(): void {
    if (this.#lifecycle.snapshot.state !== "live") return;
    this.#lifecycle.transition("paused");
    this.applyDemand();
    this.publishSummary();
  }

  private hibernateProducer(): void {
    if (this.#lifecycle.snapshot.state !== "paused") return;
    this.#lifecycle.transition("hibernated");
    this.cancelRun();
    this.publishSummary();
  }

  private applyDemand(): void {
    const demand = this.#effectiveDemand;
    const session = this.#run?.session;
    if (demand === null || session == null) return;
    const shape = demandShape(demand);
    if (shape === this.#lastDemandShape) return;
    this.#lastDemandShape = shape;
    const helperDemand = this.nextSessionDemand();
    void session.setDemand(helperDemand).catch(() => {
      const run = this.#run;
      if (run !== null) {
        this.handleSessionFault(
          run,
          sourceError("producer-crashed", "Screen capture demand update failed", "automatic"),
        );
      }
    });
  }

  private nextSessionDemand(): SckCaptureSessionDemand {
    const demand = this.#effectiveDemand;
    if (demand === null) throw new Error("cannot actuate SCK without demand");
    this.#actuationRevision = increment(this.#actuationRevision, "SCK actuation revision");
    return {
      revision: this.#actuationRevision,
      mode: demand.mode,
      targetFps: demand.targetFps,
      ...(demand.targetRasterSize === undefined
        ? {}
        : {
            targetRasterSize: {
              width: demand.targetRasterSize.width,
              height: demand.targetRasterSize.height,
            },
          }),
    };
  }

  private handleStartupTimeout(run: ProducerRun): void {
    this.#startupTimer = null;
    if (!this.isCurrentRun(run)) return;
    this.handleSessionFault(
      run,
      sourceError("frame-stalled", "Screen capture produced no usable frame", "automatic"),
    );
  }

  private handleSessionFault(run: ProducerRun, error: LiveSurfaceErrorV1): void {
    if (!this.isCurrentRun(run) || this.#closed) return;
    const canRestart =
      this.#effectiveDemand?.mode === "live" &&
      error.recovery === "automatic" &&
      this.#restartAttempts < this.#restartLimit;
    this.clearStartupTimer();
    this.cancelRun();
    if (canRestart) {
      this.#restartAttempts += 1;
      this.#sessionRestarts += 1;
      const state = this.#lifecycle.snapshot.state;
      if (state === "live") this.#lifecycle.transition("reconnecting");
      else if (state === "starting" || state === "reconnecting") {
        this.#lifecycle.transition("failed");
      }
      this.resetProducerObservations();
      this.#error = error;
      this.publishSummary();
      this.scheduleRestart(this.#lifecycle.snapshot.state === "reconnecting");
      return;
    }
    const state = this.#lifecycle.snapshot.state;
    if (state !== "failed" && this.#lifecycle.canTransition("failed")) {
      this.#lifecycle.transition("failed");
    }
    this.#error = error;
    this.publishSummary();
  }

  private failProtocol(run: ProducerRun, message: string): void {
    this.handleSessionFault(run, sourceError("protocol-violation", message, "permanent"));
  }

  private scheduleRestart(reconnecting: boolean): void {
    if (this.#restartTimer !== null || this.#closed || this.#effectiveDemand?.mode !== "live")
      return;
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#closed || this.#effectiveDemand?.mode !== "live") return;
      if (this.#lifecycle.snapshot.state === "failed") this.startProducer(false);
      else if (this.#lifecycle.snapshot.state === "reconnecting") this.startProducer(reconnecting);
    }, 0);
  }

  private cancelRun(): void {
    const run = this.#run;
    this.#run = null;
    if (run === null) return;
    run.canceled = true;
    const session = run.session;
    run.session = null;
    if (session !== null) void session.dispose().catch(() => undefined);
  }

  private releaseFrame(frame: SckCaptureFrame, disposition: SckHelperLeaseDisposition): void {
    frame.releaseLocal();
    frame.releaseLease(disposition);
    this.#localReferencesReleased += 1;
    if (disposition === "quarantined") this.#helperLeasesQuarantined += 1;
    else this.#helperLeasesReleased += 1;
  }

  private liveAttachments(): AttachmentRecord[] {
    return [...this.#attachments.values()].filter(
      (attachment) => attachment.active && attachment.demand.current?.mode === "live",
    );
  }

  private publishSummary(): void {
    const summary = this.summary;
    const key = JSON.stringify(summary);
    if (key === this.#lastPublishedSummary) return;
    this.#lastPublishedSummary = key;
    for (const attachment of this.#attachments.values()) {
      if (attachment.active) attachment.context.publishSummary(summary);
    }
  }

  private resetProducerObservations(): void {
    this.#transport = undefined;
    this.#geometry = undefined;
    this.#geometryKey = "";
    this.#geometryRevision = 0;
    this.#lastSequence = -1n;
  }

  private isCurrentRun(run: ProducerRun): boolean {
    return !this.#closed && !run.canceled && this.#run === run;
  }

  private clearStartupTimer(): void {
    if (this.#startupTimer !== null) clearTimeout(this.#startupTimer);
    this.#startupTimer = null;
  }

  private clearTimers(): void {
    this.clearStartupTimer();
    if (this.#restartTimer !== null) clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
  }
}

// Compile-time coverage for reasons which imply native-slot quarantine.
const _leaseTimeoutReason: LiveSurfaceMainFrameDropReason = "lease-timeout";
void _leaseTimeoutReason;
