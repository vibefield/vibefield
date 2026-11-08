import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// THE NIGHT'S TOKENS (track ES, 2026-11-08; DESIGN.md §5 "Night glass", §2.4 "On the night, the night's ink") — UI_SYSTEM's
// order: the doc says each value first, and tokens.css projects it by its name. Night glass and the hush are the same in
// both themes (the night is the night by day too); the night's ink is the night theme's own, re-declared on the night.

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(join(HERE, "../../design-kit/src/tokens.css"), "utf8");
const DESIGN = readFileSync(join(HERE, "../../../DESIGN.md"), "utf8");

/** The declarations of one top-level rule of tokens.css, by its selector. */
function block(selector: string): string {
  const head = new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/gu, "\\$&")} \\{\\n`, "u").exec(
    TOKENS,
  );
  if (head === null) return "";
  const start = head.index + head[0].length;
  const end = TOKENS.indexOf("\n}", start);
  return TOKENS.slice(start, end);
}
/** One custom property's value in a block, or undefined where the block does not say it. */
const declared = (css: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\n)\\s*${name}:\\s*([^;]+);`, "u").exec(css)?.[1]?.trim();

const GLASS: readonly (readonly [string, string])[] = [
  ["--vf-night-glass", "rgb(255 255 255 / 7%)"],
  ["--vf-night-glass-hover", "rgb(255 255 255 / 12%)"],
  ["--vf-night-glass-ring", "rgb(255 255 255 / 14%)"],
  ["--vf-night-glass-blur", "16px"],
  ["--vf-night-hush", "color-mix(in srgb, var(--vf-spark-night) 58%, transparent)"],
];

describe("DESIGN.md §5 — night glass, projected by name", () => {
  it("says night glass's values first, in the tier's own row (UI_SYSTEM: the doc, then the tokens)", () => {
    const prose = DESIGN.replace(/\s+/gu, " ");
    expect(prose).toContain(
      "white at 7% (`--vf-night-glass`; 12% under the pointer, `--vf-night-glass-hover`) over a 16 blur (`--vf-night-glass-blur`), ringed inset by white at 14% (`--vf-night-glass-ring`); the same in both themes",
    );
    expect(prose).toContain("a hush, the night at 58% (`--vf-night-hush`)");
  });

  it("projects each by its name in tokens.css, with the doc's value, and the same in both themes — `.dark` says none again", () => {
    const root = block(":root");
    const dark = block(".dark");
    for (const [name, value] of GLASS) {
      expect(declared(root, name), name).toBe(value);
      expect(declared(dark, name), name).toBeUndefined();
    }
  });
});

describe("DESIGN.md §2.4 — on the night, the night's ink: `.vf-on-night` IS the night theme's ink", () => {
  it("names the scope in the doc before tokens.css wears it", () => {
    expect(DESIGN).toContain("`.vf-on-night`");
  });

  it("re-declares on the night exactly `.dark`'s values, equal by design — so either moving alone fails here", () => {
    const night = block(".vf-on-night");
    const dark = block(".dark");
    expect(night).toMatch(/(?:^|\n)\s*color-scheme: dark;/u);
    const names = [...night.matchAll(/(?:^|\n)\s*(--vf-[a-z0-9-]+):/gu)].map((found) => found[1]);
    // the ink a word reads in, and the fills a control on the night draws with
    expect(names).toEqual(
      expect.arrayContaining([
        "--vf-foreground",
        "--vf-foreground-inverse",
        "--vf-text-primary",
        "--vf-text-secondary",
        "--vf-text-tertiary",
        "--vf-text-faint",
        "--vf-hairline",
        "--vf-hairline-strong",
        "--vf-chrome-solid",
        "--vf-fill",
      ]),
    );
    for (const name of names) {
      if (name === undefined) continue;
      const value = declared(dark, name);
      expect(value, `${name} is the night theme's own`).toBeDefined();
      expect(declared(night, name), name).toBe(value);
    }
  });
});
