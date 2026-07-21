import { describe, expect, it } from "vitest";
import { captureDocThumbnailScene } from "../renderer/src/doc-thumbnail-scene";
import { buildRegistry, createFieldEngine, seedField } from "../renderer/src/field-engine";

describe("document thumbnail scene", () => {
  it("projects the seeded canvas into sanitized root-level silhouettes and wires", () => {
    const ce = createFieldEngine(buildRegistry());
    seedField(ce, ce.docs.create());

    const scene = captureDocThumbnailScene(ce);
    expect(scene.widgets).toHaveLength(21);
    expect(scene.wires).toHaveLength(2);
    expect(scene.widgets.some((widget) => widget.type === "note.card")).toBe(true);
    expect(scene.widgets.some((widget) => widget.type === "field.folder")).toBe(true);
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
