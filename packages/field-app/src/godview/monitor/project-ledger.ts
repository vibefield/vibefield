// THE PROJECT'S COLOUR (record §02, adopted at AR-5 — D3): a project is dealt
// a SEQUENCE the first time an agent runs in it, never reused, and the theme's
// tint turns the sequence into a hue (`projectTint`, the package's). A bare
// terminal belongs to no project and wears the ramp. The sequence is the
// identity that survives everything: two runs in one repository share a
// colour, a resumed run keeps its own, and across a reload the ledger comes
// back from cache. The reference deals this in its main process; here the
// renderer deals it, persisted per device, because the fold carries the
// project root and nothing in fieldd wants the number (D3's lean, v1).

export interface ProjectLedger {
  /** Project key (the workspace root) -> its dealt sequence, from 0. */
  readonly seqByKey: ReadonlyMap<string, number>;
  /** The next sequence to deal; never rewinds, so a retired project's hue stays retired. */
  readonly next: number;
}

export const EMPTY_PROJECT_LEDGER: ProjectLedger = { seqByKey: new Map(), next: 0 };

/** Deal every unseen key the next sequence, in the order given; known keys keep theirs. */
export function dealProjectSeqs(previous: ProjectLedger, keys: readonly string[]): ProjectLedger {
  let next = previous.next;
  let seqByKey: Map<string, number> | undefined;
  for (const key of keys) {
    if (previous.seqByKey.has(key) || seqByKey?.has(key)) continue;
    seqByKey ??= new Map(previous.seqByKey);
    seqByKey.set(key, next);
    next += 1;
  }
  return seqByKey === undefined ? previous : { seqByKey, next };
}

interface StoredLedger {
  version: 1;
  next: number;
  seqs: [string, number][];
}

/** The ledger as the last session left it, or empty. Cache, not state: an
 * unreadable record costs a project its colour continuity, nothing more. */
export function loadProjectLedger(storageKey: string): ProjectLedger {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return EMPTY_PROJECT_LEDGER;
    const parsed = JSON.parse(raw) as Partial<StoredLedger>;
    if (parsed.version !== 1 || !Array.isArray(parsed.seqs) || typeof parsed.next !== "number") {
      return EMPTY_PROJECT_LEDGER;
    }
    const seqByKey = new Map<string, number>();
    for (const entry of parsed.seqs) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && Number.isInteger(entry[1])) {
        seqByKey.set(entry[0], entry[1]);
      }
    }
    // `next` is the larger of what was saved and what the dealt sequences imply,
    // so a truncated record can never deal a sequence twice.
    const dealt = seqByKey.size === 0 ? -1 : Math.max(...seqByKey.values());
    return { seqByKey, next: Math.max(parsed.next, dealt + 1) };
  } catch {
    return EMPTY_PROJECT_LEDGER;
  }
}

export function saveProjectLedger(storageKey: string, ledger: ProjectLedger): void {
  try {
    const stored: StoredLedger = { version: 1, next: ledger.next, seqs: [...ledger.seqByKey] };
    localStorage.setItem(storageKey, JSON.stringify(stored));
  } catch {
    // A disabled storage partition: the colours still hold for this session.
  }
}
