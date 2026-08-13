// The P7 registry commands, shipped REGISTRY-AGNOSTIC (P8-D6 retired the
// P7-only fence; the design block fixed the shape). The index repository is
// James's operational act and does not exist yet, so these commands do the parts
// that are real — compute the pin, verify a signature, sign an index — and say
// plainly which step is a human's, rather than pretending a marketplace is
// there.
//
// NO NETWORK, anywhere in this kit. `release lookup` reads a path or a file://
// URL; an http(s) index is refused with the reason, because a tool that
// silently fetched would make `check` and `submit` unsafe to run on a manifest
// you have not read.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type PluginManifestV1,
  RegistryIndex,
  type RegistryPluginEntry,
  type RegistryRelease,
} from "@vibefield/contracts";
import { signRegistryIndex, verifyRegistryIndex } from "@vibefield/plugin-build";
import { expectedFromIssue } from "./manifest-check";
import { jsonPointer, note, pass, refuse, type Verdict } from "./verdict";

export const SIGNATURE_SUFFIX = ".sig";

/** The placeholder an author replaces with their release asset's URL. Loud on
 * purpose: a row that shipped with this string in it is obviously unfinished,
 * where a plausible-looking URL would not be. */
export const ARTIFACT_URL_PLACEHOLDER = "REPLACE-ME://release-asset-url-of-the-vfplugin";

export function sha256Pin(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// --- submit -------------------------------------------------------------------

export interface SubmitResult {
  readonly verdicts: Verdict[];
  /** the §5.3.1 index row, exactly as the index carries it */
  readonly indexRow?: { id: string; repo?: string; latest: RegistryRelease };
}

/**
 * Emit the exact §5.3.1 index row for an artifact, and name the human step.
 * Builds nothing: the artifact is an input, because what gets pinned must be
 * the bytes that will be published, not a fresh build that might differ.
 */
export function submitPlugin(opts: {
  manifest: PluginManifestV1;
  artifactPath: string;
  /** injected in tests; the real clock otherwise */
  now?: number;
}): SubmitResult {
  if (!existsSync(opts.artifactPath))
    return {
      verdicts: [
        refuse("registry", "pack-refused", `no artifact at ${opts.artifactPath}`, {
          expected: "run `vibefield-plugin pack <pluginDir>` first, or pass --artifact <path>",
        }),
      ],
    };

  const bytes = readFileSync(opts.artifactPath);
  const repo = (opts.manifest as { repository?: unknown }).repository;
  const latest: RegistryRelease = {
    version: opts.manifest.version,
    artifactUrl: ARTIFACT_URL_PLACEHOLDER,
    sha256: sha256Pin(bytes),
    minApp: opts.manifest.engines.app,
    minContracts: opts.manifest.engines.contracts,
    publishedAt: opts.now ?? Date.now(),
  };

  const verdicts: Verdict[] = [
    pass("registry", `${opts.manifest.id}@${opts.manifest.version} pins ${latest.sha256}`),
    note(
      "registry",
      "submit-artifact-url-placeholder",
      "artifactUrl is a PLACEHOLDER — replace it with the release asset's url before opening the PR",
      { pointer: "/latest/artifactUrl", expected: `a url serving exactly ${latest.sha256}` },
    ),
    note(
      "registry",
      "submit-index-repo-absent",
      "the index repository does not exist yet: add this row to registry/index.json, sign it, and open the PR when it does",
      { expected: "vibefield-plugin index sign registry/index.json --key <secret key file>" },
    ),
  ];

  return {
    verdicts,
    indexRow: {
      id: opts.manifest.id,
      ...(typeof repo === "string" ? { repo } : {}),
      latest,
    },
  };
}

// --- index reading + verification ---------------------------------------------

export interface LoadedIndex {
  readonly bytes: Buffer;
  readonly index: RegistryIndex;
  readonly signaturePath: string;
}

export type IndexLoad = { ok: true; loaded: LoadedIndex } | { ok: false; verdicts: Verdict[] };

/** A path, or a file:// URL. http(s) is refused rather than fetched. */
export function resolveIndexLocation(
  location: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (location.startsWith("file://")) {
    try {
      return { ok: true, path: fileURLToPath(location) };
    } catch (error) {
      return {
        ok: false,
        reason: `not a usable file url: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location))
    return {
      ok: false,
      reason: `${location} is a network url, and this kit performs no network fetches — download the index first, then pass its path`,
    };
  return { ok: true, path: location };
}

/**
 * Read an index and verify its detached signature against the EXACT bytes on
 * disk. Never re-canonicalizes: re-serializing before verifying would trust the
 * verifier's serializer instead of the signed bytes, which is the whole failure
 * mode a detached signature exists to close.
 */
export function loadSignedIndex(location: string, publicKey: string): IndexLoad {
  const resolved = resolveIndexLocation(location);
  if (!resolved.ok)
    return { ok: false, verdicts: [refuse("registry", "index-unreadable", resolved.reason)] };

  if (!existsSync(resolved.path))
    return {
      ok: false,
      verdicts: [refuse("registry", "index-unreadable", `no index at ${resolved.path}`)],
    };
  const bytes = readFileSync(resolved.path);

  const signaturePath = `${resolved.path}${SIGNATURE_SUFFIX}`;
  if (!existsSync(signaturePath))
    return {
      ok: false,
      verdicts: [
        refuse("registry", "signature-missing", `no detached signature at ${signaturePath}`, {
          pointer: signaturePath,
        }),
      ],
    };
  const signature = readFileSync(signaturePath, "utf8").trim();

  if (!verifyRegistryIndex(bytes, signature, publicKey))
    return {
      ok: false,
      verdicts: [
        refuse(
          "registry",
          "signature-invalid",
          `${signaturePath} does not verify against ${resolved.path} for the given key`,
          { pointer: signaturePath },
        ),
      ],
    };

  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return {
      ok: false,
      verdicts: [
        refuse(
          "registry",
          "index-invalid",
          `index is not JSON: ${error instanceof Error ? error.message : String(error)}`,
          { pointer: resolved.path },
        ),
      ],
    };
  }
  const parsed = RegistryIndex.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      verdicts: parsed.error.issues.map((issue) => {
        const expected = expectedFromIssue(issue);
        return refuse("registry", "index-invalid", issue.message, {
          pointer: jsonPointer(issue.path),
          ...(expected !== undefined ? { expected } : {}),
        });
      }),
    };

  return { ok: true, loaded: { bytes, index: parsed.data, signaturePath } };
}

export interface LookupResult {
  readonly verdicts: Verdict[];
  readonly entry?: RegistryPluginEntry;
}

/** `release lookup <id>` — the signature is checked BEFORE the row is read, so
 * an unverified index never gets to tell you anything. */
export function lookupRelease(opts: {
  location: string;
  publicKey: string;
  id: string;
}): LookupResult {
  const load = loadSignedIndex(opts.location, opts.publicKey);
  if (!load.ok) return { verdicts: load.verdicts };

  const entry = load.loaded.index.plugins[opts.id];
  if (entry === undefined)
    return {
      verdicts: [
        refuse("registry", "release-not-found", `${opts.id} is not in this index`, {
          expected: `one of: ${Object.keys(load.loaded.index.plugins).sort().join(", ") || "<empty index>"}`,
        }),
      ],
    };

  return {
    verdicts: [
      pass("registry", `index signature verifies (${load.loaded.signaturePath})`),
      pass(
        "registry",
        `${entry.id} latest ${entry.latest.version} → ${entry.latest.artifactUrl} ${entry.latest.sha256}`,
      ),
    ],
    entry,
  };
}

/** Confirm an artifact on disk is the bytes an index row pins. */
export function verifyArtifactAgainst(release: RegistryRelease, artifactPath: string): Verdict[] {
  if (!existsSync(artifactPath))
    return [refuse("registry", "index-unreadable", `no artifact at ${artifactPath}`)];
  const pin = sha256Pin(readFileSync(artifactPath));
  if (pin !== release.sha256)
    return [
      refuse(
        "registry",
        "artifact-hash-mismatch",
        `${artifactPath} is ${pin}, index pins ${release.sha256}`,
        { pointer: artifactPath },
      ),
    ];
  return [pass("registry", `${artifactPath} matches the pinned ${release.sha256}`)];
}

// --- signing --------------------------------------------------------------------

export interface SignResult {
  readonly verdicts: Verdict[];
  readonly signaturePath?: string;
  readonly signature?: string;
}

/** `index sign` — the maintainer's half. Signs the bytes as they are on disk. */
export function signIndex(opts: { indexPath: string; keyPath: string }): SignResult {
  if (!existsSync(opts.indexPath))
    return { verdicts: [refuse("registry", "index-unreadable", `no index at ${opts.indexPath}`)] };
  if (!existsSync(opts.keyPath))
    return { verdicts: [refuse("registry", "key-unreadable", `no key file at ${opts.keyPath}`)] };

  const bytes = readFileSync(opts.indexPath);
  const secretKey = readFileSync(opts.keyPath, "utf8").trim();
  let signature: string;
  try {
    signature = signRegistryIndex(bytes, secretKey);
  } catch (error) {
    return {
      verdicts: [
        refuse(
          "registry",
          "key-unreadable",
          `${opts.keyPath} is not a base64 DER Ed25519 secret key: ${error instanceof Error ? error.message : String(error)}`,
          { pointer: opts.keyPath },
        ),
      ],
    };
  }

  const signaturePath = `${opts.indexPath}${SIGNATURE_SUFFIX}`;
  writeFileSync(signaturePath, signature);
  return {
    verdicts: [pass("registry", `signed ${opts.indexPath} → ${signaturePath}`)],
    signaturePath,
    signature,
  };
}
