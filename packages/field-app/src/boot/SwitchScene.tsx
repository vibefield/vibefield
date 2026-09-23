import { UserFaceView } from "@vibefield/design-kit/face";
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FIRST_STAGE } from "./machine";
import { SplashFace, SplashStatus, type SplashStatusView } from "./splash-parts";
import {
  registerSwitchStage,
  revealArrival,
  SWITCH_MOTION,
  type SwitchOrigin,
  type SwitchPersona,
  switchLeft,
  switchReturned,
  switchRevealed,
  useSwitchState,
} from "./switch";
// The splash's own ground (`.vf-splash`) — the scene IS the splash in its
// held frame, so it owns that import rather than borrowing BootRoot's.
import "./boot.css";
import "./switch-scene.css";

// The switch's scene (DESIGN.md §8 "The switch"). Split like every
// runtime-bound view (UI_SYSTEM.md): `SwitchSceneView` owns the DOM and the
// motion and takes plain data — the catalog stages it with a fixture — and
// `SwitchLayer` binds it to the switch conductor (switch.ts) and the boot.
//
// Motion is CSS transitions on a `data-step` the view sets on its root (M3):
// a stalled compositor snaps a transition to its end, and the end of every
// phase here is a frame the window can rest on.

export type SwitchScenePhase = "leaving" | "held" | "returning" | "revealing";

export interface SwitchSceneViewProps {
  /** Who the window is going to; null draws the plain splash (a new user). */
  persona: SwitchPersona | null;
  phase: SwitchScenePhase;
  /** The splash's words while the window changes hands. */
  status: SplashStatusView;
  onRetry?: (() => void) | undefined;
  /** Where the face leaves from, and goes back to when a switch is refused. */
  origin?: SwitchOrigin | null;
  /** Where the face lands when the arriving window is revealed, in viewport
   * pixels: where that face will REST, which is not always where it is — the
   * boot settles the stage and flies the corners in under the reveal. */
  findHome?: () => SwitchBox | null;
  /** Hide the home's own face until the traveller is on it. */
  landing?: boolean;
  /** A phase has run: leaving → the frame has converged; returning and
   * revealing → the scene is done. */
  onSettled?: (phase: "leaving" | "returning" | "revealing") => void;
  /** Stage it inside its parent instead of over the window (the catalog). */
  contained?: boolean;
}

const M = SWITCH_MOTION;
const ms = (value: number): string => `${value}ms`;

/** Every number the stylesheet runs on, from the one set in switch.ts. */
const MOTION_VARS = {
  "--vf-switch-face-size": `${M.faceSize}px`,
  "--vf-switch-blur": `${M.blurPx}px`,
  "--vf-switch-travel": ms(M.travel),
  "--vf-switch-blur-in": ms(M.blurIn),
  "--vf-switch-ground-delay": ms(M.groundDelay),
  "--vf-switch-ground-in": ms(M.groundIn),
  "--vf-switch-words-delay": ms(M.wordsDelay),
  "--vf-switch-words-in": ms(M.wordsIn),
  "--vf-switch-words-out": ms(M.wordsOut),
  "--vf-switch-home-delay": ms(M.homeDelay),
  "--vf-switch-home-travel": ms(M.homeTravel),
  "--vf-switch-ground-out": ms(M.groundOut),
  "--vf-switch-blur-out": ms(M.blurOut),
  "--vf-switch-handover": ms(M.handover),
  "--vf-switch-home-landed": ms(M.homeDelay + M.homeTravel),
  "--vf-switch-return-landed": ms(M.homeDelay + M.travel),
  "--vf-switch-return-ground-out": ms(M.returnGroundOut),
  "--vf-switch-return-blur-out": ms(M.returnBlurOut),
  "--vf-switch-reduced-fade": ms(M.reducedFade),
  "--vf-switch-reduced-ground-in": ms(M.reducedGroundIn),
  "--vf-switch-reduced-ground-out": ms(M.reducedGroundOut),
} as CSSProperties;

/** §2.8's lift, which the face wears while it is carried. */
const LIFT_MS = 180;

export interface SwitchBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
type Box = SwitchBox;

/** The transform that puts the slot's box on the target's: FLIP's invert. */
function flip(slot: Box, target: Box): string {
  const dx = target.left + target.width / 2 - (slot.left + slot.width / 2);
  const dy = target.top + target.height / 2 - (slot.top + slot.height / 2);
  const scale = slot.width > 0 ? target.width / slot.width : 1;
  return `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
}

/** An element's box with every transform above it at rest: the offset chain
 * is layout, which neither the boot's settle nor the corners' flight moves. */
export function restingBox(element: HTMLElement): SwitchBox {
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = element; node !== null; ) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
  }
  return {
    left: left - window.scrollX,
    top: top - window.scrollY,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Set a step's start without transitions, then its end with them: the style
 * flush between the two is what makes the browser transition from the one to
 * the other (no frame is painted in between). */
function play(root: HTMLElement, from: string, to: string): void {
  root.dataset.step = from;
  void root.getBoundingClientRect();
  root.dataset.step = to;
}

export function SwitchSceneView({
  persona,
  phase,
  status,
  onRetry,
  origin = null,
  findHome,
  landing = false,
  onSettled,
  contained = false,
}: SwitchSceneViewProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  // Carried faces are held (§2.8): lifted as the leaving begins, like the row
  // it left under the pointer, and set down before the frame converges.
  const [held, setHeld] = useState(phase === "leaving");
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const findHomeRef = useRef(findHome);
  findHomeRef.current = findHome;

  // The corner the face is flying to keeps its own face hidden until the
  // traveller is on it (the stylesheet's `[data-vf-switch-landing]`).
  useLayoutEffect(() => {
    if (!landing) return;
    const scope = contained ? (rootRef.current?.parentElement ?? null) : document.documentElement;
    scope?.setAttribute("data-vf-switch-landing", "");
    return () => scope?.removeAttribute("data-vf-switch-landing");
  }, [landing, contained]);

  // The row the face left went with it (M1) — until it comes back.
  useLayoutEffect(() => {
    const element = origin?.element ?? null;
    if (element === null) return;
    element.setAttribute("data-vf-switch-origin", "");
    return () => element.removeAttribute("data-vf-switch-origin");
  }, [origin]);

  // One choreography per phase; everything else is read as it starts.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const reduced = prefersReducedMotion();
    root.toggleAttribute("data-reduced", reduced);
    const face = faceRef.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (delay: number, run: () => void): void => {
      timers.push(setTimeout(run, delay));
    };
    // The face's own place in the column: every step's rules leave it
    // untransformed at rest, which is when each phase starts.
    const slot = (): Box | null => face?.getBoundingClientRect() ?? null;

    switch (phase) {
      case "held": {
        root.dataset.step = "held";
        setHeld(false);
        break;
      }
      case "leaving": {
        const from = slot();
        if (face !== null && from !== null && origin !== null) {
          face.style.setProperty("--vf-switch-origin", flip(from, origin.rect));
        }
        play(root, "from", "to");
        if (reduced) setHeld(false);
        else after(M.setDown, () => setHeld(false));
        after(reduced ? M.reducedConverge : M.converge, () => {
          root.dataset.step = "held";
          settled.current?.("leaving");
        });
        break;
      }
      case "returning": {
        const from = slot();
        const homeless = face === null || from === null || origin === null;
        if (!homeless) face.style.setProperty("--vf-switch-origin", flip(from, origin.rect));
        root.toggleAttribute("data-homeless", homeless);
        play(root, "return-from", "return");
        if (!reduced && !homeless) {
          setHeld(true);
          after(M.homeDelay + M.travel - LIFT_MS, () => setHeld(false));
        }
        // Back on its row: the row shows its own face under the traveller's
        // last 120ms, never two faces and never none.
        after(reduced ? M.reducedFade : M.homeDelay + M.travel, () =>
          origin?.element.removeAttribute("data-vf-switch-origin"),
        );
        after(reduced ? M.reducedDone : M.returned, () => settled.current?.("returning"));
        break;
      }
      case "revealing": {
        const from = slot();
        const home = findHomeRef.current?.() ?? null;
        const homeless = face === null || from === null || home === null;
        if (!homeless) face.style.setProperty("--vf-switch-home", flip(from, home));
        root.toggleAttribute("data-homeless", homeless);
        play(root, "reveal-from", "reveal");
        if (!reduced && !homeless) {
          after(M.homeDelay, () => setHeld(true));
          after(M.homeDelay + M.homeTravel - LIFT_MS, () => setHeld(false));
        }
        const scope = contained ? root.parentElement : document.documentElement;
        after(reduced ? M.reducedFade : M.homeDelay + M.homeTravel, () =>
          scope?.removeAttribute("data-vf-switch-landing"),
        );
        after(reduced ? M.reducedDone : M.revealed, () => settled.current?.("revealing"));
        break;
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [phase]);

  return (
    <div
      ref={rootRef}
      className="vf-switch"
      data-contained={contained ? "" : undefined}
      style={MOTION_VARS}
    >
      <div className="vf-switch-frost" />
      <div className="vf-switch-ground vf-splash" />
      <div className="vf-switch-column">
        {persona === null ? (
          // The plain splash, exactly: no margin of its own, so it stands
          // where the boot splash stands.
          <div className="vf-switch-status">
            <SplashFace status={status} onRetry={onRetry} />
          </div>
        ) : (
          <div className="vf-switch-stack">
            <div ref={faceRef} className="vf-switch-face">
              <UserFaceView
                emoji={persona.face.emoji}
                frame={persona.face.frame}
                size={M.faceSize}
                seed={persona.userId}
                legend={persona.name}
                held={held}
              />
            </div>
            <div className="vf-switch-words" role="status">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-black/50 dark:text-white/50">
                Switching to
              </span>
              <span className="vf-switch-name text-[28px] font-light leading-[1.15] tracking-[-0.02em] text-black dark:text-white">
                {persona.name}
              </span>
            </div>
            <div className="vf-switch-status">
              <SplashStatus
                status={status}
                onRetry={onRetry}
                label={`Switching to ${persona.name}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** What the leaving window's splash says while main wakes the other pair:
 * exactly what the arriving window's splash will say first. */
export const LEAVING_STATUS: SplashStatusView = Object.freeze({
  stage: FIRST_STAGE,
  progress: null,
  unavailable: null,
});

/** The Me menu's face (or pane 2's) for this user — where an arriving face
 * lands. The attribute names the user, so a window that turned out to hold
 * someone else lands nowhere rather than on the wrong face. */
function homeOf(userId: string): SwitchBox | null {
  for (const home of document.querySelectorAll("[data-vf-switch-home]")) {
    if (home.getAttribute("data-vf-switch-home") !== userId) continue;
    const face = home.querySelector(".vf-face");
    return face instanceof HTMLElement ? restingBox(face) : null;
  }
  return null;
}

/** The controller: the conductor's state on the boot's layer. `boot` is the
 * machine's view while arriving; `ready` says the arriving window may be
 * revealed (the field is interactive, or Setup holds it). */
export function SwitchLayer({
  boot,
  ready,
  onRetry,
}: {
  boot: SplashStatusView;
  ready: boolean;
  onRetry: () => void;
}): ReactElement | null {
  const state = useSwitchState();
  useLayoutEffect(() => registerSwitchStage(), []);
  useEffect(() => {
    if (ready && state.kind === "arriving" && state.phase === "held") revealArrival();
  }, [ready, state]);
  if (state.kind === "idle") return null;
  if (state.kind === "leaving") {
    return (
      <SwitchSceneView
        persona={state.persona}
        phase={state.phase}
        status={LEAVING_STATUS}
        origin={state.origin}
        onSettled={(phase) => {
          if (phase === "leaving") switchLeft();
          else if (phase === "returning") switchReturned();
        }}
      />
    );
  }
  const userId = state.persona.userId;
  return (
    <SwitchSceneView
      persona={state.persona}
      phase={state.phase}
      status={boot}
      onRetry={onRetry}
      findHome={() => homeOf(userId)}
      landing
      onSettled={(phase) => {
        if (phase === "revealing") switchRevealed();
      }}
    />
  );
}
