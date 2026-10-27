import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_CAPABILITIES,
  AGENT_CATALOG,
  AgentCatalogEntry,
  AgentCatalogResult,
  isOffered,
} from "../src/agent-catalog";
import { AGENT_SPAWNED_BY, AgentSessionRecord, AgentSessionSummary } from "../src/agent-session";
import { LAYOUT, LAYOUT_ROOT_LEVEL } from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

// AR-7a / AR-9a — the contracts half of a typed agent (a name typed into one of
// our panes' shells becomes a managed session through puppeteer's spawn-through
// shim) and of the runtime inspector's one verb (thinking-ar7-typed-agents.md
// §5.1). Wire truth only: the daemon's handlers and the renderer come after.
// Erratum 2026-09-28: AR-9a was WITHDRAWN (AR7-D9, ruled 2026-09-27: the
// inspector is puppeteer's dev panel) and its verb never reached this base, so
// the file holds AR-7a alone.

describe("LAYOUT (AR-7)", () => {
  it("the spawn-through shim's home lives under this user's agents/ tree", () => {
    expect(LAYOUT.AGENT_SHIMS_DIR).toEqual(["agents", "shims"]);
    expect(LAYOUT.AGENT_SHIMS_DIR.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    expect(LAYOUT_ROOT_LEVEL).not.toContain("AGENT_SHIMS_DIR");
  });
});

describe("the catalog's `invoke` (AR-7a; AR7-D15)", () => {
  const rows = AgentCatalogEntry.array().parse(AGENT_CATALOG);
  // the first row, typed as a row, and its offers as a desktop from before
  // AR-7a sent them
  const base = AgentCatalogEntry.parse(AGENT_CATALOG[0]);
  const { invoke: _unsent, ...olderOffers } = base.offers;
  // The seam rule for this claim (agent-catalog.test.ts's "a claim needs its
  // seam"; R23's pin-claim at preflight): a launcher is puppeteer's to give, so
  // a row that claims one names a puppeteer provider.
  const seamProblem = (row: AgentCatalogEntry) =>
    row.offers.invoke && row.seams.puppeteer === null
      ? `\`${row.id}\` claims \`invoke\` with no puppeteer seam`
      : undefined;

  it("is a capability every row decides — required on the table, a puppeteer claim", () => {
    expect(AGENT_CAPABILITIES).toContain("invoke");
    for (const row of rows) {
      expect(typeof row.offers.invoke, row.id).toBe("boolean");
      expect(seamProblem(row), row.id).toBeUndefined();
    }
    expect(() => AgentCatalogEntry.parse({ ...base, offers: olderOffers })).toThrow();
  });

  it("a row that claims it with no puppeteer seam is refused by the seam rule", () => {
    const none = Object.fromEntries(AGENT_CAPABILITIES.map((c) => [c, false]));
    const seamless = AgentCatalogEntry.parse({
      ...base,
      id: "seamless",
      seams: { puppeteer: null, rosetta: base.seams.rosetta },
      offers: { ...none, invoke: true },
    });
    expect(seamProblem(seamless)).toBe("`seamless` claims `invoke` with no puppeteer seam");
    // the claim is the whole fault: the same row claiming nothing passes
    expect(seamProblem({ ...seamless, offers: { ...seamless.offers, invoke: false } })).toBe(
      undefined,
    );
  });

  // AR7-D15 requires classification, not merely a grammar's presence. The
  // 2026-09-28 expansion supplies that port for all nine vendor adapters;
  // R23 and fieldd's real-provider test hold this claim to the sibling pin.
  it("claims the nine classifying vendor adapters while withholding the protocol row", () => {
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
    expect(isOffered("codex", "invoke")).toBe(true);
    expect(isOffered("grok", "invoke")).toBe(true);
    expect(rows.find((row) => row.id === "grok")?.status).toBe("preview");
    expect(isOffered("grok", "spawn")).toBe(true);
    expect(isOffered("acp", "invoke")).toBe(false);
    // Q17 (2026-10-27): nor a spawn, until fieldd supplies an ACP connector
    expect(isOffered("acp", "spawn")).toBe(false);
  });

  it("an older desktop's row, sent before the word existed, reads as unclaimed — never a refusal", () => {
    const parsed = AgentCatalogResult.parse({ catalog: [{ ...base, offers: olderOffers }] });
    expect(parsed.catalog[0]?.offers.invoke).toBeUndefined();
    expect(parsed.catalog[0]?.offers.spawn).toBe(true);
  });
});

describe("where a run came from (AR-7): spawnedBy and the adopted process", () => {
  it("knows two words, design-04 §8.1's", () => {
    expect([...AGENT_SPAWNED_BY]).toEqual(["app", "user-shell"]);
  });

  it("a typed run's row says user-shell; a row from before AR-7 says nothing, which reads app", () => {
    const typed = AgentSessionSummary.parse(fixture("agent-session-summary.user-shell.json"));
    expect(typed.spawnedBy).toBe("user-shell");
    expect(typed.terminal?.workloadClass).toBe("interactive");
    const older = AgentSessionSummary.parse(fixture("agent-session-summary.valid.json"));
    expect(older.spawnedBy).toBeUndefined();
    expect(older).not.toHaveProperty("spawnedBy");
  });

  it("is OPEN on the wire: a word this build never heard of rides, an empty or overlong one is refused", () => {
    const typed = fixture("agent-session-summary.user-shell.json");
    expect(AgentSessionSummary.parse({ ...typed, spawnedBy: "someday" }).spawnedBy).toBe("someday");
    expect(AgentSessionSummary.safeParse({ ...typed, spawnedBy: "" }).success).toBe(false);
    expect(AgentSessionSummary.safeParse({ ...typed, spawnedBy: "x".repeat(33) }).success).toBe(
      false,
    );
    const record = fixture("agent-session-record.user-shell.json");
    expect(AgentSessionRecord.parse({ ...record, spawnedBy: "someday" }).spawnedBy).toBe("someday");
    expect(AgentSessionRecord.safeParse({ ...record, spawnedBy: "" }).success).toBe(false);
  });

  it("a typed run's record carries the adopted process: a positive pid and the time it started", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.user-shell.json"));
    expect(record.spawnedBy).toBe("user-shell");
    expect(record.process).toEqual({ pid: 48213, startedAt: "2026-09-27T10:00:00.412Z" });
    const raw = fixture("agent-session-record.user-shell.json");
    const adopted = raw.process as Record<string, unknown>;
    for (const pid of [0, -1, 1.5, "48213"]) {
      expect(AgentSessionRecord.safeParse({ ...raw, process: { ...adopted, pid } }).success).toBe(
        false,
      );
    }
    expect(
      AgentSessionRecord.safeParse({ ...raw, process: { ...adopted, startedAt: "" } }).success,
    ).toBe(false);
    expect(AgentSessionRecord.safeParse({ ...raw, process: { pid: 48213 } }).success).toBe(false);
    // tolerant inside: a fact a newer daemon adds to the process rides through
    const newer = AgentSessionRecord.parse({ ...raw, process: { ...adopted, ppid: 1 } });
    expect((newer.process as Record<string, unknown>).ppid).toBe(1);
  });

  // The record is SIGNED over its canonical JSON (fieldd's agent-sessions.ts,
  // untouched by AR-7a): a parse that added a key would change what an existing
  // record canonicalises to. Both new fields are optional, so a record from
  // before AR-7 comes back with exactly the keys it had.
  it("adds nothing to a record from before AR-7: the parse returns exactly its keys", () => {
    const raw = fixture("agent-session-record.valid.json");
    const parsed = AgentSessionRecord.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(raw).sort());
    expect(parsed).not.toHaveProperty("spawnedBy");
    expect(parsed).not.toHaveProperty("process");
  });
});
