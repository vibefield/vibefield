/**
 * DK-2 — the host's built-in registration is GUARDED (r1 §0.2). It ran outside
 * every try, so one refused definition threw out of `buildRegistry` and took the
 * workspace's session memo down with it. A built-in that cannot register now says
 * which type, and the field still gets its registry.
 */
import { describe, expect, it, vi } from "vitest";
import type { RendererLogger } from "../src/logging";

vi.mock("../src/terminal/widget", async (importActual) => ({
  ...(await importActual<typeof import("../src/terminal/widget")>()),
  registerBuiltInTerminalWidgets: () => {
    throw new Error("ice: defineWidget(vibefield.terminal.mirror) — `component` is refused");
  },
}));

describe("DK-2 — the built-in terminal registration is guarded", () => {
  it("a throwing built-in leaves the field its registry, and the log names the type", async () => {
    // test/setup.ts already evaluated field-engine against the REAL built-in door; a
    // fresh module graph picks up the mock above (logging included, so the sink is its).
    vi.resetModules();
    const logging = await import("../src/logging");
    const logged: Array<{ event: string; message: string; attrs?: Record<string, unknown> }> = [];
    const logger: RendererLogger = {
      child: () => logger,
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error(event, message, _error, attrs) {
        logged.push({ event, message, ...(attrs === undefined ? {} : { attrs }) });
      },
      fatal() {},
      isLevelEnabled: () => true,
    };
    logging.setRendererLogger(logger);
    const { buildRegistry } = await import("../src/field-engine");

    const registry = buildRegistry({ generation: -1, staged: [], bundled: [] });
    expect(registry.hasWidget("vibefield.terminal.mirror")).toBe(false);
    const row = logged.find(
      (line) => line.event === "renderer.plugins.builtin_registration_failed",
    );
    expect(row?.message).toContain("vibefield.terminal.mirror");
    expect(row?.attrs).toEqual({ type: "vibefield.terminal.mirror" });
  });
});
