// THE PORTAL (track ES, ES-3b; ES-D3 A and ES-D5 A, ruled by James on the ES page, 2026-11-08 04:27:25Z; DESIGN.md §6
// "The night, at rest, under the pointer, and through the portal", the portal) — its numbers, its geometry and its
// motion. Opened from Chat's empty night, the New spark sheet's sky is that night's own canvas, lent (the kit's
// `lendNight`): panel-sized at the panel's place, over the sheet's glass, its first frame drawn at the night's own
// moment. Its edge closes onto the sky's place while the glass grows from clear around it and the sheet's form comes
// in; Cancel opens it back and hands the night back at the window's moment; Create takes the sheet and its window away
// as one. The motion runs on the elements' own animations (Web Animations), the named curves read from the tokens.

/** §6's numbers, in ms. */
export const PORTAL_MS = {
  /** the night's edge closes from the panel's place onto the sky's, on the island curve */
  close: 600,
  /** Chat's words fade and recede to 0.98, on the retract curve (`chat-empty.css`) */
  wordsLeave: 180,
  /** the sheet's name, agent and foot come in from 45% of the close, over 330 on the island curve */
  formAt: 270,
  form: 330,
  /** Cancel, Esc or the dim: the window opens back, on the retract curve */
  back: 240,
  /** the face shrinks back into the night: the face engine's own leave */
  faceLeave: 450,
  /** the words return 300 into the return, over 240 on the island curve (`chat-empty.css`) */
  wordsBackAt: 300,
  wordsBack: 240,
  /** Create: the sheet and its window leave as one, down 16 at 0.97, on the retract curve */
  leave: 240,
  /** reduced motion (M6): the night fades out, then the sheet fades in with its window */
  reducedOut: 150,
  /** reduced motion: Cancel, the same backwards */
  reducedBack: 120,
  /** ES-3c: drawn, the window comes in over the night on the retract curve as the words leave, so their fade shows
   * through it */
  windowIn: 180,
  /** ES-3c: whole, it has Chat's night fade out under it on the same curve, `windowIn` in (`spark-face.css`) */
  nightOut: 180,
} as const;

/** The panel's corners, and the sky's (§8 "The New spark sheet"). */
export const PANEL_RADIUS = 22;
export const SKY_RADIUS = 30;

/** A place in px. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function boxOf(rect: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}): Box {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** The clip that shows `inner` of a layer standing at `outer`, its corners `radius`. */
export function insetOf(inner: Box, outer: Box, radius: number): string {
  const top = inner.y - outer.y;
  const left = inner.x - outer.x;
  const right = outer.x + outer.w - (inner.x + inner.w);
  const bottom = outer.y + outer.h - (inner.y + inner.h);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

/** Where the portal stands: drawing the window's first frame, closing onto the sky, closed (open, as a sheet), folding
 * back for Cancel, or leaving with the sheet for Create. */
export type PortalPhase = "drawing" | "closing" | "open" | "folding" | "leaving";

/** What the portal's motion moves: the window (the lent night) and the glass growing around it. */
export interface PortalParts {
  readonly window: HTMLElement;
  readonly glass: HTMLElement;
}

/** Where the motion goes, in the sheet's layer's own pixels. */
export interface PortalPlaces {
  /** the night's place: the window stands here, and the glass grows from here */
  readonly panel: Box;
  /** the sky's place in the sheet: the window closes onto it */
  readonly sky: Box;
  /** the sheet's own box: the glass grows to it */
  readonly sheet: Box;
  /** the night's edge as it stood (at rest, or leaning) */
  readonly clip: string;
}

/** The retract curve (§6's "one more plain curve"), and the island curve read from its token. */
const RETRACT = "cubic-bezier(0.4, 0, 1, 1)";
function island(from: Element): string {
  const token = getComputedStyle(from).getPropertyValue("--vf-ease-island").trim();
  return token === "" ? "ease-out" : token;
}

const CLEAR_GLASS: Keyframe = {
  backgroundColor: "transparent",
  backdropFilter: "blur(0px) saturate(1)",
  boxShadow: "0 0 0 1px transparent",
};

/** The glass at a box, in the layer's pixels, its corners `radius`. */
function glassAt(box: Box, radius: number): Keyframe {
  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    borderRadius: `${radius}px`,
  };
}

/** The sheet's own corners (§8): the glass grown around the window wears them. */
const SHEET_RADIUS = 40;

/** The glass stands at the sheet's box: as the close sets it, and again whenever what the sheet reads grows it. */
export function placeGlass(glass: HTMLElement, sheet: Box): void {
  Object.assign(glass.style, glassAt(sheet, SHEET_RADIUS));
}

/** The window's clip as the night's edge stood, or the panel's own edge when it stood at none. */
export function startClipOf(places: PortalPlaces): string {
  const clip = places.clip.trim();
  return clip === "" || clip === "none" ? insetOf(places.panel, places.panel, PANEL_RADIUS) : clip;
}

/** A phase's motion as it runs (ES-3d): finished once its own animations have, and stopped where it has come to. */
export interface PortalMotion {
  /** resolves once the phase's animations have finished, or, where nothing animates, once the phase's own time has
   * passed; never once it is stopped */
  readonly finished: Promise<void>;
  /** stop it where it has come to: its styles kept, so the next phase moves on from there */
  stop(): void;
}

/** A phase's own time: its motion's length, and the bound where nothing animates (no Web Animations, tests). */
export function phaseMsOf(phase: PortalPhase, reduced: boolean): number {
  switch (phase) {
    case "closing":
      return reduced ? PORTAL_MS.reducedOut * 2 : PORTAL_MS.close;
    case "folding":
      return reduced ? PORTAL_MS.reducedBack : PORTAL_MS.back;
    case "leaving":
      return reduced ? PORTAL_MS.reducedBack : PORTAL_MS.leave;
    default:
      return 0;
  }
}

/** Run one phase's motion on the parts. A Cancel mid-close opens back from wherever the edge had come to. ES-3d: what
 * follows a phase follows its motion's own finish, never a clock beside it (§6: the night comes back "once Cancel, Esc
 * or the dim has opened it again"), for the motion rides frames and a clock does not. */
export function movePortal(
  phase: PortalPhase,
  parts: PortalParts,
  places: PortalPlaces,
  reduced: boolean,
): PortalMotion {
  const running: Animation[] = [];
  const run = (element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    if (typeof element.animate !== "function") return;
    running.push(element.animate(frames, { fill: "both", ...options }));
  };
  const sky = insetOf(places.sky, places.panel, SKY_RADIUS);
  const rest = insetOf(places.panel, places.panel, PANEL_RADIUS);
  const ease = island(parts.window);
  switch (phase) {
    case "drawing":
      // nothing of the sheet shows until the window has drawn (ES-3c): it draws its first frame unseen
      parts.window.style.clipPath = reduced ? sky : startClipOf(places);
      parts.window.style.opacity = "0";
      Object.assign(parts.glass.style, glassAt(places.panel, PANEL_RADIUS));
      break;
    case "closing":
      // where they come to stands as their own styles, and each moves from its start to them: the glass follows the
      // sheet as its reads come in and grow it (`placeGlass`)
      parts.window.style.clipPath = sky;
      placeGlass(parts.glass, places.sheet);
      if (reduced) {
        // M6: the night fades out (`chat-empty.css`), then the sheet fades in with its window
        for (const part of [parts.window, parts.glass])
          run(part, [{ opacity: 0 }, { opacity: 1 }], {
            duration: PORTAL_MS.reducedOut,
            delay: PORTAL_MS.reducedOut,
            easing: "ease",
          });
        break;
      }
      // ES-3c: it comes in over the night as the words leave, so their fade shows through it
      run(parts.window, [{ opacity: 0 }, { opacity: 1 }], {
        duration: PORTAL_MS.windowIn,
        easing: RETRACT,
      });
      run(parts.window, [{ clipPath: startClipOf(places), offset: 0 }], {
        duration: PORTAL_MS.close,
        easing: ease,
      });
      run(parts.glass, [{ ...glassAt(places.panel, PANEL_RADIUS), ...CLEAR_GLASS, offset: 0 }], {
        duration: PORTAL_MS.close,
        easing: ease,
      });
      break;
    case "open":
      parts.window.style.clipPath = sky;
      for (const part of [parts.window, parts.glass]) part.style.removeProperty("opacity");
      placeGlass(parts.glass, places.sheet);
      break;
    case "folding":
      // from wherever the close had come to, back to the panel's own edge at rest: the pointer has left New spark, so
      // the night it is handed to is at rest
      if (reduced) {
        for (const part of [parts.window, parts.glass])
          run(part, [{ opacity: 0 }], { duration: PORTAL_MS.reducedBack, easing: "ease" });
        break;
      }
      run(parts.window, [{ clipPath: rest }], { duration: PORTAL_MS.back, easing: RETRACT });
      run(parts.glass, [{ ...glassAt(places.panel, PANEL_RADIUS), ...CLEAR_GLASS }], {
        duration: PORTAL_MS.back,
        easing: RETRACT,
      });
      break;
    case "leaving": {
      // Create: the sheet and its window leave as one, down 16 at 0.97, about the sheet's own centre
      const leave: Keyframe[] = [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(16px) scale(0.97)" },
      ];
      const about = (box: Box): string =>
        `${places.sheet.x + places.sheet.w / 2 - box.x}px ${places.sheet.y + places.sheet.h / 2 - box.y}px`;
      parts.window.style.transformOrigin = about(places.panel);
      parts.glass.style.transformOrigin = about(places.sheet);
      for (const part of [parts.window, parts.glass])
        run(part, leave, {
          duration: reduced ? PORTAL_MS.reducedBack : PORTAL_MS.leave,
          easing: RETRACT,
        });
      break;
    }
  }
  let stopped = false;
  let bound = 0;
  const finished = new Promise<void>((done) => {
    const end = (): void => {
      if (!stopped) done();
    };
    if (running.length === 0) {
      bound = window.setTimeout(end, phaseMsOf(phase, reduced));
      return;
    }
    // a stopped animation's finish rejects (it was cancelled): nothing follows it
    Promise.all(running.map((animation) => animation.finished)).then(end, () => undefined);
  });
  return {
    finished,
    stop: () => {
      stopped = true;
      window.clearTimeout(bound);
      for (const animation of running) {
        // keep where it had come to; a part no longer drawn keeps nothing
        try {
          animation.commitStyles();
        } catch {
          // not drawn: nothing to keep
        }
        animation.cancel();
      }
    },
  };
}
