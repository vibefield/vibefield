// @vitest-environment happy-dom
/**
 * Item 300 — the loading veil's motion, as DESIGN.md §8 "The loading veil" says it (§6's named easings, M6): the bar
 * waits 500ms, then fades in where it stands, over 300ms on `--vf-ease-island`; under reduced motion every one of the
 * veil's transitions takes 90ms — the cover's fade-in and its fade-out, and the bar's entrance and its fill. vitest
 * loads no CSS, so LoadingVeil.css is held here as text, as ui-system-boundaries holds the kit's reduced-motion rules;
 * the witness row watches the same motion in Chrome.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingVeilView } from "../src/hud/LoadingVeil";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = read("src/hud/LoadingVeil.css");
const view = read("src/hud/LoadingVeil.tsx");
const REDUCED = "@media (prefers-reduced-motion: reduce) {";
/** The body of the first rule written `<selector> {` (a list's member ends in a comma, so never matches). */
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const render = (details: boolean): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(LoadingVeilView, { view: { progress: 0.4 }, shown: true, details }));
  });
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return host;
};

describe("the loading veil's motion (item 300; DESIGN.md §8, §6, M6)", () => {
  it("fades the bar in where it stands, over 300ms on --vf-ease-island — no Tailwind curve and no rise", () => {
    expect(rule(".vf-loading-veil__details")).toContain("opacity: 0;");
    expect(rule(".vf-loading-veil__details")).toContain(
      "transition: opacity 300ms var(--vf-ease-island);",
    );
    expect(rule('.vf-loading-veil__details[data-details="true"]')).toContain("opacity: 1;");
    expect(view).not.toMatch(/translate-y-|transition-\[|duration-\d/u);
  });

  it("takes 90ms for every one of the veil's transitions under reduced motion, the visible state's included (M6)", () => {
    const at = css.indexOf(REDUCED);
    expect(at).toBeGreaterThan(css.lastIndexOf('.vf-loading-veil[data-visible="true"] {'));
    const block = css.slice(at);
    for (const selector of [
      ".vf-loading-veil,",
      '.vf-loading-veil[data-visible="true"],',
      ".vf-loading-veil__details,",
      ".vf-loading-veil__progress {",
    ]) {
      expect(block).toContain(selector);
    }
    expect(block).toMatch(/\.vf-loading-veil__progress \{\s*transition-duration: 90ms;\s*\}/u);
  });

  it("flips the bar's data-details with its late half — hidden, then shown", () => {
    const hidden = render(false).querySelector<HTMLElement>(".vf-loading-veil__details");
    expect(hidden?.dataset["details"]).toBe("false");
    expect(hidden?.getAttribute("aria-hidden")).toBe("true");
    cleanup?.();
    cleanup = null;
    const shown = render(true).querySelector<HTMLElement>(".vf-loading-veil__details");
    expect(shown?.dataset["details"]).toBe("true");
    expect(shown?.getAttribute("aria-hidden")).toBe("false");
  });
});
