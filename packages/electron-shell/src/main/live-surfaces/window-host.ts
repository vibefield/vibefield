import { IPC_CHANNELS, type LiveSurfacePortBootstrapV1 } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { BrowserWindow, MessagePortMain } from "electron";
import {
  LiveSurfaceControlSession,
  type LiveSurfaceMainMessagePort,
  validateCpuFrameEnvelope,
} from "./control-session";
import type { LiveSurfaceRuntimeAuthority } from "./runtime";
import {
  type LiveSurfaceTextureFrameSink,
  LiveSurfaceTextureTransferBudget,
} from "./texture-forwarder";
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
  budget: LiveSurfaceTextureTransferBudget,
) => LiveSurfaceTextureFrameSink;

/** EY-1 (1f): what a window's desk says to main over its control session, not an attachment's. */
export interface LiveSurfaceWindowDesk {
  /** the desk's room for agent pages (`room`) */
  readonly onRoom?: (agentPages: number) => void;
  /** the desk declines a made page at its adopt (`made-declined`) */
  readonly onMadeDeclined?: (made: string) => void;
}

/** EY-1 (1f, 2026-11-19): the product windows that stand now, by their contents' ids: every window
 * with a live-surface host whose window is not destroyed (a run's page may land on its desk). */
export function liveSurfaceProductWindows(
  hosts: Iterable<Pick<LiveSurfaceWindowHost, "window">>,
): number[] {
  const ids: number[] = [];
  for (const host of hosts) if (!host.window.isDestroyed()) ids.push(host.window.webContents.id);
  return ids;
}

/** Owns generation ports and ticket targeting for one shell WebContents. */
export class LiveSurfaceWindowHost {
  readonly #webContents: BrowserWindow["webContents"];
  #generation = 0;
  #session: LiveSurfaceControlSession | null = null;
  #fallbackPort: MessagePortMain | null = null;
  readonly #textureBudgets: Map<string, LiveSurfaceTextureTransferBudget>;
  readonly #ownsTextureBudgets: boolean;
  readonly #pendingDrains = new Set<Promise<unknown>>();
  #disposed = false;

  constructor(
    readonly window: BrowserWindow,
    readonly tickets: LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>,
    readonly createChannel: LiveSurfaceMessageChannelFactory,
    readonly logger?: Logger,
    readonly createTextureSink?: LiveSurfaceTextureSinkFactory,
    textureBudgets?: Map<string, LiveSurfaceTextureTransferBudget>,
    /** EY-1 (1f): where this window's desk word goes, each renderer generation's alike */
    readonly desk?: LiveSurfaceWindowDesk,
  ) {
    this.#webContents = window.webContents;
    this.#textureBudgets = textureBudgets ?? new Map();
    this.#ownsTextureBudgets = textureBudgets === undefined;
  }

  get rendererGeneration(): number {
    return this.#generation;
  }

  /** EY-1 (C4, 2026-11-24): whether the document `rendererGeneration` names stands now: its load ended, and nothing
   * has replaced it, closed its ports or ended its process since. False before the window's first load ends (the
   * number is 0), and from a navigation's start until its load's end (the number is still the old document's).
   * Custody reads it to know which document a pane placed now lands in. */
  get rendererLive(): boolean {
    return (
      !this.#disposed && this.#generation > 0 && this.#session !== null && !this.#session.closed
    );
  }

  async whenDrained(): Promise<void> {
    await Promise.all([...this.#pendingDrains]);
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
    if (this.#ownsTextureBudgets) this.#textureBudgets.clear();
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
        : {
            createTextureSink: (surfaceId: string, attachmentId: string) =>
              this.createTextureSink!(surfaceId, attachmentId, this.textureBudget(surfaceId)),
          }),
      onProtocolFault: (reason) => {
        this.logger?.warn(
          "desktop.live_surfaces.control_protocol_rejected",
          "Electron closed a malformed Live Surfaces renderer generation",
          { webContentsId: this.#webContents.id, generation: this.#generation, reason },
        );
      },
      onRoom: (agentPages) => this.desk?.onRoom?.(agentPages),
      onMadeDeclined: (made) => this.desk?.onMadeDeclined?.(made),
      onClosed: () => {
        this.trackDrain(session.whenDrained());
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

  private textureBudget(surfaceId: string): LiveSurfaceTextureTransferBudget {
    const existing = this.#textureBudgets.get(surfaceId);
    if (existing !== undefined) return existing;
    const budget = new LiveSurfaceTextureTransferBudget(2);
    this.#textureBudgets.set(surfaceId, budget);
    return budget;
  }

  private trackDrain(raw: Promise<unknown>): void {
    const drain = raw.catch(() => undefined);
    this.#pendingDrains.add(drain);
    void drain.finally(() => this.#pendingDrains.delete(drain));
  }

  private closePort(port: MessagePortMain | null): void {
    try {
      port?.close();
    } catch {
      // Its remote renderer generation already ended.
    }
  }
}
