import type { Disposable, PluginSurfaceProps } from "@vibefield/plugin-sdk";
import type { ComponentType } from "react";

// The spine surface registry (P6, spec §8.4 / §13.2): the renderer-side binding
// table behind ctx.surfaces. Surfaces are FIXED contribution points, not
// arbitrary portals — the spine owns layout, clipping, focus, and the
// error/empty/loading faces; a plugin only binds a component to a declared id.
//
// A reactive module store (the plugin-registry-store pattern) so ChromeLayer
// re-renders when a surface binds/unbinds — a disabled or dev-reloaded plugin's
// surface must appear and disappear honestly, never linger (P5: no optimistic
// state). The manifest-DECLARED check is the harness's (it holds the manifest,
// like widgets.register); THIS module owns SLOT POLICY:
//  - hud.attention, hud.panel, and hud.side-panel are LIVE slots;
//  - godview.row and godview.lens are REFUSED honestly at bind time — the
//    declaration is forward-compatible (a manifest may carry it), but binding
//    is not yet (Godview lands later; §8.4 "no silent fake").

/** The live host-facing slots this slice renders. Godview slots are declarable
 * but not bindable (refused below). */
export type LiveSurfaceSlot = "hud.attention" | "hud.panel" | "hud.side-panel";
const LIVE_SLOTS = new Set<string>(["hud.attention", "hud.panel", "hud.side-panel"]);
const FORWARD_SLOTS = new Set<string>(["godview.row", "godview.lens"]);

export interface SurfaceEntry {
  surfaceId: string;
  pluginId: string;
  slot: LiveSurfaceSlot;
  title: string;
  icon?: string;
  component: ComponentType<PluginSurfaceProps>;
  order: number;
  /** registration sequence — the stable tiebreaker when orders collide */
  seq: number;
}

const entries = new Map<string, SurfaceEntry>();
const listeners = new Set<() => void>();
let seqCounter = 0;
let snapshot: readonly SurfaceEntry[] = [];

function rebuild(): void {
  // A fresh immutable array each mutation so useSyncExternalStore sees a new
  // reference exactly when the set changes (and the same one otherwise).
  snapshot = [...entries.values()].sort((a, b) => a.order - b.order || a.seq - b.seq);
  for (const fn of listeners) fn();
}

/** Bind a component to a declared surface (§13.2). The SLOT is manifest truth
 * the harness resolves and passes; here it is gated:
 *  - godview.* → refused honestly (forward-compatible declaration, not-yet-live
 *    binding);
 *  - a non-live/unknown slot → refused;
 *  - already-bound id → refused (no double-bind).
 * Throws on refusal (a registration-time error, like widget/command register);
 * the honest degraded rendering is ChromeLayer's face policy, not this table's. */
export function register(
  pluginId: string,
  surfaceId: string,
  slot: string,
  component: ComponentType<PluginSurfaceProps>,
  order = 0,
  title = surfaceId,
  icon?: string,
): Disposable {
  if (!surfaceId.startsWith(`${pluginId}.`))
    throw new Error(`surface ${surfaceId} is not owned by ${pluginId} (§6.2)`);
  if (FORWARD_SLOTS.has(slot))
    throw new Error(
      `surface ${surfaceId} targets ${slot}: godview lands later — declaration is forward-compatible, binding is not yet (§8.4)`,
    );
  if (!LIVE_SLOTS.has(slot))
    throw new Error(`surface ${surfaceId} targets unknown slot ${slot} (§8.4)`);
  if (slot === "hud.side-panel" && [...entries.values()].some((entry) => entry.slot === slot))
    throw new Error("hud.side-panel already has its one v1 contribution (§8.4/A7)");
  if (entries.has(surfaceId))
    throw new Error(`surface ${surfaceId} already bound in this entry (§13.2)`);
  const seq = seqCounter++;
  entries.set(surfaceId, {
    surfaceId,
    pluginId,
    slot: slot as LiveSurfaceSlot,
    title,
    ...(icon !== undefined ? { icon } : {}),
    component,
    order,
    seq,
  });
  rebuild();
  return {
    dispose() {
      // Identity-guarded: a re-bind under the same id must survive a late
      // dispose from the prior binding.
      if (entries.get(surfaceId)?.seq === seq) {
        entries.delete(surfaceId);
        rebuild();
      }
    },
  };
}

export function subscribeSurfaces(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSurfacesSnapshot(): readonly SurfaceEntry[] {
  return snapshot;
}
