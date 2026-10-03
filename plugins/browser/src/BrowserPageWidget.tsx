import type { PluginLiveSurfaceOptions } from "@vibefield/plugin-sdk";
import type { Entity } from "@vibefield/plugin-sdk/canvas";

// DT-3d — the browser card's surface ADDRESSING, pure. The card's CONTROLLER
// (`createBrowserPageWidget`: the durable props read per conflict group, the
// attachment's lifetime, the `CardShell` frame around `BrowserPageView`) was CUT
// at DK-2 (desk/landing, ICE 0.14.0): the desk draws no DOM under the camera, the
// SDK cut the card exports, and `vibefield.browser.page` binds no face — the host
// compiles it FACELESS from the manifest, so a saved page keeps its address. The
// page returns as an object kind under PORTALS (DK-D20); these two rules are what
// a live-surface claim for a page keeps meaning until then.

/**
 * The card's name for its surface.
 *
 * ONE CARD, ONE ATTACHMENT: the pool shares an attachment across every holder
 * of a key, so two cards must never agree on one. The entity is what makes
 * this card this card, and the host namespaces the whole thing by plugin id
 * before it reaches the pool, so nothing outside this plugin can name it.
 *
 * THE CEILING, STATED. This key is only as durable as the entity id, which is
 * a RUNTIME number (`Entity` is a branded number; the ECS runtime is
 * key-ignorant and the SDK's canvas door exposes no durable entity key). So
 * `reuseKey` re-binds the same running page across everything inside one
 * renderer generation — a remount, a cull, the pool's grace window — which is
 * what it is for. It does NOT promise re-binding across a renderer reload,
 * because a plugin cannot currently name a card the same way twice across one.
 * Saying so here rather than implying otherwise: the surface a reload orphans
 * is swept by main's stale-incarnation sweep, and the card re-attaches to its
 * durable `url`, which is the honest half of the promise and the half DT-D7
 * actually makes.
 */
export function surfaceKeyFor(entity: Entity): string {
  return `page:${String(entity)}`;
}

/**
 * Everything the card asks the pool for, in one place a test can read.
 *
 * `key` and `reuseKey` are deliberately the SAME string: the key says which
 * attachment in this window, the reuse key says which running runtime to
 * re-bind to, and for a card those are one question — this card's page.
 */
export function browserSurfaceOptions(
  entity: Entity,
  initialUrl: string,
): PluginLiveSurfaceOptions {
  const key = surfaceKeyFor(entity);
  return {
    key,
    source: {
      kind: "browser",
      initialUrl,
      // A memory profile per card: cookies and storage are runtime policy,
      // never durable (DT-D7's never-persisted column), and `ref` scopes the
      // partition to this card so two browser cards are two sessions.
      profile: { mode: "memory", ref: key },
      logicalViewport: { width: 1024, height: 768 },
    },
    reuseKey: key,
    // A seed the view immediately corrects: `SurfaceView` measures its own
    // element and re-declares this holder's demand on mount (DT-D5).
    initialDemand: { mode: "live", targetFps: 30, priority: 50, interactive: false },
  };
}
