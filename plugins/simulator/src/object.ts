// The PHONE's code half — the `ObjectBinding` its manifest row names (`binding: { kind: "simulator" }`). The HOST makes the
// `defineObject` call (spec §12.2: plugin code never owns a durable schema), compiling the manifest's durable half
// (manifest.ts — the props, the size, the interaction, the tray entry, what it provides) with what this export carries: the
// kind, whole (kind.ts), and its DOM HALF, declared — the face's words' raster, LENT as a keyed service (`WORDS_RASTER`,
// notice-canvas.ts: the platform's Canvas 2D, where there is one). Static, never registered from `activate`: the desk creates
// every kind's pass together at its mount, so the host reads this export by name. Core's drag carries it on the desk's springs
// (the one physics — no driver of its own); in hand it takes nothing but its face's act (view-only until PT-S4's touch
// lands). PT-S2 — its MENU: Attach and Finish (attach.ts; R11 — no Model act: only Attach writes the model, as its device's),
// and its DRIVER FACTORY the menu's bridge to this desk's local (`phoneDrivers` — no driver is made).

import { type ObjectBinding, service } from "@vibefield/plugin-sdk/desk";
import { PHONE_ACTS, phoneDrivers } from "./attach";
import { type SimulatorGeometry, simulatorKind } from "./kind";
import type { PhoneInstance, PhoneLookValues } from "./layout";
import { WORDS_RASTER } from "./notice";
import { wordsRaster } from "./notice-canvas";

/** THE BINDING — the phone's kind, its face's words' raster lent by its DOM half, and its menu: Attach and Finish. */
export const simulator: ObjectBinding<SimulatorGeometry, PhoneInstance, PhoneLookValues> = {
  kind: simulatorKind(),
  // PT-S2 — the menu's bridge: this desk's local kept by its world (a menu act is handed the world, never the desk); no driver
  drivers: phoneDrivers,
  host: {
    // where the platform draws Canvas 2D (the product's renderer); a Node still lends nothing (its faces draw the committed
    // words, face-words.ts)
    lend: () => {
      const raster = wordsRaster();
      return raster === undefined ? [] : [service(WORDS_RASTER, raster)];
    },
  },
  menu: PHONE_ACTS,
};
