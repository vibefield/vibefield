import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROJECT_DOORS } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";

// PJ-3 (D9; `thinking-project-places.md` §9, §12 risk 3) — the projects' KEY
// MEMORY. A project's key is derived (§4.3): a provisional `p1:` key hashes
// the strongest anchor no other group holds, and a record's `r:` key replaces
// it at the project's first act. So a key MOVES — when an anchor stops being
// unique to its group (a second clone of the same first commit appears), when
// two projects merge, and at a first record — and a reader holding the old
// key (a phone's open project, a window's selection) must hear where it went
// (`project.get` → `movedTo`, `project.subscribe` → `regrouped`).
//
// The moves are INFERRED, not declared: the journal remembers the last key
// each place was seen in, and a regroup that finds a place under a new key
// while its old key is held by no project records old → new. When an old
// key's places scatter, the key that took the most of them is where it went
// (a tie goes to the smaller key, so every daemon infers the same). A place
// absent from a regroup keeps its last key — so a restart, or a desktop's
// rows arriving late, still diffs against what the place was last seen in,
// not against a grouping that briefly lacked it. Both maps are bounded
// (PROJECT_DOORS) and persisted atomically: opaque keys and placeIds only,
// never a path or a remote.

/** One inferred move: `from` regrouped into `to`, at the journal's clock. */
export interface KeyMove {
  readonly from: string;
  readonly to: string;
  readonly at: number;
}

/** A project as the journal reads one: its key and every id its places
 * answer to (an aliased place's other ids included). */
export interface JournalProject {
  readonly key: string;
  readonly placeIds: readonly string[];
}

export interface KeyJournalOptions {
  /** where it persists (`LAYOUT.PROJECT_KEYS_FILE`); absent: memory only */
  file?: string;
  now?: () => number;
  /** test seams (default PROJECT_DOORS.JOURNAL_PLACES_MAX / JOURNAL_MOVES_MAX) */
  placesMax?: number;
  movesMax?: number;
  logger?: Logger;
}

const FILE_FORMAT = 1;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class KeyJournal {
  readonly #file: string | undefined;
  readonly #now: () => number;
  readonly #placesMax: number;
  readonly #movesMax: number;
  readonly #logger: Logger;
  /** placeId → the key it was last seen in; insertion order is recency */
  readonly #places = new Map<string, { key: string; seenAt: number }>();
  /** a key no project holds → where it went; insertion order is age */
  readonly #moves = new Map<string, { to: string; at: number }>();

  constructor(opts: KeyJournalOptions = {}) {
    this.#file = opts.file;
    this.#now = opts.now ?? Date.now;
    this.#placesMax = opts.placesMax ?? PROJECT_DOORS.JOURNAL_PLACES_MAX;
    this.#movesMax = opts.movesMax ?? PROJECT_DOORS.JOURNAL_MOVES_MAX;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "project_keys" });
    this.#load();
  }

  /** One regroup's projects: infer the moves since each place was last seen,
   * remember where every place is now, persist when anything moved. Answers
   * the moves this regroup made, oldest key first. */
  observe(projects: readonly JournalProject[]): KeyMove[] {
    const at = this.#now();
    const current = new Set(projects.map((project) => project.key));
    /** an old key no project holds → the new keys its places went to */
    const scattered = new Map<string, Map<string, number>>();
    let changed = false;
    for (const project of projects) {
      for (const placeId of project.placeIds) {
        const held = this.#places.get(placeId);
        if (held === undefined || held.key !== project.key) changed = true;
        if (held === undefined || held.key === project.key || current.has(held.key)) continue;
        let tally = scattered.get(held.key);
        if (tally === undefined) {
          tally = new Map();
          scattered.set(held.key, tally);
        }
        tally.set(project.key, (tally.get(project.key) ?? 0) + 1);
      }
    }
    const moves: KeyMove[] = [];
    for (const from of [...scattered.keys()].sort(byString)) {
      const tally = [...(scattered.get(from) ?? new Map<string, number>())].sort(
        (a, b) => b[1] - a[1] || byString(a[0], b[0]),
      );
      const to = tally[0]?.[0];
      if (to === undefined) continue;
      this.#moves.delete(from);
      this.#moves.set(from, { to, at });
      moves.push({ from, to, at });
    }
    while (this.#moves.size > this.#movesMax) {
      const oldest = this.#moves.keys().next().value;
      if (oldest === undefined) break;
      this.#moves.delete(oldest);
    }
    for (const project of projects) {
      for (const placeId of project.placeIds) {
        this.#places.delete(placeId);
        this.#places.set(placeId, { key: project.key, seenAt: at });
      }
    }
    while (this.#places.size > this.#placesMax) {
      const stalest = this.#places.keys().next().value;
      if (stalest === undefined) break;
      this.#places.delete(stalest);
    }
    if (changed || moves.length > 0) this.#persist();
    return moves;
  }

  /** Where a key no project holds went: the moves followed until one lands
   * on a key `isCurrent` holds (at most PROJECT_DOORS.MOVE_HOPS_MAX), or
   * undefined — the key never existed here, or its places are all gone. */
  movedTo(key: string, isCurrent: (key: string) => boolean): string | undefined {
    let at = key;
    for (let hop = 0; hop < PROJECT_DOORS.MOVE_HOPS_MAX; hop += 1) {
      const move = this.#moves.get(at);
      if (move === undefined) return undefined;
      if (isCurrent(move.to)) return move.to;
      at = move.to;
    }
    return undefined;
  }

  /** Every remembered move, oldest first (tests, diagnostics). */
  moves(): KeyMove[] {
    return [...this.#moves].map(([from, move]) => ({ from, to: move.to, at: move.at }));
  }

  /** How many places it remembers (tests). */
  get places(): number {
    return this.#places.size;
  }

  #load(): void {
    if (this.#file === undefined) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.#file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.#logger.warn("fieldd.projects.keys_unreadable", "The key journal could not be read", {
          error: error instanceof Error ? error.message : String(error),
        });
      return;
    }
    // tolerant: a row this build cannot read is skipped, never the file
    const file = raw as { format?: unknown; places?: unknown; moves?: unknown };
    if (file.format !== FILE_FORMAT) return;
    for (const row of Array.isArray(file.places) ? file.places : []) {
      if (!Array.isArray(row)) continue;
      const [placeId, key, seenAt] = row as unknown[];
      if (typeof placeId === "string" && typeof key === "string" && typeof seenAt === "number")
        this.#places.set(placeId, { key, seenAt });
    }
    for (const row of Array.isArray(file.moves) ? file.moves : []) {
      if (!Array.isArray(row)) continue;
      const [from, to, at] = row as unknown[];
      if (typeof from === "string" && typeof to === "string" && typeof at === "number")
        this.#moves.set(from, { to, at });
    }
  }

  #persist(): void {
    if (this.#file === undefined) return;
    try {
      mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
      const tmp = `${this.#file}.${process.pid}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify({
          format: FILE_FORMAT,
          places: [...this.#places].map(([placeId, held]) => [placeId, held.key, held.seenAt]),
          moves: [...this.#moves].map(([from, move]) => [from, move.to, move.at]),
        }),
        { mode: 0o600 },
      );
      durableRenameSync(tmp, this.#file);
    } catch (error) {
      this.#logger.warn(
        "fieldd.projects.keys_persist_failed",
        "The key journal could not be written",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
