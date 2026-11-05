import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  FLOW_LIMITS,
  FLOW_RECORD_FORMAT,
  FlowApprovalRecord,
  FlowHash,
  FlowJournalHead,
  type FlowJournalKnownLine,
  FlowProposalId,
  FlowProposalRecord,
  FlowRunId,
  FlowSlug,
  flowJournalLineOf,
  type NeedsItemId,
  RECORD_STORES,
  type SparkId,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import {
  RecordSigner,
  recordsUnreadable,
  type SetAsideWhy,
  StoreGuard,
  setAsideFile,
  UNREADABLE_WORDS,
} from "../signed-record";
import {
  type FlowJournalEntry,
  type FlowJournalHeadEntry,
  JOURNAL_SUFFIX,
  type JournalTail,
  type JournalVerdict,
  journalMacInput,
  RUNS_DIR,
  readJournal,
} from "./journal";

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
// that a restart would not find.
// - `runs/<run>.jsonl` (CP-4a2a; 4A2-Q10 (a)): each run's journal (journal.ts), its head written beside and renamed, each
//   line after it appended and fsynced before the call it names is handed on. A journal is read whole at each ask; one
//   whose line is not VibeField's is set aside as lost, never replayed (CP4-S15).
// Item 172 (DESIGN.md §9 "What VibeField keeps, when it cannot read it"): the approvals and proposals are its fifth
// store, read at each ask. A record the disk did not answer, or a folder it cannot list, is left where it is and refused
// UNAVAILABLE {service: RECORD_STORES.SERVICE_FLOWS} in fieldd's words, never read as nothing; a record a newer
// VibeField wrote is kept for it, never served, and a write over it is refused (StoreGuard). The bytes are no signed
// record: a version's file is judged by its hash.

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
  /** item 172 — a record file's read, a seam for a disk that does not answer (tests) */
  readonly readFile?: ((path: string) => string) | undefined;
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

/** A run's journal read back: what its lines say (journal.ts), or nothing kept under its id. A journal the disk did not
 * answer is refused in the store's words, never read as nothing (item 172). */
export type FlowRunRead = JournalVerdict | { readonly kind: "absent" };

export class FlowRecords {
  readonly #signer: RecordSigner;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #guard: StoreGuard;
  /** each run's journal's last line, as this store last wrote or read it, and where its whole lines end (bytes) */
  readonly #tails = new Map<string, JournalTail & { readonly bytes: number }>();

  constructor(private readonly opts: FlowRecordsOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
    this.#guard = new StoreGuard({
      store: "flows",
      format: FLOW_RECORD_FORMAT,
      // read at each ask, so a later ask may find the disk answering
      refusal: () => recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true),
      logger: this.#logger,
    });
    this.#signer = new RecordSigner({
      keyPath: opts.keyPath,
      logger: this.#logger,
      readFile: opts.readFile,
    });
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
   * SCRIPT_MAX_BYTES, and the store's refusal when the flow's approval cannot be read or a newer VibeField's holds it,
   * before anything is written. */
  approve(flow: FlowSlug, bytes: Uint8Array, opts: FlowApproveOptions = {}): FlowApprovalRecord {
    const slug = FlowSlug.parse(flow);
    if (bytes.byteLength > FLOW_LIMITS.SCRIPT_MAX_BYTES) refuseTooBig(bytes.byteLength);
    // item 172: never written over what could not be read, or what a newer VibeField kept
    this.approval(slug);
    this.#guard.writable(this.#key(APPROVALS_DIR, slug));
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

  /** A flow's standing approval, when it verifies; throws the store's refusal when it cannot be read. */
  approval(flow: string): FlowApprovalRecord | undefined {
    if (!FlowSlug.safeParse(flow).success) return undefined;
    const path = join(this.opts.dir, APPROVALS_DIR, `${flow}${RECORD_SUFFIX}`);
    return this.#readSigned(APPROVALS_DIR, path, flow, FlowApprovalRecord, (record) => record.flow);
  }

  /** Every standing approval that verifies, by its flow's slug; throws the store's refusal when its folder or an
   * approval cannot be read. */
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
    this.#guard.writable(this.#key(PROPOSALS_DIR, record.id));
    this.#writeSigned(PROPOSALS_DIR, record.id, record);
    return record;
  }

  /** One proposal, when it verifies; throws the store's refusal when it cannot be read. */
  proposal(id: string): FlowProposalRecord | undefined {
    if (!FlowProposalId.safeParse(id).success) return undefined;
    const path = join(this.opts.dir, PROPOSALS_DIR, `${id}${RECORD_SUFFIX}`);
    return this.#readSigned(PROPOSALS_DIR, path, id, FlowProposalRecord, (record) => record.id);
  }

  /** Every proposal that verifies, oldest first; throws the store's refusal when its folder or a proposal cannot be
   * read. */
  proposals(): FlowProposalRecord[] {
    return this.#names(PROPOSALS_DIR, FlowProposalId)
      .flatMap((id) => {
        const record = this.proposal(id);
        return record !== undefined ? [record] : [];
      })
      .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt) || a.id.localeCompare(b.id));
  }

  /** Drop a proposal once its item is answered. Its bytes stay kept: an approval of it names them. A proposal that
   * cannot be read, or a newer VibeField's, is left as it is (the read refuses, or serves nothing). */
  dropProposal(id: FlowProposalId): void {
    if (this.proposal(id) === undefined) return;
    this.#guard.writable(this.#key(PROPOSALS_DIR, id));
    rmSync(join(this.opts.dir, PROPOSALS_DIR, `${id}${RECORD_SUFFIX}`), { force: true });
  }

  /** CP-4a2a — begin a run's journal (CP4-S15): its head, the file's first line, signed and written beside then
   * renamed. A run's id is fieldd's and never reused: a journal already under it is refused, never written over. */
  beginRun(entry: FlowJournalHeadEntry): FlowJournalHead {
    const run = FlowRunId.parse(entry.run);
    const key = this.#key(RUNS_DIR, run);
    this.#guard.writable(key);
    const path = this.#journalPath(run);
    if (existsSync(path)) throw new Error(`a run's journal is already kept under ${run}`);
    const head = FlowJournalHead.parse({
      ...entry,
      format: FLOW_RECORD_FORMAT,
      seq: 1,
      kind: "head",
      at: this.#now().toISOString(),
    });
    const mac = this.#signer.sign(journalMacInput(run, "", head));
    const text = `${JSON.stringify({ ...head, mac })}\n`;
    this.#write(this.#dir(RUNS_DIR), `${run}${JOURNAL_SUFFIX}`, text);
    this.#tails.set(run, { seq: 1, mac, bytes: Buffer.byteLength(text, "utf8") });
    return head;
  }

  /** CP-4a2a — append a line to a run's journal, chained to the one before it, and fsynced before this returns: a
   * call is journaled before it is handed on, so a restart finds it. Throws the store's refusal while the journal
   * cannot be read or a newer VibeField's holds it, and when the line is not one contracts' journal reads.
   * The line starts where the journal's whole lines end: a piece past them (a line the disk never finished, before a
   * crash) is dropped first, never glued to; a journal shorter than this store left it is refused, and the next read
   * sets it aside (bth's review P3). */
  appendRun(run: FlowRunId, entry: FlowJournalEntry): FlowJournalKnownLine {
    const tail = this.#tailOf(run);
    this.#guard.writable(this.#key(RUNS_DIR, run));
    const line = {
      ...entry,
      format: FLOW_RECORD_FORMAT,
      seq: tail.seq + 1,
      at: this.#now().toISOString(),
    };
    const known = flowJournalLineOf(line);
    if (known === undefined || known.kind === "head")
      throw new TypeError(`a ${entry.kind} line this journal cannot keep`);
    const mac = this.#signer.sign(journalMacInput(run, tail.mac, known));
    const text = `${JSON.stringify({ ...known, mac })}\n`;
    const fd = openSync(this.#journalPath(run), "a", 0o600);
    try {
      const size = fstatSync(fd).size;
      if (size < tail.bytes)
        throw new Error(`the journal under ${run} is shorter than fieldd left it`);
      if (size > tail.bytes) {
        ftruncateSync(fd, tail.bytes);
        this.#logger.warn(
          "fieldd.flows.journal_piece",
          "A run's journal held a piece past its last line; dropped before the next",
          { run, bytes: size - tail.bytes },
        );
      }
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.#tails.set(run, {
      seq: known.seq,
      mac,
      bytes: tail.bytes + Buffer.byteLength(text, "utf8"),
    });
    return known;
  }

  /** CP-4a2a — a run's journal read back (journal.ts): kept, every line verified; lost, its file set aside beside
   * itself and said; kept for a newer VibeField; or none under that id. A journal the disk did not answer, or a key
   * that cannot be read, is left where it is and refused in the store's words (item 172). */
  readRun(run: string): FlowRunRead {
    if (!FlowRunId.safeParse(run).success) return { kind: "absent" };
    const path = this.#journalPath(run);
    const text = this.#signer.readText(path);
    if (typeof text !== "string") {
      if ("absent" in text) return { kind: "absent" };
      if ("unavailable" in text) return this.#guard.unavailable(path, text.unavailable);
      this.#lost(run, path, text.why);
      return { kind: "lost", why: text.why, line: 1 };
    }
    let verdict: JournalVerdict;
    try {
      verdict = readJournal(
        text,
        run,
        (unsigned, mac) => this.#signer.verifies(unsigned, mac),
        FLOW_RECORD_FORMAT,
      );
    } catch (error) {
      // the key could not be read: the journal is not judged by it
      return this.#guard.unavailable(
        path,
        (error as NodeJS.ErrnoException).code ?? "key-unreadable",
      );
    }
    // the tail this store wrote or read is an anchor while it lives: a journal shorter than it was cut, never crashed
    const anchor = this.#tails.get(run);
    if (verdict.kind === "kept" && anchor !== undefined && verdict.tail.seq < anchor.seq) {
      this.#lost(run, path, "forged");
      return { kind: "lost", why: "forged", line: verdict.tail.seq + 1 };
    }
    if (verdict.kind === "kept") this.#tails.set(run, { ...verdict.tail, bytes: verdict.bytes });
    else if (verdict.kind === "lost") this.#lost(run, path, verdict.why);
    else this.#guard.newer(this.#key(RUNS_DIR, run), path, { format: verdict.format });
    return verdict;
  }

  /** CP-4a2a — the runs whose journals are kept and verify, sorted; each one that is not VibeField's is set aside as
   * it is read. A folder the disk cannot list is refused (item 172). */
  runs(): FlowRunId[] {
    return this.#guard
      .entries(join(this.opts.dir, RUNS_DIR))
      .map((entry) => entry.name)
      .filter((file) => file.endsWith(JOURNAL_SUFFIX))
      .map((file) => file.slice(0, -JOURNAL_SUFFIX.length))
      .filter((run) => FlowRunId.safeParse(run).success)
      .sort()
      .filter((run) => this.readRun(run).kind === "kept");
  }

  #journalPath(run: string): string {
    return join(this.opts.dir, RUNS_DIR, `${run}${JOURNAL_SUFFIX}`);
  }

  /** Where a run's journal stands, read from its file when this store has not written or read it yet. */
  #tailOf(run: FlowRunId): JournalTail & { readonly bytes: number } {
    const known = this.#tails.get(run);
    if (known !== undefined) return known;
    const read = this.readRun(run);
    if (read.kind === "kept") return { ...read.tail, bytes: read.bytes };
    // a newer VibeField's journal: its key is held now, and the store refuses the write
    this.#guard.writable(this.#key(RUNS_DIR, run));
    throw new Error(`no journal this VibeField keeps stands under ${run} (${read.kind})`);
  }

  #lost(run: string, path: string, why: SetAsideWhy): void {
    this.#tails.delete(run);
    this.#setAside(path, why);
  }

  /** The record names in one of the records' directories, sorted: a file that is no record's name is passed over. A
   * folder that is not there has none; one the disk cannot list is refused (item 172). */
  #names(sub: string, name: { safeParse: (value: string) => { success: boolean } }): string[] {
    return this.#guard
      .entries(join(this.opts.dir, sub))
      .map((entry) => entry.name)
      .filter((file) => file.endsWith(RECORD_SUFFIX))
      .map((file) => file.slice(0, -RECORD_SUFFIX.length))
      .filter((stem) => name.safeParse(stem).success)
      .sort();
  }

  /** A record's key in the store's guard: its directory and its name. */
  #key(sub: string, name: string): string {
    return `${sub}/${name}`;
  }

  /** A signed record read back: one that is exposed, unparseable, unsigned or forged, or that names another file than
   * its own is set aside; one the disk did not answer is left where it is and refused; one a newer VibeField wrote is
   * kept for it and not served (item 172). */
  #readSigned<T>(
    sub: string,
    path: string,
    name: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    nameOf: (record: T) => string,
  ): T | undefined {
    const read = this.#signer.read(path);
    if ("why" in read) return this.#setAside(path, read.why);
    if ("unavailable" in read) return this.#guard.unavailable(path, read.unavailable);
    if ("absent" in read) return undefined;
    if (this.#guard.newer(this.#key(sub, name), path, read.body)) return undefined;
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
