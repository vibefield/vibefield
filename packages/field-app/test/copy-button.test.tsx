// @vitest-environment happy-dom
/**
 * HN-5 — A COPY'S BUTTON ON A SHEET (frame/cards/CopyButton.tsx; DESIGN.md §8 "Copy", LC-22):
 * Settings' copies and the Setup Assistant's deal their card from the button's own box, and the
 * button says how the copy went for two seconds in its own words, "Copied" or "Couldn't copy",
 * then its label again. In a Diagnostics record's summary its press is its own: the row is never
 * toggled by it, and the row's own handler never hears it; elsewhere the press is the page's too.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../src/frame/cards/CopyButton";
import type { DealFrom } from "../src/frame/cards/cards-store";
import { COPY_BUTTON_WORDS } from "../src/frame/cards/cards-words";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOX = { left: 520, top: 300, width: 64, height: 24 };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

/** A button by what it says, its box as the page lays it out. */
function button(label: string): HTMLButtonElement {
  const found = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === label,
  );
  if (found === undefined) throw new Error(`no ${label} button`);
  vi.spyOn(found, "getBoundingClientRect").mockReturnValue(BOX as DOMRect);
  return found;
}

/** Let a copy land, and the button say how it went. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

describe("a copy's button (HN-5)", () => {
  it("copies from its own box, says Copied for two seconds, then its label again", async () => {
    vi.useFakeTimers();
    const asked: Array<DealFrom | null> = [];
    const copy = async (from: DealFrom | null): Promise<boolean> => {
      asked.push(from);
      return true;
    };
    await mount(createElement(CopyButton, { label: "Copy link", copy, className: "vf-quiet" }));
    const pressed = button("Copy link");
    expect(pressed.className).toBe("vf-quiet");
    await act(async () => pressed.click());
    await act(settle);
    expect(asked).toEqual([BOX]);
    expect(pressed.textContent).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(1_999));
    expect(pressed.textContent).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(1));
    expect(pressed.textContent).toBe("Copy link");
  });

  it("says Couldn't copy when the clipboard did not take it", async () => {
    const refused = async (): Promise<boolean> => false;
    await mount(createElement(CopyButton, { label: "Copy", copy: refused, className: "" }));
    const pressed = button("Copy");
    await act(async () => pressed.click());
    await act(settle);
    expect(pressed.textContent).toBe("Couldn't copy");
    expect(COPY_BUTTON_WORDS).toEqual({ copied: "Copied", refused: "Couldn't copy" });
  });

  it("keeps its press to itself in a record's summary, and only there", async () => {
    const rowHeard = vi.fn();
    const sheetHeard = vi.fn();
    const copy = async (): Promise<boolean> => true;
    await mount(
      createElement(
        "div",
        null,
        createElement(
          "details",
          null,
          createElement(
            "summary",
            { onClick: rowHeard },
            createElement(CopyButton, { label: "copy", copy, className: "", inSummary: true }),
          ),
        ),
        createElement(
          "div",
          { onClick: sheetHeard },
          createElement(CopyButton, { label: "Copy", copy, className: "" }),
        ),
      ),
    );
    // the record's: its default prevented (a browser toggles the row after the dispatch, unless
    // it was), and the row's own handler never hears it
    const inRow = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      button("copy").dispatchEvent(inRow);
      await settle();
    });
    expect(inRow.defaultPrevented).toBe(true);
    expect(rowHeard).not.toHaveBeenCalled();
    // a sheet's: the press is left to the page around it
    const onSheet = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      button("Copy").dispatchEvent(onSheet);
      await settle();
    });
    expect(onSheet.defaultPrevented).toBe(false);
    expect(sheetHeard).toHaveBeenCalledOnce();
  });
});
