import { z } from "zod";
import { SemverString } from "./envelope";
import { CapabilityId, PluginId } from "./plugins";

// P7 — distribution and the synced install-set (spec §5.3.1/§6.3/§16.6 + D29′).
// TS-only like the whole plugin surface. Three shape families:
//   - the registry index (git-hosted marketplace, PA-30): pointers + hashes,
//     never code; a detached signature over the EXACT index bytes;
//   - the install surface (plugins.install/uninstall/updates.check §22.1);
//   - the D29′ system settings doc slices: per-plugin settings sections, the
//     spine-preferences section, and the install-set (PA-31/PA-32).

// --- the registry index (§5.3.1) ----------------------------------------------

const Sha256Pin = z.string().regex(/^sha256:[0-9a-f]{64}$/);

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

export const RegistryPluginEntry = z
  .object({
    id: PluginId,
    repo: z.string().url().max(2048),
    latest: RegistryRelease,
    /** newest-first; latest is NOT duplicated here */
    history: z.array(RegistryRelease).max(64).default([]),
  })
  .passthrough();
export type RegistryPluginEntry = z.infer<typeof RegistryPluginEntry>;

export const RegistryIndex = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.number().int().nonnegative(),
    plugins: z.record(RegistryPluginEntry),
  })
  .passthrough();
export type RegistryIndex = z.infer<typeof RegistryIndex>;

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
  })
  .passthrough();
export type RegistryProvenance = z.infer<typeof RegistryProvenance>;

// --- the D29′ system settings doc (design-03 §7.2, spec §16.6) -----------------
//
// ONE hidden Loro doc. Top-level map keys are SECTIONS:
//   "settings.plugin.<pluginId>"  → LoroMap of user-scope setting key → value
//   "settings.app"                → LoroMap of spine preference key → value
//   "installSet"                  → LoroMap of pluginId → InstallSetEntry
// Per-key LWW; op history retained (undo horizon = compaction epochs); every
// write stamps principal provenance into op metadata. The install-set and the
// grant decisions inside it are OUTSIDE the undo stack (D29′ law 2 — undo
// never re-escalates; undoing a revocation requires the explicit grant flow).

export const SETTINGS_DOC_NAME = "system.settings" as const;
export const SETTINGS_DOC_SECTIONS = {
  PLUGIN_PREFIX: "settings.plugin.",
  APP: "settings.app",
  INSTALL_SET: "installSet",
} as const;

export const GrantDecision = z
  .object({
    capability: CapabilityId,
    decision: z.enum(["granted", "revoked"]),
    at: z.number().int().nonnegative(),
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
  })
  .passthrough();
export type InstallSetEntry = z.infer<typeof InstallSetEntry>;

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
