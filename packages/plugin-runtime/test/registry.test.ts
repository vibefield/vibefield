import { describe, expect, it } from "vitest";
import { type PluginManifest, PluginRegistry } from "../src/index";

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: "note",
  version: "0.1.0",
  title: "Notes",
  widgets: [{ type: "note.card", title: "Note", defaultSize: { w: 240, h: 160 } }],
  scopes: [],
  ...over,
});

describe("PluginRegistry", () => {
  it("registers and exposes namespaced widgets", () => {
    const r = new PluginRegistry<string>();
    r.register(manifest(), { "note.card": "impl" });
    expect(r.hasWidget("note.card")).toBe(true);
    expect(r.hasWidget("note.gone")).toBe(false);
    expect(r.hasWidget("ghost.card")).toBe(false);
    expect([...r.allWidgets().keys()]).toEqual(["note.card"]);
  });

  it("rejects widgets outside the plugin namespace", () => {
    const r = new PluginRegistry();
    expect(() =>
      r.register(
        manifest({ widgets: [{ type: "other.card", title: "x", defaultSize: { w: 1, h: 1 } }] }),
        {
          "other.card": {},
        },
      ),
    ).toThrow(/namespace/);
  });

  it("rejects declared-but-missing and provided-but-undeclared implementations", () => {
    const r = new PluginRegistry();
    expect(() => r.register(manifest(), {})).toThrow(/no implementation/);
    expect(() => r.register(manifest(), { "note.card": {}, "note.extra": {} })).toThrow(
      /undeclared/,
    );
  });

  it("rejects duplicate plugin ids and bad ids", () => {
    const r = new PluginRegistry<string>();
    r.register(manifest(), { "note.card": "impl" });
    expect(() => r.register(manifest(), { "note.card": "impl" })).toThrow(/already registered/);
    expect(() => r.register(manifest({ id: "Bad_Id" }), {})).toThrow(/plugin id/);
  });

  it("resolves ownership through the exact type map, never by splitting (§6.2)", () => {
    const r = new PluginRegistry<string>();
    r.register(manifest(), { "note.card": "impl" });
    expect(r.ownerOf("note.card")).toBe("note");
    expect(r.ownerOf("note.gone")).toBeUndefined();
    // split-derived lookup would consult plugin "note" for "note.card.deep";
    // the exact map answers from the registered set alone.
    expect(r.hasWidget("note.card.deep")).toBe(false);
  });

  it("registers a validated V1 projection alongside the legacy manifest", () => {
    const r = new PluginRegistry<string>();
    r.register(manifest(), { "note.card": "impl" });
    const p = r.plugin("note");
    expect(p?.v1.manifestVersion).toBe(1);
    expect(p?.v1.contributes?.widgets?.[0]?.type).toBe("note.card");
    expect(p?.adaptWarnings).toEqual([]);
  });
});
