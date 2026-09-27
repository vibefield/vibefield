import { describe, expect, it } from "vitest";
import {
  AGENT_CAPABILITIES,
  AGENT_CATALOG,
  AgentCatalogEntry,
  AgentCatalogResult,
  isOffered,
} from "../src/agent-catalog";
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

describe("the catalog's `invoke` (AR-7a)", () => {
  const rows = AgentCatalogEntry.array().parse(AGENT_CATALOG);
  // the first row, typed as a row, and its offers as a desktop from before
  // AR-7a sent them
  const base = AgentCatalogEntry.parse(AGENT_CATALOG[0]);
  const { invoke: _unsent, ...olderOffers } = base.offers;

  it("is a capability every row decides — required on the table, a puppeteer claim", () => {
    expect(AGENT_CAPABILITIES).toContain("invoke");
    for (const row of rows) {
      expect(typeof row.offers.invoke, row.id).toBe("boolean");
      if (row.offers.invoke) expect(row.seams.puppeteer, row.id).not.toBeNull();
    }
    expect(() => AgentCatalogEntry.parse({ ...base, offers: olderOffers })).toThrow();
  });

  // The claims are the 2026-09-27 pin's (puppeteer 524709b), as wall R23 read
  // them: nine launch providers declare a native CLI grammar; the protocol
  // row's does not. A pin move that changes this is R23's to say first.
  it("is claimed by the rows whose launch provider declares a native grammar, and not by the protocol row", () => {
    expect(rows.filter((row) => row.offers.invoke).map((row) => row.id)).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
      "hermes",
      "antigravity",
      "copilot",
      "pi",
    ]);
    expect(isOffered("claude", "invoke")).toBe(true);
    expect(isOffered("acp", "invoke")).toBe(false);
    expect(isOffered("acp", "spawn")).toBe(true);
  });

  it("an older desktop's row, sent before the word existed, reads as unclaimed — never a refusal", () => {
    const parsed = AgentCatalogResult.parse({ catalog: [{ ...base, offers: olderOffers }] });
    expect(parsed.catalog[0]?.offers.invoke).toBeUndefined();
    expect(parsed.catalog[0]?.offers.spawn).toBe(true);
  });
});
