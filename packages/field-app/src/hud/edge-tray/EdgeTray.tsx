/**
 * ClipboardTray — the left edge tray's controller (SNAP-3): the hover / pin /
 * keyboard grammar, the store, the capture door, and the fly-in. Mounted once
 * by ChromeLayer; the view it drives is EdgeTrayView, which the catalog mounts
 * on its own with fixtures.
 *
 * Grammar (compact.md Part II, as ruled): hover opens after 120ms and closes
 * after a 320ms grace; click pins (the pin survives the pointer leaving);
 * ⌘⇧V / Ctrl+Shift+V pins from the keyboard; Escape unpins; typing while
 * pinned filters the column. Non-modal, like the Artifact Hub's panel: no
 * backdrop, no recede, no focus trap.
 */
import type { ScreenshotCaptureResult } from "@vibefield/contracts";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type FieldHost, getHost } from "../../host";
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
const BUMP_MS = 420;

export type ClipboardTrayHost = Pick<
  FieldHost,
  "screenshotCapture" | "onScreenshotResult" | "screenshotStillUrl"
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

export function ClipboardTray({
  store = clipboardStore,
  host: hostProp,
  now = () => Date.now(),
}: {
  store?: ClipboardStore;
  host?: ClipboardTrayHost;
  now?: () => number;
}): ReactElement {
  const host = hostProp ?? getHost();
  const items = useClipboardItems(store);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ScreenshotCaptureResult | null>(null);
  const [bumped, setBumped] = useState(false);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const nubRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const bumpTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const setOpenState = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setFilter("");
  }, []);

  const pin = useCallback(
    (on: boolean) => {
      clearTimers();
      setPinned(on);
      setOpenState(on);
    },
    [clearTimers, setOpenState],
  );

  const onPointerEnter = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (open) return;
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpenState(true);
    }, TRAY_OPEN_DELAY_MS);
  }, [open, setOpenState]);

  const onPointerLeave = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (pinned) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpenState(false);
    }, TRAY_CLOSE_GRACE_MS);
  }, [pinned, setOpenState]);

  useEffect(() => clearTimers, [clearTimers]);

  // ⌘⇧V pins from the keyboard; Escape unpins; typing while pinned filters.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        (event.key === "v" || event.key === "V") &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        pin(!pinned);
        return;
      }
      if (!pinned) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        pin(false);
        return;
      }
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
      const from = flightStart(result.bounds, window);
      void flyToNotch({
        from,
        to: { left: to.left, top: to.top, width: to.width, height: to.height },
        imageUrl: host.screenshotStillUrl?.(result.path) ?? null,
        reducedMotion: reducedMotion(),
        host: document.body,
      }).then(land);
    },
    [bump, host, store],
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
      const url = item === undefined ? null : (host.screenshotStillUrl?.(item.path) ?? null);
      if (url === null) return;
      window.open(url, "_blank", "noopener");
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
      items={tiles}
      filter={filter}
      snap={snapFor(host, last, busy)}
      bumped={bumped}
      hint="Clipboard — hover to open, click to keep open (⌘⇧V)"
      emptyWord="nothing here yet — take a screenshot and it lands here"
      nubRef={nubRef}
      onNubClick={() => pin(!pinned)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onSnap={snap}
      onLook={look}
      onRemove={remove}
      onImageBroken={onImageBroken}
    />
  );
}
