import { z } from "zod";
import { SemverString } from "./envelope";
import { NativeRestartReason } from "./mgmt";
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
  /** WP12c (L2b-ii, `build-wp12-updater.md` §10 S3/S4) — the apply was refused and NOTHING was torn down, or what was
   * torn down came back (the pair respawned from the current bytes): Squirrel.Mac refused or timed out on the payload
   * (`squirrel-timeout`, its own named reason — a silent hang never masquerades as a gate), or its install failed after
   * the daemons stopped. The reason rides the refusal's detail, in doctor and in audit. */
  STATE_APPLY_REFUSED: "apply-refused",
  /** WP12c (§10 S1) — the session census could not be read (the inventory unobserved, the link down, no answer inside
   * its bound): the apply HOLDS (EDP-33: never auto-escalated), and the tray says so instead of offering the verb. */
  STATE_CENSUS_UNKNOWN: "census-unknown",
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
  /** WP12c (L2b-ii) — the apply: `succeeded` as the install is handed to Squirrel, `denied`/`failed` with the refusal's
   * reason (`SQUIRREL_TIMEOUT`, `SQUIRREL_REFUSED`, `SESSIONS_CHANGED`, `INSTALL_FAILED`), the consented count in attrs. */
  APPLY: "app.update.apply",
} as const;

const RememberedVersion = z.number().int().min(1).nullable();

/** WP12c (L2b-ii, `build-wp12-updater.md` §10 S4; the PM's rulings 13:36–13:38Z) — the last apply, written
 * SYNCHRONOUSLY before every exit the apply takes. After the daemon stop fieldd is gone, and the shell's audit row
 * travels through fieldd (wall R17), so the `app.update.apply` OUTCOME row is appended from here at the next launch,
 * once (`audited`); its ATTEMPT row was appended before the stop.
 *  - `installing`: the install was handed to Squirrel (`quitAndInstall`);
 *  - `relaunched`: Squirrel refused the payload (nothing armed) — the app relaunched on the current bytes;
 *  - `exited`: Squirrel timed out, or the install never took over — the app quit WITHOUT relaunch, because Squirrel may
 *    have armed the install (a downloaded update is applied at the next start: `electron.d.ts:2103-2104`). */
export const UpdateLastApply = z
  .object({
    at: z.number().int().nonnegative(),
    version: z.string().min(1).max(64),
    branch: z.enum(["installing", "relaunched", "exited"]),
    reason: z.enum(["squirrel-refused", "squirrel-timeout", "install-failed"]).optional(),
    /** how many sessions the person consented to end (0 at census zero) */
    consented: z.number().int().nonnegative(),
    /** the ATTEMPT row's operation id, so the outcome row appended at the next launch names the same operation */
    operationId: z.string().min(1).max(128).optional(),
    audited: z.boolean().default(false),
  })
  .passthrough();
export type UpdateLastApply = z.infer<typeof UpdateLastApply>;

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
    /** WP12c — the last apply's branch (`UpdateLastApply`); null = none since the state began */
    lastApply: UpdateLastApply.nullable().default(null),
  })
  .passthrough();
export type UpdateClientStateFile = z.infer<typeof UpdateClientStateFile>;

/** EDP-33 — the planes a release can touch. Which ones a release touches selects its consent model; until WP12e's
 * signed planes (L3), every release is treated as touching field-native (`build-wp12-updater.md` §2, §9). */
export const UPDATE_PLANES = ["shell", "fieldd", "field-native"] as const;
export const UpdatePlane = z.enum(UPDATE_PLANES);
export type UpdatePlane = z.infer<typeof UpdatePlane>;

/** WP12 L2b (§9 R3, the PM's correction 12:22Z) — a planned restart, announced on `system.health` before the stop
 * (`FielddHealth.restartScheduled`; null when none is scheduled). The LOCAL carrier only: `system.health.subscribe` is
 * local to its device (D36). The phone/peer half is `DeviceSlice.restart`, owed to the DS track. */
export const RestartScheduled = z
  .object({
    reason: NativeRestartReason,
    planes: z.array(UpdatePlane).min(1),
    /** epoch millis */
    at: z.number().int().nonnegative(),
  })
  .passthrough();
export type RestartScheduled = z.infer<typeof RestartScheduled>;

/** `system.shutdown` params (scope `native.admin`, local only). Absent `native` = fieldd stops alone and field-native
 * and its sessions keep running — the two-planes law (EL1), unchanged.
 *
 * `native` = WP12 L2b's ONE consented exception (design-00 EL1's 2026-10-15 note; §9 R2): an update that touches
 * field-native stops the floor too. `sessions` is the set the person consented to end — `[]` at census zero. fieldd
 * closes the terminal service to births, then compares its OWN live set (the observed inventory plus every session
 * born and not yet observed) with `sessions`: any difference, a birth in flight, or an unobserved inventory refuses
 * (`PRECONDITION_FAILED {live}` / `UNAVAILABLE {service: "terminal", state: "unobserved"}`) and reopens births; only
 * an exact match stops the floor (`native.lifecycle.prepareRestart` → `native.lifecycle.shutdown`), then fieldd. */
export const SystemShutdownParams = z
  .object({
    native: z
      .object({
        stop: z.literal(true),
        sessions: z.array(z.string().min(1).max(256)).max(4096),
        /** the app version the restart installs — recorded in the floor's intent, never parsed for behavior */
        toVersion: z.string().min(1).max(128).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type SystemShutdownParams = z.infer<typeof SystemShutdownParams>;

export const SystemShutdownResult = z
  .object({
    stopping: z.boolean(),
    detail: z.string().optional(),
    /** present when `native` was asked: how the floor's stop went (`closed` = its management socket closed; `forced` =
     * the kill ladder's backstop ran on a spawned floor; `lingering` = neither inside the bound) */
    native: z.enum(["closed", "forced", "lingering"]).optional(),
  })
  .passthrough();
export type SystemShutdownResult = z.infer<typeof SystemShutdownResult>;
