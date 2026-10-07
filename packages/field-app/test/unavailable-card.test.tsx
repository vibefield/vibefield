// @vitest-environment happy-dom
/**
 * DK-16 — WHEN THE DESK CAN'T DRAW, the card itself (DESIGN.md §8 "When the desk can't draw"; DK-D32; R18 — the kit's
 * `UnavailableState` EXTENDED, a kit change): the 380-wide variant on the plain ground — `--vf-canvas-bg` and the
 * CSS-fallback dots, never the mat, which nothing can draw — centred, the strong hairline dashed, corners 22, padded 26 26
 * 22: what happened (14/600, primary), what to do (12.5/400, tertiary), ONE Reload (the primary, inverted: 36 tall, padded
 * 0 18, corners 18, 13/500) and ICE's message in the detail slot, verbatim, LAST and small (11 mono, faint, 12 below). The
 * words are desk-words.test.ts's; this file holds the anatomy and the numbers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DeskUnavailableView } from "../src/field/desk/DeskUnavailableView";
import { failedWords } from "../src/field/desk/desk-words";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOST = "the device was lost: destroyed: Device was destroyed.";
const NO_GPU =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU is unavailable here (no navigator.gpu)";

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const rulesIn =
  (css: string) =>
  (selector: string): string =>
    [...strip(css).matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => (m[1] ?? "").split(",").some((s) => s.trim() === selector))
      .map((m) => m[2] ?? "")
      .join("\n");
const kit = rulesIn(readFileSync(join(process.cwd(), "../design-kit/src/primitives.css"), "utf8"));
const desk = rulesIn(readFileSync(join(process.cwd(), "src/field/desk/desk.css"), "utf8"));

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function render(element: ReturnType<typeof createElement>): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return host;
}

describe("the unavailable card's anatomy — what happened, what to do, one Reload, ICE's message last", () => {
  it("lays the slots in the canon's order, the detail LAST, on the plain ground, centred", () => {
    const host = render(
      createElement(DeskUnavailableView, { words: failedWords(LOST), onReload: () => undefined }),
    );
    const card = host.querySelector(".vf-ui-unavailable-state");
    expect(card?.getAttribute("data-card")).toBe("true");
    expect(card?.getAttribute("role")).toBe("status");
    const children = [...(card?.children ?? [])].map((el) =>
      el.tagName === "STRONG" || el.tagName === "SPAN" ? el.tagName : el.className,
    );
    expect(children).toEqual([
      "STRONG",
      "SPAN",
      "vf-ui-unavailable-state__action",
      "vf-ui-unavailable-state__detail",
    ]);
    expect(card?.querySelector("strong")?.textContent).toBe("The desk lost its graphics device");
    const buttons = [...(card?.querySelectorAll("button") ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(["Reload"]); // ONE act
    expect(buttons[0]?.getAttribute("data-variant")).toBe("primary");
    expect(card?.querySelector(".vf-ui-unavailable-state__detail")?.textContent).toBe(LOST);
    expect(
      host.querySelector("[data-desk-unavailable]")?.getAttribute("data-desk-unavailable"),
    ).toBe("lost");
  });

  it("offers no act at all where a reload cannot help — the slot is not there", () => {
    const host = render(
      createElement(DeskUnavailableView, { words: failedWords(NO_GPU), onReload: () => undefined }),
    );
    expect(host.querySelector(".vf-ui-unavailable-state__action")).toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelector(".vf-ui-unavailable-state__detail")?.textContent).toBe(NO_GPU);
  });
});

describe("the unavailable card's numbers (R18), in the kit's and the stage's stylesheets", () => {
  it("is the 380-wide variant: the strong hairline dashed, corners 22, padded 26 26 22", () => {
    expect(kit(".vf-ui-unavailable-state")).toContain(
      "border: 1px dashed var(--vf-hairline-strong);",
    );
    const card = kit('.vf-ui-unavailable-state[data-card="true"]');
    for (const decl of ["width: 380px;", "padding: 26px 26px 22px;", "border-radius: 22px;"])
      expect(card).toContain(decl);
  });

  it("says what happened at 14/600 in primary ink and what to do at 12.5/400 in tertiary", () => {
    expect(kit('.vf-ui-unavailable-state[data-card="true"] strong')).toContain("font-size: 14px;");
    expect(kit(".vf-ui-unavailable-state strong")).toContain("font-weight: 600;");
    expect(kit(".vf-ui-unavailable-state strong")).toContain("color: var(--vf-text-primary);");
    const body = kit('.vf-ui-unavailable-state[data-card="true"] span');
    expect(body).toContain("font-size: 12.5px;");
    expect(body).toContain("font-weight: 400;");
    expect(kit(".vf-ui-unavailable-state span")).toContain("color: var(--vf-text-tertiary);");
  });

  it("makes the Reload the primary at 36 tall, padded 0 18, corners 18, 13/500", () => {
    const reload = kit(
      '.vf-ui-unavailable-state[data-card="true"] .vf-ui-button[data-variant="primary"]',
    );
    for (const decl of [
      "height: 36px;",
      "padding-inline: 18px;",
      "border-radius: 18px;",
      "font-size: 13px;",
      "font-weight: 500;",
    ])
      expect(reload).toContain(decl);
  });

  it("sets ICE's message last and small: 11 mono, faint, 12 below", () => {
    const detail = kit(".vf-ui-unavailable-state__detail");
    for (const decl of [
      "margin: 12px 0 0;",
      "color: var(--vf-text-faint);",
      "font-family: var(--vf-font-mono);",
      "font-size: 11px;",
    ])
      expect(detail).toContain(decl);
  });

  it("stands the card centred on the plain ground — the canvas's token and the CSS-fallback dots, never the mat", () => {
    const ground = desk(".vf-desk-unavailable");
    for (const decl of [
      "inset: 0;",
      "align-items: center;",
      "justify-content: center;",
      "background-color: var(--vf-canvas-bg);",
    ])
      expect(ground).toContain(decl);
    expect(ground).toMatch(/background-image: radial-gradient\(circle, var\(--vf-canvas-dot\)/);
    expect(ground).not.toContain("--vf-mat-ground");
  });
});
