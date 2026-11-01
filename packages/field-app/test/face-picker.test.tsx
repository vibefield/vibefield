// @vitest-environment happy-dom
/**
 * The face picker OFF (DESIGN.md §7 "Off", §2.4, §2.8; FG, the catalog judged's follow-up 1): while its host writes,
 * the deck is a control that is off. It says so the way assistive tech reads it — `role="group"` with
 * `aria-disabled="true"` beside the styling hook — never by `data-disabled` alone, and its words wear t4 at full
 * opacity (3:1 or more on their ground) while only its pictures dim. Row 32's catalog walk found the deck's two head
 * words read as live words at 0.45 of their ink while saving (run69b, "02 field (saving)", 2.1–2.6:1); this file holds
 * the markup and the stylesheet to the rule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FaceDeck, FacePicker } from "../src/account/FacePicker";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const mount = (element: ReturnType<typeof createElement>): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return host;
};

const face = { emoji: "🦊" };
const held = new Map<string, string>();
const noop = (): void => {};

describe("an off face picker says so the way assistive tech reads it (DESIGN.md §7)", () => {
  for (const [name, element] of [
    [
      "the wizard's deck",
      (disabled: boolean) =>
        createElement(FaceDeck, {
          value: face,
          held,
          onChange: noop,
          disabled,
          label: "Face",
          rows: 3,
        }),
    ],
    [
      "the Account page's picker",
      (disabled: boolean) =>
        createElement(FacePicker, { value: face, held, onChange: noop, disabled }),
    ],
  ] as const) {
    it(`${name}: every group styled off is a group that is off, and none is while it is on`, () => {
      const off = mount(element(true));
      const styled = [...off.querySelectorAll("[data-disabled]")];
      expect(styled.length).toBeGreaterThan(0);
      for (const el of styled) {
        expect(el.getAttribute("role"), el.className).toBe("group");
        expect(el.getAttribute("aria-disabled"), el.className).toBe("true");
      }
      cleanup?.();
      const on = mount(element(false));
      expect(on.querySelectorAll("[data-disabled], [aria-disabled]")).toHaveLength(0);
    });
  }
});

/* ── the stylesheet: the pictures dim, the words wear t4 ─────────────────── */

const CSS = readFileSync(join(process.cwd(), "src/account/FacePicker.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
/** every rule as its selectors and its declarations */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
  selectors: (m[1] ?? "").split(",").map((s) => s.trim()),
  body: m[2] ?? "",
}));
const OFF = RULES.filter((rule) => rule.selectors.some((s) => s.includes("[data-disabled]")));
const PICTURES = [".vf-face-picker-deck", ".vf-face-picker-any-input"];
const WORDS = [".vf-face-picker-label", ".vf-face-picker-any-label"];

describe("an off face picker's pictures dim and its words wear t4 at full opacity (DESIGN.md §7, §2.4)", () => {
  it("dims only its pictures: no opacity on an off group itself, which would reach its words", () => {
    const dims = OFF.filter((rule) => /\bopacity\s*:/.test(rule.body));
    expect(dims.length).toBeGreaterThan(0);
    for (const rule of dims)
      for (const selector of rule.selectors)
        expect(
          PICTURES.some((picture) => selector.endsWith(` ${picture}`)),
          `${selector} dims, and it is not one of the picker's pictures`,
        ).toBe(true);
  });

  it("puts each of its words at t4 while off", () => {
    for (const word of WORDS) {
      const rule = OFF.find((r) =>
        r.selectors.includes(`.vf-face-picker-choices[data-disabled] ${word}`),
      );
      expect(rule?.body, word).toMatch(/\bcolor:\s*var\(--vf-text-faint\);/);
    }
  });
});

describe("DESIGN.md §7 names the Off state", () => {
  it("as a row of its states: said the way assistive tech reads it, its words at t4", () => {
    const states = /\n## 7\. Interactive states\n([\s\S]*?)\n## 8\./.exec(
      readFileSync(join(process.cwd(), "../../DESIGN.md"), "utf8"),
    )?.[1];
    const row = states?.split("\n").find((line) => line.startsWith("| **Off**"));
    expect(row).toBeDefined();
    expect(row).toContain('`aria-disabled="true"`');
    expect(row).toContain("t4");
    expect(row).toContain("3:1");
  });
});
