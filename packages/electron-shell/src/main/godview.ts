import {
  type GodviewState,
  GodviewState as GodviewStateSchema,
  IPC_CHANNELS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { WebContents } from "electron";

// The Godview overlay's open bit, per window, owned by MAIN (GT-D2).
//
// It lives here and not in the renderer because the toggle is answered ABOVE
// the page: ⇧⇧ is detected in main from `before-input-event`, before any
// renderer or terminal pane is offered the keystroke — which is the whole
// reason it works while a pane holds focus — so main learns of every toggle
// whether it owns the bit or not. Two copies would then need reconciling, and
// the menu's checkmark would be the one that goes stale. One owner instead:
// main flips, main publishes, and the renderer's toolbar button asks for the
// same flip the gesture asks for.
//
// The bit is not persisted. Closed on every launch is the honest default (GT-2
// mounts no deck until asked, so a window nobody opens forks no bridge); GT-3's
// restore manifest is where "what was open" becomes durable.

/** The part of Electron's `before-input-event` payload this shell reads. Named
 * so the matcher below can be a pure function with a unit test, rather than a
 * shape only reachable by pressing a key on a real keyboard. */
export interface ChordInput {
  readonly type: string;
  readonly key: string;
  readonly meta: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

// DOUBLE-SHIFT (James, 2026-08-04), after ⌘⎋ was proven unreachable.
//
// ⌘⎋ was tried first and cannot be made to work by ANY mechanism: macOS eats
// Command+Escape before the application sees it. Measured, not assumed — with
// the app focused, ⌘G and a bare ⎋ both arrived at `before-input-event` and ⌘⎋
// never did, while ⇧⌘⎋ and ⌃⌘⎋ both did. The combination is the OS's, not ours.
//
// So the gesture is now a DOUBLE TAP of Shift, the one WebStorm/IntelliJ use for
// Search Everywhere. It costs no chord at all — nothing in ghostty, macOS or
// this shell binds a lone Shift — which is what finally ends the collision
// bookkeeping that ⌘G and ⌘W needed.
//
// The rules below are JetBrains' own, transcribed from
// `ModifierKeyDoubleClickHandler.Dispatcher` (platform-impl, Apache 2.0) rather
// than invented, because their timings are tuned by a decade of people typing
// capitals at speed and are the reason double-Shift feels deliberate instead of
// twitchy. Their file says so itself: "Timings ... were tuned for
// SearchEverywhere functionality (invoked on double Shift)".

/** Max gap between EACH transition of the gesture (press→release→press→release).
 * JetBrains' `handleModifier`. */
const DOUBLE_TAP_WINDOW_MS = 300;
/** A first tap older than this is stale even before the window check — their
 * outer guard in `dispatch`. */
const STALE_TAP_MS = 500;
/** A Shift arriving within this of another key is part of TYPING, not a gesture.
 * This is the guard that keeps fast capitals from opening the overlay. */
const AFTER_OTHER_KEY_MS = 100;

/** The double-tap state machine, pure so the whole gesture can be tested without
 * a keyboard. Feed it every key event; it answers true exactly once, on the
 * SECOND RELEASE of a clean double tap.
 *
 * Firing on the release rather than the press is JetBrains' choice and worth
 * keeping: it means holding Shift down after the second tap does nothing until
 * the user lets go, so Shift-dragging and Shift-clicking never trip it. */
export class DoubleShiftDetector {
  private firstPressed = false;
  private firstReleased = false;
  private secondPressed = false;
  private otherKeyWasPressed = false;
  private lastAt = 0;

  /** JetBrains resets only the three gesture flags here — `otherKeyWasPressed`
   * and the timestamp deliberately survive, because they describe what the
   * KEYBOARD just did, not where the gesture had got to. */
  reset(): void {
    this.firstPressed = false;
    this.firstReleased = false;
    this.secondPressed = false;
  }

  accept(input: ChordInput, now: number): boolean {
    if (input.key !== "Shift") {
      // Any other key ends any gesture in progress and marks the keyboard busy.
      this.lastAt = now;
      this.otherKeyWasPressed = true;
      // Escape and Tab get a HARD reset in their implementation — a zeroed
      // timestamp, so the very next Shift is treated as a fresh first tap
      // instead of being suppressed by the typing guard.
      if (input.key === "Escape" || input.key === "Tab") this.lastAt = 0;
      this.reset();
      return false;
    }
    // A Shift held WITH another modifier is someone building a chord, not
    // tapping. (Note: `input.shift` itself is not read — for the Shift key the
    // flag describes the key being pressed, not a separate held modifier.)
    if (input.meta || input.control || input.alt) {
      this.reset();
      return false;
    }
    if (this.otherKeyWasPressed && now - this.lastAt < AFTER_OTHER_KEY_MS) {
      this.reset();
      return false;
    }
    this.otherKeyWasPressed = false;
    if (this.firstPressed && now - this.lastAt > STALE_TAP_MS) this.reset();
    return this.handleShift(input, now);
  }

  private handleShift(input: ChordInput, now: number): boolean {
    if (this.firstPressed && now - this.lastAt > DOUBLE_TAP_WINDOW_MS) {
      this.reset();
      return false;
    }
    if (input.type === "keyDown") {
      if (!this.firstPressed) {
        this.reset();
        this.firstPressed = true;
        this.lastAt = now;
        return false;
      }
      if (this.firstReleased) {
        this.secondPressed = true;
        this.lastAt = now;
        return false;
      }
    } else if (input.type === "keyUp") {
      if (!this.firstReleased && this.firstPressed) {
        this.firstReleased = true;
        this.lastAt = now;
        return false;
      }
      if (this.firstPressed && this.firstReleased && this.secondPressed) {
        this.reset();
        return true;
      }
    }
    this.reset();
    return false;
  }
}

/** ⇧⇧ ABOVE THE PAGE (GT-D2's requirement, kept).
 *
 * `before-input-event` fires in MAIN before the page or any terminal inside it
 * is offered the key, which is the one property the menu accelerator was ever
 * chosen for — and a double tap could not be a menu key equivalent anyway, since
 * accelerators describe chords and this is a rhythm.
 *
 * NOTHING IS EVER SWALLOWED. Unlike the ⌘⎋ interceptor this replaces, no
 * `preventDefault` is called — not even on the firing event. Shift is a live
 * modifier the terminal needs for capitals, and eating its keyUp would leave
 * ghosttea believing Shift was still held. Letting every Shift through costs us
 * nothing: a lone Shift means nothing to a shell, so the gesture is invisible to
 * the pane it fires over. */
export function installGodviewDoubleShift(
  target: WebContents,
  toggle: () => void,
  now: () => number = Date.now,
): void {
  const detector = new DoubleShiftDetector();
  target.on("before-input-event", (_event, input) => {
    if (!detector.accept(input as ChordInput, now())) return;
    toggle();
  });
}

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
