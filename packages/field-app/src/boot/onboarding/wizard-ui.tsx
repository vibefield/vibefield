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
import { useFieldGlass, useFieldStill } from "../field-glass";
import { ease, logoBox } from "../splash/field-mark";
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

/** The hand-over (FG-5; DESIGN.md §6), as the glass plays it: its words go
 * (`words`: the line, the steps and the theme control), so the logo holds
 * alone; then the glass clears (`clear`) as the field's mark takes over from
 * the logo. BootRoot steps it; the stylesheet plays each step. */
export type WizardLeaving = "words" | "clear";

/** The band's state (FG-D22 A): the chapter's steps, in order (`stepsOf`), and
 * the step the pane stands in (`STEP_OF`) — none where the band is absent. */
export interface WizardBand {
  steps: readonly WizardStep[];
  at: WizardStep | null;
  /** How far the step it stands in has come, 0 … 1, where the work says so
   * (FG-4b): Setting up's segment fills with the boot's own progress, then
   * stands full. Absent, the segment fills as you arrive. */
  progress?: number | undefined;
}

/** What a pane stands in, told by the shell around it: the glass's one frame,
 * where the band names the step (FG-L3), or Finish setting up's sheet, which
 * keeps its panes as they stood before FG (FG-D26). */
const WizardFrameSize = createContext<WizardSize>("glass");

/** What the pane stands in: a load holds only on the glass, and the sheet keeps
 * its panes as they stood (FG-D26). */
export function useWizardFrame(): WizardSize {
  return useContext(WizardFrameSize);
}

/** The face a pane wears in the frame (FG-4b): the frame fades only from one
 * face to another. A pane's is its step's, the shell's `paneKey`, so a pane's
 * own changes never fade; a hold names its own. */
const WizardFace = createContext("pane");

/** One persistent glass around every step (FG-L2). The question inside
 * changes; the glass, its band and the theme control never resize or remount
 * around it. */
export function WizardShell({
  children,
  ground,
  size,
  band,
  paneKey,
  leaving,
}: {
  children: ReactNode;
  ground?: WizardGround | undefined;
  size?: WizardSize | undefined;
  band?: WizardBand | undefined;
  /** Which pane stands in the frame: a new key fades the old pane out first. */
  paneKey?: string | undefined;
  /** How far the hand-over has come (FG-5); absent until it begins. */
  leaving?: WizardLeaving | undefined;
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
      leaving={leaving}
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
 * frost. On the live field the field draws those layers and the logo
 * (`useFieldGlass`, `data-glass`). Only the glass takes a press: around it the
 * ground lets one through to what holds it (the sheet's scrim closes it). From
 * the hand-over's first step it takes none (`data-leaving`, FG-5). */
export function WizardShellView({
  children,
  dark,
  onToggleTheme,
  ground = "app",
  size = "glass",
  band,
  paneKey,
  leaving,
}: {
  children: ReactNode;
  dark: boolean;
  onToggleTheme: () => void;
  ground?: WizardGround | undefined;
  size?: WizardSize | undefined;
  band?: WizardBand | undefined;
  paneKey?: string | undefined;
  leaving?: WizardLeaving | undefined;
}): ReactElement {
  const groundRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const frostRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const fit = useGlassFit(groundRef, glassRef, size === "glass");
  const still = useFieldStill();
  const drawn = useFieldGlass(glassRef, shadowRef, frostRef, logoRef, ground === "field");
  const [logo, setLogo] = useState(false);
  return (
    <div
      ref={groundRef}
      className="vf-wizard-ground"
      style={fit === null ? undefined : groundStyle(fit, still)}
    >
      <div className="vf-wizard-fit">
        <div
          ref={glassRef}
          className="vf-wizard-shell"
          data-ground={ground}
          data-size={size}
          data-glass={drawn ? "field" : undefined}
          data-logo={logo ? "shown" : undefined}
          data-leaving={leaving}
          inert={leaving !== undefined}
        >
          <div ref={shadowRef} className="vf-wizard-glass-shadow" />
          <div ref={frostRef} className="vf-wizard-glass-frost" />
          <div className="vf-wizard-glass-grain" />
          <div className="vf-wizard-glass-edge" />
          {size === "glass" && <div ref={logoRef} className="vf-wizard-logo" aria-hidden="true" />}
          {band !== undefined && <WizardSteps band={band} />}
          <ThemeToggleButton
            dark={dark}
            onToggle={onToggleTheme}
            className="vf-wizard-theme no-drag absolute top-5 right-5"
          />
          <WizardFrameSize.Provider value={size}>
            <WizardFace.Provider value={paneKey ?? "pane"}>
              {size === "glass" ? (
                <PaneSwap onLogo={setLogo}>{children}</PaneSwap>
              ) : (
                <div className="vf-wizard-frame">{children}</div>
              )}
            </WizardFace.Provider>
          </WizardFrameSize.Provider>
        </div>
      </div>
    </div>
  );
}

/** The ground's custom properties: the glass's fit (FG-L2), and the logo's box
 * in the glass's own px, so the logo stands at the size of the field's mark on
 * the screen however far the glass is scaled (FG-4b). */
function groundStyle({ fit, width, height }: GlassFit, still: boolean): CSSProperties {
  const logo = logoBox(width, height, still);
  return {
    "--vf-glass-fit": String(fit),
    "--vf-wizard-logo-width": `${logo.width / fit}px`,
    "--vf-wizard-logo-height": `${logo.height / fit}px`,
  } as CSSProperties;
}

/** How long a pane takes to leave and to arrive, and the logo to leave before
 * the next words come (DESIGN.md §6, §8 "The Setup Assistant's glass"; FG-L3);
 * halved and more under Reduce Motion, as the page plays them. The logo's own
 * fades are the stylesheet's (`--vf-glass-logo`). */
const PANE_MOTION = {
  full: { out: 120, in: 240, logoOut: 280 },
  reduced: { out: 60, in: 160, logoOut: 120 },
} as const;
type PaneMotion = (typeof PANE_MOTION)[keyof typeof PANE_MOTION];

/** A load's floor (DESIGN.md §6, FG-4b): a hold that has begun to show stands
 * this long before its words and the logo leave — the logo's 400 in, then a
 * beat to read the line. */
const HOLD_FLOOR_MS = 800;

const LEAVING = "vf-wizard-pane-leaving";

/** A pane as the frame saw it arrive. */
interface Standing {
  readonly root: HTMLElement;
  readonly face: string;
  readonly hold: boolean;
  /** when it was mounted (`performance.now()`), so its leaving copy's own fades
   * resume as old as it is */
  readonly addedAt: number;
  /** when its fade in begins */
  readonly enterAt: number;
}

/** The last pane that was seen, and when it begins to leave: whatever comes
 * after it follows it, even past a pane that was never seen. */
interface Left {
  readonly from: Standing;
  readonly at: number;
}

interface PaneSwapProps {
  children: ReactNode;
  /** The frame shows the logo while a hold stands, and says when. */
  onLogo: (shown: boolean) => void;
}

const reducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** The root standing in the frame: its own, never a leaving copy. */
function standingRoot(frame: HTMLElement): HTMLElement | null {
  const root = Array.from(frame.children)
    .reverse()
    .find((child) => child.hasAttribute("data-face") && !child.classList.contains(LEAVING));
  return root instanceof HTMLElement ? root : null;
}

/** A pane's fade in from `enterAt`: until then it waits under the leaving copy,
 * held clear. One whose fade in has begun keeps its place in it. */
function enter(root: HTMLElement, enterAt: number, now: number, motion: PaneMotion): void {
  if (typeof root.animate !== "function" || now >= enterAt + motion.in) return;
  root.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: motion.in,
    delay: enterAt - now,
    easing: "ease",
    fill: "backwards",
  });
}

/** The leaving copy's opacity from `now` until it is gone: from where its own
 * fade in had come, whole by `arrived`, whole until `at` (a hold's floor), then
 * out. */
export function leavingFrames(
  from: number,
  arrived: number,
  at: number,
  now: number,
  out: number,
): { readonly keyframes: Keyframe[]; readonly duration: number } {
  const duration = at - now + out;
  if (at <= now)
    return { keyframes: [{ opacity: from, easing: "ease" }, { opacity: 0 }], duration };
  const offset = (time: number): number => Math.min(1, Math.max(0, (time - now) / duration));
  return {
    keyframes: [
      { offset: 0, opacity: from, easing: "ease-out" },
      { offset: offset(arrived), opacity: 1 },
      { offset: offset(at), opacity: 1, easing: "ease" },
      { offset: 1, opacity: 0 },
    ],
    duration,
  };
}

/** The pane that leaves: a still copy laid over the frame, inert and hidden from
 * assistive tech, its own fades resumed as old as the pane was
 * (`--vf-wizard-age`), and each timed part of it (`data-born`: a line, a way
 * out) as old as that part was, so a way out it had not shown yet stays hidden
 * and a line keeps its place in its crossfade. */
function leave(
  frame: HTMLElement,
  was: Standing,
  at: number,
  now: number,
  motion: PaneMotion,
): void {
  if (typeof frame.animate !== "function") return;
  const copy = was.root.cloneNode(true) as HTMLElement;
  copy.setAttribute("inert", "");
  copy.setAttribute("aria-hidden", "true");
  copy.classList.add(LEAVING);
  copy.style.setProperty("--vf-wizard-age", `${Math.round(now - was.addedAt)}ms`);
  for (const part of copy.querySelectorAll<HTMLElement>("[data-born]")) {
    part.style.setProperty("--vf-wizard-age", `${Math.round(now - Number(part.dataset.born))}ms`);
  }
  frame.append(copy);
  const from = ease((now - was.enterAt) / motion.in);
  const { keyframes, duration } = leavingFrames(from, was.enterAt + motion.in, at, now, motion.out);
  const gone = (): void => copy.remove();
  copy.animate(keyframes, { duration, fill: "forwards" }).finished.then(gone, gone);
}

/** The frame (FG-L3, FG-4b), where a pane only fades in, and the one it
 * replaces fades out first. It watches its own children: a new root with a new
 * face (`data-face`) fades, while one with the same face — a pane's own
 * redraw, a load's fallback and then the view it waited for — is carried with
 * the fade it had. The old pane leaves as a still copy laid over the frame
 * while the new one, mounted at once, waits under it. A pane replaced before
 * its fade in began was never seen: what comes next follows the one before it.
 * A hold (`data-hold`) that has begun to show stands its floor before it leaves;
 * the logo shows while a hold stands — in once the last words are out, out
 * before the next words come, which wait for it. A host that cannot animate
 * swaps at once. */
class PaneSwap extends Component<PaneSwapProps> {
  private readonly frame = createRef<HTMLDivElement>();
  private observer: MutationObserver | null = null;
  private standing: Standing | null = null;
  private left: Left | null = null;
  private logo = false;
  private logoTimer: ReturnType<typeof setTimeout> | undefined;

  override componentDidMount(): void {
    const frame = this.frame.current;
    if (frame === null) return;
    this.observer = new MutationObserver(() => this.settle());
    this.observer.observe(frame, { childList: true });
    this.settle();
  }

  override componentWillUnmount(): void {
    this.observer?.disconnect();
    clearTimeout(this.logoTimer);
  }

  /** A root came or went. */
  private settle(): void {
    const frame = this.frame.current;
    if (frame === null) return;
    const root = standingRoot(frame);
    const was = this.standing;
    if (root === (was?.root ?? null)) return;
    const now = performance.now();
    const motion = reducedMotion() ? PANE_MOTION.reduced : PANE_MOTION.full;
    if (root !== null && was !== null && root.dataset.face === was.face) {
      // its own fades start again with it; its fade in and its floor are the face's
      this.standing = { ...was, root, addedAt: now };
      enter(root, was.enterAt, now, motion);
      return;
    }
    if (was !== null && now >= was.enterAt) {
      const at = was.hold ? Math.max(now, was.enterAt + HOLD_FLOOR_MS) : now;
      this.left = { from: was, at };
      leave(frame, was, at, now, motion);
    }
    if (root === null) {
      this.standing = null;
      this.showLogo(false, this.left?.at ?? now, now);
      return;
    }
    const face = root.dataset.face ?? "";
    const hold = root.hasAttribute("data-hold");
    const left = this.left;
    if (left === null) {
      // the first pane arrives with the glass
      this.standing = { root, face, hold, addedAt: now, enterAt: now };
      enter(root, now, now, motion);
      this.showLogo(hold, now, now);
      return;
    }
    // the next words wait for the last ones to go, and for the logo when it goes;
    // after an empty frame, from now
    const after =
      left.at + (left.from.hold && !hold ? Math.max(motion.out, motion.logoOut) : motion.out);
    const enterAt = was === null ? Math.max(now, after) : after;
    this.standing = { root, face, hold, addedAt: now, enterAt };
    enter(root, enterAt, now, motion);
    if (left.from.hold === hold) this.showLogo(hold, now, now);
    else this.showLogo(hold, hold ? enterAt : left.at, now);
  }

  /** The logo shows or goes at `at` — at once if that has come. */
  private showLogo(shown: boolean, at: number, now: number): void {
    clearTimeout(this.logoTimer);
    this.logoTimer = undefined;
    if (at > now) {
      this.logoTimer = setTimeout(() => this.tellLogo(shown), at - now);
      return;
    }
    this.tellLogo(shown);
  }

  private tellLogo(shown: boolean): void {
    if (this.logo === shown) return;
    this.logo = shown;
    this.props.onLogo(shown);
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

/** The glass's fit to its ground, and the ground's size, which the logo's box
 * is read from (the window on the field). */
interface GlassFit {
  readonly fit: number;
  readonly width: number;
  readonly height: number;
}

/** The glass's fit to its ground, measured before the first paint and again
 * whenever the ground resizes: the window on the field, a frame in the
 * catalog. None where the glass is not fitted (the sheet's, FG-D26). */
function useGlassFit(
  groundRef: RefObject<HTMLDivElement | null>,
  glassRef: RefObject<HTMLDivElement | null>,
  fitted: boolean,
): GlassFit | null {
  const [fit, setFit] = useState<GlassFit>({ fit: 1, width: 0, height: 0 });
  useLayoutEffect(() => {
    const ground = groundRef.current;
    const glass = glassRef.current;
    if (!fitted || ground === null || glass === null) return;
    const measure = (): void => {
      const width = ground.clientWidth;
      const height = ground.clientHeight;
      const next = glassFit(
        { width, height },
        { width: glass.offsetWidth, height: glass.offsetHeight },
      );
      setFit((was) =>
        was.fit === next && was.width === width && was.height === height
          ? was
          : { fit: next, width, height },
      );
    };
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
 * in it moves: a segment fills as you arrive and empties as you go back, or
 * fills with the work's own progress where the band carries it (Setting up,
 * FG-4b). It fades away where the pane stands in no step, and the first time it
 * shows, its segments fill from empty. */
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
          const progress = state === "now" ? band.progress : undefined;
          return (
            <li
              key={step}
              data-step={step}
              data-state={state}
              data-progress={progress === undefined ? undefined : "true"}
              style={
                progress === undefined
                  ? undefined
                  : ({
                      "--vf-wizard-progress": String(Math.min(1, Math.max(0, progress))),
                    } as CSSProperties)
              }
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
 * the sheet, which has no band (FG-L7, FG-D26). It wears its step's face, a
 * new root for a new face, so the frame can fade from one to the next. */
export function WizardPane({
  eyebrow,
  title,
  voice,
  children,
  actions,
  later,
  onSubmit,
  track,
}: {
  eyebrow: string;
  title: ReactNode;
  voice?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  /** The line under the actions: where a skip says the question's later home
   * (W3), or what a pane says last. */
  later?: ReactNode;
  /** TS's panes keep their own rhythm in the body, 18 between its parts. */
  track?: "ts" | undefined;
  /** Enter advances: the primary action is the form's submit button, so the
   * keyboard path is the same object as the pointer path. */
  onSubmit?: () => void;
}): ReactElement {
  const size = useContext(WizardFrameSize);
  const face = useContext(WizardFace);
  return (
    <form
      key={face}
      className="vf-wizard-pane"
      data-face={face}
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

/** A load (FG-L5, FG-D20; DESIGN.md §8): the logo and one line. It spans the
 * glass — its rows `1fr | the logo | 1fr`, so the logo's row is where the field
 * draws its mark — and says its words 26 under the logo: the line and its sub
 * (`WizardStatus`), and a way out only once the load runs long
 * (`WizardHoldOut`). The frame shows the logo while a hold stands, and keeps one
 * that has begun to show for its floor (DESIGN.md §6). A hold names its own
 * face, a new root for a new face, so the frame fades from the pane before it
 * and to the pane after it. The welcome is a hold too, as a title card
 * (`card`): its words 30 under the logo. A hold stands only on the glass; the
 * sheet keeps its panes (`useWizardFrame`, FG-D26). */
export function WizardHold({
  face,
  card = false,
  onSubmit,
  children,
}: {
  face: string;
  card?: boolean;
  /** Enter's act, where the hold has one: the welcome's Get started. */
  onSubmit?: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <form
      key={face}
      className="vf-wizard-hold"
      data-face={face}
      data-hold={card ? "card" : "line"}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <div className="vf-wizard-hold-words">{children}</div>
    </form>
  );
}

/** A hold's line crossfading, as the stylesheet plays it (DESIGN.md §8): the
 * words standing out, then the next in; halved and more under Reduce Motion. */
const STATUS_MOTION = {
  full: { out: 140, in: 240 },
  reduced: { out: 60, in: 120 },
} as const;
type StatusMotion = (typeof STATUS_MOTION)[keyof typeof STATUS_MOTION];

interface StatusWords {
  readonly line: string;
  readonly sub: ReactNode;
  readonly ink: boolean;
}

/** The words standing: when they came (`performance.now()`), and how much of
 * their wait to fade in had already passed — words that replace words never
 * seen take their place in the crossfade. */
interface StandingWords extends StatusWords {
  readonly at: number;
  readonly ahead: number;
}

/** The words leaving, from the opacity they had come to, since `at`. */
interface LeavingWords extends StatusWords {
  readonly key: number;
  readonly at: number;
  readonly from: number;
}

interface StatusState {
  readonly standing: StandingWords;
  readonly leaving: LeavingWords | null;
  /** Whether a line has followed another: the first stands at once, with the hold. */
  readonly moved: boolean;
  /** The leaves so far, so each leaving is drawn afresh. */
  readonly leaves: number;
}

/** The next line: the words standing leave from where they had come to; words
 * that had not begun to show never do — the next take their place, and what
 * was leaving goes on leaving. */
export function crossfade(
  was: StatusState,
  next: StatusWords,
  now: number,
  motion: StatusMotion,
): StatusState {
  const { standing } = was;
  const waited = now - standing.at + standing.ahead;
  if (was.moved && waited < motion.out) {
    return { ...was, standing: { ...next, at: now, ahead: waited } };
  }
  return {
    standing: { ...next, at: now, ahead: 0 },
    leaving: {
      line: standing.line,
      sub: standing.sub,
      ink: standing.ink,
      key: was.leaves + 1,
      at: now,
      from: was.moved ? ease((waited - motion.out) / motion.in) : 1,
    },
    moved: true,
    leaves: was.leaves + 1,
  };
}

/** A hold's line (FG-L5): what the load is doing, and under it its sub, both in
 * tabular figures so their numbers count in place. A new line crossfades in
 * its one cell (140ms out, then 240ms in) with the sub it brings; a new sub
 * under the same line is only its numbers moving, so it changes where it
 * stands. `ink` sets the line in ink: Setting up's welcome. */
export function WizardStatus({
  line,
  sub,
  ink = false,
}: {
  line: string;
  sub?: ReactNode;
  ink?: boolean;
}): ReactElement {
  const [state, setState] = useState<StatusState>(() => ({
    standing: { line, sub, ink, at: performance.now(), ahead: 0 },
    leaving: null,
    moved: false,
    leaves: 0,
  }));
  const { standing, leaving, moved } = state;
  // the words follow the props in the render that brings them, so a line
  // replaced before it showed is never drawn
  if (standing.line !== line) {
    const motion = reducedMotion() ? STATUS_MOTION.reduced : STATUS_MOTION.full;
    setState(crossfade(state, { line, sub, ink }, performance.now(), motion));
  } else if (standing.sub !== sub || standing.ink !== ink) {
    setState({ ...state, standing: { ...standing, sub, ink } });
  }
  return (
    <div className="vf-wizard-status" role="status">
      {leaving !== null && (
        <div
          key={`out ${leaving.key}`}
          className="vf-wizard-status-words"
          data-state="out"
          data-ink={leaving.ink ? "true" : undefined}
          data-born={leaving.at}
          aria-hidden="true"
          style={{ "--vf-wizard-from": String(leaving.from) } as CSSProperties}
          onAnimationEnd={() =>
            setState((now) => (now.leaving?.key === leaving.key ? { ...now, leaving: null } : now))
          }
        >
          <p className="vf-wizard-status-line">{leaving.line}</p>
          <p className="vf-wizard-status-sub">{leaving.sub}</p>
        </div>
      )}
      <div
        key={`in ${standing.line}`}
        className="vf-wizard-status-words"
        data-state={moved ? "in" : undefined}
        data-ink={standing.ink ? "true" : undefined}
        data-born={standing.at}
        style={
          standing.ahead > 0
            ? ({ "--vf-wizard-ahead": `${Math.round(standing.ahead)}ms` } as CSSProperties)
            : undefined
        }
      >
        <p className="vf-wizard-status-line">{standing.line}</p>
        <p className="vf-wizard-status-sub">{standing.sub}</p>
      </div>
    </div>
  );
}

/** A hold's way out (FG-L5; FG-O7 (a)), under its words: shown only once the
 * load has run long — 6s on the stylesheet's clock, from when it came — or,
 * `now`, as soon as it is given: Setting up's Start now, which AO-D4's 8s
 * already waited for. */
export function WizardHoldOut({
  now = false,
  children,
}: {
  now?: boolean;
  children: ReactNode;
}): ReactElement {
  const [born] = useState(() => performance.now());
  return (
    <div className="vf-wizard-hold-out" data-late={now ? undefined : "true"} data-born={born}>
      {children}
    </div>
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
