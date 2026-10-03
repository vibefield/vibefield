import { defineRendererPlugin, type ObjectBinding } from "@vibefield/plugin-sdk";
import { BreakerProbe, CARRIER_TYPE, DurableProbe, PresenceProbe, RuntimeProbe } from "./behaviors";

/**
 * The carrier's KIND (DK-4; the manifest's `binding.kind: "card"` names this export): a desk kind's
 * shape with no drawing of its own — the fixture carries behaviors, not pixels. Its pass is never
 * made: `create` refuses, so a desk that mounts it draws the carrier with ICE's missing face (I24),
 * contained to the kind. The SDK's `/desk` door (DK-6) will type this; until then the host checks
 * it (`isObjectKind`) and compiles the row through `defineObject`.
 */
export const card: ObjectBinding = {
  kind: {
    name: CARRIER_TYPE,
    stratum: "things",
    reach: 0,
    create: () =>
      Promise.reject(
        new Error("the behavior-conformance carrier draws nothing: a test fixture's kind"),
      ),
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
