import type { AgentView } from "@vibecook/puppeteer-view-sdk/model";
import { detailLine, projectName } from "@vibecook/puppeteer-view-sdk/toolkit";
import type { FindAgent } from "@vibecook/puppeteer-views";
import type { ChromeRun } from "./chrome-facts";

/** The facts Find joins on, per run. Evidence recency is read fresh at a join,
 * without redrawing the sheet for every evidence tick (M19, MV-3d). */
export function findJoinKey(runs: readonly ChromeRun[]): string {
  return runs
    .map((run) => {
      const mirror = run.local?.mirror;
      return `${run.runtimeRunId}:${run.local?.nativeSessionId ?? ""}:${mirror === undefined ? "-" : "m"}:${mirror?.startedAt ?? ""}:${mirror === undefined ? "" : run.statusSince}`;
    })
    .join("\n");
}

/**
 * Find's rows (M19, M49): the model's searchable facts plus this window's
 * native session id and mirror clocks. No view reads this adapter. It carries
 * exactly what Find reads, with no fabricated terminal, pane or Core state.
 * A peer keeps its established search surface (M9): no local account or
 * transcript join. Only rosetta searches transcripts, through HistoryPort.
 */
export function findAgentsOf(
  agents: readonly AgentView[],
  runByRow: ReadonlyMap<string, string>,
  runs: readonly ChromeRun[],
): readonly FindAgent[] {
  const byRun = new Map(runs.map((run) => [run.runtimeRunId, run] as const));
  return agents.map((row): FindAgent => {
    const runId = row.device.self ? runByRow.get(row.id) : undefined;
    const run = runId === undefined ? undefined : byRun.get(runId);
    const local = run?.local;
    const mirror = local?.mirror;
    return {
      id: row.id,
      createdAtMs: row.createdAt,
      status: row.status,
      project: projectName(row),
      detail: detailLine(row),
      color: row.colour,
      ...(row.kind === "agent"
        ? {
            agent: {
              provider: row.provider ?? { id: "", label: "" },
              ...(row.model ? { model: row.model } : {}),
              ...(row.project.branch ? { branch: row.project.branch } : {}),
              ...(row.device.self && row.account ? { account: row.account } : {}),
              ...(local?.nativeSessionId !== undefined
                ? { nativeSessionId: local.nativeSessionId }
                : {}),
              // Find reads only these optional clocks. Preserve absence;
              // neither a terminal nor a full Core state is invented.
              ...(run !== undefined && mirror !== undefined
                ? {
                    monitor: {
                      statusSince: run.statusSince,
                      session:
                        mirror.startedAt !== undefined ? { startedAt: mirror.startedAt } : {},
                      freshness:
                        mirror.lastEvidenceAt !== undefined
                          ? { lastEvidenceAt: mirror.lastEvidenceAt }
                          : {},
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
  });
}
