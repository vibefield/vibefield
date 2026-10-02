import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  AGENT_HISTORY,
  type AgentHistoryChange,
  type AgentMonitorMirror,
  type AgentRunHistory,
  type AgentSessionRecord,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { boundText } from "./agent-field";

// TL (2026-10-02, TL-D8) — the status ledger: what each managed run was doing
// over time, kept beside the session records because the fold already sees
// every change (`applyMonitor`) and keeps running while Godview is closed.
// `agent.history` answers from it (`agent-history.ts` in the contracts).
//
// ON DISK: `users/<fuid>/agents/history/<runtimeRunId>.jsonl`
// (LAYOUT.AGENT_HISTORY_DIR), the directory 0700 and each file 0600, APPENDED
// one JSON line per event while the run lives:
//
//   {"k":"from","at":ISO}                          where the record begins (first line)
//   {"k":"change","status":S,"at":ISO,"blocker"?:{kind,detail?}}
//   {"k":"did","did":TEXT}                         the closed working span's last line
//
// A `did` line belongs to the change before it, and only to a `working` one.
// Appends are NOT fsync'd: this is display data, and a crash costs at most the
// lines the OS had not written yet — never a session, never a decision. A
// file that grows past twice MAX_CHANGES lines is compacted by rewrite (a
// private temp file, durably renamed over it, the record store's discipline).
//
// EL7 — a same-uid agent can write into this directory, so its contents are
// UNTRUSTED input to a reader that is fieldd: a run id must be a plain file
// name before it becomes a path; files are opened with O_NOFOLLOW and must be
// regular, single-linked files (a hard link to the person's own file would
// otherwise take our appends); at most the last MiB of a file is read; a line
// that is oversized, unparsable, out of order or of an unknown kind is
// skipped; every text is cut to `AGENT_HISTORY.TEXT_CHARS`. A file that fails
// those checks at a WRITE is replaced whole — a rename replaces the link it
// lands on, never what the link points at.

/** A run id as a file name: puppeteer's are uuids; nothing with a separator,
 * a leading dot or `..` ever reaches `join`. */
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isLedgerRunId(runtimeRunId: string): boolean {
  return SAFE_RUN_ID.test(runtimeRunId) && !runtimeRunId.includes("..");
}

/** How much of a file a load reads, from its end. */
export const LEDGER_READ_BYTES = 1024 * 1024;
/** The longest line a load accepts (a legitimate line is a few hundred bytes). */
export const LEDGER_LINE_CHARS = 4096;
/** A status or blocker kind longer than this is not a word this ledger records. */
const WORD_CHARS = 64;
/** How often a long-lived fieldd sweeps retention (besides at boot). */
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const SUFFIX = ".jsonl";

/** One change as the ledger holds it: epoch ms beside the wire's ISO text. */
interface HeldChange {
  status: string;
  atMs: number;
  blocker?: { kind: string; detail?: string } | undefined;
  did?: string | undefined;
}

/** The first blocker's kind and words, bounded: puppeteer's `detail`, else a
 * question blocker's first prompt (Core's `questions[].prompt`, read off the
 * passthrough mirror the way the desk row reads it). */
export function blockerOf(
  mirror: AgentMonitorMirror | undefined,
): { kind: string; detail?: string } | undefined {
  const first = mirror?.blockers[0] as Record<string, unknown> | undefined;
  if (first === undefined || typeof first["kind"] !== "string") return undefined;
  const kind = boundText(first["kind"], WORD_CHARS);
  let words = typeof first["detail"] === "string" ? first["detail"] : undefined;
  if (words === undefined && Array.isArray(first["questions"])) {
    const question = first["questions"][0] as Record<string, unknown> | undefined;
    if (typeof question?.["prompt"] === "string") words = question["prompt"];
  }
  return words === undefined || words.length === 0
    ? { kind }
    : { kind, detail: boundText(words, AGENT_HISTORY.TEXT_CHARS) };
}

/** One run's ledger, in memory, appending to its file. */
export class RunLedger {
  private recordedFromMs: number;
  private readonly changes: HeldChange[] = [];
  /** the open working span's last line has reached the file */
  private didPersisted = true;
  /** lines in the file as this ledger knows it (what triggers a compaction) */
  private linesOnDisk = 0;
  /** the file is not ours to append to as it stands: rewrite before the next line */
  private needsRewrite = true;

  constructor(
    private readonly store: AgentStatusLedgers,
    readonly runtimeRunId: string,
    recordedFromMs: number,
  ) {
    this.recordedFromMs = recordedFromMs;
  }

  /** The status from `at` on. A repeat of the current status is no change;
   * `at` never runs backwards past the last change, nor ahead of now. */
  change(status: string, at: number, blocker?: { kind: string; detail?: string }): void {
    if (status.length === 0 || status.length > WORD_CHARS) return;
    const last = this.changes.at(-1);
    if (last?.status === status) return;
    const now = this.store.nowMs();
    const atMs = Math.max(
      Number.isFinite(at) ? Math.min(at, now) : now,
      last?.atMs ?? this.recordedFromMs,
    );
    const lines: string[] = [];
    if (last?.status === "working" && last.did !== undefined && !this.didPersisted) {
      lines.push(JSON.stringify({ k: "did", did: last.did }));
    }
    const held: HeldChange = {
      status,
      atMs,
      ...(status === "blocked" && blocker !== undefined ? { blocker } : {}),
    };
    this.changes.push(held);
    this.didPersisted = true;
    lines.push(changeLine(held));
    this.bound();
    this.persist(lines);
  }

  /** The working span's latest activity line: kept in memory, and written
   * when the span closes (so a crash mid-span loses that one line). */
  activity(line: string | undefined): void {
    const last = this.changes.at(-1);
    if (line === undefined || line.length === 0 || last?.status !== "working") return;
    const did = boundText(line, AGENT_HISTORY.TEXT_CHARS);
    if (did === last.did) return;
    last.did = did;
    this.didPersisted = false;
  }

  /** Write the open span's `did` now (a graceful stop, an exit). */
  flush(): void {
    const last = this.changes.at(-1);
    if (last?.status !== "working" || last.did === undefined || this.didPersisted) return;
    this.didPersisted = true;
    this.persist([JSON.stringify({ k: "did", did: last.did })]);
  }

  get lastStatus(): string | undefined {
    return this.changes.at(-1)?.status;
  }

  /** The wire's view at `now`: trimmed to the horizon (the change straddling
   * the cut is kept, starting AT the cut, and `recordedFrom` moves up to it),
   * oldest first. Every change's `at` is at or after `recordedFrom`. */
  snapshot(now: number, exitedAt?: string): AgentRunHistory {
    const cut = now - AGENT_HISTORY.HORIZON_MS;
    const { from, kept } = trimmed(this.recordedFromMs, this.changes, cut);
    return {
      runtimeRunId: this.runtimeRunId,
      recordedFrom: new Date(from).toISOString(),
      changes: kept.map(wireChange),
      ...(exitedAt !== undefined ? { exitedAt } : {}),
    };
  }

  /** Load what a file says (a previous boot's appends), tolerantly. */
  load(text: string, whole: boolean): void {
    let lines = text.split("\n");
    // a tail read starts mid-line: the first piece is not a line
    if (!whole) lines = lines.slice(1);
    let fromSeen = false;
    let count = 0;
    for (const raw of lines) {
      if (raw.length === 0) continue;
      count += 1;
      if (raw.length > LEDGER_LINE_CHARS) continue;
      let line: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
        line = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const last = this.changes.at(-1);
      if (line["k"] === "from") {
        const at = isoMs(line["at"]);
        if (fromSeen || at === undefined || this.changes.length > 0) continue;
        fromSeen = true;
        this.recordedFromMs = at;
      } else if (line["k"] === "change") {
        const status = line["status"];
        const at = isoMs(line["at"]);
        if (typeof status !== "string" || status.length === 0 || status.length > WORD_CHARS)
          continue;
        if (at === undefined || at < (last?.atMs ?? (fromSeen ? this.recordedFromMs : at)))
          continue;
        if (!fromSeen && this.changes.length === 0) this.recordedFromMs = at;
        if (last?.status === status) continue;
        this.changes.push({ status, atMs: at, ...blockerAt(status, line["blocker"]) });
      } else if (line["k"] === "did") {
        if (last?.status === "working" && typeof line["did"] === "string") {
          last.did = boundText(line["did"], AGENT_HISTORY.TEXT_CHARS);
        }
      }
    }
    this.bound();
    this.linesOnDisk = count;
    // a file read only in part, or one past the compaction bound, is rewritten
    // whole at the first line this boot adds
    this.needsRewrite = !whole || count > 2 * AGENT_HISTORY.MAX_CHANGES;
  }

  /** At most MAX_CHANGES, the oldest dropped first; what was dropped is no
   * longer recorded, so `recordedFrom` moves up to the oldest kept. */
  private bound(): void {
    const over = this.changes.length - AGENT_HISTORY.MAX_CHANGES;
    if (over <= 0) return;
    this.changes.splice(0, over);
    this.recordedFromMs = this.changes[0]?.atMs ?? this.recordedFromMs;
  }

  private persist(lines: string[]): void {
    if (lines.length === 0) return;
    if (!this.needsRewrite && this.linesOnDisk + lines.length <= 2 * AGENT_HISTORY.MAX_CHANGES) {
      if (this.store.append(this.runtimeRunId, `${lines.join("\n")}\n`)) {
        this.linesOnDisk += lines.length;
        return;
      }
    }
    this.compact();
  }

  /** Rewrite the file whole from memory: trimmed to the horizon, bounded. */
  private compact(): void {
    const cut = this.store.nowMs() - AGENT_HISTORY.HORIZON_MS;
    const { from, kept } = trimmed(this.recordedFromMs, this.changes, cut);
    this.recordedFromMs = from;
    this.changes.splice(0, this.changes.length, ...kept);
    const lines = [JSON.stringify({ k: "from", at: new Date(from).toISOString() })];
    for (const change of this.changes) {
      lines.push(changeLine(change));
      if (change.did !== undefined) lines.push(JSON.stringify({ k: "did", did: change.did }));
    }
    const last = this.changes.at(-1);
    // the open span's line is on disk now, whether or not it had been
    if (last?.status === "working") this.didPersisted = true;
    if (this.store.rewrite(this.runtimeRunId, `${lines.join("\n")}\n`)) {
      this.linesOnDisk = lines.length;
      this.needsRewrite = false;
    }
  }

  /** Begin a FRESH file (a run the fold has just begun to record). */
  begin(): void {
    this.compact();
  }
}

/** The ledgers of this user's runs (one per run id, opened by the fold). */
export class AgentStatusLedgers {
  private readonly logger: Logger;
  private readonly ledgers = new Map<string, RunLedger>();
  private diskRefused = false;
  private lastSweepMs: number | undefined;

  constructor(private readonly opts: { dir: string; now: () => Date; logger?: Logger }) {
    this.logger = opts.logger ?? createNoopLogger();
  }

  nowMs(): number {
    return this.opts.now().getTime();
  }

  path(runtimeRunId: string): string {
    return join(this.opts.dir, `${runtimeRunId}${SUFFIX}`);
  }

  /** The run's ledger for the fold to write: a new record begins at
   * `recordedFrom` with the status unknown; `resume` (a re-attach after a
   * fieldd restart) carries on from the file a previous boot left. Undefined
   * for an id that cannot be a file name — the run is simply not recorded. */
  open(
    runtimeRunId: string,
    opts: { recordedFrom: number; resume: boolean },
  ): RunLedger | undefined {
    if (!this.validId(runtimeRunId)) return undefined;
    const held = this.ledgers.get(runtimeRunId);
    if (held !== undefined) return held;
    const loaded = opts.resume ? this.loadFile(runtimeRunId) : undefined;
    if (loaded !== undefined) {
      this.ledgers.set(runtimeRunId, loaded);
      return loaded;
    }
    const ledger = new RunLedger(this, runtimeRunId, opts.recordedFrom);
    this.ledgers.set(runtimeRunId, ledger);
    ledger.begin();
    ledger.change("unknown", opts.recordedFrom);
    return ledger;
  }

  /** A run this boot holds but does not observe (pending after a restart):
   * from `at` on its status is unknown. Only a run with a ledger already. */
  note(runtimeRunId: string, status: string, at: number): void {
    const ledger = this.get(runtimeRunId);
    if (ledger === undefined) return;
    ledger.flush();
    ledger.change(status, at);
  }

  /** The run's history at now, from memory or (once, then held) from disk. */
  history(runtimeRunId: string, exitedAt?: string): AgentRunHistory | undefined {
    return this.get(runtimeRunId)?.snapshot(this.nowMs(), exitedAt);
  }

  /** The run's ledger file goes, and the ledger with it. */
  remove(runtimeRunId: string): void {
    this.ledgers.delete(runtimeRunId);
    if (!this.validId(runtimeRunId)) return;
    try {
      unlinkSync(this.path(runtimeRunId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  /** Retention: a ledger whose run has no (verified) record goes, as does
   * one whose run exited more than HORIZON_MS ago, and a temp file a crashed
   * compaction left. `live` names the runs the fold holds right now. */
  sweep(records: readonly AgentSessionRecord[], live: ReadonlySet<string>): void {
    const now = this.nowMs();
    this.lastSweepMs = now;
    const keep = new Set<string>(live);
    for (const record of records) {
      const exited = record.exited === undefined ? undefined : Date.parse(record.exited.at);
      if (
        exited !== undefined &&
        Number.isFinite(exited) &&
        exited < now - AGENT_HISTORY.HORIZON_MS
      )
        continue;
      keep.add(record.runtimeRunId);
    }
    let names: string[];
    try {
      names = readdirSync(this.opts.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let removed = 0;
    for (const name of names) {
      const id = name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : undefined;
      const stray = name.endsWith(".tmp") && name.includes(SUFFIX);
      if (!stray && (id === undefined || keep.has(id))) continue;
      try {
        // unlink takes the directory entry, a planted link included — never its target
        unlinkSync(join(this.opts.dir, name));
        removed += 1;
      } catch {
        // gone already, or not ours to remove: the next sweep asks again
      }
      if (id !== undefined) this.ledgers.delete(id);
    }
    // a ledger held only in memory (its file never written) goes the same way
    for (const id of [...this.ledgers.keys()]) if (!keep.has(id)) this.ledgers.delete(id);
    if (removed > 0) {
      this.logger.info("fieldd.agents.history_swept", "Status ledgers past retention removed", {
        removed,
      });
    }
  }

  /** A sweep is due once an hour on a long-lived fieldd. */
  sweepDue(): boolean {
    return this.lastSweepMs === undefined || this.nowMs() - this.lastSweepMs >= SWEEP_EVERY_MS;
  }

  private get(runtimeRunId: string): RunLedger | undefined {
    if (!this.validId(runtimeRunId)) return undefined;
    const held = this.ledgers.get(runtimeRunId);
    if (held !== undefined) return held;
    const loaded = this.loadFile(runtimeRunId);
    if (loaded !== undefined) this.ledgers.set(runtimeRunId, loaded);
    return loaded;
  }

  private validId(runtimeRunId: string): boolean {
    return isLedgerRunId(runtimeRunId);
  }

  /** Read a previous boot's file: at most its last MiB, a regular file
   * reached without following a link. Absent or unsafe reads as no ledger. */
  private loadFile(runtimeRunId: string): RunLedger | undefined {
    const path = this.path(runtimeRunId);
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | NO_FOLLOW);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      this.logger.warn(
        "fieldd.agents.history_unsafe",
        "A status ledger could not be opened safely",
        {
          runtimeRunId,
          code: code ?? "unknown",
        },
      );
      return undefined;
    }
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) {
        this.logger.warn("fieldd.agents.history_unsafe", "A status ledger is not a regular file", {
          runtimeRunId,
        });
        return undefined;
      }
      const length = Math.min(info.size, LEDGER_READ_BYTES);
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const n = readSync(fd, buffer, read, length - read, info.size - length + read);
        if (n === 0) break;
        read += n;
      }
      const ledger = new RunLedger(this, runtimeRunId, info.mtimeMs);
      ledger.load(buffer.subarray(0, read).toString("utf8"), info.size <= LEDGER_READ_BYTES);
      // whether it is still ours to append to is asked again at every append
      return ledger.lastStatus === undefined ? undefined : ledger;
    } finally {
      closeSync(fd);
    }
  }

  /** Append to an existing file, only if it is still ours to append to: a
   * regular file, one link, this user's. False = rewrite it instead. */
  append(runtimeRunId: string, text: string): boolean {
    if (this.diskRefused) return true;
    let fd: number;
    try {
      fd = openSync(this.path(runtimeRunId), constants.O_WRONLY | constants.O_APPEND | NO_FOLLOW);
    } catch {
      return false;
    }
    try {
      const info = fstatSync(fd);
      if (!safeToAppend(info)) return false;
      if (process.platform !== "win32" && (info.mode & 0o777) !== 0o600) fchmodSync(fd, 0o600);
      // display data: no fsync per line (see the header)
      writeSync(fd, text);
      return true;
    } catch (error) {
      this.writeFailed(runtimeRunId, error);
      return true;
    } finally {
      closeSync(fd);
    }
  }

  /** Publish a whole file: the directory owner-only, a private temp file that
   * cannot pre-exist, durably renamed over whatever stood at the path. */
  rewrite(runtimeRunId: string, text: string): boolean {
    if (this.diskRefused || !this.ownDirectory()) return false;
    const path = this.path(runtimeRunId);
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
      durableRenameSync(tmp, path);
      return true;
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        // never written, or already renamed
      }
      this.writeFailed(runtimeRunId, error);
      return false;
    }
  }

  /** The directory exists, is a directory (not a link to one) and is 0700. */
  private ownDirectory(): boolean {
    const dir = this.opts.dir;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const info = lstatSync(dir);
      if (!info.isDirectory()) {
        this.diskRefused = true;
        this.logger.error(
          "fieldd.agents.history_dir_unsafe",
          "The status-ledger directory is not a directory; ledgers are kept in memory only",
          undefined,
          { dir },
        );
        return false;
      }
      if (process.platform !== "win32" && (statSync(dir).mode & 0o777) !== 0o700) {
        chmodSync(dir, 0o700);
      }
      return true;
    } catch (error) {
      this.writeFailed("", error);
      return false;
    }
  }

  private writeFailed(runtimeRunId: string, error: unknown): void {
    this.logger.warn("fieldd.agents.history_write_failed", "A status ledger could not be written", {
      runtimeRunId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

function safeToAppend(info: ReturnType<typeof fstatSync>): boolean {
  if (!info.isFile() || info.nlink !== 1) return false;
  if (process.platform === "win32" || typeof process.getuid !== "function") return true;
  return info.uid === process.getuid();
}

function isoMs(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function blockerAt(status: string, value: unknown): Pick<HeldChange, "blocker"> {
  if (status !== "blocked" || typeof value !== "object" || value === null) return {};
  const { kind, detail } = value as Record<string, unknown>;
  if (typeof kind !== "string" || kind.length === 0) return {};
  return {
    blocker: {
      kind: boundText(kind, WORD_CHARS),
      ...(typeof detail === "string" && detail.length > 0
        ? { detail: boundText(detail, AGENT_HISTORY.TEXT_CHARS) }
        : {}),
    },
  };
}

function changeLine(change: HeldChange): string {
  return JSON.stringify({
    k: "change",
    status: change.status,
    at: new Date(change.atMs).toISOString(),
    ...(change.blocker !== undefined ? { blocker: change.blocker } : {}),
  });
}

function wireChange(change: HeldChange): AgentHistoryChange {
  return {
    status: change.status,
    at: new Date(change.atMs).toISOString(),
    ...(change.blocker !== undefined ? { blocker: { ...change.blocker } } : {}),
    ...(change.status === "working" && change.did !== undefined ? { did: change.did } : {}),
  };
}

/** Changes from `cut` on: the last change before the cut is kept, moved up to
 * start AT it (the run was in that status when the horizon begins), and the
 * record begins no earlier than the cut. */
function trimmed(
  recordedFrom: number,
  changes: readonly HeldChange[],
  cut: number,
): { from: number; kept: HeldChange[] } {
  if (recordedFrom >= cut) return { from: recordedFrom, kept: [...changes] };
  let first = 0;
  while (first + 1 < changes.length && (changes[first + 1]?.atMs ?? Infinity) <= cut) first += 1;
  const kept = changes
    .slice(first)
    .map((change, index) => (index === 0 && change.atMs < cut ? { ...change, atMs: cut } : change));
  return { from: cut, kept };
}
