import { z } from "zod";
import { Ed25519SpkiBase64 } from "./trust-root";
import { UpdateChannel } from "./update-policy";

// WP8b / TD-2 (build-wp8-bundled-plugins.md WP8-D3/D4 as amended; trust-and-distribution.md §5) — the public
// identity a stage carries into `Resources/identity/release-identity.json`, beside the trust-root document and its
// signatures. The shell reads it in the packaged layout and hands fieldd the document's path and these root keys;
// fieldd verifies the document against the keys, then the bundled index against the document's `bundled` role.
// `keyClass` says which keys signed: `release` (the trust-root James minted, TD-1, and the `bundled` secret from the
// release-signing environment) or `dev` (an ephemeral trust-root minted for one stage, whose secrets never left the
// stager). A release build refuses `dev` (`package:mac:release` → `--require-release-key`); a packaged shell refuses
// it unless the stage was made for development (WP8-D4). Public values only: no secret is ever written here.

export const KEY_CLASSES = ["release", "dev"] as const;
export const KeyClass = z.enum(KEY_CLASSES);
export type KeyClass = z.infer<typeof KeyClass>;

const FloorVersion = z.number().int().min(1).nullable();

/** WP12 (build-wp12-updater.md §3, the build-time floor; the PM's ruling 2026-10-15) — the versions of the signed update
 * documents this build was STAGED with. The updater never accepts below them (`max(remembered, floor)`), so a corrupt
 * or hand-lowered client state (EL7: a same-uid writer can do either) resets to the build, never to zero. `trustRoot`
 * is the embedded trust-root's version; the channel heads have no build-time source (null); each channel's policy
 * floor is its committed source's version once WP12d stages them (null until then). */
export const UpdateFloors = z
  .object({
    trustRoot: z.number().int().min(1),
    channels: FloorVersion,
    policy: z
      .object({ nightly: FloorVersion, beta: FloorVersion, stable: FloorVersion })
      .passthrough(),
  })
  .passthrough();
export type UpdateFloors = z.infer<typeof UpdateFloors>;

export const StagedReleaseIdentity = z
  .object({
    schemaVersion: z.literal(1),
    keyClass: KeyClass,
    /** the ledger's identityRevision the stage was cut at */
    identityRevision: z.number().int().min(1),
    /** the root keys the staged trust-root must be signed by: the ledger's frozen `trustRootKeys` for a release
     * stage, the ephemeral root's for a dev stage */
    trustRootKeys: z.array(Ed25519SpkiBase64).min(2).max(16),
    appId: z.string().min(1).max(256),
    productName: z.string().min(1).max(256),
    updateChannel: UpdateChannel,
    updateOrigin: z.string().url().max(2048),
    /** absent on a stage cut before WP12: the updater then has no floor but its own memory */
    updateFloors: UpdateFloors.optional(),
    /** WP12 D10 — this build's identity, `<appVersion>+<commit7>`: the shell adopts only a fieldd that records the
     * same one in product.json and replaces any other (`ProductInfo.buildId`'s shape). Absent on a stage cut before
     * WP12c: that app keeps the old adoption rule (user + contracts major only). */
    buildId: z.string().min(1).max(128).optional(),
  })
  .passthrough()
  .superRefine((identity, ctx) => {
    if (new Set(identity.trustRootKeys).size !== identity.trustRootKeys.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trustRootKeys"],
        message: "a root key is listed twice",
      });
  });
export type StagedReleaseIdentity = z.infer<typeof StagedReleaseIdentity>;

/** The stager's `stagedBuildId` (`apps/desktop/packaging/bundled-plugins.mjs`): `<appVersion>+<commit7>`. */
const BUILD_ID_PATTERN = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\+([0-9a-f]{7,})$/;

/** AU-3a (AU-D13 A; LC-20) — WP12 D10's build id is `<appVersion>+<commit7>`: its app version, or undefined for any
 * other shape (the dev runner's `dev-<hash>`, an absent id). fieldd learns the version it publishes on its device
 * slice from the id its launcher handed it, so a dev build says none, which is honest. */
export function appVersionOfBuildId(buildId: string | null | undefined): string | undefined {
  if (typeof buildId !== "string") return undefined;
  return BUILD_ID_PATTERN.exec(buildId)?.[1];
}

/** AU-4 (AU-G9) — the commit a build id names (`84509d6` of `0.1.0-nightly.20261027+84509d6`), or undefined for any
 * other shape. About says it beside the version, so a person can name the exact build they run. */
export function commitOfBuildId(buildId: string | null | undefined): string | undefined {
  if (typeof buildId !== "string") return undefined;
  return BUILD_ID_PATTERN.exec(buildId)?.[2];
}
