import {
  LIVE_SURFACE_PORT_BRIDGE_MESSAGE_V1,
  LiveSurfacePortBootstrapV1,
} from "@vibefield/contracts";
import type { LiveSurfaceClosableFrame, LiveSurfaceMessagePort } from "./ports";
import { LiveSurfaceRendererTransport } from "./transport";

export interface LiveSurfaceWindowMessageEvent {
  readonly source: unknown;
  readonly data: unknown;
  readonly ports: readonly unknown[];
  stopImmediatePropagation?(): void;
}

export interface LiveSurfaceWindowMessageTarget {
  addEventListener(type: "message", listener: (event: LiveSurfaceWindowMessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: LiveSurfaceWindowMessageEvent) => void,
  ): void;
}

export interface LiveSurfaceRendererPortReceiver<
  TFrame extends LiveSurfaceClosableFrame = LiveSurfaceClosableFrame,
> {
  readonly transport: Promise<LiveSurfaceRendererTransport<TFrame>>;
  dispose(): void;
}

/** Consumes exactly one isolated-world port handoff before plugin activation. */
export function receiveLiveSurfaceRendererTransport<
  TFrame extends LiveSurfaceClosableFrame = LiveSurfaceClosableFrame,
>(
  target: LiveSurfaceWindowMessageTarget,
  expectedBridgeNonce: string,
  onRejected?: (reason: string) => void,
): LiveSurfaceRendererPortReceiver<TFrame> {
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(expectedBridgeNonce)) {
    throw new Error("invalid Live Surfaces bridge nonce");
  }
  let settled = false;
  let resolveTransport!: (transport: LiveSurfaceRendererTransport<TFrame>) => void;
  const transport = new Promise<LiveSurfaceRendererTransport<TFrame>>((resolve) => {
    resolveTransport = resolve;
  });
  const listener = (event: LiveSurfaceWindowMessageEvent): void => {
    if (
      settled ||
      event.source !== target ||
      event.data === null ||
      typeof event.data !== "object"
    ) {
      return;
    }
    const message = event.data as { type?: unknown; bootstrap?: unknown; bridgeNonce?: unknown };
    if (message.type !== LIVE_SURFACE_PORT_BRIDGE_MESSAGE_V1) return;
    // This listener is installed before product/plugin activation. Once the
    // dedicated handoff is identified, do not let later same-world listeners
    // observe its capability ports — including when the payload is malformed.
    event.stopImmediatePropagation?.();
    const bootstrap = LiveSurfacePortBootstrapV1.safeParse(message.bootstrap);
    const controlPort = event.ports[0] as LiveSurfaceMessagePort | undefined;
    const framePort = event.ports[1] as LiveSurfaceMessagePort | undefined;
    if (
      message.bridgeNonce !== expectedBridgeNonce ||
      !bootstrap.success ||
      event.ports.length !== 2 ||
      controlPort === undefined ||
      framePort === undefined
    ) {
      onRejected?.("invalid main-world live surface port handoff");
      return;
    }
    settled = true;
    target.removeEventListener("message", listener);
    resolveTransport(
      new LiveSurfaceRendererTransport<TFrame>(bootstrap.data, controlPort, framePort),
    );
  };
  target.addEventListener("message", listener);
  return {
    transport,
    dispose: () => {
      if (settled) return;
      settled = true;
      target.removeEventListener("message", listener);
    },
  };
}
