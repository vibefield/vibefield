import type { ReactElement } from "react";
import { fabCls } from "../field/theme-constants";
import { requestGodviewToggle } from "./overlay-state";

/** The Godview toggle in the field's bottom chrome — a floating round button
 * (DESIGN.md §8): 40px, solid chrome surface, `shadow-lg`, icon in the muted
 * ramp until hover, inverted solid while active. `fabCls` IS that recipe, and
 * sharing it with the Settings and devtools buttons is what keeps the three
 * reading as one row rather than three decisions.
 *
 * It presses the same button ⇧⇧ presses: `requestGodviewToggle` asks the host,
 * the host flips its bit, and `active` here is the value that came back — so
 * the button can never be lit over a closed overlay. */
export function GodviewToggle({ active }: { active: boolean }): ReactElement {
  return (
    <button
      type="button"
      onClick={requestGodviewToggle}
      data-hud-flight="bottom-left"
      className={`hud-flight ${fabCls(active)} bottom-4 left-16`}
      title="Godview (⇧ ⇧)"
      aria-pressed={active}
    >
      {/* Panes: the deck's own silhouette, at the 1.8 stroke the neighbours use. */}
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M11 4v16M11 12h10" />
      </svg>
    </button>
  );
}
