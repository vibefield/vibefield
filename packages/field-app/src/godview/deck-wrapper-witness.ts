import { type RefObject, useEffect, useRef } from "react";
import { type GodviewDeckFacts, godviewMarkersEnabled } from "../development-console";
import type { GodviewDeckState } from "../frame/deck-door";

// THE WRAPPER'S WITNESS (Godview round 3; DESIGN.md §8 "One resize per
// change"). The wrapper around the terminals — the Lip, the well, the sheet's
// edge — is the stage's, and the deck inside it is what a harness reads
// (`GODVIEW_DECK`). So the stage measures its own wrapper and says the facts
// here, and the deck's marker carries them: the state it draws, where its top
// edge stands, and how many times the box the terminals fill has changed.
//
// That count is the point. A move the product makes is ONE resize of the
// terminals (a person's drag is the only thing that resizes as it goes), and a
// count that only grows is how a harness holds a rise, a fall or a maximize to
// exactly one — as `zoom.commits` holds a pane's zoom.
//
// A witness and nothing else: only the window's own stage runs it, and only
// while the Godview markers are on (the smokes and the labs). The product
// measures nothing here.

export type DeckWrapperFacts = NonNullable<GodviewDeckFacts["wrapper"]>;

/** The sheet between two states (`GodviewStage`): rising, falling, or still. */
export type DeckTravel = "rise" | "fall" | null;

let facts: DeckWrapperFacts | null = null;
const listeners = new Set<() => void>();

/** The stage's side: say the facts on change, null when it goes away. */
export function publishDeckWrapperFacts(next: DeckWrapperFacts | null): void {
  if (
    next === facts ||
    (next !== null &&
      facts !== null &&
      next.state === facts.state &&
      next.top === facts.top &&
      next.bodyResizes === facts.bodyResizes)
  ) {
    return;
  }
  facts = next;
  for (const fn of listeners) fn();
}

export function getDeckWrapperFacts(): DeckWrapperFacts | null {
  return facts;
}

/** The deck's side: hears each change, to say its marker again. */
export function subscribeDeckWrapperFacts(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam. */
export function resetDeckWrapperFactsForTest(): void {
  facts = null;
  listeners.clear();
}

/**
 * The stage's measuring: the deck section's top against the stage's, and the
 * body's box, re-read whenever either is laid out again. The first reading is
 * the baseline; every later one that finds the body's box another size counts.
 *
 * The LAYOUT, never the painted box (`offset*`, not `getBoundingClientRect`):
 * a transform — the sheet's own rise and fall, the cover settling from 1.012
 * as Godview opens, the Peek's recede to 0.98 — moves and scales what is
 * painted and never the box the terminals fill. Until 2026-10-11 the painted
 * box was read, and a smoke saw the top "move" 313 → 316 under the cover's
 * settle. Away, the top is where the sheet is laid out (its box is kept), and
 * the state says it is away.
 */
export function useDeckWrapperWitness(options: {
  /** Only the window's stage (`publishesDeck`) — never a fixture's. */
  enabled: boolean;
  state: GodviewDeckState;
  /** A travel moves the sheet by `transform`, which no observer hears: the
   * facts are read again when it ends, so `top` is where the sheet came to. */
  travel?: DeckTravel;
  deck: RefObject<HTMLElement | null>;
  body: RefObject<HTMLElement | null>;
}): void {
  const { enabled, state, travel = null, deck, body } = options;
  const box = useRef<string | null>(null);
  const resizes = useRef(0);
  useEffect(() => {
    if (!enabled || !godviewMarkersEnabled()) return;
    const section = deck.current;
    const pane = body.current;
    const root = section?.closest<HTMLElement>(".vf-godview") ?? null;
    if (section === null || pane === null || root === null) return;
    const measure = (): void => {
      const size = `${pane.offsetWidth}x${pane.offsetHeight}`;
      if (box.current !== null && box.current !== size) resizes.current += 1;
      box.current = size;
      // the sheet's offset parent is the stage's root (positioned): its top,
      // from the stage's top, as laid out
      publishDeckWrapperFacts({ state, top: section.offsetTop, bodyResizes: resizes.current });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(section);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [enabled, state, travel, deck, body]);
  useEffect(() => {
    if (!enabled) return;
    return () => publishDeckWrapperFacts(null);
  }, [enabled]);
}
