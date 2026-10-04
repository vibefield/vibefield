import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import type { KindPass, ObjectBinding } from "@vibefield/plugin-sdk/desk";
import { BreakerProbe, CARRIER_TYPE, DurableProbe, PresenceProbe, RuntimeProbe } from "./behaviors";

/**
 * The carrier's PASS — a real one that DRAWS NOTHING (DK-6, through the SDK's `/desk` door; DK-5's
 * input (4)): the fixture carries behaviors, not pixels. Until DK-6 its `create` refused, so every desk
 * that mounted it drew the carrier with ICE's missing face and named it in `status().faults`; now the
 * desk makes this pass beside every other kind's, it records nothing to draw, and the carrier lies on
 * the desk as an object with no drawing of its own — picked by its box, faulting nothing.
 */
const NOTHING_DRAWN: KindPass = {
  spawn: () => NOTHING_DRAWN,
  prepare: () => 0,
  drawRange: () => {},
  dispose: () => {},
};

/**
 * The carrier's KIND (DK-4; the manifest's `binding.kind: "card"` names this export): a desk kind with
 * no drawing of its own, typed at the SDK's door; the host checks it (`isObjectKind`, its name IS its
 * type) and compiles the row through `defineObject`.
 */
export const card: ObjectBinding = {
  kind: {
    name: CARRIER_TYPE,
    stratum: "things",
    reach: 0,
    create: async () => NOTHING_DRAWN,
    resolve: () => ({}),
    record: () => ({}),
    hit: () => "content",
  },
};

export default defineRendererPlugin({
  activate(ctx) {
    ctx.canvas?.behaviors.bind(DurableProbe.name, DurableProbe);
    ctx.canvas?.behaviors.bind(RuntimeProbe.name, RuntimeProbe);
    ctx.canvas?.behaviors.bind(BreakerProbe.name, BreakerProbe);
    ctx.canvas?.behaviors.bind(PresenceProbe.name, PresenceProbe);
  },
});
