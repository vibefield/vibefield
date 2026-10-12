// @vitest-environment happy-dom
/**
 * THE TERMINALS' STATE, PURE (Godview round 3 — GV-D5, GV-D6; DESIGN.md §8
 * "Minimized" and "Called up"). The wrapper is away, up or maximized; its owner
 * is the overlay, and what moves it is two acts: minimize, and a call — any
 * session brought to the terminals. This file holds the acts to the ruling:
 *   1. minimize puts the terminals away, from wherever they are, and touches
 *      nothing but the name — the edge is the viewer's, kept where it stood,
 *      so a call brings them back THERE (the mounted half is
 *      `godview-deck-wrapper.test.tsx`)
 *   2. a call brings them up from away, and a call while up moves nothing
 *   3. the state is kept for the run (L3: the session's storage, so a reload
 *      keeps it and a launch does not), and a launch opens up, as today
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DECK_STATE_STORAGE_KEY,
  deckAfter,
  storeDeckState,
  storedDeckState,
} from "../src/godview/deck-state";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("the terminals' two acts", () => {
  it("minimize keeps the top; a call brings it up there; a call while up moves nothing", () => {
    // minimize: away, from up (and from maximized, once the terminals can be)
    expect(deckAfter("up", "minimize")).toBe("away");
    expect(deckAfter("maximized", "minimize")).toBe("away");
    expect(deckAfter("away", "minimize")).toBe("away");
    // the acts are names only: neither takes nor answers an edge, so the place
    // the viewer left the edge is not theirs to move (deck-edge.ts keeps it)
    expect(deckAfter.length).toBe(2);
    // a call: up from away — the same panes, the same edge
    expect(deckAfter("away", "call")).toBe("up");
    // a call while they show moves nothing
    expect(deckAfter("up", "call")).toBe("up");
    expect(deckAfter("maximized", "call")).toBe("maximized");
  });
});

describe("the state, kept for the run (L3)", () => {
  it("a launch opens up: nothing is kept, so the terminals are up as today", () => {
    expect(sessionStorage.getItem(DECK_STATE_STORAGE_KEY)).toBeNull();
    expect(storedDeckState()).toBe("up");
  });

  it("a reload keeps what was left: away comes back away, up comes back up", () => {
    storeDeckState("away");
    expect(sessionStorage.getItem(DECK_STATE_STORAGE_KEY)).toBe("away");
    expect(storedDeckState()).toBe("away");
    storeDeckState("up");
    // up is what a launch opens with, so it keeps nothing of its own
    expect(sessionStorage.getItem(DECK_STATE_STORAGE_KEY)).toBeNull();
    expect(storedDeckState()).toBe("up");
  });

  it("is the session's, never the viewer's: nothing reaches localStorage", () => {
    storeDeckState("away");
    expect(localStorage.length).toBe(0);
  });

  it("reads a word it does not know as up", () => {
    sessionStorage.setItem(DECK_STATE_STORAGE_KEY, "sideways");
    expect(storedDeckState()).toBe("up");
  });
});
