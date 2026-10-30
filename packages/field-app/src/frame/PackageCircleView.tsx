import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { ReactElement, Ref } from "react";
import type { PeekStep } from "./PeekView";
import "./package-circle.css";

// THE PACKAGE CIRCLE (DESIGN.md §8 "The head" — the package circle; PL-D2
// ruled by James 2026-10-29, Cards in Hand: "Agents start their servers in
// Godview. Publishing one shouldn't need a trip to the desk."; HN-8) —
// controller-free, so the catalog mounts this exact markup on fixtures. Under
// a cover the pill is the desk's and hides with it, and Artifacts' door stands
// alone at the head's left, the mirror of search's circle at its right: the
// frame's, above the cover. Its tooltip, its name and its dot are the pill's
// package's. What it DOES lives in `PackageCircle.tsx`; what it shows is all
// props.

export interface PackageCircleViewProps {
  /** Its sheet shows: the frame's one owner holds `artifacts`. */
  readonly open: boolean;
  /** What its tooltip and its name say at rest — "Artifacts", or with the dot
   * on which source is unavailable, or how many. */
  readonly words: string;
  /** The standing dot: an artifact's source is unavailable. */
  readonly dot: boolean;
  readonly onPress?: () => void;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  /** Godview's terminals are maximized: the same button stands at their title
   * bar's left end, folded to it, as search stands at its right (GV-D11). */
  readonly bar?: boolean;
  /** Leaving the bar with search: `out` while the bar's control fades where
   * it stands, `in` while the head's circle fades back. */
  readonly step?: PeekStep | null;
}

/** The covered views' package circle: `package` 18 on the line's glass at x
 * 96, which grows the pill's sheet on its Artifacts shelf. While the sheet
 * shows the button is on, and says "Close  Esc", as the pill's buttons do. */
export function PackageCircleView({
  open,
  words,
  dot,
  onPress,
  buttonRef,
  bar = false,
  step = null,
}: PackageCircleViewProps): ReactElement {
  return (
    <div
      className="vf-package-circle no-drag"
      data-bar={bar ? "true" : undefined}
      data-step={step ?? undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        className="vf-package-button"
        aria-label={open ? "Close Artifacts" : words}
        aria-expanded={open}
        title={open ? "Close  Esc" : words}
        onClick={onPress}
      >
        <FieldGlyph name="package" size={18} />
        {dot ? <span className="vf-package-dot" aria-hidden="true" /> : null}
      </button>
    </div>
  );
}
