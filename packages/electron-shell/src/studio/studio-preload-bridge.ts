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
}

export interface StudioRendererApi {
  readonly environment: "electron";
  publishAppearance(serialized: string): string;
  clearAppearance(): string;
  onMessage(handler: (message: HostToStudio) => void): () => void;
}

/** Latest-slot, animation-frame-coalesced publisher owned by the preload. */
export class StudioPreloadBridge {
  private port: RendererPort | null = null;
  private pending: StudioToHost | null = null;
  private framePending = false;
  private requestSequence = 0;
  private readonly listeners = new Set<(message: HostToStudio) => void>();

  constructor(private readonly scheduleFrame: (callback: () => void) => void) {}

  attach(port: RendererPort): void {
    this.port?.close();
    this.port = port;
    port.onmessage = (event) => {
      if (this.port !== port) return;
      let message: HostToStudio;
      try {
        message = parseHostToStudio(event.data);
      } catch {
        return;
      }
      for (const listener of [...this.listeners]) listener(message);
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

  subscribe(handler: (message: HostToStudio) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
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
  productConnected: false,
  live: false,
  revision: null,
  appliedRevision: null,
  rejection: null,
});
