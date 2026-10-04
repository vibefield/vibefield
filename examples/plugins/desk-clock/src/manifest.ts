import type { PluginManifestV1 } from "@vibefield/contracts";
import { CLOCK_TYPE } from "./ids";
import { CLOCK, CLOCK_STYLES } from "./law";

/**
 * THE PARITY WITNESS (DK-6; ICE design-016 K-L2): ICE's worked third-party kind — the analogue desk
 * clock (`infinite-canvas-engine/examples/desk-clock`) — ported to a VibeField plugin through the SDK's
 * `/desk` door alone, and drawn by the product beside the desk's six built-ins. Its law, hands, zone
 * and wakes are ICE's verbatim; what changed is the door it imports through and where its declaration
 * lives.
 *
 * This manifest is the clock's DURABLE half, as ICE's `defineObject` call declares it: its props in one
 * group (one cell, one transaction per change) — `style` (the dial), `ring24` (the 24-hour ring),
 * `seconds` (the seconds hand, and with it the desk's cadence) and `zone` (`local`, or a UTC offset);
 * its size; its interaction (movable, selectable, snapping both ways, never resized — a clock is round);
 * what it PROVIDES — it lies on the desk (`desk.object`) and goes into a mini mat (`desk.containable`,
 * where it draws its chip); and its tray entry — a clock on a hook among the desk's things. The time is
 * never a prop: it is the host's clock (flux). The code half is the export `binding.kind` names
 * (object.ts). Emitted to `vibefield.plugin.json` by `pnpm gen:manifest`; the import here stays pure
 * (ids and law only) so emitting needs no bundle.
 */
export const deskClockManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: CLOCK_TYPE,
  version: "0.1.0",
  title: "Desk clock",
  description:
    "ICE's analogue desk clock as a VibeField plugin — its own WGSL, pass, wake, tray entry, menu act and held tools, through the SDK's /desk door alone",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onWidget:${CLOCK_TYPE}`],
  capabilities: [], // a kind draws what it is handed; it asks for nothing
  contributes: {
    objects: [
      {
        type: CLOCK_TYPE,
        title: "Clock",
        description:
          "An analogue clock lying on the desk: it reads the host's clock and wakes only when a hand must move",
        schemaVersion: 1,
        size: { w: CLOCK.size, h: CLOCK.size },
        interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
        // the SDK's DESK_OBJECT and CONTAINABLE (test/manifest.test.ts holds them equal): it lies on the
        // desk and goes into a mini mat by what it provides, never by a list that names it (K8a)
        provides: [CLOCK_TYPE, "desk.object", "desk.containable"],
        props: {
          style: { kind: "enum", options: [...CLOCK_STYLES], default: "classic" },
          ring24: { kind: "boolean", default: false },
          seconds: { kind: "boolean", default: true },
          zone: { kind: "string", default: "local" },
        },
        groups: {},
        // on the pegboard (ICE design-017 §8): a clock on a hook among the desk's things, showing the
        // shop's 10:10:30 — a specimen is its kind's stateless drawing; one taken off shows the desk's time
        tray: {
          category: "things",
          label: "Clock",
          order: 0,
          hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] },
        },
        binding: { kind: "clock" },
      },
    ],
  },
};
