import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import {
  CUSTODY,
  OBJECT_GRANTS_FORMAT,
  type ObjectGrant,
  type ObjectGrantEntry,
  ObjectGrantsFile,
  type ObjectRef,
} from "@vibefield/contracts";
import { durableRenameSync, type Logger } from "@vibefield/logging";
import {
  type RecordSigner,
  type SetAsideWhy,
  type StoreGuard,
  setAsideFile,
} from "../signed-record";

// OB custody (C4, C5; OB-D18 A, OB-D19 A) — every grant, for one user root, in ONE file: `ObjectGrantsFile` at
// LAYOUT.OBJECTS_GRANTS_FILE, 0600, written beside and renamed, signed by the objects store's signer. A grant is what
// lets a run work the person's object. It used to sit in each object's record; one file makes a take-back one write,
// and lets an older state that was put back be seen:
//  - `generation` rises with every change, and whoever outlives fieldd is told the count (the mark
//    `CUSTODY.MARK_OBJECT_GRANTS`: the floor keeps it in memory, and the shell hands what it heard to the next fieldd).
//    A file below its mark is an older one put back: nothing in it is granted, it is set aside, and the count goes on
//    above the mark. A file AT its mark is not stale. The count never wraps: past what a number holds exactly, a change
//    cannot be written.
//  - A take-back always takes. What a change takes away is gone from memory before the disk is asked; what it gives is
//    in memory only once the disk holds it, so nothing is granted that a restart would not find. A removal the disk
//    will not take is closed the other way: the file is removed, the mark rises anyway, and the store writes again at
//    the next change and on a timer.
//  - Under custody's `sealed` level the key was handed, and the file says so. A fieldd at `files` cannot judge such a
//    file: it leaves it exactly where it is and the store refuses (the store's own refusal, until fieldd restarts),
//    names and all. A file too large for it to tell is left and refused the same way: wrong toward refusing is the
//    safe side. So that it can, a sealed store never leaves the path empty: it writes the file at boot, before any
//    name, and again before a name whenever the file is known to be gone.
// What this cannot hold against: with no VibeField process left to remember the mark, a whole older file put back is
// served. No store the user owns keeps a count the same user cannot put back.

/** The marks that outlive fieldd, as this store needs them: fieldd's `CustodyMarks` fits. */
export interface GrantMarks {
  /** fieldd's view of a mark now; 0 when it has none */
  get(name: string): number;
  /** raise it, and tell whoever outlives fieldd; answers what is kept */
  note(name: string, value: number): Promise<number>;
}

export interface GrantsFileOptions {
  /** LAYOUT.OBJECTS_GRANTS_FILE, absolute */
  readonly path: string;
  /** the objects store's signer and guard: one key, one refusal */
  readonly signer: RecordSigner;
  readonly guard: StoreGuard;
  /** the signer's key was handed: custody's `sealed` level */
  readonly sealed: boolean;
  readonly marks: GrantMarks;
  readonly logger: Logger;
  /** the file's write beside, a seam for a disk that will not take it (tests) */
  readonly writeFile?: ((path: string, text: string) => void) | undefined;
  /** how long a take-back the disk would not take waits before it is written again (tests) */
  readonly retryMs?: number | undefined;
  /** how long an answer waits on a survivor (tests) */
  readonly noteMs?: number | undefined;
}

const MARK = CUSTODY.MARK_OBJECT_GRANTS;
/** The guard's key for the one file: a newer VibeField's is held under it. */
const HELD_KEY = "grants";
/** How long an answer waits for a survivor to say it remembers the count. */
const NOTE_MS = 2_000;
const RETRY_MS = 5_000;
/** The most the peek for `sealed` reads. A grant is about a hundred bytes, so a real file is far below it; the signer's
 * own read has no bound to borrow. A file past it cannot be told, and is not judged at all. */
const PEEK_BYTES = 4 * 1024 * 1024;
/** The peek's open: read only, never through a link, and never waiting on something that is not a file. */
const PEEK_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

const same = (a: ObjectGrantEntry, b: ObjectGrantEntry): boolean =>
  a.ref === b.ref && a.holder === b.holder;

/** What an error said, as its code alone (`ENOSPC`, `EACCES`, `EISDIR`, …). A log line prints an error's code and
 * never its message: Node's file errors name the file's whole path, which holds the person's home. An error with no
 * code is `unknown`. */
export const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "unknown";
};

/** What a hand, a place or a grant throws when the store could not keep it: ONE fixed sentence and a code, and
 * nothing else of what the disk said (no field, no cause). What is thrown here travels, to the window and to an agent
 * when a tool call was behind the write, and Node's own message names the file's whole path. It is no typed refusal,
 * and no sentence a person is meant to read. */
export const unwritten = (code: string): Error =>
  new Error(`the desk objects could not be written (${code})`);

/** `work`, or a rejection once `ms` have passed: an error whose code is `timeout`. */
const within = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`no answer in ${ms} ms`), { code: "timeout" }));
    }, ms);
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export class GrantsFile {
  #grants: ObjectGrantEntry[] = [];
  #generation = 0;
  /** a take-back stands in memory that the file does not hold */
  #unkept = false;
  /** nothing of this store's is at the path: never there, set aside, or removed when a take-back was lost */
  #absent = false;
  #retry: ReturnType<typeof setTimeout> | undefined;
  /** every count told so far, answered or timed out */
  #told: Promise<void> = Promise.resolve();
  readonly #put: (path: string, text: string) => void;

  constructor(private readonly opts: GrantsFileOptions) {
    this.#put = opts.writeFile ?? ((path, text) => writeFileSync(path, text, { mode: 0o600 }));
  }

  /** The boot's one read, made inside the store's guarded boot and before any name is listed: for a file it must leave
   * where it is (a disk that did not answer, a sealed file this fieldd was handed no key for) it throws the store's
   * refusal. A sealed store that finds its path empty writes its file before it returns. */
  boot(): void {
    this.#grants = [];
    this.#generation = 0;
    this.#absent = false;
    const mark = this.#mark();
    const file = this.#read(mark);
    if (file === undefined) {
      this.ensure();
      return;
    }
    this.#grants = [...file.grants];
    this.#generation = file.generation;
    // a survivor that forgot (a floor that restarted) learns the count again
    if (file.generation > mark) this.#tell(file.generation);
  }

  /** What the file holds, when it is this store's to serve: nothing for one that is absent, set aside, stale or a
   * newer VibeField's. */
  #read(mark: number): ObjectGrantsFile | undefined {
    const { path, signer, guard } = this.opts;
    // Before the signer is asked anything: a fieldd at `files` does not judge what a handed key signed, whatever its
    // signature or mode says, and never moves it. Nor one it cannot tell about.
    const says = this.opts.sealed ? "plain" : this.#peek();
    if (says === "sealed") {
      this.opts.logger.error(
        "fieldd.objects.grants_sealed",
        "The grants file was sealed by a VibeField that was handed its key, and this one was not: it is left where it is, and the desk's objects refuse",
        undefined,
        { file: basename(path) },
      );
      return guard.unavailable(path, "sealed");
    }
    if (says === "untold") {
      this.opts.logger.error(
        "fieldd.objects.grants_unjudged",
        "The grants file is larger than fieldd reads to tell who sealed it: it is left where it is, and the desk's objects refuse",
        undefined,
        { file: basename(path), bound: PEEK_BYTES },
      );
      return guard.unavailable(path, "too-large");
    }
    const read = signer.read(path);
    if ("absent" in read) {
      this.#absent = true;
      return undefined;
    }
    if ("unavailable" in read) return guard.unavailable(path, read.unavailable);
    if ("why" in read) return this.#setAside(read.why);
    if (guard.newer(HELD_KEY, path, read.body)) return undefined;
    const parsed = ObjectGrantsFile.safeParse(read.body);
    if (!parsed.success) return this.#setAside("unreadable");
    // the belt: a sealed store only ever writes `sealed: true`, and the word is under the signature
    if (this.opts.sealed && parsed.data.sealed !== true) return this.#setAside("forged");
    if (parsed.data.generation < mark) return this.#stale(parsed.data.generation, mark);
    return parsed.data;
  }

  /** Whether the file holds what memory does: false from a take-back the disk would not take until a write lands. */
  get kept(): boolean {
    return !this.#unkept;
  }

  /** Every grant, in the file's order. */
  all(): readonly ObjectGrantEntry[] {
    return this.#grants;
  }

  /** Every grant on one object. */
  on(ref: ObjectRef): ObjectGrantEntry[] {
    return this.#grants.filter((grant) => grant.ref === ref);
  }

  of(ref: ObjectRef, holder: string): ObjectGrant | undefined {
    return this.#grants.find((grant) => grant.ref === ref && grant.holder === holder);
  }

  /** In memory only: a grant on an object the store does not name is nobody's. The next write leaves it out. */
  keepOnly(named: (ref: ObjectRef) => boolean): void {
    this.#grants = this.#grants.filter((grant) => named(grant.ref));
  }

  /** Give `entry`. Throws the store's refusal, or `unwritten` with the code of what the disk said: memory is unchanged
   * then. */
  give(entry: ObjectGrantEntry): void {
    this.opts.guard.writable(HELD_KEY);
    this.#change(() => false, entry);
  }

  /** End every grant `match` names; returns them. They are gone from memory whatever the disk then says. */
  take(match: (grant: ObjectGrantEntry) => boolean): ObjectGrantEntry[] {
    const taken = this.#grants.filter(match);
    this.#change(match);
    return taken;
  }

  /** OB-D9 — a `one` kind's hand, in one write: every other holder's grant on the object ends, and `entry` is given
   * unless its holder held the object already. Returns the holders it left. When the giving cannot be written it
   * throws, and what it took away stays taken. */
  move(entry: ObjectGrantEntry): string[] {
    this.opts.guard.writable(HELD_KEY);
    const others = (grant: ObjectGrantEntry): boolean =>
      grant.ref === entry.ref && grant.holder !== entry.holder;
    const left = this.#grants.filter(others).map((grant) => grant.holder);
    const held = this.of(entry.ref, entry.holder) !== undefined;
    this.#change(others, held ? undefined : entry);
    return left;
  }

  /** At `sealed`, the file is what tells a fieldd that was handed no key to leave this store alone, names and all. So a
   * sealed store never leaves the path empty: with nothing of its own there, it writes memory as it stands (nothing,
   * at a boot). It is no change: no new count, and nobody is told. Called at boot and before every name is written; a
   * write the disk will not take is said, refuses nothing, and is made again at the next change or name. */
  ensure(): void {
    if (!this.opts.sealed || !this.#absent || !this.opts.guard.keeps(HELD_KEY)) return;
    if (this.#rewrite() || this.#unkept) return;
    // a lost take-back has said so already (`#lost`); this is the file a boot could not write
    this.opts.logger.warn(
      "fieldd.objects.grants_unwritten",
      "The grants file could not be written; until it is, another VibeField that was handed no key would not know to leave this store alone",
      { file: basename(this.opts.path) },
    );
  }

  /** Once every count told so far has been answered, or its wait has run out. Never rejects: an answer waits on it. */
  settled(): Promise<void> {
    return this.#told;
  }

  /** Stop the timer a take-back the disk would not take is written again on. */
  close(): void {
    if (this.#retry !== undefined) clearTimeout(this.#retry);
    this.#retry = undefined;
  }

  /** fieldd's view of the mark. One that is not a count a number holds exactly reads as the top of what one does, so
   * nothing is ever counted past it. */
  #mark(): number {
    const mark = this.opts.marks.get(MARK);
    return Number.isSafeInteger(mark) ? mark : Number.MAX_SAFE_INTEGER;
  }

  /** One change: one count, one write. What it takes away leaves memory first; what it gives enters memory last. */
  #change(drop: (grant: ObjectGrantEntry) => boolean, add?: ObjectGrantEntry): void {
    const stay = this.#grants.filter((grant) => !drop(grant));
    const takes = stay.length < this.#grants.length;
    if (!takes && add === undefined) return;
    if (takes) this.#grants = stay;
    const generation = Math.max(this.#generation, this.#mark()) + 1;
    // The count never wraps, and is never written where a number does not hold it: at the top, a change cannot be
    // written. A hand is refused as one the disk would not take is, and a take-back still takes.
    if (!Number.isSafeInteger(generation)) {
      if (takes) this.#lost("count-full");
      if (add !== undefined) throw unwritten("count-full");
      return;
    }
    if (takes) this.#generation = generation;
    // what `add` replaces (the same holder, held another way) goes only once the new one is kept
    const next = add === undefined ? stay : [...stay.filter((grant) => !same(grant, add)), add];
    try {
      this.#keep(next, generation);
    } catch (error) {
      // what the key or the disk said goes no further than its code: to the log for a take-back, in the one fixed
      // sentence for a giving
      const code = codeOf(error);
      if (takes) this.#lost(code);
      if (add !== undefined) throw unwritten(code);
      return;
    }
    this.#grants = next;
    this.#generation = generation;
    this.#landed();
    this.#tell(generation);
  }

  /** The whole list at `generation`: signed, written beside, renamed. Throws what the key or the disk said. */
  #keep(grants: readonly ObjectGrantEntry[], generation: number): void {
    const { path } = this.opts;
    const body = { format: OBJECT_GRANTS_FORMAT, sealed: this.opts.sealed, generation, grants };
    const signature = this.opts.signer.sign(body);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    this.#put(temp, `${JSON.stringify({ ...body, signature })}\n`);
    durableRenameSync(temp, path);
  }

  /** Memory as it stands, written with no new count: at the count this store holds, or at the mark when a survivor
   * holds a higher one (below the mark the file would read as stale). False when the disk would not take it. */
  #rewrite(): boolean {
    const generation = Math.max(this.#generation, this.#mark());
    try {
      this.#keep(this.#grants, generation);
    } catch {
      return false;
    }
    this.#generation = generation;
    this.#landed();
    return true;
  }

  /** A take-back the disk would not take. It stands in memory. So that no restart finds it undone, the file goes (one
   * that cannot be removed is said), and the mark rises anyway: under it, a file left behind or put back reads stale.
   * `code` is why, as a code alone (`codeOf`): the error itself never reaches the log. */
  #lost(code: string): void {
    const { path } = this.opts;
    let removed = true;
    try {
      rmSync(path, { force: true });
    } catch {
      removed = false;
    }
    this.#unkept = true;
    this.#absent = removed;
    this.opts.logger.error(
      "fieldd.objects.grants_unkept",
      "A take-back could not be written. It stands; the grants file was removed so that no restart finds it undone, and fieldd writes again",
      undefined,
      { file: basename(path), code, generation: this.#generation, removed },
    );
    this.#tell(this.#generation);
    this.#later();
  }

  #later(): void {
    if (this.#retry !== undefined) return;
    const wait = this.opts.retryMs ?? RETRY_MS;
    this.#retry = setTimeout(() => {
      this.#retry = undefined;
      this.#again();
    }, wait);
    this.#retry.unref?.();
  }

  /** The timer's write: memory as it stands, at the count the survivors were already told. */
  #again(): void {
    if (!this.#unkept) return;
    if (!this.#rewrite()) {
      this.#later();
      return;
    }
    this.opts.logger.info(
      "fieldd.objects.grants_kept",
      "The grants file holds every take-back again",
      { file: basename(this.opts.path), generation: this.#generation },
    );
  }

  /** A write landed: the file is there, and holds everything memory does. */
  #landed(): void {
    this.#unkept = false;
    this.#absent = false;
    this.close();
  }

  /** Tell whoever outlives fieldd the count. Never a refusal: a survivor that does not answer in time, or says no, is
   * a log line, and the change stands. */
  #tell(generation: number): void {
    let asked: Promise<number>;
    try {
      asked = this.opts.marks.note(MARK, generation);
    } catch (error) {
      asked = Promise.reject(error);
    }
    const told = within(asked, this.opts.noteMs ?? NOTE_MS).then(
      () => undefined,
      (error: unknown) => {
        this.opts.logger.warn(
          "fieldd.objects.grants_mark_unanswered",
          "No survivor took the grants' count; until one does, an older grants file put back would be served",
          { generation, reason: codeOf(error) },
        );
      },
    );
    this.#told = Promise.all([this.#told, told]).then(() => undefined);
  }

  /** What the file's own text says of who signed it, read past the signer (which answers `exposed` and `unsigned`
   * before it would say) and with more care than it reads: a regular file only, no link followed, and no more than
   * PEEK_BYTES of it.
   *  - `sealed`: JSON whose `sealed` is `true` itself, and nothing else: a handed key signed it.
   *  - `untold`: a regular file past PEEK_BYTES. It cannot be told, so it is not judged at all.
   *  - `plain`: anything else, which is the signer's to judge. */
  #peek(): "sealed" | "untold" | "plain" {
    let fd: number | undefined;
    try {
      fd = openSync(this.opts.path, PEEK_FLAGS);
      const stat = fstatSync(fd);
      if (!stat.isFile()) return "plain";
      if (stat.size > PEEK_BYTES) return "untold";
      const bytes = Buffer.alloc(stat.size);
      let got = 0;
      while (got < bytes.length) {
        const more = readSync(fd, bytes, got, bytes.length - got, got);
        if (more === 0) break;
        got += more;
      }
      const parsed: unknown = JSON.parse(bytes.toString("utf8", 0, got));
      const sealed =
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { sealed?: unknown }).sealed === true;
      return sealed ? "sealed" : "plain";
    } catch {
      return "plain";
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  #setAside(why: SetAsideWhy): undefined {
    const { path } = this.opts;
    const aside = setAsideFile(path, why);
    this.#absent = true;
    this.opts.logger.warn(
      "fieldd.objects.grants_set_aside",
      `The grants file is ${why}; set aside, and nothing in it is granted`,
      { file: basename(path), why, aside: basename(aside) },
    );
    return undefined;
  }

  /** An older file put back: set aside for a human as the signed files are, beside itself and under a name of its
   * own. The line names its count and the mark, and nothing else. */
  #stale(generation: number, mark: number): undefined {
    const { path } = this.opts;
    try {
      renameSync(path, `${path}.stale-${Date.now()}`);
    } catch {
      // nothing else to do: the store's next write replaces it
    }
    this.#absent = true;
    this.opts.logger.warn(
      "fieldd.objects.grants_stale",
      "The grants file is older than the count a survivor remembers: an earlier state, put back. Set aside, and nothing in it is granted",
      { generation, mark },
    );
    return undefined;
  }
}
