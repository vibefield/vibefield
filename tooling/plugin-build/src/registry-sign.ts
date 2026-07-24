// Registry index signing (plugin-architecture spec §5.3.1 "Verification",
// verify-item §27.9). v1 ratifies a minisign-class, in-repo Ed25519 scheme:
// the app ships the registry maintainer's public verify key, and the index
// carries a DETACHED signature over its bytes. Install is: fetch index
// (signature-checked) → fetch artifact → sha256 MUST match the index pin.
// sigstore is a later upgrade (§27.9, James's call); nothing here forecloses
// it — the seam is "bytes + detached signature + shipped public key".
//
// The unit of trust is a BYTE. `signRegistryIndex` signs the exact bytes of
// index.json; `verifyRegistryIndex` verifies those same bytes. canonicalJson
// is used when the index file is GENERATED (fixture-registry.ts / the future
// publish path), never re-run at verify time — re-canonicalizing at verify
// would trust the verifier's serializer instead of the signed bytes, which
// is the whole failure mode a detached signature exists to close.
//
// node:crypto only — no external dependency. Ed25519 keys have no parameters
// to misconfigure and a fixed 64-byte signature, which is why they suit a
// "shipped key" scheme better than RSA (verify-item §27.9's minisign-class).

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

// The signed object — RegistryIndex — is a VibeField wire shape and lives in
// @vibefield/contracts (plugin-distribution.ts), not here: these primitives
// sign and verify BYTES, so they never need the object type. Keeping the shape
// out of this file is the contracts-first law working as intended — one home
// for the wire shape, and no chance of a tooling copy drifting from it.

/**
 * An Ed25519 keypair for the registry, both members base64-encoded DER.
 *
 * KEY ENCODING (documented, consistent across this module): the public key is
 * base64 of its SPKI DER; the secret key is base64 of its PKCS#8 DER. DER
 * round-trips through node:crypto's `createPublicKey`/`createPrivateKey` with
 * no manual ASN.1 or raw-scalar reconstruction — the reason to prefer it over
 * a raw 32/64-byte encoding when the only consumer is node:crypto itself.
 */
export interface RegistryKeypair {
  publicKey: string;
  secretKey: string;
}

/**
 * Generate a fresh registry signing keypair (base64 DER — see
 * {@link RegistryKeypair}). The secret key signs the index; the public key is
 * what the app ships to verify it.
 */
export function generateRegistryKeypair(): RegistryKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    secretKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

/**
 * Produce a detached base64 Ed25519 signature over the EXACT bytes of
 * index.json. `indexBytes` must be the same bytes written to disk — sign the
 * bytes, never a re-serialization of the parsed object.
 *
 * Throws on a malformed `secretKey`: signing is a publish-time author action,
 * and a bad signing key is a build failure to surface loudly, not swallow.
 * (Verification, the untrusted-input side, is the one that never throws.)
 */
export function signRegistryIndex(indexBytes: Buffer, secretKey: string): string {
  const key = createPrivateKey({
    key: Buffer.from(secretKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  // Ed25519 takes no digest algorithm — it MUST be null (node:crypto contract).
  return sign(null, indexBytes, key).toString("base64");
}

/**
 * Verify a detached base64 signature against the EXACT bytes of index.json and
 * a base64 DER public key. NEVER throws: every malformed input — bad base64,
 * a non-Ed25519 or private key where a public one belongs, a wrong-length
 * signature — returns `false`. This is the tolerant-reader law applied to the
 * one surface that consumes bytes an adversary may have shaped: a malformed
 * signature is an untrusted signature, which is exactly "not verified".
 */
export function verifyRegistryIndex(
  indexBytes: Buffer,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(null, indexBytes, key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
