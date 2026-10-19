/**
 * Where a session opens in the terminals (GV-D4, RE-RULED by James 2026-10-18
 * 23:33Z; DESIGN.md §8, the deck: "A session with no pane").
 *
 * The rule alone, with no deck: the panes showing, the focused one, and the
 * session asked for. Every pane is an observer, and what the person opens goes
 * into the one they selected — "Everywhere", and "Mirror it" when another pane
 * shows it already. The reference is the original Godview's own select, "Show
 * this agent in the active pane" (puppeteer `view-sdk/src/view.ts`). What the
 * deck does with each answer — ghosttea's mount into the active pane — is
 * `godview-deck.test.tsx`'s.
 */
import { describe, expect, it } from "vitest";
import { type DeckPaneShown, deckPlacement } from "../src/godview/deck-placement";

const pane = (id: string, sessionId: string): DeckPaneShown => ({ id, sessionId });
const ONE = [pane("p1", "a")];
const TWO = [pane("p1", "a"), pane("p2", "b")];
const THREE = [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")];
const SIX = [...THREE, pane("p4", "d"), pane("p5", "e"), pane("p6", "f")];

describe("where a session opens (GV-D4, re-ruled 2026-10-18)", () => {
  it("the focused pane already shows it: nothing moves", () => {
    expect(deckPlacement({ panes: ONE, focusedPaneId: "p1" }, "a")).toEqual({
      kind: "focus",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: THREE, focusedPaneId: "p2" }, "b")).toEqual({
      kind: "focus",
      paneId: "p2",
    });
  });

  it("one, two, three or more panes: it replaces the FOCUSED pane, and no pane is added", () => {
    // until the re-ruling: beside the focused pane while fewer than three showed
    expect(deckPlacement({ panes: ONE, focusedPaneId: "p1" }, "x")).toEqual({
      kind: "replace",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: TWO, focusedPaneId: "p2" }, "x")).toEqual({
      kind: "replace",
      paneId: "p2",
    });
    expect(deckPlacement({ panes: THREE, focusedPaneId: "p3" }, "x")).toEqual({
      kind: "replace",
      paneId: "p3",
    });
    // six, made by ⌘D (which splits without limit): still the focused pane
    expect(deckPlacement({ panes: SIX, focusedPaneId: "p4" }, "x")).toEqual({
      kind: "replace",
      paneId: "p4",
    });
  });

  it("shown in ANOTHER pane: the focused pane shows it too — a mirror, never a focus elsewhere", () => {
    // James: "Mirror it". Until the re-ruling the pane already showing it was
    // focused instead, and nothing was mounted twice.
    expect(deckPlacement({ panes: TWO, focusedPaneId: "p1" }, "b")).toEqual({
      kind: "replace",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: SIX, focusedPaneId: "p1" }, "f")).toEqual({
      kind: "replace",
      paneId: "p1",
    });
    // already mirrored, and the focused pane is one of the mirrors: nothing moves
    const mirrored = [pane("p1", "a"), pane("p2", "b"), pane("p3", "a")];
    expect(deckPlacement({ panes: mirrored, focusedPaneId: "p3" }, "a")).toEqual({
      kind: "focus",
      paneId: "p3",
    });
    // …and when it is not, the focused pane becomes a third view of it
    expect(deckPlacement({ panes: mirrored, focusedPaneId: "p2" }, "a")).toEqual({
      kind: "replace",
      paneId: "p2",
    });
  });

  it("a new terminal replaces the focused pane, at any count", () => {
    // no session to look for (it is not born yet)
    expect(deckPlacement({ panes: ONE, focusedPaneId: "p1" })).toEqual({
      kind: "replace",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: TWO, focusedPaneId: "p1" })).toEqual({
      kind: "replace",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: SIX, focusedPaneId: "p6" })).toEqual({
      kind: "replace",
      paneId: "p6",
    });
  });

  it("with no pane, or no focused pane among those showing, there is nowhere to place", () => {
    expect(deckPlacement({ panes: [], focusedPaneId: undefined }, "x")).toEqual({ kind: "none" });
    expect(deckPlacement({ panes: TWO, focusedPaneId: undefined }, "x")).toEqual({ kind: "none" });
    expect(deckPlacement({ panes: TWO, focusedPaneId: "gone" })).toEqual({ kind: "none" });
    // a session a pane shows is no exception: the rule places by the focused pane alone
    expect(deckPlacement({ panes: TWO, focusedPaneId: undefined }, "b")).toEqual({ kind: "none" });
  });
});

// N16 (a), the lead's rule (2026-10-12): ⌘W on the last pane empties it — a
// fresh shell with the launcher over it. Under the re-ruled GV-D4 that pane is
// a pane like any other: focused, the next session takes its place.
describe("the empty pane ⌘W left is a pane the rule replaces (N16 (a))", () => {
  it("the next session, or a new terminal, replaces the empty focused pane", () => {
    const emptied = [pane("p1", "fresh-shell")];
    expect(deckPlacement({ panes: emptied, focusedPaneId: "p1" }, "x")).toEqual({
      kind: "replace",
      paneId: "p1",
    });
    expect(deckPlacement({ panes: emptied, focusedPaneId: "p1" })).toEqual({
      kind: "replace",
      paneId: "p1",
    });
  });
});
