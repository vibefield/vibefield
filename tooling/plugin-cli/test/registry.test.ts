// The registry commands, against the on-disk fixture registry the install path
// itself is tested with (`buildFixtureRegistry`). No network, no stubs: a real
// signed index, a real detached signature, real `.vfplugin` bytes.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PluginManifestV1 } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_URL_PLACEHOLDER,
  lookupRelease,
  resolveIndexLocation,
  signIndex,
  submitPlugin,
  verifyArtifactAgainst,
} from "../src/registry-commands";
import { baseManifest, freshDir, makePlugin, refusalCodes, rendererModule } from "./fixtures";

async function fixtureRegistry(): Promise<{
  dir: string;
  indexPath: string;
  publicKey: string;
  secretKey: string;
  artifactPath: string;
  pluginRoot: string;
}> {
  const pluginRoot = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
  const { bytes } = await packVfplugin({ rootDir: pluginRoot });
  const keys = generateRegistryKeypair();
  const dir = freshDir("vf-registry-");
  const built = buildFixtureRegistry({
    dir,
    plugins: [{ manifestDir: pluginRoot, artifactBytes: bytes }],
    secretKey: keys.secretKey,
  });
  return {
    dir,
    indexPath: built.indexPath,
    publicKey: keys.publicKey,
    secretKey: keys.secretKey,
    artifactPath: join(dir, "artifacts", `${baseManifest()["id"] as string}@0.1.0.vfplugin`),
    pluginRoot,
  };
}

describe("release lookup", () => {
  it("verifies the signature, then prints the row", async () => {
    const fixture = await fixtureRegistry();
    const result = lookupRelease({
      location: fixture.indexPath,
      publicKey: fixture.publicKey,
      id: baseManifest()["id"] as string,
    });
    expect(refusalCodes(result.verdicts)).toEqual([]);
    expect(result.entry?.latest.version).toBe("0.1.0");
    expect(result.entry?.latest.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses a tampered index (the control run), and accepts the untampered one", async () => {
    const fixture = await fixtureRegistry();
    const original = readFileSync(fixture.indexPath);

    // RED: one byte of the signed content changes — the signature is over the
    // bytes, so any edit at all breaks it.
    const tampered = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
    (tampered["plugins"] as Record<string, { latest: { sha256: string } }>)[
      baseManifest()["id"] as string
    ]!.latest.sha256 = `sha256:${"0".repeat(64)}`;
    writeFileSync(fixture.indexPath, `${JSON.stringify(tampered, null, 2)}\n`);

    const refused = lookupRelease({
      location: fixture.indexPath,
      publicKey: fixture.publicKey,
      id: baseManifest()["id"] as string,
    });
    expect(refusalCodes(refused.verdicts)).toEqual(["signature-invalid"]);
    expect(refused.entry).toBeUndefined();

    // GREEN: restore the signed bytes.
    writeFileSync(fixture.indexPath, original);
    expect(
      refusalCodes(
        lookupRelease({
          location: fixture.indexPath,
          publicKey: fixture.publicKey,
          id: baseManifest()["id"] as string,
        }).verdicts,
      ),
    ).toEqual([]);
  });

  it("refuses a signature made by a different key", async () => {
    const fixture = await fixtureRegistry();
    const other = generateRegistryKeypair();
    const result = lookupRelease({
      location: fixture.indexPath,
      publicKey: other.publicKey,
      id: baseManifest()["id"] as string,
    });
    expect(refusalCodes(result.verdicts)).toEqual(["signature-invalid"]);
  });

  it("refuses a missing signature rather than reading the index anyway", async () => {
    const fixture = await fixtureRegistry();
    writeFileSync(`${fixture.indexPath}.sig`, "");
    const result = lookupRelease({
      location: fixture.indexPath,
      publicKey: fixture.publicKey,
      id: baseManifest()["id"] as string,
    });
    expect(refusalCodes(result.verdicts)).toEqual(["signature-invalid"]);
  });

  it("refuses an id the index does not carry, and lists what it does", async () => {
    const fixture = await fixtureRegistry();
    const result = lookupRelease({
      location: fixture.indexPath,
      publicKey: fixture.publicKey,
      id: "com.example.absent",
    });
    expect(refusalCodes(result.verdicts)).toEqual(["release-not-found"]);
    expect(result.verdicts[0]?.expected).toContain(baseManifest()["id"] as string);
  });

  it("reads a file:// url and refuses a network one", () => {
    expect(resolveIndexLocation("file:///tmp/index.json")).toEqual({
      ok: true,
      path: "/tmp/index.json",
    });
    const refused = resolveIndexLocation("https://example.test/index.json");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("no network fetches");
  });
});

describe("index sign", () => {
  it("signs the bytes on disk, and the signature verifies", async () => {
    const fixture = await fixtureRegistry();
    const keys = generateRegistryKeypair();
    const keyPath = join(freshDir("vf-key-"), "secret.key");
    writeFileSync(keyPath, keys.secretKey);

    const signed = signIndex({ indexPath: fixture.indexPath, keyPath });
    expect(refusalCodes(signed.verdicts)).toEqual([]);
    expect(signed.signaturePath).toBe(`${fixture.indexPath}.sig`);

    expect(
      refusalCodes(
        lookupRelease({
          location: fixture.indexPath,
          publicKey: keys.publicKey,
          id: baseManifest()["id"] as string,
        }).verdicts,
      ),
    ).toEqual([]);
  });

  it("refuses a key file that is not a key", async () => {
    const fixture = await fixtureRegistry();
    const keyPath = join(freshDir("vf-key-"), "secret.key");
    writeFileSync(keyPath, "not-a-key");
    expect(refusalCodes(signIndex({ indexPath: fixture.indexPath, keyPath }).verdicts)).toEqual([
      "key-unreadable",
    ]);
  });
});

describe("submit", () => {
  it("emits the exact §5.3.1 row, with the artifact url flagged as a placeholder", async () => {
    const fixture = await fixtureRegistry();
    const manifest = PluginManifestV1.parse(
      JSON.parse(readFileSync(join(fixture.pluginRoot, "vibefield.plugin.json"), "utf8")),
    );
    const result = submitPlugin({
      manifest,
      artifactPath: fixture.artifactPath,
      now: 1_700_000_000_000,
    });

    expect(refusalCodes(result.verdicts)).toEqual([]);
    expect(result.indexRow?.latest).toEqual({
      version: "0.1.0",
      artifactUrl: ARTIFACT_URL_PLACEHOLDER,
      sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      minApp: "^0.1.0",
      minContracts: "^0.1.0",
      publishedAt: 1_700_000_000_000,
    });
    // The row is honest about the two steps a human owns.
    expect(result.verdicts.filter((v) => v.level === "note")).toHaveLength(2);
  });

  it("pins the same sha256 the index does, and catches a mismatch", async () => {
    const fixture = await fixtureRegistry();
    const manifest = PluginManifestV1.parse(
      JSON.parse(readFileSync(join(fixture.pluginRoot, "vibefield.plugin.json"), "utf8")),
    );
    const row = submitPlugin({ manifest, artifactPath: fixture.artifactPath });
    const lookup = lookupRelease({
      location: fixture.indexPath,
      publicKey: fixture.publicKey,
      id: manifest.id,
    });
    expect(row.indexRow?.latest.sha256).toBe(lookup.entry?.latest.sha256);

    expect(refusalCodes(verifyArtifactAgainst(lookup.entry!.latest, fixture.artifactPath))).toEqual(
      [],
    );
    const wrong = join(freshDir("vf-artifact-"), "other.vfplugin");
    writeFileSync(wrong, "not the artifact");
    expect(refusalCodes(verifyArtifactAgainst(lookup.entry!.latest, wrong))).toEqual([
      "artifact-hash-mismatch",
    ]);
  });

  it("refuses when there is no artifact to pin", async () => {
    const fixture = await fixtureRegistry();
    const manifest = PluginManifestV1.parse(
      JSON.parse(readFileSync(join(fixture.pluginRoot, "vibefield.plugin.json"), "utf8")),
    );
    expect(
      refusalCodes(submitPlugin({ manifest, artifactPath: "/nowhere/x.vfplugin" }).verdicts),
    ).toEqual(["pack-refused"]);
  });
});
