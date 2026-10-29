import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { AppearanceOverrideSource } from "../appearance";
import type { ProductPresentationContextReporter } from "../presentation-context";
import { FieldLayer } from "./FieldLayer";
import type { BootMachine } from "./machine";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { SwitchLayer } from "./SwitchScene";
import { SplashFace } from "./splash-parts";
import { isSwitchCovering, SWITCH_MOTION, useSwitchState } from "./switch";
import "./boot.css";

// BootRoot (ESR §5.4.2): the splash is the app's first face (DESIGN.md §8 —
// the field waking, the veil's thin bar, real stage labels); the
// workspace mounts UNDERNEATH it as soon as the module + document exist, and
// the reveal (240ms fade + a 560ms island-ease settle) plays only when the
// machine reaches `interactive` — fully warm, frame-stable, never mid-hitch.
//
// UA-3w borrows that first face once per install: from the machine's
// `onboarding` hold the Setup Assistant takes the splash's layer and ground,
// and the splash's own face (bar, stage line) stands down and the field's
// mark goes under the glass. Since
// AO-D2 it keeps them to the end: its answers recorded, the document opens,
// warms and settles behind its glass while Setting up reports those stages,
// and at `interactive` the glass leaves exactly as the splash would — the
// 240ms fade over the 560ms settle — so the splash never returns between the
// wizard and the desk. W5 in mechanism: the wizard ends inside the field it
// opened, not at a door.
//
// The switch (DESIGN.md §8) borrows it once per user change. The window being
// left draws its scene over everything — the field recedes and freezes under
// it — and converges on the splash wearing the next user's face; the window
// that reload opens paints that same frame first and stands the plain splash
// down until its reveal sends the face home.

const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // --vf-ease-island

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

  // The stage recedes under a switch it is leaving (M5), and comes forward
  // again while a refused one plays back; the transform lives only that long,
  // for the settle's reason below.
  const returning = switching.kind === "leaving" && switching.phase === "returning";
  const recede = !prefersReducedMotion() && (covered || returning);
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
              ? {
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
        <LeavingGround revealed={revealed} inert={covered} glass>
          <OnboardingWizard
            client={machine.client}
            onboarding={machine.onboarding}
            boot={view}
            onComplete={machine.completeOnboarding}
            onReveal={machine.revealDesk}
            onRetry={machine.retry}
          />
        </LeavingGround>
      ) : switching.kind === "arriving" || splashRetired ? null : (
        <LeavingGround revealed={revealed}>
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
 * mark gone while the Setup Assistant's glass stands on it. */
function BootGround({
  className = "",
  ariaHidden = false,
  inert = false,
  glass,
  children,
}: {
  className?: string;
  ariaHidden?: boolean;
  inert?: boolean;
  glass: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`vf-splash absolute inset-0 z-[120] flex items-center justify-center ${className}`}
      aria-hidden={ariaHidden}
      inert={inert}
    >
      <FieldLayer mark={!glass} />
      {children}
    </div>
  );
}

/** The first face — the splash, or the Setup Assistant that kept the window
 * (AO-D2) — leaves on the reveal: a 240ms fade over the desk's settle, then it
 * unmounts. One leaving for both, so the two can never part differently. */
function LeavingGround({
  revealed,
  inert = false,
  glass = false,
  children,
}: {
  revealed: boolean;
  inert?: boolean;
  /** the Setup Assistant's glass stands on the ground */
  glass?: boolean;
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
    >
      {children}
    </BootGround>
  );
}
