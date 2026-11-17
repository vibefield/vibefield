// OB custody (C2) — the shell pairing's recipe as fieldd takes it, and the verifier the
// door asks (`src/shell-pairing.ts`).
//
// The recipe has ONE home, `@vibefield/trust` (the supervisor makes the MAC there, fieldd checks it there), so the
// maker and the verifier cannot spell the message two ways; a row here reads fieldd's source and holds it to that.
// The recipe is pinned across packages by `contracts/fixtures/shell-pairing.vector.json`: the vector row is the
// VERIFIER's reading of it (the door's own verifier is handed the vector's hello), and trust's suite holds the
// maker's. No builder may run code, so the vector's two outputs say TO-BE-COMPUTED and the vector row FAILS on that
// word, by the spec's own sentence, until the first admitted row computes them. Until then the second row is what
// holds the recipe from this side: it spelled a second time, apart, in the test harness.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CUSTODY } from "@vibefield/contracts";
import {
  newNonce,
  shellAckMac as trustAckMac,
  shellPairingMac as trustPairingMac,
} from "@vibefield/trust";
import { describe, expect, it } from "vitest";
import { ShellPairingVerifier } from "../src/shell-pairing";
import { freshNonce, type PairingFacts, shellAckMac, shellMac } from "./custody-harness";

interface VectorCase extends PairingFacts {
  secretHex: string;
  mac: string;
  ackMac: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const UNCOMPUTED = "TO-BE-COMPUTED";

/** What trust's two recipes are asked, from a case's facts. */
function asked(facts: PairingFacts & { secretHex: string }): {
  secret: string;
  port: number;
  bootId: string;
  userId: string;
  nonce: string;
  ts: number;
} {
  return {
    secret: facts.secretHex,
    port: facts.port,
    bootId: facts.bootId,
    userId: facts.userId,
    nonce: facts.nonce,
    ts: facts.ts,
  };
}

/** The vector's cases, in either shape it has had: one case at the file's top (slice K), or several under `cases`,
 * each over whatever the top states for all of them (K2 adds a daemon with no user). */
function vectorCases(): VectorCase[] {
  const file = JSON.parse(
    readFileSync(join(HERE, "../../contracts/fixtures/shell-pairing.vector.json"), "utf8"),
  ) as Record<string, unknown>;
  const { cases, ...top } = file;
  const found: Record<string, unknown>[] = [];
  if (typeof top["mac"] === "string" || typeof top["ackMac"] === "string") found.push(top);
  if (Array.isArray(cases))
    for (const entry of cases) found.push({ ...top, ...(entry as Record<string, unknown>) });
  return found as unknown as VectorCase[];
}

describe("fieldd's shell pairing recipe", () => {
  // : trust is the one home of the recipes. Red while `src/shell-pairing.ts` makes an HMAC of its
  // own: a second spelling is how a maker and a verifier come to disagree about one message.
  it("fieldd spells the recipe nowhere of its own: its verifier takes trust's", () => {
    const source = readFileSync(join(HERE, "../src/shell-pairing.ts"), "utf8");
    const found = [...source.matchAll(/ from "([^"]+)";$/gm)];
    const modules = found.map((line) => line[1]);
    expect(modules).toContain("@vibefield/trust");
    expect(modules).not.toContain("node:crypto");
    expect(source).not.toContain("createHmac");
    // and the three it takes, by name: the hello's MAC, the answer's, and the constant-time compare
    const taken = /^import \{([^}]+)\} from "@vibefield\/trust";$/m.exec(source)?.[1] ?? "";
    const names = taken.split(",").map((name) => name.trim());
    const named = names.filter((name) => name.length > 0);
    expect(named.sort()).toEqual(["macMatches", "shellAckMac", "shellPairingMac"]);
  });

  it("matches the cross-package vector", () => {
    const all = vectorCases();
    expect(all.length, "the vector holds a case").toBeGreaterThan(0);
    for (const c of all) {
      const mac = trustPairingMac(asked(c));
      const ackMac = trustAckMac(asked(c));
      if (c.mac === UNCOMPUTED || c.ackMac === UNCOMPUTED) {
        // the secret is the fixture's repeated byte, so what this side computes may be said: a run fills the
        // vector, which is then held to the maker's side saying the same
        throw new Error(
          `the vector's outputs are computed by the first admitted row (userId "${c.userId}": this side computes mac ${mac}, ackMac ${ackMac})`,
        );
      }
      expect(mac).toBe(c.mac);
      expect(ackMac).toBe(c.ackMac);
      // the verifier's reading: the door's own verifier, handed the vector's hello, pairs and answers its proof
      const door = new ShellPairingVerifier({
        secretHex: c.secretHex,
        bootId: c.bootId,
        userId: c.userId,
        now: () => c.ts * 1_000,
      });
      const hello = { bootId: c.bootId, ts: c.ts, nonce: c.nonce, mac: c.mac };
      expect(door.verify(hello, c.port)).toEqual({ ok: true, serverMac: c.ackMac });
    }
  });

  it("is the spec's recipe, spelled a second time apart from it", () => {
    const inputs: Array<PairingFacts & { secretHex: string }> = [
      ...vectorCases(),
      // a daemon with no user: the empty string, its separators still there
      {
        secretHex: "a3".repeat(32),
        port: 49_213,
        bootId: "fieldd-1a2b3c4d5e6f7a8b",
        userId: "",
        nonce: "9f8e7d6c5b4a39281706f5e4d3c2b1a0",
        ts: 1_784_930_400,
      },
      // other numbers: a port and a clock are decimal, never padded
      {
        secretHex: "5e".repeat(32),
        port: 9,
        bootId: "fieldd-0000000000000000",
        userId: "01J9USERAAAAAAAAAAAAAAAAAA",
        nonce: "00000000000000000000000000000001",
        ts: 7,
      },
    ];
    for (const facts of inputs) {
      expect(trustPairingMac(asked(facts))).toBe(shellMac(facts.secretHex, facts));
      expect(trustAckMac(asked(facts))).toBe(shellAckMac(facts.secretHex, facts));
    }
    // the two directions never answer one another
    const [first] = inputs;
    if (first === undefined) throw new Error("no input");
    expect(trustAckMac(asked(first))).not.toBe(trustPairingMac(asked(first)));
  });

  it("a nonce is CUSTODY.NONCE_HEX lowercase hex characters, fresh each time", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(new RegExp(`^[0-9a-f]{${CUSTODY.NONCE_HEX}}$`));
    expect(b).not.toBe(a);
  });
});

describe("the shell pairing's verifier", () => {
  const SECRET = "a3".repeat(32);
  const BOOT = "fieldd-1a2b3c4d5e6f7a8b";
  const PORT = 49_213;
  /** the verifier's clock, in seconds: a row moves it */
  let clock = 1_784_930_400;

  function verifier(userId = ""): ShellPairingVerifier {
    clock = 1_784_930_400;
    return new ShellPairingVerifier({
      secretHex: SECRET,
      bootId: BOOT,
      userId,
      now: () => clock * 1_000,
    });
  }

  /** A hello as the shell makes it, honest unless a row says otherwise. */
  function credential(
    over: Partial<PairingFacts> & { secretHex?: string; macOver?: Partial<PairingFacts> } = {},
  ): { bootId: string; ts: number; mac: string; nonce: string } {
    const { secretHex, macOver, ...said } = over;
    const facts: PairingFacts = {
      port: PORT,
      bootId: BOOT,
      userId: "",
      nonce: freshNonce(),
      ts: clock,
      ...said,
    };
    return {
      bootId: facts.bootId,
      ts: facts.ts,
      nonce: facts.nonce,
      mac: shellMac(secretHex ?? SECRET, { ...facts, ...macOver }),
    };
  }

  it("pairs an honest hello and answers the ack's proof", () => {
    const door = verifier();
    const hello = credential();
    expect(door.verify(hello, PORT)).toEqual({
      ok: true,
      serverMac: shellAckMac(SECRET, { nonce: hello.nonce, bootId: BOOT, port: PORT }),
    });
  });

  it("refuses in the spec's order: the shape, the boot, the window, the nonce, the mac", () => {
    const door = verifier();
    const stale = clock - CUSTODY.WINDOW_SECS - 1;
    const otherBoot = "fieldd-0000000000000000";
    const notANonce = "A".repeat(CUSTODY.NONCE_HEX);
    const wrong = { secretHex: "00".repeat(32) };

    for (const shapeless of [undefined, null, "tok_a-bearer", 7, {}, { bootId: BOOT, ts: clock }])
      expect(door.verify(shapeless, PORT)).toEqual({ ok: false, reason: "shape" });
    // every later check failing at once: the first one answers
    expect(
      door.verify(credential({ bootId: otherBoot, ts: stale, nonce: notANonce, ...wrong }), PORT),
    ).toEqual({ ok: false, reason: "boot" });
    expect(door.verify(credential({ ts: stale, nonce: notANonce, ...wrong }), PORT)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(door.verify(credential({ nonce: notANonce, ...wrong }), PORT)).toEqual({
      ok: false,
      reason: "nonce",
    });
    expect(door.verify(credential(wrong), PORT)).toEqual({ ok: false, reason: "mac" });
    // and each alone
    expect(door.verify(credential({ bootId: otherBoot }), PORT)).toEqual({
      ok: false,
      reason: "boot",
    });
    expect(door.verify(credential({ ts: stale }), PORT)).toEqual({ ok: false, reason: "stale" });
    expect(door.verify(credential({ ts: clock + CUSTODY.WINDOW_SECS + 1 }), PORT)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(door.verify(credential({ nonce: "ab".repeat(8) }), PORT)).toEqual({
      ok: false,
      reason: "nonce",
    });
    expect(door.verify(credential({ macOver: { port: PORT + 1 } }), PORT)).toEqual({
      ok: false,
      reason: "mac",
    });
    expect(door.verify(credential(), PORT + 1)).toEqual({ ok: false, reason: "mac" });
    expect(door.verify(credential({ macOver: { userId: "someone" } }), PORT)).toEqual({
      ok: false,
      reason: "mac",
    });
    // the window's edges are inside it
    expect(door.verify(credential({ ts: clock - CUSTODY.WINDOW_SECS }), PORT).ok).toBe(true);
    expect(door.verify(credential({ ts: clock + CUSTODY.WINDOW_SECS }), PORT).ok).toBe(true);
  });

  it("a mac that is no mac is refused, never thrown on", () => {
    const door = verifier();
    for (const mac of ["", "zz", "a3".repeat(31), "a3".repeat(33), "É".repeat(64)])
      expect(door.verify({ ...credential(), mac }, PORT)).toEqual({ ok: false, reason: "mac" });
  });

  it("the daemon's user is under the mac", () => {
    const door = verifier("01J9USERAAAAAAAAAAAAAAAAAA");
    expect(door.verify(credential(), PORT)).toEqual({ ok: false, reason: "mac" });
    expect(door.verify(credential({ userId: "01J9USERAAAAAAAAAAAAAAAAAA" }), PORT).ok).toBe(true);
  });

  // trust's recipe throws on a key that is not one, rather than MAC under what `Buffer.from(x, "hex")` makes of it
  // (the empty key). The door's verifier never throws on a hello, so the refusal is here, where the daemon boots.
  it("a verifier made with a secret that is not one is refused when it is made", () => {
    for (const secretHex of ["", "a3".repeat(31), "A3".repeat(32), "zz".repeat(32)]) {
      const make = (): ShellPairingVerifier =>
        new ShellPairingVerifier({ secretHex, bootId: BOOT, userId: "" });
      expect(make, `"${secretHex}"`).toThrow(TypeError);
    }
  });

  it("a nonce is spent by the hello that paired, and by no other", () => {
    const door = verifier();
    const nonce = freshNonce();
    // a hello nobody holding the secret made spends nothing
    expect(door.verify(credential({ nonce, secretHex: "00".repeat(32) }), PORT)).toEqual({
      ok: false,
      reason: "mac",
    });
    const hello = credential({ nonce });
    expect(door.verify(hello, PORT).ok).toBe(true);
    expect(door.verify(hello, PORT)).toEqual({ ok: false, reason: "nonce" });
    // nor does a later clock bring it back while its ts is inside the window
    clock += CUSTODY.WINDOW_SECS;
    expect(door.verify(hello, PORT)).toEqual({ ok: false, reason: "nonce" });
  });

  it("remembers the last CUSTODY.NONCES_KEPT nonces and no more", () => {
    const door = verifier();
    const first = credential();
    expect(door.verify(first, PORT).ok).toBe(true);
    for (let i = 0; i < CUSTODY.NONCES_KEPT - 1; i += 1)
      expect(door.verify(credential(), PORT).ok).toBe(true);
    // NONCES_KEPT pairings in: the first is still remembered
    expect(door.verify(first, PORT)).toEqual({ ok: false, reason: "nonce" });
    // one more pushes it out: the memory is bounded, and this is the bound said plainly
    expect(door.verify(credential(), PORT).ok).toBe(true);
    expect(door.verify(first, PORT).ok).toBe(true);
  });
});
