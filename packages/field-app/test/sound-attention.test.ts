// SD-2 (DESIGN.md §14 rules 3 and 9; SD-D11, SD-D12) — what the window tells main about its agents: which floor
// session you are typing into, and where each shown session sits across the window, −1 (left) … 1 (right). Main maps
// sessions to runs; the window only reads its deck.

import { SOUND_ATTENTION } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { LinePane } from "../src/frame/line-door";
import { soundAttentionOf } from "../src/sound/attention";

const pane = (paneId: string, sessionId: string, active = false): LinePane => ({
  paneId,
  sessionId,
  name: "vibe-field",
  runs: "claude",
  state: "working",
  active,
});

const RECTS: Record<string, { left: number; width: number }> = {
  p1: { left: 0, width: 400 },
  p2: { left: 400, width: 400 },
  p3: { left: 800, width: 400 },
};
const rectOf = (id: string) => RECTS[id] ?? null;

describe("the window's attention", () => {
  it("names the active pane's session while the window has the keyboard and the deck is on screen", () => {
    const a = soundAttentionOf({
      panes: [pane("p2", "pty-b", true), pane("p1", "pty-a")],
      rectOf,
      windowWidth: 1200,
      hasFocus: true,
      onScreen: true,
    });
    expect(a.focused).toBe("pty-b");
  });
  it("places each session by its pane's centre across the window", () => {
    const a = soundAttentionOf({
      panes: [pane("p1", "pty-a", true), pane("p2", "pty-b"), pane("p3", "pty-c")],
      rectOf,
      windowWidth: 1200,
      hasFocus: true,
      onScreen: true,
    });
    expect(a.places["pty-a"]).toBeCloseTo(-2 / 3, 9);
    expect(a.places["pty-b"]).toBeCloseTo(0, 9);
    expect(a.places["pty-c"]).toBeCloseTo(2 / 3, 9);
  });
  it("names nobody while the window does not have the keyboard: you are not typing into it", () => {
    const a = soundAttentionOf({
      panes: [pane("p1", "pty-a", true)],
      rectOf,
      windowWidth: 1200,
      hasFocus: false,
      onScreen: true,
    });
    expect(a.focused).toBeNull();
    expect(Object.keys(a.places)).toEqual(["pty-a"]);
  });
  it("says nothing while the deck is not on screen: the sounds come from the centre", () => {
    expect(
      soundAttentionOf({
        panes: [pane("p1", "pty-a", true)],
        rectOf,
        windowWidth: 1200,
        hasFocus: true,
        onScreen: false,
      }),
    ).toEqual({ focused: null, places: {} });
  });
  it("places a session shown in two panes by the active one, and skips a pane with no box", () => {
    const a = soundAttentionOf({
      panes: [pane("p3", "pty-a", true), pane("p1", "pty-a"), pane("gone", "pty-z")],
      rectOf,
      windowWidth: 1200,
      hasFocus: true,
      onScreen: true,
    });
    expect(a.places).toEqual({ "pty-a": expect.closeTo(2 / 3, 9) });
  });
  it("keeps every place on the window, and never more places than the door takes", () => {
    const panes = Array.from({ length: SOUND_ATTENTION.MAX_PLACES + 10 }, (_, i) =>
      pane(`q${i}`, `pty-${i}`),
    );
    const a = soundAttentionOf({
      panes,
      rectOf: () => ({ left: -500, width: 100 }),
      windowWidth: 1200,
      hasFocus: true,
      onScreen: true,
    });
    expect(Object.keys(a.places)).toHaveLength(SOUND_ATTENTION.MAX_PLACES);
    expect(Object.values(a.places).every((x) => x === -1)).toBe(true);
  });
});
