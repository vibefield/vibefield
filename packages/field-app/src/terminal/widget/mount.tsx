import type { Entity, World } from "@vibecook/ice";
import { UnavailableState } from "@vibefield/design-kit/primitives";
import { lazy, type ReactElement, Suspense } from "react";
import "./mirror-widget.css";

// THE LAZY BOUNDARY, and it is load-bearing rather than an optimization.
//
// FINDING (TP-S2b-widget, 2026-08-22). The first cut imported
// `TerminalMirrorWidget` from the registration door, and the door is reached
// from `field-engine.ts` — which `test/setup.ts` imports for the dev-bundled
// plugin fallback. So building the widget REGISTRY pulled the terminal pool and
// `@vibecook/ghosttea-react` into the module registry before any test file ran,
// and every `vi.mock("@vibecook/ghosttea-react", …)` in the suite silently
// stopped applying: the module was already instantiated, so the factory never
// ran, the real runtime was constructed, and it died on `Worker is not defined`.
// It took `terminal-mirror.test.tsx` from 18 green to 7 red WITHOUT touching a
// line of it — a test-visible symptom of a real layering mistake, which is that
// a widget CATALOG has no business dragging a terminal runtime in behind it.
//
// The registry needs a component reference synchronously; it does not need the
// component's MODULE. `lazy` is exactly that distinction, and the boundary buys
// three things at once: the registry stays terminal-free, a board with no
// mirror card never loads the pool, and every suite's mocks keep working.
//
// The Suspense fallback is an honest face, not a spinner: a mirror that is
// still arriving says so, in the same vocabulary the pool's `UNAVAILABLE`
// states use.

const LazyTerminalMirrorWidget = lazy(async () => {
  const module = await import("./TerminalMirrorWidget");
  return { default: module.TerminalMirrorWidget };
});

/** What the ENGINE mounts for a `vibefield.terminal.mirror` card. */
export function TerminalMirrorWidgetMount(props: { entity: Entity; world: World }): ReactElement {
  return (
    <Suspense
      fallback={
        <div className="vf-terminal-mirror-widget" data-face="loading">
          <div className="vf-terminal-mirror-widget-face">
            <UnavailableState compact title="terminal mirror" description="opening" />
          </div>
        </div>
      }
    >
      <LazyTerminalMirrorWidget {...props} />
    </Suspense>
  );
}

/**
 * The TRAY TILE, and the reason it is declared rather than left absent.
 *
 * ICE's preview contract mounts the REAL component in a sandbox when a dom
 * widget declares no preview component (`define-widget.d.ts`: "absent → the
 * REAL component mounts with default props"). For this widget that would mean
 * opening the tray fires a roster read and renders a live session picker inside
 * a 132-pixel silhouette — a terminal door opened by a hover. A declared
 * preview is the way to say "show a picture of the thing", and a picture is all
 * a tile ever wanted.
 */
export function TerminalMirrorTile(): ReactElement {
  return (
    <div className="vf-terminal-mirror-tile" aria-hidden="true">
      <span className="vf-terminal-mirror-tile-bar" />
      <span className="vf-terminal-mirror-tile-line" data-width="long" />
      <span className="vf-terminal-mirror-tile-line" data-width="short" />
      <span className="vf-terminal-mirror-tile-line" data-width="medium" />
    </div>
  );
}
