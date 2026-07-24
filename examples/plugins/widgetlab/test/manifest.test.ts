import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { widgetlabManifest, widgetlabRenderer } from "../src";

// C1b·2/P3a: the canonical manifest V1-validates; node ports ride as DATA on
// the manifest itself; ACTIVATION binds exactly the declared widget types
// (§12.1, proven against the SDK's mock host — no engine, no registry).
// Host-side integration (prefab building, tray silhouettes) lives in
// field-app's own suites.
describe("plugin-widgetlab", () => {
  it("activation binds exactly the manifest's declared widget types", async () => {
    const declared = (widgetlabManifest.contributes?.widgets ?? []).map((w) => w.type);
    expect(declared).toHaveLength(18); // 8 cards + 7 GL + 3 nodes
    const session = await activateWithMockHost(widgetlabRenderer, {
      id: widgetlabManifest.id,
      version: widgetlabManifest.version,
      declaredWidgets: declared,
    });
    expect([...session.bindings.keys()]).toEqual(declared);
    for (const binding of session.bindings.values()) expect(binding.component).toBeDefined();

    // the 7 GL islands: chrome + animated flags survive activation verbatim
    // (the two chromeless islands — crystal, cube — carry no chrome binding).
    expect(session.bindings.get("vibefield.widgetlab.sphere")?.chrome).toBeDefined();
    expect(session.bindings.get("vibefield.widgetlab.sphere")?.animated).toBe(false);
    expect(session.bindings.get("vibefield.widgetlab.crystal")?.chrome).toBeUndefined();
    expect(session.bindings.get("vibefield.widgetlab.crystal")?.animated).toBe(true);
    expect(session.bindings.get("vibefield.widgetlab.torus-knot")?.chrome).toBeDefined();
    expect(session.bindings.get("vibefield.widgetlab.torus-knot")?.animated).toBe(true);
    expect(session.bindings.get("vibefield.widgetlab.cube")?.chrome).toBeUndefined();
    expect(session.bindings.get("vibefield.widgetlab.cube")?.animated).toBe(true);
    expect(session.bindings.get("vibefield.widgetlab.gold-knot")?.chrome).toBeDefined();
    expect(session.bindings.get("vibefield.widgetlab.gold-knot")?.animated).toBe(true);
    expect(session.bindings.get("vibefield.widgetlab.shapes")?.chrome).toBeDefined();
    expect(session.bindings.get("vibefield.widgetlab.shapes")?.animated).toBe(true);
    expect(session.bindings.get("vibefield.widgetlab.orbit-cube")?.chrome).toBeDefined();
    expect(session.bindings.get("vibefield.widgetlab.orbit-cube")?.animated).toBe(false);
  });

  it("dogfoods the hud.panel status surface; activation binds it (§8.4/§13.2)", async () => {
    const surfaces = widgetlabManifest.contributes?.surfaces ?? [];
    expect(surfaces).toEqual([
      { id: "vibefield.widgetlab.status", title: "Widgetlab status", slot: "hud.panel" },
    ]);
    const declaredWidgets = (widgetlabManifest.contributes?.widgets ?? []).map((w) => w.type);
    const session = await activateWithMockHost(widgetlabRenderer, {
      id: widgetlabManifest.id,
      version: widgetlabManifest.version,
      declaredWidgets,
      declaredSurfaces: surfaces.map((s) => s.id),
    });
    expect([...session.surfaces.keys()]).toEqual(["vibefield.widgetlab.status"]);
    expect(session.surfaces.get("vibefield.widgetlab.status")).toBeDefined();
  });

  it("node ports survive to v1 (the wire-editor trio's whole reason for being)", () => {
    const widgets = widgetlabManifest.contributes?.widgets ?? [];
    expect(widgets.find((w) => w.type === "vibefield.widgetlab.filter")?.ports).toEqual([
      { id: "in", side: "w", accepts: ["signal"] },
      { id: "out", side: "e", accepts: ["signal"] },
    ]);
  });

  it("the committed vibefield.plugin.json is the canonical emission (regen: pnpm gen:manifest)", () => {
    const result = validatePluginManifest(widgetlabManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
