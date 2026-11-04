import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { NeedsItemId, NeedsRecord } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { RecordSigner, type SetAsideWhy, setAsideFile } from "../../../signed-record";

// CP-3 (cp3-the-person.md §5.1) — the needs-you queue's store: one `NeedsRecord` per item, its file named by the item's
// id, 0600 in a 0700 directory per user root (LAYOUT.NEEDS_DIR), each signed by fieldd's one record signer under a key
// of its own (LAYOUT.NEEDS_KEY_FILE). A record is what an Allow acts on (the held words, the launch) and what the person
// answered, so an agent that wrote or edited one could answer it, allow itself a session or put words in a spark's
// mouth. A file that is unsigned, does not verify, does not parse, is exposed to other users, or names another item than
// its file does (a record copied to another id) is set aside for a human and never served. That holds against an edit.
// It is no wall against an agent that reads the key, which is 0600 to the same uid as the sparks' is (EL7).

export interface NeedsStoreOptions {
  /** LAYOUT.NEEDS_DIR, absolute */
  readonly dir: string;
  /** LAYOUT.NEEDS_KEY_FILE, absolute */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
}

export class NeedsStore {
  readonly #signer: RecordSigner;
  readonly #logger: Logger;

  constructor(private readonly opts: NeedsStoreOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#signer = new RecordSigner({ keyPath: opts.keyPath, logger: this.#logger });
  }

  /** A new item's id: fieldd's, never reused. */
  static mintId(): NeedsItemId {
    return `ny-${randomBytes(8).toString("hex")}`;
  }

  /** A notify's id: an event's, never kept. */
  static noticeId(): string {
    return `nt-${randomBytes(8).toString("hex")}`;
  }

  /** Every record that verifies, oldest asked first. Read at boot: the queue holds them in memory after. */
  list(): NeedsRecord[] {
    if (!existsSync(this.opts.dir)) return [];
    return readdirSync(this.opts.dir)
      .flatMap((file) => {
        if (!file.endsWith(".json")) return [];
        const id = file.slice(0, -".json".length);
        if (!NeedsItemId.safeParse(id).success) return [];
        const record = this.#read(join(this.opts.dir, file), id);
        return record ? [record] : [];
      })
      .sort((a, b) => a.item.asked.localeCompare(b.item.asked));
  }

  /** Keep a record whole and signed: written beside, then renamed, 0600 in 0700. Throws when it cannot be kept, so
   * nothing is acted on that a restart would not find. */
  write(record: NeedsRecord): void {
    const { signature: _previous, ...unsigned } = NeedsRecord.parse(record) as NeedsRecord & {
      signature?: string;
    };
    const signature = this.#signer.sign(unsigned);
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.dir, 0o700);
    const path = this.#path(record.item.id);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ ...unsigned, signature })}\n`, { mode: 0o600 });
    durableRenameSync(temp, path);
  }

  remove(id: NeedsItemId): void {
    rmSync(this.#path(id), { force: true });
  }

  #path(id: NeedsItemId): string {
    return join(this.opts.dir, `${id}.json`);
  }

  #read(path: string, id: string): NeedsRecord | undefined {
    const read = this.#signer.read(path);
    if ("why" in read) return this.#setAside(path, read.why);
    const parsed = NeedsRecord.safeParse(read.body);
    if (!parsed.success) return this.#setAside(path, "unreadable");
    // signed for another item: a record copied into this id's name
    if (parsed.data.item.id !== id) return this.#setAside(path, "forged");
    return parsed.data;
  }

  #setAside(path: string, why: SetAsideWhy): undefined {
    const aside = setAsideFile(path, why);
    this.#logger.warn(
      "fieldd.needs.set_aside",
      `A needs-you record is ${why}; set aside, never served`,
      {
        file: basename(path),
        why,
        aside: basename(aside),
      },
    );
    return undefined;
  }
}
