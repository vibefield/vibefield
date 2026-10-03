import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { ReactElement } from "react";
import { roundButtonCls } from "./field/theme-constants";

/** The app-wide light/dark control. Field chrome and boot surfaces share the
 * exact same round button, icon, and accessible action label. */
export function ThemeToggleButton({
  dark,
  onToggle,
  className = "",
}: {
  dark: boolean;
  onToggle: () => void;
  className?: string;
}): ReactElement {
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${roundButtonCls(false)} motion-reduce:transition-none ${className}`}
      title={label}
      aria-label={label}
    >
      {dark ? <FieldGlyph name="sun" size={20} /> : <FieldGlyph name="moon" size={20} />}
    </button>
  );
}
