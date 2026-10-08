import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  type WorkspacePickedRecord,
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
//     IDENTITY (R6, 2026-10-07): a place is keyed by the cwd as given, and
//     records its REAL path (`realPath`) whenever a run touches it. A refresh
//     marks it missing when its real path no longer matches (the folder
//     swapped for a link — elsewhere, or to `/`) or is a filesystem root, so
//     the export never follows a link it was not touched through; a live
//     attachment on it ends through the worker's root check. System links
//     resolve the same way every time (`/tmp/x` → `/private/tmp/x`), so they
//     stay present. A run touching the place again re-records it: the folder
//     is where work happens now. A place written before the field adopts its
//     real path at the first refresh that finds the folder there and not a
//     filesystem root; one that resolves to a filesystem root adopts nothing
//     and stays missing until a run touches it again.
//   · BROWSE exports — the home directory and the mounted volumes
//     (browse-exports.ts), enumerated LIVE at every reading, never kept.
//
//   · PICKED roots — the native folder picker's canonical directories, kept
//     beside places. The caller cannot supply a path. Missing picks remain
//     visible, and a replaced symlink never silently retargets an export.
// Rosetta's separately registered project roots remain unbuilt.
// A root's id is a digest of its kind and path (`rootIdFor`). Writes are atomic (a temp file, then a rename); a
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
  readonly #picked = new Map<string, WorkspacePickedRecord>();
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
    for (const picked of parsed.data.picked ?? []) this.#picked.set(picked.path, picked);
  }

  #write(picked = this.#picked): void {
    const body = {
      version: 1 as const,
      places: [...this.#places.values()].sort((a, b) => a.path.localeCompare(b.path)),
      ...(picked.size > 0
        ? { picked: [...picked.values()].sort((a, b) => a.path.localeCompare(b.path)) }
        : {}),
    };
    const file = this.#opts.file;
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      try {
        rmSync(temp, { force: true });
      } catch {
        /* keep the write's error */
      }
      throw error;
    }
  }

  #persist(): void {
    try {
      this.#write();
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

  /** Resolve the trusted native pick without publishing it. Audit completes
   * before registerPicked; aliases converge on the canonical directory. */
  preparePicked(path: string): WorkspaceRoot | null {
    this.#load();
    const canonical = (this.#opts.realpath ?? defaultRealpath)(path);
    if (
      canonical === null ||
      isFilesystemRoot(canonical, this.#platform) ||
      !(this.#opts.isDirectory ?? defaultIsDirectory)(canonical)
    )
      return null;
    return {
      rootId: rootIdFor("picked", canonical),
      name: displayName(canonical, this.#platform),
      path: canonical,
      device: this.#opts.deviceId(),
      kind: "picked",
      missing: false,
      lastActiveAt: null,
    };
  }

  /** Strict persistence for an explicit choice: no row or event is exposed
   * unless the atomic write succeeds. Revalidate the approved canonical path;
   * replacing it with a symlink while the dialog/audit finishes is refused. */
  registerPicked(path: string): WorkspaceRoot | null {
    const root = this.preparePicked(path);
    if (!root || root.path !== path) return null;
    const existing = this.#picked.get(path);
    if (existing && existing.missing !== true) return root;
    const picked = new Map(this.#picked);
    const record = {
      path,
      addedAt: existing?.addedAt ?? (this.#opts.now ?? (() => new Date()))().toISOString(),
      missing: false,
    };
    picked.set(path, record);
    this.#write(picked);
    this.#picked.set(path, record);
    this.#emit();
    return root;
  }

  /** A run entered the fold in `cwd` at `at` (ISO): the folder becomes a place,
   * or its `lastActiveAt` moves forward. A folder the service never exports
   * (a filesystem root, on its real path) or one that is not there is not
   * added. Answers whether anything changed. */
  touchPlace(cwd: string, at?: string): boolean {
    this.#load();
    const when = at ?? (this.#opts.now ?? (() => new Date()))().toISOString();
    const realPath = this.#exportableReal(cwd);
    if (realPath === null) return false;
    const existing = this.#places.get(cwd);
    if (existing !== undefined) {
      if (
        existing.lastActiveAt >= when &&
        existing.missing !== true &&
        existing.realPath === realPath
      )
        return false;
      this.#places.set(cwd, {
        ...existing,
        lastActiveAt: existing.lastActiveAt >= when ? existing.lastActiveAt : when,
        missing: false,
        realPath,
      });
    } else {
      this.#places.set(cwd, {
        path: cwd,
        addedAt: when,
        lastActiveAt: when,
        missing: false,
        realPath,
      });
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
      const realPath = this.#exportableReal(cwd);
      if (realPath === null) continue;
      const existing = this.#places.get(cwd);
      if (existing === undefined) {
        this.#places.set(cwd, {
          path: cwd,
          addedAt: at,
          lastActiveAt: at,
          missing: false,
          realPath,
        });
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

  /** The folder's real path when the service may export it: a directory
   * whose real path is not a filesystem root; otherwise null. */
  #exportableReal(path: string): string | null {
    if (!(this.#opts.isDirectory ?? defaultIsDirectory)(path)) return null;
    const real = (this.#opts.realpath ?? defaultRealpath)(path);
    if (real === null || isFilesystemRoot(real, this.#platform)) return null;
    return real;
  }

  /** Refresh saved roots' missing state; a flip is persisted and heard.
   * Places and picks both retain their canonical identity when a path
   * becomes a link: a place against the real path it was touched with, a
   * pick against its own (canonical) path. */
  refresh(rootId?: string): boolean {
    this.#load();
    const isDirectory = this.#opts.isDirectory ?? defaultIsDirectory;
    let changed = false;
    for (const [path, place] of this.#places) {
      if (rootId !== undefined && rootIdFor("place", path) !== rootId) continue;
      const real = this.#exportableReal(path);
      // a place recorded before its identity was adopts it on first sight
      const realPath = place.realPath ?? real ?? undefined;
      const missing = real === null || real !== realPath;
      if ((place.missing === true) !== missing || realPath !== place.realPath) {
        this.#places.set(path, {
          ...place,
          missing,
          ...(realPath !== undefined ? { realPath } : {}),
        });
        changed = true;
      }
    }
    for (const [path, picked] of this.#picked) {
      if (rootId !== undefined && rootIdFor("picked", path) !== rootId) continue;
      const missing = !isDirectory(path) || (this.#opts.realpath ?? defaultRealpath)(path) !== path;
      if ((picked.missing === true) !== missing) {
        this.#picked.set(path, { ...picked, missing });
        changed = true;
      }
    }
    if (changed) {
      this.#persist();
      this.#emit();
    }
    return changed;
  }

  /** Mark one saved root missing (the worker found its folder gone mid-ask). */
  markMissing(rootId: string): void {
    this.#load();
    for (const [path, place] of this.#places) {
      if (rootIdFor("place", path) !== rootId || place.missing === true) continue;
      this.#places.set(path, { ...place, missing: true });
      this.#persist();
      this.#emit();
      return;
    }
    for (const [path, picked] of this.#picked) {
      if (rootIdFor("picked", path) !== rootId || picked.missing === true) continue;
      this.#picked.set(path, { ...picked, missing: true });
      this.#persist();
      this.#emit();
      return;
    }
  }

  /** Every root, in the order an answer gives them: places newest first,
   * picks by path, then home and volumes. Saved roots carry the disk's word
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
    for (const picked of [...this.#picked.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push({
        rootId: rootIdFor("picked", picked.path),
        name: displayName(picked.path, platform),
        path: picked.path,
        device,
        kind: "picked",
        missing: picked.missing === true,
        lastActiveAt: null,
      });
    }
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
