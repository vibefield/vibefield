import { useCallback, useEffect, useState } from "react";

// Spine theme system (Track D1, 03·A §6 law): `.dark` class + `data-theme`
// attribute are stamped TOGETHER on <html> — Tailwind's dark variant reads the
// class; token sheets and (later) mille read the attribute. Persisted per
// device (localStorage at P0; graduates to the D29 device-scope setting).
const KEY = "vf-dark";

function initialDark(): boolean {
  const saved = localStorage.getItem(KEY);
  if (saved !== null) return saved === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function stamp(dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.setAttribute("data-theme", dark ? "dark" : "light");
}

/** Stamp the stored theme before the first render: the splash's first frame —
 * and the switch's held frame, which the window before a reload converged on
 * in this same theme — must never paint in the other one. */
export function stampInitialTheme(): void {
  try {
    stamp(initialDark());
  } catch {
    // No storage or media queries here: the first render stamps it instead.
  }
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(initialDark);
  useEffect(() => {
    stamp(dark);
    localStorage.setItem(KEY, String(dark));
  }, [dark]);
  const toggle = useCallback(() => setDark((d) => !d), []);
  return { dark, toggle };
}
