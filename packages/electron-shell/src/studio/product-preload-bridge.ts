import {
  type AppearanceRejectCode,
  type HostToProduct,
  type ProductContext,
  parseHostToProduct,
  parseProductToHost,
  STUDIO_PROTOCOL_VERSION,
} from "./protocol";
import type { RendererPort } from "./studio-preload-bridge";

export type ProductAppearanceCommand = Exclude<HostToProduct, { type: "product.connect" }>;

export interface ProductAppearanceRendererApi {
  onCommand(handler: (command: ProductAppearanceCommand) => void): () => void;
  reportApplied(revision: number): void;
  reportRejected(revision: number, code: AppearanceRejectCode): void;
  reportContext(context: ProductContext): void;
  /** Present only in the opt-in physical acceptance composition. */
  physicalState?(): ProductPreloadPhysicalState;
}

export interface ProductPreloadPhysicalState {
  readonly received: number;
  readonly parseFailures: number;
  readonly handlerAttached: boolean;
  readonly dispatches: number;
  readonly completions: number;
  readonly pending: { type: HostToProduct["type"]; revision: number | null } | null;
  readonly lastCommand: { type: HostToProduct["type"]; revision: number | null } | null;
  readonly generation: number;
  readonly connected: boolean;
}

/** Receive-only product bridge with one pending command across boot ordering. */
export class ProductPreloadBridge {
  private port: RendererPort | null = null;
  private handler: ((command: ProductAppearanceCommand) => void) | null = null;
  private pending: ProductAppearanceCommand | null = null;
  private currentContext: ProductContext | null = null;
  private sentContext: ProductContext | null = null;
  private contextScheduled = false;
  private received = 0;
  private parseFailures = 0;
  private dispatches = 0;
  private completions = 0;
  private lastCommand: HostToProduct | null = null;
  private portGeneration = 0;
  private connected = false;

  constructor(
    private readonly instanceId: string,
    private readonly scheduleContext: (callback: () => void) => void = (callback) => {
      setTimeout(callback, 100);
    },
  ) {}

  attach(port: RendererPort, generation: number): void {
    if (!Number.isSafeInteger(generation) || generation <= this.portGeneration) {
      port.close();
      return;
    }
    this.portGeneration = generation;
    this.port?.close();
    this.port = port;
    this.connected = false;
    this.pending = null;
    this.sentContext = null;
    port.onmessage = (event) => {
      if (this.port !== port) return;
      let command: HostToProduct;
      try {
        command = parseHostToProduct(event.data);
      } catch {
        this.parseFailures += 1;
        return;
      }
      this.received += 1;
      this.lastCommand = command;
      if (command.type === "product.connect") {
        if (this.connected) return;
        this.connected = true;
        port.postMessage({
          type: "product.ready",
          protocol: STUDIO_PROTOCOL_VERSION,
          instanceId: this.instanceId,
          connectionId: command.connectionId,
        });
        this.scheduleContextFlush();
        return;
      }
      if (!this.connected) return;
      if (this.handler === null) this.pending = command;
      else this.dispatch(command, this.handler);
    };
    port.start();
  }

  subscribe(handler: (command: ProductAppearanceCommand) => void): () => void {
    this.handler = handler;
    if (this.pending !== null) {
      const pending = this.pending;
      this.pending = null;
      this.dispatch(pending, handler);
    }
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }

  applied(revision: number): void {
    if (!this.connected) return;
    this.port?.postMessage(
      parseProductToHost({ type: "appearance.applied", revision, instanceId: this.instanceId }),
    );
  }

  rejected(revision: number, code: AppearanceRejectCode): void {
    if (!this.connected) return;
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

  physicalState(): ProductPreloadPhysicalState {
    return Object.freeze({
      received: this.received,
      parseFailures: this.parseFailures,
      handlerAttached: this.handler !== null,
      dispatches: this.dispatches,
      completions: this.completions,
      pending: commandMetadata(this.pending),
      lastCommand: commandMetadata(this.lastCommand),
      generation: this.portGeneration,
      connected: this.connected,
    });
  }

  private dispatch(
    command: ProductAppearanceCommand,
    handler: (command: ProductAppearanceCommand) => void,
  ): void {
    this.dispatches += 1;
    handler(command);
    this.completions += 1;
  }

  private scheduleContextFlush(): void {
    if (
      this.contextScheduled ||
      this.port === null ||
      !this.connected ||
      this.currentContext === null
    ) {
      return;
    }
    if (sameContext(this.currentContext, this.sentContext)) return;
    this.contextScheduled = true;
    this.scheduleContext(() => {
      this.contextScheduled = false;
      const current = this.currentContext;
      if (
        this.port === null ||
        !this.connected ||
        current === null ||
        sameContext(current, this.sentContext)
      ) {
        return;
      }
      this.sentContext = current;
      this.port.postMessage({ type: "product.context", ...current });
    });
  }
}

function commandMetadata(
  command: HostToProduct | null,
): ProductPreloadPhysicalState["lastCommand"] {
  return command === null
    ? null
    : {
        type: command.type,
        revision: command.type === "product.connect" ? null : command.revision,
      };
}

function sameContext(a: ProductContext | null, b: ProductContext | null): boolean {
  return a?.theme === b?.theme && a?.zoom === b?.zoom;
}
