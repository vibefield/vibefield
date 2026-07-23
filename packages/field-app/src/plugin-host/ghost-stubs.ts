import type { WidgetType } from "@vibecook/ice";
import { isDistributablePluginId, type WidgetContribution } from "@vibefield/contracts";
import { getRendererLogger } from "../logging";
import { buildWidgetType } from "./build-widget";
import { ghostFaceComponent } from "./faces";

// P3c — ghost stubs (§12.4, the ABSENT case): a board can carry widgets of a
// plugin this device does not have at all. The envelope header names every
// widget type + pack version pre-open, so the host registers a STUB prefab at
// exactly the doc's version — the engine's pack-marker gate stays satisfied
// (the board opens WRITABLE), the entity keeps position/size/z, the props cell
// simply never projects (probe-proven to survive export byte-for-byte), and
// the face says honestly what it is.
//
// Stubs are process-permanent (ICE's widget catalog cannot un-define — the C2
// no-aliasing finding), which is exactly right for absent plugins: installing
// one is a restart-shaped event. Disabled-but-PRESENT plugins never come here
// — they register their real schemas and swap faces live (faces.tsx).
//
// Only distributable-shaped ids (≥2 dot segments) are stubbed: engine-internal
// prefabs like "wire" ride the header too and must stay untouched.

export function buildGhostWidgetTypes(
  headerPrefabVersions: Record<string, number> | undefined,
  registeredTypes: ReadonlySet<string>,
): WidgetType[] {
  if (headerPrefabVersions === undefined) return [];
  const out: WidgetType[] = [];
  for (const [type, version] of Object.entries(headerPrefabVersions)) {
    if (registeredTypes.has(type)) continue;
    if (!isDistributablePluginId(type)) continue; // engine-internal — never ours to stub
    const contribution: WidgetContribution = {
      type,
      title: type,
      description: "preserved content from a plugin this device does not have",
      category: "Tools",
      surface: "dom",
      schemaVersion: version,
      sizeMode: "fixed",
      defaultSize: { w: 240, h: 160 },
      props: {},
      groups: {},
      provides: ["widget"],
      interaction: { selectable: true, movable: true, resizable: true, snap: "target" },
    };
    out.push(buildWidgetType(contribution, { component: ghostFaceComponent(type) }));
    getRendererLogger()
      .child({ component: "plugin.host" })
      .warn(
        "renderer.plugins.ghost_stub_registered",
        "A preserving widget stub was registered for an absent plugin",
        { type, version },
      );
  }
  return out;
}
