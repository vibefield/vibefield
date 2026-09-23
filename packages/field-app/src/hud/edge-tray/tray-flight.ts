/**
 * The fly-in (SNAP-3): a ghost of the still appears where the capture was and
 * travels to the notch, shrinking along its travel (DESIGN.md §6 M4), on the
 * island curve; the caller bumps the notch and ticks the count on arrival.
 * One element and CSS transitions (M3 — a stalled compositor still ends in
 * the end state, and the timer below is the worst case). Reduced motion (M6):
 * the ghost fades at the notch and never travels.
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

/** Where the ghost starts: the capture's bounds mapped into this window when
 * they fall inside it, else the window's centre. Bounds are screen points;
 * the window's own screen origin maps them. PURE. */
export function flightStart(
  bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  window: {
    readonly screenX: number;
    readonly screenY: number;
    readonly innerWidth: number;
    readonly innerHeight: number;
  },
): FlightRect {
  const left = bounds.x - window.screenX;
  const top = bounds.y - window.screenY;
  const inside =
    bounds.width > 0 &&
    bounds.height > 0 &&
    left + bounds.width > 0 &&
    top + bounds.height > 0 &&
    left < window.innerWidth &&
    top < window.innerHeight;
  if (inside) {
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
export function flyToNotch(options: FlightOptions): Promise<void> {
  const { from, to, host } = options;
  const ghost = host.ownerDocument.createElement("div");
  ghost.className = "vf-edge-tray__ghost";
  ghost.setAttribute("aria-hidden", "true");
  if (options.imageUrl !== null) {
    const img = host.ownerDocument.createElement("img");
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
    if (options.reducedMotion) {
      ghost.dataset.reduced = "true";
      ghost.style.left = `${toCenterX - from.width / 2}px`;
      ghost.style.top = `${toCenterY - from.height / 2}px`;
      ghost.style.width = `${from.width}px`;
      ghost.style.height = `${from.height}px`;
      host.appendChild(ghost);
      ghost.addEventListener("transitionend", finish, { once: true });
      host.ownerDocument.defaultView?.setTimeout(finish, FADE_MS + 80);
      // next frame: the fade
      requestFrame(host, () => {
        ghost.dataset.arrived = "true";
      });
      return;
    }
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    host.appendChild(ghost);
    ghost.addEventListener("transitionend", finish, { once: true });
    host.ownerDocument.defaultView?.setTimeout(finish, FLIGHT_SETTLE_MS);
    requestFrame(host, () => {
      ghost.dataset.arrived = "true";
      ghost.style.translate = `${dx}px ${dy}px`;
      ghost.style.scale = String(endScale);
    });
  });
}

function requestFrame(host: HTMLElement, fn: () => void): void {
  const view = host.ownerDocument.defaultView;
  if (view?.requestAnimationFrame !== undefined) {
    view.requestAnimationFrame(() => view.requestAnimationFrame(fn));
  } else {
    fn();
  }
}
