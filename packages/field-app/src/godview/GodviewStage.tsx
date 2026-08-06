import type { CSSProperties, ReactElement, ReactNode } from "react";
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
      <section
        className="vf-godview-terminal-deck relative min-h-0 flex-1"
        aria-label="Terminal panes"
      >
        {deck}
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
