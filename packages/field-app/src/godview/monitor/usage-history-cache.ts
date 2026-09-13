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

const MAX_RECORDS = 200;

interface StoredCache {
  version: 1;
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
    return parsed.version === 1 && Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
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
      for (const record of records) merged.set(keyOf(record), record);
      // Newest saves last; the oldest fall off the front.
      const kept = [...merged.values()]
        .sort((left, right) => Date.parse(left.savedAt) - Date.parse(right.savedAt))
        .slice(-MAX_RECORDS);
      try {
        const stored: StoredCache = { version: 1, records: kept };
        localStorage.setItem(storageKey, JSON.stringify(stored));
      } catch {
        // A full or disabled partition: the live ledgers are unaffected.
      }
    },
  };
}
