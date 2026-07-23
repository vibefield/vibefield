// Manifest emit (plugin-architecture spec §5.4 item 1, stage "manifest
// emit"). Turns a TS-authored manifest object into the installed artifact's
// `vibefield.plugin.json`: validated, defaulted, and canonicalized so the
// file on disk already IS the manifest fieldd will register, not a draft
// fieldd still has to interpret.

import { writeFileSync } from "node:fs";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "./canonical";

export interface EmitManifestResult {
  unknownKeys: string[];
}

/**
 * Validate `manifest`, then write its canonical JSON form to `outPath`.
 *
 * A manifest that fails `PluginManifestV1` validation THROWS with every
 * issue joined into the error message — a broken manifest fails at build,
 * never at install (spec §5.4). Unknown top-level/`contributes` keys are
 * preserved, never stripped (§7.1), but are surfaced two ways: warned to
 * the console immediately, and returned so a caller can be stricter than
 * this function is by default (e.g. bundled-plugin CI rejecting them).
 *
 * Design note — canonicalizes the PARSED manifest (`validatePluginManifest`'s
 * `.manifest`), not the raw `manifest` argument:
 *
 * fieldd's own registration sequence (spec §9.2) zod-validates AND DEFAULTS
 * a manifest (step 3) BEFORE canonicalizing it and computing `manifestHash`
 * (step 5) — canonicalize-after-parse is the pipeline order the spec itself
 * establishes, not a choice invented here. Emitting the parsed form mirrors
 * that order so the shipped `vibefield.plugin.json` is byte-identical to
 * what fieldd independently re-derives at registration, which is what lets
 * PA-2 call this file "the canonical artifact" without a reader having to
 * mentally re-run zod defaults to know the effective manifest.
 *
 * Concretely, `WidgetContribution.props`/`.groups` carry `.default({})`/
 * `.default([])` (packages/contracts/src/plugins.ts): an author who writes
 * `"groups": []` explicitly and one who omits `groups` entirely mean the
 * same plugin. Canonicalizing raw input would hash those two manifests
 * differently; canonicalizing parsed output collapses them to identical
 * bytes, which is what "byte-stable" (PA-33) should mean — stable in the
 * EFFECTIVE manifest, not merely stable per keystroke.
 *
 * This is safe against `canonicalJson`'s strict undefined-rejection: zod
 * (3.25.76, this repo's pinned version) leaves an omitted `.optional()`
 * field genuinely absent from parsed output — it does not materialize
 * `key: undefined`. The one case that DOES produce a literal `undefined`
 * value post-parse is an author explicitly writing `key: undefined` in
 * source, which is exactly the pattern this repo's own
 * `exactOptionalPropertyTypes` house rule (CLAUDE.md) already treats as a
 * mistake — rejecting it here at build time is that same discipline
 * enforced transitively through the emit path, not a new hazard.
 * `.passthrough()` on every object in the schema means this switch costs
 * nothing in fidelity: unknown/future keys ride through parsing unchanged.
 */
export function emitManifest(manifest: unknown, outPath: string): EmitManifestResult {
  const result = validatePluginManifest(manifest);
  if (!result.ok) {
    throw new Error(
      [
        "plugin manifest failed validation — a broken manifest must fail at",
        "build, never at install (plugin-architecture spec §5.4):",
        ...result.issues.map((issue) => `  - ${issue}`),
      ].join("\n"),
    );
  }

  if (result.unknownKeys.length > 0) {
    console.warn(
      `plugin-build: manifest declares unknown keys (preserved, ungranted): ${result.unknownKeys.join(", ")}`,
    );
  }

  writeFileSync(outPath, canonicalJson(result.manifest));

  return { unknownKeys: result.unknownKeys };
}
