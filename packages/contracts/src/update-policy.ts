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

/** EDP-33's planes (declared here, before the shapes that name them; `UPDATE_PLANES` below is the same list). */
const UPDATE_PLANES_LIST = ["shell", "fieldd", "field-native"] as const;

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

/** WP12-D5 (L3a) — a channel's COMMITTED policy source, `apps/desktop/packaging/policy/<channel>.json`, edited by PR: the
 * policy minus what the release workflow's sign step stamps (`generatedAt`, `expires`, `trustRootVersion`). The sign
 * step refuses a changed body without a `version` bump, and a `version` below the last published one. */
export const UpdatePolicySource = z
  .object({
    version: z.number().int().min(1),
    channel: UpdateChannel,
    yanked: z.array(SemverString).max(256).default([]),
    killSwitch: z.boolean(),
    requireUserConfirmation: z.boolean(),
    floors: z
      .object({
        os: z.string().min(1).max(64).optional(),
        glibc: z.string().min(1).max(64).optional(),
      })
      .passthrough()
      .default({}),
    minSupported: SemverString.optional(),
  })
  .passthrough();
export type UpdatePolicySource = z.infer<typeof UpdatePolicySource>;

/** WP12-D11 (L3a) — `release-manifest.json`: the release's bytes per plane, signed by `release` like the feed. The
 * planes a release TOUCHES are computed — each plane's digest against the previous release's manifest — never declared
 * by hand (a hand-declared list is how a native change rides a "shell-only" release). The first release touches every
 * plane. The client reads it from L3b on; until then every release counts as touching field-native.
 *
 * L3b-i (the PM's ruling 2026-10-15 16:03Z, B3): the client decides by DIGEST, never by `touched` alone (a client may
 * skip releases, and nightly releases are deleted at 14 days). It hashes its OWN installed field-native plane and
 * compares it with the head's — and that plane is field-native AND every executable it execs from its own directory
 * (`field-terminal-host`; `field-freeway-host`, F1; `sidecar-slim` or `truffle-sidecar`, whichever it finds), so the
 * manifest NAMES the plane's members and a missing or extra member reads as touched. Each digest line is
 * `path\0sha256`, the path relative to the app's resources directory for a file inside it (`bin/field-native`) and
 * relative to the app otherwise. */
export const RELEASE_MANIFEST_FILE = "release-manifest.json" as const;

/** The release workflow's platform keys (`builds` below; `release.yml`'s matrix): `<mac|win|linux>-<arch>`. */
export function releasePlatformKey(platform: string, arch: string): string {
  const os = platform === "darwin" ? "mac" : platform === "win32" ? "win" : platform;
  return `${os}-${arch}`;
}

const ReleasePlaneDigest = z.object({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  files: z.number().int().nonnegative(),
  /** the plane's members, resources-relative and sorted (REQUIRED for field-native: B3 compares the set itself) */
  members: z.array(z.string().min(1).max(256)).max(64).optional(),
});
export const ReleaseManifest = z
  .object({
    /** Additive at 1 only: a bump, or a retyped field, makes every installed app refuse the whole chain
     * (`feed-unverified`). */
    schemaVersion: z.literal(1),
    /** the app version (D6) */
    version: SemverString,
    tag: z.string().min(1).max(128),
    channel: UpdateChannel,
    /** the source commit the release was built from */
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    /** per platform build, per plane: a sha256 over the plane's sorted `path\0sha256` lines, and its file count */
    builds: z.record(
      z.string().min(1).max(32),
      z.record(z.enum(UPDATE_PLANES_LIST), ReleasePlaneDigest),
    ),
    /** the planes whose digest differs from the previous release's on any platform (every plane on a first release) */
    touched: z.array(z.enum(UPDATE_PLANES_LIST)),
    /** the tag the comparison was made against; null on a first release */
    previous: z.string().min(1).max(128).nullable(),
    /** AU-6 — the release's notes, signed with the manifest. Declared LOOSELY here: an installed client verifies the
     * chain by this schema, so a notes block it cannot read must never refuse its updates. verify-chain parses it
     * separately (`ReleaseNotes.safeParse`) and drops it, logged; `release-verify` parses it strictly at publish.
     * Absent on every manifest before AU-6. */
    notes: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((manifest, ctx) => {
    for (const [platform, planes] of Object.entries(manifest.builds)) {
      const native = planes["field-native"];
      if (native === undefined) continue;
      const members = native.members;
      if (members === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builds", platform, "field-native", "members"],
          message: "the field-native plane names its members",
        });
        continue;
      }
      const sorted = [...new Set(members)].sort();
      if (sorted.length !== members.length || sorted.some((m, i) => m !== members[i]))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builds", platform, "field-native", "members"],
          message: "members are sorted and unique",
        });
      if (members.length !== native.files)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builds", platform, "field-native", "files"],
          message: "files counts the members",
        });
    }
  });
export type ReleaseManifest = z.infer<typeof ReleaseManifest>;

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
  /** WP12d (L3b-i, the PM's ruling 2026-10-15 16:03Z, B2) — an apply needs a FRESH verified policy, read at the click;
   * the origin could not be reached (offline, a network error, no answer in its bound), so the apply HOLDS. No offline
   * allowance: the kill switch is 1.0's only emergency lever, and its worth is how fast clients see it. */
  STATE_POLICY_UNREACHABLE: "policy-unreachable",
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
   * reason (`SQUIRREL_TIMEOUT`, `SQUIRREL_REFUSED`, `SESSIONS_CHANGED`, `INSTALL_FAILED`), the consented count in attrs.
   * WP12d (L3b-i) adds the levers' refusals — `KILLED`, `YANKED`, `FLOOR_UNMET` on `app.update.verify` (a check that
   * found a release it may not offer) and on `app.update.apply` (a policy re-read at the click), and
   * `POLICY_UNREACHABLE` / `POLICY_UNVERIFIED` on `app.update.apply`. AU-1: the ATTEMPT row's `trigger` attr is who
   * began it (`person`, `silent`); the next launch's OUTCOME row adds `from` and `began` (`UpdateApplyTrigger`:
   * `restart`, `silent`, `quit`) from the record, never a second `trigger`. AU-5: a quit-install appends no ATTEMPT
   * row (fieldd is already down); its OUTCOME row at the next launch carries `began: quit`, and `QUIT_HELD` when the
   * quit's own policy read held it. */
  APPLY: "app.update.apply",
  /** WP12d (L3c-i) — a person's channel change (EDP §11.6), `from` and `to` in attrs; a lower channel is a downgrade */
  CHANNEL: "app.update.channel",
  /** AU-1 (AU-G5, AU-G6) — a person's hand download: `why` is `updates-off` or `skipped` (the decline it removed) */
  DOWNLOAD: "app.update.download",
} as const;

// ── AU-6 (AU-D10 A; EDP §11.1 as amended 2026-10-29: "no remote markup; signed plain text only") ──
// A release's notes ride INSIDE `release-manifest.json`, under its one `release` signature. A line is plain text on one
// line, rendered as a text node: never markup, never linkified. The one link (the comparison) is composed by MAIN from
// its frozen origin and two verified tags, never read from the manifest (EDP-38).

/** LC-19 — a written release says at most 8 lines, a log at most 4 (one per track); a line at most 200 characters. */
export const RELEASE_NOTES_LIMITS = {
  WRITTEN_LINES: 8,
  LOG_LINES: 4,
  LINE_CHARS: 200,
  TRACK_CHARS: 24,
} as const;

/** One line of plain text: no control or format character (bidi overrides, zero-width) and no line separator. */
export const ReleaseNoteText = z
  .string()
  .min(1)
  .max(RELEASE_NOTES_LIMITS.LINE_CHARS)
  .regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u, "one line of plain text");

/** The release the notes count from: the manifest's `previous`, with its version (the words name it). */
const ReleaseNotesSince = z
  .object({ version: SemverString, tag: z.string().min(1).max(128) })
  .passthrough();

export const ReleaseNotes = z
  .discriminatedUnion("kind", [
    // a stable (it refuses to publish without `apps/desktop/packaging/notes/<X.Y.Z>.txt`), or a beta that has one
    z
      .object({
        kind: z.literal("written"),
        since: ReleaseNotesSince.nullable(),
        lines: z.array(ReleaseNoteText).min(1).max(RELEASE_NOTES_LIMITS.WRITTEN_LINES),
      })
      .passthrough(),
    // a nightly, or a beta with no file (LC-19): read from the log since the channel's previous release
    z
      .object({
        kind: z.literal("log"),
        since: ReleaseNotesSince,
        /** the non-merge commits in `since..commit` */
        commits: z.number().int().nonnegative(),
        /** those outside the docs (a `docs:` subject is the docs) */
        product: z.number().int().nonnegative(),
        /** the newest subject per track prefix, newest first, cut at its first " — "; a `Release-note:` trailer
         * replaces its commit's subject */
        lines: z
          .array(
            z
              .object({
                track: z.string().min(1).max(RELEASE_NOTES_LIMITS.TRACK_CHARS).optional(),
                text: ReleaseNoteText,
              })
              .passthrough(),
          )
          .max(RELEASE_NOTES_LIMITS.LOG_LINES),
      })
      .passthrough(),
  ])
  // zod 3 refuses a ZodEffects member inside a discriminatedUnion, so the cross-field rule sits on the union
  .superRefine((notes, ctx) => {
    if (notes.kind === "log" && notes.product > notes.commits)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["product"],
        message: "product counts within commits",
      });
  });
export type ReleaseNotes = z.infer<typeof ReleaseNotes>;

/** The notes as the window reads them: the verified notes of `version`, and the comparison main composed. */
export const ReleaseNotesView = z
  .object({
    /** the release the notes describe */
    version: z.string().min(1).max(64),
    body: ReleaseNotes,
    /** composed by MAIN from its frozen update origin and two verified tags; never read from the manifest */
    compareUrl: z.string().url().max(512).optional(),
  })
  .passthrough();
export type ReleaseNotesView = z.infer<typeof ReleaseNotesView>;

// ── AU-1 (AU-D11 A) — an apply, as the window says it afterwards ──

/** How an apply began: a person's Restart to Update (the tray, Settings, the Me menu), the safe window's silent apply
 * (B4), or a person's quit (AU-5). All three are declared here so no later slice grows the enum an older app reads. */
export const UPDATE_APPLY_TRIGGERS = ["restart", "silent", "quit"] as const;
export const UpdateApplyTrigger = z.enum(UPDATE_APPLY_TRIGGERS);
export type UpdateApplyTrigger = z.infer<typeof UpdateApplyTrigger>;

/** What the first launch after an apply found: it runs the version (`installed`) or it does not (`not-applied`). */
export const UPDATE_APPLY_OUTCOMES = ["installed", "not-applied"] as const;
export const UpdateApplyOutcome = z.enum(UPDATE_APPLY_OUTCOMES);
export type UpdateApplyOutcome = z.infer<typeof UpdateApplyOutcome>;

const RememberedVersion = z.number().int().min(1).nullable();

/** WP12c (L2b-ii, `build-wp12-updater.md` §10 S4; the PM's rulings 13:36–13:38Z) — the last apply, written
 * SYNCHRONOUSLY before every exit the apply takes. After the daemon stop fieldd is gone, and the shell's audit row
 * travels through fieldd (wall R17), so the `app.update.apply` OUTCOME row is appended from here at the next launch,
 * once (`audited`); its ATTEMPT row was appended before the stop.
 *  - `installing`: the install was handed to Squirrel (`quitAndInstall`);
 *  - `relaunched`: Squirrel refused the payload (nothing armed) — the app relaunched on the current bytes;
 *  - `exited`: Squirrel timed out, or the install never took over — the app quit WITHOUT relaunch, because Squirrel may
 *    have armed the install (a downloaded update is applied at the next start: `electron.d.ts:2103-2104`).
 * AU-1 adds `from`, `trigger` and `landed`, all tolerant (`.catch`), never a new `branch` or `reason` value; AU-6 adds
 * `notes`, tolerant the same way.
 * AU-5 (install on quit, `trigger: "quit"`): nothing relaunches on any branch — `installing`, or `exited` with Squirrel's
 * refusal or timeout, or with no reason when the quit's own policy read held the install. */
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
    /** AU-1 — the version this apply LEFT (the running app's, written with the record); absent on a record an older
     * app wrote */
    from: z.string().min(1).max(64).optional().catch(undefined),
    /** AU-1 — how the apply began; absent on a record an older app wrote (the window then says "restarted") */
    trigger: UpdateApplyTrigger.optional().catch(undefined),
    /** AU-1 — judged ONCE, at the first launch after the record and before its OUTCOME row is delivered: `installed`
     * when that launch runs `version`, else `not-applied`; `at` is that launch's clock (the window's "for a day" counts
     * from it). Absent while the apply's own process runs, and on a record an older app already delivered (`audited`
     * without `landed` is history: never judged, never shown). */
    landed: z
      .object({ at: z.number().int().nonnegative(), outcome: UpdateApplyOutcome })
      .passthrough()
      .optional()
      .catch(undefined),
    /** AU-6 — the verified notes of `version`, copied from `staged` when the record is written, so "What's new"
     * reads offline after the relaunch */
    notes: ReleaseNotes.optional().catch(undefined),
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
    /** AU-1 (AU-D3 A) — the version staged on this Mac and when it FIRST became ready: kept while the same version
     * re-stages after a relaunch (so "Ready since Oct 19" is true), replaced when another version stages, cleared when
     * its payload is collected (declined, a channel change, a lever, a check that finds nothing) or it installs. */
    staged: z
      .object({
        version: z.string().min(1).max(64),
        at: z.number().int().nonnegative(),
        /** AU-6 — the staged version's verified notes, kept so a later check that finds a newer head never swaps
         * them */
        notes: ReleaseNotes.optional().catch(undefined),
      })
      .passthrough()
      .nullable()
      .default(null)
      .catch(null),
    /** WP12d (L3b-ii, B5; the PM's ruling 2026-10-15 16:03Z) — the trust-root DOCUMENTS this client adopted by rotation,
     * oldest first, each with its detached signature, never bare keys: re-verified from the app's EMBEDDED root keys at
     * every load, each by the set before it (a same-uid writer cannot forge one, EL7), and the newest that verifies
     * anchors the next check. A chain that breaks is dropped from the break on, loudly. */
    trustRoots: z
      .array(
        z.object({
          version: z.number().int().min(1),
          doc: z.string().min(1).max(65_536),
          sig: z.string().min(1).max(8_192),
        }),
      )
      .max(16)
      .default([]),
  })
  .passthrough();
export type UpdateClientStateFile = z.infer<typeof UpdateClientStateFile>;

/** EDP-33 — the planes a release can touch. Which ones a release touches selects its consent model; until WP12e's
 * signed planes (L3), every release is treated as touching field-native (`build-wp12-updater.md` §2, §9). */
export const UPDATE_PLANES = UPDATE_PLANES_LIST;
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
 * an exact match stops the floor (`native.lifecycle.prepareRestart` → `native.lifecycle.shutdown`), then fieldd.
 *
 * `reason` (AL-2, 2026-10-27) — why the shell asks: `update`, or a person's `quit`, or the OS's `logout`. It rides into
 * the floor's intent and the logs; absent = `update`, the only caller before it (the apply port, `replaceStaleBuild`'s
 * plain stop). It changes no rule: a native stop is an exact consented match whatever the reason. */
export const SystemShutdownParams = z
  .object({
    reason: NativeRestartReason.optional(),
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

// ── WP12d (L3c-i; `build-wp12-updater.md` §13, the PM's ruling 2026-10-15 18:17Z) — the updater over the HOST BRIDGE ──
// The renderer's Settings card and the tray read ONE projection of the updater (`UpdateController.view()` in main)
// and act through narrow host doors (the preload's allowlist; `IPC_CHANNELS.update*`). The bridge, not fieldd, because
// an updater must work with fieldd broken (EDP §11.3). No door carries a path or a URL (EDP-38); main validates each.

/** AU-1 (AU-D11 A; AU-G7) — the last apply as the window says it, once a launch has judged it
 * (`UpdateLastApply.landed`). An `installed` apply is projected only while its `version` runs (another build on the
 * same state never reads "Updated today" of it). Main applies no time filter (a view is not re-emitted as time
 * passes): the window decides "Updated today" against `at`, as `checkedLabel` does for `lastCheckAt`. */
export const UpdateViewLastApply = z
  .object({
    version: z.string().min(1).max(64),
    /** the version it left; absent when an older app wrote the record */
    from: z.string().min(1).max(64).optional(),
    outcome: UpdateApplyOutcome,
    /** epoch ms of the first launch after the apply (`landed.at`) */
    at: z.number().int().nonnegative(),
    /** how it began; absent on an older app's record */
    trigger: UpdateApplyTrigger.optional(),
    /** true only in the launch that judged it, and only when that launch runs the version the apply left (or landed
     * on): a failed install is said once, by the launch that found it, and never by a third version */
    thisLaunch: z.boolean().optional(),
    /** AU-6 — installed only: what's new in `version` */
    notes: ReleaseNotesView.optional(),
  })
  .passthrough();
export type UpdateViewLastApply = z.infer<typeof UpdateViewLastApply>;

/** AU-7 (AU-G8; LC-10) — macOS: where this bundle runs. `read-only` (App Translocation, a mounted disk image, an
 * unwritable parent folder) cannot update itself: decide holds it and the apply refuses before anything stops.
 * `elsewhere` is writable and updates as usual. */
export const UPDATE_APP_LOCATIONS = ["applications", "elsewhere", "read-only"] as const;
export const UpdateAppLocation = z.enum(UPDATE_APP_LOCATIONS);
export type UpdateAppLocation = z.infer<typeof UpdateAppLocation>;

/** The updater as the person sees it: the tray's item and the Settings card both render THIS. */
export const UpdateView = z
  .object({
    phase: z.enum([
      "idle",
      "checking",
      // L3c-ii — found, and NOT downloading: the person skipped it, or turned updates off (a manual check still runs)
      "available",
      "downloading",
      "staged",
      "paused",
      "unsupported",
      "failed",
      "offline",
    ]),
    /** available, downloading or staged */
    version: z.string().min(1).max(64).optional(),
    /** available: the person skipped this version ("Skip this version"), held across restarts */
    declined: z.boolean().optional(),
    /** downloading: coarse, 0–100 */
    percent: z.number().min(0).max(100).optional(),
    /** staged: the live sessions the last census read, or `unknown` (the verb holds) */
    sessions: z.union([z.number().int().nonnegative(), z.literal("unknown")]).optional(),
    /** staged: the release leaves the floor's bytes alone, so its apply ends no session (L3b-i, B3) */
    keepsSessions: z.boolean().optional(),
    /** staged: what holds the apply, named (`sessions`, `census-unknown`, `policy-unreachable`, …) */
    blockedBy: z.string().min(1).max(64).optional(),
    /** failed: the honest `UNAVAILABLE {service: "updates", state}` */
    unavailable: z.string().min(1).max(64).optional(),
    channel: UpdateChannel,
    /** the running build's own channel: a lower `channel` is a downgrade, and the card says so (EDP-36) */
    buildChannel: UpdateChannel,
    enabled: z.boolean(),
    lastCheckAt: z.number().int().nonnegative().nullable(),
    /** the apply exists on this platform (macOS); elsewhere nothing offers a restart */
    applyWired: z.boolean(),
    /** the advisory UNSUPPORTED line: the running version is below the policy's `minSupported` — never a block */
    unsupportedBelow: z.string().min(1).max(64).optional(),
    /** AU-1 (AU-G4; AU-D4 B) — the running app's exact version (`app.getVersion()`) */
    currentVersion: z.string().min(1).max(64).optional(),
    /** AU-1 (AU-D3 A; AU-G12) — staged: when `version` FIRST became ready on this Mac, across launches (epoch ms) */
    stagedAt: z.number().int().nonnegative().optional(),
    /** AU-1 (AU-D11 A; AU-G7) — the last apply, once a launch has judged it */
    lastApply: UpdateViewLastApply.optional(),
    /** AU-7 (AU-G8) — macOS only: where the app runs; absent elsewhere */
    location: UpdateAppLocation.optional(),
    /** AU-6 (AU-D10 A; AU-G10) — available, downloading or staged: the verified notes of `version`; absent when its
     * manifest carried none */
    notes: ReleaseNotesView.optional(),
    /** AU-6 (LC-18) — when this build was made (the staged identity's `builtAt`), epoch ms; absent on an older stage */
    builtAt: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type UpdateView = z.infer<typeof UpdateView>;

export const UpdateSetEnabledRequest = z.object({ enabled: z.boolean() }).strict();
export const UpdateSetChannelRequest = z.object({ channel: UpdateChannel }).strict();
export const UpdateDeclineRequest = z.object({ version: z.string().min(1).max(64) }).strict();
export const UpdateConfirmRequest = z.object({ token: z.string().min(16).max(128) }).strict();

/** One live session in the apply's census, as the consent names it (`title — cwd`); the id is what fieldd re-checks. */
export const UpdateConsentSession = z
  .object({
    sessionId: z.string().min(1).max(256),
    title: z.string().max(512).optional(),
    cwd: z.string().max(4096).optional(),
  })
  .passthrough();

/** Words the person reads when an apply does not start: the tray's native box and the card say the SAME sentence. */
export const UpdateWords = z
  .object({ message: z.string().min(1).max(256), detail: z.string().min(1).max(1024) })
  .passthrough();

/** L3c-ii — the consent's words, composed ONCE in main (`consentWords`): the tray's native box joins them, the Settings
 * card lays them out — the same sentence either way. Present only when the apply would end sessions. */
export const UpdateConsentWords = z
  .object({
    /** "Updating ends 2 terminal sessions" */
    message: z.string().min(1).max(256),
    /** "VibeField 1.2.0 replaces the terminal service, which ends:" */
    lead: z.string().min(1).max(512),
    /** up to five sessions as `title — cwd` */
    listed: z.array(z.string().min(1).max(4700)).max(16),
    /** the sessions past the listed ones ("and K more") */
    more: z.number().int().nonnegative(),
    /** the destructive act's own words: "End 2 sessions and update" */
    confirm: z.string().min(1).max(128),
  })
  .passthrough();
export type UpdateConsentWords = z.infer<typeof UpdateConsentWords>;

/** C2, the first phase: a FRESH policy, the planes, and ONE census snapshot — with a token bound to its ids. The
 * second phase acts on exactly that snapshot (fieldd's re-check is the last word); an expired token means a fresh
 * prepare, never a silent proceed. */
export const UpdatePrepareResult = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      token: z.string().min(16).max(128),
      version: z.string().min(1).max(64),
      /** the release leaves the floor alone: no session ends, no consent */
      keepsSessions: z.boolean(),
      sessions: z.array(UpdateConsentSession).max(4096),
      expiresAt: z.number().int().nonnegative(),
      /** L3c-ii — the consent's words when the apply ends sessions; absent, nothing ends and no consent is asked */
      consent: UpdateConsentWords.optional(),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      reason: z.string().min(1).max(64),
      words: UpdateWords.optional(),
    })
    .passthrough(),
]);
export type UpdatePrepareResult = z.infer<typeof UpdatePrepareResult>;

export const UpdateConfirmResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).passthrough(),
  z
    .object({
      ok: z.literal(false),
      reason: z.string().min(1).max(64),
      /** L3c-ii — what the person reads (an expired snapshot says to choose Restart to Update again) */
      words: UpdateWords.optional(),
    })
    .passthrough(),
]);
export type UpdateConfirmResult = z.infer<typeof UpdateConfirmResult>;

/** AU-1 (LC-5) — a person's check, answered when the CHECK settles (`updateCheck`'s answer): a found update's download
 * goes on and the view says it. `busy`: a check or a download was already in flight (the view says which). `held`:
 * found and not downloading (skipped, updates off, or a lever). `failed`: the check threw (the view says offline,
 * failed, paused or unsupported). */
export const UpdateCheckResult = z
  .object({
    outcome: z.enum(["up-to-date", "found", "held", "failed", "busy"]),
    /** found or held: the version */
    version: z.string().min(1).max(64).optional(),
  })
  .passthrough();
export type UpdateCheckResult = z.infer<typeof UpdateCheckResult>;

/** AU-1 (AU-G5, AU-G6) — a person downloads THIS found version: with automatic updates off, or a skip taken back
 * (its decline is removed). Never a version a lever refuses. */
export const UpdateDownloadRequest = z.object({ version: z.string().min(1).max(64) }).strict();

export const UpdateDownloadResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).passthrough(),
  z
    .object({
      ok: z.literal(false),
      /** `not-available`, `busy`, a lever (`killed`, `yanked`, `floor-unmet`), `location` (AU-7) */
      reason: z.string().min(1).max(64),
      words: UpdateWords.optional(),
    })
    .passthrough(),
]);
export type UpdateDownloadResult = z.infer<typeof UpdateDownloadResult>;

/** AU-7 (LC-10, LC-25, LC-37) — Move to Applications, through the quit gate. `proceed`: the person's quit is underway;
 * the app moves itself once the pairs have stopped and opens again from Applications. `cancel`: the quit box's
 * Cancel, nothing changed. A refusal comes back BEFORE anything stops: `not-needed` (it already runs from
 * Applications), `busy` (a quit or an apply is underway). Another VibeField running in Applications is no refusal
 * (LC-37): the move fails after the stop and the app opens again where it was. */
export const UpdateMoveResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), outcome: z.enum(["proceed", "cancel"]) }).passthrough(),
  z
    .object({
      ok: z.literal(false),
      reason: z.string().min(1).max(64),
      words: UpdateWords.optional(),
    })
    .passthrough(),
]);
export type UpdateMoveResult = z.infer<typeof UpdateMoveResult>;

/** C4 — the doctor's lines (EDP §11.6), as `doctorLines()` says them. */
export const UpdateDoctorResult = z
  .object({ lines: z.array(z.string().max(1024)).max(64) })
  .passthrough();
export type UpdateDoctorResult = z.infer<typeof UpdateDoctorResult>;

// ── AU-1 (LC-2; AU-L6) — one friendly name for a version, said the same by main's words and the window's ──

const RELEASE_NAME_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
/** `release-plan.mjs`'s nightly version, `<X.Y.Z>-nightly.<YYYYMMDD>`, its UTC plan day. */
const NIGHTLY_VERSION_PATTERN = /^\d+\.\d+\.\d+-nightly\.(\d{4})(\d{2})(\d{2})$/;
/** `release-plan.mjs`'s beta version: the tag without its `v`. */
const BETA_VERSION_PATTERN = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/;

/** A version in a sentence: "the Oct 28 nightly" ("The Oct 28 nightly" with `start`) for a nightly, by the UTC day its
 * version names; "VibeField 0.2.0 beta 3" for a beta; "VibeField " + the version for a stable and for anything else
 * (a nightly whose day is not a real date included). English on purpose: the exact version stays where it can be
 * copied (Settings → Updates' head). */
export function releaseName(version: string, options: { readonly start?: boolean } = {}): string {
  const nightly = NIGHTLY_VERSION_PATTERN.exec(version);
  if (nightly !== null) {
    const month = Number(nightly[2]) - 1;
    const date = Number(nightly[3]);
    const day = new Date(Date.UTC(Number(nightly[1]), month, date));
    if (day.getUTCMonth() === month && day.getUTCDate() === date) {
      const the = options.start === true ? "The" : "the";
      return `${the} ${RELEASE_NAME_MONTHS[month]} ${date} nightly`;
    }
  }
  const beta = BETA_VERSION_PATTERN.exec(version);
  if (beta !== null) return `VibeField ${beta[1]} beta ${Number(beta[2])}`;
  return `VibeField ${version}`;
}

// ── AU-3a (X24) — one version order, read by main's decision and the window's devices alike ──
// Moved verbatim from main's `updates/decide.ts` (`compareDotted`, `compareSemver`), renamed, with no alias left
// behind, so the window can say a desktop's version is older or newer (AU-3's devices) by the order main decides by.
// A string compare would put 0.10.0 below 0.9.0.

/** Dotted numeric versions (`15.1.0` against `14.0`): <0, 0 or >0, and NaN when either has a part that is not a
 * number — which the floor reads as unmet (fail closed). */
export function compareDottedVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (Number.isNaN(l) || Number.isNaN(r)) return Number.NaN;
    if (l !== r) return l - r;
  }
  return 0;
}

/** Semver precedence, enough for the advisory `minSupported` line: the dotted core first, then a prerelease sorts
 * below its release, identifiers compared numerically when both are numbers. NaN when a core part is not a number.
 * Across channels the order means nothing (`beta` sorts below `nightly`), so the window compares within one. */
export function compareReleaseVersions(a: string, b: string): number {
  const [aCore = "", ...aPre] = a.split("-");
  const [bCore = "", ...bPre] = b.split("-");
  const core = compareDottedVersions(aCore, bCore);
  if (Number.isNaN(core) || core !== 0) return core;
  const ap = aPre.join("-");
  const bp = bPre.join("-");
  if (ap === bp) return 0;
  if (ap === "") return 1;
  if (bp === "") return -1;
  const ai = ap.split(".");
  const bi = bp.split(".");
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    const x = ai[i];
    const y = bi[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    return numeric ? Number(x) - Number(y) : x < y ? -1 : 1;
  }
  return 0;
}

/** AU-3 (LC-20) — a release version's channel by its shape (`release-plan.mjs`'s naming), or null for anything else.
 * Older and newer are said only within one channel: semver orders `beta` below `nightly`. */
export function releaseChannelOf(version: string): UpdateChannel | null {
  if (NIGHTLY_VERSION_PATTERN.test(version)) return "nightly";
  if (BETA_VERSION_PATTERN.test(version)) return "beta";
  return /^\d+\.\d+\.\d+$/.test(version) ? "stable" : null;
}

/** AU-6 — the tag a release version was published under (the inverse of `release-plan.mjs`'s naming), or null. Main
 * composes the notes' comparison from two of these (X18); it matches `NIGHTLY_TAG_PATTERN`, `BETA_TAG_PATTERN` or
 * `STABLE_TAG_PATTERN` whenever it is not null. */
export function releaseTagOf(version: string): string | null {
  const nightly = NIGHTLY_VERSION_PATTERN.exec(version);
  if (nightly !== null) return `nightly-${nightly[1]}${nightly[2]}${nightly[3]}`;
  return BETA_VERSION_PATTERN.test(version) || /^\d+\.\d+\.\d+$/.test(version)
    ? `v${version}`
    : null;
}
