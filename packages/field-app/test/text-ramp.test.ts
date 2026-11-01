// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// DESIGN.md §2.4 — the text ramp (track FG, item 127; amended 2026-11-01): the theme's foreground at four alphas, each
// tier holding its floor on every chrome ground of its theme. t1, t2 and t3 are words that are read, at 4.5:1 or more
// (§8's bar); t4 is never a word that must be read, only a mark or the words of a control that is off, at 3:1 or more.
// What a review cannot see by eye is pinned here: the arithmetic over tokens.css's own values, DESIGN.md saying the
// same alphas first, and every use of t4 named as a mark or a control that is off. Row 32's catalog walk measures the
// same tiers in pixels, on the catalog's "Text ramp".

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOKENS = readFileSync(join(REPO, "packages/design-kit/src/tokens.css"), "utf8");
const DESIGN = readFileSync(join(REPO, "DESIGN.md"), "utf8");

type Theme = "light" | "dark";
type Rgb = readonly [number, number, number];

/* ── colour arithmetic (WCAG 2) ────────────────────────────────────────── */

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** an ink at `alpha` laid over an opaque ground */
const over = (ink: Rgb, alpha: number, ground: Rgb): Rgb => [
  ink[0] * alpha + ground[0] * (1 - alpha),
  ink[1] * alpha + ground[1] * (1 - alpha),
  ink[2] * alpha + ground[2] * (1 - alpha),
];

/* ── tokens.css, a theme's block at a time ─────────────────────────────── */

/** a theme's block: `:root` by day, `.dark` by night */
const block = (theme: Theme): string => {
  const found = (
    theme === "light" ? /\n:root \{\n([\s\S]*?)\n\}/ : /\n\.dark \{\n([\s\S]*?)\n\}/
  ).exec(TOKENS);
  if (found?.[1] === undefined) throw new Error(`no ${theme} block in tokens.css`);
  return found[1];
};
const hex = (theme: Theme, name: string): Rgb => {
  const found = new RegExp(`\\n\\s*${name}:\\s*#([0-9a-fA-F]{6});`).exec(block(theme));
  if (found?.[1] === undefined) throw new Error(`no ${name} in tokens.css's ${theme} block`);
  const n = Number.parseInt(found[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const TIERS = [
  ["t1", "--vf-text-primary"],
  ["t2", "--vf-text-secondary"],
  ["t3", "--vf-text-tertiary"],
  ["t4", "--vf-text-faint"],
] as const;
type Tier = (typeof TIERS)[number][0];

/** a tier's ink and its alpha (0…1), as tokens.css writes it: `rgb(R G B / A%)` */
const tier = (theme: Theme, name: string): { ink: Rgb; alpha: number } => {
  const found = new RegExp(`\\n\\s*${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+) / (\\d+)%\\);`).exec(
    block(theme),
  );
  if (found === null)
    throw new Error(`no ${name} as rgb(R G B / A%) in tokens.css's ${theme} block`);
  const [, r, g, b, a] = found.map(Number) as [number, number, number, number, number];
  return { ink: [r, g, b], alpha: a / 100 };
};

/** §2.4's chrome grounds: by day white, the canvas, the fill and its hover; by night the solid chrome, the canvas and
 * the fill (its hover the same) — the translucent chrome stands between them */
const GROUNDS = ["--vf-chrome-solid", "--vf-canvas-bg", "--vf-fill", "--vf-fill-hover"] as const;

/** §2.4's floors: a word that is read, and a mark */
const FLOOR: Readonly<Record<Tier, number>> = { t1: 4.5, t2: 4.5, t3: 4.5, t4: 3 };

describe("DESIGN.md §2.4 — the ramp holds its floors on every chrome ground", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`by ${theme === "light" ? "day" : "night"}, each tier is the theme's foreground at its alpha`, () => {
      const foreground = hex(theme, "--vf-foreground");
      for (const [, name] of TIERS) expect(tier(theme, name).ink, name).toEqual(foreground);
    });

    for (const [t, name] of TIERS) {
      const what = t === "t4" ? "a mark" : "a word that is read";
      it(`by ${theme === "light" ? "day" : "night"}, ${t} (${name}) holds ${FLOOR[t]}:1 as ${what}`, () => {
        const { ink, alpha } = tier(theme, name);
        for (const ground of GROUNDS) {
          const g = hex(theme, ground);
          const ratio = contrast(over(ink, alpha, g), g);
          expect(
            ratio,
            `${name} at ${alpha * 100}% on ${ground}: ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(FLOOR[t]);
        }
      });
    }
  }

  it("DESIGN.md says the same alphas first (UI_SYSTEM: the doc, then the tokens)", () => {
    const percent = (theme: Theme): number[] =>
      TIERS.map(([, name]) => Math.round(tier(theme, name).alpha * 100));
    const [d1, d2, d3, d4] = percent("light");
    const [n1, n2, n3, n4] = percent("dark");
    const prose = DESIGN.replace(/\s+/g, " ");
    expect(prose).toContain(`By day t1 ${d1}%, t2 ${d2}%, t3 ${d3}% and t4 ${d4}%`);
    expect(prose).toContain(`by night ${n1}%, ${n2}%, ${n3}% and ${n4}%`);
  });
});

/* ── t4's uses: marks and controls that are off, never a word that is read ── */

/** Every use of t4 in the product's styles, by file and selector, with how many: each a mark (a separator, a chevron, a
 * dot, a disc, a glyph) or a control that is off. A new use fails here until it is named, and a word that is read takes
 * t3. The catalog's own styles (`design-system/`) are development material and are not the product's. */
const T4_USES: Readonly<Record<string, number>> = {
  "packages/design-kit/src/primitives.css · .vf-ui-status-dot": 1,
  "packages/field-app/src/account/FacePicker.css · .vf-face-picker-choices[data-disabled] .vf-face-picker-any-label": 1,
  "packages/field-app/src/account/MeMenu.css · .vf-me-row:disabled": 1,
  "packages/field-app/src/account/door/door.css · .vf-door-device[data-ghost] .vf-door-device-disc": 1,
  "packages/field-app/src/chat/new-spark-sheet.css · .vf-new-spark-menu-head[data-off]": 1,
  "packages/field-app/src/field/desk/bar/selection-bar.css · .vf-bar-cell[data-disabled]:active": 1,
  'packages/field-app/src/frame/composer.css · .vf-line-snapshot[aria-disabled="true"]:hover': 1,
  'packages/field-app/src/frame/composer.css · .vf-line-create[aria-disabled="true"]:hover': 1,
  "packages/field-app/src/frame/head.css · .vf-head-sep": 1,
  'packages/field-app/src/frame/menu.css · .vf-menu-row[aria-disabled="true"] .vf-menu-ico': 1,
  "packages/field-app/src/frame/peek.css · .vf-peek-dot[data-state]": 1,
  "packages/field-app/src/panels/agents/agents-settings.css · .vf-agents-chevron": 1,
  "packages/field-app/src/panels/agents/extensions-settings.css · .vf-ext-cell": 1,
  "packages/field-app/src/panels/agents/extensions-settings.css · .vf-ext-chevron": 1,
  "packages/field-app/src/panels/agents/extensions-settings.css · .vf-ext-chip:disabled": 1,
  "packages/field-app/src/panels/settings.css · .vf-settings-account-chevron": 1,
  "packages/field-app/src/panels/terminal/terminal-settings.css · .vf-ts-diagnostic-dot": 1,
};

const STYLED = /\.(css|tsx)$/;
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" || entry.name === "design-system" ? [] : sources(path);
    return STYLED.test(entry.name) ? [path] : [];
  });

/** each line naming t4, by its file and the selector of the rule it stands in (the nearest line that opens one) */
const t4Uses = (): Record<string, number> => {
  const uses: Record<string, number> = {};
  for (const root of ["packages/design-kit/src", "packages/field-app/src"])
    for (const file of sources(join(REPO, root))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, at) => {
        if (!line.includes("--vf-text-faint") || /^\s*--vf-text-faint\s*:/.test(line)) return;
        let open = at;
        while (open >= 0 && !(lines[open] ?? "").trimEnd().endsWith("{")) open -= 1;
        const selector = (lines[open] ?? "").replace(/\{\s*$/, "").trim();
        const key = `${relative(REPO, file)} · ${selector}`;
        uses[key] = (uses[key] ?? 0) + 1;
      });
    }
  return uses;
};

describe("DESIGN.md §2.4 — t4 is never a word that must be read", () => {
  it("names every use of t4 as a mark or a control that is off", () => {
    expect(t4Uses()).toEqual(T4_USES);
  });
});
