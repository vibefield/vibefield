import type { ReactElement } from "react";
import type { TierMark } from "./plan-tier";

// DESIGN.md §8 "A plan's tier" — THE MARK AFTER A PLAN'S TITLE, one view for
// Settings → Agent Profiles' plan card and Godview's popover row (`tierMarks` decides which).
// The badge is the popover head's default tag holding the label as given, with tabular figures;
// it never gives way, a long label stopping at 8 characters' width, cut inside the capsule. A
// tier not read beside a labelled sibling is the same capsule empty and dashed, with the Bands'
// empty dash (2 3), twice as wide as it is tall: geometry, never a glyph (§13). The badge is
// part of the name, so a reader hears it after the title ("ChatGPT Pro 200") and never as an
// element of its own; the empty capsule says nothing aloud. Its look lives in
// profiles-settings.css; a host may hand it its ring (`--vf-plan-tier-ring`).

/** The empty capsule's box: the badge's height (10 × 1, padded 3 and 3), twice as wide. */
const UNREAD_HEIGHT = 16;
const UNREAD_WIDTH = UNREAD_HEIGHT * 2;

export function PlanTierMark({ mark }: { mark: TierMark }): ReactElement | null {
  if (mark === undefined) return null;
  if (mark.kind === "unread") {
    return (
      <span className="vf-plan-tier" data-unread="" aria-hidden="true">
        <svg
          width={UNREAD_WIDTH}
          height={UNREAD_HEIGHT}
          viewBox={`0 0 ${UNREAD_WIDTH} ${UNREAD_HEIGHT}`}
          aria-hidden="true"
          focusable="false"
        >
          <rect
            x="0.5"
            y="0.5"
            width={UNREAD_WIDTH - 1}
            height={UNREAD_HEIGHT - 1}
            rx={(UNREAD_HEIGHT - 1) / 2}
          />
        </svg>
      </span>
    );
  }
  return (
    <>
      {/* the label joins the title's words for a reader, after a space; the capsule is seen */}
      <span className="sr-only"> {mark.label}</span>
      <span className="vf-plan-tier" aria-hidden="true">
        {mark.label}
      </span>
    </>
  );
}
