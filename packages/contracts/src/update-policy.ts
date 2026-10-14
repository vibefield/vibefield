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

export const UPDATE_POLICY_FILE = "update-policy.json" as const;

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
