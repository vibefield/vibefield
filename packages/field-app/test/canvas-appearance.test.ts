import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultCanvasAppearance } from "../src/field/canvas-appearance";

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "../src/field/canvas-appearance.ts");

// DK-17: what is left of the canvas appearance is the plain ground (DESIGN.md §2.1) — the 0.11 ground's
// grid, its magnet and its dot inks retired with it (the retire table's magnet/world-grid row).
describe("canvas appearance — the plain ground", () => {
  it("is the reviewed plain ground, and nothing of the retired 0.11 ground", () => {
    expect(defaultCanvasAppearance()).toEqual({
      canvasPalette: { bgLight: "#FAFAFA", bgDark: "#171717" },
    });
  });

  it("returns isolated editable values without mutating product defaults", () => {
    const editable = defaultCanvasAppearance();
    editable.canvasPalette.bgLight = "#123456";
    expect(defaultCanvasAppearance().canvasPalette.bgLight).toBe("#FAFAFA");
  });

  it("keeps the ground's two colours as the literals ICE's theme test reads by name (risk 9)", () => {
    // ICE `packages/objects/test/vf-theme.test.ts` reads this FILE, not the module:
    // `new RegExp(`${key}:\\s*"([^"]+)"`).exec(canvas-appearance.ts)` for bgLight and bgDark, and skips
    // its whole cross-check when the file is gone — so the file stays, and the literals with it.
    const text = readFileSync(SOURCE, "utf8");
    const literal = (key: string): string | undefined =>
      new RegExp(`${key}:\\s*"([^"]+)"`).exec(text)?.[1];
    expect(literal("bgLight")).toBe(defaultCanvasAppearance().canvasPalette.bgLight);
    expect(literal("bgDark")).toBe(defaultCanvasAppearance().canvasPalette.bgDark);
  });
});
