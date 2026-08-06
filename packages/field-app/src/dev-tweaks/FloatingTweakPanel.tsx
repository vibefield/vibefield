import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const PANEL_Z_INDEX = 2_147_483_646;
const TOGGLE_Z_INDEX = 2_147_483_647;
const VIEWPORT_GUTTER = 8;

interface Point {
  left: number;
  top: number;
}

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

export interface FloatingTweakPanelProps {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Reusable top-layer development panel. It portals to body to escape every app
 * stacking context; only its compact header is a drag handle, so controls keep
 * native pointer behavior.
 */
export function FloatingTweakPanel({
  title,
  open,
  onOpenChange,
  children,
}: FloatingTweakPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<Point | null>(null);

  useEffect(() => {
    const keepInViewport = (): void => {
      const panel = panelRef.current;
      if (panel === null) return;
      setPosition((current) =>
        current === null ? null : clampPoint(current.left, current.top, panel),
      );
    };
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, []);

  useEffect(() => {
    if (!open) return;
    // A closed panel has no element to measure during resize. Clamp again as
    // soon as it reopens so a saved drag position can never strand it offscreen.
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel === null) return;
      setPosition((current) =>
        current === null ? null : clampPoint(current.left, current.top, panel),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onOpenChange(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [onOpenChange, open]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    if (panel === null) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setPosition({ left: rect.left, top: rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (drag === null || panel === null || drag.pointerId !== event.pointerId) return;
    setPosition(clampPoint(event.clientX - drag.offsetX, event.clientY - drag.offsetY, panel));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return createPortal(
    <>
      <button
        type="button"
        aria-label={open ? "Hide developer tweaks" : "Show developer tweaks"}
        aria-pressed={open}
        data-dev-tweak-toggle
        className="no-drag fixed top-16 left-4 flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/75 text-black/60 shadow-xl backdrop-blur-xl transition hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vf-select)] dark:border-white/15 dark:bg-neutral-900/70 dark:text-white/65 dark:hover:bg-neutral-900 dark:hover:text-white"
        style={{ zIndex: TOGGLE_Z_INDEX }}
        title={open ? "Hide developer tweaks" : "Show developer tweaks"}
        onClick={() => onOpenChange(!open)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.7]"
        >
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          data-dev-tweak-panel
          className="no-drag fixed flex max-h-[calc(100vh-5rem)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/75 text-black shadow-2xl backdrop-blur-2xl dark:border-white/15 dark:bg-neutral-950/75 dark:text-white"
          style={
            position === null
              ? { zIndex: PANEL_Z_INDEX, top: "7rem", left: "1rem" }
              : { zIndex: PANEL_Z_INDEX, left: position.left, top: position.top }
          }
        >
          <div
            data-dev-tweak-drag-handle
            className="flex h-10 shrink-0 touch-none cursor-grab select-none items-center justify-between border-b border-black/10 px-3 active:cursor-grabbing dark:border-white/10"
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
                Dev
              </span>
              <span className="truncate text-[12px] font-semibold">{title}</span>
            </div>
            <span aria-hidden="true" className="text-[14px] tracking-[0.12em] opacity-30">
              ···
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
        </div>
      )}
    </>,
    document.body,
  );
}

function clampPoint(left: number, top: number, panel: HTMLElement): Point {
  const maxLeft = Math.max(
    VIEWPORT_GUTTER,
    window.innerWidth - panel.offsetWidth - VIEWPORT_GUTTER,
  );
  const maxTop = Math.max(
    VIEWPORT_GUTTER,
    window.innerHeight - panel.offsetHeight - VIEWPORT_GUTTER,
  );
  return {
    left: Math.min(Math.max(VIEWPORT_GUTTER, left), maxLeft),
    top: Math.min(Math.max(VIEWPORT_GUTTER, top), maxTop),
  };
}
