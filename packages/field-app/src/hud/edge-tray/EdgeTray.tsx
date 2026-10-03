/**
 * The edge trays' controllers (SNAP-3; One Frame FR-4): the drawers' shared
 * grammar on the frame's ONE owner of the open surface, the clipboard on the
 * left — its store, the capture door, the fly-in — and Artifacts on the right,
 * whose drawer holds the `hud.side-panel` contribution (the Artifact Hub) that
 * used to slide out as a 26rem side panel. Mounted once each by ChromeLayer;
 * the view they drive is EdgeTrayView, which the catalog mounts with fixtures.
 *
 * Grammar (compact.md Part II, as ruled; DESIGN.md §8 edge trays): hover opens
 * after 120ms and closes after a 320ms grace; click pins (the pin survives the
 * pointer leaving); ⇧⌘V / Ctrl+Shift+V pins the clipboard from the keyboard;
 * Escape folds an open drawer; typing while the clipboard is pinned filters
 * its column. A drawer is one of the frame's open surfaces — opening it folds
 * every other, and any other opening folds it (F11) — and over a covered view
 * its notch rests as a sliver whose hover delay waits for it to grow (240ms).
 * Non-modal: no backdrop, no recede, no focus trap.
 */
import type { ScreenshotCaptureResult } from "@vibefield/contracts";
import {
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isClipboardTrayChord } from "../../field/product-chords";
import { type FrameSurface, foldSurface } from "../../frame/frame-surface";
import { viewKeysOf } from "../../frame/views";
import { type FieldHost, getHost } from "../../host";
import type { SurfaceEntry } from "../../plugin-host/surface-registry";
import { PluginSurfaceHost, useVisiblePluginSurfaces } from "../PluginSurfaceSlot";
import {
  type ClipboardItem,
  type ClipboardStore,
  clipboardStore,
  useClipboardItems,
} from "./clipboard-store";
import {
  type EdgeTrayDay,
  type EdgeTraySnap,
  type EdgeTrayTile,
  EdgeTrayView,
} from "./EdgeTrayView";
import { flightStart, flyToNotch } from "./tray-flight";

export const TRAY_OPEN_DELAY_MS = 120;
export const TRAY_CLOSE_GRACE_MS = 320;
/** A sliver's growth into the notch (One Frame §10): a notch reached as a
 * sliver opens its drawer only once it IS the notch. */
export const SLIVER_GROW_MS = 240;
const BUMP_MS = 420;
/** The drawer's travel out (§8: 600ms, island) — content stays through it. */
const DRAWER_EXIT_MS = 600;

/** The two drawers, as the frame's owner names them. */
export type EdgeDrawer = Extract<FrameSurface, "clipboard" | "artifacts">;

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

export type ClipboardTrayHost = Pick<
  FieldHost,
  "screenshotCapture" | "onScreenshotResult" | "screenshotStillUrl" | "screenshotPreview"
>;

/** The honest word for each answer the door can give. */
export function snapFor(
  host: ClipboardTrayHost,
  last: ScreenshotCaptureResult | null,
  busy: boolean,
): EdgeTraySnap {
  if (host.screenshotCapture === undefined)
    return { state: "unavailable", word: "no capture here" };
  if (busy) return { state: "busy", word: "capturing…" };
  if (last !== null && last.status === "error") {
    switch (last.code) {
      case "helper-missing":
        return { state: "unavailable", word: "no helper on this platform" };
      case "permission-denied":
        return {
          state: "error",
          word: "Screen Recording is off — System Settings › Privacy & Security",
        };
      case "busy":
        return { state: "busy", word: "one at a time" };
      default:
        return { state: "error", word: last.message };
    }
  }
  return { state: "ready", word: "snap" };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayOf(at: number, now: number): EdgeTrayDay {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (at >= startOfToday.getTime()) return "today";
  if (at >= startOfToday.getTime() - DAY_MS) return "yesterday";
  return "earlier";
}

function timeOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function tileFor(
  item: ClipboardItem,
  host: ClipboardTrayHost,
  now: number,
  broken: ReadonlySet<string>,
): EdgeTrayTile {
  const url = broken.has(item.id) ? null : (host.screenshotStillUrl?.(item.path) ?? null);
  return {
    id: item.id,
    kind: "capture",
    label: `Screenshot · ${item.width} × ${item.height}`,
    imageUrl: url,
    time: timeOf(item.at),
    day: dayOf(item.at, now),
    meta: broken.has(item.id) ? "the still is gone from disk" : "Screen · on the clipboard",
  };
}

function matches(tile: EdgeTrayTile, filter: string): boolean {
  if (filter === "") return true;
  const needle = filter.toLowerCase();
  return `${tile.label} ${tile.meta} ${tile.time}`.toLowerCase().includes(needle);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** The notch's tooltip says its key (FR-5), in Apple's order (⌃⌥⇧⌘). */
export function clipboardHint(platform: FieldHost["platform"]): string {
  return `Clipboard  ${viewKeysOf(platform) === "mac" ? "⇧⌘V" : "Ctrl+Shift+V"}`;
}

export function ClipboardTray({
  store = clipboardStore,
  host: hostProp,
  now = () => Date.now(),
  ...owner
}: EdgeDrawerProps & {
  store?: ClipboardStore;
  host?: ClipboardTrayHost & Pick<FieldHost, "platform">;
  now?: () => number;
}): ReactElement {
  const host = hostProp ?? getHost();
  const items = useClipboardItems(store);
  const drawer = useEdgeDrawer("clipboard", owner);
  const { open, pinned, pin, nubRef } = drawer;
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ScreenshotCaptureResult | null>(null);
  const [bumped, setBumped] = useState(false);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const bumpTimer = useRef<number | null>(null);

  // Folding clears the filter, whoever folded it.
  if (!open && filter !== "") setFilter("");

  // ⇧⌘V pins from the keyboard; typing while pinned filters. (Escape is the
  // drawers' own, above.)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isClipboardTrayChord(event)) {
        event.preventDefault();
        // GT-D21: stopped here too, or a focused Godview pane would ALSO run
        // its Ghostty default for ⇧⌘V (paste_from_selection).
        event.stopPropagation();
        pin(!pinned);
        return;
      }
      if (!pinned || event.key === "Escape") return;
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Backspace") {
        setFilter((f) => f.slice(0, -1));
        return;
      }
      if (event.key.length === 1) setFilter((f) => f + event.key);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pin, pinned]);

  const bump = useCallback(() => {
    if (bumpTimer.current !== null) window.clearTimeout(bumpTimer.current);
    setBumped(true);
    bumpTimer.current = window.setTimeout(() => {
      bumpTimer.current = null;
      setBumped(false);
    }, BUMP_MS);
  }, []);

  /** A still arrived — from either door. The ghost flies, then the store
   * takes it, so the count ticks and the tile deals in on arrival. */
  const onResult = useCallback(
    (result: ScreenshotCaptureResult) => {
      setLast(result);
      if (result.status !== "ok") return;
      const nub = nubRef.current;
      const to = nub?.getBoundingClientRect();
      const land = (): void => {
        store.addCapture(result);
        bump();
      };
      if (nub === null || to === undefined || to.width === 0) {
        land();
        return;
      }
      const from = flightStart(result.screenBounds, window);
      void flyToNotch({
        from,
        to: { left: to.left, top: to.top, width: to.width, height: to.height },
        imageUrl: host.screenshotStillUrl?.(result.path) ?? null,
        reducedMotion: reducedMotion(),
        host: document.body,
      }).then(land);
    },
    [bump, host, nubRef, store],
  );

  // The View menu's capture (SNAP-3): main tells the page; the same landing.
  useEffect(() => {
    const subscribe = host.onScreenshotResult;
    if (subscribe === undefined) return;
    return subscribe(onResult);
  }, [host, onResult]);

  const snap = useCallback(() => {
    const capture = host.screenshotCapture;
    if (capture === undefined || busy) return;
    setBusy(true);
    capture().then(
      (result) => {
        setBusy(false);
        onResult(result);
      },
      (cause: unknown) => {
        setBusy(false);
        setLast({
          status: "error",
          code: "helper-exited",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    );
  }, [busy, host, onResult]);

  const look = useCallback(
    (id: string) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item === undefined) return;
      if (host.screenshotPreview === undefined) {
        setPreviewNotice("Preview is available in the desktop app.");
        return;
      }
      setPreviewNotice(null);
      void host.screenshotPreview(item.path).then(
        (result) => setPreviewNotice(result.ok ? null : result.message),
        () => setPreviewNotice("The screenshot preview could not be opened. Try again."),
      );
    },
    [host, items],
  );

  const remove = useCallback((id: string) => store.remove(id), [store]);
  const onImageBroken = useCallback((id: string) => {
    setBroken((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const tiles = useMemo(() => {
    const at = now();
    return items
      .map((item) => tileFor(item, host, at, broken))
      .filter((tile) => matches(tile, filter));
  }, [broken, filter, host, items, now]);

  return (
    <EdgeTrayView
      side="left"
      label="Clipboard"
      open={open}
      pinned={pinned}
      count={items.length}
      sliver={owner.sliver === true}
      items={tiles}
      filter={filter}
      snap={snapFor(host, last, busy)}
      bumped={bumped}
      hint={clipboardHint(host.platform)}
      emptyWord="nothing here yet — take a screenshot and it lands here"
      notice={previewNotice}
      nubRef={nubRef}
      trayRef={drawer.trayRef}
      onNubClick={() => pin(!pinned)}
      onPointerEnter={drawer.onPointerEnter}
      onPointerLeave={drawer.onPointerLeave}
      onSnap={snap}
      onLook={look}
      onRemove={remove}
      onImageBroken={onImageBroken}
    />
  );
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
      side="right"
      label={entry.title}
      open={open}
      pinned={drawer.pinned}
      count={null}
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
      items={[]}
      filter=""
      snap={null}
      bumped={false}
      hint={entry.title}
      emptyWord=""
      nubRef={drawer.nubRef}
      trayRef={drawer.trayRef}
      onNubClick={() => pin(!drawer.pinned)}
      onPointerEnter={drawer.onPointerEnter}
      onPointerLeave={drawer.onPointerLeave}
    />
  );
}
