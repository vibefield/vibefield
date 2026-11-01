import type { AgentFieldRow, SparkId, SparkSummary } from "@vibefield/contracts";
import { SPARK_NEEDS_YOU, type SparkStatus } from "@vibefield/design-kit/spark-face";

// CHAT'S READING OF A SPARK (SP-1b; DESIGN.md §8 "Chat's list", §2.10; CH-D1, CH-D3, CH-D4). Pure: the sparks
// fieldd keeps (`compose.sparks.list`) and the field board's rows (`agent.subscribe {projection: "field"}`) in, with
// the sparks the window's feed has seen have a turn, the list Chat draws out. A run is a spark's by the row's `spark` (its own session) or its `origin` (an agent it
// started); a row from a daemon before SP-1b carries neither and is simply no spark's. Only the statuses the board
// can certify are read here — the others arrive with the slices that report them, never from a guess.

/** One spark, as Chat's list and its cell draw it. */
export interface SparkEntry {
  readonly spark: SparkSummary;
  /** its own session's row, while the board shows one */
  readonly run: AgentFieldRow | null;
  readonly status: SparkStatus;
  /** S-4: Asking you, Needs your OK or Stuck (Rate limited has no signal yet) */
  readonly needsYou: boolean;
  /** when it last did anything, as epoch ms: its own run, the agents it started, or its record */
  readonly activityAt: number;
  /** It has had a turn, as far as this window has seen (DESIGN.md §8 "Chat's thread", how "new" is read): at work or
   * waiting on you, or its own run's tokens spent, on this reading or on any the window's feed made before it. The
   * board counts tokens only as they are spent live, so a run that reads its transcript back shows none until its
   * next live turn; a turn this window saw stays seen for the window's life whatever the board counts after it. That
   * life ends at a fieldd restart (main's boot fence replaces the document), and fieldd re-attaches only the runs a
   * restart left (as it boots, and in its G5 retries after), so a re-attached run is read by a window that has seen
   * none of its turns: DESIGN.md's open case. */
  readonly turnSeen: boolean;
}

/** The spark's own session on the board: the run its record names, else a live one, else the newest. */
export function ownRunOf(
  spark: SparkSummary,
  rows: readonly AgentFieldRow[],
): AgentFieldRow | null {
  const own = rows.filter((row) => row.spark === spark.id);
  const named = own.find((row) => row.runtimeRunId === spark.session?.runtimeRunId);
  if (named !== undefined) return named;
  const live = own.filter((row) => row.alive);
  const pool = live.length > 0 ? live : own;
  return pool.reduce<AgentFieldRow | null>(
    (newest, row) =>
      newest === null || timeOf(row.createdAt) > timeOf(newest.createdAt) ? row : newest,
    null,
  );
}

/** The runs the spark started (CP-D15's `origin`), which its face works with (CH-D3). */
export function agentRunsOf(spark: SparkId, rows: readonly AgentFieldRow[]): AgentFieldRow[] {
  return rows.filter((row) => row.origin?.by === "spark" && row.origin.spark === spark);
}

/** The first that holds is the word (DESIGN.md §8 "Chat's list", the status as SP-1b reads it). */
export function sparkStatusOf(
  spark: SparkSummary,
  own: AgentFieldRow | null,
  agents: readonly AgentFieldRow[],
): SparkStatus {
  if (own === null && spark.session === undefined) return "hello";
  const live = own?.alive ?? spark.session?.live ?? false;
  if (!live) return "sleeping";
  const blocker = own?.blockers[0];
  if (blocker !== undefined || own?.status === "blocked") {
    if (blocker?.kind === "permission") return "approval";
    if (blocker?.kind === "question") return "asking";
    return "stuck";
  }
  if (agents.some((row) => row.alive && row.status === "working")) return "running";
  if (own?.status === "working") return "thinking";
  if (own?.status === "idle") return "ready";
  // live by its record, but its run has not been heard from yet
  return "hello";
}

/** The statuses a spark has before its first turn: Hello, Ready, Asleep. Any other is at work or waiting on you. */
const UNSPOKEN: ReadonlySet<SparkStatus> = new Set(["hello", "ready", "sleeping"]);

/** The board shows a turn now: the spark at work or waiting on you, or its own run's tokens spent (a turn is a model's
 * answer, and every answer spends them). */
function turnShown(status: SparkStatus, own: AgentFieldRow | null): boolean {
  return !UNSPOKEN.has(status) || (own?.usage?.cumulativeTokens ?? 0) > 0;
}

const NO_TURNS: ReadonlySet<SparkId> = new Set();

/** Chat's list: one entry per spark, newest activity first (CH-D1), a tie by name. `turnsSeen` is the sparks the
 * window's feed has seen have a turn before this reading (none by default: a reading of the board alone). */
export function sparkEntriesOf(
  sparks: readonly SparkSummary[],
  rows: readonly AgentFieldRow[],
  turnsSeen: ReadonlySet<SparkId> = NO_TURNS,
): SparkEntry[] {
  return sparks
    .map((spark): SparkEntry => {
      const run = ownRunOf(spark, rows);
      const agents = agentRunsOf(spark.id, rows);
      const status = sparkStatusOf(spark, run, agents);
      const times = [spark.updatedAt, ...[run, ...agents].map((row) => row && activityOf(row))];
      return {
        spark,
        run,
        status,
        needsYou: SPARK_NEEDS_YOU.has(status),
        activityAt: Math.max(...times.map((at) => (at ? timeOf(at) : 0))),
        turnSeen: turnsSeen.has(spark.id) || turnShown(status, run),
      };
    })
    .sort((a, b) => b.activityAt - a.activityAt || a.spark.name.localeCompare(b.spark.name));
}

/** A row's time as the list says it: "now", a time today by the window's own clock ("9:41 AM"), a weekday this week
 * ("Tue"), else the date ("Oct 12"). */
export function activityWords(at: number, now: number, locale?: string): string {
  const ago = now - at;
  if (ago < 60_000) return "now";
  const when = new Date(at);
  const today = new Date(now);
  if (when.toDateString() === today.toDateString()) {
    return when.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  if (ago < 6 * 24 * 60 * 60_000) return when.toLocaleDateString(locale, { weekday: "short" });
  return when.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function activityOf(row: AgentFieldRow): string {
  return row.lastActivityAt ?? row.stateChangedAt;
}

function timeOf(at: string): number {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
}
