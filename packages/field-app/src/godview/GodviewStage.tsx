import type { CSSProperties, ReactElement, ReactNode } from "react";
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
  className = "",
}: GodviewStageProps): ReactElement {
  return (
    <div
      aria-hidden={!open}
      data-godview-open={open ? "true" : "false"}
      data-godview-tuning-open={tuningOpen ? "true" : "false"}
      data-godview-animations={animations ? "on" : "off"}
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
          <GodviewDeckEdge
            persist={deckEdge.persist}
            monitorPresent={monitor !== undefined && monitor !== null && monitor !== false}
          />
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
