// @vitest-environment happy-dom
// A CHOICE ON THE SHEET (track OM, OM-2, 2026-11-25; DESIGN.md §9 "The simulator's acts", §8 "A choice's list"): its list
// filled again while it stands open (the sheet's poll) stays open with the focus kept in it, and from a faint row (the
// unavailable saved version, which a press gives the focus) ↓ goes to the first row that can be taken and ↑ to the last.
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SheetOption, sheetChoice } from "../src/setup-choice";
import { setupMarkup } from "../src/setup-view";

const A: SheetOption = { value: "a", label: "iOS 26.5" };
const B: SheetOption = { value: "b", label: "iOS 26.1" };
const C: SheetOption = { value: "c", label: "iOS 18.6" };
const GONE: SheetOption = { value: "", label: "iOS 17.5 (unavailable)", disabled: true };

function mount() {
  const root = document.createElement("div");
  root.innerHTML = setupMarkup;
  document.body.append(root);
  const changed = vi.fn();
  const choice = sheetChoice(root, "runtime", changed);
  const list = root.querySelector<HTMLElement>('[data-list="runtime"]')!;
  const pill = root.querySelector<HTMLButtonElement>('[data-pill="runtime"]')!;
  const row = (value: string) =>
    Array.from(list.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")).find(
      (r) => r.dataset.value === value,
    )!;
  return { choice, list, pill, row, changed };
}
const key = (target: Element, name: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );

afterEach(() => {
  document.body.replaceChildren();
});

describe("a choice's list filled again while it stands open", () => {
  it("stays open on its new rows, the focus kept on the row it was on, else the row taken, else the first that can be", () => {
    const h = mount();
    h.choice.fill([A, B], "a");
    expect(h.choice.open()).toBe(true);
    expect(document.activeElement).toBe(h.row("a"));
    key(h.row("a"), "ArrowDown");
    expect(document.activeElement).toBe(h.row("b"));
    const before = h.row("b");
    // the poll: the same value, and a row the Mac has now
    h.choice.fill([A, B, C], "a");
    expect(h.row("b")).not.toBe(before);
    expect(h.choice.isOpen).toBe(true);
    expect(h.list.hidden).toBe(false);
    expect(h.pill.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(h.row("b"));
    expect(h.row("c")?.textContent).toBe(C.label);
    // the row it was on gone: the row taken
    h.choice.fill([A, C], "a");
    expect(document.activeElement).toBe(h.row("a"));
    // the row taken gone too: the first that can be taken
    h.choice.fill([GONE, C], "");
    expect(document.activeElement).toBe(h.row("c"));
    expect(h.list.hidden).toBe(false);
    // nothing left that can be taken: it folds, the focus back on its pill
    h.choice.fill([GONE], "");
    expect(h.list.hidden).toBe(true);
    expect(h.pill.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(h.pill);
    // filling it moves no value of the person's: nothing is told
    expect(h.changed).not.toHaveBeenCalled();
  });

  it("a focus outside the list stays where it is; a folded list stays folded", () => {
    const h = mount();
    h.choice.fill([A, B], "a");
    h.choice.open();
    h.pill.focus();
    h.choice.fill([A, B, C], "b");
    expect(h.list.hidden).toBe(false);
    expect(document.activeElement).toBe(h.pill);
    expect(h.pill.dataset.value).toBe("b");
    h.choice.fold();
    h.choice.fill([A, B], "a");
    expect(h.list.hidden).toBe(true);
    expect(document.activeElement).toBe(h.pill);
  });
});

describe("the keys from a faint row", () => {
  it("↑ goes to the last row that can be taken and ↓ to the first; from a row that can be, the walk is round as before", () => {
    const h = mount();
    h.choice.fill([GONE, A, B, C], "");
    h.choice.open();
    // the unavailable row, pressed: it is not taken, and it has the focus
    h.row("").click();
    h.row("").focus();
    expect(h.choice.value).toBe("");
    expect(h.list.hidden).toBe(false);
    key(h.row(""), "ArrowUp");
    expect(document.activeElement).toBe(h.row("c"));
    h.row("").focus();
    key(h.row(""), "ArrowDown");
    expect(document.activeElement).toBe(h.row("a"));
    key(h.row("a"), "ArrowUp");
    expect(document.activeElement).toBe(h.row("c"));
    key(h.row("c"), "ArrowDown");
    expect(document.activeElement).toBe(h.row("a"));
    key(h.row("a"), "End");
    expect(document.activeElement).toBe(h.row("c"));
    key(h.row("c"), "Home");
    expect(document.activeElement).toBe(h.row("a"));
    expect(h.changed).not.toHaveBeenCalled();
  });
});
