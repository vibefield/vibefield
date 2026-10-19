import { type ReactElement, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { subscribeTerminalPool, terminalPoolSnapshot } from "../terminal/pool";
import { describeSeat, type SeatPaneFace } from "./pane-faces";

/** How long the seat must stay elsewhere before the pane says so (DESIGN.md
 * §8): a glance at the phone never flashes the readout. */
export const SEAT_VEIL_DELAY_MS = 400;

/** The name's letters come in behind the veil by §6's content reveal delay,
 * the bloom's 140ms, 26ms apart (§6's stagger), and the whole stagger is never
 * more than 400ms (its cap), read as the Me menu reads it: `min(i × 26, 400)`,
 * so a long name's later letters start together. */
const LETTER_REVEAL_MS = 140;
const LETTER_STAGGER_MS = 26;
const LETTER_STAGGER_CAP_MS = 400;

/** A letter is a grapheme, so an accent or an emoji in a name is never split
 * across two of the pop's boxes. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The name's letters as the pop draws them, each with its offset in the name
 * (its identity: the same name drawn again keeps its boxes, so the pop never
 * replays) and its delay. */
function nameLetters(name: string): { offset: number; letter: string; delayMs: number }[] {
  return Array.from(GRAPHEMES.segment(name), ({ segment, index }, ordinal) => ({
    offset: index,
    // alone in its box a space is trimmed from the box's line; a no-break one keeps its width
    letter: segment === " " ? "\u00a0" : segment,
    delayMs: LETTER_REVEAL_MS + Math.min(ordinal * LETTER_STAGGER_MS, LETTER_STAGGER_CAP_MS),
  }));
}

/**
 * item 42 — THE PANE WHOSE SESSION ANOTHER DEVICE IS DRIVING (DESIGN.md §8;
 * `pane-faces.ts` `describeSeat` words it, the pool's seat for the session
 * decides it). The held-edge readout's figure, as James ruled it (2026-10-19
 * 21:38Z): over a veil — the terminal's ground at 62%, the content dimmed
 * under it and never hidden — the holder's name, full, and its verb at 40%,
 * huge, and under them one caption line, the size in mono and what a click
 * does. The pane colour lights it from the edges and from behind the words.
 * The name is drawn one box per letter for the pop's stagger, so a screen
 * reader is handed it whole beside them. It takes no pointer: a click reaches
 * the pane, and the pane's press takes the seat back (ghosttea's press take).
 */
export function SeatPaneStateView({ face }: { face: SeatPaneFace }): ReactElement {
  return (
    <div className="vf-godview-seat-state" role="status" data-seat-state={face.state}>
      <div className="vf-godview-seat-state-veil" aria-hidden="true" />
      <div className="vf-godview-seat-state-bloom" aria-hidden="true" />
      <div className="vf-godview-seat-state-glow" aria-hidden="true" />
      <p className="vf-godview-seat-state-words">
        <span className="vf-godview-seat-state-said">{face.name}</span>
        <span className="vf-godview-seat-state-name" aria-hidden="true">
          {nameLetters(face.name).map(({ offset, letter, delayMs }) => (
            <span key={offset} style={{ transitionDelay: `${delayMs}ms` }}>
              {letter}
            </span>
          ))}
        </span>
        <span className="vf-godview-seat-state-verb">{face.verb}</span>
      </p>
      <p className="vf-godview-seat-state-caption">
        <span className="vf-godview-seat-state-size">{face.size}</span> {face.caption}
      </p>
    </div>
  );
}

/** True once `on` has held for `ms`; false at once when it stops. */
function useHeldFor(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && held;
}

/**
 * The controller: one pane's session, its seat read from the pool (so only
 * this pane re-renders when it moves), portaled into ghosttea's pane element
 * beside the frame. It appears 400ms after the seat goes elsewhere, plays its
 * entrance once (its stylesheet) and then holds still, and goes AT ONCE when
 * this window takes the seat. A pane whose other desktop refused its ticket
 * says that instead (`RemotePaneState`): no frame comes to it, so no seat is
 * its to show.
 */
export function SeatPaneState({
  pane,
  sessionId,
}: {
  pane: HTMLElement;
  sessionId: string;
}): ReactElement | null {
  const seat = useSyncExternalStore(subscribeTerminalPool, () =>
    terminalPoolSnapshot().sessionSeats.get(sessionId),
  );
  const refused = useSyncExternalStore(subscribeTerminalPool, () =>
    terminalPoolSnapshot().remoteRefusals.has(sessionId),
  );
  const face = refused ? undefined : describeSeat(seat);
  const shown = useHeldFor(face !== undefined, SEAT_VEIL_DELAY_MS);
  if (face === undefined || !shown) return null;
  return createPortal(<SeatPaneStateView face={face} />, pane);
}
