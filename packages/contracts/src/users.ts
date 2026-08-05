import { z } from "zod";

// UA-D8/UA-D10 — the user directory ABOVE the per-user roots (`users.json` +
// `layout.json` at the VibeField root). Deliberately TS-only in the generation
// pipeline (design-01 §7 law: Rust generation includes only shapes with a
// native consumer — field-native never reads these files; the supervisor and
// fieldd's standalone entry are the only writers, via @vibefield/users).
// Pinned by fixtures/users.vector.json, INCLUDING the unknown-key round trip
// UA-D10 demands of writers: `.passthrough()` on the read side is only half
// the job — a version-skewed writer must not drop a newer field.

export const USERS_FILE_VERSION = 1;
export const LAYOUT_VERSION = 2;

/** One user on this machine. Deliberately machine-local, supervisor-written,
 * non-converging (spec §3.3): `name`/`color`/`resident`/`onboarded` are THIS
 * machine's view of the user, unlike D29′ user-scope settings which ride the
 * user's own mesh. `color` is a DESIGN.md accent slot name, never a hex. */
export const UserRecord = z
  .object({
    /** 26-char Crockford ULID — THE durable root identity; the tailscale link
     * points at it (UA-D2). Never derived from any account. */
    userId: z.string().min(1),
    /** The field uid: small positive integer naming `users/<fuid>/` (UA-D9 —
     * the sun_path budget forbids ULID-named directories). Never reused. */
    fuid: z.number().int().positive(),
    name: z.string().min(1),
    color: z.string().optional(),
    /** Keep the pair running when not attached (UA-D3; default true — V3). */
    resident: z.boolean(),
    /** False until the §6 Setup Assistant completes or is skipped through. */
    onboarded: z.boolean(),
    createdAt: z.string(),
  })
  .passthrough();
export type UserRecord = z.infer<typeof UserRecord>;

export const UsersFile = z
  .object({
    version: z.literal(USERS_FILE_VERSION),
    /** Monotonic allocator for fuids — never decremented, never reused. */
    nextFuid: z.number().int().positive(),
    /** Hint for next boot (best-effort write — never blocks a switch). */
    lastAttached: z.string().nullable(),
    users: z.array(UserRecord),
  })
  .passthrough();
export type UsersFile = z.infer<typeof UsersFile>;

/** UA-3 — the recorded tailscale link (`users/<fuid>/fieldd/link.json`,
 * fieldd-owned, private). `login` is THE trust comparison value for UA-4's
 * self/guest door; null until captured (self-whois needs a Running node, and
 * tagged nodes may never yield one — a typed pre-capture state, not an error). */
export const TailscaleLink = z
  .object({
    login: z.string().nullable(),
    /** display only — the MagicDNS suffix, never a trust input */
    tailnet: z.string().optional(),
    linkedAt: z.string(),
    lastVerifiedAt: z.string().optional(),
  })
  .passthrough();
export type TailscaleLink = z.infer<typeof TailscaleLink>;

/** The Account surface's fold: link truth + live mesh reachability, honest
 * about every degraded shape (mesh off, auth pending, capture pending). */
export const UserLinkStatus = z
  .object({
    link: TailscaleLink.nullable(),
    meshEnabled: z.boolean(),
    nodeState: z.string().nullable(),
    authUrl: z.string().nullable(),
  })
  .passthrough();
export type UserLinkStatus = z.infer<typeof UserLinkStatus>;

/** UA-3 — the Account page's profile write over the closed IPC surface. All
 * fields optional (the handler refuses an empty update); `onboarded` exists
 * for UA-3w's wizard completion flip. Tolerant read per the corpus law —
 * unknown fields are ignored by the applier, never a refusal. */
export const UsersUpdateParams = z
  .object({
    name: z.string().min(1).max(120).optional(),
    color: z.string().min(1).max(64).optional(),
    resident: z.boolean().optional(),
    onboarded: z.boolean().optional(),
  })
  .passthrough();
export type UsersUpdateParams = z.infer<typeof UsersUpdateParams>;

/** `layout.json` — the migration's commit marker, written LAST (spec §4). */
export const LayoutStamp = z
  .object({
    layoutVersion: z.literal(LAYOUT_VERSION),
    migratedAt: z.string(),
    previous: z.enum(["flat-v1", "fresh"]),
  })
  .passthrough();
export type LayoutStamp = z.infer<typeof LayoutStamp>;
