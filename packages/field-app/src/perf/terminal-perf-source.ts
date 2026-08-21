// WHERE THE SAMPLER FINDS THE RUNTIME — a one-slot module registry.
//
// The terminal runtime is created by whoever owns it, and that owner is moving:
// today the Godview deck constructs it (`GodviewDeck.tsx`), at TP-S0b a
// window-level module-owned pool does. A sampler that reached the runtime by
// React tree position — a context, a ref threaded through the deck — would have
// to move with it, and would be a second thing to get right in someone else's
// slice. So the sampler reaches it through this registry instead: the owner
// publishes, the sampler reads, and the move is one line changing hands.
//
// The registry is deliberately NOT typed as `GhostteaTerminalRuntime`. What the
// sampler needs is three members, and naming the structural shape rather than
// the class keeps `perf/` free of the ghosttea import (the DeviceService /
// TerminalLink pattern this repo already uses: no import coupling, trivially
// fakeable in a test). It also means the pool can publish a facade rather than
// the raw runtime if it wants to.

import type { TerminalRenderPerformanceSnapshot } from "./terminal-perf-types";

/** The three members the sampler uses. `GhostteaTerminalRuntime` satisfies it
 * structurally (`ghosttea-react/dist/runtime.d.ts:52-61`). */
export interface TerminalPerfSource {
  readonly rendererBackend: string;
  startPerformanceMeasurement(): Promise<void>;
  finishPerformanceMeasurement(options?: {
    quietMs?: number;
    timeoutMs?: number;
  }): Promise<TerminalRenderPerformanceSnapshot>;
}

let current: TerminalPerfSource | null = null;
const listeners = new Set<(source: TerminalPerfSource | null) => void>();

/**
 * Publish the runtime as the sampler's source.
 *
 * Returns its own undo, so the owner's effect cleanup is `return register(...)`
 * and a stale runtime can never outlive its registration. Registering a second
 * source REPLACES the first rather than erroring: a deck that rebuilt its
 * runtime after a device loss is the normal case, not a fault.
 */
export function registerTerminalPerfSource(source: TerminalPerfSource): () => void {
  current = source;
  for (const listener of listeners) listener(source);
  return () => {
    // Only if it is still ours: a later registration already replaced us, and
    // clearing then would unpublish the live runtime.
    if (current !== source) return;
    current = null;
    for (const listener of listeners) listener(null);
  };
}

/** The runtime the sampler should measure, or null when none is mounted. */
export function getTerminalPerfSource(): TerminalPerfSource | null {
  return current;
}

/** Subscribe to source changes; fires immediately with the current value. */
export function observeTerminalPerfSource(
  listener: (source: TerminalPerfSource | null) => void,
): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
