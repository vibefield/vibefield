// @vibefield/trust — the ONE Ed25519 check (TD-2: "own keys for what the app verifies"). Moved here from the kit's
// registry-sign.ts at WP12 (build-wp12-updater.md D2: wall R2 keeps every `@vibefield/plugin-*` out of Electron main,
// so the update verifier and the kit share this Node-only spine library instead). The unit of trust is a BYTE: verify
// the exact bytes that were signed, never a re-serialization of them.
//
// node:crypto only. Ed25519 keys have no parameters to misconfigure and a fixed 64-byte signature.

import { createPublicKey, verify } from "node:crypto";

/**
 * true when `signature` (base64) is an Ed25519 signature over `bytes` by `publicKey` (base64 SPKI DER).
 * NEVER throws: every malformed input — bad base64, a non-Ed25519 or private key where a public one belongs, a
 * wrong-length signature — returns `false`. A malformed signature is an untrusted signature, which is exactly
 * "not verified" (the tolerant-reader law on the one surface that consumes bytes an adversary may have shaped).
 */
export function verifyEd25519(bytes: Uint8Array, signature: string, publicKey: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(null, bytes, key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
