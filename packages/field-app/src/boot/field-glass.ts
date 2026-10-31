import {
  createContext,
  type RefObject,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import {
  type GlassPose,
  type GlassState,
  readGlassLook,
  readGlassPose,
  samePose,
} from "./splash/glass-look";

// The field's hold on the Setup Assistant's glass (track FG, FG-3b; FG-D24; DESIGN.md §8 "The Setup Assistant's
// glass"): the glass standing on the live field hands the field its look and where it stands, and the field says
// whether it draws it, so the browser stands its own frost down. FieldLayer keeps one for its field and hands it to
// what stands on the field; wizard-ui.tsx's glass follows it (`useFieldGlass`). Off the field, or with nothing under
// it but the field's still, the browser draws the whole glass, as it did before FG-3b.

/** The glass's side of the hold. */
export interface FieldGlass {
  /** What the field is to draw, or null for none: kept, and handed on to the field's door once it opens. */
  set(glass: GlassState | null): void;
  /** The field's box on the page, which a pose is measured from; null while nothing holds it. */
  box(): DOMRectReadOnly | null;
  /** Whether the field draws the glass, for `useSyncExternalStore`. */
  drawn(): boolean;
  subscribe(listener: () => void): () => void;
}

/** FieldLayer's side: the field's door as it opens and goes, and what the door says. */
export interface FieldGlassHost extends FieldGlass {
  /** The open door, handed what is kept; null once it is gone, and the field draws nothing. */
  attach(door: { glass(glass: GlassState | null): void } | null): void;
  /** The door says whether the field draws the glass. */
  report(drawn: boolean): void;
}

export function createFieldGlass(field: () => Element | null): FieldGlassHost {
  let door: { glass(glass: GlassState | null): void } | null = null;
  let kept: GlassState | null = null;
  let drawn = false;
  const listeners = new Set<() => void>();
  const say = (next: boolean): void => {
    if (next === drawn) return;
    drawn = next;
    for (const listener of listeners) listener();
  };
  return {
    set(glass) {
      kept = glass;
      door?.glass(glass);
    },
    box: () => field()?.getBoundingClientRect() ?? null,
    drawn: () => drawn,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attach(next) {
      door = next;
      if (next === null) say(false);
      else next.glass(kept);
    },
    report(next) {
      // a door already gone says nothing the field still draws
      if (door !== null || !next) say(next);
    },
  };
}

export const FieldGlassContext = createContext<FieldGlass | null>(null);

const alone = (): (() => void) => () => {};

/** The glass's own animations, the forming, still running. */
function forming(glass: Element): boolean {
  return (
    typeof glass.getAnimations === "function" &&
    glass.getAnimations().some((animation) => animation.playState === "running")
  );
}

/** The Setup Assistant's glass drawn by the field it stands on (FG-3b). While `on`, it hands the field its look, read
 * off its layers and again whenever the theme turns, and its pose, read every frame it moves: through its forming
 * (the frost and the rise), and through a window's resize (the fit) until it has rested two frames. True while the
 * field draws it, so the browser draws only the edge. */
export function useFieldGlass(
  glassRef: RefObject<HTMLElement | null>,
  shadowRef: RefObject<Element | null>,
  frostRef: RefObject<Element | null>,
  on: boolean,
): boolean {
  const field = useContext(FieldGlassContext);
  useLayoutEffect(() => {
    const glass = glassRef.current;
    const shadow = shadowRef.current;
    const frost = frostRef.current;
    if (field === null || !on || glass === null || shadow === null || frost === null) return;
    const layers = { glass, shadow, frost };
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
    // the tint is the theme's: `.dark` and `data-theme` on the root (theme.ts)
    const themed = new MutationObserver(() => {
      look = readGlassLook(layers);
      send();
    });
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    window.addEventListener("resize", wake);
    follow();
    return () => {
      cancelAnimationFrame(raf);
      themed.disconnect();
      window.removeEventListener("resize", wake);
      field.set(null);
    };
  }, [field, on, glassRef, shadowRef, frostRef]);
  const drawn = useSyncExternalStore(
    field?.subscribe ?? alone,
    () => field?.drawn() ?? false,
    () => false,
  );
  return on && drawn;
}
