import { ChromeBoundary } from "@vibecook/puppeteer-views";
import { type CSSProperties, type ReactElement, type ReactNode, useEffect } from "react";
import { type GodviewDeckState, publishGodviewDeck } from "../frame/deck-door";
import { GodviewDeckEdge } from "./GodviewDeckEdge";
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
  /** The deck's movable edge (DESIGN.md §8, 2026-09-28). Absent, the lip is
   * drawn and the edge stays at rest — the Settings miniature is a picture. */
  deckEdge?: { persist: boolean };
  /** The terminals' wrapper: away, up or maximized (round 3, GV-D5/D6/D11).
   * The stage only draws it — written on the root beside the three attributes
   * above, for the stylesheet. Its owner is the overlay. Today the deck is
   * always up. */
  deckState?: GodviewDeckState;
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
  return (
    <div
      aria-hidden={!open}
      data-godview-open={open ? "true" : "false"}
      data-godview-tuning-open={tuningOpen ? "true" : "false"}
      data-godview-animations={animations ? "on" : "off"}
      data-godview-deck={deckState}
      className={`vf-godview theme-${theme} ${className}`.trim()}
      style={style}
    >
      <div className="vf-godview-scanlines" aria-hidden="true" />
      <div className="vf-godview-vignette" aria-hidden="true" />
      {monitor}
      {tuningPanel}
      {/* The deck is a sheet over the monitor (§8): its lip is the tab along
          the top edge, and the body is the positioned box every deck face
          fills (`inset: 0`), so the faces never learn the lip is there. */}
      <section
        className="vf-godview-terminal-deck relative min-h-0 flex-1"
        aria-label="Terminal panes"
      >
        {deckEdge ? (
          // M49 — the edge is chrome too: a throw in it says so in the lip's
          // place, and it tries again only when what it is handed changes
          <ChromeBoundary name="Deck edge" retryKey={`${deckEdge.persist}:${monitorPresent}`}>
            <GodviewDeckEdge persist={deckEdge.persist} monitorPresent={monitorPresent} />
          </ChromeBoundary>
        ) : (
          <div className="vf-godview-deck-lip" aria-hidden="true" />
        )}
        <div className="vf-godview-terminal-deck-body">{deck}</div>
      </section>
    </div>
  );
}

export function GodviewUnavailableDeck(): ReactElement {
  return (
    <p className="vf-godview-unavailable">
      THIS HOST HAS NO TERMINAL BRIDGE — THE DECK IS UNAVAILABLE HERE.
    </p>
  );
}
