// OB custody, C1 — the OS keystore as the shell's custody root needs it: three calls
// and nothing else. The root (root.ts) reaches the disk only as `wrap` made it, so the bytes at LAYOUT.CUSTODY_KEY
// open nothing without a key the OS holds and releases to the signed shell alone. keystore-electron.ts is the one
// implementation; it is made only at custody's `sealed` level, by a maker the composition root hands in, so a dev
// run and an unsigned package never construct one. Every test hands a fake.

export interface Keystore {
  /** Whether the keystore answers now. Never throws: every doubt is `false`. On macOS this is the question that
   * reaches the Keychain, so it is asked when the root is opened and when a person asks again, never on a timer. */
  available(): boolean;
  /** `plain` under the keystore's key. Throws when the keystore will not wrap. */
  wrap(plain: Buffer): Buffer;
  /** What `wrap` was given. Throws when `wrapped` was not made under this keystore's key. */
  unwrap(wrapped: Buffer): Buffer;
}
