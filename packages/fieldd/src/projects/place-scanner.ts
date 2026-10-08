import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { PLACE_FACTS } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type {
  PlaceFactsArgs,
  PlaceGitRead,
  PlaceHit,
  PlaceRead,
  PlaceSampleSet,
} from "../workspace/protocol";
import { type FilesHostHealth, FilesHostUnavailable } from "../workspace/supervisor";
import {
  identityRemoteOf,
  normalizeRemotes,
  type PlaceFacts,
  placeIdFor,
} from "./place-facts-interim";

// PJ-1 (`thinking-project-places.md` §9; `build-pj.md` L1, L2, L3, L7) — the
// PLACE SCANNER: this desktop's places, read through the files worker's
// `placeFacts` and published on the history catalog's PROJECT ROWS (L1: no
// second table — an older peer would refuse one, and its refusal detaches the
// tables it does know).
//
// What it scans: every root path each of this desktop's rosetta project rows
// names, plus the worktrees `git worktree list` names for a checkout among
// them (PJ-D17 (a)) — a worktree rides the row of the checkout that named it
// unless a row of its own names it. When: at boot (the catalog's first
// snapshot, the worker's READY), when the catalog's project roots change,
// when a peer's places change (their samples are what this desktop's hits are
// looked for among), and on PLACE_FACTS.SCAN_INTERVAL_MS for what no event
// announces — each after CHANGE_SETTLE_MS of quiet, one pass at a time. A
// place's cheap read that still matches its cached key costs nothing more.
//
// L2 — no churn: a place's `observedAt` moves only when the digest of its
// facts does, and the catalog's table makes no frame for a row equal to the
// one it holds, so a pass over unchanged places publishes nothing.
//
// The facts are STICKY (§9): a place that is gone, or on a volume that left,
// keeps its last-known git facts; `exists` and `mounted` say which.
//
// L7 — `acted`: a place the person acted in through VibeField is the files
// service's places registry, read (never copied) and matched to this
// desktop's places by the longest path prefix. It is the engine's input, not
// a published fact.
//
// EL7: no path and no remote ever reaches a log line; the summary counts.

/** What the scanner asks the files worker (the supervisor's `request`). */
export interface PlaceFactsAsker {
  request(op: "placeFacts", args: PlaceFactsArgs): Promise<{ places: PlaceRead[] }>;
  health(): FilesHostHealth;
  on(event: "transition", listener: (health: FilesHostHealth) => void): unknown;
  off(event: "transition", listener: (health: FilesHostHealth) => void): unknown;
}

/** The catalog half the scanner reads and writes (index-catalog.ts). */
export interface PlaceCatalog {
  readonly ready: boolean;
  readonly projects: {
    rows(): ReadonlyArray<{ projectId: string; rootPaths: readonly string[] }>;
  };
  setPlaces(places: ReadonlyMap<string, readonly PlaceFacts[]>): void;
  on(event: "changed", listener: () => void): unknown;
  off(event: "changed", listener: () => void): unknown;
}

/** A root of the files service's registry, as `acted` reads it. */
export interface ActedRoot {
  path: string;
  kind: string;
  lastActiveAt: string | null;
}

export interface PlaceScannerOptions {
  catalog: PlaceCatalog;
  worker: PlaceFactsAsker;
  /** this desktop's id, read at every pass (it moves at most once, D30) */
  deviceId: () => string;
  /** the agent catalog's task roots (PJ-D21) */
  taskRoots: () => readonly string[];
  /** every PEER's places, read tolerantly off the replica (index-mesh.ts) */
  peerPlaces?: () => ReadonlyArray<{ device: string; places: readonly PlaceFacts[] }>;
  /** the files service's roots (roots.ts `roots()`): the `acted` evidence */
  actedRoots?: () => readonly ActedRoot[];
  now?: () => number;
  logger?: Logger;
  /** test seams (defaults: PLACE_FACTS) */
  intervalMs?: number;
  settleMs?: number;
  batchPlaces?: number;
  maxPlaces?: number;
}

/** The row an asked path rides: a rosetta root's own, or (discovered) the
 * row of the checkout whose worktree list named it. */
interface Owner {
  projectId: string;
  discovered: boolean;
}

/** What the scanner holds for one asked path. */
interface Entry {
  /** the latest read that finished */
  read: Extract<PlaceRead, { skipped: false }>;
  /** the last full git read (sticky: kept while the folder is gone) */
  git: PlaceGitRead | null;
  key: string | null;
  hits: PlaceHit[];
  hitsKey: string | null;
}

/** What a pass did, for the summary line and the tests. */
export interface PlaceScanSummary {
  asked: number;
  read: number;
  unchanged: number;
  skipped: number;
  places: number;
  /** places whose facts changed this pass (their `observedAt` moved) */
  changed: number;
  ms: number;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function realOr(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

export class PlaceScanner {
  readonly #opts: PlaceScannerOptions;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #settleMs: number;
  readonly #batch: number;
  readonly #max: number;
  readonly #intervalMs: number;
  /** asked path → what was read there */
  readonly #entries = new Map<string, Entry>();
  /** placeId → its facts' digest and when that digest last moved (L2) */
  readonly #observed = new Map<string, { digest: string; at: number }>();
  /** the places last published, by project */
  #published = new Map<string, PlaceFacts[]>();
  #rootsDigest: string | null = null;
  #peersDigest: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #interval: ReturnType<typeof setInterval> | null = null;
  #running: Promise<void> | null = null;
  #again = false;
  #started = false;
  #disposed = false;
  #last: PlaceScanSummary | null = null;

  constructor(opts: PlaceScannerOptions) {
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "place_scanner" });
    this.#now = opts.now ?? Date.now;
    this.#settleMs = opts.settleMs ?? PLACE_FACTS.CHANGE_SETTLE_MS;
    this.#batch = Math.max(1, opts.batchPlaces ?? PLACE_FACTS.BATCH_PLACES);
    this.#max = Math.max(1, opts.maxPlaces ?? PLACE_FACTS.MAX_PLACES);
    this.#intervalMs = opts.intervalMs ?? PLACE_FACTS.SCAN_INTERVAL_MS;
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#opts.catalog.on("changed", this.#onCatalog);
    this.#opts.worker.on("transition", this.#onWorker);
    if (this.#intervalMs > 0) {
      this.#interval = setInterval(() => this.scanSoon(), this.#intervalMs);
      this.#interval.unref?.();
    }
    this.scanSoon();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#opts.catalog.off("changed", this.#onCatalog);
    this.#opts.worker.off("transition", this.#onWorker);
    if (this.#timer !== null) clearTimeout(this.#timer);
    if (this.#interval !== null) clearInterval(this.#interval);
    this.#timer = null;
    this.#interval = null;
  }

  /** The places last published, by project (what the rows carry). */
  places(): ReadonlyMap<string, readonly PlaceFacts[]> {
    return this.#published;
  }

  /** The last pass's summary (null before the first). */
  lastPass(): PlaceScanSummary | null {
    return this.#last;
  }

  /** L7 — the places the person acted in through VibeField: each of the files
   * service's place and picked roots, matched to the published place whose
   * path (or an alias) is its longest prefix. placeId → the latest act (ISO),
   * or null for a pick. */
  acted(): Map<string, string | null> {
    const out = new Map<string, string | null>();
    const roots = this.#opts.actedRoots?.() ?? [];
    if (roots.length === 0) return out;
    const spellings: Array<{ prefix: string; placeId: string; caseless: boolean }> = [];
    for (const places of this.#published.values())
      for (const place of places)
        for (const path of [place.path, ...place.aliases])
          spellings.push({ prefix: path, placeId: place.placeId, caseless: place.caseless });
    for (const root of roots) {
      if (root.kind !== "place" && root.kind !== "picked") continue;
      const candidates = [root.path, realOr(root.path)];
      let best: { length: number; placeId: string } | null = null;
      for (const { prefix, placeId, caseless } of spellings) {
        const fold = (s: string) => (caseless ? s.toLowerCase() : s);
        const p = fold(prefix.replace(/[\\/]+$/, ""));
        const hit = candidates.some((candidate) => {
          const c = fold(candidate);
          return c === p || c.startsWith(`${p}/`) || c.startsWith(`${p}\\`);
        });
        if (hit && (best === null || p.length > best.length)) best = { length: p.length, placeId };
      }
      if (best === null) continue;
      const before = out.get(best.placeId);
      const at = root.lastActiveAt;
      if (before === undefined || (at !== null && (before === null || at > before)))
        out.set(best.placeId, at);
    }
    return out;
  }

  /** A peer's places may have moved: scan when their samples did. */
  peersChanged(): void {
    const next = digest(this.#peerCandidates());
    if (next === this.#peersDigest) return;
    this.scanSoon();
  }

  /** Scan after the settle; a burst of asks is one pass. */
  scanSoon(): void {
    if (this.#disposed || !this.#started || this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.scanNow();
    }, this.#settleMs);
    this.#timer.unref?.();
  }

  /** Scan now (or after the pass under way, once more). */
  async scanNow(): Promise<void> {
    if (this.#disposed) return;
    if (this.#running !== null) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      try {
        await this.#pass();
      } catch (error) {
        // the worker went away mid-pass: its next READY scans again
        if (error instanceof FilesHostUnavailable) return;
        this.#logger.warn(
          "fieldd.places.scan_failed",
          "A place scan failed; the next one retries",
          {
            error: error instanceof Error ? error.message.slice(0, 200) : String(error),
          },
        );
      } finally {
        this.#running = null;
        if (this.#again && !this.#disposed) {
          this.#again = false;
          this.scanSoon();
        }
      }
    })();
    return this.#running;
  }

  readonly #onCatalog = (): void => {
    if (!this.#opts.catalog.ready) return;
    if (this.#rootsDigest !== null && digest(this.#roots()) === this.#rootsDigest) return;
    this.scanSoon();
  };

  readonly #onWorker = (health: FilesHostHealth): void => {
    if (health.phase === "ready") this.scanSoon();
  };

  /** rosetta's roots, by project, in the table's order. */
  #roots(): Array<[string, string[]]> {
    return this.#opts.catalog.projects
      .rows()
      .map((row) => [row.projectId, [...row.rootPaths]] as [string, string[]]);
  }

  /** Every place's samples this desktop knows: its own (from the last
   * reads) and its peers' (the replica) — what hits are looked for among. */
  #peerCandidates(): PlaceSampleSet[] {
    const out: PlaceSampleSet[] = [];
    for (const places of this.#published.values())
      for (const place of places)
        if (place.root !== undefined && place.samples.length > 0)
          out.push({ placeId: place.placeId, root: place.root, samples: place.samples });
    for (const peer of this.#opts.peerPlaces?.() ?? [])
      for (const place of peer.places)
        if (place.root !== undefined && place.samples.length > 0)
          out.push({ placeId: place.placeId, root: place.root, samples: place.samples });
    const unique = new Map<string, PlaceSampleSet>();
    for (const set of out) if (!unique.has(set.placeId)) unique.set(set.placeId, set);
    return [...unique.values()].sort((a, b) =>
      a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0,
    );
  }

  async #pass(): Promise<void> {
    const catalog = this.#opts.catalog;
    if (!catalog.ready || this.#opts.worker.health().phase !== "ready") return;
    const started = this.#now();
    const roots = this.#roots();
    this.#rootsDigest = digest(roots);
    const candidates = this.#peerCandidates();
    this.#peersDigest = digest(candidates);
    const taskRoots = [...this.#opts.taskRoots()];
    const summary: PlaceScanSummary = {
      asked: 0,
      read: 0,
      unchanged: 0,
      skipped: 0,
      places: 0,
      changed: 0,
      ms: 0,
    };

    // the asked paths, each with the project whose row carries it
    const owners = new Map<string, Owner>();
    for (const [projectId, paths] of roots)
      for (const path of paths)
        if (!owners.has(path) && owners.size < this.#max)
          owners.set(path, { projectId, discovered: false });
    const asked = new Set<string>();
    let wave = [...owners.keys()];
    // a wave, then the worktrees it named that nobody asked about, twice at most
    for (let round = 0; round < 3 && wave.length > 0; round += 1) {
      for (let at = 0; at < wave.length; at += this.#batch) {
        const batch = wave.slice(at, at + this.#batch);
        for (const path of batch) asked.add(path);
        const answer = await this.#opts.worker.request("placeFacts", {
          places: batch.map((path) => this.#ask(path)),
          peers: candidates,
          taskRoots,
        });
        for (const read of answer.places) this.#take(read, summary);
      }
      const named: string[] = [];
      for (const path of wave) {
        const owner = owners.get(path);
        for (const worktree of this.#entries.get(path)?.git?.worktrees ?? []) {
          if (owners.has(worktree.path) || owner === undefined || owners.size >= this.#max)
            continue;
          owners.set(worktree.path, { projectId: owner.projectId, discovered: true });
          named.push(worktree.path);
        }
      }
      wave = named;
    }
    // what no row names any more is forgotten (a re-scan reads it afresh)
    for (const path of [...this.#entries.keys()]) if (!owners.has(path)) this.#entries.delete(path);

    const published = this.#assemble(owners, summary);
    this.#published = published;
    catalog.setPlaces(published);
    summary.asked = asked.size;
    summary.ms = this.#now() - started;
    this.#last = summary;
    if (summary.changed > 0 || summary.skipped > 0)
      this.#logger.info("fieldd.places.scanned", "Place facts read", { ...summary });
    // this desktop's own samples are candidates for its own places' hits: when
    // they moved, read the hits again (the next pass finds the rest unchanged)
    if (digest(this.#peerCandidates()) !== this.#peersDigest) this.#again = true;
    if (summary.skipped > 0) this.#again = true;
  }

  /** What the worker is told it may already know of a path. */
  #ask(path: string): PlaceFactsArgs["places"][number] {
    const entry = this.#entries.get(path);
    if (entry === undefined) return { path };
    const git = entry.git;
    // a root a walk could not finish is asked for again, not taken as known
    const rootOwed = git !== null && git.root === null && git.head !== null && !git.shallow;
    return {
      path,
      known: {
        key: rootOwed ? null : entry.key,
        root: git?.root ?? null,
        hitsKey: entry.hitsKey,
      },
    };
  }

  #take(read: PlaceRead, summary: PlaceScanSummary): void {
    if (read.skipped) {
      summary.skipped += 1;
      return;
    }
    const before = this.#entries.get(read.path);
    let git: PlaceGitRead | null;
    if (read.git === "unchanged") {
      git = before?.git ?? null;
      summary.unchanged += 1;
    } else {
      summary.read += 1;
      // sticky: a folder that is gone keeps what git last said of it
      git = read.exists || read.gitRefused !== null ? read.git : (before?.git ?? null);
    }
    const hits =
      read.hits === "unchanged"
        ? (before?.hits ?? [])
        : read.exists
          ? read.hits
          : (before?.hits ?? []);
    this.#entries.set(read.path, {
      read,
      git,
      key: read.exists ? read.key : (before?.key ?? null),
      hits,
      hitsKey: read.hits === "unchanged" ? (before?.hitsKey ?? null) : read.hitsKey,
    });
  }

  /** The published places, by project: one per canonical path on a row (its
   * other spellings as aliases), its root paths first, then its worktrees. */
  #assemble(
    owners: ReadonlyMap<string, Owner>,
    summary: PlaceScanSummary,
  ): Map<string, PlaceFacts[]> {
    const device = this.#opts.deviceId();
    const now = this.#now();
    const byProject = new Map<string, PlaceFacts[]>();
    /** placeIds a rosetta root already places, on any row */
    const rooted = new Set<string>();
    const seen = new Set<string>();
    for (const [path, { projectId, discovered }] of owners) {
      const entry = this.#entries.get(path);
      if (entry === undefined) continue; // never read yet: no facts to say
      const placeId = placeIdFor(device, entry.read.canonical);
      // a worktree a row of its own names rides that row, not its checkout's
      if (discovered && rooted.has(placeId)) continue;
      if (!discovered) rooted.add(placeId);
      const places = byProject.get(projectId) ?? [];
      const same = places.find((place) => place.placeId === placeId);
      if (same !== undefined) {
        if (path !== same.path && !same.aliases.includes(path)) same.aliases.push(path);
        continue;
      }
      places.push(this.#facts(entry, path, placeId, device));
      byProject.set(projectId, places);
    }
    // L2: `observedAt` moves only with the facts' digest
    for (const places of byProject.values()) {
      for (const place of places) {
        place.aliases.sort();
        const { observedAt: _, ...facts } = place;
        const factsDigest = digest(facts);
        const before = this.#observed.get(place.placeId);
        if (before?.digest === factsDigest) place.observedAt = before.at;
        else {
          place.observedAt = now;
          this.#observed.set(place.placeId, { digest: factsDigest, at: now });
          summary.changed += 1;
        }
        seen.add(place.placeId);
        summary.places += 1;
      }
    }
    for (const placeId of [...this.#observed.keys()])
      if (!seen.has(placeId)) this.#observed.delete(placeId);
    return byProject;
  }

  #facts(entry: Entry, asked: string, placeId: string, device: string): PlaceFacts {
    const { read, git } = entry;
    const remotes: Record<string, string> = {};
    for (const remote of git?.remotes ?? []) remotes[remote.name] = remote.url;
    const aliases = git?.sshAliases ?? {};
    const identity =
      git === null ? null : identityRemoteOf(remotes, git.pushRemote ?? undefined, aliases);
    const facts: PlaceFacts = {
      placeId,
      path: read.canonical,
      aliases: asked !== read.canonical ? [asked] : [],
      kind: read.kind,
      caseless: read.caseless,
      exists: read.exists,
      mounted: read.mounted,
      git: git !== null || read.gitRefused !== null,
      remotes: git === null ? [] : normalizeRemotes(remotes, aliases),
      samples: git?.samples ?? [],
      hits: entry.hits
        .filter((hit) => hit.placeId !== placeId)
        .map((hit) => ({ placeId: hit.placeId, sha: hit.sha, depth: hit.depth })),
      observedAt: 0,
    };
    if (read.homeRelative !== null) facts.homeRelative = read.homeRelative;
    if (identity !== null) facts.identityRemote = identity;
    if (git?.root) facts.root = git.root;
    if (git?.branch) facts.branch = git.branch;
    if (git?.worktreeOf) facts.worktreeOf = placeIdFor(device, git.worktreeOf);
    if (read.gitRefused !== null) facts.gitRefused = read.gitRefused;
    return facts;
  }
}
