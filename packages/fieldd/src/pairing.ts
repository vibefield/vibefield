import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** D8 — the canonical MAC recipe, byte-identical to field-native's Rust
 * implementation. Pinned by contracts/fixtures/pairing.vector.json on BOTH sides:
 *   mac = hex(HMAC-SHA256(secret, "fn-boot" 0x00 bootId 0x00 decimal(ts)))
 */
export function computePairingMac(secretHex: string, bootId: string, ts: number): string {
  const message = `fn-boot\0${bootId}\0${String(ts)}`;
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(message, "utf8").digest("hex");
}

/** WIN-10 — the SERVER's half of the handshake, byte-identical to field-native's
 * `pairing::compute_ack_mac`. Pinned by the same cross-language vector:
 *   serverMac = hex(HMAC-SHA256(secret, "fn-ack" 0x00 nonce 0x00 bootId))
 * A distinct context string from `fn-boot` keeps the two directions' transcripts
 * from ever being replayable as one another. */
export function computeAckMac(secretHex: string, nonce: string, bootId: string): string {
  const message = `fn-ack\0${nonce}\0${bootId}`;
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(message, "utf8").digest("hex");
}

/** A fresh challenge for one connection. 32 hex chars = 16 bytes from the CSPRNG
 * — far past any birthday concern for a value that lives one handshake. */
export function newPairingNonce(): string {
  return randomBytes(16).toString("hex");
}

/** Constant-time compare for the server's answer. `timingSafeEqual` throws on a
 * length mismatch, so the lengths are checked first and a wrong-length answer is
 * simply not equal — never an exception on a hostile input. */
export function ackMacMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
