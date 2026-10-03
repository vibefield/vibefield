import { FieldGlyph } from "@vibefield/design-kit/glyphs";
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
      {/* Panes: the deck's own silhouette (DESIGN.md §13). */}
      <FieldGlyph name="panes" size={20} />
    </button>
  );
}
