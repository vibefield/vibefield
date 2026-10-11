import type { AgentView } from "@vibecook/puppeteer-view-sdk/model";
import { detailLine, projectName } from "@vibecook/puppeteer-view-sdk/toolkit";
import type { LiveDesk, LiveFindAgent } from "../../frame/find-door";
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

/** The model's OS word as the views' four marks name it; never guessed. */
function deskOs(os: string | undefined): LiveDesk["os"] {
  switch (os) {
    case "mac":
      return "macos";
    case "windows":
    case "linux":
      return os;
    default:
      return "unknown";
  }
}

/**
 * Find's rows (M19, M49): the model's searchable facts plus this window's
 * native session id and mirror clocks. No view reads this adapter. It carries
 * exactly what Find reads, with no fabricated terminal, pane or Core state.
 * A peer keeps its established search surface (M9): no local account or
 * transcript join. Only rosetta searches transcripts, through HistoryPort.
 *
 * P2 (the Peek's Live now): each row also says where it runs (`desk`, the
 * model's own desktop) and, for this desktop's runs, the floor session its
 * terminal is (`floorSessionId`, the board's join) — what the live peek
 * watches and Jump to reveals. A peer's row names no floor session here.
 */
interface CachedFindAgent {
  readonly floorSessionId: string | undefined;
  readonly nativeSessionId: string | undefined;
  readonly observed: boolean;
  readonly statusSince: string | undefined;
  readonly startedAt: string | undefined;
  readonly lastEvidenceAt: string | undefined;
  readonly row: LiveFindAgent;
}

/** One cache per window. Model rows are immutable; local clocks are compared
 * separately because chrome facts can move without that model row changing. */
export function createFindAgents(): (
  agents: readonly AgentView[],
  runByRow: ReadonlyMap<string, string>,
  runs: readonly ChromeRun[],
  sessionByRow?: ReadonlyMap<string, string>,
) => readonly LiveFindAgent[] {
  const cached = new WeakMap<AgentView, CachedFindAgent>();
  let last: readonly LiveFindAgent[] = Object.freeze([]);
  return (agents, runByRow, runs, sessionByRow) => {
    const byRun = new Map(runs.map((run) => [run.runtimeRunId, run] as const));
    const next = agents.map((row): LiveFindAgent => {
      const runId = row.kind === "agent" && row.device.self ? runByRow.get(row.id) : undefined;
      const run = runId === undefined ? undefined : byRun.get(runId);
      const local = run?.local;
      const mirror = local?.mirror;
      const nativeSessionId = local?.nativeSessionId;
      const observed = mirror !== undefined;
      const statusSince = observed ? run?.statusSince : undefined;
      const startedAt = mirror?.startedAt;
      const lastEvidenceAt = mirror?.lastEvidenceAt;
      const floorSessionId = row.device.self ? sessionByRow?.get(row.id) : undefined;
      const held = cached.get(row);
      if (
        held !== undefined &&
        held.floorSessionId === floorSessionId &&
        held.nativeSessionId === nativeSessionId &&
        held.observed === observed &&
        held.statusSince === statusSince &&
        held.startedAt === startedAt &&
        held.lastEvidenceAt === lastEvidenceAt
      ) {
        return held.row;
      }
      const made: LiveFindAgent = {
        id: row.id,
        createdAtMs: row.createdAt,
        status: row.status,
        project: projectName(row),
        detail: detailLine(row),
        color: row.colour,
        desk: {
          id: row.device.id,
          name: row.device.name,
          os: deskOs(row.device.os),
          self: row.device.self,
        },
        ...(floorSessionId !== undefined && floorSessionId !== "" ? { floorSessionId } : {}),
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
        floorSessionId,
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
