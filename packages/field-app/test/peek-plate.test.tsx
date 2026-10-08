// @vitest-environment happy-dom
/**
 * The Peek's catalog plate (docs/UI_SYSTEM.md "Catalog fidelity"; DESIGN.md §8
 * "Search — the Peek"): the SHIPPING Peek controller over its fixture port,
 * standing over the SHIPPING History view drawn from the same room demo. A
 * pick lands that room ON THE LINE through the room's own `openAt` — the
 * place the product's door hands it — and the view under the popup recedes
 * by the product's own rule while the popup stands.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PeekPlate } from "../src/design-system/PeekPreview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

/** happy-dom lays nothing out: the plate is given the default window's box,
 * which is what the Peek measures a plate by (its `container`). */
const BOX = { clientWidth: 1180, clientHeight: 780 } as const;
/** The getter happy-dom defines, wherever up the chain it lives. */
function inherited(key: string): PropertyDescriptor | undefined {
  for (let at: object | null = HTMLElement.prototype; at !== null; at = Object.getPrototypeOf(at)) {
    const found = Object.getOwnPropertyDescriptor(at, key);
    if (found !== undefined) return found;
  }
  return undefined;
}
const own = Object.fromEntries(
  Object.keys(BOX).map((key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)]),
);
const saved = Object.fromEntries(Object.keys(BOX).map((key) => [key, inherited(key)]));

beforeAll(async () => {
  for (const [key, value] of Object.entries(BOX)) {
    const original = saved[key];
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("vf-ds-peek-plate")
          ? value
          : (original?.get?.call(this) ?? 0);
      },
    });
  }
  await import("../src/history/HistoryRoomView");
}, 60_000);

afterAll(() => {
  for (const [key, descriptor] of Object.entries(own)) {
    if (descriptor !== undefined) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function until<T>(read: () => T | null | undefined, label: string, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("the Peek's plate — the shipping controller over the room demo", () => {
  it("holds “plus” open over the receding view, and a pick lands the room on the line", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<PeekPlate state="open" />));
    const plate = await until(() => host?.querySelector<HTMLElement>(".vf-ds-peek-plate"), "plate");
    // drawn in the plate, open, the view receding under it
    const pop = await until(() => plate.querySelector<HTMLElement>(".vf-peek-pop"), "the popup");
    expect(plate.querySelector('.vf-ds-peek-view[data-peek-recede="true"]')).not.toBeNull();
    // the page's focus is not taken
    expect(document.activeElement?.closest(".vf-peek-pop")).toBeFalsy();
    const row = await until(
      () => pop.querySelector<HTMLElement>('[role="option"]'),
      "the demo's row for “plus”",
    );
    expect(row.querySelector(".vf-peek-title")?.textContent).toBe("One frame for four views");
    expect(row.querySelector(".vf-peek-sub")?.textContent).toBe("vibe-field · Claude Code");
    expect(row.querySelectorAll(".vf-peek-ev")).toHaveLength(3);
    // the newest matched line is where Open lands — the peek says which
    const lands = pop.querySelector('.vf-peek-past-line[data-lands="true"]');
    expect(lands?.textContent).toContain("only Canvas draws it as a plus");
    act(() => row.click());
    expect(plate.querySelector(".vf-peek-pop")).toBeNull();
    expect(plate.querySelector('.vf-ds-peek-view[data-peek-recede="false"]')).not.toBeNull();
    // the room opens the conversation and lands on that message
    const landed = await until(
      () => plate.querySelector<HTMLElement>("[data-timeline-id][data-hit], .is-landed"),
      "the room landed on the line",
      20_000,
    );
    expect(landed.getAttribute("data-timeline-id")).toBe("s0-t10");
    expect(landed.textContent).toContain("only Canvas draws it as a plus");
  }, 40_000);
});
