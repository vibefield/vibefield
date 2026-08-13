import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { manifest, renderer } from "../src";

// The plugin contract in miniature: the CANONICAL manifest V1-validates,
// ACTIVATION binds exactly the declared widget types (§12.1, proven against the
// SDK's mock host — no engine, no registry), and the committed artifact is the
// canonical emission of the TS source beside it.
//
// Keep both tests as the plugin grows. The first is what makes a declaration
// that nothing binds fail here rather than at load; the second is what makes a
// hand-edited `vibefield.plugin.json` fail here rather than at install.
describe("{{id}}", () => {
  it("activation binds exactly the manifest's declared widget types", async () => {
    const declared = (manifest.contributes?.widgets ?? []).map((w) => w.type);
    const session = await activateWithMockHost(renderer, {
      id: manifest.id,
      version: manifest.version,
      declaredWidgets: declared,
    });
    expect([...session.bindings.keys()]).toEqual(declared);
    for (const binding of session.bindings.values()) expect(binding.component).toBeDefined();
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
