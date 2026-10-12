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
import { DECK_FILL_LINE, deckEdgeBounds, deckLetGo } from "../src/godview/deck-edge";
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

describe("maximized (round 3, W6 — GV-D11)", () => {
  it("maximize fills from up; restore brings it up; a call while maximized moves nothing; minimize from maximized goes away", () => {
    expect(deckAfter("up", "maximize")).toBe("maximized");
    expect(deckAfter("maximized", "restore")).toBe("up");
    // restore is maximized's alone: up and away are not moved by it
    expect(deckAfter("up", "restore")).toBe("up");
    expect(deckAfter("away", "restore")).toBe("away");
    expect(deckAfter("maximized", "call")).toBe("maximized");
    expect(deckAfter("maximized", "minimize")).toBe("away");
  });

  it("above 104 or a fling up fills", () => {
    expect(DECK_FILL_LINE).toBe(104);
    // rest at 300 in the drawing's 780 window, the panes ending at 692
    const bounds = deckEdgeBounds({ restTop: 300, height: 780, reserve: 88 });
    // an up deck's highest is the fill line, a held edge's the window's top
    expect(300 + bounds.min).toBe(104);
    expect(300 + bounds.top).toBe(0);
    // let go above the line: maximized; at it: it stays
    expect(deckLetGo(bounds.min - 1, bounds, 0)).toBe("maximized");
    expect(deckLetGo(bounds.top, bounds, 0)).toBe("maximized");
    expect(deckLetGo(bounds.min, bounds, 0)).toBe("stays");
    // a fling up fills whatever the distance; a fling down still goes away
    expect(deckLetGo(0, bounds, -1.41)).toBe("maximized");
    expect(deckLetGo(0, bounds, -1.4)).toBe("stays");
    expect(deckLetGo(0, bounds, 1.41)).toBe("away");
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

  it("a reload keeps the terminals maximized", () => {
    storeDeckState("maximized");
    expect(storedDeckState()).toBe("maximized");
  });

  it("reads a word it does not know as up", () => {
    sessionStorage.setItem(DECK_STATE_STORAGE_KEY, "sideways");
    expect(storedDeckState()).toBe("up");
  });
});
