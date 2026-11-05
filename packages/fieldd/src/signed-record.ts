import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { canonicalJson, RECORD_STORES } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";

// The one record signer (CP-3; LEANS P3). fieldd keeps records it later acts on in files a same-uid agent can write.
// Each record carries an HMAC-SHA256 over its canonical JSON (contracts' one form), keyed by a secret made once per
// store per user root, so an edit is refused: a file that is unsigned, does not verify, does not parse, or is exposed
// to other users is set aside by its store and never served. SparkStore signs here (a spark's record bounds what its
// verbs reach, TL-D5), so do the sessions' input queues (agent-input-queue.ts: what a kept queue holds is pasted into
// a session, marked as a spark's words or as VibeField's), so does the needs-you queue (tool-plane/rooms/you/
// store.ts: what an Allow acts on), and so does each spark's kept record (tool-plane/spark-kept.ts, item 159: what
// fieldd keeps for one spark across a restart, in the spark's own folder). Each store has a key of its own.
// SessionRecordStore (agent-sessions.ts) still keeps its own copy of the same HMAC and key rule, its key in base64.
// Moving it here needs this signer to read that key as it is written: read as hex it is unreadable, and setting it
// aside would make every session record it signed read as forged.
//
// What it holds against is an EDIT. The key is 0600 to the same uid, so an agent that reads it can sign (EL7): the
// signature is evidence against a careless or partial adversary, never a wall against one that reads fieldd's files.
//
// The key's rule is SessionRecordStore's (AR-4b): a key that other users could read is worthless as evidence, so it
// is set aside and another made in the same call, and a file that holds no key is set aside the same way. Every
// record signed with a key set aside reads as forged from then on. A key set aside is renamed beside the store for a
// human, never deleted.

/** The secret's bytes, and the signature's: each written as hex (the key as SparkStore's always was), read in
 * either case. */
const KEY_BYTES = 32;
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

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
  needs: "VibeField can't read what waits on you; nothing was changed",
  inputs: "VibeField can't keep words for its sessions; nothing was sent",
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
export function newerFormat(_body: Record<string, unknown>, _own: number): number | undefined {
  return undefined;
}

export interface RecordSignerOptions {
  /** the secret's file (a LAYOUT `*_KEY_FILE` row), made once, 0600, in a 0700 directory */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  /** a record file's read (utf8): a seam for a disk that does not answer (EMFILE), in tests */
  readonly readFile?: ((path: string) => string) | undefined;
}

export class RecordSigner {
  #key: Buffer | undefined;
  readonly #keyPath: string;
  readonly #logger: Logger;
  readonly #readFile: (path: string) => string;

  constructor(opts: RecordSignerOptions) {
    this.#keyPath = opts.keyPath;
    this.#logger = opts.logger ?? createNoopLogger();
    this.#readFile = opts.readFile ?? ((path) => readFileSync(path, "utf8"));
  }

  /** HMAC-SHA256 over the record's canonical JSON, hex. */
  sign(unsigned: unknown): string {
    return createHmac("sha256", this.#signingKey()).update(canonicalJson(unsigned)).digest("hex");
  }

  /** Whether `signature` is this key's for `unsigned`, compared in constant time; false for a malformed one. */
  verifies(unsigned: unknown, signature: string): boolean {
    if (!HEX_32_BYTES.test(signature)) return false;
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(this.sign(unsigned), "hex"));
  }

  /** Read a signed file: one exposed to other users, unparseable, unsigned or forged is refused, in that order. The
   * store parses the body with its own schema, and sets aside what this refuses. */
  read(path: string): SignedRead {
    try {
      if (exposed(path)) return { why: "exposed" };
      const { signature, ...body } = JSON.parse(this.#readFile(path)) as Record<string, unknown>;
      if (typeof signature !== "string") return { why: "unsigned" };
      return this.verifies(body, signature) ? { body } : { why: "forged" };
    } catch {
      return { why: "unreadable" };
    }
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
        writeFileSync(this.#keyPath, randomBytes(KEY_BYTES).toString("hex"), {
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
      return HEX_32_BYTES.test(text) ? Buffer.from(text, "hex") : "unreadable";
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
