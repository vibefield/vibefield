import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LAYOUT, ShellExitRecord, type ShellLeaveReason } from "@vibefield/contracts";
import { durableRename, type Logger } from "@vibefield/logging";

// AL-7 (`draft/thinking-app-lifecycle.md` §8.1) — the shell lease, fieldd's half. A `shell-main` connection that
// claims it (`system.shell.attach`) holds it until it closes; a holder that says why first (`system.shell.leave`)
// leaves PLANNED, one that is simply gone leaves UNPLANNED. When the last holder goes, the record of how is written
// to `LAYOUT.SHELL_EXIT` — fieldd's to keep, so a fieldd that stops or dies before the next shell comes still hands it
// over — and the next attach takes it once. AL-5 reads the lease's vacancy (`onVacant`, `onHeld`) for the orphan bound.

export interface ShellLeaseOptions {
  /** the user root this fieldd serves */
  readonly dataDir: string;
  /** the floor's live session count now; null when it cannot be read (an inventory never observed) */
  readonly liveSessions: () => number | null;
  readonly logger: Logger;
  readonly now?: () => number;
  /** the last holder is gone, with the record of how (AL-5's bound starts here) */
  readonly onVacant?: (record: ShellExitRecord) => void;
  /** a holder is back after a vacancy */
  readonly onHeld?: () => void;
}

export class ShellLease {
  private readonly holders = new Set<string>();
  private readonly leaving = new Map<string, ShellLeaveReason>();
  private readonly path: string;
  private readonly now: () => number;
  private writes: Promise<void> = Promise.resolve();
  private sealed = false;

  constructor(private readonly opts: ShellLeaseOptions) {
    this.path = join(opts.dataDir, ...LAYOUT.SHELL_EXIT);
    this.now = opts.now ?? Date.now;
  }

  /** a shell holds the lease now */
  get held(): boolean {
    return this.holders.size > 0;
  }

  /** `system.shell.attach`: the connection holds the lease from now on; the record of how the last holder left,
   * once (a record still being written is the one handed over). */
  async attach(connectionId: string): Promise<ShellExitRecord | null> {
    const wasVacant = this.holders.size === 0;
    this.holders.add(connectionId);
    this.leaving.delete(connectionId);
    if (wasVacant) this.opts.onHeld?.();
    await this.writes;
    const lastExit = await this.take();
    this.opts.logger.info("fieldd.shell_lease.attached", "A shell holds the lease", {
      holders: this.holders.size,
      lastExit: lastExit === null ? null : lastExit.planned ? "planned" : "unplanned",
    });
    return lastExit;
  }

  /** `system.shell.leave`: the holder is leaving on purpose, and its close will read planned. false = this connection
   * holds no lease (a probe, or a shell that never attached). */
  leave(connectionId: string, why: ShellLeaveReason): boolean {
    if (!this.holders.has(connectionId)) return false;
    this.leaving.set(connectionId, why);
    return true;
  }

  /** fieldd is stopping (a `system.shutdown` it accepted, or its own stop): the closes that follow are fieldd's own,
   * never a shell leaving, so none of them is recorded. */
  seal(): void {
    this.sealed = true;
  }

  /** The connection closed (product-api's close hook). Only a holder's close can vacate the lease. */
  closed(connectionId: string): void {
    if (!this.holders.delete(connectionId) || this.sealed) return;
    const why = this.leaving.get(connectionId);
    this.leaving.delete(connectionId);
    if (this.holders.size > 0) return;
    const record: ShellExitRecord = {
      planned: why !== undefined,
      ...(why !== undefined ? { why } : {}),
      at: this.now(),
      sessions: this.opts.liveSessions(),
    };
    this.opts.logger.info(
      record.planned ? "fieldd.shell_lease.left" : "fieldd.shell_lease.lost",
      record.planned
        ? "The last shell left on purpose; the pair keeps running"
        : "The last shell went without saying why (a crash, a Force Quit or a signal); the pair keeps running",
      { why: record.why ?? null, sessions: record.sessions },
    );
    this.writes = this.writes
      .then(() => this.write(record))
      .catch((error: unknown) => {
        this.opts.logger.warn(
          "fieldd.shell_lease.record_failed",
          "The record of how the last shell left could not be written; the next shell will not hear it",
          { error: error instanceof Error ? error.message : String(error) },
        );
      });
    this.opts.onVacant?.(record);
  }

  /** Every record write settled (the daemon's stop, the tests). */
  flush(): Promise<void> {
    return this.writes;
  }

  private async take(): Promise<ShellExitRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return null;
    }
    await rm(this.path, { force: true });
    try {
      const parsed = ShellExitRecord.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // falls through: a garbled record is said, then read as none
    }
    this.opts.logger.warn(
      "fieldd.shell_lease.record_unreadable",
      "The record of how the last shell left could not be read; it was set aside",
    );
    return null;
  }

  private async write(record: ShellExitRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${randomBytes(6).toString("hex")}`;
    const fd = await open(tmp, "w", 0o600);
    try {
      await fd.writeFile(JSON.stringify(record));
      await fd.sync();
    } finally {
      await fd.close();
    }
    await durableRename(tmp, this.path);
  }
}
