import {
  type FrameView,
  type FrameViewState,
  FrameViewState as FrameViewStateSchema,
  frameViewBuilt,
  IPC_CHANNELS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { WebContents } from "electron";

// THE ACTIVE VIEW, per window, owned by MAIN (One Frame FR-1 — GT-D2's
// Godview bit, grown into the frame's four views and retired into them).
//
// One owner, and it is main's because main has to KNOW the view: the View menu
// marks the one it names, and the close item lends ⌘W to Godview's panes only
// while Godview is the view (`app-menu-model`). Everything that moves a view
// ASKS this owner — the views track's cells and ⌘1–⌘4 through the renderer's
// door (`ipc.ts`), the menu's items here — and draws what it answers; the page
// keeps a mirror of the last answer, never a copy of its own. There is no
// second bit to reconcile: Godview's open/closed state IS "the view is godview".
//
// ⇧⇧ RETIRED (FC-D4, ruled 2026-10-01). The double tap was detected in main from
// `before-input-event` — the reason the bit lived here at first — and is gone
// with its detector: ⌘2 opens Godview and ⌘1 leaves it, from any view, a focused
// pane included, as product chords (`app-menu-model`'s VIEW_KEYS_ROAD).
//
// Not persisted: a window opens on the canvas, the ground floor (FV-D1). It
// survives a reload because main still holds it, and `republish` tells the new
// document.

export interface ViewHostOptions {
  logger?: Logger;
  /** Called after every request with the resulting state and the window it is
   * of, so the application menu can move its mark and lend or reclaim ⌘W, and
   * that window's lights can follow its view in the same step
   * (`window-lights.ts`). */
  onChanged?: (state: FrameViewState, target: WebContents) => void;
}

/** One window's view. */
export class ViewWindowState {
  private view: FrameView = "canvas";

  constructor(
    private readonly target: WebContents,
    private readonly opts: ViewHostOptions,
  ) {}

  current(): FrameViewState {
    return { view: this.view };
  }

  /** Go to a view. A view that is not built (the Assistant, FC-D2) is refused
   * and the window stays where it is — the answer is the unchanged state. */
  set(next: FrameView): FrameViewState {
    if (!frameViewBuilt(next)) {
      this.opts.logger?.info(
        "desktop.view.refused",
        "A window was asked for a view that is not built yet",
        { webContentsId: this.target.id, view: next },
      );
    } else if (next !== this.view) {
      const from = this.view;
      this.view = next;
      this.opts.logger?.info("desktop.view.changed", "A window changed its view", {
        webContentsId: this.target.id,
        from,
        view: next,
      });
    }
    // Published even when unchanged: a request is also how a reloaded document
    // asks for the truth, and a refused one must still be answered.
    this.publish();
    this.opts.onChanged?.(this.current(), this.target);
    return this.current();
  }

  /** Re-publish to a renderer that just finished loading. A new document
   * starts on the canvas in its own head; main's view is the correction. */
  republish(): void {
    this.publish();
  }

  private publish(): void {
    if (this.target.isDestroyed()) return;
    this.target.send(IPC_CHANNELS.viewState, FrameViewStateSchema.parse(this.current()));
  }
}

/** Per-window views, born on first ask and buried with their window. */
export class ViewRegistry {
  private readonly states = new Map<number, ViewWindowState>();

  constructor(private readonly opts: ViewHostOptions) {}

  ensure(target: WebContents): ViewWindowState {
    const existing = this.states.get(target.id);
    if (existing !== undefined) return existing;
    const state = new ViewWindowState(target, this.opts);
    this.states.set(target.id, state);
    target.once("destroyed", () => {
      this.states.delete(target.id);
    });
    return state;
  }

  /** The view of a window if it has one — used by the menu, which must not
   * bring a state into being merely by drawing itself. */
  peek(target: WebContents): FrameViewState {
    return this.states.get(target.id)?.current() ?? { view: "canvas" };
  }

  dispose(): void {
    this.states.clear();
  }
}
