import { PluginRegistry } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../src/hud/tray-catalog";

// buildCatalog is a pure derivation over a live PluginRegistry (no ICE, no DOM):
// each manifest widget row joined with its registered def becomes a tray tile.
// We register one fake plugin and assert the join, the category fallback, and
// def identity.
//
// Not tested here: buildCatalog's `def === undefined` skip guard. register()
// enforces declared-vs-provided parity (it throws on either mismatch — covered
// by packages/plugin-runtime/test/registry.test.ts), so a declared row with no
// implementation is unrepresentable through the public API; the guard is
// belt-and-braces for a future non-register construction path.

interface FakeDef {
  surface: "dom" | "gl";
}

const domImpl: FakeDef = { surface: "dom" };
const glImpl: FakeDef = { surface: "gl" };

// "fake.a": explicit category + preview. "fake.b": neither → category falls back
// off the def's surface ("gl" → "3D"), preview stays absent.
function fakeRegistry(): PluginRegistry<FakeDef> {
  const registry = new PluginRegistry<FakeDef>();
  registry.register(
    {
      id: "fake",
      version: "0.0.0",
      title: "Fake",
      scopes: [],
      widgets: [
        {
          type: "fake.a",
          title: "Fake A",
          defaultSize: { w: 4, h: 3 },
          category: "Tools",
          preview: "#123456",
        },
        { type: "fake.b", title: "Fake B", defaultSize: { w: 4, h: 3 } },
      ],
    },
    { "fake.a": domImpl, "fake.b": glImpl },
  );
  return registry;
}

describe("buildCatalog", () => {
  it("joins one entry per declared widget", () => {
    const catalog = buildCatalog(fakeRegistry());
    expect(catalog).toHaveLength(2);
    expect(catalog.map((e) => e.type)).toEqual(["fake.a", "fake.b"]);
  });

  it("takes titles from the manifest", () => {
    const catalog = buildCatalog(fakeRegistry());
    expect(catalog.map((e) => e.title)).toEqual(["Fake A", "Fake B"]);
  });

  it("uses the manifest category and preview when present", () => {
    const a = buildCatalog(fakeRegistry()).find((e) => e.type === "fake.a");
    expect(a?.category).toBe("Tools");
    expect(a?.preview).toBe("#123456");
  });

  it("falls back to a surface-derived category when the manifest omits one", () => {
    const b = buildCatalog(fakeRegistry()).find((e) => e.type === "fake.b");
    expect(b?.category).toBe("3D"); // gl surface → "3D"
    expect(b?.preview).toBeUndefined();
  });

  it("carries the live widget def by identity", () => {
    const catalog = buildCatalog(fakeRegistry());
    expect(catalog.find((e) => e.type === "fake.a")?.def).toBe(domImpl);
    expect(catalog.find((e) => e.type === "fake.b")?.def).toBe(glImpl);
  });
});
