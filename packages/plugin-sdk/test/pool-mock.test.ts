import type { LiveSurfaceSourceSpecV1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  defineRendererPlugin,
  type PluginSurfaceHandle,
  type PluginSurfaceState,
} from "../src/index";
import { activateWithMockHost } from "../src/testing";

// DT-2b-2 — `ctx.pool` in the mock host. The point of the mock is that a
// plugin's own suite fails for the same reason the app would fail it, so the
// two laws worth encoding here are the two a plugin author will actually lean
// on: a handle reports its states to observers, and the ACTIVATION releases it
// — a plugin that never calls `release()` still must not leak an attachment.

const SOURCE: LiveSurfaceSourceSpecV1 = {
  kind: "browser",
  initialUrl: "https://example.invalid/panel",
  profile: { mode: "memory", ref: "mock" },
  logicalViewport: { width: 640, height: 480 },
};

const DEMAND = { mode: "live", targetFps: 30, priority: 50, interactive: false } as const;

describe("mock host ctx.pool", () => {
  it("is present unconditionally and records what the plugin asked for", async () => {
    const mod = defineRendererPlugin({
      activate(ctx) {
        ctx.pool.liveSurface({
          key: "preview",
          source: SOURCE,
          reuseKey: "card-1",
          initialDemand: DEMAND,
        });
      },
    });
    const session = await activateWithMockHost(mod);

    // No option DECLARES the pool — unlike commands/surfaces, it is always there.
    const surface = session.liveSurfaces.get("preview");
    expect(surface).toBeDefined();
    expect(surface?.options.source).toEqual(SOURCE);
    expect(surface?.options.reuseKey).toBe("card-1");
    expect(surface?.demands).toEqual([DEMAND]);
    expect(surface?.handle.status).toBe("attaching");

    await session.close();
  });

  it("cycles states and tells every observer", async () => {
    let handle: PluginSurfaceHandle | undefined;
    const seen: PluginSurfaceState[] = [];
    const mod = defineRendererPlugin({
      activate(ctx) {
        handle = ctx.pool.liveSurface({ key: "preview", source: SOURCE, initialDemand: DEMAND });
        handle.onState((state) => seen.push(state));
      },
    });
    const session = await activateWithMockHost(mod);
    const surface = session.liveSurfaces.get("preview");
    expect(handle).toBeDefined();

    // onState fires immediately with the current state, then on every change.
    expect(seen.map((state) => state.status)).toEqual(["attaching"]);

    surface?.set("live");
    const failure = new Error("the producer crashed");
    surface?.set("lost", failure);
    expect(seen.map((state) => state.status)).toEqual(["attaching", "live", "lost"]);
    expect(seen.at(-1)?.error).toBe(failure);
    expect(handle?.error).toBe(failure);

    // retry() is a no-op in any state but `lost`, and mints fresh from there.
    handle?.retry();
    expect(surface?.retries).toBe(1);
    expect(handle?.status).toBe("attaching");
    handle?.retry();
    expect(surface?.retries).toBe(1);

    // Demand a holder re-declares is recorded; the fold is the host's business.
    const paused = { mode: "paused", targetFps: 0, priority: 0, interactive: false } as const;
    handle?.setDemand(paused);
    expect(surface?.demands).toEqual([DEMAND, paused]);

    await session.close();
  });

  it("releases what the plugin acquired when the activation closes", async () => {
    const mod = defineRendererPlugin({
      activate(ctx) {
        // Deliberately kept and never released by the plugin.
        ctx.pool.liveSurface({ key: "a", source: SOURCE, initialDemand: DEMAND });
        ctx.pool.liveSurface({ key: "b", source: SOURCE, initialDemand: DEMAND });
      },
    });
    const session = await activateWithMockHost(mod);
    expect([...session.liveSurfaces.values()].map((s) => s.released)).toEqual([false, false]);

    await session.close();

    expect([...session.liveSurfaces.values()].map((s) => s.released)).toEqual([true, true]);
    expect([...session.liveSurfaces.values()].map((s) => s.handle.status)).toEqual([
      "released",
      "released",
    ]);
  });

  it("refuses use after abort, like every other capability", async () => {
    let handle: PluginSurfaceHandle | undefined;
    const mod = defineRendererPlugin({
      activate(ctx) {
        handle = ctx.pool.liveSurface({ key: "preview", source: SOURCE, initialDemand: DEMAND });
      },
    });
    const session = await activateWithMockHost(mod);
    await session.close();

    // A handle a plugin captured cannot outlive its activation's gate.
    expect(() =>
      handle?.setDemand({ mode: "paused", targetFps: 0, priority: 0, interactive: false }),
    ).toThrow(/after abort/);
    // `release` is exempt: it is the inverse teardown itself runs.
    expect(() => handle?.release()).not.toThrow();
  });

  it("exposes a SurfaceView component rather than a frame", async () => {
    let view: unknown;
    let handle: unknown;
    const mod = defineRendererPlugin({
      activate(ctx) {
        view = ctx.pool.SurfaceView;
        handle = ctx.pool.liveSurface({ key: "preview", source: SOURCE, initialDemand: DEMAND });
      },
    });
    const session = await activateWithMockHost(mod);

    expect(typeof view).toBe("function");
    // DK-7: the mock's view draws NOTHING and never throws (DK-2's stub threw "DK-7") — a panel that
    // mounts it still activates under the mock; a face on the desk is a kind, judged by the harness.
    expect((view as (props: unknown) => unknown)({ handle })).toBeNull();
    // PA-22 in the mock too: nothing on the handle reaches a frame.
    expect("presentation" in (handle as Record<string, unknown>)).toBe(false);

    await session.close();
  });
});
