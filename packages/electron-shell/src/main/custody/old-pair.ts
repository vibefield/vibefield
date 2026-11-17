import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { CUSTODY, FILES, LAYOUT, LOG_STREAMS } from "@vibefield/contracts";
import { pairLogRoot } from "@vibefield/logging";
import {
  type CodeIdentity,
  FIELD_NATIVE_SIGNING_IDENTIFIER,
  FIELDD_SIGNING_IDENTIFIER,
  processIsOurs,
} from "@vibefield/trust";
import type { CodeIdentityCheck } from "./level";

// OB custody, C1 (what follows a custody root MADE in this boot (none was kept, or the
// one kept did not open): the pair an older root sealed can never be reached again. An old floor refuses a hello
// under any other secret and keeps its old client; the new fieldd then starts no floor and exits; every start after
// that fails the same way. So, by itself and before anything is spawned, main looks for those processes and stops
// the ones that are its own. Nothing a person presses reaches this file, and below custody's `sealed` level nothing
// reaches it at all: a build with no signature has none to check against.
//
// OB-D21 A (`draft/thinking-objects-at-work.md`): an exception to WP12 D10.
// THE ONE PLACE this shell signals a pid it read from a file. WP12 D10 stands everywhere else (no signal to a pid
// read from a file), and here it is bought with a rule: A FILE ONLY EVER NOMINATES A PID. THE CHECK DECIDES.
//   · Three files nominate. `product.json` under each user root names the old fieldd and its floor. It is removed by
//     roads main takes every day while the floor lives on (an update that leaves the native plane alone, fieldd's
//     own graceful stop), so a floor is also looked for in its own log lock (there while its log writer is open,
//     through every rotation) and in the machine's admission ledger (there while it holds a session, which is when
//     stopping it costs a person something). A floor that no file names is not found: the start fails, and that
//     floor ends itself after ORPHAN_BOUND.IDLE_EXIT_MS without a session and without a client.
//   · They are read and nothing else: no lock is taken, nothing is written, removed or repaired. One that is not a
//     regular file, is over NAMING_FILE_MAX_BYTES or does not parse names nobody; a torn read is a miss, never a
//     danger. The ledger alone is read again when it is torn: every live floor rewrites it in place every few
//     seconds, and a reader that takes no lock can find it empty or half-written.
//   · A number from a file is a pid only if it is an integer above 1 that fits a pid and is not main's own. Zero
//     and the negatives address a whole process GROUP: none of them reaches the look, let alone the signal.
//   · A candidate is signalled only if the process at that pid, asked about IMMEDIATELY before the signal, is
//     VibeField's own binary of that name, signed by the shell's own team under the hardened runtime (trust's check,
//     always with the identifier: team and runtime alone would call any of VibeField's binaries safe to signal).
//     That proves the binary at that pid at that moment and no more. A pid can change hands between the check and
//     the signal: the process that verified would have to exit and its pid be given to another inside that one
//     step, and whatever then held it would be sent SIGTERM. A lock or a ledger entry can outlive its floor, and
//     its pid be another process's by now: that is what the check is for. A program running as the person that
//     rewrites a file can at most have VibeField stop a VibeField process it could have stopped itself.
//   · The identifier is not proof of "the daemon". `field-native door`, an agent's bridge to the floor's door, is
//     the same program as the floor (one binary, one identifier): a file that names one gets it a SIGTERM. Its own
//     uid could always send that. And fieldd's executable is also the files host.
//   · A pid is one candidate per ROLE. Named as a floor by several files, it is one floor, with every source; named
//     once as a fieldd and once as a floor, it is asked about under each identifier (else a planted product.json
//     that calls the floor's pid a fieldd would hide the floor from its own check).
//   · At most OLD_PAIR_CHECK_BOUND checks are made in a boot, so a planted file cannot have main run `codesign`
//     without end. A candidate met after that is left, unchecked and unsignalled.
//   · The signal is ONE, the polite one. Never a second, never a harder one, whatever the process does. A process
//     still alive when the bounded wait ends is left, and main goes on to a start that then fails by itself.
//   · The whole walk has ONE budget, CUSTODY.OLD_PAIR_WALK_BUDGET_MS (the time a start already waits at main for a
//     daemon to be ready), measured from its first look on a clock that never runs backwards. Each process may be
//     waited for, and sixteen of them would be minutes of splash before a start that then fails. When the budget is
//     spent the walk ENDS: a process that was signalled and is still there is left, whoever was not reached is left
//     as `over-budget`, and nothing more is looked at, asked about or signalled. A check that was still running
//     when the budget ran out is followed by no signal.
//
// The order is load-bearing, and the walk is one thing after another, never several at once: the user roots as they
// were given (fuid order), each root's fieldd FIRST and waited for, THEN its floor (a floor stopped under a live
// fieldd is a floor that fieldd starts again, and a live fieldd keeps the floor's client slot and its run files),
// and the ledger's floors last. The bound is counted in that order. Every file is read before the first signal: the
// old fieldd removes product.json as it stops.
//
// Main cannot count the sessions a stopped floor held (it cannot pair with a floor whose secret is gone, and
// nothing on disk counts them that it can vouch for), so nothing here carries a count of them.

/** How many `codesign` checks one boot makes, fieldd and floor candidates together: eight pairs. */
export const OLD_PAIR_CHECK_BOUND = 16;
/** A naming file larger than this names nobody. The largest honest one, the ledger, is a few hundred bytes. */
const NAMING_FILE_MAX_BYTES = 65_536;
/** How often the ledger is read while it is torn, and how long apart. After the last it names nobody. */
const LEDGER_READS = 3;
const LEDGER_READ_GAP_MS = 50;
/** The largest number a pid can be on any system this runs on, and the largest the signal call takes. */
const PID_MAX = 2 ** 31 - 1;
/** fieldd's graceful stop includes its plugins' deactivation (about five seconds at the outside); the floor's, its
 * sessions' end. Past the bound the process is `left`. */
const GONE_WAIT_MS = 8_000;
const GONE_POLL_MS = 100;

export type OldProcessSource = "product" | "log-lock" | "admission";

/** One process a file named, and what became of it. */
export interface OldProcessEntry {
  readonly role: "fieldd" | "floor";
  /** the user root whose files named it; `null` for a floor the machine's ledger alone named */
  readonly userRoot: string | null;
  readonly pid: number;
  /** every file that named this pid in this role, in the order they were read */
  readonly sources: readonly OldProcessSource[];
  /** `stopped`: verified, signalled and gone inside the bound · `gone`: no process was at that pid · `left`: see `why` */
  readonly outcome: "stopped" | "left" | "gone";
  /** present exactly when `outcome` is `left`: the process there is not VibeField's own binary of that name (or
   * could not be asked about) · it was signalled and is still there · it was met after the bound · the walk's
   * budget was spent before it was reached, or before it could be signalled */
  readonly why?: "not-ours" | "still-alive" | "over-bound" | "over-budget";
}

/** What the rows hand in place of the machine; production leaves each to its default. */
export interface OldPairStopSeams {
  /** trust's `processIsOurs` unless a test injects its own */
  readonly isOurs?: CodeIdentityCheck | undefined;
  /** SIGTERM to `pid`; throws when no process is there, or when it may not be signalled */
  readonly signal?: ((pid: number) => void) | undefined;
  /** whether a process is at `pid`; delivers no signal */
  readonly exists?: ((pid: number) => boolean) | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly goneWaitMs?: number | undefined;
  readonly pollMs?: number | undefined;
  /** main's own pid, never a candidate: `process.pid` unless a row says otherwise */
  readonly selfPid?: number | undefined;
  /** the walk's clock, in milliseconds: one that never runs backwards unless a row hands its own */
  readonly now?: (() => number) | undefined;
  /** the whole walk's budget: the registry's unless a row says otherwise */
  readonly budgetMs?: number | undefined;
}

export interface OldPairStopOptions extends OldPairStopSeams {
  /** the shell's own code identity (level.ts) */
  readonly own: CodeIdentity;
  /** the VibeField root, above the user roots: the admission ledger is under it */
  readonly vibefieldRoot: string;
  /** every user root main knows, in fuid order, whether or not it holds a product.json */
  readonly userRoots: readonly string[];
  /** the platform log root: each pair's log lock is under its own `pairLogRoot` of it */
  readonly logRoot: string;
  /** Told each outcome AS IT IS DECIDED, in the walk's order and before the next candidate is looked at, so that
   * what the caller records of it carries the time it happened (a walk can last minutes). What the caller does
   * with it never undoes it and never ends the walk. */
  readonly onDecided?: ((entry: OldProcessEntry) => void) | undefined;
}

interface Candidate {
  readonly role: "fieldd" | "floor";
  readonly userRoot: string | null;
  readonly pid: number;
  readonly sources: OldProcessSource[];
}

type Fate = Pick<OldProcessEntry, "outcome" | "why">;

/** What becomes of a candidate once the walk's budget is spent. */
const OVER_BUDGET: Fate = { outcome: "left", why: "over-budget" };

/** What a naming file gave. `torn`: a small regular file is there, and it is empty or not JSON. `absent`: no file,
 * or something that is not a small regular file this can read. */
type Naming =
  | { readonly read: "whole"; readonly value: unknown }
  | { readonly read: "torn" | "absent" };

const ABSENT: Naming = { read: "absent" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A naming file, read and nothing else. The look comes before the open so that a pipe or a device put at the path
 * is never opened (opening one can wait for ever), and the open neither follows a link nor waits. */
function readNaming(path: string): Naming {
  let fd: number;
  try {
    const looked = lstatSync(path);
    if (!looked.isFile() || looked.size > NAMING_FILE_MAX_BYTES) return ABSENT;
    // O_NOFOLLOW and O_NONBLOCK are absent on Windows, where this level never runs
    fd = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch {
    return ABSENT;
  }
  let text: string;
  try {
    // what was looked at may not be what was opened: the open file is asked again, and read to the bound alone
    if (!fstatSync(fd).isFile()) return ABSENT;
    const bytes = Buffer.alloc(NAMING_FILE_MAX_BYTES + 1);
    let read = 0;
    while (read < bytes.length) {
      const more = readSync(fd, bytes, read, bytes.length - read, null);
      if (more === 0) break;
      read += more;
    }
    if (read > NAMING_FILE_MAX_BYTES) return ABSENT;
    text = bytes.toString("utf8", 0, read);
  } catch {
    return ABSENT;
  } finally {
    closeSync(fd);
  }
  try {
    // parsed as JSON, never matched as text: no writer pins its key order
    return { read: "whole", value: JSON.parse(text) };
  } catch {
    return { read: "torn" };
  }
}

/** Whether a process is at `pid`, by the signal that delivers nothing. Only "no such process" is gone: a process
 * this may not signal lives, and so does anything else the look cannot read (the supervisor's own rule). */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Every process the three files name, in the order they are to be judged; then each judged, one at a time. */
export async function stopOldPairs(options: OldPairStopOptions): Promise<OldProcessEntry[]> {
  const isOurs: CodeIdentityCheck =
    options.isOurs ?? ((pid, own, expect) => processIsOurs(pid, own, expect));
  const signal = options.signal ?? ((pid: number) => void process.kill(pid, "SIGTERM"));
  const exists = options.exists ?? pidExists;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const goneWaitMs = options.goneWaitMs ?? GONE_WAIT_MS;
  const pollMs = options.pollMs ?? GONE_POLL_MS;
  const selfPid = options.selfPid ?? process.pid;
  const now = options.now ?? (() => performance.now());
  const budgetMs = options.budgetMs ?? CUSTODY.OLD_PAIR_WALK_BUDGET_MS;
  // The budget runs from here, the walk's first look (the first file is read just below), and once it is spent it
  // stays spent: the clock does not run backwards.
  const startedAt = now();
  const spent = (): boolean => now() - startedAt >= budgetMs;

  /** The guard, before ANYTHING is done with a number from a file. */
  const pidOf = (value: unknown): number | null =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 1 &&
    value <= PID_MAX &&
    value !== selfPid
      ? value
      : null;

  // The nominations, all of them, before anything is judged. One candidate per pid and role: named again in the
  // same role, by another file or under another root, it is the candidate it already is, with one more source.
  const candidates: Candidate[] = [];
  const named = new Map<string, Candidate>();
  const nominate = (
    role: "fieldd" | "floor",
    userRoot: string | null,
    value: unknown,
    source: OldProcessSource,
  ): void => {
    const pid = pidOf(value);
    if (pid === null) return;
    const already = named.get(`${role}:${pid}`);
    if (already !== undefined) {
      if (!already.sources.includes(source)) already.sources.push(source);
      return;
    }
    const candidate: Candidate = { role, userRoot, pid, sources: [source] };
    named.set(`${role}:${pid}`, candidate);
    candidates.push(candidate);
  };
  const lockName = `${LOG_STREAMS.SYSTEM_FIELD_NATIVE}.ndjson.lock`;
  for (const userRoot of options.userRoots) {
    // Never assume product.json belongs to the fieldd that is alive: a stopping fieldd can remove a newer one's run
    // files, and a stale file can name a pid that is no longer a fieldd. The file nominates; the check decides.
    const product = readNaming(join(userRoot, ...LAYOUT.PRODUCT_JSON));
    if (product.read === "whole" && isRecord(product.value)) {
      nominate("fieldd", userRoot, product.value["pid"], "product");
      nominate("floor", userRoot, product.value["nativePid"], "product");
    }
    const lock = readNaming(join(pairLogRoot(options.logRoot, userRoot), lockName));
    if (lock.read === "whole" && isRecord(lock.value)) {
      nominate("floor", userRoot, lock.value["pid"], "log-lock");
    }
  }
  // the ledger, once for the machine and after every user root; read again, a little later, only while it is torn
  const ledgerPath = join(options.vibefieldRoot, FILES.CUSTODY_ADMISSION_LEDGER);
  let ledger = readNaming(ledgerPath);
  for (let reads = 1; ledger.read === "torn" && reads < LEDGER_READS; reads += 1) {
    await sleep(LEDGER_READ_GAP_MS);
    ledger = readNaming(ledgerPath);
  }
  const held = ledger.read === "whole" && isRecord(ledger.value) ? ledger.value["entries"] : null;
  if (Array.isArray(held)) {
    for (const entry of held) {
      if (isRecord(entry)) nominate("floor", null, entry["pid"], "admission");
    }
  }

  /** Whether `pid` went inside its own bound and inside what is left of the walk's budget. Its own bound is counted
   * in polls, not read from a clock (it is the same in a row whose sleep is instant); the budget is the clock's. The
   * look comes first, so the wait ends with one last look at the moment either runs out. */
  const gone = async (pid: number): Promise<boolean> => {
    for (let waited = 0; ; waited += pollMs) {
      if (!exists(pid)) return true;
      if (waited >= goneWaitMs || spent()) return false;
      await sleep(pollMs);
    }
  };

  let checks = 0;
  const judge = async (candidate: Candidate): Promise<Fate> => {
    const pid = candidate.pid;
    // nobody there: nothing to stop, nothing to ask the tool about, and no check spent
    if (!exists(pid)) return { outcome: "gone" };
    if (checks >= OLD_PAIR_CHECK_BOUND) return { outcome: "left", why: "over-bound" };
    checks += 1;
    const expect = {
      identifier:
        candidate.role === "fieldd" ? FIELDD_SIGNING_IDENTIFIER : FIELD_NATIVE_SIGNING_IDENTIFIER,
    };
    let ours = false;
    try {
      // immediately before the signal, and nothing awaited in between
      ours = await isOurs(pid, options.own, expect);
    } catch {
      // a check that cannot be made is a doubt, and a doubt signals nothing
      ours = false;
    }
    if (!ours) return { outcome: "left", why: "not-ours" };
    // the check itself can take long: if the budget ran out under it, the walk has ended and nothing is signalled
    if (spent()) return OVER_BUDGET;
    try {
      signal(pid);
    } catch (error) {
      // it went between the check and the signal: this did not stop it. Anything else is a process still there
      // that this could not signal, and it is not tried again
      return (error as NodeJS.ErrnoException).code === "ESRCH"
        ? { outcome: "gone" }
        : { outcome: "left", why: "still-alive" };
    }
    const went = await gone(pid);
    return went ? { outcome: "stopped" } : { outcome: "left", why: "still-alive" };
  };

  // one after another, never several at once: the bound is counted in this order, and one root's stops must not
  // interleave with another's. Once the budget is spent nobody else is reached: not even the look is made
  const entries: OldProcessEntry[] = [];
  for (const candidate of candidates) {
    const fate = spent() ? OVER_BUDGET : await judge(candidate);
    const entry: OldProcessEntry = {
      role: candidate.role,
      userRoot: candidate.userRoot,
      pid: candidate.pid,
      sources: [...candidate.sources],
      ...fate,
    };
    entries.push(entry);
    try {
      options.onDecided?.(entry);
    } catch {
      // the caller's own trouble: the outcome stands, and the walk goes on
    }
  }
  return entries;
}
