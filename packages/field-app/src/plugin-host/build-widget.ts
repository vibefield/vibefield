import { defineWidget, p, type WidgetType } from "@vibecook/ice";
import type { PropSpec, WidgetContribution } from "@vibefield/contracts";

// §12.2 — the HOST builds every prefab from manifest data; plugins export
// components, never call defineWidget (thinking-p1-canonical-manifests.md).
// Doc-compat invariant: for a group-less contribution this call must be
// indistinguishable from the retired hand call — same `${type}:props` durable
// component, same prop defaults/bounds, same interaction tags. The contract
// vocabulary is the engine's verbatim (PLUG-P1a), so mapping is 1:1; anything
// the engine can't express refuses loudly rather than approximating.

/** The opaque code-side params (view registration, never durable data). */
export interface WidgetBinding {
  component: unknown;
  /** GL-only: DOM chrome portaled UNDER the canvas (CardChrome sandwich). */
  chrome?: unknown;
  /** GL-only: per-frame island repaint opt-in (design-004 §3). */
  animated?: boolean;
  /** tray preview override (tri-tier: absent → sandbox-mounted component). */
  preview?: unknown;
}

function buildProp(type: string, name: string, spec: PropSpec) {
  switch (spec.kind) {
    case "string":
      return p.string(spec.default !== undefined ? { default: spec.default } : {});
    case "number":
      return p.number({
        ...(spec.default !== undefined ? { default: spec.default } : {}),
        ...(spec.min !== undefined ? { min: spec.min } : {}),
        ...(spec.max !== undefined ? { max: spec.max } : {}),
      });
    case "boolean":
      return p.boolean(spec.default !== undefined ? { default: spec.default } : {});
    case "enum":
      return p.enum(spec.options, spec.default !== undefined ? { default: spec.default } : {});
    case "json":
      return p.json(spec.inner, spec.default !== undefined ? { default: spec.default } : {});
    default:
      // ref kinds (entity/session/terminal/artifact/file) have no engine
      // constructor yet — no shipped user either (A7): refuse, never guess.
      throw new Error(`widget ${type} prop ${name}: kind ${spec.kind} has no engine constructor`);
  }
}

// defineWidget registers into ICE's process-global catalog and THROWS on a
// duplicate type. The retired hand calls ran once per process as import side
// effects; this cache preserves exactly that semantic for repeated
// buildRegistry() calls (tests, multiple windows in one renderer).
const built = new Map<string, WidgetType>();

export function buildWidgetType(w: WidgetContribution, binding: WidgetBinding): WidgetType {
  const cached = built.get(w.type);
  if (cached !== undefined) return cached;

  const props = Object.fromEntries(
    Object.entries(w.props).map(([name, spec]) => [name, buildProp(w.type, name, spec)]),
  );
  const def = {
    type: w.type,
    version: w.schemaVersion,
    surface: w.surface,
    component: binding.component,
    ...(binding.chrome !== undefined ? { chrome: binding.chrome } : {}),
    ...(binding.animated !== undefined ? { animated: binding.animated } : {}),
    ...(binding.preview !== undefined ? { preview: binding.preview } : {}),
    sizeMode: w.sizeMode,
    defaultSize: w.defaultSize,
    ...(w.minSize !== undefined ? { minSize: w.minSize } : {}),
    props,
    ...(Object.keys(w.groups).length > 0 ? { groups: w.groups } : {}),
    ...(w.interaction !== undefined ? { interaction: w.interaction } : {}),
    ...(w.container !== undefined ? { container: w.container } : {}),
    ...(w.provides !== undefined ? { provides: w.provides } : {}),
    ...(w.ports !== undefined ? { ports: w.ports } : {}),
  };
  // Boundary cast, attested: zod `.optional()` infers `| undefined` on every
  // optional under exactOptionalPropertyTypes, which WidgetDef's optionals
  // reject. Runtime values are parse products — absent keys stay ABSENT (zod
  // never materializes `key: undefined`), and defineWidget's own
  // definition-time validation is the enforcement net behind this seam.
  const widget = defineWidget(def as Parameters<typeof defineWidget>[0]);
  built.set(w.type, widget);
  return widget;
}
