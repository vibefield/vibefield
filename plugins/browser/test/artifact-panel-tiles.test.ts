import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * HN-8 — the Artifact Hub's tile form (PL-D3, "Tiles, like your fields"). The Hub's host is
 * VibeField's pill's sheet, on its Artifacts shelf: 504 wide inside the sheet's 544, a CSS
 * container (VibeField DESIGN.md §8 "Artifacts — the Artifacts shelf's contents"). There the
 * catalog reads as the fields' tiles do — three across, the preview on top in its ring, the name,
 * where it runs and its state under it, the overflow on a chip over the preview — with Publish…
 * first, standing for the round plus, and the tiles move as the fields' do. Publish… turns the
 * shelf to its step, "Publish", whose two choices are two cards side by side. The list stays for
 * a host that is no container, so the tile rules live only inside the query. The 152 column's
 * narrow form retired with the edges' drawer, and the side panel's "Close panel" with it.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "artifact-panel.css"),
  "utf8",
);
const tiles = ((): string => {
  const from = CSS.indexOf("@container (min-width: 320px) {");
  if (from < 0) return "";
  const end = CSS.indexOf("\n}\n", from);
  return CSS.slice(from, end < 0 ? CSS.length : end);
})();
/** The reduced-motion block (M6), to the stylesheet's end. */
const still = ((): string => {
  const from = CSS.indexOf("@media (prefers-reduced-motion: reduce) {");
  return from < 0 ? "" : CSS.slice(from);
})();
/** A rule inside a block, by its whole selector list, one selector to a line as biome writes it. */
const ruleIn = (block: string, ...selectors: string[]): string => {
  const from = block.indexOf(`  ${selectors.join(",\n  ")} {`);
  return from < 0 ? "" : block.slice(from, block.indexOf("}", from));
};
/** A rule inside the tile form's query. */
const rule = (...selectors: string[]): string => ruleIn(tiles, ...selectors);
/** A rule outside any query: the list form's, or the Publish… tile's own. */
const outside = CSS.slice(0, CSS.indexOf("@container"));
const base = (selector: string): string => {
  const from = outside.indexOf(`\n${selector} {`);
  return from < 0 ? "" : outside.slice(from, outside.indexOf("}", from));
};

describe("the Artifact Hub on the Artifacts shelf (HN-8, PL-D3)", () => {
  it("answers a container of the shelf's width with tiles three across, at the fields' gaps", () => {
    expect(tiles).not.toBe("");
    expect(rule(".vf-artifact-list")).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(rule(".vf-artifact-list")).toContain("gap: 16px 14px;");
    // the sheet is the padding: the panel takes none of its own
    expect(rule(".vf-artifact-panel")).toContain("padding: 0;");
  });

  it("draws each tile as its preview in the hairline ring, its name at 12/500, its overflow on a chip over the preview", () => {
    expect(rule(".vf-artifact-row")).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule(".vf-artifact-row")).toContain("border: 0;");
    expect(rule(".vf-artifact-preview")).toContain("width: 100%;");
    expect(rule(".vf-artifact-preview")).toContain("box-shadow: 0 0 0 1px var(--vf-hairline);");
    expect(rule(".vf-artifact-row__facts strong")).toContain("font-weight: 500;");
    expect(rule(".vf-artifact-row__facts strong")).toContain("color: var(--vf-text-primary);");
    const chip = rule(".vf-artifact-menu summary");
    expect(chip).toContain("position: absolute;");
    expect(chip).toContain("top: 6px;");
    expect(chip).toContain("right: 6px;");
    expect(chip).toContain("background: var(--vf-chrome-solid);");
  });

  it("hangs the chip's menu from the tile's right, and from its left in the first column — Publish… first — so it never leaves the shelf (ruling 13)", () => {
    // the chip and its menu are placed on the tile, the row, whose box the list form already
    // positions: the details between them is no containing block of its own
    expect(base(".vf-artifact-row")).toContain("position: relative;");
    expect(rule(".vf-artifact-menu")).toContain("position: static;");
    // under the chip (6 in, 26 tall, 8 clear), from the tile's right edge where the chip stands
    expect(rule(".vf-artifact-menu > div")).toContain("top: 40px;");
    expect(rule(".vf-artifact-menu > div")).toContain("right: 6px;");
    // the first column is every third tile from the first, Publish… itself being the first
    const first = rule(".vf-artifact-row:nth-child(3n + 1) .vf-artifact-menu > div");
    expect(first).toContain("right: auto;");
    expect(first).toContain("left: 6px;");
  });

  it("moves its tiles as the fields' do — 1.03 under the pointer, 0.95 pressed, 200ms ease — the one under the pointer or the focus standing above its neighbours (ruling 12)", () => {
    for (const tile of [".vf-artifact-row", ".vf-artifact-publish"]) {
      expect(rule(tile), tile).toContain("transition: transform 200ms ease;");
    }
    const hover = rule(".vf-artifact-row:hover", ".vf-artifact-publish:hover");
    expect(hover).toContain("transform: scale(1.03);");
    expect(hover).toContain("z-index: 1;");
    // the focus above the pointer: a tile whose menu is open keeps it over a neighbour passed over
    expect(rule(".vf-artifact-row:focus-within", ".vf-artifact-publish:focus-within")).toContain(
      "z-index: 2;",
    );
    // pressed is the tile's own face, never its chip, its menu or its rename
    expect(
      rule(
        ".vf-artifact-row:has(> .vf-artifact-row__open:not(:disabled):active)",
        ".vf-artifact-publish:active",
      ),
    ).toContain("transform: scale(0.95);");
    // and the face does not press a second time inside its tile, as the list's row does
    expect(base(".vf-artifact-row__open:not(:disabled):active")).toContain("scale(0.99)");
    expect(rule(".vf-artifact-row__open:not(:disabled):active")).toContain("transform: none;");
  });

  it("holds the tiles still under reduced motion: no rise, no press (ruling 12, M6)", () => {
    expect(
      ruleIn(
        still,
        ".vf-artifact-row:hover",
        ".vf-artifact-row:has(> .vf-artifact-row__open:not(:disabled):active)",
        ".vf-artifact-publish:hover",
        ".vf-artifact-publish:active",
      ),
    ).toContain("transform: none;");
  });

  it("lays the Publish step's two choices side by side as cards in the tile form, one under the other in the list (ruling 11)", () => {
    expect(base(".vf-artifact-choices")).toContain("display: grid;");
    expect(base(".vf-artifact-choices")).not.toContain("grid-template-columns");
    expect(rule(".vf-artifact-choices")).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    // the ruled page's card: its glyph over its name and its line, 8 apart, on the fill
    const card = rule(".vf-artifact-choices > .vf-artifact-choice");
    expect(card).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(card).toContain("gap: 8px;");
    expect(card).toContain("padding: 16px;");
    expect(card).toContain("border-radius: 14px;");
    expect(card).toContain("background: var(--vf-fill);");
    expect(rule(".vf-artifact-choices > .vf-artifact-choice > span")).toContain("gap: 8px;");
    expect(rule(".vf-artifact-choices > .vf-artifact-choice strong")).toContain("font-size: 14px;");
    expect(rule(".vf-artifact-choices .vf-artifact-chevron")).toContain("display: none;");
  });

  it("puts Publish… first in New field's face and hides the round plus it stands for — in the tile form only", () => {
    expect(base(".vf-artifact-publish")).toContain("display: none;");
    expect(rule(".vf-artifact-publish")).toContain("display: block;");
    expect(rule(".vf-artifact-add")).toContain("display: none;");
    const face = base(".vf-artifact-publish > button");
    expect(face).toContain("aspect-ratio: 16 / 10;");
    expect(face).toContain("border: 1px dashed var(--vf-hairline-strong);");
    expect(face).toContain("background: var(--vf-fill);");
    expect(face).toContain("color: var(--vf-text-secondary);");
    expect(face).toContain("font-size: 12px;");
    expect(face).toContain("font-weight: 500;");
  });

  it("keeps the list outside the query, and retires the narrow form and the close", () => {
    expect(outside).toMatch(/\.vf-artifact-preview \{\s*width: 7rem;/);
    expect(outside).toMatch(
      /\.vf-artifact-row__open \{[^}]*grid-template-columns: 7rem minmax\(0, 1fr\);/,
    );
    expect(CSS).not.toContain("@container (max-width: 200px)");
    expect(CSS).not.toContain(".vf-artifact-close");
    expect(CSS.match(/@container/g)).toHaveLength(1);
  });
});
