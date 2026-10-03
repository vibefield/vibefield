import {
  resolveTheme,
  type ThemeName,
  type ThemePreference,
  type ThemeState,
} from "@vibefield/contracts";
import { useCallback, useSyncExternalStore } from "react";
import { peekHost } from "./host";
import { getRendererLogger } from "./logging";

// THE APP'S THEME, in the renderer (One Frame FR-4, FC-D5; DESIGN.md §10) — a
// MIRROR of main's one owner (`electron-shell/src/main/theme.ts`), never a copy.
//
// Three states — Light · Dark · Auto — chosen by the Me menu's Theme, Settings →
// Appearance and the Setup Assistant's button, all of which ASK the host by
// name and draw what it answers; nothing here moves until the host says so, so
// two controls can never show two answers. It replaced a sticky boolean in
// localStorage that had no Auto and no OS follow (r4 §4), held twice over.
//
// The stamp (03·A §6): `.dark` and `data-theme` on <html>, together — Tailwind's
// dark variant reads the class, the token sheets the attribute. Stamped here on
// every change, whoever is reading, and before the first render: main projects
// its answer into `nativeTheme`, so the page's `prefers-color-scheme` already
// IS the owner's theme when this document's first frame paints.
//
// A page with no host — a browser harness, the catalog, a component's own test —
// has no main: there the OS's theme is Auto's answer and a choice lasts for
// the page's life. A stand-in, not a second owner, and it never takes the old
// boolean away from a page that may still own it (the catalog's own theme).

/** The three, as the Me menu's Theme and Settings → Appearance both say them,
 * in the page's order — one table, so the two controls of one setting can
 * never name it two ways. */
export const THEME_LABELS = ["Light", "Dark", "Auto"] as const;
export type ThemeLabel = (typeof THEME_LABELS)[number];
const LABEL_OF: Readonly<Record<ThemePreference, ThemeLabel>> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};
const CHOICE_OF: Readonly<Record<ThemeLabel, ThemePreference>> = {
  Light: "light",
  Dark: "dark",
  Auto: "auto",
};
export const themeLabel = (preference: ThemePreference): ThemeLabel => LABEL_OF[preference];
export const themeChoice = (label: ThemeLabel): ThemePreference => CHOICE_OF[label];

/** The old renderer-held boolean. Read once, to hand its choice to the owner
 * the first time this build meets it, then removed. */
const LEGACY_KEY = "vf-dark";

let state: ThemeState | null = null;
let attached = false;
/** A legacy choice is on its way to the owner: what the owner says before it
 * answers is the state the choice is about to replace. */
let handingOff = false;
const listeners = new Set<() => void>();

function osDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function readLegacy(): ThemeName | null {
  try {
    const saved = localStorage.getItem(LEGACY_KEY);
    return saved === null ? null : saved === "true" ? "dark" : "light";
  } catch {
    return null;
  }
}

function stamp(resolved: ThemeName): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.setAttribute("data-theme", resolved);
}

/** Before the host has said anything: a legacy choice if there is one (it is
 * about to be the owner's), else the OS's answer — which, with a host, is the
 * owner's own projection. */
function initial(): ThemeState {
  const legacy = readLegacy();
  const preference: ThemePreference = legacy ?? "auto";
  return { preference, resolved: resolveTheme(preference, osDark()) };
}

function current(): ThemeState {
  if (state === null) state = initial();
  return state;
}

function apply(next: ThemeState): void {
  const was = current();
  state = { preference: next.preference, resolved: next.resolved };
  stamp(state.resolved);
  if (was.preference === state.preference && was.resolved === state.resolved) return;
  for (const fn of listeners) fn();
}

function refused(error: unknown): void {
  getRendererLogger()
    .child({ component: "theme" })
    .error("renderer.theme.set_refused", "The shell refused a theme request", error);
}

/** Subscribe to the owner once. With a host: its state, and the one hand-off
 * of a legacy choice. Without: the stand-in follows the OS while on Auto. */
function attach(): void {
  if (attached) return;
  attached = true;
  // The first reading, before anything below can change what it reads.
  current();
  const host = peekHost()?.theme;
  if (host === undefined) {
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) =>
        apply({
          preference: current().preference,
          resolved: resolveTheme(current().preference, event.matches),
        }),
      );
    } catch {
      // No media queries here: the stand-in stays where it began.
    }
    return;
  }
  // Armed BEFORE subscribing: the door replays the owner's last word at once,
  // and that word is the state the hand-off is about to replace.
  const legacy = readLegacy();
  if (legacy !== null) {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Storage went away: the choice still reaches the owner below.
    }
    handingOff = true;
  }
  host.onState((told) => {
    if (handingOff) return;
    apply(told);
  });
  if (legacy === null) return;
  host.set(legacy).then(
    (answer) => {
      handingOff = false;
      apply(answer);
    },
    (error: unknown) => {
      handingOff = false;
      refused(error);
    },
  );
}

/** Stamp the theme before the first render — the splash's first frame, and the
 * switch's held frame (DESIGN.md §8 "The switch"), must never paint in the
 * other one — and start listening to the owner. */
export function stampInitialTheme(): void {
  try {
    stamp(current().resolved);
    attach();
  } catch {
    // No document storage or media queries here: the first render stamps it.
  }
}

export function subscribeAppTheme(fn: () => void): () => void {
  attach();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getAppTheme(): ThemeState {
  return current();
}

/** Choose the app's theme by name. Asked of the owner; drawn when it answers. */
export function setAppTheme(preference: ThemePreference): void {
  attach();
  const host = peekHost()?.theme;
  if (host === undefined) {
    apply({ preference, resolved: resolveTheme(preference, osDark()) });
    return;
  }
  host.set(preference).then(apply, refused);
}

/** The one subscription every reader shares. */
export function useAppTheme(): ThemeState {
  return useSyncExternalStore(subscribeAppTheme, getAppTheme, getAppTheme);
}

/** The app's theme as one flag and a flip — for the Setup Assistant's sun/moon
 * button and anything else that draws by it. The flip CHOOSES the other theme
 * (an explicit Light or Dark), through the same owner. */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const { resolved } = useAppTheme();
  const dark = resolved === "dark";
  const toggle = useCallback(() => setAppTheme(dark ? "light" : "dark"), [dark]);
  return { dark, toggle };
}

/** Test seam: forget the host subscription, the value and the readers. */
export function resetAppThemeForTest(): void {
  state = null;
  attached = false;
  handingOff = false;
  listeners.clear();
}
