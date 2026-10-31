import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AppearanceOverrideSource } from "../appearance";
import type { ProductPresentationContextReporter } from "../presentation-context";
import { getAppTheme } from "../theme";
import { type FieldHandle, FieldLayer } from "./FieldLayer";
import type { BootMachine } from "./machine";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import type { WizardLeaving } from "./onboarding/wizard-ui";
import { SwitchLayer } from "./SwitchScene";
import { SplashFace } from "./splash-parts";
import { isSwitchCovering, SWITCH_MOTION, useSwitchState } from "./switch";
import "./boot.css";

// BootRoot (ESR §5.4.2): the splash is the app's first face (DESIGN.md §8 —
// the field waking, the veil's thin bar, real stage labels); the
// workspace mounts UNDERNEATH it as soon as the module + document exist, and
// the reveal plays only once the machine hands the desk over — fully warm,
// frame-stable, never mid-hitch. Since FG-2 a returning boot's splash opens
// onto it: its words go (240ms), then the field tears from its centre (1.9s)
// as the desk settles in from .985 and its exposure comes down from 1.16, and
// only then is it `interactive`. Without a live field, under Reduce Motion or
// in a hidden window, the reveal is the base one: a 240ms fade over a 560ms
// island-ease settle, at `interactive`.
//
// UA-3w borrows that first face once per install: from the machine's
// `onboarding` hold the Setup Assistant takes the splash's layer and ground,
// and the splash's own face (bar, stage line) stands down and the field's
// mark goes under the glass. Since
// AO-D2 it keeps them to the end: its answers recorded, the document opens,
// warms and settles behind its glass while Setting up reports those stages,
// so the splash never returns between the wizard and the desk. Since FG-5 its
// last beat hands over as a returning boot's splash does, its glass leaving
// first: its words go, its logo holds alone, and the glass clears as the
// field's mark takes over; then the tear, or the base reveal's fade. W5 in
// mechanism: the wizard ends inside the field it opened, not at a door.
//
// The switch (DESIGN.md §8) borrows it once per user change. The window being
// left draws its scene over everything — the field recedes and freezes under
// it — and converges on the splash wearing the next user's face; the window
// that reload opens paints that same frame first and stands the plain splash
// down until its reveal sends the face home.

const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // --vf-ease-island
const WORDS_OUT_MS = 240; // the website's `SPLASH.wordsOut`: the bar and the stage go first

/** The Setup Assistant's hand-over (FG-5; DESIGN.md §6), as its glass plays it (wizard-ui.css):
 * its words go, its logo holds alone, and its glass clears as the field's mark takes over — fades
 * only, halved, under Reduce Motion. */
const HANDOVER = {
  full: { words: 240, alone: 640, clear: 600 },
  reduced: { words: 120, alone: 320, clear: 300 },
} as const;

/** How a returning boot's first face opens (FG-2): the field's tear, or the base reveal's fade. */
type Opening = "tear" | "fade";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function BootRoot({
  machine,
  appearanceOverrideSource,
  onPresentationContextChange,
}: {
  machine: BootMachine;
  appearanceOverrideSource?: AppearanceOverrideSource;
  onPresentationContextChange?: ProductPresentationContextReporter;
}): ReactElement {
  const view = useSyncExternalStore(machine.subscribe, machine.view);
  const ready = machine.ready;
  const revealed = view.phase === "interactive";
  const [settled, setSettled] = useState(false);
  const switching = useSwitchState();
  const covered = isSwitchCovering(switching);
  // An arrival revealed straight into the field retires the plain splash: the
  // switch's scene WAS this boot's splash. Into Setup it does not — the plain
  // splash returns under the wizard's hand-back like any boot's.
  const [splashRetired, setSplashRetired] = useState(false);
  useEffect(() => {
    if (switching.kind === "arriving" && switching.phase === "revealing" && revealed) {
      setSplashRetired(true);
    }
  }, [switching, revealed]);

  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setSettled(true), 600); // outlive the 560ms settle
    return () => clearTimeout(t);
  }, [revealed]);

  // FG-2 — the hand-over (DESIGN.md §6, §8 "The reveal"). A returning boot's
  // splash opens onto the desk once the machine is at `handing-over`: the tear
  // when the field is live, motion is allowed and the window is seen, else the
  // base reveal's fade, handed over at once. The Setup Assistant hands over at
  // its own last beat (`onReveal`, FG-5 below), and a switch's arrival at once:
  // its scene was this boot's splash, on the mat. Decided once, and never
  // cancelled by a later render — a hand-over that never came would hold the
  // boot.
  const field = useRef<FieldHandle>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [tearing, setTearing] = useState(false);
  // The tear itself: the desk settles in as the field opens, and is handed over
  // once the field is open, or once its bound has passed.
  const tearOpen = useCallback((): void => {
    if (!mounted.current) return;
    setTearing(true);
    const torn = field.current?.tear(getAppTheme().resolved === "dark") ?? Promise.resolve(false);
    void torn.then(() => {
      if (mounted.current) machine.revealDesk();
    });
  }, [machine]);
  const handing = view.phase === "handing-over";
  const wizard = machine.client !== null && machine.onboarding !== null;
  const splashShown = !wizard && switching.kind !== "arriving" && !splashRetired;
  useEffect(() => {
    if (!handing || wizard || opening !== null) return;
    const tears =
      splashShown && !document.hidden && !prefersReducedMotion() && field.current?.live === true;
    setOpening(tears ? "tear" : "fade");
    if (!tears) {
      machine.revealDesk();
      return;
    }
    setTimeout(tearOpen, WORDS_OUT_MS);
  }, [handing, wizard, opening, splashShown, machine, tearOpen]);

  // FG-5 — the Setup Assistant's hand-over (DESIGN.md §6). From its last beat
  // its glass leaves first — its words go, its logo holds alone, and the glass
  // clears as the field's mark takes over (`leaving`) — and then the field
  // opens as a returning boot's does, chosen as FG-2 chooses: the tear when the
  // field is live and motion is allowed, else the base reveal's fade. Under
  // Reduce Motion the glass fades only, halved; a hidden window, which draws
  // nothing, hands over at once. Begun once, and decided as it begins.
  const begun = useRef(false);
  const [leaving, setLeaving] = useState<WizardLeaving | null>(null);
  const handOver = useCallback((): void => {
    if (begun.current) return;
    begun.current = true;
    if (document.hidden) {
      setOpening("fade");
      machine.revealDesk();
      return;
    }
    const reduced = prefersReducedMotion();
    const motion = reduced ? HANDOVER.reduced : HANDOVER.full;
    const tears = !reduced && field.current?.live === true;
    setOpening(tears ? "tear" : "fade");
    setLeaving("words");
    setTimeout(() => {
      if (!mounted.current) return;
      setLeaving("clear");
      setTimeout(() => {
        if (tears) tearOpen();
        else if (mounted.current) machine.revealDesk();
      }, motion.clear);
    }, motion.words + motion.alone);
  }, [machine, tearOpen]);

  // The stage recedes under a switch it is leaving (M5), and comes forward
  // again while a refused one plays back; the transform lives only that long,
  // for the settle's reason below.
  const returning = switching.kind === "leaving" && switching.phase === "returning";
  const recede = !prefersReducedMotion() && (covered || returning);
  const clearMs = (prefersReducedMotion() ? HANDOVER.reduced : HANDOVER.full).clear;
  return (
    <>
      {ready !== null && (
        <div
          className="absolute inset-0 motion-reduce:transition-none"
          // Nothing under a switch can be reached: it is leaving.
          inert={covered}
          // The settle transform exists ONLY while settling: a persistent
          // transform creates a stacking context that flattens the whole app
          // BELOW the z-40 .app-drag strip — every click in the top 52px died
          // (field report 2026-07-22). Once settled the wrapper is inert and
          // body-level stacking returns: the pill's no-drag hole punches
          // through the drag strip again.
          style={
            !settled
              ? tearing
                ? // the tear's settle: in from .985 as the exposure comes down (DESIGN.md §6)
                  {
                    transform: "scale(1)",
                    filter: "brightness(1)",
                    transition: `transform 1900ms ${EASE}, filter 1500ms ease-out`,
                  }
                : opening === "tear"
                  ? // the words' beat: the desk waits under the field, small and bright
                    { transform: "scale(0.985)", filter: "brightness(1.16)" }
                  : {
                      transform: revealed ? "scale(1)" : "scale(0.99)",
                      transition: `transform 560ms ${EASE}`,
                    }
              : recede
                ? {
                    transform: covered ? `scale(${SWITCH_MOTION.recede})` : "scale(1)",
                    transition: `transform 600ms ${EASE}`,
                  }
                : undefined
          }
        >
          <ready.mod.FielddProvider client={ready.client}>
            <ready.mod.FieldView
              manager={ready.manager}
              plugins={ready.plugins}
              {...(appearanceOverrideSource === undefined ? {} : { appearanceOverrideSource })}
              {...(onPresentationContextChange === undefined
                ? {}
                : { onPresentationContextChange })}
              {...(ready.profile === undefined ? {} : { profile: ready.profile })}
            />
          </ready.mod.FielddProvider>
        </div>
      )}
      {machine.client !== null && machine.onboarding !== null ? (
        <LeavingGround
          revealed={revealed}
          inert={covered}
          // the glass stands until it clears, and over its clearing the field's
          // mark takes over from its logo (FG-5)
          glass={leaving !== "clear"}
          markMs={leaving === "clear" ? clearMs : undefined}
          opening={opening}
          field={field}
        >
          <OnboardingWizard
            client={machine.client}
            onboarding={machine.onboarding}
            boot={view}
            leaving={leaving}
            onComplete={machine.completeOnboarding}
            onReveal={handOver}
            onRetry={machine.retry}
          />
        </LeavingGround>
      ) : switching.kind === "arriving" || splashRetired ? null : (
        <LeavingGround revealed={revealed} opening={opening} field={field}>
          <SplashFace status={view} onRetry={machine.retry} />
        </LeavingGround>
      )}
      <SwitchLayer
        boot={view}
        ready={revealed || machine.onboarding !== null}
        onRetry={machine.retry}
      />
    </>
  );
}

/** The first face's ground: the field (track FG; DESIGN.md §2.1, §8 — the
 * website's splash, not a logo card). Shared by the splash and the Setup
 * Assistant so handing one to the other changes the content and never the
 * floor: one node, so one field runs from the first paint to the reveal, its
 * mark gone while the Setup Assistant's glass stands on it and back as the
 * glass clears (`markMs`, FG-5) — and since FG-3b the glass drawn by the field
 * itself, so what stands on the ground stands in the field's layer. `opening`
 * (FG-2): at the tear the words go and the ground's own colour with them
 * (boot.css). */
function BootGround({
  className = "",
  ariaHidden = false,
  inert = false,
  glass,
  markMs,
  opening,
  field,
  children,
}: {
  className?: string;
  ariaHidden?: boolean;
  inert?: boolean;
  glass: boolean;
  markMs: number | undefined;
  opening: Opening | null;
  field: RefObject<FieldHandle | null>;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`vf-splash absolute inset-0 z-[120] flex items-center justify-center ${className}`}
      data-opening={opening ?? undefined}
      aria-hidden={ariaHidden}
      inert={inert}
    >
      <FieldLayer mark={!glass} markMs={markMs} handleRef={field}>
        {children}
      </FieldLayer>
    </div>
  );
}

/** The first face — the splash, or the Setup Assistant that kept the window
 * (AO-D2) — leaves on the reveal: a 240ms fade over the desk's settle, then it
 * unmounts. One leaving for both, so the two can never part differently. Since
 * FG-2 a returning boot's field may have torn open first, and since FG-5 a
 * first run's, its glass cleared before it, leaving the fade nothing to fade
 * but a field that never opened. */
function LeavingGround({
  revealed,
  inert = false,
  glass = false,
  markMs,
  opening = null,
  field,
  children,
}: {
  revealed: boolean;
  inert?: boolean;
  /** the Setup Assistant's glass stands on the ground */
  glass?: boolean;
  /** how long the field's mark takes to come back, when not its own 400ms (FG-5) */
  markMs?: number | undefined;
  /** how the ground is opening (FG-2, FG-5) */
  opening?: Opening | null;
  /** the field's handle, for the reveal (FG-2) */
  field: RefObject<FieldHandle | null>;
  children: ReactNode;
}): ReactElement | null {
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setMounted(false), 400); // outlive the 240ms fade
    return () => clearTimeout(t);
  }, [revealed]);
  if (!mounted) return null;

  return (
    <BootGround
      className={`transition-opacity duration-[240ms] ease-out ${
        revealed ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      ariaHidden={revealed}
      inert={inert}
      glass={glass}
      markMs={markMs}
      opening={opening}
      field={field}
    >
      {children}
    </BootGround>
  );
}
