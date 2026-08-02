import type { GhostteaWorkspaceProps } from "@vibecook/ghosttea-react/workspace";

/** Ghosttea's `SessionSummary`, taken from the prop that receives it rather
 * than imported: it lives in `@vibecook/ghosttea-protocol`, a transitive
 * dependency of ghosttea-react that this package does not declare and should
 * not, since the only reason we know the shape is that the deck hands it to
 * us. Derived here, the type cannot drift from the call site. */
export type DeckSession = Parameters<NonNullable<GhostteaWorkspaceProps["decoratePane"]>>[0];

// The deck's honest pane faces (DESIGN.md §2.5, §8 "Empty / degraded states",
// §9 voice), as a pure function so the rules are testable without a GPU.
//
// The workspace draws two things for us per pane: a badge (the decoration's
// `label`) and an accent (`color`, which lands on `--ghostty-pane-color`). That
// is the whole vocabulary, so these rules spend it only where there is a FACT
// the pane does not otherwise show.
//
// A LIVE pane gets nothing. The terminal's own output is the state, and a badge
// reading "live" over a running shell is the vacuous row DESIGN.md's sync
// section forbids — quiet IS the honesty. Ghosttea already renders "View only"
// for a read-only session and its own banner for a remote one, so neither is
// restated here.

export interface PaneFace {
  label?: string;
  color?: string;
}

/** How a session's ending reads. Exit 0 is an ending, not a failure — DESIGN.md
 * §2.5 gives red to `failed`, and a shell the user typed `exit` into did not
 * fail — so it takes the muted ramp (no color) and states the fact in words.
 * A nonzero code or a signal is a real failure and wears `--vf-red`. */
export function describePane(session: DeckSession): PaneFace | undefined {
  if (!session.exited) return undefined;
  if (session.exitSignal !== null) {
    return { label: `ended · ${session.exitSignal}`, color: "var(--vf-red)" };
  }
  if (session.exitCode === null) {
    // The floor knows it ended and not how. Saying so beats inventing a code.
    return { label: "ended" };
  }
  if (session.exitCode === 0) return { label: "exited" };
  return { label: `exited · ${session.exitCode}`, color: "var(--vf-red)" };
}
