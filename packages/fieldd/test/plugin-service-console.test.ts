import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { emitPendingPluginServiceLog } from "../src/plugin-service-console";

describe("pending plugin service console adapter", () => {
  it("bounds one-line output while LOG-L4 persistence is still pending", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    emitPendingPluginServiceLog({
      pluginId: "vibefield.example.test",
      level: "info",
      message: `first\nsecond${"x".repeat(LOG_TRANSPORT_LIMITS.PLUGIN_PARTIAL_LINE_BYTES * 2)}`,
    });

    expect(info).toHaveBeenCalledTimes(1);
    const output = String(info.mock.calls[0]?.[0]);
    expect(output).not.toContain("\n");
    expect(output).toContain("first ↩ second");
    expect(output).toContain("…[truncated]");
    expect(Buffer.byteLength(output, "utf8")).toBeLessThan(
      LOG_TRANSPORT_LIMITS.PLUGIN_PARTIAL_LINE_BYTES + 128,
    );
  });
});
