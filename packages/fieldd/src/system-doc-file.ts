import { mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createNoopLogger, durableRename, type Logger } from "@vibefield/logging";

// SystemDocFile (DS-5c, 2026-10-01 — the DS wave 1 review's DS-5 list) — the
// at-rest file of ONE system document (the library today; the settings
// document when DS-5b registers it with the host), shared so every system
// document gets the same three guarantees:
//
//   · ONE WRITER. A local commit's persist and a peer merge's persist (the
//     host's `SystemDocOwner.persist`) never interleave: writes run one at a
//     time, and a call made while a write is still WAITING joins it — the
//     snapshot is taken when a write RUNS, so the write that waited carries
//     everything committed before it began. The bug this closes: two persists
//     shared one `.tmp` name, and the older snapshot could land last.
//   · DURABLE. `<file>.<pid>.tmp` → fsync → the previous file renamed to
//     `<file>.last-good` → the tmp renamed in → the directory fsync'd
//     (`durableRename` carries the win32 retry). A crash between the two
//     renames leaves no `<file>`, and the loader reads the last good copy.
//   · NEVER FIRST BOOT BY ACCIDENT. A file whose bytes the document will not
//     take (Loro verifies a checksum before it applies anything — probed: a
//     truncated snapshot throws and leaves the doc empty) is moved aside as
//     `<file>.torn-<ms>` — evidence, and out of the rotation, so the next
//     write cannot rename a torn file over the good copy — and the last good
//     copy loads instead. Before this, ANY read failure read as "first boot":
//     an empty library, and the tombstones and renames no peer had yet were
//     gone.
//
// Stale `<file>.<pid>.tmp` files a crashed process left are swept at load.

export interface SystemDocFileOptions {
  /** The document's file. */
  path: string;
  /** The bytes to persist, taken when a write RUNS (a full snapshot). */
  snapshot: () => Uint8Array;
  logger?: Logger;
}

/** Which copy a load read. */
export type SystemDocLoad = "current" | "last-good" | "none";

export class SystemDocFile {
  readonly #path: string;
  readonly #lastGood: string;
  readonly #snapshot: () => Uint8Array;
  readonly #log: Logger;
  /** The tail of the writer queue. */
  #running: Promise<void> = Promise.resolve();
  /** A write queued and not started yet — a later call joins it. */
  #waiting: Promise<void> | null = null;
  #dirReady = false;

  constructor(opts: SystemDocFileOptions) {
    this.#path = opts.path;
    this.#lastGood = `${opts.path}.last-good`;
    this.#snapshot = opts.snapshot;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "docs.system_file" });
  }

  /** Read the newest copy the document takes into `apply`, which THROWS on
   * bytes it cannot take (`LoroDoc.import`). "none" only when neither copy
   * exists or can be taken — logged loudly when one existed. */
  async load(apply: (bytes: Uint8Array) => void): Promise<SystemDocLoad> {
    await this.#sweepTmp();
    for (const [file, which] of [
      [this.#path, "current"],
      [this.#lastGood, "last-good"],
    ] as const) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await readFile(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.#log.error(
            "fieldd.docs.system_file_unreadable",
            "A system document's file could not be read",
            error,
            {
              file: which,
            },
          );
        }
        continue;
      }
      try {
        apply(bytes);
      } catch (error) {
        this.#log.error(
          "fieldd.docs.system_file_torn",
          "A system document's file is torn; it is kept aside",
          error,
          {
            file: which,
            bytes: bytes.byteLength,
          },
        );
        await durableRename(file, `${file}.torn-${Date.now()}`).catch(() => undefined);
        continue;
      }
      if (which === "last-good") {
        this.#log.warn(
          "fieldd.docs.system_file_fell_back",
          "A system document loaded its last good copy; its newest write is lost",
          { bytes: bytes.byteLength },
        );
      }
      return which;
    }
    return "none";
  }

  /** Persist the document's snapshot — durably, and one write at a time. */
  persist(): Promise<void> {
    if (this.#waiting !== null) return this.#waiting;
    const run = this.#running
      .catch(() => undefined)
      .then(() => {
        this.#waiting = null; // started: a later call queues behind it
        return this.#write(this.#snapshot());
      });
    this.#waiting = run;
    this.#running = run;
    return run;
  }

  /** Resolves once every write already asked for has landed (or failed). */
  drained(): Promise<void> {
    return this.#running.catch(() => undefined);
  }

  async #write(bytes: Uint8Array): Promise<void> {
    const dir = dirname(this.#path);
    if (!this.#dirReady) {
      await mkdir(dir, { recursive: true });
      this.#dirReady = true;
    }
    const tmp = `${this.#path}.${process.pid}.tmp`;
    try {
      const fd = await open(tmp, "w", 0o600);
      try {
        await fd.writeFile(bytes);
        await fd.sync();
      } finally {
        await fd.close();
      }
      // The previous file becomes the last good copy, then the new one lands:
      // each step one atomic rename.
      await durableRename(this.#path, this.#lastGood).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error; // first write: nothing to keep yet
      });
      await durableRename(tmp, this.#path);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    // The renames persist with the directory. Windows cannot fsync one (EPERM);
    // the atomic renames still hold — doc-service.ts's atomicWrite posture.
    if (process.platform !== "win32") {
      const dirFd = await open(dir, "r");
      try {
        await dirFd.sync();
      } finally {
        await dirFd.close();
      }
    }
  }

  /** `<file>.<pid>.tmp` left by a process that died mid-write. */
  async #sweepTmp(): Promise<void> {
    const name = basename(this.#path);
    let entries: string[];
    try {
      entries = await readdir(dirname(this.#path));
    } catch {
      return; // no directory yet: nothing was ever written
    }
    for (const entry of entries) {
      if (!entry.startsWith(`${name}.`) || !/^\d+\.tmp$/.test(entry.slice(name.length + 1)))
        continue;
      await rm(join(dirname(this.#path), entry), { force: true }).catch(() => undefined);
    }
  }
}
