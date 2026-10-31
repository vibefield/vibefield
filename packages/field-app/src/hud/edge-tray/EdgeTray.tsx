/**
 * The edge tray's controllers (One Frame FR-4): the drawer's grammar on the frame's ONE owner of
 * the open surface, and Artifacts on the right edge — its drawer holds the `hud.side-panel`
 * contribution (the Artifact Hub) that used to slide out as a 26rem side panel. Mounted once by
 * ChromeLayer; the view it drives is EdgeTrayView, which the catalog mounts with fixtures. (The
 * left edge's clipboard retired into the hand, track HN — `frame/cards/`.)
 *
 * Grammar (compact.md Part II, as ruled; DESIGN.md §8 edge trays): hover opens after 120ms and
 * closes after a 320ms grace; click pins (the pin survives the pointer leaving); Escape folds an
 * open drawer. A drawer is one of the frame's open surfaces — opening it folds every other, and
 * any other opening folds it (F11) — and over a covered view its notch rests as a sliver whose
 * hover delay waits for it to grow (240ms). Non-modal: no backdrop, no recede, no focus trap.
 */
import { type ReactElement, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { type FrameSurface, foldSurface } from "../../frame/frame-surface";
import type { SurfaceEntry } from "../../plugin-host/surface-registry";
import { PluginSurfaceHost, useVisiblePluginSurfaces } from "../PluginSurfaceSlot";
import { EdgeTrayView } from "./EdgeTrayView";

export const TRAY_OPEN_DELAY_MS = 120;
export const TRAY_CLOSE_GRACE_MS = 320;
/** A sliver's growth into the notch (One Frame §10): a notch reached as a
 * sliver opens its drawer only once it IS the notch. */
export const SLIVER_GROW_MS = 240;
/** The drawer's travel out (§8: 600ms, island) — content stays through it. */
const DRAWER_EXIT_MS = 600;

/** The drawer, as the frame's owner names it. */
export type EdgeDrawer = Extract<FrameSurface, "artifacts">;

export interface EdgeDrawerProps {
  /** The frame's open surface, from its one owner. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  /** A view covers the field: the notch rests as its sliver. */
  sliver?: boolean;
}

export interface EdgeDrawerState {
  readonly open: boolean;
  readonly pinned: boolean;
  pin(on: boolean): void;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  readonly trayRef: RefObject<HTMLElement | null>;
  readonly nubRef: RefObject<HTMLButtonElement | null>;
}

/** The drawers' one grammar, on the frame's owner: open is "the owner holds
 * this drawer", the pin is the drawer's own, and a fold from outside (another
 * surface, a change of view) takes the pin with it. */
export function useEdgeDrawer(
  which: EdgeDrawer,
  { surface, onSurfaceChange, sliver = false }: EdgeDrawerProps,
): EdgeDrawerState {
  const open = surface === which;
  const [pinned, setPinned] = useState(false);
  if (!open && pinned) setPinned(false);
  // The owner as it stands when a timer fires, never as it stood when it was
  // set: a fold must not fold a surface that opened in between.
  const live = useRef({ surface, onSurfaceChange });
  live.current = { surface, onSurfaceChange };
  const trayRef = useRef<HTMLElement | null>(null);
  const nubRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const setOpen = useCallback(
    (next: boolean) => {
      const now = live.current;
      now.onSurfaceChange(next ? which : foldSurface(now.surface, which));
    },
    [which],
  );

  const pin = useCallback(
    (on: boolean) => {
      clearTimers();
      setPinned(on);
      setOpen(on);
    },
    [clearTimers, setOpen],
  );

  const onPointerEnter = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (open) return;
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(
      () => {
        openTimer.current = null;
        setOpen(true);
      },
      sliver ? SLIVER_GROW_MS + TRAY_OPEN_DELAY_MS : TRAY_OPEN_DELAY_MS,
    );
  }, [open, setOpen, sliver]);

  const onPointerLeave = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (pinned) return;
    // A drawer that holds the keyboard stays: a field in it is in use.
    if (trayRef.current?.contains(document.activeElement)) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, TRAY_CLOSE_GRACE_MS);
  }, [pinned, setOpen]);

  // Escape folds an open drawer — on the capture phase, as the side panel's
  // did, so the field's own Esc waits — and gives the keyboard back to its
  // notch if it was inside.
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const inside = trayRef.current?.contains(document.activeElement) ?? false;
      pin(false);
      if (inside) nubRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open, pin]);

  return { open, pinned, pin, onPointerEnter, onPointerLeave, trayRef, nubRef };
}

/** Artifacts, behind the right notch (One Frame FR-4, FC-D10 — closes D-7;
 * F10): the notch is the Artifact Hub's only door, and its drawer holds the
 * SAME contents the 26rem side panel held — the `hud.side-panel` contribution
 * — in the drawer's 152 column, where the Hub answers with its narrow form.
 * No surface bound, no notch: a door to nothing would be a lie (the side
 * panel's toggle had the same rule). The Hub mounts while the drawer is open
 * and stays through its travel out, so it never slides away empty; disable or
 * hot-reload folds it. */
export function ArtifactsTray({
  windowId,
  ...owner
}: EdgeDrawerProps & { windowId: string }): ReactElement | null {
  const surfaces = useVisiblePluginSurfaces("hud.side-panel");
  const entry = surfaces[0] ?? null;
  const drawer = useEdgeDrawer("artifacts", owner);
  const { open, pin } = drawer;
  const [shown, setShown] = useState<SurfaceEntry | null>(open ? entry : null);

  // Unbound (disabled, reloading): the drawer folds with its content.
  useEffect(() => {
    if (entry === null && open) pin(false);
  }, [entry, open, pin]);

  useEffect(() => {
    if (open && entry !== null) {
      setShown(entry);
      return;
    }
    const timer = window.setTimeout(() => setShown(null), DRAWER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [entry, open]);

  if (entry === null) return null;
  return (
    <EdgeTrayView
      label={entry.title}
      open={open}
      pinned={drawer.pinned}
      sliver={owner.sliver === true}
      content={
        shown === null ? null : (
          <PluginSurfaceHost
            slot="hud.side-panel"
            windowId={windowId}
            requestClose={() => pin(false)}
            surfaceId={shown.surfaceId}
          />
        )
      }
      hint={entry.title}
      nubRef={drawer.nubRef}
      trayRef={drawer.trayRef}
      onNubClick={() => pin(!drawer.pinned)}
      onPointerEnter={drawer.onPointerEnter}
      onPointerLeave={drawer.onPointerLeave}
    />
  );
}
