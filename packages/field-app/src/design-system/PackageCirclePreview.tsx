import type { ReactElement } from "react";
import { artifactsWords } from "../frame/artifacts-standing";
import { PackageCircleView } from "../frame/PackageCircleView";
import { GodviewPreview } from "./GodviewPreview";
import { HistoryPreview } from "./HistoryPreview";

// The package circle's fixture ADAPTER (PL-D2, HN-8; docs/UI_SYSTEM.md): the
// shipping circle — `PackageCircleView` — at its own place over each covered
// view's own ground, one plate per state: over Godview's stage, its Stories
// row keeping one head gap from the circle; over History's band with an
// artifact's source unavailable, its dot on; and in the terminals' title bar
// while they are maximized, folded there as search is. What it replaces is
// only what a host supplies: the window's view, the deck's state and the
// head's reading of the catalog (the titles whose source is unavailable); its
// words are the head's own (`artifactsWords`). The markup and the CSS are the
// product's. The sheet it grows is the pill's, drawn by the head's plates.

/** The package circle's plates, in the page's order. */
export const PACKAGE_CIRCLE_STATES = ["godview", "history", "bar"] as const;
export type PackageCircleState = (typeof PACKAGE_CIRCLE_STATES)[number];

/** The titles each plate's catalog says are unavailable: none, one, two. */
const UNAVAILABLE: Record<PackageCircleState, readonly string[]> = {
  godview: [],
  history: ["vibe-field"],
  bar: ["vibe-field", "sketchbook"],
};

/** The window's top over a covered view, the circle at the head's left. */
export function PackageCirclePlate({
  state,
  dark,
}: {
  readonly state: PackageCircleState;
  readonly dark: boolean;
}): ReactElement {
  const unavailable = UNAVAILABLE[state];
  return (
    <div className="vf-ds-package-plate" data-state={state}>
      <div className="vf-ds-package-ground">
        {state === "history" ? (
          <HistoryPreview state="consent" />
        ) : (
          <GodviewPreview
            theme={dark ? "dark" : "light"}
            deckState={state === "bar" ? "maximized" : "away"}
          />
        )}
      </div>
      <PackageCircleView
        open={false}
        words={artifactsWords(unavailable)}
        dot={unavailable.length > 0}
        bar={state === "bar"}
      />
    </div>
  );
}
