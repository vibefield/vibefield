import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type Dirent,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { canonicalJson, RECORD_STORES } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";

// The one record signer (CP-3; LEANS P3). fieldd keeps records it later acts on in files a same-uid agent can write.
// Each record carries an HMAC-SHA256 over its canonical JSON (contracts' one form), keyed by a secret made once per
// store per user root, so an edit is refused: a file that is unsigned, does not verify, does not parse, or is exposed
// to other users is set aside by its store and never served. Item 172: a disk that does not answer (an errno, after
// RECORD_STORES.READ_TRIES tries; a key that cannot be read) is no proof a file is not a record, so such a file is left
// where it is and its store refuses (StoreGuard, below), and a record a newer VibeField wrote is kept for it. SparkStore signs here (a spark's record bounds what its
// verbs reach, TL-D5), so do the sessions' input queues (agent-input-queue.ts: what a kept queue holds is pasted into
// a session, marked as a spark's words or as VibeField's), so does the needs-you queue (tool-plane/rooms/you/
// store.ts: what an Allow acts on), and so does each spark's kept record (tool-plane/spark-kept.ts, item 159: what
// fieldd keeps for one spark across a restart, in the spark's own folder). Each store has a key of its own.
// Item 177: so do the managed sessions' records (agent-sessions.ts, AR-3/AR-4b: what the boot re-attaches to and
// resume-when-idle terminates), whose key is base64 as it always was (`keyEncoding`): read as hex it would be
// unreadable, and setting it aside would make every session record it signed read as forged.
//
// What it holds against is an EDIT. The key is 0600 to the same uid, so an agent that reads it can sign (EL7): the
// signature is evidence against a careless or partial adversary, never a wall against one that reads fieldd's files.
//
// The key's rule is SessionRecordStore's (AR-4b): a key that other users could read is worthless as evidence, so it
// is set aside and another made in the same call, and a file that holds no key is set aside the same way. Every
// record signed with a key set aside reads as forged from then on. A key set aside is renamed beside the store for a
// human, never deleted.

/** The secret's bytes, and the signature's: each written as hex (the key as SparkStore's always was), read in
 * either case. Item 177: the sessions' key is base64, 32 bytes with its padding, as AR-4b made it. */
const KEY_BYTES = 32;
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;
const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

/** Why a signed file is not served. */
export type SetAsideWhy = "exposed" | "unsigned" | "forged" | "unreadable";

/** A signed file read back: its body without the signature; why it must be set aside (it is not a record); the
 * errno of a disk that did not answer (item 172: left where it is, never set aside); or nothing there. */
export type SignedRead =
  | { readonly body: Record<string, unknown> }
  | { readonly why: SetAsideWhy }
  | { readonly unavailable: string }
  | { readonly absent: true };

/** Item 172 — fieldd's words when a store cannot read what it keeps (DESIGN.md §9 "What VibeField keeps, when it
 * cannot read it"): never a path or an error's name. */
export const UNREADABLE_WORDS = {
  sparks: "VibeField can't read the sparks it keeps; nothing was changed",
  // item 177 — the sessions' records (SessionRecordStore), one of the signed stores: a sign-out and a set's delete refuse first
  sessions: "VibeField can't read the sessions it keeps; nothing was changed",
  needs: "VibeField can't read what waits on you; nothing was changed",
  inputs: "VibeField can't keep words for its sessions; nothing was sent",
  // CP-4a1 — the flow records, item 172's fifth store
  flows: "VibeField can't read the flows it keeps; nothing was changed",
  /** TH-1 — a spark's transcript (spark-transcripts.ts): its folder, a run's file or the key its lines are checked by */
  transcripts: "VibeField can't read this spark's conversation; nothing was changed",
} as const;

/** Item 172 — a store that cannot read what it keeps: UNAVAILABLE {service, state: RECORD_STORES.STATE_UNREADABLE}, in
 * fieldd's words. Retryable where the store reads at each ask; not where it read once, at boot. */
export function recordsUnreadable(
  service: string,
  words: string,
  retryable: boolean,
): RpcCallError {
  return new RpcCallError("UNAVAILABLE", words, retryable, {
    service,
    state: RECORD_STORES.STATE_UNREADABLE,
  });
}

/** Item 172 — the format a newer VibeField wrote a record in, when it is above this build's own (`own`): such a record
 * is kept where it is for that VibeField, never served and never written over. */
export function newerFormat(body: Record<string, unknown>, own: number): number | undefined {
  const { format } = body;
  return typeof format === "number" && Number.isInteger(format) && format > own
    ? format
    : undefined;
}

/** An error's errno (`ENOENT`, `EMFILE`, …), when it carries one. */
function errnoOf(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

export interface StoreGuardOptions {
  /** the store's name in fieldd's log */
  readonly store: string;
  /** the format this build writes: a record above it is a newer VibeField's */
  readonly format: number;
  /** the store's refusal while it cannot read (`recordsUnreadable`, in its words) */
  refusal(): RpcCallError;
  readonly logger: Logger;
}

/** Item 172 — what every signed store answers alike when its disk does not answer, or a newer VibeField wrote a record:
 * - a folder it cannot list, or a file the disk did not answer (after READ_TRIES tries), is said in fieldd's log and
 *   refused UNAVAILABLE in the store's words, never answered as nothing, and nothing is moved or written over;
 * - a store read once at boot (`boot`) whose read failed refuses every read and write after, until fieldd restarts on a
 *   disk that answers; the boot itself goes on (EL7: a same-uid file where a folder is never stops fieldd);
 * - a record a newer VibeField wrote is held: kept where it is, never served, said once, and a write to its key is
 *   refused, never answered by writing over it. */
export class StoreGuard {
  /** the boot read failed, with its errno: every read and write refuses until a restart */
  #failed: string | undefined;
  /** the keys a newer VibeField's records hold */
  readonly #held = new Set<string>();
  /** the boot read's failure was said already (by the listing) */
  #said = false;
  /** the errno of the last read the disk did not answer */
  #code: string | undefined;

  constructor(private readonly opts: StoreGuardOptions) {}

  /** The store's boot read: its answer, or `empty` when it could not read (said; the store refuses after). Never
   * throws. */
  boot<T>(read: () => T, empty: T): T {
    this.#said = false;
    try {
      return read();
    } catch (error) {
      this.#failed = errnoOf(error) ?? this.#code ?? "unknown";
      if (!this.#said)
        this.opts.logger.error(
          "fieldd.records.store_unavailable",
          "A store fieldd keeps could not be read at boot; it refuses until fieldd restarts on a disk that answers",
          error instanceof RpcCallError ? undefined : error,
          { store: this.opts.store, code: this.#failed },
        );
      return empty;
    }
  }

  /** Throws the store's refusal while its boot read has failed. */
  check(): void {
    if (this.#failed !== undefined) throw this.opts.refusal();
  }

  /** Whether a write to `key` would be kept: the store reads, and no newer VibeField's record holds the key. */
  keeps(key: string): boolean {
    return this.#failed === undefined && !this.#held.has(key);
  }

  /** Throws the store's refusal unless a write to `key` would be kept. */
  writable(key: string): void {
    this.check();
    if (this.#held.has(key)) throw this.opts.refusal();
  }

  /** A folder's entries, tried READ_TRIES times; nothing for a folder that is not there. A folder it cannot list is
   * said and refused. */
  entries(dir: string): Dirent[] {
    let code = "unknown";
    for (let attempt = 0; attempt < RECORD_STORES.READ_TRIES; attempt += 1) {
      try {
        return readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        code = errnoOf(error) ?? "unknown";
        if (code === "ENOENT") return [];
      }
    }
    this.#said = true;
    this.#code = code;
    this.opts.logger.error(
      "fieldd.records.store_unavailable",
      "A store fieldd keeps could not list its folder; nothing in it is served, moved or written over",
      undefined,
      { store: this.opts.store, code },
    );
    throw this.opts.refusal();
  }

  /** A file the disk did not answer (`code`): left where it is, said, and refused. */
  unavailable(path: string, code: string): never {
    this.#code = code;
    this.opts.logger.warn(
      "fieldd.records.unavailable",
      "A record the disk did not answer is left where it is, never set aside or written over",
      { store: this.opts.store, file: basename(path), code },
    );
    throw this.opts.refusal();
  }

  /** Whether `body` is a newer VibeField's record: its key is held, said once, and it is not served. */
  newer(key: string, path: string, body: Record<string, unknown>): boolean {
    const format = newerFormat(body, this.opts.format);
    if (format === undefined) return false;
    if (!this.#held.has(key))
      this.opts.logger.warn(
        "fieldd.records.newer",
        "A record a newer VibeField wrote is kept for it, never served or written over",
        { store: this.opts.store, file: basename(path), format },
      );
    this.#held.add(key);
    return true;
  }
}

export interface RecordSignerOptions {
  /** the secret's file (a LAYOUT `*_KEY_FILE` row), made once, 0600, in a 0700 directory */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  /** a record file's read (utf8): a seam for a disk that does not answer (EMFILE), in tests */
  readonly readFile?: ((path: string) => string) | undefined;
  /** Item 177 — how the key is written in its file: hex (every store since SparkStore), or base64 (the sessions' key,
   * AR-4b's, read and made as it always was). */
  readonly keyEncoding?: "hex" | "base64" | undefined;
}

export class RecordSigner {
  #key: Buffer | undefined;
  readonly #keyPath: string;
  readonly #logger: Logger;
  readonly #readFile: (path: string) => string;
  readonly #keyEncoding: "hex" | "base64";

  constructor(opts: RecordSignerOptions) {
    this.#keyPath = opts.keyPath;
    this.#logger = opts.logger ?? createNoopLogger();
    this.#readFile = opts.readFile ?? ((path) => readFileSync(path, "utf8"));
    this.#keyEncoding = opts.keyEncoding ?? "hex";
  }

  /** HMAC-SHA256 over the record's canonical JSON, hex. */
  sign(unsigned: unknown): string {
    return createHmac("sha256", this.#signingKey()).update(canonicalJson(unsigned)).digest("hex");
  }

  /** TH-1 — the key's bytes, for a worker of fieldd's own that verifies what this signs (the transcript worker),
   * handed on its IPC pipe and never in its environment (EL7). Made once, as for a signature. */
  secret(): Buffer {
    return Buffer.from(this.#signingKey());
  }

  /** Whether `signature` is this key's for `unsigned`, compared in constant time; false for a malformed one. */
  verifies(unsigned: unknown, signature: string): boolean {
    if (!HEX_32_BYTES.test(signature)) return false;
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(this.sign(unsigned), "hex"));
  }

  /** Read a signed file: one exposed to other users, unparseable, unsigned or forged is refused, in that order, and
   * the store parses the body with its own schema and sets aside what this refuses. Item 172: a disk that does not
   * answer is no proof a file is not a record. A read that fails by an errno is tried READ_TRIES times, then answered
   * `unavailable`, and so is a key that cannot be read; nothing there (ENOENT, or ENOTDIR: a file where its folder
   * would be) is `absent`, and a folder at the path is not a record. */
  read(path: string): SignedRead {
    const text = this.#text(path);
    if (typeof text !== "string") return text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { why: "unreadable" };
    }
    if (parsed === null) return { why: "unreadable" };
    const { signature, ...body } = parsed as Record<string, unknown>;
    if (typeof signature !== "string") return { why: "unsigned" };
    try {
      return this.verifies(body, signature) ? { body } : { why: "forged" };
    } catch (error) {
      // the key could not be read: the record is not judged by it
      return { unavailable: errnoOf(error) ?? "key-unreadable" };
    }
  }

  /** CP-4a2a — a file's text, read as `read` reads a record's (tried READ_TRIES times; a file open to other users, a
   * folder at the path, nothing there and a disk that did not answer each said so), for a store whose file is not one
   * signed body: a run's journal, each of its lines MAC'd (flows/journal.ts). */
  readText(path: string): string | Exclude<SignedRead, { readonly body: Record<string, unknown> }> {
    return this.#text(path);
  }

  /** The file's text, tried READ_TRIES times while the disk does not answer; or why there is none to read. */
  #text(path: string): string | Exclude<SignedRead, { readonly body: Record<string, unknown> }> {
    let code = "unknown";
    for (let attempt = 0; attempt < RECORD_STORES.READ_TRIES; attempt += 1) {
      try {
        if (exposed(path)) return { why: "exposed" };
        return this.#readFile(path);
      } catch (error) {
        code = errnoOf(error) ?? "unknown";
        // nothing there, or no folder for it to be in (a file where its folder would be): no record to read or keep
        if (code === "ENOENT" || code === "ENOTDIR") return { absent: true };
        // a folder where a record's file is: not a record
        if (code === "EISDIR") return { why: "unreadable" };
      }
    }
    return { unavailable: code };
  }

  /** The key: read, or made once (flag "wx", so a second fieldd that races the first reads the winner's). Two passes
   * bound it: a key set aside in the first is replaced there, and the second reads what was made. */
  #signingKey(): Buffer {
    if (this.#key !== undefined) return this.#key;
    mkdirSync(dirname(this.#keyPath), { recursive: true, mode: 0o700 });
    for (let pass = 0; pass < 2; pass += 1) {
      const found = this.#readKey();
      if (Buffer.isBuffer(found)) {
        this.#key = found;
        return found;
      }
      if (found !== "absent") this.#setKeyAside(found);
      try {
        // the sessions' key ends with a newline, as AR-4b wrote it
        const made = randomBytes(KEY_BYTES).toString(this.#keyEncoding);
        writeFileSync(this.#keyPath, this.#keyEncoding === "base64" ? `${made}\n` : made, {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        // another writer made it first: the next pass reads theirs
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new Error(`the signing key at ${this.#keyPath} could not be read or made`);
  }

  #readKey(): Buffer | "absent" | "exposed" | "unreadable" {
    try {
      if (exposed(this.#keyPath)) return "exposed";
      const text = readFileSync(this.#keyPath, "utf8").trim();
      const shape = this.#keyEncoding === "base64" ? BASE64_32_BYTES : HEX_32_BYTES;
      return shape.test(text) ? Buffer.from(text, this.#keyEncoding) : "unreadable";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
      throw error;
    }
  }

  #setKeyAside(why: "exposed" | "unreadable"): void {
    const aside = `${this.#keyPath}.${why}-${Date.now()}`;
    this.#logger.error(
      "fieldd.records.key_set_aside",
      "A record signing key was set aside and another made; every record it signed reads as forged",
      undefined,
      { key: basename(this.#keyPath), why, aside: basename(aside) },
    );
    try {
      renameSync(this.#keyPath, aside);
    } catch (error) {
      // another writer set it aside first
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** A signed file its store will not serve, moved out of the listing for a human to look at: renamed
 * `<file>.<why>-<ms>` beside it, never deleted and never read again (SessionRecordStore's rule). The store says so in
 * its own log line. The name it was set aside under is returned; a file another writer moved first stays where it is. */
export function setAsideFile(path: string, why: SetAsideWhy): string {
  const aside = `${path}.${why}-${Date.now()}`;
  try {
    renameSync(path, aside);
  } catch {
    // nothing else to do: the store's next write replaces it
  }
  return aside;
}

/** Whether a file's mode lets group or others at it (never on win32, where the mode bits say nothing). */
function exposed(path: string): boolean {
  if (process.platform === "win32") return false;
  return (statSync(path).mode & 0o077) !== 0;
}
