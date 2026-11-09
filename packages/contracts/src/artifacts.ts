import { z } from "zod";
import { MADE_APP_LIMITS, MADE_APP_OPEN, MESH_CONTROL_LIMITS } from "./registries";

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
  SLICE_BYTES: MESH_CONTROL_LIMITS.ARTIFACT_SLICE_BYTES,
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

export const ArtifactRefreshPreviewResult = z.union([
  z
    .object({
      artifactId: ArtifactId,
      captured: z.literal(true),
      previewRevision: z.number().int().nonnegative().safe(),
      title: ArtifactTitle.optional(),
    })
    .passthrough(),
  z
    .object({
      artifactId: ArtifactId,
      captured: z.literal(false),
      reason: z.string().min(1).max(ARTIFACT_LIMITS.ERROR_CHARS),
    })
    .passthrough(),
]);
export type ArtifactRefreshPreviewResult = z.infer<typeof ArtifactRefreshPreviewResult>;

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

// ── MA-1a — the made apps (`draft/thinking-mini-apps.md` v0.2, RULED 2026-11-05; the build plan's §1 as the lead
// ruled it, 2026-11-05 09:30Z) ──
//
// A page an agent presented is a FACT (rosetta found it in a transcript); keeping it and hiding it are the person's
// INTENT; its bytes are served by its desktop at the app's own origin (MA §2). The fact rows and the doors that page
// them are agent-index.ts' (`IndexCatalogApp`, `IndexApp`, `index.artifacts`). Here are the acts on an app
// (`artifact.open`, `artifact.mark`), the grammars both files share, the intent row and the origin's private serve
// record. None of it is an `ArtifactView`: a made app's id is rosetta's 64-hex identity, not a ULID (the maps' H1),
// and `artifact.subscribe`'s whole-list readers would blank on a `kind` they do not know (H2). Live apps stay on
// `artifact.*`'s list and made apps are `index.apps.*`'s; a shelf draws them as two groups (the plan's L10).

/** rosetta's identity of a made app (`artifact_id`) and of one presentation of it (`publication.id`): blake3 over
 * length-delimited parts, in lowercase hex (rosetta `crates/core/src/html_artifacts.rs`, `identity`). Never a ULID,
 * so never an `ArtifactId` (H1). */
export const MadeAppId = z.string().regex(/^[0-9a-f]{64}$/);
export type MadeAppId = z.infer<typeof MadeAppId>;

/** A digest rosetta computes over bytes it keeps: blake3, lowercase hex (`AssetRef.digest`). Its own grammar, never
 * `RowsDigest`'s sha256 (H8). */
export const Blake3Hex = z.string().regex(/^[0-9a-f]{64}$/);
export type Blake3Hex = z.infer<typeof Blake3Hex>;

/** A digest VibeField computes over bytes it holds: SHA-256, lowercase hex (a preview JPEG's, as the capture answers
 * it). */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export type Sha256Hex = z.infer<typeof Sha256Hex>;

/** The folder a made app's preview lives in: a ULID fieldd mints for the app at its first open. It is the capture's
 * `artifactId`, so Electron's capture is unchanged (the plan's L7). */
export const MadeAppPreviewId = z.string().ulid();
export type MadeAppPreviewId = z.infer<typeof MadeAppPreviewId>;

/** One DNS label: `[a-z0-9-]`, neither starting nor ending with `-`. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** A DNS name in its canonical form, as fieldd's `canonicalTailnetDnsName` leaves it (device-service.ts): lowercase,
 * no terminal dot, at least two labels, each a `DNS_LABEL` of 1..63, at most 253 in all. */
function isCanonicalDnsName(host: string): boolean {
  if (host.length === 0 || host.length > 253 || !host.includes(".")) return false;
  const labels = host.split(".");
  return labels.every((label) => label.length <= 63 && DNS_LABEL.test(label));
}

/** AH §6's rule for an artifact's ROOT URL, the form Truffle answers for a listener, checked on its raw spelling
 * before any WHATWG normalization: printable ASCII with no `%` or `\`; `https://<host>:<port>` with an optional `/`
 * and nothing else (no credentials, path, query or fragment); the host already canonical (`isCanonicalDnsName`); the
 * port spelled canonically and inside AH's range. This is the half that does not depend on the origin: a reader then
 * requires the host to equal the origin's MagicDNS name, from its own transport binding, and strips the URL when it
 * does not (C16: validate or strip, never rewrite). It is the rule fieldd's `catalogUrlClaim` applies
 * (artifact-service.ts). */
export function artifactRootUrlClaim(
  raw: string,
): { raw: string; hostname: string; port: number } | null {
  if (
    raw.length > ARTIFACT_LIMITS.URL_CHARS ||
    !/^[!-~]+$/.test(raw) ||
    raw.includes("%") ||
    raw.includes("\\")
  )
    return null;
  const match = /^https:\/\/([^/:?#@]+):(\d{1,5})\/?$/.exec(raw);
  const hostname = match?.[1];
  const portText = match?.[2];
  if (hostname === undefined || portText === undefined) return null;
  if (!isCanonicalDnsName(hostname)) return null;
  const port = Number(portText);
  if (
    String(port) !== portText ||
    port < ARTIFACT_LIMITS.LISTEN_PORT_MIN ||
    port > ARTIFACT_LIMITS.LISTEN_PORT_MAX
  )
    return null;
  return { raw, hostname, port };
}

/** A root URL that passes `artifactRootUrlClaim`: what `artifact.open` answers, and a source's `previewsBase`. */
export const ArtifactRootUrl = z.string().refine(isArtifactRootUrl, "a root HTTPS URL");

function isArtifactRootUrl(raw: string): boolean {
  return artifactRootUrlClaim(raw) !== null;
}
export type ArtifactRootUrl = z.infer<typeof ArtifactRootUrl>;

/** The https link an agent's tool recorded for the page (rosetta's `publication.url`; claude.ai's today): a FOLD KEY
 * (MA-D4, the plan's L6) and the "Open in ‹host›" link, the host read from it as data (L22). VibeField never fetches
 * it. HTTPS only, printable ASCII with no whitespace, a host, no credentials, at most ARTIFACT_LIMITS.URL_CHARS. */
export const MadeAppHostedUrl = z
  .string()
  .min(1)
  .max(ARTIFACT_LIMITS.URL_CHARS)
  .refine(isHostedLink, "expected an https link with a host and no credentials");
export type MadeAppHostedUrl = z.infer<typeof MadeAppHostedUrl>;

function isHostedLink(raw: string): boolean {
  if (!/^https:\/\/[!-~]+$/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname.length === 0) return false;
  return url.username === "" && url.password === "";
}

/** A host a served shell's page loads from besides its own origin (RO-A1's `hosts`, as data, MA-L9): the open
 * answer's `reach` and the capture's `allowHosts` (shell.ts). A BARE DNS name in canonical form, so no scheme, no
 * port, no path and no wildcard. Its last label is not all digits, so it is never an IPv4 literal (an IPv6 one cannot
 * be spelled in the grammar). It is never a tailnet name either: the app's own origin is admitted on its own, and no
 * other `*.ts.net` host is a page's to reach (MA-L7). */
export const MadeAppReachHost = z
  .string()
  .min(1)
  .max(253)
  .refine(isReachHost, "expected a bare public DNS host");
export type MadeAppReachHost = z.infer<typeof MadeAppReachHost>;

function isReachHost(host: string): boolean {
  if (!isCanonicalDnsName(host)) return false;
  const last = host.slice(host.lastIndexOf(".") + 1);
  return !/^[0-9]+$/.test(last) && host !== "ts.net" && !host.endsWith(".ts.net");
}

/** The hosts of a served shell, at most MADE_APP_LIMITS.REACH_HOSTS. */
export const MadeAppReach = z.array(MadeAppReachHost).max(MADE_APP_LIMITS.REACH_HOSTS);
export type MadeAppReach = z.infer<typeof MadeAppReach>;

/** A made app's preview, the app's face on both hosts (MA-D10 (b); the plan's §2 as the lead ruled it): the capture
 * fieldd keeps for the app, never its bytes.
 *  - id: the preview's folder (`MadeAppPreviewId`), under `artifacts/previews/` where the capture writes and under
 *    `artifacts/made-previews/` where the previews serve serves it.
 *  - digest: the JPEG's SHA-256, as the capture answered it. Every device keeps the image by it.
 *  - pageDigest: rosetta's digest of the presentation the capture photographed. A new one owes a new capture.
 *  - capturedAt: epoch ms, the origin's clock.
 * It carries NO URL (the lead's ruling on L2 and C6), and a `url` member is refused rather than carried: a reader
 * derives the image's address from its source's `previewsBase` (`madeAppPreviewUrl`) and never stores one. */
export const MadeAppPreview = z
  .object({
    id: MadeAppPreviewId,
    digest: Sha256Hex,
    pageDigest: Blake3Hex,
    capturedAt: z.number().int().nonnegative(),
    url: z.never().optional(),
  })
  .passthrough();
export type MadeAppPreview = z.infer<typeof MadeAppPreview>;

/** The file a preview's folder holds, under both preview directories. */
export const MADE_APP_PREVIEW_FILE = "thumbnail.jpg";

/** The address of a made app's preview image: `${previewsBase}${id}/thumbnail.jpg?v=${digest}`, whichever way the
 * listener spelled the root's trailing slash. Derived by every reader and never stored (the lead's ruling on L2).
 * `previewsBase` must already have passed `artifactRootUrlClaim` with its host bound to the origin; a base that fails
 * the claim derives nothing. */
export function madeAppPreviewUrl(
  previewsBase: string,
  preview: Pick<MadeAppPreview, "id" | "digest">,
): string | undefined {
  if (artifactRootUrlClaim(previewsBase) === null) return undefined;
  const root = previewsBase.endsWith("/") ? previewsBase : `${previewsBase}/`;
  return `${root}${preview.id}/${MADE_APP_PREVIEW_FILE}?v=${preview.digest}`;
}

/** The made apps' port rule (the plan's L7 and L12, as the lead ruled them): AH-D4's derivation over the SAME range
 * (ARTIFACT_LIMITS.LISTEN_PORT_MIN..MAX) with a domain of its own, `10000 + u32be(sha256(domain + id)[0..4]) % 10000`,
 * probed linearly with wrap, assigned once and kept for life. AH's `"artifact-port-v1\0"` (fieldd's
 * `artifactPortCandidate`) and these two read ONE reservation set, so no port is handed out twice.
 *  - MADE_APP_PORT_DOMAIN + appId: one app's serve, which all its versions share (MA-L6).
 *  - MADE_APP_PREVIEWS_PORT_DOMAIN + deviceId: the desktop's one previews serve. There is no PORTS row for it.
 * fieldd computes both (slice 3b), and a vector fixture pins them, as `artifact-serving.vector.json` pins AH's. */
export const MADE_APP_PORT_DOMAIN = "made-app-port-v1\0";
export const MADE_APP_PREVIEWS_PORT_DOMAIN = "made-app-previews-v1\0";

/** The longest fold key: the hosted form, its prefix and a URL at ARTIFACT_LIMITS.URL_CHARS. */
export const MADE_APP_FOLD_KEY_CHARS = "hosted:".length + ARTIFACT_LIMITS.URL_CHARS;

/** The fold key (MA-D4; the plan's L6, and the key the lead's ruling on L8 gives the intent): what ONE app is across
 * desktops, and what the person's keep-and-hide intent is keyed by. It is the native id when rosetta recorded one,
 * else the hosted link, else the app on its desktop, each behind its own prefix so the three can never collide:
 * `native:<kind>:<nativeId>`, `hosted:<hostedUrl>`, `app:<device>:<appId>`. Every daemon composes it with
 * `madeAppFoldKey` and nothing else. A client takes it from the door's row (`IndexApp.foldKey`), compares it and never
 * parses it.
 * The native form names the agent's kind because rosetta scopes a native id to one runtime: its `artifact_id` is
 * `identity(runtime_id, native id)`, and the runtime is `(kind, data root)` (rosetta `html_artifacts.rs`, `ids.rs`).
 * A kind is the same word on every desktop, so the same agent's page still folds across desktops, and two agents that
 * happen to record the same native id stay two apps. A row whose kind is unknown (absent, or a word this build cannot
 * read) has no native form and folds by its hosted link, else on its desktop: it may fold less, never wrongly. A key
 * is persisted in the person's intent (slice 3h), so its spelling is fixed here, before anything writes one. */
export const MadeAppFoldKey = z
  .string()
  .min(1)
  .max(MADE_APP_FOLD_KEY_CHARS)
  .regex(/^(?:native|hosted|app):./, "expected a made app's fold key");
export type MadeAppFoldKey = z.infer<typeof MadeAppFoldKey>;

/** Compose an app's fold key from its parsed row (`IndexCatalogApp`): the one spelling of `MadeAppFoldKey`. */
export function madeAppFoldKey(app: {
  device: string;
  appId: string;
  kind?: string | undefined;
  nativeId?: string | undefined;
  hostedUrl?: string | undefined;
}): string {
  if (isNonEmpty(app.kind) && isNonEmpty(app.nativeId)) return `native:${app.kind}:${app.nativeId}`;
  if (isNonEmpty(app.hostedUrl)) return `hosted:${app.hostedUrl}`;
  return `app:${app.device}:${app.appId}`;
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

/** `artifact.open`: open a made app. Its desktop exports the page (RO-A1), serves it at the app's own origin and
 * answers the URL. It creates no intent; it acts inside the standing rule that an app made here opens when you open
 * it (MA §4.4, MA-L3).
 *  - appId names the app on `device`. With no `device` it is this desktop's; a foreign one forwards the call WHOLE
 *    (the method is `federate`) and the owner answers from its own rule.
 *  - presentationId opens one of its versions (Versions); absent, the newest.
 *  - reveal is the WINDOW's ask that its own desktop also open the answered URL in the browser, through its shell's
 *    `shell.openLink`, as `terminal.link.open` does, because the window never holds `shell.open` (the lead's ruling
 *    on L4, C1 and C2). The answering home does it, never the origin, and the phone never sets it. */
export const ArtifactOpenParams = z
  .object({
    appId: MadeAppId,
    device: z.string().min(1).max(256).optional(),
    presentationId: MadeAppId.optional(),
    reveal: z.literal(true).optional(),
  })
  .passthrough();
export type ArtifactOpenParams = z.infer<typeof ArtifactOpenParams>;

/** `artifact.open`'s two answers: `serving`, its listener up, or `starting`, still on its way up. */
export const MADE_APP_OPEN_STATES = ["serving", "starting"] as const;

/** What `artifact.open` answers.
 *  - state: a state this build cannot read is `starting`, which promises nothing is up.
 *  - url: the URL the app's own listener reported, never a synthesized address (AH §6). A daemon that forwarded the
 *    open checks it again against the origin's MagicDNS name and strips it on a mismatch (validate or strip, never
 *    rewrite). A url this build cannot read is no url.
 *  - reach: the shell's hosts from RO-A1's answer, as data (MA-L9): what the page loads from besides its own origin,
 *    which a host's web view admits and nothing more (MA-L7). One this build cannot read is no reach. */
export const ArtifactOpenResult = z
  .object({
    state: z.enum(MADE_APP_OPEN_STATES).catch("starting"),
    url: ArtifactRootUrl.optional().catch(undefined),
    reach: MadeAppReach.optional().catch(undefined),
  })
  .passthrough();
export type ArtifactOpenResult = z.infer<typeof ArtifactOpenResult>;

/** `artifact.reveal` (FL-2a): a desktop window asks its own desktop to open a LIVE app in the browser. The window never
 * holds `shell.open` (the lead's ruling on L4, C1 and C2), so it names a row of this desktop's catalog by the key
 * `artifact.subscribe` gave it, and the desktop opens that row's URL. No URL crosses this door, so it opens nothing the
 * catalog does not hold. `artifact.open` is the made apps' door and takes a made app's id. The key is
 * `<owner device>:<artifact id>`: an owner and a ULID, no longer. */
export const ArtifactRevealParams = z
  .object({
    artifactKey: z
      .string()
      .min(1)
      .max(MESH_CONTROL_LIMITS.OWNER_CHARS + 1 + 26),
  })
  .passthrough();
export type ArtifactRevealParams = z.infer<typeof ArtifactRevealParams>;

/** What `artifact.reveal` answers once the shell has opened the URL, as `shell.openExternal` does. */
export const ArtifactRevealResult = z.object({ opened: z.literal(true) }).passthrough();
export type ArtifactRevealResult = z.infer<typeof ArtifactRevealResult>;

/** `artifact.open`'s refusal words (`MADE_APP_OPEN`, registries.ts), as a reader recognizes them in an UNAVAILABLE's
 * details. `device` names the desktop the refusal is about when the open was forwarded there. */
export const MADE_APP_OPEN_REFUSAL_STATES = [
  MADE_APP_OPEN.STATE_EXPORT_UNBUILT,
  MADE_APP_OPEN.STATE_NOT_KEPT,
  MADE_APP_OPEN.STATE_TOO_LARGE,
  MADE_APP_OPEN.STATE_UNSUPPORTED,
  MADE_APP_OPEN.STATE_READING,
  MADE_APP_OPEN.STATE_EXPORT_FAILED,
  MADE_APP_OPEN.STATE_NOT_LINKED,
] as const;

export const MadeAppOpenRefusal = z
  .object({
    service: z.literal(MADE_APP_OPEN.SERVICE),
    state: z.enum(MADE_APP_OPEN_REFUSAL_STATES),
    device: z.string().min(1).optional(),
  })
  .passthrough();
export type MadeAppOpenRefusal = z.infer<typeof MadeAppOpenRefusal>;

/** `artifact.mark`: keep an app, or hide it. This is the person's INTENT, never a fact on the origin's rows (MA-L2; the
 * lead's ruling on L8 and C5). The HOME answers it (the desktop the caller is connected to): it writes its replica of
 * the settings document (design-06 §1), keyed by the app's fold key, and the replica carries the write to every
 * desktop. Each origin reads the merged intent to decide its serves: kept means no idle close; hidden means the serve
 * retires and `artifact.open` answers NOT_FOUND. The method is `local`, so it takes no `device`, and a holder that is
 * asleep misses nothing because nothing is sent to it. Set semantics: `true` sets a flag, `false` clears it, and an
 * absent flag is left as it is; at least one is named. Hidden wins over kept: a hidden app is never served. */
export const ArtifactMarkParams = z
  .object({
    foldKey: MadeAppFoldKey,
    kept: z.boolean().optional(),
    hidden: z.boolean().optional(),
  })
  .passthrough()
  .refine((value) => value.kept !== undefined || value.hidden !== undefined, {
    message: "artifact.mark requires kept or hidden",
  });
export type ArtifactMarkParams = z.infer<typeof ArtifactMarkParams>;

/** What `artifact.mark` answers: the app's intent at the home once the write is made, both flags said. */
export const ArtifactMarkResult = z
  .object({
    foldKey: MadeAppFoldKey,
    kept: z.boolean(),
    hidden: z.boolean(),
  })
  .passthrough();
export type ArtifactMarkResult = z.infer<typeof ArtifactMarkResult>;

/** One app's keep-and-hide intent, a row of the replicated settings document (slice 3h), keyed by the fold key. A flag
 * is present only when it is set, so a row with neither is the same as no row. `updatedAt` is the writer's clock in
 * epoch ms; how the document merges two writes is 3h's. Declared at MA-1a so 3h codes to it; nothing writes one before
 * 3h. */
export const MadeAppIntentRow = z
  .object({
    foldKey: MadeAppFoldKey,
    kept: z.literal(true).optional(),
    hidden: z.literal(true).optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type MadeAppIntentRow = z.infer<typeof MadeAppIntentRow>;

/** Every intent row one person holds, at most MADE_APP_LIMITS.INTENTS. */
export const MadeAppIntentRows = z.array(MadeAppIntentRow).max(MADE_APP_LIMITS.INTENTS);
export type MadeAppIntentRows = z.infer<typeof MadeAppIntentRows>;

/** The origin's private registry of its made apps' serves: fieldd's alone, beside AH's ARTIFACT_INTENT_FILE. */
export const MADE_APP_REGISTRY_FILE = "field.made-apps.v1.json";

/** A made app's serve, `open` while one is declared and `closed` otherwise (idle, retired or hidden). */
export const MADE_APP_SERVE_STATES = ["closed", "open"] as const;

const MadeAppListenPort = z
  .number()
  .int()
  .min(ARTIFACT_LIMITS.LISTEN_PORT_MIN)
  .max(ARTIFACT_LIMITS.LISTEN_PORT_MAX);

/** One made app's serve, as ITS OWN desktop keeps it (the plan's L7): a sibling of AH's `LocalArtifactIntent`, never a
 * row of it, because the ids differ (H1) and AH's records would leak. It is not the person's intent (keep and hide
 * are `MadeAppIntentRow`s), and no door answers or replicates any of it.
 *  - listenPort: the app's port, assigned by the made rule at its first open and kept for its life (MA-L6).
 *  - previewId: minted at the first open (`MadeAppPreview.id`).
 *  - exportedPresentationId, exportedDigest: the presentation the app's folder holds now, and rosetta's digest of it.
 *  - state: a state this build cannot read is `closed`: nothing listens until a person opens it (MA-L3).
 *  - lastOpenedAt: the last `artifact.open`, which is what "used" means for the idle close (L7). Durable.
 *  - retiringServeIds: serves being removed, as AH's are.
 *  - lastServedUrl: the URL its listener last reported, checked again before it is answered.
 *  - preview: the newest capture. reach: the shell's hosts from the last export. */
export const MadeAppServeRecord = z
  .object({
    appId: MadeAppId,
    listenPort: MadeAppListenPort,
    previewId: MadeAppPreviewId.optional(),
    exportedPresentationId: MadeAppId.optional(),
    exportedDigest: Blake3Hex.optional(),
    state: z.enum(MADE_APP_SERVE_STATES).catch("closed"),
    lastOpenedAt: z.number().int().nonnegative().optional(),
    retiringServeIds: z.array(z.string().min(1)).max(16),
    lastServedUrl: z.string().max(ARTIFACT_LIMITS.URL_CHARS).optional(),
    preview: MadeAppPreview.optional(),
    reach: MadeAppReach.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type MadeAppServeRecord = z.infer<typeof MadeAppServeRecord>;

/** The whole private registry file. `previewsListenPort` is the desktop's previews serve's port, by the made rule over
 * its device id, assigned once and kept. `apps` is at most MADE_APP_LIMITS.INTENTS: a reservation lasts for life. */
export const MadeAppRegistry = z
  .object({
    v: z.literal(1),
    previewsListenPort: MadeAppListenPort.optional(),
    apps: z.array(MadeAppServeRecord).max(MADE_APP_LIMITS.INTENTS),
  })
  .passthrough();
export type MadeAppRegistry = z.infer<typeof MadeAppRegistry>;
