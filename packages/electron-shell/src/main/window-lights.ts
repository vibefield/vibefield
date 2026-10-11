import type {
  FrameView,
  GodviewDeckState,
  WindowLights,
  WindowLightsState,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { WebContents } from "electron";
import { isSmokeLike, type ShellMode } from "./modes";

// THE WINDOW'S LIGHTS, per window, owned by MAIN (Godview round 3, GV-D11).
//
// macOS's close · minimize · zoom are the system's to draw and main's to place.
// A window is built with them on the head's axis (`windows.ts`); while Godview's
// deck is MAXIMIZED its 30 px bar is the window's title bar, and they sit on
// that bar's axis instead (DESIGN.md §8, "Maximized — the bar is the window's
// title bar").
//
// The page never sends a position. It says its deck's state BY NAME through the
// deck door (`ipc.ts`), and this owner composes that word with the view main
// already owns (`view.ts`): the lights are on the bar ONLY while the window's
// view is Godview AND its deck says maximized. Because the composition is
// main's, a change of view puts them back inside the view owner's own step —
// ⌘1 from a maximized deck needs no round trip to the page.
//
// The same word is ⌘W's second fact (`app-menu-model`'s `closeWindowItem`): a
// deck that is away has no pane to lend the chord to. That half holds on every
// platform, so the word is kept even where there are no lights to move.
//
// Electron appears as TYPES only (the `window-policy.ts` rule): tests drive this
// with structural fakes, and `index.ts` hands in the real windows.

/** Where a window is built with its lights, and where they return: the head's
 * axis (y 28 for the 12 px lights). `windows.ts` constructs with this. */
export const HEAD_LIGHTS = { x: 18, y: 22 } as const;

/** On the maximized deck's 30 px bar: its centre, y 15. */
export const BAR_LIGHTS = { x: 12, y: 9 } as const;

const POSITIONS = { head: HEAD_LIGHTS, bar: BAR_LIGHTS } as const;

/** Whether a window of this shell carries inset lights at all: a Mac, outside
 * the harness modes — whose windows keep the default title bar, where the
 * lights are the system's and nothing here may move them. One answer for the
 * factory that builds the window and the owner that moves its lights. */
export function hasInsetLights(platform: NodeJS.Platform, mode: ShellMode): boolean {
  return platform === "darwin" && !isSmokeLike(mode);
}

/** The slice of a BrowserWindow the lights need. */
export interface LightsWindow {
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  setWindowButtonPosition(position: { x: number; y: number } | null): void;
  on(event: "enter-full-screen", listener: () => void): unknown;
  on(event: "leave-full-screen", listener: () => void): unknown;
}

export interface LightsHostOptions {
  /** {@link hasInsetLights} for this shell's windows. False makes every move a
   * no-op the answer names (`lights: "none"`); the deck's word is still held. */
  inset: boolean;
  /** The window's view, from its one owner (`ViewRegistry.peek`). */
  view: (target: WebContents) => FrameView;
  /** The native window behind a page, or null when it is gone. */
  windowOf: (target: WebContents) => LightsWindow | null;
  logger?: Logger;
  /** Called whenever the deck's word changes, with the resulting state and the
   * window it is of, so the application menu can lend or reclaim ⌘W. */
  onChanged?: (state: WindowLightsState, target: WebContents) => void;
}

/** The slice of a WebContents this owner listens to (`bootstrap.ts`'s shape:
 * the positional arguments are the ones Electron 43 still delivers). */
interface DocumentEvents {
  on(
    event: "did-start-navigation",
    listener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
  ): unknown;
}

/** One window's deck word, and the lights that follow it. */
export class LightsWindowState {
  private deck: GodviewDeckState | null = null;
  /** Where the lights were last PUT. A window is built with them on the head. */
  private applied: "head" | "bar" = "head";
  /** Tracked from the window's own events, not asked each time: Electron's
   * typings warn that `isFullScreen()` is not to be trusted across a macOS
   * transition until one of the two events has been emitted. */
  private fullScreen = false;

  constructor(
    private readonly target: WebContents,
    private readonly opts: LightsHostOptions,
  ) {
    // The page owns the word, so it dies with the document that said it: a
    // reloaded page (DK-9, a users switch) has said nothing yet and may never
    // mount a deck. Same test as bootstrap's generation boundary.
    (target as unknown as DocumentEvents).on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) this.say(null);
      },
    );
    if (!opts.inset) return;
    const window = opts.windowOf(target);
    if (window === null || window.isDestroyed()) return;
    this.fullScreen = window.isFullScreen();
    window.on("enter-full-screen", () => {
      this.fullScreen = true;
    });
    // NATIVE FULL SCREEN. The system owns the title bar there, so nothing is
    // moved inside it (`apply`); on the way out the position is set again even
    // when nothing changed. What Electron 43.1.1 itself does to a custom
    // position across full screen is NOT established — its typings say only
    // "Set a custom position for the traffic light buttons in frameless
    // window" — so the re-apply does not rest on either answer.
    window.on("leave-full-screen", () => {
      this.fullScreen = false;
      this.apply(true);
    });
  }

  current(): WindowLightsState {
    return { deck: this.deck, lights: this.opts.inset ? this.place() : "none" };
  }

  /** The page's word: its deck's state by name, or null for none. Answered
   * with what main holds now, moved or not. */
  say(deck: GodviewDeckState | null): WindowLightsState {
    if (deck !== this.deck) {
      const from = this.deck;
      this.deck = deck;
      this.opts.logger?.info("desktop.window.deck_changed", "A window's page said its deck", {
        webContentsId: this.target.id,
        from: from ?? "none",
        deck: deck ?? "none",
      });
      this.apply(false);
      this.opts.onChanged?.(this.current(), this.target);
    }
    return this.current();
  }

  /** Main's view of this window changed (or was asked for again): recompose. */
  viewChanged(): void {
    this.apply(false);
  }

  /** The composition, and the whole of it. */
  private place(): Exclude<WindowLights, "none"> {
    return this.opts.view(this.target) === "godview" && this.deck === "maximized" ? "bar" : "head";
  }

  private apply(afterFullScreen: boolean): void {
    if (!this.opts.inset || this.fullScreen) return;
    const place = this.place();
    if (!afterFullScreen && place === this.applied) return;
    const window = this.opts.windowOf(this.target);
    if (window === null || window.isDestroyed()) return;
    window.setWindowButtonPosition({ ...POSITIONS[place] });
    this.applied = place;
    this.opts.logger?.info("desktop.window.lights_moved", "A window's lights were placed", {
      webContentsId: this.target.id,
      lights: place,
      deck: this.deck ?? "none",
      afterFullScreen,
    });
  }
}

/** Per-window lights, born when a window's page first speaks and buried with
 * the window. */
export class LightsRegistry {
  private readonly states = new Map<number, LightsWindowState>();

  constructor(private readonly opts: LightsHostOptions) {}

  ensure(target: WebContents): LightsWindowState {
    const existing = this.states.get(target.id);
    if (existing !== undefined) return existing;
    const state = new LightsWindowState(target, this.opts);
    this.states.set(target.id, state);
    target.once("destroyed", () => {
      this.states.delete(target.id);
    });
    return state;
  }

  /** What main holds for a window, if anything — used by the menu and by a
   * view change, neither of which may bring a state into being: a window whose
   * page never spoke is still where it was built. */
  peek(target: WebContents): WindowLightsState {
    return (
      this.states.get(target.id)?.current() ?? {
        deck: null,
        lights: this.opts.inset ? "head" : "none",
      }
    );
  }

  /** The view owner's step (`ViewHostOptions.onChanged`): that window's lights
   * follow its view now, with no word from the page. */
  viewChanged(target: WebContents): void {
    this.states.get(target.id)?.viewChanged();
  }

  dispose(): void {
    this.states.clear();
  }
}
