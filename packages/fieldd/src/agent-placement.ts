import type { AgentSessionRecord, TerminalInfo } from "@vibefield/contracts";

// AR-4b's CELL RULE, as both doors that act on a record's terminal read it
// (item 121, James A, 2026-10-31): the boot's re-attach (`attachRecord`) and
// `agent.resume`, which ends the old PTY before it births the new one. EL7: a
// record is a control input to an attach and to a terminate, so the daemon acts
// only on a PTY it can prove it spawned.
//
//  · a PTY on the agent cell is one by construction: only fieldd's agent
//    births land there;
//  · a PTY on another cell is one only when fieldd's own SIGNED record says
//    so. TC-D4's fallback lands an agent birth on the interactive cell while
//    no agent cell is up, and the birth stamps where it landed
//    (`AgentSessionPlacement`); the record must name THIS terminal, on exactly
//    that cell.
//
// Everything else — a shell of the person's, a record without a placement, one
// whose signature does not verify, one naming another terminal or another cell
// — is refused, as AR-4b refused it. A typed run (AR-7c) is not read here: it
// is trusted on its own proof (`agent-typed-run.ts`). Pure, so the two doors
// share one reading and its rows need no floor.

export type CellVerdict =
  | { admits: true; by: "agent-cell" | "placement" }
  | { admits: false; why: "unverified" | "no-placement" | "other-terminal" | "other-cell" };

export function cellAdmits(input: {
  record: Pick<AgentSessionRecord, "terminalSessionId" | "placement">;
  /** the record's signature verifies against this root's key */
  verified: boolean;
  /** the terminal the act would bind to, or end */
  terminalId: string;
  /** the floor's row for that terminal: its cell tag (TC-S3) */
  row: Pick<TerminalInfo, "cell">;
}): CellVerdict {
  const cell = input.row.cell;
  if (cell?.workloadClass === "agent") return { admits: true, by: "agent-cell" };
  if (!input.verified) return { admits: false, why: "unverified" };
  const placement = input.record.placement;
  if (placement === undefined) return { admits: false, why: "no-placement" };
  if (input.record.terminalSessionId !== input.terminalId)
    return { admits: false, why: "other-terminal" };
  if (
    cell === undefined ||
    cell.cellBootId !== placement.cellBootId ||
    cell.workloadClass !== placement.workloadClass
  )
    return { admits: false, why: "other-cell" };
  return { admits: true, by: "placement" };
}
