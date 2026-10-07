// @vitest-environment happy-dom
/**
 * DK-16 — THE SPLASH, THE VEIL AND THE EXPLORER'S TILES WEAR THE MAT (DESIGN.md §2.1's erratum: "The CSS-fallback dots stay
 * the splash's, the loading veil's and the explorer tiles' ground until DK-16, which dresses those three in the mat; after it
 * they stay only where nothing can draw the mat (the unavailable state, §8)"). The mat in CSS is the kit's: its sage as the
 * theme lights it (`--vf-mat-ground`), its lattice in its lit cream (`--vf-mat-line`, MAT.md §4) at the line law's presences
 * (ICE `MAT_GRID`), and the words on it paper white at the splash's quiet presence (`--vf-mat-ink`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SplashFace } from "../src/boot/splash-parts";
import { LoadingVeilView } from "../src/hud/LoadingVeil";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = read("../design-kit/src/tokens.css");
const block = (css: string, selector: string): string =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => (m[1] ?? "").split(",").some((s) => s.trim() === selector))
    .map((m) => m[2] ?? "")
    .join("\n");
const declared = (name: string): string[] =>
  [...tokens.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "gu"))].map((m) => (m[1] ?? "").trim());

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

describe("the mat in CSS — the kit's tokens", () => {
  it("lights its lattice in the mat's own cream: the Sun's by day, the Moon's by night (MAT.md §4)", () => {
    expect(declared("--vf-mat-ground")).toEqual(["#3d5a30", "#313c40"]);
    expect(declared("--vf-mat-line")).toEqual(["#ceb783", "#4c5254"]);
  });

  it("draws the lattice at the line law's presences — thick 21 % every 100 px, thin 7 % every 25", () => {
    const lattice = declared("--vf-mat-lattice")[0] ?? "";
    expect(lattice.match(/var\(--vf-mat-line\) 21%/gu)).toHaveLength(2);
    expect(lattice.match(/var\(--vf-mat-line\) 7%/gu)).toHaveLength(2);
    expect(declared("--vf-mat-lattice-size")).toEqual([
      "100px 100px, 100px 100px, 25px 25px, 25px 25px",
    ]);
  });

  it("writes on it in paper white at 60 % — 4.0:1 on the Sun-lit sage, the old splash's quiet 3.9:1 kept", () => {
    expect(declared("--vf-mat-ink")).toEqual(["rgb(255 255 255 / 60%)"]);
    const lin = (c: number): number => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (rgb: number[]): number =>
      0.2126 * lin(rgb[0] as number) +
      0.7152 * lin(rgb[1] as number) +
      0.0722 * lin(rgb[2] as number);
    const over = (ground: number[]): number[] => ground.map((g) => 255 * 0.6 + g * 0.4);
    for (const ground of [
      [61, 90, 48],
      [49, 60, 64],
    ]) {
      const ratio = (lum(over(ground)) + 0.05) / (lum(ground) + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(3.94);
    }
  });
});

describe("the splash, the veil and the explorer's tiles wear it — and the dots stay only under the card", () => {
  for (const [file, selector] of [
    ["src/boot/boot.css", ".vf-splash"],
    ["src/hud/LoadingVeil.css", ".vf-loading-veil"],
    ["src/frame/head.css", ".vf-head-doc-face"],
    ["src/panels/terminal/terminal-settings.css", ".vf-ts-mini-field"],
  ] as const) {
    it(`grounds ${selector} on the mat — its lit sage and its lattice`, () => {
      const rule = block(read(file), selector);
      expect(rule).toContain("background-color: var(--vf-mat-ground);");
      expect(rule).toContain("background-image: var(--vf-mat-lattice);");
      expect(rule).not.toContain("--vf-canvas-dot");
    });
  }

  it("keeps the CSS-fallback dots only where nothing can draw the mat — the unavailable card's plain ground", () => {
    const product = [
      "src/boot/boot.css",
      "src/hud/LoadingVeil.css",
      "src/frame/head.css",
      "src/panels/terminal/terminal-settings.css",
      "src/field/desk/desk.css",
      "src/styles/base.css",
    ];
    const using = product.filter((file) => read(file).includes("--vf-canvas-dot"));
    expect(using).toEqual(["src/field/desk/desk.css"]);
  });

  it("writes the splash's words in the mat's ink, never the light theme's black", () => {
    const host = render(
      createElement(SplashFace, {
        status: { stage: "waking the daemon", progress: null, unavailable: null },
      }),
    );
    const html = host.innerHTML;
    expect(html).toContain("text-[var(--vf-mat-ink)]");
    expect(html).not.toMatch(/text-black|bg-black/u);
  });

  it("writes the veil's bar and stage line in the mat's ink", () => {
    const host = render(
      createElement(LoadingVeilView, {
        view: { progress: 0.4, stage: "drawing the board" },
        shown: true,
        details: true,
      }),
    );
    const html = host.innerHTML;
    expect(html).toContain("text-[var(--vf-mat-ink)]");
    expect(html).not.toMatch(/text-black|bg-black/u);
  });

  it("writes the switch's words in the mat's ink — the switch stands on the splash's floor", () => {
    const scene = read("src/boot/SwitchScene.tsx");
    expect(scene).toContain('className="vf-switch-ground vf-splash"');
    expect(scene).not.toMatch(/text-black/u);
  });
});
