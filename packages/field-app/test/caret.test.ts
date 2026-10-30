// @vitest-environment happy-dom
/**
 * The frame's ONE field test (HN-L3; `frame/cards/caret.ts`): where the caret is — an input for
 * text, a text area, anything editable — for B, ⌫, ⌘V with no caret and a drop from another app.
 * A control a person does not type in holds no caret, and a drop passes over a field that takes
 * no insert: disabled or read-only. Each act's own suite pins its use (composer-line, cards,
 * cards-outside).
 */
import { afterEach, describe, expect, it } from "vitest";
import { isDropField, isField } from "../src/frame/cards/caret";

/** An input of this type, as the markup writes it (left out: no type at all). */
function input(type?: string): HTMLInputElement {
  const el = document.createElement("input");
  if (type !== undefined) el.setAttribute("type", type);
  return el;
}

/** What is editable, and a span inside it. */
function editable(): { readonly editor: HTMLElement; readonly inside: HTMLElement } {
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  const inside = document.createElement("span");
  editor.append(inside);
  document.body.append(editor);
  return { editor, inside };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the one field test (caret.ts)", () => {
  it("finds the caret in an input for text — no type, a type the browser does not know, text, search, url, tel, email, password, number — a text area, and anything editable", () => {
    const typed = ["text", "search", "url", "tel", "email", "password", "number"];
    for (const type of [undefined, "bogus", ...typed]) {
      expect(isField(input(type)), type ?? "no type").toBe(true);
    }
    expect(isField(document.createElement("textarea"))).toBe(true);
    const { editor, inside } = editable();
    expect(isField(editor)).toBe(true);
    expect(isField(inside), "inside what is editable").toBe(true);
  });

  it("finds none in a control a person does not type in — a select, a checkbox, a radio, a button, a range, a colour, a file, a date — nor outside any field", () => {
    expect(isField(document.createElement("select"))).toBe(false);
    expect(isField(document.createElement("button"))).toBe(false);
    const pressed = ["checkbox", "radio", "button", "submit", "reset", "image"];
    for (const type of [...pressed, "range", "color", "file", "date", "time", "hidden"]) {
      expect(isField(input(type)), type).toBe(false);
    }
    expect(isField(document.body)).toBe(false);
    expect(isField(window)).toBe(false);
    expect(isField(null)).toBe(false);
    expect(isField(undefined)).toBe(false);
  });

  it("lets a drop in only where a field takes an insert: never a disabled or a read-only one, nor a control", () => {
    const { editor } = editable();
    for (const field of [input(), document.createElement("textarea"), editor]) {
      expect(isDropField(field)).toBe(true);
    }
    const shut = document.createElement("textarea");
    shut.readOnly = true;
    const off = input("search");
    off.disabled = true;
    const fixed = input("text");
    fixed.readOnly = true;
    for (const field of [shut, off, fixed]) {
      expect(isField(field), "a field still, to a key or a paste").toBe(true);
      expect(isDropField(field), "but it takes no drop").toBe(false);
    }
    expect(isDropField(input("checkbox"))).toBe(false);
    expect(isDropField(document.createElement("select"))).toBe(false);
  });
});
