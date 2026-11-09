import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OBJECT_RECORD_FORMAT, ObjectRecord, ObjectRef, RECORD_STORES } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import {
  RecordSigner,
  recordsUnreadable,
  type SetAsideWhy,
  StoreGuard,
  setAsideFile,
  UNREADABLE_WORDS,
} from "../signed-record";

// OB-3a (thinking-objects-at-work.md §5.6; OB-L1, EY-D9 B) — the desk's registry and grants on disk: one `ObjectRecord`
// per object, its file named by its ref's eight characters, 0600 in a 0700 directory per user root (LAYOUT.OBJECTS_DIR),
// each signed by fieldd's one record signer under a key of its own (LAYOUT.OBJECTS_KEY_FILE). A grant is what lets a
// run work an object, so a same-uid agent that wrote or edited a record could hand itself the person's work. A file that
// is unsigned, does not verify, does not parse, is exposed to other users, or names another ref than its file does is
// set aside for a human and never served. That holds against an edit; it is no wall against an agent that reads the key,
// which is 0600 to the same uid, as the sparks' is (EL7). Read once, at boot (the needs-you store's rule, item 172).

const REF_PREFIX = "vf:obj/";

export interface ObjectsStoreOptions {
  /** LAYOUT.OBJECTS_DIR, absolute */
  readonly dir: string;
  /** LAYOUT.OBJECTS_KEY_FILE, absolute */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  /** the record file's read, a seam for a disk that does not answer (tests) */
  readonly readFile?: ((path: string) => string) | undefined;
}

export class ObjectsStore {
  readonly #signer: RecordSigner;
  readonly #guard: StoreGuard;
  readonly #logger: Logger;

  constructor(private readonly opts: ObjectsStoreOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#guard = new StoreGuard({
      store: "objects",
      format: OBJECT_RECORD_FORMAT,
      refusal: () =>
        recordsUnreadable(RECORD_STORES.SERVICE_OBJECTS, UNREADABLE_WORDS.objects, false),
      logger: this.#logger,
    });
    this.#signer = new RecordSigner({
      keyPath: opts.keyPath,
      logger: this.#logger,
      readFile: opts.readFile,
    });
  }

  /** The boot's one read: never throws. A store it could not read answers nothing, says so, and refuses every read and
   * write after (`readable`), until fieldd restarts. */
  boot(): ObjectRecord[] {
    return this.#guard.boot(() => this.list(), []);
  }

  /** Throws UNAVAILABLE {service: "objects"} in fieldd's words while the boot read has failed. */
  readable(): void {
    this.#guard.check();
  }

  /** Every record that verifies. Throws the store's refusal when its folder or a record cannot be read. */
  list(): ObjectRecord[] {
    return this.#guard.entries(this.opts.dir).flatMap((entry) => {
      if (!entry.name.endsWith(".json")) return [];
      const id = entry.name.slice(0, -".json".length);
      if (!ObjectRef.safeParse(`${REF_PREFIX}${id}`).success) return [];
      const record = this.#read(join(this.opts.dir, entry.name), id);
      return record ? [record] : [];
    });
  }

  /** Keep a record whole and signed: written beside, then renamed, 0600 in 0700. Throws when it cannot be kept, so
   * nothing is granted that a restart would not find. */
  write(record: ObjectRecord): void {
    this.#guard.writable(record.ref);
    const { signature: _previous, ...unsigned } = ObjectRecord.parse(record) as ObjectRecord & {
      signature?: string;
    };
    const signature = this.#signer.sign(unsigned);
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.dir, 0o700);
    const path = join(this.opts.dir, `${record.ref.slice(REF_PREFIX.length)}.json`);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ ...unsigned, signature })}\n`, { mode: 0o600 });
    durableRenameSync(temp, path);
  }

  #read(path: string, id: string): ObjectRecord | undefined {
    const read = this.#signer.read(path);
    if ("why" in read) return this.#setAside(path, read.why);
    if ("unavailable" in read) return this.#guard.unavailable(path, read.unavailable);
    if ("absent" in read) return undefined;
    if (this.#guard.newer(`${REF_PREFIX}${id}`, path, read.body)) return undefined;
    const parsed = ObjectRecord.safeParse(read.body);
    if (!parsed.success) return this.#setAside(path, "unreadable");
    // signed for another object: a record copied into this ref's name
    if (parsed.data.ref !== `${REF_PREFIX}${id}`) return this.#setAside(path, "forged");
    return parsed.data;
  }

  #setAside(path: string, why: SetAsideWhy): undefined {
    const aside = setAsideFile(path, why);
    this.#logger.warn(
      "fieldd.objects.set_aside",
      `A desk object's record is ${why}; set aside, never served`,
      { file: basename(path), why, aside: basename(aside) },
    );
    return undefined;
  }
}
