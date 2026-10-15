import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signersOf, verifyEd25519, verifySignedBytes, verifyTrustRoot } from "../src/index";

// WP12 D2 — the ONE verifier, now a Node-only spine library (wall R2 keeps the kit out of Electron main). The kit's
// own suites (registry-sign, bundled-index, trust-keygen-compat) still exercise it through the kit's re-export; these
// cases pin the library's contract at its own door.

const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: publicKey.export({ format: "der", type: "spki" }).toString("base64"), privateKey };
};
const signLine = (bytes: Buffer, kp: ReturnType<typeof keypair>) =>
  sign(null, bytes, kp.privateKey).toString("base64");
const canonical = (value: unknown): string => {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
};

describe("@vibefield/trust — the one Ed25519 check and the trust-root verifier", () => {
  const bytes = Buffer.from("latest-mac.yml's exact bytes\n");

  it("verifies exact bytes, and never throws on garbage", () => {
    const a = keypair();
    const sig = signLine(bytes, a);
    expect(verifyEd25519(bytes, sig, a.pub)).toBe(true);
    expect(verifyEd25519(Buffer.from("other bytes"), sig, a.pub)).toBe(false);
    expect(verifyEd25519(bytes, "not base64 !!", a.pub)).toBe(false);
    expect(verifyEd25519(bytes, sig, "not a key")).toBe(false);
  });

  it("counts each anchor key once, whatever its lines, and honors the threshold", () => {
    const a = keypair();
    const b = keypair();
    const stranger = keypair();
    const sigText = `${signLine(bytes, a)}\n${signLine(bytes, a)}\n${signLine(bytes, stranger)}\n`;
    expect(signersOf(bytes, sigText, [a.pub, b.pub])).toEqual([a.pub]);
    expect(verifySignedBytes(bytes, sigText, { keys: [a.pub, b.pub], threshold: 1 })).toBe(true);
    expect(verifySignedBytes(bytes, sigText, { keys: [a.pub, b.pub], threshold: 2 })).toBe(false);
    expect(verifySignedBytes(bytes, sigText, { keys: [a.pub], threshold: 0 })).toBe(false);
  });

  it("accepts a trust-root signed by the app's root keys and refuses one signed by a stranger", () => {
    const [rootA, rootB, release, bundled, registry] = [1, 2, 3, 4, 5].map(keypair);
    const doc = Buffer.from(
      canonical({
        schemaVersion: 1,
        version: 1,
        expires: "2027-04-01T00:00:00Z",
        root: { threshold: 1, keys: [rootA!.pub, rootB!.pub] },
        roles: {
          release: { threshold: 1, keys: [release!.pub] },
          bundled: { threshold: 1, keys: [bundled!.pub] },
          registry: { threshold: 1, keys: [registry!.pub] },
        },
      }),
    );
    const anchor = { keys: [rootA!.pub, rootB!.pub], threshold: 1 };
    const good = verifyTrustRoot(doc, `${signLine(doc, rootB!)}\n`, anchor);
    expect(good.ok && good.doc.roles.release.keys).toEqual([release!.pub]);
    const forged = verifyTrustRoot(doc, `${signLine(doc, release!)}\n`, anchor);
    expect(forged.ok).toBe(false);
    expect(!forged.ok && forged.reason).toMatch(/signed by 0 of the app's root keys/);
    expect(verifyTrustRoot(Buffer.from("{"), "", anchor).ok).toBe(false);
  });
});
