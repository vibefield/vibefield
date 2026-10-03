import { describe, expect, it } from "vitest";
import { captureDocThumbnailScene } from "../src/doc-thumbnail-scene";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { SEED_TYPES } from "../src/field/desk/desk-seed";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

describe("document thumbnail scene", () => {
  it("projects the seeded desk into sanitized root-level silhouettes", async () => {
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), createDeskBlobStore());

    const scene = captureDocThumbnailScene(ce);
    expect(scene.widgets).toHaveLength(SEED_TYPES.length);
    expect(scene.wires).toHaveLength(0);
    expect(scene.widgets.map((widget) => widget.type).sort()).toEqual([...SEED_TYPES].sort());
    for (const widget of scene.widgets) {
      expect(Number.isFinite(widget.x)).toBe(true);
      expect(Number.isFinite(widget.y)).toBe(true);
      expect(widget.w).toBeGreaterThan(0);
      expect(widget.h).toBeGreaterThan(0);
      expect(widget).not.toHaveProperty("props");
    }

    ce.dispose();
  });
});
