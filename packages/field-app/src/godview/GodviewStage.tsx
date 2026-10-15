import { ChromeBoundary } from "@vibecook/puppeteer-views";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
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
import { type GodviewDeckState, publishGodviewDeck } from "../frame/deck-door";
import { peekHost } from "../host";
import { getRendererLogger } from "../logging";
import {
  DECK_FALL_MS,
  DECK_RISE_MS,
  DECK_TRAVEL_GRACE_MS,
  type DeckAct,
  deckAfter,
} from "./deck-state";
import { type DeckTravel, useDeckWrapperWitness } from "./deck-wrapper-witness";
import { DeckGroove, type DeckReadoutKind, GodviewDeckEdge } from "./GodviewDeckEdge";
import type { GodviewTheme } from "./GodviewTuningPanel";

export interface GodviewStageProps {
  open: boolean;
  theme: GodviewTheme;
  tuningOpen: boolean;
  animations: boolean;
  style?: CSSProperties;
  monitor?: ReactNode;
  tuningPanel?: ReactNode;
  deck: ReactNode;
  /** The deck's movable edge (DESIGN.md §8, 2026-09-28). Absent, the Lip is
   * drawn with its groove at rest and nothing moves — the Settings miniature
   * is a picture. */
  deckEdge?: { persist: boolean };
  /** The terminals' wrapper: away, up or maximized (round 3, GV-D5/D6/D11).
   * The stage only draws it — written on the root beside the three attributes
   * above, for the stylesheet, with the travel between two states. Its owner
   * is the overlay. */
  deckState?: GodviewDeckState;
  /** The owner's ear: the Lip's buttons ask for a state through it. Absent,
   * no button is drawn — a button that does nothing is not drawn (§8). */
  onDeckState?: (next: GodviewDeckState) => void;
  /** Only the window's Godview speaks for the window (`frame/deck-door.ts`),
   * as `publishesFind` does for the monitor: the catalog's stage and Settings'
   * miniature draw a state and say nothing. */
  publishesDeck?: boolean;
  /** W7 — the window's witness says when a lab's call (the markers' seam,
   * `deck-state.ts`) raised the terminals from away. */
  deckRaisedBy?: "lab" | null;
  /** LR (2026-10-15) — a question standing over the whole stage (the last
   * run's curtain): above the monitor and the sheet, under the CRT layers and
   * the head, so the view circles stay live. While it stands the sheet takes
   * no pointer, focus or key, as away. */
  curtain?: ReactNode;
  className?: string;
}

/** The visual shell shared by the live overlay and isolated design fixtures.
 * Runtime ownership stays outside: this component only establishes the exact
 * stage DOM, layer order, attributes, and terminal-deck slot. */
export function GodviewStage({
  open,
  theme,
  tuningOpen,
  animations,
  style,
  monitor,
  tuningPanel,
  deck,
  deckEdge,
  deckState = "up",
  onDeckState,
  publishesDeck = false,
  deckRaisedBy = null,
  curtain,
  className = "",
}: GodviewStageProps): ReactElement {
  const monitorPresent = monitor !== undefined && monitor !== null && monitor !== false;
  // The door's word and the root's attribute are one fact, said in one place.
  // Closed — Godview is not the window's view — it is withdrawn: the frame
  // must never read a deck it cannot see.
  const spoken = publishesDeck && open ? deckState : null;
  useEffect(() => {
    if (!publishesDeck) return;
    publishGodviewDeck(spoken);
  }, [publishesDeck, spoken]);
  useEffect(() => {
    if (!publishesDeck) return;
    return () => publishGodviewDeck(null);
  }, [publishesDeck]);
  // …and the shell hears the state by name (W5: main places the window's
  // lights and lends ⌘W by it). Not withdrawn with the view: main composes the
  // word with the view it owns, so ⌘2 back onto a maximized deck finds the
  // lights' place in its own step. Withdrawn only when this stage goes.
  useEffect(() => {
    if (!publishesDeck) return;
    tellShell(deckState);
  }, [publishesDeck, deckState]);
  useEffect(() => {
    if (!publishesDeck) return;
    return () => tellShell(null);
  }, [publishesDeck]);
  const deckRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** The next change of state is the hand's — a let-go above the fill line, a
   * drag or a key out of maximized — and takes no travel (L10, GV-D11). */
  const atOnce = useRef(false);
  const { travel, layout } = useDeckTravel(deckState, atOnce, deckRef);
  const away = deckState === "away";
  const maximized = deckState === "maximized";
  const curtained = curtain !== undefined && curtain !== null && curtain !== false;
  // The owner's acts. The Lip's buttons ask with a travel; the edge's hand
  // asks at once. A stage with no owner (a picture) asks nothing and draws no
  // button.
  const ask = (act: DeckAct, now: boolean): void => {
    if (onDeckState === undefined) return;
    atOnce.current = now;
    onDeckState(deckAfter(deckState, act));
  };
  const owned = onDeckState !== undefined;
  // Held past either line, the stage says what letting go would do (§8, §9).
  const [readout, setReadout] = useState<DeckReadoutKind | null>(null);
  // Away, the deck takes no pointer, no focus and no key (§8 "Minimized"):
  // the sheet is inert, and a pane that held the keyboard lets it go — before
  // the paint, so not one key reaches a hidden pane.
  useLayoutEffect(() => {
    if (!away) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && deckRef.current?.contains(focused) === true) {
      focused.blur();
    }
  }, [away]);
  // The wrapper's facts for the deck's marker — the window's stage only, and
  // only while the markers are on (`deck-wrapper-witness.ts`).
  useDeckWrapperWitness({
    enabled: publishesDeck,
    state: deckState,
    travel,
    raisedBy: deckRaisedBy,
    deck: deckRef,
    body: bodyRef,
  });
  // The maximized deck's ink, for the one search button standing in its title
  // bar — the frame's, outside this stage (§8 "Search — the Peek"): the window's
  // stage lends it on the document while the terminals are maximized.
  useLayoutEffect(() => {
    const root = deckRef.current?.closest<HTMLElement>(".vf-godview");
    if (!publishesDeck || !maximized || !root) return;
    const page = document.documentElement;
    const ink = getComputedStyle(root).getPropertyValue("--deck-ink").trim();
    if (ink !== "") page.style.setProperty("--vf-godview-bar-ink", ink);
    return () => {
      page.style.removeProperty("--vf-godview-bar-ink");
    };
  }, [publishesDeck, maximized, style]);
  return (
    <div
      aria-hidden={!open}
      data-godview-open={open ? "true" : "false"}
      data-godview-tuning-open={tuningOpen ? "true" : "false"}
      data-godview-animations={animations ? "on" : "off"}
      data-godview-deck={deckState}
      // the layout drawn, which a fall out of maximized keeps until it arrives
      data-godview-deck-layout={layout}
      {...(travel !== null ? { "data-godview-deck-motion": travel } : {})}
      // an edge PLACES the sheet (godview.css): without one — Settings'
      // miniature — the sheet stays in the flow under its own monitor
      {...(deckEdge ? { "data-godview-deck-edge": "" } : {})}
      {...(curtained ? { "data-godview-curtain": "" } : {})}
      className={`vf-godview theme-${theme} ${className}`.trim()}
      style={style}
    >
      <div className="vf-godview-scanlines" aria-hidden="true" />
      <div className="vf-godview-vignette" aria-hidden="true" />
      {monitor}
      {tuningPanel}
      {/* where the sheet rests, held still whatever the sheet does — the
          edge measures rest off it (`deck-edge.ts`) */}
      {deckEdge ? <span className="vf-godview-deck-rest" aria-hidden="true" /> : null}
      {/* The deck is a sheet over the monitor (§8): the Lip along its top
          edge, then the well set into the frame, and in the well the body —
          the positioned box every deck face fills (`inset: 0`), so the faces
          never learn the lip or the well is there. */}
      <section
        ref={deckRef}
        className="vf-godview-terminal-deck relative min-h-0 flex-1"
        aria-label="Terminal panes"
        inert={away || curtained}
      >
        {deckEdge ? (
          // M49 — the edge is chrome too: a throw in it says so in the lip's
          // place, and it tries again only when what it is handed changes
          <ChromeBoundary name="Deck edge" retryKey={`${deckEdge.persist}:${monitorPresent}`}>
            <GodviewDeckEdge
              persist={deckEdge.persist}
              monitorPresent={monitorPresent}
              away={away}
              maximized={maximized}
              {...(owned
                ? {
                    onMinimize: () => ask("minimize", false),
                    onMaximize: () => ask("maximize", true),
                    onUp: (fall: boolean) => ask("restore", !fall),
                    onReadout: setReadout,
                  }
                : {})}
            />
          </ChromeBoundary>
        ) : (
          <div className="vf-godview-deck-lip" aria-hidden="true">
            <DeckGroove />
          </div>
        )}
        {owned ? (
          <DeckControls
            maximized={maximized}
            onMinimize={() => ask("minimize", false)}
            onMaximize={() => ask("maximize", false)}
            onRestore={() => ask("restore", false)}
          />
        ) : null}
        <div className="vf-godview-deck-well">
          <div ref={bodyRef} className="vf-godview-terminal-deck-body">
            {deck}
          </div>
        </div>
      </section>
      {deckEdge && owned && monitorPresent ? <DeckReadout says={readout} /> : null}
      {curtained ? curtain : null}
    </div>
  );
}

/**
 * THE READOUTS WHILE THE EDGE IS HELD (DESIGN.md §8 "A let-go decides", §9;
 * James, 29 Sep: a readout is huge bold words in open space). Past either line,
 * what letting go would do: *Minimize* the terminals — written on the monitor,
 * centred between y 60 and the edge, over a veil of the monitor's ground down
 * to 26 above it, both under the sheet — or *Maximize* the terminals — written
 * over the terminals, centred between the edge and the panes' foot, its veil
 * over the sheet from the edge down. Placed by `godview.css` from the held edge
 * on the root, so a move re-renders nothing here; the words stay the last said
 * while they fade. A picture for the eye: keys never minimize or maximize, so
 * it is not spoken.
 */
function DeckReadout({ says }: { says: DeckReadoutKind | null }): ReactElement {
  const [last, setLast] = useState<DeckReadoutKind>(says ?? "minimize");
  if (says !== null && says !== last) setLast(says);
  const on = says !== null ? "true" : "false";
  return (
    <>
      <div className="vf-godview-deck-veil" data-on={on} data-readout={last} aria-hidden="true" />
      <div className="vf-godview-deck-readout" data-on={on} data-readout={last} aria-hidden="true">
        <b>
          <i>{last === "minimize" ? "Minimize" : "Maximize"}</i> the terminals
        </b>
      </div>
    </>
  );
}

/**
 * THE LIP'S BUTTONS (GV-D7, GV-D11; DESIGN.md §8 "The Lip's two buttons", §9,
 * §13): at the lip's right end, minimize then maximize — the order windows keep
 * them. Maximized, the lip is the title bar and its end is a hairline, minimize
 * and restore (the frame's search button stands before the hairline — the
 * frame's one button, never a second one here). Beside the separator, never in
 * it: the whole lip drags the edge but never its buttons, and a separator's
 * children are presentational to assistive technology.
 */
function DeckControls({
  maximized,
  onMinimize,
  onMaximize,
  onRestore,
}: {
  maximized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onRestore: () => void;
}): ReactElement {
  return (
    <div className="vf-godview-deck-controls">
      {maximized ? <i className="vf-godview-deck-hair" aria-hidden="true" /> : null}
      <button
        type="button"
        className="vf-godview-deck-control"
        title="Minimize — every session keeps running"
        aria-label="Minimize the terminals"
        onClick={onMinimize}
      >
        <FieldGlyph name="minimize" size={14} />
      </button>
      {maximized ? (
        <button
          type="button"
          className="vf-godview-deck-control"
          title="Restore"
          aria-label="Restore the terminals to their place"
          onClick={onRestore}
        >
          <FieldGlyph name="restore" size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="vf-godview-deck-control"
          title="Maximize"
          aria-label="Maximize the terminals"
          onClick={onMaximize}
        >
          <FieldGlyph name="maximize" size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * THE RISE AND THE FALL (DESIGN.md §6 "The terminals rise and fall"; §8 "One
 * resize per change"). The travel between two states, said on the stage's root
 * for the stylesheet, which draws each as a CSS transition of the sheet's
 * `transform` (M3) — never an animated edge — with the LAYOUT the sheet is
 * drawn at:
 *
 *   fall     — minimized: the sheet keeps its layout and travels down at the
 *              size it HAS (300ms, the retract curve), and is not laid out
 *              again on arrival (it keeps its box away).
 *   rise     — called up from away: the sheet is laid out at its END size at
 *              once and travels up to it (480ms, island). A call during a fall
 *              turns it round from where it is.
 *   maximize — by the Lip's button: laid out at the window's top at once and
 *              travelling there from where its edge stood (480ms, island).
 *   restore  — by the title bar's restore, or a double-click on its grip: the
 *              state is up at once (the door says so), but the sheet travels
 *              down at the size it HAS (300ms, retract) and is laid out at its
 *              edge on arrival.
 *
 * A change the hand makes — a let-go above the fill line, a drag or a key out
 * of maximized — takes no travel: one layout, at once (`atOnce`).
 *
 * Started in the render that sees the change, so the commit that draws the new
 * state draws its travel with it; ended by a timer of the travel's length and
 * a little grace, so the last frame is drawn before the layout changes under
 * it — never by `transitionend`, which a transition that never ran (a hidden
 * window) never sends. Reduced motion: no travel, the deck is at its end at
 * once (M6).
 */
function useDeckTravel(
  state: GodviewDeckState,
  atOnce: { current: boolean },
  sheet: RefObject<HTMLElement | null>,
): { travel: DeckTravel; layout: DeckLayout } {
  const [travel, setTravel] = useState<DeckTravel>(null);
  const [layout, setLayout] = useState<DeckLayout>(state === "maximized" ? "maximized" : "up");
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    const still = reducedMotion() || atOnce.current;
    atOnce.current = false;
    let next: DeckTravel = null;
    if (state === "maximized") {
      setLayout("maximized");
      next = still ? null : "maximize";
    } else if (state === "away") {
      // the fall keeps the layout it had, maximized or up, and so does away
      next = reducedMotion() ? null : "fall";
    } else if (seen === "maximized") {
      // restored: a fall at the maximized size, laid out on arrival
      next = still ? null : "restore";
      if (next === null) setLayout("up");
    } else {
      // called up from away: laid out up at once, rising
      setLayout("up");
      next = reducedMotion() ? null : "rise";
    }
    if (next !== travel) setTravel(next);
  }
  // THE MAXIMIZE'S START: laid out at the window's top already, the sheet is
  // put back where its edge stood (rest and the shift) with no transition, and
  // let go to its end — the stylesheet's transition carries it (M3).
  useLayoutEffect(() => {
    const element = sheet.current;
    if (travel !== "maximize" || element === null) return;
    element.style.transition = "none";
    element.style.transform =
      "translateY(calc(var(--vf-godview-deck-rest) + var(--vf-godview-deck-shift, 0px)))";
    void element.offsetHeight;
    element.style.removeProperty("transition");
    element.style.removeProperty("transform");
  }, [travel, sheet]);
  useEffect(() => {
    if (travel === null) return;
    const falls = travel === "fall" || travel === "restore";
    const timer = window.setTimeout(
      () => {
        setTravel(null);
        if (travel === "restore") setLayout("up");
      },
      (falls ? DECK_FALL_MS : DECK_RISE_MS) + DECK_TRAVEL_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [travel]);
  return { travel, layout };
}

/** The sheet's layout: at its edge, or at the window's top (maximized). */
type DeckLayout = "up" | "maximized";

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/** The window's word to its shell — answered with what main holds, which the
 * page does not need; a refusal is logged, and the page's state stands. */
function tellShell(deck: GodviewDeckState | null): void {
  const shell = peekHost()?.deck;
  if (shell === undefined) return;
  void shell.set(deck).catch((error: unknown) => {
    getRendererLogger()
      .child({ component: "godview" })
      .error("renderer.godview.deck_set_refused", "The shell refused the deck's state", error);
  });
}

export function GodviewUnavailableDeck(): ReactElement {
  return (
    <p className="vf-godview-unavailable">
      THIS HOST HAS NO TERMINAL BRIDGE — THE DECK IS UNAVAILABLE HERE.
    </p>
  );
}
