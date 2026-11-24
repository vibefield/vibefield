import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentMonitorMirror, AgentSessionCarried } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";

// PF-21 (2026-11-23) — THE RUN LEDGER: what each run has run and used so far.
//
// Three things made a session's clock and its spend begin again at nothing:
//   · a resumed run is a NEW run in a new terminal (`agent.resume`), born now;
//   · the runtime counts a run's own LIVE usage alone: a resumed session's
//     history is replayed, never counted again (puppeteer core's rule);
//   · the monitor's totals live in memory for the daemon's lifetime (MV-D22).
// So after an app restart every resumed body in the swarm came back the same
// size, the spend view listed nothing, and no pane could say how long its
// session had run.
//
// This file is fieldd's answer, and it is small on purpose: per run, the time
// the session has been running and what it has used, each INCLUDING what the
// run itself carried in (`AgentSessionCarried`). The runtime writes a run's
// line twice a minute while it is alive, at its exit and at the daemon's stop;
// a resume reads the line of the run it continues, and a run met again after a
// fieldd restart reads its own. The monitor then adds a run's own live count to
// what it was handed (`MonitorHostRun.carried`, puppeteer 0.4.12).
//
// Figures to draw and nothing to act on (as the last-board picture is): the
// file is unsigned, parsed tolerantly, and a line that is no figure is left
// out. A lost or unreadable ledger costs the figures and nothing else.

/** One run's line: the session's totals as of `asOf`, the run's carried figures included. */
export interface RunTotals {
  /** how long the session has been running, ms */
  ranMs: number;
  /** estimated API-equivalent USD */
  usd?: number | undefined;
  /** how much of that work was priced (OPEN: `complete` · `partial`) */
  coverage?: string | undefined;
  tokens?: number | undefined;
  asOf: string;
}

/** How often a live run's line is written. A crash or a power cut costs at most this much of a clock. */
export const RUN_LEDGER_WRITE_MS = 30_000;

/** The most lines the file keeps; past it the oldest by `asOf` go. A run's line is about 120 bytes. */
export const RUN_LEDGER_MAX_RUNS = 4_000;

function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Two coverages as one: a floor when either is, whole when both are. An absent one says nothing. */
export function combineCoverage(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left === "complete" && right === "complete" ? "complete" : "partial";
}

/** What a run's own mirror has counted, in the ledger's words: nothing a mirror does not say. */
export function ownUsage(mirror: AgentMonitorMirror | undefined): {
  usd?: number;
  coverage?: string;
  tokens?: number;
} {
  const usage = mirror?.usage as
    | { costUsd?: unknown; costCoverage?: unknown; cumulativeTokens?: unknown }
    | undefined;
  const usd = amount(usage?.costUsd);
  const tokens = amount(usage?.cumulativeTokens);
  const coverage =
    typeof usage?.costCoverage === "string" && usage.costCoverage !== "unavailable"
      ? usage.costCoverage
      : undefined;
  return {
    ...(usd !== undefined ? { usd } : {}),
    // a price that reached none of the run's tokens leaves the whole a floor
    ...(usd !== undefined
      ? { coverage: coverage ?? "partial" }
      : tokens !== undefined && tokens > 0
        ? { coverage: "partial" }
        : {}),
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

/**
 * A run's totals at a moment: what it carried in, plus its own time since its birth and its own count. Pure.
 * `untilMs` is now for a live run and its end for an ended one.
 */
export function runTotals(input: {
  carried: AgentSessionCarried | undefined;
  createdAt: string;
  untilMs: number;
  own: { usd?: number; coverage?: string; tokens?: number };
}): Omit<RunTotals, "asOf"> {
  const { carried, own } = input;
  const born = Date.parse(input.createdAt);
  const ownMs = Number.isFinite(born) ? Math.max(0, Math.floor(input.untilMs - born)) : 0;
  const before = amount(carried?.ranMs) ?? 0;
  const carriedUsd = amount(carried?.usd);
  const carriedTokens = amount(carried?.tokens);
  const usd =
    carriedUsd === undefined && own.usd === undefined
      ? undefined
      : (carriedUsd ?? 0) + (own.usd ?? 0);
  const tokens =
    carriedTokens === undefined && own.tokens === undefined
      ? undefined
      : (carriedTokens ?? 0) + (own.tokens ?? 0);
  const coverage =
    usd === undefined
      ? undefined
      : combineCoverage(
          carriedUsd === undefined ? undefined : (carried?.coverage ?? "complete"),
          own.coverage,
        );
  return {
    ranMs: Math.floor(before) + ownMs,
    ...(usd !== undefined ? { usd } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

/**
 * What a record alone can say of the whole time its session ran, when the ledger holds no line for it (a run from
 * before PF-21, a ledger that was lost): its carried time plus birth to exit, for an exit fieldd SAW. An exit
 * stamped `unknown` was stamped by a later boot at that boot's own time, which is no end, so such a record says
 * nothing; so does one with no exit. Pure.
 */
export function recordedRanMs(record: {
  createdAt: string;
  carried?: AgentSessionCarried | undefined;
  exited?: { at: string; reason: string } | undefined;
}): number | undefined {
  const exited = record.exited;
  if (exited === undefined || exited.reason === "unknown") return undefined;
  const born = Date.parse(record.createdAt);
  const ended = Date.parse(exited.at);
  if (!Number.isFinite(born) || !Number.isFinite(ended) || ended < born) return undefined;
  return Math.floor(amount(record.carried?.ranMs) ?? 0) + Math.floor(ended - born);
}

/** A line as what the run that continues it carries in. */
export function carriedFrom(totals: Omit<RunTotals, "asOf">): AgentSessionCarried {
  return {
    ranMs: totals.ranMs,
    ...(totals.usd !== undefined ? { usd: totals.usd } : {}),
    ...(totals.coverage !== undefined ? { coverage: totals.coverage } : {}),
    ...(totals.tokens !== undefined ? { tokens: totals.tokens } : {}),
  };
}

export interface RunLedgerOptions {
  /** `LAYOUT.AGENT_RUN_LEDGER_FILE`, resolved */
  path: string;
  now?: () => Date;
  logger?: Logger;
}

export class RunLedger {
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly runs = new Map<string, RunTotals>();
  private dirty = false;

  constructor(private readonly opts: RunLedgerOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
  }

  /** Read what the last daemon kept. An absent file is the common case; one that does not parse is said in the log
   * and read as empty, because a figure is never a reason to fail a boot. */
  load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.opts.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.unreadable(error);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { v?: unknown; runs?: unknown };
      if (parsed.v !== 1 || typeof parsed.runs !== "object" || parsed.runs === null) {
        throw new Error("not a version-1 run ledger");
      }
      for (const [runtimeRunId, value] of Object.entries(parsed.runs as Record<string, unknown>)) {
        const line = lineOf(value);
        if (line !== undefined && runtimeRunId !== "") this.runs.set(runtimeRunId, line);
      }
    } catch (error) {
      this.unreadable(error);
    }
  }

  /** A run's line, a copy; undefined when the ledger holds none. */
  read(runtimeRunId: string): RunTotals | undefined {
    const line = this.runs.get(runtimeRunId);
    return line === undefined ? undefined : { ...line };
  }

  /**
   * Take a run's totals. A clock never runs backward: a time under the line's own keeps the line's. A figure the
   * totals do not say keeps the line's, so a run whose mirror has gone quiet does not lose what it had counted.
   */
  note(runtimeRunId: string, totals: Omit<RunTotals, "asOf">): void {
    const ranMs = amount(totals.ranMs);
    if (runtimeRunId === "" || ranMs === undefined) return;
    const held = this.runs.get(runtimeRunId);
    const usd = amount(totals.usd) ?? held?.usd;
    const tokens = amount(totals.tokens) ?? held?.tokens;
    const coverage = totals.coverage ?? held?.coverage;
    const next: RunTotals = {
      ranMs: Math.max(Math.floor(ranMs), held?.ranMs ?? 0),
      ...(usd !== undefined ? { usd } : {}),
      ...(usd !== undefined && coverage !== undefined ? { coverage } : {}),
      ...(tokens !== undefined ? { tokens } : {}),
      asOf: this.now().toISOString(),
    };
    if (
      held !== undefined &&
      held.ranMs === next.ranMs &&
      held.usd === next.usd &&
      held.coverage === next.coverage &&
      held.tokens === next.tokens
    ) {
      return;
    }
    this.runs.set(runtimeRunId, next);
    this.dirty = true;
  }

  /** Drop a run's line (its record is gone: a deleted profile's, `forgetUnder`). */
  forget(runtimeRunId: string): void {
    if (this.runs.delete(runtimeRunId)) this.dirty = true;
  }

  /** Write the file when a line moved. Never throws: a ledger that cannot be written is said in the log, and the
   * lines stay in memory for the next try. */
  flush(): void {
    if (!this.dirty) return;
    try {
      this.bound();
      const runs: Record<string, RunTotals> = {};
      for (const [runtimeRunId, line] of this.runs) runs[runtimeRunId] = line;
      const path = this.opts.path;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${randomUUID()}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ v: 1, runs })}\n`, { mode: 0o600, flag: "wx" });
      durableRenameSync(tmp, path);
      if (process.platform !== "win32" && (statSync(path).mode & 0o777) !== 0o600) {
        chmodSync(path, 0o600);
      }
      this.dirty = false;
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.run_ledger_unwritten",
        "The run ledger could not be written",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /** How many lines the ledger holds. */
  get size(): number {
    return this.runs.size;
  }

  private bound(): void {
    const over = this.runs.size - RUN_LEDGER_MAX_RUNS;
    if (over <= 0) return;
    const oldest = [...this.runs.entries()]
      .sort((a, b) => (a[1].asOf < b[1].asOf ? -1 : a[1].asOf > b[1].asOf ? 1 : 0))
      .slice(0, over);
    for (const [runtimeRunId] of oldest) this.runs.delete(runtimeRunId);
  }

  private unreadable(error: unknown): void {
    this.logger.warn("fieldd.agents.run_ledger_unreadable", "The run ledger could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A stored line, read tolerantly: a line with no time is no line, and a figure that is no amount is left out. */
function lineOf(value: unknown): RunTotals | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const ranMs = amount(raw["ranMs"]);
  if (ranMs === undefined) return undefined;
  const usd = amount(raw["usd"]);
  const tokens = amount(raw["tokens"]);
  const coverage = typeof raw["coverage"] === "string" ? raw["coverage"] : undefined;
  return {
    ranMs: Math.floor(ranMs),
    ...(usd !== undefined ? { usd } : {}),
    ...(usd !== undefined && coverage !== undefined && coverage !== "" ? { coverage } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    asOf: typeof raw["asOf"] === "string" ? raw["asOf"] : "",
  };
}
