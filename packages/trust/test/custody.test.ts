import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTODY } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { deriveCustody, macMatches, newNonce, shellAckMac, shellPairingMac } from "../src/index";

// OB custody (C6) — the one home of custody's recipes: how the shell derives a user root's secrets from its root, and
// the MAC a shell pairs with under `sealed` (and the daemon's answer). The MAC's recipe is pinned twice: by a second
// spelling of it here, and by contracts' cross-language vector, which the verifier's test reads too.

const FIXTURES = join(import.meta.dirname, "..", "..", "contracts", "fixtures");
const UNCOMPUTED = "TO-BE-COMPUTED";

interface VectorCase {
  secretHex: string;
  port: number;
  bootId: string;
  userId: string;
  nonce: string;
  ts: number;
  mac: string;
  ackMac: string;
}
const raw = readFileSync(join(FIXTURES, "shell-pairing.vector.json"), "utf8");
const vector = JSON.parse(raw) as { cases: VectorCase[] };
const pairingOf = (c: VectorCase) => ({
  secret: c.secretHex,
  port: c.port,
  bootId: c.bootId,
  userId: c.userId,
  nonce: c.nonce,
  ts: c.ts,
});
const ackOf = (c: VectorCase) => ({
  secret: c.secretHex,
  nonce: c.nonce,
  bootId: c.bootId,
  port: c.port,
});

describe("deriveCustody — a user root's secrets from the shell's root", () => {
  const root = Buffer.alloc(32, 0xa3);
  const userRoot = "/Users/me/Library/Application Support/VibeField/users/1";

  it("is HKDF-SHA256 with no salt over the label, a NUL and the context: 32 bytes, as hex", () => {
    const derived = deriveCustody(root, CUSTODY.LABELS.shell, userRoot);
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    const info = Buffer.from([CUSTODY.LABELS.shell, userRoot].join("\0"), "utf8");
    const again = Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), info, 32)).toString("hex");
    expect(derived).toBe(again);
    expect(deriveCustody(root, CUSTODY.LABELS.shell, userRoot)).toBe(derived);
  });

  it("gives each label its own secret, and each user root its own three", () => {
    const labels = Object.values(CUSTODY.LABELS);
    const mine = labels.map((label) => deriveCustody(root, label, userRoot));
    const theirs = labels.map((label) => deriveCustody(root, label, `${userRoot}0`));
    expect(new Set([...mine, ...theirs]).size).toBe(6);
    const otherRoot = Buffer.alloc(32, 0xb4);
    expect(deriveCustody(otherRoot, CUSTODY.LABELS.shell, userRoot)).not.toBe(mine[0]);
  });

  it("refuses a root that is not 32 bytes, an empty label or context, and a label that carries a NUL", () => {
    expect(() => deriveCustody(Buffer.alloc(31, 1), CUSTODY.LABELS.shell, userRoot)).toThrow();
    expect(() => deriveCustody(Buffer.alloc(33, 1), CUSTODY.LABELS.shell, userRoot)).toThrow();
    expect(() => deriveCustody(root, "", userRoot)).toThrow();
    expect(() => deriveCustody(root, CUSTODY.LABELS.shell, "")).toThrow();
    // `label 0x00 context` reads one way only while no label holds the separator
    expect(() => deriveCustody(root, ["vf/custody", "v1"].join("\0"), userRoot)).toThrow();
  });
});

describe("the shell's pairing MAC and the daemon's answer", () => {
  const one = vector.cases[0] as VectorCase;

  it("is HMAC-SHA256 over NUL-separated decimal text, the context first", () => {
    const key = Buffer.from(one.secretHex, "hex");
    const hmac = (text: string) => createHmac("sha256", key).update(text, "utf8").digest("hex");
    const hello = [CUSTODY.SHELL_CONTEXT, one.port, one.bootId, one.userId, one.nonce, one.ts];
    expect(shellPairingMac(pairingOf(one))).toBe(hmac(hello.join("\0")));
    const ack = [CUSTODY.SHELL_ACK_CONTEXT, one.nonce, one.bootId, one.port];
    expect(shellAckMac(ackOf(one))).toBe(hmac(ack.join("\0")));
  });

  it("matches the cross-language vector, a daemon with a user and one with none", () => {
    expect(vector.cases.map((c) => c.userId === "")).toEqual([false, true]);
    for (const [index, c] of vector.cases.entries()) {
      const mac = shellPairingMac(pairingOf(c));
      const ackMac = shellAckMac(ackOf(c));
      if (c.mac === UNCOMPUTED || c.ackMac === UNCOMPUTED) {
        expect.fail(
          `the vector's outputs are computed by the first admitted row: case ${index} is mac ${mac}, ackMac ${ackMac}`,
        );
      }
      expect(mac, `case ${index}`).toBe(c.mac);
      expect(ackMac, `case ${index}`).toBe(c.ackMac);
    }
  });

  it("changes with every input, so a hello for another port, boot, user, nonce or time is another MAC", () => {
    const base = pairingOf(one);
    const mac = shellPairingMac(base);
    const others = [
      { ...base, port: base.port + 1 },
      { ...base, bootId: `${base.bootId}0` },
      { ...base, userId: "" },
      { ...base, nonce: "0".repeat(32) },
      { ...base, ts: base.ts + 1 },
      { ...base, secret: "b4".repeat(32) },
    ];
    for (const other of others) expect(shellPairingMac(other)).not.toBe(mac);
    const ack = ackOf(one);
    const ackMac = shellAckMac(ack);
    expect(shellAckMac({ ...ack, port: ack.port + 1 })).not.toBe(ackMac);
    expect(shellAckMac({ ...ack, bootId: `${ack.bootId}0` })).not.toBe(ackMac);
    expect(shellAckMac({ ...ack, nonce: "0".repeat(32) })).not.toBe(ackMac);
  });

  it("never lets one direction's MAC stand for the other's", () => {
    // both sign with one secret: were the contexts equal, a hello read off the wire would answer a challenge
    for (const c of vector.cases) {
      expect(shellAckMac(ackOf(c))).not.toBe(shellPairingMac(pairingOf(c)));
    }
    expect(CUSTODY.SHELL_CONTEXT).not.toBe(CUSTODY.SHELL_ACK_CONTEXT);
  });

  it("refuses a secret that is not 32 bytes of hex, rather than MAC under a key it did not mean", () => {
    // Buffer.from("zz", "hex") is the EMPTY key, and a MAC under it would look like any other
    for (const secret of ["", "zz".repeat(32), "a3".repeat(31), "A3".repeat(32)]) {
      expect(() => shellPairingMac({ ...pairingOf(one), secret })).toThrow(TypeError);
      expect(() => shellAckMac({ ...ackOf(one), secret })).toThrow(TypeError);
    }
    // and its refusal never says the secret back
    const told = "c5".repeat(31);
    let message = "";
    try {
      shellPairingMac({ ...pairingOf(one), secret: told });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(told);
  });
});

describe("newNonce and macMatches", () => {
  it("makes a fresh nonce of the registry's length each time", () => {
    const a = newNonce();
    expect(a).toMatch(new RegExp(`^[0-9a-f]{${CUSTODY.NONCE_HEX}}$`));
    expect(newNonce()).not.toBe(a);
  });

  it("matches a MAC with itself and with nothing else, and never throws", () => {
    const one = vector.cases[0] as VectorCase;
    const mac = shellPairingMac(pairingOf(one));
    expect(macMatches(mac, mac)).toBe(true);
    expect(macMatches(mac, shellAckMac(ackOf(one)))).toBe(false);
    const garbage = [mac.slice(2), `${mac}00`, mac.toUpperCase(), UNCOMPUTED, "", undefined, null];
    for (const other of garbage) {
      expect(macMatches(mac, other), String(other)).toBe(false);
      expect(macMatches(other, mac), String(other)).toBe(false);
    }
    expect(macMatches(undefined, undefined)).toBe(false);
  });
});
