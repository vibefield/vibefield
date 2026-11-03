import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type TerminalReleaseIntent, TerminalReleasesFile } from "@vibefield/contracts";
import { durableRenameSync, type Logger } from "@vibefield/logging";

const requestKey = (request: TerminalReleaseIntent): string =>
  `${request.sessionId}:${request.condition}`;

export type ReleaseState =
  | "released"
  | "gone"
  | "used"
  | "not-shell"
  | "attached"
  | "busy"
  | "running";

/** Owner-side obligations. Acknowledgement means the intent is on disk, not
 * that the PTY has disappeared. Only a native answer discharges an obligation;
 * transport failures and active views retain it across renderer/fieldd restarts.
 */
export class TerminalReleases {
  private pending = new Map<string, TerminalReleaseIntent>();
  private active = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly options: {
      file?: string | undefined;
      release(request: TerminalReleaseIntent): Promise<ReleaseState>;
      logger: Logger;
      retryMs?: number | undefined;
    },
  ) {
    if (options.file !== undefined) {
      try {
        const file = TerminalReleasesFile.parse(JSON.parse(readFileSync(options.file, "utf8")));
        this.pending = new Map(file.pending.map((request) => [requestKey(request), request]));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.arm();
  }

  list(): readonly TerminalReleaseIntent[] {
    return [...this.pending.values()];
  }

  enqueue(request: TerminalReleaseIntent): void {
    if (this.disposed) throw new Error("terminal release owner is stopped");
    const existing = this.pending.get(requestKey(request));
    if (existing?.condition === request.condition) return;
    const next = new Map(this.pending).set(requestKey(request), request);
    this.save(next);
    this.pending = next;
    this.arm();
  }

  async flush(): Promise<void> {
    if (this.disposed) return;
    await Promise.all(
      [...this.pending.values()].map(async (request) => {
        if (this.active.has(requestKey(request))) return;
        this.active.add(requestKey(request));
        try {
          const state = await this.options.release(request);
          if (this.disposed || this.pending.get(requestKey(request)) !== request) return;
          if (["released", "gone", "used", "not-shell"].includes(state)) {
            const next = new Map(this.pending);
            next.delete(requestKey(request));
            this.save(next);
            this.pending = next;
          }
        } catch (error) {
          this.options.logger.debug(
            "fieldd.terminal.release_pending",
            "Terminal release will retry",
            {
              sessionId: request.sessionId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        } finally {
          this.active.delete(requestKey(request));
        }
      }),
    );
    this.arm();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    if (this.disposed || this.timer !== undefined || this.pending.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.retryMs ?? 500);
    this.timer.unref?.();
  }

  private save(pending: ReadonlyMap<string, TerminalReleaseIntent>): void {
    const file = this.options.file;
    if (file === undefined) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, pending: [...pending.values()] }), {
        flag: "wx",
        mode: 0o600,
      });
      durableRenameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
