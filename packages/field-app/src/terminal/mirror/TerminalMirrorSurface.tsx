import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { GhostteaProvider, TerminalSurface, type TerminalTheme } from "@vibecook/ghosttea-react";
import { UnavailableState } from "@vibefield/design-kit";
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useTerminalPool, useTerminalSessionViews } from "../pool";
import { type MirrorRefusals, watchOnlyRuntime } from "./watch-only-runtime";
import "./mirror.css";

// THE ICE TERMINAL WIDGET — a `SurfaceView` host that WATCHES (TPv3 §10, §9.5;
// design-00 §4.6's "DOM-surface widgets with the input contract and cull-driven
// `setVisible`"; gate TP-R4a).
//
// WHERE THIS LIVES, AND WHY IT IS NOT A PLUGIN. Every widget ON the canvas today
// is a manifest contribution: "the HOST builds every prefab from manifest data;
// plugins export components, never call defineWidget" (`plugin-host/
// build-widget.ts`), and R10 makes `@vibefield/plugin-sdk` the only door a
// plugin may reach the app through. This surface needs the window's terminal
// POOL — the routed runtime, the demand ledger, the transport table — none of
// which the SDK exports, and none of which it should: minting a terminal door in
// the SDK would put a third-party surface inside the terminal trust boundary
// (EL7 — same-uid agents are the adversary) and reopen a dependency TPv3's
// posture closes ("the terminal track serves Godview and the companion, not
// plugins"). So the mirror is a PRODUCT surface on the spine, in field-app
// beside the pool it consumes — the pool's second consumer, exactly as the deck
// is its first — and a canvas widget TYPE that mounts it is a manifest question
// for whoever opens that door, not a reason to open it here.
//
// WHAT A MIRROR IS. A second `TerminalSurface` on a session another view owns
// (upstream builds N views per session: the runtime refcounts one frame
// subscription per session handle and the worker fans invalidation to every
// surface — one decode, N presents). It is addressed by SESSION ID and nothing
// else (TP-L-C); which cell answers is the pool's business.
//
// WHAT MAKES IT WATCH-ONLY. Five layers, each independently sufficient for a
// different failure, because TP-R4a asks for "by construction" and one clever
// prop is not a construction:
//
//   1. the runtime it is given REFUSES every geometry and input verb
//      (`watch-only-runtime.ts` — and see there for why props cannot do this:
//      `controlsResize: false` does not stop the surface's own ResizeObserver
//      from resizing the PTY, and `readWrite` is not a prop at all);
//   2. `inert` on the container — the browser's own answer to "cannot be
//      focused": no tab stop, no programmatic `.focus()`, no click-to-focus,
//      for the whole subtree including the surface's `<textarea>`;
//   3. `pointer-events: none` on the surface — a mirror consumes no gesture, so
//      pointer events belong to the canvas underneath it (the C-2 contract by
//      OMISSION: no `data-canvas-interactive` anywhere in this widget means
//      drag, select and wheel-to-zoom all stay the canvas's, which is what a
//      card the user moves around should do);
//   4. `active={false}` — the surface's auto-focus effect (`TerminalSurface.js
//      :228-230`) never runs, and its focus-sync boolean is false regardless of
//      what the DOM does;
//   5. a `readWrite: false` projection of the session summary, which is where
//      the component reads interactivity from (`TerminalSurface.js:40`), so its
//      textarea is read-only and its key/mouse handlers early-return.
//
// Layer 1 is the one the gate is about; 2–5 are what keep a focus event from
// ever being generated in the first place.

/** How the mirror is currently placed. `culled` is the render-demand fact the
 * host observes; the rest is the honest-state ladder (tolerant reader). */
export type MirrorState = "resolving" | "unavailable" | "watching" | "culled";

export interface TerminalMirrorSurfaceProps {
  /** THE ADDRESS, and the only one (TP-L-C). */
  sessionId: string;
  /**
   * The host's own cull answer, when it has one.
   *
   * A canvas that culls its own content knows before any observer does, so a
   * host that knows should say. Left undefined, the widget observes itself (see
   * `useOnScreen` below) — which is what makes it correct in a catalog, a
   * panel, or a canvas whose cull signal has not been wired yet, rather than
   * only inside one host.
   */
  culled?: boolean;
  /** The camera's current scale, when the host has a camera. */
  cameraScale?: number;
  /** False while a camera gesture is in flight, true when it has settled. A
   * host without a camera leaves both undefined and the widget never defers. */
  cameraSettled?: boolean;
  /** Chrome. A mirror says whose screen it is showing. */
  label?: string;
  /** Diagnostics seam — what the widget is doing, published on change. */
  onStateChange?: (state: MirrorState) => void;
}

/**
 * Is this element on screen?
 *
 * `IntersectionObserver` rather than a camera-bounds test, because the widget
 * must be right in every host it can be mounted in and the browser already
 * accounts for what a camera does: an intersection is computed against the
 * VISUAL rect, so a CSS-transformed content plane culls correctly for free.
 * A host with its own cull signal overrides this entirely.
 */
function useOnScreen(element: HTMLElement | null, override: boolean | undefined): boolean {
  // Starts TRUE, and the observer corrects it.
  //
  // The two wrong answers are not symmetric. A mirror that is briefly `live`
  // while off screen costs one frame's work; a mirror that is wrongly `none`
  // shows a blank card and reads as broken — and it is the failure that
  // actually happens, because "the observer has not reported yet" and "the
  // observer never reports" are the same state to a widget. In a browser the
  // first callback lands in the same frame batch, so the optimistic window is
  // one frame; in an environment whose observer never fires at all (some test
  // DOMs) the mirror stays visible rather than silently dying. Honest over
  // clever, and the same reasoning as the pool's `UNAVAILABLE` states.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (override !== undefined || element === null) return;
    if (typeof IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) setVisible(entry.isIntersecting);
      },
      // A sliver counts: a widget half off the edge of the canvas is being
      // read, and demand that flickers at the boundary is worse than demand
      // that turns on slightly early.
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, override]);
  return override === undefined ? visible : !override;
}

/**
 * Resolve a session id to the summary the surface needs.
 *
 * Through the pool's runtime, which is the only client of the terminal system
 * this renderer has. `listSessions` is a control read, not a view verb, so it
 * goes through the watch-only facade like everything else — a mirror that
 * reached around its own facade for one call would be a mirror whose guarantee
 * had an exception in it.
 */
function useMirrorSession(
  runtime: ReturnType<typeof watchOnlyRuntime> | null,
  sessionId: string,
): SessionSummary | null | undefined {
  const [session, setSession] = useState<SessionSummary | null | undefined>(undefined);
  useEffect(() => {
    if (runtime === null) {
      setSession(undefined);
      return;
    }
    let live = true;
    setSession(undefined);
    runtime.runtime
      .listSessions()
      .then((sessions) => {
        if (!live) return;
        setSession(sessions.find((candidate) => candidate.id === sessionId) ?? null);
      })
      .catch(() => {
        if (live) setSession(null);
      });
    return () => {
      live = false;
    };
  }, [runtime, sessionId]);
  return session;
}

export function TerminalMirrorSurface({
  sessionId,
  culled,
  cameraScale,
  cameraSettled,
  label,
  onStateChange,
}: TerminalMirrorSurfaceProps): ReactElement {
  const pool = useTerminalPool();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const onScreen = useOnScreen(host, culled);

  // One facade per runtime incarnation. Rebuilt when the pool replaces its
  // runtime (a recovery), because a facade over a disposed runtime is a facade
  // over nothing — and NOT rebuilt otherwise, since `TerminalSurface` keys its
  // mount effect on the runtime object's identity.
  const guarded = useMemo(
    () => (pool.runtime === null ? null : watchOnlyRuntime(pool.runtime)),
    [pool.runtime],
  );
  const session = useMirrorSession(guarded, sessionId);

  // DEMAND (TP-L-E′), cull-driven and released atomically.
  //
  // Visible ⇒ `live`; culled, off-screen or hidden ⇒ `none`. Declared through
  // the pool's ledger — the same door the deck uses — so the fold over a
  // session's views is computed in one place and a mirror is just another view
  // of it. Unmounting releases: the hook's cleanup drops the binding whether
  // the widget was live or not, which is TP-L-E′'s "unmount does not silence
  // the source directly; it atomically RELEASES that view's declared demand".
  //
  // Scope honesty (v0.7 moved this line, and it is worth restating): at TP-S2
  // the RENDER half of the release is real — `setVisible` reaches the worker's
  // occluded set and stops its raster and its cursor timers — while the SOURCE
  // half is a ledger entry. `DeclareDemand` reaches the cell at TP-S3b. A
  // culled mirror stops costing pixels today; it stops costing frames then.
  const watching = session != null && onScreen;
  useTerminalSessionViews(session == null ? [] : [sessionId], watching ? "live" : "none");

  // THE CAMERA (§10: "re-raster at gesture end under camera zoom"), and the
  // same doctrine as pane zoom: a gesture is a TRANSFORM, its end is a COMMIT.
  //
  // While the camera moves, the widget's scale rides a CSS custom property and
  // its layout box does not change — so no `ResizeObserver` fires, no backing
  // store is reallocated and the canvas simply scales, as the last frame does
  // between reflows. When the gesture settles, the scale is written into the
  // box once and the canvas re-rasters ONCE.
  //
  // What it never does, at any point: resize the PTY. A mirror holds no
  // geometry lease (TP-L-D), so its box is a rendering question only — and the
  // facade would refuse the call even if the surface tried to make it.
  const [committedScale, setCommittedScale] = useState(1);
  const rerasters = useRef(0);
  const lastCommitted = useRef(1);
  const settled = cameraSettled !== false;
  const scale = cameraScale ?? 1;
  useEffect(() => {
    if (!settled) return;
    // Guarded on a ref rather than counted inside the state updater: React may
    // invoke an updater twice (StrictMode, a re-render racing the commit), and
    // a counter that ticks inside one would report re-rasters that never
    // happened. The guard makes the whole effect idempotent, which is the only
    // form in which "exactly one" is a claim about the world.
    if (lastCommitted.current === scale) return;
    lastCommitted.current = scale;
    rerasters.current += 1;
    setCommittedScale(scale);
  }, [settled, scale]);

  const state: MirrorState =
    session === undefined
      ? "resolving"
      : session === null
        ? "unavailable"
        : onScreen
          ? "watching"
          : "culled";
  const published = useRef<MirrorState | null>(null);
  useEffect(() => {
    if (published.current === state) return;
    published.current = state;
    onStateChange?.(state);
  }, [state, onStateChange]);

  return (
    <div
      ref={setHost}
      className="vf-terminal-mirror"
      data-mirror-state={state}
      data-camera={settled ? "settled" : "moving"}
      // The re-raster count, published where a harness can read it: one per
      // SETTLED camera change and never one during a gesture (§10's
      // "re-raster at gesture end"). Zero PTY resizes accompany any of them.
      data-rerasters={rerasters.current}
      style={
        {
          // The gesture's scale (transform, no layout) and the committed one
          // (layout, one re-raster). Their RATIO is what the surface wears while
          // a gesture is in flight, so a settled camera always wears exactly 1.
          "--vf-mirror-scale": `${scale / (committedScale === 0 ? 1 : committedScale)}`,
        } as CSSProperties
      }
    >
      {label !== undefined && (
        <span className="vf-terminal-mirror-label">
          {label}
          <span className="vf-terminal-mirror-badge">watching</span>
        </span>
      )}
      {session == null ? (
        <UnavailableState
          compact
          title={session === undefined ? "finding this session" : "session unavailable"}
          description={
            session === undefined
              ? "the pool is resolving it"
              : pool.runtime === null
                ? "this window holds no terminal transport yet"
                : `no session ${sessionId} on this floor`
          }
        />
      ) : (
        // `inert` is layer 2, and it is the load-bearing one for TP-R4a's DOM
        // half: it removes the whole subtree from the focus order AND makes
        // `element.focus()` a no-op, which is the difference between a surface
        // that does not take focus and one that CANNOT.
        <div className="vf-terminal-mirror-surface" inert>
          {guarded !== null && (
            <GhostteaProvider runtime={guarded.runtime}>
              <TerminalSurface
                // The read-only projection (layer 5). The component reads
                // interactivity off the SESSION, not off a prop, so this is the
                // only way to tell it what it is.
                session={{ ...session, readWrite: false }}
                theme={mirrorTheme}
                // Layer 4: no auto-focus, and the focus-sync boolean is false
                // whatever the DOM does.
                active={false}
                // Stated for the reader and for the day upstream honours it —
                // but never relied on. See `watch-only-runtime.ts`: at 0.10.1
                // this gates one effect and not the resize path.
                controlsResize={false}
                // Worker-side occlusion — the RENDER half of cull-driven demand
                // (`runtime.js:1271`: posts `visibility` to the worker, and
                // nothing reaches the daemon).
                visible={watching}
              />
            </GhostteaProvider>
          )}
        </div>
      )}
    </div>
  );
}

/** The mirror's theme.
 *
 * A frozen module constant rather than a prop, and the reason is a finding:
 * `runtime.setTheme` notifies the daemon `set-colors` with a sessionId and NO
 * view scope (`runtime.js:1247-1263`), so a mirror with its own theme would
 * repaint the session for every viewer including the authority. The facade
 * refuses the call; this value exists only because `TerminalSurface` requires
 * the prop, and the worker keeps whatever theme the authority set.
 */
const mirrorTheme: TerminalTheme = Object.freeze({
  foreground: [0.85, 0.85, 0.85, 1] as const,
  // Transparent ground: the card behind the mirror is the card's, and a mirror
  // that painted its own would hide the surface it sits on.
  background: [0, 0, 0, 0] as const,
  cursor: [0.85, 0.85, 0.85, 1] as const,
  selection: [0.35, 0.42, 0.55, 0.45] as const,
  selectionForeground: [0.95, 0.95, 0.95, 1] as const,
});

/** Re-exported for a host that wants to read what its mirrors turned away.
 * Zero is the claim; a non-zero count names the verb (TP-R4a). */
export type { MirrorRefusals };
