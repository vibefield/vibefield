/**
 * The fly-in (SNAP-3): a ghost of the still appears where the capture was and
 * travels to the notch, shrinking along its travel (DESIGN.md §6 M4), on the
 * island curve; the caller bumps the notch and ticks the count on arrival.
 * One element and CSS transitions (M3 — a stalled compositor still ends in
 * the end state, and the timer below is the worst case). Reduced motion (M6):
 * the ghost fades at the notch and never travels.
 *
 * Two things the first live capture taught (2026-09-23): the result lands
 * while the helper's overlay has just left the screen and the window may not
 * be visible yet — so the flight WAITS for the document to be visible (with a
 * bound) rather than running unseen; and the end state is set after a forced
 * reflow, not on an animation frame, because a window that is occluded or
 * has not painted yet fires no frames and the ghost would be removed by the
 * settle timer before it ever moved.
 */
export interface FlightRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const FLIGHT_MS = 560;
const FLIGHT_SETTLE_MS = 640;
const FADE_MS = 160;
const GHOST_START_WIDTH = 120;
/** How long a landing waits for the window to become visible before flying anyway. */
export const FLIGHT_VISIBILITY_WAIT_MS = 1500;

/** Where the ghost starts: the capture's bounds mapped into this window when
 * they fall inside it, else the window's centre. Only the shell's normalized
 * top-left screen DIP bounds belong here; a missing mapping uses the centre.
 * The helper's native bounds must never be used as a fallback. PURE. */
export function flightStart(
  bounds:
    | {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }
    | undefined,
  window: {
    readonly screenX: number;
    readonly screenY: number;
    readonly innerWidth: number;
    readonly innerHeight: number;
  },
): FlightRect {
  const left = (bounds?.x ?? 0) - window.screenX;
  const top = (bounds?.y ?? 0) - window.screenY;
  const inside =
    bounds !== undefined &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    left + bounds.width > 0 &&
    top + bounds.height > 0 &&
    left < window.innerWidth &&
    top < window.innerHeight;
  if (inside && bounds !== undefined) {
    const scale = Math.min(1, GHOST_START_WIDTH / bounds.width);
    const width = bounds.width * scale;
    const height = bounds.height * scale;
    return {
      left: left + (bounds.width - width) / 2,
      top: top + (bounds.height - height) / 2,
      width,
      height,
    };
  }
  const width = GHOST_START_WIDTH;
  const height = (GHOST_START_WIDTH * 5) / 8;
  return {
    left: (window.innerWidth - width) / 2,
    top: (window.innerHeight - height) / 2,
    width,
    height,
  };
}

/** Resolves once the document is visible, or after `maxWaitMs` regardless. */
export function whenVisible(
  doc: Document,
  maxWaitMs: number = FLIGHT_VISIBILITY_WAIT_MS,
): Promise<void> {
  if (doc.visibilityState !== "hidden") return Promise.resolve();
  const view = doc.defaultView;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      doc.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    const onChange = (): void => {
      if (doc.visibilityState !== "hidden") finish();
    };
    doc.addEventListener("visibilitychange", onChange);
    view?.setTimeout(finish, maxWaitMs);
  });
}

export interface FlightOptions {
  readonly from: FlightRect;
  /** the notch's rect in viewport coordinates */
  readonly to: FlightRect;
  readonly imageUrl: string | null;
  readonly reducedMotion: boolean;
  /** the element the ghost is appended to (the document body in production) */
  readonly host: HTMLElement;
}

/** Runs the flight; resolves when the ghost has arrived and been removed. */
export async function flyToNotch(options: FlightOptions): Promise<void> {
  const { from, to, host } = options;
  const doc = host.ownerDocument;
  await whenVisible(doc);
  const ghost = doc.createElement("div");
  ghost.className = "vf-edge-tray__ghost";
  ghost.setAttribute("aria-hidden", "true");
  if (options.imageUrl !== null) {
    const img = doc.createElement("img");
    img.src = options.imageUrl;
    img.alt = "";
    img.draggable = false;
    ghost.appendChild(img);
  } else {
    ghost.dataset.blank = "true";
  }
  const toCenterX = to.left + to.width / 2;
  const toCenterY = to.top + to.height / 2;
  const endScale = Math.max(
    0.12,
    Math.min(to.width, to.height) / Math.max(from.width, from.height),
  );
  const dx = toCenterX - (from.left + from.width / 2);
  const dy = toCenterY - (from.top + from.height / 2);

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      ghost.remove();
      resolve();
    };
    ghost.addEventListener("transitionend", finish, { once: true });
    if (options.reducedMotion) {
      ghost.dataset.reduced = "true";
      ghost.style.left = `${toCenterX - from.width / 2}px`;
      ghost.style.top = `${toCenterY - from.height / 2}px`;
      ghost.style.width = `${from.width}px`;
      ghost.style.height = `${from.height}px`;
      host.appendChild(ghost);
      doc.defaultView?.setTimeout(finish, FADE_MS + 80);
      settle(ghost);
      ghost.dataset.arrived = "true";
      return;
    }
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    host.appendChild(ghost);
    doc.defaultView?.setTimeout(finish, FLIGHT_SETTLE_MS);
    // The start state is committed by a forced reflow, so the end state below
    // is a transition from it — no animation frame needed, and none may come.
    settle(ghost);
    ghost.dataset.arrived = "true";
    ghost.style.translate = `${dx}px ${dy}px`;
    ghost.style.scale = String(endScale);
  });
}

/** Force the element's current style to be computed and committed. */
function settle(el: HTMLElement): void {
  void el.getBoundingClientRect();
  void el.offsetWidth;
}
