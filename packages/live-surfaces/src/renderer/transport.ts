import {
  type LiveSurfaceAttachTicketV1,
  LiveSurfaceDemandV1,
  LiveSurfaceFrameEnvelopeV1,
  LiveSurfaceHostControlMessageV1,
  type LiveSurfacePortBootstrapV1,
  type LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import {
  LatestLiveSurfaceFrameQueue,
  type LiveSurfaceFrameLease,
  type LiveSurfaceFrameQueueStats,
} from "../frame-queue";
import {
  isLiveSurfaceClosableFrame,
  type LiveSurfaceClosableFrame,
  type LiveSurfaceMessagePort,
} from "./ports";

const PRESENTATION_STATES = new Set<LiveSurfaceRuntimeSummaryV1["state"]>([
  "starting",
  "live",
  "reconnecting",
]);

interface PendingAttach<TFrame extends LiveSurfaceClosableFrame> {
  readonly resolve: (attachment: LiveSurfaceRendererAttachment<TFrame>) => void;
  readonly reject: (error: Error) => void;
}

interface RendererFrameMessage {
  readonly type: "frame";
  readonly envelope: unknown;
  readonly frame: unknown;
}

function rendererFrameMessage(value: unknown): RendererFrameMessage | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<RendererFrameMessage>;
  if (candidate.type !== "frame" || !("frame" in candidate)) return null;
  return {
    type: "frame",
    envelope: candidate.envelope,
    frame: candidate.frame,
  };
}

function errorFromHost(message: string): Error {
  const error = new Error(message);
  error.name = "LiveSurfaceHostError";
  return error;
}

/** Renderer-local handle. It owns no source and exposes no semantic browser control. */
export class LiveSurfaceRendererAttachment<
  TFrame extends LiveSurfaceClosableFrame = LiveSurfaceClosableFrame,
> {
  readonly #summaryListeners = new Set<(summary: LiveSurfaceRuntimeSummaryV1) => void>();
  readonly #queue: LatestLiveSurfaceFrameQueue<TFrame>;
  #summary: LiveSurfaceRuntimeSummaryV1;
  #closed = false;

  constructor(
    readonly attachmentId: string,
    summary: LiveSurfaceRuntimeSummaryV1,
    private readonly sendControl: (message: unknown) => void,
    private readonly onLocalClose: (attachmentId: string) => void,
  ) {
    this.#summary = summary;
    this.#queue = new LatestLiveSurfaceFrameQueue<TFrame>(summary.producerEpoch, ({ value }) => {
      try {
        value.close();
      } catch {
        // A frame close is best-effort at this boundary; queue accounting remains exact.
      }
    });
    this.#queue.setAccepting(PRESENTATION_STATES.has(summary.state));
  }

  get surfaceId(): string {
    return this.#summary.surfaceId;
  }

  get summary(): LiveSurfaceRuntimeSummaryV1 {
    return this.#summary;
  }

  get frameStats(): LiveSurfaceFrameQueueStats {
    return this.#queue.stats;
  }

  get closed(): boolean {
    return this.#closed;
  }

  setDemand(raw: LiveSurfaceDemandV1): void {
    if (this.#closed) throw new Error("cannot set demand on a detached live surface");
    const demand = LiveSurfaceDemandV1.parse(raw);
    this.sendControl({
      v: 1,
      type: "demand",
      attachmentId: this.attachmentId,
      demand,
    });
  }

  takeFrame(): LiveSurfaceFrameLease<TFrame> | null {
    return this.#queue.take();
  }

  onSummary(listener: (summary: LiveSurfaceRuntimeSummaryV1) => void): () => void {
    this.#summaryListeners.add(listener);
    try {
      listener(this.#summary);
    } catch {
      // A presentation observer cannot break attachment ownership or delivery.
    }
    return () => this.#summaryListeners.delete(listener);
  }

  dispose(): void {
    if (this.#closed) return;
    this.sendControl({ v: 1, type: "detach", attachmentId: this.attachmentId });
    this.closeFromHost();
  }

  acceptFrame(frame: TFrame, envelope: LiveSurfaceFrameEnvelopeV1): void {
    if (this.#closed || envelope.metadata.surfaceId !== this.#summary.surfaceId) {
      try {
        frame.close();
      } catch {
        // Invalid arrivals still leave queue ownership empty.
      }
      return;
    }
    this.#queue.offer({ value: frame, metadata: envelope.metadata });
  }

  acceptSummary(summary: LiveSurfaceRuntimeSummaryV1): boolean {
    if (this.#closed || summary.surfaceId !== this.#summary.surfaceId) return false;
    if (summary.stateRevision < this.#summary.stateRevision) return false;
    if (summary.producerEpoch < this.#summary.producerEpoch) return false;
    if (
      summary.stateRevision === this.#summary.stateRevision &&
      (summary.state !== this.#summary.state ||
        summary.producerEpoch !== this.#summary.producerEpoch)
    ) {
      return false;
    }
    if (
      summary.geometry !== undefined &&
      this.#summary.geometry !== undefined &&
      summary.geometry.revision < this.#summary.geometry.revision
    ) {
      return false;
    }
    if (summary.producerEpoch > this.#summary.producerEpoch) {
      this.#queue.resetEpoch(summary.producerEpoch);
    }
    this.#summary = summary;
    this.#queue.setAccepting(PRESENTATION_STATES.has(summary.state));
    const listeners = [...this.#summaryListeners];
    if (summary.state === "closed") this.closeFromHost();
    for (const listener of listeners) {
      try {
        listener(summary);
      } catch {
        // Observers are isolated so one faulty consumer cannot skip cleanup.
      }
    }
    return true;
  }

  closeFromHost(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue.close();
    this.#summaryListeners.clear();
    this.onLocalClose(this.attachmentId);
  }
}

/**
 * Owns the two main-world ports for one renderer generation. Frames never use
 * ordinary IPC or window messages after the one-time port handoff.
 */
export class LiveSurfaceRendererTransport<
  TFrame extends LiveSurfaceClosableFrame = LiveSurfaceClosableFrame,
> {
  readonly #attachments = new Map<string, LiveSurfaceRendererAttachment<TFrame>>();
  readonly #pending = new Map<string, PendingAttach<TFrame>>();
  readonly #ready: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: Error) => void;
  #readyGeneration: number | null = null;
  #requestSequence = 0;
  #closed = false;
  #protocolFaults = 0;

  constructor(
    readonly bootstrap: LiveSurfacePortBootstrapV1,
    readonly controlPort: LiveSurfaceMessagePort,
    readonly framePort: LiveSurfaceMessagePort,
  ) {
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    controlPort.onmessage = (event) => this.acceptControl(event.data);
    controlPort.onmessageerror = () => this.dispose(errorFromHost("control port message failed"));
    framePort.onmessage = (event) => this.acceptFrame(event.data);
    framePort.onmessageerror = () => {
      this.#protocolFaults += 1;
    };
    controlPort.start();
    framePort.start();
  }

  get ready(): Promise<void> {
    return this.#ready;
  }

  get rendererGeneration(): number {
    return this.bootstrap.rendererGeneration;
  }

  get protocolFaults(): number {
    return this.#protocolFaults;
  }

  get closed(): boolean {
    return this.#closed;
  }

  async attach(ticket: LiveSurfaceAttachTicketV1): Promise<LiveSurfaceRendererAttachment<TFrame>> {
    if (this.#closed) throw new Error("live surface renderer transport is closed");
    await this.#ready;
    if (this.#closed) throw new Error("live surface renderer transport is closed");
    this.#requestSequence += 1;
    const requestId = `request_${this.rendererGeneration}_${this.#requestSequence}`;
    const response = new Promise<LiveSurfaceRendererAttachment<TFrame>>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
    });
    try {
      this.postControl({ v: 1, type: "attach", requestId, ticket });
    } catch (error) {
      this.#pending.delete(requestId);
      throw error;
    }
    return response;
  }

  dispose(reason = errorFromHost("live surface renderer transport closed")): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#readyGeneration === null) this.#rejectReady(reason);
    for (const pending of this.#pending.values()) pending.reject(reason);
    this.#pending.clear();
    for (const attachment of [...this.#attachments.values()]) attachment.closeFromHost();
    this.#attachments.clear();
    this.controlPort.onmessage = null;
    this.framePort.onmessage = null;
    try {
      this.controlPort.close();
    } catch {
      // The remote renderer generation already closed.
    }
    try {
      this.framePort.close();
    } catch {
      // The remote renderer generation already closed.
    }
  }

  private acceptControl(raw: unknown): void {
    if (this.#closed) return;
    const parsed = LiveSurfaceHostControlMessageV1.safeParse(raw);
    if (!parsed.success) {
      this.#protocolFaults += 1;
      this.dispose(errorFromHost("host sent a malformed live surface control message"));
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "ready": {
        if (
          this.#readyGeneration !== null ||
          message.bootstrap.rendererGeneration !== this.rendererGeneration
        ) {
          this.#protocolFaults += 1;
          this.dispose(errorFromHost("live surface renderer generation handshake mismatch"));
          return;
        }
        this.#readyGeneration = message.bootstrap.rendererGeneration;
        this.#resolveReady();
        return;
      }
      case "attached": {
        const pending = this.#pending.get(message.requestId);
        if (pending === undefined) {
          this.#protocolFaults += 1;
          return;
        }
        this.#pending.delete(message.requestId);
        if (this.#attachments.has(message.attachment.attachmentId)) {
          pending.reject(errorFromHost("host reused a live surface attachment identity"));
          this.#protocolFaults += 1;
          return;
        }
        const attachment = new LiveSurfaceRendererAttachment<TFrame>(
          message.attachment.attachmentId,
          message.attachment.summary,
          (outbound) => this.postControl(outbound),
          (attachmentId) => this.#attachments.delete(attachmentId),
        );
        this.#attachments.set(attachment.attachmentId, attachment);
        pending.resolve(attachment);
        return;
      }
      case "rejected": {
        const pending = this.#pending.get(message.requestId);
        if (pending === undefined) {
          this.#protocolFaults += 1;
          return;
        }
        this.#pending.delete(message.requestId);
        pending.reject(errorFromHost(`${message.error.code}: ${message.error.message}`));
        return;
      }
      case "summary": {
        const attachment = this.#attachments.get(message.attachmentId);
        if (attachment === undefined || !attachment.acceptSummary(message.summary)) {
          this.#protocolFaults += 1;
        }
        return;
      }
      case "detached": {
        const attachment = this.#attachments.get(message.attachmentId);
        if (attachment === undefined) return;
        attachment.closeFromHost();
      }
    }
  }

  private acceptFrame(raw: unknown): void {
    const message = rendererFrameMessage(raw);
    const candidateFrame = message?.frame;
    if (!isLiveSurfaceClosableFrame(candidateFrame)) {
      this.#protocolFaults += 1;
      return;
    }
    const frame = candidateFrame as TFrame;
    if (this.#closed || message === null) {
      frame.close();
      this.#protocolFaults += 1;
      return;
    }
    const envelope = LiveSurfaceFrameEnvelopeV1.safeParse(message.envelope);
    if (!envelope.success) {
      frame.close();
      this.#protocolFaults += 1;
      return;
    }
    const attachment = this.#attachments.get(envelope.data.attachmentId);
    if (attachment === undefined) {
      frame.close();
      return;
    }
    try {
      attachment.acceptFrame(frame, envelope.data);
    } finally {
      if (envelope.data.metadata.transport === "cpu-bgra") {
        try {
          this.postControl({
            v: 1,
            type: "cpu-frame-ack",
            attachmentId: envelope.data.attachmentId,
            producerEpoch: envelope.data.metadata.producerEpoch,
            sequence: envelope.data.metadata.sequence,
          });
        } catch {
          // postControl already closed the disconnected generation.
        }
      }
    }
  }

  private postControl(message: unknown): void {
    if (this.#closed) throw new Error("live surface renderer transport is closed");
    try {
      this.controlPort.postMessage(message);
    } catch (error) {
      this.dispose(errorFromHost("live surface control port disconnected"));
      throw error;
    }
  }
}
