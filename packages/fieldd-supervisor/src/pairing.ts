import type { PairingMac } from "@vibefield/contracts";
import type { FielddPairing } from "@vibefield/fieldd-client";
import { macMatches, newNonce, shellAckMac, shellPairingMac } from "@vibefield/trust";

// OB custody (C2) — the shell's side of the pairing, made here in Node for a client that holds no crypto. The recipes
// are @vibefield/trust's, the one home fieldd's verifier reads too. The secret stays in this closure: what leaves is
// a MAC over a fresh nonce, the dialled port and the daemon's boot, so a listener planted at another port learns
// nothing it can replay at the real one, and the real one cannot be replayed at later.

/** The daemon a pairing is made for: the port dialled, the boot the daemon stated (its ready line, or product.json),
 * and the user it serves (the empty string for a daemon that has none). */
export interface PairedDaemon {
  readonly port: number;
  readonly bootId: string;
  readonly userId: string;
}

/**
 * A `FielddPairing` for one client of one daemon. Each `credential()` draws a fresh nonce and stamps the time (seconds,
 * as `PairingMac.ts` carries it); `proves(ack)` then holds the ack to THAT nonce, in constant time. Before any
 * credential was made nothing is proved. `secret` is `CustodyHandoff.shell`; a secret that is not 64 lowercase hex
 * characters throws at the first credential (trust's guard against MACing under the empty key), which the client reads
 * as a terminal refusal.
 */
export function shellPairing(
  secret: string,
  daemon: PairedDaemon,
  now: () => number = Date.now,
): FielddPairing {
  let nonce: string | null = null;
  return {
    credential(): PairingMac {
      const fresh = newNonce();
      const ts = Math.floor(now() / 1_000);
      const mac = shellPairingMac({ secret, ...daemon, nonce: fresh, ts });
      nonce = fresh;
      return { bootId: daemon.bootId, ts, nonce: fresh, mac };
    },
    proves(ack): boolean {
      if (nonce === null) return false;
      const expected = shellAckMac({ secret, nonce, bootId: daemon.bootId, port: daemon.port });
      return macMatches(ack.serverMac, expected);
    },
  };
}
