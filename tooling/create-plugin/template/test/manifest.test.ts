import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { isObjectKind } from "@vibefield/plugin-sdk/desk";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { manifest, renderer } from "../src";
import * as rendererModule from "../src/renderer";

// The plugin contract in miniature: the CANONICAL manifest V1-validates; its object row
// names an export of the renderer module whose kind the host will take — a desk kind whose
// registry name IS the row's type (the host refuses anything else); ACTIVATION binds nothing
// (a kind is an export, never a registration); and the committed artifact is the canonical
// emission of the TS source beside it.
//
// Keep these as the plugin grows. The second is what makes a misnamed or missing export fail
// here rather than on the desk; the last is what makes a hand-edited `vibefield.plugin.json`
// fail here rather than at install.
describe("{{id}}", () => {
  const row = manifest.contributes?.objects?.[0];

  it("declares one object, drawn by the export its binding names — a desk kind named by its type", () => {
    expect(row?.type).toBe("{{widgetType}}");
    // the host reads the export off the module's NAMESPACE by its binding name (spec §12.8)
    const exported = (rendererModule as unknown as Record<string, { kind?: unknown }>)[
      row?.binding.kind ?? ""
    ];
    const kind = exported?.kind;
    expect(isObjectKind(kind)).toBe(true);
    expect(isObjectKind(kind) ? kind.name : undefined).toBe(row?.type);
  });

  it("activates as any plugin does, binding no command or surface — its kind is its export", async () => {
    const session = await activateWithMockHost(renderer, {
      id: manifest.id,
      version: manifest.version,
    });
    expect([...session.commands.keys()]).toEqual([]);
    expect([...session.surfaces.keys()]).toEqual([]);
    await session.close();
  });

  it("the committed vibefield.plugin.json is the canonical emission (regen: pnpm gen:manifest)", () => {
    const result = validatePluginManifest(manifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
