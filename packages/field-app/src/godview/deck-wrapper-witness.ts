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
 */
export function useDeckWrapperWitness(options: {
  /** Only the window's stage (`publishesDeck`) — never a fixture's. */
  enabled: boolean;
  state: GodviewDeckState;
  deck: RefObject<HTMLElement | null>;
  body: RefObject<HTMLElement | null>;
}): void {
  const { enabled, state, deck, body } = options;
  const box = useRef<string | null>(null);
  const resizes = useRef(0);
  useEffect(() => {
    if (!enabled || !godviewMarkersEnabled()) return;
    const section = deck.current;
    const pane = body.current;
    const root = section?.closest<HTMLElement>(".vf-godview") ?? null;
    if (section === null || pane === null || root === null) return;
    const measure = (): void => {
      const rect = pane.getBoundingClientRect();
      const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (box.current !== null && box.current !== size) resizes.current += 1;
      box.current = size;
      publishDeckWrapperFacts({
        state,
        top: Math.round(section.getBoundingClientRect().top - root.getBoundingClientRect().top),
        bodyResizes: resizes.current,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(section);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [enabled, state, deck, body]);
  useEffect(() => {
    if (!enabled) return;
    return () => publishDeckWrapperFacts(null);
  }, [enabled]);
}
