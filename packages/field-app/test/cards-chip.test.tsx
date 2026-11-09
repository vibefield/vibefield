// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardFace } from "../src/frame/cards/CardFace";
import { textCardOf } from "../src/frame/cards/cards-model";

// THE CHIP (CS-D7 B, ruled by James 2026-11-06; DESIGN.md §8 "The hand"): how a card leaves. 30 round on its top right
// corner, half off the card, 44 to hit, red under the pointer; its outer half is still the card, so the reach holds.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSS = readFileSync(join(process.cwd(), "src/frame/cards/cards.css"), "utf8");

/** The body of a stylesheet rule, by its exact selector. */
function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf("}", at));
}

const card = textCardOf("A card.", { id: "a", origin: { view: "canvas", how: "copy" }, at: 0 });

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function mount(reached: boolean, onRemove = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(CardFace, { card, reached, onRemove })));
  return { el: host, onRemove };
}

describe("the chip (CS-D7 B)", () => {
  it("stands only on a card reached", () => {
    expect(mount(false).el.querySelector(".vf-card-x")).toBeNull();
  });

  it("is 30 round, centred on the card's top right corner", () => {
    const css = rule(".vf-card-x");
    expect(css).toContain("width: 30px;");
    expect(css).toContain("height: 30px;");
    expect(css).toContain("top: -15px;");
    expect(css).toContain("right: -15px;");
    expect(css).toContain("box-shadow: var(--vf-card-chip-shadow);");
    expect(css).toContain("background: var(--vf-card-dark-stock);");
  });

  it("is 44 to hit, and red and 1.12× under the pointer", () => {
    expect(rule(".vf-card-x::before")).toContain("inset: -7px;");
    const hot = rule(".vf-card-x:hover");
    expect(hot).toContain("background: var(--vf-red);");
    expect(hot).toContain("transform: scale(1.12);");
  });

  it("wears a × at 13, and its outer half is still the card, so the reach holds", () => {
    const { el } = mount(true);
    const chip = el.querySelector<HTMLElement>(".vf-card-x");
    expect(chip?.querySelector("svg")?.getAttribute("width")).toBe("13");
    expect(chip?.closest("[data-card]")?.getAttribute("data-card")).toBe("a");
  });

  it("removes the card", () => {
    const { el, onRemove } = mount(true);
    act(() => el.querySelector<HTMLElement>(".vf-card-x")?.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
