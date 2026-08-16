import { IPC_CHANNELS, type LiveSurfacePortBootstrapV1 } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { BrowserWindow, MessagePortMain } from "electron";
import {
  LiveSurfaceControlSession,
  type LiveSurfaceMainMessagePort,
  validateCpuFrameEnvelope,
} from "./control-session";
import type { LiveSurfaceRuntimeAuthority } from "./runtime";
import type { LiveSurfaceTextureFrameSink } from "./texture-forwarder";
import type {
  LiveSurfacePresentationOperation,
  LiveSurfaceTicketBinding,
  LiveSurfaceTicketTable,
} from "./ticket-table";

export interface LiveSurfaceWindowTicketRequest {
  readonly surfaceId: string;
  readonly sourceKind: LiveSurfaceTicketBinding<unknown>["sourceKind"];
  readonly operations: readonly LiveSurfacePresentationOperation[];
  readonly principalId?: string;
  readonly authority: LiveSurfaceRuntimeAuthority;
  readonly ttlMs?: number;
}

export interface LiveSurfaceMainMessageChannel {
  readonly port1: MessagePortMain;
  readonly port2: MessagePortMain;
}

export type LiveSurfaceMessageChannelFactory = () => LiveSurfaceMainMessageChannel;
export type LiveSurfaceTextureSinkFactory = (
  surfaceId: string,
  attachmentId: string,
) => LiveSurfaceTextureFrameSink;

/** Owns generation ports and ticket targeting for one shell WebContents. */
export class LiveSurfaceWindowHost {
  readonly #webContents: BrowserWindow["webContents"];
  #generation = 0;
  #session: LiveSurfaceControlSession | null = null;
  #fallbackPort: MessagePortMain | null = null;
  #disposed = false;

  constructor(
    readonly window: BrowserWindow,
    readonly tickets: LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>,
    readonly createChannel: LiveSurfaceMessageChannelFactory,
    readonly logger?: Logger,
    readonly createTextureSink?: LiveSurfaceTextureSinkFactory,
  ) {
    this.#webContents = window.webContents;
  }

  get rendererGeneration(): number {
    return this.#generation;
  }

  install(): this {
    const onNavigation = (
      _event: Electron.Event,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (isMainFrame && !isInPlace) this.closeGeneration();
    };
    const onProcessGone = (): void => this.closeGeneration();
    const onDestroyed = (): void => this.dispose();
    this.#webContents.on("did-finish-load", this.openGeneration);
    this.#webContents.on("did-start-navigation", onNavigation);
    this.#webContents.on("render-process-gone", onProcessGone);
    this.#webContents.once("destroyed", onDestroyed);
    if (!this.#webContents.isLoadingMainFrame()) this.openGeneration();
    this.#removeListeners = () => {
      this.#webContents.off("did-finish-load", this.openGeneration);
      this.#webContents.off("did-start-navigation", onNavigation);
      this.#webContents.off("render-process-gone", onProcessGone);
      this.#webContents.off("destroyed", onDestroyed);
    };
    return this;
  }

  issue(request: LiveSurfaceWindowTicketRequest) {
    if (
      this.#disposed ||
      this.#generation === 0 ||
      this.#session === null ||
      this.#session.closed
    ) {
      throw new Error("cannot issue a Live Surface ticket without a live renderer generation");
    }
    return this.tickets.issue(
      {
        targetWebContentsId: this.#webContents.id,
        rendererGeneration: this.#generation,
        surfaceId: request.surfaceId,
        sourceKind: request.sourceKind,
        operations: request.operations,
        ...(request.principalId === undefined ? {} : { principalId: request.principalId }),
        authority: request.authority,
      },
      request.ttlMs,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#removeListeners();
    this.closeGeneration();
  }

  #removeListeners = (): void => {};

  private readonly openGeneration = (): void => {
    if (this.#disposed || this.#webContents.isDestroyed()) return;
    this.closeGeneration();
    this.#generation += 1;
    const bootstrap: LiveSurfacePortBootstrapV1 = {
      v: 1,
      rendererGeneration: this.#generation,
    };
    const control = this.createChannel();
    const frames = this.createChannel();
    const fallback = this.createChannel();
    this.#fallbackPort = fallback.port1;
    let session: LiveSurfaceControlSession;
    session = new LiveSurfaceControlSession({
      senderWebContentsId: this.#webContents.id,
      bootstrap,
      port: control.port1 as unknown as LiveSurfaceMainMessagePort,
      tickets: this.tickets,
      publishCpuFrame: (attachmentId, frame) => {
        const payload = validateCpuFrameEnvelope(attachmentId, frame);
        const port = this.#fallbackPort;
        if (payload === null || port === null) return false;
        try {
          port.postMessage(payload);
          return true;
        } catch {
          return false;
        }
      },
      ...(this.createTextureSink === undefined
        ? {}
        : { createTextureSink: this.createTextureSink }),
      onProtocolFault: (reason) => {
        this.logger?.warn(
          "desktop.live_surfaces.control_protocol_rejected",
          "Electron closed a malformed Live Surfaces renderer generation",
          { webContentsId: this.#webContents.id, generation: this.#generation, reason },
        );
      },
      onClosed: () => {
        if (this.#session !== session) return;
        this.#session = null;
        this.closePort(this.#fallbackPort);
        this.#fallbackPort = null;
      },
    });
    this.#session = session;
    session.start();
    try {
      this.#webContents.postMessage(IPC_CHANNELS.liveSurfacePorts, bootstrap, [
        control.port2,
        frames.port1,
        frames.port2,
        fallback.port2,
      ]);
      this.logger?.info(
        "desktop.live_surfaces.generation_opened",
        "Electron opened the Live Surfaces renderer ports",
        { webContentsId: this.#webContents.id, generation: this.#generation },
      );
    } catch (error) {
      session.dispose();
      this.#session = null;
      this.closePort(this.#fallbackPort);
      this.#fallbackPort = null;
      this.closePort(control.port2);
      this.closePort(frames.port1);
      this.closePort(frames.port2);
      this.closePort(fallback.port2);
      this.logger?.error(
        "desktop.live_surfaces.generation_failed",
        "Electron could not transfer the Live Surfaces renderer ports",
        error,
        { webContentsId: this.#webContents.id, generation: this.#generation },
      );
    }
  };

  private closeGeneration(): void {
    const session = this.#session;
    this.#session = null;
    session?.dispose();
    this.closePort(this.#fallbackPort);
    this.#fallbackPort = null;
  }

  private closePort(port: MessagePortMain | null): void {
    try {
      port?.close();
    } catch {
      // Its remote renderer generation already ended.
    }
  }
}
