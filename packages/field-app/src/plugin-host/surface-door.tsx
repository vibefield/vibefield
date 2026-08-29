// DT-2b-2 — `ctx.pool.liveSurface`: the plugin's door to the window's live
// surface pool (DT-D4). One kind so far; others join with their consumers (A7).
//
// The door exists to make three things true at once, and each one is a fact
// about a boundary rather than a convenience:
//
//   1. TWO PLUGINS CANNOT COLLIDE ON A KEY. A plugin names `preview`; the pool
//      sees `acme.tools:preview`. The pool's whole contract is that one key is
//      one attachment shared by every holder — so an un-namespaced key would
//      let one plugin join another's capture, which is EL7's adversary reading
//      pixels it was never granted.
//   2. A PLUGIN NEVER TOUCHES A FRAME (PA-22). The handle it gets is the pool's
//      handle with `presentation` removed — not hidden behind a convention but
//      absent from the object. Frames are transferred `VideoFrame`s on leases
//      the presentation closes on a fixed schedule; a plugin holding one could
//      retain it past its lease and stall the producer. So rendering goes
//      through `SurfaceView`, which closes over the REAL handle in a WeakMap
//      the plugin has no name for.
//   3. A DEACTIVATED PLUGIN LEAKS NOTHING. Every acquire is tracked on the
//      activation's own scope (PRC-1), so the release is the ownership tree's
//      to perform, not the plugin's to remember.
//
// AUTHORITY IS NOT HERE. The mint is `surface.open` on the plugin's own product
// client, so fieldd decides whether this principal holds `surface.attach` (the
// registry scope on that method, checked by ProductAPI before the handler runs,
// plus SurfaceService's own kind→scope matrix). The door does not gate, it
// reports: a refusal arrives as a `lost` handle carrying the daemon's own words.
// Today that is EVERY plugin — `surface.attach` is not yet plugin-eligible in
// contracts — so this path is complete and currently always refuses. That is a
// state, not a bug, and it is the one the face was built to show.

import { SurfaceOpenResultV1 } from "@vibefield/contracts";
import { UnavailableState } from "@vibefield/design-kit/primitives";
import type {
  PluginAttachmentPool,
  PluginLiveSurfaceOptions,
  PluginProductClient,
  PluginSurfaceHandle,
  PluginSurfaceState,
  PluginSurfaceViewProps,
} from "@vibefield/plugin-sdk";
import type { ReactElement } from "react";
import { getHost } from "../host";
import {
  getSurfacePool,
  normalizeSurfaceDemandIntent,
  type ProductSurfaceFrame,
  type SurfaceHandle,
  type SurfacePool,
} from "../surfaces/pool";
import { LiveSurfaceView } from "../surfaces/view/LiveSurfaceView";

/**
 * The narrowed handle → the real one.
 *
 * A WeakMap rather than a field, because a field is a name and a name is a
 * reachable path: `handle.__real.presentation` would undo PA-22 for anyone who
 * read this file. Keyed weakly so a released handle a plugin drops takes its
 * entry with it.
 */
const REAL_HANDLES = new WeakMap<PluginSurfaceHandle, SurfaceHandle<ProductSurfaceFrame>>();

export interface PluginSurfacePoolDeps {
  readonly pluginId: string;
  /** The plugin-principal client — the SAME caller `ctx.client` rides, so a
   * mint carries this plugin's identity, grants and via-attribution rather than
   * the window's. */
  readonly client: PluginProductClient;
  /** The activation's ownership tree (PRC-1). Every acquire is tracked here. */
  readonly own: (label: string, release: () => void) => void;
  /** The context's activity gate — the same one `ctx.client` calls. */
  readonly assertOpen: () => void;
  /** Test/host seam. Production resolves the window's one pool from FieldHost. */
  readonly resolvePool?: () => SurfacePool<ProductSurfaceFrame> | null;
}

/** The window's pool, or null on any host that has no live-surface plane. A
 * missing host is that same answer, not a crash: the browser catalog and the
 * test harnesses both reach this line before `mountFieldApp` has wired one. */
function defaultResolvePool(): SurfacePool<ProductSurfaceFrame> | null {
  try {
    return getSurfacePool(getHost());
  } catch {
    return null;
  }
}

/**
 * A handle that is `lost` before it began, and says why.
 *
 * The alternative — throwing from `liveSurface()` — would put the honest answer
 * ("this window has no live surfaces") in a plugin's activation path, where the
 * only thing it can do with it is fail to activate. As a handle it is a FACE:
 * the plugin lays out its card, `SurfaceView` renders the unavailable state,
 * and the plugin keeps working. `retry()` is deliberately inert; there is
 * nothing on this host to retry against.
 */
function unavailableHandle(error: Error): PluginSurfaceHandle {
  const state: PluginSurfaceState = Object.freeze({ status: "lost" as const, error });
  return Object.freeze({
    status: "lost" as const,
    error,
    onState(listener: (state: PluginSurfaceState) => void): () => void {
      listener(state);
      return () => undefined;
    },
    setDemand(): void {
      // Nothing is attached, so there is no fold to move.
    },
    retry(): void {
      // No producer, no authority, nothing to mint against.
    },
    release(): void {
      // Nothing was claimed.
    },
  });
}

/** The pool's handle minus `presentation` — PA-22, by absence rather than by
 * convention. `key` is gone too: the plugin knows the name it asked for, and
 * the namespaced one is the host's business. */
function narrowHandle(real: SurfaceHandle<ProductSurfaceFrame>): PluginSurfaceHandle {
  return Object.freeze({
    get status() {
      return real.status;
    },
    get error() {
      return real.error;
    },
    onState(listener: (state: PluginSurfaceState) => void): () => void {
      return real.onState((state) => listener({ status: state.status, error: state.error }));
    },
    setDemand(demand: Parameters<PluginSurfaceHandle["setDemand"]>[0]): void {
      real.setDemand(demand);
    },
    retry(): void {
      real.retry();
    },
    release(): void {
      real.release();
    },
  });
}

/**
 * The plugin-facing view: the SHIPPING `LiveSurfaceView` over the real handle.
 *
 * Module-level and stable, because a component identity that changed per render
 * would remount the canvas — and a remounted canvas drops the last painted
 * frame, which is the one thing that survives a pause.
 */
function PluginSurfaceView(props: PluginSurfaceViewProps): ReactElement {
  const real = REAL_HANDLES.get(props.handle);
  if (real === undefined) {
    // Either an unavailable-host handle or an object the plugin built itself.
    // Both get the same honest face; neither gets a throw inside a plugin tree.
    return (
      <div
        data-live-surface-status={props.handle.status}
        {...(props.className === undefined ? {} : { className: props.className })}
      >
        <UnavailableState
          compact
          title="Live surface unavailable"
          description={props.handle.error?.message ?? "this window has no live surfaces"}
        />
      </div>
    );
  }
  return (
    <LiveSurfaceView
      handle={real}
      {...(props.interactive === undefined ? {} : { interactive: props.interactive })}
      {...(props.className === undefined ? {} : { className: props.className })}
    />
  );
}
PluginSurfaceView.displayName = "PluginSurfaceView";

export function createPluginSurfacePool(deps: PluginSurfacePoolDeps): PluginAttachmentPool {
  const resolvePool = deps.resolvePool ?? defaultResolvePool;
  return Object.freeze({
    liveSurface(opts: PluginLiveSurfaceOptions): PluginSurfaceHandle {
      deps.assertOpen();
      // Coherence first, and deliberately UNCAUGHT: "live at 0fps" is the
      // caller's bug, and the pool's door exists so the throw lands in the
      // frame of the acquire that was wrong (surfaces/pool/demand.ts). Only the
      // host's absence becomes a face.
      const initialDemand = normalizeSurfaceDemandIntent(opts.initialDemand);
      const key = `${deps.pluginId}:${opts.key}`;
      const pool = resolvePool();
      if (pool === null) {
        return unavailableHandle(new Error("live surfaces are unavailable on this host"));
      }

      let real: SurfaceHandle<ProductSurfaceFrame>;
      try {
        real = pool.acquire(key, {
          initialDemand,
          tickets: {
            async mint() {
              // ONE mint per attach attempt, and NO idempotencyKey. The pool's
              // single-flight already makes a client-side double mint
              // impossible (concurrent acquires share the one in-flight
              // attach); the service's replay map is for WIRE retries, where
              // the caller cannot tell a lost response from a lost request.
              // Sending a key here would fuse two DELIBERATE attempts — the
              // retry after a loss is the common one — into a replayed answer
              // carrying a ticket that was already spent.
              const raw = await deps.client.request("surface.open", {
                source: opts.source,
                ...(opts.reuseKey === undefined ? {} : { reuseKey: opts.reuseKey }),
              });
              return SurfaceOpenResultV1.parse(raw).ticket;
            },
          },
        });
      } catch (error) {
        // The window's pool was disposed under us (pagehide, renderer
        // generation change). Same face as no pool at all.
        return unavailableHandle(error instanceof Error ? error : new Error(String(error)));
      }

      const handle = narrowHandle(real);
      REAL_HANDLES.set(handle, real);
      // PRC-1: the release belongs to the activation's ownership tree, so a
      // plugin that forgets — or one that is deactivated mid-frame — still
      // drops its claim, and the pool's grace timer takes it from there.
      deps.own(`pool.liveSurface:${key}`, () => real.release());
      return handle;
    },
    SurfaceView: PluginSurfaceView,
  });
}
