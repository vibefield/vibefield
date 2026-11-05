import {
  type AgentFieldRow,
  type NeedsItem,
  needsKindOf,
  type SparkId,
  type SparkSummary,
} from "@vibefield/contracts";
import { SPARK_NEEDS_YOU, type SparkStatus } from "@vibefield/design-kit/spark-face";

// CHAT'S READING OF A SPARK (SP-1b, CP-3; DESIGN.md §8 "Chat's list", §2.10; CH-D1, CH-D3, CH-D4, CP3-D7, CP3-D8).
// Pure: the sparks fieldd keeps (`compose.sparks.list`), the field board's rows (`agent.subscribe {projection:
// "field"}`) and the needs-you queue's open items (`needs.subscribe`) in, the list Chat draws out. A run is a spark's
// by the row's `spark` (its own session) or its `origin` (an agent it started); a row from a daemon before SP-1b
// carries neither and is simply no spark's. An item is a spark's by its `spark`. Only the statuses the board or the
// queue can certify are read here — the others arrive with the slices that report them, never from a guess. What its
// session is doing (awake, waiting on you in its terminal) is read from the session, never from the word, which an
// item's stands over.

/** One spark, as Chat's list and its cell draw it. */
export interface SparkEntry {
  readonly spark: SparkSummary;
  /** its own session's row, while the board shows one */
  readonly run: AgentFieldRow | null;
  readonly status: SparkStatus;
  /** S-4: Asking you, Needs your OK or Stuck (Rate limited has no signal yet) — its own run's blocker, or an item */
  readonly needsYou: boolean;
  /** Its session runs: its own run alive on the board, else its record says so. Asleep or not, the head's act (Jump to
   * or Wake) and whether Send wakes it first key on this, never on the word (an item's word stands over Asleep:
   * CP3-D7). */
  readonly awake: boolean;
  /** Its own run waits on you: a blocker on its own row (or the row blocked) while its session runs. *Amended at TH-1
   * (ER-C2):* this stopped Send, since a menu in its pane would read a paste as its answer; Send now queues, and the
   * queue delivers only at an idle with nothing blocking, so it says your receipt: "it lands after you answer". */
  readonly blocked: boolean;
  /** The needs-you queue's open items for it, oldest first (CP-3): its question, its held send or spawn, an ask from
   * an agent it started, and since TH-1 the ask of its own run (TH-Q29 (a)), which draws its card now the pane has
   * left Chat (`isOwnAsk`). */
  readonly items: readonly NeedsItem[];
  /** The runs that are its own session: the one its record names, and any the board says is its own. An agent's ask
   * from one of them is its own run's (`isOwnAsk`). */
  readonly ownRuns: readonly string[];
  /** The keys of what needs you, each a need of its own for the views track's note (a reading of CP3-D8): its own
   * run's blockers while it runs, then its items. Its own run's blocker and that run's item are one need, read once:
   * its key is the item's (TH-1; §8 "Chat's list"). */
  readonly needs: readonly string[];
  /** when it last did anything, as epoch ms: its own run, the agents it started, or its record */
  readonly activityAt: number;
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

/** The runs that are the spark's own session: the run its record names, and any the board says is its own. */
function ownRunsOf(spark: SparkSummary, rows: readonly AgentFieldRow[]): string[] {
  const own = new Set(rows.filter((row) => row.spark === spark.id).map((row) => row.runtimeRunId));
  if (spark.session !== undefined) own.add(spark.session.runtimeRunId);
  return [...own];
}

/** The spark's items in the queue, oldest first as fieldd lists them: those whose `spark` is it. *Amended at TH-1
 * (TH-Q29 (a); ER-C2):* the asks of its own run were left out here, since its row's blocker said them and the thread
 * was that run's pane. The pane left Chat, so its own ask is its item and draws its card, read once with the blocker
 * (`needsOf`). A question the spark asked itself (`ask_user`) is from its own run too, and was always its item. */
function sparkItemsOf(spark: SparkSummary, items: readonly NeedsItem[]): NeedsItem[] {
  return items.filter((item) => item.spark === spark.id);
}

/** An agent's ask from the spark's own run (TH-Q29 (a)): its card names the spark by its name, never its run's
 * title, and stands first at the foot (CO-Q12 (b)). */
export function isOwnAsk(entry: Pick<SparkEntry, "ownRuns">, item: NeedsItem): boolean {
  return (
    needsKindOf(item) === "agent-ask" &&
    item.from.session !== undefined &&
    entry.ownRuns.includes(item.from.session)
  );
}

/** An item's word (DESIGN.md §8 "Chat's list", the status): a question, its own or an agent's, is Asking you; a held
 * send, a held spawn, an agent's permission, or a kind this build does not know is Needs your OK — the need is real,
 * and that word is the safe one. */
export function statusOfItem(item: NeedsItem): SparkStatus {
  const kind = needsKindOf(item);
  return kind === "question" || (kind === "agent-ask" && item.ask === "question")
    ? "asking"
    : "approval";
}

/** Its session runs: its own run alive on the board, else its record says so. */
function awakeOf(spark: SparkSummary, own: AgentFieldRow | null): boolean {
  return own?.alive ?? spark.session?.live ?? false;
}

/** Its own row waits on someone: a blocker on it, or the row blocked with none named. */
function waitsOn(own: AgentFieldRow | null): own is AgentFieldRow {
  return own !== null && (own.blockers[0] !== undefined || own.status === "blocked");
}

const NO_ITEMS: readonly NeedsItem[] = Object.freeze([]);

/** The first that holds is the word (DESIGN.md §8 "Chat's list", the status as SP-1b reads it, as amended at CP-3).
 * `items` are the spark's own (`sparkItemsOf`), oldest first. */
export function sparkStatusOf(
  spark: SparkSummary,
  own: AgentFieldRow | null,
  agents: readonly AgentFieldRow[],
  items: readonly NeedsItem[] = NO_ITEMS,
): SparkStatus {
  const item = items[0];
  if (own === null && spark.session === undefined && item === undefined) return "hello";
  const awake = awakeOf(spark, own);
  // a blocker counts only while its session runs: a run that has stopped waits on no one
  if (awake && waitsOn(own)) {
    const blocker = own.blockers[0];
    if (blocker?.kind === "permission") return "approval";
    if (blocker?.kind === "question") return "asking";
    return "stuck";
  }
  // before Asleep: an answer wakes it (CP3-D7)
  if (item !== undefined) return statusOfItem(item);
  if (!awake) return "sleeping";
  if (agents.some((row) => row.alive && row.status === "working")) return "running";
  if (own?.status === "working") return "thinking";
  if (own?.status === "idle") return "ready";
  // live by its record, but its run has not been heard from yet
  return "hello";
}

/** The keys of what needs you (`SparkEntry.needs`): each blocker of its own run while it waits on you there (`blocked`:
 * that run, else null; the run itself when it is blocked with none named), then each item. A blocked run whose ask the
 * queue holds is that item, read once (TH-1): the item's key alone. */
function needsOf(blocked: AgentFieldRow | null, items: readonly NeedsItem[]): string[] {
  const queued =
    blocked !== null &&
    items.some(
      (item) => needsKindOf(item) === "agent-ask" && item.from.session === blocked.runtimeRunId,
    );
  const asks =
    blocked === null || queued
      ? []
      : blocked.blockers.length > 0
        ? blocked.blockers.map((blocker) => `${blocked.runtimeRunId}:${blocker.id}`)
        : [`${blocked.runtimeRunId}:blocked`];
  return [...asks, ...items.map((item) => item.id)];
}

/** What the window's feed reads beside the sparks and the board, for one reading. */
export interface BesideTheBoard {
  /** the needs-you queue's open items, oldest first (`needs.subscribe`); none: a reading with no queue */
  readonly items?: readonly NeedsItem[] | undefined;
}

/** Chat's list: one entry per spark, newest activity first (CH-D1), a tie by name. */
export function sparkEntriesOf(
  sparks: readonly SparkSummary[],
  rows: readonly AgentFieldRow[],
  { items = NO_ITEMS }: BesideTheBoard = {},
): SparkEntry[] {
  return sparks
    .map((spark): SparkEntry => {
      const run = ownRunOf(spark, rows);
      const agents = agentRunsOf(spark.id, rows);
      const mine = sparkItemsOf(spark, items);
      const status = sparkStatusOf(spark, run, agents, mine);
      const awake = awakeOf(spark, run);
      const blocked = awake && waitsOn(run);
      const times = [spark.updatedAt, ...[run, ...agents].map((row) => row && activityOf(row))];
      return {
        spark,
        run,
        status,
        needsYou: SPARK_NEEDS_YOU.has(status),
        awake,
        blocked,
        items: mine,
        ownRuns: ownRunsOf(spark, rows),
        needs: needsOf(blocked ? run : null, mine),
        activityAt: Math.max(...times.map((at) => (at ? timeOf(at) : 0))),
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
