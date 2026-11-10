import { CUSTODY, CustodySecret, PairingMac } from "@vibefield/contracts";
import { macMatches, shellAckMac, shellPairingMac } from "@vibefield/trust";

// OB custody (C2; contracts custody.ts, registries.ts `CUSTODY`) — the shell's pairing at a `sealed` fieldd.
//
// At `files` the shell's authority is a bearer in LAYOUT.SHELL_TOKEN, a file every process of the same user reads
// (EL7). A fieldd handed custody mints no such bearer. Its shell proves it holds the secret the spawner handed, and
// never sends it: a `shell-main` hello carries envelope.ts's `PairingMac` in `Hello.credential`, its `nonce`
// required, and the ack answers `HelloAck.serverMac`. A listener planted by rewriting `product.json` therefore
// learns nothing and cannot answer, and because the port and the boot are under the MAC, a hello it relays to the
// real fieldd is a hello made for another port.
//
// The recipe is NOT spelled here. It has one home, `@vibefield/trust` (custody.ts: `shellPairingMac`, `shellAckMac`,
// `macMatches`), where the supervisor makes the MAC this file checks, so that the maker and the verifier cannot
// spell the message two ways; contracts/fixtures/shell-pairing.vector.json pins it across packages. What this file
// owns is the door's ORDER of checks and its memory of nonces.

/** Why a pairing was refused. For fieldd's own log alone: the door answers every one in the same words. */
export type ShellPairingRefusal = "shape" | "boot" | "stale" | "nonce" | "mac";

export type ShellPairingVerdict =
  | { ok: true; serverMac: string }
  | { ok: false; reason: ShellPairingRefusal };

export interface ShellPairingVerifierOptions {
  /** the shell's pairing secret for this user root (`CustodyHandoff.shell`), 64 lowercase hex characters */
  secretHex: string;
  /** this daemon's boot */
  bootId: string;
  /** this daemon's configured user id; the empty string when it has none */
  userId: string;
  /** Test seam: the verifier's clock, unix milliseconds. */
  now?: () => number;
}

const NONCE = new RegExp(`^[0-9a-f]{${CUSTODY.NONCE_HEX}}$`);

/** The door's verifier, one per daemon boot. It checks in the spec's order and stops at the first that fails: the
 * shape, the boot, the clock's window, the nonce, the MAC.
 *
 * A nonce is remembered only once its hello has PAIRED, so the memory holds what holders of the secret said and
 * nothing a stranger can fill it with. It keeps the last `CUSTODY.NONCES_KEPT`: a hello heard again is refused while
 * it is among them, and its `ts` ends it at the window in any case. */
export class ShellPairingVerifier {
  /** nonces that paired, oldest first (a Set iterates in insertion order) */
  private readonly seen = new Set<string>();

  /** Throws on a secret that is not one. trust's recipe refuses to key a MAC with such a string (the empty key,
   * whose MACs look like any other), and `verify` must never throw on a hello: so the refusal is here, where the
   * daemon boots, and it never says the secret back. */
  constructor(private readonly opts: ShellPairingVerifierOptions) {
    if (!CustodySecret.safeParse(opts.secretHex).success) {
      throw new TypeError("the shell's pairing secret is 64 lowercase hex characters");
    }
  }

  /** `credential` is a hello's, as it came; `port` is the port this daemon is listening on. */
  verify(credential: unknown, port: number): ShellPairingVerdict {
    const parsed = PairingMac.safeParse(credential);
    if (!parsed.success) return { ok: false, reason: "shape" };
    const { bootId, ts, mac, nonce } = parsed.data;
    if (bootId !== this.opts.bootId) return { ok: false, reason: "boot" };
    const now = Math.floor((this.opts.now?.() ?? Date.now()) / 1000);
    if (Math.abs(now - ts) > CUSTODY.WINDOW_SECS) return { ok: false, reason: "stale" };
    if (nonce === undefined || !NONCE.test(nonce) || this.seen.has(nonce))
      return { ok: false, reason: "nonce" };
    const { secretHex: secret, userId } = this.opts;
    const expected = shellPairingMac({ secret, port, bootId, userId, nonce, ts });
    // constant time, and a mac that is no mac is simply not equal: never an exception on a hostile input
    if (!macMatches(expected, mac)) return { ok: false, reason: "mac" };
    this.seen.add(nonce);
    for (const oldest of this.seen) {
      if (this.seen.size <= CUSTODY.NONCES_KEPT) break;
      this.seen.delete(oldest);
    }
    return { ok: true, serverMac: shellAckMac({ secret, nonce, bootId, port }) };
  }
}
