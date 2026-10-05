// `emit-manifest` — the plugin's own `gen:manifest`, run by the kit (DK-10 — the ten-minute bar).
//
// A plugin's canonical `vibefield.plugin.json` is EMITTED from its `src/manifest.ts` (PA-2: TS authors, JSON is the
// installed contract) by ONE function, plugin-build's `emitManifest` — validated, defaulted, canonicalized. The
// scaffold's `scripts/emit-manifest.ts` calls it through `tsx`, which needs an install; a plugin authored OUTSIDE a
// workspace has none (its `workspace:*` dependencies resolve to nothing there), and the bar's first three agents each
// wrote an emitter of their own to get past it. This command imports `src/manifest.ts` the way the scaffolder did on
// the plugin's first breath (Node strips its types; the host's singletons resolve to the kit's copies — the bin's
// import map) and hands it to the SAME `emitManifest`: the same producer, a different launcher.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emitManifest } from "@vibefield/plugin-build";
import { note, pass, refuse, type Verdict } from "./verdict";

/** Where a plugin's manifest is authored, by the scaffold's convention. */
export const MANIFEST_SOURCE = join("src", "manifest.ts");

export async function emitManifestCommand(dir: string): Promise<Verdict[]> {
  const root = resolve(dir);
  const source = join(root, MANIFEST_SOURCE);
  if (!existsSync(source))
    return [
      refuse("manifest", "manifest-source-missing", `${source} does not exist`, {
        pointer: MANIFEST_SOURCE,
      }),
    ];
  let manifest: unknown;
  try {
    const mod = (await import(`${pathToFileURL(source).href}?emit=${Date.now()}`)) as {
      manifest?: unknown;
      default?: unknown;
    };
    manifest = mod.manifest ?? mod.default;
  } catch (error) {
    return [
      refuse(
        "manifest",
        "manifest-source-unloadable",
        `${MANIFEST_SOURCE} did not load: ${error instanceof Error ? error.message : String(error)}`,
        { pointer: MANIFEST_SOURCE },
      ),
    ];
  }
  if (manifest === undefined)
    return [
      refuse(
        "manifest",
        "manifest-source-unloadable",
        `${MANIFEST_SOURCE} exports no \`manifest\` (nor a default)`,
        { pointer: MANIFEST_SOURCE },
      ),
    ];
  const out = join(root, "vibefield.plugin.json");
  try {
    const { unknownKeys } = emitManifest(manifest, out);
    return [
      pass(
        "manifest",
        `emitted ${out} from ${MANIFEST_SOURCE} (canonical: keys sorted, defaults applied)`,
      ),
      ...unknownKeys.map((key) =>
        note(
          "manifest",
          "manifest-unknown-key",
          `${key} is not a key the schema knows (kept, ungranted)`,
          {
            pointer: `/${key}`,
          },
        ),
      ),
    ];
  } catch (error) {
    // emitManifest throws with every issue joined — the manifest fails PluginManifestV1
    return [
      refuse(
        "manifest",
        "manifest-invalid",
        error instanceof Error ? error.message : String(error),
        { pointer: MANIFEST_SOURCE },
      ),
    ];
  }
}
