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

export interface StagedSurfaceBinding {
  surfaceId: string;
  slot: string;
  component: ComponentType<PluginSurfaceProps>;
  order?: number;
  title?: string;
  icon?: string;
}

export interface SurfaceBindingCandidate extends Disposable {
  bind(row: StagedSurfaceBinding): void;
  commit(): void;
  withdraw(surfaceId: string): void;
}

const entries = new Map<string, SurfaceEntry>();
const reservations = new Map<string, { token: symbol; slot: string }>();
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
  const candidate = stageBindings(pluginId, [
    { surfaceId, slot, component, order, title, ...(icon === undefined ? {} : { icon }) },
  ]);
  candidate.commit();
  return candidate;
}

/** PRC-3d private surface batch. Slot/collision checks and reservations happen before commit;
 * observers receive one rebuilt snapshot containing the whole batch or none of it. */
export function stageBindings(
  pluginId: string,
  rows: readonly StagedSurfaceBinding[],
): SurfaceBindingCandidate {
  const token = Symbol(`surfaces:${pluginId}`);
  const prepared = new Map<string, SurfaceEntry>();
  let state: "staged" | "active" | "disposed" = "staged";

  const bind = (row: StagedSurfaceBinding): void => {
    if (state === "disposed")
      throw new Error(`surface candidate for ${pluginId} is no longer current (§13.2)`);
    const { surfaceId, slot } = row;
    if (!surfaceId.startsWith(`${pluginId}.`))
      throw new Error(`surface ${surfaceId} is not owned by ${pluginId} (§6.2)`);
    if (FORWARD_SLOTS.has(slot))
      throw new Error(
        `surface ${surfaceId} targets ${slot}: godview lands later — declaration is forward-compatible, binding is not yet (§8.4)`,
      );
    if (!LIVE_SLOTS.has(slot))
      throw new Error(`surface ${surfaceId} targets unknown slot ${slot} (§8.4)`);
    if (prepared.has(surfaceId))
      throw new Error(`surface ${surfaceId} is bound twice in this candidate (§13.2)`);
    if (entries.has(surfaceId) || reservations.has(surfaceId))
      throw new Error(`surface ${surfaceId} already bound in this entry (§13.2)`);
    if (
      slot === "hud.side-panel" &&
      ([...entries.values()].some((entry) => entry.slot === slot) ||
        [...reservations.values()].some((reservation) => reservation.slot === slot))
    ) {
      throw new Error("hud.side-panel already has its one v1 contribution (§8.4/A7)");
    }
    const entry: SurfaceEntry = {
      surfaceId,
      pluginId,
      slot: slot as LiveSurfaceSlot,
      title: row.title ?? surfaceId,
      ...(row.icon === undefined ? {} : { icon: row.icon }),
      component: row.component,
      order: row.order ?? 0,
      seq: seqCounter++,
    };
    prepared.set(surfaceId, entry);
    if (state === "staged") reservations.set(surfaceId, { token, slot });
    else {
      entries.set(surfaceId, entry);
      rebuild();
    }
  };
  try {
    for (const row of rows) bind(row);
  } catch (error) {
    for (const surfaceId of prepared.keys()) {
      if (reservations.get(surfaceId)?.token === token) reservations.delete(surfaceId);
    }
    throw error;
  }

  return Object.freeze({
    bind,
    commit(): void {
      if (state === "active") return;
      if (
        state === "disposed" ||
        [...prepared.keys()].some(
          (surfaceId) => reservations.get(surfaceId)?.token !== token || entries.has(surfaceId),
        )
      ) {
        throw new Error(`surface candidate for ${pluginId} is no longer current (§13.2)`);
      }
      state = "active";
      for (const [surfaceId, row] of prepared) {
        reservations.delete(surfaceId);
        entries.set(surfaceId, row);
      }
      if (prepared.size > 0) rebuild();
    },
    withdraw(surfaceId: string): void {
      const row = prepared.get(surfaceId);
      if (row === undefined) return;
      prepared.delete(surfaceId);
      if (reservations.get(surfaceId)?.token === token) reservations.delete(surfaceId);
      if (entries.get(surfaceId)?.seq === row.seq) {
        entries.delete(surfaceId);
        rebuild();
      }
    },
    dispose(): void {
      if (state === "disposed") return;
      const prior = state;
      state = "disposed";
      let changed = false;
      for (const [surfaceId, row] of prepared) {
        if (prior === "staged" && reservations.get(surfaceId)?.token === token)
          reservations.delete(surfaceId);
        if (prior === "active" && entries.get(surfaceId)?.seq === row.seq) {
          entries.delete(surfaceId);
          changed = true;
        }
      }
      if (changed) rebuild();
    },
  });
}

export function subscribeSurfaces(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSurfacesSnapshot(): readonly SurfaceEntry[] {
  return snapshot;
}
