import { safeStorage } from "electron";
import type { Keystore } from "./keystore";

// OB custody, C1 (CUSTODY-SPEC §7) — the shell's keystore: Electron's own, and the ONLY file that names it (a row
// reads the tree for that). On macOS its key is a Keychain item of the app's, the one a packaged app's cookie
// encryption already uses, released without a prompt to the app that made it. That is read from Electron's
// documentation and Chromium's, not measured: what the Keychain does on a signed build (its prompt, its access list,
// whether a refusal is remembered for the life of the process, so that asking again needs a relaunch) is owed to a
// row on a signed package.
//
// Made only at custody's `sealed` level (a packaged, signed shell on macOS). A development Electron must never make
// one: it would create the same-named Keychain item under another identity, and the person would be asked about it
// later. Elsewhere this API can fall back to a key that protects nothing, which is one more reason the level is
// macOS's alone.

export function createElectronKeystore(): Keystore {
  return {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    // the API wraps text, so the bytes cross as their base64
    wrap: (plain) => safeStorage.encryptString(plain.toString("base64")),
    unwrap: (wrapped) => {
      const text = safeStorage.decryptString(wrapped);
      const plain = Buffer.from(text, "base64");
      // base64 decoding refuses nothing on its own: only the text `wrap` wrote reads back as its own bytes' base64.
      // The refusal never says the text.
      if (plain.toString("base64") !== text) {
        throw new Error("the keystore opened bytes that are not a wrapped key");
      }
      return plain;
    },
  };
}
