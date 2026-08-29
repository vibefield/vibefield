// The host seam's product side: one surface pool per FieldHost, built lazily.
//
// The transport is a WINDOW capability — the Electron renderer host claims the
// port bridge once per renderer generation and hands the promise through
// `host.liveSurfaces`. Memoizing the pool against the host object rather than a
// module-level singleton keeps that one-per-window shape honest: the browser
// catalog, a test harness and the product each carry their own host, so each
// gets its own pool and none of them can see another's attachments.
//
// A host with no `liveSurfaces` is the ordinary case, not a degraded one: the
// browser-only catalog has no privileged main process to claim ports from.
// `getSurfacePool` answers null there, and callers render the surface's absence
// honestly (UNAVAILABLE, never a blank).

import type { FieldHost } from "../../host";
import { createSurfacePool, type SurfacePool } from "./surface-pool";

/**
 * The product's frame type.
 *
 * `LiveSurfaceRendererTransport` is invariant in its frame parameter (its
 * private frame queue puts `TFrame` in both positions), so the seam names the
 * real one rather than the `LiveSurfaceClosableFrame` bound: the host bridge
 * transfers `VideoFrame`s, and a transport typed at the bound would not accept
 * the one the host actually claims.
 */
export type ProductSurfaceFrame = VideoFrame;

const POOLS = new WeakMap<FieldHost, SurfacePool<ProductSurfaceFrame>>();

/**
 * The window's surface pool, or null on a host that has no live surfaces.
 *
 * Built on first use so a window that never opens a surface never constructs
 * one, and cached against the host so every caller shares the ONE pool — two
 * pools over one transport would each mint for the same key.
 */
export function getSurfacePool(host: FieldHost): SurfacePool<ProductSurfaceFrame> | null {
  const liveSurfaces = host.liveSurfaces;
  if (liveSurfaces === undefined) return null;
  const existing = POOLS.get(host);
  if (existing !== undefined && !existing.disposed) return existing;
  const pool = createSurfacePool<ProductSurfaceFrame>({ transport: liveSurfaces.transport });
  POOLS.set(host, pool);
  return pool;
}

/** Drop the memoized pool for a host, disposing it. Used by teardown and tests. */
export function disposeSurfacePool(host: FieldHost): void {
  const pool = POOLS.get(host);
  if (pool === undefined) return;
  POOLS.delete(host);
  pool.dispose();
}
