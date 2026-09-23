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

/** UA-D17 (spec v0.3) — a user is known by a face, never a colour: one emoji,
 * framed as a sticker (the default; an absent `frame` means sticker) or a coin
 * (the user's own choice). The look is DESIGN.md §2.8; the deck, the refusal
 * list and the deal are `user-face.ts`. */
export const UserFaceFrame = z.enum(["sticker", "coin"]);
export type UserFaceFrame = z.infer<typeof UserFaceFrame>;

export const UserFace = z
  .object({
    /** One emoji grapheme — a ZWJ sequence or a keycap counts as one. The
     * writer validates it (`faceProblem`); the reader only bounds it. */
    emoji: z.string().min(1).max(32),
    frame: UserFaceFrame.optional(),
  })
  .passthrough();
export type UserFace = z.infer<typeof UserFace>;

/** One user on this machine. Supervisor-written and machine-local today (spec
 * §3.3): `name`/`face`/`resident`/`onboarded` are THIS machine's view of the
 * user. UA-D18 moves `name` and `face` into the user-scope settings doc so they
 * travel with the login — GATED: the settings doc does not replicate yet
 * (`fieldd/src/settings-doc.ts`), so until it does these fields are the only
 * copy, not a cache. */
export const UserRecord = z
  .object({
    /** 26-char Crockford ULID — THE durable root identity; the tailscale link
     * points at it (UA-D2). Never derived from any account. */
    userId: z.string().min(1),
    /** The field uid: small positive integer naming `users/<fuid>/` (UA-D9 —
     * the sun_path budget forbids ULID-named directories). Never reused. */
    fuid: z.number().int().positive(),
    name: z.string().min(1),
    /** UA-D17 — absent until the Setup Assistant's pane 2 is passed (W6), and
     * for a pre-v0.3 user until main's silent deal on their first attach. A
     * face-less user is SHOWN with `effectiveFaces`' deal, never a blank. */
    face: UserFace.optional(),
    /** @deprecated the pre-v0.3 accent slot name. Tolerated and never rendered:
     * W6 reads its presence as "pane 2 was answered once", and the first
     * profile write that sets a face drops it. */
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

/** UA-P-0a (D1) — the POSTURE this desktop is in, as one word the Account pane
 * can draw. The mesh derives from the link, so these are the only six shapes a
 * desktop has, and four of them are honest refusals rather than blanks:
 *
 *  - `offline` — unlinked. A default local account: no node, no serve, no
 *    store, no lane. The ordinary first-run state, not a fault.
 *  - `capturing` — the user asked to link; the interactive login is running.
 *    Nothing is declared and nothing is published until the login lands.
 *  - `linked` — a login was captured and is the account.
 *  - `link_corrupt` — `link.json` is present and unusable. OFFLINE and LOUD:
 *    the identity record is never overwritten by a guess, and `linkDetail`
 *    names the file so a human can move it aside. (Before UA-P-0a this state
 *    paused capture forever while `link` read null — a LINKED desktop serving
 *    an open door under a UI that said "not linked".)
 *  - `login_unavailable` — the node came up but the tailnet never answered
 *    with a user for it (a TAGGED node, which has no login by construction).
 *    Capture ends; the node is stopped; the desktop is offline and says why.
 *  - `login_already_linked` — UA-P-0b (D8): another local user on this machine
 *    already holds this tailscale account. One local user per tailscale
 *    account, LAW; `linkDetail` names the other user, and capture succeeds
 *    only after that user unlinks. */
export const UserLinkState = z.enum([
  "offline",
  "capturing",
  "linked",
  "link_corrupt",
  "login_unavailable",
  "login_already_linked",
]);
export type UserLinkState = z.infer<typeof UserLinkState>;

/** The Account surface's fold: link truth + live mesh reachability, honest
 * about every degraded shape (mesh off, auth pending, capture pending).
 *
 * UA-P-0a adds the posture itself. `linkState` is the WORD; `linkDetail` is
 * the SENTENCE that makes a refusal actionable (the corrupt file's path, the
 * other user's name) and is null whenever the word needs no elaboration. The
 * three older fields keep their meaning and stay: `meshEnabled` is "is there a
 * node at all", `nodeState`/`authUrl` are the floor's own bring-up facts. */
export const UserLinkStatus = z
  .object({
    link: TailscaleLink.nullable(),
    meshEnabled: z.boolean(),
    nodeState: z.string().nullable(),
    authUrl: z.string().nullable(),
    linkState: UserLinkState,
    linkDetail: z.string().nullable(),
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
    /** UA-D17 — main refuses a face another user on this machine already
     * wears, a refused emoji, or more than one grapheme (`faceProblem`). */
    face: UserFace.optional(),
    resident: z.boolean().optional(),
    onboarded: z.boolean().optional(),
  })
  .passthrough();
export type UsersUpdateParams = z.infer<typeof UsersUpdateParams>;

/** UA-5 — the roster read behind `users:list`: one truth for the Account
 * switcher and the tray submenu. `attachedUserId` is main's live attachment,
 * not `lastAttached` (which is only the next-boot hint). */
export const UsersListSnapshot = z
  .object({
    attachedUserId: z.string().nullable(),
    users: z.array(UserRecord),
  })
  .passthrough();
export type UsersListSnapshot = z.infer<typeof UsersListSnapshot>;

/** UA-5 — `users:create`: mint user N under the §3.3 lock, then attach. The
 * name is optional and the face is never minted (UA-D17): the wizard's
 * second-user variant is where identity is actually decided (§6.2), and its
 * pane 2 shows the dealt face before it writes one. */
export const UsersCreateParams = z
  .object({
    name: z.string().min(1).max(120).optional(),
  })
  .passthrough();
export type UsersCreateParams = z.infer<typeof UsersCreateParams>;

/** UA-5 — `users:switch` (UA-D15: attach re-target + window reload). */
export const UsersSwitchParams = z
  .object({
    userId: z.string().min(1),
  })
  .passthrough();
export type UsersSwitchParams = z.infer<typeof UsersSwitchParams>;

/** `layout.json` — the migration's commit marker, written LAST (spec §4). */
export const LayoutStamp = z
  .object({
    layoutVersion: z.literal(LAYOUT_VERSION),
    migratedAt: z.string(),
    previous: z.enum(["flat-v1", "fresh"]),
  })
  .passthrough();
export type LayoutStamp = z.infer<typeof LayoutStamp>;
