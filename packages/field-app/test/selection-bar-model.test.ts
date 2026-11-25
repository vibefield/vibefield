// @vitest-environment node
/**
 * DK-11 — WHAT THE SELECTION BAR AND ITS MENU SAY (field/desk/bar/bar-model.ts; DESIGN.md §8 "The selection bar" —
 * Order, Keyboard; "The bar grown" — the order nearest first, the eyebrow; R1, R3, R4, R10, R11, R23 reversed, DK-D24,
 * DK-D29; HN-D3, CS-D11 A). The bar: Make a card · rule · the kind's acts · Duplicate · Tape it down · More · rule ·
 * Delete — Make a card for one object or several; taped, no Duplicate and "Lift the tape" wearing `lift`; a missing
 * face, its name and word where the acts would stand, Duplicate still offered. Tooltips the frame's way with the DESK's
 * keys — Make a card's ⌘C among them — a kind's act prints none. The menu, nearest first: the kind's acts · Open ·
 * Comment · Make a card | Duplicate · Bring to front · Send to back · Clean up | Tape | Delete; the eyebrow names what
 * it acts on. Item 578: Download… follows Open, for one print whose picture the desk holds. Track OM (ICE I61, I62): an
 * act says what it is now — disabled, a swatch — and an act that is a choice is a pill (its current choice, or Mixed),
 * More's one row for it opening its list, the list's rows its choices nearest first: checked, hinted, grouped, a choice
 * that asks for values with an ellipsis. OM-2: a choice whose every choice carries a swatch is a swatch pill — the
 * current one's swatch, none while Mixed — over a selection and in hand.
 */

import type { ActChoice } from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { handCells } from "../src/field/desk/bar/bar-hand";
import {
  type BarCell,
  barCells,
  choiceEyebrow,
  choiceGroups,
  choiceOfRow,
  MIXED_LABEL,
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
  downloadable: false,
  commentable: true,
  ...over,
});

/** A cell as one word: its kind, its act or id, its label. */
const said = (cells: readonly BarCell[]): string[] =>
  cells.map((cell) => {
    switch (cell.kind) {
      case "copy":
        return `copy:${cell.label}`;
      case "rule":
        return "|";
      case "act":
        return `act:${cell.id}`;
      case "choice":
        return `choice:${cell.id}:${cell.current}`;
      case "words":
        return `words:${cell.label}`;
      default:
        return `${cell.act}:${cell.glyph}`;
    }
  });

describe("the selection bar's cells", () => {
  it("in the canon's order: Make a card · rule · the kind's acts · Duplicate · Tape it down · More · rule · Delete", () => {
    const cells = barCells(
      facts({
        menu: [{ id: "seconds", label: "Seconds hand", glyph: { path: "M0 0" }, keys: "S" }],
      }),
      "mac",
    );
    expect(said(cells)).toEqual([
      "copy:Make a card",
      "|",
      "act:seconds",
      "duplicate:duplicate",
      "tape:tape",
      "more:ellipsis",
      "|",
      "delete:trash",
    ]);
  });

  it("says Make a card for several as for one — the count is the menu's eyebrow's, and the card's title", () => {
    expect(said(barCells(facts({ count: 2 }), "mac"))[0]).toBe("copy:Make a card");
  });

  it('taped: no Duplicate, and the tape act becomes "Lift the tape" wearing `lift` — an act whose name changes (R10)', () => {
    const cells = barCells(facts({ locked: true }), "mac");
    expect(said(cells)).toEqual([
      "copy:Make a card",
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
      "copy:Make a card",
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

  it('Make a card leads the bar where Send to… stood (CS-D11): "Make a card  ⌘C" — Ctrl+C off the Mac', () => {
    expect(barCells(facts(), "mac")[0]).toEqual({
      kind: "copy",
      label: "Make a card",
      tip: "Make a card  ⌘C",
    });
    expect(barCells(facts({ count: 3 }), "other")[0]).toEqual({
      kind: "copy",
      label: "Make a card",
      tip: "Make a card  Ctrl+C",
    });
  });
});

describe("the bar grown — its rows, nearest first", () => {
  const ids = (f: SelectionFacts) => menuGroups(f, "mac").map((g) => g.map((row) => row.id));

  it("the kind's acts · Open · Comment · Copy | Duplicate · Bring to front · Send to back | Tape | Delete", () => {
    expect(
      ids(facts({ menu: [{ id: "seconds", label: "Seconds hand" }], openable: true })),
    ).toEqual([
      ["act:seconds", "open", "comment", "copy"],
      ["duplicate", "front", "back"],
      ["tape"],
      ["delete"],
    ]);
  });

  // Item 578 — red until the model knows the row: a print whose picture the desk holds offers Download… after Open
  // (DESIGN.md §8 "The bar grown"), with its ellipsis and no key; anything else has no such row.
  it("Download… follows Open for one print whose picture the desk holds, and prints no key (item 578)", () => {
    expect(ids(facts({ openable: true, downloadable: true }))[0]).toEqual([
      "open",
      "download",
      "comment",
      "copy",
    ]);
    expect(ids(facts({ downloadable: true }))[0]).toEqual(["download", "comment", "copy"]);
    expect(ids(facts({ downloadable: true, locked: true }))[0]).toEqual([
      "download",
      "comment",
      "copy",
    ]);
    const row = menuGroups(facts({ downloadable: true }), "mac")
      .flat()
      .find((r) => r.id === "download");
    expect(row).toEqual({ id: "download", label: "Download…" });
    expect(
      menuGroups(facts({ downloadable: true }), "other")
        .flat()
        .find((r) => r.id === "download"),
    ).toEqual({ id: "download", label: "Download…" });
  });

  it("no Download row unless the selection is one print the desk can save (item 578)", () => {
    expect(ids(facts({ openable: true }))[0]).toEqual(["open", "comment", "copy"]);
    expect(
      ids(facts({ menu: [{ id: "seconds", label: "Seconds hand" }], downloadable: true }))[0],
    ).toEqual(["act:seconds", "download", "comment", "copy"]);
  });

  it("Clean up with two or more selected (DK-D29)", () => {
    expect(ids(facts({ count: 2 }))[1]).toEqual(["duplicate", "front", "back", "cleanup"]);
  });

  it("no Open unless exactly one object whose type opens (a container has no row — ⏎ enters it, R4)", () => {
    expect(ids(facts({ openable: false }))[0]).toEqual(["comment", "copy"]);
  });

  it("no Comment where the comment pad's kind is not drawn; no Duplicate while taped; Lift the tape", () => {
    const groups = menuGroups(facts({ commentable: false, locked: true }), "mac");
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([
      ["copy"],
      ["front", "back"],
      ["tape"],
      ["delete"],
    ]);
    expect(groups[2]?.[0]).toMatchObject({ label: "Lift the tape", key: "⇧⌘L" });
  });

  it("keys at the rows' ends for the desk's acts — Open ↩ · Copy ⌘C · Duplicate ⌘D · Tape ⇧⌘L · Delete ⌫ — none for a kind's act, Comment, Bring/Send, Clean up", () => {
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
      copy: "⌘C",
      duplicate: "⌘D",
      front: null,
      back: null,
      cleanup: null,
      tape: "⇧⌘L",
      delete: "⌫",
    });
    // HN-D3: Copy is a row taken like any other — it waits for nothing, and says Copy for two
    expect(rows.find((r) => r.id === "copy")).toEqual({
      id: "copy",
      label: "Make a card",
      key: "⌘C",
    });
    expect(rows.find((r) => r.id === "delete")).toMatchObject({ danger: true });
  });

  it("a missing face's menu offers none of its kind's acts", () => {
    expect(
      ids(facts({ words: [clockOff], menu: [{ id: "seconds", label: "Seconds hand" }] }))[0],
    ).toEqual(["comment", "copy"]);
  });

  it("the eyebrow names what it acts on: NOTE · 2 OBJECTS · CLOCK · PLUGIN OFF", () => {
    expect(menuEyebrow(facts())).toBe("NOTE");
    expect(menuEyebrow(facts({ count: 2, words: [note, clockOff] }))).toBe("2 OBJECTS");
    expect(menuEyebrow(facts({ words: [clockOff] }))).toBe("CLOCK · PLUGIN OFF");
  });
});

describe("what an act says now, and an act that is a choice (track OM; ICE I61, I62)", () => {
  const DEVICES: readonly ActChoice[] = [
    { id: "laptop", label: "Laptop", hint: "1280 × 800", group: "devices", current: true },
    { id: "phone", label: "iPhone 17 Pro", hint: "402 × 874", group: "devices" },
    { id: "landscape", label: "Turn to landscape", group: "turn" },
    {
      id: "custom",
      label: "Custom",
      hint: "your size and agent",
      group: "custom",
      fields: [
        { id: "width", label: "Width", kind: "number", value: 1280, min: 320, max: 8192, step: 1 },
      ],
    },
  ];
  const device = { id: "device", label: "Device", glyph: { path: "M0 0" }, choices: DEVICES };

  it("a choice act is a pill: its glyph, its current choice and its tip — Mixed when none is current", () => {
    const [pill] = barCells(facts({ menu: [device] }), "mac").filter((c) => c.kind === "choice");
    expect(pill).toEqual({
      kind: "choice",
      id: "device",
      label: "Device",
      glyph: { path: "M0 0" },
      current: "Laptop",
      mixed: false,
      tip: "Device: Laptop",
    });
    const mixed = barCells(
      facts({ menu: [{ ...device, choices: DEVICES.map(({ current: _, ...c }) => c) }] }),
      "mac",
    ).find((c) => c.kind === "choice");
    expect(mixed).toMatchObject({ current: MIXED_LABEL, mixed: true, tip: "Device: Mixed" });
  });

  it("an act its kind says is disabled is a disabled cell, one with a swatch carries it — and More draws the disabled one, never takes it", () => {
    const menu = [
      { id: "sound", label: "Mute", glyph: { path: "M1 1" }, enabled: false as const },
      { id: "finish", label: "Finish", swatch: "#2b3c5c" },
    ];
    const cells = barCells(facts({ menu }), "mac").filter((c) => c.kind === "act");
    expect(cells).toEqual([
      { kind: "act", id: "sound", label: "Mute", glyph: { path: "M1 1" }, disabled: true },
      { kind: "act", id: "finish", label: "Finish", glyph: undefined, swatch: "#2b3c5c" },
    ]);
    const [near] = menuGroups(facts({ menu }), "mac");
    expect(near?.slice(0, 2)).toEqual([
      { id: "act:sound", label: "Mute", waits: "" },
      { id: "act:finish", label: "Finish" },
    ]);
  });

  it("More lists a choice act as one row, its current choice in the key's place, taking it opening the list", () => {
    const [near] = menuGroups(facts({ menu: [device] }), "mac");
    expect(near?.[0]).toEqual({ id: "act:device", label: "Device", key: "Laptop", opens: true });
  });

  it("the list: the choices nearest first, a group per run of the kind's group, checked, hinted, an ellipsis for one that asks for values", () => {
    const groups = choiceGroups(DEVICES);
    expect(groups.map((g) => g.map((r) => [r.id, r.label, r.key, r.checked]))).toEqual([
      [
        ["choice:laptop", "Laptop", "1280 × 800", true],
        ["choice:phone", "iPhone 17 Pro", "402 × 874", false],
      ],
      [["choice:landscape", "Turn to landscape", undefined, false]],
      [["choice:custom", "Custom…", "your size and agent", false]],
    ]);
    expect(groups[2]?.[0]?.fields?.[0]?.id).toBe("width");
    expect(choiceOfRow("choice:custom")).toBe("custom");
    expect(choiceOfRow("act:device")).toBeUndefined();
    expect(choiceEyebrow("Device")).toBe("DEVICE");
    expect(choiceGroups([{ id: "a", label: "A", swatch: "#e0692a" }])[0]?.[0]?.swatch).toBe(
      "#e0692a",
    );
  });

  it("in hand, an action that is a choice is the same pill: its current choice in its cell and its tip", () => {
    const cells = handCells(
      {
        tools: [
          {
            id: "device",
            label: "Device",
            kind: "action",
            glyph: { path: "M0 0" },
            choices: DEVICES,
          },
          { id: "sound", label: "Mute", kind: "action", glyph: { path: "M1 1" } },
        ],
        active: "",
      },
      "mac",
    ).filter((c) => c.kind === "tool");
    expect(cells.map((c) => (c.kind === "tool" ? [c.id, c.look, c.current, c.tip] : []))).toEqual([
      ["device", "choice", "Laptop", "Device: Laptop"],
      ["sound", "action", undefined, "Mute"],
    ]);
  });
});

describe("a swatch choice — the simulator's Finish (track OM, OM-2; DESIGN.md §8 'An act that is a choice')", () => {
  // the iPhone 17 Pro's finishes, each with its band's colour (DESIGN.md §5.1), Cosmic Orange current
  const FINISHES: readonly ActChoice[] = [
    { id: "cosmic-orange", label: "Cosmic Orange", swatch: "#e0692a", current: true },
    { id: "deep-blue", label: "Deep Blue", swatch: "#2b3c5c" },
    { id: "silver-17p", label: "Silver", swatch: "#dededb" },
  ];
  const finish = { id: "finish", label: "Finish", choices: FINISHES };
  const unmarked = FINISHES.map(({ current: _, ...c }) => c);

  it("a choice whose every choice carries a swatch is a swatch pill: the current one's swatch, and its tip the act and the choice", () => {
    const pill = barCells(facts({ menu: [finish] }), "mac").find((c) => c.kind === "choice");
    expect(pill).toEqual({
      kind: "choice",
      id: "finish",
      label: "Finish",
      glyph: undefined,
      current: "Cosmic Orange",
      mixed: false,
      tip: "Finish: Cosmic Orange",
      swatches: true,
      swatch: "#e0692a",
    });
  });

  it('phones of one model on different finishes: Mixed, no swatch — the empty ring — and "Finish: Mixed"', () => {
    const pill = barCells(
      facts({ count: 2, menu: [{ ...finish, choices: unmarked }] }),
      "mac",
    ).find((c) => c.kind === "choice");
    expect(pill).toMatchObject({
      swatches: true,
      mixed: true,
      current: MIXED_LABEL,
      tip: "Finish: Mixed",
    });
    expect(pill).not.toHaveProperty("swatch");
  });

  it("a choice that leaves a swatch out anywhere is the label pill, its current choice's swatch never drawn", () => {
    const some = [...FINISHES, { id: "clear", label: "Clear" }];
    const pill = barCells(facts({ menu: [{ ...finish, choices: some }] }), "mac").find(
      (c) => c.kind === "choice",
    );
    expect(pill).toMatchObject({ current: "Cosmic Orange", tip: "Finish: Cosmic Orange" });
    expect(pill).not.toHaveProperty("swatches");
    expect(pill).not.toHaveProperty("swatch");
  });

  it("its list: the model's finishes by name, each with its dot, the current one checked — and More's row names it", () => {
    expect(choiceGroups(FINISHES)).toEqual([
      [
        { id: "choice:cosmic-orange", label: "Cosmic Orange", checked: true, swatch: "#e0692a" },
        { id: "choice:deep-blue", label: "Deep Blue", checked: false, swatch: "#2b3c5c" },
        { id: "choice:silver-17p", label: "Silver", checked: false, swatch: "#dededb" },
      ],
    ]);
    expect(choiceEyebrow("Finish")).toBe("FINISH");
    expect(menuGroups(facts({ menu: [finish] }), "mac")[0]?.[0]).toEqual({
      id: "act:finish",
      label: "Finish",
      key: "Cosmic Orange",
      opens: true,
    });
  });

  it("in hand, a held action that is a swatch choice is the same pill: the current one's swatch, Mixed with none marked", () => {
    const home = { id: "home", label: "Home", kind: "action", glyph: { path: "M0 0" } } as const;
    const tools = (choices: readonly ActChoice[]) =>
      handCells(
        { tools: [{ id: "finish", label: "Finish", kind: "action", choices }, home], active: "" },
        "mac",
      ).filter((c) => c.kind === "tool");
    const [pill, other] = tools(FINISHES);
    expect(pill).toMatchObject({
      id: "finish",
      look: "choice",
      current: "Cosmic Orange",
      tip: "Finish: Cosmic Orange",
      swatches: true,
      swatch: "#e0692a",
    });
    expect(pill).not.toHaveProperty("mixed");
    expect(other).toMatchObject({ id: "home", look: "action", swatch: undefined });
    expect(other).not.toHaveProperty("swatches");
    const [mixed] = tools(unmarked);
    expect(mixed).toMatchObject({
      current: MIXED_LABEL,
      tip: "Finish: Mixed",
      mixed: true,
      swatches: true,
      swatch: undefined,
    });
  });
});
