import { z } from "zod";
import { SemverString } from "./envelope";
import { CommandContribution, PluginId, SurfaceContribution, WidgetContribution } from "./plugins";

// Plugin registry wire surface (plugin spec §9.4/§22.1, slice P2): what
// `plugins.list/get/subscribe/enable/disable/reload` carry between fieldd and
// its clients. TS-only like the manifest schemas — field-native exposes no
// plugin loader (spec §4.2), so nothing here enters the Rust gen bundle.
//
// SANITIZED-SNAPSHOT LAW (§9.4): paths, tokens, secrets, stack traces, and
// storage roots never appear in these shapes. The service composes records
// from validated manifests, copying only the public sections; problems name
// roots by BASENAME only.

/** §9.1 sources shipping in P2. Registry installs and sideloads arrive at P7. */
export const PluginSource = z.enum(["bundled", "dev-linked"]);
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

/** The public, path-free contribution sections. Services/MCP declarations stay
 * out until their runtime exists (stdio transports name executables). */
export const SanitizedContributions = z
  .object({
    widgets: z.array(WidgetContribution).default([]),
    commands: z.array(CommandContribution).default([]),
    surfaces: z.array(SurfaceContribution).default([]),
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
    state: PluginRecordState,
    compatible: z.boolean(),
    enabled: z.boolean(),
    requestedCapabilities: z.array(z.string()),
    /** P2: requested verbatim for valid plugins (policy ceilings land at P6). */
    grantedCapabilities: z.array(z.string()),
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

export const PluginRegistrySnapshot = z
  .object({
    generation: z.number().int().nonnegative(),
    plugins: z.array(PluginRecord),
    problems: z.array(PluginRegistryProblem),
  })
  .passthrough();
export type PluginRegistrySnapshot = z.infer<typeof PluginRegistrySnapshot>;

// --- method params/results (§22.1, the P2 six) --------------------------------

export const PluginsGetParams = z.object({ id: PluginId }).passthrough();
export type PluginsGetParams = z.infer<typeof PluginsGetParams>;

export const PluginsEnableParams = z.object({ id: PluginId }).passthrough();
export type PluginsEnableParams = z.infer<typeof PluginsEnableParams>;

export const PluginsDisableParams = z.object({ id: PluginId }).passthrough();
export type PluginsDisableParams = z.infer<typeof PluginsDisableParams>;

/** Full §9.2 re-scan of every root. Per-plugin developer reload is §18.5 (P3). */
export const PluginsReloadParams = z.object({}).passthrough();
export type PluginsReloadParams = z.infer<typeof PluginsReloadParams>;

/** plugins.list and plugins.reload return the snapshot; plugins.subscribe's
 * subscription snapshot/delta payloads are PluginRegistrySnapshot verbatim
 * (deltas are coalesced full snapshots — spec §9.4 allows server re-snapshot).
 * plugins.get/enable/disable return the single PluginRecord. */
export const PluginsListResult = PluginRegistrySnapshot;
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
