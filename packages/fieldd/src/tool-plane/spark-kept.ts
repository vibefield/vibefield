import { SPARK_KEPT_FORMAT, type SparkId, type SparkKeptRecord } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// Item 159 (step0-items-158-159.md §4; TH0-Q11 (b), ruled 2026-11-04) — the spark's kept record: what fieldd keeps for
// one spark beyond its SparkRecord, for the slices that keep something per spark across a restart (1′'s watches and
// held wakes, SP-1e2's crews). One file, SPARK_KEPT_FILE, in the spark's own folder under LAYOUT.SPARK_FILES_DIR,
// which TH-1's run files share under the same key. Item 159 (red): a skeleton; nothing is kept yet.

export interface SparkKeptStoreOptions {
  /** LAYOUT.SPARK_FILES_DIR, absolute */
  readonly dir: string;
  /** LAYOUT.SPARK_FILES_KEY_FILE, absolute */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  readonly now?: () => Date;
}

export class SparkKeptStore {
  readonly #logger: Logger;
  readonly #now: () => Date;

  constructor(opts: SparkKeptStoreOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
  }

  /** One spark's record, when it verifies. Item 159 (red): none. */
  get(_spark: SparkId): SparkKeptRecord | undefined {
    return undefined;
  }

  /** Every record that verifies, read at boot. Item 159 (red): none. */
  list(): SparkKeptRecord[] {
    return [];
  }

  /** Re-read the spark's record, apply `fn`, and keep the result signed, written through. Item 159 (red): the record
   * `fn` makes is answered and never kept. */
  update(spark: SparkId, fn: (kept: SparkKeptRecord) => SparkKeptRecord): SparkKeptRecord {
    return fn({ format: SPARK_KEPT_FORMAT, spark, updatedAt: this.#now().toISOString() });
  }
}
