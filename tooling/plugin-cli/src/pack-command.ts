// `pack` — a thin delegation to plugin-build's pack stage. Every byte of the
// determinism story (STORE-only, fixed DOS clock, bytewise-sorted names) lives
// there; this file chooses a destination and reports the sha256.
//
// The §5.4 authoring-time exemption, checked rather than assumed: pack's default
// walk collects `vibefield.plugin.json` + `dist/**` + `assets/**` + the declared
// entry modules, so `playground/`, `test/`, and `scripts/` are excluded BY
// CONSTRUCTION — an inclusion list, not a filter that could be forgotten.
// `test/pack-exclusions.test.ts` pins that, because "excluded by construction"
// is a property of pack's walk that a future edit could quietly drop.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PluginManifestV1 } from "@vibefield/contracts";
import { packVfplugin, VfpluginError } from "@vibefield/plugin-build";
import { pass, refuse, type Verdict } from "./verdict";

export interface PackResult {
  readonly verdicts: Verdict[];
  readonly artifactPath?: string;
  readonly sha256?: string;
}

export function artifactNameFor(manifest: PluginManifestV1): string {
  return `${manifest.id}@${manifest.version}.vfplugin`;
}

export async function packPlugin(opts: {
  root: string;
  manifest: PluginManifestV1;
  /** where to write; defaults to the plugin directory */
  out?: string;
}): Promise<PackResult> {
  const artifactPath = resolve(opts.out ?? join(opts.root, artifactNameFor(opts.manifest)));
  try {
    const { bytes, sha256 } = await packVfplugin({ rootDir: opts.root });
    writeFileSync(artifactPath, bytes);
    return {
      verdicts: [pass("pack", `${artifactPath} (${bytes.length} bytes) ${sha256}`)],
      artifactPath,
      sha256,
    };
  } catch (error) {
    const detail =
      error instanceof VfpluginError
        ? `${error.message} [${error.code}]`
        : error instanceof Error
          ? error.message
          : String(error);
    return { verdicts: [refuse("pack", "pack-refused", detail, { pointer: opts.root })] };
  }
}
