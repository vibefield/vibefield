// The BROWSER PANE's code half — the `ObjectBinding` its manifest row names (`binding: { kind: "browserPane" }`). The
// HOST makes the `defineObject` call (spec §12.2: plugin code never owns a durable schema), compiling the manifest's
// durable half (manifest.ts — the props, the size and its floor, the interaction, the tray entry, what it provides) with
// what this export carries: the kind, whole (kind.ts); its DOM HALF, declared — the head's raster, LENT as a keyed
// service (`HEAD_RASTER`, head-canvas.ts: the platform's Canvas 2D, where there is one); and its MENU — the device switch
// (device.ts). Static, never registered from `activate`: the desk creates every kind's pass together at its mount, so
// the host reads this export by name. Core's drag carries it (PT-1 ruling 4); its DRIVER is its hand in use (PT-3 — hand.ts).

import { type ObjectBinding, service } from "@vibefield/plugin-sdk/desk";
import { DEVICE_ACTS } from "./device";
import { createPaneHand, type PaneHand } from "./hand";
import { HEAD_RASTER } from "./head";
import { headRaster } from "./head-canvas";
import { browserPaneKind } from "./kind";
import type { PaneGeometry } from "./law";
import type { PaneInstance, PaneLookValues } from "./layout";

// docs:begin binding
/** THE BINDING — the pane's kind, its head's raster lent by its DOM half, and the device switch on the selection menu. */
export const browserPane: ObjectBinding<PaneGeometry, PaneInstance, PaneLookValues> = {
  kind: browserPaneKind(),
  // PT-3 — its hand on the editor while a pane is in hand (hand.ts): its page's keys, text and IME, the browser's chords, the address
  drivers: (h) => createPaneHand(h),
  host: {
    // where the platform draws Canvas 2D (the product's renderer); a Node still lends nothing (the committed heads draw)
    lend: () => {
      const raster = headRaster();
      return raster === undefined ? [] : [service(HEAD_RASTER, raster)];
    },
    // the hand joins its DOM half: the desk's one editor, its container (a press over the held pane keeps the editor's focus)
    mount: (dom) => {
      (dom.driver as PaneHand | undefined)?.join(dom);
    },
  },
  menu: DEVICE_ACTS,
};
// docs:end binding
