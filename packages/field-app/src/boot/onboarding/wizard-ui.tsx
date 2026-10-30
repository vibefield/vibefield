import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ThemeToggleButton } from "../../ThemeToggleButton";
import { useTheme } from "../../theme";
import type { WizardStep } from "./order";
import "./wizard-ui.css";

// The Setup Assistant's chrome (UA-3w; DESIGN.md §3/§7/§8/§9). Deliberately
// its own small vocabulary rather than the settings one: a full-window pane's
// primary action is not a settings-row chip, and the boot bundle should not
// pull the panels module in to borrow a class string.
//
// Type follows §3's inversion — the headline is BIG and LIGHT, the controls are
// small and medium. Color follows §2.5: none of this chrome is a state, so none
// of it carries a hue. The only saturated thing on screen is the accent the
// user picks, which is content.

/** Primary action — the §8 chip canon's inverted solid, at full-window size. */
export const primaryCls =
  "inline-flex h-10 items-center justify-center rounded-full bg-black px-5 text-[13px] font-medium text-white shadow-md transition-[transform,opacity] hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vf-select)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vf-canvas-bg)] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:bg-white dark:text-black";

/** Quiet action — skips, backs, second thoughts. */
export const quietCls =
  "inline-flex h-10 items-center justify-center rounded-full bg-black/5 px-4 text-[13px] font-medium text-black/65 transition-[background-color,color,transform] hover:bg-black/10 hover:text-black active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vf-select)] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:bg-white/10 dark:text-white/65 dark:hover:bg-white/15 dark:hover:text-white";

export const eyebrowCls =
  "text-[10px] font-medium uppercase tracking-[0.08em] text-black/50 dark:text-white/50";
export const voiceCls = "text-[14px] leading-[1.45] text-black/70 dark:text-white/70";
export const factCls = "text-[12px] leading-5 text-black/45 dark:text-white/45";

/** What the glass stands on (DESIGN.md §5, the Setup Assistant's row). On the
 * field, where the first run happens (track FG), it wears the field's edge,
 * shadow and grain, and forms where the splash stood; over the app (Finish
 * setting up's sheet) it keeps the hairline and the island's shadow. */
export type WizardGround = "field" | "app";

/** How the glass is sized (FG-D26, a lean). The Setup Assistant's steps stand
 * in one glass, 880 × 640 and fitted to its ground (FG-D3 A); Finish setting
 * up's sheet is AO's surface and no step of the chapter, so it keeps the size
 * and padding it had before FG, never fitted, until AO rules. */
export type WizardSize = "glass" | "sheet";

/** The band's state (FG-D22 A): the chapter's steps, in order (`stepsOf`), and
 * the step the pane stands in (`STEP_OF`) — none where the band is absent. */
export interface WizardBand {
  steps: readonly WizardStep[];
  at: WizardStep | null;
}

/** One persistent glass around every step (FG-L2). The question inside
 * changes; the glass, its band and the theme control never resize or remount
 * around it. */
export function WizardShell({
  children,
  ground,
  size,
  band,
}: {
  children: ReactNode;
  ground?: WizardGround | undefined;
  size?: WizardSize | undefined;
  band?: WizardBand | undefined;
}): ReactElement {
  const { dark, toggle } = useTheme();
  return (
    <WizardShellView dark={dark} onToggleTheme={toggle} ground={ground} size={size} band={band}>
      {children}
    </WizardShellView>
  );
}

/** Controller-free shell for production-backed catalogs and tests. The glass
 * is 880 × 640 on every step, centred on its ground and scaled as one picture
 * to fit it (`glassFit`), never reflowed — the sheet's keeps its own size,
 * unscaled (FG-D26); its material is layers under its
 * contents (wizard-ui.css), so it can form without fading anything above its
 * frost. Only the glass takes a press: around it the ground lets one through
 * to what holds it (the sheet's scrim closes it). */
export function WizardShellView({
  children,
  dark,
  onToggleTheme,
  ground = "app",
  size = "glass",
  band,
}: {
  children: ReactNode;
  dark: boolean;
  onToggleTheme: () => void;
  ground?: WizardGround | undefined;
  size?: WizardSize | undefined;
  band?: WizardBand | undefined;
}): ReactElement {
  const groundRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const fit = useGlassFit(groundRef, glassRef, size === "glass");
  return (
    <div
      ref={groundRef}
      className="vf-wizard-ground"
      style={fit === null ? undefined : ({ "--vf-glass-fit": String(fit) } as CSSProperties)}
    >
      <div className="vf-wizard-fit">
        <div ref={glassRef} className="vf-wizard-shell" data-ground={ground} data-size={size}>
          <div className="vf-wizard-glass-shadow" />
          <div className="vf-wizard-glass-frost" />
          <div className="vf-wizard-glass-grain" />
          <div className="vf-wizard-glass-edge" />
          {band !== undefined && <WizardSteps band={band} />}
          <ThemeToggleButton
            dark={dark}
            onToggle={onToggleTheme}
            className="no-drag absolute top-5 right-5"
          />
          <div className="vf-wizard-frame">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** The room the glass keeps around itself on its ground, 48 a side (FG-L2:
 * scaled below a 976 × 736 window). Its size is the stylesheet's alone. */
const FIT_MARGIN = 96;

/** FG-L2's fit: min(1, (w − 96) / 880, (h − 96) / 640), read off the glass's
 * own laid-out size. A ground not laid out yet (or with no room at all) draws
 * the glass at its own size, which the ground clips. */
export function glassFit(
  ground: { width: number; height: number },
  glass: { width: number; height: number },
): number {
  const roomWidth = ground.width - FIT_MARGIN;
  const roomHeight = ground.height - FIT_MARGIN;
  if (roomWidth <= 0 || roomHeight <= 0 || glass.width <= 0 || glass.height <= 0) return 1;
  return Math.min(1, roomWidth / glass.width, roomHeight / glass.height);
}

/** The glass's fit to its ground, measured before the first paint and again
 * whenever the ground resizes: the window on the field, a frame in the
 * catalog. None where the glass is not fitted (the sheet's, FG-D26). */
function useGlassFit(
  groundRef: RefObject<HTMLDivElement | null>,
  glassRef: RefObject<HTMLDivElement | null>,
  fitted: boolean,
): number | null {
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const ground = groundRef.current;
    const glass = glassRef.current;
    if (!fitted || ground === null || glass === null) return;
    const measure = (): void =>
      setFit(
        glassFit(
          { width: ground.clientWidth, height: ground.clientHeight },
          { width: glass.offsetWidth, height: glass.offsetHeight },
        ),
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(ground);
    return () => observer.disconnect();
  }, [groundRef, glassRef, fitted]);
  return fitted ? fit : null;
}

/** The band's words (DESIGN.md §8), set in small capitals by the stylesheet. */
const STEP_LABEL: Record<WizardStep, string> = {
  you: "You",
  agents: "Agents",
  profiles: "Profiles",
  history: "History",
  devices: "Devices",
  "setting-up": "Setting up",
};

/** The steps (FG-D22 A, FG-D23 A): the chapter along the glass's top. Its list
 * is built once per chapter and afterwards only its states change, so nothing
 * in it moves: a segment fills as you arrive and empties as you go back. It
 * fades away where the pane stands in no step, and the first time it shows,
 * its segments fill from empty. */
function WizardSteps({ band }: { band: WizardBand }): ReactElement {
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);
  const at = !armed || band.at === null ? -1 : band.steps.indexOf(band.at);
  const shown = at >= 0;
  return (
    <div className="vf-wizard-steps" data-shown={shown} aria-hidden={!shown}>
      <ol key={band.steps.join(" ")} aria-label="Steps">
        {band.steps.map((step, index) => {
          const state = index < at ? "done" : index === at ? "now" : "next";
          return (
            <li
              key={step}
              data-step={step}
              data-state={state}
              aria-current={state === "now" ? "step" : undefined}
            >
              <span className="vf-wizard-step-seg">
                <span />
              </span>
              <span className="vf-wizard-step-label">{STEP_LABEL[step]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One pane: eyebrow, headline, a line of voice, its content, its actions.
 * `key` the caller passes drives the entrance — one container, new content
 * (M1: nothing crossfades with anything). */
export function WizardPane({
  eyebrow,
  title,
  voice,
  children,
  actions,
  onSubmit,
  centered = false,
}: {
  eyebrow: string;
  /** Words, or — for Setting up's welcome — one cell whose words cross-fade. */
  title: ReactNode;
  voice?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  /** The opening welcome is intentionally quieter than the question panes. */
  centered?: boolean;
  /** Enter advances: the primary action is the form's submit button, so the
   * keyboard path is the same object as the pointer path. */
  onSubmit?: () => void;
}): ReactElement {
  return (
    <form
      className={`vf-wizard-pane flex w-full max-w-[30rem] flex-col gap-5 ${
        centered ? "items-center text-center" : ""
      }`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <div className={`flex flex-col gap-2 ${centered ? "items-center" : ""}`}>
        <span className={eyebrowCls}>{eyebrow}</span>
        <h1 className="text-[28px] font-light leading-[1.15] tracking-[-0.02em] text-black dark:text-white">
          {title}
        </h1>
        {voice !== undefined && <p className={voiceCls}>{voice}</p>}
      </div>
      {children}
      <div className={`flex flex-wrap items-center gap-2 pt-1 ${centered ? "justify-center" : ""}`}>
        {actions}
      </div>
    </form>
  );
}

/** Every skip names its later home (W3) — the spec's subtitle, unless the pane
 * names its own (the agent chapter's: "Bring it in anytime from History.").
 * The pane that skips with this default, the link, lives on Settings →
 * Devices since TS-3a (TS-D3), as the posture it was followed by does (TS-6). */
export function SkipAction({
  label,
  onSkip,
  home = "Set up later — Settings → Devices",
}: {
  label: string;
  onSkip: () => void;
  home?: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={quietCls} onClick={onSkip}>
        {label}
      </button>
      <span className={factCls}>{home}</span>
    </div>
  );
}

/** W6's other half — Back always works, so every question but the first offers
 * it; absent where there is nowhere earlier to go. */
export function BackAction({ onBack }: { onBack: (() => void) | undefined }): ReactElement | null {
  if (onBack === undefined) return null;
  return (
    <button type="button" className={quietCls} onClick={onBack}>
      Back
    </button>
  );
}

/** An error that holds its pane: what happened, and what to do next (§9). */
export function WizardError({ reason }: { reason: string }): ReactElement {
  return (
    <p className="text-[12px] leading-5 text-amber-600 dark:text-amber-400" role="alert">
      {reason}
    </p>
  );
}
