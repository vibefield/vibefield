import { z } from "zod";

// TD-0 (specs/trust-and-distribution.md §2–§3, ruled 2026-10-14) — the ONE trust model under the app
// updater, the bundled plugin set and the plugin registry. An OFFLINE root key set held by James signs
// `trust-root.json`, which names the public keys of three ONLINE roles: `release` (the update feed, the
// policy, the release's copy of this document), `bundled` (the staged bundled-plugin index) and
// `registry` (the registry index). The app embeds the root public keys and the document it was built
// with; nothing it verifies at runtime is signed by a key the document does not name (TD-1).
// TS-only like the whole distribution surface: nothing here enters the Rust gen bundle.
//
// The format is TUF's fields and no other (TD-16): keys, roles, threshold, version, expires. The
// signature file is the document's name plus `.sig` (the kit's convention): one base64 Ed25519
// signature over the document's EXACT bytes per line, one line per root key that signed — a one-line
// file is exactly the kit's registry signature. A client accepts the document when `root.threshold`
// distinct root keys it ALREADY trusts verify a line; rotation is a new document signed by an old root
// key and a new one (§2 "Rotation").

/** An Ed25519 public key in the kit's encoding (`tooling/plugin-build/src/registry-sign.ts`): base64
 * SPKI DER. Always 44 bytes — the 12-byte SPKI header `302a300506032b6570032100` (base64
 * `MCowBQYDK2VwAyEA`) then the 32 key bytes — so 60 characters ending in one `=`, whose last data
 * character carries two zero bits. A secret (base64 PKCS#8, `MC4CAQAw…`, 64 characters) can never
 * pass, which is the point: this is the one place a public key and a secret could be confused. */
export const ED25519_SPKI_BASE64_PREFIX = "MCowBQYDK2VwAyEA" as const;
export const Ed25519SpkiBase64 = z
  .string()
  .regex(
    /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/,
    "expected an Ed25519 public key as base64 SPKI DER (60 characters, MCowBQYDK2VwAyEA…=)",
  );
export type Ed25519SpkiBase64 = z.infer<typeof Ed25519SpkiBase64>;

/** An instant as ISO 8601 UTC (`2027-04-01T00:00:00Z`), the spec's `expires`. */
export const IsoInstant = z.string().datetime();
export type IsoInstant = z.infer<typeof IsoInstant>;

export const TRUST_ROOT_FILE = "trust-root.json" as const;
/** The kit's convention: a signed file's signature is its name plus `.sig`. */
export const SIGNATURE_SUFFIX = ".sig" as const;

/** The three online roles (§3), in the order the document lists them. */
export const TRUST_ROLES = ["release", "bundled", "registry"] as const;
export const TrustRoleName = z.enum(TRUST_ROLES);
export type TrustRoleName = z.infer<typeof TrustRoleName>;

/** How long each signed document lives before a client calls it STALE (§2, §3; TD-10). */
export const TRUST_FRESHNESS_DAYS = {
  /** the trust-root: James re-signs before expiry */
  trustRoot: 180,
  /** `update-policy.json`, signed by `release` */
  updatePolicy: 60,
  /** `registry/index.json`, re-signed by CI on every merge and weekly */
  registryIndex: 90,
} as const;

/** One key set and how many of its keys must sign. */
export const TrustKeySet = z
  .object({
    threshold: z.number().int().min(1),
    keys: z.array(Ed25519SpkiBase64).min(1).max(16),
  })
  .passthrough()
  .superRefine((set, ctx) => {
    if (new Set(set.keys).size !== set.keys.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys"],
        message: "a key is listed twice",
      });
    if (set.threshold > set.keys.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["threshold"],
        message: `a threshold of ${set.threshold} cannot be met by ${set.keys.length} key(s)`,
      });
  });
export type TrustKeySet = z.infer<typeof TrustKeySet>;

/** `trust-root.json` (§2). Every key appears ONCE across the document: the root is offline and the
 * roles are online (TD-1), so a root key named as a role would put the root's authority online, and
 * a key shared by two roles would let one role sign the other's documents (a registry key signing
 * the bundled index). Unknown fields pass (the tolerant reader) and are never trusted. */
export const TrustRoot = z
  .object({
    schemaVersion: z.literal(1),
    /** monotonic; a client remembers the last accepted and refuses a lower one (TD-10) */
    version: z.number().int().min(1),
    expires: IsoInstant,
    root: TrustKeySet,
    roles: z
      .object({ release: TrustKeySet, bundled: TrustKeySet, registry: TrustKeySet })
      .passthrough(),
  })
  .passthrough()
  .superRefine((doc, ctx) => {
    // TD-1: the root is two keys (threshold 1), so losing one device never strands every client.
    if (doc.root.keys.length < 2)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["root", "keys"],
        message: "the root is at least two keys (TD-1)",
      });
    const seen = new Map<string, string>();
    const sets: Array<[string, readonly string[]]> = [
      ["root", doc.root.keys],
      ...TRUST_ROLES.map((role): [string, readonly string[]] => [role, doc.roles[role].keys]),
    ];
    for (const [owner, keys] of sets) {
      for (const key of keys) {
        const first = seen.get(key);
        if (first !== undefined && first !== owner)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: owner === "root" ? ["root", "keys"] : ["roles", owner, "keys"],
            message: `a key of ${owner} is also a key of ${first} — every key belongs to one role`,
          });
        else seen.set(key, owner);
      }
    }
  });
export type TrustRoot = z.infer<typeof TrustRoot>;

/** The keys a role signs with, by name. */
export function trustRoleKeys(doc: TrustRoot, role: TrustRoleName | "root"): TrustKeySet {
  return role === "root" ? doc.root : doc.roles[role];
}

/** TD-10's judgement of a signed document a client is offered, AFTER its signature verified:
 * - `rollback` — its version is lower than the last one accepted for this role: refused;
 * - `stale` — expired: used only with the STALE label, never silently trusted;
 * - `accepted` — the client remembers this version from now on.
 * An equal version is accepted (the same document fetched again). */
export type SignedDocumentVerdict = "accepted" | "stale" | "rollback";
export function judgeSignedDocument(
  doc: { readonly version: number; readonly expires: string },
  seen: { readonly lastAcceptedVersion: number | null; readonly now: number },
): SignedDocumentVerdict {
  if (seen.lastAcceptedVersion !== null && doc.version < seen.lastAcceptedVersion)
    return "rollback";
  const expires = Date.parse(doc.expires);
  if (!Number.isFinite(expires) || expires <= seen.now) return "stale";
  return "accepted";
}
