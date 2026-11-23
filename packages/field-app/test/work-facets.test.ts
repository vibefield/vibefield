import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";
import { agentViewFixture } from "@vibefield/puppeteer-view-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  agentOf,
  drawsGroup,
  NO_WORK,
  projectOf,
  SHELL_AGENT,
  sessionsUnder,
  standingWork,
  workFacets,
  workRecedes,
  workSessions,
  workSessionsKey,
} from "../src/godview/monitor/work-facets";

// WL-1 (2026-11-23; DESIGN.md §8 "Godview's work column"): the work column's two
// groups, read off the rows on the stage — a project by its folder's name, an
// agent by its provider, a bare terminal as Shell — each in the order its first
// session came, with what runs and what waits under it; a choice read where it
// stands; and the lens that recedes a run off it.

const ALPHA = { id: "alpha-agent", label: "Alpha" };
const BETA = { id: "beta-agent", label: "Beta" };

const row = (
  id: string,
  project: string,
  provider: { id: string; label: string } | undefined,
  extra: Partial<AgentView> = {},
): AgentView =>
  agentViewFixture({
    id,
    project: { name: project, seq: project.length },
    ...(provider === undefined ? { kind: "terminal" as const } : { provider }),
    ...extra,
  });

describe("the work column's groups (`workFacets`)", () => {
  it("counts each project and agent, its sessions and its waits, in the order each first came", () => {
    const work = workFacets([
      row("r3", "billing-api", ALPHA, { createdAt: 30, colour: "#333333" }),
      row("r1", "vibe-field", ALPHA, { createdAt: 10, colour: "#111111" }),
      row("r2", "vibe-field", BETA, { createdAt: 20, status: "blocked" }),
      row("r4", "billing-api", undefined, { createdAt: 40 }),
    ]);
    expect(work.projects).toEqual([
      {
        id: "vibe-field",
        label: "vibe-field",
        sessions: 2,
        waiting: 1,
        since: 10,
        colour: "#111111",
        seq: 10,
      },
      {
        id: "billing-api",
        label: "billing-api",
        sessions: 2,
        waiting: 0,
        since: 30,
        colour: "#333333",
        seq: 11,
      },
    ]);
    expect(work.agents).toEqual([
      { id: "alpha-agent", label: "Alpha", sessions: 2, waiting: 0, since: 10, shell: false },
      { id: "beta-agent", label: "Beta", sessions: 1, waiting: 1, since: 20, shell: false },
      { id: SHELL_AGENT, label: "Shell", sessions: 1, waiting: 0, since: 40, shell: true },
    ]);
  });

  it("gives a terminal in no project no project, and an agent that names no provider no agent", () => {
    const loose = agentViewFixture({ id: "t", kind: "terminal", project: { name: "" } });
    expect(projectOf(loose)).toBeUndefined();
    expect(agentOf(loose)).toBe(SHELL_AGENT);
    const unnamed = agentViewFixture({ id: "a", kind: "agent" });
    expect(agentOf(unnamed)).toBeUndefined();
    expect(workFacets([loose]).projects).toEqual([]);
    expect(workFacets([])).toBe(NO_WORK);
  });

  it("orders a tie by its id, never by the rows' own order", () => {
    const a = workFacets([row("x", "zeta", ALPHA), row("y", "eta", BETA)]);
    const b = workFacets([row("y", "eta", BETA), row("x", "zeta", ALPHA)]);
    expect(a.projects.map((facet) => facet.id)).toEqual(["eta", "zeta"]);
    expect(b.projects.map((facet) => facet.id)).toEqual(["eta", "zeta"]);
  });
});

describe("a choice read where it stands, and the groups drawn (§8 'Which circles')", () => {
  const work = workFacets([row("r1", "vibe-field", ALPHA), row("r2", "billing-api", ALPHA)]);

  it("stands while a session of it is on the stage, and is none (but kept) while none is", () => {
    expect(standingWork(work.projects, "vibe-field")).toBe("vibe-field");
    expect(standingWork(work.projects, "gone")).toBeNull();
    expect(standingWork(work.projects, null)).toBeNull();
  });

  it("draws a group of two values or more, and a group of one only while its choice stands", () => {
    expect(drawsGroup(work.projects, null)).toBe(true);
    expect(drawsGroup(work.agents, null)).toBe(false);
    expect(drawsGroup(work.agents, "alpha-agent")).toBe(true);
    expect(drawsGroup(work.agents, "gone")).toBe(false);
  });
});

describe("the work lens (`workRecedes`)", () => {
  it("recedes a run off the chosen project or off the chosen agent, and keeps every run with nothing chosen", () => {
    const run = { project: "vibe-field", agent: "alpha-agent" };
    expect(workRecedes({}, run)).toBe(false);
    expect(workRecedes({ project: "vibe-field" }, run)).toBe(false);
    expect(workRecedes({ project: "billing-api" }, run)).toBe(true);
    expect(workRecedes({ agent: "beta-agent" }, run)).toBe(true);
    expect(workRecedes({ project: "vibe-field", agent: "alpha-agent" }, run)).toBe(false);
    expect(workRecedes({ project: "vibe-field", agent: "beta-agent" }, run)).toBe(true);
    // a run with no project recedes under any project
    expect(workRecedes({ project: "vibe-field" }, { project: undefined, agent: "x" })).toBe(true);
  });
});

describe("a card's sessions (`workSessions`, `sessionsUnder`)", () => {
  const rows = [
    row("idle", "vibe-field", ALPHA, { createdAt: 1, status: "idle" }),
    row("shell", "vibe-field", undefined, { createdAt: 2 }),
    row("working", "vibe-field", BETA, { createdAt: 3, status: "working" }),
    row("blocked", "vibe-field", ALPHA, {
      createdAt: 4,
      status: "blocked",
      wait: { kind: "permission", since: 4 },
    }),
    row("elsewhere", "billing-api", ALPHA, { createdAt: 5 }),
  ];
  const sessions = workSessions(rows);

  it("lists those that wait first, then working, then idle, then the shells, each saying its state", () => {
    const under = sessionsUnder(sessions, { group: "project", id: "vibe-field" });
    expect(under.map((session) => [session.id, session.dot, session.state])).toEqual([
      ["blocked", "blocked", "blocked · permission"],
      ["working", "working", "working"],
      ["idle", "idle", "idle"],
      ["shell", "shell", "quiet"],
    ]);
    expect(under.map((session) => session.agentLabel)).toEqual(["Alpha", "Beta", "Alpha", "Shell"]);
  });

  it("lists an agent's sessions across its projects", () => {
    const under = sessionsUnder(sessions, { group: "agent", id: "alpha-agent" });
    expect(under.map((session) => session.projectName)).toEqual([
      "vibe-field",
      "vibe-field",
      "billing-api",
    ]);
  });

  it("keys a card by every fact it draws, never a token count", () => {
    const key = workSessionsKey(sessions);
    const counted = workSessions(
      rows.map((each) => ({ ...each, tokens: { total: 5_000, perMinute: 900 } })),
    );
    expect(workSessionsKey(counted)).toBe(key);
    const moved = workSessions(rows.map((each) => ({ ...each, status: "working" as const })));
    expect(workSessionsKey(moved)).not.toBe(key);
  });
});
