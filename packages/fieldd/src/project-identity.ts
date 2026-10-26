import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { ProjectIdentityFile } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import {
  createMemoryProjectIdentityStore,
  type MemoryProjectIdentityStore,
  type ProjectIdentityStore,
} from "@vibefield/puppeteer-monitor";

// MV-3a (L4) — THE PROJECT'S COLOUR IS IDENTITY, NOT HISTORY.
//
// The monitor backend (puppeteer-monitor, beside the runtime in this daemon)
// asks its `ProjectIdentityStore` for a project's colour sequence and deals the
// next one when the key is new; it never persists. This is the host's half:
// the dealt keys and the `next` counter, in `users/<fuid>/fieldd/
// project-identity.json` (LAYOUT `PROJECT_IDENTITY_FILE`, 0600), so a daemon
// restart does not reshuffle every project's colour — which is what the
// renderer's localStorage ledger (`project-ledger.ts`) used to prevent, one
// window at a time. The dealing rule is the backend's memory store's (first
// seen, from 0, never rewound, never reused); this file only remembers it.
//
// Private on purpose: a key is the project's canonical ROOT — a path, which
// carries the OS username and the shape of a person's disk (EL7 B1 is why the
// field row names folders). It never leaves this file; what crosses a door is
// the sequence, and only to this desktop's own windows (M16).

/** How many dealt keys the file keeps. A desktop runs agents in a handful of
 * projects; past the bound the OLDEST-dealt keys go, and `next` keeps counting
 * so a dropped key that returns is dealt a fresh sequence, never a retired one
 * (the renderer's ledger kept 256 for the same reason). */
export const PROJECT_IDENTITY_MAX_KEYS = 1024;

export interface ProjectIdentityStoreOptions {
  /** the file (LAYOUT `PROJECT_IDENTITY_FILE` under the user root); absent =
   * memory only, for tests and for a daemon with no root to write */
  file?: string | undefined;
  maxKeys?: number | undefined;
  logger?: Logger | undefined;
  now?: (() => number) | undefined;
}

export interface FileProjectIdentityStore extends ProjectIdentityStore {
  /** every dealt key and its sequence, oldest deal first */
  entries(): ReadonlyMap<string, number>;
  /** the next sequence to deal */
  next(): number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The identity store fieldd hands the backend: the memory store's rule, written
 * through to the file on every new deal (a deal is rare — once per project per
 * daemon lifetime — so the write is synchronous and whole, like the terminal
 * bindings record). A file this fieldd cannot read is set aside and the record
 * starts empty: colours are then re-dealt once, which is honest, and never
 * again.
 */
export function createProjectIdentityStore(
  opts: ProjectIdentityStoreOptions = {},
): FileProjectIdentityStore {
  const logger = opts.logger ?? createNoopLogger();
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? PROJECT_IDENTITY_MAX_KEYS;
  const loaded = load(opts.file, logger, now);
  const memory: MemoryProjectIdentityStore = createMemoryProjectIdentityStore(
    loaded.projects.map((entry) => [entry.key, entry.seq] as const),
    { next: loaded.next },
  );
  // The bound is applied to what is WRITTEN: the memory store keeps every key
  // it dealt this lifetime (a live row must keep its colour), the file keeps
  // the newest `maxKeys` deals, and `next` keeps the dropped ones retired.
  const save = (): void => {
    const file = opts.file;
    if (file === undefined) return;
    const all = [...memory.entries()].map(([key, seq]) => ({ key, seq }));
    const kept = all.length > maxKeys ? all.slice(all.length - maxKeys) : all;
    const record: ProjectIdentityFile = { version: 1, next: memory.next(), projects: kept };
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      durableRenameSync(tmp, file);
      if (process.platform !== "win32" && (statSync(file).mode & 0o777) !== 0o600)
        chmodSync(file, 0o600);
    } catch (error) {
      rmSync(tmp, { force: true });
      logger.warn(
        "fieldd.monitor.identity_unwritten",
        "The project identity record could not be written; it is kept in memory",
        { error: messageOf(error) },
      );
    }
  };
  return {
    seq: (key) => memory.seq(key),
    deal(key) {
      const known = memory.seq(key);
      if (known !== undefined) return known;
      const seq = memory.deal(key);
      save();
      return seq;
    },
    entries: () => memory.entries(),
    next: () => memory.next(),
  };
}

/** The record as read: an absent file is empty; one this fieldd cannot read is
 * set aside beside itself and the record starts empty, said once. */
function load(
  file: string | undefined,
  logger: Logger,
  now: () => number,
): { next: number; projects: ProjectIdentityFile["projects"] } {
  const empty = { next: 0, projects: [] };
  if (file === undefined) return empty;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    logger.warn(
      "fieldd.monitor.identity_unreadable",
      "The project identity record could not be read; colours are dealt afresh",
      { error: messageOf(error) },
    );
    return empty;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const parsed = ProjectIdentityFile.safeParse(raw);
  if (!parsed.success) {
    const aside = `${file}.unreadable-${now()}`;
    logger.warn(
      "fieldd.monitor.identity_set_aside",
      "The project identity record is not one this fieldd reads; it was set aside and colours are dealt afresh",
      { aside },
    );
    try {
      renameSync(file, aside);
    } catch {
      // the next deal replaces it
    }
    return empty;
  }
  return { next: parsed.data.next, projects: parsed.data.projects };
}
