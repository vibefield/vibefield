import {
  type AppearanceRejectCode,
  type HostToProduct,
  parseHostToProduct,
  parseProductToHost,
  STUDIO_PROTOCOL_VERSION,
} from "./protocol";
import type { RendererPort } from "./studio-preload-bridge";

export interface ProductAppearanceRendererApi {
  onCommand(handler: (command: HostToProduct) => void): () => void;
  reportApplied(revision: number): void;
  reportRejected(revision: number, code: AppearanceRejectCode): void;
}

/** Receive-only product bridge with one pending command across boot ordering. */
export class ProductPreloadBridge {
  private port: RendererPort | null = null;
  private handler: ((command: HostToProduct) => void) | null = null;
  private pending: HostToProduct | null = null;

  constructor(private readonly instanceId: string) {}

  attach(port: RendererPort): void {
    this.port?.close();
    this.port = port;
    port.onmessage = (event) => {
      if (this.port !== port) return;
      let command: HostToProduct;
      try {
        command = parseHostToProduct(event.data);
      } catch {
        return;
      }
      if (this.handler === null) this.pending = command;
      else this.handler(command);
    };
    port.start();
    port.postMessage({
      type: "product.ready",
      protocol: STUDIO_PROTOCOL_VERSION,
      instanceId: this.instanceId,
    });
  }

  subscribe(handler: (command: HostToProduct) => void): () => void {
    this.handler = handler;
    if (this.pending !== null) {
      const pending = this.pending;
      this.pending = null;
      handler(pending);
    }
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }

  applied(revision: number): void {
    this.port?.postMessage(parseProductToHost({ type: "appearance.applied", revision }));
  }

  rejected(revision: number, code: AppearanceRejectCode): void {
    this.port?.postMessage(parseProductToHost({ type: "appearance.rejected", revision, code }));
  }
}
