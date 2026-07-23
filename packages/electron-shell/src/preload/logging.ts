import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";

export interface RendererLogPort {
  postMessage(message: string): void;
  start(): void;
  close(): void;
}

/** Preload owns the transferred MessagePort and exposes only a bounded string
 * submit function through contextBridge. The page never receives ipcRenderer,
 * a raw port, a channel name, or a destination path. */
export class PreloadLogBridge {
  private readonly pending: Array<{ raw: string; bytes: number }> = [];
  private pendingBytes = 0;
  private port: RendererLogPort | null = null;
  private closed = false;

  submit(raw: unknown): boolean {
    if (this.closed || typeof raw !== "string") return false;
    if (raw.length > LOG_TRANSPORT_LIMITS.RENDERER_BATCH_BYTES) return false;
    const bytes = new TextEncoder().encode(raw).byteLength;
    if (bytes > LOG_TRANSPORT_LIMITS.RENDERER_BATCH_BYTES) return false;
    if (this.port !== null) {
      try {
        this.port.postMessage(raw);
        return true;
      } catch {
        this.detachPort();
      }
    }
    const maxPendingBatches = LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND * 2;
    if (
      this.pending.length >= maxPendingBatches ||
      this.pendingBytes + bytes > LOG_TRANSPORT_LIMITS.RENDERER_QUEUE_BYTES
    ) {
      return false;
    }
    this.pending.push({ raw, bytes });
    this.pendingBytes += bytes;
    return true;
  }

  attach(port: RendererLogPort): void {
    if (this.closed) {
      port.close();
      return;
    }
    this.detachPort();
    this.port = port;
    port.start();
    while (this.port === port && this.pending.length > 0) {
      const next = this.pending[0];
      if (next === undefined) break;
      try {
        port.postMessage(next.raw);
      } catch {
        this.detachPort();
        return;
      }
      this.pending.shift();
      this.pendingBytes -= next.bytes;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detachPort();
    this.pending.length = 0;
    this.pendingBytes = 0;
  }

  health(): { pendingBatches: number; pendingBytes: number; connected: boolean } {
    return {
      pendingBatches: this.pending.length,
      pendingBytes: this.pendingBytes,
      connected: this.port !== null,
    };
  }

  private detachPort(): void {
    const current = this.port;
    this.port = null;
    try {
      current?.close();
    } catch {
      // The remote WebContents generation is already gone.
    }
  }
}
