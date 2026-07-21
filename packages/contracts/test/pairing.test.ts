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

describe("D8 pairing MAC (golden vector)", () => {
  it("matches the cross-language vector", () => {
    expect(computePairingMac(VECTOR.secretHex, VECTOR.bootId, VECTOR.ts)).toBe(VECTOR.mac);
  });
  it("changes with every input (sanity)", () => {
    expect(computePairingMac(VECTOR.secretHex, VECTOR.bootId, VECTOR.ts + 1)).not.toBe(VECTOR.mac);
    expect(computePairingMac(VECTOR.secretHex, "other-boot", VECTOR.ts)).not.toBe(VECTOR.mac);
  });
});
