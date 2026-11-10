import { createHmac, randomBytes } from "node:crypto";
import { CUSTODY, PairingMac } from "@vibefield/contracts";
import { ackMacMatches } from "./pairing";

// OB custody (C2; contracts custody.ts, registries.ts `CUSTODY`) — the shell's pairing at a `sealed` fieldd.
//
// At `files` the shell's authority is a bearer in LAYOUT.SHELL_TOKEN, a file every process of the same user reads
// (EL7). A fieldd handed custody mints no such bearer. Its shell proves it holds the secret the spawner handed, and
// never sends it: a `shell-main` hello carries envelope.ts's `PairingMac` in `Hello.credential`, its `nonce`
// required, and the ack answers `HelloAck.serverMac`. A listener planted by rewriting `product.json` therefore
// learns nothing and cannot answer, and because the port and the boot are under the MAC, a hello it relays to the
// real fieldd is a hello made for another port.
//
// The recipe, pinned across packages by contracts/fixtures/shell-pairing.vector.json (this file is the verifier's
// copy; `packages/trust` holds the maker's). NUL separators and decimal numbers, as D8's (pairing.ts):
//   mac       = hex(HMAC-SHA256(shell, "vf-shell"     0x00 String(port) 0x00 bootId 0x00 userId 0x00 nonce 0x00 String(ts)))
//   serverMac = hex(HMAC-SHA256(shell, "vf-shell-ack" 0x00 nonce 0x00 bootId 0x00 String(port)))
// `shell` is the secret's 32 bytes. `port` is the TCP port the daemon listens on and the client dialled. `userId` is
// the daemon's configured user id, or the empty string when it has none. A different context each way, so neither
// direction's transcript replays as the other's.

/** What the shell's MAC is made over. */
export interface ShellPairingFacts {
  /** the TCP port the daemon listens on and the client dialled */
  port: number;
  /** the daemon's own boot, as `product.json` and the ready line state it */
  bootId: string;
  /** the daemon's configured user id; the empty string when it has none */
  userId: string;
  /** `CUSTODY.NONCE_HEX` lowercase hex characters, fresh per connection */
  nonce: string;
  /** the shell's clock, unix seconds */
  ts: number;
}

/** The shell's half: proof that the caller holds the handed secret, for this port, boot and user alone. */
export function computeShellPairingMac(secretHex: string, facts: ShellPairingFacts): string {
  const message = [
    CUSTODY.SHELL_CONTEXT,
    String(facts.port),
    facts.bootId,
    facts.userId,
    facts.nonce,
    String(facts.ts),
  ].join("\0");
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(message, "utf8").digest("hex");
}

/** The daemon's half: proof that the answerer holds the same secret, over the nonce the shell picked. */
export function computeShellAckMac(
  secretHex: string,
  facts: Pick<ShellPairingFacts, "nonce" | "bootId" | "port">,
): string {
  const message = [
    CUSTODY.SHELL_ACK_CONTEXT,
    facts.nonce,
    facts.bootId,
    String(facts.port),
  ].join("\0");
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(message, "utf8").digest("hex");
}

/** A fresh nonce for one connection: `CUSTODY.NONCE_HEX` hex characters from the CSPRNG. */
export function newShellPairingNonce(): string {
  return randomBytes(CUSTODY.NONCE_HEX / 2).toString("hex");
}

/** Why a pairing was refused. For fieldd's own log alone: the door answers every one in the same words. */
export type ShellPairingRefusal = "shape" | "boot" | "stale" | "nonce" | "mac";

export type ShellPairingVerdict =
  | { ok: true; serverMac: string }
  | { ok: false; reason: ShellPairingRefusal };

export interface ShellPairingVerifierOptions {
  /** the shell's pairing secret for this user root (`CustodyHandoff.shell`), 64 hex characters */
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

  constructor(private readonly opts: ShellPairingVerifierOptions) {}

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
    const expected = computeShellPairingMac(this.opts.secretHex, {
      port,
      bootId,
      userId: this.opts.userId,
      nonce,
      ts,
    });
    // constant time, and a mac of another length is simply not equal: never an exception on a hostile input
    if (!ackMacMatches(expected, mac)) return { ok: false, reason: "mac" };
    this.seen.add(nonce);
    for (const oldest of this.seen) {
      if (this.seen.size <= CUSTODY.NONCES_KEPT) break;
      this.seen.delete(oldest);
    }
    return {
      ok: true,
      serverMac: computeShellAckMac(this.opts.secretHex, { nonce, bootId, port }),
    };
  }
}
