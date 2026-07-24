import { z } from "zod";
import { SemverString } from "./envelope";
import { RegistryProvenance } from "./plugin-distribution";
import { DeniedCapability } from "./plugin-runtime";
import {
  CommandContribution,
  PluginCapabilityContribution,
  PluginId,
  SettingsContribution,
  SurfaceContribution,
  WidgetContribution,
} from "./plugins";

// Plugin registry wire surface (plugin spec §9.4/§22.1, slice P2): what
// `plugins.list/get/subscribe/enable/disable/reload` carry between fieldd and
// its clients. TS-only like the manifest schemas — field-native exposes no
// plugin loader (spec §4.2), so nothing here enters the Rust gen bundle.
//
// SANITIZED-SNAPSHOT LAW (§9.4): paths, tokens, secrets, stack traces, and
// storage roots never appear in these shapes. The service composes records
// from validated manifests, copying only the public sections; problems name
// roots by BASENAME only.

/** §9.1 sources. P7 adds registry installs and sideloads to P2's pair. */
export const PluginSource = z.enum(["bundled", "dev-linked", "registry", "sideload"]);
export type PluginSource = z.infer<typeof PluginSource>;

/** §9.3 entry states, declared in full for forward compatibility. P2 never
 * activates an entry, so fieldd emits only "none" (undeclared) and "inactive"
 * (declared, awaiting P3's harness); readers must tolerate the rest today. */
export const PublicEntryState = z.enum([
  "none",
  "inactive",
  "activating",
  "active",
  "degraded",
  "restarting",
  "quarantined",
]);
export type PublicEntryState = z.infer<typeof PublicEntryState>;

/** §22.5 — the stable discriminator (`pluginKind` in RPC error details, `kind`
 * in registry summaries). Declared in full; P2 emits the first three. */
export const PluginErrorKind = z.enum([
  "PLUGIN_INVALID",
  "PLUGIN_INCOMPATIBLE",
  "PLUGIN_DISABLED",
  "PLUGIN_QUARANTINED",
  "PLUGIN_ACTIVATION_FAILED",
  "PLUGIN_CAPABILITY_DENIED",
  "PLUGIN_SCHEMA_VIOLATION",
  "PLUGIN_QUOTA_EXCEEDED",
  "PLUGIN_PROVIDER_GONE",
  "PLUGIN_ARTIFACT_MISMATCH",
  "PLUGIN_SOURCE_UNAVAILABLE",
]);
export type PluginErrorKind = z.infer<typeof PluginErrorKind>;

/** Doctor-grade honesty in one public sentence: no paths, no stacks. */
export const PluginErrorSummary = z
  .object({
    kind: PluginErrorKind,
    message: z.string().max(500),
  })
  .passthrough();
export type PluginErrorSummary = z.infer<typeof PluginErrorSummary>;

/** P6 — sanitized MCP section: tool projections verbatim (public data) plus
 * server ROWS stripped to id/kind/autoStart. Executables, urls, and setting
 * keys never leave fieldd through the snapshot. */
export const SanitizedMcp = z
  .object({
    tools: z
      .array(
        z
          .object({
            name: z.string(),
            title: z.string(),
            description: z.string(),
            method: z.string(),
          })
          .passthrough(),
      )
      .default([]),
    servers: z
      .array(
        z
          .object({
            id: z.string(),
            transportKind: z.enum(["stdio", "http"]),
            autoStart: z.boolean(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();
export type SanitizedMcp = z.infer<typeof SanitizedMcp>;

/** The public, path-free contribution sections. Full MCP server transports
 * stay out (they name executables); SanitizedMcp is the visible slice. */
export const SanitizedContributions = z
  .object({
    widgets: z.array(WidgetContribution).default([]),
    commands: z.array(CommandContribution).default([]),
    surfaces: z.array(SurfaceContribution).default([]),
    /** P5 — the §8.5 declaration (scalar form-subset schemas; PUBLIC data —
     * the generated pane renders from it; values live behind storage.settings) */
    settings: SettingsContribution.optional(),
    /** P6 — custom capability declarations (§15.1: title/description/risk are
     * exactly what the grants UX renders) */
    capabilities: z.array(PluginCapabilityContribution).default([]),
    /** P6 — §8.7 sanitized */
    mcp: SanitizedMcp.optional(),
  })
  .passthrough();
export type SanitizedContributions = z.infer<typeof SanitizedContributions>;

/** Plugin-level state (§9.3): the discriminant the UI switches on. `compatible`
 * and `enabled` remain as spec §9.4's booleans; `state` folds them honestly. */
export const PluginRecordState = z.enum(["invalid", "incompatible", "disabled", "enabled"]);
export type PluginRecordState = z.infer<typeof PluginRecordState>;

export const PluginRecord = z
  .object({
    id: PluginId,
    version: SemverString,
    title: z.string().min(1),
    source: PluginSource,
    /** sha256 of the canonical manifest JSON — the §9.2 identity. */
    manifestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    /** P2: derived from the manifest hash (installs proper arrive at P7). */
    installRevision: z.string().min(1).max(64),
    /** P7 §6.3 — registry-source rows carry verified provenance (no paths). */
    registry: RegistryProvenance.optional(),
    state: PluginRecordState,
    compatible: z.boolean(),
    enabled: z.boolean(),
    requestedCapabilities: z.array(z.string()),
    /** P6 — computeEffectiveGrants output (§15.2): requested ∩ eligibility ∩
     * persisted device-local decisions. Ineligible/revoked requests surface in
     * deniedCapabilities instead of silently thinning this list. */
    grantedCapabilities: z.array(z.string()),
    deniedCapabilities: z.array(DeniedCapability).default([]),
    /** §15.4 — bumps on every grant change; leases minted under an older
     * generation are dead at the mint table. */
    grantGeneration: z.number().int().nonnegative().default(0),
    contributions: SanitizedContributions,
    renderer: PublicEntryState,
    service: PublicEntryState,
    lastError: PluginErrorSummary.optional(),
  })
  .passthrough();
export type PluginRecord = z.infer<typeof PluginRecord>;

/** A discovered root that could not produce a plugin row (unparseable or
 * oversize manifest — there is no trustworthy id to key a record by). */
export const PluginRegistryProblem = z
  .object({
    /** plugin directory BASENAME — never a filesystem path */
    root: z.string().min(1).max(256),
    error: PluginErrorSummary,
  })
  .passthrough();
export type PluginRegistryProblem = z.infer<typeof PluginRegistryProblem>;

/** Named shape + explicit annotation: with §8.5 settings nested inside every
 * record the INFERRED type exceeds tsc's serialization cap (TS7056 — the P0
 * lesson repeating); a named reference stays compact. */
const PluginRegistrySnapshotShape = {
  generation: z.number().int().nonnegative(),
  plugins: z.array(PluginRecord),
  problems: z.array(PluginRegistryProblem),
};
export const PluginRegistrySnapshot: z.ZodObject<
  typeof PluginRegistrySnapshotShape,
  "passthrough"
> = z.object(PluginRegistrySnapshotShape).passthrough();
export type PluginRegistrySnapshot = z.infer<typeof PluginRegistrySnapshot>;

// --- method params/results (§22.1, the P2 six) --------------------------------

export const PluginsGetParams = z.object({ id: PluginId }).passthrough();
export type PluginsGetParams = z.infer<typeof PluginsGetParams>;

export const PluginsEnableParams = z.object({ id: PluginId }).passthrough();
export type PluginsEnableParams = z.infer<typeof PluginsEnableParams>;

export const PluginsDisableParams = z.object({ id: PluginId }).passthrough();
export type PluginsDisableParams = z.infer<typeof PluginsDisableParams>;

/** P6 — §18.5: with an id, the full dev-reload sequence for that plugin;
 * without one, the P2-era whole-registry rescan (dev convenience — the empty
 * shape this declaration superseded). */
export const PluginsReloadParams = z.object({ id: PluginId.optional() }).passthrough();
export type PluginsReloadParams = z.infer<typeof PluginsReloadParams>;

/** plugins.list and plugins.reload return the snapshot; plugins.subscribe's
 * subscription snapshot/delta payloads are PluginRegistrySnapshot verbatim
 * (deltas are coalesced full snapshots — spec §9.4 allows server re-snapshot).
 * plugins.get/enable/disable return the single PluginRecord. */
export const PluginsListResult: typeof PluginRegistrySnapshot = PluginRegistrySnapshot;
export type PluginsListResult = z.infer<typeof PluginsListResult>;

// --- the renderer principal lease (§11.2, P3b) --------------------------------

/** The trusted renderer spine asks for a plugin-bound session. manifestHash,
 * when supplied, must match the registered record (artifact-mismatch law). */
export const PluginsOpenRendererSessionParams = z
  .object({
    pluginId: PluginId,
    manifestHash: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .optional(),
  })
  .passthrough();
export type PluginsOpenRendererSessionParams = z.infer<typeof PluginsOpenRendererSessionParams>;

/** A short-lived, plugin-bound bearer lease. The credential lives only in the
 * client closure that redeems it (§11.2) — never persisted, dead on restart. */
export const PluginsOpenRendererSessionResult = z
  .object({
    token: z.string().min(1),
    scopes: z.array(z.string()),
    pluginId: PluginId,
    /** epoch ms; the client re-leases before this passes */
    expiresAt: z.number().int().positive(),
  })
  .passthrough();
export type PluginsOpenRendererSessionResult = z.infer<typeof PluginsOpenRendererSessionResult>;

// --- dynamic services (§14, P4) -----------------------------------------------

/** Sanitized provider row (§9.4 spirit): method names/kinds/caps, never the
 * JSON Schemas (those are registration-side data) and never paths. */
export const ServiceProviderRecord = z
  .object({
    pluginId: PluginId,
    namespace: z.string().regex(/^x\./),
    methods: z.array(
      z
        .object({
          name: z.string().min(1),
          kind: z.enum(["query", "mutation", "subscription"]),
          idempotent: z.boolean(),
          requiredCapability: z.string().min(1),
        })
        .passthrough(),
    ),
    state: z.enum(["active"]),
  })
  .passthrough();
export type ServiceProviderRecord = z.infer<typeof ServiceProviderRecord>;

export const ServicesSnapshot = z
  .object({
    generation: z.number().int().nonnegative(),
    providers: z.array(ServiceProviderRecord),
  })
  .passthrough();
export type ServicesSnapshot = z.infer<typeof ServicesSnapshot>;

/** §14.5 — the delta envelope for DYNAMIC subscriptions: snapshot-then-delta,
 * provider loss ends the stream with one honest `unavailable` event. */
export const DynamicSubEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), value: z.unknown() }).passthrough(),
  z.object({ kind: z.literal("delta"), value: z.unknown() }).passthrough(),
  z
    .object({
      kind: z.literal("unavailable"),
      error: z.object({ kind: z.string(), message: z.string() }).passthrough(),
    })
    .passthrough(),
]);
export type DynamicSubEvent = z.infer<typeof DynamicSubEvent>;

// --- settings + KV storage (§16.2/§16.3, P5) ----------------------------------

/** storage.settings.* params. Plugin principals are always SELF-scoped —
 * pluginId is for the trusted pane path (plugins.manage) and must match the
 * caller's own id when a plugin supplies it. */
export const SettingsGetParams = z
  .object({ pluginId: PluginId.optional(), key: z.string().min(1).max(128) })
  .passthrough();
export type SettingsGetParams = z.infer<typeof SettingsGetParams>;

/** Unset key with a schema default → { value: default, isSet: false }.
 * SECRET keys to any caller but the owning plugin: value OMITTED, secret true
 * — the value never enters snapshots, logs, or the pane (§16.2). */
export const SettingsGetResult = z
  .object({
    value: z.unknown().optional(),
    isSet: z.boolean(),
    secret: z.boolean().optional(),
  })
  .passthrough();
export type SettingsGetResult = z.infer<typeof SettingsGetResult>;

export const SettingsSetParams = z
  .object({
    pluginId: PluginId.optional(),
    key: z.string().min(1).max(128),
    value: z.unknown(),
  })
  .passthrough();
export type SettingsSetParams = z.infer<typeof SettingsSetParams>;

export const SettingsResetParams = SettingsGetParams;
export type SettingsResetParams = z.infer<typeof SettingsResetParams>;

export const SettingsSubscribeParams = z.object({ pluginId: PluginId.optional() }).passthrough();
export type SettingsSubscribeParams = z.infer<typeof SettingsSubscribeParams>;

/** The per-plugin settings snapshot: PERSISTED non-secret values only
 * (defaults are never persisted); secrets appear as NAMES, never values. */
export const SettingsSnapshot = z
  .object({
    pluginId: PluginId,
    values: z.record(z.unknown()),
    secretsSet: z.array(z.string()),
  })
  .passthrough();
export type SettingsSnapshot = z.infer<typeof SettingsSnapshot>;

/** storage.kv.* — plugin-principal-only, self-scoped, quota-bounded (§16.3). */
export const KvGetParams = z.object({ key: z.string().min(1).max(512) }).passthrough();
export type KvGetParams = z.infer<typeof KvGetParams>;

export const KvGetResult = z.object({ value: z.unknown() }).passthrough();
export type KvGetResult = z.infer<typeof KvGetResult>;

export const KvSetParams = z
  .object({ key: z.string().min(1).max(512), value: z.unknown() })
  .passthrough();
export type KvSetParams = z.infer<typeof KvSetParams>;

export const KvDeleteParams = KvGetParams;
export type KvDeleteParams = z.infer<typeof KvDeleteParams>;

export const KvListParams = z.object({ prefix: z.string().max(512).optional() }).passthrough();
export type KvListParams = z.infer<typeof KvListParams>;

export const KvListResult = z.object({ keys: z.array(z.string()) }).passthrough();
export type KvListResult = z.infer<typeof KvListResult>;
