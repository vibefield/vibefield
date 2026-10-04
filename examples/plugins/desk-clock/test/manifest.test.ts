import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { CONTAINABLE, DESK_OBJECT, isObjectKind } from "@vibefield/plugin-sdk/desk";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { deskClockManifest, deskClockRenderer } from "../src";
import * as rendererModule from "../src/renderer";

// The clock's contract in miniature (DK-6): its manifest V1-validates and is committed as its own canonical
// emission; its one OBJECT row names an export of the renderer module whose kind the host will take —
// a desk kind whose registry name IS the row's type; its placement keys are the SDK's own; and its
// activation binds nothing (the kind is a static export, never a registration).
describe("vibefield.example.desk-clock", () => {
  const row = deskClockManifest.contributes?.objects?.[0];

  it("declares one object and no widget, bound by name to the renderer module's export", () => {
    expect(deskClockManifest.contributes?.widgets).toBeUndefined();
    expect(deskClockManifest.contributes?.objects).toHaveLength(1);
    // the host reads a row's kind off the module's NAMESPACE by its binding name (spec §12.8)
    const exported = (rendererModule as unknown as Record<string, { kind?: unknown }>)[
      row?.binding.kind ?? ""
    ];
    const kind = exported?.kind;
    expect(isObjectKind(kind)).toBe(true);
    expect(isObjectKind(kind) ? kind.name : undefined).toBe(row?.type);
  });

  it("places by the SDK's keys, never a list that names it — the manifest's strings ARE the door's", () => {
    expect(row?.provides).toEqual([row?.type, DESK_OBJECT, CONTAINABLE]);
  });

  it("activates as any plugin does, binding no widget, command, surface or behavior", async () => {
    const session = await activateWithMockHost(deskClockRenderer, {
      id: deskClockManifest.id,
      version: deskClockManifest.version,
      declaredWidgets: [],
    });
    expect([...session.bindings.keys()]).toEqual([]);
    expect([...session.commands.keys()]).toEqual([]);
    await session.close();
  });

  it("keeps the committed manifest byte-identical to its validated canonical emission", () => {
    const result = validatePluginManifest(deskClockManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
