import { describe, expect, it } from "vitest";
import { LAYOUT, LAYOUT_ROOT_LEVEL } from "../src/registries";

// AR-7a / AR-9a — the contracts half of a typed agent (a name typed into one of
// our panes' shells becomes a managed session through puppeteer's spawn-through
// shim) and of the runtime inspector's one verb (thinking-ar7-typed-agents.md
// §5.1). Wire truth only: the daemon's handlers and the renderer come after.

describe("LAYOUT (AR-7)", () => {
  it("the spawn-through shim's home lives under this user's agents/ tree", () => {
    expect(LAYOUT.AGENT_SHIMS_DIR).toEqual(["agents", "shims"]);
    expect(LAYOUT.AGENT_SHIMS_DIR.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    expect(LAYOUT_ROOT_LEVEL).not.toContain("AGENT_SHIMS_DIR");
  });
});
