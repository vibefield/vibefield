import { describe, expect, it } from "vitest";
import { defineRendererPlugin } from "../src/index";
import { activateWithMockHost } from "../src/testing";

// The SDK's own contract in miniature: the mock host enforces exactly what the
// real harness enforces (§12.1 — declared-by-this-plugin, no double-bind,
// nothing after abort), so a plugin's suite failing here fails for the same
// reason it would fail in the app.
describe("activateWithMockHost", () => {
  it("collects registrations and tracked disposables", async () => {
    const mod = defineRendererPlugin({
      activate(ctx) {
        ctx.widgets.register({ type: "vibefield.mock.a", binding: { component: () => null } });
        ctx.track({ dispose() {} });
        ctx.logger.info("hello");
      },
    });
    const session = await activateWithMockHost(mod, {
      declaredWidgets: ["vibefield.mock.a", "vibefield.mock.b"],
    });
    expect([...session.bindings.keys()]).toEqual(["vibefield.mock.a"]);
    expect(session.disposables).toHaveLength(1);
    expect(session.logs).toEqual([{ level: "info", message: "hello" }]);
  });

  it("refuses undeclared types and double-binds (§12.1)", async () => {
    const undeclared = defineRendererPlugin({
      activate(ctx) {
        ctx.widgets.register({ type: "vibefield.mock.ghost", binding: { component: 1 } });
      },
    });
    await expect(activateWithMockHost(undeclared, { declaredWidgets: [] })).rejects.toThrow(
      /not declared/,
    );

    const doubled = defineRendererPlugin({
      activate(ctx) {
        ctx.widgets.register({ type: "vibefield.mock.a", binding: { component: 1 } });
        ctx.widgets.register({ type: "vibefield.mock.a", binding: { component: 2 } });
      },
    });
    await expect(
      activateWithMockHost(doubled, { declaredWidgets: ["vibefield.mock.a"] }),
    ).rejects.toThrow(/already bound/);
  });

  it("the returned disposable un-binds; register refuses after abort", async () => {
    let escaped: Parameters<Parameters<typeof defineRendererPlugin>[0]["activate"]>[0] | null =
      null;
    const mod = defineRendererPlugin({
      activate(ctx) {
        escaped = ctx; // tests only — a real module must not let ctx escape
        const handle = ctx.widgets.register({
          type: "vibefield.mock.a",
          binding: { component: () => null },
        });
        void handle.dispose();
      },
    });
    const session = await activateWithMockHost(mod, { declaredWidgets: ["vibefield.mock.a"] });
    expect(session.bindings.size).toBe(0); // the dispose un-bound it
    session.abort();
    expect(() =>
      escaped?.widgets.register({ type: "vibefield.mock.a", binding: { component: 1 } }),
    ).toThrow(/after abort/);
  });
});
