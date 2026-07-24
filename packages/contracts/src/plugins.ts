import { z } from "zod";
import { SemverString } from "./envelope";
import { SCOPES, type Scope } from "./registries";

// Plugin manifest contracts (plugin-architecture spec §7/§8, slice P0 — PA-3:
// the canonical schema lives HERE; plugin-runtime must not own a hand-written
// duplicate). TS-only by design (never in the Rust gen bundle): field-native
// exposes no plugin loader (spec §4.2), so no Rust reader exists.
//
// Two shapes ship in slice P0:
//   - PluginManifestV1 — the target contract (tolerant reader, P3: passthrough
//     everywhere; cross-field invariants in one superRefine). Its ID rule
//     tolerates single-segment DEV ALIASES (note/field/widgetlab) until the
//     §21.2 durable-ID ratification; `isDistributablePluginId` is the strict
//     rule distribution will gate on.
//   - LegacyPluginManifest — the walking-skeleton shape the P0 built-ins
//     authored. TOMBSTONE (C1c): every plugin is canonical V1 now and the
//     adapter is deleted; the shape stays only until C2's doc migration
//     confirms nothing on disk still needs a reader for it.

// --- limits (spec §7.1/§10.4/§16.3: every string and collection is bounded) ---

export const PLUGIN_LIMITS = {
  MANIFEST_MAX_BYTES: 256 * 1024,
  ID_MAX: 64,
  TITLE_MAX: 80,
  TEXT_MAX: 500, // descriptions, backgroundReason, capability explanations
  PATH_MAX: 256,
  PREVIEW_MAX: 400,
  WIDGETS_MAX: 64,
  PROPS_MAX: 64,
  PORTS_MAX: 16,
  COMMANDS_MAX: 64,
  SURFACES_MAX: 32,
  SYSTEMS_MAX: 16,
  SERVICE_METHODS_MAX: 64,
  SETTINGS_MAX: 64,
  CAPABILITIES_MAX: 32,
  ACTIVATION_MAX: 64,
  SYSTEM_BUDGET_MS_MAX: 16,
  RENDERER_ACTIVATE_DEADLINE_MS: 5_000,
  SERVICE_ACTIVATE_DEADLINE_MS: 10_000,
  DEACTIVATE_DEADLINE_MS: 5_000,
  KV_VALUE_MAX_BYTES: 64 * 1024,
  KV_TOTAL_MAX_BYTES: 10 * 1024 * 1024,
  FILE_QUOTA_BYTES: 100 * 1024 * 1024,
} as const;

// --- identifiers (spec §6.1/§6.2 — resolution is exact-map, never split) ------

const ID_SEGMENT_RE = /^[a-z][a-z0-9-]*$/;

/** Every dot segment must be [a-z][a-z0-9-]*; segment count is checked by the
 * caller (dev aliases are single-segment until §21.2 ratifies durable IDs). */
export function isWellFormedPluginId(id: string): boolean {
  if (id.length === 0 || id.length > PLUGIN_LIMITS.ID_MAX) return false;
  return id.split(".").every((s) => ID_SEGMENT_RE.test(s));
}

/** The distributable rule (spec §6.1): two or more segments. Single-segment
 * dev-era aliases (note/field/widgetlab) fail this and may never enter the
 * registry channel or new user documents (§21.2). */
export function isDistributablePluginId(id: string): boolean {
  return isWellFormedPluginId(id) && id.split(".").length >= 2;
}

export const PluginId = z
  .string()
  .refine(isWellFormedPluginId, "plugin id segments must match [a-z][a-z0-9-]* (dot-separated)");
export type PluginId = z.infer<typeof PluginId>;

/** `x.<pluginId>.<name>` — a plugin-defined capability (spec §15.1). Owner
 * checks are exact against the declaring manifest's id (never split-derived). */
export function isCustomCapabilityId(s: string): boolean {
  if (!s.startsWith("x.")) return false;
  const segs = s.slice(2).split(".");
  return segs.length >= 2 && segs.every((seg) => ID_SEGMENT_RE.test(seg));
}

export const CapabilityId = z
  .string()
  .max(PLUGIN_LIMITS.ID_MAX + 8)
  .refine(
    (s) => (SCOPES as readonly string[]).includes(s) || isCustomCapabilityId(s),
    "capability must be a core scope or x.<pluginId>.<name>",
  );
export type CapabilityId = z.infer<typeof CapabilityId>;

// --- paths (spec §5.2 — syntactic confinement; realpath/symlink checks are the
// host's job at install resolution, never the schema's) -----------------------

export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0 || p.length > PLUGIN_LIMITS.PATH_MAX) return false;
  if (!p.startsWith("./")) return false;
  if (p.includes("\0") || p.includes("\\") || p.includes(":")) return false;
  const segs = p.slice(2).split("/");
  return segs.every((s) => s.length > 0 && s !== "." && s !== "..");
}

export const RelativeAssetPath = z
  .string()
  .refine(isSafeRelativePath, "asset paths are ./-relative POSIX, no .., no schemes");
export type RelativeAssetPath = z.infer<typeof RelativeAssetPath>;

export const RelativeModulePath = z
  .string()
  .refine(
    (p) => isSafeRelativePath(p) && p.endsWith(".js"),
    "entry modules are ./-relative built .js artifacts",
  );
export type RelativeModulePath = z.infer<typeof RelativeModulePath>;

// --- shared vocabularies ------------------------------------------------------

/** Tray shelves (P-3, widgetlab port). The tray adds "All" on top. */
export const WIDGET_CATEGORIES = ["Cards", "3D", "Nodes", "Tools"] as const;
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

/** A declared JSON Schema (spec §20.4 subset). Structural validation and the
 * ajv compile limits are host-side; the manifest carries a bounded object. */
export const JsonSchemaObject = z.object({}).passthrough();
export type JsonSchemaObject = z.infer<typeof JsonSchemaObject>;

/** §8.2: previews are schema-sanitized — a color, a gradient, or an approved
 * asset. Raw CSS from manifests died with the legacy WidgetDecl (its own D22
 * threat note demanded exactly this). */
export const SafePreview = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), value: z.string().regex(/^#[0-9a-fA-F]{3,8}$/) }),
  z.object({
    kind: z.literal("gradient"),
    value: z
      .string()
      .max(PLUGIN_LIMITS.PREVIEW_MAX)
      .refine(
        (v) =>
          (v.startsWith("linear-gradient(") || v.startsWith("radial-gradient(")) &&
          !v.includes("url(") &&
          !v.includes(";") &&
          !v.includes("}"),
        "gradient previews are a single gradient function, no url()/injection",
      ),
  }),
  z.object({ kind: z.literal("asset"), path: RelativeAssetPath }),
]);
export type SafePreview = z.infer<typeof SafePreview>;

export const ActivationEvent = z
  .string()
  .max(PLUGIN_LIMITS.ID_MAX * 2)
  .refine(
    (e) =>
      e === "onStartup" ||
      ((e.startsWith("onWidget:") ||
        e.startsWith("onCommand:") ||
        e.startsWith("onSurface:") ||
        e.startsWith("onService:")) &&
        e.split(":")[1] !== ""),
    "activation events: onStartup | on{Widget,Command,Surface,Service}:<owned id>",
  );
export type ActivationEvent = z.infer<typeof ActivationEvent>;

// --- widget contribution (spec §8.2, the v0.2 vocabulary — enumerated FROM the
// shipped built-ins: folder demanded container, nodes demanded ports/provides,
// every widgetlab card demanded interaction) ----------------------------------

/** ICE p.json inner shapes (props.ts JsonShape, mirrored 1:1 — validation-only,
 * never their own strata components; the outer json prop is ONE string cell). */
export type JsonShape =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; options: string[] }
  | { kind: "array"; item: JsonShape }
  | { kind: "object"; fields: Record<string, JsonShape> };
export const JsonShape: z.ZodType<JsonShape> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("string") }),
    z.object({ kind: z.literal("number") }),
    z.object({ kind: z.literal("boolean") }),
    z.object({ kind: z.literal("enum"), options: z.array(z.string()).min(1).max(64) }),
    z.object({ kind: z.literal("array"), item: JsonShape }),
    z.object({ kind: z.literal("object"), fields: z.record(JsonShape) }),
  ]),
);

const propBase = {
  optional: z.boolean().optional(),
  /** default true; immutable props belong to no conflict group */
  mutable: z.boolean().optional(),
};

export const PropSpec = z.discriminatedUnion("kind", [
  z
    .object({
      ...propBase,
      kind: z.literal("string"),
      default: z.string().optional(),
      maxLength: z.number().int().positive().optional(),
    })
    .passthrough(),
  z
    .object({
      ...propBase,
      kind: z.literal("number"),
      default: z.number().optional(),
      /** engine vocabulary (p.number): min/max, not JSON-Schema minimum/maximum */
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .passthrough(),
  z
    .object({ ...propBase, kind: z.literal("boolean"), default: z.boolean().optional() })
    .passthrough(),
  z
    .object({
      ...propBase,
      kind: z.literal("enum"),
      /** engine vocabulary (p.enum): `options` — additive-only across versions */
      options: z.array(z.string()).min(1).max(64),
      default: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      ...propBase,
      kind: z.literal("json"),
      /** the ICE p.json inner shape — without it stocks/fitness/todo-class
       * props cannot be reconstructed from manifest data */
      inner: JsonShape,
      /** the PARSED default value (the builder serializes for the string cell) */
      default: z.unknown().optional(),
      maxBytes: z.number().int().positive().max(PLUGIN_LIMITS.KV_VALUE_MAX_BYTES).optional(),
    })
    .passthrough(),
  z.object({ ...propBase, kind: z.literal("entity-ref") }).passthrough(),
  z.object({ ...propBase, kind: z.literal("session-ref") }).passthrough(),
  z.object({ ...propBase, kind: z.literal("terminal-ref") }).passthrough(),
  z.object({ ...propBase, kind: z.literal("artifact-ref") }).passthrough(),
  z.object({ ...propBase, kind: z.literal("file-ref") }).passthrough(),
]);
export type PropSpec = z.infer<typeof PropSpec>;

const SizeSpec = z.object({ w: z.number().positive(), h: z.number().positive() }).passthrough();

export const WidgetContribution = z
  .object({
    type: z.string().max(PLUGIN_LIMITS.ID_MAX * 2),
    title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    description: z.string().max(PLUGIN_LIMITS.TEXT_MAX).optional(),
    icon: RelativeAssetPath.optional(),
    category: z.enum(WIDGET_CATEGORIES).optional(),
    preview: SafePreview.optional(),

    schemaVersion: z.number().int().positive(),
    surface: z.enum(["dom", "gl"]),
    /** engine vocabulary (defineWidget): resizability is interaction.resizable */
    sizeMode: z.enum(["fixed", "auto-height", "auto"]),
    defaultSize: SizeSpec,
    minSize: SizeSpec.optional(),
    /** reserved — no engine support yet (defineWidget has no maxSize); hosts ignore */
    maxSize: SizeSpec.optional(),

    /** ICE interaction flags — durable contract, host-derived into the prefab.
     * Vocabulary is the engine's WidgetInteraction verbatim: snap
     * source/target/both/none (default target), dragOn press/longPress,
     * sweepContained = the comment-box drag. */
    interaction: z
      .object({
        selectable: z.boolean().optional(),
        movable: z.boolean().optional(),
        resizable: z.boolean().optional(),
        snap: z.enum(["source", "target", "both", "none"]).optional(),
        dragOn: z.enum(["press", "longPress"]).optional(),
        solid: z.boolean().optional(),
        sweepContained: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    /** container semantics (folder-class): drop-to-consume + nested canvas. */
    container: z
      .object({
        accepts: z.array(z.string()).min(1).max(16),
        provides: z.array(z.string()).max(16).optional(),
      })
      .passthrough()
      .optional(),
    /** leaf drop-matching currency when not a container (engine: container wins). */
    provides: z.array(z.string()).max(16).optional(),
    /** node ports (wire endpoints); the engine renders and routes the wires.
     * accepts optional = connects to anything; index = slot along the side. */
    ports: z
      .array(
        z
          .object({
            id: z.string().min(1).max(32),
            side: z.enum(["n", "e", "s", "w"]),
            index: z.number().int().nonnegative().optional(),
            accepts: z.array(z.string()).max(16).optional(),
          })
          .passthrough(),
      )
      .max(PLUGIN_LIMITS.PORTS_MAX)
      .optional(),

    props: z.record(PropSpec).optional().default({}),
    /** NAMED conflict groups (engine truth: the generated strata component is
     * `${type}:${groupName}`, so names are DURABLE). Ungrouped props auto-join
     * the engine's "props" default group — omitting groups entirely is the
     * common case and exactly what all 21 shipped widgets do. */
    groups: z.record(z.array(z.string()).min(1)).optional().default({}),
  })
  .passthrough();
export type WidgetContribution = z.infer<typeof WidgetContribution>;

// --- other contributions (spec §8.3–§8.8) -------------------------------------

export const CanvasSystemContribution = z
  .object({
    id: z.string().max(PLUGIN_LIMITS.ID_MAX * 2),
    /** runs after the engine step; more phases are earned (A7) */
    phase: z.literal("tick"),
    /** per-invocation budget, enforced by the spine scheduler (PA-28) */
    budgetMs: z.number().positive().max(PLUGIN_LIMITS.SYSTEM_BUDGET_MS_MAX),
    /** the honesty tax: why frame cadence is required */
    reason: z.string().min(1).max(PLUGIN_LIMITS.TEXT_MAX),
  })
  .passthrough();
export type CanvasSystemContribution = z.infer<typeof CanvasSystemContribution>;

export const CommandContribution = z
  .object({
    id: z.string().max(PLUGIN_LIMITS.ID_MAX * 2),
    title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    description: z.string().max(PLUGIN_LIMITS.TEXT_MAX).optional(),
    icon: RelativeAssetPath.optional(),
    placements: z
      .array(z.enum(["palette", "widget-context", "canvas-context", "hud", "godview"]))
      .min(1),
    args: JsonSchemaObject.optional(),
  })
  .passthrough();
export type CommandContribution = z.infer<typeof CommandContribution>;

export const SurfaceContribution = z
  .object({
    id: z.string().max(PLUGIN_LIMITS.ID_MAX * 2),
    title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    slot: z.enum(["hud.attention", "hud.panel", "godview.row", "godview.lens"]),
    order: z.number().optional(),
  })
  .passthrough();
export type SurfaceContribution = z.infer<typeof SurfaceContribution>;

export const SettingsContribution = z
  .object({
    properties: z.record(
      z
        .object({
          title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
          description: z.string().max(PLUGIN_LIMITS.TEXT_MAX).optional(),
          scope: z.enum(["user", "device", "secret"]),
          schema: JsonSchemaObject,
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type SettingsContribution = z.infer<typeof SettingsContribution>;

const serviceMethodBase = {
  /** suffix, not full method — the full method is `<namespace>.<name>` */
  name: z.string().regex(ID_SEGMENT_RE).max(PLUGIN_LIMITS.ID_MAX),
  requiredCapability: CapabilityId,
  idempotent: z.boolean(),
  /** v1: dynamic methods never federate (spec §14.6); expansion is a design decision */
  locality: z.literal("local"),
  input: JsonSchemaObject,
  description: z.string().max(PLUGIN_LIMITS.TEXT_MAX).optional(),
};

export const ServiceMethodContribution = z.discriminatedUnion("kind", [
  z
    .object({ ...serviceMethodBase, kind: z.literal("query"), output: JsonSchemaObject })
    .passthrough(),
  z
    .object({ ...serviceMethodBase, kind: z.literal("mutation"), output: JsonSchemaObject })
    .passthrough(),
  z
    .object({
      ...serviceMethodBase,
      kind: z.literal("subscription"),
      snapshot: JsonSchemaObject,
      delta: JsonSchemaObject,
    })
    .passthrough(),
]);
export type ServiceMethodContribution = z.infer<typeof ServiceMethodContribution>;

export const ServiceContribution = z
  .object({
    namespace: z.string().regex(/^x\./, "dynamic services live under x.<pluginId>"),
    methods: z.array(ServiceMethodContribution).min(1).max(PLUGIN_LIMITS.SERVICE_METHODS_MAX),
  })
  .passthrough();
export type ServiceContribution = z.infer<typeof ServiceContribution>;

export const McpContribution = z
  .object({
    tools: z
      .array(
        z
          .object({
            name: z.string().regex(ID_SEGMENT_RE),
            title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
            description: z.string().min(1).max(PLUGIN_LIMITS.TEXT_MAX),
            method: z.string().regex(/^x\./),
          })
          .passthrough(),
      )
      .max(32)
      .optional(),
    servers: z
      .array(
        z
          .object({
            id: z.string().regex(ID_SEGMENT_RE),
            transport: z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("stdio"),
                  executable: z.string().min(1).max(PLUGIN_LIMITS.PATH_MAX),
                  args: z.array(z.string().max(PLUGIN_LIMITS.PATH_MAX)).max(32).optional(),
                  cwdSetting: z.string().max(PLUGIN_LIMITS.ID_MAX).optional(),
                })
                .passthrough(),
              z
                .object({
                  kind: z.literal("http"),
                  urlSetting: z.string().max(PLUGIN_LIMITS.ID_MAX),
                  authSecretSetting: z.string().max(PLUGIN_LIMITS.ID_MAX).optional(),
                })
                .passthrough(),
            ]),
            autoStart: z.boolean().optional(),
          })
          .passthrough(),
      )
      .max(16)
      .optional(),
  })
  .passthrough();
export type McpContribution = z.infer<typeof McpContribution>;

export const PluginCapabilityContribution = z
  .object({
    id: z.string().refine(isCustomCapabilityId, "custom capabilities are x.<pluginId>.<name>"),
    title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    description: z.string().min(1).max(PLUGIN_LIMITS.TEXT_MAX),
    risk: z.enum(["read", "write", "execute", "sensitive"]),
  })
  .passthrough();
export type PluginCapabilityContribution = z.infer<typeof PluginCapabilityContribution>;

// --- the manifest (spec §7.1) -------------------------------------------------

/** The structural shape (exported so declaration emit can reference it by name;
 * the validating export below layers the §7.1 cross-field invariants on top). */
export const PluginManifestV1Shape = z
  .object({
    manifestVersion: z.literal(1),

    id: PluginId,
    version: SemverString,
    title: z.string().min(1).max(PLUGIN_LIMITS.TITLE_MAX),
    description: z.string().max(PLUGIN_LIMITS.TEXT_MAX).optional(),
    icon: RelativeAssetPath.optional(),

    engines: z
      .object({
        app: z.string().min(1).max(64),
        contracts: z.string().min(1).max(64),
        platforms: z
          .array(z.enum(["darwin", "linux", "win32"]))
          .min(1)
          .optional(),
      })
      .passthrough(),

    entries: z
      .object({
        renderer: RelativeModulePath.optional(),
        service: RelativeModulePath.optional(),
      })
      .passthrough()
      .optional(),

    /** applies only to entries.service; default "worker" */
    host: z.enum(["worker", "process"]).optional(),

    activation: z.array(ActivationEvent).max(PLUGIN_LIMITS.ACTIVATION_MAX),
    backgroundReason: z.string().min(1).max(PLUGIN_LIMITS.TEXT_MAX).optional(),
    capabilities: z.array(CapabilityId).max(PLUGIN_LIMITS.CAPABILITIES_MAX),

    contributes: z
      .object({
        capabilities: z
          .array(PluginCapabilityContribution)
          .max(PLUGIN_LIMITS.CAPABILITIES_MAX)
          .optional(),
        widgets: z.array(WidgetContribution).max(PLUGIN_LIMITS.WIDGETS_MAX).optional(),
        systems: z.array(CanvasSystemContribution).max(PLUGIN_LIMITS.SYSTEMS_MAX).optional(),
        commands: z.array(CommandContribution).max(PLUGIN_LIMITS.COMMANDS_MAX).optional(),
        surfaces: z.array(SurfaceContribution).max(PLUGIN_LIMITS.SURFACES_MAX).optional(),
        settings: SettingsContribution.optional(),
        services: z.array(ServiceContribution).max(8).optional(),
        mcp: McpContribution.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

/** Owned-name rule: `<pluginId>` itself (widgets only) or `<pluginId>.<one segment>`. */
function isOwnedName(id: string, name: string, allowBare: boolean): boolean {
  if (allowBare && name === id) return true;
  if (!name.startsWith(`${id}.`)) return false;
  return ID_SEGMENT_RE.test(name.slice(id.length + 1));
}

export const PluginManifestV1: z.ZodEffects<typeof PluginManifestV1Shape> =
  PluginManifestV1Shape.superRefine((m, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    const c = m.contributes ?? {};
    const caps = new Set(m.capabilities);
    const hasRenderer = m.entries?.renderer !== undefined;
    const hasService = m.entries?.service !== undefined;

    // entry requirements (§7.1 invariants)
    const rendererNeeds = [
      c.widgets?.length ? "widgets" : null,
      c.commands?.length ? "commands" : null,
      c.surfaces?.length ? "surfaces" : null,
      c.systems?.length ? "systems" : null,
    ].filter((x) => x !== null);
    if (rendererNeeds.length > 0 && !hasRenderer)
      issue(`${rendererNeeds.join("/")} require entries.renderer`, ["entries"]);
    if ((c.services?.length || c.mcp?.tools?.length) && !hasService)
      issue("dynamic services and contributed MCP tools require entries.service", ["entries"]);
    if (m.host !== undefined && !hasService)
      issue("host is invalid without entries.service", ["host"]);

    // capability requirements
    if (c.services?.length && !caps.has("services.provide"))
      issue("declaring dynamic services requires the services.provide capability", [
        "capabilities",
      ]);
    if (c.settings !== undefined && (hasRenderer || hasService) && !caps.has("storage.self"))
      issue("settings access from code requires the storage.self capability", ["capabilities"]);
    if (c.systems?.length && !caps.has("canvas.read"))
      issue("canvas systems require at least the canvas.read capability", ["capabilities"]);
    if (c.mcp?.tools?.length && !caps.has("mcp.contribute"))
      issue("contributed MCP tools require the mcp.contribute capability", ["capabilities"]);
    if (c.mcp?.servers?.length && !caps.has("mcp.consume"))
      issue("declared MCP servers require the mcp.consume capability", ["capabilities"]);
    for (const s of c.mcp?.servers ?? []) {
      if (s.transport.kind === "stdio" && !caps.has("process.spawn"))
        issue("stdio MCP servers require the process.spawn capability", ["capabilities"]);
      if (s.autoStart === true && !caps.has("background"))
        issue("autoStart MCP servers require the background capability", ["capabilities"]);
    }

    // onStartup (§8.1)
    if (m.activation.includes("onStartup")) {
      if (!hasService) issue("onStartup requires entries.service", ["activation"]);
      if (!caps.has("background"))
        issue("onStartup requires the background capability", ["capabilities"]);
      if (m.backgroundReason === undefined)
        issue("onStartup requires a non-empty backgroundReason", ["backgroundReason"]);
    }

    // ownership + uniqueness per collection (§6.2 — exact names, never split)
    const widgetTypes = (c.widgets ?? []).map((w) => w.type);
    for (const w of c.widgets ?? [])
      if (!isOwnedName(m.id, w.type, true))
        issue(`widget type ${w.type} must be ${m.id} or ${m.id}.<name>`, [
          "contributes",
          "widgets",
        ]);
    for (const [label, ids] of [
      ["widget types", widgetTypes],
      ["command ids", (c.commands ?? []).map((x) => x.id)],
      ["surface ids", (c.surfaces ?? []).map((x) => x.id)],
      ["system ids", (c.systems ?? []).map((x) => x.id)],
      ["capability ids", (c.capabilities ?? []).map((x) => x.id)],
    ] as const) {
      const d = dupes([...ids]);
      if (d.length > 0) issue(`duplicate ${label}: ${d.join(", ")}`, ["contributes"]);
    }
    for (const x of c.commands ?? [])
      if (!isOwnedName(m.id, x.id, false))
        issue(`command ${x.id} must be ${m.id}.<name>`, ["contributes", "commands"]);
    for (const x of c.surfaces ?? [])
      if (!isOwnedName(m.id, x.id, false))
        issue(`surface ${x.id} must be ${m.id}.<name>`, ["contributes", "surfaces"]);
    for (const x of c.systems ?? [])
      if (!isOwnedName(m.id, x.id, false))
        issue(`system ${x.id} must be ${m.id}.<name>`, ["contributes", "systems"]);
    for (const x of c.capabilities ?? [])
      if (!isOwnedName(`x.${m.id}`, x.id, false))
        issue(`custom capability ${x.id} must be x.${m.id}.<name>`, [
          "contributes",
          "capabilities",
        ]);

    // widgets: props/groups/ports coherence (§8.2)
    (c.widgets ?? []).forEach((w, wi) => {
      const path = ["contributes", "widgets", wi];
      const propNames = Object.keys(w.props);
      if (propNames.length > PLUGIN_LIMITS.PROPS_MAX) issue("too many props", path);
      // Explicit groups: names are DURABLE component suffixes (`${type}:${name}`),
      // membership disjoint, members declared. Ungrouped props auto-join the
      // engine's "props" default group, so absence of groups is normal.
      const grouped = new Map<string, number>();
      for (const [gname, members] of Object.entries(w.groups)) {
        if (!ID_SEGMENT_RE.test(gname))
          issue(`group name ${gname} must match [a-z][a-z0-9-]*`, path);
        for (const name of members) {
          if (!propNames.includes(name)) issue(`group names undeclared prop ${name}`, path);
          const n = (grouped.get(name) ?? 0) + 1;
          grouped.set(name, n);
          if (n > 1) issue(`prop ${name} appears in more than one group`, path);
        }
      }
      for (const [name, spec] of Object.entries(w.props)) {
        if (spec.mutable === false && grouped.has(name))
          issue(`immutable prop ${name} must not belong to a conflict group`, path);
        if (
          spec.kind === "enum" &&
          spec.default !== undefined &&
          !spec.options.includes(spec.default)
        )
          issue(`enum default ${spec.default} not in options for prop ${name}`, path);
        if (spec.kind === "number" && spec.default !== undefined) {
          if (spec.min !== undefined && spec.default < spec.min)
            issue(`number default below min for prop ${name}`, path);
          if (spec.max !== undefined && spec.default > spec.max)
            issue(`number default above max for prop ${name}`, path);
        }
        if (
          spec.kind === "string" &&
          spec.default !== undefined &&
          spec.maxLength !== undefined &&
          spec.default.length > spec.maxLength
        )
          issue(`string default exceeds maxLength for prop ${name}`, path);
      }
      const portIds = (w.ports ?? []).map((p) => p.id);
      const pd = dupes(portIds);
      if (pd.length > 0) issue(`duplicate port ids: ${pd.join(", ")}`, path);
    });

    // services: namespace ownership + method-name uniqueness (§8.6/§14.6)
    const declaredMethods = new Set<string>();
    for (const s of c.services ?? []) {
      if (s.namespace !== `x.${m.id}`)
        issue(`service namespace ${s.namespace} must be x.${m.id}`, ["contributes", "services"]);
      const names = s.methods.map((mm) => mm.name);
      const d = dupes(names);
      if (d.length > 0)
        issue(`duplicate service methods: ${d.join(", ")}`, ["contributes", "services"]);
      for (const name of names) declaredMethods.add(`${s.namespace}.${name}`);
    }

    // mcp tools project declared methods; referenced settings must exist with the
    // right scopes (§8.7)
    const settingScopes = new Map(
      Object.entries(c.settings?.properties ?? {}).map(([k, v]) => [k, v.scope]),
    );
    for (const t of c.mcp?.tools ?? [])
      if (!declaredMethods.has(t.method))
        issue(`mcp tool ${t.name} projects undeclared method ${t.method}`, ["contributes", "mcp"]);
    for (const s of c.mcp?.servers ?? []) {
      const refs: Array<[string | undefined, "device" | "secret"]> =
        s.transport.kind === "stdio"
          ? [[s.transport.cwdSetting, "device"]]
          : [
              [s.transport.urlSetting, "device"],
              [s.transport.authSecretSetting, "secret"],
            ];
      for (const [key, want] of refs) {
        if (key === undefined) continue;
        const got = settingScopes.get(key);
        if (got === undefined)
          issue(`mcp server ${s.id} references undeclared setting ${key}`, ["contributes", "mcp"]);
        else if (got !== want)
          issue(`mcp server ${s.id} setting ${key} must be ${want}-scope`, ["contributes", "mcp"]);
      }
    }

    // activation events name owned declarations (§8.1)
    const commandIds = new Set((c.commands ?? []).map((x) => x.id));
    const surfaceIds = new Set((c.surfaces ?? []).map((x) => x.id));
    const widgetTypeSet = new Set(widgetTypes);
    for (const e of m.activation) {
      if (e === "onStartup") continue;
      const [kind, target] = [e.slice(0, e.indexOf(":")), e.slice(e.indexOf(":") + 1)];
      const ok =
        (kind === "onWidget" && widgetTypeSet.has(target)) ||
        (kind === "onCommand" && commandIds.has(target)) ||
        (kind === "onSurface" && surfaceIds.has(target)) ||
        (kind === "onService" && declaredMethods.has(target));
      if (!ok) issue(`activation event ${e} names no owned declaration`, ["activation"]);
    }
  });
export type PluginManifestV1 = z.infer<typeof PluginManifestV1Shape>;

// --- unknown-key visibility (§7.1: preserved AND logged; strict CI rejects) ---

const KNOWN_TOP_KEYS = new Set([
  "manifestVersion",
  "id",
  "version",
  "title",
  "description",
  "icon",
  "engines",
  "entries",
  "host",
  "activation",
  "backgroundReason",
  "capabilities",
  "contributes",
]);
const KNOWN_CONTRIBUTES_KEYS = new Set([
  "capabilities",
  "widgets",
  "systems",
  "commands",
  "surfaces",
  "settings",
  "services",
  "mcp",
]);

/** Top and contributes levels only — deep unknown fields are ordinary tolerant-
 * reader traffic; these two levels are where a typo'd contribution silently
 * grants nothing (the failure worth surfacing). */
export function findUnknownManifestKeys(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const out: string[] = [];
  for (const k of Object.keys(raw)) if (!KNOWN_TOP_KEYS.has(k)) out.push(k);
  const contributes = (raw as Record<string, unknown>)["contributes"];
  if (contributes !== null && typeof contributes === "object")
    for (const k of Object.keys(contributes))
      if (!KNOWN_CONTRIBUTES_KEYS.has(k)) out.push(`contributes.${k}`);
  return out;
}

export type PluginManifestValidation =
  | { ok: true; manifest: PluginManifestV1; unknownKeys: string[] }
  | { ok: false; issues: string[] };

/** The host entry point: parse + invariants + unknown-key visibility. Strict
 * callers (bundled CI, the distribution gate) additionally reject non-empty
 * unknownKeys and non-distributable ids — policy, applied above this. */
export function validatePluginManifest(raw: unknown): PluginManifestValidation {
  const parsed = PluginManifestV1.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
    };
  }
  return { ok: true, manifest: parsed.data, unknownKeys: findUnknownManifestKeys(raw) };
}

// --- grant calculation (spec §15.1/§15.2 — the ALGORITHM lives in contracts;
// fieldd feeds it persisted device-local state and applies the result) --------

/** Which entry kinds may hold each core scope (§15.2). ABSENT means never
 * plugin-eligible (native.admin, tokens.mint, plugins.*, diagnostics.*,
 * audit.append, agent.bless, push.manage — the safe default is silence).
 * Custom x.* capabilities are eligible for both kinds: they gate calls INTO
 * the owner's methods, and callers of either kind may hold them. */
export const PLUGIN_CAPABILITY_ELIGIBILITY: Readonly<
  Partial<Record<Scope, { renderer?: true; service?: true }>>
> = {
  "canvas.read": { renderer: true, service: true },
  "canvas.write": { renderer: true, service: true },
  "doc.read": { renderer: true, service: true },
  "doc.write": { renderer: true, service: true },
  "workspace.read": { renderer: true, service: true },
  "index.read": { renderer: true, service: true },
  "artifact.publish": { renderer: true, service: true },
  "agent.observe": { renderer: true, service: true },
  "approval.respond": { renderer: true, service: true },
  "storage.self": { renderer: true, service: true },
  "mcp.consume": { renderer: true, service: true },
  // service-eligible (§15.2 examples verbatim)
  "services.provide": { service: true },
  "process.spawn": { service: true },
  background: { service: true },
  "net.outbound": { service: true },
  "mcp.contribute": { service: true },
  // renderer-eligible (terminal via the pool; shell.* are window powers;
  // agent spawn/control start renderer-side — service expansion is a decision)
  "terminal.attach": { renderer: true },
  "agent.spawn": { renderer: true },
  "agent.control": { renderer: true },
  "shell.windows": { renderer: true },
  "shell.dialog": { renderer: true },
  "shell.clipboard": { renderer: true },
  "shell.open": { renderer: true },
  "shell.webcontents": { renderer: true },
} as const;

export interface EffectiveGrantsInput {
  requested: readonly string[];
  hasRenderer: boolean;
  hasService: boolean;
  /** v1 source policy grants every source its requests (bundled/registry are
   * reviewed presets §15.3; dev-linked/sideload are developer-mode explicit
   * visibility) — the ceiling hook lands as data with rung policy (§20.5). */
  source: "bundled" | "dev-linked" | "registry" | "sideload";
  /** device-local persisted decisions; `false` is an explicit revocation,
   * absent/true means granted (v1 default-grant with UX visibility — §15.3) */
  persisted?: Readonly<Record<string, boolean>>;
}

export interface EffectiveGrants {
  granted: string[];
  denied: Array<{
    capability: string;
    reason: "entry-kind" | "revoked" | "source-policy" | "host";
  }>;
}

/** §15.2: effective = requested ∩ source-policy ceiling ∩ persisted ∩
 * entry-kind eligibility ∩ host capabilities. The manifest request is a
 * ceiling, not a grant. v1 source policy grants both sources their requests
 * (bundled = reviewed preset per §15.3; dev-linked = developer-mode explicit
 * visibility) — the ceiling HOOK exists so distribution policy lands as data,
 * not a new mechanism. Host-capability pruning is the caller's platform
 * concern and enters as persisted=false today. */
export function computeEffectiveGrants(input: EffectiveGrantsInput): EffectiveGrants {
  const out: EffectiveGrants = { granted: [], denied: [] };
  for (const cap of input.requested) {
    const eligible = isCustomCapabilityId(cap)
      ? input.hasRenderer || input.hasService
      : (() => {
          const e = PLUGIN_CAPABILITY_ELIGIBILITY[cap as Scope];
          if (e === undefined) return false;
          return (
            (e.renderer === true && input.hasRenderer) || (e.service === true && input.hasService)
          );
        })();
    if (!eligible) {
      out.denied.push({ capability: cap, reason: "entry-kind" });
      continue;
    }
    if (input.persisted?.[cap] === false) {
      out.denied.push({ capability: cap, reason: "revoked" });
      continue;
    }
    out.granted.push(cap);
  }
  return out;
}

// --- the legacy walking-skeleton shape (spec §21.1 bridge; retires at P1) -----

/** Today's TS-authored manifest (id is a single dev-era segment; widgets carry
 * presentation-only decls; scopes are granted wholesale). plugin-runtime
 * validates against this and adapts to V1 — see its adapter. */
export const LegacyWidgetDecl = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    defaultSize: SizeSpec,
    description: z.string().max(PLUGIN_LIMITS.TEXT_MAX).optional(),
    category: z.enum(WIDGET_CATEGORIES).optional(),
    /** raw CSS background (legacy only — V1 previews are SafePreview) */
    preview: z.string().max(PLUGIN_LIMITS.PREVIEW_MAX).optional(),
  })
  .passthrough();
export type LegacyWidgetDecl = z.infer<typeof LegacyWidgetDecl>;

export const LegacyPluginManifest = z
  .object({
    id: z.string().regex(ID_SEGMENT_RE),
    version: z.string().min(1),
    title: z.string().min(1),
    widgets: z.array(LegacyWidgetDecl),
    scopes: z.array(z.string().refine((s) => (SCOPES as readonly string[]).includes(s))),
  })
  .passthrough();
export type LegacyPluginManifest = z.infer<typeof LegacyPluginManifest>;
