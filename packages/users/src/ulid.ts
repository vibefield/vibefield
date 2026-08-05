import { randomBytes } from "node:crypto";

// Crockford base32 (no I L O U) — the same alphabet as truffle's device ids.
// 10 time chars (48 bits of unix ms) + 16 random chars (80 bits from 10 bytes).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Mint a 26-char ULID. `now` is injectable so tests and callers that must not
 * read ambient clocks (workflow rules; migration stamps) can pass one in. */
export function ulid(now: number = Date.now()): string {
  const out = new Array<string>(26);
  let time = now;
  for (let i = 9; i >= 0; i--) {
    out[i] = ALPHABET[time % 32] as string;
    time = Math.floor(time / 32);
  }
  let acc = 0;
  let bits = 0;
  let at = 10;
  for (const byte of randomBytes(10)) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out[at++] = ALPHABET[(acc >>> bits) & 31] as string;
    }
  }
  return out.join("");
}
