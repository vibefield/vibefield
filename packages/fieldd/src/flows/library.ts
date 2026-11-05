import type { FlowEntry, FlowHash, FlowSlug } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { FlowRecords } from "./records";

// CP-4a1 (step0-cp4.md §5.1 commit 4; CP4-Q18 (a), CP4-Q5 (a)) — the person's library, LAYOUT.FLOWS_LIBRARY_DIR,
// read against fieldd's approvals. CP-4a1 (red): a skeleton; it lists and reads nothing yet.

export interface FlowLibraryOptions {
  /** LAYOUT.FLOWS_LIBRARY_DIR, absolute */
  readonly dir: string;
  /** where a flow's standing approval is read */
  readonly records: Pick<FlowRecords, "approval">;
  readonly logger?: Logger | undefined;
}

/** A library file as fieldd read it: its bytes and their hash, or (`tooBig`) its size alone, never read. */
export type FlowFile =
  | {
      readonly flow: FlowSlug;
      readonly size: number;
      readonly bytes: Buffer;
      readonly hash: FlowHash;
    }
  | { readonly flow: FlowSlug; readonly size: number; readonly tooBig: true };

export class FlowLibrary {
  readonly #logger: Logger;

  constructor(private readonly opts: FlowLibraryOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
  }

  /** Every flow in the library, by slug, against its approval. CP-4a1 (red): none. */
  list(): FlowEntry[] {
    this.#logger.debug("fieldd.flows.library", "nothing read yet", { dir: this.opts.dir });
    return [];
  }

  /** One flow's file. CP-4a1 (red): none. */
  read(_flow: string): FlowFile | undefined {
    return undefined;
  }
}
