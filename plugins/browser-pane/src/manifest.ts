import type { PluginManifestV1 } from "@vibefield/contracts";
import { DEVICE_IDS, hundredth, PANE_MIN_SIZE, PANE_SIZE } from "./devices";
import {
  BROWSER_PANE_CATEGORY,
  BROWSER_PANE_TYPE,
  PANE_FINISHES,
  PANE_SCHEMES,
  SAMPLE_URL,
  URL_MAX,
} from "./ids";

/**
 * THE BROWSER PANE (PT-1, PORTALS — the first live surface back on the desk as a proper object kind, built as a plugin
 * kind exactly as a third party builds one, the comment pad's shape): a pane of clear glass lying on the desk, cut to its
 * page at its device's density, its head engraved with the browser's chrome, its page a STILL in PT-1 (live frames are
 * PT-2's; use is PT-3's).
 *
 * This manifest is the pane's DURABLE half: its `url` (the address its head prints and its page shows), its `device`
 * (laptop, desktop, tablet, phone — a viewport AND a density), its `finish` (the glass) and its `scheme` (the page's
 * colours: the desk's, or fixed); its size — a laptop's page, 1280 × 800 — and the floor a resize stops at (the
 * smallest viewport at the finest density; a pane's viewport is DERIVED from its size, never stored — PT-1 ruling 5);
 * its interaction (selectable, carried by core's drag, RESIZED by core's handles — they write the size, and the page
 * follows); what it PROVIDES (it lies on the desk; it does not go into a mini mat yet — no chip); and its tray entry — a
 * pane on a shelf under a NEW category, `portals`, its specimen the sample page drawn with the kind's desk state. The
 * code half is the export `binding.kind` names (object.ts). Emitted to `vibefield.plugin.json` by `pnpm gen:manifest`;
 * the imports here stay pure (ids and devices) so emitting needs no bundle.
 */
export const browserPaneManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: BROWSER_PANE_TYPE,
  version: "0.1.0",
  title: "Browser pane",
  description:
    "A browser on the desk: a pane of clear glass cut to its page at its device's density, its chrome engraved in its head — its page live through the desk's LIVE service, its own sample a still",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onObject:${BROWSER_PANE_TYPE}`],
  // PT-2: a live page — the desk's LIVE service opens it only for an object whose plugin is granted both (ruling 3)
  capabilities: ["surface.attach", "surface.browser"],
  contributes: {
    objects: [
      {
        type: BROWSER_PANE_TYPE,
        title: "Browser",
        description:
          "A pane of glass cut to its page: resize it and its page re-lays out; switch its device and it is re-cut to that screen's size",
        schemaVersion: 1,
        size: { w: PANE_SIZE.w, h: PANE_SIZE.h },
        minSize: { w: PANE_MIN_SIZE.w, h: PANE_MIN_SIZE.h },
        interaction: { selectable: true, movable: true, resizable: true, snap: "both" },
        // the SDK's DESK_OBJECT (test/manifest.test.ts holds it equal): it lies on the desk, by what it provides (K8a)
        provides: [BROWSER_PANE_TYPE, "desk.object"],
        // one cell: a device switch writes the device beside the size it cuts, one transaction (device.ts)
        groups: {},
        props: {
          url: { kind: "string", default: SAMPLE_URL, maxLength: URL_MAX },
          device: { kind: "enum", options: [...DEVICE_IDS], default: "laptop" },
          finish: { kind: "enum", options: [...PANE_FINISHES], default: "low-iron" },
          scheme: { kind: "enum", options: [...PANE_SCHEMES], default: "desk" },
        },
        // on the pegboard (ICE design-017 §8): a pane on a shelf under the portals' own category, hung at its own
        // aspect, its specimen drawn with the kind's desk state (its head engraved by the host's service)
        tray: {
          category: BROWSER_PANE_CATEGORY,
          label: "Browser",
          order: 0,
          hang: {
            w: hundredth(PANE_SIZE.w * 0.3),
            h: hundredth(PANE_SIZE.h * 0.3),
            accessory: "shelf",
            pegs: [
              [-2, 0.5],
              [2, 0.5],
            ],
          },
          local: true,
        },
        binding: { kind: "browserPane" },
      },
    ],
  },
};
