// `inspect` — what the host will see, computed from the artifact on disk: the
// resolved contributions, the requested capabilities and how they resolve per
// entry kind, the identity hashes, and how many widget states the playground
// would render.
//
// The grant column is not this tool's opinion: `computeEffectiveGrants` is the
// contracts function fieldd itself applies (§15.2), called here with the same
// inputs a dev-linked install would produce.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { computeEffectiveGrants, type PluginManifestV1 } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";

export interface InspectedWidget {
  readonly type: string;
  readonly title: string;
  readonly surface: "dom" | "gl";
  readonly schemaVersion: number;
  readonly props: number;
  readonly groups: string[];
  readonly ports: number;
  /** named playground states, or 1 when the plugin declares none (§P8-D8's
   * "absent file ⇒ one `default` state from prop defaults") */
  readonly states: number;
}

export interface InspectionResult {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  /** sha256 over the canonical manifest bytes — §9.2's identity */
  readonly manifestHash: string;
  readonly entries: { renderer?: string; service?: string; host?: "worker" | "process" };
  readonly activation: string[];
  readonly capabilities: {
    readonly requested: string[];
    readonly granted: string[];
    readonly denied: Array<{ capability: string; reason: string }>;
  };
  readonly contributions: {
    readonly widgets: InspectedWidget[];
    readonly commands: Array<{ id: string; title: string; placements: string[] }>;
    readonly surfaces: Array<{ id: string; title: string; slot: string }>;
    readonly behaviors: Array<{
      id: string;
      store: "durable" | "runtime" | "ephemeral";
      phase: "simulate" | "derive" | "present" | "publish";
      hooks: string[];
      budgetMs?: number;
    }>;
    readonly settings: Array<{ key: string; scope: string }>;
    readonly services: Array<{ namespace: string; methods: string[] }>;
    readonly capabilities: Array<{ id: string; risk: string }>;
    readonly mcp: { tools: string[]; servers: string[] };
  };
  /** where the playground state fixtures came from, said plainly */
  readonly statesSource: "playground" | "defaults";
  readonly totalStates: number;
}

/** §9.2 identity: sha256 over the CANONICAL bytes, so two manifests that mean
 * the same thing hash the same. */
export function manifestHashOf(manifest: PluginManifestV1): string {
  return `sha256:${createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex")}`;
}

/**
 * Named widget states from `playground/states.*`, tolerated rather than
 * demanded: the file is authoring-time bench material whose contract belongs to
 * the playground, so an unreadable or unrecognised one degrades to the default
 * state count instead of failing an inspection.
 */
async function readPlaygroundStates(
  root: string,
): Promise<{ source: "playground" | "defaults"; byType: Map<string, number> }> {
  const byType = new Map<string, number>();
  const candidate = ["states.ts", "states.mts", "states.js", "states.mjs"]
    .map((name) => join(root, "playground", name))
    .find((path) => existsSync(path));
  if (candidate === undefined) return { source: "defaults", byType };

  try {
    const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
    const table = (mod["states"] ?? mod["default"]) as unknown;
    if (typeof table !== "object" || table === null) return { source: "defaults", byType };
    for (const [type, states] of Object.entries(table as Record<string, unknown>)) {
      if (typeof states !== "object" || states === null) continue;
      byType.set(type, Object.keys(states as Record<string, unknown>).length);
    }
    return { source: byType.size > 0 ? "playground" : "defaults", byType };
  } catch {
    // The playground owns this file's contract; an inspection never fails on it.
    return { source: "defaults", byType };
  }
}

export async function inspectPlugin(
  root: string,
  manifest: PluginManifestV1,
): Promise<InspectionResult> {
  const c = manifest.contributes ?? {};
  const hasRenderer = manifest.entries?.renderer !== undefined;
  const hasService = manifest.entries?.service !== undefined;
  const grants = computeEffectiveGrants({
    requested: manifest.capabilities,
    hasRenderer,
    hasService,
    source: "dev-linked",
  });
  const states = await readPlaygroundStates(resolve(root));

  const widgets: InspectedWidget[] = (c.widgets ?? []).map((w) => ({
    type: w.type,
    title: w.title,
    surface: w.surface,
    schemaVersion: w.schemaVersion,
    props: Object.keys(w.props).length,
    groups: Object.keys(w.groups),
    ports: (w.ports ?? []).length,
    states: states.byType.get(w.type) ?? 1,
  }));

  return {
    id: manifest.id,
    version: manifest.version,
    title: manifest.title,
    manifestHash: manifestHashOf(manifest),
    entries: {
      ...(manifest.entries?.renderer !== undefined ? { renderer: manifest.entries.renderer } : {}),
      ...(manifest.entries?.service !== undefined ? { service: manifest.entries.service } : {}),
      ...(manifest.host !== undefined ? { host: manifest.host } : {}),
    },
    activation: [...manifest.activation],
    capabilities: {
      requested: [...manifest.capabilities],
      granted: grants.granted,
      denied: grants.denied,
    },
    contributions: {
      widgets,
      commands: (c.commands ?? []).map((x) => ({
        id: x.id,
        title: x.title,
        placements: [...x.placements],
      })),
      surfaces: (c.surfaces ?? []).map((x) => ({ id: x.id, title: x.title, slot: x.slot })),
      behaviors: (c.behaviors ?? []).map((x) => ({
        id: x.id,
        store: x.definition.store,
        phase: x.definition.phase,
        hooks: [...x.definition.hooks],
        ...(x.definition.budgetMs === undefined ? {} : { budgetMs: x.definition.budgetMs }),
      })),
      settings: Object.entries(c.settings?.properties ?? {}).map(([key, v]) => ({
        key,
        scope: v.scope,
      })),
      services: (c.services ?? []).map((s) => ({
        namespace: s.namespace,
        methods: s.methods.map((m) => `${m.name} (${m.kind})`),
      })),
      capabilities: (c.capabilities ?? []).map((x) => ({ id: x.id, risk: x.risk })),
      mcp: {
        tools: (c.mcp?.tools ?? []).map((t) => t.name),
        servers: (c.mcp?.servers ?? []).map((s) => s.id),
      },
    },
    statesSource: states.source,
    totalStates: widgets.reduce((sum, w) => sum + w.states, 0),
  };
}

/** The human register: an inspection is read top-down, so it prints as a
 * report, not a table of tables. */
export function formatInspection(result: InspectionResult): string {
  const lines: string[] = [];
  const push = (label: string, value: string): void => {
    lines.push(`${label.padEnd(14)} ${value}`);
  };
  push("plugin", `${result.id}@${result.version} — ${result.title}`);
  push("manifestHash", result.manifestHash);
  push(
    "entries",
    Object.entries(result.entries)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ") || "none",
  );
  push("activation", result.activation.join(", ") || "none");
  push("requested", result.capabilities.requested.join(", ") || "none");
  push("granted", result.capabilities.granted.join(", ") || "none");
  for (const denial of result.capabilities.denied)
    push("denied", `${denial.capability} (${denial.reason})`);

  const c = result.contributions;
  for (const w of c.widgets)
    push(
      "widget",
      `${w.type} — ${w.surface}, v${w.schemaVersion}, ${w.props} prop(s), ${w.ports} port(s), ${w.states} state(s)`,
    );
  for (const x of c.commands) push("command", `${x.id} [${x.placements.join(", ")}]`);
  for (const x of c.surfaces) push("surface", `${x.id} → ${x.slot}`);
  for (const x of c.behaviors) {
    const hooks = x.hooks.join(", ") || "no hooks";
    const budget = x.budgetMs === undefined ? "" : `, ${x.budgetMs}ms budget`;
    push("behavior", `${x.id} (${x.store}/${x.phase}, ${hooks}${budget})`);
  }
  for (const x of c.settings) push("setting", `${x.key} (${x.scope})`);
  for (const x of c.services) push("service", `${x.namespace}: ${x.methods.join(", ")}`);
  for (const x of c.capabilities) push("capability", `${x.id} (${x.risk})`);
  for (const t of c.mcp.tools) push("mcp tool", t);
  for (const s of c.mcp.servers) push("mcp server", s);
  push("states", `${result.totalStates} total (from ${result.statesSource})`);
  return lines.join("\n");
}
