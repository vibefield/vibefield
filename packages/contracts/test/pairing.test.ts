import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// D8 — the pairing MAC recipe must be byte-identical in fieldd (TS) and
// field-native (Rust). This vector is the cross-language pin.
const VECTOR = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pairing.vector.json"),
    "utf8",
  ),
);

export function computePairingMac(secretHex: string, bootId: string, ts: number): string {
  const message = `fn-boot\0${bootId}\0${String(ts)}`;
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(message, "utf8").digest("hex");
}

/** WIN-10 — the SERVER's half, mirroring field-native's `compute_ack_mac`. */
export function computeAckMac(secretHex: string, nonce: string, bootId: string): string {
  const message = `fn-ack\0${nonce}\0${bootId}`;
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(message, "utf8").digest("hex");
}

describe("D8 pairing MAC (golden vector)", () => {
  it("matches the cross-language vector", () => {
    expect(computePairingMac(VECTOR.secretHex, VECTOR.bootId, VECTOR.ts)).toBe(VECTOR.mac);
  });
  it("changes with every input (sanity)", () => {
    expect(computePairingMac(VECTOR.secretHex, VECTOR.bootId, VECTOR.ts + 1)).not.toBe(VECTOR.mac);
    expect(computePairingMac(VECTOR.secretHex, "other-boot", VECTOR.ts)).not.toBe(VECTOR.mac);
  });
});

describe("WIN-10 server proof (golden vector)", () => {
  it("matches the cross-language vector", () => {
    expect(computeAckMac(VECTOR.secretHex, VECTOR.nonce, VECTOR.bootId)).toBe(VECTOR.ackMac);
  });

  it("is bound to the nonce, so a captured proof cannot answer a fresh challenge", () => {
    expect(computeAckMac(VECTOR.secretHex, "another-nonce", VECTOR.bootId)).not.toBe(VECTOR.ackMac);
  });

  it("never collides with the client's MAC — separate contexts, separate transcripts", () => {
    // Both directions sign with the SAME secret. Were the context strings equal,
    // a client MAC observed on the wire would be a valid server proof (and the
    // reverse), which is the classic reflection this separation exists to stop.
    expect(computeAckMac(VECTOR.secretHex, VECTOR.nonce, VECTOR.bootId)).not.toBe(VECTOR.mac);
    expect(computeAckMac(VECTOR.secretHex, String(VECTOR.ts), VECTOR.bootId)).not.toBe(VECTOR.mac);
  });
});
