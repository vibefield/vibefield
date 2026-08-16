const instanceId = crypto.randomUUID();

export default {
  activate(ctx) {
    ctx.services.provide({
      namespace: "x.vibefield.prc.controller",
      methods: {
        instance: {
          kind: "query",
          handle: () => ({ id: instanceId }),
        },
        touch: {
          kind: "mutation",
          handle: async ({ value }) => {
            await ctx.storage.kv.set("credential-probe", value);
            return { value: await ctx.storage.kv.get("credential-probe") };
          },
        },
      },
    });
  },
};
