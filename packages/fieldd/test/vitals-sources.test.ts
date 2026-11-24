import { EventEmitter } from "node:events";
import { AGENT_CATALOG, VITALS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { ChildPidCensus } from "../src/child-pid-census";
import { MCP_STDIO_CHILDREN, spawnMcpStdio } from "../src/process-service";
import {
  mcpServerVitalsRows,
  pluginProcessVitalsRows,
  terminalVitalsRows,
  type VitalsAgentRun,
  vitalsLabel,
} from "../src/vitals-sources";

// VT-2c (track VT, 2026-11-24) — the pure halves of the processes fieldd names for the vitals recorder: what each
// source makes of what fieldd's own services hold, and never more (VT-D4: no argument, folder, environment or output).

const first = AGENT_CATALOG[0];
const second = AGENT_CATALOG[1];
if (first === undefined || second === undefined)
  throw new Error("the catalog has fewer than two rows");
/** the catalog's label for an id: the same lookup daemon.ts hands the source */
const labelOf = (id: string): string | undefined =>
  AGENT_CATALOG.find((entry) => entry.id === id)?.label;

const run = (
  kind: string,
  session: string,
  extra: Partial<VitalsAgentRun> = {},
): VitalsAgentRun => ({
  kind,
  terminal: { hosted: "local", runtimeSessionId: session },
  ...extra,
});

describe("VT-2c — a terminal's row says the agent fieldd launched in it", () => {
  it("names a terminal by its run's agent, the catalog's label; a plain shell stays Terminal", () => {
    const rows = terminalVitalsRows(
      [
        { sessionId: "s-agent", pid: 501 },
        { sessionId: "s-shell", pid: 502 },
        { sessionId: "s-other-agent", pid: 503 },
      ],
      () => [run(first.id, "s-agent"), run(second.id, "s-other-agent")],
      labelOf,
    );
    expect(rows).toEqual([
      { pid: 501, group: "agents", role: "terminal", tree: true, label: first.label },
      { pid: 502, group: "agents", role: "terminal", tree: true },
      { pid: 503, group: "agents", role: "terminal", tree: true, label: second.label },
    ]);
  });

  it("an exited run, a remote run, and an agent the catalog does not name leave the row Terminal", () => {
    const rows = terminalVitalsRows(
      [
        { sessionId: "s-exited", pid: 601 },
        { sessionId: "s-remote", pid: 602 },
        { sessionId: "s-unknown", pid: 603 },
      ],
      () => [
        run(first.id, "s-exited", { continuation: { exited: true } }),
        run(first.id, "s-remote", {
          terminal: { hosted: "remote", runtimeSessionId: "s-remote" },
        }),
        run("an-agent-no-build-decided-on", "s-unknown"),
      ],
      labelOf,
    );
    for (const row of rows) expect(row).not.toHaveProperty("label");
    expect(rows.map((row) => row.pid)).toEqual([601, 602, 603]);
  });

  it("a terminal with no pid yet is not named, and no terminal reads no runs", () => {
    let read = 0;
    const runs = (): VitalsAgentRun[] => {
      read += 1;
      return [run(first.id, "s1")];
    };
    expect(terminalVitalsRows([], runs, labelOf)).toEqual([]);
    expect(read).toBe(0);
    expect(
      terminalVitalsRows(
        [{ sessionId: "s1", pid: null }, { sessionId: "s2", pid: 0 }, { sessionId: "s3" }],
        runs,
        labelOf,
      ),
    ).toEqual([]);
  });

  it("a run list that cannot be read names every terminal by its role alone, never none", () => {
    const rows = terminalVitalsRows(
      [{ sessionId: "s1", pid: 701 }],
      () => {
        throw new Error("the runtime is not composed");
      },
      labelOf,
    );
    expect(rows).toEqual([{ pid: 701, group: "agents", role: "terminal", tree: true }]);
  });

  it("the label is one line and bounded; an empty one is none", () => {
    expect(vitalsLabel("  An\nAgent  ")).toBe("An Agent");
    expect(vitalsLabel("x".repeat(VITALS.LABEL_MAX + 20))).toHaveLength(VITALS.LABEL_MAX);
    expect(vitalsLabel("   ")).toBeUndefined();
    expect(vitalsLabel(undefined)).toBeUndefined();
    const rows = terminalVitalsRows(
      [{ sessionId: "s1", pid: 801 }],
      () => [run(first.id, "s1")],
      () => "y".repeat(VITALS.LABEL_MAX * 2),
    );
    expect(rows[0]?.label).toHaveLength(VITALS.LABEL_MAX);
  });
});

describe("VT-2c — the processes fieldd starts for plugins, and the MCP servers it starts", () => {
  it("names each running plugin child by its plugin's title, with everything under it", () => {
    const titles: Record<string, string> = { "vibefield.desk-clock": "Desk Clock" };
    const rows = pluginProcessVitalsRows(
      [
        { pluginId: "vibefield.desk-clock", state: "running", pid: 901 },
        { pluginId: "vibefield.untitled", state: "running", pid: 902 },
        { pluginId: "vibefield.desk-clock", state: "restarting" },
        { pluginId: "vibefield.desk-clock", state: "exited", pid: 903 },
        { pluginId: "vibefield.desk-clock", state: "failed", pid: 904 },
      ],
      (pluginId) => titles[pluginId],
    );
    expect(rows).toEqual([
      { pid: 901, group: "fieldd", role: "plugin-process", tree: true, label: "Desk Clock" },
      { pid: 902, group: "fieldd", role: "plugin-process", tree: true },
    ]);
  });

  it("names each MCP server fieldd started, and nothing that is not a pid", () => {
    expect(mcpServerVitalsRows([1201, 0, -3, 1.5, 1202])).toEqual([
      { pid: 1201, group: "fieldd", role: "mcp-server", tree: true },
      { pid: 1202, group: "fieldd", role: "mcp-server", tree: true },
    ]);
    expect(mcpServerVitalsRows([])).toEqual([]);
  });

  it("the census counts a child from its spawn to its exit, and never one with no pid", () => {
    const census = new ChildPidCensus();
    const child = (pid?: number) => Object.assign(new EventEmitter(), { pid });
    const a = child(1301);
    const b = child(1302);
    census.note(a);
    census.note(b);
    census.note(child());
    census.note(child(0));
    expect(census.pids()).toEqual([1301, 1302]);
    a.emit("exit", 0, null);
    expect(census.pids()).toEqual([1302]);
    b.emit("exit", null, "SIGTERM");
    expect(census.pids()).toEqual([]);
  });

  it("the MCP door counts the server it really spawned until that server exits", async () => {
    expect(MCP_STDIO_CHILDREN.pids()).toEqual([]);
    const server = spawnMcpStdio({
      executable: process.execPath,
      args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"],
    });
    const exited = new Promise<void>((resolve) => server.onExit(() => resolve()));
    expect(MCP_STDIO_CHILDREN.pids()).toHaveLength(1);
    expect(mcpServerVitalsRows(MCP_STDIO_CHILDREN.pids())[0]?.role).toBe("mcp-server");
    server.stdin.end();
    await exited;
    expect(MCP_STDIO_CHILDREN.pids()).toEqual([]);
  });
});
