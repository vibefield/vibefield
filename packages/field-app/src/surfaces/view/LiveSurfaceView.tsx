// DT-2b — the shipping DOM face of a live surface: one <canvas>, painted from
// the pool handle's presentation via the DOM-era consume door
// (`presentLatestVia` + 2D `drawImage`, the foundation lab's own on-screen
// path). The component is a thin shell over `createSurfaceViewController`; it
// owns exactly the DOM wiring — IntersectionObserver, ResizeObserver, page
// visibility, the rAF scheduler, the canvas sink — and none of the policy.
//
// Ownership: the ACQUIRER owns the handle (03·A C-3). This view never acquires
// and never releases; it presents the handle it is given and stops on unmount.
// Faces are deliberately minimal here — the widget's CardShell owns real
// chrome; the catalog and DT-3 both mount THIS component (UI_SYSTEM: the
// catalog mounts the shipping view, never a replica).

import { UiButton, UnavailableState } from "@vibefield/design-kit/primitives";
import { type ReactElement, useEffect, useRef, useSyncExternalStore } from "react";
import type { ProductSurfaceFrame } from "../pool/host-pool";
import type { SurfaceHandle } from "../pool/surface-pool";
import { createSurfaceViewController, type SurfaceViewController } from "./view-controller";
import "./live-surface-view.css";

export interface LiveSurfaceViewProps {
  readonly handle: SurfaceHandle<ProductSurfaceFrame>;
  /** The holder is interactively engaged (raises fps + priority, DT-D5). */
  readonly interactive?: boolean;
  readonly className?: string;
}

export function LiveSurfaceView(props: LiveSurfaceViewProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<SurfaceViewController<ProductSurfaceFrame> | null>(null);
  const interactiveRef = useRef(props.interactive === true);
  interactiveRef.current = props.interactive === true;

  const status = useSyncExternalStore(
    (onStoreChange) => props.handle.onState(onStoreChange),
    () => props.handle.status,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const controller = createSurfaceViewController<ProductSurfaceFrame>({
      handle: props.handle,
      scheduler: {
        schedule: (tick) => {
          const id = requestAnimationFrame(tick);
          return () => cancelAnimationFrame(id);
        },
      },
      sink: {
        draw: (frame, metadata) => {
          const rect = metadata.geometry.visibleRect;
          if (rect.width < 1 || rect.height < 1) return false;
          if (canvas.width !== rect.width) canvas.width = rect.width;
          if (canvas.height !== rect.height) canvas.height = rect.height;
          try {
            context.drawImage(
              frame,
              rect.x,
              rect.y,
              rect.width,
              rect.height,
              0,
              0,
              rect.width,
              rect.height,
            );
            return true;
          } catch {
            return false;
          }
        },
      },
      initialFacts: {
        elementVisible: true,
        pageVisible: document.visibilityState === "visible",
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
        interactive: interactiveRef.current,
      },
    });
    controllerRef.current = controller;

    const intersection = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) controller.updateFacts({ elementVisible: entry.isIntersecting });
    });
    intersection.observe(canvas);

    const resize = new ResizeObserver(() => {
      controller.updateFacts({
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
      });
    });
    resize.observe(canvas);

    const onPageVisibility = (): void => {
      controller.updateFacts({ pageVisible: document.visibilityState === "visible" });
    };
    document.addEventListener("visibilitychange", onPageVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onPageVisibility);
      intersection.disconnect();
      resize.disconnect();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [props.handle]);

  useEffect(() => {
    controllerRef.current?.updateFacts({ interactive: props.interactive === true });
  }, [props.interactive]);

  return (
    <div
      data-live-surface-status={status}
      className={`vf-live-surface-view ${props.className ?? ""}`.trim()}
    >
      <canvas ref={canvasRef} className="vf-live-surface-view__canvas" />
      {status !== "live" ? (
        <div className="vf-live-surface-view__face">
          {status === "attaching" ? <span>connecting surface…</span> : null}
          {status === "lost" ? (
            <>
              <UnavailableState
                compact
                title="Surface lost"
                description="the producer went away — the last frame is kept"
              />
              <UiButton variant="quiet" onClick={() => controllerRef.current?.retry()}>
                Reconnect
              </UiButton>
            </>
          ) : null}
          {status === "released" ? <span>surface released</span> : null}
        </div>
      ) : null}
    </div>
  );
}
