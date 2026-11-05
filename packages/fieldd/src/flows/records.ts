import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  FLOW_LIMITS,
  FLOW_RECORD_FORMAT,
  FlowApprovalRecord,
  FlowHash,
  FlowProposalId,
  FlowProposalRecord,
  FlowSlug,
  type NeedsItemId,
  type SparkId,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { RecordSigner, type SetAsideWhy, setAsideFile } from "../signed-record";

// CP-4a1 (step0-cp4.md §5.1 commit 4; CP4-Q18 (a), CP-D10) — fieldd's own flow records under LAYOUT.FLOWS_DIR. fieldd
// never runs a file in the person's library: it runs the bytes it kept when they approved them, so a run of a version
// is a run of exactly what they read.
// - `bytes/<hash>.flow.js`: each approved or proposed version's bytes, named by their SHA-256. They need no signature:
//   they are read back only while that hash is still their name, and set aside as forged when it is not, so an edit in
//   place is refused and a file nothing names is never run.
// - `approvals/<slug>.json`: a flow's standing approval, the version the person approved by its hash.
// - `proposals/<id>.json`: a spark's proposal, its bytes kept by their hash, until the person answers its item.
// Each record is one file signed by fieldd's one record signer under LAYOUT.FLOWS_KEY_FILE, its own name inside (the
// approval's `flow`, the proposal's `id`), so an approval an agent wrote or edited, or one copied to another flow's
// name, is set aside as forged and never served (docs/LANDED.md: a signature binds a file to its name only when the
// name is inside it). Every file is 0600 in a 0700 directory. That holds against an edit; it is no wall against an
// agent that reads the key, which is 0600 to the same uid, as the sparks' is (EL7).
// A write goes beside, then is renamed (durably), and throws when the disk does not take it, so nothing is acted on
// that a restart would not find. Each run's journal joins these under `runs/` with CP-4a2.

const BYTES_DIR = "bytes";
const APPROVALS_DIR = "approvals";
const PROPOSALS_DIR = "proposals";
const RECORD_SUFFIX = ".json";
const BYTES_SUFFIX = ".flow.js";

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

/** A script past FLOW_LIMITS.SCRIPT_MAX_BYTES, refused before anything is kept, in words a card can say. */
function refuseTooBig(size: number): never {
  throw new RangeError(
    `a flow's script is at most 64 KiB (${FLOW_LIMITS.SCRIPT_MAX_BYTES} bytes); this one is ${size} bytes`,
  );
}

export class FlowRecords {
  readonly #signer: RecordSigner;
  readonly #logger: Logger;
  readonly #now: () => Date;

  constructor(private readonly opts: FlowRecordsOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
    this.#signer = new RecordSigner({ keyPath: opts.keyPath, logger: this.#logger });
  }

  /** A new proposal's id: fieldd's, never reused. */
  static mintProposalId(): FlowProposalId {
    return `fp-${randomBytes(8).toString("hex")}`;
  }

  /** Keep a version's bytes by their hash, once: bytes already kept under it are left as they are. Throws past
   * SCRIPT_MAX_BYTES, before anything is written, and when the disk does not take them. */
  keep(bytes: Uint8Array): FlowHash {
    if (bytes.byteLength > FLOW_LIMITS.SCRIPT_MAX_BYTES) refuseTooBig(bytes.byteLength);
    const hash = flowHashOf(bytes);
    if (this.bytes(hash) !== undefined) return hash;
    this.#write(this.#dir(BYTES_DIR), `${hash}${BYTES_SUFFIX}`, bytes);
    return hash;
  }

  /** A kept version's bytes, while their hash is still their name: bytes edited in place are set aside as forged, and
   * a file too big to be one fieldd kept as unreadable. Nothing for a name that is no hash, or none kept. */
  bytes(hash: string): Buffer | undefined {
    if (!FlowHash.safeParse(hash).success) return undefined;
    const path = join(this.opts.dir, BYTES_DIR, `${hash}${BYTES_SUFFIX}`);
    if (!existsSync(path) || !statSync(path).isFile()) return undefined;
    if (statSync(path).size > FLOW_LIMITS.SCRIPT_MAX_BYTES)
      return this.#setAside(path, "unreadable");
    const bytes = readFileSync(path);
    if (flowHashOf(bytes) !== hash) return this.#setAside(path, "forged");
    return bytes;
  }

  /** Approve a version of a flow, as the person (CP-D10): its bytes kept, then its approval signed and written, in
   * place of the flow's last one, whose version's bytes stay kept. Throws for a name that is no slug or bytes past
   * SCRIPT_MAX_BYTES, before anything is written. */
  approve(flow: FlowSlug, bytes: Uint8Array, opts: FlowApproveOptions = {}): FlowApprovalRecord {
    const slug = FlowSlug.parse(flow);
    const record = FlowApprovalRecord.parse({
      format: FLOW_RECORD_FORMAT,
      flow: slug,
      hash: this.keep(bytes),
      approvedAt: this.#now().toISOString(),
      by: opts.by ?? "you",
      ...(opts.proposal !== undefined ? { proposal: opts.proposal } : {}),
    });
    this.#writeSigned(APPROVALS_DIR, slug, record);
    return record;
  }

  /** A flow's standing approval, when it verifies. */
  approval(flow: string): FlowApprovalRecord | undefined {
    if (!FlowSlug.safeParse(flow).success) return undefined;
    const path = join(this.opts.dir, APPROVALS_DIR, `${flow}${RECORD_SUFFIX}`);
    return this.#readSigned(path, flow, FlowApprovalRecord, (record) => record.flow);
  }

  /** Every standing approval that verifies, by its flow's slug. */
  approvals(): FlowApprovalRecord[] {
    return this.#names(APPROVALS_DIR, FlowSlug).flatMap((flow) => {
      const record = this.approval(flow);
      return record !== undefined ? [record] : [];
    });
  }

  /** Keep a spark's proposal (`flow_propose`, CP4-Q3 (a)): its bytes by their hash, then its record signed under a new
   * id. Throws for a name that is no slug or bytes past SCRIPT_MAX_BYTES, before anything is written. */
  propose(input: FlowProposeInput): FlowProposalRecord {
    const flow = FlowSlug.parse(input.flow);
    if (input.bytes.byteLength > FLOW_LIMITS.SCRIPT_MAX_BYTES) refuseTooBig(input.bytes.byteLength);
    const record = FlowProposalRecord.parse({
      format: FLOW_RECORD_FORMAT,
      id: FlowRecords.mintProposalId(),
      flow,
      hash: this.keep(input.bytes),
      spark: input.spark,
      proposedAt: this.#now().toISOString(),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.item !== undefined ? { item: input.item } : {}),
    });
    this.#writeSigned(PROPOSALS_DIR, record.id, record);
    return record;
  }

  /** One proposal, when it verifies. */
  proposal(id: string): FlowProposalRecord | undefined {
    if (!FlowProposalId.safeParse(id).success) return undefined;
    const path = join(this.opts.dir, PROPOSALS_DIR, `${id}${RECORD_SUFFIX}`);
    return this.#readSigned(path, id, FlowProposalRecord, (record) => record.id);
  }

  /** Every proposal that verifies, oldest first. */
  proposals(): FlowProposalRecord[] {
    return this.#names(PROPOSALS_DIR, FlowProposalId)
      .flatMap((id) => {
        const record = this.proposal(id);
        return record !== undefined ? [record] : [];
      })
      .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt) || a.id.localeCompare(b.id));
  }

  /** Drop a proposal once its item is answered. Its bytes stay kept: an approval of it names them. */
  dropProposal(id: FlowProposalId): void {
    if (this.proposal(id) === undefined) return;
    rmSync(join(this.opts.dir, PROPOSALS_DIR, `${id}${RECORD_SUFFIX}`), { force: true });
  }

  /** The record names in one of the records' directories, sorted: a file that is no record's name is passed over. */
  #names(sub: string, name: { safeParse: (value: string) => { success: boolean } }): string[] {
    const dir = join(this.opts.dir, sub);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith(RECORD_SUFFIX))
      .map((file) => file.slice(0, -RECORD_SUFFIX.length))
      .filter((stem) => name.safeParse(stem).success)
      .sort();
  }

  /** A signed record read back: one that is exposed, unparseable, unsigned or forged, of another format, or that names
   * another file than its own is set aside. */
  #readSigned<T>(
    path: string,
    name: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    nameOf: (record: T) => string,
  ): T | undefined {
    if (!existsSync(path) || !statSync(path).isFile()) return undefined;
    const read = this.#signer.read(path);
    if ("why" in read) return this.#setAside(path, read.why);
    const parsed = schema.safeParse(read.body);
    if (!parsed.success) return this.#setAside(path, "unreadable");
    // signed for another name: a record copied into this one's
    if (nameOf(parsed.data) !== name) return this.#setAside(path, "forged");
    return parsed.data;
  }

  /** Keep a record whole and signed under its name. */
  #writeSigned(sub: string, name: string, record: Record<string, unknown>): void {
    const { signature: _previous, ...unsigned } = record as Record<string, unknown> & {
      signature?: unknown;
    };
    const signature = this.#signer.sign(unsigned);
    this.#write(
      this.#dir(sub),
      `${name}${RECORD_SUFFIX}`,
      `${JSON.stringify({ ...unsigned, signature })}\n`,
    );
  }

  /** One of the records' directories, made 0700 under a 0700 FLOWS_DIR. */
  #dir(sub: string): string {
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.dir, 0o700);
    const dir = join(this.opts.dir, sub);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    return dir;
  }

  /** Written beside, then renamed, 0600. */
  #write(dir: string, file: string, data: Uint8Array | string): void {
    const path = join(dir, file);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, data, { mode: 0o600 });
    durableRenameSync(temp, path);
  }

  #setAside(path: string, why: SetAsideWhy): undefined {
    const aside = setAsideFile(path, why);
    this.#logger.warn(
      "fieldd.flows.set_aside",
      `A flow record is ${why}; set aside, never served`,
      { file: basename(path), why, aside: basename(aside) },
    );
    return undefined;
  }
}
