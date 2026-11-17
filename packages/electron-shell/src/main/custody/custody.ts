import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { CUSTODY, type CustodyLevel, SHELL_CUSTODY_AUDIT_ACTIONS } from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import type { Logger } from "@vibefield/logging";
import type { Keystore } from "./keystore";
import type { ResolvedCustodyLevel } from "./level";
import { type OldPairStopSeams, type OldProcessEntry, stopOldPairs } from "./old-pair";
import {
  type CustodyProvider,
  type CustodyProviderOptions,
  createCustodyProvider,
} from "./provider";
import {
  type CustodyRootReading,
  type CustodyRootState,
  FIELDD_NOT_STARTED,
  openCustodyRoot,
} from "./root";

// OB custody, C1 (EL7-PLAN §3.2; CUSTODY-SPEC §7, v0.14) — the shell's custody, whole: the level this boot runs at,
// the root under the OS keystore, each user root's hand-off, and the gate every pair's start goes through.
//
// NO KEY OR CUSTODY CONCEPT REACHES A PERSON (James, 2026-11-10): the app runs, or a start failed. There is no sheet,
// no door for a window, no act a person presses and no sentence about any of this. Everything here happens by itself.
//
// At `files` it is inert on purpose: no keystore is made (the maker is never called), nothing is read or written,
// nothing is looked for or signalled, and `gate` hands back the very function it was given. Every dev run, smoke and
// existing test lives there, byte for byte as before.
//
// At `sealed` the root is read ONCE, here, before the first supervisor is asked for anything (root.ts):
//   · It opened: pairs start as they always have, each handed its secrets on stdin.
//   · It was made in this boot (none was kept, or the one kept did not open): the pair an older root sealed can
//     never be reached again, so before ANY start goes on the older processes are looked for and stopped
//     (old-pair.ts), once for the boot, and every start waits for that.
//   · It is unavailable: no pair is started and nothing is derived. A start is refused as any failed start is
//     refused, with one constant that names nothing of this (root.ts's FIELDD_NOT_STARTED), and the splash's Retry
//     works by itself: A PERSON'S ASK while the root is unavailable reads it again from the top, and goes on if it
//     opened or was made.
//
// WHO READS AN UNAVAILABLE ROOT AGAIN: a person's ask, and nobody else. A reading is a call to the OS keystore, and
// on a locked keychain it may be a prompt. Asks reach this gate that nobody made (a timer: the updater's census
// watch, every minute while an update is staged and with no window open; an audit append; a support preview), so the
// gate reads only for `person: true`, which the pair's coordinator hands on from a window's bootstrap and its Retry,
// a switch to a person and the status item's Try Again. Every other ask is answered from the last reading, with the
// same refusal a fresh reading would give, so no caller can tell the two apart and none retries because of it. And a
// person's asks read at most once in CUSTODY.ROOT_REREAD_MIN_MS, counted from when the last reading STARTED (the
// boot's own is the first), for a Retry pressed fast. `person` is read here and taken off: no supervisor is handed
// it, at any level. This rests on one fact of root.ts: a root that became ready never goes back, so `unavailable` is
// reachable only before the first ready reading.
//
// What is recorded: every reading and every older process, in main's own log (`desktop.custody.*`) at once. The
// audit trail has one door, fieldd's `audit.append`, and an append needs a pair that is UP: so what happened before
// one existed waits in memory (the newest AUDIT_KEPT) and is appended once, in order, through the first pair that
// comes up, each record saying when the thing happened and that it waited. An append is never what starts a pair:
// it is asked on that pair's own handle, and if the pair is gone by then, or the door refuses, each record the trail
// did not take is written to main's log instead (`desktop.custody.audit_unappended`) and nothing is tried again.
// THE EDGE, accepted: a refused start that no pair follows in the same boot is in main's log and NOT in the audit
// trail. A second audit writer in main would cost more on the EL7 review surface than that gap is worth.
// Neither the log nor the trail ever carries a secret, the wrapped bytes or a path: a user is named by their id, and
// an error by its code, never by its message (a file error's message is where a path would ride in).

/** How many records wait for a pair: the newest. A keystore that never answers must not grow main without end. */
const AUDIT_KEPT = 32;

/** What a log line or an audit record says of a reading or of an older process: plain facts, never a secret. */
type Facts = Record<string, string | number | boolean | string[]>;

/** What a log line says of an error: its `code`, else its `kind`, NEVER its message. A file error's message carries
 * the absolute path, which holds the person's home folder, and main's log rides into a support bundle. A code is
 * said when it is a plain token or a whole number (node's file errors carry one). With no such code, a `kind` that
 * is a plain token is said: fieldd's client throws a refusal with a kind and no code, and a refused append is the
 * one case the line is there for. A path put in either is not said, and anything else is "unknown". Those two
 * fields are read, and nothing else of the error. */
const CODE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/u;
function codeOf(error: unknown): string | number {
  if (typeof error !== "object" || error === null) return "unknown";
  const { code, kind } = error as { code?: unknown; kind?: unknown };
  if (typeof code === "number" && Number.isSafeInteger(code)) return code;
  if (typeof code === "string" && CODE_TOKEN.test(code)) return code;
  if (typeof kind === "string" && CODE_TOKEN.test(kind)) return kind;
  return "unknown";
}

/** What a record is about when no one user root is: the root itself, and a floor the machine's ledger alone named. */
const SHELL_ROOT: AuditAppendV1["target"] = { kind: "custody-root", id: "shell" };
const MACHINE: AuditAppendV1["target"] = { kind: "vibefield-root", id: "machine" };

/** What a pair's start takes: a supervisor's own `ensure` options, and nothing of custody's. */
export interface PairStartOptions {
  readonly signal?: AbortSignal;
}

/** How a start is asked for through the gate. */
export interface GatedAsk extends PairStartOptions {
  /** A PERSON asked: the only ask that reads an unavailable root again. Read by the gate and taken off. */
  readonly person?: boolean;
}

/** What the gate hands a start: the ask's signal, or nothing. It is what a supervisor's `ensure` was handed before
 * the gate knew who asked, so `person` reaches no supervisor at any level. */
const startOptions = (ask: GatedAsk | undefined): PairStartOptions | undefined =>
  ask?.signal === undefined ? undefined : { signal: ask.signal };

/** One user of this install as custody needs them: who they are in main's log, and where their pair's files are. */
export interface CustodyUserRoot {
  readonly userId: string;
  readonly root: string;
}

export interface ShellCustodyOptions<Pair = unknown> {
  readonly level: ResolvedCustodyLevel;
  /** the VibeField root, above the user roots */
  readonly vibefieldRoot: string;
  /** Makes the OS keystore. Called once, and only at `sealed`. */
  keystore(): Keystore;
  /** every user root of this install, in fuid order, as it stands when asked */
  userRoots(): readonly CustodyUserRoot[];
  /** the platform log root: a floor's own log lock is one of the files that names it (old-pair.ts) */
  readonly logRoot: string;
  /** fieldd's `audit.append`, asked of a pair that is already up: never something that would start one */
  readonly audit?: ((through: Pair, record: AuditAppendV1) => Promise<unknown>) | undefined;
  readonly log?: Pick<Logger, "info" | "warn"> | undefined;
  /** the rows' seams; production leaves each to its default */
  readonly randomBytes?: ((size: number) => Buffer) | undefined;
  readonly derive?: CustodyProviderOptions["derive"];
  readonly isOurChild?: CustodyProviderOptions["isOurChild"];
  readonly stop?: OldPairStopSeams | undefined;
  /** when a thing happened, for what is recorded of it: the wall clock */
  readonly now?: (() => number) | undefined;
  /** how long ago the last reading started, in milliseconds: a clock that never runs backwards */
  readonly monotonic?: (() => number) | undefined;
}

export interface ShellCustody<Pair = unknown> {
  readonly level: CustodyLevel;
  /** `ready` at `files`, always */
  state(): CustodyRootState;
  /** Wraps a pair's start. While the root is unavailable the start is refused and never called, and only a person's
   * ask reads the root again; after a root made in this boot it waits until the older processes have been judged.
   * The start is handed the ask's signal and never who asked. At `files` it is asked at once, with that alone. */
  gate(start: (options?: PairStartOptions) => Promise<Pair>): (ask?: GatedAsk) => Promise<Pair>;
  /** One user root's custody for its supervisor (the same one each time, so the marks it noted outlive a supervisor
   * that was rebuilt); `undefined` at `files`. */
  forUserRoot(userRoot: string): CustodyProvider | undefined;
  /** The shell's pairing secret for a user root, for an adopt-only probe; `undefined` at `files`. Throws while the
   * root is unavailable: there is no secret then, and no token to fall back on. */
  shellSecret(userRoot: string): string | undefined;
}

/** Custody at the `files` level: nothing to open, nothing to hand, nothing to gate. */
function filesCustody<Pair>(): ShellCustody<Pair> {
  return {
    level: "files",
    state: () => "ready",
    gate: (start) => (ask) => start(startOptions(ask)),
    forUserRoot: () => undefined,
    shellSecret: () => undefined,
  };
}

export function createShellCustody<Pair = unknown>(
  options: ShellCustodyOptions<Pair>,
): ShellCustody<Pair> {
  if (options.level.level === "files") return filesCustody<Pair>();
  const own = options.level.own;
  const log = options.log;
  const now = options.now ?? Date.now;
  const monotonic = options.monotonic ?? (() => performance.now());
  const providers = new Map<string, CustodyProvider>();
  /** The judging of the older processes, when this boot made its root: every start waits on it. Settled otherwise. */
  let oldPairs: Promise<void> = Promise.resolve();
  /** What waits for a pair to be appended through; `null` once the first pair came up and was handed it. */
  let waiting: AuditAppendV1[] | null = [];

  const defer = (
    action: string,
    target: AuditAppendV1["target"],
    outcome: "succeeded" | "failed",
    attrs: Facts,
  ): void => {
    if (waiting === null) return;
    waiting.push({
      action,
      target,
      phase: "outcome",
      outcome,
      operationId: randomUUID(),
      // when the thing HAPPENED, not when it is appended
      attrs: { ...attrs, at: now(), deferred: true },
    });
    if (waiting.length > AUDIT_KEPT) waiting.shift();
  };

  /** The first pair is up: what waited is appended through it, once, in order, and no start waits for that. A pair
   * that is gone by then, or a door that refuses, fails no start and STARTS none: the first append that fails ends
   * the appending, and every record the trail did not take is written to main's log instead, whole. Nothing is
   * tried again, by this start or a later one. */
  const pairUp = (pair: Pair): void => {
    const records = waiting;
    if (records === null) return;
    waiting = null;
    const audit = options.audit;
    if (audit === undefined || records.length === 0) return;
    void (async () => {
      let appended = 0;
      try {
        for (const record of records) {
          await audit(pair, record);
          appended += 1;
        }
      } catch (error) {
        log?.warn(
          "desktop.custody.audit_unavailable",
          "Not every record that waited for a pair reached the audit trail; this log has them",
          { kept: records.length, appended, code: codeOf(error) },
        );
        for (const record of records.slice(appended)) {
          log?.warn(
            "desktop.custody.audit_unappended",
            "A record that waited for a pair did not reach the audit trail; this line holds it",
            {
              action: record.action,
              target: record.target,
              outcome: record.outcome,
              attrs: record.attrs ?? {},
            },
          );
        }
      }
    })();
  };

  /** One older process that was stopped or left, taken AS ITS OUTCOME IS DECIDED: main's log at once, and its record
   * to wait. The record's `at` is read here, so it is when this happened and not when the walk ended (a walk can
   * last minutes). */
  const tookOldProcess = (userIds: ReadonlyMap<string, string>, entry: OldProcessEntry): void => {
    // a floor the ledger alone named belongs to no one user: it is recorded against the machine
    const userId = (entry.userRoot === null ? undefined : userIds.get(entry.userRoot)) ?? null;
    const said: Facts = {
      role: entry.role,
      outcome: entry.outcome,
      sources: [...entry.sources],
      pid: entry.pid,
    };
    if (entry.why !== undefined) said["why"] = entry.why;
    let message = "An older process was left running";
    if (entry.outcome === "stopped") {
      message = "An older fieldd was stopped";
      if (entry.role === "floor") {
        // main cannot know how many sessions a floor held: the fact is said, and never a number of them
        said["sessionsEnded"] = true;
        message = "An older floor was stopped; its terminal sessions ended with it";
      }
    }
    log?.warn("desktop.custody.old_process", message, { userId, ...said });
    defer(
      SHELL_CUSTODY_AUDIT_ACTIONS.PAIR,
      userId === null ? MACHINE : { kind: "user-root", id: userId },
      entry.outcome === "stopped" ? "succeeded" : "failed",
      said,
    );
  };

  /** The walk has ended: what it found, as counts on one line, and ONE record for every candidate that was not
   * reached, met after the bound or after the budget (a planted file must not fill the log or the trail either).
   * Nothing waits once either is met, so the walk's end is when those candidates were met. `gone` is main's log
   * only, and only as a count. */
  const tookWalk = (userRoots: number, entries: readonly OldProcessEntry[]): void => {
    const count = (is: (entry: OldProcessEntry) => boolean): number => entries.filter(is).length;
    const overBound = count((entry) => entry.why === "over-bound");
    const overBudget = count((entry) => entry.why === "over-budget");
    if (overBound + overBudget > 0) {
      const unreached: Facts = {
        outcome: "left",
        why: overBound > 0 ? "over-bound" : "over-budget",
        count: overBound + overBudget,
      };
      // both in one walk: the record says how many of its count the budget left, and the rest are the bound's
      if (overBound > 0 && overBudget > 0) unreached["overBudget"] = overBudget;
      defer(SHELL_CUSTODY_AUDIT_ACTIONS.PAIR, MACHINE, "failed", unreached);
    }
    const left = count((entry) => entry.outcome === "left");
    const walked = {
      userRoots,
      named: entries.length,
      stopped: count((entry) => entry.outcome === "stopped"),
      left,
      gone: count((entry) => entry.outcome === "gone"),
      overBound,
      overBudget,
    };
    const message = "The older processes a new custody root can no longer reach were looked for";
    if (left > 0) log?.warn("desktop.custody.old_pairs_walked", message, walked);
    else log?.info("desktop.custody.old_pairs_walked", message, walked);
  };

  /** CUSTODY-SPEC §7.2, for the whole machine, once. Never rejects: whatever it could not do, the starts go on. */
  const judgeOldPairs = async (): Promise<void> => {
    try {
      const users = options.userRoots();
      const userIds = new Map(users.map((user): [string, string] => [user.root, user.userId]));
      const entries = await stopOldPairs({
        ...options.stop,
        own,
        vibefieldRoot: options.vibefieldRoot,
        userRoots: users.map((user) => user.root),
        logRoot: options.logRoot,
        onDecided: (entry) => {
          // nobody was there, or it was not reached (the bound, the budget): the walk's own line, at its end
          if (entry.outcome === "gone") return;
          if (entry.why === "over-bound" || entry.why === "over-budget") return;
          tookOldProcess(userIds, entry);
        },
      });
      tookWalk(users.length, entries);
    } catch (error) {
      log?.warn(
        "desktop.custody.old_pairs_unwalked",
        "The older processes could not be looked for; nothing was signalled after that",
        { code: codeOf(error) },
      );
    }
  };

  /** One reading of the root, taken: said in main's log, kept for the trail, and followed by what it calls for. */
  const took = (reading: CustodyRootReading): void => {
    if (reading.outcome === "opened") {
      // not audited: a root that simply opened is every ordinary boot
      log?.info("desktop.custody.root_opened", "The kept custody root opened", {
        outcome: reading.outcome,
      });
      return;
    }
    if (reading.outcome === "unavailable") {
      const said = { outcome: reading.outcome, cause: reading.cause };
      defer(SHELL_CUSTODY_AUDIT_ACTIONS.ROOT, SHELL_ROOT, "failed", said);
      log?.warn(
        "desktop.custody.root_unavailable",
        "The custody root is unavailable; nothing was made and no pair is started",
        said,
      );
      return;
    }
    // before anything else can run or fail: every start from here waits until the older processes have been judged
    oldPairs = judgeOldPairs();
    const said = { outcome: reading.outcome };
    defer(SHELL_CUSTODY_AUDIT_ACTIONS.ROOT, SHELL_ROOT, "succeeded", said);
    if (reading.outcome === "made-unopenable") {
      log?.warn(
        "desktop.custody.root_made",
        "The kept custody key did not open and was renamed aside; a new root was made",
        said,
      );
    } else {
      log?.info("desktop.custody.root_made", "No custody key was kept; a root was made", said);
    }
  };

  /** When the last reading of the root STARTED. The boot's own, just below, is the first. */
  let readAt = monotonic();
  const root = openCustodyRoot({
    vibefieldRoot: options.vibefieldRoot,
    keystore: options.keystore(),
    randomBytes: options.randomBytes,
  });
  took(root.reading);

  /** A start may go on: the root is ready, and what a root made in this boot calls for is done. While it is
   * unavailable only a person's ask reads it again, from the top, and not sooner than CUSTODY.ROOT_REREAD_MIN_MS
   * after the reading before it started: an ask inside that, and every ask nobody made, gets the last reading's
   * answer. A reading is taken in one step, so there is never a second one under way. */
  const admit = (person: boolean): Promise<void> => {
    if (root.state !== "ready" && person) {
      const at = monotonic();
      if (at - readAt >= CUSTODY.ROOT_REREAD_MIN_MS) {
        readAt = at;
        try {
          took(root.read());
        } catch {
          // a reading that could not be taken leaves the root as it was
        }
      }
    }
    if (root.state !== "ready") return Promise.reject(new Error(FIELDD_NOT_STARTED));
    return oldPairs;
  };

  const forUserRoot = (userRoot: string): CustodyProvider => {
    const kept = providers.get(userRoot);
    if (kept !== undefined) return kept;
    const provider = createCustodyProvider({
      root: () => root.bytes(),
      userRoot,
      own,
      derive: options.derive,
      isOurChild: options.isOurChild,
    });
    providers.set(userRoot, provider);
    return provider;
  };

  return {
    level: "sealed",
    state: () => root.state,
    gate: (start) => (ask) =>
      admit(ask?.person === true)
        .then(() => start(startOptions(ask)))
        .then((pair) => {
          pairUp(pair);
          return pair;
        }),
    forUserRoot,
    shellSecret: (userRoot) => forUserRoot(userRoot).shellSecret(),
  };
}
