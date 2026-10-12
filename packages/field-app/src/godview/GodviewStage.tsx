import { ChromeBoundary } from "@vibecook/puppeteer-views";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type GodviewDeckState, publishGodviewDeck } from "../frame/deck-door";
import { peekHost } from "../host";
import { getRendererLogger } from "../logging";
import { DECK_FALL_MS, DECK_RISE_MS, DECK_TRAVEL_GRACE_MS, deckAfter } from "./deck-state";
import { type DeckTravel, useDeckWrapperWitness } from "./deck-wrapper-witness";
import { DeckGroove, GodviewDeckEdge } from "./GodviewDeckEdge";
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
  const travel = useDeckTravel(deckState);
  const away = deckState === "away";
  // The Lip's minimize and a let-go past the line ask the owner the same
  // thing; a stage with no owner (a picture) asks nothing and says nothing.
  const minimize =
    onDeckState === undefined ? undefined : () => onDeckState(deckAfter(deckState, "minimize"));
  // Held past the line, the stage says what letting go would do (§8, §9).
  const [readout, setReadout] = useState(false);
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
    deck: deckRef,
    body: bodyRef,
  });
  return (
    <div
      aria-hidden={!open}
      data-godview-open={open ? "true" : "false"}
      data-godview-tuning-open={tuningOpen ? "true" : "false"}
      data-godview-animations={animations ? "on" : "off"}
      data-godview-deck={deckState}
      {...(travel !== null ? { "data-godview-deck-motion": travel } : {})}
      // an edge PLACES the sheet (godview.css): without one — Settings'
      // miniature — the sheet stays in the flow under its own monitor
      {...(deckEdge ? { "data-godview-deck-edge": "" } : {})}
      className={`vf-godview theme-${theme} ${className}`.trim()}
      style={style}
    >
      <div className="vf-godview-scanlines" aria-hidden="true" />
      <div className="vf-godview-vignette" aria-hidden="true" />
      {monitor}
      {tuningPanel}
      {/* The deck is a sheet over the monitor (§8): the Lip along its top
          edge, then the well set into the frame, and in the well the body —
          the positioned box every deck face fills (`inset: 0`), so the faces
          never learn the lip or the well is there. */}
      <section
        ref={deckRef}
        className="vf-godview-terminal-deck relative min-h-0 flex-1"
        aria-label="Terminal panes"
        inert={away}
      >
        {deckEdge ? (
          // M49 — the edge is chrome too: a throw in it says so in the lip's
          // place, and it tries again only when what it is handed changes
          <ChromeBoundary name="Deck edge" retryKey={`${deckEdge.persist}:${monitorPresent}`}>
            <GodviewDeckEdge
              persist={deckEdge.persist}
              monitorPresent={monitorPresent}
              away={away}
              {...(minimize !== undefined ? { onMinimize: minimize, onReadout: setReadout } : {})}
            />
          </ChromeBoundary>
        ) : (
          <div className="vf-godview-deck-lip" aria-hidden="true">
            <DeckGroove />
          </div>
        )}
        {minimize !== undefined ? <DeckControls onMinimize={minimize} /> : null}
        <div className="vf-godview-deck-well">
          <div ref={bodyRef} className="vf-godview-terminal-deck-body">
            {deck}
          </div>
        </div>
      </section>
      {deckEdge && minimize !== undefined && monitorPresent ? <DeckReadout on={readout} /> : null}
    </div>
  );
}

/**
 * THE READOUT WHILE THE EDGE IS HELD (DESIGN.md §8 "A let-go decides", §9; James,
 * 29 Sep: a readout is huge bold words in open space). Past the line, what
 * letting go would do — *Minimize* the terminals — written on the monitor,
 * centred between y 60 and the edge, over a veil of the monitor's ground down
 * to 26 above it, both under the sheet. Placed by `godview.css` from the held
 * edge on the root, so a move re-renders nothing here. (*Maximize* is the next
 * slice's.) A picture for the eye: the keys never minimize, so it is not
 * spoken.
 */
function DeckReadout({ on }: { on: boolean }): ReactElement {
  const state = on ? "true" : "false";
  return (
    <>
      <div className="vf-godview-deck-veil" data-on={state} aria-hidden="true" />
      <div className="vf-godview-deck-readout" data-on={state} aria-hidden="true">
        <b>
          <i>Minimize</i> the terminals
        </b>
      </div>
    </>
  );
}

/**
 * THE LIP'S BUTTONS (GV-D7; DESIGN.md §8 "The Lip's two buttons", §9, §13): at
 * the lip's right end, minimize — then maximize, once the terminals can be
 * maximized; a button that does nothing is not drawn. Beside the separator,
 * never in it: the whole lip drags the edge but never its buttons, and a
 * separator's children are presentational to assistive technology.
 */
function DeckControls({ onMinimize }: { onMinimize: () => void }): ReactElement {
  return (
    <div className="vf-godview-deck-controls">
      <button
        type="button"
        className="vf-godview-deck-control"
        title="Minimize — every session keeps running"
        aria-label="Minimize the terminals"
        onClick={onMinimize}
      >
        <FieldGlyph name="minimize" size={14} />
      </button>
    </div>
  );
}

/**
 * THE RISE AND THE FALL (DESIGN.md §6 "The terminals rise and fall"; §8 "One
 * resize per change"). The travel between two states, said on the stage's root
 * for the stylesheet, which draws each as a CSS transition of the sheet's
 * `transform` (M3) — never an animated edge:
 *
 *   fall — minimized: the sheet keeps its layout and travels down at the size
 *          it HAS (300ms, the retract curve); on arrival the stylesheet takes it
 *          out of the flow at that same box, and it is not laid out again.
 *   rise — called up from away: the sheet is laid out at its END size at once
 *          (the same box it was kept at) and travels up to it (480ms, island).
 *          A call during a fall turns it round from where it is.
 *
 * Started in the render that sees the change, so the commit that draws the new
 * state draws its travel with it; ended by a timer of the travel's length and
 * a little grace, so the last frame is drawn before the layout changes under
 * it — never by `transitionend`, which a transition that never ran (a hidden
 * window) never sends. Reduced motion: no travel, the deck is at its end at
 * once (M6).
 */
function useDeckTravel(state: GodviewDeckState): DeckTravel {
  const [travel, setTravel] = useState<DeckTravel>(null);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    const next: DeckTravel = reducedMotion()
      ? null
      : state === "away"
        ? "fall"
        : seen === "away"
          ? "rise"
          : null;
    if (next !== travel) setTravel(next);
  }
  useEffect(() => {
    if (travel === null) return;
    const timer = window.setTimeout(
      () => setTravel(null),
      (travel === "fall" ? DECK_FALL_MS : DECK_RISE_MS) + DECK_TRAVEL_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [travel]);
  return travel;
}

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
