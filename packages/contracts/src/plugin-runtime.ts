import { z } from "zod";
import { CapabilityId, JsonSchemaObject, PLUGIN_LIMITS, PluginId } from "./plugins";

// P6 — the remaining-powers wire shapes (spec §17 + §22.4): supervised
// processes, endpoint adoption, MCP consume/contribute, per-capability grants.
// TS-only like the rest of the plugin surface (field-native has no plugin
// loader). Caller matrices are HANDLER-enforced (the P5 pattern): most of
// these methods declare scope null and gate on principal kind + granted
// capability inside fieldd.

// --- §17.1 supervised processes ------------------------------------------------

export const ProcessRestartPolicy = z.enum(["never", "on-crash"]);
export type ProcessRestartPolicy = z.infer<typeof ProcessRestartPolicy>;

/** What a service entry may ask fieldd to supervise. `cwd` is confined by the
 * host to the plugin's own root/data directories in v1 (SelectedPathRef —
 * user-picked paths — is a later capability). `env` is ADDITIVE onto a
 * prefix-stripped minimal base; the host wins conflicts and never passes
 * daemon or plugin bearer tokens (EL7). */
export const ProcessSpawnParams = z
  .object({
    executable: z.string().min(1).max(PLUGIN_LIMITS.PATH_MAX),
    args: z.array(z.string().max(1024)).max(64).default([]),
    cwd: z.string().min(1).max(PLUGIN_LIMITS.PATH_MAX).optional(),
    env: z.record(z.string().max(4096)).optional(),
    restart: ProcessRestartPolicy,
  })
  .passthrough();
export type ProcessSpawnParams = z.infer<typeof ProcessSpawnParams>;

export const ProcessState = z.enum(["running", "restarting", "exited", "failed"]);
export type ProcessState = z.infer<typeof ProcessState>;

/** Provenance-first record (§15.5/§17.1): who spawned what, alive or not.
 * Visible to the owning plugin (self-scoped) and to plugins.manage callers. */
export const ProcessRecord = z
  .object({
    procId: z.string().min(1).max(64),
    pluginId: PluginId,
    executable: z.string(),
    args: z.array(z.string()),
    restart: ProcessRestartPolicy,
    state: ProcessState,
    pid: z.number().int().positive().optional(),
    startedAt: z.number().optional(),
    exitedAt: z.number().optional(),
    exitCode: z.number().int().nullable().optional(),
    exitSignal: z.string().max(16).optional(),
    /** how many times this record has (re)spawned — restart-policy visibility */
    spawnCount: z.number().int().positive(),
  })
  .passthrough();
export type ProcessRecord = z.infer<typeof ProcessRecord>;

export const ProcessSpawnResult = z.object({ proc: ProcessRecord }).passthrough();
export type ProcessSpawnResult = z.infer<typeof ProcessSpawnResult>;

/** v1 signals are the termination ladder's two rungs, not arbitrary POSIX. */
export const ProcessSignalParams = z
  .object({ procId: z.string().min(1).max(64), signal: z.enum(["term", "kill"]) })
  .passthrough();
export type ProcessSignalParams = z.infer<typeof ProcessSignalParams>;

export const ProcessStatParams = z
  .object({ procId: z.string().min(1).max(64).optional() })
  .passthrough();
export type ProcessStatParams = z.infer<typeof ProcessStatParams>;

export const ProcessStatResult = z.object({ processes: z.array(ProcessRecord) }).passthrough();
export type ProcessStatResult = z.infer<typeof ProcessStatResult>;

/** process.subscribe frames — the §14.5 envelope discipline. */
export const ProcessSubEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), processes: z.array(ProcessRecord) }).passthrough(),
  z.object({ kind: z.literal("delta"), proc: ProcessRecord }).passthrough(),
]);
export type ProcessSubEvent = z.infer<typeof ProcessSubEvent>;

// --- §17.3 endpoint adoption ---------------------------------------------------

export const EndpointHealthState = z.enum(["unknown", "healthy", "unhealthy"]);
export type EndpointHealthState = z.infer<typeof EndpointHealthState>;

/** Health is mandatory — there is no unmonitored endpoint. Poll bounds keep a
 * plugin from turning fieldd into a load generator. */
export const EndpointRegisterParams = z
  .object({
    serviceId: z.string().regex(/^x\./, "endpoints bind to x.<pluginId>.<name> service ids"),
    endpoint: z
      .object({
        protocol: z.literal("http"),
        port: z.number().int().min(1).max(65535),
      })
      .passthrough(),
    health: z
      .object({
        path: z.string().regex(/^\//, "health path is absolute on the endpoint"),
        intervalMs: z.number().int().min(1_000).max(300_000),
      })
      .passthrough(),
    expose: z.object({ app: z.boolean(), mesh: z.boolean(), mcp: z.boolean() }).passthrough(),
  })
  .passthrough();
export type EndpointRegisterParams = z.infer<typeof EndpointRegisterParams>;

export const EndpointUnregisterParams = z
  .object({ serviceId: z.string().regex(/^x\./) })
  .passthrough();
export type EndpointUnregisterParams = z.infer<typeof EndpointUnregisterParams>;

export const EndpointRecord = z
  .object({
    serviceId: z.string().regex(/^x\./),
    pluginId: PluginId,
    endpoint: z.object({ protocol: z.literal("http"), port: z.number().int() }).passthrough(),
    expose: z.object({ app: z.boolean(), mesh: z.boolean(), mcp: z.boolean() }).passthrough(),
    health: z
      .object({
        state: EndpointHealthState,
        lastCheckedAt: z.number().optional(),
        consecutiveFailures: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();
export type EndpointRecord = z.infer<typeof EndpointRecord>;

/** services.health — the §23.2 fold for dynamic runtime state: live providers
 * plus adopted endpoints. A dead endpoint is VISIBLE here as unhealthy, never
 * silently retained (§17.3). */
export const ServicesHealthResult = z
  .object({
    generation: z.number().int().nonnegative(),
    endpoints: z.array(EndpointRecord),
  })
  .passthrough();
export type ServicesHealthResult = z.infer<typeof ServicesHealthResult>;

// --- §17.4 MCP -----------------------------------------------------------------

export const McpTransportKind = z.enum(["stdio", "http"]);
export type McpTransportKind = z.infer<typeof McpTransportKind>;

export const McpServerState = z.enum(["stopped", "starting", "running", "failed"]);
export type McpServerState = z.infer<typeof McpServerState>;

/** Public server row — transport DETAILS (executables, urls, secrets) never
 * leave fieldd; only the kind does. `serverKey` is the routing identity:
 * `<pluginId>/<id>` for manifest-declared servers, `user/<id>` for user-added. */
export const McpServerRecord = z
  .object({
    serverKey: z.string().min(1).max(160),
    id: z.string().min(1).max(PLUGIN_LIMITS.ID_MAX),
    ownerPluginId: PluginId.optional(),
    transportKind: McpTransportKind,
    state: McpServerState,
    autoStart: z.boolean(),
    toolCount: z.number().int().nonnegative(),
    lastError: z.string().max(500).optional(),
  })
  .passthrough();
export type McpServerRecord = z.infer<typeof McpServerRecord>;

/** User-added transports carry literal values (the user's own machine
 * authority); plugin-declared servers keep referencing SETTINGS by key in the
 * manifest and never pass through this shape. v1 user http servers carry no
 * auth material — a secret-backed header lands with the settings reference. */
export const UserMcpTransport = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stdio"),
      executable: z.string().min(1).max(PLUGIN_LIMITS.PATH_MAX),
      args: z.array(z.string().max(1024)).max(32).default([]),
    })
    .passthrough(),
  z.object({ kind: z.literal("http"), url: z.string().url().max(2048) }).passthrough(),
]);
export type UserMcpTransport = z.infer<typeof UserMcpTransport>;

export const McpServersAddParams = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(PLUGIN_LIMITS.ID_MAX),
    transport: UserMcpTransport,
    autoStart: z.boolean().optional(),
  })
  .passthrough();
export type McpServersAddParams = z.infer<typeof McpServersAddParams>;

export const McpServersRemoveParams = z
  .object({ serverKey: z.string().min(1).max(160) })
  .passthrough();
export type McpServersRemoveParams = z.infer<typeof McpServersRemoveParams>;

export const McpServersListResult = z.object({ servers: z.array(McpServerRecord) }).passthrough();
export type McpServersListResult = z.infer<typeof McpServersListResult>;

/** One aggregated tool row. `tool` is the CALLING name and is namespaced by
 * origin — `plugin:<pluginId>:<name>` or `server:<serverKey>:<name>` — so two
 * origins can never collide and provenance is legible in every audit line. */
export const McpToolRecord = z
  .object({
    tool: z.string().min(1).max(256),
    title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    description: z.string().max(PLUGIN_LIMITS.TEXT_MAX),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("plugin"), pluginId: PluginId }).passthrough(),
      z.object({ kind: z.literal("server"), serverKey: z.string().min(1) }).passthrough(),
    ]),
    inputSchema: JsonSchemaObject,
    /** false = declared but its provider/server is down right now (honest state) */
    available: z.boolean(),
  })
  .passthrough();
export type McpToolRecord = z.infer<typeof McpToolRecord>;

export const McpToolsListResult = z.object({ tools: z.array(McpToolRecord) }).passthrough();
export type McpToolsListResult = z.infer<typeof McpToolsListResult>;

export const McpToolsCallParams = z
  .object({ tool: z.string().min(1).max(256), args: z.unknown().optional() })
  .passthrough();
export type McpToolsCallParams = z.infer<typeof McpToolsCallParams>;

export const McpToolsCallResult = z.object({ output: z.unknown() }).passthrough();
export type McpToolsCallResult = z.infer<typeof McpToolsCallResult>;

/** A plugin narrowing which of its DECLARED tools are live (subset; the
 * manifest remains the ceiling — §17.4). Plugin principals only. */
export const McpContributeSetParams = z
  .object({ tools: z.array(z.string().max(PLUGIN_LIMITS.ID_MAX)).max(32) })
  .passthrough();
export type McpContributeSetParams = z.infer<typeof McpContributeSetParams>;

// --- §15.2/§15.4 grants --------------------------------------------------------

export const PluginsGrantsSetParams = z
  .object({
    id: PluginId,
    capability: CapabilityId,
    granted: z.boolean(),
  })
  .passthrough();
export type PluginsGrantsSetParams = z.infer<typeof PluginsGrantsSetParams>;

export const GrantDenialReason = z.enum(["entry-kind", "revoked", "source-policy", "host"]);
export type GrantDenialReason = z.infer<typeof GrantDenialReason>;

/** Why a REQUESTED capability is not in grantedCapabilities — the grants UX
 * renders these instead of silently thinning the list. */
export const DeniedCapability = z
  .object({ capability: z.string().min(1), reason: GrantDenialReason })
  .passthrough();
export type DeniedCapability = z.infer<typeof DeniedCapability>;
