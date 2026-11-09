// UM-4 (M-phone's Owed; DESIGN.md §13's dated note) — the phone's two presentation tables, read from the pinned
// packages into a VibeField-origin golden the kit's tests read. An EL8 that moves `PROFILE_GLYPHS` or
// `SERVICE_PRODUCTS` reddens the first row here until the golden is re-blessed.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRESENTATION_TABLES_GOLDEN,
  presentationTables,
  presentationTablesFile,
  serviceProductsOf,
} from "../perf/lib/presentation-tables-golden";

const table = (rows: string): string =>
  `const SERVICE_PRODUCTS = {\n${rows}};\nexport function x() {}\n`;

describe("the phone's presentation tables, from the pinned packages", () => {
  it("are committed exactly as the generator writes them", () => {
    expect(existsSync(PRESENTATION_TABLES_GOLDEN)).toBe(true);
    expect(readFileSync(PRESENTATION_TABLES_GOLDEN, "utf8")).toBe(presentationTablesFile());
  });

  it("hold the token the phone falls back to, and a product for the company it names first", () => {
    const tables = presentationTables();
    expect(tables.profileGlyphs).toContain("star");
    expect(tables.serviceProducts.anthropic).toBe("Claude");
  });

  it("read the package's rows, a quoted company too", () => {
    expect(
      serviceProductsOf(table("    anthropic: 'Claude',\n    'google-ai': 'Google AI',\n")),
    ).toEqual({
      anthropic: "Claude",
      "google-ai": "Google AI",
    });
  });

  it("stop, rather than write a shorter table, when the file is reshaped", () => {
    expect(() => serviceProductsOf("export const OTHER = {};\n")).toThrow(/no SERVICE_PRODUCTS/);
    expect(() => serviceProductsOf(table("    anthropic: `Claude`,\n"))).toThrow(/cannot read/);
    expect(() => serviceProductsOf(table(""))).toThrow(/empty/);
  });

  it("refuse a table the package's own door does not agree with", () => {
    expect(() => presentationTables(table("    anthropic: 'Not Claude',\n"))).toThrow(
      /serviceProduct says/,
    );
  });
});
