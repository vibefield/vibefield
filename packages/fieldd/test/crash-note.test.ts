import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  CRASH_NOTE_MESSAGE_MAX,
  CRASH_NOTE_STACK_MAX,
  crashNoteOf,
  keepCrashNote,
  takeCrashNote,
  writeCrashNote,
} from "../src/crash-note";
import { type FloorExit, hearFloorExits, noteFloorExit, watchFloorExit } from "../src/floor-exit";
import { bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

// VT-4a (track VT, 2026-11-24) — nothing dies silently: the note fieldd keeps of an error nobody caught, the next
// boot saying it once, and the way a floor this process started ended.

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "vf-crash-note-"));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const WHO = { at: 1_795_500_000_000, pid: 4242, bootId: "fieldd-test" };

/** The runtime tells the monitor of an error before it acts on it. Said by hand here, so nothing is thrown. */
const sayUncaught = (error: unknown, origin: string): boolean =>
  (process as unknown as { emit(event: string, ...args: unknown[]): boolean }).emit(
    "uncaughtExceptionMonitor",
    error,
    origin,
  );

describe("VT-4a — fieldd's crash note", () => {
  it("keeps an error's name, message and stack, and the runtime's word for how it arrived", () => {
    const error = new TypeError("the index could not be read");
    const note = crashNoteOf(error, "uncaughtException", WHO);
    expect(note).toMatchObject({
      v: 1,
      at: WHO.at,
      pid: 4242,
      bootId: "fieldd-test",
      origin: "uncaughtException",
      name: "TypeError",
      message: "the index could not be read",
    });
    expect(note.stack).toContain("TypeError: the index could not be read");
  });

  it("trusts nothing of what was thrown: a string, null, an object whose fields throw", () => {
    expect(crashNoteOf("plain words", "unhandledRejection", WHO)).toMatchObject({
      name: "Error",
      message: "plain words",
      stack: "",
      origin: "unhandledRejection",
    });
    expect(crashNoteOf(null, "uncaughtException", WHO).message).toBe("null");
    const hostile = Object.create(null, {
      message: {
        get: () => {
          throw new Error("no");
        },
      },
    }) as unknown;
    expect(crashNoteOf(hostile, "uncaughtException", WHO).message).toBe(
      "an error that could not be said",
    );
  });

  it("bounds what it keeps, and says how much it left out", () => {
    const error = new Error("m".repeat(CRASH_NOTE_MESSAGE_MAX + 500));
    error.stack = "s".repeat(CRASH_NOTE_STACK_MAX + 9_000);
    const note = crashNoteOf(error, "uncaughtException", WHO);
    expect(note.message.endsWith("… (500 more)")).toBe(true);
    expect(note.stack.endsWith("… (9000 more)")).toBe(true);
    expect(note.message.length).toBeLessThan(CRASH_NOTE_MESSAGE_MAX + 20);
  });

  it("is written whole in one turn, read once by the next boot, and gone after", () => {
    const path = join(root(), "fieldd", "crash-note.json");
    const note = crashNoteOf(new Error("boom"), "uncaughtException", WHO);
    writeCrashNote(path, note);
    // nothing partial is left beside it
    expect(readdirSync(join(path, ".."))).toEqual(["crash-note.json"]);
    expect(takeCrashNote(path)).toEqual(note);
    expect(existsSync(path)).toBe(false);
    expect(takeCrashNote(path)).toBeNull();
  });

  it("removes a file that is not a note, so a broken one is not read at every boot", () => {
    const dir = root();
    const path = join(dir, "crash-note.json");
    for (const text of ["{ not json", JSON.stringify({ v: 2 }), JSON.stringify(null), "[]"]) {
      writeFileSync(path, text);
      expect(takeCrashNote(path)).toBeNull();
      expect(existsSync(path)).toBe(false);
    }
  });

  it("never throws from the write: a place that cannot be written keeps no note", () => {
    const dir = root();
    writeFileSync(join(dir, "a-file"), "");
    expect(() =>
      writeCrashNote(join(dir, "a-file", "crash-note.json"), crashNoteOf(1, "x", WHO)),
    ).not.toThrow();
  });

  it("watches once a process: the newest daemon's place is written, and a stopped one keeps none", () => {
    const before = process.listenerCount("uncaughtExceptionMonitor");
    const first = join(root(), "crash-note.json");
    const second = join(root(), "crash-note.json");
    const forgetFirst = keepCrashNote(first, "boot-1");
    const forgetSecond = keepCrashNote(second, "boot-2");
    // one listener, however many daemons booted in this process
    expect(process.listenerCount("uncaughtExceptionMonitor")).toBeLessThanOrEqual(before + 1);

    // the runtime tells the monitor of the error before it acts on it; said by hand here, nothing is thrown
    sayUncaught(new RangeError("too deep"), "uncaughtException");
    expect(existsSync(first)).toBe(false);
    expect(takeCrashNote(second)).toMatchObject({
      bootId: "boot-2",
      name: "RangeError",
      message: "too deep",
      pid: process.pid,
    });

    // an older daemon's stop does not take the newer one's watch away
    forgetFirst();
    sayUncaught(new Error("again"), "unhandledRejection");
    expect(takeCrashNote(second)?.origin).toBe("unhandledRejection");

    forgetSecond();
    sayUncaught(new Error("after the stop"), "uncaughtException");
    expect(existsSync(second)).toBe(false);
  });

  it("the next fieldd says the note in its log, once, and removes it", async () => {
    const dir = root();
    const dataDir = join(dir, "data");
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const notePath = join(dataDir, ...LAYOUT.FIELDD_CRASH_NOTE);
    writeCrashNote(
      notePath,
      crashNoteOf(new Error("the last one's end"), "uncaughtException", WHO),
    );
    const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await native.start();
    const logRoot = join(dir, "logs");
    const daemon = await bootstrap({ dataDir, logRoot, controlPort: 0, dataPort: 0 });
    expect(existsSync(notePath)).toBe(false);
    await daemon.stop();
    await native.stop();

    const said: string[] = [];
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const next = join(at, entry.name);
        if (entry.isDirectory()) walk(next);
        else
          for (const line of readFileSync(next, "utf8").split("\n"))
            if (line.includes("fieldd.lifecycle.previous_crash")) said.push(line);
      }
    };
    walk(logRoot);
    expect(said).toHaveLength(1);
    const record = JSON.parse(said[0] ?? "{}") as {
      severity?: string;
      attrs?: Record<string, unknown>;
    };
    expect(record.severity).toBe("ERROR");
    expect(record.attrs).toMatchObject({
      previousPid: 4242,
      previousBootId: "fieldd-test",
      origin: "uncaughtException",
      errorName: "Error",
      errorMessage: "the last one's end",
    });
    // a daemon that stopped keeps no note for a later error in this process
    sayUncaught(new Error("after its stop"), "uncaughtException");
    expect(existsSync(notePath)).toBe(false);
  }, 60_000);
});

describe("VT-4a — how a floor this fieldd started ended", () => {
  const child = (pid: number | undefined) => {
    let exit: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
    return {
      pid,
      once: (
        _event: "exit",
        listener: (code: number | null, signal: NodeJS.Signals | null) => void,
      ) => {
        exit = listener;
      },
      end: (code: number | null, signal: NodeJS.Signals | null) => exit?.(code, signal),
    };
  };

  it("holds an exit seen before the daemon listens, then says each as it happens", () => {
    const early = child(5001);
    watchFloorExit(early, () => 111);
    early.end(null, "SIGKILL");

    const heard: FloorExit[] = [];
    const stop = hearFloorExits((exit) => heard.push(exit));
    expect(heard).toEqual([{ pid: 5001, code: null, signal: "SIGKILL", at: 111 }]);

    const later = child(5002);
    watchFloorExit(later, () => 222);
    later.end(101, null);
    expect(heard.at(-1)).toEqual({ pid: 5002, code: 101, signal: null, at: 222 });

    // after the daemon stops listening the next is held for the next listener, not lost and not said twice
    stop();
    noteFloorExit({ pid: 5003, code: 0, signal: null, at: 333 });
    expect(heard).toHaveLength(2);
    const again: FloorExit[] = [];
    hearFloorExits((exit) => again.push(exit))();
    expect(again).toEqual([{ pid: 5003, code: 0, signal: null, at: 333 }]);
  });

  it("holds a few at most, the newest, and a listener that throws ends nothing", () => {
    for (let n = 0; n < 12; n++) noteFloorExit({ pid: n, code: 1, signal: null, at: n });
    const heard: number[] = [];
    const stop = hearFloorExits((exit) => {
      heard.push(exit.pid ?? -1);
      throw new Error("a log that cannot take it");
    });
    expect(heard).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(() => noteFloorExit({ pid: 99, code: 1, signal: null, at: 99 })).not.toThrow();
    stop();
  });

  it("says a floor with no pid as null, never a made-up one", () => {
    const heard: FloorExit[] = [];
    const stop = hearFloorExits((exit) => heard.push(exit));
    const unknown = child(undefined);
    watchFloorExit(unknown, () => 5);
    unknown.end(1, null);
    expect(heard).toEqual([{ pid: null, code: 1, signal: null, at: 5 }]);
    stop();
  });
});
