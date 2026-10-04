import { type AnyBehaviorDef, defineWidget, p, type WidgetType } from "@vibecook/ice";
import { defineObject, isObjectKind } from "@vibecook/ice/desk";
import type { ObjectContribution, PropSpec, WidgetContribution } from "@vibefield/contracts";
import type { ObjectBinding } from "@vibefield/plugin-sdk";

// §12.2 — the HOST builds every prefab from manifest data; plugins never call
// defineWidget or defineObject (thinking-p1-canonical-manifests.md; spec §12.8).
// Doc-compat invariant: for a group-less contribution this call must be
// indistinguishable from the retired hand call — same `${type}:props` durable
// component, same prop defaults/bounds, same interaction tags. The contract
// vocabulary is the engine's verbatim (PLUG-P1a), so mapping is 1:1; anything
// the engine can't express refuses loudly rather than approximating.
//
// DK-2 (desk/landing, ICE 0.14.0): a widget's FACE is its object kind. ICE refuses
// the DOM/R3F face fields at definition (`surface`, `component`, `chrome`,
// `animated`, `preview`, `instancePreview`, `sizeMode`, a container's
// `framePreview`), so a `widgets` row compiles FACELESS — its durable half only,
// bound to NO kind: the document's data survives and the entity stays pickable by
// its box (ICE draws it with its missing face from 0.15.0, DK-D18 as amended;
// until then it is invisible). An `objects` row compiles through `defineObject`
// with the kind its renderer module exports.

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

// DK-8: the C2 rename history (`TYPE_RENAMES`, the `renamedFrom` projection) RETIRED with the
// `vibefield.*` types it renamed — note, field-tools and widgetlab. Every board that could carry a
// pre-C2 id is a board from before the desk, refused at open (field/desk/pre-desk.ts; DK-D13).

// defineWidget registers into ICE's process-global catalog and THROWS on a
// duplicate type. The retired hand calls ran once per process as import side
// effects; this cache preserves exactly that semantic for repeated
// buildRegistry() calls (tests, multiple windows in one renderer).
const built = new Map<string, WidgetType>();

/** The durable half both doors share: props, groups, interaction, container,
 * provides, ports and the behavior riders. */
function durableHalf(
  row: WidgetContribution | ObjectContribution,
  owner: { pluginId: string; pluginTitle: string } | undefined,
  behaviorBindings: ReadonlyMap<string, { readonly handle: AnyBehaviorDef }>,
) {
  const props = Object.fromEntries(
    Object.entries(row.props).map(([name, spec]) => [name, buildProp(row.type, name, spec)]),
  );
  const behaviors = (row.behaviors ?? []).map((attachment) => {
    if (owner !== undefined && !attachment.id.startsWith(`${owner.pluginId}:`)) {
      throw new Error(
        `widget ${row.type} behavior ${attachment.id} is outside plugin ${owner.pluginId}`,
      );
    }
    const bound = behaviorBindings.get(attachment.id);
    if (bound === undefined) {
      throw new Error(`widget ${row.type} behavior ${attachment.id} has no sealed code binding`);
    }
    if (bound.handle.name !== attachment.id) {
      throw new Error(
        `widget ${row.type} behavior binding ${bound.handle.name} does not match ${attachment.id}`,
      );
    }
    if (bound.handle.store === "ephemeral") {
      throw new Error(`widget ${row.type} cannot pre-attach ephemeral behavior ${attachment.id}`);
    }
    return attachment.data === undefined ? bound.handle : bound.handle.with(attachment.data);
  });
  return {
    type: row.type,
    version: row.schemaVersion,
    ...(row.minSize !== undefined ? { minSize: row.minSize } : {}),
    props,
    ...(Object.keys(row.groups).length > 0 ? { groups: row.groups } : {}),
    ...(row.interaction !== undefined ? { interaction: row.interaction } : {}),
    ...(row.container !== undefined ? { container: row.container } : {}),
    ...(row.provides !== undefined ? { provides: row.provides } : {}),
    ...(row.ports !== undefined ? { ports: row.ports } : {}),
    ...(behaviors.length > 0 ? { behaviors } : {}),
  };
}

/** A LEGACY `widgets` row → a FACELESS widget type (DK-2): the manifest's durable half
 * and its `defaultSize`, no face of any kind — none of the fields ICE 0.14 refuses
 * ever reaches `defineWidget`. */
export function buildWidgetType(
  w: WidgetContribution,
  owner?: { pluginId: string; pluginTitle: string },
  behaviorBindings: ReadonlyMap<string, { readonly handle: AnyBehaviorDef }> = new Map(),
): WidgetType {
  const cached = built.get(w.type);
  if (cached !== undefined) return cached;
  const def = { ...durableHalf(w, owner, behaviorBindings), defaultSize: w.defaultSize };
  // Boundary cast, attested: zod `.optional()` infers `| undefined` on every
  // optional under exactOptionalPropertyTypes, which WidgetDef's optionals
  // reject. Runtime values are parse products — absent keys stay ABSENT (zod
  // never materializes `key: undefined`), and defineWidget's own
  // definition-time validation is the enforcement net behind this seam.
  const widget = defineWidget(def as Parameters<typeof defineWidget>[0]);
  built.set(w.type, widget);
  return widget;
}

/** An `objects` row + the kind its renderer module exports → an OBJECT type, through
 * ICE's `defineObject` (spec §12.8): the manifest's durable half, its `size`, its
 * tray entry, and the binding's `kind`, `migrate`, `drivers`, `host` and `menu`.
 * The host's rules (plan §5, DK-6 inputs): the kind must be a desk kind whose
 * registry `name` IS the type (one id, no second namespace); a tray entry must say
 * how it hangs (`tray.hang` — a derived default would be a guess the author never
 * saw; the contract requires it too since DK-3, ruling 9, and the host still refuses
 * a hangless entry that reached it some other way); `provides` is taken as declared,
 * never padded with a key the manifest did not name. Each refusal names the type. */
export function buildObjectType(
  o: ObjectContribution,
  binding: ObjectBinding,
  owner?: { pluginId: string; pluginTitle: string },
  behaviorBindings: ReadonlyMap<string, { readonly handle: AnyBehaviorDef }> = new Map(),
): WidgetType {
  const cached = built.get(o.type);
  if (cached !== undefined) return cached;
  const { kind } = binding;
  if (!isObjectKind(kind)) {
    throw new Error(
      `object ${o.type}: its export \`${o.binding.kind}\` holds no desk kind (ICE \`isObjectKind\`: a program with resolve · record · hit · reach)`,
    );
  }
  if (kind.name !== o.type) {
    throw new Error(
      `object ${o.type}: its kind is named "${kind.name}" — a kind's registry name IS its type`,
    );
  }
  if (o.tray !== undefined && o.tray.hang === undefined) {
    throw new Error(`object ${o.type}: tray.hang is required — say how the specimen hangs`);
  }
  const def = {
    ...durableHalf(o, owner, behaviorBindings),
    kind,
    size: o.size,
    ...(o.tray !== undefined ? { tray: o.tray } : {}),
    ...(binding.migrate !== undefined ? { migrate: binding.migrate } : {}),
    ...(binding.drivers !== undefined ? { drivers: binding.drivers } : {}),
    ...(binding.host !== undefined ? { host: binding.host } : {}),
    ...(binding.menu !== undefined ? { menu: binding.menu } : {}),
  };
  // The same attested zod boundary as above. The binding's members are typed since the
  // SDK's `/desk` door (DK-6) — ICE's own `ObjectKind`, `DriverFactory`, `ObjectHost`,
  // `MenuActionDef` — yet they are a plugin's DATA at run time, so `isObjectKind` checked
  // the kind and `defineObject`/`defineWidget` validate the rest at definition.
  const object = defineObject(def as Parameters<typeof defineObject>[0]);
  built.set(o.type, object);
  return object;
}

/** The object rows' code halves, read off a renderer module's NAMESPACE by each row's
 * `binding.kind` export name (spec §12.8: a static export, never a registration from
 * `activate`), keyed by type. A name the module does not export is simply absent here:
 * field-engine then compiles that row faceless, its data preserved, and says why. */
export function objectBindingsFrom(
  namespace: unknown,
  objects: readonly ObjectContribution[],
): Map<string, ObjectBinding> {
  const out = new Map<string, ObjectBinding>();
  if (typeof namespace !== "object" || namespace === null) return out;
  for (const o of objects) {
    const value = (namespace as Record<string, unknown>)[o.binding.kind];
    if (typeof value === "object" && value !== null && "kind" in value)
      out.set(o.type, value as ObjectBinding);
  }
  return out;
}

/** An `objects` row whose kind could not be bound (no such export, not a desk kind, a
 * refused binding) still keeps its document's data: the type compiles FACELESS from
 * its durable half — no tray (a specimen is the kind's own drawing) — and ICE draws
 * it with its missing face from 0.15.0 (DK-D18 as amended). */
export function buildFacelessObjectType(
  o: ObjectContribution,
  owner?: { pluginId: string; pluginTitle: string },
  behaviorBindings: ReadonlyMap<string, { readonly handle: AnyBehaviorDef }> = new Map(),
): WidgetType {
  const cached = built.get(o.type);
  if (cached !== undefined) return cached;
  const def = { ...durableHalf(o, owner, behaviorBindings), defaultSize: o.size };
  const widget = defineWidget(def as Parameters<typeof defineWidget>[0]);
  built.set(o.type, widget);
  return widget;
}
