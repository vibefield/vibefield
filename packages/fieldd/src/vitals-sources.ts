import { VITALS } from "@vibefield/contracts";
import type { VitalsNamedProcess } from "./vitals-service";

// VT-1's sources, named (track VT, 2026-11-24) — the pure halves of the processes fieldd names for its vitals
// recorder (`vitals-service.ts`), which `daemon.ts`'s `sources` list calls with what its services hold in memory. Each
// is a pure function: it reads nothing of a process (never its arguments, folder, environment or output: VT-D4) and
// never waits, so a source over it answers at every sample as `VitalsSource` asks.

/** A label as a row shows it: one line, bounded (`VITALS.LABEL_MAX`); an empty one is no label. */
export function vitalsLabel(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const line = text.replace(/\s+/g, " ").trim();
  return line === "" ? undefined : line.slice(0, VITALS.LABEL_MAX);
}

/** What the source needs of a floor terminal (`TerminalInfo`). */
export interface VitalsTerminalRow {
  sessionId: string;
  pid?: number | null | undefined;
}

/** What the source needs of an agent run's row (`AgentSessionSummary`): which agent, and the floor session fieldd
 * launched it in. */
export interface VitalsAgentRun {
  /** the run's agent, by its catalog id */
  kind: string;
  terminal?: { hosted: string; runtimeSessionId?: string | undefined } | undefined;
  continuation?: { exited?: boolean | undefined } | undefined;
}

/** VT-2c (2026-11-24; DESIGN.md §9 "Vitals' words": "A terminal's row is **Terminal**, or the agent's name once
 * fieldd says it") — the person's terminals, each its own process and everything under it (VT-D4's group). A terminal
 * fieldd launched an agent in, on this device, says that agent by the catalog's label (`labelOf`, a lookup by id and
 * never a compare: R23b) while the run stands; once its record says the agent exited (its pane returned to a shell),
 * or for a plain shell, or for an agent the catalog does not name, the row is the role's word alone, **Terminal**.
 * What the person typed into a shell is never read, so an agent started by hand in a shell stays **Terminal**.
 *
 * `runs` is read only while a terminal stands, and a run list that cannot be read names every terminal by its role
 * alone rather than none of them. */
export function terminalVitalsRows(
  terminals: readonly VitalsTerminalRow[],
  runs: () => readonly VitalsAgentRun[],
  labelOf: (agentId: string) => string | undefined,
): VitalsNamedProcess[] {
  if (terminals.length === 0) return [];
  let listed: readonly VitalsAgentRun[] = [];
  try {
    listed = runs();
  } catch {
    listed = [];
  }
  const agentIn = new Map<string, string>();
  for (const run of listed) {
    const session = run.terminal?.runtimeSessionId;
    if (session === undefined || run.terminal?.hosted !== "local") continue;
    if (run.continuation?.exited === true) continue;
    const label = vitalsLabel(labelOf(run.kind));
    if (label !== undefined && !agentIn.has(session)) agentIn.set(session, label);
  }
  return terminals.flatMap((terminal): VitalsNamedProcess[] => {
    if (typeof terminal.pid !== "number" || terminal.pid <= 0) return [];
    const label = agentIn.get(terminal.sessionId);
    return [
      {
        pid: terminal.pid,
        group: "agents",
        role: "terminal",
        tree: true,
        ...(label !== undefined ? { label } : {}),
      },
    ];
  });
}

/** What the source needs of a plugin's supervised child (`ProcessRecord`). */
export interface VitalsPluginProcess {
  pluginId: string;
  state: string;
  pid?: number | undefined;
}

/** VT-2c (2026-11-24) — the plugins' own processes, which fieldd starts and supervises for them (`ProcessService`,
 * plugin spec §17.1): each running child, counted with everything under it (a plugin's `npx` runs its work below
 * it), its row the plugin's title as Settings shows it (`titleOf`), else the role's word, **Plugin process**. A child
 * between restarts, exited or failed has no process to measure and no row. */
export function pluginProcessVitalsRows(
  records: readonly VitalsPluginProcess[],
  titleOf: (pluginId: string) => string | undefined,
): VitalsNamedProcess[] {
  return records.flatMap((record): VitalsNamedProcess[] => {
    if (record.state !== "running" || typeof record.pid !== "number" || record.pid <= 0) return [];
    const label = vitalsLabel(titleOf(record.pluginId));
    return [
      {
        pid: record.pid,
        group: "fieldd",
        role: "plugin-process",
        tree: true,
        ...(label !== undefined ? { label } : {}),
      },
    ];
  });
}

/** VT-2c (2026-11-24) — the MCP servers fieldd started itself (a plugin's configured stdio server, `spawnMcpStdio`),
 * each counted with everything under it, its row **MCP server**. The MCP servers an agent starts are the agent's,
 * inside its terminal's tree, and never named here. */
export function mcpServerVitalsRows(pids: readonly number[]): VitalsNamedProcess[] {
  return pids
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .map((pid): VitalsNamedProcess => ({ pid, group: "fieldd", role: "mcp-server", tree: true }));
}
