// The manifest row. Two checks that fail differently and must not be conflated:
// the manifest VALIDATES (§7.1, one verdict per zod issue), and the committed
// artifact IS the canonical emission of itself (the same freshness law
// `gen:manifest` pins per plugin — a hand-edit is caught here, not at install).
//
// The contracts reader preserves stable semantic codes plus issue paths. We run
// the raw schema beside it only to enrich ordinary zod rows with `expected`;
// admission policy and its public codes always come from validatePluginManifest.

import {
  findUnknownManifestKeys,
  isDistributablePluginId,
  type PluginManifestV1 as PluginManifest,
  PluginManifestV1,
  validatePluginManifest,
} from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import type { z } from "zod";
import type { LoadedPlugin } from "./plugin-dir";
import { jsonPointer, note, pass, refuse, type Verdict } from "./verdict";

export interface ManifestRowResult {
  readonly verdicts: Verdict[];
  /** the parsed manifest, present only when validation passed */
  readonly manifest?: PluginManifest;
}

/** What would have passed, taken from the issue itself rather than restated.
 * zod knows the answer in every case a human would ask about; where it does not
 * (a superRefine `custom`), the message IS the expectation and repeating it as
 * `expected` would be noise, so the caller falls back to the catalog guidance. */
export function expectedFromIssue(issue: z.ZodIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      return `type ${issue.expected} (received ${issue.received})`;
    case "invalid_literal":
      return `the literal ${JSON.stringify(issue.expected)}`;
    case "invalid_enum_value":
      return `one of ${issue.options.map((o) => JSON.stringify(o)).join(", ")}`;
    case "invalid_union_discriminator":
      return `a discriminator among ${issue.options.map((o) => JSON.stringify(o)).join(", ")}`;
    case "unrecognized_keys":
      return `no unknown keys here (saw ${issue.keys.join(", ")})`;
    case "too_big":
      return `${issue.type} at most ${String(issue.maximum)}${issue.inclusive ? "" : " (exclusive)"}`;
    case "too_small":
      return `${issue.type} at least ${String(issue.minimum)}${issue.inclusive ? "" : " (exclusive)"}`;
    case "not_multiple_of":
      return `a multiple of ${String(issue.multipleOf)}`;
    case "invalid_string":
      return typeof issue.validation === "string"
        ? `a ${issue.validation} string`
        : "a string matching the declared pattern";
    default:
      return undefined;
  }
}

export function checkManifest(plugin: LoadedPlugin): ManifestRowResult {
  const verdicts: Verdict[] = [];
  const validation = validatePluginManifest(plugin.parsed);

  if (!validation.ok) {
    const parsed = PluginManifestV1.safeParse(plugin.parsed);
    const zodIssues = parsed.success ? [] : parsed.error.issues;
    validation.issueDetails.forEach((issue, index) => {
      const zodIssue = zodIssues[index];
      const expected =
        issue.code === "manifest-invalid" && zodIssue !== undefined
          ? expectedFromIssue(zodIssue)
          : undefined;
      verdicts.push(
        refuse("manifest", issue.code, issue.message, {
          pointer: jsonPointer(issue.path),
          ...(expected !== undefined ? { expected } : {}),
        }),
      );
    });
    return { verdicts };
  }

  const manifest = validation.manifest;
  verdicts.push(
    pass("manifest", `${manifest.id}@${manifest.version} validates as PluginManifestV1`),
  );

  // §7.1 tolerant reader: unknown keys are PRESERVED, never stripped — and said
  // out loud, because a typo'd contribution kind silently grants nothing.
  for (const key of findUnknownManifestKeys(plugin.parsed)) {
    verdicts.push(
      note("manifest", "manifest-unknown-key", `unknown key ${key} (preserved, ungranted)`, {
        pointer: jsonPointer(key.split(".")),
      }),
    );
  }

  // §6.1/§21.2 — a single-segment id is legal here and refused by distribution.
  // A note, not a refusal: the dev aliases in this repo are exactly this shape.
  if (!isDistributablePluginId(manifest.id)) {
    verdicts.push(
      note(
        "manifest",
        "manifest-dev-alias-id",
        `${manifest.id} is a single-segment dev alias — valid locally, refused by distribution`,
        { pointer: "/id", expected: "a dotted id such as vendor.plugin" },
      ),
    );
  }

  // The freshness law: the committed artifact must equal the canonical emission
  // of what it parses to. Defaults are part of that — `groups: []` written by
  // hand and `groups` omitted mean the same plugin, and only one of them is the
  // canonical bytes.
  const canonical = canonicalJson(manifest);
  if (canonical !== plugin.raw) {
    verdicts.push(
      refuse(
        "manifest",
        "manifest-stale",
        `vibefield.plugin.json differs from its canonical emission (${describeDrift(plugin.raw, canonical)})`,
        { pointer: plugin.manifestPath },
      ),
    );
  } else {
    verdicts.push(pass("manifest", "the committed manifest is its own canonical emission"));
  }

  return { verdicts, manifest };
}

/** The first differing line, so a stale-manifest verdict points somewhere. */
function describeDrift(committed: string, canonical: string): string {
  const a = committed.split("\n");
  const b = canonical.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i])
      return `first difference at line ${i + 1}: committed ${JSON.stringify(a[i] ?? "<eof>")}, canonical ${JSON.stringify(b[i] ?? "<eof>")}`;
  }
  return "same lines, different bytes";
}
