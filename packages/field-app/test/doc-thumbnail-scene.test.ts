import { describe, expect, it } from "vitest";
import { captureDocThumbnailScene } from "../src/doc-thumbnail-scene";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

describe("document thumbnail scene", () => {
  it("projects the seeded canvas into sanitized root-level silhouettes and wires", () => {
    const registry = buildRegistry();
    const ce = createFieldEngine(registry);
    seedField(ce, ce.docs.create(), registry);

    const scene = captureDocThumbnailScene(ce);
    expect(scene.widgets).toHaveLength(21);
    expect(scene.wires).toHaveLength(2);
    expect(scene.widgets.some((widget) => widget.type === "vibefield.note")).toBe(true);
    expect(scene.widgets.some((widget) => widget.type === "vibefield.field-tools.folder")).toBe(
      true,
    );
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
