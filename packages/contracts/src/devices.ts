import { z } from "zod";
import { MESH_CONTROL_LIMITS } from "./registries";

// DeviceService wire shapes (design-04 §3.1, D31 — the C4 P1-lite subset).
// The roster fuses self-slices in the `field.devices.v1` SyncedStore with
// tailnet peer liveness; presence heartbeats (source 3) are deferred with the
// spec's own verify-item. TS-only — the shape does not cross to Rust (the store
// carries opaque JSON; field-native enforces only generated transport budgets).

/** Hostile-store and projection bounds. Device slices are tiny identity rows;
 * accepting arbitrary strings here would let one peer amplify every roster and
 * Artifact Hub snapshot that names it. */
export const DEVICE_LIMITS = {
  REMOTE_ORIGINS: MESH_CONTROL_LIMITS.REMOTE_ORIGINS,
  SLICE_BYTES: MESH_CONTROL_LIMITS.DEVICE_SLICE_BYTES,
  DEVICE_ID_CHARS: MESH_CONTROL_LIMITS.OWNER_CHARS,
  NAME_CHARS: 128,
  PLATFORM_CHARS: 64,
  VERSION_CHARS: 64,
  BOOT_ID_CHARS: 256,
  ENDPOINT_SERVE_CHARS: 128,
  ENDPOINT_URL_CHARS: 2_048,
  /** Item 406 — a Tailscale stable node id, as the sidecar injects it and the peer registry names it. */
  NODE_ID_CHARS: MESH_CONTROL_LIMITS.OWNER_CHARS,
  /** Item 406 — the node ids one refusal or one known phone carries. A phone takes a new node id only when it
   * registers again, so a handful is generous; the bound keeps every synced entry small. */
  NODE_IDS_PER_ENTRY: 16,
} as const;

/** Honest per-device capability facts (D31: "capabilities honest per device"). */
export const DeviceCapabilities = z
  .object({
    /** This device HAS a terminal floor — the local fact. True iff the
     * pairing hello delivered the floor's endpoints; it says nothing about
     * whether anyone else can reach them (QA 2026-09-13 finding 2 turned on
     * exactly that distinction). */
    terminalHost: z.boolean(),
    /** TM-2 (MF-1l) — this device's terminal doors are PUBLISHED ON THE
     * TAILNET, the floor's own word from its hello, which is the fact a
     * REMOTE reader needs: `terminalHost` true with this false means the
     * desktop is running terminals it will not let anyone attach to from
     * another device, and a card drawn on the first fact alone is tappable
     * and dead.
     *
     * OPTIONAL, and absence reads as FALSE. A slice published by a peer older
     * than TM-2 simply does not carry it, and the tolerant-reader law says a
     * missing field is "it did not say" — which for a promise of reachability
     * is a no. */
    terminalMesh: z.boolean().optional(),
    docHost: z.boolean(),
    push: z.boolean(),
  })
  .passthrough();
export type DeviceCapabilities = z.infer<typeof DeviceCapabilities>;

/** How to reach this device's product surface. Recorded delta from the spec's
 * "(mesh.serve name)": the FULL capability URL rides here too — C3's secret-path
 * design means the serve name alone cannot be dialed, and this store is the
 * distribution channel C3 reserved for it. `url` is present only while the
 * serve is active.
 *
 * ERRATA (2026-09-13, EL7 M1): this paragraph called the store
 * "same-user-private" and readers took that as a guarantee. It was not one.
 * truffle-core broadcast to EVERY tailnet node whose hostname started with
 * `truffle-vibefield-` — no WhoIs, no login check on the store's own path — so
 * the store's audience was the APP's tailnet peers, and same-user held by
 * DEPLOYMENT (UA-D5: the tailnet is this person's) rather than by construction.
 *
 * RESOLVED (2026-09-16, UA-P-4): it is same-account BY CONSTRUCTION now, and
 * the erratum above is kept because the reasoning it corrected is the reasoning
 * that must not come back. RFC 025 gates the node on the linked login, so a
 * store reaches only nodes whose owner's login matches (§3.3), a foreign hello
 * is refused before our identity block (§3.4), and a slice applies only under
 * its sender's authenticated device id (§3.5). GM-D10's posture question is
 * closed by UA-P-D2: the store is scoped to the login identity.
 *
 * WHAT DID NOT CHANGE, and is the more important half: this URL is a LOCATOR,
 * not a capability. UA-P-0d (D7) moved the route secret to the sidecar's target
 * path, so a caller dials a bare root and the sidecar adds the secret on
 * forward. The DOOR behind this URL is still the gate — WhoIs, scopes, the
 * `guestOk` choke — and the gate on the bus does not stand in for it. */
export const ProductEndpoint = z
  .object({
    serve: z.string().min(1).max(DEVICE_LIMITS.ENDPOINT_SERVE_CHARS),
    url: z.string().min(1).max(DEVICE_LIMITS.ENDPOINT_URL_CHARS).optional(),
  })
  .passthrough();
export type ProductEndpoint = z.infer<typeof ProductEndpoint>;

/** TS-3b (P9, TS-D17 A) — where a device's name came from: the person gave it
 * (`user`, kept on that device only), or it is the computer's (`hostname`,
 * D30's fallback). Optional everywhere: a slice from an older daemon says neither. */
export const DeviceNameSource = z.enum(["user", "hostname"]);
export type DeviceNameSource = z.infer<typeof DeviceNameSource>;

/** One device's self-published slice in `field.devices.v1` (published on boot
 * and on change; the slice key IS the writer's mesh deviceId — D30). */
export const DeviceSlice = z
  .object({
    deviceId: z.string().min(1).max(DEVICE_LIMITS.DEVICE_ID_CHARS),
    name: z.string().min(1).max(DEVICE_LIMITS.NAME_CHARS),
    nameSource: DeviceNameSource.optional(),
    platform: z.string().min(1).max(DEVICE_LIMITS.PLATFORM_CHARS),
    headless: z.boolean(),
    fielddVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS),
    contractsVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS),
    /** AU-3a (AU-D13 A; LC-20) — the VibeField app this desktop runs, from
     * the build id its launcher gave fieldd (`fielddVersion` is the daemon
     * package's own and never moves between builds). Optional and tolerant: an
     * older peer does not say it, and a malformed one drops ALONE, never the
     * slice (a slice that fails `DeviceSlice` is dropped at intake with the
     * device's capabilities). */
    appVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional().catch(undefined),
    capabilities: DeviceCapabilities,
    productEndpoint: ProductEndpoint.optional(),
    bootId: z.string().min(1).max(DEVICE_LIMITS.BOOT_ID_CHARS),
    publishedAt: z.number().int(),
  })
  .passthrough();
export type DeviceSlice = z.infer<typeof DeviceSlice>;

/** DS-L8 (2026-09-30) — asleep is a state, not an absence: the roster tells
 * the three apart, plus the skewed peer DS-L9 names.
 *  - `awake`: its door answers (or nothing says otherwise while the tailnet
 *    lists it online — a peer never dialled is not a silent one); self always.
 *  - `restarting`: its NODE is on the tailnet and its DAEMON is silent — the
 *    last forward to its door went unanswered at the transport. field-native
 *    outlives fieldd, and the tailnet's `online` flag is the node's.
 *  - `asleep`: the tailnet says it is not online.
 *  - `incompatible`: its door refused our contracts major (the link's pin);
 *    it is not asked until this daemon restarts. */
export const DeviceState = z.enum(["awake", "restarting", "asleep", "incompatible"]);
export type DeviceState = z.infer<typeof DeviceState>;

/** Item 406 (WI-W5b A; VF-PM's Q-PM2, 2026-11-14) — how a desktop of this account came to KNOW a
 * device is a phone: the device spoke to it as one.
 *  - `freeway`: its freeway link opened with the PHONE's hello (`FreewayHello`, an approval),
 *    never a desktop's (`FreewayPeerHello`).
 *  - `product`: its product hello said `clientKind: "ios"`.
 * Closed on purpose: a word this build does not know is no fact (its readers drop it), so a reader
 * errs toward offering no Remove, never toward refusing a desktop. */
export const PhoneEvidence = z.enum(["freeway", "product"]);
export type PhoneEvidence = z.infer<typeof PhoneEvidence>;

/** Item 406 — the POSITIVE phone fact, the only one Remove is offered on. "Not a desktop" is not
 * it: a desktop whose slice has not arrived has no `docHost` either (fieldd's freeway predicate
 * reads such a row as a phone), and a refusal is never lifted, so a desktop removed on that guess
 * would stay refused on every desktop of the account. */
export const PhoneFact = z
  .object({
    via: PhoneEvidence,
    /** when a desktop of the account last saw it speak as a phone (unix ms) */
    at: z.number().int().nonnegative(),
  })
  .passthrough();
export type PhoneFact = z.infer<typeof PhoneFact>;

/** The roster row. `online` derives from tailnet peer state (self is always
 * online); `lastSeenAt` = max(publishedAt, peer last-seen) — honest without
 * heartbeats. `link` is PeerLink's live verdict about OUR connection to the
 * device (C5/D32) — absent when never dialed.
 *
 * UA-P-0e (D2, 2026-09-15) — THE SLICE-DERIVED FACTS ARE OPTIONAL, and this row
 * no longer extends `DeviceSlice`. It used to: a roster row WAS a slice fused
 * with liveness, so every field a peer published was a field the roster
 * required. That coupling is what made the row undescribable the moment the bus
 * went quiet, and it stays broken on purpose.
 *
 * UA-P-4 (2026-09-16) — the slices are back (RFC 025 scopes the bus to the
 * account), so a peer row usually carries them again. They remain OPTIONAL
 * because their absence is a real and ordinary state: a self peer the registry
 * lists before its slice has arrived, a peer that published none, a mesh still
 * coming up. A row is then built from the tailnet's own facts — the peer
 * registry, its WhoIs login, a DERIVED door locator — and says nothing it
 * cannot source.
 *
 * Which is the tolerant-reader law applied to ourselves: a peer's OS, its
 * fieldd version, what it can host are claims a device makes about itself, and
 * absence is the honest answer until it has made them. SELF still carries every
 * field; it is this process, and nothing about it has to cross a wire.
 *
 * MEMBERSHIP IS NOT A SLICE'S TO GRANT. A row exists for a device the tailnet's
 * own registry lists for this account; a slice may describe such a device and
 * may never add one. */
export const DeviceInfo = z
  .object({
    deviceId: z.string().min(1).max(DEVICE_LIMITS.DEVICE_ID_CHARS),
    name: z.string().min(1).max(DEVICE_LIMITS.NAME_CHARS),
    /** TS-3b — whether the person named this device (so "Use the computer's
     * name" is offered), as its own slice says. */
    nameSource: DeviceNameSource.optional(),
    platform: z.string().min(1).max(DEVICE_LIMITS.PLATFORM_CHARS).optional(),
    headless: z.boolean().optional(),
    fielddVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional(),
    contractsVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional(),
    /** AU-3a (LC-20) — the app version its slice says, copied at intake.
     * Absent while the device has not said it (an older build, a dev build, a
     * slice not yet arrived); a malformed one drops alone, so a roster read
     * from another daemon still parses. */
    appVersion: z.string().min(1).max(DEVICE_LIMITS.VERSION_CHARS).optional().catch(undefined),
    capabilities: DeviceCapabilities.optional(),
    /** UA-P-0e, kept by UA-P-4 — for a PEER this is a derived LOCATOR
     * (`http://<magicdns>:<the registry's product serve port>`) in preference
     * to anything the peer published, and never a secret: D7 moved the route
     * secret to the sidecar's target path, so a door coordinate is all there is
     * to hold. The scoped bus makes a published URL an account peer's claim
     * rather than a stranger's; it is still a claim, and `peer-link` dials it.
     * For SELF it is this daemon's own serve, `url` present only while it is
     * active. */
    productEndpoint: ProductEndpoint.optional(),
    bootId: z.string().min(1).max(DEVICE_LIMITS.BOOT_ID_CHARS).optional(),
    publishedAt: z.number().int().optional(),
    self: z.boolean(),
    online: z.boolean(),
    lastSeenAt: z.number().int(),
    /** DS-L8 — ADDITIVE beside `online` (kept: old readers read it). This
     * daemon always sets it; optional so a roster read from an older peer
     * (a federated `device.list {device}`) still parses. */
    state: DeviceState.optional(),
    link: z.enum(["connected", "dialing", "incompatible"]).optional(),
    /** The Tailscale stable node id, when the peer registry correlates it to
     * this device (PeerInfo.deviceId ⋈ slice key). This is the DIAL/liveness
     * keyspace — `lane.open`, doc-sync peers, the C5 endpoint door — distinct
     * from `deviceId` (the durable ULID roster key, D30); the two never collide
     * and must never be joined against each other (T1 §6). Absent for self and
     * for devices the registry does not currently list. */
    tailscaleId: z.string().optional(),
    /** Authenticated MagicDNS hostname derived from PeerInfo.whois.deviceName
     * only after the lawful ULID → Tailscale-id registry join. It is deliberately
     * absent from DeviceSlice: a peer may not self-assert the host used to bind
     * an Artifact Hub URL. */
    tailnetDnsName: z.string().min(1).max(253).optional(),
    /** Item 406 — POSITIVE: this device spoke to a desktop of the account as a phone
     * (`PhoneFact`), seen live or remembered by the account's known phones (`KnownPhone`).
     * Absence says nothing: a desktop, a row whose kind is not known yet, a roster from an older
     * daemon. ADDITIVE and tolerant: a malformed fact drops ALONE, never the row, so no reader
     * offers Remove on a word it cannot read. */
    phone: PhoneFact.optional().catch(undefined),
  })
  .passthrough();
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const DeviceListResult = z.object({ devices: z.array(DeviceInfo) }).passthrough();
export type DeviceListResult = z.infer<typeof DeviceListResult>;

export const DeviceGetParams = z.object({ deviceId: z.string() }).passthrough();
export type DeviceGetParams = z.infer<typeof DeviceGetParams>;

/** TS-3b (P9, TS-D17 A) — `device.rename`: the person's own name for THIS
 * device, 1–`DEVICE_LIMITS.NAME_CHARS` characters once trimmed; `null` is "Use
 * the computer's name". A longer name is refused with its count, never clipped. */
export const DeviceRenameParams = z
  .object({ name: z.string().trim().min(1).max(DEVICE_LIMITS.NAME_CHARS).nullable() })
  .passthrough();
export type DeviceRenameParams = z.infer<typeof DeviceRenameParams>;

/** TS-3b — `LAYOUT.DEVICE_NAME_FILE` (0600, written atomically): the name the
 * person gave this device. On this device only — never a synced preference,
 * which would name every device alike, and never across the sync plane (M16). */
export const DeviceNameFile = z
  .object({
    name: z.string().min(1).max(DEVICE_LIMITS.NAME_CHARS),
    setAt: z.number().int(),
  })
  .passthrough();
export type DeviceNameFile = z.infer<typeof DeviceNameFile>;

// --- Item 406 — Remove for a phone (track WI's Desktop slice; WI-W5 A, WI-W5b A; VF-PM's rulings
// of 2026-11-14 04:49Z). The person presses Remove on a phone's row on any of their computers. That
// desktop writes the refusal into the settings document every desktop of the account already shares
// (`SETTINGS_DOC_SECTIONS.DEVICES_REFUSED`), and each desktop, as the merged list reaches it, forgets
// the phone, closes what the phone holds there and refuses it at every door it controls. Tailscale
// lists the phone until the person removes it in Tailscale's admin console, which is the whole close.
// TS-only, like the rest of this file: the floor reads none of it, and the kit decodes the refusal's
// word by hand.

/** A phone's node ids, in `DeviceInfo.tailscaleId`'s keyspace: what a door sees (the sidecar's
 * `Tailscale-Node-Id`), never the durable roster id. */
const NodeIds = z
  .array(z.string().min(1).max(DEVICE_LIMITS.NODE_ID_CHARS))
  .max(DEVICE_LIMITS.NODE_IDS_PER_ENTRY);

/** Item 406 — `device.remove`: refuse one of this account's PHONES on every desktop of the
 * account. `deviceId` is the roster's durable id (the ULID, D30), never a node id: the handler
 * reads the phone's node ids from the roster and the known phones. The handler (S3) refuses This
 * Mac and every row that is not positively a phone (`PhoneFact`). */
export const DeviceRemoveParams = z
  .object({ deviceId: z.string().min(1).max(DEVICE_LIMITS.DEVICE_ID_CHARS) })
  .passthrough();
export type DeviceRemoveParams = z.infer<typeof DeviceRemoveParams>;

/** Item 406 — what `device.remove` answers. DECLARATIVE (the method row's `idempotent`): a refused
 * device is refused once, so `removed` is false when the refusal already stood (a second Remove, or
 * another desktop's that this one has merged) and nothing new is written. `closed` counts the
 * phone's live connections THIS desktop closed in its sweep: product sockets, freeway links,
 * transcript readers. Every other desktop closes its own as the merged list reaches it, and no
 * answer here can say when that is. */
export const DeviceRemoveResult = z
  .object({
    removed: z.boolean(),
    closed: z.number().int().nonnegative(),
  })
  .passthrough();
export type DeviceRemoveResult = z.infer<typeof DeviceRemoveResult>;

/** Item 406 (Q-PM1) — one entry of the settings document's `devices.refused`, keyed
 * `[deviceId, eventId]` (a JSON tuple, as the install-set's revocations are, so no id alphabet can
 * collide). GROW-ONLY: an entry is never deleted, so the merge is the union and a concurrent Remove
 * is never lost. It is written under a `no-undo:` origin, so no undo reaches it (D29′ law 2), and no
 * method lifts it. A phone is refused when its durable id, or any of its node ids, is in the union
 * of every entry.
 *  - `tailscaleIds`: the phone's node ids as the writing desktop knew them; empty when it knew
 *    none, since the durable id alone refuses the roster row. A desktop that later sees a refused
 *    durable id under a NEW node id appends an entry of its own carrying it, `removedAt` the time
 *    it appended it.
 *  - `by`: the roster id of the desktop that wrote the entry.
 * Never the phone's name: the refusal outlives the phone's row and needs only its ids. */
export const RefusedDevice = z
  .object({
    tailscaleIds: NodeIds,
    removedAt: z.number().int().nonnegative(),
    by: z.string().min(1).max(DEVICE_LIMITS.DEVICE_ID_CHARS),
  })
  .passthrough();
export type RefusedDevice = z.infer<typeof RefusedDevice>;

/** Item 406 (Q-PM2) — one entry of the settings document's `devices.phones`, keyed by the phone's
 * durable id: what this account's desktops know of a phone. A lost phone that stays offline keeps
 * a row Remove can be offered on after a restart (truffle holds a peer's durable id in memory
 * only), and the row is positively a phone. Upserted when a node speaks as a phone (last writer
 * wins per key); DELETED by Remove.
 *  - `tailscaleIds`: its node ids, at least one (a phone speaks through a node).
 *  - `phone`: the positive fact, as last seen.
 *  - `name`: only where the row needs it, so the row of a phone offline after a restart can still
 *    be named. Nothing else about the phone is kept.
 * A deleted entry leaves the document's STATE only. The settings document keeps its operation
 * history in its snapshots (`LAYOUT.SETTINGS_DOC`), so a removed phone's entry, its name with it,
 * stays in that history. Nothing a person sees may promise that Remove erases it. */
export const KnownPhone = z
  .object({
    tailscaleIds: NodeIds.min(1),
    phone: PhoneFact,
    name: z.string().min(1).max(DEVICE_LIMITS.NAME_CHARS).optional(),
  })
  .passthrough();
export type KnownPhone = z.infer<typeof KnownPhone>;

/** Item 406 (Q-PM5) — the words of a refusal of a removed device, as contract strings. */
export const DEVICE_REFUSALS = {
  /** the reason a removed phone's product hello is answered with (`DeviceRemovedDetails`) */
  REASON_REMOVED: "device-removed",
  /** S3 (Q-PM6) — the reason a same-login hello the sidecar named no node for is answered with,
   * while any refusal stands (`DeviceUnidentifiedDetails`) */
  REASON_UNIDENTIFIED: "device-unidentified",
} as const;

/** Item 406 (Q-PM5) — the details of the UNAUTHORIZED, retryable false, that a desktop answers a
 * removed phone's product hello with before the door closes (`error-data.device-removed`). A close
 * before the hello is silent by the kit's policy, and an empty grant reads to the kit as another
 * account's desktop, so without this word the phone could only say its computer is out of reach,
 * which is false of a removed phone. It names nothing else: no time, no desktop, no id. A bare
 * UNAUTHORIZED (a bad token) carries no such reason and says nothing of a removal.
 * *Open, S3's to settle:* a same-login hello with NO node id is refused while any refusal stands
 * (Q-PM6), but such a hello cannot be known to be the removed phone, so it must not carry this
 * reason; its details are not ruled. */
export const DeviceRemovedDetails = z
  .object({ reason: z.literal(DEVICE_REFUSALS.REASON_REMOVED) })
  .passthrough();
export type DeviceRemovedDetails = z.infer<typeof DeviceRemovedDetails>;

// 406 (red, S3): STUBBED — refuses every value, so the row that reads it fails (the green commit's schema)
export const DeviceUnidentifiedDetails = z.custom<{ reason: "device-unidentified" }>(() => false);
export type DeviceUnidentifiedDetails = z.infer<typeof DeviceUnidentifiedDetails>;
