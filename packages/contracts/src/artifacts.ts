import { z } from "zod";

// Artifact Hub wire shapes (AH-1/AH-2; design-02 §3 ArtifactService ·
// specs/artifact-hub §4). Local source details are accepted only by mutation
// methods and persisted in fieldd's private intent file. List/status shapes are
// safe projections and never contain a directory path, source port, scheme, or
// allow-list.

export const ARTIFACT_SERVE_PREFIX = "artifact-";
export const ARTIFACT_TECHNICAL_NAME_PREFIX = "artifact:";
export const ARTIFACT_INTENT_FILE = "field.artifact-intent.v2.json";

export const ARTIFACT_LIMITS = {
  LOCAL_OBJECTS: 128,
  TITLE_CHARS: 128,
  PATH_CHARS: 4096,
  ALLOW_GLOBS: 32,
  ALLOW_GLOB_CHARS: 256,
  URL_CHARS: 2048,
  ERROR_CHARS: 256,
  SLICE_BYTES: 256 * 1024,
  LISTEN_PORT_MIN: 10_000,
  LISTEN_PORT_MAX: 19_999,
} as const;

export const ArtifactId = z.string().ulid();
export type ArtifactId = z.infer<typeof ArtifactId>;

export const ArtifactTitle = z.string().trim().min(1).max(ARTIFACT_LIMITS.TITLE_CHARS);
export type ArtifactTitle = z.infer<typeof ArtifactTitle>;

export const ArtifactSource = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("proxy"),
      port: z.number().int().min(1).max(65_535),
      scheme: z.enum(["http", "https"]),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("folder"),
      path: z.string().min(1).max(ARTIFACT_LIMITS.PATH_CHARS),
      spaFallback: z.literal("/index.html").optional(),
    })
    .passthrough(),
]);
export type ArtifactSource = z.infer<typeof ArtifactSource>;

const ArtifactAllow = z
  .array(z.string().min(1).max(ARTIFACT_LIMITS.ALLOW_GLOB_CHARS))
  .max(ARTIFACT_LIMITS.ALLOW_GLOBS);

export const ArtifactPublishV2Params = z
  .object({
    artifactId: ArtifactId,
    title: ArtifactTitle,
    source: ArtifactSource,
    allow: ArtifactAllow.optional(),
    idempotencyKey: z.string().ulid().optional(),
  })
  .passthrough();
export type ArtifactPublishV2Params = z.infer<typeof ArtifactPublishV2Params>;

/** C6 compatibility window. New clients must use ArtifactPublishV2Params. */
export const LegacyArtifactName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "artifact names are lowercase slugs");

export const LegacyArtifactPublishParams = z
  .object({
    name: LegacyArtifactName,
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("port"), port: z.number().int().min(1).max(65_535) }),
      z.object({ kind: z.literal("dir"), path: z.string().min(1).max(ARTIFACT_LIMITS.PATH_CHARS) }),
    ]),
    allow: ArtifactAllow.optional(),
  })
  .passthrough();
export type LegacyArtifactPublishParams = z.infer<typeof LegacyArtifactPublishParams>;

export const ArtifactPublishParams = z.union([
  ArtifactPublishV2Params,
  LegacyArtifactPublishParams,
]);
export type ArtifactPublishParams = z.infer<typeof ArtifactPublishParams>;

export const ArtifactUpdateParams = z
  .object({
    artifactId: ArtifactId,
    title: ArtifactTitle.optional(),
    source: ArtifactSource.optional(),
    allow: ArtifactAllow.optional(),
    idempotencyKey: z.string().ulid().optional(),
  })
  .passthrough()
  .refine(
    (value) => value.title !== undefined || value.source !== undefined || value.allow !== undefined,
    {
      message: "artifact.update requires title, source, or allow",
    },
  );
export type ArtifactUpdateParams = z.infer<typeof ArtifactUpdateParams>;

export const ArtifactUnpublishParams = z.union([
  z.object({ artifactId: ArtifactId }).passthrough(),
  z.object({ name: LegacyArtifactName }).passthrough(),
]);
export type ArtifactUnpublishParams = z.infer<typeof ArtifactUnpublishParams>;

export const ArtifactRefreshPreviewParams = z.object({ artifactId: ArtifactId }).passthrough();
export type ArtifactRefreshPreviewParams = z.infer<typeof ArtifactRefreshPreviewParams>;

export const LocalArtifactIntent = z
  .object({
    artifactId: ArtifactId,
    title: ArtifactTitle,
    source: ArtifactSource,
    listenPort: z
      .number()
      .int()
      .min(ARTIFACT_LIMITS.LISTEN_PORT_MIN)
      .max(ARTIFACT_LIMITS.LISTEN_PORT_MAX),
    allow: ArtifactAllow.default([]),
    publicTls: z.literal(true),
    desired: z.enum(["published", "absent"]),
    retiringServeIds: z.array(z.string().min(1)).max(16),
    lastPublishedUrl: z.string().max(ARTIFACT_LIMITS.URL_CHARS).optional(),
    previewRevision: z.number().int().nonnegative().safe().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    /** Present only for the one-window C6 adapter/migration. */
    legacyName: LegacyArtifactName.optional(),
  })
  .passthrough();
export type LocalArtifactIntent = z.infer<typeof LocalArtifactIntent>;

export const ArtifactStatus = z
  .object({
    artifactId: ArtifactId,
    title: ArtifactTitle,
    kind: z.enum(["proxy", "folder"]),
    status: z.enum(["active", "starting", "removing", "source-unavailable", "error"]),
    url: z.string().max(ARTIFACT_LIMITS.URL_CHARS).optional(),
    error: z.string().max(ARTIFACT_LIMITS.ERROR_CHARS).optional(),
    previewRevision: z.number().int().nonnegative().safe().optional(),
    publishedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    /** Compatibility echo for legacy callers; never used as identity. */
    name: LegacyArtifactName.optional(),
  })
  .passthrough();
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

/** Coarse origin truth that is safe to replicate in `field.artifacts.v1`.
 * Native error strings stay local; clients fuse this claim with authenticated
 * origin identity, boot identity, and liveness before presenting it. */
export const ArtifactAdvertisedAvailability = z.enum([
  "active",
  "starting",
  "removing",
  "source-unavailable",
  "error",
]);
export type ArtifactAdvertisedAvailability = z.infer<typeof ArtifactAdvertisedAvailability>;

export const ArtifactAvailability = z.enum([
  ...ArtifactAdvertisedAvailability.options,
  "offline",
  "unknown",
]);
export type ArtifactAvailability = z.infer<typeof ArtifactAvailability>;

/** One safe public row in an origin-owned SyncedStore slice. This is not a
 * directly renderable shape: in particular, `url` is still an untrusted claim
 * until ArtifactService binds it to DeviceService's transport-derived DNS
 * identity. */
export const ArtifactCatalogEntry = z
  .object({
    artifactId: ArtifactId,
    title: ArtifactTitle,
    kind: z.enum(["proxy", "folder"]),
    originDeviceId: z.string().min(1),
    originBootId: z.string().min(1),
    url: z.string().min(1).max(ARTIFACT_LIMITS.URL_CHARS).optional(),
    previewRevision: z.number().int().nonnegative().safe().optional(),
    advertisedAvailability: ArtifactAdvertisedAvailability,
    availabilityAt: z.number().int().nonnegative(),
    publishedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type ArtifactCatalogEntry = z.infer<typeof ArtifactCatalogEntry>;

/** Whole-file self slice. Runtime readers additionally byte/count gate the raw
 * object before invoking the per-entry tolerant schema. */
export const ArtifactCatalogSlice = z
  .object({
    v: z.literal(1),
    artifacts: z.array(ArtifactCatalogEntry).max(ARTIFACT_LIMITS.LOCAL_OBJECTS),
  })
  .passthrough();
export type ArtifactCatalogSlice = z.infer<typeof ArtifactCatalogSlice>;

/** Client-safe global projection. `url` and `thumbnailUrl` are present only
 * after origin binding; the raw catalog claim never crosses ProductAPI. */
export const ArtifactView = ArtifactCatalogEntry.omit({ url: true })
  .extend({
    artifactKey: z.string().min(1),
    originDeviceName: z.string().min(1),
    originOnline: z.boolean(),
    url: z.string().min(1).max(ARTIFACT_LIMITS.URL_CHARS).optional(),
    thumbnailUrl: z.string().min(1).max(ARTIFACT_LIMITS.URL_CHARS).optional(),
    openable: z.boolean(),
    availability: ArtifactAvailability,
    editable: z.boolean(),
    error: z.string().max(ARTIFACT_LIMITS.ERROR_CHARS).optional(),
  })
  .passthrough();
export type ArtifactView = z.infer<typeof ArtifactView>;

export const ArtifactListResult = z.object({ artifacts: z.array(ArtifactView) }).passthrough();
export type ArtifactListResult = z.infer<typeof ArtifactListResult>;
