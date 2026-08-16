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
    // Host-created registrations are owned too; explicit tracking remains compatible.
    expect(session.disposables).toHaveLength(3);
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

  it("commands: present iff declared; binds declared ids, refuses undeclared + double-binds (§13.1)", async () => {
    const handler = (): void => {};
    const mod = defineRendererPlugin({
      activate(ctx) {
        // ctx.commands present because declaredCommands was supplied
        ctx.commands?.register("vibefield.mock.do", handler);
      },
    });
    const session = await activateWithMockHost(mod, {
      declaredCommands: ["vibefield.mock.do"],
    });
    expect([...session.commands.keys()]).toEqual(["vibefield.mock.do"]);
    expect(session.commands.get("vibefield.mock.do")).toBe(handler);

    // absent when the plugin declares no commands contribution
    const noApi = defineRendererPlugin({
      activate(ctx) {
        if (ctx.commands !== undefined) throw new Error("ctx.commands should be absent");
      },
    });
    await expect(activateWithMockHost(noApi, {})).resolves.toBeDefined();

    const undeclared = defineRendererPlugin({
      activate(ctx) {
        ctx.commands?.register("vibefield.mock.ghost", handler);
      },
    });
    await expect(
      activateWithMockHost(undeclared, { declaredCommands: ["vibefield.mock.do"] }),
    ).rejects.toThrow(/not declared/);

    const doubled = defineRendererPlugin({
      activate(ctx) {
        ctx.commands?.register("vibefield.mock.do", handler);
        ctx.commands?.register("vibefield.mock.do", handler);
      },
    });
    await expect(
      activateWithMockHost(doubled, { declaredCommands: ["vibefield.mock.do"] }),
    ).rejects.toThrow(/already bound/);
  });

  it("surfaces: bind declared ids; the disposable un-binds; register refuses after abort (§13.2)", async () => {
    const Comp = (): null => null;
    let escaped: Parameters<Parameters<typeof defineRendererPlugin>[0]["activate"]>[0] | null =
      null;
    const mod = defineRendererPlugin({
      activate(ctx) {
        escaped = ctx;
        const handle = ctx.surfaces?.register("vibefield.mock.panel", Comp);
        ctx.surfaces?.register("vibefield.mock.attention", Comp);
        void handle?.dispose(); // the panel un-binds; attention stays
      },
    });
    const session = await activateWithMockHost(mod, {
      declaredSurfaces: ["vibefield.mock.panel", "vibefield.mock.attention"],
    });
    expect([...session.surfaces.keys()]).toEqual(["vibefield.mock.attention"]);
    session.abort();
    expect(() => escaped?.surfaces?.register("vibefield.mock.panel", Comp)).toThrow(/after abort/);
  });

  it("canvas: present with an engine handle iff supplied (§12.7 stopgap)", async () => {
    const engine = { marker: "engine" };
    const withCanvas = defineRendererPlugin({
      activate(ctx) {
        if (ctx.canvas === undefined) throw new Error("ctx.canvas should be present");
        if (ctx.canvas.engine() !== engine) throw new Error("engine() should return the handle");
      },
    });
    await expect(activateWithMockHost(withCanvas, { canvasEngine: engine })).resolves.toBeDefined();

    const noCanvas = defineRendererPlugin({
      activate(ctx) {
        if (ctx.canvas !== undefined) throw new Error("ctx.canvas should be absent");
      },
    });
    await expect(activateWithMockHost(noCanvas, {})).resolves.toBeDefined();
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

  it("binds effect capabilities to a rollback child while outer registrations survive", async () => {
    const Comp = (): null => null;
    let escapedChild: Parameters<Parameters<typeof defineRendererPlugin>[0]["activate"]>[0] | null =
      null;
    let childDisposed = 0;
    const mod = defineRendererPlugin({
      async activate(ctx) {
        ctx.commands?.register("vibefield.mock.keep", () => {});
        await ctx
          .effect("optional-panel", async (fx) => {
            escapedChild = fx;
            fx.surfaces?.register("vibefield.mock.panel", Comp);
            fx.track("panel-listener", {
              dispose() {
                childDisposed += 1;
              },
            });
            throw new Error("optional setup failed");
          })
          .catch(() => undefined);
      },
    });

    const session = await activateWithMockHost(mod, {
      declaredCommands: ["vibefield.mock.keep"],
      declaredSurfaces: ["vibefield.mock.panel"],
    });
    expect([...session.commands.keys()]).toEqual(["vibefield.mock.keep"]);
    expect(session.surfaces.size).toBe(0);
    expect(childDisposed).toBe(1);
    expect(() => escapedChild?.surfaces?.register("vibefield.mock.panel", Comp)).toThrow(
      /after abort/,
    );
    await session.close();
    expect(session.commands.size).toBe(0);
  });

  it("deduplicates one exact resource across labeled track and the activate return", async () => {
    let disposeCalls = 0;
    const shared = {
      dispose() {
        disposeCalls += 1;
      },
    };
    const session = await activateWithMockHost(
      defineRendererPlugin({
        activate(ctx) {
          ctx.track("shared", shared);
          ctx.track(shared);
          return shared;
        },
      }),
    );
    await session.close();
    expect(disposeCalls).toBe(1);
  });

  it("rolls back partial mock activation before rethrowing the primary error", async () => {
    let disposeCalls = 0;
    const activation = activateWithMockHost(
      defineRendererPlugin({
        activate(ctx) {
          ctx.widgets.register({
            type: "vibefield.mock.a",
            binding: { component: () => null },
          });
          ctx.track("partial", {
            dispose() {
              disposeCalls += 1;
            },
          });
          throw new Error("primary failure");
        },
      }),
      { declaredWidgets: ["vibefield.mock.a"] },
    );

    await expect(activation).rejects.toThrow("primary failure");
    expect(disposeCalls).toBe(1);
  });
});
