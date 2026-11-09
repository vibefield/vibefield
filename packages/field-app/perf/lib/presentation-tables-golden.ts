import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_GLYPHS } from "@vibefield/puppeteer-view-sdk/toolkit";
import { serviceProduct } from "@vibefield/puppeteer-views";

// UM-4 (M-phone's Owed; DESIGN.md §13's dated note) — THE PHONE'S TWO PRESENTATION TABLES, FROM THE PINNED PACKAGES:
// the profile-glyph vocabulary (puppeteer-view-sdk's `PROFILE_GLYPHS`) and what each company's plans are sold as
// (puppeteer-views' `SERVICE_PRODUCTS`). The phone keeps hand copies (`ProfileGlyphSymbols.symbols`,
// `PlanTitles.products`); `ProfileGlyphSymbolsTests` and `MeterModelTests` hold them to this file, so an EL8 that moves
// either table reddens `test/presentation-tables.test.ts` here and, once the file is re-blessed, the kit. The writer is
// `perf/presentation-tables.generate.perf.ts`. It carries no puppeteer version: a pin that moves neither table moves
// no byte.

const FIELD_APP = join(import.meta.dirname, "..", "..");

/** Where the golden lives, beside the meters' own. The kit's two copies are held to it byte for byte by
 * `pnpm check:ios-fixtures` (`OTHER_ORIGINS`). */
export const PRESENTATION_TABLES_GOLDEN = join(
  FIELD_APP,
  "test",
  "fixtures",
  "usage",
  "presentation-tables.golden.json",
);

/** `SERVICE_PRODUCTS` is not exported: only `serviceProduct(service)` is, which answers one company at a time. The
 * companies themselves are read from the package's own file, and every answer is then held to that door. */
const SERVICE_MARK_JS = join(
  FIELD_APP,
  "node_modules",
  "@vibefield",
  "puppeteer-views",
  "dist",
  "icons",
  "ServiceMark.js",
);

/** A label no table holds: what `serviceProduct` says for a company that has no product row. */
const NO_PRODUCT = "no product row";

export interface PresentationTables {
  profileGlyphs: string[];
  serviceProducts: Record<string, string>;
}

/** The rows of `const SERVICE_PRODUCTS = { … };` in `ServiceMark.js`. A table it cannot find, a row it cannot read and
 * an empty table each throw: an EL8 that reshapes the file stops here, loudly, rather than writing a shorter table. */
export function serviceProductsOf(source: string): Record<string, string> {
  const body = /^const SERVICE_PRODUCTS = \{\n([\s\S]*?)^\};$/mu.exec(source)?.[1];
  if (body === undefined) throw new Error("ServiceMark.js holds no SERVICE_PRODUCTS table");
  const products: Record<string, string> = {};
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const row = /^\s*(?:'([^']+)'|([A-Za-z0-9_]+)): '([^']*)',?$/u.exec(line);
    const id = row?.[1] ?? row?.[2];
    const name = row?.[3];
    if (id === undefined || name === undefined) {
      throw new Error(`a SERVICE_PRODUCTS row this reader cannot read: ${line.trim()}`);
    }
    products[id] = name;
  }
  if (Object.keys(products).length === 0) throw new Error("SERVICE_PRODUCTS is empty");
  return products;
}

/** The two tables at the pin: the vocabulary in the package's order, the products by company id. */
export function presentationTables(
  source: string = readFileSync(SERVICE_MARK_JS, "utf8"),
): PresentationTables {
  const products = serviceProductsOf(source);
  for (const [id, name] of Object.entries(products)) {
    const said = serviceProduct({ id, label: NO_PRODUCT });
    if (said !== name) {
      throw new Error(`serviceProduct says "${said}" for ${id}, the file "${name}"`);
    }
  }
  const ids = Object.keys(products).sort();
  return {
    profileGlyphs: [...PROFILE_GLYPHS],
    serviceProducts: Object.fromEntries(ids.map((id) => [id, products[id] as string])),
  };
}

/** The file's bytes. */
export function presentationTablesFile(): string {
  return `${JSON.stringify(presentationTables(), null, 2)}\n`;
}
