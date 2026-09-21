import type {
  UsageHistoryKey,
  UsageHistoryStore,
  UsageLedgerRecord,
} from "@vibecook/puppeteer-views";

// THE BURN LEDGER'S CACHE (D7): where the UI's usage ledgers sleep between
// sessions, so a resumed conversation opens with the total and the burn it
// had. The reference keeps this in its main process only because its renderer
// cannot write a file; here it is renderer-local, because it is CACHE — losing
// it costs a resumed bubble its first ten minutes of history and nothing else,
// and no other device or daemon wants it. Bounded so a user's whole past never
// accumulates in a storage partition.
//
// AR-5-1: the record became a list of independently observed USD RUNS, so this
// file keeps a host's two obligations rather than one. Version 2 is the USD
// document — a version 1 record held token series and must never be read back
// as dollars. And a save MERGES runs: `exportUsage` emits only the live run, so
// a wholesale replace would throw away every earlier run's observed spend.

const MAX_RECORDS = 200;
// One conversation resumed forever must not grow without bound in a partition
// whose only failure mode is a silent throw.
const MAX_RUNS = 50;

interface StoredCache {
  version: 2;
  records: UsageLedgerRecord[];
}

function keyOf(record: Pick<UsageLedgerRecord, "providerId" | "nativeSessionId">): string {
  return `${record.providerId} ${record.nativeSessionId}`;
}

function read(storageKey: string): UsageLedgerRecord[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as Partial<StoredCache>;
    return parsed.version === 2 && Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

/**
 * A conversation's runs accumulate; a correction wins by revision. Two Godview
 * windows share this partition, so a delayed snapshot must not undo the
 * correction the other one already observed.
 */
function mergeRecord(
  previous: UsageLedgerRecord | undefined,
  incoming: UsageLedgerRecord,
): UsageLedgerRecord {
  if (!previous) return incoming;
  const runs = new Map(previous.runs.map((run) => [run.runId, run]));
  const newerSave = Date.parse(incoming.savedAt) >= Date.parse(previous.savedAt);
  for (const run of incoming.runs) {
    const held = runs.get(run.runId);
    const wins =
      held?.revision !== undefined || run.revision !== undefined
        ? (run.revision ?? -1) >= (held?.revision ?? -1)
        : newerSave;
    if (!held || wins) runs.set(run.runId, run);
  }
  return {
    ...incoming,
    savedAt: newerSave ? incoming.savedAt : previous.savedAt,
    // Oldest runs fall off first, as the oldest conversations do below.
    runs: [...runs.values()].slice(-MAX_RUNS),
  };
}

export function createUsageHistoryCache(storageKey: string): UsageHistoryStore {
  return {
    async load(key: UsageHistoryKey) {
      const wanted = keyOf(key);
      return read(storageKey).find((record) => keyOf(record) === wanted) ?? null;
    },
    async save(records) {
      if (records.length === 0) return;
      const merged = new Map(read(storageKey).map((record) => [keyOf(record), record]));
      for (const record of records) {
        merged.set(keyOf(record), mergeRecord(merged.get(keyOf(record)), record));
      }
      // Newest saves last; the oldest fall off the front.
      const kept = [...merged.values()]
        .sort((left, right) => Date.parse(left.savedAt) - Date.parse(right.savedAt))
        .slice(-MAX_RECORDS);
      try {
        const stored: StoredCache = { version: 2, records: kept };
        localStorage.setItem(storageKey, JSON.stringify(stored));
      } catch {
        // A full or disabled partition: the live ledgers are unaffected.
      }
    },
  };
}
