import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  FLOW_FILE_SUFFIX,
  FLOW_LIBRARY_MAX,
  FLOW_LIMITS,
  type FlowEntry,
  type FlowEntryState,
  type FlowHash,
  FlowSlug,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { type FlowRecords, flowHashOf } from "./records";

// CP-4a1 (step0-cp4.md §5.1 commit 4; CP4-Q18 (a), CP4-Q5 (a)) — the person's library: one per user,
// LAYOUT.FLOWS_LIBRARY_DIR, `<slug>.flow.js` files that are theirs to write and edit, as a spark's home is. fieldd reads
// each against its standing approval (records.ts) and never runs one: a run takes the bytes fieldd kept when the
// person approved them. A file reads `approved` while its bytes are that version, `changed` when an approval stands for
// other bytes, `new` when none does (one an agent forged is set aside by the records and never counts), and `too-big`
// past SCRIPT_MAX_BYTES, its size alone, never read. Read on each ask: the library is the person's folder, edited
// while fieldd runs, so nothing is cached and nothing is watched here.
// - Only regular files whose names end FLOW_FILE_SUFFIX are flows (a link to one is followed, as the person's own
//   file); a name whose stem is no slug is passed over and said once in the log, so the person can rename it.
// - The library reads no script's meaning: what a row shows of it is the static read's (static-read.ts), which the
//   door that lists the library joins (CP-4a2).

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
  /** names already said in the log as passed over */
  readonly #said = new Set<string>();

  constructor(private readonly opts: FlowLibraryOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
  }

  /** Every flow in the library, by slug, against its approval (at most FLOW_LIBRARY_MAX, the first by slug). */
  list(): FlowEntry[] {
    return this.#slugs()
      .slice(0, FLOW_LIBRARY_MAX)
      .flatMap((flow) => {
        const file = this.read(flow);
        if (file === undefined) return [];
        const approved = this.opts.records.approval(flow)?.hash;
        const hash = "hash" in file ? file.hash : undefined;
        const state: FlowEntryState =
          hash === undefined
            ? "too-big"
            : approved === undefined
              ? "new"
              : approved === hash
                ? "approved"
                : "changed";
        return [
          {
            flow,
            ...(hash !== undefined ? { hash } : {}),
            ...(approved !== undefined ? { approved } : {}),
            state,
            bytes: file.size,
          },
        ];
      });
  }

  /** One flow's file: its bytes and their hash, or its size alone past SCRIPT_MAX_BYTES. Nothing for a name that is no
   * slug, or no regular file. */
  read(flow: string): FlowFile | undefined {
    if (!FlowSlug.safeParse(flow).success) return undefined;
    const path = join(this.opts.dir, `${flow}${FLOW_FILE_SUFFIX}`);
    let size: number;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return undefined;
      size = stat.size;
    } catch {
      // absent, or a link that leads nowhere
      return undefined;
    }
    if (size > FLOW_LIMITS.SCRIPT_MAX_BYTES) return { flow, size, tooBig: true };
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      this.#logger.warn("fieldd.flows.unreadable", "A flow in the library could not be read", {
        flow,
        code: (error as NodeJS.ErrnoException).code ?? "unknown",
      });
      return undefined;
    }
    // the file grew between the two reads: what was read is what is judged
    if (bytes.byteLength > FLOW_LIMITS.SCRIPT_MAX_BYTES)
      return { flow, size: bytes.byteLength, tooBig: true };
    return { flow, size: bytes.byteLength, bytes, hash: flowHashOf(bytes) };
  }

  /** The library's flow names, sorted; a name whose stem is no slug is said once and passed over. */
  #slugs(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.opts.dir);
    } catch {
      // no library yet: the person has written no flow
      return [];
    }
    const slugs: string[] = [];
    for (const name of names) {
      if (!name.endsWith(FLOW_FILE_SUFFIX)) continue;
      const stem = name.slice(0, -FLOW_FILE_SUFFIX.length);
      if (FlowSlug.safeParse(stem).success) {
        slugs.push(stem);
        continue;
      }
      if (this.#said.has(name)) continue;
      this.#said.add(name);
      this.#logger.warn(
        "fieldd.flows.passed_over",
        "A file in the flows library is not named as a flow (lowercase letters, digits and dashes); it is passed over",
        { file: name, why: "name" },
      );
    }
    return slugs.sort();
  }
}
