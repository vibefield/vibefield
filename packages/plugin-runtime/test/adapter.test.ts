import { describe, expect, it } from "vitest";
import { adaptLegacyManifest } from "../src/adapter";
import type { PluginManifest } from "../src/manifest";

// The §21.1 bridge: every legacy manifest shape shipping today must adapt to a
// VALIDATED PluginManifestV1 — shape-level truth now, canonical manifests at P1.

const legacy = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: "note",
  version: "0.1.0",
  title: "Notes",
  widgets: [
    {
      type: "note.card",
      title: "Note",
      defaultSize: { w: 260, h: 180 },
      description: "A sticky note",
      category: "Cards",
      preview: "#f6e7a9",
    },
  ],
  scopes: [],
  ...over,
});

describe("adaptLegacyManifest", () => {
  it("adapts a note-shaped manifest to validated V1 with a color preview", () => {
    const { v1, warnings } = adaptLegacyManifest(legacy());
    expect(warnings).toEqual([]);
    expect(v1.id).toBe("note");
    expect(v1.activation).toEqual(["onWidget:note.card"]);
    const w = v1.contributes?.widgets?.[0];
    expect(w?.preview).toEqual({ kind: "color", value: "#f6e7a9" });
    expect(w?.surface).toBe("dom");
    expect(w?.schemaVersion).toBe(1);
  });

  it("maps gradient previews and drops unmappable ones with a warning", () => {
    const { v1, warnings } = adaptLegacyManifest(
      legacy({
        widgets: [
          {
            type: "note.grad",
            title: "G",
            defaultSize: { w: 10, h: 10 },
            preview: "linear-gradient(135deg, rgba(99, 102, 241, 0.45), rgba(99, 102, 241, 0.18))",
          },
          {
            type: "note.weird",
            title: "W",
            defaultSize: { w: 10, h: 10 },
            preview: "url(http://evil)",
          },
        ],
      }),
    );
    const [grad, weird] = v1.contributes?.widgets ?? [];
    expect(grad?.preview?.kind).toBe("gradient");
    expect(weird?.preview).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/note\.weird/);
  });

  it("carries scopes into V1 capabilities", () => {
    const { v1 } = adaptLegacyManifest(legacy({ scopes: ["doc.write", "canvas.read"] }));
    expect(v1.capabilities).toEqual(["doc.write", "canvas.read"]);
  });
});
