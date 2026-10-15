// TD-2 / WP8 (specs/trust-and-distribution.md §2, §5) — the runtime side of the trust-root: verify the
// document against the root keys the app already trusts, then a role-signed file against that role's keys.
// `scripts/trust-keygen.mjs` is the authoring side (James's keys, builtins only); this module is what fieldd,
// the stager's `--verify` and, at TD-3, the shell's UpdateProvider call. Same encoding, same signature-file
// format: one base64 Ed25519 signature per line over the signed file's EXACT bytes, and a key counts once
// however many lines it signed (the kit's single-line `.sig` is the one-signature case).
import { TrustRoot } from "@vibefield/contracts";
import { verifyRegistryIndex } from "./registry-sign";

/** A key set and how many of its keys must have signed. */
export interface TrustAnchor {
  readonly keys: readonly string[];
  readonly threshold: number;
}

export function signatureLines(sigText: string): string[] {
  return sigText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The DISTINCT keys of `keys` that signed `bytes` (never throws: a malformed line verifies nothing). */
export function signersOf(bytes: Buffer, sigText: string, keys: readonly string[]): string[] {
  const lines = signatureLines(sigText);
  return keys.filter(
    (key, index) =>
      keys.indexOf(key) === index && lines.some((line) => verifyRegistryIndex(bytes, line, key)),
  );
}

/** true when at least `anchor.threshold` distinct anchor keys signed `bytes`. */
export function verifySignedBytes(bytes: Buffer, sigText: string, anchor: TrustAnchor): boolean {
  return anchor.threshold >= 1 && signersOf(bytes, sigText, anchor.keys).length >= anchor.threshold;
}

export type TrustRootVerdict =
  | { readonly ok: true; readonly doc: TrustRoot; readonly signers: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** Verify a trust-root document's exact bytes against the root an app ALREADY trusts (its embedded root keys,
 * TD-1). Shape first (the contract), then the signatures. Freshness is the caller's question
 * (`judgeSignedDocument`): an app's own embedded document must keep its bundled plugins working past expiry,
 * while an update check must call an expired one STALE. */
export function verifyTrustRoot(
  docBytes: Buffer,
  sigText: string,
  anchor: TrustAnchor,
): TrustRootVerdict {
  let raw: unknown;
  try {
    raw = JSON.parse(docBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "the trust-root is not JSON" };
  }
  const parsed = TrustRoot.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      reason: `the trust-root is malformed: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    };
  const signers = signersOf(docBytes, sigText, anchor.keys);
  if (anchor.threshold < 1 || signers.length < anchor.threshold)
    return {
      ok: false,
      reason: `the trust-root is signed by ${signers.length} of the app's root keys; ${anchor.threshold} must`,
    };
  return { ok: true, doc: parsed.data, signers };
}
