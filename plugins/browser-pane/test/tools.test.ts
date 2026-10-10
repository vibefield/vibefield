// PT-5a (ruling 2; ICE I49) — THE HELD BAR'S TOOLS SAY THEIR STATE: ‹ back and › forward are disabled where the page has
// nowhere to go — a still has nowhere, a desk with no answer has nowhere — and ↻ reload reads Stop (the head's ✕, its
// label) while the page loads. Read off the pane's desk state (`HeldToolStateContext.local` — the face's words), never the
// document: a page's history is not a prop.
import type { Entity, HeldToolStateContext, LiveInfo } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { PANE_TOOLS, STOP_GLYPH } from "../src";

/** A tool's state under a pane whose page says `info` (undefined: no live page — a still, the film). */
const stateOf = (id: string, info: LiveInfo | undefined, local: "none" | "lent" = "lent") => {
  const tool = PANE_TOOLS.find((t) => t.id === id);
  if (tool === undefined) throw new Error(`no ${id}`);
  const ctx = {
    world: undefined as never,
    entity: 7 as Entity,
    props: () => ({}),
    local:
      local === "none"
        ? undefined
        : { page: (e: Entity) => (e === 7 && info !== undefined ? { info } : undefined) },
  } as unknown as HeldToolStateContext;
  return tool.state?.(ctx);
};

describe("PT-5a — the pane's held tools say their state (ICE I49)", () => {
  it("‹ and › are DISABLED where the page has nowhere to go: no history, a still, a desk that answers nothing — and live the moment it has", () => {
    for (const id of ["back", "forward"]) {
      expect(stateOf(id, {}), id).toEqual({ enabled: false });
      expect(stateOf(id, { back: false, forward: false }), id).toEqual({ enabled: false });
      // a still (no live page behind the pane), and an engine with no desk answering
      expect(stateOf(id, undefined), id).toEqual({ enabled: false });
      expect(stateOf(id, { back: true, forward: true }, "none"), id).toEqual({ enabled: false });
    }
    // each reads ITS OWN reach
    expect(stateOf("back", { back: true })).toEqual({ enabled: true });
    expect(stateOf("forward", { back: true })).toEqual({ enabled: false });
    expect(stateOf("forward", { forward: true })).toEqual({ enabled: true });
    expect(stateOf("back", { forward: true })).toEqual({ enabled: false });
  });

  it("↻ reads STOP — the head's ✕, its label — while the page loads, and is the tool as declared once it has", () => {
    expect(stateOf("reload", { loading: 0.5 })).toEqual({ glyph: STOP_GLYPH, label: "Stop" });
    expect(stateOf("reload", { loading: 0 })).toEqual({ glyph: STOP_GLYPH, label: "Stop" });
    expect(stateOf("reload", {})).toBeUndefined();
    expect(stateOf("reload", undefined)).toBeUndefined();
    // as declared: Reload, its own glyph, never disabled (a failed page's ↻ tries again)
    const reload = PANE_TOOLS.find((t) => t.id === "reload");
    expect(reload?.label).toBe("Reload");
    expect(reload?.glyph).not.toEqual(STOP_GLYPH);
  });

  it("the address and the device say no state: always the tools as declared", () => {
    for (const id of ["address", "device"])
      expect(PANE_TOOLS.find((t) => t.id === id)?.state, id).toBeUndefined();
  });
});
