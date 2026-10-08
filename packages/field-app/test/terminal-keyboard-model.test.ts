/**
 * GT-7 — Settings → Terminal → Keyboard, as data. Every fact the rows show is
 * ghosttea's: the defaults are the pinned package's dump of Ghostty's macOS
 * table, whether an action runs is its router's answer, and the effective list
 * is the loader's snapshot. These cases hold the model to those sources, and
 * hold the three chords VibeField keeps (GT-D21) to the rows that name them.
 */
import { describe, expect, it } from "vitest";
import { PRODUCT_CHORDS } from "../src/field/product-chords";
import {
  actionLabel,
  bindingLine,
  chordGlyphs,
  defaultBindings,
  isPerformableTrigger,
  type KeyboardRow,
  keyboardRows,
  reservedWords,
  routeOfAction,
  routeWords,
  splitBinding,
  triggerFromKeyEvent,
  triggerKey,
} from "../src/panels/terminal/keyboard-model";

const EMPTY = { keybindings: [], clearKeybindings: false };

function row(rows: readonly KeyboardRow[], id: string): KeyboardRow {
  const found = rows.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
}

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("chords", () => {
  it("gives a trigger one identity however it is spelled", () => {
    expect(triggerKey("super+k")).toBe("super+k");
    expect(triggerKey("cmd+K")).toBe("super+k");
    expect(triggerKey("global:performable:super+k")).toBe("super+k");
    expect(triggerKey("super+digit_1")).toBe(triggerKey("super+1"));
    expect(triggerKey("super+shift+ctrl+alt+a")).toBe("ctrl+alt+shift+super+a");
    expect(triggerKey("super+")).toBeNull();
  });

  it("splits a keybind value where the loader does, even when the trigger ends in =", () => {
    expect(splitBinding("super+==increase_font_size")).toEqual({
      trigger: "super+=",
      action: "increase_font_size",
    });
    expect(splitBinding(" super+k = clear_screen ")).toEqual({
      trigger: "super+k",
      action: "clear_screen",
    });
    expect(splitBinding("clear")).toBeNull();
    expect(splitBinding("super+k=")).toBeNull();
  });

  it("draws a chord as a Mac keyboard does, modifiers in ⌃⌥⇧⌘ order", () => {
    expect(chordGlyphs("super+shift+enter")).toEqual(["⇧", "⌘", "↩"]);
    expect(chordGlyphs("super+digit_1")).toEqual(["⌘", "1"]);
    expect(chordGlyphs("super+alt+shift+ctrl+f5")).toEqual(["⌃", "⌥", "⇧", "⌘", "F5"]);
    expect(chordGlyphs("super+arrow_left")).toEqual(["⌘", "←"]);
  });

  it("records a key press as Ghostty writes it — printable keys unshifted", () => {
    expect(
      triggerFromKeyEvent(keyEvent({ key: "K", code: "KeyK", metaKey: true, shiftKey: true })),
    ).toBe("super+shift+k");
    expect(
      triggerFromKeyEvent(
        keyEvent({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
      ),
    ).toBe("super+shift+[");
    expect(
      triggerFromKeyEvent(keyEvent({ key: "!", code: "Digit1", metaKey: true, shiftKey: true })),
    ).toBe("super+shift+1");
    expect(
      triggerFromKeyEvent(keyEvent({ key: "ArrowLeft", code: "ArrowLeft", altKey: true })),
    ).toBe("alt+arrow_left");
    expect(triggerFromKeyEvent(keyEvent({ key: "F5", code: "F5", ctrlKey: true }))).toBe("ctrl+f5");
    expect(
      triggerFromKeyEvent(keyEvent({ key: "Meta", code: "MetaLeft", metaKey: true })),
    ).toBeNull();
  });

  it("reads the performable flag from the trigger as a layer wrote it", () => {
    expect(isPerformableTrigger("performable:super+f")).toBe(true);
    expect(isPerformableTrigger("global:performable:super+f")).toBe(true);
    expect(isPerformableTrigger("super+f")).toBe(false);
  });

  it("frees a chord by its bare name, and binds with the flags given", () => {
    expect(bindingLine("performable:super+f", null)).toBe("super+f=unbind");
    expect(bindingLine("performable:super+f", "start_search")).toBe(
      "performable:super+f=start_search",
    );
  });
});

describe("labels", () => {
  it("names an action as a person would, leaving out Ghostty's default target", () => {
    expect(actionLabel("new_split:right")).toBe("Split · right");
    expect(actionLabel("close_tab:this")).toBe("Close tab");
    expect(actionLabel("close_tab:other")).toBe("Close tab · other");
    expect(actionLabel("some_new_action")).toBe("Some new action");
  });
});

describe("routes", () => {
  it("asks ghosttea's router where an action goes", () => {
    expect(routeOfAction("new_split:right")).toBe("workspace");
    expect(routeOfAction("copy_to_clipboard")).toBe("terminal");
    expect(routeOfAction("quit")).toBe("platform");
    expect(routeOfAction("increase_font_size")).toBe("unhandled");
    expect(routeOfAction("not_an_action")).toBe("invalid");
  });
});

describe("the rows", () => {
  const defaults = defaultBindings();
  const rows = keyboardRows(EMPTY, []);

  it("lists every default chord once, as Ghostty set it", () => {
    expect(rows).toHaveLength(defaults.size);
    expect(rows.every((entry) => entry.state === "default" && entry.setBy === "ghostty")).toBe(
      true,
    );
    expect(row(rows, "super+d")).toMatchObject({
      action: "new_split:right",
      route: "workspace",
      group: "Splits",
    });
  });

  it("marks exactly the chords VibeField keeps, on the Ghostty defaults they override", () => {
    const reserved = rows.filter((entry) => entry.reserved !== null);
    expect(reserved.map((entry) => [entry.id, entry.reserved?.id]).sort()).toEqual(
      PRODUCT_CHORDS.map((chord) => [triggerKey(chord.trigger), chord.id]).sort(),
    );
    expect(routeWords(row(rows, "super+k"))).toEqual({
      text: "VibeField: Command palette",
      runs: false,
    });
  });

  it("says WHEN a chord is kept when it is kept only sometimes — the Peek's ⌘F, in History and Godview (K4)", () => {
    const find = row(rows, "super+f");
    expect(find.reserved?.id).toBe("search");
    expect(find.defaultAction).toBe("start_search");
    expect(routeWords(find)).toEqual({ text: "VibeField: Search", runs: false });
    const kept = find.reserved;
    if (kept === null) throw new Error("⌘F is not kept");
    expect(reservedWords(kept, find.defaultAction)).toBe(
      "VibeField: Search, while History or Godview is the view — Ghostty's find never runs on this chord then.",
    );
    // an always-kept chord says no when
    const palette = row(rows, "super+k");
    if (palette.reserved === null) throw new Error("⌘K is not kept");
    expect(reservedWords(palette.reserved, palette.defaultAction)).toBe(
      "VibeField: Command palette — Ghostty's clear the screen never runs on this chord.",
    );
  });

  it("says what a platform action does in the deck, where the window is Godview", () => {
    const quit = rows.find((entry) => entry.action === "quit");
    expect(quit === undefined ? null : routeWords(quit)).toEqual({
      text: "Closes Godview",
      runs: true,
    });
  });

  it("tells a swallowed key from one that reaches the shell", () => {
    // ⌘F went to the Peek (2026-10-08), so ⌘E — Find the selection — is the
    // performable default ghosttea does not handle yet
    const find = row(rows, "super+e");
    expect(find).toMatchObject({
      action: "search_selection",
      route: "unhandled",
      performable: true,
    });
    expect(routeWords(find).text).toBe("Not in ghosttea yet — the key goes to the shell");
    // Ghostty's own spelling carries the step: `increase_font_size:1`.
    const bigger = rows.find(
      (entry) => entry.action?.startsWith("increase_font_size") === true && !entry.performable,
    );
    expect(bigger === undefined ? null : routeWords(bigger).text).toBe(
      "Not in ghosttea yet — the key is swallowed",
    );
  });

  it("names who decided each changed chord", () => {
    const layered = keyboardRows(
      {
        keybindings: [
          { trigger: "super+d", action: "new_split:down" },
          { trigger: "super+k", action: "unbind" },
          { trigger: "ctrl+super+k", action: "clear_screen" },
          { trigger: "super+q", action: "unbind" },
          { trigger: "ctrl+super+x", action: "unbind" },
        ],
        clearKeybindings: false,
      },
      ["super+k=unbind", "ctrl+super+k=clear_screen", "super+q=unbind"],
    );
    expect(row(layered, "super+d")).toMatchObject({
      state: "changed",
      setBy: "your-ghostty",
      defaultAction: "new_split:right",
    });
    expect(row(layered, "super+k")).toMatchObject({
      state: "removed",
      action: null,
      setBy: "this-mac",
    });
    expect(row(layered, "ctrl+super+k")).toMatchObject({
      state: "added",
      setBy: "this-mac",
      group: "Scrolling",
    });
    expect(routeWords(row(layered, "super+q"))).toEqual({ text: "Unbound", runs: false });
    // Unbinding a chord nothing bound leaves no row at all.
    expect(layered.some((entry) => entry.id === "ctrl+super+x")).toBe(false);
  });

  it("takes the performable flag from the binding in force, not from Ghostty's default", () => {
    const layered = keyboardRows(
      {
        keybindings: [
          // ⌘E: a performable default (⌘F, the other, is the Peek's since 2026-10-08)
          { trigger: "super+e", action: "increase_font_size" },
          { trigger: "performable:super+j", action: "increase_font_size" },
        ],
        clearKeybindings: false,
      },
      [],
    );
    expect(row(layered, "super+e").performable).toBe(false);
    expect(routeWords(row(layered, "super+e")).text).toBe(
      "Not in ghosttea yet — the key is swallowed",
    );
    expect(row(layered, "super+j").performable).toBe(true);
  });

  it("says who cleared the defaults: this Mac only when config.ghostty says `clear`", () => {
    const cleared = {
      keybindings: [{ trigger: "super+t", action: "new_tab" }],
      clearKeybindings: true,
    };
    const here = keyboardRows(cleared, ["clear", "super+t=new_tab"]);
    const theirs = keyboardRows(cleared, []);
    expect(row(here, "super+d")).toMatchObject({ state: "removed", setBy: "this-mac" });
    expect(row(theirs, "super+d")).toMatchObject({ state: "removed", setBy: "your-ghostty" });
    expect(row(here, "super+t")).toMatchObject({ state: "default", setBy: "this-mac" });
  });
});
