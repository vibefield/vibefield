import {
  createContext,
  type RefObject,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import type { FieldDoor } from "./splash/field-door";
import {
  type GlassPose,
  type GlassState,
  readGlassLook,
  readGlassPose,
  samePose,
} from "./splash/glass-look";
import type { MarkBox } from "./splash/glass-pass";

// The field's hold on the Setup Assistant's glass (track FG, FG-3b; FG-D24; DESIGN.md §8 "The Setup Assistant's
// glass"): the glass standing on the live field hands the field its look and where it stands, and the field says
// whether it draws it, so the browser stands its own frost down. FieldLayer keeps one for its field and hands it to
// what stands on the field; wizard-ui.tsx's glass follows it (`useFieldGlass`). Off the field, or with nothing under
// it but the field's still, the browser draws the whole glass, as it did before FG-3b. FG-6's frozen frame holds the
// glass off the field for a harness (`hold`), so the browser draws it over the same field; since its follow-up 3 the
// browser's logo wears the field's mark there, as the held frame holds it (§8: "one living mark, the field's own").

/** The field's mark as the held frame holds it (FG-6's follow-up 3): its picture's URL, and its box in CSS px of the
 * field's box. */
export interface HeldMark {
  readonly url: string;
  readonly box: MarkBox;
}

/** The glass's side of the hold. */
export interface FieldGlass {
  /** What the field is to draw, or null for none: kept, and handed on to the field's door once it opens. */
  set(glass: GlassState | null): void;
  /** The field's box on the page, which a pose is measured from; null while nothing holds it. */
  box(): DOMRectReadOnly | null;
  /** Whether the field draws the glass, for `useSyncExternalStore`. */
  drawn(): boolean;
  /** Whether the field is its still picture (FG-4b: the logo then takes the still's own mark size). */
  still(): boolean;
  /** The field's mark as the held frame holds it, while the glass is held off the field (FG-6's follow-up 3): the
   * browser's logo wears it there, so its glass and the field's are one frame. Null otherwise. */
  heldMark(): HeldMark | null;
  subscribe(listener: () => void): () => void;
}

/** The field's door as the hold reaches it (field-door.ts's `FieldDoor`). */
export type FieldGlassDoor = Pick<FieldDoor, "glass" | "markPicture">;

/** FieldLayer's side: the field's door as it opens and goes, and what the door says. */
export interface FieldGlassHost extends FieldGlass {
  /** The open door, handed what is kept; null once it is gone, and the field draws nothing. A door that goes takes
   * the mark it pictured with it. */
  attach(door: FieldGlassDoor | null): void;
  /** The door says whether the field draws the glass. */
  report(drawn: boolean): void;
  /** The field became its still, or never was. */
  stillness(still: boolean): void;
  /** While `off`, the glass is held off the field (FG-6's frozen frame): the door is handed none, so the field draws
   * none and the browser draws the whole glass, and what the glass sets meanwhile is kept for the door once it lets
   * go. As it begins the door pictures the field's mark, held while it lasts and let go with it (its follow-up 3). */
  hold(off: boolean): void;
}

export function createFieldGlass(field: () => Element | null): FieldGlassHost {
  let door: FieldGlassDoor | null = null;
  let kept: GlassState | null = null;
  let off = false;
  let drawn = false;
  let still = false;
  let held: HeldMark | null = null;
  // each hold's ask for the field's mark, so a picture that comes after its hold was let go, or its door went, is
  // dropped
  let asked = 0;
  const hand = (): void => door?.glass(off ? null : kept);
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of listeners) listener();
  };
  const say = (next: boolean): void => {
    if (next === drawn) return;
    drawn = next;
    tell();
  };
  const picture = (): void => {
    const ask = ++asked;
    void door?.markPicture().then((mark) => {
      if (ask !== asked || mark === null) return;
      held = { url: URL.createObjectURL(mark.png), box: mark.box };
      tell();
    });
  };
  const letGo = (): void => {
    asked++;
    if (held === null) return;
    URL.revokeObjectURL(held.url);
    held = null;
    tell();
  };
  return {
    set(glass) {
      kept = glass;
      hand();
    },
    box: () => field()?.getBoundingClientRect() ?? null,
    drawn: () => drawn,
    still: () => still,
    heldMark: () => held,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attach(next) {
      letGo();
      door = next;
      if (next === null) say(false);
      else hand();
    },
    report(next) {
      // a door already gone says nothing the field still draws
      if (door !== null || !next) say(next);
    },
    stillness(next) {
      if (next === still) return;
      still = next;
      tell();
    },
    hold(next) {
      if (next === off) return;
      off = next;
      hand();
      if (off) picture();
      else letGo();
    },
  };
}

export const FieldGlassContext = createContext<FieldGlass | null>(null);

const alone = (): (() => void) => () => {};

/** The glass's own animations still running: its forming, the logo's fades (on the glass, `--vf-glass-logo`), and its
 * clearing at the hand-over (FG-5). */
function forming(glass: Element): boolean {
  return (
    typeof glass.getAnimations === "function" &&
    glass.getAnimations().some((animation) => animation.playState === "running")
  );
}

/** Where the logo wears the field's held mark (FG-6's follow-up 3), in the logo's own px (`scale` of the page's px to
 * one of them, its glass's fit): how far the logo moves from its box on the page (`logo`) to stand on the mark's
 * corner, the mark's `box` in CSS px of the `field`'s, and the mark's size there. */
export function markDress(
  box: MarkBox,
  field: Pick<DOMRectReadOnly, "left" | "top">,
  logo: Pick<DOMRectReadOnly, "left" | "top">,
  scale: number,
): MarkBox {
  return {
    x: (field.left + box.x - logo.left) / scale,
    y: (field.top + box.y - logo.top) / scale,
    width: box.width / scale,
    height: box.height / scale,
  };
}

/** The inline dress the logo wears the field's held mark in, the stylesheet's own beneath it. */
const DRESS = ["background-image", "background-size", "background-position", "translate"] as const;

function undress(logo: HTMLElement): void {
  for (const name of DRESS) logo.style.removeProperty(name);
  logo.removeAttribute("data-mark");
}

/** The logo in the field's held mark: its picture at the mark's own spot and size on the page, the logo moved onto
 * the mark's corner so the picture lands on the field's own px. Its filter and its fade stay the stylesheet's, as the
 * field's pass draws them on the field's glass. */
function wear(logo: HTMLElement, mark: HeldMark, field: DOMRectReadOnly, scale: number): void {
  const at = markDress(mark.box, field, logo.getBoundingClientRect(), scale);
  logo.style.setProperty("background-image", `url("${mark.url}")`);
  logo.style.setProperty("background-size", `${at.width}px ${at.height}px`);
  logo.style.setProperty("background-position", "0px 0px");
  logo.style.setProperty("translate", `${at.x}px ${at.y}px`);
  logo.setAttribute("data-mark", "field");
}

/** The Setup Assistant's glass drawn by the field it stands on (FG-3b). While `on`, it hands the field its look, read
 * off its layers and again whenever the theme turns, and its pose, read every frame it moves: through its forming
 * (the frost, the edge and the rise), through the logo's fades (FG-4b), through its clearing at the hand-over (FG-5),
 * and through a window's resize (the fit) until it has rested two frames. True while the field draws it, so the
 * browser draws only the edge. While the glass is held off the field, its logo wears the field's held mark (FG-6's
 * follow-up 3). */
export function useFieldGlass(
  glassRef: RefObject<HTMLElement | null>,
  shadowRef: RefObject<Element | null>,
  frostRef: RefObject<Element | null>,
  logoRef: RefObject<HTMLElement | null>,
  on: boolean,
): boolean {
  const field = useContext(FieldGlassContext);
  useLayoutEffect(() => {
    const glass = glassRef.current;
    const shadow = shadowRef.current;
    const frost = frostRef.current;
    const logo = logoRef.current;
    if (
      field === null ||
      !on ||
      glass === null ||
      shadow === null ||
      frost === null ||
      logo === null
    )
      return;
    const layers = { glass, shadow, frost, logo };
    let look = readGlassLook(layers);
    let pose: GlassPose | null = null;
    let raf = 0;
    let rested = 0;
    const send = (): void => field.set(look === null || pose === null ? null : { look, pose });
    const follow = (): void => {
      raf = 0;
      const box = field.box();
      if (box === null) return;
      const next = readGlassPose(glass, box);
      if (pose === null || !samePose(pose, next)) {
        pose = next;
        rested = 0;
        send();
      } else rested++;
      if (rested < 2 || forming(glass)) raf = requestAnimationFrame(follow);
    };
    const wake = (): void => {
      rested = 0;
      if (raf === 0) raf = requestAnimationFrame(follow);
    };
    // the logo fades on the glass itself, long after the forming has rested, and the glass clears there at the end
    const moved = (event: Event): void => {
      if (event.target === glass) wake();
    };
    // the tint is the theme's: `.dark` and `data-theme` on the root (theme.ts)
    const themed = new MutationObserver(() => {
      look = readGlassLook(layers);
      send();
    });
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    // the field's held mark, dressed once for each mark held, and taken off with it or with the glass
    let worn: HeldMark | null = null;
    const dress = (): void => {
      const mark = field.heldMark();
      if (mark === worn) return;
      worn = mark;
      undress(logo);
      const box = field.box();
      if (mark !== null && box !== null) wear(logo, mark, box, readGlassPose(glass, box).fit);
    };
    const unheld = field.subscribe(dress);
    window.addEventListener("resize", wake);
    glass.addEventListener("transitionrun", moved);
    glass.addEventListener("animationstart", moved);
    follow();
    dress();
    return () => {
      cancelAnimationFrame(raf);
      themed.disconnect();
      unheld();
      undress(logo);
      window.removeEventListener("resize", wake);
      glass.removeEventListener("transitionrun", moved);
      glass.removeEventListener("animationstart", moved);
      field.set(null);
    };
  }, [field, on, glassRef, shadowRef, frostRef, logoRef]);
  const drawn = useSyncExternalStore(
    field?.subscribe ?? alone,
    () => field?.drawn() ?? false,
    () => false,
  );
  return on && drawn;
}

/** Whether what the glass stands on is the field's still picture (FG-4b): the logo is then the still's own mark,
 * at the picture's size. False off the field. */
export function useFieldStill(): boolean {
  const field = useContext(FieldGlassContext);
  return useSyncExternalStore(
    field?.subscribe ?? alone,
    () => field?.still() ?? false,
    () => false,
  );
}
