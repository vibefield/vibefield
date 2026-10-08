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
interface CachedFindAgent {
  readonly nativeSessionId: string | undefined;
  readonly observed: boolean;
  readonly statusSince: string | undefined;
  readonly startedAt: string | undefined;
  readonly lastEvidenceAt: string | undefined;
  readonly row: FindAgent;
}

/** One cache per window. Model rows are immutable; local clocks are compared
 * separately because chrome facts can move without that model row changing. */
export function createFindAgents(): (
  agents: readonly AgentView[],
  runByRow: ReadonlyMap<string, string>,
  runs: readonly ChromeRun[],
) => readonly FindAgent[] {
  const cached = new WeakMap<AgentView, CachedFindAgent>();
  let last: readonly FindAgent[] = Object.freeze([]);
  return (agents, runByRow, runs) => {
    const byRun = new Map(runs.map((run) => [run.runtimeRunId, run] as const));
    const next = agents.map((row): FindAgent => {
      const runId = row.kind === "agent" && row.device.self ? runByRow.get(row.id) : undefined;
      const run = runId === undefined ? undefined : byRun.get(runId);
      const local = run?.local;
      const mirror = local?.mirror;
      const nativeSessionId = local?.nativeSessionId;
      const observed = mirror !== undefined;
      const statusSince = observed ? run?.statusSince : undefined;
      const startedAt = mirror?.startedAt;
      const lastEvidenceAt = mirror?.lastEvidenceAt;
      const held = cached.get(row);
      if (
        held !== undefined &&
        held.nativeSessionId === nativeSessionId &&
        held.observed === observed &&
        held.statusSince === statusSince &&
        held.startedAt === startedAt &&
        held.lastEvidenceAt === lastEvidenceAt
      ) {
        return held.row;
      }
      const made: FindAgent = {
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
                ...(nativeSessionId !== undefined ? { nativeSessionId } : {}),
                // Preserve absence: these clocks are the local mirror's,
                // never inferred from the presentation model or a peer.
                ...(run !== undefined && mirror !== undefined
                  ? {
                      monitor: {
                        statusSince: run.statusSince,
                        session: startedAt !== undefined ? { startedAt } : {},
                        freshness: lastEvidenceAt !== undefined ? { lastEvidenceAt } : {},
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
      cached.set(row, {
        nativeSessionId,
        observed,
        statusSince,
        startedAt,
        lastEvidenceAt,
        row: made,
      });
      return made;
    });
    if (next.length !== last.length || next.some((row, index) => row !== last[index])) {
      last = Object.freeze(next);
    }
    return last;
  };
}
