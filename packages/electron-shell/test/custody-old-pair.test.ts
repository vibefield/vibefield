import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CUSTODY, FILES, LAYOUT, LOG_STREAMS, ORPHAN_BOUND } from "@vibefield/contracts";
import { pairLogRoot } from "@vibefield/logging";
import { FIELD_NATIVE_SIGNING_IDENTIFIER, FIELDD_SIGNING_IDENTIFIER } from "@vibefield/trust";
import { describe, expect, it, vi } from "vitest";
import { createShellCustody, type ShellCustody } from "../src/main/custody/custody";
import {
  OLD_PAIR_CHECK_BOUND,
  type OldPairStopSeams,
  type OldProcessEntry,
  stopOldPairs,
} from "../src/main/custody/old-pair";
import { custodyKeyPath, FIELDD_NOT_STARTED, openCustodyRoot } from "../src/main/custody/root";
import {
  type FakeKeystore,
  type FakePair,
  fakeDerive,
  fakeKeystore,
  filesBelow,
  keptLog,
  keptTrail,
  OWN,
  vibefieldTree,
} from "./custody-fakes";

// OB custody, C1 (OB-D21 A) — a root MADE this boot (none was
// kept, or the kept one did not open) can never reach a pair an earlier root sealed: the old floor refuses the new
// fieldd and keeps its old client, and every start after that fails. So, by itself and before anything is spawned,
// main looks for those processes and stops the ones that are its own.
//   · A file only ever NOMINATES a pid: product.json (the old fieldd, and its floor), the floor's own log lock, and
//     the machine's admission ledger. They are read and never written, locked or removed; one that is too large,
//     not a regular file or not JSON names nobody; and a number that is not a plain pid above 1 (or is main's own)
//     never reaches `process.kill`, not even as the look.
//   · The `codesign` check with the binary's identifier DECIDES, immediately before the signal, and at most sixteen
//     such checks are made in a boot.
//   · fieldd is stopped and waited for before its floor. The one signal is SIGTERM; a process still alive after the
//     bound is `left` and never signalled again; a pid that does not verify is never signalled at all.
// Nothing a person presses reaches any of it. Every reading of the root and every older process is said in main's
// log at once, and in the audit trail once a pair is up. The rows hand the process table, the check and the signal
// as fakes, and the three files as real files under the OS temp dir: nothing here signals a process.

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src", relativePath), "utf8");
const POSIX = process.platform !== "win32";

const FIELDD = FIELDD_SIGNING_IDENTIFIER;
const FLOOR = FIELD_NATIVE_SIGNING_IDENTIFIER;
/** the pair a row's start hands back: the audit trail is appended through it */
const PAIR: FakePair = { pair: "the pair that came up" };

type Tree = ReturnType<typeof vibefieldTree>;

interface World {
  readonly tree: Tree;
  /** the platform log root: each pair's log lock is under `users/<fuid>` of it */
  readonly logRoot: string;
  /** pid → the signing identifier the process there verifies as; null is somebody else's code at that pid */
  readonly processes: Map<number, string | null>;
  /** pid → how many more looks it survives after its signal */
  readonly lingering: Map<number, number>;
  /** `there:<pid>` / `gone:<pid>` (a look), `ask:<pid>:<identifier>` (the check), `signal:<pid>`, `start` */
  readonly events: string[];
  readonly sleeps: number[];
  readonly stop: OldPairStopSeams;
}

function world(
  fuids: readonly number[] = [1],
  options: {
    hold?: Promise<void>;
    isOursThrows?: boolean;
    onSignal?: (pid: number) => void;
    /** false: the process went between its check and its signal (ESRCH) */
    signalFinds?: (pid: number) => boolean;
    /** true: the process is there and may not be signalled (EPERM) */
    signalRefused?: (pid: number) => boolean;
    /** what the world does while the seam waits: a row's way to change a file between two reads of it */
    onSleep?: (ms: number) => void;
    /** what the world does while a process is asked about: a row's way to have the check take time */
    onAsk?: (pid: number) => void;
    goneWaitMs?: number;
    pollMs?: number;
    /** the walk's own clock, moved on by every wait the seam makes */
    clock?: { at: number };
    /** the walk's clock as the row alone says it (instead of `clock`) */
    now?: () => number;
    budgetMs?: number;
  } = {},
): World {
  const clock = options.clock;
  const now = options.now ?? (clock === undefined ? undefined : () => clock.at);
  const processes = new Map<number, string | null>();
  const lingering = new Map<number, number>();
  const signalled = new Set<number>();
  const events: string[] = [];
  const sleeps: number[] = [];
  const stop: OldPairStopSeams = {
    isOurs: async (pid, own, expected) => {
      events.push(`ask:${pid}:${expected.identifier}`);
      options.onAsk?.(pid);
      await options.hold;
      if (options.isOursThrows === true) throw new Error("codesign did not answer");
      return own === OWN && processes.get(pid) === expected.identifier;
    },
    exists: (pid) => {
      const looks = lingering.get(pid);
      if (looks !== undefined && signalled.has(pid)) {
        if (looks === 0) processes.delete(pid);
        else lingering.set(pid, looks - 1);
      }
      const there = processes.has(pid);
      events.push(`${there ? "there" : "gone"}:${pid}`);
      return there;
    },
    signal: (pid) => {
      events.push(`signal:${pid}`);
      options.onSignal?.(pid);
      if (options.signalFinds?.(pid) === false) {
        processes.delete(pid);
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      }
      if (options.signalRefused?.(pid) === true) {
        throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
      }
      signalled.add(pid);
      if (!lingering.has(pid)) processes.delete(pid);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      if (clock !== undefined) clock.at += ms;
      options.onSleep?.(ms);
    },
    ...(options.goneWaitMs === undefined ? {} : { goneWaitMs: options.goneWaitMs }),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
    ...(now === undefined ? {} : { now }),
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
  };
  const tree = vibefieldTree(fuids);
  return {
    tree,
    logRoot: tree.logRoot,
    processes,
    lingering,
    events,
    sleeps,
    stop,
  };
}

const productPath = (userRoot: string): string => join(userRoot, ...LAYOUT.PRODUCT_JSON);
const logLockPath = (w: World, userRoot: string): string =>
  join(pairLogRoot(w.logRoot, userRoot), `${LOG_STREAMS.SYSTEM_FIELD_NATIVE}.ndjson.lock`);
const ledgerPath = (w: World): string => join(w.tree.root, FILES.CUSTODY_ADMISSION_LEDGER);

function write(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** product.json as fieldd writes it, naming whatever the row says for its two pids. */
function writeProduct(userRoot: string, named: { pid: unknown; nativePid: unknown }): string {
  return write(
    productPath(userRoot),
    JSON.stringify({
      port: 50123,
      pid: named.pid,
      bootId: "boot-before",
      contractsVersion: "0.1.0",
      startedAt: 1,
      nativePid: named.nativePid,
      custody: "sealed",
    }),
  );
}

/** The floor's log lock as it writes it: one JSON line. */
const writeLogLock = (w: World, userRoot: string, pid: unknown): string =>
  write(logLockPath(w, userRoot), `${JSON.stringify({ pid, bootId: "boot-before" })}\n`);

/** The machine's admission ledger: one entry per floor that holds a session. */
const writeLedger = (w: World, pids: readonly unknown[]): string =>
  write(
    ledgerPath(w),
    JSON.stringify({
      version: 1,
      entries: pids.map((pid) => ({ pid, bootId: "boot-before", count: 2 })),
    }),
  );

/** One user root's older pair as product.json names it, both alive and VibeField's own unless said otherwise. */
function oldPair(
  w: World,
  userRoot: string,
  pid: number,
  nativePid: number | null,
  verifies: { fieldd?: string | null; floor?: string | null } = {},
): void {
  writeProduct(userRoot, { pid, nativePid });
  w.processes.set(pid, verifies.fieldd === undefined ? FIELDD : verifies.fieldd);
  if (nativePid !== null) {
    w.processes.set(nativePid, verifies.floor === undefined ? FLOOR : verifies.floor);
  }
}

/** The seam, asked about every user root of the row's world. */
const walks = (w: World): Promise<OldProcessEntry[]> =>
  stopOldPairs({
    ...w.stop,
    own: OWN,
    vibefieldRoot: w.tree.root,
    userRoots: w.tree.userRoots,
    logRoot: w.logRoot,
  });

const signals = (events: readonly string[]): string[] =>
  events.filter((event) => event.startsWith("signal:"));
const asks = (events: readonly string[]): string[] =>
  events.filter((event) => event.startsWith("ask:"));
const acts = (events: readonly string[]): string[] =>
  events.filter((event) => event.startsWith("ask:") || event.startsWith("signal:"));

describe("the older pair's stop (C1)", () => {
  it("a renewal reads both pids before it signals", async () => {
    // the old fieldd removes product.json as it stops: whoever needs the floor's pid must have it by then
    const w = world([1], {
      onSignal: (pid) => {
        if (pid === 601) rmSync(productPath(w.tree.userRoots[0]!));
      },
    });
    const userRoot = w.tree.userRoots[0]!;
    oldPair(w, userRoot, 601, 602);

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot, pid: 601, sources: ["product"], outcome: "stopped" },
      { role: "floor", userRoot, pid: 602, sources: ["product"], outcome: "stopped" },
    ]);
    expect(existsSync(productPath(userRoot))).toBe(false);
  });

  it("fieldd is stopped before its floor, each asked about immediately before its signal", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);

    await walks(w);
    expect(w.events).toEqual([
      "there:601",
      `ask:601:${FIELDD}`,
      "signal:601",
      "gone:601",
      "there:602",
      `ask:602:${FLOOR}`,
      "signal:602",
      "gone:602",
    ]);
  });

  it("waits for the old fieldd to be gone before it turns to the floor", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    w.lingering.set(601, 3);

    const entries = await walks(w);
    expect(entries.map((entry) => entry.outcome)).toEqual(["stopped", "stopped"]);
    expect(w.events.indexOf(`ask:602:${FLOOR}`)).toBeGreaterThan(w.events.indexOf("gone:601"));
    expect(w.events.filter((event) => event === "there:601")).toHaveLength(4);
    expect(w.sleeps).toHaveLength(3);
  });

  it("a pid that does not verify is not signalled: it is `left`, `not-ours`, with its sources", async () => {
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    // the pids product.json names belong to other code now: a stranger's program, and a VibeField binary that is
    // not the one the file claims (fieldd's identifier where a floor was named)
    oldPair(w, userRoot, 501, 502, { fieldd: null, floor: FIELDD });

    expect(await walks(w)).toEqual([
      {
        role: "fieldd",
        userRoot,
        pid: 501,
        sources: ["product"],
        outcome: "left",
        why: "not-ours",
      },
      {
        role: "floor",
        userRoot,
        pid: 502,
        sources: ["product"],
        outcome: "left",
        why: "not-ours",
      },
    ]);
    expect(signals(w.events)).toEqual([]);
    expect(acts(w.events)).toEqual([`ask:501:${FIELDD}`, `ask:502:${FLOOR}`]);
    expect([...w.processes.keys()]).toEqual([501, 502]);
  });

  it("a fieldd that does not verify is left, and its floor is still judged on its own", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 701, 702, { fieldd: null });

    const entries = await walks(w);
    expect(entries.map((entry) => [entry.role, entry.outcome])).toEqual([
      ["fieldd", "left"],
      ["floor", "stopped"],
    ]);
    expect(acts(w.events)).toEqual([`ask:701:${FIELDD}`, `ask:702:${FLOOR}`, "signal:702"]);
  });

  it("a check that cannot be made is a doubt, and a doubt signals nothing", async () => {
    const w = world([1], { isOursThrows: true });
    oldPair(w, w.tree.userRoots[0]!, 711, 712);

    const entries = await walks(w);
    expect(entries.map((entry) => [entry.outcome, entry.why])).toEqual([
      ["left", "not-ours"],
      ["left", "not-ours"],
    ]);
    expect(signals(w.events)).toEqual([]);
  });

  it("`processIsOurs` is never called without `expect`", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const isOurs = vi.fn(w.stop.isOurs as NonNullable<OldPairStopSeams["isOurs"]>);

    await stopOldPairs({
      ...w.stop,
      isOurs,
      own: OWN,
      vibefieldRoot: w.tree.root,
      userRoots: w.tree.userRoots,
      logRoot: w.logRoot,
    });
    // the binary each pid is expected to be, by its own identifier: team and runtime alone would call any of
    // VibeField's binaries safe to signal
    expect(isOurs.mock.calls).toEqual([
      [601, OWN, { identifier: FIELDD }],
      [602, OWN, { identifier: FLOOR }],
    ]);
    // and trust's check is called once in the shell, in its three-argument form
    const seam = source("main/custody/old-pair.ts");
    expect(seam.match(/processIsOurs\([^)]*\)/gu)).toEqual(["processIsOurs(pid, own, expect)"]);
    const calling = filesBelow(join(PACKAGE_ROOT, "src")).filter((file) =>
      /\bprocessIsOurs\(/u.test(readFileSync(file, "utf8")),
    );
    expect(calling.map((file) => basename(file))).toEqual(["old-pair.ts"]);
  });

  it("the one signal is SIGTERM and nothing harder is ever sent", async () => {
    // a pid no system gives out: were the spy ever not in place, the first look would find no process there and
    // nothing would be signalled
    const NO_SUCH_PID = 2 ** 31 - 1;
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    writeProduct(userRoot, { pid: NO_SUCH_PID, nativePid: null });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      // the seam's own look and its own signal: only the check and the clock are the row's
      const entries = await stopOldPairs({
        own: OWN,
        vibefieldRoot: w.tree.root,
        userRoots: w.tree.userRoots,
        logRoot: w.logRoot,
        isOurs: async () => true,
        sleep: async () => undefined,
        goneWaitMs: 200,
        pollMs: 100,
      });
      // the spy's process never goes: it is `left`, after ONE signal
      expect(entries).toEqual([
        {
          role: "fieldd",
          userRoot,
          pid: NO_SUCH_PID,
          sources: ["product"],
          outcome: "left",
          why: "still-alive",
        },
      ]);
      expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([
        [NO_SUCH_PID, "SIGTERM"],
      ]);
      expect(kill.mock.calls.every(([pid]) => pid === NO_SUCH_PID)).toBe(true);
    } finally {
      kill.mockRestore();
    }
    // and no other signal is named anywhere in custody's files
    const seam = source("main/custody/old-pair.ts");
    expect(seam.match(/process\.kill\([^)]*\)/gu)).toEqual([
      "process.kill(pid, 0)",
      'process.kill(pid, "SIGTERM")',
    ]);
    for (const file of filesBelow(join(PACKAGE_ROOT, "src", "main", "custody"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /SIGKILL|SIGINT|SIGQUIT|SIGHUP|SIGSTOP|SIGABRT/u,
      );
    }
  });

  it("a process still alive after the bound is `left` and is not signalled again", async () => {
    const w = world([1], { goneWaitMs: 300, pollMs: 100 });
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    w.lingering.set(601, Number.MAX_SAFE_INTEGER);

    // not counted as stopped; the floor is still judged, and main goes on to a start that fails by itself
    const entries = await walks(w);
    expect(entries.map((entry) => [entry.role, entry.outcome, entry.why])).toEqual([
      ["fieldd", "left", "still-alive"],
      ["floor", "stopped", undefined],
    ]);
    expect(w.sleeps).toEqual([100, 100, 100]);
    expect(signals(w.events)).toEqual(["signal:601", "signal:602"]);
    expect(w.processes.has(601)).toBe(true);
  });

  it("a pid that is already gone is `gone`, and is never asked about", async () => {
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    writeProduct(userRoot, { pid: 801, nativePid: 802 });

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot, pid: 801, sources: ["product"], outcome: "gone" },
      { role: "floor", userRoot, pid: 802, sources: ["product"], outcome: "gone" },
    ]);
    expect(w.events).toEqual(["gone:801", "gone:802"]);
  });

  it("a process that goes between its check and its signal is `gone`: this did not stop it", async () => {
    const w = world([1], { signalFinds: (pid) => pid !== 811 });
    oldPair(w, w.tree.userRoots[0]!, 811, 812);

    const entries = await walks(w);
    expect(entries.map((entry) => entry.outcome)).toEqual(["gone", "stopped"]);
    expect(entries[0]).not.toHaveProperty("why");
  });

  it("a process that may not be signalled is `left`, and is not tried again", async () => {
    const w = world([1], { signalRefused: (pid) => pid === 821 });
    oldPair(w, w.tree.userRoots[0]!, 821, 822);

    const entries = await walks(w);
    expect(entries.map((entry) => [entry.outcome, entry.why])).toEqual([
      ["left", "still-alive"],
      ["stopped", undefined],
    ]);
    expect(signals(w.events)).toEqual(["signal:821", "signal:822"]);
  });

  it("an empty list is `nothing was named`: no file, no candidate, no look", async () => {
    const w = world([1, 2]);
    expect(await walks(w)).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("each outcome is said as it is decided, before the seam turns to the next candidate", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    w.lingering.set(601, 2);
    const said: OldProcessEntry[] = [];
    const entries = await stopOldPairs({
      ...w.stop,
      own: OWN,
      vibefieldRoot: w.tree.root,
      userRoots: w.tree.userRoots,
      logRoot: w.logRoot,
      onDecided: (entry) => {
        said.push(entry);
        w.events.push(`decided:${entry.pid}:${entry.outcome}`);
      },
    });
    // the list is what was said, in the order it was said
    expect(said).toEqual(entries);
    expect(said.map((entry) => entry.pid)).toEqual([601, 602]);
    // fieldd's outcome was said when its wait ended, and only then was the floor looked at
    expect(w.events).toEqual([
      "there:601",
      `ask:601:${FIELDD}`,
      "signal:601",
      "there:601",
      "there:601",
      "gone:601",
      "decided:601:stopped",
      "there:602",
      `ask:602:${FLOOR}`,
      "signal:602",
      "gone:602",
      "decided:602:stopped",
    ]);
  });

  it("a caller that throws at an outcome does not undo it, and does not end the walk", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const told: number[] = [];
    const entries = await stopOldPairs({
      ...w.stop,
      own: OWN,
      vibefieldRoot: w.tree.root,
      userRoots: w.tree.userRoots,
      logRoot: w.logRoot,
      onDecided: (entry) => {
        told.push(entry.pid);
        throw new Error("the caller's own trouble");
      },
    });
    expect(told).toEqual([601, 602]);
    expect(entries.map((entry) => entry.outcome)).toEqual(["stopped", "stopped"]);
    expect(signals(w.events)).toEqual(["signal:601", "signal:602"]);
  });

  it("the seam says whose ruling it stands on, what its identifier does not prove, and custody alone asks it", () => {
    const seam = source("main/custody/old-pair.ts");
    expect(seam).toContain(
      "OB-D21 A (`draft/thinking-objects-at-work.md`): an exception to WP12 D10",
    );
    // `field-native door` is the same program as the floor: the identifier is not proof of "the daemon"
    expect(seam).toContain("field-native door");
    const asking = filesBelow(join(PACKAGE_ROOT, "src")).filter((file) =>
      /\bstopOldPairs\(/u.test(readFileSync(file, "utf8")),
    );
    expect(asking.map((file) => basename(file)).sort()).toEqual(["custody.ts", "old-pair.ts"]);
  });
});

describe("where an older floor is looked for: a file nominates, the check decides (C1)", () => {
  it("a root with no `product.json` is still walked: a floor whose `product.json` is gone is found by its log lock", async () => {
    const w = world([1, 2]);
    const [, second] = w.tree.userRoots as [string, string];
    // an update that left the native plane alone, fieldd's own graceful stop: the file is gone and the floor lives
    writeLogLock(w, second, 602);
    w.processes.set(602, FLOOR);

    expect(await walks(w)).toEqual([
      { role: "floor", userRoot: second, pid: 602, sources: ["log-lock"], outcome: "stopped" },
    ]);
    expect(w.events).toEqual(["there:602", `ask:602:${FLOOR}`, "signal:602", "gone:602"]);
  });

  it("a floor named by the admission ledger alone is found, with `userRoot` null, after every user root", async () => {
    const w = world([1, 2]);
    const [first, second] = w.tree.userRoots as [string, string];
    oldPair(w, second, 621, 622);
    oldPair(w, first, 611, 612);
    writeLedger(w, [777]);
    w.processes.set(777, FLOOR);

    const entries = await walks(w);
    expect(entries.at(-1)).toEqual({
      role: "floor",
      userRoot: null,
      pid: 777,
      sources: ["admission"],
      outcome: "stopped",
    });
    // the roots in the order they were given, each root's fieldd before its floor, and the ledger's floors last
    expect(signals(w.events)).toEqual([
      "signal:611",
      "signal:612",
      "signal:621",
      "signal:622",
      "signal:777",
    ]);
  });

  it("a pid named by two files is checked ONCE and carries both sources", async () => {
    const w = world([1, 2]);
    const [first, second] = w.tree.userRoots as [string, string];
    oldPair(w, first, 601, 602);
    writeLogLock(w, first, 602);
    // and again under another root, and by the ledger: still the one floor it is
    writeLogLock(w, second, 602);
    writeLedger(w, [602]);

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot: first, pid: 601, sources: ["product"], outcome: "stopped" },
      {
        role: "floor",
        userRoot: first,
        pid: 602,
        sources: ["product", "log-lock", "admission"],
        outcome: "stopped",
      },
    ]);
    expect(asks(w.events)).toEqual([`ask:601:${FIELDD}`, `ask:602:${FLOOR}`]);
    expect(signals(w.events)).toEqual(["signal:601", "signal:602"]);
  });

  it("a pid named once as a fieldd and once as a floor is checked under each identifier", async () => {
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    // a planted product.json calls the floor's pid a fieldd: that must not hide the floor from its own check
    writeProduct(userRoot, { pid: 602, nativePid: null });
    writeLogLock(w, userRoot, 602);
    w.processes.set(602, FLOOR);

    expect(await walks(w)).toEqual([
      {
        role: "fieldd",
        userRoot,
        pid: 602,
        sources: ["product"],
        outcome: "left",
        why: "not-ours",
      },
      { role: "floor", userRoot, pid: 602, sources: ["log-lock"], outcome: "stopped" },
    ]);
    expect(acts(w.events)).toEqual([`ask:602:${FIELDD}`, `ask:602:${FLOOR}`, "signal:602"]);
  });

  it("a pid the ledger names, that a product.json called a fieldd, is still a floor candidate of the machine's", async () => {
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    writeProduct(userRoot, { pid: 602, nativePid: null });
    writeLedger(w, [602]);
    w.processes.set(602, FLOOR);

    const entries = await walks(w);
    const told = entries.map((one) => [one.role, one.userRoot, one.sources, one.outcome]);
    expect(told).toEqual([
      ["fieldd", userRoot, ["product"], "left"],
      ["floor", null, ["admission"], "stopped"],
    ]);
  });

  it("two roots are walked one after the other: the second root's first check comes after the first root's last wait", async () => {
    const w = world([1, 2]);
    const [first, second] = w.tree.userRoots as [string, string];
    oldPair(w, first, 611, 612);
    oldPair(w, second, 621, 622);
    // the first root's floor takes three more looks to go
    w.lingering.set(612, 3);

    await walks(w);
    expect(w.events).toEqual([
      "there:611",
      `ask:611:${FIELDD}`,
      "signal:611",
      "gone:611",
      "there:612",
      `ask:612:${FLOOR}`,
      "signal:612",
      "there:612",
      "there:612",
      "there:612",
      "gone:612",
      "there:621",
      `ask:621:${FIELDD}`,
      "signal:621",
      "gone:621",
      "there:622",
      `ask:622:${FLOOR}`,
      "signal:622",
      "gone:622",
    ]);
    // and nothing in the seam runs two things at once
    expect(source("main/custody/old-pair.ts")).not.toMatch(/Promise\.all/u);
    expect(source("main/custody/custody.ts")).not.toMatch(/Promise\.all/u);
  });

  it("the lock's line is parsed as JSON whatever its key order", async () => {
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    write(logLockPath(w, userRoot), '{ "bootId" : "boot-before",\t"pid":602 }\n');
    w.processes.set(602, FLOOR);

    expect(await walks(w)).toEqual([
      { role: "floor", userRoot, pid: 602, sources: ["log-lock"], outcome: "stopped" },
    ]);
  });

  it("a ledger read that is empty and then whole names its floor", async () => {
    // every live floor rewrites the ledger in place every few seconds: a reader that takes no lock can find it empty
    const w = world([1], {
      onSleep: (ms) => {
        if (ms === 50) writeLedger(w, [777]);
      },
    });
    write(ledgerPath(w), "");
    w.processes.set(777, FLOOR);

    expect(await walks(w)).toEqual([
      { role: "floor", userRoot: null, pid: 777, sources: ["admission"], outcome: "stopped" },
    ]);
    // one wait, and the second read was whole
    expect(w.sleeps).toEqual([50]);
  });

  it("a ledger read half-written and then whole names its floor too", async () => {
    const w = world([1], {
      onSleep: (ms) => {
        if (ms === 50 && w.sleeps.length === 2) writeLedger(w, [777]);
      },
    });
    write(ledgerPath(w), '{"version":1,"entries":[{"pid":77');
    w.processes.set(777, FLOOR);

    const entries = await walks(w);
    expect(entries.map((entry) => entry.pid)).toEqual([777]);
    expect(w.sleeps).toEqual([50, 50]);
  });

  it("three empty reads name nobody and are not an error", async () => {
    const w = world();
    write(ledgerPath(w), "");
    w.processes.set(777, FLOOR);

    expect(await walks(w)).toEqual([]);
    // three reads in all, fifty milliseconds apart, and then it is left alone: still there, still empty
    expect(w.sleeps).toEqual([50, 50]);
    expect(readFileSync(ledgerPath(w), "utf8")).toBe("");
    expect(w.events).toEqual([]);
  });

  it("a ledger that parses and names nobody is a true nobody: it is not read again", async () => {
    const w = world();
    writeLedger(w, []);
    expect(await walks(w)).toEqual([]);
    expect(w.sleeps).toEqual([]);
  });

  it("only the ledger is read again: a torn product.json or log lock is a miss at once", async () => {
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    write(productPath(userRoot), "");
    write(logLockPath(w, userRoot), "");
    expect(await walks(w)).toEqual([]);
    expect(w.sleeps).toEqual([]);
  });

  it("a pid of 0, 1, a negative, a fraction, a string, or main's own names nobody, and `process.kill` is never called with it", async () => {
    // `kill(0, …)` and `kill(-n, …)` signal a whole process GROUP: none of these may reach it, even as the look
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      for (const planted of [
        0,
        1,
        -1,
        -4321,
        601.5,
        "601",
        null,
        true,
        [601],
        { pid: 601 },
        2 ** 31,
        2 ** 53,
        process.pid,
      ]) {
        const w = world([1, 2]);
        const [first, second] = w.tree.userRoots as [string, string];
        writeProduct(first, { pid: planted, nativePid: planted });
        writeLogLock(w, second, planted);
        writeLedger(w, [planted, planted]);
        const isOurs = vi.fn(async () => true);

        // the seam's own look and its own signal, over the spy: nothing is looked for and nothing is signalled
        const entries = await stopOldPairs({
          own: OWN,
          vibefieldRoot: w.tree.root,
          userRoots: w.tree.userRoots,
          logRoot: w.logRoot,
          isOurs,
          sleep: async () => undefined,
        });
        expect(entries, JSON.stringify(planted)).toEqual([]);
        expect(isOurs, JSON.stringify(planted)).not.toHaveBeenCalled();
      }
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it("main's own pid is never a candidate, whatever a row says it is", async () => {
    const w = world();
    writeProduct(w.tree.userRoots[0]!, { pid: 4242, nativePid: 4242 });
    w.processes.set(4242, FIELDD);
    const entries = await stopOldPairs({
      ...w.stop,
      selfPid: 4242,
      own: OWN,
      vibefieldRoot: w.tree.root,
      userRoots: w.tree.userRoots,
      logRoot: w.logRoot,
    });
    expect(entries).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("a file over 65536 bytes, or one that is not a regular file, or one that does not parse, names nobody and is not an error", async () => {
    const BIG = "x".repeat(65_536);
    const plants: Record<string, (w: World, userRoot: string) => unknown> = {
      "a product.json over the size a naming file may be": (_w, userRoot) =>
        write(productPath(userRoot), JSON.stringify({ pid: 601, nativePid: 602, pad: BIG })),
      "a folder where product.json was": (_w, userRoot) =>
        mkdirSync(productPath(userRoot), { recursive: true }),
      "a product.json torn in the middle": (_w, userRoot) =>
        write(productPath(userRoot), '{"pid":601,"nativeP'),
      "a product.json that is JSON and no object": (_w, userRoot) =>
        write(productPath(userRoot), "[601, 602]"),
      "a log lock that is no JSON": (w, userRoot) => write(logLockPath(w, userRoot), "602\n"),
      "a log lock over the size": (w, userRoot) =>
        write(logLockPath(w, userRoot), JSON.stringify({ pid: 602, bootId: BIG })),
      "a folder where the ledger was": (w) => mkdirSync(ledgerPath(w), { recursive: true }),
      "a ledger whose entries are no list": (w) =>
        write(ledgerPath(w), '{"version":1,"entries":{"pid":602}}'),
      "a ledger torn in the middle": (w) =>
        write(ledgerPath(w), '{"version":1,"entries":[{"pid":602'),
    };
    for (const [name, plant] of Object.entries(plants)) {
      const w = world();
      w.processes.set(601, FIELDD);
      w.processes.set(602, FLOOR);
      plant(w, w.tree.userRoots[0]!);
      expect(await walks(w), name).toEqual([]);
      expect(w.events, name).toEqual([]);
    }
  });

  it.skipIf(!POSIX)(
    "a link where a naming file was is not that file: it is not followed",
    async () => {
      const w = world();
      const userRoot = w.tree.userRoots[0]!;
      w.processes.set(601, FIELDD);
      w.processes.set(602, FLOOR);
      const named = '{"pid":601,"nativePid":602}';
      const elsewhere = write(join(w.tree.root, "elsewhere.json"), named);
      mkdirSync(dirname(productPath(userRoot)), { recursive: true });
      symlinkSync(elsewhere, productPath(userRoot));

      expect(await walks(w)).toEqual([]);
      expect(w.events).toEqual([]);
    },
  );

  it("unknown fields are ignored, and an entry that names nobody does not hide the next", async () => {
    const w = world();
    write(
      ledgerPath(w),
      JSON.stringify({
        version: 9,
        later: { field: true },
        entries: [{ pid: 0, bootId: "b", count: 1 }, "not an entry", { pid: 777, extra: [1, 2] }],
      }),
    );
    w.processes.set(777, FLOOR);

    expect(await walks(w)).toEqual([
      { role: "floor", userRoot: null, pid: 777, sources: ["admission"], outcome: "stopped" },
    ]);
  });

  it("none of the three files is written, locked or removed", async () => {
    // processes that do not verify: nothing stops, so nothing of the pair's own removes a file either
    const w = world();
    const userRoot = w.tree.userRoots[0]!;
    oldPair(w, userRoot, 601, 602, { fieldd: null, floor: null });
    writeLogLock(w, userRoot, 603);
    writeLedger(w, [604]);
    w.processes.set(603, null);
    w.processes.set(604, null);
    const watched = [productPath(userRoot), logLockPath(w, userRoot), ledgerPath(w)];
    const before = watched.map((file) => ({
      bytes: readFileSync(file),
      mtimeMs: statSync(file).mtimeMs,
      mode: statSync(file).mode,
    }));
    const listed = [...filesBelow(w.tree.root), ...filesBelow(w.logRoot)];

    const entries = await walks(w);
    expect(entries.map((entry) => entry.pid)).toEqual([601, 602, 603, 604]);
    watched.forEach((file, index) => {
      expect(readFileSync(file).equals(before[index]!.bytes), file).toBe(true);
      expect(statSync(file).mtimeMs, file).toBe(before[index]!.mtimeMs);
      expect(statSync(file).mode, file).toBe(before[index]!.mode);
    });
    // and nothing was put beside them: no lock, no temporary file, no repair
    expect([...filesBelow(w.tree.root), ...filesBelow(w.logRoot)]).toEqual(listed);
  });

  it("the 17th live candidate is not checked and not signalled", async () => {
    expect(OLD_PAIR_CHECK_BOUND).toBe(16);
    const w = world();
    // a planted ledger: five pids that are nobody (they cost no check), then twenty live floors of VibeField's own
    const dead = [901, 902, 903, 904, 905];
    const live = Array.from({ length: 20 }, (_, index) => 1001 + index);
    writeLedger(w, [...dead, ...live]);
    for (const pid of live) w.processes.set(pid, FLOOR);

    const entries = await walks(w);
    expect(entries.slice(0, 5).map((entry) => entry.outcome)).toEqual(Array(5).fill("gone"));
    expect(entries.slice(5, 21).map((entry) => entry.outcome)).toEqual(Array(16).fill("stopped"));
    expect(entries.slice(21)).toEqual(
      live.slice(16).map((pid) => ({
        role: "floor",
        userRoot: null,
        pid,
        sources: ["admission"],
        outcome: "left",
        why: "over-bound",
      })),
    );
    // sixteen checks, sixteen signals: the planted file could not make main run `codesign` without end
    expect(asks(w.events)).toHaveLength(16);
    expect(signals(w.events)).toHaveLength(16);
    expect(w.processes.size).toBe(4);
  });

  it("the bound counts fieldd and floor candidates together, in the order they are met", async () => {
    const fuids = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const w = world(fuids);
    w.tree.userRoots.forEach((userRoot, index) => {
      oldPair(w, userRoot, 2000 + index * 2, 2001 + index * 2);
    });

    const entries = await walks(w);
    // eight pairs are judged; the ninth root's two are met after the bound
    expect(entries.slice(0, 16).every((entry) => entry.outcome === "stopped")).toBe(true);
    expect(entries.slice(16).map((entry) => [entry.pid, entry.outcome, entry.why])).toEqual([
      [2016, "left", "over-bound"],
      [2017, "left", "over-bound"],
    ]);
    expect(asks(w.events)).toHaveLength(16);
  });

  it("the limit: a floor no file names ends itself after ten idle minutes", () => {
    const limit =
      "The limit: a floor with no log writer open and no session " +
      "is named by no file, the start fails, and that floor ends itself after " +
      "ORPHAN_BOUND.IDLE_EXIT_MS, ten minutes. If the constant moved, that sentence and " +
      "old-pair.ts's header move with it.";
    expect(ORPHAN_BOUND.IDLE_EXIT_MS, limit).toBe(10 * 60_000);
  });
});

describe("the walk has a total budget (C1)", () => {
  // item 18 — sixteen processes each waited for eight seconds would be two minutes of splash
  // before a start that then fails. So the whole walk has ONE budget, measured from its first look on a clock of its
  // own. When it is spent the walk ends: whoever was signalled and is still there is `left`, whoever was not reached
  // is `left` with `over-budget`, and nothing more is looked at, asked about or signalled. Each row's clock is the
  // row's: every wait the seam makes moves it on by what it waited.
  const stillAlive = { outcome: "left", why: "still-alive" } as const;
  const overBudget = { outcome: "left", why: "over-budget" } as const;

  it("a process that goes one wait before the budget is spent is `stopped`", async () => {
    const clock = { at: 0 };
    const w = world([1], { clock, budgetMs: 1_000 });
    const userRoot = w.tree.userRoots[0]!;
    oldPair(w, userRoot, 601, null);
    // there at the ten looks from its signal to 900 ms; gone at the look the budget's last wait ends with
    w.lingering.set(601, 10);

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot, pid: 601, sources: ["product"], outcome: "stopped" },
    ]);
    expect(clock.at).toBe(1_000);
  });

  it("a process that would go one wait after the budget is spent is `left`, and is not signalled again", async () => {
    const clock = { at: 0 };
    const w = world([1], { clock, budgetMs: 1_000 });
    const userRoot = w.tree.userRoots[0]!;
    oldPair(w, userRoot, 601, null);
    w.lingering.set(601, 11);

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot, pid: 601, sources: ["product"], ...stillAlive },
    ]);
    // the wait ended with the budget, far inside the eight seconds one process may be waited for
    expect(clock.at).toBe(1_000);
    expect(signals(w.events)).toEqual(["signal:601"]);
    expect(w.processes.has(601)).toBe(true);
  });

  it("after the budget nothing is looked at, asked about or signalled: what was not reached is `left`, `over-budget`", async () => {
    const clock = { at: 0 };
    const w = world([1, 2], { clock, budgetMs: 1_000 });
    const [first, second] = w.tree.userRoots as [string, string];
    oldPair(w, first, 601, 602);
    oldPair(w, second, 603, 604);
    // the first root's fieldd never goes: the budget is spent waiting for it
    w.lingering.set(601, 999);

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot: first, pid: 601, sources: ["product"], ...stillAlive },
      { role: "floor", userRoot: first, pid: 602, sources: ["product"], ...overBudget },
      { role: "fieldd", userRoot: second, pid: 603, sources: ["product"], ...overBudget },
      { role: "floor", userRoot: second, pid: 604, sources: ["product"], ...overBudget },
    ]);
    expect(acts(w.events)).toEqual([`ask:601:${FIELDD}`, "signal:601"]);
    // not even the look that delivers nothing: the walk has ended, and nothing is done with those pids
    expect(w.events.filter((event) => /:60[234](?::|$)/u.test(event))).toEqual([]);
    expect([602, 603, 604].every((pid) => w.processes.has(pid))).toBe(true);
  });

  it("the per-process wait never exceeds what is left of the budget", async () => {
    // the registry's own budget: the time a start already waits at main for a daemon to be ready
    expect(CUSTODY.OLD_PAIR_WALK_BUDGET_MS).toBe(20_000);
    const clock = { at: 0 };
    const w = world([1, 2], { clock });
    const [first, second] = w.tree.userRoots as [string, string];
    oldPair(w, first, 601, 602);
    oldPair(w, second, 603, 604);
    for (const pid of [601, 602, 603]) w.lingering.set(pid, 999);

    const entries = await walks(w);
    // two were waited for the whole eight seconds each; the third only for the four that were left
    expect(entries.map((entry) => [entry.pid, entry.outcome, entry.why])).toEqual([
      [601, "left", "still-alive"],
      [602, "left", "still-alive"],
      [603, "left", "still-alive"],
      [604, "left", "over-budget"],
    ]);
    expect(clock.at).toBe(CUSTODY.OLD_PAIR_WALK_BUDGET_MS);
    expect(w.sleeps).toEqual(Array(200).fill(100));
    expect(signals(w.events)).toEqual(["signal:601", "signal:602", "signal:603"]);
  });

  it("a check that outlasts the budget is followed by no signal", async () => {
    const clock = { at: 0 };
    const w = world([1], {
      clock,
      budgetMs: 1_000,
      // `codesign` took two seconds to answer about the old fieldd
      onAsk: () => {
        clock.at += 2_000;
      },
    });
    const userRoot = w.tree.userRoots[0]!;
    oldPair(w, userRoot, 601, 602);

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot, pid: 601, sources: ["product"], ...overBudget },
      { role: "floor", userRoot, pid: 602, sources: ["product"], ...overBudget },
    ]);
    expect(w.events).toEqual(["there:601", `ask:601:${FIELDD}`]);
  });

  it("a process that is not VibeField's own is `not-ours` however long its check took", async () => {
    const clock = { at: 0 };
    const w = world([1], {
      clock,
      budgetMs: 1_000,
      onAsk: () => {
        clock.at += 2_000;
      },
    });
    const userRoot = w.tree.userRoots[0]!;
    oldPair(w, userRoot, 601, null, { fieldd: null });

    // what the check found is the fact, and it is said; the budget would only be why nothing followed
    const notOurs = { outcome: "left", why: "not-ours" } as const;
    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot, pid: 601, sources: ["product"], ...notOurs },
    ]);
  });

  it("the budget is measured from the walk's first look: the ledger's second and third reads are inside it", async () => {
    const clock = { at: 0 };
    const w = world([1], { clock, budgetMs: 100 });
    const userRoot = w.tree.userRoots[0]!;
    oldPair(w, userRoot, 601, 602);
    // a torn ledger: read three times, fifty milliseconds apart, before anyone is judged
    write(ledgerPath(w), "");

    expect(await walks(w)).toEqual([
      { role: "fieldd", userRoot, pid: 601, sources: ["product"], ...overBudget },
      { role: "floor", userRoot, pid: 602, sources: ["product"], ...overBudget },
    ]);
    expect(w.sleeps).toEqual([50, 50]);
    expect(w.events).toEqual([]);
  });

  it("a walk inside its budget is the walk it was: the budget adds no wait and takes none away", async () => {
    const clock = { at: 0 };
    const w = world([1], { clock });
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    w.lingering.set(601, 3);

    const entries = await walks(w);
    expect(entries.map((entry) => entry.outcome)).toEqual(["stopped", "stopped"]);
    expect(w.sleeps).toEqual([100, 100, 100]);
  });

  it("the budget is the registry's, read off a clock that never runs backwards", () => {
    const seam = source("main/custody/old-pair.ts");
    expect(seam).toContain("options.budgetMs ?? CUSTODY.OLD_PAIR_WALK_BUDGET_MS");
    // not the wall clock: a clock set back mid-walk must not make the budget longer
    expect(seam).toContain("options.now ?? (() => performance.now())");
    expect(seam).toContain('import { performance } from "node:perf_hooks";');
    expect(seam).not.toMatch(/\bDate\.now\b/u);
    // and custody hands the seam no clock and no budget of its own
    const custody = source("main/custody/custody.ts");
    expect(custody).not.toMatch(/\bbudgetMs\b/u);
  });
});

/** A sealed boot over the row's world. `kept`: what the key file held when the boot read it. */
function boot(
  w: World,
  kept: "none" | "unopenable" | "opens",
  extra: {
    keystore?: FakeKeystore;
    log?: ReturnType<typeof keptLog>;
    trail?: ReturnType<typeof keptTrail>;
    now?: () => number;
    /** the clock custody measures its own intervals on, as the row moves it */
    monotonic?: () => number;
  } = {},
): ShellCustody<FakePair> {
  if (kept !== "none") {
    openCustodyRoot({
      vibefieldRoot: w.tree.root,
      keystore: fakeKeystore(kept === "opens" ? "new" : "old"),
    });
  }
  const keystore = extra.keystore ?? fakeKeystore("new");
  return createShellCustody<FakePair>({
    level: { level: "sealed", own: OWN },
    vibefieldRoot: w.tree.root,
    keystore: () => keystore,
    userRoots: () => w.tree.users,
    logRoot: w.logRoot,
    derive: fakeDerive,
    stop: w.stop,
    ...(extra.log === undefined ? {} : { log: extra.log }),
    ...(extra.trail === undefined ? {} : { audit: extra.trail.audit }),
    ...(extra.now === undefined ? {} : { now: extra.now }),
    ...(extra.monotonic === undefined ? {} : { monotonic: extra.monotonic }),
  });
}

/** A person's ask, as a window's bootstrap makes it: the only ask that reads an unavailable root again. */
const PERSON = { person: true } as const;
/** How far apart two readings of an unavailable root must have started. */
const APART = CUSTODY.ROOT_REREAD_MIN_MS;

/** A pair's start that says when it ran. */
const starting = (w: World) =>
  vi.fn(async (): Promise<FakePair> => {
    w.events.push("start");
    return PAIR;
  });

/** A clock that reads one more each time it is asked: 5001, 5002, and on. */
function ticking(): () => number {
  let at = 5000;
  return () => {
    at += 1;
    return at;
  };
}

const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("a root made this boot: the older pair is stopped before anything is spawned (C1)", () => {
  it.each([
    ["the kept key did not open", "unopenable"],
    ["no key was kept: the first sealed launch over a pair from before custody", "none"],
  ] as const)("stops it by itself, then starts (%s)", async (_name, kept) => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const start = starting(w);

    expect(await boot(w, kept).gate(start)()).toBe(PAIR);
    expect(w.events).toEqual([
      "there:601",
      `ask:601:${FIELDD}`,
      "signal:601",
      "gone:601",
      "there:602",
      `ask:602:${FLOOR}`,
      "signal:602",
      "gone:602",
      "start",
    ]);
  });

  it("a root that opened looks for no process and signals nothing", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    writeLedger(w, [602]);
    const start = starting(w);

    expect(await boot(w, "opens").gate(start)()).toBe(PAIR);
    expect(w.events).toEqual(["start"]);
  });

  it("nothing is started while the older pair is still being stopped", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = world([1], { hold });
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const start = starting(w);
    const custody = boot(w, "unopenable");

    const pending = custody.gate(start)();
    await settled();
    expect(start).not.toHaveBeenCalled();
    expect(signals(w.events)).toEqual([]);

    release();
    expect(await pending).toBe(PAIR);
    expect(w.events.at(-1)).toBe("start");
  });

  it("walks EVERY user root, once: a second start and another user's wait on the same stops", async () => {
    const w = world([1, 2, 3]);
    oldPair(w, w.tree.userRoots[0]!, 901, 902);
    oldPair(w, w.tree.userRoots[2]!, 903, null);
    const custody = boot(w, "unopenable");
    const first = starting(w);
    const second = starting(w);

    const both = await Promise.all([custody.gate(first)(), custody.gate(second)()]);
    expect(both).toEqual([PAIR, PAIR]);
    expect(await custody.gate(first)()).toBe(PAIR);
    expect(signals(w.events)).toEqual(["signal:901", "signal:902", "signal:903"]);
    // every stop came before the first start, and no later start looked again
    expect(w.events.indexOf("start")).toBe(w.events.length - 3);
  });

  it("a pid that does not verify is never signalled, and main goes on to the start", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 501, 502, { fieldd: null, floor: null });
    const start = starting(w);

    // nothing more is built for it: the start that follows fails by itself, against the floor that was left
    expect(await boot(w, "unopenable").gate(start)()).toBe(PAIR);
    expect(signals(w.events)).toEqual([]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a root made at a person's later ask, after the keystore did not answer at boot, stops the older pair then", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const keystore = fakeKeystore("new");
    keystore.answers = false;
    const pace = { at: 0 };
    const custody = boot(w, "unopenable", { keystore, monotonic: () => pace.at });
    const start = starting(w);

    pace.at += APART;
    await expect(custody.gate(start)(PERSON)).rejects.toThrow(FIELDD_NOT_STARTED);
    // while the keystore does not answer no process is looked for, and nothing is signalled
    expect(w.events).toEqual([]);

    // the keystore answers, and an ask nobody made reads nothing: the older pair is not looked for yet
    keystore.answers = true;
    pace.at += APART;
    await expect(custody.gate(start)()).rejects.toThrow(FIELDD_NOT_STARTED);
    expect(w.events).toEqual([]);

    expect(await custody.gate(start)(PERSON)).toBe(PAIR);
    expect(signals(w.events)).toEqual(["signal:601", "signal:602"]);
    expect(w.events.at(-1)).toBe("start");
  });

  it("below `sealed` nothing is signalled and no keystore is constructed", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    writeLogLock(w, w.tree.userRoots[0]!, 602);
    writeLedger(w, [602]);
    const makeKeystore = vi.fn(() => fakeKeystore());
    const trail = keptTrail();
    const custody = createShellCustody<FakePair>({
      level: { level: "files" },
      vibefieldRoot: w.tree.root,
      keystore: makeKeystore,
      userRoots: () => w.tree.users,
      logRoot: w.logRoot,
      stop: w.stop,
      audit: trail.audit,
    });
    const start = starting(w);

    expect(await custody.gate(start)()).toBe(PAIR);
    await settled();
    // no process is asked about, looked for or signalled, and no key is made
    expect(w.events).toEqual(["start"]);
    expect(makeKeystore).not.toHaveBeenCalled();
    expect(existsSync(custodyKeyPath(w.tree.root))).toBe(false);
    expect(trail.appended).toEqual([]);
  });
});

describe("what main records of its root and of an older pair (C1)", () => {
  const record = (
    action: "root" | "pair",
    target: { kind: string; id: string },
    outcome: "succeeded" | "failed",
    attrs: Record<string, unknown>,
  ) => ({
    action: `shell.custody.${action}`,
    target,
    phase: "outcome",
    outcome,
    operationId: expect.any(String),
    attrs: { ...attrs, deferred: true },
  });
  const SHELL_ROOT = { kind: "custody-root", id: "shell" };
  const USER_1 = { kind: "user-root", id: "user-1" };
  const MACHINE = { kind: "vibefield-root", id: "machine" };

  it("every outcome is audited: in main's log at once, and in the trail once a pair is up, in order", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const keystore = fakeKeystore("new");
    keystore.answers = false;
    const log = keptLog();
    const trail = keptTrail();
    const pace = { at: 0 };
    const custody = boot(w, "none", {
      keystore,
      log,
      trail,
      now: ticking(),
      monotonic: () => pace.at,
    });
    const start = starting(w);

    // the boot's reading is said at once, before any pair exists
    expect(log.lines).toEqual([
      {
        level: "warn",
        event: "desktop.custody.root_unavailable",
        message: expect.any(String),
        attrs: { outcome: "unavailable", cause: "keystore-unavailable" },
      },
    ]);
    pace.at += APART;
    await expect(custody.gate(start)(PERSON)).rejects.toThrow(FIELDD_NOT_STARTED);
    await settled();
    // an append IS a start, so nothing is appended while no pair is up
    expect(trail.appended).toEqual([]);

    keystore.answers = true;
    pace.at += APART;
    expect(await custody.gate(start)(PERSON)).toBe(PAIR);
    await vi.waitFor(() => expect(trail.appended).toHaveLength(5));
    // appended through the pair that came up, never through a start of its own
    expect(start).toHaveBeenCalledTimes(1);
    expect(trail.appended.every(({ through }) => through === PAIR)).toBe(true);
    // each says when it HAPPENED and that it waited
    const unavailable = { outcome: "unavailable", cause: "keystore-unavailable" };
    expect(trail.appended.map((appended) => appended.record)).toEqual([
      record("root", SHELL_ROOT, "failed", { ...unavailable, at: 5001 }),
      record("root", SHELL_ROOT, "failed", { ...unavailable, at: 5002 }),
      record("root", SHELL_ROOT, "succeeded", { outcome: "made-absent", at: 5003 }),
      record("pair", USER_1, "succeeded", {
        role: "fieldd",
        outcome: "stopped",
        sources: ["product"],
        pid: 601,
        at: 5004,
      }),
      record("pair", USER_1, "succeeded", {
        role: "floor",
        outcome: "stopped",
        sources: ["product"],
        pid: 602,
        sessionsEnded: true,
        at: 5005,
      }),
    ]);
    expect(new Set(trail.appended.map((appended) => appended.record.operationId)).size).toBe(5);
    expect(log.lines.map((line) => line.event)).toEqual([
      "desktop.custody.root_unavailable",
      "desktop.custody.root_unavailable",
      "desktop.custody.root_made",
      "desktop.custody.old_process",
      "desktop.custody.old_process",
      "desktop.custody.old_pairs_walked",
    ]);

    // appended once: a later start appends nothing again
    expect(await custody.gate(start)()).toBe(PAIR);
    await settled();
    expect(trail.appended).toHaveLength(5);
  });

  it("a record's `at` is when THAT process's outcome was decided, not when the walk ended", async () => {
    // the walk's own clock: every wait the seam makes moves it on by what it waited
    let clock = 10_000;
    const w = world([1], {
      onSleep: (ms) => {
        clock += ms;
      },
    });
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    w.lingering.set(601, 3);
    w.lingering.set(602, 2);
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: () => clock });

    await custody.gate(starting(w))();
    await vi.waitFor(() => expect(trail.appended).toHaveLength(3));
    // the root at once; the old fieldd when its three waits ended; its floor two waits after that
    const at = trail.appended.map((appended) => appended.record.attrs?.["at"]);
    expect(at).toEqual([10_000, 10_300, 10_500]);
    expect(w.sleeps).toEqual([100, 100, 100, 100, 100]);
  });

  it("main's log says each older process when its outcome is decided, not when the walk ends", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    // the check of the SECOND candidate is held: the first has been decided, and the walk has not ended
    const w = world();
    const { isOurs } = w.stop;
    const held: OldPairStopSeams = {
      ...w.stop,
      isOurs: async (pid, own, expected) => {
        if (pid === 602) await hold;
        return (isOurs as NonNullable<OldPairStopSeams["isOurs"]>)(pid, own, expected);
      },
    };
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const log = keptLog();
    openCustodyRoot({ vibefieldRoot: w.tree.root, keystore: fakeKeystore("old") });
    const custody = createShellCustody<FakePair>({
      level: { level: "sealed", own: OWN },
      vibefieldRoot: w.tree.root,
      keystore: () => fakeKeystore("new"),
      userRoots: () => w.tree.users,
      logRoot: w.logRoot,
      derive: fakeDerive,
      stop: held,
      log,
    });

    const pending = custody.gate(starting(w))();
    await settled();
    const said = (): unknown[] =>
      log.lines
        .filter((line) => line.event === "desktop.custody.old_process")
        .map((line) => line.attrs?.["pid"]);
    expect(said()).toEqual([601]);
    release();
    await pending;
    expect(said()).toEqual([601, 602]);
  });

  it("a root that simply opened is in main's log and not in the trail", async () => {
    const w = world();
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "opens", { log, trail });

    expect(await custody.gate(starting(w))()).toBe(PAIR);
    await settled();
    expect(log.lines).toEqual([
      {
        level: "info",
        event: "desktop.custody.root_opened",
        message: expect.any(String),
        attrs: { outcome: "opened" },
      },
    ]);
    expect(trail.appended).toEqual([]);
  });

  it("a key that did not open is said as such: `made-unopenable`", async () => {
    const w = world();
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });

    await custody.gate(starting(w))();
    await vi.waitFor(() => expect(trail.appended).toHaveLength(1));
    expect(trail.appended[0]?.record).toEqual(
      record("root", SHELL_ROOT, "succeeded", { outcome: "made-unopenable", at: 5001 }),
    );
    expect(log.lines[0]).toMatchObject({
      level: "warn",
      event: "desktop.custody.root_made",
      attrs: { outcome: "made-unopenable" },
    });
    // nothing was named: the walk says so in main's log, and the trail holds no pair
    expect(log.lines[1]).toEqual({
      level: "info",
      event: "desktop.custody.old_pairs_walked",
      message: expect.any(String),
      attrs: {
        userRoots: 1,
        named: 0,
        stopped: 0,
        left: 0,
        gone: 0,
        overBound: 0,
        overBudget: 0,
      },
    });
  });

  it("the audit of a renewal says the floor's sessions ended and names no count", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });

    await custody.gate(starting(w))();
    await vi.waitFor(() => expect(trail.appended).toHaveLength(3));
    const lines = log.lines.filter((said) => said.event === "desktop.custody.old_process");
    expect(lines).toEqual([
      {
        level: "warn",
        event: "desktop.custody.old_process",
        message: expect.not.stringMatching(/sessions/u),
        attrs: {
          role: "fieldd",
          userId: "user-1",
          pid: 601,
          sources: ["product"],
          outcome: "stopped",
        },
      },
      {
        level: "warn",
        event: "desktop.custody.old_process",
        message: expect.stringMatching(/sessions ended/u),
        attrs: {
          role: "floor",
          userId: "user-1",
          pid: 602,
          sources: ["product"],
          outcome: "stopped",
          sessionsEnded: true,
        },
      },
    ]);
    // main cannot know how many sessions the floor held: nothing says a number of them
    expect(lines[1]?.message).not.toMatch(/\d/u);
    const attrs: Record<string, unknown> = trail.appended[2]?.record.attrs ?? {};
    expect(attrs["sessionsEnded"]).toBe(true);
    expect(Object.keys(attrs)).not.toContain("count");
    expect(Object.keys(trail.appended[1]?.record.attrs ?? {})).not.toContain("sessionsEnded");
  });

  it("a floor that was left ended no session main can speak for, and the record says why it was left", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602, { floor: null });
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });

    await custody.gate(starting(w))();
    await vi.waitFor(() => expect(trail.appended).toHaveLength(3));
    expect(trail.appended[2]?.record).toEqual(
      record("pair", USER_1, "failed", {
        role: "floor",
        outcome: "left",
        why: "not-ours",
        sources: ["product"],
        pid: 602,
        at: 5003,
      }),
    );
    const said = log.lines.filter((line) => line.event === "desktop.custody.old_process");
    expect(said.every((line) => !/sessions ended/u.test(line.message))).toBe(true);
    expect(log.lines.at(-1)?.attrs).toMatchObject({ named: 2, stopped: 1, left: 1 });
  });

  it("`gone` is main's log only, and the ledger's floor is recorded against the machine", async () => {
    const w = world();
    writeProduct(w.tree.userRoots[0]!, { pid: 801, nativePid: 802 });
    writeLedger(w, [777]);
    w.processes.set(777, FLOOR);
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });

    await custody.gate(starting(w))();
    await vi.waitFor(() => expect(trail.appended).toHaveLength(2));
    expect(trail.appended[1]?.record).toEqual(
      record("pair", MACHINE, "succeeded", {
        role: "floor",
        outcome: "stopped",
        sources: ["admission"],
        pid: 777,
        sessionsEnded: true,
        at: 5002,
      }),
    );
    expect(log.lines.at(-1)).toMatchObject({
      event: "desktop.custody.old_pairs_walked",
      attrs: { userRoots: 1, named: 3, stopped: 1, left: 0, gone: 2, overBound: 0 },
    });
    const said = log.lines.find((line) => line.event === "desktop.custody.old_process");
    expect(said?.attrs).toEqual({
      role: "floor",
      userId: null,
      pid: 777,
      sources: ["admission"],
      outcome: "stopped",
      sessionsEnded: true,
    });
  });

  it("the audit holds ONE over-bound record with its count, and main's log one line for them", async () => {
    const w = world();
    const live = Array.from({ length: 20 }, (_, index) => 1001 + index);
    writeLedger(w, live);
    for (const pid of live) w.processes.set(pid, FLOOR);
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });

    await custody.gate(starting(w))();
    // the root, sixteen floors that were stopped, and ONE record for the four met after the bound
    await vi.waitFor(() => expect(trail.appended).toHaveLength(18));
    const together = { outcome: "left", why: "over-bound", count: 4, at: 5018 };
    expect(trail.appended.at(-1)?.record).toEqual(record("pair", MACHINE, "failed", together));
    const said = log.lines.filter((line) => line.event === "desktop.custody.old_process");
    expect(said).toHaveLength(16);
    expect(log.lines.at(-1)?.attrs).toEqual({
      userRoots: 1,
      named: 20,
      stopped: 16,
      left: 4,
      gone: 0,
      overBound: 4,
      overBudget: 0,
    });
  });

  it("what the budget did not reach is ONE record too, and main goes on to the start", async () => {
    const clock = { at: 0 };
    const w = world([1, 2], { clock, budgetMs: 1_000 });
    const [first, second] = w.tree.userRoots as [string, string];
    oldPair(w, first, 601, 602);
    oldPair(w, second, 603, 604);
    w.lingering.set(601, 999);
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });
    const start = starting(w);

    // the start that follows fails by itself, against the processes that were left: nothing more is built for it
    expect(await custody.gate(start)()).toBe(PAIR);
    expect(start).toHaveBeenCalledTimes(1);
    // the root, the fieldd that was signalled and stayed, and ONE record for the three that were not reached
    await vi.waitFor(() => expect(trail.appended).toHaveLength(3));
    expect(trail.appended[1]?.record).toEqual(
      record("pair", USER_1, "failed", {
        role: "fieldd",
        outcome: "left",
        why: "still-alive",
        sources: ["product"],
        pid: 601,
        at: 5002,
      }),
    );
    const together = { outcome: "left", why: "over-budget", count: 3, at: 5003 };
    expect(trail.appended[2]?.record).toEqual(record("pair", MACHINE, "failed", together));
    // main's log: one line for the process that was signalled, none for those the walk never looked at
    const said = log.lines.filter((line) => line.event === "desktop.custody.old_process");
    expect(said.map((line) => line.attrs?.["pid"])).toEqual([601]);
    expect(log.lines.at(-1)).toEqual({
      level: "warn",
      event: "desktop.custody.old_pairs_walked",
      message: expect.any(String),
      attrs: {
        userRoots: 2,
        named: 4,
        stopped: 0,
        left: 4,
        gone: 0,
        overBound: 0,
        overBudget: 3,
      },
    });
  });

  it("met after the bound and then after the budget, they are still ONE record", async () => {
    // twenty live floors in a planted ledger, and a clock that jumps once the seventeenth has been looked at
    const live = Array.from({ length: 20 }, (_, index) => 1001 + index);
    const w: World = world([1], {
      budgetMs: 1_000,
      now: () => (w.events.includes("there:1017") ? 5_000 : 0),
    });
    writeLedger(w, live);
    for (const pid of live) w.processes.set(pid, FLOOR);
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });

    await custody.gate(starting(w))();
    await vi.waitFor(() => expect(trail.appended).toHaveLength(18));
    // sixteen were stopped; the seventeenth was met after the bound, the last three after the budget
    const together = { outcome: "left", why: "over-bound", count: 4, overBudget: 3, at: 5018 };
    expect(trail.appended.at(-1)?.record).toEqual(record("pair", MACHINE, "failed", together));
    expect(log.lines.at(-1)?.attrs).toEqual({
      userRoots: 1,
      named: 20,
      stopped: 16,
      left: 4,
      gone: 0,
      overBound: 1,
      overBudget: 3,
    });
    expect(asks(w.events)).toHaveLength(16);
    expect(w.events.filter((event) => /:10(?:18|19|20)(?::|$)/u.test(event))).toEqual([]);
  });

  it("the trail is handed the newest 32 of what happened before a pair was up", async () => {
    const w = world();
    const keystore = fakeKeystore("new");
    keystore.answers = false;
    const trail = keptTrail();
    const pace = { at: 0 };
    const custody = boot(w, "none", { keystore, trail, now: ticking(), monotonic: () => pace.at });
    const start = starting(w);
    // the boot's reading and forty asks of a person, two seconds apart: forty-one readings that found the keystore
    // not answering
    for (let ask = 0; ask < 40; ask += 1) {
      pace.at += APART;
      await expect(custody.gate(start)(PERSON)).rejects.toThrow(FIELDD_NOT_STARTED);
    }

    keystore.answers = true;
    pace.at += APART;
    await custody.gate(start)(PERSON);
    await vi.waitFor(() => expect(trail.appended).toHaveLength(32));
    await settled();
    const records = trail.appended.map((appended) => appended.record);
    expect(records).toHaveLength(32);
    // the newest: the last thirty-one refusals, then the root that was made
    const outcomes = records.map((kept) => kept.attrs?.["outcome"]);
    expect(outcomes.slice(0, 31)).toEqual(Array.from({ length: 31 }, () => "unavailable"));
    expect(records[0]?.attrs).toMatchObject({ at: 5011 });
    expect(records[31]?.attrs).toMatchObject({ outcome: "made-absent", at: 5042 });
  });

  it("a refused start never followed by a pair is in main's log and NOT in the audit trail", async () => {
    // the edge §7.4 accepts: a second audit writer in main would cost more than this gap is worth
    const w = world();
    const keystore = fakeKeystore("new");
    keystore.answers = false;
    const log = keptLog();
    const trail = keptTrail();
    const pace = { at: 0 };
    const custody = boot(w, "none", { keystore, log, trail, monotonic: () => pace.at });
    const start = starting(w);

    for (let ask = 0; ask < 2; ask += 1) {
      pace.at += APART;
      await expect(custody.gate(start)(PERSON)).rejects.toThrow(FIELDD_NOT_STARTED);
      // an ask nobody made is refused from that reading: it reads nothing, and says nothing new
      await expect(custody.gate(start)()).rejects.toThrow(FIELDD_NOT_STARTED);
    }
    await settled();
    expect(log.lines.map((line) => line.event)).toEqual([
      "desktop.custody.root_unavailable",
      "desktop.custody.root_unavailable",
      "desktop.custody.root_unavailable",
    ]);
    expect(trail.appended).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  it("a trail that refuses fails no start, and main's log says what it could not append", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    const log = keptLog();
    const trail = keptTrail();
    trail.refuses = true;
    const custody = boot(w, "none", { log, trail });
    const start = starting(w);

    expect(await custody.gate(start)()).toBe(PAIR);
    await vi.waitFor(() =>
      expect(log.lines).toContainEqual(
        expect.objectContaining({
          level: "warn",
          event: "desktop.custody.audit_unavailable",
          attrs: expect.objectContaining({ kept: 3, appended: 0 }),
        }),
      ),
    );
    // once: what could not be appended stays in main's log, and no later start tries again
    trail.refuses = false;
    await custody.gate(start)();
    await settled();
    expect(trail.appended).toEqual([]);
  });

  it("a log line says an error's code and never its message: a path under the home reaches no line", async () => {
    const w = world();
    const planted = writeProduct(w.tree.userRoots[0]!, { pid: 601, nativePid: 602 });
    // a file error as node makes one: its message carries the absolute path, and so does its `path`
    const fileError = Object.assign(new Error(`ENOENT: no such file, open '${planted}'`), {
      code: "ENOENT",
      path: planted,
    });
    const log = keptLog();
    openCustodyRoot({ vibefieldRoot: w.tree.root, keystore: fakeKeystore("old") });
    const custody = createShellCustody<FakePair>({
      level: { level: "sealed", own: OWN },
      vibefieldRoot: w.tree.root,
      keystore: () => fakeKeystore("new"),
      // the walk cannot be made: the roster fails with that file error
      userRoots: () => {
        throw fileError;
      },
      logRoot: w.logRoot,
      derive: fakeDerive,
      stop: w.stop,
      // and the append fails with an error that names the path and carries no code
      audit: async () => {
        throw new Error(`could not write ${planted}`);
      },
      log,
    });

    expect(await custody.gate(starting(w))()).toBe(PAIR);
    const line = (event: string) => log.lines.find((said) => said.event === event);
    await vi.waitFor(() => expect(line("desktop.custody.audit_unavailable")).toBeDefined());
    expect(line("desktop.custody.old_pairs_unwalked")?.attrs).toEqual({ code: "ENOENT" });
    expect(line("desktop.custody.audit_unavailable")?.attrs).toEqual({
      kept: 1,
      appended: 0,
      code: "unknown",
    });
    // no line, at any level, holds the path, the home above it, or the words that carried them
    const said = JSON.stringify(log.lines);
    for (const never of [planted, w.tree.root, w.logRoot, "no such file", "could not write"]) {
      expect(said.includes(never), never).toBe(false);
    }
    // nothing was looked for after the roster failed
    expect(w.events).toEqual(["start"]);
  });

  it.each([
    ["a file error's code", Object.assign(new Error("no"), { code: "EACCES" }), "EACCES"],
    ["a wire error's number", Object.assign(new Error("no"), { code: -32601 }), -32601],
    ["no code at all", new Error("no"), "unknown"],
    ["a code that is a path", Object.assign(new Error("no"), { code: "/Users/a/b" }), "unknown"],
    ["a code that is no token", Object.assign(new Error("no"), { code: { a: 1 } }), "unknown"],
    ["a number that is no whole number", Object.assign(new Error("no"), { code: 0.5 }), "unknown"],
    ["something thrown that is no error", "/Users/a/thrown as a string", "unknown"],
  ])("what a line says of a failed append is its code (%s)", async (_name, thrown, code) => {
    const w = world();
    const log = keptLog();
    // a root made in this boot: one record waits, and the door it is appended through throws what the row says
    const custody = createShellCustody<FakePair>({
      level: { level: "sealed", own: OWN },
      vibefieldRoot: w.tree.root,
      keystore: () => fakeKeystore("new"),
      userRoots: () => w.tree.users,
      logRoot: w.logRoot,
      derive: fakeDerive,
      stop: w.stop,
      audit: async () => {
        throw thrown;
      },
      log,
    });

    await custody.gate(starting(w))();
    const unavailable = () =>
      log.lines.find((said) => said.event === "desktop.custody.audit_unavailable");
    await vi.waitFor(() => expect(unavailable()).toBeDefined());
    expect(unavailable()?.attrs).toEqual({ kept: 1, appended: 0, code });
    expect(JSON.stringify(log.lines)).not.toContain("/Users/a");
  });

  /** A boot that made its root (one record waits) over a door that throws `thrown` at the append; answers what
   * main's log then says of it. */
  async function saidOfAppend(w: World, thrown: unknown): Promise<ReturnType<typeof keptLog>> {
    const log = keptLog();
    const custody = createShellCustody<FakePair>({
      level: { level: "sealed", own: OWN },
      vibefieldRoot: w.tree.root,
      keystore: () => fakeKeystore("new"),
      userRoots: () => w.tree.users,
      logRoot: w.logRoot,
      derive: fakeDerive,
      stop: w.stop,
      audit: async () => {
        throw thrown;
      },
      log,
    });
    await custody.gate(starting(w))();
    await vi.waitFor(() =>
      expect(log.lines.map((said) => said.event)).toContain("desktop.custody.audit_unavailable"),
    );
    return log;
  }
  const unavailableIn = (log: ReturnType<typeof keptLog>) =>
    log.lines.find((said) => said.event === "desktop.custody.audit_unavailable");
  /** An error as a door throws one, with the fields the row says. */
  const failed = (fields: Record<string, unknown>) => Object.assign(new Error("no"), fields);

  it("a refused append is said by its kind: the client's error has a kind, no code, and a path in its words", async () => {
    const w = world();
    const planted = productPath(w.tree.userRoots[0]!);
    // fieldd's client throws a refusal so: a `kind`, the door's words, and no `code`
    const refusal = Object.assign(new Error(`UNAUTHORIZED: no such door for ${planted}`), {
      kind: "UNAUTHORIZED",
      retryable: false,
      details: { path: planted },
    });

    const log = await saidOfAppend(w, refusal);
    expect(unavailableIn(log)?.attrs).toEqual({ kept: 1, appended: 0, code: "UNAUTHORIZED" });
    // the kind and nothing else of the error: not its words, not its details, no part of the path
    const said = JSON.stringify(log.lines);
    for (const never of [planted, w.tree.root, "no such door", "retryable", "details"]) {
      expect(said.includes(never), never).toBe(false);
    }
  });

  it.each([
    ["a kind and no code", failed({ kind: "PRECONDITION_FAILED" }), "PRECONDITION_FAILED"],
    ["a code and a kind: the code", failed({ code: "EIO", kind: "UNAVAILABLE" }), "EIO"],
    ["a path for its code, and a kind", failed({ code: "/Users/a/b", kind: "BUSY" }), "BUSY"],
    ["a kind that is a path", failed({ kind: "/Users/a/k" }), "unknown"],
    ["a kind that is no string", failed({ kind: 7 }), "unknown"],
    ["an empty kind", failed({ kind: "" }), "unknown"],
  ])("what a line says of a failed append with a kind (%s)", async (_name, thrown, code) => {
    const log = await saidOfAppend(world(), thrown);
    expect(unavailableIn(log)?.attrs).toEqual({ kept: 1, appended: 0, code });
    expect(JSON.stringify(log.lines)).not.toContain("/Users/a");
  });

  it("nothing but an error's code and its kind is read for a line", () => {
    const custody = source("main/custody/custody.ts");
    expect(custody).not.toMatch(/\.message\b/u);
    expect(custody).not.toMatch(/\bString\(error\)/u);
    expect(custody).not.toMatch(/\.stack\b|\.details\b|\.retryable\b/u);
  });

  it("neither the log nor the trail holds a secret, the wrapped key or a path", async () => {
    const w = world();
    oldPair(w, w.tree.userRoots[0]!, 601, 602);
    writeLedger(w, [777]);
    w.processes.set(777, null);
    const log = keptLog();
    const trail = keptTrail();
    const custody = boot(w, "unopenable", { log, trail, now: ticking() });

    await custody.gate(starting(w))();
    await vi.waitFor(() => expect(trail.appended).toHaveLength(4));
    const said = JSON.stringify([log.lines, trail.appended]);
    const wrapped = readFileSync(custodyKeyPath(w.tree.root));
    const root = fakeKeystore("new").unwrap(wrapped);
    const handoff = custody.forUserRoot(w.tree.userRoots[0]!)?.handoff();
    for (const kept of [
      root.toString("hex"),
      root.toString("base64"),
      wrapped.toString("hex"),
      wrapped.toString("base64"),
      handoff?.shell,
      handoff?.pairing,
      handoff?.records,
      w.tree.root,
      w.logRoot,
      // the files that were planted under the home, each by its whole path, and the key's own
      productPath(w.tree.userRoots[0]!),
      ledgerPath(w),
      custodyKeyPath(w.tree.root),
      w.tree.userRoots[0],
    ]) {
      expect(typeof kept).toBe("string");
      expect(said.includes(kept as string)).toBe(false);
    }
  });
});
