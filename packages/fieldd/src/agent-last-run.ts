import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AgentLastRunGone,
  type AgentLastRunResult,
  type AgentModelBoardRow,
  AgentModelSnapshot,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { type ModelBoardSources, ModelProjection } from "./agent-model-board";
import { RpcCallError } from "./native-link";

// LR (James, 2026-10-15 — the focus session's ruling: "fieldd keeps it") —
// WHAT THE LAST RUN LEFT.
//
// When the floor dies (a reboot, a crash, a teardown that took field-native
// with it), every session on it goes, and the next launch used to know only
// the deck's own layout: "this deck had N panes last time". James's ruling is
// that Godview opens on last run's picture instead — every view drawing the
// board as it stood, still, under the restore question — and that the picture
// is the BACKEND's fact, kept here, so whatever view was on screen at the end,
// and whichever window asks, the picture is the true last state.
//
// What is kept is ONE picture, never a history ("Godview stays runtime only",
// 2026-10-03, narrowed by this ruling and no further):
//
//   last-board.json — this desktop's model board as it stands (the local cut a
//     window reads, `agent-model-board.ts`), rewritten as the board moves, at
//     most once per `writeDelayMs`. Taken only while the floor is connected: a
//     floor that dies before fieldd does would otherwise have its sessions'
//     exits written over the picture of them running.
//   left-board.json — the picture a boot (or a floor that came back) found its
//     sessions missing from, held until a window answers restore or start
//     clean (`forget`), so a second restart before the answer keeps the
//     question. A later picture merges into it by row id, the later row
//     winning.
//
// What a window is told (`read`) is the held picture whole and the rows whose
// sessions did not survive: an agent whose record can still continue it
// (`continuable` — `agent.resume {runtimeRunId}` is the restore, through the
// SIGNED record, never through a row of these files), and a bare terminal the
// floor no longer lists. A held picture with nothing gone is forgotten on its
// own: a restart the floor survived asks nothing (GT-3's silence).

/** The board the picture is taken of: as it stands, and when it moves. */
export interface LastRunBoard {
  snapshot(): AgentModelSnapshot;
  subscribe(onChange: () => void): () => void;
}

/** The model board a window reads (`agent-model-board.ts`), as a picture's
 * source: the same projection, its own revision chain. */
export function modelBoardSource(sources: ModelBoardSources): LastRunBoard {
  const projection = new ModelProjection();
  return {
    snapshot: () => {
      projection.apply(sources);
      return projection.snapshot();
    },
    subscribe: (onChange) => {
      const offFold = sources.fold.subscribe(() => onChange());
      const offModel = sources.monitor.subscribe(() => onChange());
      return () => {
        offFold();
        offModel();
      };
    },
  };
}

/** One picture: the board and when it was taken. */
interface Picture {
  asOf: string;
  board: AgentModelSnapshot;
}

/** How long after a picture is held before "not alive now" is believed: the
 * boot's re-attach grace (`EXIT_GRACE_MS`, 1.5 s) with room, and the time a
 * floor that came back takes to list what it still holds. */
export const LAST_RUN_SETTLE_MS = 3_000;
/** The picture's floor: a busy board moves many times a second, and one write
 * per interval is all the next boot needs. */
export const LAST_RUN_WRITE_MS = 1_500;

export interface LastRunKeeperOptions {
  /** `LAYOUT.AGENT_LAST_BOARD_FILE`, resolved */
  lastPath: string;
  /** `LAYOUT.AGENT_LEFT_BOARD_FILE`, resolved */
  leftPath: string;
  board: LastRunBoard;
  /** the floor is connected — a picture is taken only while it is */
  floorUp: () => boolean;
  /** this boot's re-attach has run and decided every record it held */
  settled: () => boolean;
  /** the floor sessions alive now; undefined while the floor's inventory is unknown */
  liveSessions: () => ReadonlySet<string> | undefined;
  /** the runs the fold holds now */
  liveRuns: () => ReadonlySet<string>;
  /** an agent's record could be continued by `agent.resume {runtimeRunId}` */
  continuable: (runtimeRunId: string) => boolean;
  now?: () => Date;
  writeDelayMs?: number;
  settleMs?: number;
  logger?: Logger;
}

export class LastRunKeeper {
  private readonly logger: Logger;
  private readonly now: () => Date;
  private held: Picture | undefined;
  /** when the held picture was taken up (the settle clock starts there) */
  private heldAt = 0;
  /** the picture this boot last wrote */
  private last: Picture | undefined;
  private writtenRevision = -1;
  private floorWasUp = true;
  private evaluated = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly opts: LastRunKeeperOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
  }

  /** Read what the last run left, then start taking this run's picture. The
   * read comes first: nothing this boot writes may reach the last one's. */
  start(): void {
    const left = this.readPicture(this.opts.leftPath, "left");
    const previous = this.readPicture(this.opts.lastPath, "last");
    this.hold(mergePictures(left, previous));
    this.unsubscribe = this.opts.board.subscribe(() => this.schedule());
    this.schedule();
  }

  /** `agent.lastRun`. UNAVAILABLE (retryable) until "not alive now" can be
   * believed: before the re-attach has settled a session not yet re-attached
   * is not gone, and before the floor lists its sessions none can be judged. */
  read(): AgentLastRunResult {
    if (!this.ready()) {
      throw new RpcCallError(
        "UNAVAILABLE",
        "what the last run left is not known until the restart has settled",
        true,
        { service: "agent-last-run", state: "starting" },
      );
    }
    const held = this.held;
    if (held === undefined) return { state: "none" };
    const gone = this.goneOf(held);
    if (gone.length === 0) {
      this.drop("every session the last run held survived");
      return { state: "none" };
    }
    return { state: "left", asOf: held.asOf, board: held.board, gone };
  }

  /** `agent.lastRunForget` — the window's answer is in. */
  forget(): { forgotten: boolean } {
    const forgotten = this.held !== undefined;
    this.drop("a window answered");
    return { forgotten };
  }

  /** The picture as the run ends: taken now, when the floor is up. */
  dispose(): void {
    if (this.disposed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    try {
      this.take();
    } catch (error) {
      this.logger.warn("fieldd.agents.last_run_write_failed", "The last picture was not kept", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.disposed = true;
  }

  private ready(): boolean {
    return (
      this.opts.settled() &&
      this.opts.liveSessions() !== undefined &&
      this.now().getTime() - this.heldAt >= (this.opts.settleMs ?? LAST_RUN_SETTLE_MS)
    );
  }

  private goneOf(held: Picture): AgentLastRunGone[] {
    const sessions = this.opts.liveSessions() ?? new Set<string>();
    const runs = this.opts.liveRuns();
    const gone: AgentLastRunGone[] = [];
    for (const row of held.board.rows) {
      const sessionId = row.terminal?.runtimeSessionId;
      if (row.kind === "terminal") {
        if (!sessions.has(row.runtimeRunId)) {
          gone.push({ id: row.runtimeRunId, kind: "terminal", ...withSession(sessionId) });
        }
        continue;
      }
      // a run the picture shows ENDED was closed before the run did — it is
      // not something the last run left open
      if (!runningIn(row) || runs.has(row.runtimeRunId)) continue;
      if (!this.opts.continuable(row.runtimeRunId)) continue;
      gone.push({ id: row.runtimeRunId, kind: "agent", ...withSession(sessionId) });
    }
    return gone;
  }

  private schedule(): void {
    if (this.timer !== null || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (error) {
        this.logger.warn(
          "fieldd.agents.last_run_write_failed",
          "The board's picture was not kept",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }, this.opts.writeDelayMs ?? LAST_RUN_WRITE_MS);
    this.timer.unref?.();
  }

  private tick(): void {
    if (!this.opts.floorUp()) {
      // frozen: the picture keeps the sessions the floor took with it
      this.floorWasUp = false;
      return;
    }
    if (!this.floorWasUp) {
      // the floor came back under this fieldd: whatever it lost is left, as a
      // boot would find it
      this.floorWasUp = true;
      this.hold(mergePictures(this.held, this.last));
    }
    this.take();
    this.settleOnce();
  }

  /** A held picture with nothing gone is forgotten without being asked — once
   * the restart has settled, so a session still re-attaching is not read as
   * one that survived and then dropped. */
  private settleOnce(): void {
    if (this.evaluated || this.held === undefined || !this.ready()) return;
    this.evaluated = true;
    if (this.goneOf(this.held).length === 0) this.drop("every session the last run held survived");
  }

  private take(): void {
    if (!this.opts.floorUp()) return;
    const board = this.opts.board.snapshot();
    if (board.revision === this.writtenRevision) return;
    const picture: Picture = { asOf: this.now().toISOString(), board };
    writePicture(this.opts.lastPath, picture);
    this.last = picture;
    this.writtenRevision = board.revision;
  }

  private hold(picture: Picture | undefined): void {
    this.evaluated = false;
    this.heldAt = this.now().getTime();
    if (picture === undefined || picture.board.rows.length === 0) {
      this.held = undefined;
      return;
    }
    this.held = picture;
    try {
      writePicture(this.opts.leftPath, picture);
    } catch (error) {
      this.logger.warn("fieldd.agents.last_run_hold_failed", "The left picture was not kept", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.logger.info("fieldd.agents.last_run_held", "Holding what the last run left", {
      rows: picture.board.rows.length,
      asOf: picture.asOf,
    });
  }

  private drop(why: string): void {
    if (this.held === undefined) return;
    this.held = undefined;
    rmSync(this.opts.leftPath, { force: true });
    this.logger.info("fieldd.agents.last_run_dropped", "The last run's picture was let go", {
      why,
    });
  }

  /** A picture file, or nothing: an absent file is the common case, and one
   * that does not parse is set aside in the log — a picture is never a reason
   * to fail a boot. */
  private readPicture(path: string, which: "last" | "left"): Picture | undefined {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      this.logger.warn("fieldd.agents.last_run_unreadable", "A board picture could not be read", {
        which,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as { v?: unknown; asOf?: unknown; board?: unknown };
      const board = AgentModelSnapshot.safeParse(parsed.board);
      if (parsed.v !== 1 || typeof parsed.asOf !== "string" || !board.success) {
        throw new Error("not a version-1 board picture");
      }
      return { asOf: parsed.asOf, board: board.data };
    } catch (error) {
      this.logger.warn("fieldd.agents.last_run_unreadable", "A board picture could not be read", {
        which,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}

/** A run the picture shows running: the fold's liveness, and no exit the
 * chrome's facts had already seen. */
function runningIn(row: AgentModelBoardRow): boolean {
  if (!("alive" in row) || row.alive !== true) return false;
  const local = (row as { local?: { exited?: boolean } }).local;
  return local?.exited !== true;
}

function withSession(sessionId: string | undefined): { sessionId?: string } {
  return sessionId !== undefined && sessionId !== "" ? { sessionId } : {};
}

/** Two pictures as one: rows by id, the later picture's row winning, the
 * later picture's moment. Either may be absent. */
export function mergePictures(
  earlier: Picture | undefined,
  later: Picture | undefined,
): Picture | undefined {
  if (earlier === undefined) return later;
  if (later === undefined) return earlier;
  const rows = new Map<string, AgentModelBoardRow>();
  for (const row of earlier.board.rows) rows.set(row.runtimeRunId, row);
  for (const row of later.board.rows) rows.set(row.runtimeRunId, row);
  return {
    asOf: later.asOf > earlier.asOf ? later.asOf : earlier.asOf,
    board: { revision: later.board.revision, rows: [...rows.values()] },
  };
}

/** 0600 in a 0700 directory, through a private temp file and a durable
 * rename, as the session records are written. */
function writePicture(path: string, picture: Picture): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ v: 1, ...picture })}\n`, { mode: 0o600, flag: "wx" });
  durableRenameSync(tmp, path);
  if (process.platform !== "win32" && (statSync(path).mode & 0o777) !== 0o600) {
    chmodSync(path, 0o600);
  }
}
