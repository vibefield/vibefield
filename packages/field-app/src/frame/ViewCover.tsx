import type { FrameView } from "@vibefield/contracts";
import type { ReactElement, ReactNode } from "react";
import "./view-frame.css";

// THE COVER (DESIGN.md §6 "The view switch", §10; One Frame FC-D13): the canvas
// is the ground floor and every other view is ONE cover over it. The cover
// rises and lowers; between covered views only its content changes, in place.
// Each view paints its own ground at the covers' glass (FC-D16) and keeps its
// content above the reserve (FC-D15). Controller-free: the catalog mounts it on
// fixtures, the frame's controller hands it the view and the motion.

/** The views a cover can show. */
export type CoveredView = Exclude<FrameView, "canvas">;

/** What the cover is doing this render: rising off the canvas, swapping one
 * covered view for another, lowering back to the canvas, or at rest. Only a
 * swap fades the content; a rise or a lowering moves the cover around the
 * content that is already in it. */
export type CoverMotion = "rise" | "swap" | "lower" | "rest";

/** What the cover holds and how it is moving. */
export interface CoverState {
  readonly content: CoveredView;
  readonly motion: CoverMotion;
}

/** The cover as a window first draws it on `view`: holding that view if it
 * covers, Godview otherwise (the first covered view anyone opens), at rest. */
export function coverAt(view: FrameView): CoverState {
  return {
    content: view === "canvas" ? "godview" : view,
    motion: "rest",
  };
}

/** The cover after the window moves from one view to another (DESIGN.md §6):
 * off the canvas it RISES around the new view; between covered views it SWAPS
 * its content in place; back to the canvas it LOWERS, keeping what it held so
 * what leaves is what was there. The motion is kept until the next move, so a
 * render in between never cuts a fade short. */
export function coverAfter(cover: CoverState, from: FrameView, to: FrameView): CoverState {
  const next = to === "canvas" ? null : to;
  return {
    content: next ?? cover.content,
    motion: from === "canvas" ? "rise" : next === null ? "lower" : "swap",
  };
}

export interface ViewCoverViewProps {
  /** The window's view; the cover is down on the canvas. */
  view: FrameView;
  /** The view the cover holds — the active one while up, and the last one
   * while it lowers, so what leaves is what was there. */
  content: CoveredView;
  motion: CoverMotion;
  godview?: ReactNode;
  history?: ReactNode;
  chat?: ReactNode;
}

export function ViewCoverView({
  view,
  content,
  motion,
  godview,
  history,
  chat,
}: ViewCoverViewProps): ReactElement {
  const up = view !== "canvas";
  return (
    <div
      className="vf-cover"
      data-cover={up ? "up" : "down"}
      data-cover-motion={motion}
      data-view={content}
      aria-hidden={!up}
    >
      {/* A view that is not showing is INERT, not merely faded: a pane that
          kept focus under History would take the keys typed there. */}
      <section
        className="vf-cover-view"
        data-cover-view="godview"
        data-active={content === "godview" ? "true" : "false"}
        aria-label="Godview"
        inert={!up || content !== "godview"}
      >
        {godview}
      </section>
      <section
        className="vf-cover-view"
        data-cover-view="history"
        data-active={content === "history" ? "true" : "false"}
        aria-label="History"
        inert={!up || content !== "history"}
      >
        {history}
      </section>
      <section
        className="vf-cover-view"
        data-cover-view="assistant"
        data-active={content === "assistant" ? "true" : "false"}
        aria-label="Chat"
        inert={!up || content !== "assistant"}
      >
        {chat}
      </section>
    </div>
  );
}
