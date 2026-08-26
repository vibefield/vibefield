import {
  type AppearanceRejectCode,
  type HostToProduct,
  type ProductContext,
  parseHostToProduct,
  parseProductToHost,
  STUDIO_PROTOCOL_VERSION,
} from "./protocol";
import type { RendererPort } from "./studio-preload-bridge";

export interface ProductAppearanceRendererApi {
  onCommand(handler: (command: HostToProduct) => void): () => void;
  reportApplied(revision: number): void;
  reportRejected(revision: number, code: AppearanceRejectCode): void;
  reportContext(context: ProductContext): void;
}

/** Receive-only product bridge with one pending command across boot ordering. */
export class ProductPreloadBridge {
  private port: RendererPort | null = null;
  private handler: ((command: HostToProduct) => void) | null = null;
  private pending: HostToProduct | null = null;
  private currentContext: ProductContext | null = null;
  private sentContext: ProductContext | null = null;
  private contextScheduled = false;

  constructor(
    private readonly instanceId: string,
    private readonly scheduleContext: (callback: () => void) => void = (callback) => {
      setTimeout(callback, 100);
    },
  ) {}

  attach(port: RendererPort): void {
    this.port?.close();
    this.port = port;
    this.sentContext = null;
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
    this.scheduleContextFlush();
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
    this.port?.postMessage(
      parseProductToHost({ type: "appearance.applied", revision, instanceId: this.instanceId }),
    );
  }

  rejected(revision: number, code: AppearanceRejectCode): void {
    this.port?.postMessage(
      parseProductToHost({
        type: "appearance.rejected",
        revision,
        code,
        instanceId: this.instanceId,
      }),
    );
  }

  context(context: ProductContext): void {
    const parsed = parseProductToHost({ type: "product.context", ...context });
    if (parsed.type !== "product.context") return;
    this.currentContext = { theme: parsed.theme, zoom: parsed.zoom };
    this.scheduleContextFlush();
  }

  private scheduleContextFlush(): void {
    if (this.contextScheduled || this.port === null || this.currentContext === null) return;
    if (sameContext(this.currentContext, this.sentContext)) return;
    this.contextScheduled = true;
    this.scheduleContext(() => {
      this.contextScheduled = false;
      const current = this.currentContext;
      if (this.port === null || current === null || sameContext(current, this.sentContext)) return;
      this.sentContext = current;
      this.port.postMessage({ type: "product.context", ...current });
    });
  }
}

function sameContext(a: ProductContext | null, b: ProductContext | null): boolean {
  return a?.theme === b?.theme && a?.zoom === b?.zoom;
}
