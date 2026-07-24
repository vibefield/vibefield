import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryIndex } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { buildFixtureRegistry } from "../src/fixture-registry";
import {
  generateRegistryKeypair,
  signRegistryIndex,
  verifyRegistryIndex,
} from "../src/registry-sign";

// noUncheckedIndexedAccess: a record lookup is `T | undefined` — narrow it once
// so the intent of a fixture that MUST contain the entry reads as an assertion.
function pluginEntry(index: RegistryIndex, id: string) {
  const entry = index.plugins[id];
  if (!entry) throw new Error(`fixture index is missing plugin ${id}`);
  return entry;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "registry-sign-test-"));
}

// A manifest (in its own temp dir) with just the fields the fixture builder
// reads (id/version/engines); returns the dir to hand to buildFixtureRegistry.
function writeManifest(facts: {
  id: string;
  version: string;
  app?: string;
  contracts?: string;
  repository?: string;
}): string {
  const manifestDir = mkdtempSync(join(tmpdir(), "manifest-"));
  const manifest: Record<string, unknown> = {
    manifestVersion: 1,
    id: facts.id,
    version: facts.version,
    engines: { app: facts.app ?? "^0.1.0", contracts: facts.contracts ?? "^0.1.0" },
  };
  if (facts.repository) manifest.repository = facts.repository;
  writeFileSync(join(manifestDir, "vibefield.plugin.json"), JSON.stringify(manifest));
  return manifestDir;
}

describe("signRegistryIndex / verifyRegistryIndex", () => {
  it("round-trips: a signature made with the secret key verifies with the public key", () => {
    const { publicKey, secretKey } = generateRegistryKeypair();
    const indexBytes = Buffer.from('{"schemaVersion":1}\n', "utf8");

    const signature = signRegistryIndex(indexBytes, secretKey);
    expect(verifyRegistryIndex(indexBytes, signature, publicKey)).toBe(true);
  });

  it("returns false when a single byte of the signed index is tampered", () => {
    const { publicKey, secretKey } = generateRegistryKeypair();
    const indexBytes = Buffer.from("the exact bytes are the unit of trust", "utf8");
    const signature = signRegistryIndex(indexBytes, secretKey);

    const tampered = Buffer.from(indexBytes);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0x01, 0); // flip one bit of one byte
    expect(verifyRegistryIndex(tampered, signature, publicKey)).toBe(false);
  });

  it("returns false when verified against a different (wrong) public key", () => {
    const signer = generateRegistryKeypair();
    const other = generateRegistryKeypair();
    const indexBytes = Buffer.from("signed by signer, checked against other", "utf8");
    const signature = signRegistryIndex(indexBytes, signer.secretKey);

    expect(verifyRegistryIndex(indexBytes, signature, other.publicKey)).toBe(false);
    expect(verifyRegistryIndex(indexBytes, signature, signer.publicKey)).toBe(true);
  });

  it("never throws on malformed inputs — bad base64, wrong-length sig, empty strings all return false", () => {
    const { publicKey, secretKey } = generateRegistryKeypair();
    const indexBytes = Buffer.from("payload", "utf8");
    const goodSig = signRegistryIndex(indexBytes, secretKey);

    // malformed / non-key public keys
    expect(verifyRegistryIndex(indexBytes, goodSig, "")).toBe(false);
    expect(verifyRegistryIndex(indexBytes, goodSig, "not-base64-!!!")).toBe(false);
    expect(verifyRegistryIndex(indexBytes, goodSig, secretKey)).toBe(false); // secret where public belongs

    // malformed / wrong-length signatures against a valid key
    expect(verifyRegistryIndex(indexBytes, "", publicKey)).toBe(false);
    expect(verifyRegistryIndex(indexBytes, "not-base64-!!!", publicKey)).toBe(false);
    expect(
      verifyRegistryIndex(indexBytes, Buffer.from("short").toString("base64"), publicKey),
    ).toBe(false);
  });

  it("throws on a malformed secret key (signing is an author action that fails loudly)", () => {
    const indexBytes = Buffer.from("payload", "utf8");
    expect(() => signRegistryIndex(indexBytes, "not-a-real-key")).toThrow();
  });
});

describe("buildFixtureRegistry", () => {
  it("writes a signature-verifiable index whose sha256 pins match the artifact bytes", () => {
    const { publicKey, secretKey } = generateRegistryKeypair();
    const dir = tempDir();
    const artifactBytes = Buffer.from("deterministic .vfplugin zip bytes", "utf8");
    const manifestDir = writeManifest({ id: "com.example.notes", version: "0.1.0" });

    const { indexPath, signaturePath, index } = buildFixtureRegistry({
      dir,
      secretKey,
      plugins: [{ manifestDir, artifactBytes }],
    });

    // The signature covers the exact bytes on disk — verify bytes, not a re-serialization.
    const indexBytes = readFileSync(indexPath);
    const signature = readFileSync(signaturePath, "utf8");
    expect(verifyRegistryIndex(indexBytes, signature, publicKey)).toBe(true);

    // Walk the index the way fieldd's install path will: pin → artifact → recompute → compare.
    const onDisk = JSON.parse(indexBytes.toString("utf8")) as RegistryIndex;
    const release = pluginEntry(onDisk, "com.example.notes").latest;
    expect(release.minApp).toBe("^0.1.0");
    expect(release.minContracts).toBe("^0.1.0");

    const artifactPath = join(dir, release.artifactUrl);
    const fetched = readFileSync(artifactPath);
    const recomputed = `sha256:${createHash("sha256").update(fetched).digest("hex")}`;
    expect(recomputed).toBe(release.sha256);
    // returned index agrees with what was written
    expect(pluginEntry(index, "com.example.notes").latest.sha256).toBe(release.sha256);
  });

  it("makes a tampered artifact detectable by hash mismatch, as fieldd will detect it", () => {
    const { secretKey } = generateRegistryKeypair();
    const dir = tempDir();
    const artifactBytes = Buffer.from("original artifact bytes", "utf8");
    const manifestDir = writeManifest({ id: "com.example.notes", version: "0.1.0" });

    const { indexPath } = buildFixtureRegistry({
      dir,
      secretKey,
      plugins: [{ manifestDir, artifactBytes }],
    });

    const onDisk = JSON.parse(readFileSync(indexPath, "utf8")) as RegistryIndex;
    const release = pluginEntry(onDisk, "com.example.notes").latest;
    const artifactPath = join(dir, release.artifactUrl);

    // Swap the artifact bytes on disk; the pin no longer matches → PLUGIN_ARTIFACT_MISMATCH.
    writeFileSync(artifactPath, Buffer.from("tampered artifact bytes", "utf8"));
    const fetched = readFileSync(artifactPath);
    const recomputed = `sha256:${createHash("sha256").update(fetched).digest("hex")}`;
    expect(recomputed).not.toBe(release.sha256);
  });

  it("promotes the first release of an id to latest and files the rest as newest-first history", () => {
    const { secretKey } = generateRegistryKeypair();
    const dir = tempDir();
    const newer = writeManifest({ id: "com.example.notes", version: "0.2.0" });
    const older = writeManifest({ id: "com.example.notes", version: "0.1.0" });

    const { index } = buildFixtureRegistry({
      dir,
      secretKey,
      plugins: [
        { manifestDir: newer, artifactBytes: Buffer.from("v0.2.0") },
        { manifestDir: older, artifactBytes: Buffer.from("v0.1.0") },
      ],
    });

    const entry = pluginEntry(index, "com.example.notes");
    expect(entry.latest.version).toBe("0.2.0");
    expect(entry.history.map((r) => r.version)).toEqual(["0.1.0"]);
  });
});
