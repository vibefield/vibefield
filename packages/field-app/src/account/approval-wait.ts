import {
  connectAskMoment,
  connectAskOpen,
  type SetupLedger,
  type SetupMomentKey,
} from "@vibefield/contracts/setup";

// TS-4b (track TS, TS-D7; TS-D20 ruled A 2026-10-29; DESIGN.md §8 "Asking
// again") — the approval-after moment: when an approval this Mac's agent asked
// for waited more than ten minutes, the line says so as the wait clears, and
// offers the devices that could have answered it. It is a nudge: said at most
// once per 30 days, never two places in a day (`connectAskOpen`), only to
// someone who put Devices off, never once the switch is off, and each saying
// is written `connect-ask:approval-wait` asked.

export const APPROVAL_WAIT = {
  /** a wait longer than this is worth a line (DESIGN.md §8: "more than ten minutes") */
  LONG_MS: 10 * 60_000,
} as const;

export const APPROVAL_WAIT_MOMENT: SetupMomentKey = connectAskMoment("approval-wait");

/** The model row's facts the moment reads (the views' `MonitorAgentRow`, narrowed). */
export interface ApprovalWaitRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly statusSince: number;
  readonly alive: boolean;
  readonly wait?: { readonly kind: string; readonly since: number } | undefined;
  readonly device: { readonly self: boolean };
  readonly project: { readonly name: string };
  readonly provider?: { readonly id: string; readonly label: string } | undefined;
}

/** A wait that cleared: whose it was, and how long it lasted. */
export interface ApprovalWaitFact {
  readonly rowId: string;
  /** the row's `statusSince` as the wait cleared: the line stands until it moves */
  readonly clearedAt: number;
  readonly waitedMs: number;
  readonly project: string;
  readonly provider?: { readonly id: string; readonly label: string } | undefined;
}

function waitingOnApproval(row: ApprovalWaitRow): boolean {
  return row.status === "blocked" && row.wait?.kind === "permission";
}

/** The window's watch over its rows. It remembers each approval it sees an
 * agent of this Mac's waiting on, and answers the ones that cleared between
 * two reads after more than ten minutes, timed by the backend's own clocks (the
 * wait's start, and the next state's), never the window's. A wait it never saw
 * waiting says nothing, so the first read after a launch is never the moment;
 * a run that ended while it waited said no answer, and says nothing either. */
export class ApprovalWaits {
  /** row id → the start of the approval wait it was last seen on */
  private readonly waiting = new Map<string, number>();

  observe(rows: readonly ApprovalWaitRow[]): ApprovalWaitFact[] {
    const cleared: ApprovalWaitFact[] = [];
    const present = new Set<string>();
    for (const row of rows) {
      if (row.kind !== "agent" || !row.device.self) continue;
      present.add(row.id);
      const since = this.waiting.get(row.id);
      const now = waitingOnApproval(row) ? row.wait?.since : undefined;
      if (since !== undefined && now !== since) {
        this.waiting.delete(row.id);
        if (row.alive) {
          // answered: the next state began when the wait ended — a new wait's
          // own start, or the row's new status
          const end =
            row.status === "blocked" ? (row.wait?.since ?? row.statusSince) : row.statusSince;
          const waitedMs = end - since;
          if (waitedMs > APPROVAL_WAIT.LONG_MS) {
            cleared.push({
              rowId: row.id,
              clearedAt: row.statusSince,
              waitedMs,
              project: row.project.name,
              ...(row.provider === undefined ? {} : { provider: row.provider }),
            });
          }
        }
      }
      if (now !== undefined) this.waiting.set(row.id, now);
    }
    // a row gone from the model ended with its wait unanswered here
    for (const id of [...this.waiting.keys()]) if (!present.has(id)) this.waiting.delete(id);
    return cleared.sort((a, b) => b.waitedMs - a.waitedMs);
  }
}

/** Whether the approval line may be said now: this Mac is in the ordinary
 * unconnected state, the switch is read and on, and the ledger is read and its
 * place open. Never a guess: an unread switch or ledger says nothing. */
export function approvalWaitOpen(input: {
  readonly offersConnect: boolean;
  readonly asksOn: boolean | null;
  readonly ledger: SetupLedger | null;
  readonly now: number;
}): boolean {
  if (!input.offersConnect || input.asksOn !== true || input.ledger === null) return false;
  return connectAskOpen(input.ledger, "approval-wait", input.now);
}

/** The line still stands: its row is present and has not moved since it cleared. */
export function approvalWaitStands(
  fact: ApprovalWaitFact,
  rows: readonly Pick<ApprovalWaitRow, "id" | "statusSince">[],
): boolean {
  return rows.some((row) => row.id === fact.rowId && row.statusSince === fact.clearedAt);
}
