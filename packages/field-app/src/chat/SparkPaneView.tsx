import type { CSSProperties, DOMAttributes, ReactElement, ReactNode, Ref } from "react";
import type { TerminalGroundStyle } from "../godview/deck-theme";
import { NO_TERMINALS } from "../terminal/terminal-words";
import type { SparkPanePlace } from "./thread-pane-door";

// THE THREAD'S PANE, DRAWN (SP-1d; DESIGN.md §8 "Chat's thread") — controller-free, so the catalog mounts this exact
// markup. Live, the spark's own terminal stands in a well painted in the terminal's own ground; otherwise the pane's
// place says why there is no pane, on the panel's own chrome, never a blank. The live surface is the controller's
// (`SparkPane.tsx`): a catalog holds no terminals, so it only ever draws the words.

/** The live pane: the spark's terminal in its well. */
export interface LiveSparkPaneViewProps
  extends Pick<DOMAttributes<HTMLDivElement>, "onPointerDown" | "onFocus" | "onBlur"> {
  readonly state: "live";
  /** the terminal's ground and ink, projected onto the well (`useDeckPaneLook`) */
  ground?: TerminalGroundStyle | undefined;
  /** the spark's terminal */
  children?: ReactNode;
  /** the pane's box: where the keyboard is held */
  boxRef?: Ref<HTMLDivElement> | undefined;
}

export type SparkPaneViewProps = {
  /** the spark's name, as its words say it */
  name: string;
} & (LiveSparkPaneViewProps | SparkPanePlace);

/** What the pane's place says while there is no pane to draw (DESIGN.md §8 "Chat's thread"; §9 "Chat's words"). */
export function sparkPaneWords(name: string, place: SparkPanePlace): string {
  switch (place.state) {
    case "finding":
      return `Finding ${name}'s pane…`;
    case "gone":
      return `${name}'s terminal is not on this desktop's floor.`;
    case "fault":
      return `Couldn't find ${name}'s pane: ${place.reason}`;
    case "no-terminals":
      return NO_TERMINALS;
  }
}

export function SparkPaneView(props: SparkPaneViewProps): ReactElement {
  if (props.state !== "live") {
    return (
      <div className="vf-chat-pane" data-pane-state={props.state}>
        <p className="vf-chat-pane-words" role="status">
          {sparkPaneWords(props.name, props)}
        </p>
      </div>
    );
  }
  const { ground, children, boxRef, onPointerDown, onFocus, onBlur } = props;
  return (
    <div
      ref={boxRef}
      className="vf-chat-pane"
      data-pane-state="live"
      // the one inline style: the terminal's ground, a custom-property projection (docs/UI_SYSTEM.md)
      style={ground as CSSProperties | undefined}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="vf-chat-pane-surface">{children}</div>
    </div>
  );
}
