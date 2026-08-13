import type { PluginManifestV1 } from "@vibefield/contracts";
import { PluginRecord } from "@vibefield/contracts";
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

// P8b-3 — the SECOND registration authority. A staged plugin's manifest lives in
// fieldd; the renderer holds only the sanitized record (§9.4), which has no
// `engines` and no `entries` and therefore cannot pass the manifest door. These
// rows exist to prove the two doors enforce the SAME laws, because a second door
// that is merely more permissive is a way around the first.

const record = (over: Partial<PluginRecord> = {}): PluginRecord =>
  PluginRecord.parse({
    id: "note",
    version: "0.1.0",
    title: "Notes",
    source: "bundled",
    manifestHash: `sha256:${"a".repeat(64)}`,
    installRevision: "rev-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    contributions: {
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
    renderer: "inactive",
    service: "none",
    ...over,
  });

describe("PluginRegistry.registerRecord (staged)", () => {
  it("registers from a sanitized record and owns its types the same way", () => {
    const r = new PluginRegistry<string>();
    r.registerRecord(record(), { "note.card": "impl" });
    expect(r.ownerOf("note.card")).toBe("note");
    expect(r.hasWidget("note.card.deep")).toBe(false);
    expect([...r.allWidgets().keys()]).toEqual(["note.card"]);
  });

  it("exposes identity and declarations without a manifest behind them", () => {
    const r = new PluginRegistry<string>();
    r.registerRecord(record(), { "note.card": "impl" });
    const [registered] = r.all();
    expect(registered?.id).toBe("note");
    expect(registered?.title).toBe("Notes");
    expect(registered?.widgetContributions.map((w) => w.type)).toEqual(["note.card"]);
    // The provenance is honest in both directions: a staged row carries the
    // record it came from and NO manifest, because this process never saw one.
    expect(registered?.record?.installRevision).toBe("rev-1");
    expect(registered?.v1).toBeUndefined();
  });

  it("enforces declared⇄provided parity and refuses a duplicate id", () => {
    const r = new PluginRegistry<string>();
    expect(() => r.registerRecord(record(), {})).toThrow(/no implementation/);
    expect(() => r.registerRecord(record(), { "note.card": "a", "note.extra": "b" })).toThrow(
      /undeclared/,
    );
    r.registerRecord(record(), { "note.card": "impl" });
    expect(() => r.registerRecord(record(), { "note.card": "impl" })).toThrow(/already registered/);
  });

  it("refuses a malformed id that did not come through the record schema", () => {
    // `PluginRecord.parse` already rejects `Bad_Id` (PluginId validates shape),
    // so this row builds one WITHOUT the schema — which is the only way the
    // registry can ever meet a malformed id, and therefore the only thing its
    // own check can be defending against.
    const r = new PluginRegistry<string>();
    const unparsed = { ...record(), id: "Bad_Id" } as PluginRecord;
    expect(() => r.registerRecord(unparsed, {})).toThrow(/well-formed plugin id/);
  });

  it("refuses a type another plugin already owns, across BOTH doors", () => {
    // The collision that matters is the cross-door one: a manifest-registered
    // built-in and a staged plugin claiming the same widget type would be two
    // owners in one exact map, and the map is what resolution trusts.
    const r = new PluginRegistry<string>();
    r.registerV1(manifest(), { "note.card": "impl" });
    expect(() => r.registerRecord(record({ id: "note.card" }), { "note.card": "impl2" })).toThrow(
      /already owned/,
    );
  });
});
