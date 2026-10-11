/**
 * Where a session with no pane opens (GV-D4, James 2026-10-02; DESIGN.md §8,
 * the deck: "A session with no pane").
 *
 * The rule alone, with no deck: the panes showing, the focused one, and the
 * session asked for. The ruled drawing's own code is the reference
 * (`draft/one-frame/src/kit/gv3.js` `placeSession`): a session not shown is
 * pushed while fewer than three panes show and takes the focused pane's index
 * after; one already shown is only focused. What the deck does with each
 * answer — ghosttea's own split, its mount, its activation — is
 * `godview-deck.test.tsx`'s.
 */
import { describe, expect, it } from "vitest";
import {
  DECK_PLACEMENT_PANES,
  type DeckPaneShown,
  deckPlacement,
} from "../src/godview/deck-placement";

const pane = (id: string, sessionId: string): DeckPaneShown => ({ id, sessionId });
const ONE = [pane("p1", "a")];
const TWO = [pane("p1", "a"), pane("p2", "b")];
const THREE = [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")];
const FOUR = [...THREE, pane("p4", "d")];

describe("where a session with no pane opens (GV-D4)", () => {
  it("fewer than three: beside; three: replaces the focused; already shown: focused, never mounted twice", () => {
    // fewer than three panes showing: beside the focused one
    expect(deckPlacement({ panes: ONE, focusedPaneId: "p1" }, "x")).toEqual({
      kind: "beside",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: TWO, focusedPaneId: "p2" }, "x")).toEqual({
      kind: "beside",
      paneId: "p2",
    });
    // three showing: the focused pane's place, whichever pane that is
    expect(deckPlacement({ panes: THREE, focusedPaneId: "p2" }, "x")).toEqual({
      kind: "replace",
      paneId: "p2",
    });
    expect(deckPlacement({ panes: THREE, focusedPaneId: "p3" }, "x")).toEqual({
      kind: "replace",
      paneId: "p3",
    });
    // already in a pane: that pane, at any count — never a second mount
    expect(deckPlacement({ panes: ONE, focusedPaneId: "p1" }, "a")).toEqual({
      kind: "focus",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: TWO, focusedPaneId: "p1" }, "b")).toEqual({
      kind: "focus",
      paneId: "p2",
    });
    expect(deckPlacement({ panes: THREE, focusedPaneId: "p1" }, "c")).toEqual({
      kind: "focus",
      paneId: "p3",
    });
  });

  it("the cap is three, and it is this rule's alone", () => {
    expect(DECK_PLACEMENT_PANES).toBe(3);
  });

  it("a new terminal follows the same rule", () => {
    // no session to look for (it is not born yet): beside, then the focused pane's place
    expect(deckPlacement({ panes: ONE, focusedPaneId: "p1" })).toEqual({
      kind: "beside",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: TWO, focusedPaneId: "p1" })).toEqual({
      kind: "beside",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: THREE, focusedPaneId: "p1" })).toEqual({
      kind: "replace",
      paneId: "p1",
    });
  });

  it("four or more panes (made by ⌘D) still replace the focused", () => {
    // ⌘D splits without limit (L4): past three, the rule never adds a pane
    expect(deckPlacement({ panes: FOUR, focusedPaneId: "p4" }, "x")).toEqual({
      kind: "replace",
      paneId: "p4",
    });
    expect(deckPlacement({ panes: FOUR, focusedPaneId: "p2" })).toEqual({
      kind: "replace",
      paneId: "p2",
    });
    const SIX = [...FOUR, pane("p5", "e"), pane("p6", "f")];
    expect(deckPlacement({ panes: SIX, focusedPaneId: "p1" }, "x")).toEqual({
      kind: "replace",
      paneId: "p1",
    });
    // …and one of them already showing the session is still only focused
    expect(deckPlacement({ panes: SIX, focusedPaneId: "p1" }, "f")).toEqual({
      kind: "focus",
      paneId: "p6",
    });
  });

  it("a session mirrored in two panes is focused where the person is, else in its first pane", () => {
    const mirrored = [pane("p1", "a"), pane("p2", "b"), pane("p3", "a")];
    expect(deckPlacement({ panes: mirrored, focusedPaneId: "p3" }, "a")).toEqual({
      kind: "focus",
      paneId: "p3",
    });
    expect(deckPlacement({ panes: mirrored, focusedPaneId: "p2" }, "a")).toEqual({
      kind: "focus",
      paneId: "p1",
    });
  });

  it("counts panes, not sessions: two panes mirroring one session are two", () => {
    const mirrors = [pane("p1", "a"), pane("p2", "a"), pane("p3", "a")];
    expect(deckPlacement({ panes: mirrors, focusedPaneId: "p1" }, "x")).toEqual({
      kind: "replace",
      paneId: "p1",
    });
  });

  it("with no pane, or no focused pane among those showing, there is nowhere to place", () => {
    expect(deckPlacement({ panes: [], focusedPaneId: undefined }, "x")).toEqual({ kind: "none" });
    expect(deckPlacement({ panes: TWO, focusedPaneId: undefined }, "x")).toEqual({ kind: "none" });
    expect(deckPlacement({ panes: TWO, focusedPaneId: "gone" })).toEqual({ kind: "none" });
    // …but a session already shown needs no focused pane to be found
    expect(deckPlacement({ panes: TWO, focusedPaneId: undefined }, "b")).toEqual({
      kind: "focus",
      paneId: "p2",
    });
  });
});
