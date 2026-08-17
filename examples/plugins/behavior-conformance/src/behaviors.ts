import {
  type BehaviorHandle,
  declareBehavior,
  defineBehavior,
  p,
} from "@vibefield/plugin-sdk/behavior";

export const PLUGIN_ID = "vibefield.behavior-conformance";
export const WIDGET_TYPE = `${PLUGIN_ID}.card`;

/** A v2 document behavior. The conformance suite authors genuine v1 bytes in a fresh process. */
export const DurableProbe: BehaviorHandle<{ readonly count: number }> = defineBehavior(
  `${PLUGIN_ID}:durable`,
  {
    store: "durable",
    version: 2,
    schema: { count: p.number({ default: 5, min: 0 }) },
    migrate: {
      1(previous) {
        return { ...previous, count: Number(previous.count ?? 0) + 1 };
      },
    },
    on: {
      init(_entity, data, ctx) {
        ctx.log("durable.init", data.count);
      },
      dispose(_entity, ctx) {
        ctx.log("durable.dispose");
      },
    },
  },
);

/** A World-scoped rider used to prove same-engine adoption and new-engine default reset. */
export const RuntimeProbe: BehaviorHandle<{ readonly count: number }> = defineBehavior(
  `${PLUGIN_ID}:runtime`,
  {
    store: "runtime",
    schema: { count: p.number({ default: 7, min: 0 }) },
    on: {
      init(_entity, data, ctx) {
        ctx.log("runtime.init", data.count);
      },
      dispose(_entity, ctx) {
        ctx.log("runtime.dispose");
      },
    },
  },
);

/** Deliberately invalid async hook: ICE must fault it at the hook seam and suspend at strike 3. */
export const BreakerProbe = defineBehavior(`${PLUGIN_ID}:breaker`, {
  store: "runtime",
  on: {
    async tick(_entity, _data, _frame, ctx) {
      ctx.log("breaker.tick");
      await Promise.resolve();
    },
  },
});

/** Bounded per-peer state used by PRC-4g2's packaged two-engine tombstone witness. */
export const PresenceProbe: BehaviorHandle<{ readonly mode: string }> = defineBehavior(
  `${PLUGIN_ID}:presence`,
  {
    store: "ephemeral",
    maxFacetBytes: 128,
    schema: { mode: p.string({ default: "active" }) },
    on: {
      init(_entity, data, ctx) {
        ctx.log("presence.init", data.mode);
      },
      dispose(_entity, ctx) {
        ctx.log("presence.dispose");
      },
    },
  },
);

export const durableContribution = declareBehavior(DurableProbe);
export const runtimeContribution = declareBehavior(RuntimeProbe);
export const breakerContribution = declareBehavior(BreakerProbe, {
  reason: "Exercise the host breaker, fault provenance, and chronic-ledger carryover",
});
export const presenceContribution = declareBehavior(PresenceProbe);
