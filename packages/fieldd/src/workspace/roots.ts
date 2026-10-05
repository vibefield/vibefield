import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  type WorkspacePlaceRecord,
  type WorkspaceRoot,
  WorkspaceRootsFile,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import {
  type BrowseExport,
  type BrowseFacts,
  enumerateBrowseExports,
  ownBrowseFacts,
} from "./browse-exports";
import { displayName, isFilesystemRoot, rootIdFor } from "./paths";

// FS-1a (L2; `thinking-files-service.md` §6) — the ROOTS REGISTRY: what this
// desktop's files service exports, fieldd-owned, under the user root at
// `LAYOUT.WORKSPACE_ROOTS_FILE`.
//
//   · PLACES — every folder an agent was spawned in (the places model: a
//     place is "a folder on a device where work happens"). Added automatically
//     when a run enters the fold (agent-runtime.ts `onPlace`), its
//     `lastActiveAt` refreshed on every later run there, seeded once from the
//     session records the runtime already kept. PERSISTED: a place is never
//     dropped — a folder that vanished is `missing: true` (PJ's word), and
//     comes back the day the folder does.
//   · BROWSE exports — the home directory and the mounted volumes
//     (browse-exports.ts), enumerated LIVE at every reading, never kept.
//
// Picks (FS-3) and rosetta's project roots (FS-1b, on consent) are not built.
// A root's id is a digest of its kind and path (`rootIdFor`), so nothing but
// the places needs a file. Writes are atomic (a temp file, then a rename); a
// file that does not parse is set aside with a warning and the registry
// starts empty — never a boot failure, never a half-written file read.

type PlaceRecord = WorkspacePlaceRecord;

export interface RootsRegistryOptions {
  /** `LAYOUT.WORKSPACE_ROOTS_FILE` under the user root */
  file: string;
  /** this desktop's device id, read at every answer */
  deviceId: () => string;
  /** the platform the paths are (a test's fixture platform; default: this one) */
  platform?: NodeJS.Platform;
  /** the browse enumerator's facts (a test's fixture platform) */
  browse?: () => BrowseFacts;
  /** is this folder there? (a test's seam; default: stat says directory) */
  isDirectory?: (path: string) => boolean;
  /** its real path, or null when it cannot be read (a test's seam) */
  realpath?: (path: string) => string | null;
  now?: () => Date;
  logger?: Logger;
}

/** A root as the service holds it: the wire row plus nothing secret. */
export type RootRow = WorkspaceRoot;

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function defaultRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export class RootsRegistry {
  readonly #opts: RootsRegistryOptions;
  readonly #logger: Logger;
  /** places by path, in no order (answers sort them) */
  readonly #places = new Map<string, PlaceRecord>();
  readonly #listeners = new Set<() => void>();
  readonly #platform: NodeJS.Platform;
  #loaded = false;

  constructor(opts: RootsRegistryOptions) {
    this.#opts = opts;
    this.#logger = opts.logger ?? createNoopLogger();
    this.#platform = opts.platform ?? process.platform;
  }

  /** Hear every change a reading or a write made (the rows table re-reads). */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        this.#logger.warn("fieldd.workspace.roots_listener_failed", "A roots listener threw", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  #load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    let raw: string;
    try {
      raw = readFileSync(this.#opts.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.#logger.warn(
          "fieldd.workspace.roots_unreadable",
          "The roots registry could not be read",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      return;
    }
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // not JSON: set aside below, like any file that does not parse
    }
    const parsed = WorkspaceRootsFile.safeParse(json);
    if (!parsed.success) {
      const aside = `${this.#opts.file}.unreadable-${Date.now()}`;
      try {
        renameSync(this.#opts.file, aside);
      } catch {
        // left in place; the next write replaces it
      }
      this.#logger.warn(
        "fieldd.workspace.roots_set_aside",
        "The roots registry did not parse; it was set aside and the registry starts empty",
        { aside },
      );
      return;
    }
    for (const place of parsed.data.places) this.#places.set(place.path, place);
  }

  #persist(): void {
    const body = {
      version: 1 as const,
      places: [...this.#places.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
    const file = this.#opts.file;
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      this.#logger.warn(
        "fieldd.workspace.roots_write_failed",
        "The roots registry could not be written",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /** A run entered the fold in `cwd` at `at` (ISO): the folder becomes a place,
   * or its `lastActiveAt` moves forward. A folder the service never exports
   * (a filesystem root, on its real path) or one that is not there is not
   * added. Answers whether anything changed. */
  touchPlace(cwd: string, at?: string): boolean {
    this.#load();
    const when = at ?? (this.#opts.now ?? (() => new Date()))().toISOString();
    if (!this.#exportable(cwd)) return false;
    const existing = this.#places.get(cwd);
    if (existing !== undefined) {
      if (existing.lastActiveAt >= when && existing.missing !== true) return false;
      this.#places.set(cwd, {
        ...existing,
        lastActiveAt: existing.lastActiveAt >= when ? existing.lastActiveAt : when,
        missing: false,
      });
    } else {
      this.#places.set(cwd, { path: cwd, addedAt: when, lastActiveAt: when, missing: false });
    }
    this.#persist();
    this.#emit();
    return true;
  }

  /** Seed places from what the runtime already kept (its session records):
   * one write for the whole set. */
  seedPlaces(places: ReadonlyArray<{ cwd: string; at: string }>): number {
    this.#load();
    let added = 0;
    for (const { cwd, at } of places) {
      if (!this.#exportable(cwd)) continue;
      const existing = this.#places.get(cwd);
      if (existing === undefined) {
        this.#places.set(cwd, { path: cwd, addedAt: at, lastActiveAt: at, missing: false });
        added += 1;
      } else if (existing.lastActiveAt < at) {
        this.#places.set(cwd, { ...existing, lastActiveAt: at });
        added += 1;
      }
    }
    if (added > 0) {
      this.#persist();
      this.#emit();
    }
    return added;
  }

  #exportable(path: string): boolean {
    if (!(this.#opts.isDirectory ?? defaultIsDirectory)(path)) return false;
    const real = (this.#opts.realpath ?? defaultRealpath)(path);
    if (real === null) return false;
    return !isFilesystemRoot(real, this.#platform);
  }

  /** Re-read the disk's word on every place (`missing`) — a flip is persisted
   * and heard. Cheap: one stat per place. */
  refresh(): boolean {
    this.#load();
    const isDirectory = this.#opts.isDirectory ?? defaultIsDirectory;
    let changed = false;
    for (const [path, place] of this.#places) {
      const missing = !isDirectory(path);
      if ((place.missing === true) !== missing) {
        this.#places.set(path, { ...place, missing });
        changed = true;
      }
    }
    if (changed) {
      this.#persist();
      this.#emit();
    }
    return changed;
  }

  /** Mark one place missing (the worker found its folder gone mid-ask). */
  markMissing(rootId: string): void {
    this.#load();
    for (const [path, place] of this.#places) {
      if (rootIdFor("place", path) !== rootId || place.missing === true) continue;
      this.#places.set(path, { ...place, missing: true });
      this.#persist();
      this.#emit();
      return;
    }
  }

  /** Every root, in the order an answer gives them: places newest first,
   * then the home directory, then the volumes. Places carry the disk's word
   * as last read (`refresh` re-reads it). */
  roots(): RootRow[] {
    this.#load();
    const device = this.#opts.deviceId();
    const platform = this.#platform;
    const places = [...this.#places.values()].sort(
      (a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt) || a.path.localeCompare(b.path),
    );
    const rows: RootRow[] = places.map((place) => ({
      rootId: rootIdFor("place", place.path),
      name: displayName(place.path, platform),
      path: place.path,
      device,
      kind: "place",
      missing: place.missing === true,
      lastActiveAt: place.lastActiveAt,
    }));
    let browse: BrowseExport[] = [];
    try {
      browse = enumerateBrowseExports((this.#opts.browse ?? ownBrowseFacts)());
    } catch (error) {
      this.#logger.warn("fieldd.workspace.browse_failed", "The browse exports could not be read", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    for (const entry of browse) {
      rows.push({
        rootId: rootIdFor("browse", entry.path),
        name: displayName(entry.path, platform),
        path: entry.path,
        device,
        kind: "browse",
        browse: entry.browse,
        missing: false,
        lastActiveAt: null,
      });
    }
    return rows;
  }

  /** One root by id, or undefined — the doors' lookup. */
  find(rootId: string): RootRow | undefined {
    return this.roots().find((root) => root.rootId === rootId);
  }
}
