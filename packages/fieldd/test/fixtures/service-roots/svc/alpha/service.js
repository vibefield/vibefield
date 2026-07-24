// P4 worker-host fixture service — deliberately SDK-free (the activate shape
// is the contract; defineServicePlugin is identity). echo proves the round
// trip, boom the sanitized INTERNAL path, die the §18.3 crash ladder, ticks
// the §14.5 snapshot-then-delta conformance.
export default {
  activate(ctx) {
    console.log("fixture service stdout");
    ctx.logger.info("fixture service activated", {
      source: "fixture",
      bootstrapToken: "plugin-secret-canary-abcdefghijklmnopqrstuvwxyz",
    });
    ctx.logger.warn("m".repeat(10 * 1024), { payload: "x".repeat(50 * 1024) });
    ctx.services.provide({
      namespace: "x.vibefield.fixture.svc",
      methods: {
        echo: {
          kind: "query",
          handle: (params) => ({ echo: params.msg }),
        },
        boom: {
          kind: "query",
          handle: () => {
            throw new Error("boom");
          },
        },
        die: {
          kind: "mutation",
          handle: () => {
            setTimeout(() => process.exit(7), 10);
            return { dying: true };
          },
        },
        ticks: {
          kind: "subscription",
          subscribe(_params, _call, sink) {
            sink.snapshot({ n: 0 });
            let n = 0;
            const timer = setInterval(() => {
              n += 1;
              sink.delta({ n });
            }, 20);
            return {
              dispose() {
                clearInterval(timer);
              },
            };
          },
        },
      },
    });
  },
};
