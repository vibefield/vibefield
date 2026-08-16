import {
  LiveSurfaceFrameEnvelopeV1,
  type LiveSurfacePortBootstrapV1 as LiveSurfacePortBootstrap,
  LiveSurfacePortBootstrapV1,
} from "@vibefield/contracts";

export interface PreloadLiveSurfaceMessageEvent {
  readonly data: unknown;
}

export interface PreloadLiveSurfacePort {
  onmessage: ((event: PreloadLiveSurfaceMessageEvent) => void) | null;
  onmessageerror?: (() => void) | null;
  postMessage(message: unknown, transfer?: readonly object[]): void;
  start(): void;
  close(): void;
}

export interface PreloadLiveSurfaceFrame {
  close(): void;
}

export interface PreloadImportedSharedTexture {
  getVideoFrame(): PreloadLiveSurfaceFrame;
  release(): void;
}

export interface PreloadReceivedSharedTexture {
  readonly importedSharedTexture: PreloadImportedSharedTexture;
}

export interface PreloadLiveSurfaceFrameMuxOptions {
  readonly forwardPorts: (
    bootstrap: LiveSurfacePortBootstrap,
    controlPort: PreloadLiveSurfacePort,
    framePort: PreloadLiveSurfacePort,
  ) => void;
  readonly createCpuFrame?: (
    pixels: Uint8Array,
    options: {
      readonly format: "BGRA" | "RGBA";
      readonly codedWidth: number;
      readonly codedHeight: number;
      readonly timestamp: number;
    },
  ) => PreloadLiveSurfaceFrame;
  readonly onRejected?: (reason: string) => void;
}

export interface PreloadLiveSurfaceFrameMuxStats {
  readonly generation: number | null;
  readonly sharedAccepted: number;
  readonly cpuAccepted: number;
  readonly dropped: number;
}

interface CpuFrameMessage {
  readonly type: "cpu-frame";
  readonly envelope: unknown;
  readonly pixels: unknown;
}

interface VideoFrameConstructorLike {
  new (
    pixels: Uint8Array,
    options: {
      readonly format: "BGRA" | "RGBA";
      readonly codedWidth: number;
      readonly codedHeight: number;
      readonly timestamp: number;
    },
  ): PreloadLiveSurfaceFrame;
}

function defaultCpuFrame(
  pixels: Uint8Array,
  options: {
    readonly format: "BGRA" | "RGBA";
    readonly codedWidth: number;
    readonly codedHeight: number;
    readonly timestamp: number;
  },
): PreloadLiveSurfaceFrame {
  const videoFrameConstructor = (
    globalThis as unknown as {
      VideoFrame?: VideoFrameConstructorLike;
    }
  ).VideoFrame;
  if (videoFrameConstructor === undefined) {
    throw new Error("VideoFrame is unavailable in this renderer");
  }
  return new videoFrameConstructor(pixels, options);
}

function cpuFrameMessage(value: unknown): CpuFrameMessage | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<CpuFrameMessage>;
  if (candidate.type !== "cpu-frame") return null;
  return { type: "cpu-frame", envelope: candidate.envelope, pixels: candidate.pixels };
}

/** Isolated-world owner of the sole shared-texture receiver for one generation. */
export class PreloadLiveSurfaceFrameMux {
  #generation: number | null = null;
  #frameSender: PreloadLiveSurfacePort | null = null;
  #fallbackIngress: PreloadLiveSurfacePort | null = null;
  #sharedAccepted = 0;
  #cpuAccepted = 0;
  #dropped = 0;

  constructor(readonly options: PreloadLiveSurfaceFrameMuxOptions) {}

  get stats(): PreloadLiveSurfaceFrameMuxStats {
    return {
      generation: this.#generation,
      sharedAccepted: this.#sharedAccepted,
      cpuAccepted: this.#cpuAccepted,
      dropped: this.#dropped,
    };
  }

  bind(rawBootstrap: unknown, ports: readonly PreloadLiveSurfacePort[]): boolean {
    const bootstrap = LiveSurfacePortBootstrapV1.safeParse(rawBootstrap);
    if (!bootstrap.success || ports.length !== 4) {
      for (const port of ports) this.closePort(port);
      this.reject("invalid generation port handoff");
      return false;
    }
    const controlPort = ports[0];
    const frameSender = ports[1];
    const frameReceiver = ports[2];
    const fallbackIngress = ports[3];
    if (
      controlPort === undefined ||
      frameSender === undefined ||
      frameReceiver === undefined ||
      fallbackIngress === undefined
    ) {
      for (const port of ports) this.closePort(port);
      this.reject("incomplete generation port handoff");
      return false;
    }
    this.disposeRetainedPorts();
    this.#generation = bootstrap.data.rendererGeneration;
    this.#frameSender = frameSender;
    this.#fallbackIngress = fallbackIngress;
    fallbackIngress.onmessage = (event) => this.acceptCpuFrame(event.data);
    fallbackIngress.onmessageerror = () => this.reject("fallback ingress message failed");
    frameSender.start();
    fallbackIngress.start();
    try {
      this.options.forwardPorts(bootstrap.data, controlPort, frameReceiver);
      return true;
    } catch {
      this.disposeRetainedPorts();
      this.closePort(controlPort);
      this.closePort(frameReceiver);
      this.reject("main-world port forward failed");
      return false;
    }
  }

  async acceptSharedTexture(
    received: PreloadReceivedSharedTexture,
    rawEnvelope: unknown,
  ): Promise<void> {
    const imported = received.importedSharedTexture;
    let importedReleased = false;
    let frame: PreloadLiveSurfaceFrame | null = null;
    const releaseImported = (): void => {
      if (importedReleased) return;
      importedReleased = true;
      try {
        imported.release();
      } catch {
        this.reject("shared texture wrapper release failed");
      }
    };
    try {
      const envelope = LiveSurfaceFrameEnvelopeV1.safeParse(rawEnvelope);
      const sender = this.#frameSender;
      if (!envelope.success || sender === null) {
        this.reject("shared texture arrived without a valid attachment envelope");
        return;
      }
      frame = imported.getVideoFrame();
      releaseImported();
      sender.postMessage({ type: "frame", envelope: envelope.data, frame }, [frame]);
      frame = null;
      this.#sharedAccepted += 1;
    } catch {
      this.reject("shared texture frame transfer failed");
    } finally {
      releaseImported();
      try {
        frame?.close();
      } catch {
        // A failed transferable frame is already detached or closed.
      }
    }
  }

  dispose(): void {
    this.disposeRetainedPorts();
    this.#generation = null;
  }

  private acceptCpuFrame(raw: unknown): void {
    const message = cpuFrameMessage(raw);
    const sender = this.#frameSender;
    if (message === null || sender === null || !(message.pixels instanceof Uint8Array)) {
      this.reject("malformed CPU fallback frame");
      return;
    }
    const envelope = LiveSurfaceFrameEnvelopeV1.safeParse(message.envelope);
    if (!envelope.success) {
      this.reject("malformed CPU fallback envelope");
      return;
    }
    const metadata = envelope.data.metadata;
    const { width, height } = metadata.geometry.codedSize;
    if (
      metadata.transport !== "cpu-bgra" ||
      metadata.degradedMode !== "cpu-bitmap" ||
      (metadata.pixelFormat !== "bgra" && metadata.pixelFormat !== "rgba") ||
      message.pixels.byteLength !== width * height * 4
    ) {
      this.reject("incoherent CPU fallback frame");
      return;
    }
    const timestamp = Number(metadata.hostReceivedAtUs);
    if (!Number.isSafeInteger(timestamp)) {
      this.reject("CPU fallback timestamp exceeds renderer precision");
      return;
    }
    let frame: PreloadLiveSurfaceFrame | null = null;
    try {
      frame = (this.options.createCpuFrame ?? defaultCpuFrame)(message.pixels, {
        format: metadata.pixelFormat === "bgra" ? "BGRA" : "RGBA",
        codedWidth: width,
        codedHeight: height,
        timestamp,
      });
      sender.postMessage({ type: "frame", envelope: envelope.data, frame }, [frame]);
      frame = null;
      this.#cpuAccepted += 1;
    } catch {
      this.reject("CPU fallback frame transfer failed");
    } finally {
      try {
        frame?.close();
      } catch {
        // The failed transfer may already have detached the VideoFrame.
      }
    }
  }

  private reject(reason: string): void {
    this.#dropped += 1;
    this.options.onRejected?.(reason);
  }

  private disposeRetainedPorts(): void {
    const sender = this.#frameSender;
    const fallback = this.#fallbackIngress;
    this.#frameSender = null;
    this.#fallbackIngress = null;
    this.closePort(sender);
    this.closePort(fallback);
  }

  private closePort(port: PreloadLiveSurfacePort | null): void {
    if (port === null) return;
    port.onmessage = null;
    try {
      port.close();
    } catch {
      // Its owning renderer generation already ended.
    }
  }
}
