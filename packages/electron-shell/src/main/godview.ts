import {
  type GodviewState,
  GodviewState as GodviewStateSchema,
  IPC_CHANNELS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { WebContents } from "electron";

// The Godview overlay's open bit, per window, owned by MAIN (GT-D2).
//
// It lives here and not in the renderer because the toggle is an application
// accelerator: the menu consumes ⌘G before any renderer is offered the
// keystroke — which is the whole reason it works while a terminal pane holds
// focus — so main learns of every toggle whether it owns the bit or not. Two
// copies would then need reconciling, and the menu's checkmark would be the one
// that goes stale. One owner instead: main flips, main publishes, and the
// renderer's toolbar button asks for the same flip the accelerator asks for.
//
// The bit is not persisted. Closed on every launch is the honest default (GT-2
// mounts no deck until asked, so a window nobody opens forks no bridge); GT-3's
// restore manifest is where "what was open" becomes durable.

export interface GodviewHostOptions {
  logger?: Logger;
  /** Called after every change with the resulting state, so the application
   * menu can redraw its checkmark and release or reclaim ⌘W. */
  onChanged?: (state: GodviewState) => void;
}

/** One window's overlay state. */
export class GodviewWindowState {
  private open = false;

  constructor(
    private readonly target: WebContents,
    private readonly opts: GodviewHostOptions,
  ) {}

  current(): GodviewState {
    return { open: this.open };
  }

  /** Apply a transition. `next` omitted means flip — the toolbar button and the
   * accelerator both send that, so neither carries its own stale copy of the
   * value it is about to change. */
  set(next?: boolean): GodviewState {
    const open = next ?? !this.open;
    if (open !== this.open) {
      this.open = open;
      this.opts.logger?.info(
        "desktop.godview.toggled",
        "The Godview overlay was opened or closed for a window",
        { webContentsId: this.target.id, open },
      );
    }
    // Published even when unchanged: an explicit set is also how a reloaded
    // document asks for the truth, and a document that just loaded has no idea
    // what main believes.
    this.publish();
    this.opts.onChanged?.(this.current());
    return this.current();
  }

  /** Re-publish to a renderer that just finished loading. A new document starts
   * with the overlay closed in its own head; main's bit is the correction. */
  republish(): void {
    this.publish();
  }

  private publish(): void {
    if (this.target.isDestroyed()) return;
    this.target.send(IPC_CHANNELS.godviewState, GodviewStateSchema.parse(this.current()));
  }
}

/** Per-window states, born on first ask and buried with their window. */
export class GodviewRegistry {
  private readonly states = new Map<number, GodviewWindowState>();

  constructor(private readonly opts: GodviewHostOptions) {}

  ensure(target: WebContents): GodviewWindowState {
    const existing = this.states.get(target.id);
    if (existing !== undefined) return existing;
    const state = new GodviewWindowState(target, this.opts);
    this.states.set(target.id, state);
    target.once("destroyed", () => {
      this.states.delete(target.id);
    });
    return state;
  }

  /** The state of a window if it has one — used by the menu, which must not
   * bring a state into being merely by drawing itself. */
  peek(target: WebContents): GodviewState {
    return this.states.get(target.id)?.current() ?? { open: false };
  }

  dispose(): void {
    this.states.clear();
  }
}
