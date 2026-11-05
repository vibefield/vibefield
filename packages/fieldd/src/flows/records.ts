import { createHash, randomBytes } from "node:crypto";
import {
  FLOW_RECORD_FORMAT,
  type FlowApprovalRecord,
  type FlowHash,
  type FlowProposalId,
  type FlowProposalRecord,
  type FlowSlug,
  type NeedsItemId,
  type SparkId,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// CP-4a1 (step0-cp4.md §5.1 commit 4; CP4-Q18 (a)) — fieldd's own flow records under LAYOUT.FLOWS_DIR.
// CP-4a1 (red): a skeleton. Nothing is kept or read yet; each act answers what it would keep.

export interface FlowRecordsOptions {
  /** LAYOUT.FLOWS_DIR, absolute */
  readonly dir: string;
  /** LAYOUT.FLOWS_KEY_FILE, absolute */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  readonly now?: () => Date;
}

export interface FlowApproveOptions {
  /** the spark's proposal the approval came from */
  readonly proposal?: FlowProposalId | undefined;
  /** FLOW_APPROVERS, OPEN; `you` when absent */
  readonly by?: string | undefined;
}

export interface FlowProposeInput {
  readonly flow: FlowSlug;
  readonly bytes: Uint8Array;
  readonly spark: SparkId;
  readonly name?: string | undefined;
  readonly item?: NeedsItemId | undefined;
}

/** A version's name: the SHA-256 of its bytes, lowercase hex. */
export function flowHashOf(bytes: Uint8Array): FlowHash {
  return createHash("sha256").update(bytes).digest("hex");
}

export class FlowRecords {
  readonly #logger: Logger;
  readonly #now: () => Date;

  constructor(private readonly opts: FlowRecordsOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
  }

  /** A new proposal's id: fieldd's, never reused. */
  static mintProposalId(): FlowProposalId {
    return `fp-${randomBytes(8).toString("hex")}`;
  }

  /** Keep a version's bytes by their hash. CP-4a1 (red): nothing is kept. */
  keep(bytes: Uint8Array): FlowHash {
    return flowHashOf(bytes);
  }

  /** A kept version's bytes. CP-4a1 (red): none. */
  bytes(_hash: string): Buffer | undefined {
    return undefined;
  }

  /** Approve a version of a flow. CP-4a1 (red): the record is answered, never kept. */
  approve(flow: FlowSlug, bytes: Uint8Array, opts: FlowApproveOptions = {}): FlowApprovalRecord {
    return {
      format: FLOW_RECORD_FORMAT,
      flow,
      hash: flowHashOf(bytes),
      approvedAt: this.#now().toISOString(),
      by: opts.by ?? "you",
      ...(opts.proposal !== undefined ? { proposal: opts.proposal } : {}),
    };
  }

  /** A flow's standing approval. CP-4a1 (red): none. */
  approval(_flow: string): FlowApprovalRecord | undefined {
    return undefined;
  }

  /** Every standing approval. CP-4a1 (red): none. */
  approvals(): FlowApprovalRecord[] {
    return [];
  }

  /** Keep a spark's proposal. CP-4a1 (red): the record is answered, never kept. */
  propose(input: FlowProposeInput): FlowProposalRecord {
    return {
      format: FLOW_RECORD_FORMAT,
      id: FlowRecords.mintProposalId(),
      flow: input.flow,
      hash: flowHashOf(input.bytes),
      spark: input.spark,
      proposedAt: this.#now().toISOString(),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.item !== undefined ? { item: input.item } : {}),
    };
  }

  /** One proposal. CP-4a1 (red): none. */
  proposal(_id: string): FlowProposalRecord | undefined {
    return undefined;
  }

  /** Every proposal, oldest first. CP-4a1 (red): none. */
  proposals(): FlowProposalRecord[] {
    return [];
  }

  /** Drop a proposal once its item is answered. CP-4a1 (red): nothing to drop. */
  dropProposal(_id: FlowProposalId): void {
    this.#logger.debug("fieldd.flows.drop_proposal", "nothing kept yet", { dir: this.opts.dir });
  }
}
