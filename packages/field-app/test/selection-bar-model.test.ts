// @vitest-environment node
/**
 * DK-11 — WHAT THE SELECTION BAR AND ITS MENU SAY (field/desk/bar/bar-model.ts; DESIGN.md §8 "The selection bar" —
 * Order, Keyboard; "The bar grown" — the order nearest first, the eyebrow; R1, R3, R4, R10, R11, R23 reversed, DK-D24,
 * DK-D29). The bar: Send to… · rule · the kind's acts · Duplicate · Tape it down · More · rule · Delete; several
 * selected, "Send 2 to…"; taped, no Duplicate and "Lift the tape" wearing `lift`; a missing face, its name and word
 * where the acts would stand, Duplicate still offered. Tooltips the frame's way with the DESK's keys — a kind's act
 * prints none. The menu, nearest first: the kind's acts · Open · Comment · Send to… | Duplicate · Bring to front ·
 * Send to back · Clean up | Tape | Delete; the eyebrow names what it acts on.
 */
import { describe, expect, it } from "vitest";
import {
  type BarCell,
  barCells,
  menuEyebrow,
  menuGroups,
  type SelectionFacts,
  tipOf,
} from "../src/field/desk/bar/bar-model";

const note = { type: "desk.note", title: "Note", state: null, label: "Note" } as const;
const clockOff = {
  type: "vibefield.example.desk-clock",
  title: "Clock",
  state: "plugin off",
  label: "Clock · plugin off",
} as const;

const facts = (over: Partial<SelectionFacts> = {}): SelectionFacts => ({
  count: 1,
  locked: false,
  menu: [],
  words: [note],
  openable: false,
  commentable: true,
  ...over,
});

/** A cell as one word: its kind, its act or id, its label. */
const said = (cells: readonly BarCell[]): string[] =>
  cells.map((cell) => {
    switch (cell.kind) {
      case "send":
        return `send:${cell.label}`;
      case "rule":
        return "|";
      case "act":
        return `act:${cell.id}`;
      case "words":
        return `words:${cell.label}`;
      default:
        return `${cell.act}:${cell.glyph}`;
    }
  });

describe("the selection bar's cells", () => {
  it("in the canon's order: Send to… · rule · the kind's acts · Duplicate · Tape it down · More · rule · Delete", () => {
    const cells = barCells(
      facts({
        menu: [{ id: "seconds", label: "Seconds hand", glyph: { path: "M0 0" }, keys: "S" }],
      }),
      "mac",
    );
    expect(said(cells)).toEqual([
      "send:Send to…",
      "|",
      "act:seconds",
      "duplicate:duplicate",
      "tape:tape",
      "more:ellipsis",
      "|",
      "delete:trash",
    ]);
  });

  it('counts several: "Send 2 to…"', () => {
    expect(said(barCells(facts({ count: 2 }), "mac"))[0]).toBe("send:Send 2 to…");
  });

  it('taped: no Duplicate, and the tape act becomes "Lift the tape" wearing `lift` — an act whose name changes (R10)', () => {
    const cells = barCells(facts({ locked: true }), "mac");
    expect(said(cells)).toEqual([
      "send:Send to…",
      "|",
      "tape:lift",
      "more:ellipsis",
      "|",
      "delete:trash",
    ]);
    const tape = cells.find((c) => c.kind === "desk" && c.act === "tape");
    expect(tape).toMatchObject({ label: "Lift the tape", tip: "Lift the tape  ⇧⌘L" });
  });

  it("a missing face: its name and word where the kind's acts would stand — its acts not offered — and Duplicate still (R11)", () => {
    const cells = barCells(
      facts({ words: [clockOff], menu: [{ id: "seconds", label: "Seconds hand" }] }),
      "mac",
    );
    expect(said(cells)).toEqual([
      "send:Send to…",
      "|",
      "words:Clock · plugin off",
      "duplicate:duplicate",
      "tape:tape",
      "more:ellipsis",
      "|",
      "delete:trash",
    ]);
  });

  it('says the DESK\'s keys the frame\'s way — "Duplicate  ⌘D", "Tape it down  ⇧⌘L", "Delete  ⌫" — and a kind\'s act none (R1)', () => {
    const cells = barCells(
      facts({ menu: [{ id: "vinyl", label: "Change the vinyl", keys: "T" }] }),
      "mac",
    );
    const tips = Object.fromEntries(
      cells.flatMap((c) => (c.kind === "desk" ? [[c.act, c.tip] as const] : [])),
    );
    expect(tips).toEqual({
      duplicate: "Duplicate  ⌘D",
      tape: "Tape it down  ⇧⌘L",
      more: "More",
      delete: "Delete  ⌫",
    });
    const act = cells.find((c) => c.kind === "act");
    expect(act).toEqual({ kind: "act", id: "vinyl", label: "Change the vinyl", glyph: undefined });
    // off the Mac
    const other = barCells(facts(), "other").flatMap((c) => (c.kind === "desk" ? [c.tip] : []));
    expect(other).toEqual([
      "Duplicate  Ctrl+D",
      "Tape it down  Ctrl+Shift+L",
      "More",
      "Delete  Delete",
    ]);
    expect(tipOf("More")).toBe("More");
  });

  it("Send to… drafts (DK-14): live, its tip its name — no key, DK-D24 binds none — counting several", () => {
    expect(barCells(facts(), "mac")[0]).toEqual({
      kind: "send",
      label: "Send to…",
      tip: "Send to…",
    });
    expect(barCells(facts({ count: 3 }), "other")[0]).toEqual({
      kind: "send",
      label: "Send 3 to…",
      tip: "Send 3 to…",
    });
  });
});

describe("the bar grown — its rows, nearest first", () => {
  const ids = (f: SelectionFacts) => menuGroups(f, "mac").map((g) => g.map((row) => row.id));

  it("the kind's acts · Open · Comment · Send to… | Duplicate · Bring to front · Send to back | Tape | Delete — no Copy", () => {
    expect(
      ids(facts({ menu: [{ id: "seconds", label: "Seconds hand" }], openable: true })),
    ).toEqual([
      ["act:seconds", "open", "comment", "send"],
      ["duplicate", "front", "back"],
      ["tape"],
      ["delete"],
    ]);
  });

  it("Clean up with two or more selected (DK-D29)", () => {
    expect(ids(facts({ count: 2 }))[1]).toEqual(["duplicate", "front", "back", "cleanup"]);
  });

  it("no Open unless exactly one object whose type opens (a container has no row — ⏎ enters it, R4)", () => {
    expect(ids(facts({ openable: false }))[0]).toEqual(["comment", "send"]);
  });

  it("no Comment where the comment pad's kind is not drawn; no Duplicate while taped; Lift the tape", () => {
    const groups = menuGroups(facts({ commentable: false, locked: true }), "mac");
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([
      ["send"],
      ["front", "back"],
      ["tape"],
      ["delete"],
    ]);
    expect(groups[2]?.[0]).toMatchObject({ label: "Lift the tape", key: "⇧⌘L" });
  });

  it("keys at the rows' ends for the desk's acts — Open ↩ · Duplicate ⌘D · Tape ⇧⌘L · Delete ⌫ — none for a kind's act, Comment, Bring/Send, Clean up", () => {
    const rows = menuGroups(
      facts({
        count: 2,
        openable: true,
        menu: [{ id: "seconds", label: "Seconds hand", keys: "S" }],
      }),
      "mac",
    ).flat();
    expect(Object.fromEntries(rows.map((r) => [r.id, r.key ?? null]))).toEqual({
      "act:seconds": null,
      open: "↩",
      comment: null,
      send: null,
      duplicate: "⌘D",
      front: null,
      back: null,
      cleanup: null,
      tape: "⇧⌘L",
      delete: "⌫",
    });
    // DK-14: Send to… is a row taken like any other — it waits for nothing
    expect(rows.find((r) => r.id === "send")).toEqual({ id: "send", label: "Send 2 to…" });
    expect(rows.find((r) => r.id === "delete")).toMatchObject({ danger: true });
  });

  it("a missing face's menu offers none of its kind's acts", () => {
    expect(
      ids(facts({ words: [clockOff], menu: [{ id: "seconds", label: "Seconds hand" }] }))[0],
    ).toEqual(["comment", "send"]);
  });

  it("the eyebrow names what it acts on: NOTE · 2 OBJECTS · CLOCK · PLUGIN OFF", () => {
    expect(menuEyebrow(facts())).toBe("NOTE");
    expect(menuEyebrow(facts({ count: 2, words: [note, clockOff] }))).toBe("2 OBJECTS");
    expect(menuEyebrow(facts({ words: [clockOff] }))).toBe("CLOCK · PLUGIN OFF");
  });
});
