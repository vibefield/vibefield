import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, it } from "vitest";
import {
  PRESENTATION_TABLES_GOLDEN,
  presentationTablesFile,
} from "./lib/presentation-tables-golden";

// WRITE THE PHONE'S PRESENTATION TABLES (UM-4, M-phone's Owed; `perf/lib/presentation-tables-golden.ts`) into
// `test/fixtures/usage/`, pinned byte for byte by `test/presentation-tables.test.ts`. Its ONE writer (biome is told to
// leave `usage/*.golden.json`). Every regeneration is a re-bless, said in its commit, with the kit's two copies to
// refresh (`pnpm check:ios-fixtures` names them).
//
//   ./node_modules/.bin/vitest run --config vitest.perf.config.ts perf/presentation-tables.generate.perf.ts
//   (from packages/field-app)

describe("the phone's presentation tables", () => {
  it("writes the profile glyphs and the plans' products from the pinned packages", () => {
    const bytes = presentationTablesFile();
    let before: string | null = null;
    try {
      before = readFileSync(PRESENTATION_TABLES_GOLDEN, "utf8");
    } catch {
      before = null;
    }
    mkdirSync(dirname(PRESENTATION_TABLES_GOLDEN), { recursive: true });
    writeFileSync(PRESENTATION_TABLES_GOLDEN, bytes);
    const verdict = before === null ? "WRITTEN" : before === bytes ? "unchanged" : "RE-BLESSED";
    process.stdout.write(
      `presentation-tables.golden.json: ${verdict} (${Buffer.byteLength(bytes)} bytes)\n`,
    );
  });
});
