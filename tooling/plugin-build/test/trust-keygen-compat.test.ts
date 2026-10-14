import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical";
import {
  generateRegistryKeypair,
  signRegistryIndex,
  verifyRegistryIndex,
} from "../src/registry-sign";

// TD-0 — `scripts/trust-keygen.mjs` is builtins-only so James runs it with no build, which makes it a
// second implementation of the kit's key encoding, canonical form and signature. This file holds the
// two together: a key, a document's bytes or a signature made by one is read the same by the other.
// The trust-root fixture is the document under test (public keys only; no secret exists for it).

interface KeygenModule {
  canonicalJson(value: unknown): string;
  generateKeypair(): { publicKey: string; secretKey: string };
  isEd25519Spki(value: string): boolean;
  publicKeyOf(secret: string): string;
  signBytes(bytes: Buffer, secret: string): string;
  verifyBytes(bytes: Buffer, signature: string, publicKey: string): boolean;
  trustRootProblems(doc: unknown): string[];
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let keygen: KeygenModule;
beforeAll(async () => {
  keygen = (await import(
    pathToFileURL(join(REPO, "scripts", "trust-keygen.mjs")).href
  )) as KeygenModule;
});

const fixtureText = (): string =>
  readFileSync(join(REPO, "packages", "contracts", "fixtures", "trust-root.valid.json"), "utf8");

describe("trust-keygen speaks the kit's encoding (TD-0)", () => {
  it("writes the kit's canonical JSON, byte for byte", () => {
    const doc = JSON.parse(fixtureText());
    expect(keygen.canonicalJson(doc)).toBe(canonicalJson(doc));
    expect(keygen.canonicalJson(doc)).toBe(fixtureText());
    expect(keygen.trustRootProblems(doc)).toEqual([]);
  });

  it("a kit keypair is a keygen keypair, and the reverse", () => {
    const kit = generateRegistryKeypair();
    expect(keygen.isEd25519Spki(kit.publicKey)).toBe(true);
    expect(keygen.publicKeyOf(kit.secretKey)).toBe(kit.publicKey);
    const own = keygen.generateKeypair();
    expect(keygen.isEd25519Spki(own.publicKey)).toBe(true);
    expect(keygen.isEd25519Spki(own.secretKey)).toBe(false);
  });

  it("a keygen signature verifies with the kit, and a kit signature with keygen", () => {
    const bytes = Buffer.from(fixtureText());
    const own = keygen.generateKeypair();
    expect(verifyRegistryIndex(bytes, keygen.signBytes(bytes, own.secretKey), own.publicKey)).toBe(
      true,
    );
    const kit = generateRegistryKeypair();
    expect(keygen.verifyBytes(bytes, signRegistryIndex(bytes, kit.secretKey), kit.publicKey)).toBe(
      true,
    );
    expect(
      keygen.verifyBytes(
        Buffer.from(`${fixtureText()} `),
        signRegistryIndex(bytes, kit.secretKey),
        kit.publicKey,
      ),
    ).toBe(false);
  });
});
