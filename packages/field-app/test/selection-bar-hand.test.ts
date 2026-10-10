// @vitest-environment node
/**
 * DK-12 — THE TOOLS IN HAND, as the bar says them (field/desk/bar/bar-hand.ts; DESIGN.md §8 "Tools in hand"; R2, R13;
 * ICE I22). Over the REAL kinds' held tools — ICE's notebook, whiteboard and calendar, and the example plugin's clock —
 * each made into the anchor's slots as ICE makes them (its `heldSlots`: every tool not keys-only, its swatch from the
 * kind's look under the product's palette): the canon's order, the slots in their DECLARED order never regrouped, the 6
 * gap where the run changes between pages, inks and tools, what each slot looks like, its tooltip, the readout one slot
 * after the tools, Done.
 */
import type { HeldToolDef } from "@vibecook/ice";
import { kindPalette } from "@vibecook/ice/desk";
import {
  BOARD_TOOLS,
  boardKind,
  calendarKind,
  NOTEBOOK_TOOLS,
  notebookKind,
} from "@vibecook/ice/desk/objects";
import { CLOCK_TOOLS } from "@vibefield/plugin-example-desk-clock";
import { describe, expect, it } from "vitest";
import {
  DONE_TIP,
  type HandCell,
  type HeldSlot,
  handCells,
  lookOf,
  runOf,
  slotsKey,
} from "../src/field/desk/bar/bar-hand";
import { deskLook } from "../src/field/desk/desk-layer";

/** ICE's `heldSlots` (desk compose/marks.ts), mirrored: the slots a kind's tools take in the bar. */
const slotsOf = (
  tools: readonly HeldToolDef[],
  swatches: Readonly<Record<string, string>> = {},
): HeldSlot[] =>
  tools
    .filter((t) => t.bar !== false)
    .map((t) => ({
      id: t.id,
      label: t.label,
      ...(t.kind !== undefined ? { kind: t.kind } : {}),
      ...(t.hint !== undefined ? { hint: t.hint } : {}),
      ...(t.glyph !== undefined ? { glyph: t.glyph } : {}),
      ...(swatches[t.id] !== undefined ? { swatch: swatches[t.id] as string } : {}),
    }));

// a kind's `theme` takes the palette AS A KIND IS HANDED IT (ICE I46: its cast colour a role of it)
const palette = kindPalette(deskLook("light").palette);
const swatchesOf = (look: unknown): Record<string, string> =>
  (look as { swatches: Record<string, string> }).swatches;

const NOTEBOOK = slotsOf(NOTEBOOK_TOOLS, swatchesOf(notebookKind().theme?.(palette, "light")));
const WHITEBOARD = slotsOf(BOARD_TOOLS, swatchesOf(boardKind().theme?.(palette, "light")));
const CALENDAR = slotsOf(calendarKind().open?.tools ?? []);
const CLOCK = slotsOf(CLOCK_TOOLS);

/** The cells as a reader meets them: `|` a rule, a tool by its id (`+` before it where the run changes), the word, Done. */
const said = (cells: readonly HandCell[]): string[] =>
  cells.map((c) => {
    switch (c.kind) {
      case "send":
        return c.label;
      case "rule":
        return "|";
      case "tool":
        return `${c.gap ? "+" : ""}${c.id}`;
      case "readout":
        return `“${c.text}”`;
      default:
        return c.label;
    }
  });

const tools = (cells: readonly HandCell[]) =>
  cells.filter((c): c is Extract<HandCell, { kind: "tool" }> => c.kind === "tool");

describe("the tools in hand — the four specimens, from the real kinds' held tools (DK-12)", () => {
  it("the notebook: ‹ › · felt, ball, fountain, red · undo, reading “Page 1” — the pens dots in their own inks, the fountain in hand", () => {
    const cells = handCells({ tools: NOTEBOOK, active: "pen:fountain", readout: "Page 1" });
    expect(said(cells)).toEqual([
      "Send to…",
      "|",
      "turn:-1",
      "turn:1",
      "+pen:felt",
      "pen:ball",
      "pen:fountain",
      "pen:red",
      "+undo",
      "“Page 1”",
      "|",
      "Done",
    ]);
    const t = tools(cells);
    expect(t.map((c) => c.look)).toEqual([
      "action",
      "action",
      "dot",
      "dot",
      "dot",
      "dot",
      "action",
    ]);
    expect(t.map((c) => c.run)).toEqual(["page", "page", "ink", "ink", "ink", "ink", "tool"]);
    expect(t.filter((c) => c.on).map((c) => c.id)).toEqual(["pen:fountain"]);
    // each dot in its own ink, as the kind's look says it under the product's palette
    for (const c of t.filter((c) => c.look === "dot")) {
      expect(c.swatch, c.id).toBe(NOTEBOOK.find((s) => s.id === c.id)?.swatch);
      expect(c.swatch, c.id).toBeTruthy();
    }
    expect(t.find((c) => c.id === "pen:felt")?.tip).toBe("Felt pen  1");
    expect(t.find((c) => c.id === "turn:-1")).toMatchObject({
      tip: "Previous page  ←",
      glyph: "chevron-left",
    });
    expect(t.find((c) => c.id === "undo")?.tip).toBe("Undo  ⌘Z");
    // redo is keys-only on the notebook (`bar: false`): never a slot
    expect(t.map((c) => c.id)).not.toContain("redo");
  });

  it("the whiteboard: black, blue, red, green · eraser · undo · redo — the eraser a cell, inverted while in hand; no word", () => {
    const cells = handCells({ tools: WHITEBOARD, active: "eraser" });
    expect(said(cells)).toEqual([
      "Send to…",
      "|",
      "marker:black",
      "marker:blue",
      "marker:red",
      "marker:green",
      "+eraser",
      "undo",
      "redo",
      "|",
      "Done",
    ]);
    const t = tools(cells);
    expect(t.map((c) => c.look)).toEqual(["dot", "dot", "dot", "dot", "mode", "action", "action"]);
    expect(t.find((c) => c.id === "eraser")).toMatchObject({
      look: "mode",
      on: true,
      swatch: undefined,
      glyph: "eraser",
      tip: "Eraser  E",
    });
    expect(t.find((c) => c.id === "marker:black")?.tip).toBe("Black marker  1");
    expect(t.find((c) => c.id === "redo")?.glyph).toBe("redo");
    expect(cells.some((c) => c.kind === "readout")).toBe(false);
  });

  it("the calendar: ‹ › · today · pen, reading its month — the pen a mode without a swatch", () => {
    const cells = handCells({ tools: CALENDAR, active: "pen", readout: "September" });
    expect(said(cells)).toEqual([
      "Send to…",
      "|",
      "month:-1",
      "month:1",
      "+today",
      "pen",
      "“September”",
      "|",
      "Done",
    ]);
    const t = tools(cells);
    expect(t.map((c) => [c.id, c.look, c.run])).toEqual([
      ["month:-1", "action", "page"],
      ["month:1", "action", "page"],
      ["today", "action", "tool"],
      ["pen", "mode", "tool"],
    ]);
    expect(t.find((c) => c.id === "pen")).toMatchObject({ on: true, tip: "The pen  P" });
    expect(t.find((c) => c.id === "today")?.tip).toBe("Today  T");
  });

  it("the clock: seconds · the 24-hour ring · an hour back · an hour ahead · the next dial — its own five drawings, reading its time", () => {
    const cells = handCells({ tools: CLOCK, active: "", readout: "10:08:42" });
    expect(said(cells)).toEqual([
      "Send to…",
      "|",
      "seconds",
      "ring24",
      "zone-back",
      "zone-ahead",
      "dial",
      "“10:08:42”",
      "|",
      "Done",
    ]);
    const t = tools(cells);
    expect(t.every((c) => c.look === "action" && c.run === "tool" && !c.gap)).toBe(true);
    // each its own drawing (`{ path }`) — the bar's one path renderer draws it
    expect(t.every((c) => typeof c.glyph === "object" && typeof c.glyph?.path === "string")).toBe(
      true,
    );
    expect(t.map((c) => c.tip)).toEqual([
      "Seconds hand  S",
      "24-hour ring  H",
      "An hour back  [",
      "An hour ahead  ]",
      "Next dial  F",
    ]);
  });
});

describe("what a slot looks like, and where the runs change (§8, R13)", () => {
  it("a mode with a swatch is a DOT (an ink); without one a cell; an action a cell; no kind faint", () => {
    expect(lookOf({ id: "a", label: "A", kind: "mode", swatch: "#000000" })).toBe("dot");
    expect(lookOf({ id: "a", label: "A", kind: "mode" })).toBe("mode");
    expect(lookOf({ id: "a", label: "A", kind: "action", swatch: "#000000" })).toBe("action");
    expect(lookOf({ id: "a", label: "A" })).toBe("faint");
    expect(runOf({ id: "a", label: "A", kind: "mode", swatch: "#000000" })).toBe("ink");
    // §13's chevron is a page or a month turned — the slots that are PAGES
    expect(runOf({ id: "a", label: "A", kind: "action", glyph: "chevron" })).toBe("page");
    expect(runOf({ id: "a", label: "A", kind: "action", glyph: "chevron-left" })).toBe("page");
    expect(runOf({ id: "a", label: "A", kind: "action", glyph: { path: "M0 0" } })).toBe("tool");
    expect(runOf({ id: "a", label: "A", kind: "mode" })).toBe("tool");
  });

  it("keeps the DECLARED order, never regrouped: a gap each time the run changes, however often it changes back", () => {
    const cells = handCells({
      tools: [
        { id: "ink-1", label: "Ink", kind: "mode", swatch: "#111111" },
        { id: "next", label: "Next", kind: "action", glyph: "chevron" },
        { id: "ink-2", label: "Ink", kind: "mode", swatch: "#222222" },
        { id: "wait", label: "Waits" },
      ],
      active: "ink-2",
    });
    expect(said(cells)).toEqual([
      "Send to…",
      "|",
      "ink-1",
      "+next",
      "+ink-2",
      "+wait",
      "|",
      "Done",
    ]);
    // a mode's `on` is the anchor's mode in hand; never an action's, never a slot that only waits — even named by it
    expect(tools(cells).map((c) => c.on)).toEqual([false, false, true, false]);
    for (const active of ["next", "wait"]) {
      const named = handCells({
        tools: [
          { id: "next", label: "Next", kind: "action", glyph: "chevron" },
          { id: "wait", label: "Waits" },
        ],
        active,
      });
      expect(
        tools(named).map((c) => c.on),
        active,
      ).toEqual([false, false]);
    }
  });

  it("a slot with no glyph and no swatch keeps its label (R3); an unknown name passes to §13's table, which draws `missing`", () => {
    const [plain, odd] = tools(
      handCells({
        tools: [
          { id: "flip", label: "Flip", kind: "action" },
          { id: "odd", label: "Odd", kind: "action", glyph: "stopwatch" },
        ],
        active: "",
      }),
    );
    expect(plain).toMatchObject({ glyph: undefined, label: "Flip", tip: "Flip" });
    expect(odd?.glyph).toBe("stopwatch");
  });

  it("says no word for a kind that says none — or an empty one — and Done's tip the frame's way", () => {
    const none = handCells({ tools: [], active: "" });
    expect(said(none)).toEqual(["Send to…", "|", "|", "Done"]);
    expect(said(handCells({ tools: [], active: "", readout: "" }))).toEqual(said(none));
    expect(none.at(-1)).toEqual({ kind: "done", label: "Done", tip: "Put it down  Esc" });
    expect(DONE_TIP).toBe("Put it down  Esc");
    expect(none[0]).toEqual({ kind: "send", label: "Send to…", tip: "Send to…" });
  });

  it("keys the slots by everything the bar says of them — a swatch's change is a change, the same slots never are", () => {
    expect(slotsKey(NOTEBOOK)).toBe(slotsKey(NOTEBOOK.map((s) => ({ ...s }))));
    const night = slotsOf(
      NOTEBOOK_TOOLS,
      swatchesOf(notebookKind().theme?.(kindPalette(deskLook("dark").palette), "dark")),
    );
    const changed = NOTEBOOK.some((s, i) => s.swatch !== night[i]?.swatch);
    expect(slotsKey(night) !== slotsKey(NOTEBOOK)).toBe(changed);
    expect(slotsKey([{ id: "a", label: "A" }])).not.toBe(slotsKey([{ id: "a", label: "B" }]));
  });

  it("PT-5a (ICE I49): a slot its kind says is DISABLED NOW keeps its look and is marked so — and a slot's state is part of what the bar says of it (its key moves when it comes live, when its label or its glyph changes)", () => {
    const back = {
      id: "back",
      label: "Back",
      kind: "action",
      hint: "⌘[",
      glyph: { path: "M0 0" },
    } as const;
    const reload = {
      id: "reload",
      label: "Reload",
      kind: "action",
      glyph: { path: "M1 1" },
    } as const;
    const stop = { ...reload, label: "Stop", glyph: { path: "M2 2" } } as const;
    const cells = handCells({ tools: [{ ...back, enabled: false }, reload], active: "" });
    const tools = cells.filter((c) => c.kind === "tool");
    expect(tools.map((c) => [c.id, c.look, c.disabled])).toEqual([
      ["back", "action", true],
      ["reload", "action", false],
    ]);
    // a slot declared only is faint, never "disabled": its kind said nothing of it
    const faint = handCells({ tools: [{ id: "later", label: "Later" }], active: "" });
    expect(faint.filter((c) => c.kind === "tool").map((c) => [c.look, c.disabled])).toEqual([
      ["faint", false],
    ]);
    // the key: live ≠ disabled; Reload ≠ Stop
    expect(slotsKey([back])).not.toBe(slotsKey([{ ...back, enabled: false }]));
    expect(slotsKey([{ ...back, enabled: false }])).toBe(slotsKey([{ ...back, enabled: false }]));
    expect(slotsKey([reload])).not.toBe(slotsKey([stop]));
  });
});
