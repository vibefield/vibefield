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

import type { LiveSurfaceGeometryV1, LiveSurfaceInputEventV1 } from "@vibefield/contracts";
import { UiButton, UnavailableState } from "@vibefield/design-kit/primitives";
import { type ReactElement, useEffect, useRef, useSyncExternalStore } from "react";
import type { ProductSurfaceFrame } from "../pool/host-pool";
import type { SurfaceHandle } from "../pool/surface-pool";
import {
  keyModifiersFromDom,
  mapPointerToLogical,
  pointerButtonFromDom,
  printableTextOf,
} from "./input-map";
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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SurfaceViewController<ProductSurfaceFrame> | null>(null);
  /** The geometry of the frame ON SCREEN — what the user's pointer is actually
   * over. Input maps against THIS and stamps ITS revision (§10.2), never the
   * newest summary's: during a resize the two can differ, and the honest
   * answer is the pixels the user clicked. */
  const displayedGeometryRef = useRef<LiveSurfaceGeometryV1 | null>(null);
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
          displayedGeometryRef.current = metadata.geometry;
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

  // DT-3c — the human input lane (DT-D6). Only wired while `interactive`; the
  // widget decides engagement (WidgetInputBoundary is ITS job), the view only
  // translates: canvas box → the DISPLAYED frame's logical space, stamped with
  // that frame's geometry revision. Events the map rejects (letterbox, no
  // frame yet) or the wire cannot carry (exotic buttons, empty key names)
  // are dropped here — the transport parse is an assert, not a filter.
  useEffect(() => {
    if (props.interactive !== true) return;
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (canvas === null || wrapper === null) return;
    const handle = props.handle;

    const send = (event: LiveSurfaceInputEventV1): void => {
      const geometry = displayedGeometryRef.current;
      if (geometry === null) return;
      handle.sendInput(event, geometry.revision);
    };
    const mapped = (event: {
      clientX: number;
      clientY: number;
    }): { x: number; y: number } | null => {
      const geometry = displayedGeometryRef.current;
      if (geometry === null) return null;
      const box = canvas.getBoundingClientRect();
      return mapPointerToLogical(
        { width: box.width, height: box.height },
        { x: event.clientX - box.left, y: event.clientY - box.top },
        geometry,
      );
    };
    const clampDelta = (value: number): number =>
      Math.min(Math.max(Number.isFinite(value) ? value : 0, -100_000), 100_000);

    const onPointerDown = (event: PointerEvent): void => {
      wrapper.focus();
      const button = pointerButtonFromDom(event.button);
      const point = mapped(event);
      if (button === null || point === null) return;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // A capture refusal only loosens drag tracking; the click still lands.
      }
      event.preventDefault();
      send({
        kind: "pointer",
        action: "down",
        x: point.x,
        y: point.y,
        button,
        clickCount: Math.min(Math.max(event.detail, 1), 3),
      });
    };
    const onPointerMove = (event: PointerEvent): void => {
      const point = mapped(event);
      if (point === null) return;
      send({ kind: "pointer", action: "move", x: point.x, y: point.y });
    };
    const onPointerUp = (event: PointerEvent): void => {
      const button = pointerButtonFromDom(event.button);
      const point = mapped(event);
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Never captured — an up without its down is still worth forwarding.
      }
      if (button === null || point === null) return;
      send({ kind: "pointer", action: "up", x: point.x, y: point.y, button });
    };
    const onWheel = (event: WheelEvent): void => {
      const point = mapped(event);
      if (point === null) return;
      event.preventDefault();
      send({
        kind: "wheel",
        x: point.x,
        y: point.y,
        deltaX: clampDelta(event.deltaX),
        deltaY: clampDelta(event.deltaY),
      });
    };
    const onContextMenu = (event: MouseEvent): void => {
      // The right-click belongs to the page under the surface, not to ours.
      event.preventDefault();
    };
    const onKey = (event: KeyboardEvent, action: "down" | "up"): void => {
      const key = event.key.slice(0, 32);
      const code = event.code.slice(0, 64);
      if (key.length === 0 || code.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      send({
        kind: "key",
        action,
        key,
        code,
        modifiers: keyModifiersFromDom(event),
        autoRepeat: event.repeat,
      });
      if (action !== "down") return;
      // CDP key events alone insert no characters; ordinary typing rides the
      // committed-text lane beside its key event.
      const text = printableTextOf(event);
      if (text !== null) send({ kind: "text", text });
    };
    const onKeyDown = (event: KeyboardEvent): void => onKey(event, "down");
    const onKeyUp = (event: KeyboardEvent): void => onKey(event, "up");

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    wrapper.addEventListener("keydown", onKeyDown);
    wrapper.addEventListener("keyup", onKeyUp);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      wrapper.removeEventListener("keydown", onKeyDown);
      wrapper.removeEventListener("keyup", onKeyUp);
    };
  }, [props.handle, props.interactive]);

  return (
    <div
      ref={wrapperRef}
      data-live-surface-status={status}
      className={`vf-live-surface-view ${props.className ?? ""}`.trim()}
      {...(props.interactive === true ? { tabIndex: 0 } : {})}
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
