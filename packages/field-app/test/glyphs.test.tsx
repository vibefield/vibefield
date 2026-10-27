// @vitest-environment happy-dom

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
    expect(GLYPH_NAMES.length).toBe(63);
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

  it("draws the wrapper's three — minimize, maximize, restore — to the law, in a 12-unit extent about 12,12 (round 3)", () => {
    // DESIGN.md §13: the three glyphs of the wrapper around Godview's terminals
    // are Instrument, redrawn from the ruled page's stand-ins (strokes of 1.7
    // and 1.9, 1-unit corners) to the set's law: one 2-unit stroke (held for
    // every Instrument glyph above), the law's corner, and the page's 12-unit
    // extent centred on 12,12 — so the three weigh the same in a 30 × 24 control.
    // The corner is the law's IN PROPORTION (ruled 2026-10-11): 3 units on the
    // 12-unit square is a quarter of its side, so `restore`'s 8-unit squares
    // take 2. At 3 an 8-unit square has 2 units of straight side and reads, at
    // 14, as a ring with a hook.
    const numbers = (text: string): number[] => (text.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    /** The corners a drawing's strokes pass through, and every corner radius. */
    const walk = (name: "minimize" | "maximize" | "restore") => {
      const glyph = GLYPHS[name];
      if (glyph.kind !== "instrument") throw new Error(`${name} is not Instrument`);
      expect(glyph.fills, name).toEqual([]);
      expect(glyph.transform, name).toBeUndefined();
      const xs: number[] = [];
      const ys: number[] = [];
      const radii: number[] = [];
      for (const [tag, attrs] of glyph.strokes) {
        if (tag === "rect") {
          const [x, y, w, h] = ["x", "y", "width", "height"].map((key) => Number(attrs[key]));
          xs.push(x as number, (x as number) + (w as number));
          ys.push(y as number, (y as number) + (h as number));
          radii.push(Number(attrs["rx"]));
          continue;
        }
        expect(tag, name).toBe("path");
        let x = 0;
        let y = 0;
        for (const [, command, rest] of (attrs["d"] ?? "").matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
          const n = numbers(rest ?? "");
          if (command === "M") [x, y] = [n[0] as number, n[1] as number];
          else if (command === "h") x += n[0] as number;
          else if (command === "v") y += n[0] as number;
          else if (command === "a") {
            // a quarter corner: its end is all the box needs, its radius the law
            expect(n[0], name).toBe(n[1]);
            radii.push(n[0] as number);
            x += n[5] as number;
            y += n[6] as number;
          } else throw new Error(`${name}: a command this walk does not read, ${command}`);
          xs.push(x);
          ys.push(y);
        }
      }
      return {
        x: [Math.min(...xs), Math.max(...xs)],
        y: [Math.min(...ys), Math.max(...ys)],
        radii,
      };
    };
    for (const name of ["minimize", "maximize", "restore"] as const) {
      expect(GLYPH_NAMES, name).toContain(name);
      expect(GLYPHS[name].kind, name).toBe("instrument");
      expect(GLYPH_META[name].group, name).toBe("actions");
    }
    // a rule: 12 wide on the box's own middle line
    expect(walk("minimize")).toEqual({ x: [6, 18], y: [12, 12], radii: [] });
    // a square, and the square behind a square: each 12 by 12 about 12,12, its
    // every corner a quarter of its square's side — 3 on maximize's 12, 2 on
    // restore's 8, the square in front and the arc of the one behind alike
    for (const [name, side, corner] of [
      ["maximize", 12, 3],
      ["restore", 8, 2],
    ] as const) {
      const box = walk(name);
      expect(box.x, name).toEqual([6, 18]);
      expect(box.y, name).toEqual([6, 18]);
      expect(box.radii.length, name).toBeGreaterThan(0);
      expect(new Set(box.radii), name).toEqual(new Set([corner]));
      expect(corner / side, name).toBe(0.25);
      const glyph = GLYPHS[name];
      const squares =
        glyph.kind === "instrument" ? glyph.strokes.filter(([tag]) => tag === "rect") : [];
      expect(squares, name).toHaveLength(1);
      expect(squares[0]?.[1], name).toMatchObject({ width: String(side), height: String(side) });
    }
    // restore is two marks — the square in front, and what shows of the one behind
    expect(GLYPHS.restore.kind === "instrument" && GLYPHS.restore.strokes.length).toBe(2);
    expect(GLYPHS.maximize.kind === "instrument" && GLYPHS.maximize.strokes.length).toBe(1);
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
    // DK-11 (R2): the desk bar's ONE path renderer for a kind's own drawing —
    // one component, one <svg> — and no other file of the bar's. DK-16 (R17):
    // the peers' pointer arrow, the page's drawing — one view, one <svg>.
    const allow = new Map<string, number>([
      // TS-D4 (DESIGN.md §13): Tailscale's logomark, a vendor mark kept exact
      ["account/tailscale-mark.tsx", 1],
      ["field/desk/bar/KindGlyph.tsx", 1],
      ["field/desk/peers/PeersView.tsx", 1],
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
      // Retired plugins can leave ignored build/cache folders, not product packages.
      if (!existsSync(join(REPO_ROOT, "plugins", plugin, "package.json"))) continue;
      visit(join(REPO_ROOT, "plugins", plugin, "src"), "", () => false);
    }
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(allow));
  });
});
