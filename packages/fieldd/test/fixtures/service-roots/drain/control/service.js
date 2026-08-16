export default {
  async activate(ctx) {
    // Exercise the real child-bound service context. The provider publication belongs to this
    // optional lifetime; its synchronous inverse runs before the deliberately slow disposer.
    await ctx.effect("drain-provider", async (fx) => {
      fx.track("slow-cleanup", {
        async dispose() {
          await new Promise((resolve) => setTimeout(resolve, 250));
        },
      });
      fx.services.provide({
        namespace: "x.vibefield.prc.drain-control",
        methods: {
          echo: {
            kind: "query",
            handle: (params) => ({ echo: params.msg }),
          },
          slow: {
            kind: "query",
            async handle(params) {
              await new Promise((resolve) => setTimeout(resolve, params.delayMs));
              return { echo: params.msg };
            },
          },
          ticks: {
            kind: "subscription",
            subscribe(_params, _call, sink) {
              let n = 0;
              sink.snapshot({ n });
              const timer = setInterval(() => {
                n += 1;
                sink.delta({ n });
              }, 10);
              return { dispose: () => clearInterval(timer) };
            },
          },
        },
      });
    });
  },
};
