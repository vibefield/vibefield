import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_CAPABILITIES,
  AGENT_CATALOG,
  AGENT_CATALOG_IDS,
  AGENT_CATALOG_READERS,
  AgentCatalogEntry,
  AgentCatalogResult,
  AgentProviderSummary,
  catalogEntry,
  catalogIdForKind,
  createAgentCatalogReaders,
  isOffered,
  isVisible,
  kindForCatalogId,
  visibleCatalog,
} from "../src";
import { METHODS } from "../src/methods";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// AC-1 (thinking-ar-agent-catalog.md §3.2) — the table's own invariants. The
// cross-sibling truths (the pin composes the provider, registers the kind,
// spells the root the same, implements every claimed capability) are wall
// R23's, at preflight: this file never imports a sibling.
describe("the agent catalog (AC-1)", () => {
  const rows = AgentCatalogEntry.array().parse(AGENT_CATALOG);

  it("parses strictly and is non-empty, in display order", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.id)).toEqual([...AGENT_CATALOG_IDS]);
  });

  it("ids are unique, and equal the puppeteer provider id wherever that seam exists (AC-D2)", () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of rows) {
      if (row.seams.puppeteer !== null) expect(row.seams.puppeteer.provider).toBe(row.id);
    }
  });

  it("every row has at least one seam", () => {
    for (const row of rows) {
      expect(row.seams.puppeteer !== null || row.seams.rosetta !== null).toBe(true);
    }
  });

  it("rosetta kinds and layout roots are unique among the rows that have them", () => {
    const kinds = rows.flatMap((r) => (r.seams.rosetta === null ? [] : [r.seams.rosetta.kind]));
    expect(new Set(kinds).size).toBe(kinds.length);
    const roots = rows.flatMap((r) => (r.layoutRoot === null ? [] : [r.layoutRoot]));
    expect(new Set(roots).size).toBe(roots.length);
  });

  it("a claim needs its seam: history ⇒ rosetta + a root; spawn/resume/reattach/usage/distribution/personas ⇒ puppeteer", () => {
    for (const row of rows) {
      if (row.offers.history) {
        expect(row.seams.rosetta, row.id).not.toBeNull();
        expect(row.layoutRoot, row.id).not.toBeNull();
      }
      for (const capability of AGENT_CAPABILITIES) {
        if (capability === "history") continue;
        if (row.offers[capability])
          expect(row.seams.puppeteer, `${row.id}.${capability}`).not.toBeNull();
      }
      // a root without a rosetta seam is a root nobody joins on
      if (row.layoutRoot !== null) expect(row.seams.rosetta, row.id).not.toBeNull();
    }
  });

  it("a declined row offers nothing and shows nowhere", () => {
    for (const row of rows) {
      if (row.status !== "declined") continue;
      for (const capability of AGENT_CAPABILITIES)
        expect(row.offers[capability], row.id).toBe(false);
      expect(row.surfaces).toEqual({ desktop: false, phone: false });
    }
  });

  it("the readers answer from the table and only the table", () => {
    expect(catalogEntry("claude")?.seams.rosetta?.kind).toBe("claude-code");
    expect(catalogIdForKind("claude-code")).toBe("claude");
    expect(catalogIdForKind("kimi-code")).toBe("kimi");
    expect(kindForCatalogId("kimi")).toBe("kimi-code");
    expect(catalogEntry("not-a-row")).toBeUndefined();
    expect(catalogIdForKind("not-a-kind")).toBeUndefined();
    expect(kindForCatalogId("acp")).toBeUndefined();
    expect(isOffered("claude")).toBe(true);
    expect(isOffered("claude", "spawn")).toBe(true);
    expect(isOffered("acp", "history")).toBe(false);
    expect(isOffered("acp", "spawn")).toBe(true);
    expect(isOffered("not-a-row")).toBe(false);
    expect(isVisible("not-a-row")).toBe(false);
    // the phone never sees the protocol row (AC-D7); the desktop does
    expect(visibleCatalog("phone").some((r) => r.id === "acp")).toBe(false);
    expect(visibleCatalog("desktop").some((r) => r.id === "acp")).toBe(true);
    expect(visibleCatalog().every((r) => r.status !== "declined")).toBe(true);
  });

  it("the two generated projections equal the table (regenerate: pnpm --filter @vibefield/contracts gen:schema)", () => {
    const gen = JSON.parse(readFileSync(join(ROOT, "gen", "agent-catalog.json"), "utf8"));
    expect(gen.catalog).toEqual(rows);
    const fixture = JSON.parse(
      readFileSync(join(ROOT, "fixtures", "agent-catalog.valid.json"), "utf8"),
    );
    expect(fixture).toEqual({ catalog: rows });
    expect(AgentCatalogResult.parse(fixture).catalog).toHaveLength(rows.length);
  });

  it("the wire form is tolerant: an unknown key on a row rides through", () => {
    const parsed = AgentCatalogResult.parse({
      catalog: [{ ...rows[0], someday: "a field this build never heard of" }],
    });
    expect((parsed.catalog[0] as Record<string, unknown>).someday).toBe(
      "a field this build never heard of",
    );
    // …while the TABLE is strict (an unknown key in the source is a typo)
    expect(() => AgentCatalogEntry.parse({ ...rows[0], someday: 1 })).toThrow();
  });

  it("agent.catalog is a product door on agent.observe, local like agent.list", () => {
    const door = METHODS.find((m) => m.method === "agent.catalog");
    expect(door).toMatchObject({
      surface: "product",
      scope: "agent.observe",
      idempotent: true,
      locality: "local",
    });
  });

  it("agent.providers rows carry the decision and its claims (required since AC-3); history only where offered", () => {
    const bare = {
      id: "claude",
      label: "Claude Code",
      available: true,
      resumable: true,
      personas: [],
    };
    expect(() => AgentProviderSummary.parse(bare)).toThrow();
    const decided = AgentProviderSummary.parse({
      ...bare,
      status: "supported",
      offers: catalogEntry("claude")?.offers,
      history: "indexed",
    });
    expect(decided.offers.reattach).toBe(true);
    const protocol = AgentProviderSummary.parse({
      ...bare,
      id: "acp",
      status: "preview",
      offers: catalogEntry("acp")?.offers,
    });
    expect(protocol.history).toBeUndefined();
    expect(() => AgentProviderSummary.parse({ ...decided, status: "someday" })).toThrow();
  });

  it("the readers factory answers over its own table; the named readers are the factory over THE table", () => {
    const readers = createAgentCatalogReaders([
      {
        ...rows[0],
        id: "x",
        seams: { puppeteer: { provider: "x" }, rosetta: { kind: "x-kind" } },
        layoutRoot: "~/.x",
      },
      {
        ...rows[0],
        id: "y",
        status: "declined",
        seams: { puppeteer: { provider: "y" }, rosetta: null },
        layoutRoot: null,
        offers: {
          spawn: false,
          resume: false,
          reattach: false,
          history: false,
          usage: false,
          distribution: false,
          personas: false,
        },
        surfaces: { desktop: false, phone: false },
      },
    ]);
    expect(readers.idForKind("x-kind")).toBe("x");
    expect(readers.kindFor("x")).toBe("x-kind");
    expect(readers.isOffered("x", "spawn")).toBe(true);
    expect(readers.isOffered("y")).toBe(false);
    expect(readers.isVisible("y")).toBe(false);
    expect(readers.visible().map((r) => r.id)).toEqual(["x"]);
    expect(readers.entry("claude")).toBeUndefined();
    expect(AGENT_CATALOG_READERS.table).toBe(AGENT_CATALOG);
  });
});
