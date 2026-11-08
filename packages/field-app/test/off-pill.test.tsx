// @vitest-environment node
/**
 * Item 241's 241b — A PILL THAT IS OFF, on the Mac (DESIGN.md §7 "Off"; James's leans of 2026-11-07 20:53:00Z, Q1 (b)
 * and Q2 (a)). The kit's `.vf-ui-button` that is `disabled` gives up its own look for the quiet pill's: the quiet fill
 * and no lift, so a primary loses its inversion and its shadow. Its words wear t4 at full opacity, 3.2–3.9:1 on that
 * fill over the sheet's paper, by day and by night. A whole button faded to 0.4 is not an off pill. A pill whose word
 * says its own press is running passes `UiButton`'s `running`: it stays `disabled`, so its hits are off, and keeps its
 * look (`data-running`).
 *
 * Three things are held here:
 * - the kit's own stylesheet, cascaded at rest over tokens.css's values by theme, as a browser cascades it
 *   (specificity, then source order). happy-dom's own cascade lets a class rule's fill beat a winning `:disabled`
 *   rule's (probed 2026-11-08), so the cascade is this file's;
 * - the button the kit renders;
 * - every kit button whose word says its press is running, by its source.
 * The pixels are the stills' (DESIGN.md §7's ratios, measured), which run at a landing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { UiButton } from "@vibefield/design-kit/primitives";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string): string => readFileSync(join(REPO, path), "utf8");
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

type Theme = "light" | "dark";
type Variant = "quiet" | "primary" | "danger";
type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

/* ── tokens.css: `:root` by day, `.dark` over it by night ─────────────────── */

const TOKENS = strip(read("packages/design-kit/src/tokens.css"));
const tokenBlock = (selector: string): Map<string, string> => {
  const found = new RegExp(
    `(?:^|\\n)${selector.replace(".", "\\.")} \\{\\n([\\s\\S]*?)\\n\\}`,
  ).exec(TOKENS);
  if (found?.[1] === undefined) throw new Error(`no ${selector} block in tokens.css`);
  return new Map(
    [...found[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1] ?? "",
      (m[2] ?? "").trim(),
    ]),
  );
};
const DAY = tokenBlock(":root");
const NIGHT = tokenBlock(".dark");
const token = (theme: Theme, name: string): string => {
  const value = (theme === "dark" ? NIGHT.get(name) : undefined) ?? DAY.get(name);
  if (value === undefined) throw new Error(`no ${name} in tokens.css`);
  return value;
};
/** a value with every `var()` replaced by its token's value, by theme */
const resolve = (value: string, theme: Theme): string => {
  const next = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => token(theme, name));
  return next === value ? value : resolve(next, theme);
};

/* ── colour (WCAG 2) ──────────────────────────────────────────────────────── */

const colour = (value: string): Rgba => {
  const v = value.trim();
  if (v === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+)%)?\)$/.exec(v);
  if (rgb !== null)
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]) / 100,
    ];
  // `color-mix(in srgb, C P%, transparent)`: C at P% of its alpha
  const mix = /^color-mix\(in srgb, (.+) (\d+)%, transparent\)$/.exec(v);
  if (mix?.[1] !== undefined) {
    const [r, g, b, a] = colour(mix[1]);
    return [r, g, b, (a * Number(mix[2])) / 100];
  }
  throw new Error(`a colour this file does not read: ${v}`);
};
const over = ([r, g, b, a]: Rgba, ground: Rgb): Rgb => [
  r * a + ground[0] * (1 - a),
  g * a + ground[1] * (1 - a),
  b * a + ground[2] * (1 - a),
];
const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (x: Rgb, y: Rgb): number => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/* ── the kit's stylesheet, cascaded at rest on one bare kit button ────────── */

type Button = { readonly variant: Variant; readonly disabled: boolean; readonly running: boolean };

const KIT = strip(read("packages/design-kit/src/primitives.css")).replace(
  /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
  "",
);
const RULES = [...KIT.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, at) => ({
  at,
  selectors: (m[1] ?? "").split(",").map((s) => s.trim()),
  declarations: [...(m[2] ?? "").matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map(
    (d) => [d[1] ?? "", (d[2] ?? "").trim()] as const,
  ),
}));

const PART = /\.[\w-]+|\[[^\]]+\]|:not\((?:[^()]|\([^()]*\))*\)|:[\w-]+/g;
/** whether one simple part of a compound holds for the button at rest; a part this cascade does not know is an error */
const holds = (part: string, button: Button): boolean => {
  if (part === ".vf-ui-button") return true;
  if (part.startsWith(".")) return false; // another class: a composition's, not the bare kit button
  if (part.startsWith(":not(")) return !holds(part.slice(5, -1), button);
  if (part === ":disabled") return button.disabled;
  if (part === "[data-running]") return button.running;
  if (part === "[data-variant]") return true;
  const variant = /^\[data-variant="(\w+)"\]$/.exec(part);
  if (variant !== null) return variant[1] === button.variant;
  if (/^:(hover|active|focus|focus-visible)$/.test(part)) return false; // a state, never at rest
  throw new Error(`a selector part this cascade does not read: ${part}`);
};
const weight = (part: string): number => (part.startsWith(":not(") ? weight(part.slice(5, -1)) : 1);
/** a selector's specificity on the button (classes, attributes and pseudo-classes; all of the kit's are that one
 * column), or null where it does not apply: another element's, a context's, or a state's */
const specificity = (selector: string, button: Button, theme: Theme): number | null => {
  let compound = selector;
  let extra = 0;
  if (compound.startsWith(".dark ")) {
    if (theme !== "dark") return null;
    compound = compound.slice(6);
    extra = 1;
  }
  if (!compound.startsWith(".vf-ui-button") || /[\s>+~]/.test(compound)) return null;
  const parts = compound.match(PART) ?? [];
  if (parts.join("") !== compound)
    throw new Error(`a selector this cascade does not read: ${selector}`);
  return parts.every((part) => holds(part, button))
    ? extra + parts.reduce((sum, part) => sum + weight(part), 0)
    : null;
};

type Look = {
  readonly fill: Rgba;
  readonly ink: Rgba;
  readonly shadow: string;
  readonly opacity: number;
  readonly hits: string;
};
/** the button's look at rest, by theme: the winning declaration of each property the look reads */
const look = (button: Button, theme: Theme): Look => {
  const won = new Map<string, { weight: number; at: number; value: string }>();
  for (const rule of RULES)
    for (const selector of rule.selectors) {
      const s = specificity(selector, button, theme);
      if (s === null) continue;
      for (const [property, value] of rule.declarations) {
        if (value.includes("!important")) throw new Error(`!important in the kit's ${selector}`);
        const held = won.get(property);
        if (held === undefined || s > held.weight || (s === held.weight && rule.at >= held.at))
          won.set(property, { weight: s, at: rule.at, value });
      }
    }
  const get = (property: string): string | undefined => {
    const value = won.get(property)?.value;
    return value === undefined ? undefined : resolve(value, theme);
  };
  return {
    fill: colour(get("background") ?? "transparent"),
    ink: colour(get("color") ?? "transparent"),
    shadow: get("box-shadow") ?? "none",
    opacity: Number(get("opacity") ?? "1"),
    hits: get("pointer-events") ?? "auto",
  };
};
/** the words' ratio as drawn: the ink on the fill, the whole at its opacity, over the sheet's paper */
const wordsRatio = (drawn: Look, theme: Theme): number => {
  const paper = colour(token(theme, "--vf-chrome-solid"));
  const ground: Rgb = [paper[0], paper[1], paper[2]];
  const fill = over(drawn.fill, ground);
  const ink = over(drawn.ink, fill);
  const faded = (c: Rgb): Rgb => over([c[0], c[1], c[2], drawn.opacity], ground);
  return contrast(faded(ink), faded(fill));
};

const THEMES = [
  ["light", "day"],
  ["dark", "night"],
] as const;
const VARIANTS = ["quiet", "primary", "danger"] as const;
const live = (variant: Variant): Button => ({ variant, disabled: false, running: false });
const off = (variant: Variant): Button => ({ variant, disabled: true, running: false });
const running = (variant: Variant): Button => ({ variant, disabled: true, running: true });

describe("DESIGN.md §7 'Off' — a kit pill that is off draws the quiet pill's look, its words in t4", () => {
  for (const [theme, when] of THEMES) {
    it(`by ${when}, the live pills are as they were: the quiet fill under t2, the primary inverted and lifted`, () => {
      const fill = colour(
        resolve("color-mix(in srgb, var(--vf-foreground) 5%, transparent)", theme),
      );
      expect(look(live("quiet"), theme)).toEqual({
        fill,
        ink: colour(token(theme, "--vf-text-secondary")),
        shadow: "none",
        opacity: 1,
        hits: "auto",
      });
      expect(look(live("primary"), theme)).toEqual({
        fill: colour(token(theme, "--vf-foreground")),
        ink: colour(token(theme, "--vf-foreground-inverse")),
        shadow: "0 4px 10px rgb(0 0 0 / 14%)",
        opacity: 1,
        hits: "auto",
      });
      expect(look(live("danger"), theme).ink).toEqual(colour(token(theme, "--vf-red")));
    });

    for (const variant of VARIANTS) {
      it(`by ${when}, a ${variant} that is off takes the quiet fill, no lift, and its words in t4 at full opacity`, () => {
        const drawn = look(off(variant), theme);
        expect(drawn.opacity, "a whole pill faded is not an off pill").toBe(1);
        expect(drawn.fill, "the quiet pill's fill").toEqual(look(live("quiet"), theme).fill);
        expect(drawn.ink, "t4, --vf-text-faint").toEqual(colour(token(theme, "--vf-text-faint")));
        expect(drawn.shadow, "no lift").toBe("none");
        expect(drawn.hits).toBe("none");
      });

      it(`by ${when}, a ${variant} that is off reads 3.2–3.9:1 on its fill over the sheet's paper`, () => {
        const ratio = wordsRatio(look(off(variant), theme), theme);
        expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3.2);
        expect(ratio, `${ratio.toFixed(2)}:1`).toBeLessThanOrEqual(3.9);
      });

      it(`by ${when}, a ${variant} whose press is running keeps its look, with its hits off`, () => {
        const { hits, ...drawn } = look(running(variant), theme);
        const { hits: _, ...shown } = look(live(variant), theme);
        expect(drawn).toEqual(shown);
        expect(hits).toBe("none");
      });
    }
  }
});

/* ── the button the kit renders ───────────────────────────────────────────── */

type KitProps = ComponentProps<typeof UiButton> & { running?: boolean };
const rendered = (props: KitProps): string => renderToStaticMarkup(createElement(UiButton, props));

describe("the kit's UiButton — `running` keeps the look and takes the hits", () => {
  it("a pill whose press is running is disabled and says so to its stylesheet", () => {
    const html = rendered({ running: true, children: "Saving…" });
    expect(html).toContain(' disabled=""');
    expect(html).toContain(' data-running=""');
  });

  it("a pill that is off is disabled, and nothing says it runs", () => {
    const html = rendered({ disabled: true, children: "Save" });
    expect(html).toContain(' disabled=""');
    expect(html).not.toContain("data-running");
  });

  it("a live pill is neither", () => {
    const html = rendered({ running: false, children: "Save" });
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("data-running");
  });
});

/* ── every kit button whose word says its press is running ────────────────── */

/** a running word: a verb's -ing, ending in an ellipsis ("Saving…", "Pausing current turn…"). An ellipsis alone says a
 * press opens more ("Remove…", "Add server…"), and that pill is off while it cannot be pressed. */
const RUNNING_WORD = /^[A-Z][a-z]+ing\b[^"`]*…$/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return ["node_modules", "design-system", "test"].includes(entry.name) ? [] : sources(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });

/** each `<tag …>…</tag>` in a file: its line, its opening tag and its children */
const elements = (text: string, tag: string): { line: number; open: string; children: string }[] =>
  [...text.matchAll(new RegExp(`<${tag}\\b`, "g"))].map((m) => {
    const start = m.index ?? 0;
    let at = start + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; at < text.length; at += 1) {
      const c = text[at];
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "`" || (c === "'" && depth > 0)) quote = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    const open = text.slice(start, at + 1);
    const close = text.indexOf(`</${tag}>`, at);
    const children = open.endsWith("/>") || close < 0 ? "" : text.slice(at + 1, close);
    return { line: text.slice(0, start).split("\n").length, open, children };
  });

type Kind = "kit" | "raw";
/** a file's kit buttons: every `<UiButton>`, and every `<button>` or `<a>` that wears the kit's class itself — by
 * `uiButtonClass`, by "vf-ui-button", or by settings-ui's `buttonCls` (which is `uiButtonClass`) where the file
 * imports it from there */
const kitButtons = (
  text: string,
): { line: number; open: string; children: string; kind: Kind }[] => {
  const viaSettings = /import\s*\{[^}]*\bbuttonCls\b[^}]*\}\s*from\s*"[^"]*settings-ui"/.test(text);
  const wears = (open: string): boolean => {
    const cls = /\sclassName=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/.exec(open)?.[1] ?? "";
    return (
      /\buiButtonClass\b|vf-ui-button(?![\w-])/.test(cls) ||
      (viaSettings && /\bbuttonCls\b/.test(cls))
    );
  };
  return [
    ...elements(text, "UiButton").map((b) => ({ ...b, kind: "kit" as const })),
    ...["button", "a"].flatMap((tag) =>
      elements(text, tag)
        .filter((b) => wears(b.open))
        .map((b) => ({ ...b, kind: "raw" as const })),
    ),
  ];
};

const squash = (code: string): string => code.replace(/\s+/g, " ").trim();
/** the condition under which a button's own words say its press is running: `true` for a word that always does, the
 * condition of `{cond ? "…ing…" : …}` for one that does on it, or null */
const saysRunning = (children: string): string | null => {
  const words = squash(children.replace(/<[^>]*>/g, " "));
  if (RUNNING_WORD.test(words)) return "true";
  for (const m of children.matchAll(/\{\s*([^{}?]+?)\s*\?\s*["`]([^"`]+)["`]\s*:/g))
    if (RUNNING_WORD.test(m[2] ?? "")) return squash(m[1] ?? "");
  return null;
};
/** the condition a button passes as running, or null: a `UiButton`'s `running` (`true` for the bare prop), a raw kit
 * button's `data-running={cond ? "" : undefined}` */
const passesRunning = (open: string, kind: Kind): string | null => {
  if (kind === "raw") {
    const m = /\sdata-running=\{\s*([\s\S]+?)\s*\?\s*""\s*:\s*undefined\s*\}/.exec(open);
    return m === null ? null : squash(m[1] ?? "");
  }
  const m = /\srunning(?:=\{((?:[^{}]|\{[^{}]*\})*)\})?(?=[\s/>])/.exec(open);
  if (m === null) return null;
  return m[1] === undefined ? "true" : squash(m[1]);
};

/** a module's source by its path as an import names it, without its extension; null where there is none */
type ReadModule = (path: string) => string | null;
const readModule: ReadModule = (path) => {
  const file = [`${path}.ts`, `${path}.tsx`, join(path, "index.ts")].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  return file === undefined ? null : readFileSync(file, "utf8");
};
/** HG-2 over 241b (2026-11-08): a file's words-table words, so a pill whose words come from a table is held like one that
 * writes them. `NAME.key` reads as the literal `key: "…"` in `export const NAME = { … }`, and only where the file
 * imports `NAME` by a relative path (`import { NAME } from "./…"`). A word it cannot resolve that way stays as written,
 * and the scan reads it as it always has: no words. */
const tableWords = (
  file: string,
  text: string,
  read: ReadModule,
): ((local: string, key: string) => string | null) => {
  const imported = new Map<string, { name: string; module: string }>();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.{1,2}\/[^"]+)"/g))
    for (const spec of (m[1] ?? "").split(",")) {
      const [name, local] = spec.trim().split(/\s+as\s+/);
      if (name !== undefined && name !== "")
        imported.set(local ?? name, { name, module: join(dirname(file), m[2] ?? "") });
    }
  return (local, key) => {
    const at = imported.get(local);
    const source = at === undefined ? null : read(at.module);
    if (at === undefined || source === null) return null;
    const plain = (name: string): string => name.replace(/\$/g, "\\$");
    const table = new RegExp(
      `export const ${plain(at.name)}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`,
    ).exec(source)?.[1];
    if (table === undefined) return null;
    return new RegExp(`(?:^|[\\s,{])${plain(key)}:\\s*"([^"\\n]*)"`).exec(table)?.[1] ?? null;
  };
};
/** a button's children with each table word it can resolve written as that word: a ternary's first branch
 * (`cond ? NAME.key :`) and a child that is the word alone (`{NAME.key}`) */
const withTableWords = (
  children: string,
  word: (local: string, key: string) => string | null,
): string =>
  children
    .replace(
      /\?\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*:/g,
      (whole, local: string, key: string) => {
        const w = word(local, key);
        return w === null || /["`]/.test(w) ? whole : `? "${w}" :`;
      },
    )
    .replace(
      /\{\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\}/g,
      (whole, local: string, key: string) => {
        const w = word(local, key);
        return w === null || /[{}<]/.test(w) ? whole : w;
      },
    );
/** one file's kit buttons whose words and whose running disagree, each said as the scan says it */
const wrongIn = (file: string, text: string, read: ReadModule = readModule): string[] => {
  const word = tableWords(file, text, read);
  return kitButtons(text).flatMap((button) => {
    const says = saysRunning(withTableWords(button.children, word));
    const passes = passesRunning(button.open, button.kind);
    return says === passes
      ? []
      : [
          `${relative(REPO, file)}:${button.line} (${button.kind}) — its words run on ${says}, it passes ${passes}`,
        ];
  });
};

describe("DESIGN.md §7 'Off', Q2 (a) — a pill whose word says its press is running says so to its stylesheet", () => {
  it("on the condition its words say it, and no pill passes it otherwise", () => {
    const wrong: string[] = [];
    for (const root of ["packages/field-app/src", "plugins"])
      for (const file of sources(join(REPO, root)))
        wrong.push(...wrongIn(file, readFileSync(file, "utf8")));
    expect(wrong).toEqual([]);
  });

  it("reads a pill's words through a words table its file imports, and none it cannot resolve that way (the probes)", () => {
    const file = join(REPO, "packages/field-app/src/probe/Probe.tsx");
    const module = join(REPO, "packages/field-app/src/probe/probe-words");
    const read: ReadModule = (path) =>
      path === module
        ? 'export const PROBE_WORDS = {\n  act: "Bring in",\n  acting: "Bringing in…",\n} as const;\n'
        : null;
    const imports = 'import { PROBE_WORDS } from "./probe-words";\n';
    const pill = (words: string, head = imports): string =>
      `${head}<UiButton running={busy}>{busy ? ${words} : PROBE_WORDS.act}</UiButton>\n`;
    // held: the table holds the word, a running one, so the pill's words run on `busy`, as it passes
    expect(wrongIn(file, pill("PROBE_WORDS.acting"), read)).toEqual([]);
    expect(
      wrongIn(file, `${imports}<UiButton running>{PROBE_WORDS.acting}</UiButton>\n`, read),
    ).toEqual([]);
    // each mutation reads red in the scan's own words: a key the table lacks, a table the file does not import, a
    // branch that is no table word, and a table word that is no running word
    const red =
      "packages/field-app/src/probe/Probe.tsx:2 (kit) — its words run on null, it passes busy";
    expect(wrongIn(file, pill("PROBE_WORDS.missing"), read)).toEqual([red]);
    expect(wrongIn(file, pill("PROBE_WORDS.acting", ""), read)).toEqual([
      red.replace(":2 ", ":1 "),
    ]);
    expect(wrongIn(file, pill("label"), read)).toEqual([red]);
    expect(wrongIn(file, pill("PROBE_WORDS.act"), read)).toEqual([red]);
  });
});
