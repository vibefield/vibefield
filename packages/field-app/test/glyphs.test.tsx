// @vitest-environment happy-dom

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FieldGlyph,
  GLYPH_META,
  GLYPH_NAMES,
  GLYPHS,
  glyphSvg,
} from "@vibefield/design-kit/glyphs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

// DESIGN.md §13 — the chrome's glyph set. What a review cannot catch by eye
// is pinned here: one box, one paint, one drawing per meaning, and the rule
// that an icon in product code is a FieldGlyph and never an inline <svg>.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function draw(props: Parameters<typeof FieldGlyph>[0]): Promise<SVGSVGElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(FieldGlyph, props)));
  return container.firstElementChild as SVGSVGElement;
}

const COLOUR_LITERAL = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(|\b(?:black|white|red|blue)\b/i;

describe("the glyph set", () => {
  it("has every name drawn, in one box, in currentColor and nothing else", () => {
    expect(GLYPH_NAMES.length).toBe(48);
    for (const name of GLYPH_NAMES) {
      const svg = glyphSvg(name);
      expect(svg, name).toMatch(
        /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/,
      );
      expect(svg, name).not.toMatch(COLOUR_LITERAL);
      expect(svg, name).not.toMatch(
        /<(?:mask|filter|linearGradient|radialGradient|image|clipPath)/,
      );
      expect(GLYPH_META[name].label.length, name).toBeGreaterThan(0);
    }
  });

  it("draws Instrument at one 2-unit stroke and Hardware as one evenodd path", () => {
    const hardware = GLYPH_NAMES.filter((name) => GLYPHS[name].kind === "hardware");
    // James's picks, 2026-09-24 (tooling/glyphs/picks.json).
    expect([...hardware].sort()).toEqual(
      [
        "arrow",
        "backspace",
        "check",
        "close",
        "ellipsis",
        "keyboard",
        "pencil",
        "return",
        "search",
        "sliders",
      ].sort(),
    );
    for (const name of GLYPH_NAMES) {
      const svg = glyphSvg(name);
      if (GLYPHS[name].kind === "hardware") {
        expect(svg, name).toMatch(/<path fill="currentColor" fill-rule="evenodd" d="[^"]+"\/>/);
        expect(svg.match(/<path /g)?.length, name).toBe(1);
      } else {
        expect(svg, name).toMatch(
          /stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/,
        );
        expect(svg, name).not.toMatch(/stroke-width="(?!2")/);
      }
    }
  });

  it("renders decorative by default, named when labelled, turned and flipped on request", async () => {
    const plain = await draw({ name: "plus", size: 15 });
    expect(plain.getAttribute("aria-hidden")).toBe("true");
    expect(plain.getAttribute("width")).toBe("15");
    expect(plain.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(plain.classList.contains("vf-glyph")).toBe(true);
    expect(plain.querySelector("[transform]")).toBeNull();

    const named = await draw({ name: "close", label: "Close settings" });
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Close settings");
    expect(named.getAttribute("aria-hidden")).toBeNull();
    expect(named.querySelector("path")?.getAttribute("fill-rule")).toBe("evenodd");

    const down = await draw({ name: "chevron", turn: 90 });
    expect(down.firstElementChild?.getAttribute("transform")).toBe("rotate(90 12 12)");
    const redo = await draw({ name: "undo", flip: true, turn: 0 });
    expect(redo.firstElementChild?.getAttribute("transform")).toBe("matrix(-1 0 0 1 24 0)");
  });

  it("keeps the committed drawings and the phone's template assets fresh", () => {
    // The generator is the source; data.ts and FieldGlyphs.xcassets are its
    // outputs. A drawing edited by hand in either place fails here.
    const out = execFileSync(
      process.execPath,
      [join(REPO_ROOT, "tooling/glyphs/build.mjs"), "--check"],
      {
        encoding: "utf8",
      },
    );
    expect(out).toContain("glyphs fresh");
    for (const name of [
      "keyboard",
      "mic",
      "prompt",
      "plus",
      "return",
      "arrow",
      "ellipsis",
      "backspace",
      "scantext",
      "snippets",
      "clipboard",
    ]) {
      const asset = readFileSync(
        join(
          REPO_ROOT,
          `apps/ios/VibeFieldKit/Sources/FieldDesign/Resources/FieldGlyphs.xcassets/glyph-${name}.imageset/glyph-${name}.svg`,
        ),
        "utf8",
      );
      // The same geometry the kit draws, with an opaque ink for a template image.
      expect(asset.replace(/"black"/g, '"currentColor"').trim()).toBe(
        glyphSvg(name as (typeof GLYPH_NAMES)[number]),
      );
    }
  });

  it("refuses an inline <svg> icon in product code (the silhouettes are the allowlist)", () => {
    // Product code draws icons through FieldGlyph. What may still be an inline
    // <svg> is geometry that is not an icon: the edge tray's notch and drawer
    // are chrome silhouettes drawn from the wall (DESIGN.md §8), and the OS
    // marks are their owners' marks, kept exact like the vendor marks (§13).
    // The catalog (design-system/) is a harness and keeps its own fixtures.
    const allow = new Map<string, number>([
      ["godview/os-marks.tsx", 1],
      ["hud/edge-tray/EdgeTrayView.tsx", 2],
    ]);
    const found = new Map<string, number>();
    const visit = (base: string, relativeDir: string, skip: (rel: string) => boolean): void => {
      for (const entry of readdirSync(join(base, relativeDir), { withFileTypes: true })) {
        const rel = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
        if (skip(rel)) continue;
        if (entry.isDirectory()) visit(base, rel, skip);
        else if (/\.tsx?$/.test(entry.name)) {
          const count = (readFileSync(join(base, rel), "utf8").match(/<svg\b/g) ?? []).length;
          if (count > 0) found.set(rel, count);
        }
      }
    };
    visit(join(PACKAGE_ROOT, "src"), "", (rel) => rel.startsWith("design-system"));
    for (const plugin of readdirSync(join(REPO_ROOT, "plugins"))) {
      visit(join(REPO_ROOT, "plugins", plugin, "src"), "", () => false);
    }
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(allow));
  });
});
