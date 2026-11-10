import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CUSTODY } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcCallError } from "../src/native-link";
import { createDeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import {
  capture,
  captureAll,
  cleanupWorlds,
  type DeskWorld,
  type LoggedEvents,
  type Survivor,
  survivor,
  world,
} from "./desk-fixtures";

// OB custody, C5 (OB-D19 A) — a take-back stays taken. Every change to the grants file raises its `generation`, and
// whoever outlives fieldd is told the count (the mark `CUSTODY.MARK_OBJECT_GRANTS`): the floor keeps it in memory, and
// the shell hands what it heard to the next fieldd it spawns. A file below its mark is an older one put back: nothing
// in it is granted, it is set aside, and the count goes on above the mark. And a take-back always takes: memory first,
// then the disk, and a disk that will not take it loses the whole file rather than keep the grant.
//
// The survivor here is the store's own two-method shape. That the floor really keeps a mark and the shell really hands
// it on are their own rows (field-native's marks.rs, the supervisor's hand-off).
//
// Given an injected `marks`: every row here hands the store its survivor (one of desk-fixtures.ts's making), its
// write, its timers and, through the world, `bornFor`, and shows the store's rule given those. That production binds
// the real ones is proved by ob-d's rows through the real daemon, `packages/fieldd/test/custody-boot.test.ts`.

afterEach(() => {
  cleanupWorlds();
  vi.useRealTimers();
});

const MARK = CUSTODY.MARK_OBJECT_GRANTS;
const SPARK = "sp-7k2m9q4x";
/** Mode bits mean nothing on win32, and root writes past them. */
const MODES_BITE = process.platform !== "win32" && process.getuid?.() !== 0;

interface OnDisk {
  generation: number;
  grants: { ref: string; holder: string }[];
}

const grantsOf = (h: DeskWorld): OnDisk => JSON.parse(readFileSync(h.grantsPath, "utf8"));
const staleOf = (h: DeskWorld) =>
  readdirSync(h.root).filter((name) => name.startsWith("objects.grants.json.stale-"));
/** Each time the store said `event`. */
const said = (events: LoggedEvents, event: string) => events.filter((e) => e.event === event);

/** A disk whose write of the grants file can be made to fail, as a full or read-only one does. */
function disk() {
  const state = { failing: false };
  return {
    state,
    writeFile: (path: string, text: string) => {
      if (state.failing) throw Object.assign(new Error("ENOSPC: no space"), { code: "ENOSPC" });
      writeFileSync(path, text, { mode: 0o600 });
    },
  };
}

/** A world whose spark, Vela, thinks in run-1: what she is handed outlives a restart. */
function sparkWorld(opts: Parameters<typeof world>[0] = {}): DeskWorld {
  const h = world(opts);
  h.sparks.set(SPARK, "Vela");
  h.sparkRuns.set("run-1", SPARK);
  h.runs.set("run-1", "live");
  return h;
}

/** Vela's next run, launched by the fieldd running now. */
function wake(h: DeskWorld, run = "run-2") {
  h.sparkRuns.set(run, SPARK);
  h.runs.set(run, "live");
  return run;
}

/** Vela is handed a note (generation 1) and the person takes it back (generation 2). The file as it was while she
 * held it is returned: what an agent that kept a copy would put back. */
async function handedThenTakenBack(h: DeskWorld) {
  const ref = h.refOf("k1", "desk.note");
  h.desk.hand(ref, "run-1");
  const copy = readFileSync(h.grantsPath);
  h.desk.takeBack(ref, `spark:${SPARK}`);
  await h.desk.settled();
  return { ref, copy };
}

describe("every change is counted, and the survivors are told (OB custody, C5)", () => {
  it("raises the generation by one at each change, in one write, and tells the mark each time", async () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    h.desk.takeBack(ref, "run-a");
    expect(grantsOf(h)).toMatchObject({ generation: 3, grants: [{ ref, holder: "run-b" }] });
    await h.desk.settled();
    expect(h.marks.noted).toEqual([
      [MARK, 1],
      [MARK, 2],
      [MARK, 3],
    ]);
    // what changes nothing is no change: a hand the holder already has, a take-back of nothing
    h.desk.hand(ref, "run-b");
    h.desk.takeBack(ref, "run-a");
    expect(grantsOf(h).generation).toBe(3);
  });

  it("moves a `one` kind in one write: the old holder out and the new one in, at one count", () => {
    const h = world();
    const ref = h.refOf("page", "vibefield.page");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    expect(grantsOf(h)).toMatchObject({ generation: 2, grants: [{ ref, holder: "run-b" }] });
  });

  it("ends every grant a settle ends in one write", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(other, "run-a");
    h.desk.hand(other, "run-b");
    const again = h.reopen();
    again.reconcile();
    expect(grantsOf(h)).toEqual(expect.objectContaining({ generation: 4, grants: [] }));
  });

  it("a survivor that does not answer in time is a log line, never a refusal", async () => {
    const events: LoggedEvents = [];
    const silent: Survivor = {
      noted: [],
      get: () => 0,
      note: () => new Promise<number>(() => undefined),
    };
    const h = world({ marks: silent, noteMs: 20, logger: capture(events) });
    const ref = h.refOf("k1", "desk.note");
    expect(h.desk.hand(ref, "run-a")).toEqual({ handed: true });
    await h.desk.settled();
    expect(h.desk.grantOf(ref, "run-a")?.how).toBe("handed");
    expect(events.map((e) => e.event)).toContain("fieldd.objects.grants_mark_unanswered");
  });

  it("a survivor that says no is a log line, never a refusal", async () => {
    const events: LoggedEvents = [];
    const gone: Survivor = {
      noted: [],
      get: () => 0,
      note: async () => {
        throw new Error("the floor is not there");
      },
    };
    const h = world({ marks: gone, logger: capture(events) });
    const ref = h.refOf("k1", "desk.note");
    expect(h.desk.hand(ref, "run-a")).toEqual({ handed: true });
    h.desk.takeBack(ref, "run-a");
    await h.desk.settled();
    expect(h.desk.grants(ref)).toEqual([]);
    expect(said(events, "fieldd.objects.grants_mark_unanswered")).toHaveLength(2);
  });

  it("says a survivor that took no count by a code alone: no part of a path its error's message holds", async () => {
    const calls: unknown[][] = [];
    // what a survivor rejects with may name a file as Node's errors do: its whole path, which holds the person's home
    const planted = "/Users/planted-home/Library/VibeField/native/marks.json";
    const says = `EACCES: permission denied, open '${planted}'`;
    const coded = Object.assign(new Error(says), { code: "EACCES", path: planted });
    const bare = new Error(`marks refused at ${planted}`);
    // a typed refusal, as fieldd's link to the floor makes one: it has a kind, and no code that is a word
    const refused = `link refused at ${planted}`;
    const kinded = new RpcCallError("UNAVAILABLE", refused, false, { path: planted });
    let told = 0;
    const refusing: Survivor = {
      noted: [],
      get: () => 0,
      // it says no as Node would of a file, then with an error that has no code, then with a typed refusal, then
      // never answers
      note: () => {
        told += 1;
        if (told === 1) return Promise.reject(coded);
        if (told === 2) return Promise.reject(bare);
        if (told === 3) return Promise.reject(kinded);
        return new Promise<number>(() => undefined);
      },
    };
    const h = world({ marks: refusing, noteMs: 20, logger: captureAll(calls) });
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    h.desk.hand(other, "run-a");
    h.desk.takeBack(ref, "run-a");
    await h.desk.settled();
    // a line is (event, sentence, attrs): its reason is a code, a typed refusal's kind when it has no code, or the
    // store's own word for a wait that ran out
    const unanswered = calls.filter(([event]) => event === "fieldd.objects.grants_mark_unanswered");
    const reasons = unanswered.map((call) => (call[2] as { reason?: unknown }).reason);
    expect(reasons).toEqual(["EACCES", "unknown", "UNAVAILABLE", "timeout"]);
    // everything every line was handed, with an error's message, stack and fields spelled out
    const spelled = JSON.stringify(calls, (_key, value: unknown) =>
      value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value,
    );
    const never = [
      "planted-home",
      "/Users",
      "marks.json",
      "marks refused at",
      "link refused at",
      "no answer in",
    ];
    for (const part of never) expect(spelled).not.toContain(part);
  });

  it("says `unknown` for a code or a kind that is no plain token: a path in either, or a word past 64 characters", async () => {
    const calls: unknown[][] = [];
    const planted = "/Users/planted-home/Library/VibeField/native/marks.json";
    // What a survivor rejects with, each time: a path where a code goes, a path where a kind goes, a code one
    // character too long, and a code of the longest length that is still said. A code is a word of the code's own
    // choosing, so a field that holds anything else is not printed at all.
    const longest = "E".repeat(64);
    const answers: unknown[] = [
      Object.assign(new Error("refused"), { code: planted }),
      new RpcCallError(planted, "refused"),
      Object.assign(new Error("refused"), { code: `${longest}E` }),
      Object.assign(new Error("refused"), { code: longest }),
    ];
    const refusing: Survivor = {
      noted: [],
      get: () => 0,
      note: () => Promise.reject(answers.shift()),
    };
    const h = world({ marks: refusing, logger: captureAll(calls) });
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    h.desk.hand(other, "run-a");
    h.desk.takeBack(ref, "run-a");
    await h.desk.settled();
    const unanswered = calls.filter(([event]) => event === "fieldd.objects.grants_mark_unanswered");
    const reasons = unanswered.map((call) => (call[2] as { reason?: unknown }).reason);
    expect(reasons).toEqual(["unknown", "unknown", "unknown", longest]);
    const spelled = JSON.stringify(calls);
    for (const part of ["planted-home", "/Users", "marks.json"])
      expect(spelled).not.toContain(part);
  });
});

describe("an older grants file put back is stale (OB custody, C5)", () => {
  it("a restored older file grants nothing and is set aside", async () => {
    const events: LoggedEvents = [];
    const h = sparkWorld({ logger: capture(events) });
    const { ref, copy } = await handedThenTakenBack(h);
    // an agent that kept a copy puts it back, and has fieldd restarted
    writeFileSync(h.grantsPath, copy, { mode: 0o600 });
    const again = h.reopen();
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(again.grants()).toEqual([]);
    expect(existsSync(h.grantsPath)).toBe(false);
    expect(staleOf(h)).toHaveLength(1);
    // said once, by the file's count and the mark, and nothing else
    const stale = said(events, "fieldd.objects.grants_stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.attrs).toEqual({ generation: 1, mark: 2 });
  });

  it("a mark at the top of what a number holds refuses a hand and still lets a take-back take", async () => {
    // the top itself, and a mark past what a number holds exactly, which reads as the top
    for (const top of [Number.MAX_SAFE_INTEGER, 2 ** 60]) {
      const h = world({ retryMs: 60_000 });
      const ref = h.refOf("k1", "desk.note");
      h.desk.hand(ref, "run-a");
      // at `files`, whoever reads the pairing file can set a mark on the floor
      await h.marks.note(MARK, top);
      // the count cannot rise: it never wraps, and nothing is written at a count a number does not hold. The hand
      // throws what a hand the disk would not take throws: the one fixed sentence, with its own code
      expect(() => h.desk.hand(ref, "run-b")).toThrow(
        new Error("the desk objects could not be written (count-full)"),
      );
      expect(h.desk.grantOf(ref, "run-b")).toBeUndefined();
      expect(grantsOf(h)).toMatchObject({ generation: 1, grants: [{ ref, holder: "run-a" }] });
      // a take-back still takes, as one the disk would not take does: memory first, and the file goes
      expect(() => h.desk.takeBack(ref, "run-a")).not.toThrow();
      expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
      expect(h.desk.kept).toBe(false);
      expect(existsSync(h.grantsPath)).toBe(false);
    }
  });

  it("the floor's mark outlives fieldd: a file at its mark is served, and the count goes on from it", async () => {
    const floor = survivor();
    const h = sparkWorld({ marks: floor });
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-1");
    h.desk.hand(other, "run-1");
    await h.desk.settled();
    expect(floor.get(MARK)).toBe(2);
    // fieldd restarts; the floor does not, and it is the floor the next fieldd asks
    const again = h.reopen();
    again.reconcile();
    expect(again.grantOf(ref, wake(h))?.how).toBe("handed");
    again.takeBack(other, `spark:${SPARK}`);
    expect(grantsOf(h)).toMatchObject({ generation: 3, grants: [{ ref }] });
    await again.settled();
    expect(floor.get(MARK)).toBe(3);
  });

  it("the shell hands `expect` to the next fieldd: with the floor gone too, the restored file is still stale", async () => {
    const h = sparkWorld();
    const { ref, copy } = await handedThenTakenBack(h);
    writeFileSync(h.grantsPath, copy, { mode: 0o600 });
    // the floor went down with fieldd, and a new floor remembers nothing. The shell heard 2 on fieldd's stream and
    // hands it to the fieldd it spawns next (`CustodyHandoff.expect`), which is where that fieldd's view starts.
    const again = h.reopen({ marks: survivor({ [MARK]: h.marks.get(MARK) }) });
    expect(h.marks.get(MARK)).toBe(2);
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(staleOf(h)).toHaveLength(1);
  });

  it("with no survivor left to remember, the restored file is served: the boundary the record states (§5.5)", async () => {
    const h = sparkWorld();
    const { ref, copy } = await handedThenTakenBack(h);
    writeFileSync(h.grantsPath, copy, { mode: 0o600 });
    const again = h.reopen({ marks: survivor() });
    expect(again.grantOf(ref, wake(h))?.how).toBe("handed");
  });

  it("the generation continues above the mark after a stale file", async () => {
    const h = sparkWorld();
    const { ref, copy } = await handedThenTakenBack(h);
    writeFileSync(h.grantsPath, copy, { mode: 0o600 });
    const again = h.reopen();
    expect(again.hand(ref, wake(h))).toEqual({ handed: true });
    // the mark was 2: the next change is 3, never the stale file's 1 plus one
    expect(grantsOf(h)).toMatchObject({ generation: 3, grants: [{ ref }] });
    await again.settled();
    expect(h.marks.get(MARK)).toBe(3);
  });

  it("starts above the mark when the file is gone: removing it hands everything back, and resets no count", async () => {
    const h = sparkWorld();
    const { ref } = await handedThenTakenBack(h);
    rmSync(h.grantsPath);
    const again = h.reopen();
    expect(again.grants()).toEqual([]);
    expect(again.hand(ref, wake(h))).toEqual({ handed: true });
    expect(grantsOf(h).generation).toBe(3);
  });

  it("tells a survivor that forgot the count the file is at", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    h.desk.hand(h.refOf("k2", "desk.note"), "run-1");
    // the floor restarted while fieldd was down: it remembers nothing, and learns the count at fieldd's boot
    const floor = survivor();
    const again = h.reopen({ marks: floor });
    await again.settled();
    expect(floor.get(MARK)).toBe(2);
  });
});

describe("a take-back always takes (OB custody, C5; OB-D19 A)", () => {
  it("a take-back that cannot be written still takes back", async () => {
    const { state, writeFile } = disk();
    const h = world({ writeFile, retryMs: 60_000 });
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    state.failing = true;
    expect(() => h.desk.takeBack(ref, "run-a")).not.toThrow();
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(h.desk.grants(ref)).toEqual([]);
    expect(h.desk.kept).toBe(false);
    const verbs = createDeskVerbs({ objects: h.desk });
    await expect(verbs.object_open({ runtimeRunId: "run-a" }, { ref })).rejects.toMatchObject({
      details: { fact: "not-handed" },
    });
  });

  it("still takes back when an agent has put a folder where the store writes (the real disk, no seam)", () => {
    const h = world({ retryMs: 60_000 });
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    // where a store writes beside before it renames: an object's record's, and the grants file's
    const record = join(h.root, "objects", `${ref.slice("vf:obj/".length)}.json`);
    mkdirSync(`${record}.${process.pid}.tmp`);
    mkdirSync(`${h.grantsPath}.${process.pid}.tmp`);
    expect(() => h.desk.takeBack(ref, "run-a")).not.toThrow();
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(h.desk.kept).toBe(false);
    expect(existsSync(h.grantsPath)).toBe(false);
  });

  it("a take-back that cannot be written removes the file and raises the mark", async () => {
    const events: LoggedEvents = [];
    const { state, writeFile } = disk();
    const h = sparkWorld({ writeFile, retryMs: 60_000, logger: capture(events) });
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    const copy = readFileSync(h.grantsPath);
    state.failing = true;
    h.desk.takeBack(ref, `spark:${SPARK}`);
    // the file that still said she held it is gone: a restart finds no grant rather than the one taken back
    expect(existsSync(h.grantsPath)).toBe(false);
    await h.desk.settled();
    expect(h.marks.get(MARK)).toBe(2);
    expect(said(events, "fieldd.objects.grants_unkept")[0]?.attrs).toMatchObject({
      generation: 2,
      removed: true,
    });
    // and the file put back as it was is below the mark
    writeFileSync(h.grantsPath, copy, { mode: 0o600 });
    const again = h.reopen();
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(staleOf(h)).toHaveLength(1);
  });

  it("says a take-back the disk would not take by the error's code alone: no part of a path its message holds", () => {
    const calls: unknown[][] = [];
    // Node's file errors name the file's whole path, in the message and beside it, and that holds the person's home
    const planted = "/Users/planted-home/Library/VibeField/fieldd/objects.grants.json.1.tmp";
    const says = `ENOSPC: no space left on device, open '${planted}'`;
    const coded = Object.assign(new Error(says), { code: "ENOSPC", path: planted });
    const bare = new Error(`write refused at ${planted}`);
    let refused: Error | undefined;
    const h = world({
      logger: captureAll(calls),
      retryMs: 60_000,
      writeFile: (path, text) => {
        if (refused !== undefined) throw refused;
        writeFileSync(path, text, { mode: 0o600 });
      },
    });
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(other, "run-b");
    refused = coded;
    h.desk.takeBack(ref, "run-a");
    // an error with no code is said as `unknown`, and nothing of what it says
    refused = bare;
    h.desk.takeBack(other, "run-b");
    // a line is (event, sentence, error, attrs): no error is handed to the logger, and the attrs carry its code
    const unkept = calls.filter(([event]) => event === "fieldd.objects.grants_unkept");
    expect(unkept.map((call) => call[2])).toEqual([undefined, undefined]);
    const codes = unkept.map((call) => (call[3] as { code?: unknown }).code);
    expect(codes).toEqual(["ENOSPC", "unknown"]);
    // everything every line was handed, with an error's message, stack and fields spelled out
    const spelled = JSON.stringify(calls, (_key, value: unknown) =>
      value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value,
    );
    expect(spelled).toContain("fieldd.objects.grants_unkept");
    for (const part of ["planted-home", "/Users", ".tmp", "write refused at"])
      expect(spelled).not.toContain(part);
  });

  it.skipIf(!MODES_BITE)(
    "a file it cannot remove is said, and is stale at the next boot: the mark rose anyway",
    async () => {
      const events: LoggedEvents = [];
      const h = sparkWorld({ retryMs: 60_000, logger: capture(events) });
      const ref = h.refOf("k1", "desk.note");
      h.desk.hand(ref, "run-1");
      // a folder nothing can be written into or removed from, which an agent can arrange
      chmodSync(h.root, 0o500);
      try {
        h.desk.takeBack(ref, `spark:${SPARK}`);
        expect(h.desk.grantOf(ref, "run-1")).toBeUndefined();
        expect(existsSync(h.grantsPath)).toBe(true);
        expect(said(events, "fieldd.objects.grants_unkept")[0]?.attrs).toMatchObject({
          generation: 2,
          removed: false,
        });
        await h.desk.settled();
        expect(h.marks.get(MARK)).toBe(2);
      } finally {
        chmodSync(h.root, 0o700);
      }
      h.desk.close();
      const again = h.reopen();
      expect(again.grantOf(ref, wake(h))).toBeUndefined();
      expect(staleOf(h)).toHaveLength(1);
    },
  );

  it("writes it again at the next change: the file then holds every take-back", () => {
    const { state, writeFile } = disk();
    const h = world({ writeFile, retryMs: 60_000 });
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    state.failing = true;
    h.desk.takeBack(ref, "run-a");
    expect(h.desk.kept).toBe(false);
    state.failing = false;
    h.desk.hand(other, "run-b");
    expect(h.desk.kept).toBe(true);
    const file = grantsOf(h);
    expect(file.generation).toBe(4);
    expect(file.grants.map((g) => [g.ref, g.holder])).toEqual([
      [ref, "run-b"],
      [other, "run-b"],
    ]);
  });

  it("writes it again on a timer, at the count the survivors were already told", async () => {
    vi.useFakeTimers();
    const events: LoggedEvents = [];
    const { state, writeFile } = disk();
    const h = world({ writeFile, retryMs: 1_000, logger: capture(events) });
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    state.failing = true;
    h.desk.takeBack(ref, "run-a");
    // the disk still refuses at the first try, and takes it at the second
    vi.advanceTimersByTime(1_000);
    expect(h.desk.kept).toBe(false);
    expect(existsSync(h.grantsPath)).toBe(false);
    state.failing = false;
    vi.advanceTimersByTime(1_000);
    expect(h.desk.kept).toBe(true);
    expect(grantsOf(h)).toMatchObject({ generation: 3, grants: [{ ref, holder: "run-b" }] });
    expect(events.map((e) => e.event)).toContain("fieldd.objects.grants_kept");
    await h.desk.settled();
    expect(h.marks.noted.at(-1)).toEqual([MARK, 3]);
  });

  it("a `one` kind's hand that cannot be written is refused, and what it took away stays taken", () => {
    const { state, writeFile } = disk();
    const h = world({ writeFile, retryMs: 60_000 });
    const ref = h.refOf("page", "vibefield.page");
    h.desk.hand(ref, "run-a");
    state.failing = true;
    expect(() => h.desk.hand(ref, "run-b")).toThrow("ENOSPC");
    // nothing is granted that a restart would not find, and the holder it was moving off holds it no more
    expect(h.desk.grantOf(ref, "run-b")).toBeUndefined();
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(h.desk.kept).toBe(false);
    expect(existsSync(h.grantsPath)).toBe(false);
  });
});
