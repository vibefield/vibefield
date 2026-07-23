import type { PluginManifestV1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { PluginRegistry } from "../src/index";

// C1c: the registry speaks ONLY the canonical V1. Ownership stays the §6.2
// exact type map; declared⇄provided parity and cross-plugin collisions refuse
// at registration.

const manifest = (over: Partial<PluginManifestV1> = {}): PluginManifestV1 => ({
  manifestVersion: 1,
  id: "note",
  version: "0.1.0",
  title: "Notes",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [],
  capabilities: [],
  contributes: {
    widgets: [
      {
        type: "note.card",
        title: "Note",
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 240, h: 160 },
        props: {},
        groups: {},
      },
    ],
  },
  ...over,
});

describe("PluginRegistry", () => {
  it("registers and exposes namespaced widgets through the exact map", () => {
    const r = new PluginRegistry<string>();
    r.registerV1(manifest(), { "note.card": "impl" });
    expect(r.hasWidget("note.card")).toBe(true);
    expect(r.hasWidget("note.gone")).toBe(false);
    expect(r.hasWidget("ghost.card")).toBe(false);
    // split-derived lookup would consult plugin "note" for "note.card.deep";
    // the exact map answers from the registered set alone (§6.2).
    expect(r.hasWidget("note.card.deep")).toBe(false);
    expect(r.ownerOf("note.card")).toBe("note");
    expect([...r.allWidgets().keys()]).toEqual(["note.card"]);
  });

  it("rejects widgets outside the plugin namespace (V1 validation)", () => {
    const r = new PluginRegistry();
    const bad = manifest();
    bad.contributes = {
      widgets: [{ ...(bad.contributes?.widgets?.[0] as object), type: "other.card" } as never],
    };
    expect(() => r.registerV1(bad, { "other.card": {} })).toThrow(/must be note/);
  });

  it("rejects declared-but-missing and provided-but-undeclared implementations", () => {
    const r = new PluginRegistry();
    expect(() => r.registerV1(manifest(), {})).toThrow(/no implementation/);
    expect(() => r.registerV1(manifest(), { "note.card": {}, "note.extra": {} })).toThrow(
      /undeclared/,
    );
  });

  it("rejects duplicate plugin ids and invalid manifests", () => {
    const r = new PluginRegistry<string>();
    r.registerV1(manifest(), { "note.card": "impl" });
    expect(() => r.registerV1(manifest(), { "note.card": "impl" })).toThrow(/already registered/);
    expect(() => r.registerV1(manifest({ id: "Bad_Id" }), {})).toThrow(/manifest invalid/);
  });

  it("refuses a cross-plugin widget-type collision", () => {
    const r = new PluginRegistry<string>();
    r.registerV1(manifest(), { "note.card": "impl" });
    // a DIFFERENT plugin whose bare type collides: id "note.card" owns the
    // bare widget type "note.card" by the owned-name rule — the exact map
    // refuses it at registration.
    const collider = manifest({ id: "note.card" });
    collider.contributes = {
      widgets: [{ ...(collider.contributes?.widgets?.[0] as object), type: "note.card" } as never],
    };
    expect(() => r.registerV1(collider, { "note.card": "impl2" })).toThrow(/already owned/);
  });
});
