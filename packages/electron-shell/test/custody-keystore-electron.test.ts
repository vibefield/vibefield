import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAIN_ROOT } from "./custody-fakes";

// OB custody, C1 — the one keystore the shell ships: Electron's own, which on macOS is the Keychain
// item the packaged app's cookie encryption already uses. This file's `electron` is a stand-in that marks what it is
// given, so the rows prove the adapter and never the Keychain: availability is the keystore's own answer, the bytes
// cross as their base64 text (the API wraps text), and what comes back is refused unless it is that text again.
// What the real Keychain does (its prompt, its ACL, whether a refusal is remembered for the process) is owed to a row
// on a signed build.

const stand = vi.hoisted(() => ({
  available: true as boolean | "throws",
  asked: { available: 0, encrypt: [] as string[], decrypt: 0 },
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => {
      stand.asked.available += 1;
      if (stand.available === "throws") throw new Error("the keystore is not ready");
      return stand.available;
    },
    encryptString: (text: string) => {
      stand.asked.encrypt.push(text);
      return Buffer.from(`stand-in:${text}`, "utf8");
    },
    decryptString: (wrapped: Buffer) => {
      stand.asked.decrypt += 1;
      const text = wrapped.toString("utf8");
      if (!text.startsWith("stand-in:")) throw new Error("Error while decrypting the ciphertext");
      return text.slice("stand-in:".length);
    },
  },
}));

const { createElectronKeystore } = await import("../src/main/custody/keystore-electron");

beforeEach(() => {
  stand.available = true;
  stand.asked.available = 0;
  stand.asked.encrypt.length = 0;
  stand.asked.decrypt = 0;
});

describe("the Electron keystore (C1)", () => {
  it("making it asks the keystore nothing", () => {
    createElectronKeystore();
    expect(stand.asked).toEqual({ available: 0, encrypt: [], decrypt: 0 });
  });

  it("wraps the bytes as their base64 text, and unwraps to the same bytes", () => {
    const keystore = createElectronKeystore();
    const wrapped = keystore.wrap(PLAIN_ROOT);
    expect(stand.asked.encrypt).toEqual([PLAIN_ROOT.toString("base64")]);
    expect(wrapped.includes(PLAIN_ROOT)).toBe(false);
    expect(keystore.unwrap(wrapped).equals(PLAIN_ROOT)).toBe(true);
  });

  it("is available when the keystore says so, and a keystore that throws is not there", () => {
    const keystore = createElectronKeystore();
    expect(keystore.available()).toBe(true);
    stand.available = false;
    expect(keystore.available()).toBe(false);
    stand.available = "throws";
    expect(keystore.available()).toBe(false);
  });

  it("refuses bytes the keystore cannot open, and bytes that open to something that is not a wrapped key", () => {
    const keystore = createElectronKeystore();
    expect(() => keystore.unwrap(Buffer.from("not wrapped by anyone"))).toThrow();
    // base64 decoding refuses nothing on its own: text that is not the base64 of its own bytes was never ours
    expect(() => keystore.unwrap(Buffer.from("stand-in:not base64 at all!"))).toThrow();
    expect(() => keystore.unwrap(Buffer.from("stand-in:AQID\n"))).toThrow();
    // and no refusal says the text back
    let refusal: unknown;
    try {
      keystore.unwrap(Buffer.from("stand-in:c2VjcmV0IHdvcmRz!"));
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(Error);
    expect(String(refusal)).not.toContain("c2VjcmV0");
  });
});
