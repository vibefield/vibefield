import type { AgentView, MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";
import { projectName, stateWord } from "@vibefield/puppeteer-view-sdk/toolkit";

// WL-1 (DESIGN.md §8 "Godview's work column", 2026-11-23) — WHAT RUNS, BY PROJECT AND BY AGENT: the two groups the
// work column draws and search's Live now offers, read off the rows on the stage. A project is the folder a session
// runs in, by its name, as the bodies are titled; an agent is the provider a session runs, and a bare terminal is
// Shell. Each group stands in the order its first session came, so a circle keeps its place while it has sessions.
// A choice is kept as chosen and read where it stands, as a desktop's is (`standingChoice`). Pure: no React, no DOM.

/** A bare terminal's place among the agents. No provider id is written in parentheses, so it is no agent's. */
export const SHELL_AGENT = "(shell)";

/** What the column, the menu and a token call a bare terminal's agent. */
export const SHELL_LABEL = "Shell";

/** One value of a group: a project or an agent, and what runs under it on the stage. */
export interface WorkFacet {
  /** a project's folder name; an agent's provider id, or `SHELL_AGENT` */
  readonly id: string;
  /** what it is called: the folder's name, the adapter's own label, or Shell */
  readonly label: string;
  /** the sessions under it on the stage */
  readonly sessions: number;
  /** of those, how many wait on you */
  readonly waiting: number;
  /** when its first session came, the earliest `createdAt`: its place in the group */
  readonly since: number;
}

export interface WorkProject extends WorkFacet {
  /** the colour its bodies wear in Godview's mode (`AgentView.colour`), its first session's */
  readonly colour: string;
  /** its colour's sequence (`MonitorProject.seq`), for a surface outside Godview's mode; absent, the neutral */
  readonly seq?: number | undefined;
}

export interface WorkAgent extends WorkFacet {
  /** a bare terminal's: drawn with `terminal`, as no agent has a mark of its own for it */
  readonly shell: boolean;
}

/** The two groups, each in the order its first session came. */
export interface WorkFacets {
  readonly projects: readonly WorkProject[];
  readonly agents: readonly WorkAgent[];
}

export const NO_WORK: WorkFacets = Object.freeze({
  projects: Object.freeze([]),
  agents: Object.freeze([]),
});

/** The project a session runs in, by its folder's name; none for a terminal in no project. */
export function projectOf(row: Pick<MonitorAgentRow, "project">): string | undefined {
  return row.project.name === "" ? undefined : row.project.name;
}

/** The agent a session runs: its provider's id, `SHELL_AGENT` for a bare terminal, none while an agent names none. */
export function agentOf(row: Pick<MonitorAgentRow, "kind" | "provider">): string | undefined {
  if (row.provider !== undefined) return row.provider.id;
  return row.kind === "terminal" ? SHELL_AGENT : undefined;
}

/** What a session's agent is called: the adapter's own label (as Live now's rows say it), else its id; Shell for a
 * bare terminal; and, for an agent that names no provider yet, the word for one. */
function agentLabel(row: Pick<MonitorAgentRow, "kind" | "provider">): string {
  if (row.provider !== undefined) return row.provider.label || row.provider.id;
  return row.kind === "terminal" ? SHELL_LABEL : "Agent";
}

interface Tally {
  id: string;
  label: string;
  sessions: number;
  waiting: number;
  since: number;
  colour: string;
  seq: number | undefined;
}

function count(tallies: Map<string, Tally>, row: AgentView, id: string, label: string): void {
  const waits = row.status === "blocked" ? 1 : 0;
  const tally = tallies.get(id);
  if (tally === undefined) {
    tallies.set(id, {
      id,
      label,
      sessions: 1,
      waiting: waits,
      since: row.createdAt,
      colour: row.colour,
      seq: row.project.seq,
    });
    return;
  }
  tally.sessions += 1;
  tally.waiting += waits;
  if (row.createdAt < tally.since) {
    tally.since = row.createdAt;
    tally.colour = row.colour;
    tally.seq = row.project.seq;
  }
}

/** Oldest first; a tie by its id, so the order never depends on the rows'. */
const byArrival = (a: Tally, b: Tally): number => a.since - b.since || a.id.localeCompare(b.id);

/** The groups of the rows on the stage (the chosen desktop's, every profile's): each value counted, its waits
 * counted, in the order its first session came. */
export function workFacets(rows: readonly AgentView[]): WorkFacets {
  const projects = new Map<string, Tally>();
  const agents = new Map<string, Tally>();
  for (const row of rows) {
    const project = projectOf(row);
    if (project !== undefined) count(projects, row, project, project);
    const agent = agentOf(row);
    if (agent !== undefined) count(agents, row, agent, agentLabel(row));
  }
  if (projects.size === 0 && agents.size === 0) return NO_WORK;
  return {
    projects: [...projects.values()].sort(byArrival).map((tally) => ({
      id: tally.id,
      label: tally.label,
      sessions: tally.sessions,
      waiting: tally.waiting,
      since: tally.since,
      colour: tally.colour,
      ...(tally.seq !== undefined ? { seq: tally.seq } : {}),
    })),
    agents: [...agents.values()].sort(byArrival).map((tally) => ({
      id: tally.id,
      label: tally.label,
      sessions: tally.sessions,
      waiting: tally.waiting,
      since: tally.since,
      shell: tally.id === SHELL_AGENT,
    })),
  };
}

/** A choice as the stage still has it: the id while a session of it stands there, else none. The choice itself is
 * kept, so it is chosen again when one returns. */
export function standingWork(facets: readonly WorkFacet[], chosen: string | null): string | null {
  return chosen !== null && facets.some((facet) => facet.id === chosen) ? chosen : null;
}

/** Whether a group is drawn, in the column and in Live now's menu: two values or more, or its choice standing, so a
 * lens is never out of sight. */
export function drawsGroup(facets: readonly WorkFacet[], chosen: string | null): boolean {
  return facets.length > 1 || standingWork(facets, chosen) !== null;
}

/** The work lens: the chosen project and agent as they stand; absent, that group keeps everything. */
export interface WorkLens {
  readonly project?: string | undefined;
  readonly agent?: string | undefined;
}

/** Whether a run recedes under the work lens: it is off the chosen project or the chosen agent. A live row and an
 * ended lane both call it, as `runRecedes` is called for the profile and the plan. */
export function workRecedes(
  lens: WorkLens,
  run: { readonly project: string | undefined; readonly agent: string | undefined },
): boolean {
  return (
    (lens.project !== undefined && run.project !== lens.project) ||
    (lens.agent !== undefined && run.agent !== lens.agent)
  );
}

/** A session as a card lists it. */
export interface WorkSession {
  readonly id: string;
  /** its dot, as Live now's: working green, waiting orange, idle and a shell faint */
  readonly dot: "working" | "blocked" | "idle" | "shell";
  /** its project's id, or none */
  readonly project: string | undefined;
  /** its name where an agent's card lists it, as its body is titled */
  readonly projectName: string;
  /** the colour its body wears */
  readonly colour: string;
  /** its agent's id, or none */
  readonly agent: string | undefined;
  /** its agent's name, where a project's card lists it */
  readonly agentLabel: string;
  /** a bare terminal's */
  readonly shell: boolean;
  /** its state in the timeline readout's words (`stateWord`): "working", "blocked · permission", "running" */
  readonly state: string;
  readonly since: number;
}

const DOT_ORDER: Readonly<Record<WorkSession["dot"], number>> = {
  blocked: 0,
  working: 1,
  idle: 2,
  shell: 3,
};

/** The rows on the stage as the cards list them. */
export function workSessions(rows: readonly AgentView[]): readonly WorkSession[] {
  return rows.map((row) => {
    const agent = agentOf(row);
    return {
      id: row.id,
      dot: row.kind === "terminal" ? "shell" : row.status,
      project: projectOf(row),
      projectName: projectName(row),
      colour: row.colour,
      agent,
      agentLabel: agentLabel(row),
      shell: agent === SHELL_AGENT,
      state: stateWord(row),
      since: row.createdAt,
    };
  });
}

/** What makes the cards' sessions the same: every fact a card draws, never a token count (M19). */
export function workSessionsKey(sessions: readonly WorkSession[]): string {
  return sessions
    .map((session) =>
      [
        session.id,
        session.dot,
        session.project ?? "",
        session.projectName,
        session.colour,
        session.agent ?? "",
        session.agentLabel,
        session.state,
        session.since,
      ].join("\u0001"),
    )
    .join("\n");
}

/** One group's value: a project's or an agent's, as the column and the cards name a target. */
export type WorkTarget =
  | { readonly group: "project"; readonly id: string }
  | { readonly group: "agent"; readonly id: string };

/** The sessions under a target, as its card lists them: those that wait first, then working, then idle, then the
 * shells, the oldest first within each. */
export function sessionsUnder(
  sessions: readonly WorkSession[],
  target: WorkTarget,
): readonly WorkSession[] {
  return sessions
    .filter((session) =>
      target.group === "project" ? session.project === target.id : session.agent === target.id,
    )
    .sort((a, b) => DOT_ORDER[a.dot] - DOT_ORDER[b.dot] || a.since - b.since);
}
