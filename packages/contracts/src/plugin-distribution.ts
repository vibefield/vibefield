import { z } from "zod";
import { SemverString } from "./envelope";
import { CapabilityId, isSafeRelativePath, PLUGIN_LIMITS, PluginId } from "./plugins";
import { IsoInstant } from "./trust-root";

// P7 — distribution and the synced install-set (spec §5.3.1/§6.3/§16.6 + D29′).
// TS-only like the whole plugin surface. Three shape families:
//   - the registry index (git-hosted marketplace, PA-30): pointers + hashes,
//     never code; a detached signature over the EXACT index bytes;
//   - the install surface (plugins.install/uninstall/updates.check §22.1);
//   - the D29′ system settings doc slices: per-plugin settings sections, the
//     spine-preferences section, and the install-set (PA-31/PA-32).

// --- the registry index (§5.3.1) ----------------------------------------------

export const Sha256Pin = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const RegistryRelease = z
  .object({
    version: SemverString,
    /** absolute url or a path relative to index.json (fixture/file registries) */
    artifactUrl: z.string().min(1).max(2048),
    /** over the .vfplugin bytes — a mismatch is PLUGIN_ARTIFACT_MISMATCH,
     * discarded, never partially installed */
    sha256: Sha256Pin,
    minApp: z.string().min(1).max(64),
    minContracts: z.string().min(1).max(64),
    publishedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type RegistryRelease = z.infer<typeof RegistryRelease>;

// --- MK-1: what a listing says (MK-D12, ruled A by James 2026-11-11; DESIGN.md §8 "Plugins — the frame's
// second popup") ------------------------------------------------------------------------------------------------
//
// The registry's CI writes the listing from the manifest it rebuilt, never the author (MK-D12's A): its words,
// its objects and every picture come from the build a person would install. Each picture is a file relative to the
// index (`ListingPath` holds it there: no URL, no "..", no absolute path) with a pin, `Sha256Pin` as an artifact's:
// the sha256 of the picture file's bytes as fetched. The index's signature covers the pin, never the bytes a path
// names, so fieldd hashes the fetched bytes against the pin before it caches or serves them, to the window only
// through fieldd's cache and main's plugin scheme (MK-E9). Nothing fetches or serves a picture until MK-2 (MK-1b;
// VF-PM's B1, 2026-11-11 08:48:07Z; MK-2's custody note §5). Every field but the title (and a picture's day
// and night, a file's path and pin, an object's type, label and category) is optional, and every carrier of a
// listing or a pick catches to undefined: one bad listing must never refuse the whole index (fieldd parses the index
// whole, `plugin-install.ts`), it just goes unshown, as does a listing with a picture that has no pin. Its bounds are
// the manifest's own (`PLUGIN_LIMITS`), since the registry writes it from the manifest.

/** A path relative to the index, as `isSafeRelativePath` holds a manifest's paths. */
const ListingPath = z
  .string()
  .min(1)
  .max(512)
  .refine((p) => isSafeRelativePath(`./${p}`), "listing pictures are index-relative paths");

/** One picture file: where it sits beside the index, and the hash its bytes must match. */
export const RegistryListingFile = z
  .object({
    path: ListingPath,
    sha256: Sha256Pin,
  })
  .passthrough();
export type RegistryListingFile = z.infer<typeof RegistryListingFile>;

/** A picture the registry rendered, by day and by night; the app's theme picks which. */
export const RegistryListingPicture = z
  .object({
    day: RegistryListingFile,
    night: RegistryListingFile,
  })
  .passthrough();
export type RegistryListingPicture = z.infer<typeof RegistryListingPicture>;

/** One object in the set, in the pegboard's tray order (`contributes.objects`). */
export const RegistryListingObject = z
  .object({
    /** the object's type id; never shown (DESIGN.md §9, VibeField's insides) */
    type: z.string().min(1).max(256),
    /** its pegboard label (`tray.label`) */
    label: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    /** the pegboard category it hangs under (`tray.category`) */
    category: z.string().min(1).max(PLUGIN_LIMITS.ID_MAX),
    stills: RegistryListingPicture.optional(),
  })
  .passthrough();
export type RegistryListingObject = z.infer<typeof RegistryListingObject>;

export const RegistryListing = z
  .object({
    /** the manifest's title */
    title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    /** the manifest's description */
    summary: z.string().max(PLUGIN_LIMITS.TEXT_MAX).optional(),
    /** the publisher's name as a person reads it (MK-E11's source word); absent says the namespace */
    publisherName: z.string().min(1).max(120).optional(),
    icon: RegistryListingFile.optional(),
    /** the set laid out together, as it will sit on a desk (MK-D3, MK-D4) */
    spread: RegistryListingPicture.optional(),
    objects: z.array(RegistryListingObject).max(PLUGIN_LIMITS.OBJECTS_MAX).default([]),
    tools: z.number().int().nonnegative().optional(),
    services: z.number().int().nonnegative().optional(),
    settings: z.boolean().optional(),
    /** the artifact's size in bytes */
    size: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type RegistryListing = z.infer<typeof RegistryListing>;

/** The maintainers' pick, shown first on Discover (MK-D12): ids that should be listed in the same index. Strict
 * itself; each carrier of it catches, so a bad pick reads as none. */
export const RegistryFeatured = z.array(PluginId).max(24);
export type RegistryFeatured = z.infer<typeof RegistryFeatured>;

export const RegistryPluginEntry = z
  .object({
    id: PluginId,
    repo: z.string().url().max(2048),
    latest: RegistryRelease,
    /** newest-first; latest is NOT duplicated here */
    history: z.array(RegistryRelease).max(64).default([]),
    /** MK-1 (MK's J1, ruled by James 2026-11-11): the rung it is listed at, v2's own field carried on v1. The SIGNED
     * index entry is the one authority for whether a listed plugin is VibeField's own (R1) or a community one: fieldd
     * verifies the index's signature over its exact bytes before it parses it (`fieldd/src/plugin-install.ts:118`,
     * `fetchIndex`), and no copy elsewhere decides. Absent, or a value this reader does not know, reads as community,
     * never the other way (`registryListedAs`). */
    rung: z
      .lazy(() => RegistryRung)
      .optional()
      .catch(undefined),
    listing: RegistryListing.optional().catch(undefined),
  })
  .passthrough();
export type RegistryPluginEntry = z.infer<typeof RegistryPluginEntry>;

export const RegistryIndex = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.number().int().nonnegative(),
    plugins: z.record(RegistryPluginEntry),
    /** MK-1 (MK-D12): the maintainers' pick */
    featured: RegistryFeatured.optional().catch(undefined),
  })
  .passthrough();
export type RegistryIndex = z.infer<typeof RegistryIndex>;

// --- the registry index v2 (TD-9; specs/trust-and-distribution.md §6.3) --------
//
// The `vibefield/registry` repository's signed index (the `registry` role, TD-1), beside v1 until the
// first registry release, then v1 retires. What v2 adds is review and provenance: who may publish
// under a namespace, the rung a plugin runs at (TD-6), who reviewed its first listing (TD-11), the
// capabilities a person is shown, and per release the source commit and the attestation the
// registry's CI verified (TD-4) — with the REGISTRY'S rebuilt artifact as the one served (TD-5).
// Freshness rides TD-10 (`version`, `expires`; `judgeSignedDocument`). Tolerant like v1.

/** The containment rungs of plugin-architecture §20.5; community plugins list at R2 at 1.0 (TD-6). */
export const RegistryRung = z.enum(["R0", "R1", "R2", "R3"]);
export type RegistryRung = z.infer<typeof RegistryRung>;

/** A GitHub login (the namespace's publishers, the reviewer). */
const GithubLogin = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);

export const RegistryPublisher = z
  .object({
    /** the logins allowed to publish under this namespace (§6.4's ownership gate) */
    logins: z.array(GithubLogin).min(1).max(32),
    verified: z.boolean().optional(),
  })
  .passthrough();
export type RegistryPublisher = z.infer<typeof RegistryPublisher>;

export const RegistryReleaseV2 = RegistryRelease.extend({
  prerelease: z.boolean().default(false),
  notes: z.string().max(8192).optional(),
  /** the author's repository and the commit the registry rebuilt (TD-4a) */
  sourceRepo: z.string().url().max(2048),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  /** the digest of the provenance attestation verified on the author's artifact (TD-4b) */
  attestation: Sha256Pin,
}).passthrough();
export type RegistryReleaseV2 = z.infer<typeof RegistryReleaseV2>;

export const RegistryPluginEntryV2 = z
  .object({
    id: PluginId,
    /** the namespace — the id's first segment (§6.4) */
    publisher: z.string().min(1).max(64),
    repo: z.string().url().max(2048),
    rung: RegistryRung,
    /** the human who reviewed the FIRST listing (TD-11) */
    reviewedBy: GithubLogin,
    reviewedAt: z.number().int().nonnegative(),
    /** what a person is shown before enabling it */
    capabilities: z.array(CapabilityId).max(64).default([]),
    latest: RegistryReleaseV2,
    /** newest-first; latest is NOT duplicated here */
    history: z.array(RegistryReleaseV2).max(64).default([]),
    /** versions withdrawn (an advisory names each); honoured on the next refresh */
    yanked: z.array(SemverString).max(256).default([]),
    /** the per-plugin kill switch, always with its reason (§6.4) */
    disabled: z.boolean().default(false),
    disabledReason: z.string().min(1).max(512).optional(),
    /** gathered by the registry's CI from GitHub; the app never reports (TD-14) */
    stats: z
      .object({ downloads: z.number().int().nonnegative(), at: z.number().int().nonnegative() })
      .passthrough()
      .optional(),
    /** MK-1 (MK-D12): what the set says and shows, written by the registry's CI */
    listing: RegistryListing.optional().catch(undefined),
  })
  .passthrough()
  .superRefine((entry, ctx) => {
    if (entry.id.split(".")[0] !== entry.publisher)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publisher"],
        message: `${entry.id} is not in the ${entry.publisher} namespace`,
      });
    if (entry.disabled && entry.disabledReason === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["disabledReason"],
        message: "a disabled plugin says why",
      });
  });
export type RegistryPluginEntryV2 = z.infer<typeof RegistryPluginEntryV2>;

export const RegistryIndexV2 = z
  .object({
    schemaVersion: z.literal(2),
    /** monotonic; a lower one than last accepted is refused as an index rollback (TD-10, §6.5) */
    version: z.number().int().min(1),
    generatedAt: z.number().int().nonnegative(),
    /** 90 days after the last re-sign (TRUST_FRESHNESS_DAYS.registryIndex) */
    expires: IsoInstant,
    publishers: z.record(z.string().min(1).max(64), RegistryPublisher),
    plugins: z.record(RegistryPluginEntryV2),
    /** MK-1 (MK-D12): the maintainers' pick */
    featured: RegistryFeatured.optional().catch(undefined),
  })
  .passthrough()
  .superRefine((index, ctx) => {
    for (const [key, entry] of Object.entries(index.plugins)) {
      if (key !== entry.id)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plugins", key, "id"],
          message: `listed under ${key} but its id is ${entry.id}`,
        });
      if (!Object.hasOwn(index.publishers, entry.publisher))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plugins", key, "publisher"],
          message: `${entry.publisher} is not a registered publisher`,
        });
    }
  });
export type RegistryIndexV2 = z.infer<typeof RegistryIndexV2>;

/** MK-1 (MK's J1; VF-PM 2026-11-11 07:42:17Z): whether a listed plugin is VibeField's own or a community one, read
 * from its SIGNED index entry and nowhere else. Closed and tolerant: only R1 is VibeField's own; R2, R3, R0 (which no
 * index lists), absent and anything unknown read as community. Its parameter is an index entry (`id` and `latest`),
 * so the provenance sidecar's display copy cannot be passed to it. The community switch's fence is fieldd's (MK-2).
 * *Note 2026-11-11 (MK-1):* v2's own `rung` (above) is strict, so an unknown value there refuses the v2 index rather
 * than reading as community; nothing parses v2 at runtime until the registry rung (TD §9 TD-4), which settles it. */
export const RegistryListedAs = z.enum(["vibefield", "community"]);
export type RegistryListedAs = z.infer<typeof RegistryListedAs>;
export function registryListedAs(
  entry: Pick<RegistryPluginEntry, "id" | "latest"> & { readonly rung?: unknown },
): RegistryListedAs {
  return entry.rung === "R1" ? "vibefield" : "community";
}

// --- the bundled plugin index (WP8; ESP §10.4, trust-and-distribution.md §5) ---
//
// The packaged app's own plugins ship as a staged ROOT beside its code: each plugin's §5.2 installed shape under
// `plugins/bundled/<id>/`, and one canonical index naming every staged file with its hash, each plugin's manifest
// hash as fieldd computes it, and its artifact hash (`packVfplugin` over the staged tree — the registry's pin for the
// same bytes). The index is SIGNED by the trust-root's `bundled` role (TD-1, TD-7): fieldd registers a bundled plugin
// only when the signature verifies and every file matches, refusing at two grains — a bad index refuses the root, a bad
// copy refuses that plugin (ESP §10.4 item 7). Signed over its exact bytes, so it is parsed tolerant like its siblings
// and the parse is never re-serialized. TS-only: field-native reads none of it.

/** A staged path: relative, forward-slash, no `..`, no empty or dot-only segment, no backslash or NUL. */
export const StagedPluginPath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !/[\\\0]/.test(path) &&
      path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "a staged path is relative and forward-slash, with no empty, . or .. segment",
  );

export const BundledPluginEntry = z
  .object({
    id: PluginId,
    version: SemverString,
    /** sha256(canonicalJson(manifest)) — fieldd's own definition (§9.2) */
    manifestHash: Sha256Pin,
    /** packVfplugin over the staged tree; fieldd adopts it as the row's installRevision */
    artifactSha256: Sha256Pin,
    /** every staged path → the sha256 of its bytes; the manifest is always one of them */
    files: z.record(StagedPluginPath, Sha256Pin),
  })
  .passthrough()
  .superRefine((entry, ctx) => {
    if (!Object.hasOwn(entry.files, "vibefield.plugin.json"))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "a bundled plugin's files include its vibefield.plugin.json",
      });
  });
export type BundledPluginEntry = z.infer<typeof BundledPluginEntry>;

/** `any` while every bundled plugin is JS; `<platform>-<arch>` the day one ships native bits. */
export const BundledPluginPlatform = z
  .string()
  .regex(/^(any|(darwin|win32|linux)-(arm64|x64))$/, "expected any or <platform>-<arch>");

export const BundledPluginIndex = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.number().int().nonnegative(),
    /** the app version the stage was cut for (apps/desktop/package.json) */
    appVersion: SemverString,
    platform: BundledPluginPlatform,
    plugins: z.record(BundledPluginEntry),
  })
  .passthrough()
  .superRefine((index, ctx) => {
    for (const [key, entry] of Object.entries(index.plugins))
      if (key !== entry.id)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plugins", key, "id"],
          message: `listed under ${key} but its id is ${entry.id}`,
        });
  });
export type BundledPluginIndex = z.infer<typeof BundledPluginIndex>;

// --- the install surface (§22.1, P7) ------------------------------------------

/** Registry install: the id is looked up in the signed index; `version` pins a
 * history entry (default latest). Sideload: a local .vfplugin path, developer
 * mode only — the handler enforces mode, the schema just shapes it. */
export const PluginsInstallParams = z
  .object({
    id: PluginId.optional(),
    version: SemverString.optional(),
    /** sideload only — mutually exclusive with id (handler-checked) */
    artifactPath: z.string().min(1).max(4096).optional(),
  })
  .passthrough();
export type PluginsInstallParams = z.infer<typeof PluginsInstallParams>;

export const PluginsUninstallParams = z
  .object({
    id: PluginId,
    /** §16.5 — data is PRESERVED by default; true is the separate explicit act */
    removeData: z.boolean().optional(),
  })
  .passthrough();
export type PluginsUninstallParams = z.infer<typeof PluginsUninstallParams>;

export const PluginUpdateInfo = z
  .object({
    id: PluginId,
    installedVersion: SemverString,
    latest: RegistryRelease,
    /** false when engine ranges refuse this device (honest, not hidden) */
    compatible: z.boolean(),
  })
  .passthrough();
export type PluginUpdateInfo = z.infer<typeof PluginUpdateInfo>;

/** User-initiated batch check (§5.3.1 — no push feed, no phone-home). */
export const PluginsUpdatesCheckResult = z
  .object({
    checkedAt: z.number().int().nonnegative(),
    updates: z.array(PluginUpdateInfo),
    /** ids whose registry entry vanished — parked, honestly listed */
    missing: z.array(PluginId).default([]),
  })
  .passthrough();
export type PluginsUpdatesCheckResult = z.infer<typeof PluginsUpdatesCheckResult>;

/** §6.3 — registry provenance on an installed row (public slice: no paths). */
export const RegistryProvenance = z
  .object({
    indexRef: z.string().max(256),
    artifactSha256: Sha256Pin,
    publisher: z.string().max(256),
    /** MK-1: DISPLAY COPIES of the signed entry, which fieldd writes beside the folder at install from MK-2 (today it
     * writes indexRef, artifactSha256 and publisher alone, `fieldd/src/plugin-install.ts`). They decide NOTHING: a
     * process running as the same user can rewrite what a folder says about itself (item 321), so whether a plugin is
     * VibeField's own or a community one is read from the signed index entry alone (`registryListedAs`). A bad value
     * reads as absent, so neither reader of this file can fail on them. */
    rung: RegistryRung.optional().catch(undefined),
    publisherName: z.string().min(1).max(120).optional().catch(undefined),
  })
  .passthrough();
export type RegistryProvenance = z.infer<typeof RegistryProvenance>;

// --- MK-1: the catalog door (plugins.catalog.*; MK-D5, MK-E8) -------------------------------------------------
//
// Opening Plugins… reads the plugin list: `plugins.catalog.get` answers at once from the list fieldd holds, and
// `plugins.catalog.refresh` is the fresh signed read, on the person's act only (PA-30: no timer, no push feed, no
// identity). Its state says where the list stands, its time always said and never implied fresh (DESIGN.md §9
// "Reading the list"); why a read failed goes to Diagnostics and the log, never this shape's words.

/** unconfigured: no build configures a registry (every build until the registry rung, TD §9 TD-4) · reading: a read
 * runs, the held list (if any) shown with its time · ready: read and current · stale: the held list is past its date
 * (v2's `expires`) · unreachable: offline or the host did not answer, the held list shown · refused: a list arrived
 * that VibeField could not use (signature, schema or rollback), nothing new shown. */
export const PluginsCatalogState = z.enum([
  "unconfigured",
  "reading",
  "ready",
  "stale",
  "unreachable",
  "refused",
]);
export type PluginsCatalogState = z.infer<typeof PluginsCatalogState>;

export const PluginsCatalogEntry = z
  .object({
    id: PluginId,
    /** from the signed entry (`registryListedAs`); a value this reader does not know reads as community */
    listedAs: RegistryListedAs.catch("community"),
    latest: RegistryRelease,
    /** false when engine ranges refuse this device (honest, not hidden), as `PluginUpdateInfo` says it */
    compatible: z.boolean(),
    listing: RegistryListing.optional().catch(undefined),
  })
  .passthrough();
export type PluginsCatalogEntry = z.infer<typeof PluginsCatalogEntry>;

export const PluginsCatalog = z
  .object({
    state: PluginsCatalogState,
    /** when the held list was read; null when no list is held */
    checkedAt: z.number().int().nonnegative().nullable(),
    plugins: z.array(PluginsCatalogEntry).max(4096).default([]),
    featured: RegistryFeatured.default([]).catch([]),
    /** how many installed plugins the held list has a newer compatible release for (the Me menu's "1 update") */
    updates: z.number().int().nonnegative().default(0),
  })
  .passthrough();
export type PluginsCatalog = z.infer<typeof PluginsCatalog>;

export const PluginsCatalogGetParams = z.object({}).passthrough();
export type PluginsCatalogGetParams = z.infer<typeof PluginsCatalogGetParams>;
export const PluginsCatalogRefreshParams = z.object({}).passthrough();
export type PluginsCatalogRefreshParams = z.infer<typeof PluginsCatalogRefreshParams>;
/** Both doors answer the whole catalog; refresh answers once its read has ended. */
export const PluginsCatalogResult: typeof PluginsCatalog = PluginsCatalog;
export type PluginsCatalogResult = z.infer<typeof PluginsCatalogResult>;

// --- the D29′ system settings doc (design-03 §7.2, spec §16.6) -----------------
//
// ONE hidden Loro doc. Top-level (root) containers are SECTIONS:
//   "settings.plugin.<pluginId>"  → LoroMap of user-scope setting key → value
//   "settings.app"                → LoroMap of spine preference key → value
//   "installSet.plugins"          → pluginId → the install identity
//                                   ({source, version?, artifactSha256?})
//   "installSet.enabled"          → pluginId → boolean (desire; effective
//                                   enablement stays per device)
//   "installSet.grants"           → [pluginId, capability] → the standing
//                                   decision ({decision, at, revocationGeneration})
//   "installSet.revocations"      → [pluginId, capability, eventId] → {at}: one
//                                   key per revocation ever made, never deleted
//   "installSet"                  → P7's layout (pluginId → one whole entry);
//                                   read only to MIGRATE it, then emptied
// Per-key LWW; op history retained (undo horizon = compaction epochs); every
// write stamps principal provenance into op metadata. The install-set and the
// grant decisions inside it are OUTSIDE the undo stack (D29′ law 2 — undo
// never re-escalates; undoing a revocation requires the explicit grant flow).
//
// DS-5b (PA-32, 2026-10-01) — why the install-set is one root map per FIELD.
// P7 stored an entry as ONE last-writer-wins value, so a desktop offline across
// a revocation could merge its whole entry back and re-grant (the DS wave 1
// review's B1). Split per field, a desktop that toggles enablement writes only
// `enabled`; a grant decision is one register per capability; and the root
// maps are named, so two desktops creating an entry at once share containers
// (a nested map per entry would be two containers, one side's fields lost —
// the library's rule, `library-doc.ts`). The revocation GENERATION of a
// capability is the number of its revocation keys: a grow-only set, so it
// merges as the union and a concurrent revoke is never lost, and every grant
// names the generation it saw (`standingDecision` below).

export const SETTINGS_DOC_NAME = "system.settings" as const;
export const SETTINGS_DOC_SECTIONS = {
  PLUGIN_PREFIX: "settings.plugin.",
  APP: "settings.app",
  /** P7's layout — pluginId → one whole InstallSetEntry. DS-5b migrates it
   * into the per-field sections below on load and never writes it again. */
  INSTALL_SET: "installSet",
  /** DS-5b — the install-set, one root map per field. */
  INSTALL_SET_PLUGINS: "installSet.plugins",
  INSTALL_SET_ENABLED: "installSet.enabled",
  INSTALL_SET_GRANTS: "installSet.grants",
  INSTALL_SET_REVOCATIONS: "installSet.revocations",
} as const;

export const GrantDecision = z
  .object({
    capability: CapabilityId,
    decision: z.enum(["granted", "revoked"]),
    at: z.number().int().nonnegative(),
    /** DS-5b (PA-32) — the capability's revocation generation this decision
     * SAW (a grant) or SET (a revoke). Optional, because an entry written
     * before the stamps has none; such a decision reads as having seen 0. */
    revocationGeneration: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type GrantDecision = z.infer<typeof GrantDecision>;

/** §16.6 — the synced DESIRED record. Registry installs sync fully; bundled
 * ids sync enablement only; dev-linked/sideload NEVER appear here. */
export const InstallSetEntry = z
  .object({
    pluginId: PluginId,
    source: z.enum(["registry", "bundled"]),
    /** registry entries only */
    version: SemverString.optional(),
    artifactSha256: Sha256Pin.optional(),
    enabled: z.boolean(),
    /** §16.6/PA-32 — revocation WINS regardless of LWW timing */
    grants: z.array(GrantDecision).max(64).default([]),
    /** DS-5b (PA-32) — per capability, how many revocations of it every
     * desktop has made, merged (a count that only grows). Optional: absent
     * means none, which is what an entry from before the stamps says. */
    revocationGenerations: z.record(CapabilityId, z.number().int().nonnegative()).optional(),
  })
  .passthrough();
export type InstallSetEntry = z.infer<typeof InstallSetEntry>;

/** Why a capability's decision stands as it does (`standingDecision`). */
export type StandingReason =
  /** the decision as written: a revocation, or a grant that saw every revocation */
  | "decision"
  /** PA-32's bias: a grant made without knowledge of a later or concurrent
   * revocation — it names a generation below the entry's — is applied as
   * revoked, whatever last-writer-wins said */
  | "revocation-bias"
  /** a grant naming a generation ABOVE the entry's. It cannot be honest: a
   * grant's causal past holds every revocation it counted, and revocations are
   * never deleted, so the count it saw is always still there. Refused as
   * revoked rather than trusted. */
  | "stamp-ahead";

/** DS-5b (PA-32) — the decision that STANDS for one capability of a merged
 * install-set entry. A revocation stands. A grant stands only when it saw
 * every revocation of its capability (its stamp equals the entry's
 * generation); otherwise it is dead and applied as revoked — revocation wins
 * regardless of last-writer-wins timing. A decision or an entry from before
 * the stamps reads as generation 0, so an old grant stands until the first
 * revocation the stamps record. One predicate for every reader. */
export function standingDecision(
  entry: Pick<InstallSetEntry, "revocationGenerations">,
  decision: Pick<GrantDecision, "capability" | "decision" | "revocationGeneration">,
): { granted: boolean; reason: StandingReason } {
  if (decision.decision === "revoked") return { granted: false, reason: "decision" };
  const generation = entry.revocationGenerations?.[decision.capability] ?? 0;
  const saw = decision.revocationGeneration ?? 0;
  if (saw === generation) return { granted: true, reason: "decision" };
  return { granted: false, reason: saw < generation ? "revocation-bias" : "stamp-ahead" };
}

// --- D29′ undo surface (storage.settings.undo/redo) ----------------------------

export const SettingsUndoParams = z
  .object({
    /** plugin principals are self-scoped (their own section); the pane path
     * (plugins.manage) may name any settings section or the app section */
    pluginId: PluginId.optional(),
  })
  .passthrough();
export type SettingsUndoParams = z.infer<typeof SettingsUndoParams>;

/** Honest outcome: `applied:false` with a reason beats a silent no-op. */
export const SettingsUndoResult = z
  .object({
    applied: z.boolean(),
    reason: z.enum(["empty-stack", "horizon", "not-undoable"]).optional(),
  })
  .passthrough();
export type SettingsUndoResult = z.infer<typeof SettingsUndoResult>;
