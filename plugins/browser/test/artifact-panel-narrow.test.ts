import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One Frame FR-4 — the Artifact Hub's narrow form. The Hub's door is VibeField's
 * right edge now, and its drawer is a 152 column whose list is a CSS container
 * (VibeField DESIGN.md §8, edge trays): under 200 wide the panel must read as
 * that column, never as the 26rem panel squeezed. The wide form stays for any
 * host that is wider, so the narrow rules live only inside the container query.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "artifact-panel.css"),
  "utf8",
);
const narrow = ((): string => {
  const from = CSS.indexOf("@container (max-width: 200px) {");
  if (from < 0) return "";
  const end = CSS.indexOf("\n}\n", from);
  return CSS.slice(from, end < 0 ? CSS.length : end);
})();
const rule = (selector: string): string => {
  const from = narrow.indexOf(`  ${selector} {`);
  return from < 0 ? "" : narrow.slice(from, narrow.indexOf("}", from));
};

describe("the Artifact Hub in a drawer's column (One Frame FR-4)", () => {
  it("answers a narrow container — and only a narrow one — with its card form", () => {
    expect(narrow).not.toBe("");
    // each row a card: one column, the preview full width on top
    expect(rule(".vf-artifact-row")).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule(".vf-artifact-row__open")).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule(".vf-artifact-preview")).toContain("width: 100%;");
    // the overflow on a chip over the preview
    expect(rule(".vf-artifact-menu")).toContain("position: absolute;");
    // the panel takes the drawer's own padding, and the Add step's choices stack
    expect(rule(".vf-artifact-panel")).toContain("padding: 0;");
    expect(rule(".vf-artifact-choice .vf-artifact-chevron")).toContain("display: none;");
  });

  it("keeps the wide form outside the query, for a host that is wider", () => {
    const wide = CSS.slice(0, CSS.indexOf("@container"));
    expect(wide).toMatch(/\.vf-artifact-preview \{\s*width: 7rem;/);
    expect(wide).toMatch(
      /\.vf-artifact-row__open \{[^}]*grid-template-columns: 7rem minmax\(0, 1fr\);/,
    );
  });
});
