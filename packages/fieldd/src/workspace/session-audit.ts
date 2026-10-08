import type { Logger } from "@vibefield/logging";
import type { AuditService } from "../audit-service";
import type { AttachEndReason } from "./protocol";
import type { FilesHostSessionEvent } from "./supervisor";

// R6 (James, 2026-10-07: "all of the audit's fixes, plus the per-attach audit
// rows") — an attachment's life in the ledger, beside its mint. The mint is
// the window's act (`workspace.ticket.mint`, audited as the caller); what
// follows is fieldd's observation, written as the system actor the way the
// daemon's other observed acts are (AR-4's `requiredSystem`): one row when
// both legs are serving (`workspace.session.establish`), one when it ends
// (`workspace.session.end`, the cause as its reason code). The three share
// the mint's `sessionId` (the registration's `attachId`) and its target, the
// root; no path is recorded that the mint row does not record. The window is
// named by its token id, as the mint row's actor names it.
//
// An observation gates nothing: the session is live whatever the ledger
// could take, so a row that cannot be written is logged, and the audit
// service's own health and recovery markers say the ledger fell behind.

export const ATTACH_END_REASON_CODES: Readonly<Record<AttachEndReason, string>> = {
  closed: "CLOSED",
  "leg-closed": "LEG_CLOSED",
  "root-lost": "ROOT_LOST",
  "principal-revoked": "PRINCIPAL_REVOKED",
  "root-withdrawn": "ROOT_WITHDRAWN",
  "worker-stopped": "WORKER_STOPPED",
  "worker-exited": "WORKER_EXITED",
};

export class WorkspaceSessionAudit {
  readonly #audit: Pick<AuditService, "requiredSystem">;
  readonly #logger: Logger;
  readonly #writing = new Set<Promise<void>>();

  constructor(audit: Pick<AuditService, "requiredSystem">, logger: Logger) {
    this.#audit = audit;
    this.#logger = logger;
  }

  record(event: FilesHostSessionEvent): void {
    const reasonCode = event.event === "ended" ? ATTACH_END_REASON_CODES[event.reason] : undefined;
    const attrs = { clientId: event.clientId, generation: event.generation };
    const write = this.#audit
      .requiredSystem(
        {
          action:
            event.event === "established" ? "workspace.session.establish" : "workspace.session.end",
          target: { kind: "workspace-root", id: event.rootId },
          sessionId: event.attachId,
          ...(reasonCode !== undefined ? { reasonCode } : {}),
          attrs,
        },
        async () => undefined,
        () => ({
          outcome: "succeeded",
          ...(reasonCode !== undefined ? { reasonCode } : {}),
          attrs,
        }),
      )
      .catch((error: unknown) => {
        this.#logger.warn(
          "fieldd.workspace.session_unledgered",
          "An attachment's audit row could not be written",
          {
            event: event.event,
            ...(reasonCode !== undefined ? { reasonCode } : {}),
            error: error instanceof Error ? error.message : String(error),
          },
        );
      })
      .finally(() => {
        this.#writing.delete(write);
      });
    this.#writing.add(write);
  }

  /** Every row asked for so far, written (or given up): fieldd's stop awaits
   * this before the audit writer closes, so a session ended by the stop is in
   * the ledger. */
  async drain(): Promise<void> {
    while (this.#writing.size > 0) await Promise.allSettled([...this.#writing]);
  }
}
