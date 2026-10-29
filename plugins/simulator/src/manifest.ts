import type { PluginManifestV1 } from "@vibefield/contracts";
import {
  DEFAULT_MODEL,
  FINISH_ID_MAX,
  MODEL_ID_MAX,
  PROP,
  SIMULATOR_BINDING_EXPORT,
  SIMULATOR_CATEGORY,
  SIMULATOR_TYPE,
  UNBOUND,
} from "./ids";
import { DEFAULT_PHONE, MM } from "./law";

/** Round to the hundredth of a world unit — a size as a document holds it. */
const hundredth = (v: number): number => Math.round(v * 100) / 100;

/** The phone's `Size`: the default model's body at the desk's one scale (law.ts `MM`) — a 17 Pro, 188.71 × 393.7. */
export const PHONE_SIZE = {
  w: hundredth(DEFAULT_PHONE.body.mm[0] * MM),
  h: hundredth(DEFAULT_PHONE.body.mm[1] * MM),
} as const;

/** How large a phone hangs on the pegboard, of its size (the notebook's and the calendar's specimens are ~160 tall). */
const HANG = 0.4;

/**
 * THE iOS SIMULATOR ON THE DESK (PT-S1, PORTALS — the PT-S design, ruled 2026-10-18): a phone lying face up at its true
 * size, its screen a Simulator's, view-only in v1 — a plugin kind built exactly as a third party builds one (the browser
 * pane's shape).
 *
 * This manifest is the phone's DURABLE half: its `model` (the CoreSimulator device type it IS — a free string: Xcode's set
 * grows and drops, and an enum may only grow), its `finish` (one of its model's launch colours) and its `binding` (the device
 * it is bound to: a device type and a runtime, never a UDID — contracts' `LiveSurfaceIosSimulatorBindingV1`; empty, unbound);
 * its size — the default model's body — and NO angle: a phone is never turned; its interaction (selectable, carried by core's
 * drag on the desk's springs, never resized: a phone is its model's size); what it PROVIDES (it lies on the desk; it goes into
 * no mini mat yet — no chip); and its tray entry — a phone on a shelf under a NEW category, `devices`, its specimen drawn by
 * its own pass with the screen off (a specimen is bound to nothing). NO capability: `surface.attach` and `surface.capture`
 * arrive with PT-S2's producer (capture is the Screen Recording consent class). The code half is the export `binding.kind`
 * names (object.ts). Emitted to `vibefield.plugin.json` by `pnpm gen:manifest`.
 */
export const simulatorManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: SIMULATOR_TYPE,
  version: "0.1.0",
  title: "iOS Simulator",
  description:
    "An iPhone on the desk at its true size — any of the models Xcode's Simulator knows — its screen a Simulator's, view-only",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onObject:${SIMULATOR_TYPE}`],
  capabilities: [],
  contributes: {
    objects: [
      {
        type: SIMULATOR_TYPE,
        title: "Phone",
        description:
          "An iPhone lying face up at its true size, its screen a Simulator's: double-click to use it — view-only",
        schemaVersion: 1,
        size: { w: PHONE_SIZE.w, h: PHONE_SIZE.h },
        interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
        // the SDK's DESK_OBJECT (test/manifest.test.ts holds it equal): it lies on the desk, by what it provides (K8a)
        provides: [SIMULATOR_TYPE, "desk.object"],
        // the props in ONE cell: the model, its finish and the binding are each a desk edit, an undo step, and nothing writes
        // one outside the undo stack — no prop needs a cell of its own (the pane's url does, PT-3 ruling 9)
        groups: {},
        props: {
          [PROP.model]: { kind: "string", default: DEFAULT_MODEL, maxLength: MODEL_ID_MAX },
          [PROP.finish]: {
            kind: "string",
            default: DEFAULT_PHONE.finishes[0] ?? "",
            maxLength: FINISH_ID_MAX,
          },
          [PROP.binding]: {
            kind: "json",
            inner: {
              kind: "object",
              fields: { deviceType: { kind: "string" }, runtime: { kind: "string" } },
            },
            default: UNBOUND,
          },
        },
        // on the pegboard (ICE design-017 §8): a phone on a shelf under the devices' own category, hung at its own aspect
        tray: {
          category: SIMULATOR_CATEGORY,
          label: "Phone",
          order: 0,
          hang: {
            w: hundredth(PHONE_SIZE.w * HANG),
            h: hundredth(PHONE_SIZE.h * HANG),
            accessory: "shelf",
            pegs: [
              [-1, 0.5],
              [1, 0.5],
            ],
          },
        },
        binding: { kind: SIMULATOR_BINDING_EXPORT },
      },
    ],
  },
};
