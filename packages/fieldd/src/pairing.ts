import { createHmac } from "node:crypto";

/** D8 — the canonical MAC recipe, byte-identical to field-native's Rust
 * implementation. Pinned by contracts/fixtures/pairing.vector.json on BOTH sides:
 *   mac = hex(HMAC-SHA256(secret, "fn-boot" 0x00 bootId 0x00 decimal(ts)))
 */
export function computePairingMac(secretHex: string, bootId: string, ts: number): string {
  const message = `fn-boot\0${bootId}\0${String(ts)}`;
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(message, "utf8").digest("hex");
}
