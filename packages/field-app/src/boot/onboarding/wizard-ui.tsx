import {
  Component,
  type CSSProperties,
  createContext,
  createRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ThemeToggleButton } from "../../ThemeToggleButton";
import { useTheme } from "../../theme";
import { useFieldGlass } from "../field-glass";
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
 * shadow and grain, and forms where the splash stood — over the live field
 * drawn by the field itself (FG-3b), the browser keeping only its edge; over
 * the app (Finish setting up's sheet) it keeps the hairline and the island's
 * shadow. */
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

/** What a pane stands in, told by the shell around it: the glass's one frame,
 * where the band names the step (FG-L3), or Finish setting up's sheet, which
 * keeps its panes as they stood before FG (FG-D26). */
const WizardFrameSize = createContext<WizardSize>("glass");

/** One persistent glass around every step (FG-L2). The question inside
 * changes; the glass, its band and the theme control never resize or remount
 * around it. */
export function WizardShell({
  children,
  ground,
  size,
  band,
  paneKey,
}: {
  children: ReactNode;
  ground?: WizardGround | undefined;
  size?: WizardSize | undefined;
  band?: WizardBand | undefined;
  /** Which pane stands in the frame: a new key fades the old pane out first. */
  paneKey?: string | undefined;
}): ReactElement {
  const { dark, toggle } = useTheme();
  return (
    <WizardShellView
      dark={dark}
      onToggleTheme={toggle}
      ground={ground}
      size={size}
      band={band}
      paneKey={paneKey}
    >
      {children}
    </WizardShellView>
  );
}

/** Controller-free shell for production-backed catalogs and tests. The glass
 * is 880 × 640 on every step, centred on its ground and scaled as one picture
 * to fit it (`glassFit`), never reflowed — the sheet's keeps its own size,
 * unscaled (FG-D26); its material is layers under its
 * contents (wizard-ui.css), so it can form without fading anything above its
 * frost. On the live field the field draws those layers (`useFieldGlass`,
 * `data-glass`). Only the glass takes a press: around it the ground lets one
 * through to what holds it (the sheet's scrim closes it). */
export function WizardShellView({
  children,
  dark,
  onToggleTheme,
  ground = "app",
  size = "glass",
  band,
  paneKey,
}: {
  children: ReactNode;
  dark: boolean;
  onToggleTheme: () => void;
  ground?: WizardGround | undefined;
  size?: WizardSize | undefined;
  band?: WizardBand | undefined;
  paneKey?: string | undefined;
}): ReactElement {
  const groundRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const frostRef = useRef<HTMLDivElement>(null);
  const fit = useGlassFit(groundRef, glassRef, size === "glass");
  const drawn = useFieldGlass(glassRef, shadowRef, frostRef, ground === "field");
  return (
    <div
      ref={groundRef}
      className="vf-wizard-ground"
      style={fit === null ? undefined : ({ "--vf-glass-fit": String(fit) } as CSSProperties)}
    >
      <div className="vf-wizard-fit">
        <div
          ref={glassRef}
          className="vf-wizard-shell"
          data-ground={ground}
          data-size={size}
          data-glass={drawn ? "field" : undefined}
        >
          <div ref={shadowRef} className="vf-wizard-glass-shadow" />
          <div ref={frostRef} className="vf-wizard-glass-frost" />
          <div className="vf-wizard-glass-grain" />
          <div className="vf-wizard-glass-edge" />
          {band !== undefined && <WizardSteps band={band} />}
          <ThemeToggleButton
            dark={dark}
            onToggle={onToggleTheme}
            className="no-drag absolute top-5 right-5"
          />
          <WizardFrameSize.Provider value={size}>
            <PaneSwap paneKey={paneKey}>{children}</PaneSwap>
          </WizardFrameSize.Provider>
        </div>
      </div>
    </div>
  );
}

/** How long the old pane takes to leave, and the new one to arrive (DESIGN.md
 * §8 "The Setup Assistant's glass", FG-L3); halved and more under Reduce
 * Motion, as the page plays them. */
const PANE_OUT_MS = 120;
const PANE_OUT_REDUCED_MS = 60;
const PANE_IN_MS = 240;
const PANE_IN_REDUCED_MS = 160;

interface PaneSwapProps {
  paneKey: string | undefined;
  children: ReactNode;
}

/** The pane standing in the frame: its own, never a leaving copy. */
function standingPane(frame: HTMLElement | null): HTMLElement | null {
  const pane = Array.from(frame?.children ?? []).find(
    (child) => child.classList.contains("vf-wizard-pane") && !child.hasAttribute("inert"),
  );
  return pane instanceof HTMLElement ? pane : null;
}

/** The frame (FG-L3), where a pane only fades in and the one it replaces fades
 * out first. The old pane leaves as a still copy laid over the frame, inert and
 * hidden from assistive tech, while the new one, mounted at once, waits under
 * it before its own fade. A pane's own changes never fade; only a new `paneKey`
 * does. A host that cannot animate swaps at once. A class, because React reads
 * the leaving pane only through `getSnapshotBeforeUpdate`, before it goes. */
class PaneSwap extends Component<PaneSwapProps> {
  private readonly frame = createRef<HTMLDivElement>();

  override getSnapshotBeforeUpdate(previous: Readonly<PaneSwapProps>): HTMLElement | null {
    if (previous.paneKey === this.props.paneKey) return null;
    const old = standingPane(this.frame.current);
    if (old === null || typeof old.animate !== "function") return null;
    return old.cloneNode(true) as HTMLElement;
  }

  override componentDidUpdate(
    _previous: Readonly<PaneSwapProps>,
    _state: unknown,
    leaving: HTMLElement | null,
  ): void {
    const frame = this.frame.current;
    if (leaving === null || frame === null) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const out = reduced ? PANE_OUT_REDUCED_MS : PANE_OUT_MS;
    const entering = standingPane(frame);
    leaving.setAttribute("inert", "");
    leaving.setAttribute("aria-hidden", "true");
    leaving.classList.add("vf-wizard-pane-leaving");
    frame.append(leaving);
    const gone = (): void => leaving.remove();
    leaving
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: out,
        easing: "ease",
        fill: "forwards",
      })
      .finished.then(gone, gone);
    entering?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reduced ? PANE_IN_REDUCED_MS : PANE_IN_MS,
      delay: out,
      easing: "ease",
      fill: "backwards",
    });
  }

  override render(): ReactNode {
    return (
      <div ref={this.frame} className="vf-wizard-frame">
        {this.props.children}
      </div>
    );
  }
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

/** One pane in the frame (FG-L3): its head (the headline and a line of voice),
 * its body, and its foot — the actions, and the line under them, whose room
 * the glass always keeps, so the actions stand at one height on every step.
 * The band names the step on the glass, so the pane's eyebrow is drawn only in
 * the sheet, which has no band (FG-L7, FG-D26). */
export function WizardPane({
  eyebrow,
  title,
  voice,
  children,
  actions,
  later,
  onSubmit,
  centered = false,
  track,
}: {
  eyebrow: string;
  /** Words, or — for Setting up's welcome — one cell whose words cross-fade. */
  title: ReactNode;
  voice?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  /** The line under the actions: where a skip says the question's later home
   * (W3), or what a pane says last. */
  later?: ReactNode;
  /** The opening welcome is intentionally quieter than the question panes. */
  centered?: boolean;
  /** TS's panes keep their own rhythm in the body, 18 between its parts. */
  track?: "ts" | undefined;
  /** Enter advances: the primary action is the form's submit button, so the
   * keyboard path is the same object as the pointer path. */
  onSubmit?: () => void;
}): ReactElement {
  const size = useContext(WizardFrameSize);
  return (
    <form
      className="vf-wizard-pane"
      data-centered={centered ? "true" : undefined}
      data-track={track}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <div className="vf-wizard-pane-head">
        {size === "sheet" && <span className={eyebrowCls}>{eyebrow}</span>}
        <h1 className="text-[28px] font-light leading-[1.15] tracking-[-0.02em] text-black dark:text-white">
          {title}
        </h1>
        {voice !== undefined && <p className={voiceCls}>{voice}</p>}
      </div>
      <div className="vf-wizard-pane-body">{children}</div>
      <div className="vf-wizard-pane-foot">
        <div className="vf-wizard-actions">{actions}</div>
        <p className="vf-wizard-later">{later}</p>
      </div>
    </form>
  );
}

/** The later home of a question put off on the Connect pane (W3): the link
 * lives on Settings → Devices since TS-3a (TS-D3), as the posture it was
 * followed by does (TS-6). */
export const LATER_ON_DEVICES = "Set up later — Settings → Devices";

/** Every skip names its later home (W3), on its pane's later line (`later`). */
export function SkipAction({ label, onSkip }: { label: string; onSkip: () => void }): ReactElement {
  return (
    <button type="button" className={quietCls} onClick={onSkip}>
      {label}
    </button>
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
