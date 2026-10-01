// DS-4 — the deck's focus seam (`godview/terminal-focus-take.ts`), against a
// recording stand-in for the runtime: what reaches the runtime when a surface
// claims control, gains focus, loses it and releases. The surface's own calls
// are the input; the assertion is only ever about what the RUNTIME was asked.
import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";
import { describe, expect, it } from "vitest";
import { deckFocusRuntime, runtimeTakesSeats } from "../src/godview/terminal-focus-take";

type Call = [string, ...unknown[]];

function stubRuntime(options: { takes?: boolean } = {}) {
  const calls: Call[] = [];
  const listeners: unknown[] = [];
  const runtime = {
    claimResizeControl(...args: unknown[]) {
      calls.push(["claimResizeControl", ...args]);
    },
    releaseResizeControl(...args: unknown[]) {
      calls.push(["releaseResizeControl", ...args]);
    },
    setFocused(...args: unknown[]) {
      calls.push(["setFocused", ...args]);
    },
    resize(...args: unknown[]) {
      calls.push(["resize", ...args]);
    },
    addEventListener(_type: string, listener: unknown) {
      listeners.push(listener);
    },
    rendererBackend: "test",
    ...(options.takes === true
      ? {
          takeResizeControl(...args: unknown[]) {
            calls.push(["takeResizeControl", ...args]);
          },
        }
      : {}),
  };
  return { runtime: runtime as unknown as GhostteaTerminalRuntime, calls, listeners };
}

/** Only the geometry verbs, in order — `setFocused` is a fact, not a claim. */
const claims = (calls: readonly Call[]) => calls.filter(([verb]) => verb === "claimResizeControl");

describe("the deck's focus seam (DS-4, DS-D5's note)", () => {
  it("re-claims a CONTROLLER's seat when its pane gains focus — the take this runtime can send", () => {
    const { runtime, calls } = stubRuntime();
    const deck = deckFocusRuntime(runtime);
    // the surface asks for control at mount, then its input takes focus
    deck.claimResizeControl("h1", "view-1", 80, 24);
    deck.setFocused("h1", "view-1", true, 100, 40);
    expect(claims(calls)).toEqual([
      ["claimResizeControl", "h1", "view-1", 80, 24],
      // the focus edge: the grid the surface reported WITH its focus
      ["claimResizeControl", "h1", "view-1", 100, 40],
    ]);
    // the focus fact itself still reaches the runtime, first
    const verbs = calls.map(([verb]) => verb);
    expect(verbs.indexOf("setFocused")).toBeLessThan(verbs.lastIndexOf("claimResizeControl"));
  });

  it("takes on the false→true EDGE only: a repeated true is the same focus", () => {
    const { runtime, calls } = stubRuntime();
    const deck = deckFocusRuntime(runtime);
    deck.claimResizeControl("h1", "view-1", 80, 24);
    deck.setFocused("h1", "view-1", true, 80, 24);
    deck.setFocused("h1", "view-1", true, 80, 24); // an effect re-run, not a new focus
    expect(claims(calls)).toHaveLength(2);
    // blur, then focus again (the person came back to this pane): another take
    deck.setFocused("h1", "view-1", false, 80, 24);
    expect(claims(calls)).toHaveLength(2);
    deck.setFocused("h1", "view-1", true, 90, 30);
    expect(claims(calls)[2]).toEqual(["claimResizeControl", "h1", "view-1", 90, 30]);
  });

  it("never takes for a view that holds no control — a mirror, or a controller that released", () => {
    const { runtime, calls } = stubRuntime();
    const deck = deckFocusRuntime(runtime);
    // a view that never asked (controlsResize false — the mirror's shape)
    deck.setFocused("h1", "mirror", true, 80, 24);
    expect(claims(calls)).toEqual([]);
    // a controller that released (hidden by zoom, the deck going inactive)
    deck.claimResizeControl("h1", "view-1", 80, 24);
    deck.releaseResizeControl("view-1");
    deck.setFocused("h1", "view-1", true, 80, 24);
    expect(claims(calls)).toHaveLength(1);
    expect(calls).toContainEqual(["releaseResizeControl", "view-1"]);
  });

  it("does not cross sessions: focus on a handle the view never claimed is no take", () => {
    const { runtime, calls } = stubRuntime();
    const deck = deckFocusRuntime(runtime);
    deck.claimResizeControl("h1", "view-1", 80, 24);
    deck.setFocused("h2", "view-1", true, 80, 24);
    expect(claims(calls)).toHaveLength(1);
  });

  it("hands a take-capable runtime through UNTOUCHED — the surface takes, never twice", () => {
    const { runtime } = stubRuntime({ takes: true });
    expect(runtimeTakesSeats(runtime)).toBe(true);
    expect(deckFocusRuntime(runtime)).toBe(runtime);
    expect(runtimeTakesSeats(stubRuntime().runtime)).toBe(false);
  });

  it("forwards everything else bound to the runtime, one function object per verb", () => {
    const { runtime, calls, listeners } = stubRuntime();
    const deck = deckFocusRuntime(runtime);
    deck.resize("s1", "view-1", 70, 20);
    expect(calls).toContainEqual(["resize", "s1", "view-1", 70, 20]);
    // identity: React effect deps and removeEventListener compare it
    expect(deck.resize).toBe(deck.resize);
    expect(deck.addEventListener).toBe(deck.addEventListener);
    const listener = () => undefined;
    deck.addEventListener("renderer-status", listener);
    expect(listeners).toEqual([listener]);
    expect(deck.rendererBackend).toBe("test");
  });
});
