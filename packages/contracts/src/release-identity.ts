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
