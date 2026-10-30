// @vitest-environment happy-dom
/**
 * DK-16 — THE SPLASH, THE VEIL AND THE EXPLORER'S TILES WEAR THE MAT (DESIGN.md §2.1's erratum: "The CSS-fallback dots stay
 * the splash's, the loading veil's and the explorer tiles' ground until DK-16, which dresses those three in the mat; after it
 * they stay only where nothing can draw the mat (the unavailable state, §8)"). The mat in CSS is the kit's: its sage as the
 * theme lights it (`--vf-mat-ground`), its lattice in its lit cream (`--vf-mat-line`, MAT.md §4) at the line law's presences
 * (ICE `MAT_GRID`), and the words on it paper white at the splash's quiet presence (`--vf-mat-ink`).
 *
 * Track FG (2026-10-29, DESIGN.md §2.1's amendment): the boot's first face moved to the field — the splash and the Setup
 * Assistant stand on the website's splash, its ground `--vf-field-ground` and its words `--vf-field-ink` — and the switch,
 * the veil and the tiles keep the mat.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MatSplashFace, SplashFace } from "../src/boot/splash-parts";
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

describe("the switch, the veil and the explorer's tiles wear it — and the dots are gone (DK-17)", () => {
  for (const [file, selector] of [
    ["src/boot/boot.css", ".vf-mat-floor"],
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

  it("names the CSS-fallback dots nowhere — they left the tokens and every product stylesheet (DK-17, plan (76))", () => {
    // The tokens define neither the dots nor the widgetlab alias that read them.
    expect(declared("--vf-canvas-dot")).toEqual([]);
    expect(declared("--canvas-dot")).toEqual([]);
    expect(declared("--canvas-bg")).toEqual([]);
    const product = [
      "src/boot/boot.css",
      "src/hud/LoadingVeil.css",
      "src/frame/head.css",
      "src/panels/terminal/terminal-settings.css",
      "src/field/desk/desk.css",
      "src/styles/base.css",
      "../design-kit/src/primitives.css",
      "../../plugins/browser/src/artifact-panel.css",
    ];
    const using = product.filter((file) => /--(?:vf-)?canvas-dot/u.test(read(file)));
    expect(using).toEqual([]);
  });

  it("stands a placeholder that is not a board on the plain ground — the kit's and the Artifacts panel's", () => {
    // PlaceholderFace's one consumer is the Artifacts panel (a page or an app not yet pictured): not a board, so
    // not the mat (DESIGN.md §2.1 puts the mat where the desk stands in) — the plain ground, as the card's.
    for (const [file, selector] of [
      ["../design-kit/src/primitives.css", ".vf-ui-placeholder-face"],
      ["../../plugins/browser/src/artifact-panel.css", ".vf-artifact-placeholder"],
      ["../../plugins/browser/src/artifact-panel.css", ".vf-artifact-preview"],
    ] as const) {
      const rule = block(read(file), selector);
      expect(rule, selector).toContain("background-color: var(--vf-canvas-bg);");
      expect(rule, selector).not.toContain("background-image");
      expect(rule, selector).not.toContain("--vf-mat-");
    }
  });

  it("writes the switch's plain splash in the mat's ink, never the light theme's black", () => {
    const host = render(
      createElement(MatSplashFace, {
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

  it("writes the switch's words in the mat's ink — the switch keeps the mat (track FG)", () => {
    const scene = read("src/boot/SwitchScene.tsx");
    expect(scene).toContain('className="vf-switch-ground vf-mat-floor"');
    expect(scene).not.toContain("vf-splash");
    expect(scene).not.toMatch(/text-black|--vf-field-ink/u);
  });
});

describe("the boot's first face stands on the field (track FG, DESIGN.md §2.1)", () => {
  it("names the field's ground once for both themes, and its words' ink", () => {
    expect(declared("--vf-field-ground")).toEqual(["#04050f"]);
    expect(declared("--vf-field-ink")).toEqual(["rgb(255 255 255 / 56%)"]);
  });

  it("grounds .vf-splash on the field, never the mat", () => {
    const rule = block(read("src/boot/boot.css"), ".vf-splash");
    expect(rule).toContain("background-color: var(--vf-field-ground);");
    expect(rule).not.toContain("--vf-mat-");
    expect(rule).not.toContain("background-image");
  });

  it("projects the field's ground into the window's pre-paint by name (FG-D25, UI_SYSTEM.md)", () => {
    // The files as written: `read` drops block comments, and main can't read the CSS at all.
    const raw = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");
    const [ground] = declared("--vf-field-ground");
    const main = raw("../electron-shell/src/main/windows.ts");
    expect(main).toContain(`backgroundColor: "${ground}",`);
    expect(main).toContain("`--vf-field-ground` (DESIGN.md §2.1, #04050F)");
    expect(raw("../../DESIGN.md")).toMatch(
      /^\| `--vf-field-ground` — [^\n]*`electron-shell\/src\/main\/windows\.ts`[^\n]*\| `#04050F` \|/mu,
    );
  });

  it("shades the words in the field's own ground", () => {
    const rule = block(read("src/boot/boot.css"), ".vf-field-shade");
    expect(rule).toContain("color-mix(in srgb, var(--vf-field-ground) 55%, transparent)");
    expect(rule).toContain("color-mix(in srgb, var(--vf-field-ground) 30%, transparent) 55%");
  });

  it("writes the splash's words in the field's ink, under the mark, with no wordmark", () => {
    const host = render(
      createElement(SplashFace, {
        status: { stage: "waking the daemon", progress: null, unavailable: null },
      }),
    );
    const html = host.innerHTML;
    expect(html).toContain("text-[var(--vf-field-ink)]");
    expect(html).not.toContain("--vf-mat-ink");
    expect(html).not.toMatch(/text-black|bg-black/u);
    expect(host.querySelector(".vf-field-words")).not.toBeNull();
    expect(host.textContent).toBe("waking the daemon");
  });
});
