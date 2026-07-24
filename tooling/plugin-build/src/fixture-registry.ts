// On-disk fixture registry builder (test util for plugin-architecture spec
// §5.3.1). Writes the exact layout fieldd's install path will consume over
// file:// in tests: `index.json` (canonicalJson-generated), its detached
// `index.json.sig`, and the `.vfplugin` artifact files whose sha256 the index
// pins. The point is a fixture that a real install path can walk end to end —
// signature-check the index, fetch an artifact by its relative url, and
// confirm the artifact's sha256 matches the pin — with zero network.
//
// Not shipped code: this is a test/authoring helper, kept beside the signing
// primitives it exercises so fixtures and the verifier can never drift.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RegistryIndex, RegistryPluginEntry, RegistryRelease } from "@vibefield/contracts";
import { canonicalJson } from "./canonical";
import { signRegistryIndex } from "./registry-sign";

/** One plugin to place in the fixture: where its manifest lives + its bytes. */
export interface FixturePlugin {
  /** dir holding a `vibefield.plugin.json` (id/version/engines are read from it) */
  manifestDir: string;
  /** the deterministic `.vfplugin` bytes this release pins by sha256 */
  artifactBytes: Buffer;
}

export interface BuildFixtureRegistryOptions {
  /** registry root; created if absent. `index.json` + `artifacts/` land here */
  dir: string;
  /**
   * Releases to include. Group multiple releases of one plugin by passing them
   * NEWEST-FIRST: the first entry for an id becomes `latest`, the rest become
   * its `history` (newest-first, latest not duplicated) — matching the index
   * shape without needing a semver comparator in a fixture helper.
   */
  plugins: FixturePlugin[];
  /** base64 DER secret key (from `generateRegistryKeypair`) that signs index.json */
  secretKey: string;
}

export interface BuildFixtureRegistryResult {
  indexPath: string;
  signaturePath: string;
  /** the in-memory index that was canonicalized, signed, and written */
  index: RegistryIndex;
}

/** Just the manifest fields the fixture needs; the rest rides through untouched. */
interface ManifestFacts {
  id: string;
  version: string;
  engines: { app: string; contracts: string };
  repository?: string;
}

function readManifestFacts(manifestDir: string): ManifestFacts {
  const path = join(manifestDir, "vibefield.plugin.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const engines = raw.engines as { app?: unknown; contracts?: unknown } | undefined;
  if (
    typeof raw.id !== "string" ||
    typeof raw.version !== "string" ||
    typeof engines?.app !== "string" ||
    typeof engines?.contracts !== "string"
  ) {
    throw new Error(`${path}: missing id/version/engines.{app,contracts} for a registry release`);
  }
  const facts: ManifestFacts = {
    id: raw.id,
    version: raw.version,
    engines: { app: engines.app, contracts: engines.contracts },
  };
  if (typeof raw.repository === "string") facts.repository = raw.repository;
  return facts;
}

function sha256Pin(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Build a complete, signature-verifiable fixture registry on disk and return
 * where it landed plus the index it wrote. The signature is computed over the
 * EXACT canonicalJson bytes written to index.json (sign bytes, verify bytes).
 * `index.json.sig` holds the raw detached base64 signature (no trailing
 * newline — the bytes are the unit of trust).
 */
export function buildFixtureRegistry(
  opts: BuildFixtureRegistryOptions,
): BuildFixtureRegistryResult {
  const artifactsDir = join(opts.dir, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });

  const now = Date.now();
  const entries = new Map<string, RegistryPluginEntry>();

  for (const { manifestDir, artifactBytes } of opts.plugins) {
    const facts = readManifestFacts(manifestDir);
    const artifactName = `${facts.id}@${facts.version}.vfplugin`;
    writeFileSync(join(artifactsDir, artifactName), artifactBytes);

    const release: RegistryRelease = {
      version: facts.version,
      // relative-to-index path — the fixture is consumed over file://
      artifactUrl: `artifacts/${artifactName}`,
      sha256: sha256Pin(artifactBytes),
      minApp: facts.engines.app,
      minContracts: facts.engines.contracts,
      publishedAt: now,
    };

    const existing = entries.get(facts.id);
    if (existing) {
      existing.history.push(release);
    } else {
      entries.set(facts.id, {
        id: facts.id,
        repo: facts.repository ?? `https://example.test/plugins/${facts.id}`,
        latest: release,
        history: [],
      });
    }
  }

  const index: RegistryIndex = {
    schemaVersion: 1,
    generatedAt: now,
    plugins: Object.fromEntries(entries),
  };

  const indexBytes = Buffer.from(canonicalJson(index), "utf8");
  const signature = signRegistryIndex(indexBytes, opts.secretKey);

  const indexPath = join(opts.dir, "index.json");
  const signaturePath = join(opts.dir, "index.json.sig");
  writeFileSync(indexPath, indexBytes);
  writeFileSync(signaturePath, signature);

  return { indexPath, signaturePath, index };
}
