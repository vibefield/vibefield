import type { CanvasEngine } from "@vibecook/ice";
import type { FrameView } from "@vibefield/contracts";
import { type ReactElement, useEffect, useLayoutEffect, useRef } from "react";
import { sayStatus } from "../../frame/status-line";
import {
  blurStill,
  COVER,
  type CoverStill as CoverStillController,
  createCoverStill,
  stillCanvasSurface,
} from "./cover-still";
import { currentDesk } from "./desk-door";
import "./cover-still.css";

// THE STILL UNDER THE COVERS, in the window (DK-15; DESIGN.md §8 "The covers over the desk"): one canvas over the desk
// — after the generation-keyed scene, so it outlives a remount, and under every piece of chrome — and the controller
// (`cover-still.ts`) that runs the ruled order against the window's engine and the desk mounted now. It moves the cover
// in the COMMIT that moves the frame's cover: rising, the capture is asked before the cover's first frame is painted (the
// cover fades in over the live desk meanwhile); lowering, the desk is thawed and shown before the cover's lowering is
// painted. A theme change or a resize while covered takes the still again; a new engine under a standing cover is frozen
// at once (the still stands). Unmounted, it thaws whatever it froze — a crashed frame cannot wedge the engine.

const NEXT_FRAME_FALLBACK_MS = 100;

/** The page's next frame — or a short timeout, so a hidden page (no frames) never stalls a wait. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, NEXT_FRAME_FALLBACK_MS);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CoverStill({
  ce,
  covered,
  view,
  dark,
}: {
  /** The window's engine — its frame gate is what the cover freezes. */
  ce: CanvasEngine;
  /** A view covers the field (every view but the canvas). */
  covered: boolean;
  /** The window's view, named in the cover's record. */
  view: FrameView;
  /** The theme lit now: a change while covered takes the still again. */
  dark: boolean;
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const ceRef = useRef(ce);
  ceRef.current = ce;
  const controller = useRef<CoverStillController | null>(null);

  // the controller, once for the window's still
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.dataset.still = "none";
    el.dataset.recede = "false";
    const made = createCoverStill({
      frame: () => ceRef.current.frame,
      desk: () => {
        const desk = currentDesk();
        return desk !== null && desk.engine === ceRef.current ? desk : null;
      },
      surface: stillCanvasSurface(el),
      blur: (bitmap, px) => blurStill(bitmap, px),
      // the canvas's LAYOUT width (no transform reaches it under a cover — the still recedes, the desk never does)
      viewWidth: (desk) => desk.handle.canvas.clientWidth || el.clientWidth,
      say: (id, text) => sayStatus({ id, text }),
      now: () => performance.now(),
      nextFrame,
      reduced: reducedMotion,
    });
    controller.current = made;
    return () => {
      made.dispose();
      if (controller.current === made) controller.current = null;
    };
  }, []);

  // the cover rises or lowers in the commit that moves the frame's cover — before that commit is painted
  const viewRef = useRef(view);
  viewRef.current = view;
  useLayoutEffect(() => {
    controller.current?.cover(covered, viewRef.current);
  }, [covered]);

  // a theme change while covered: the desk was re-dressed by the stage's bridge in this commit — take it again
  const darkSeen = useRef(dark);
  useEffect(() => {
    if (darkSeen.current === dark) return;
    darkSeen.current = dark;
    controller.current?.recapture("theme");
  }, [dark]);

  // a new engine under a standing cover (a new generation): frozen at once
  const ceSeen = useRef(ce);
  useEffect(() => {
    if (ceSeen.current === ce) return;
    ceSeen.current = ce;
    controller.current?.engineChanged();
  }, [ce]);

  // a resize while covered: taken again once the window stands still (a drag resizes every frame)
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver !== "function") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false; // the observation's own first call: nothing resized
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        controller.current?.recapture("resize");
      }, COVER.resizeQuietMs);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // a picture of the desk under a cover — no content of its own for assistive tech (the cover names the view)
  return <canvas ref={ref} className="field-still" />;
}
