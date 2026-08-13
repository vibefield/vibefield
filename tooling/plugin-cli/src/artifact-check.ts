// The artifact row (§5.4 item 1's "artifact checks", applied to what is already
// on disk). `check` must never require a build, so this row is conditional: no
// declared artifact present ⇒ a NOTE, and the command can still pass.
//
// The PA-29 predicates are IMPORTED from plugin-build, never restated — the
// externals list has exactly one home (`@vibefield/contracts`), the build stage
// owns the mapping rules, and this row is a second caller of the same functions.
//
// What this row can and cannot see, stated rather than blurred: an artifact's
// EMITTED specifiers are recoverable from the bytes on disk, so §11.6's
// unmappable-import refusal runs here in full. Duplicate-singleton detection is
// not — it reads the BUNDLER's module list, which exists only while the bundle
// is being produced, so `plugin-build` refuses that one at build time and this
// row says so instead of guessing from output text.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginManifestV1 } from "@vibefield/contracts";
import { findUnmappableSpecifiers } from "@vibefield/plugin-build/build";
import { note, pass, refuse, type Verdict } from "./verdict";
import { importSpecifiersOnLine } from "./wall";

/** The bare specifiers a built ESM artifact asks the host for. */
export function emittedSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const line of source.split(/\r?\n/))
    for (const spec of importSpecifiersOnLine(line)) out.add(spec);
  return [...out].sort();
}

interface DeclaredEntry {
  readonly kind: "renderer" | "service";
  readonly rel: string;
}

function declaredEntries(manifest: PluginManifestV1): DeclaredEntry[] {
  const out: DeclaredEntry[] = [];
  const renderer = manifest.entries?.renderer;
  const service = manifest.entries?.service;
  if (renderer !== undefined) out.push({ kind: "renderer", rel: renderer });
  if (service !== undefined) out.push({ kind: "service", rel: service });
  return out;
}

export function checkArtifacts(root: string, manifest: PluginManifestV1): Verdict[] {
  const declared = declaredEntries(manifest);
  if (declared.length === 0) return [pass("artifact", "no entry modules declared")];

  const present = declared.filter((entry) => existsSync(resolve(root, entry.rel)));
  if (present.length === 0)
    return [
      note(
        "artifact",
        "artifact-absent",
        `no built entries on disk (${declared.map((entry) => entry.rel).join(", ")}) — run plugin-build to produce them`,
      ),
    ];

  const verdicts: Verdict[] = [];
  // A PARTIALLY built plugin is a refusal, not a note: one entry present proves
  // a build ran, so a missing sibling is a real defect rather than "no build yet".
  for (const { kind, rel } of declared) {
    if (existsSync(resolve(root, rel))) continue;
    verdicts.push(
      refuse("artifact", "artifact-missing", `entries.${kind} names ${rel}, which is not on disk`, {
        pointer: `/entries/${kind}`,
      }),
    );
  }

  for (const { kind, rel } of present) {
    const source = readFileSync(resolve(root, rel), "utf8");
    const unmappable = findUnmappableSpecifiers(emittedSpecifiers(source));
    for (const spec of unmappable)
      verdicts.push(
        refuse(
          "artifact",
          "artifact-unmappable-specifier",
          `${rel} imports ${spec}, which the host import map cannot bind (§11.6)`,
          { pointer: rel },
        ),
      );
    if (unmappable.length === 0)
      verdicts.push(pass("artifact", `${kind} artifact ${rel} imports only mappable specifiers`));
  }

  verdicts.push(
    note(
      "artifact",
      "artifact-singleton-build-time",
      "duplicate-singleton detection reads the bundler's module list, so plugin-build refuses that at build time",
    ),
  );
  return verdicts;
}
