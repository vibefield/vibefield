import type { PluginManifestV1 } from "@vibefield/contracts";
import {
  BreakerProbe,
  breakerContribution,
  CARRIER_TYPE,
  DurableProbe,
  durableContribution,
  PLUGIN_ID,
  presenceContribution,
  RuntimeProbe,
  runtimeContribution,
} from "./behaviors";

/**
 * A non-shipping vertical fixture for plugin architecture PRC-4f. It is deliberately ordinary:
 * the same manifest emitter, package builder, mock host, fieldd projection, staged loader, and
 * document host used by authored plugins consume it without a conformance-only API.
 *
 * DK-4 (desk/landing): the riders' carrier is an OBJECT kind of the fixture's own — the plugin
 * door's shape (DK-D22; DK-2's clock): an `objects` row the desk places (`desk.object`), bound by
 * name to the kind its renderer module exports. A widget row places nowhere on the desk.
 */
export const behaviorConformanceManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: PLUGIN_ID,
  version: "0.1.0",
  title: "Behavior conformance",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onWidget:${CARRIER_TYPE}`],
  capabilities: ["canvas.write"],
  contributes: {
    behaviors: [
      durableContribution,
      runtimeContribution,
      breakerContribution,
      presenceContribution,
    ],
    objects: [
      {
        type: CARRIER_TYPE,
        title: "Behavior conformance card",
        description: "Exercises durable/runtime riders and bounded presence through the host",
        schemaVersion: 1,
        size: { w: 220, h: 120 },
        provides: ["desk.object"],
        interaction: { selectable: true, movable: true },
        props: {},
        groups: {},
        behaviors: [
          { id: DurableProbe.name, data: { count: 5 } },
          { id: RuntimeProbe.name, data: { count: 7 } },
          { id: BreakerProbe.name },
        ],
        binding: { kind: "card" },
      },
    ],
  },
};
