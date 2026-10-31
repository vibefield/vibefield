/**
 * Track FG, FG-4b — the Setup Assistant's frame, observed for a row (wizard-ui.tsx's `PaneSwap` watches its own
 * children). The observers stay real, and the frame's are also recorded, so a row can deliver a swap as a live observer
 * would: happy-dom (20.11) hands each observed node its report through a WeakRef nothing else holds, so a collection
 * mid-file can silence an observer (godview-deck-frames' palette row, 2026-09-30). The frame settles once on whatever
 * it is told, so a second delivery is nothing. A row that calls `observeFrames` unstubs the globals after it.
 */
import { act } from "react";
import { vi } from "vitest";

/** What a frame asked to watch. */
export interface FrameWatch {
  readonly target: Element;
  readonly options: MutationObserverInit | undefined;
}

export interface FrameObservers {
  /** Every frame observed since the call, in order. */
  readonly watches: () => readonly FrameWatch[];
  /** Tell each frame its children changed, inside act, as its observer's microtask would. */
  readonly hear: () => void;
}

interface Frame {
  readonly observer: MutationObserver;
  readonly callback: MutationCallback;
  readonly watch: FrameWatch;
}

export function observeFrames(): FrameObservers {
  const Real = globalThis.MutationObserver;
  const frames: Frame[] = [];
  class RecordingObserver extends Real {
    readonly #callback: MutationCallback;
    constructor(callback: MutationCallback) {
      super(callback);
      this.#callback = callback;
    }
    override observe(target: Node, options?: MutationObserverInit): void {
      super.observe(target, options);
      if (target instanceof Element && target.classList.contains("vf-wizard-frame")) {
        frames.push({ observer: this, callback: this.#callback, watch: { target, options } });
      }
    }
  }
  vi.stubGlobal("MutationObserver", RecordingObserver);
  return {
    watches: () => frames.map(({ watch }) => watch),
    hear: () => {
      act(() => {
        for (const { observer, callback } of frames) callback([], observer);
      });
    },
  };
}
