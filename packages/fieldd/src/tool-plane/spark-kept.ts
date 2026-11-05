import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SPARK_KEPT_FILE, SPARK_KEPT_FORMAT, SparkId, SparkKeptRecord } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { RecordSigner, type SetAsideWhy, setAsideFile } from "../signed-record";

// Item 159 (step0-items-158-159.md §4; TH0-Q11 (b), ruled 2026-11-04) — the spark's kept record: what fieldd keeps for
// one spark beyond its SparkRecord, for the slices that keep something per spark across a restart (1′'s watches and
// held wakes, SP-1e2's crews). Each spark has a folder of fieldd's own under LAYOUT.SPARK_FILES_DIR, named by its id,
// 0700 in a 0700 directory, never in the spark's home; its kept record is one file in it, SPARK_KEPT_FILE, 0600, signed
// by fieldd's one record signer under LAYOUT.SPARK_FILES_KEY_FILE, the folder's one key, which TH-1's run files beside
// it share.
// - The record's `spark` is inside the signature and names its folder: one copied into another spark's folder is
//   refused there. A file that is unsigned, does not verify, does not parse, is exposed to other users, or names
//   another spark is set aside for a human and never served. That holds against an edit. It is no wall against an
//   agent that reads the key, which is 0600 to the same uid, as the sparks' is (EL7).
// - An update re-reads the file first, so a section another writer kept meanwhile survives, and so does one this build
//   does not know (the record is OPEN). It is written through, and throws when the disk does not take it, so a writer
//   acts only on what a restart finds.
// - Read once at boot (`list`). No door serves it, and no section is this item's: each slice adds its own.

export interface SparkKeptStoreOptions {
  /** LAYOUT.SPARK_FILES_DIR, absolute */
  readonly dir: string;
  /** LAYOUT.SPARK_FILES_KEY_FILE, absolute */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  readonly now?: () => Date;
}

export class SparkKeptStore {
  readonly #signer: RecordSigner;
  readonly #logger: Logger;
  readonly #now: () => Date;

  constructor(private readonly opts: SparkKeptStoreOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
    this.#signer = new RecordSigner({ keyPath: opts.keyPath, logger: this.#logger });
  }

  /** One spark's record, when it verifies. */
  get(spark: SparkId): SparkKeptRecord | undefined {
    return this.#read(spark);
  }

  /** Every record that verifies, by its spark's id: a folder not named as a spark, or one with no kept record (only
   * the files later slices keep there), is passed over. Read at boot. */
  list(): SparkKeptRecord[] {
    if (!existsSync(this.opts.dir)) return [];
    return readdirSync(this.opts.dir)
      .filter((name) => SparkId.safeParse(name).success)
      .sort()
      .flatMap((spark) => {
        const record = this.#read(spark);
        return record !== undefined ? [record] : [];
      });
  }

  /** Re-read the spark's record (a fresh one when it has none), apply `fn`, and keep what it answers, signed and
   * written through, the spark and the time its own; the record kept is answered. Throws when the contract refuses it
   * or the disk does not take it. */
  update(spark: SparkId, fn: (kept: SparkKeptRecord) => SparkKeptRecord): SparkKeptRecord {
    const now = this.#now().toISOString();
    const current = this.#read(spark) ?? { format: SPARK_KEPT_FORMAT, spark, updatedAt: now };
    const { signature: _previous, ...next } = SparkKeptRecord.parse({
      ...fn(current),
      format: SPARK_KEPT_FORMAT,
      spark,
      updatedAt: now,
    }) as SparkKeptRecord & { signature?: string };
    const signature = this.#signer.sign(next);
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.dir, 0o700);
    const folder = join(this.opts.dir, spark);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    const path = join(folder, SPARK_KEPT_FILE);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ ...next, signature })}\n`, { mode: 0o600 });
    durableRenameSync(temp, path);
    return next;
  }

  #read(spark: string): SparkKeptRecord | undefined {
    const path = join(this.opts.dir, spark, SPARK_KEPT_FILE);
    if (!existsSync(path) || !statSync(path).isFile()) return undefined;
    const read = this.#signer.read(path);
    if ("why" in read) return this.#setAside(path, spark, read.why);
    const parsed = SparkKeptRecord.safeParse(read.body);
    if (!parsed.success) return this.#setAside(path, spark, "unreadable");
    // signed for another spark: a record copied into this spark's folder
    if (parsed.data.spark !== spark) return this.#setAside(path, spark, "forged");
    return parsed.data;
  }

  #setAside(path: string, spark: string, why: SetAsideWhy): undefined {
    const aside = setAsideFile(path, why);
    this.#logger.warn(
      "fieldd.spark_kept.set_aside",
      `A spark's kept record is ${why}; set aside, never served`,
      { spark, why, aside: basename(aside) },
    );
    return undefined;
  }
}
