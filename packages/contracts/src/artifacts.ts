import { z } from "zod";

// ArtifactService wire shapes (C6-6; design-02 §3 ArtifactService · design-01
// §5 catalog). The artifact hub is fieldd's registry over the mesh serve
// facade: publish a port or a directory → a tailnet URL, registry-persisted
// and REPLAYED on restart ("re-serving is re-creating"). fieldd-only shapes,
// deliberately out of the Rust gen bundle — field-native sees ordinary
// serves, never artifacts.

/** An artifact's serve name on the mesh: `artifact-<name>`. The prefix is the
 * wire-visible convention (health/Settings show serve names), and it keeps
 * artifact serves disjoint from the product serve by construction. */
export const ARTIFACT_SERVE_PREFIX = "artifact-";

/** Serve-safe naming: the name rides into proxy ids and URLs, so it is a slug
 * by law, not by hope. */
export const ARTIFACT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ArtifactName = z
  .string()
  .regex(ARTIFACT_NAME_RE, "artifact names are lowercase slugs (a-z, 0-9, -; max 64)");

export const ArtifactTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("port"), port: z.number().int().min(1).max(65535) }).passthrough(),
  z.object({ kind: z.literal("dir"), path: z.string().min(1) }).passthrough(),
]);
export type ArtifactTarget = z.infer<typeof ArtifactTarget>;

export const ArtifactPublishParams = z
  .object({
    name: ArtifactName,
    target: ArtifactTarget,
    /** per-route allow globs, forwarded verbatim to the serve (design-00 §4.7) */
    allow: z.array(z.string()).optional(),
  })
  .passthrough();
export type ArtifactPublishParams = z.infer<typeof ArtifactPublishParams>;

export const ArtifactUnpublishParams = z.object({ name: ArtifactName }).passthrough();
export type ArtifactUnpublishParams = z.infer<typeof ArtifactUnpublishParams>;

/** The persisted registry entry (`field.artifacts.v1`). Status is NOT here —
 * live serve state is fused at read time, never stored stale. */
export const ArtifactEntry = z
  .object({
    name: ArtifactName,
    target: ArtifactTarget,
    allow: z.array(z.string()).optional(),
    publishedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type ArtifactEntry = z.infer<typeof ArtifactEntry>;

/** What list/subscribe answer: the entry fused with the serve's live verdict
 * (the C3 fused vocabulary — pending is honest "declared, not serving yet"). */
export const ArtifactStatus = ArtifactEntry.extend({
  status: z.enum(["active", "pending", "error"]),
  /** the tailnet URL, present while the node reports the serve up */
  url: z.string().optional(),
  error: z.string().optional(),
}).passthrough();
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

/** `artifact.list`'s result; `artifact.subscribe` snapshots and deltas carry
 * the bare `ArtifactStatus[]` (the roster pattern — whole list, never a patch). */
export const ArtifactListResult = z.object({ artifacts: z.array(ArtifactStatus) }).passthrough();
export type ArtifactListResult = z.infer<typeof ArtifactListResult>;
