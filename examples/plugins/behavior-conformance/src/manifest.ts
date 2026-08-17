import type { PluginManifestV1 } from "@vibefield/contracts";
import {
  BreakerProbe,
  breakerContribution,
  DurableProbe,
  durableContribution,
  PLUGIN_ID,
  presenceContribution,
  RuntimeProbe,
  runtimeContribution,
  WIDGET_TYPE,
} from "./behaviors";

/**
 * A non-shipping vertical fixture for plugin architecture PRC-4f. It is deliberately ordinary:
 * the same manifest emitter, package builder, mock host, fieldd projection, staged loader, and
 * document host used by authored plugins consume it without a conformance-only API.
 */
export const behaviorConformanceManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: PLUGIN_ID,
  version: "0.1.0",
  title: "Behavior conformance",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onWidget:${WIDGET_TYPE}`],
  capabilities: ["canvas.write"],
  contributes: {
    behaviors: [
      durableContribution,
      runtimeContribution,
      breakerContribution,
      presenceContribution,
    ],
    widgets: [
      {
        type: WIDGET_TYPE,
        title: "Behavior conformance card",
        description: "Exercises durable/runtime riders and bounded presence through the host",
        category: "Tools",
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 220, h: 120 },
        interaction: { selectable: true, movable: true },
        props: {},
        groups: {},
        behaviors: [
          { id: DurableProbe.name, data: { count: 5 } },
          { id: RuntimeProbe.name, data: { count: 7 } },
          { id: BreakerProbe.name },
        ],
      },
    ],
  },
};
