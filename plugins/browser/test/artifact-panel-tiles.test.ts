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
 * first, standing for the round plus. The list stays for a host that is no container, so the
 * tile rules live only inside the query. The 152 column's narrow form retired with the edges'
 * drawer, and the side panel's "Close panel" with it.
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
/** A rule inside the tile form's query. */
const rule = (selector: string): string => {
  const from = tiles.indexOf(`  ${selector} {`);
  return from < 0 ? "" : tiles.slice(from, tiles.indexOf("}", from));
};
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
    expect(rule(".vf-artifact-menu")).toContain("position: absolute;");
    expect(rule(".vf-artifact-menu summary")).toContain("background: var(--vf-chrome-solid);");
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
