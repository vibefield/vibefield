import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computePairingMac } from "../src/pairing";

// The SAME golden vector pins three independent implementations: this one
// (fieldd runtime), the contracts-side test, and field-native's Rust.
const VECTOR = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../contracts/fixtures/pairing.vector.json"),
    "utf8",
  ),
);

describe("fieldd pairing implementation", () => {
  it("matches the cross-language D8 vector", () => {
    expect(computePairingMac(VECTOR.secretHex, VECTOR.bootId, VECTOR.ts)).toBe(VECTOR.mac);
  });
});
