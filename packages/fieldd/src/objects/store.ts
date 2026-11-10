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
import { type GrantMarks, GrantsFile } from "./grants-file";

// OB-3a (thinking-objects-at-work.md §5.6; OB-L1, EY-D9 B) — the desk's registry and grants on disk, signed by fieldd's
// one record signer under one key per user root. Two things are kept:
//  - an object's NAME: one `ObjectRecord` per object, its file named by its ref's eight characters, 0600 in a 0700
//    directory (LAYOUT.OBJECTS_DIR). A name grants nothing (OB-L1); a record that is unsigned, does not verify, does not
//    parse, is exposed to other users, or names another ref than its file does is still set aside for a human and
//    never served, because a ref pointed at another object would carry what was handed for the first one there.
//  - every GRANT, in the one grants file beside that directory (LAYOUT.OBJECTS_GRANTS_FILE; grants-file.ts, OB custody
//    C4 and C5). A grant is what lets a run work an object, so that file is held to more: a count that only rises, and
//    a take-back that always takes.
// The key (OB custody, C4): at custody's `files` level it is LAYOUT.OBJECTS_KEY_FILE, 0600 to the same uid, so the
// signature holds against an edit and is no wall against an agent that reads the key (EL7). At `sealed` the spawner
// hands the key (`CustodyHandoff.records`): it is on no disk, the key file is never read or made, and the grants file
// says so. A fieldd at `files` that finds a sealed grants file moves nothing, not one name: the store refuses.
// Read once, at boot (the needs-you store's rule, item 172).

const REF_PREFIX = "vf:obj/";

export interface ObjectsStoreOptions {
  /** LAYOUT.OBJECTS_DIR, absolute */
  readonly dir: string;
  /** LAYOUT.OBJECTS_KEY_FILE, absolute: the `files` level's key. Never read and never made when `key` is handed. */
  readonly keyPath: string;
  /** LAYOUT.OBJECTS_GRANTS_FILE, absolute. Absent (a test's store), it is the file that row names: beside `dir`. */
  readonly grantsPath?: string | undefined;
  /** OB custody (C4) — the record key the spawner handed (`CustodyHandoff.records`, its 32 bytes): the store is at the
   * `sealed` level. Absent, it is at `files` and the key is `keyPath`'s. */
  readonly key?: Buffer | undefined;
  /** who outlives fieldd and remembers the grants' count (fieldd's `CustodyMarks`). Absent (a test's store), the count
   * is remembered here and dies with the store. */
  readonly marks?: GrantMarks | undefined;
  readonly logger?: Logger | undefined;
  /** the record file's read, a seam for a disk that does not answer (tests) */
  readonly readFile?: ((path: string) => string) | undefined;
  /** the grants file's write, a seam for a disk that will not take it (tests) */
  readonly writeFile?: ((path: string, text: string) => void) | undefined;
  /** how long a take-back the disk would not take waits before it is written again (tests) */
  readonly retryMs?: number | undefined;
  /** how long an answer waits on a survivor of the count (tests) */
  readonly noteMs?: number | undefined;
}

/** A count nobody outlives fieldd to remember: what a store is given when it is handed no marks. */
function ownMarks(): GrantMarks {
  const kept = new Map<string, number>();
  return {
    get: (name) => kept.get(name) ?? 0,
    note: async (name, value) => {
      const next = Math.max(kept.get(name) ?? 0, value);
      kept.set(name, next);
      return next;
    },
  };
}

export class ObjectsStore {
  /** every grant: the one grants file, under this store's signer and guard */
  readonly grants: GrantsFile;
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
      key: opts.key,
      logger: this.#logger,
      readFile: opts.readFile,
    });
    this.grants = new GrantsFile({
      path: opts.grantsPath ?? `${opts.dir}.grants.json`,
      signer: this.#signer,
      guard: this.#guard,
      sealed: opts.key !== undefined,
      marks: opts.marks ?? ownMarks(),
      logger: this.#logger,
      writeFile: opts.writeFile,
      retryMs: opts.retryMs,
      noteMs: opts.noteMs,
    });
  }

  /** The boot's one read: never throws. The grants file is read FIRST, before any name, at either level: a sealed one
   * this fieldd was handed no key for stops the read there, with nothing moved, and a sealed store whose path is empty
   * writes its file there before a name is read. A store it could not read answers nothing, says so, and refuses
   * every read and write after (`readable`), until fieldd restarts. */
  boot(): ObjectRecord[] {
    const read = (): ObjectRecord[] => {
      this.grants.boot();
      return this.list();
    };
    const records = this.#guard.boot(read, []);
    // a grant on an object the store does not name (its record set aside, or a store that could not be read) is
    // nobody's
    const named = new Set<string>(records.map((record) => record.ref));
    this.grants.keepOnly((ref) => named.has(ref));
    return records;
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

  /** Keep a name whole and signed: written beside, then renamed, 0600 in 0700. Throws when it cannot be kept. A
   * `grants` list a record carried before the grants left for their own file is not written back. A sealed store
   * first sees that its grants file is there (`GrantsFile.ensure`): no name of its is left without the one file that
   * tells a fieldd with no key to keep off. */
  write(record: ObjectRecord): void {
    this.#guard.writable(record.ref);
    this.grants.ensure();
    const parsed = ObjectRecord.parse(record) as ObjectRecord & { signature?: string };
    const { signature: _previous, grants: _moved, ...unsigned } = parsed;
    const signature = this.#signer.sign(unsigned);
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.dir, 0o700);
    const path = join(this.opts.dir, `${record.ref.slice(REF_PREFIX.length)}.json`);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ ...unsigned, signature })}\n`, { mode: 0o600 });
    durableRenameSync(temp, path);
  }

  /** Stop the store's timer (a take-back the disk would not take is written again on one). */
  close(): void {
    this.grants.close();
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
