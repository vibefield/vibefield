import type { PluginManifestV1, SafePreview, WidgetContribution } from "@vibefield/contracts";
import { CONTRACTS_VERSION, validatePluginManifest } from "@vibefield/contracts";
import type { PluginManifest } from "./manifest";

// The §21.1 compatibility adapter: today's TS-authored legacy manifests →
// validated PluginManifestV1 data. TEMPORARY by design — it retires when slice
// P1 lands canonical vibefield.plugin.json files. Honest limits, on purpose:
//
//   - ids stay the single-segment dev aliases (note/field/widgetlab) until the
//     §21.2 durable-ID ratification — V1 tolerates them, distribution refuses
//     them (isDistributablePluginId);
//   - surface/sizeMode/props/groups are DEFAULTED ("dom"/"resizable"/empty):
//     legacy decls never carried the durable prefab contract, so V1 data from
//     this adapter validates the SHAPE but cannot yet reconstruct prefabs —
//     that is exactly P1's job (§8.2: rebuild all shipped types from manifest
//     data alone);
//   - entries.renderer names the artifact P2 packaging will make real; nothing
//     resolves it at P0 (built-ins are statically imported).

export interface AdaptedManifest {
  v1: PluginManifestV1;
  /** dropped/defaulted facts a P1 canonical manifest must state properly */
  warnings: string[];
}

function mapPreview(
  css: string | undefined,
  type: string,
  warnings: string[],
): SafePreview | undefined {
  if (css === undefined) return undefined;
  if (/^#[0-9a-fA-F]{3,8}$/.test(css)) return { kind: "color", value: css };
  if (
    (css.startsWith("linear-gradient(") || css.startsWith("radial-gradient(")) &&
    !css.includes("url(") &&
    !/[;}]/.test(css)
  )
    return { kind: "gradient", value: css };
  warnings.push(`${type}: legacy preview is not a SafePreview (dropped): ${css.slice(0, 40)}`);
  return undefined;
}

export function adaptLegacyManifest(legacy: PluginManifest): AdaptedManifest {
  const warnings: string[] = [];
  const widgets: WidgetContribution[] = legacy.widgets.map((w) => {
    const preview = mapPreview(w.preview, w.type, warnings);
    return {
      type: w.type,
      title: w.title,
      ...(w.description !== undefined ? { description: w.description } : {}),
      ...(w.category !== undefined ? { category: w.category } : {}),
      ...(preview !== undefined ? { preview } : {}),
      schemaVersion: 1,
      surface: "dom" as const,
      sizeMode: "resizable" as const,
      defaultSize: w.defaultSize,
      props: {},
      groups: [],
    };
  });
  const raw = {
    manifestVersion: 1,
    id: legacy.id,
    version: legacy.version,
    title: legacy.title,
    engines: { app: ">=0.0.0", contracts: `^${CONTRACTS_VERSION}` },
    entries: { renderer: "./dist/renderer.js" },
    activation: legacy.widgets.map((w) => `onWidget:${w.type}`),
    capabilities: [...legacy.scopes],
    contributes: { widgets },
  };
  const result = validatePluginManifest(raw);
  if (!result.ok)
    throw new Error(
      `legacy manifest ${legacy.id} fails V1 adaptation: ${result.issues.join(" · ")}`,
    );
  return { v1: result.manifest, warnings };
}
