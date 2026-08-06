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
      {dark ? (
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
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
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
        </svg>
      )}
    </button>
  );
}
