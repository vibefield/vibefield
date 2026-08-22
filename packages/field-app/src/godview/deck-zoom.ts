// PANE ZOOM — animate, then commit (TP-D18, TPv3 §9.7 / §18.6; gate TP-R3).
//
// The law this module exists to keep: "fullscreen = the same canvas (CSS
// transform animation → ONE backing-store resize → ONE committed PTY resize at
// gesture end)" (§9.7). And DESIGN.md M1 says the same thing from the other
// side: "one element morphs — never unmount-and-replace."
//
// WHY NOT UPSTREAM'S ZOOM (the finding that made this file necessary):
// ghosttea 0.10.1 HAS a zoom — `ghosttea.workspace.toggle-zoom`, bound to
// ⌘⇧Enter by its own macOS default catalog (`bindings/fixtures/
// keybinds-macos-default.json:296`) — and it is implemented as
//
//   const displayedLayout = zoomedPaneId ? leaves(layout).find(…) : layout;
//   … <SplitView node={displayedLayout} … key={displayedLayout.id} />
//   (workspace/Workspace.js:513, :668)
//
// so toggling swaps the tree's ROOT from the split node to the leaf and changes
// the React key. Every pane unmounts; the zoomed one mounts again as a NEW
// surface with a new `viewId` (`TerminalSurface.js:44`), a new `<canvas>` and a
// fresh `transferControlToOffscreen`. That is a remount, not a morph: it breaks
// canvas identity (§9.7), costs a re-attach and a re-seed, and its mount-time
// measure is an extra committed resize. It also drops every OTHER pane's
// surface for the duration. So the mechanism here replaces it rather than
// wrapping it, and the deck intercepts the chord (`GodviewDeck`).
// (Second finding, recorded because it looks like a feature and is not: the
// `is-zoomed` class upstream puts on a zoomed pane is dead code at 0.10.1 —
// the only top-level `SplitView` is rendered with `zoomedPaneId: null`
// (`Workspace.js:668`), so `zoomed` is false on every pane, always.)
//
// THE SHAPE. Two phases, and the split between them is the whole point:
//
//   entering/leaving — a CSS TRANSFORM on the workspace element. A transform
//     changes no layout box, and `ResizeObserver` reports `contentRect`, the
//     LAYOUT box (`TerminalSurface.js:238-249`). So the animation produces zero
//     backing-store resizes and zero PTY resizes, by construction rather than
//     by throttling.
//   zoomed/idle — the COMMIT. One attribute write puts the pane in (or takes it
//     out of) the zoomed layout; the transform disappears in the same style
//     recalculation. Exactly one box changes, so exactly one `ResizeObserver`
//     callback fires and exactly one `runtime.resize` commits (TP-R3).
//
// WHAT THE OTHER PANES DO: nothing. They are hidden with `visibility`, which
// keeps their boxes, and their grid placement is PINNED (see `deck-zoom.css`'s
// nth-child rules) so that taking the zoomed pane out of flow cannot re-place
// them. Zero resizes anywhere but on the zoomed session — "exactly one PTY
// resize each way" is a statement about the whole deck, not just the pane.

/** Where a gesture is. `zoomed` and `idle` are rest states; the other two are
 * the animation, and both of them run with the transform armed. */
export type DeckZoomPhase = "idle" | "entering" | "zoomed" | "leaving";

/** The rect pair a gesture is computed from. Kept as a plain shape so the math
 * is testable without a layout engine — happy-dom has none. */
export interface ZoomRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A CSS transform, as the three numbers the stylesheet reads. */
export interface ZoomTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const ZOOM_IDENTITY: ZoomTransform = Object.freeze({ scale: 1, x: 0, y: 0 });

/**
 * The glide duration (DESIGN.md §6: `--vf-ease-island`, the 240ms glide).
 *
 * The island's three sanctioned durations are 600ms morph, 240ms glide and
 * 560ms flow-in. A pane rushing forward to fill the deck TRAVELS — it does not
 * change role the way a pill becomes a sheet — so it takes the glide, and the
 * commit stays prompt under a keyboard toggle a user may repeat.
 */
export const ZOOM_DURATION_MS = 240;

/** M6, non-negotiable: reduced motion halves durations. Below ~90ms a
 * transition is a snap, so this is the floor at which we stop pretending and
 * commit on the next frame. */
export const ZOOM_REDUCED_DURATION_MS = 120;

/**
 * How long after the transition should have ended we commit anyway.
 *
 * DESIGN.md M3 chooses CSS transitions over WAAPI precisely because "a stalled
 * compositor leaves WAAPI pending forever; a transition worst-case snaps to its
 * end state" — but `transitionend` is still an event that can go missing (the
 * deck is hidden mid-gesture, the property never actually changes because the
 * pane already fills the host, a compositor hiccup swallows it). The commit is
 * the half that owns correctness, so it never depends on an event arriving:
 * whichever of `transitionend` and this deadline lands first performs it, and
 * the other becomes a no-op.
 */
export const ZOOM_COMMIT_GRACE_MS = 60;

/**
 * The transform that carries `pane` onto `host`.
 *
 * Uniform scale, deliberately: a non-uniform one would exactly fill the host
 * and distort every glyph on the way there. `max` covers the host (the overflow
 * is clipped by the deck) and the pane's CENTRE is the invariant — DESIGN.md M2
 * asks that whatever the gesture is about stays where the eye left it, and for
 * a zoom the subject is the pane, not a grab point.
 *
 * Origin is the host's top-left (`transform-origin: 0 0` in the stylesheet), so
 * a point p in host-local coordinates maps to `t + k·p`, and pinning the pane's
 * centre to the host's centre gives `t = hostCentre − k·paneCentre`.
 */
export function zoomTransform(pane: ZoomRect, host: ZoomRect): ZoomTransform {
  // A pane with no area cannot be measured onto anything; the identity leaves
  // the deck exactly as it is rather than dividing by zero and moving it to NaN.
  if (pane.width <= 0 || pane.height <= 0 || host.width <= 0 || host.height <= 0) {
    return ZOOM_IDENTITY;
  }
  const scale = Math.max(host.width / pane.width, host.height / pane.height);
  const paneCentreX = pane.left - host.left + pane.width / 2;
  const paneCentreY = pane.top - host.top + pane.height / 2;
  return {
    scale,
    x: host.width / 2 - scale * paneCentreX,
    y: host.height / 2 - scale * paneCentreY,
  };
}

/**
 * The transform that carries the ZOOMED pane back onto its home rect.
 *
 * While zoomed the pane IS the host box (that is what the committed layout
 * means), so the return is the plain map from the host box to the saved home
 * rect — and because the pane is no longer in its grid cell, that saved rect is
 * the only record of where home was. Honest consequence, stated where it is
 * true: if the deck's geometry changed while a pane was zoomed (the window
 * resized, a split closed), the return animation lands on a stale rect and the
 * commit corrects it in one step. A wrong-looking last frame, never a wrong
 * layout — and never an extra resize, because the commit is one either way.
 */
export function zoomReturnTransform(home: ZoomRect, host: ZoomRect): ZoomTransform {
  if (host.width <= 0 || host.height <= 0) return ZOOM_IDENTITY;
  return {
    scale: Math.max(0, Math.min(home.width / host.width, home.height / host.height)),
    x: home.left - host.left,
    y: home.top - host.top,
  };
}

/** The phase a gesture starts in, from where it is now. `entering` and `leaving`
 * are answered by their own reversal so a double-press cannot strand a pane
 * mid-air. */
export function nextZoomPhase(current: DeckZoomPhase): DeckZoomPhase {
  return current === "idle" || current === "leaving" ? "entering" : "leaving";
}

/** True while the committed zoom LAYOUT is applied — the whole of `zoomed`, and
 * all of `leaving`, which animates out of a layout it is still in. */
export function zoomLayoutApplied(phase: DeckZoomPhase): boolean {
  return phase === "zoomed" || phase === "leaving";
}

// ── the driver ──────────────────────────────────────────────────────────────

/** What the controller needs from its surroundings. Injected rather than
 * reached for, so a test can drive a whole gesture without a layout engine, a
 * compositor or a clock. */
export interface DeckZoomHost {
  /** The deck's own wrapper — the element carrying the phase attributes. */
  host(): HTMLElement | null;
  /** The pane element to zoom, by ghosttea's own `data-pane-id`. */
  pane(paneId: string): HTMLElement | null;
  /** The workspace element the transform rides. */
  stage(): HTMLElement | null;
  /** Layout reads, as one seam: happy-dom answers zeros, and a test that wants
   * real numbers supplies them. */
  measure(element: HTMLElement): ZoomRect;
  /** M6. Read per gesture rather than cached: a user can change it mid-session. */
  reducedMotion(): boolean;
  /** Deferral for the two-frame arming dance below. */
  raf(callback: () => void): number;
  cancelRaf(handle: number): void;
  timeout(callback: () => void, ms: number): number;
  cancelTimeout(handle: number): void;
}

/** What a gesture did, published for the deck's marker and counted by TP-R3's
 * test. `commits` is the number the gate is about: one per gesture, each way. */
export interface DeckZoomState {
  readonly phase: DeckZoomPhase;
  readonly paneId: string | null;
  /** Layout commits performed since the controller was made. */
  readonly commits: number;
}

const ZOOM_PANE_ATTRIBUTE = "data-vf-zoom-pane";

/**
 * The gesture, start to finish.
 *
 * Everything it touches is an attribute or a custom property on the deck's OWN
 * wrapper, plus one marker attribute on the pane element ghosttea rendered.
 * That marker is the one place this reaches into another library's DOM, and it
 * is deliberately an attribute React never sets: React removes only the props
 * it wrote itself, so a `data-vf-zoom-pane` survives every workspace re-render,
 * where a className would be overwritten by the next one (`Workspace.js:139`
 * rebuilds the pane's className string on every render).
 */
export class DeckZoomController {
  readonly #host: DeckZoomHost;
  readonly #notify: (state: DeckZoomState) => void;
  #phase: DeckZoomPhase = "idle";
  #paneId: string | null = null;
  #home: ZoomRect | null = null;
  #commits = 0;
  #rafHandle: number | null = null;
  #timerHandle: number | null = null;
  #armed: HTMLElement | null = null;
  #onTransitionEnd: ((event: Event) => void) | null = null;

  constructor(host: DeckZoomHost, notify: (state: DeckZoomState) => void = () => undefined) {
    this.#host = host;
    this.#notify = notify;
  }

  get state(): DeckZoomState {
    return { phase: this.#phase, paneId: this.#paneId, commits: this.#commits };
  }

  /** The gesture. Zooming a different pane while one is zoomed returns the
   * first one first — two panes absolutely positioned over the same host is not
   * a state this design has, and silently swapping would cost two commits on
   * one session and none on the other. */
  toggle(paneId: string): void {
    if (this.#phase !== "idle" && this.#paneId !== null && this.#paneId !== paneId) {
      this.#leave();
      return;
    }
    if (nextZoomPhase(this.#phase) === "entering") this.#enter(paneId);
    else this.#leave();
  }

  /** Drop the zoom without animating — the deck unmounting, a pane closing
   * under the zoom, the overlay going away. Commits like any other return,
   * because the layout still has to come off. */
  reset(): void {
    this.#clearPending();
    if (zoomLayoutApplied(this.#phase)) this.#commitLayout("idle");
    else this.#setPhase("idle");
    this.#paneId = null;
    this.#home = null;
    this.#publish();
  }

  #enter(paneId: string): void {
    const host = this.#host.host();
    const pane = this.#host.pane(paneId);
    const stage = this.#host.stage();
    if (host === null || pane === null || stage === null) return;
    this.#clearPending();
    this.#paneId = paneId;
    // The home rect, saved while it is still true. Once the commit lands the
    // pane is out of its grid cell and this can never be measured again.
    this.#home = this.#host.measure(pane);
    pane.setAttribute(ZOOM_PANE_ATTRIBUTE, "");
    this.#armed = pane;
    // Armed at identity FIRST so there is a value to transition FROM. A
    // transform written in the same frame as the transition property has
    // nothing to interpolate and the browser snaps.
    this.#writeTransform(host, ZOOM_IDENTITY);
    this.#setPhase("entering");
    const target = zoomTransform(this.#home, this.#host.measure(stage));
    this.#runGesture(host, target);
  }

  #leave(): void {
    const host = this.#host.host();
    const stage = this.#host.stage();
    if (host === null || stage === null || this.#home === null) {
      this.reset();
      return;
    }
    this.#clearPending();
    this.#setPhase("leaving");
    // The pane currently occupies the host box, so the return is measured from
    // the stage, not from the pane: reading the pane here would read the box we
    // are animating away from and land the gesture on itself.
    this.#writeTransform(host, ZOOM_IDENTITY);
    this.#runGesture(host, zoomReturnTransform(this.#home, this.#host.measure(stage)));
  }

  /** Arm the transition, then commit — whichever of the two endings arrives. */
  #runGesture(host: HTMLElement, target: ZoomTransform): void {
    const reduced = this.#host.reducedMotion();
    const duration = reduced ? ZOOM_REDUCED_DURATION_MS : ZOOM_DURATION_MS;
    host.style.setProperty("--vf-zoom-duration", `${duration}ms`);
    const settle = (): void => {
      this.#clearPending();
      this.#commitLayout(this.#phase === "entering" ? "zoomed" : "idle");
      if (this.#phase === "idle") {
        this.#paneId = null;
        this.#home = null;
      }
      this.#publish();
    };
    // The commit is owned by the deadline and merely HURRIED by the event: M3's
    // "worst case snaps to its end state" is a promise about pixels, not about
    // a listener firing.
    const onEnd = (event: Event): void => {
      if ((event as TransitionEvent).propertyName !== "transform") return;
      settle();
    };
    this.#onTransitionEnd = onEnd;
    host.addEventListener("transitionend", onEnd);
    this.#timerHandle = this.#host.timeout(settle, duration + ZOOM_COMMIT_GRACE_MS);
    // Next frame: the value change the transition interpolates.
    this.#rafHandle = this.#host.raf(() => {
      this.#rafHandle = null;
      this.#writeTransform(host, target);
    });
    this.#publish();
  }

  /**
   * THE COMMIT — one write, one layout, one resize.
   *
   * Phase and layout move together on purpose. `zoomed` drops the transform and
   * `data-zoom-layout` puts the pane on the host box; the browser coalesces
   * both into one style recalculation, so the pane's box changes exactly once
   * and `ResizeObserver` delivers exactly one entry for it. Splitting these
   * into two writes would be two layouts and — because only one of them changes
   * a box — still one resize, but the invariant would then be an accident of
   * batching rather than a property of the code.
   */
  #commitLayout(phase: DeckZoomPhase): void {
    const host = this.#host.host();
    if (host === null) return;
    this.#commits += 1;
    if (phase === "idle") {
      this.#armed?.removeAttribute(ZOOM_PANE_ATTRIBUTE);
      this.#armed = null;
      host.removeAttribute("data-zoom-layout");
    } else {
      host.setAttribute("data-zoom-layout", "pane");
    }
    // A REST STATE CARRIES NO TRANSFORM. The stylesheet only reads these while
    // a gesture is in flight, so a stale scale left here would be inert — and
    // that is exactly why it must be cleared: the next reader of this element
    // (a devtools pane, a future rule, the leave gesture arming itself) would
    // find a number describing a morph that finished, and the committed state
    // is the true box or it is nothing.
    this.#writeTransform(host, ZOOM_IDENTITY);
    this.#setPhase(phase);
  }

  #writeTransform(host: HTMLElement, transform: ZoomTransform): void {
    host.style.setProperty("--vf-zoom-scale", `${transform.scale}`);
    host.style.setProperty("--vf-zoom-x", `${transform.x}px`);
    host.style.setProperty("--vf-zoom-y", `${transform.y}px`);
  }

  #setPhase(phase: DeckZoomPhase): void {
    this.#phase = phase;
    this.#host.host()?.setAttribute("data-zoom-phase", phase);
  }

  #clearPending(): void {
    if (this.#rafHandle !== null) {
      this.#host.cancelRaf(this.#rafHandle);
      this.#rafHandle = null;
    }
    if (this.#timerHandle !== null) {
      this.#host.cancelTimeout(this.#timerHandle);
      this.#timerHandle = null;
    }
    const host = this.#host.host();
    if (host !== null && this.#onTransitionEnd !== null) {
      host.removeEventListener("transitionend", this.#onTransitionEnd);
    }
    this.#onTransitionEnd = null;
  }

  #publish(): void {
    this.#notify(this.state);
  }
}

/** The controller's surroundings, wired to a real document. Split from the
 * class so the class needs no globals and a test needs no compositor. */
export function browserZoomHost(
  hostRef: () => HTMLElement | null,
  stageSelector = ".ghostty-window",
): DeckZoomHost {
  return {
    host: hostRef,
    stage: () => hostRef()?.querySelector<HTMLElement>(stageSelector) ?? null,
    pane: (paneId) =>
      hostRef()?.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(paneId)}"]`) ?? null,
    measure: (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    },
    reducedMotion: () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    raf: (callback) => window.requestAnimationFrame(callback),
    cancelRaf: (handle) => window.cancelAnimationFrame(handle),
    timeout: (callback, ms) => window.setTimeout(callback, ms),
    cancelTimeout: (handle) => window.clearTimeout(handle),
  };
}
