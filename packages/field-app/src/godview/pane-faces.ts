import type { GhostteaWorkspaceProps } from "@vibecook/ghosttea-react/workspace";
import type { AgentStopState } from "@vibefield/contracts";
import type { RemoteRefusal, RemoteRefusalState, SessionSeat } from "../terminal/pool";

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

/**
 * DS-4e — THE FACE OF A PANE WHOSE TERMINAL LIVES ON ANOTHER DESKTOP AND HAS
 * NOT COME (`RemotePaneState`). The pane was given the owner's session; its
 * ticket was refused (`RemoteRefusal`, the routed host's reading of what fieldd
 * said), so no frame will arrive and the pane would otherwise be blank ground —
 * DESIGN.md §8: a state is rendered, never blank space.
 *
 * The words (§9 — what happened, and what happens next, never more than we
 * know): the desktop by its NAME, never its id — a desktop the roster has not
 * named is "that desktop"; the refusing plane's own sentence as the detail
 * line (§8's provenance, doc sync's "verbatim reason"); and, for a refusal
 * that waits, the one thing that will happen — the pane asks again when that
 * desktop's roster row next changes, and only then.
 */
export interface RemotePaneFace {
  state: RemoteRefusalState;
  /** the state, in the deck's words */
  message: string;
  /** the refusing plane's own words, carried whole */
  detail: string;
  /** what happens next, when something will */
  next?: string;
}

/** What a pane says for a refused ticket to `deviceName`'s session
 * (undefined: the roster has not named that desktop). */
export function describeRemoteRefusal(
  refusal: RemoteRefusal,
  deviceName: string | undefined,
): RemotePaneFace {
  const name = deviceName === undefined || deviceName === "" ? "that desktop" : deviceName;
  // the next step is said only when there IS one: a refusal that waits
  const face = (message: string, next?: string): RemotePaneFace => ({
    state: refusal.state,
    message,
    detail: refusal.reason,
    ...(next !== undefined && refusal.waits ? { next } : {}),
  });
  switch (refusal.state) {
    case "no-road":
      return face(`no road to ${name} yet`, `asks again when ${name}'s status changes`);
    case "asleep":
      return face(`${name} is asleep`, `asks again when ${name} wakes`);
    case "not-answering":
      return face(`${name} is not answering`, `asks again when ${name}'s status changes`);
    case "gone":
      return face(`gone from ${name}`);
    case "refused":
      return face(`cannot open on ${name}`);
  }
}

/**
 * item 42 — THE FACE OF A PANE WHOSE SESSION ANOTHER DEVICE IS DRIVING
 * (`SeatPaneState`; DESIGN.md §8 "A session another device is driving"). The
 * pane goes on drawing the session at the holder's size, which without a word
 * reads as a glitch (James, 2026-10-19), so it says so in the held-edge
 * readout's figure (ruled 21:38Z): the holder by the NAME fieldd minted into
 * its grant — "Another device" where it named none, never an id — and what it
 * is doing, **James's iPhone** **is driving**, over one caption line, the size
 * it holds and what to do: **45 × 22 · click the pane to take it back**.
 *
 * When the holder LETS GO the seat is empty and the PTY stays at the size it
 * set, so the pane keeps saying so in the same figure: **James's iPhone** **let
 * go**, over the size the session was left at and **· click the pane to take
 * it.** A focused pane taking the empty seat itself is ruled (James,
 * 2026-10-19 17:42Z) but arrives with item 20's ghosttea lane, the first key
 * takes: the host holds no surface's viewId or grid and ghosttea's surface has
 * no seat listener, so until that lane every pane on the session says this
 * until a click (§8's dated status line).
 *
 * A seat this window holds, an empty seat nobody else let go, and a seat never
 * announced say nothing: the terminal is the state then.
 */
export interface SeatPaneFace {
  /** another client holds the seat, or another client let it go */
  state: "held" | "let-go";
  /** the readout's noun: the holder's name, full */
  name: string;
  /** the readout's verb, at 40% */
  verb: "is driving" | "let go";
  /** the caption's figure, in mono: cols × rows */
  size: string;
  /** the caption after the size: what a click does */
  caption: string;
}

/** The name a pane says for a holder: the face's, else "Another device". */
const ANOTHER_DEVICE = "Another device";

/** What a pane says for its session's seat (undefined: the pool holds none). */
export function describeSeat(seat: SessionSeat | undefined): SeatPaneFace | undefined {
  if (seat === undefined) return undefined;
  // cols × rows, the multiplication sign spaced as the passage writes it
  const size = `${seat.cols} × ${seat.rows}`;
  if (seat.holder !== null) {
    if (seat.mine) return undefined;
    return {
      state: "held",
      name: seat.holder.face?.name ?? ANOTHER_DEVICE,
      verb: "is driving",
      size,
      caption: "· click the pane to take it back",
    };
  }
  if (seat.released === undefined) return undefined;
  return {
    state: "let-go",
    name: seat.released.face?.name ?? ANOTHER_DEVICE,
    verb: "let go",
    size,
    caption: "· click the pane to take it.",
  };
}

/**
 * ST-D4 (a) — THE FACE OF A PANE WHOSE RUN A PERSON'S STOP HAS NOT STOPPED
 * (`StopPaneState`; DESIGN.md §8 "A run a Stop has not stopped"). fieldd holds
 * the Stop as sent until it hears the run stop (the field row's `stop`), and
 * the pane speaks only where a press cannot answer itself, in the held-edge
 * readout's figure:
 *
 *   · **Ending** **the run**, over "it did not stop after two sends · ending
 *     it": fieldd is ending a run whose turn did not stop (`terminating`).
 *   · **Still** **running**, over "the stop was sent twice and not heard ·"
 *     and **End run**: fieldd will take it no further (`unheardAt`), and the
 *     person ends the run.
 *
 * A Stop only sent, or sent again, says nothing here: the frame's own verb
 * says "Stopping the turn…" from the press. Nor does one heard: an exit shows
 * as any exit, and a turn that stopped leaves its pane live. A stage this
 * build does not know is still stopping (the contract's open words).
 */
export interface StopPaneFace {
  state: "ending" | "still-running";
  /** the readout's first word, full */
  word: string;
  /** the readout's rest, at 40% */
  rest: string;
  /** the caption line */
  caption: string;
  /** the figure's one act, when the person has one */
  act?: "end-run";
}

/** What a pane says for its run's Stop (undefined: none held, or nothing to say). */
export function describeStop(stop: AgentStopState | undefined): StopPaneFace | undefined {
  if (stop === undefined || stop.stage === "heard") return undefined;
  if (stop.unheardAt !== undefined) {
    return {
      state: "still-running",
      word: "Still",
      rest: "running",
      caption: "the stop was sent twice and not heard ·",
      act: "end-run",
    };
  }
  if (stop.stage === "terminating") {
    return {
      state: "ending",
      word: "Ending",
      rest: "the run",
      caption: "it did not stop after two sends · ending it",
    };
  }
  return undefined;
}
