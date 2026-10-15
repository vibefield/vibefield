// WP12c (L2b-ii, `build-wp12-updater.md` §10 S7; EDP-34) — the safe window as ONE testable predicate with named
// clauses: `windowless ∧ tray-resident ∧ ¬display-held-awake ∧ plane-gate(release)`. The UI and doctor name the
// failing clause. L2b-ii computed it and said it; L3b-ii (B4) applies a staged update SILENTLY when it holds, and
// builds the display clause's reader (`display-awake.ts`: `pmset -g assertions` on macOS; `unknown` anywhere else, which
// fails closed).

import type { UpdatePlane } from "@vibefield/contracts";
import type { CensusCount } from "./decide";

export interface SafeWindowContext {
  /** no VibeField window is open */
  readonly windowless: boolean;
  /** the shell stays resident in the tray (it can relaunch itself without a person) */
  readonly trayResident: boolean;
  /** some process holds the display awake — a presentation, a call, a screen share; `"unknown"` = unreadable (closed) */
  readonly displayHeldAwake: boolean | "unknown";
  /** the planes the release touches: every plane, minus field-native when its signed digest is unchanged (L3b-i, B3) */
  readonly planes: readonly UpdatePlane[];
  /** the live sessions a field-native-touching release would end (EDP-33: it applies only at census zero) */
  readonly census: CensusCount;
}

export type SafeWindowClause =
  | "windowless"
  | "tray-resident"
  | "display-awake-unheld"
  | "plane-gate";

export type SafeWindow =
  | { readonly open: true }
  | { readonly open: false; readonly clause: SafeWindowClause };

/** The clauses in EDP-34's order; the first that fails is the one named. */
export function safeWindow(context: SafeWindowContext): SafeWindow {
  if (!context.windowless) return { open: false, clause: "windowless" };
  if (!context.trayResident) return { open: false, clause: "tray-resident" };
  if (context.displayHeldAwake !== false) return { open: false, clause: "display-awake-unheld" };
  if (context.planes.includes("field-native") && context.census !== 0) {
    return { open: false, clause: "plane-gate" };
  }
  return { open: true };
}

/** Doctor's line for the predicate (EDP §11.6: the blocking clause by name). */
export function safeWindowLine(window: SafeWindow): string {
  return window.open
    ? "safe window: open (a staged update may apply on its own while it stays open, EDP-34)"
    : `safe window: closed — ${window.clause}`;
}
