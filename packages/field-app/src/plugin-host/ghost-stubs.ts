import type { WidgetType } from "@vibecook/ice";
import { isDistributablePluginId } from "@vibefield/contracts";
import { getRendererLogger } from "../logging";
import { buildFacelessType, type FacelessRow } from "./build-widget";

// P3c — ghost stubs (§12.4, the ABSENT case): a board can carry widgets of a
// plugin this device does not have at all. The envelope header names every
// widget type + pack version pre-open, so the host registers a STUB prefab at
// exactly the doc's version — the engine's pack-marker gate stays satisfied
// (the board opens WRITABLE), the entity keeps position/size/z, and the props
// cell simply never projects (probe-proven to survive export byte-for-byte).
//
// DK-2 (desk/landing, ICE 0.14.0; DK-D18 as amended 3 Oct): a stub is a FACELESS
// type — `defineWidget` with no face field, bound to NO kind. ICE draws an entity
// whose type has no kind with its own missing face (petition I24, a faint hatched
// card, pickable — from 0.15.0; until that pin it is invisible but still pickable
// by its box), and VibeField's selection bar names the type (DK-11). No VibeField
// placeholder kind exists.
//
// Stubs are process-permanent (ICE's widget catalog cannot un-define — the C2
// no-aliasing finding), which is exactly right for absent plugins: installing
// one is a restart-shaped event. Disabled-but-PRESENT plugins never come here —
// they register their real schemas.
//
// The FILTER reads the engine's full PACK SCOPE (`fieldPackScope` in
// field-engine.ts: every pack the engine can interpret — the registry's types,
// the desk's six kinds, their DATA prefabs `desk.stroke`/`desk.event`/`desk.pin`,
// `wire` and the canvas packs). A header naming any of those is never stubbed:
// a stub for `desk.stroke` would collide with the desk's own data prefab at
// engine build (r2 R4). Only distributable-shaped ids (≥2 dot segments) outside
// that scope are stubbed.

export function buildGhostWidgetTypes(
  headerPrefabVersions: Record<string, number> | undefined,
  packScope: ReadonlySet<string>,
): WidgetType[] {
  if (headerPrefabVersions === undefined) return [];
  const out: WidgetType[] = [];
  for (const [type, version] of Object.entries(headerPrefabVersions)) {
    if (packScope.has(type)) continue;
    if (!isDistributablePluginId(type)) continue; // engine-internal — never ours to stub
    // DK-8: a HOST-LOCAL row (it was a WidgetContribution until `contributes.widgets`
    // retired) — the same durable half and spawn size the stub has carried since P3c.
    const stub: FacelessRow = {
      type,
      schemaVersion: version,
      size: { w: 240, h: 160 },
      props: {},
      groups: {},
      provides: ["widget"],
      interaction: { selectable: true, movable: true, resizable: true, snap: "target" },
    };
    out.push(buildFacelessType(stub));
    getRendererLogger()
      .child({ component: "plugin.host" })
      .warn(
        "renderer.plugins.ghost_stub_registered",
        "A faceless preserving stub was registered for an absent plugin type",
        { type, version },
      );
  }
  return out;
}
