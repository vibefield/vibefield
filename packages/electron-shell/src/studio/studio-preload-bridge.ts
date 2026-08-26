import {
  assertSerializedAppearance,
  type HostToStudio,
  parseHostToStudio,
  STUDIO_PROTOCOL_VERSION,
  type StudioStatus,
  type StudioToHost,
} from "./protocol";

export interface RendererPort {
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export interface StudioRendererApi {
  readonly environment: "electron";
  publishAppearance(serialized: string): string;
  clearAppearance(): string;
  focusProduct(): void;
  onMessage(handler: (message: HostToStudio) => void): () => void;
}

/** Latest-slot, animation-frame-coalesced publisher owned by the preload. */
export class StudioPreloadBridge {
  private port: RendererPort | null = null;
  private pending: StudioToHost | null = null;
  private framePending = false;
  private requestSequence = 0;
  private portGeneration = 0;
  private readonly listeners = new Set<(message: HostToStudio) => void>();

  constructor(private readonly scheduleFrame: (callback: () => void) => void) {}

  attach(port: RendererPort, generation: number): void {
    if (!Number.isSafeInteger(generation) || generation <= this.portGeneration) {
      port.close();
      return;
    }
    this.portGeneration = generation;
    const previous = this.port;
    this.port = null;
    previous?.close();
    this.port = port;
    let hostReasonReceived = false;
    port.onmessage = (event) => {
      if (this.port !== port) return;
      let message: HostToStudio;
      try {
        message = parseHostToStudio(event.data);
      } catch {
        return;
      }
      if (message.type === "studio.disconnected") hostReasonReceived = true;
      for (const listener of [...this.listeners]) listener(message);
    };
    port.onclose = () => {
      if (this.port !== port) return;
      this.port = null;
      if (!hostReasonReceived) {
        this.notify({ type: "studio.disconnected", reason: "transport-closed" });
      }
    };
    port.start();
    port.postMessage({ type: "studio.ready", protocol: STUDIO_PROTOCOL_VERSION });
    this.scheduleFlush();
  }

  publish(serialized: string): string {
    const requestId = this.nextRequestId();
    this.pending = {
      type: "appearance.publish",
      requestId,
      serialized: assertSerializedAppearance(serialized),
    };
    this.scheduleFlush();
    return requestId;
  }

  clear(): string {
    const requestId = this.nextRequestId();
    this.pending = { type: "appearance.clear", requestId };
    this.scheduleFlush();
    return requestId;
  }

  focusProduct(): string {
    const requestId = this.nextRequestId();
    this.port?.postMessage({ type: "product.focus", requestId } satisfies StudioToHost);
    return requestId;
  }

  subscribe(handler: (message: HostToStudio) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private notify(message: HostToStudio): void {
    for (const listener of [...this.listeners]) listener(message);
  }

  private scheduleFlush(): void {
    if (this.framePending || this.pending === null || this.port === null) return;
    this.framePending = true;
    this.scheduleFrame(() => {
      this.framePending = false;
      const port = this.port;
      const pending = this.pending;
      if (port === null || pending === null) return;
      this.pending = null;
      port.postMessage(pending);
      if (this.pending !== null) this.scheduleFlush();
    });
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `studio-${this.requestSequence}`;
  }
}

export const INITIAL_STUDIO_STATUS: StudioStatus = Object.freeze({
  productConnection: "unavailable",
  live: false,
  revision: null,
  appliedRevision: null,
  rejection: null,
});
