// The PHONE's code half — the `ObjectBinding` its manifest row names (`binding: { kind: "simulator" }`). The HOST makes the
// `defineObject` call (spec §12.2: plugin code never owns a durable schema), compiling the manifest's durable half
// (manifest.ts — the props, the size, the interaction, the tray entry, what it provides) with what this export carries: the
// kind, whole (kind.ts), and its DOM HALF, declared — the face's words' raster, LENT as a keyed service (`WORDS_RASTER`,
// notice-canvas.ts: the platform's Canvas 2D, where there is one). Static, never registered from `activate`: the desk creates
// every kind's pass together at its mount, so the host reads this export by name. Core's drag carries it on the desk's springs
// (the one physics — no driver of its own); in hand it takes nothing but its face's act (view-only until PT-S4's touch
// lands). No menu: the model's writer is PT-S2's attach (the hand-back asks whether S1 owes a Model or a Finish act).

import { type ObjectBinding, service } from "@vibefield/plugin-sdk/desk";
import { type SimulatorGeometry, simulatorKind } from "./kind";
import type { PhoneInstance, PhoneLookValues } from "./layout";
import { WORDS_RASTER } from "./notice";
import { wordsRaster } from "./notice-canvas";

/** THE BINDING — the phone's kind, and its face's words' raster lent by its DOM half. */
export const simulator: ObjectBinding<SimulatorGeometry, PhoneInstance, PhoneLookValues> = {
  kind: simulatorKind(),
  host: {
    // where the platform draws Canvas 2D (the product's renderer); a Node still lends nothing (its faces draw the committed
    // words, face-words.ts)
    lend: () => {
      const raster = wordsRaster();
      return raster === undefined ? [] : [service(WORDS_RASTER, raster)];
    },
  },
};
