import { z } from "zod";
import { SemverString } from "./envelope";
import { IsoInstant } from "./trust-root";

// TD-0 / WP12a — `update-policy.json`, a release asset beside the update feed (EDP-37; distribution
// spec §12): the levers a release can pull on clients already installed — yank a version, stop all
// updates, require a person's yes, refuse an OS below a floor, and say a version is no longer
// supported. Signed by the `release` role and judged by TD-10's rules (`judgeSignedDocument`): a lower
// `version` than the last accepted is refused, an expired one is STALE and surfaced in doctor
// (trust-and-distribution.md §3–§4). An ABSENT asset means "no policy", never an error.
// TS-only: deliberately outside the Rust gen bundle until a native consumer exists (WP12a).

/** The channels (Release Docket RL4 (a), RM-D1): nightly, beta, stable. */
export const UPDATE_CHANNELS = ["nightly", "beta", "stable"] as const;
export const UpdateChannel = z.enum(UPDATE_CHANNELS);
export type UpdateChannel = z.infer<typeof UpdateChannel>;

/** WP12-D5 (build-wp12-updater.md): every release carries ONE policy PER CHANNEL, so a kill switch or a yank for
 * stable rides the next nightly without a stable re-cut; each document still names its own `channel`. Its signature
 * is the file's name plus `SIGNATURE_SUFFIX` (trust-and-distribution.md §3). */
export const updatePolicyFile = (channel: UpdateChannel): string => `update-policy.${channel}.json`;

export const UpdatePolicy = z
  .object({
    /** monotonic per channel; a client refuses a lower one than it last accepted (TD-10) */
    version: z.number().int().min(1),
    /** epoch ms when the release workflow wrote it */
    generatedAt: z.number().int().nonnegative(),
    /** 60 days after generatedAt (TRUST_FRESHNESS_DAYS.updatePolicy) */
    expires: IsoInstant,
    channel: UpdateChannel,
    /** the trust-root version the signing `release` key was named by */
    trustRootVersion: z.number().int().min(1),
    /** versions no client may install or stay offered */
    yanked: z.array(SemverString).max(256).default([]),
    /** stop every update on this channel until a later policy lifts it */
    killSwitch: z.boolean(),
    /** never apply without a person's explicit yes */
    requireUserConfirmation: z.boolean(),
    /** the oldest OS (and glibc on Linux) the newest release runs on; an older host is not offered it */
    floors: z
      .object({
        os: z.string().min(1).max(64).optional(),
        glibc: z.string().min(1).max(64).optional(),
      })
      .passthrough()
      .default({}),
    /** advisory: below this an UNSUPPORTED banner, never a block */
    minSupported: SemverString.optional(),
  })
  .passthrough()
  .superRefine((policy, ctx) => {
    if (new Set(policy.yanked).size !== policy.yanked.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["yanked"],
        message: "a version is yanked twice",
      });
    const expires = Date.parse(policy.expires);
    if (Number.isFinite(expires) && expires <= policy.generatedAt)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires"],
        message: "a policy cannot expire before it was generated",
      });
  });
export type UpdatePolicy = z.infer<typeof UpdatePolicy>;

// WP12-D4 (build-wp12-updater.md §3) — `channels.json`, the channel heads. Every release carries it, signed by the
// `release` role and judged by TD-10's rules like the policy: it names, at that release's publish time, the newest
// release of each channel. A client reads the NEWEST release's copy (the first entry of `releases.atom`, or
// `releases/latest/download/` for stable) and fetches its own channel's head by URL — so GitHub's truncated atom feed
// (~10 entries) can never hide a channel, and a beta client never resolves a nightly. TS-only, like the policy.

export const CHANNEL_HEADS_FILE = "channels.json" as const;

/** A nightly's tag: `nightly-YYYYMMDD`, never reused (RL4 (a); Immutable Releases burns a deleted release's name). */
export const NIGHTLY_TAG_PATTERN = /^nightly-\d{8}$/;
/** A beta's tag: `vX.Y.Z-beta.N` (EDP-36). */
export const BETA_TAG_PATTERN = /^v\d+\.\d+\.\d+-beta\.\d+$/;
/** A stable's tag: `vX.Y.Z` with no prerelease (EDP-36's re-tag of the last beta's commit). */
export const STABLE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

const HEAD_PATTERNS: Record<UpdateChannel, RegExp> = {
  nightly: NIGHTLY_TAG_PATTERN,
  beta: BETA_TAG_PATTERN,
  stable: STABLE_TAG_PATTERN,
};

export const ChannelHeads = z
  .object({
    schemaVersion: z.literal(1),
    /** monotonic across releases (the publishing workflow's run number is enough); a lower one is a rollback */
    version: z.number().int().min(1),
    /** epoch ms when the release workflow wrote it */
    generatedAt: z.number().int().nonnegative(),
    /** the policy's freshness: 60 days (TRUST_FRESHNESS_DAYS.updatePolicy) */
    expires: IsoInstant,
    /** the trust-root version the signing `release` key was named by */
    trustRootVersion: z.number().int().min(1),
    /** each channel's newest release tag, or null when the channel has none yet ("channel-unresolved", quietly) */
    heads: z
      .object({
        nightly: z.string().max(128).nullable(),
        beta: z.string().max(128).nullable(),
        stable: z.string().max(128).nullable(),
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((doc, ctx) => {
    for (const channel of UPDATE_CHANNELS) {
      const head = doc.heads[channel];
      if (head !== null && !HEAD_PATTERNS[channel].test(head))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["heads", channel],
          message: `${channel} head "${head}" is not a ${channel} tag`,
        });
    }
    const expires = Date.parse(doc.expires);
    if (Number.isFinite(expires) && expires <= doc.generatedAt)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires"],
        message: "channel heads cannot expire before they were generated",
      });
  });
export type ChannelHeads = z.infer<typeof ChannelHeads>;

/** WP12 (TD-3, TD §4; build-wp12-updater.md §3) — the updater's honest states: `UnavailableDetails.service` and
 * `.state` on every refusal, named in doctor and in audit. TS-only (Electron main is the only producer). */
export const UPDATES_SERVICE = {
  SERVICE: "updates",
  /** a signature over channels, a policy or `latest*.yml` does not verify by the `release` role */
  STATE_FEED_UNVERIFIED: "feed-unverified",
  /** the policy or the channel heads are past `expires`: STALE, so nothing downloads (TD-10, fail closed) */
  STATE_POLICY_EXPIRED: "policy-expired",
  /** a policy or channel-heads `version` below the last accepted (TD-10) */
  STATE_POLICY_ROLLBACK: "policy-rollback",
  /** the release's `trust-root.json` does not verify by the embedded root keys, or is a rollback */
  STATE_TRUST_ROOT_REJECTED: "trust-root-rejected",
  /** no release in the feed, or the heads name none for the client's channel */
  STATE_CHANNEL_UNRESOLVED: "channel-unresolved",
  /** the policy's kill switch is on for this channel (EDP-37) */
  STATE_KILLED: "killed",
  /** the host is below the policy's OS (or glibc) floor; the release is skipped, never installed (EDP-37) */
  STATE_FLOOR_UNMET: "floor-unmet",
} as const;
export type UpdatesUnavailableState = (typeof UPDATES_SERVICE)[Exclude<
  keyof typeof UPDATES_SERVICE,
  "SERVICE"
>];

/** The update system's audit actions (EDP §11.6; TD §4: "every refusal names its clause … in doctor and in audit"),
 * appended by Electron main through fieldd's `audit.append`, which accepts only registered shell-owned actions.
 * WP12b: a check's verification outcome (`denied` with the refusal's reason code, e.g. `FEED_UNVERIFIED`) and a
 * person's per-version decline. The apply (WP12c) and the policy's levers and channel changes (WP12d) add theirs. */
export const UPDATES_AUDIT_ACTIONS = {
  VERIFY: "app.update.verify",
  DECLINE: "app.update.decline",
} as const;

const RememberedVersion = z.number().int().min(1).nullable();

/** WP12b (build-wp12-updater.md §3) — the updater's persisted CLIENT state (`<userData>/updates/state.json`): the
 * person's choices and TD-10's remembered versions. Written by Electron main only, never by the renderer (EDP-38).
 * An absent `enabled` is ON (the absent-settings default, EDP §13.1); an absent `channel` is the build's own. */
export const UpdateClientStateFile = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean().optional(),
    channel: UpdateChannel.optional(),
    /** versions the person declined: per-version, surviving restarts and a staged download (EDP §11.3) */
    declined: z.array(z.string().min(1).max(64)).max(64).default([]),
    /** the last ACCEPTED version of each signed document (TD-10); null = none accepted yet */
    remembered: z
      .object({
        trustRoot: RememberedVersion,
        channels: RememberedVersion,
        policy: z.object({
          nightly: RememberedVersion,
          beta: RememberedVersion,
          stable: RememberedVersion,
        }),
      })
      .default({
        trustRoot: null,
        channels: null,
        policy: { nightly: null, beta: null, stable: null },
      }),
    lastCheckAt: z.number().int().nonnegative().nullable().default(null),
  })
  .passthrough();
export type UpdateClientStateFile = z.infer<typeof UpdateClientStateFile>;
