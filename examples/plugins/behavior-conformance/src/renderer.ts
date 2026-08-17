import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { BreakerProbe, DurableProbe, PresenceProbe, RuntimeProbe, WIDGET_TYPE } from "./behaviors";

function ConformanceCard(): null {
  return null;
}

export default defineRendererPlugin({
  activate(ctx) {
    ctx.widgets.register({ type: WIDGET_TYPE, binding: { component: ConformanceCard } });
    ctx.canvas?.behaviors.bind(DurableProbe.name, DurableProbe);
    ctx.canvas?.behaviors.bind(RuntimeProbe.name, RuntimeProbe);
    ctx.canvas?.behaviors.bind(BreakerProbe.name, BreakerProbe);
    ctx.canvas?.behaviors.bind(PresenceProbe.name, PresenceProbe);
  },
});
