import { Canvas, useThree } from "@react-three/fiber";
import type { CanvasEngine, GridConfig } from "@vibecook/ice";
import type { DevtoolsHandle } from "@vibecook/ice/devtools";
import {
  createGLBridge,
  createGLPointerRouter,
  type GLBridge,
  type GLPointerRouter,
  GLViews,
  type GlFrameStats,
} from "@vibecook/ice/r3f";
import type { InfiniteCanvasHandle, KeymapEntry } from "@vibecook/ice/react";
import {
  type MutableRefObject,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { PMREMGenerator, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { installCursorHalo } from "../cursor";
import { InfiniteCanvasGround } from "./InfiniteCanvasGround";

// CanvasStage (§5.4.3): renderer-local ICE/DOM/GL composition and
// frame-coupled state — InfiniteCanvas, the GL bridge/pointer router/P2
// plane, the composite GLViews layer, the PMREM environment, and the cursor
// halo. Mounted INSIDE the generation-keyed recede wrapper, so one stage
// lifetime = one engine generation; the ground factory is created per mount
// (a factory is one canvas-mount's state; reuse across remounts is
// undefined). Owns NO document or chrome state.
//
// THE GL DISPOSAL ORDER (named invariant): every GL/halo resource this stage
// wires is released by disposeAll — published into `disposeRef` so the
// session's engine-disposal cleanup runs it BEFORE ce.dispose(), exactly the
// pre-split order (disposeGl → disposeHalo → engine). The stage's own
// unmount effects also call it (idempotent) — whichever runs first wins.

/**
 * v1's `r3fRoot={<Environment preset="apartment"/>}` equivalent — but
 * DETERMINISTIC: three's built-in RoomEnvironment through PMREM instead of
 * drei's CDN HDR (a slow/blocked fetch left the metallic cards silhouetted —
 * field-verified 2026-07-12). Near-identical neutral studio look, zero
 * network. <GLViews environment> stamps it on every island scene.
 */
function EnvLoader({ onTex }: { onTex: (t: Texture | null) => void }) {
  const gl = useThree((s) => s.gl);
  const tex = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    const t = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return t;
  }, [gl]);
  useEffect(() => {
    onTex(tex);
    return () => {
      onTex(null);
      // 3b disposal audit: the PMREM cubemap is per-stage-mount state — free
      // it with the stage instead of waiting for the dead context's GC.
      tex.dispose();
    };
  }, [tex, onTex]);
  return null;
}

export function CanvasStage({
  ce,
  grid,
  keymapOverrides,
  ecsOpen,
  devtoolsRef,
  disposeRef,
}: {
  ce: CanvasEngine;
  grid: Partial<GridConfig>;
  /** FieldView's stable override entries (I1, ice 0.4.0 — field-keymap.ts). */
  keymapOverrides: readonly KeymapEntry[];
  /** GL frame profiling wires only while the ECS panel is open. */
  ecsOpen: boolean;
  /** ChromeLayer's live devtools handle — the stage feeds its GL lanes. */
  devtoolsRef: MutableRefObject<DevtoolsHandle | null>;
  /** The session's engine-disposal cleanup calls this BEFORE ce.dispose(). */
  disposeRef: MutableRefObject<(() => void) | null>;
}): ReactElement {
  // --- GL root: bridge + router + P2 plane arrive in onReady; glRoute delegates
  // via ref. glRef keeps the whole set so we can tear it down — onReady fires
  // from InfiniteCanvas's mount effect, so a StrictMode double-mount would
  // otherwise stack a stale bridge (reflector + world observer) and a stale
  // plane div (glboard disposes the same set in its boot handle's dispose()).
  const routerRef = useRef<GLPointerRouter | null>(null);
  const glRef = useRef<{ bridge: GLBridge; router: GLPointerRouter; plane: HTMLDivElement } | null>(
    null,
  );
  const [gl, setGl] = useState<{ bridge: GLBridge; plane: HTMLDivElement } | null>(null);
  const [envTex, setEnvTex] = useState<Texture | null>(null);
  const glRoute = useCallback(
    (kind: "down" | "move" | "up" | "cancel", x: number, y: number, e: PointerEvent) => {
      const router = routerRef.current;
      if (router === null) return false;
      const handled = router.route(kind, x, y, e);
      // Moves carry the rich verdict: the router's hover-time overInteractive
      // feeds the pointer's OverInteractive tag (cursor-halo dot over the
      // orbit cube / claimed shapes, same telegraph as DOM interactives).
      return kind === "move" ? { handled, overInteractive: router.overInteractive() } : handled;
    },
    [],
  );
  const disposeGl = useCallback(() => {
    const prev = glRef.current;
    if (prev === null) return;
    prev.bridge.uninstall(); // unregisters the render reflector + world observer
    prev.plane.remove();
    // 3b disposal audit: don't leave the DEV forensics twin pointing at a
    // disposed bridge (the next mount overwrites it; the LAST unmount must not
    // leak it).
    const w = window as unknown as { __iceBridge?: GLBridge };
    if (w.__iceBridge === prev.bridge) delete w.__iceBridge;
    glRef.current = null;
    routerRef.current = null;
  }, []);
  // Cursor halo (2026-07-18): the pointerlab morph as an OS-cursor accent —
  // ring on canvas, zoomed-in ring over cards, solid dot over internal
  // interactives (the opt-out telegraph). Same StrictMode discipline as GL:
  // dispose the prior mount's install before wiring a fresh one.
  const haloRef = useRef<(() => void) | null>(null);
  const disposeHalo = useCallback(() => {
    haloRef.current?.();
    haloRef.current = null;
  }, []);
  const onReady = useCallback(
    (handle: InfiniteCanvasHandle) => {
      disposeHalo();
      haloRef.current = installCursorHalo(ce, handle.host.container);
      disposeGl(); // drop a prior mount's set before wiring a fresh one
      const bridge = createGLBridge(ce.engine);
      // DEV-only forensics twin of __ice — headless scripts inspect islands.
      (window as unknown as { __iceBridge?: GLBridge }).__iceBridge = bridge;
      const router = createGLPointerRouter({ world: ce.world, bridge, index: ce.stack.index });
      routerRef.current = router;
      const plane = handle.host.container.ownerDocument.createElement("div");
      plane.style.cssText = "position:absolute;inset:0;pointer-events:none;"; // P2: display-only (router owns GL hits)
      // P2 sits UNDER the lifted plane (P3) and chrome — glboard's insertion
      // point; appending last would stack GL over dragged widgets/chrome.
      handle.host.container.insertBefore(plane, handle.planes.lifted);
      glRef.current = { bridge, router, plane };
      setGl({ bridge, plane });
    },
    [ce, disposeGl, disposeHalo],
  );
  useEffect(() => disposeGl, [disposeGl]);
  useEffect(() => disposeHalo, [disposeHalo]);

  // Publish the full GL/halo teardown for the session's pre-engine-dispose
  // call; clear only our own registration on unmount.
  useEffect(() => {
    const disposeAll = (): void => {
      disposeGl();
      disposeHalo();
    };
    disposeRef.current = disposeAll;
    return () => {
      if (disposeRef.current === disposeAll) disposeRef.current = null;
    };
  }, [disposeGl, disposeHalo, disposeRef]);

  // GL frame profiling → profiler HUD lanes ("gl cpu" = the whole compositor
  // pass on the main thread; "gpu" = summed render-call GPU time, 0 where
  // timer queries are unsupported). Only wired while the ECS panel is open —
  // GLViews skips all measurement when the prop is absent.
  const onGlStats = useCallback(
    (s: GlFrameStats) => {
      const dt = devtoolsRef.current;
      if (dt === null) return;
      dt.lane("gl cpu", s.cpuMs);
      if (s.gpuMs > 0) dt.lane("gpu", s.gpuMs);
      dt.glStats(s); // the full GL panel: renderer counts, VT census, LOD bands, culls
    },
    [devtoolsRef],
  );

  return (
    <InfiniteCanvasGround
      engine={ce}
      grid={grid}
      keymapOverrides={keymapOverrides}
      glRoute={glRoute}
      onReady={onReady}
      className="field-canvas"
    >
      {/* Canvas pointerEvents none is LOAD-BEARING (glboard precedent):
          without it the R3F canvas swallows every pointer event over the
          whole viewport — DOM widgets lose hover/click while the engine
          keeps working via container bubbling (field report 2026-07-12). */}
      {gl !== null &&
        createPortal(
          <Canvas
            orthographic
            frameloop="never"
            gl={{ alpha: true, antialias: false }}
            className="field-gl-canvas"
          >
            <EnvLoader onTex={setEnvTex} />
            <GLViews
              engine={ce.engine}
              bridge={gl.bridge}
              store={ce.runtime.store}
              environment={envTex}
              {...(ecsOpen ? { onFrameStats: onGlStats } : {})}
            />
          </Canvas>,
          gl.plane,
        )}
    </InfiniteCanvasGround>
  );
}
