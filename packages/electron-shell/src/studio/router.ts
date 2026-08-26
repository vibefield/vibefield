import {
  type AppearanceClearReason,
  type HostToProduct,
  type HostToStudio,
  MAX_PUBLISHES_PER_SECOND,
  type ProductConnectionState,
  type ProductContext,
  parseProductToHost,
  parseStudioToHost,
  type StudioDisconnectReason,
  StudioProtocolError,
  type StudioSection,
  type StudioStatus,
} from "./protocol";

export interface StudioRouterPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): this;
  once(event: "close", listener: () => void): this;
  start(): void;
  close(): void;
}

export interface StudioRouterState extends StudioStatus {
  readonly retainedBytes: number;
}

export class StudioRouter {
  private studioPort: StudioRouterPort | null = null;
  private productPort: StudioRouterPort | null = null;
  private studioGeneration = 0;
  private productGeneration = 0;
  private studioReady = false;
  private productReady = false;
  private productConnection: ProductConnectionState = "unavailable";
  private productInstanceId: string | null = null;
  private productContext: ProductContext | null = null;
  private hasConnectedProduct = false;
  private latestSerialized: string | null = null;
  private live = false;
  private currentRevision: number | null = null;
  private appliedRevision: number | null = null;
  private rejection: StudioStatus["rejection"] = null;
  private revisionSequence = 0;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rateWindowStartedAt = 0;
  private rateWindowCount = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly focusProduct: () => void = () => undefined,
  ) {}

  attachStudio(port: StudioRouterPort): void {
    this.cancelDisconnect();
    const generation = ++this.studioGeneration;
    const previous = this.studioPort;
    this.studioPort = null;
    previous?.close();
    this.cancelDisconnect();
    this.studioPort = port;
    this.studioReady = false;
    port.on("message", (event) => {
      if (this.studioPort !== port || generation !== this.studioGeneration) return;
      try {
        const message = parseStudioToHost(event.data);
        if (message.type === "studio.ready") {
          this.studioReady = true;
          this.postStudio({
            type: "studio.snapshot",
            revision: this.currentRevision,
            serialized: this.latestSerialized,
            live: this.live,
          });
          this.publishStatus();
          if (this.productContext !== null) {
            this.postStudio({ type: "product.context", ...this.productContext });
          }
          return;
        }
        if (!this.studioReady) {
          this.protocolFailure("malformed");
          return;
        }
        if (!this.acceptRate()) {
          this.protocolFailure("rate-limited");
          return;
        }
        if (message.type === "product.focus") {
          this.focusProduct();
          return;
        }
        if (message.type === "appearance.publish") {
          const revision = this.nextRevision();
          this.latestSerialized = message.serialized;
          this.live = true;
          this.currentRevision = revision;
          this.appliedRevision = null;
          this.rejection = null;
          this.postStudio({
            type: "appearance.accepted",
            requestId: message.requestId,
            revision,
          });
          this.postProduct({ type: "appearance.apply", revision, serialized: message.serialized });
          this.publishStatus();
          return;
        }
        const revision = this.nextRevision();
        this.live = false;
        this.currentRevision = revision;
        this.appliedRevision = null;
        this.rejection = null;
        this.postStudio({
          type: "appearance.accepted",
          requestId: message.requestId,
          revision,
        });
        this.postProduct({ type: "appearance.clear", revision, reason: "live-disabled" });
        this.publishStatus();
      } catch (error) {
        this.protocolFailure(protocolErrorReason(error));
      }
    });
    port.once("close", () => {
      if (this.studioPort !== port || generation !== this.studioGeneration) return;
      this.studioPort = null;
      this.studioReady = false;
      this.scheduleStudioDisconnect();
    });
    port.start();
  }

  attachProduct(port: StudioRouterPort): void {
    this.productPort?.close();
    const generation = ++this.productGeneration;
    this.productPort = port;
    this.productReady = false;
    this.productConnection = this.hasConnectedProduct ? "reconnecting" : "connecting";
    this.productInstanceId = null;
    this.productContext = null;
    this.appliedRevision = null;
    this.rejection = null;
    this.publishStatus();
    port.on("message", (event) => {
      if (this.productPort !== port || generation !== this.productGeneration) return;
      try {
        const message = parseProductToHost(event.data);
        if (message.type === "product.ready") {
          if (this.productReady) throw new StudioProtocolError("malformed");
          this.productReady = true;
          this.productConnection = "connected";
          this.productInstanceId = message.instanceId;
          this.hasConnectedProduct = true;
          this.appliedRevision = null;
          this.rejection = null;
          this.replayProduct();
          this.publishStatus();
          return;
        }
        if (message.type === "product.context") {
          if (!this.productReady) return;
          this.productContext = { theme: message.theme, zoom: message.zoom };
          this.postStudio(message);
          return;
        }
        if (
          !this.productReady ||
          message.revision !== this.currentRevision ||
          message.instanceId !== this.productInstanceId
        ) {
          return;
        }
        if (message.type === "appearance.applied") {
          this.appliedRevision = message.revision;
          this.rejection = null;
          this.postStudio({ type: "appearance.applied", revision: message.revision });
        } else {
          this.rejection = message.code;
          this.postStudio({
            type: "appearance.rejected",
            revision: message.revision,
            code: message.code,
          });
        }
        this.publishStatus();
      } catch {
        this.detachProduct(port, generation);
      }
    });
    port.once("close", () => this.detachProduct(port, generation));
    port.start();
  }

  closeStudio(reason: AppearanceClearReason): void {
    this.cancelDisconnect();
    const previous = this.studioPort;
    this.studioPort = null;
    this.studioGeneration += 1;
    this.studioReady = false;
    previous?.close();
    this.cancelDisconnect();
    this.clearProductOverride(reason);
  }

  detachProductEndpoint(): void {
    this.productPort?.close();
    this.productPort = null;
    this.productReady = false;
    this.productConnection = "unavailable";
    this.productInstanceId = null;
    this.productContext = null;
    this.appliedRevision = null;
    this.rejection = null;
    this.productGeneration += 1;
    this.publishStatus();
  }

  state(): StudioRouterState {
    return Object.freeze({
      ...this.status(),
      retainedBytes:
        this.latestSerialized === null
          ? 0
          : new TextEncoder().encode(this.latestSerialized).byteLength,
    });
  }

  navigateStudio(section: StudioSection): void {
    this.postStudio({ type: "studio.navigate", section });
  }

  dispose(): void {
    this.cancelDisconnect();
    this.clearProductOverride("host-disposed");
    const studioPort = this.studioPort;
    const productPort = this.productPort;
    this.studioPort = null;
    this.productPort = null;
    this.studioGeneration += 1;
    this.productGeneration += 1;
    this.studioReady = false;
    this.productReady = false;
    this.productConnection = "unavailable";
    this.productInstanceId = null;
    this.productContext = null;
    studioPort?.close();
    productPort?.close();
    this.cancelDisconnect();
  }

  private replayProduct(): void {
    const revision = this.currentRevision;
    if (revision === null) return;
    if (this.live && this.latestSerialized !== null) {
      this.postProduct({
        type: "appearance.apply",
        revision,
        serialized: this.latestSerialized,
      });
    } else {
      this.postProduct({ type: "appearance.clear", revision, reason: "live-disabled" });
    }
  }

  private postProduct(message: HostToProduct): void {
    if (!this.productReady) return;
    this.productPort?.postMessage(message);
  }

  private postStudio(message: HostToStudio): void {
    if (!this.studioReady) return;
    this.studioPort?.postMessage(message);
  }

  private publishStatus(): void {
    this.postStudio({ type: "studio.status", status: this.status() });
  }

  private status(): StudioStatus {
    return {
      productConnection: this.productConnection,
      live: this.live,
      revision: this.currentRevision,
      appliedRevision: this.appliedRevision,
      rejection: this.rejection,
    };
  }

  private nextRevision(): number {
    if (this.revisionSequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Studio revision sequence exhausted");
    }
    this.revisionSequence += 1;
    return this.revisionSequence;
  }

  private acceptRate(): boolean {
    const now = this.now();
    if (now - this.rateWindowStartedAt >= 1_000) {
      this.rateWindowStartedAt = now;
      this.rateWindowCount = 0;
    }
    this.rateWindowCount += 1;
    return this.rateWindowCount <= MAX_PUBLISHES_PER_SECOND;
  }

  private protocolFailure(reason: StudioDisconnectReason): void {
    this.studioPort?.postMessage({ type: "studio.disconnected", reason } satisfies HostToStudio);
    this.closeStudio("protocol-error");
  }

  private detachProduct(port: StudioRouterPort, generation: number): void {
    if (this.productPort !== port || generation !== this.productGeneration) return;
    this.productPort = null;
    this.productReady = false;
    this.productConnection = "unavailable";
    this.productInstanceId = null;
    this.productContext = null;
    this.appliedRevision = null;
    this.rejection = null;
    this.publishStatus();
  }

  private scheduleStudioDisconnect(): void {
    this.cancelDisconnect();
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;
      if (this.studioPort === null) this.clearProductOverride("studio-timeout");
    }, 5_000);
  }

  private cancelDisconnect(): void {
    if (this.disconnectTimer !== null) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private clearProductOverride(reason: AppearanceClearReason): void {
    if (!this.live) return;
    const revision = this.nextRevision();
    this.live = false;
    this.currentRevision = revision;
    this.appliedRevision = null;
    this.rejection = null;
    this.postProduct({ type: "appearance.clear", revision, reason });
    this.publishStatus();
  }
}

function protocolErrorReason(error: unknown): StudioDisconnectReason {
  return error instanceof StudioProtocolError ? error.code : "malformed";
}
