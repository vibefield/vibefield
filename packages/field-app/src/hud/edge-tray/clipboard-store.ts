import { SCREENSHOT_LIMITS, type ScreenshotCaptureOk } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";

/**
 * The clipboard tray's store (SNAP-3) — what the tray holds, newest first.
 * Session-only: a still lives on the OS clipboard the moment it is taken and
 * on disk only while main's ring retains it, so the store mirrors the ring's
 * cap and nothing here outlives the window. An item is the contract's own
 * capture, plus the moment it arrived.
 */
export interface ClipboardCapture {
  readonly id: string;
  readonly kind: "capture";
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly bounds: ScreenshotCaptureOk["bounds"];
  /** epoch ms, when the still arrived in the tray */
  readonly at: number;
}

export type ClipboardItem = ClipboardCapture;

/** As many as main keeps on disk — a thirteenth would have no still to show. */
export const CLIPBOARD_CAP = SCREENSHOT_LIMITS.RETAINED_STILLS;

let nextId = 0;

export class ClipboardStore {
  #items: readonly ClipboardItem[] = [];
  readonly #listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  snapshot(): readonly ClipboardItem[] {
    return this.#items;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  addCapture(ok: ScreenshotCaptureOk): ClipboardCapture {
    nextId += 1;
    const item: ClipboardCapture = {
      id: `capture-${nextId}`,
      kind: "capture",
      path: ok.path,
      width: ok.width,
      height: ok.height,
      bounds: ok.bounds,
      at: this.now(),
    };
    this.#items = [item, ...this.#items].slice(0, CLIPBOARD_CAP);
    this.emit();
    return item;
  }

  remove(id: string): void {
    const next = this.#items.filter((item) => item.id !== id);
    if (next.length === this.#items.length) return;
    this.#items = next;
    this.emit();
  }

  clear(): void {
    if (this.#items.length === 0) return;
    this.#items = [];
    this.emit();
  }

  private emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** One store per window — the tray is spine chrome, not a plugin. */
export const clipboardStore = new ClipboardStore();

export function useClipboardItems(store: ClipboardStore): readonly ClipboardItem[] {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.snapshot(),
    () => store.snapshot(),
  );
}
