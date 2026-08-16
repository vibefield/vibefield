import type {
  BrowserControlTargetBinding,
  BrowserControlTargetRegistry,
  BrowserControlTargetWebContents,
} from "./browser-control-target";

/** Main-private association consumed by a provider adapter, never a wire contract. */
export interface BrowserControlBinding<TPrivateTarget> {
  readonly surfaceId: string;
  readonly producerEpoch: number;
  readonly revision: number;
  readonly target: TPrivateTarget;
}

/** Provider-neutral lifecycle seam; agent-browser is one possible implementation. */
export interface BrowserControlProvider<TPrivateTarget, TSession = unknown> {
  attach(binding: BrowserControlBinding<TPrivateTarget>, signal: AbortSignal): Promise<TSession>;
  dispose(): Promise<void>;
}

export interface ElectronBrowserControlPrivateTarget {
  readonly webContentsId: number;
  readonly targetId: string;
  readonly contents: BrowserControlTargetWebContents;
}

function providerBinding(
  binding: BrowserControlTargetBinding,
): BrowserControlBinding<ElectronBrowserControlPrivateTarget> {
  return {
    surfaceId: binding.surfaceId,
    producerEpoch: binding.producerEpoch,
    revision: binding.controlBindingRevision,
    target: {
      webContentsId: binding.webContentsId,
      targetId: binding.targetId,
      contents: binding.contents,
    },
  };
}

/**
 * Revalidates the exact Electron target at handoff time. URL/title/tab-order
 * discovery is deliberately absent, and possession of a target ID is never
 * enough to construct a binding.
 */
export function resolveBrowserControlProviderBinding(
  registry: BrowserControlTargetRegistry,
  surfaceId: string,
): BrowserControlBinding<ElectronBrowserControlPrivateTarget> | null {
  const binding = registry.lookupPrivate(surfaceId);
  return binding === null ? null : providerBinding(binding);
}
