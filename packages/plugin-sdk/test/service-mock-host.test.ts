import { describe, expect, it } from "vitest";
import { defineServicePlugin, type ServicePluginContext } from "../src/index";
import { activateServiceWithMockHost } from "../src/testing";

const namespace = "x.vibefield.mock";
const query = {
  kind: "query" as const,
  handle() {
    return { ok: true };
  },
};

describe("activateServiceWithMockHost", () => {
  it("auto-owns publications and deduplicates explicit and returned handles", async () => {
    let disposeCalls = 0;
    const shared = {
      dispose() {
        disposeCalls += 1;
      },
    };
    const session = await activateServiceWithMockHost(
      defineServicePlugin({
        activate(ctx) {
          ctx.services.provide({ namespace, methods: { status: query } });
          ctx.track("shared", shared);
          ctx.track(shared);
          return shared;
        },
      }),
    );

    expect([...session.provided.keys()]).toEqual([namespace]);
    session.abort();
    expect(session.provided.size).toBe(0);
    await session.close();
    expect(disposeCalls).toBe(1);
  });

  it("rolls back a failed child effect without closing outer service ownership", async () => {
    let escapedChild: ServicePluginContext | null = null;
    let childDisposed = 0;
    let outerDisposed = 0;
    const session = await activateServiceWithMockHost(
      defineServicePlugin({
        async activate(ctx) {
          ctx.track("outer", {
            dispose() {
              outerDisposed += 1;
            },
          });
          await ctx
            .effect("optional-provider", async (fx) => {
              escapedChild = fx;
              fx.services.provide({ namespace, methods: { status: query } });
              fx.track("child", {
                dispose() {
                  childDisposed += 1;
                },
              });
              throw new Error("optional setup failed");
            })
            .catch(() => undefined);
        },
      }),
    );

    expect(session.provided.size).toBe(0);
    expect(childDisposed).toBe(1);
    expect(outerDisposed).toBe(0);
    expect(() => escapedChild?.services.provide({ namespace, methods: { status: query } })).toThrow(
      /after abort/,
    );
    await session.close();
    expect(outerDisposed).toBe(1);
  });

  it("rolls partial activation back before rethrowing its primary error", async () => {
    let disposeCalls = 0;
    const activation = activateServiceWithMockHost(
      defineServicePlugin({
        activate(ctx) {
          ctx.services.provide({ namespace, methods: { status: query } });
          ctx.track("partial", {
            dispose() {
              disposeCalls += 1;
            },
          });
          throw new Error("primary failure");
        },
      }),
    );

    await expect(activation).rejects.toThrow("primary failure");
    expect(disposeCalls).toBe(1);
  });
});
