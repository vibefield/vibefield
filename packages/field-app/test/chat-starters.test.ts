import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOG, type AgentFieldRow, type AgentProviderSummary } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type StartersReading, startersOf } from "../src/chat/starters";
import { STARTERS } from "../src/chat/thread-items";

// THE STARTERS, FILLED FROM THIS MAC (track ES, ES-4; DESIGN.md §8 "Chat's list", the jobs, "Filled from this Mac";
// §9 "Chat's thread", the hello; ES-D4 A as James ruled it on the ES page, VF-PM 2026-11-08 09:30Z and 09:33Z). Two
// reads fill them: the agents this Mac has, and the field board's runs. The crew is an agent the Mac has that can be
// started, the ruled one first. The project is the busiest folder. The handle is the live run, no spark's own, worked in
// last, named by its agent and its place among that agent's live runs. Its reviewer is an agent the Mac has, the ruled
// one first, another than the run's own where there is one. An agent slot with nothing to fill keeps its ruled word; a
// project or a run with nothing to fill drops out and the starter reads bare (ES-Q1, James 2026-11-09). Pure.

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = "2026-11-08T08:00:00.000Z";

function agent(id: string, over: Partial<AgentProviderSummary> = {}): AgentProviderSummary {
  const entry = AGENT_CATALOG.find((row) => row.id === id);
  return {
    id,
    label: entry?.label ?? id,
    available: true,
    resumable: true,
    personas: [],
    offers: { spawn: true, spark: entry?.offers.spark ?? false },
    ...over,
  };
}

function run(over: Partial<AgentFieldRow> & Pick<AgentFieldRow, "runtimeRunId">): AgentFieldRow {
  return {
    revision: 1,
    kind: "claude",
    label: "Claude Code",
    tier: "managed",
    device: "dev-1",
    status: "idle",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    ...over,
  };
}

const at = (minute: number): string => `2026-11-08T08:${String(minute).padStart(2, "0")}:00.000Z`;
const wordsOf = (reading: StartersReading): string[] =>
  reading.starters.map((starter) => starter.words);

describe('the starters, filled from this Mac (DESIGN.md §8 "Chat\'s list", the jobs, "Filled from this Mac")', () => {
  it("gives the ruled words back on James's Mac: Grok and Codex here, two Claude Code runs in vibe-field, the second worked in last", () => {
    const reading = startersOf({
      agents: [agent("claude"), agent("codex"), agent("grok")],
      rows: [
        run({
          runtimeRunId: "r-1",
          createdAt: at(0),
          lastActivityAt: at(30),
          project: { name: "vibe-field" },
        }),
        run({
          runtimeRunId: "r-2",
          createdAt: at(10),
          lastActivityAt: at(59),
          project: { name: "vibe-field" },
        }),
        run({
          runtimeRunId: "r-3",
          kind: "codex",
          label: "Codex",
          createdAt: at(20),
          lastActivityAt: at(40),
          project: { name: "ice" },
        }),
      ],
    });
    expect(reading.state).toBe("read");
    expect(reading.starters).toEqual(STARTERS);
  });

  it("fills from another Mac: no Grok, three Codex runs in billing-api, the third worked in last; Codex never reviews its own run while another agent is here", () => {
    const codexRun = (id: string, minute: number, last: number) =>
      run({
        runtimeRunId: id,
        kind: "codex",
        label: "Codex",
        createdAt: at(minute),
        lastActivityAt: at(last),
        project: { name: "billing-api" },
      });
    const reading = startersOf({
      agents: [agent("claude"), agent("codex")],
      rows: [
        codexRun("c-1", 1, 20),
        codexRun("c-2", 2, 21),
        codexRun("c-3", 3, 50),
        run({
          runtimeRunId: "w-1",
          createdAt: at(4),
          lastActivityAt: at(30),
          project: { name: "web" },
        }),
      ],
    });
    expect(wordsOf(reading)).toEqual([
      "Spawn 4 Claude Code agents to research a topic each",
      "Keep track of my agents in billing-api",
      "Have Claude Code review codex·3's work until it's clean",
    ]);
    expect(reading.starters.map((starter) => starter.glyph)).toEqual(
      STARTERS.map((starter) => starter.glyph),
    );
  });

  it("reads bare where no project or run fills a slot: an empty board, and Claude Code alone here (ES-Q1)", () => {
    expect(wordsOf(startersOf({ agents: [agent("claude")], rows: [] }))).toEqual([
      "Spawn 4 Claude Code agents to research a topic each",
      "Keep track of my agents",
      "Have Claude Code review my agents' work until it's clean",
    ]);
  });

  it("drops the project alone where the runs name no folder, and still names the run (ES-Q1)", () => {
    const reading = startersOf({
      agents: [agent("claude"), agent("codex"), agent("grok")],
      rows: [
        run({ runtimeRunId: "n-1", lastActivityAt: at(3) }),
        run({ runtimeRunId: "n-2", lastActivityAt: at(4), project: { name: "" } }),
      ],
    });
    expect(wordsOf(reading)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "Keep track of my agents",
      "Have Codex review claude·2's work until it's clean",
    ]);
  });

  it("keeps an agent slot's ruled word where no agent fills it (ES-D4 A; ES-Q1 leaves the agents ruled)", () => {
    const reading = startersOf({ agents: [], rows: [] });
    expect(wordsOf(reading)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "Keep track of my agents",
      "Have Codex review my agents' work until it's clean",
    ]);
  });

  it("names no agent this Mac lacks: one not installed here, or one that cannot be started, fills nothing", () => {
    const reading = startersOf({
      agents: [
        agent("grok", { available: false }),
        agent("codex", { offers: { spawn: false, spark: false } }),
        agent("claude"),
      ],
      rows: [],
    });
    expect(wordsOf(reading)[0]).toBe("Spawn 4 Claude Code agents to research a topic each");
    expect(wordsOf(reading)[2]).toBe("Have Claude Code review my agents' work until it's clean");
  });

  it("never takes a spark's own run, nor one that has ended, for the project or the handle", () => {
    const reading = startersOf({
      agents: [agent("claude"), agent("codex"), agent("grok")],
      rows: [
        run({
          runtimeRunId: "s-1",
          spark: "sp-vela0001",
          lastActivityAt: at(59),
          project: { name: "secret" },
        }),
        run({
          runtimeRunId: "e-1",
          alive: false,
          lastActivityAt: at(58),
          project: { name: "old" },
        }),
        run({ runtimeRunId: "l-1", lastActivityAt: at(10), project: { name: "vibe-field" } }),
      ],
    });
    expect(wordsOf(reading)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "Keep track of my agents in vibe-field",
      // the one live run of its agent is named by its agent alone
      "Have Codex review claude's work until it's clean",
    ]);
  });

  it("breaks a tie between folders by the one worked in last", () => {
    const reading = startersOf({
      agents: [agent("claude")],
      rows: [
        run({ runtimeRunId: "a-1", lastActivityAt: at(5), project: { name: "alpha" } }),
        run({ runtimeRunId: "a-2", lastActivityAt: at(6), project: { name: "alpha" } }),
        run({ runtimeRunId: "b-1", lastActivityAt: at(7), project: { name: "beta" } }),
        run({ runtimeRunId: "b-2", lastActivityAt: at(40), project: { name: "beta" } }),
      ],
    });
    expect(wordsOf(reading)[1]).toBe("Keep track of my agents in beta");
  });

  it("treats a read it cannot have as nothing to fill: the agents' stay ruled, the board's drop out (ES-Q1)", () => {
    expect(wordsOf(startersOf({ agents: "failed", rows: "failed" }))).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "Keep track of my agents",
      "Have Codex review my agents' work until it's clean",
    ]);
    const boardOnly = startersOf({
      agents: "failed",
      rows: [run({ runtimeRunId: "x-1", project: { name: "web" } })],
    });
    expect(wordsOf(boardOnly)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "Keep track of my agents in web",
      "Have Codex review claude's work until it's clean",
    ]);
    const agentsOnly = startersOf({ agents: [agent("claude")], rows: "failed" });
    expect(wordsOf(agentsOnly)).toEqual([
      "Spawn 4 Claude Code agents to research a topic each",
      "Keep track of my agents",
      "Have Claude Code review my agents' work until it's clean",
    ]);
  });

  it("holds the starters in their places, wordless, while either read is out", () => {
    for (const reading of [
      startersOf({ agents: null, rows: [] }),
      startersOf({ agents: [agent("claude")], rows: null }),
    ]) {
      expect(reading.state).toBe("reading");
      expect(reading.starters).toEqual(STARTERS);
    }
  });

  it("brings the words in over 420ms on the island curve once they are read; held, a starter keeps its place", () => {
    const css = readFileSync(join(HERE, "../src/chat/chat-starter.css"), "utf8");
    const words = css.match(/^\.vf-chat-starter > span \{([^}]*)\}/mu)?.[1] ?? "";
    expect(words).toMatch(/transition: opacity 420ms var\(--vf-ease-island\);/u);
    const held =
      css.match(/^\.vf-chat-starter\[data-held="true"\] > span \{([^}]*)\}/mu)?.[1] ?? "";
    expect(held).toMatch(/opacity: 0;/u);
  });

  // ES-4 (role; VF-PM 2026-11-08 23:41Z, shape A): the catalog's role rows are the agents the hello's ruled sentences
  // name, so the ruled words and the roles cannot drift apart. The fill reads the roles from the table (R23b holds
  // starters.ts to no agent id literal).
  it("binds the hello's ruled sentences to the catalog's role rows: the crew's label, the reviewer's, the handle's run", () => {
    const roleRow = (role: string) =>
      AGENT_CATALOG.find((row) => (row as Record<string, unknown>).starter === role);
    const crew = roleRow("crew");
    const handle = roleRow("handle");
    const reviewer = roleRow("reviewer");
    expect(crew, "the crew's row").toBeDefined();
    expect(handle, "the handle's row").toBeDefined();
    expect(reviewer, "the reviewer's row").toBeDefined();
    const [spawn, , review] = STARTERS;
    expect(spawn?.words).toBe(`Spawn 4 ${crew?.label} agents to research a topic each`);
    const run = `${handle?.seams.puppeteer?.provider}·2`;
    expect(review?.words).toBe(`Have ${reviewer?.label} review ${run}'s work until it's clean`);
  });
});
