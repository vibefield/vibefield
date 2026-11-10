// @vibefield/trust — OB custody's recipes, each in ONE place (EL7: a same-uid agent is the adversary). The shell
// derives a user root's secrets from its own root here; the supervisor makes the shell's pairing MAC here and fieldd
// checks it here, so maker and verifier cannot spell the message two ways. The names, the contexts and the nonce's
// length are contracts' `CUSTODY`; the MAC is pinned across languages by `fixtures/shell-pairing.vector.json`.
//
// node:crypto only (wall R28), and Node-only (R27): the browser-compatible client is handed functions made from
// these, never this module.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { CUSTODY, CustodySecret } from "@vibefield/contracts";

const ROOT_BYTES = 32;
const SECRET_BYTES = 32;
const NUL = "\0";
const MAC_HEX = /^[0-9a-f]{64}$/;

/**
 * One of a user root's secrets, from the shell's custody root: HKDF-SHA256 with an empty salt,
 * `info = label 0x00 context`, 32 bytes out, as hex (a `CustodySecret`). `label` is one of `CUSTODY.LABELS`; `context`
 * is the user root's real path, so each user of an install has secrets of its own and nothing but the root is stored.
 *
 * Throws on a root that is not 32 bytes, an empty label or context, or a label that carries a NUL: each would derive a
 * secret that looks like any other. The separator keeps `label 0x00 context` reading one way only while no label
 * holds it (a path cannot).
 */
export function deriveCustody(root: Buffer, label: string, context: string): string {
  if (root.length !== ROOT_BYTES) throw new RangeError("the custody root is 32 bytes");
  if (label.length === 0 || label.includes(NUL))
    throw new TypeError("a custody label is a non-empty string with no NUL in it");
  if (context.length === 0) throw new TypeError("a custody context is a non-empty string");
  const info = Buffer.from(`${label}${NUL}${context}`, "utf8");
  const derived = hkdfSync("sha256", root, Buffer.alloc(0), info, SECRET_BYTES);
  return Buffer.from(derived).toString("hex");
}

/** A custody secret's 32 bytes. Throws rather than key a MAC with what `Buffer.from(x, "hex")` makes of a string
 * that is not hex: the EMPTY key, whose MACs look like any other. The refusal never says the secret back. */
function keyOf(secret: string): Buffer {
  if (!CustodySecret.safeParse(secret).success)
    throw new TypeError("a custody secret is 64 lowercase hex characters");
  return Buffer.from(secret, "hex");
}

function mac(secret: string, parts: readonly (string | number)[]): string {
  return createHmac("sha256", keyOf(secret)).update(parts.join(NUL), "utf8").digest("hex");
}

/** What a `shell-main` hello's MAC covers under `sealed`. */
export interface ShellPairingInput {
  /** the shell's pairing secret for this user root (`CustodyHandoff.shell`), 64 hex characters */
  readonly secret: string;
  /** the TCP port the daemon listens on and the client dialled */
  readonly port: number;
  /** the daemon's own boot, as its ready line or product.json stated it */
  readonly bootId: string;
  /** the daemon's configured user id, or the empty string when it has none */
  readonly userId: string;
  /** `CUSTODY.NONCE_HEX` hex characters, fresh per connection (`newNonce`) */
  readonly nonce: string;
  /** seconds since the epoch, as `PairingMac.ts` carries it */
  readonly ts: number;
}

/**
 * The shell's proof that it holds the pairing secret (`PairingMac.mac` in a `shell-main` hello):
 *   hex(HMAC-SHA256(secret, "vf-shell" 0x00 String(port) 0x00 bootId 0x00 userId 0x00 nonce 0x00 String(ts)))
 * NUL separators and decimal numbers, as D8's recipe. The port and the boot are inside it so that a listener planted
 * at another port, or another boot of the real one, cannot be handed a hello it could relay; the secret is never sent.
 */
export function shellPairingMac(input: ShellPairingInput): string {
  return mac(input.secret, [
    CUSTODY.SHELL_CONTEXT,
    input.port,
    input.bootId,
    input.userId,
    input.nonce,
    input.ts,
  ]);
}

/** What the daemon's answer covers. */
export interface ShellAckInput {
  readonly secret: string;
  /** the nonce the hello carried: the client's challenge */
  readonly nonce: string;
  readonly bootId: string;
  readonly port: number;
}

/**
 * The daemon's proof back (`HelloAck.serverMac`), over the nonce the client chose for this connection:
 *   hex(HMAC-SHA256(secret, "vf-shell-ack" 0x00 nonce 0x00 bootId 0x00 String(port)))
 * A different context from the hello's, so neither direction's MAC is ever a valid answer in the other.
 */
export function shellAckMac(input: ShellAckInput): string {
  return mac(input.secret, [CUSTODY.SHELL_ACK_CONTEXT, input.nonce, input.bootId, input.port]);
}

/** A fresh nonce for one connection: `CUSTODY.NONCE_HEX` lowercase hex characters of the OS's randomness. */
export function newNonce(): string {
  return randomBytes(CUSTODY.NONCE_HEX / 2).toString("hex");
}

/**
 * true when `a` and `b` are the same MAC, compared in constant time. NEVER throws: anything that is not 64 lowercase
 * hex characters (a missing proof, a shorter one, the wrong type) matches nothing, itself included.
 */
export function macMatches(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!MAC_HEX.test(a) || !MAC_HEX.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
